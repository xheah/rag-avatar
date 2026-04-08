import os
from dotenv import load_dotenv
import chromadb
import ollama
from sentence_transformers import SentenceTransformer

# Load environment variables from the .env file
load_dotenv()

# Force absolute pathing to avoid relative path confusion
BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DB_PATH = os.path.join(BASE_DIR, "avatar_rag_db") # Pointing to the root DB folder

# The local Ollama model to use for all LLM calls.
OLLAMA_MODEL = "aisingapore/Gemma-SEA-LION-v3-9B-IT:q4_k_m"

# qwen3 outputs tokens to message.thinking (not message.content) when think=True.
# Passing think=False fixes this. Other models don't support the think param at all,
# so we only inject it for qwen3 to avoid crashing.
OLLAMA_THINK_KWARGS: dict = {"think": False} if OLLAMA_MODEL.startswith("qwen3") else {"think": True}


# Create global singletons so they only load ONCE
_DB_CLIENT = None
_LLM_CLIENT = None
_EMBEDDING_MODEL = None

def get_db_client():
    global _DB_CLIENT
    if _DB_CLIENT is None:
        _DB_CLIENT = chromadb.PersistentClient(path=DB_PATH)
    return _DB_CLIENT

def get_llm_client():
    """Returns a singleton Ollama client pointed at the local Ollama server."""
    global _LLM_CLIENT
    if _LLM_CLIENT is None:
        _LLM_CLIENT = ollama.Client(host="http://localhost:11434")
        print("LLM CLIENT Loaded Successfully:", _LLM_CLIENT)
    return _LLM_CLIENT

_ASYNC_LLM_CLIENT = None
def get_async_llm_client():
    global _ASYNC_LLM_CLIENT
    if _ASYNC_LLM_CLIENT is None:
        _ASYNC_LLM_CLIENT = ollama.AsyncClient(host="http://localhost:11434")
    return _ASYNC_LLM_CLIENT

def get_embedding_model():
    global _EMBEDDING_MODEL
    if _EMBEDDING_MODEL is None:
        model_path = os.path.join(BASE_DIR, "models", "finetuned-minilm-sales-tutor")
        _EMBEDDING_MODEL = SentenceTransformer(model_path)
    return _EMBEDDING_MODEL
