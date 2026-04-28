import sys
import os
import json
import asyncio
import websockets
from fastapi import FastAPI, Request, WebSocket, WebSocketDisconnect, Query
from fastapi.staticfiles import StaticFiles
from fastapi.responses import HTMLResponse, StreamingResponse
from pydantic import BaseModel
from typing import Dict, Optional
import aiortc
from aiortc import RTCPeerConnection, RTCSessionDescription, MediaStreamTrack, RTCIceServer, RTCConfiguration
from aiortc.contrib.media import MediaRelay
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from src.config import get_embedding_model, CARTESIA_VOICE_ID
from src.utils.state import app_state
from src.vectorstore.retriever import get_closest_matches
from src.vectorstore.database_creation import initialize_database
from src.llm.prompts import (
    adaptive_router, generate_chat_response, generate_rag_response_v4, rewrite_query,
    generate_chat_response_stream, generate_rag_response_v4_stream
)

app = FastAPI(title="RAG Avatar API")

# Mount Static Files
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
static_dir = os.path.join(BASE_DIR, "static")
if not os.path.exists(static_dir):
    os.makedirs(static_dir)
app.mount("/static", StaticFiles(directory=static_dir), name="static")

class ChatRequest(BaseModel):
    message: str
    session_id: str = "default_session"

class Offer(BaseModel):
    sdp: str
    type: str

class DualAgentTelemetry(BaseModel):
    query: str
    t_llm_1st_ms: float
    t_llm_done_ms: float
    t_filler_start_ms: float
    t_filler_end_ms: float
    t_audio_start_ms: float

@app.on_event("startup")
async def startup_event():
    print("==================================================")
    print("FastAPI Backend Initializing")
    
    # Boot validation
    if not os.getenv("CARTESIA_API_KEY"):
        raise ValueError("CARTESIA_API_KEY is missing from environment variables")
    if not os.getenv("DEEPGRAM_API_KEY"):
        raise ValueError("DEEPGRAM_API_KEY is missing from environment variables")
    if not os.getenv("GROQ_API_KEY"):
        raise ValueError("GROQ_API_KEY is missing from environment variables")
        
    print("Verifying database and model structures...")
    initialize_database()
    print("Warming up embedding model (this may take a second)...")
    get_embedding_model() # Trigger the lazy load here
    print("System Ready!")
    print("==================================================\n")

@app.websocket("/ws/control")
async def control_socket(ws: WebSocket, session_id: str = Query(default="react_user")):
    """Control channel for barge-in interrupts and turn lifecycle signals."""
    await ws.accept()
    print(f"[Control WS] Connected for session={session_id}")
    try:
        while True:
            data = await ws.receive_text()
            try:
                msg = json.loads(data)
            except json.JSONDecodeError:
                print(f"[Control WS] Ignored malformed JSON from session={session_id}")
                continue
            if msg.get("type") == "barge_in":
                print(f"[BARGE-IN] Interrupting session={session_id}")
                app_state.get_cancel_event(session_id).set()
            elif msg.get("type") == "turn_start":
                print(f"[TURN-START] Resetting cancel event for session={session_id}")
                app_state.get_cancel_event(session_id).clear()
    except WebSocketDisconnect:
        print(f"[Control WS] Disconnected for session={session_id}")

@app.post("/api/telemetry")
async def receive_telemetry(data: DualAgentTelemetry):
    """Prints a unified Dual-Agent Latency Report to the terminal."""
    def fmt(ms_val):
        return f"{ms_val:.0f}ms"

    print("\n" + "═" * 60)
    print(f"  DUAL-AGENT LATENCY REPORT  │  query: \"{data.query[:35]}...\"")
    print("═" * 60)
    print(f"  1. Filler Start (Agent 1) │ {fmt(data.t_filler_start_ms)}  (Target: 200ms)")
    print(f"  2. First LLM Token        │ {fmt(data.t_llm_1st_ms)}")
    print(f"  3. Response Start (Agent 2)│ {fmt(data.t_audio_start_ms)}  (End-to-End)")
    print("─" * 60)
    print(f"  4. Full LLM Finished      │ {fmt(data.t_llm_done_ms)}")
    print("═" * 60)
    
    # Calculate Gaps
    filler_to_response_gap = data.t_audio_start_ms - data.t_filler_end_ms
    print(f"  GAP: Filler → Response    │ {fmt(filler_to_response_gap)}")
    if filler_to_response_gap < 0:
        print(f"  (Note: Real response overlapped filler by {fmt(abs(filler_to_response_gap))})")
    print("═" * 60 + "\n")
    return {"status": "ok"}

