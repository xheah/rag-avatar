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

from src.config import get_embedding_model
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

# We will store chat history per session
sessions: Dict[str, str] = {}

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

pcs = set()

# Per-session cancellation events for barge-in interrupts
cancel_events: Dict[str, asyncio.Event] = {}

@app.on_event("startup")
async def startup_event():
    print("==================================================")
    print("FastAPI Backend Initializing")
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
    if session_id not in cancel_events:
        cancel_events[session_id] = asyncio.Event()
    print(f"[Control WS] Connected for session={session_id}")
    try:
        while True:
            data = await ws.receive_text()
            msg = json.loads(data)
            if msg.get("type") == "barge_in":
                print(f"[BARGE-IN] Interrupting session={session_id}")
                cancel_events[session_id].set()
            elif msg.get("type") == "turn_start":
                print(f"[TURN-START] Resetting cancel event for session={session_id}")
                cancel_events[session_id].clear()
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

async def chat_stream_generator(user_query: str, session_id: str):  # noqa: C901
    import time
    import uuid
    import asyncio
    t0 = time.perf_counter()

    # Get or create a cancel event for this session and reset it for this turn
    if session_id not in cancel_events:
        cancel_events[session_id] = asyncio.Event()
    cancel_event = cancel_events[session_id]
    cancel_event.clear()

    if session_id not in sessions:
        sessions[session_id] = ""
    chat_history = sessions[session_id]

    cartesia_api_key = os.getenv("CARTESIA_API_KEY")
    output_queue = asyncio.Queue()

    # Latency tracking inside the orchestrator
    timestamps = {
        "t_first_token": None,
        "t_llm_done": None,
        "t_first_audio": None
    }

    async def orchestrate():
        try:
            full_response = ""

            cartesia_ws = None
            context_id = str(uuid.uuid4())
            
            # Setup websocket manually if key logic passes
            if cartesia_api_key:
                try:
                    cartesia_ws = await websockets.connect(
                        f"wss://api.cartesia.ai/tts/websocket?api_key={cartesia_api_key}&cartesia_version=2026-03-01"
                    )
                except Exception as e:
                    print(f"Cartesia WebSocket Connection failed: {e}")
                    cartesia_ws = None

            async def cartesia_receiver():
                if not cartesia_ws:
                    return
                # Track which text segment we are currently receiving audio for.
                # Each time a 'timestamps' message arrives it signals the end of
                # the audio for one text segment, so we bump the index.
                recv_seg = {'idx': 0}
                try:
                    async for msg in cartesia_ws:
                        if type(msg) == str:
                            data = json.loads(msg)
                            if data.get("type") == "done":
                                break
                            elif data.get("type") == "chunk" and "data" in data:
                                if timestamps["t_first_audio"] is None:
                                    timestamps["t_first_audio"] = time.perf_counter()
                                await output_queue.put(
                                    f"data: {json.dumps({'type': 'audio_chunk', 'content': data['data'], 'seg': recv_seg['idx']})}\n\n"
                                )
                            elif data.get("type") == "timestamps" and "word_timestamps" in data:
                                wt = data["word_timestamps"]
                                await output_queue.put(
                                    f"data: {json.dumps({'type': 'word_timestamps', 'content': wt, 'seg': recv_seg['idx']})}\n\n"
                                )
                                # Timestamps mark the end of this segment's audio stream
                                recv_seg['idx'] += 1
                            elif data.get("type") == "error":
                                print(f"Cartesia Error: {data.get('error')}")
                except Exception as e:
                    print(f"Cartesia receiver error: {e}")

            # Start Cartesia receiver
            receiver_task = asyncio.create_task(cartesia_receiver()) if cartesia_ws else None

            async def cancel_watcher():
                """Closes Cartesia WS immediately when a barge-in fires."""
                await cancel_event.wait()
                if cartesia_ws and not cartesia_ws.closed:
                    try:
                        await cartesia_ws.close()
                    except Exception:
                        pass

            watcher_task = asyncio.create_task(cancel_watcher()) if cartesia_ws else None

            # Tag-aware speech streaming state
            is_in_speech = False
            speech_parser_buffer = "" # Accumulates raw chunks to find tags
            speech_buffer = ""        # Accumulates text for Cartesia synthesis
            
            try:
                retrieved = get_closest_matches(user_query=user_query, k=5)
            except Exception as re:
                print(f"Retriever Error: {re}")
                retrieved = []
            
            llm_stream = generate_rag_response_v4_stream(user_query=user_query, retrieved_documents=retrieved, chat_history=chat_history)
            
            async for chunk in llm_stream:
                # Barge-in: abort generation immediately
                if cancel_event.is_set():
                    print(f"[CANCELLED] LLM stream aborted for session={session_id}")
                    break
                if timestamps["t_first_token"] is None:
                    timestamps["t_first_token"] = time.perf_counter()
                
                full_response += chunk
                await output_queue.put(f"data: {json.dumps({'type': 'chunk', 'content': chunk})}\n\n")

                if cartesia_ws:
                    # Append new chunk to parser buffer
                    speech_parser_buffer += chunk

                    # If we are NOT in a speech block, look for the start tag
                    if not is_in_speech:
                        if "<speech>" in speech_parser_buffer:
                            # Split after the tag to get any text that followed it in the same chunk
                            parts = speech_parser_buffer.split("<speech>", 1)
                            is_in_speech = True
                            # Move the trailing content into the synthesis buffer
                            speech_buffer += parts[1]
                            speech_parser_buffer = "" # Clear parser buffer
                    else:
                        # We ARE in a speech block. Look for the end tag.
                        if "</speech>" in speech_parser_buffer:
                            parts = speech_parser_buffer.split("</speech>", 1)
                            # Add text leading up to the end tag
                            speech_buffer += parts[0]
                            is_in_speech = False
                            speech_parser_buffer = "" # Stop speech synthesis for this turn
                        else:
                            # Still in speech. Safely move new content to speech_buffer as soon as it's safe 
                            # (avoiding cutting off part of a potential </speech> tag)
                            if len(speech_parser_buffer) > 10:
                                # Keep the very end in case it's part of a tag
                                to_process = speech_parser_buffer[:-10]
                                speech_buffer += to_process
                                speech_parser_buffer = speech_parser_buffer[-10:]

                    # TTS Buffering & Synthesis (only if we have content in speech_buffer)
                    if len(speech_buffer.split(" ")) >= 2:
                        words = speech_buffer.split(" ")
                        to_send = " ".join(words[:-1]) + " "
                        speech_buffer = words[-1] 
                        
                        req = {
                            "context_id": context_id,
                            "model_id": "sonic-turbo",
                            "transcript": to_send,
                            "voice": {
                                "mode": "id",
                                "id": "5ee9feff-1265-424a-9d7f-8e4d431a12c7"
                            },
                            "output_format": {
                                "container": "raw",
                                "encoding": "pcm_f32le",
                                "sample_rate": 44100
                            },
                            "add_timestamps": True,
                            "continue": True
                        }
                        try:
                            await cartesia_ws.send(json.dumps(req))
                        except Exception as e:
                            print(f"Cartesia send error: {e}")

            timestamps["t_llm_done"] = time.perf_counter()

            # Flush the rest of the buffer and close stream
            if cartesia_ws:
                # If we are STILL in a speech block (didn't see </speech>), flush the remaining parser buffer
                final_text = speech_buffer
                if is_in_speech:
                    final_text += speech_parser_buffer
                
                req = {
                    "context_id": context_id,
                    "model_id": "sonic-turbo",
                    "transcript": final_text,
                    "voice": {
                        "mode": "id",
                        "id": "5ee9feff-1265-424a-9d7f-8e4d431a12c7"
                    },
                    "output_format": {
                        "container": "raw",
                        "encoding": "pcm_f32le",
                        "sample_rate": 44100
                    },
                    "add_timestamps": True,
                    "continue": False
                }
                try:
                    if not cancel_event.is_set():
                        await cartesia_ws.send(json.dumps(req))
                        await asyncio.wait_for(receiver_task, timeout=30.0)
                except Exception as ce:
                    pass
                finally:
                    if watcher_task:
                        watcher_task.cancel()
                    try:
                        await cartesia_ws.close()
                    except Exception:
                        pass

            # Save chat history
            sessions[session_id] += f"User: {user_query}\nAvatar: {full_response}\n"

        except Exception as e:
            await output_queue.put(f"data: {json.dumps({'type': 'error', 'content': str(e)})}\n\n")
        finally:
            # We send the server-measured timestamps in the final done event so the client can use them for the combined report
            server_metrics = {
                "t_first_token": timestamps["t_first_token"] - t0 if timestamps["t_first_token"] else 0,
                "t_llm_done": timestamps["t_llm_done"] - t0 if timestamps["t_llm_done"] else 0
            }
            await output_queue.put(f"data: {json.dumps({'type': 'done', 'server_metrics': server_metrics})}\n\n")
            await output_queue.put(None) 

    # Start orchestrator logic
    orchestrator_task = asyncio.create_task(orchestrate())

    while True:
        msg = await output_queue.get()
        if msg is None:
            break
        yield msg


