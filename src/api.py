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
    if session_id not in sessions:
        sessions[session_id] = ""
    chat_history = sessions[session_id]
    
    try:
        route = adaptive_router(chat_history=chat_history, latest_user_query=user_query)
        yield f"data: {json.dumps({'type': 'route', 'route': route})}\n\n"
        
        full_response = ""
        
        if route == "CHAT":
            for chunk in generate_chat_response_stream(user_query=user_query, chat_history=chat_history):
                full_response += chunk
                yield f"data: {json.dumps({'type': 'chunk', 'content': chunk})}\n\n"
        else: # RAG
            try:
                retrieved = get_closest_matches(user_query=user_query, k=5)
            except Exception as re:
                print(f"Retriever Error: {re}")
                retrieved = []
            
            for chunk in generate_rag_response_v4_stream(user_query=user_query, retrieved_documents=retrieved, chat_history=chat_history):
                full_response += chunk
                yield f"data: {json.dumps({'type': 'chunk', 'content': chunk})}\n\n"
                
        import re
        speech_match = re.search(r"<speech>(.*?)</speech>", full_response, re.DOTALL | re.IGNORECASE)
        final_answer = speech_match.group(1).strip() if speech_match else full_response
        sessions[session_id] += f"User: {user_query}\nAvatar: {final_answer}\n"
        
        cartesia_api_key = os.getenv("CARTESIA_API_KEY")
        print(f"DEBUG: Trying Cartesia. Found API Key: {bool(cartesia_api_key)}, Text Length: {len(final_answer)}")
        
        if cartesia_api_key and final_answer:
            try:
                import requests
                url = "https://api.cartesia.ai/tts/sse"
                headers = {
                    "X-API-Key": cartesia_api_key,
                    "Cartesia-Version": "2024-06-10",
                    "Content-Type": "application/json"
                }
                data = {
                    "model_id": "sonic-english",
                    "transcript": final_answer,
                    "voice": {
                        "mode": "id",
                        "id": "9626c31c-bec5-4cca-baa8-f8ba9e84c8bc"
                    },
                    "output_format": {
                        "container": "raw",
                        "encoding": "pcm_f32le",
                        "sample_rate": 44100
                    }
                }
                with requests.post(url, headers=headers, json=data, stream=True) as response:
                    print(f"DEBUG: Cartesia SSE API Response Status: {response.status_code}")
                    if response.status_code == 200:
                        for line in response.iter_lines():
                            if line:
                                decoded = line.decode('utf-8')
                                if decoded.startswith("data: "):
                                    payload_str = decoded[6:].strip()
                                    if payload_str == "[DONE]" or not payload_str:
                                        continue
                                    try:
                                        payload = json.loads(payload_str)
                                        if "data" in payload:
                                            yield f"data: {json.dumps({'type': 'audio_chunk', 'content': payload['data']})}\n\n"
                                    except Exception as je:
                                        pass
                    else:
                        print(f"Cartesia TTS Error: {response.text}")
            except Exception as ttse:
                print(f"TTS Exception Error: {ttse}")
        
        yield f"data: {json.dumps({'type': 'done'})}\n\n"
        
    except Exception as e:
        yield f"data: {json.dumps({'type': 'error', 'content': str(e)})}\n\n"

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