@app.get("/", response_class=HTMLResponse)
async def get_index():
    with open(os.path.join(BASE_DIR, "static", "index.html"), "r") as f:
        return f.read()

# Helper classes to decouple the complex logic inside chat_stream_generator
class TTSOrchestrator:
    def __init__(self, session_id: str, output_queue: asyncio.Queue, cancel_event: asyncio.Event):
        self.session_id = session_id
        self.output_queue = output_queue
        self.cancel_event = cancel_event
        self.cartesia_api_key = os.getenv("CARTESIA_API_KEY")
        self.ws = None
        self.context_id = None
        self.receiver_task = None
        self.watcher_task = None
        self.timestamps = {"t_first_audio": None}

    async def connect(self):
        import uuid
        self.context_id = str(uuid.uuid4())
        try:
            self.ws = await websockets.connect(
                f"wss://api.cartesia.ai/tts/websocket?api_key={self.cartesia_api_key}&cartesia_version=2026-03-01"
            )
            self.receiver_task = asyncio.create_task(self._receiver_loop())
            self.watcher_task = asyncio.create_task(self._cancel_watcher())
        except Exception as e:
            print(f"Cartesia WebSocket Connection failed: {e}")
            self.ws = None

    async def _receiver_loop(self):
        recv_seg = {'idx': 0}
        try:
            async for msg in self.ws:
                if type(msg) == str:
                    data = json.loads(msg)
                    if data.get("type") == "done":
                        break
                    elif data.get("type") == "chunk" and "data" in data:
                        if self.timestamps["t_first_audio"] is None:
                            import time
                            self.timestamps["t_first_audio"] = time.perf_counter()
                        await self.output_queue.put(
                            f"data: {json.dumps({'type': 'audio_chunk', 'content': data['data'], 'seg': recv_seg['idx']})}\n\n"
                        )
                    elif data.get("type") == "phoneme_timestamps" and "phoneme_timestamps" in data:
                        pt = data["phoneme_timestamps"]
                        await self.output_queue.put(
                            f"data: {json.dumps({'type': 'phoneme_timestamps', 'content': pt, 'seg': recv_seg['idx']})}\n\n"
                        )
                        recv_seg['idx'] += 1
                    elif data.get("type") == "error":
                        print(f"Cartesia Error: {data.get('error')}")
        except Exception as e:
            print(f"Cartesia receiver error: {e}")

    async def _cancel_watcher(self):
        await self.cancel_event.wait()
        if self.ws and not self.ws.closed:
            try:
                await self.ws.close()
            except Exception:
                pass

    async def send_text(self, text: str, continue_flag: bool = True):
        if not self.ws:
            return
        req = {
            "context_id": self.context_id,
            "model_id": "sonic-turbo",
            "transcript": text,
            "voice": {
                "mode": "id",
                "id": CARTESIA_VOICE_ID
            },
            "output_format": {
                "container": "raw",
                "encoding": "pcm_f32le",
                "sample_rate": 44100
            },
            "add_phoneme_timestamps": True,
            "continue": continue_flag
        }
        try:
            if not self.cancel_event.is_set():
                await self.ws.send(json.dumps(req))
        except Exception as e:
            print(f"Cartesia send error: {e}")

    async def close(self):
        if self.watcher_task:
            self.watcher_task.cancel()
        if self.ws:
            try:
                if self.receiver_task and not self.cancel_event.is_set():
                    await asyncio.wait_for(self.receiver_task, timeout=30.0)
            except Exception:
                pass
            try:
                await self.ws.close()
            except Exception:
                pass

