import sys
import os
import json
import asyncio
import websockets
from fastapi import FastAPI, Request, WebSocket, WebSocketDisconnect
from fastapi.staticfiles import StaticFiles
from fastapi.responses import HTMLResponse, StreamingResponse
from pydantic import BaseModel
from typing import Dict

# Ensure src is importable
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

@app.get("/", response_class=HTMLResponse)
async def get_index():
    with open(os.path.join(BASE_DIR, "static", "index.html"), "r") as f:
        return f.read()

async def chat_stream_generator(user_query: str, session_id: str):
    import time
    import uuid
    import asyncio
    t0 = time.perf_counter()

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
                try:
                    async for msg in cartesia_ws:
                        if type(msg) == str:
                            data = json.loads(msg)
                            if data.get("type") == "done":
                                break
                            elif data.get("type") == "chunk" and "data" in data:
                                if timestamps["t_first_audio"] is None:
                                    timestamps["t_first_audio"] = time.perf_counter()
                                await output_queue.put(f"data: {json.dumps({'type': 'audio_chunk', 'content': data['data']})}\n\n")
                            elif data.get("type") == "error":
                                print(f"Cartesia Error: {data.get('error')}")
                except Exception as e:
                    print(f"Cartesia receiver error: {e}")

            # Start Cartesia receiver
            receiver_task = asyncio.create_task(cartesia_receiver()) if cartesia_ws else None

            # Stream text from LLM
            speech_buffer = ""
            
            # We pick the generator

            try:
                retrieved = get_closest_matches(user_query=user_query, k=5)
            except Exception as re:
                print(f"Retriever Error: {re}")
                retrieved = []
            llm_stream = generate_rag_response_v4_stream(user_query=user_query, retrieved_documents=retrieved, chat_history=chat_history)
            print(llm_stream)
            async for chunk in llm_stream:
                if timestamps["t_first_token"] is None:
                    timestamps["t_first_token"] = time.perf_counter()
                
                full_response += chunk
                await output_queue.put(f"data: {json.dumps({'type': 'chunk', 'content': chunk})}\n\n")

                if cartesia_ws:
                    speech_buffer += chunk

                    # If we have gathered enough words, flush to Cartesia
                    if len(speech_buffer.split(" ")) >= 1:
                        words = speech_buffer.split(" ")
                        to_send = " ".join(words[:-1]) + " "
                        speech_buffer = words[-1] # Carry over the latest word
                        
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
                            "continue": True
                        }
                        try:
                            await cartesia_ws.send(json.dumps(req))
                        except Exception as ce:
                            print(f"Cartesia send error: {ce}")

            timestamps["t_llm_done"] = time.perf_counter()

            # Flush the rest of the buffer and close stream
            if cartesia_ws:
                req = {
                    "context_id": context_id,
                    "model_id": "sonic-english",
                    "transcript": speech_buffer,
                    "voice": {
                        "mode": "id",
                        "id": "9626c31c-bec5-4cca-baa8-f8ba9e84c8bc"
                    },
                    "output_format": {
                        "container": "raw",
                        "encoding": "pcm_f32le",
                        "sample_rate": 44100
                    },
                    "continue": False
                }
                try:
                    await cartesia_ws.send(json.dumps(req))
                    await asyncio.wait_for(receiver_task, timeout=30.0)
                except Exception as ce:
                     pass
                finally:
                    await cartesia_ws.close()

            # Save chat history
            import re
            final_answer = full_response
            sessions[session_id] += f"User: {user_query}\nAvatar: {final_answer}\n"

        except Exception as e:
            await output_queue.put(f"data: {json.dumps({'type': 'error', 'content': str(e)})}\n\n")
        finally:
            await output_queue.put(None) # Sentinel to end generation

    # Start orchestrator logic concurrently using asyncio queue loop
    orchestrator_task = asyncio.create_task(orchestrate())

    while True:
        msg = await output_queue.get()
        if msg is None:
            break
        yield msg

    yield f"data: {json.dumps({'type': 'done'})}\n\n"

    # Latency report
    def ms(start, end):
        return f"{(end - start) * 1000:.0f}ms" if end is not None else "N/A"

    print("\n" + "─" * 52)
    print(f"  LATENCY REPORT  │  query: \"{user_query[:40]}\"")
    print("─" * 52)
    print(f"  First LLM token │ {ms(t0, timestamps['t_first_token'])}")
    print(f"  Full LLM done   │ {ms(t0, timestamps['t_llm_done'])}")
    print(f"  First audio out │ {ms(t0, timestamps['t_first_audio'])}  ◄ end-to-end")
    print("─" * 52)
    if timestamps['t_first_audio']:
        print(f"  (Cartesia TTS   took {ms(timestamps.get('t_first_token') or 0, timestamps.get('t_first_audio'))})")
    print("─" * 52 + "\n")

@app.websocket("/api/stt")
async def stt_websocket(websocket: WebSocket):
    await websocket.accept()
    # endpointing=500 means if the user pauses for 500ms, Deepgram sends a "speech_final" event!
    # smart_format applies punctuation and capitalization automatically
    DEEPGRAM_URL = 'wss://api.deepgram.com/v1/listen?smart_format=true&interim_results=true&endpointing=500'
    api_key = os.getenv("DEEPGRAM_API_KEY")
    
    if not api_key:
        print("Missing DEEPGRAM_API_KEY")
        await websocket.close(code=1011)
        return

    try:
        async with websockets.connect(
            DEEPGRAM_URL, 
            additional_headers={"Authorization": f"Token {api_key}"}
        ) as dg_socket:
            
            async def receiver():
                """Receives transcripts from Deepgram and forwards to React frontend"""
                try:
                    while True:
                        result = await dg_socket.recv()
                        await websocket.send_text(result)
                except websockets.exceptions.ConnectionClosed:
                    pass
                except Exception as e:
                    print(f"Deepgram STT Receive Error: {e}")

            async def sender():
                """Receives raw WebM audio chunks from React and pipes to Deepgram"""
                try:
                    while True:
                        data = await websocket.receive_bytes()
                        await dg_socket.send(data)
                except WebSocketDisconnect:
                    pass
                except Exception as e:
                    print(f"Deepgram STT Send Error: {e}")

            # Run both concurrently
            done, pending = await asyncio.wait(
                [asyncio.create_task(receiver()), asyncio.create_task(sender())],
                return_when=asyncio.FIRST_COMPLETED
            )
            # Cancel the remaining task when one finishes
            for task in pending:
                task.cancel()
    except Exception as e:
        print(f"Deepgram WebSocket Error: {e}")
    finally:
        try:
            await websocket.close()
        except:
            pass

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