async def process_audio_track(track, channel):
    """
    Receives audio frames from the WebRTC track, resamples them to 16kHz 16-bit PCM,
    and sends them to Deepgram. Forwards Deepgram responses back through the data channel.
    """
    import av
    import time
    api_key = os.getenv("DEEPGRAM_API_KEY")
    if not api_key:
        print("Missing DEEPGRAM_API_KEY")
        return

    # Deepgram URL for streaming
    DEEPGRAM_URL = 'wss://api.deepgram.com/v1/listen?model=nova-3&encoding=linear16&sample_rate=16000&channels=1&smart_format=true&interim_results=true&endpointing=500'
    
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
                        if channel and channel.readyState == "open":
                            channel.send(result)
                except Exception as e:
                    print(f"Deepgram WebRTC Receiver Error: {e}")

            receiver_task = asyncio.create_task(dg_receiver())

            try:
                while True:
                    frame = await track.recv()
                    # Resample to 16k mono
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
    pcs.add(pc)

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
            # We wait a tiny bit to ensure data_channel is ready if it was created by client
            async def start_processing():
                await asyncio.sleep(1) # Simple buffer for channel setup
                await process_audio_track(track, data_channel)
            
            asyncio.create_task(start_processing())

    @pc.on("iceconnectionstatechange")
    async def on_iceconnectionstatechange():
        if pc.iceConnectionState == "failed" or pc.iceConnectionState == "closed":
            await pc.close()
            pcs.discard(pc)

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
    
    # Initialize history if not exists
    if session_id not in sessions:
        sessions[session_id] = ""
        
    chat_history = sessions[session_id]
    
    try:
        # Step 1: Routing
        route = adaptive_router(chat_history=chat_history, latest_user_query=user_query)
        
        if route == "CHAT":
            response = generate_chat_response(user_query=user_query, chat_history=chat_history)
            thoughts = "No thoughts needed for casual chat."
        else: # RAG
            new_prompt = rewrite_query(chat_history=chat_history, latest_user_query=user_query)
            # Try/Except around Retriever
            try:
                retrieved = get_closest_matches(user_query=new_prompt, k=3)
            except Exception as re:
                print(f"Retriever Error: {re}")
                retrieved = []
            
            # Generator
            response, thoughts = generate_rag_response_v4(user_query=new_prompt, retrieved_documents=retrieved, chat_history=chat_history)
            
        sessions[session_id] += f"User: {user_query}\nAvatar: {response}\n"
        
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
    session_id = req.session_id
    sessions[session_id] = ""
    return {"status": "cleared"}