class SpeechTagParser:
    def __init__(self):
        self.is_in_speech = False
        self.parser_buffer = ""
        self.speech_buffer = ""

    def process_chunk(self, chunk: str) -> str:
        """Returns completed text ready for synthesis, if any."""
        self.parser_buffer += chunk
        ready_text = ""

        if not self.is_in_speech:
            if "<speech>" in self.parser_buffer:
                parts = self.parser_buffer.split("<speech>", 1)
                self.is_in_speech = True
                self.speech_buffer += parts[1]
                self.parser_buffer = ""
        else:
            if "</speech>" in self.parser_buffer:
                parts = self.parser_buffer.split("</speech>", 1)
                self.speech_buffer += parts[0]
                self.is_in_speech = False
                self.parser_buffer = ""
            else:
                if len(self.parser_buffer) > 10:
                    to_process = self.parser_buffer[:-10]
                    self.speech_buffer += to_process
                    self.parser_buffer = self.parser_buffer[-10:]

        if len(self.speech_buffer.split(" ")) >= 2:
            words = self.speech_buffer.split(" ")
            ready_text = " ".join(words[:-1]) + " "
            self.speech_buffer = words[-1]

        return ready_text

    def flush(self) -> str:
        final_text = self.speech_buffer
        if self.is_in_speech:
            final_text += self.parser_buffer
        return final_text

async def chat_stream_generator(user_query: str, session_id: str):
    import time
    t0 = time.perf_counter()

    cancel_event = app_state.get_cancel_event(session_id)
    cancel_event.clear()

    chat_history = app_state.get_session(session_id)
    output_queue = asyncio.Queue()

    timestamps = {
        "t_first_token": None,
        "t_llm_done": None
    }

    async def orchestrate():
        try:
            full_response = ""
            tts = TTSOrchestrator(session_id, output_queue, cancel_event)
            await tts.connect()
            parser = SpeechTagParser()
            
            try:
                retrieved = get_closest_matches(user_query=user_query, k=5)
            except Exception as re:
                print(f"Retriever Error: {re}")
                retrieved = []
            
            llm_stream = generate_rag_response_v4_stream(user_query=user_query, retrieved_documents=retrieved, chat_history=chat_history)
            
            async for chunk in llm_stream:
                if cancel_event.is_set():
                    print(f"[CANCELLED] LLM stream aborted for session={session_id}")
                    break
                if timestamps["t_first_token"] is None:
                    timestamps["t_first_token"] = time.perf_counter()
                
                full_response += chunk
                await output_queue.put(f"data: {json.dumps({'type': 'chunk', 'content': chunk})}\n\n")

                if tts.ws:
                    ready_text = parser.process_chunk(chunk)
                    if ready_text:
                        await tts.send_text(ready_text, continue_flag=True)

            timestamps["t_llm_done"] = time.perf_counter()

            if tts.ws:
                final_text = parser.flush()
                await tts.send_text(final_text, continue_flag=False)
                await tts.close()

            app_state.update_session(session_id, f"User: {user_query}\nAvatar: {full_response}\n")

        except Exception as e:
            await output_queue.put(f"data: {json.dumps({'type': 'error', 'content': str(e)})}\n\n")
        finally:
            server_metrics = {
                "t_first_token": timestamps["t_first_token"] - t0 if timestamps["t_first_token"] else 0,
                "t_llm_done": timestamps["t_llm_done"] - t0 if timestamps["t_llm_done"] else 0
            }
            await output_queue.put(f"data: {json.dumps({'type': 'done', 'server_metrics': server_metrics})}\n\n")
            await output_queue.put(None) 

    asyncio.create_task(orchestrate())

    while True:
        msg = await output_queue.get()
        if msg is None:
            break
        if cancel_event.is_set():
            try:
                payload_str = msg[6:].strip()
                if payload_str and json.loads(payload_str).get('type') == 'audio_chunk':
                    continue
            except Exception:
                pass
        yield msg

async def process_audio_track(track, get_channel):
    import av
    api_key = os.getenv("DEEPGRAM_API_KEY")
    if not api_key:
        print("Missing DEEPGRAM_API_KEY")
        return

    DEEPGRAM_URL = 'wss://api.deepgram.com/v1/listen?model=nova-2&encoding=linear16&sample_rate=16000&channels=1&smart_format=true&interim_results=true&endpointing=500'
    
    resampler = av.AudioResampler(
        format='s16',
        layout='mono',
        rate=16000,
    )

    try:
        async with websockets.connect(
            DEEPGRAM_URL, 
            additional_headers={"Authorization": f"Token {api_key}"}
        ) as dg_socket:
            
            async def dg_receiver():
                try:
                    while True:
                        result = await dg_socket.recv()
                        channel = get_channel()
                        if channel and channel.readyState == "open":
                            channel.send(result)
                except Exception as e:
                    print(f"Deepgram WebRTC Receiver Error: {e}")

            receiver_task = asyncio.create_task(dg_receiver())

            try:
                while True:
                    frame = await track.recv()
                    resampled_frames = resampler.resample(frame)
                    for f in resampled_frames:
                        await dg_socket.send(f.to_ndarray().tobytes())
            except Exception as e:
                print(f"Audio track processing ended: {e}")
            finally:
                receiver_task.cancel()
    except Exception as e:
        print(f"Deepgram WebRTC Connection Error: {e}")

@app.post("/api/offer")
async def offer(params: Offer):
    offer = RTCSessionDescription(sdp=params.sdp, type=params.type)
    pc = RTCPeerConnection()
    app_state.add_pc(pc)

    data_channel = None

    @pc.on("datachannel")
    def on_datachannel(channel):
        nonlocal data_channel
        data_channel = channel
        print(f"Data channel established: {channel.label}")

    @pc.on("track")
    def on_track(track):
        if track.kind == "audio":
            print("Audio track received via WebRTC")
            async def start_processing():
                await process_audio_track(track, lambda: data_channel)
            asyncio.create_task(start_processing())

    @pc.on("iceconnectionstatechange")
    async def on_iceconnectionstatechange():
        if pc.iceConnectionState == "failed" or pc.iceConnectionState == "closed":
            await pc.close()
            app_state.remove_pc(pc)

    await pc.setRemoteDescription(offer)
    answer = await pc.createAnswer()
    await pc.setLocalDescription(answer)

    return {
        "sdp": pc.localDescription.sdp,
        "type": pc.localDescription.type
    }

@app.post("/api/chat_stream")
async def chat_endpoint_stream(req: ChatRequest):
    return StreamingResponse(
        chat_stream_generator(req.message, req.session_id),
        media_type="text/event-stream"
    )

@app.post("/api/chat")
async def chat_endpoint(req: ChatRequest):
    user_query = req.message
    session_id = req.session_id
    
    chat_history = app_state.get_session(session_id)
    
    try:
        route = adaptive_router(chat_history=chat_history, latest_user_query=user_query)
        
        if route == "CHAT":
            response = generate_chat_response(user_query=user_query, chat_history=chat_history)
            thoughts = "No thoughts needed for casual chat."
        else:
            new_prompt = rewrite_query(chat_history=chat_history, latest_user_query=user_query)
            try:
                retrieved = get_closest_matches(user_query=new_prompt, k=3)
            except Exception as re:
                print(f"Retriever Error: {re}")
                retrieved = []
            
            response, thoughts = generate_rag_response_v4(user_query=new_prompt, retrieved_documents=retrieved, chat_history=chat_history)
            
        app_state.update_session(session_id, f"User: {user_query}\nAvatar: {response}\n")
        
        return {
            "response": response,
            "thoughts": thoughts,
            "route": route
        }
    except Exception as e:
        return {
            "error": str(e)
        }

@app.post("/api/clear")
async def clear_session(req: ChatRequest):
    app_state.clear_session(req.session_id)
    return {"status": "cleared"}
