import os
from dotenv import load_dotenv
import chromadb
from groq import Groq, AsyncGroq
from sentence_transformers import SentenceTransformer

# Load environment variables from the .env file
load_dotenv()

# Force absolute pathing to avoid relative path confusion
BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DB_PATH = os.path.join(BASE_DIR, "avatar_rag_db") # Pointing to the root DB folder

# The Groq model to use for all LLM calls.
GROQ_MODEL = "llama-3.3-70b-versatile"  

CARTESIA_VOICE_ID = os.getenv("CARTESIA_VOICE_ID", "5ee9feff-1265-424a-9d7f-8e4d431a12c7")
SALES_SCENARIOS_COLLECTION = "collection_sales_scenarios"

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
    """Returns a singleton Groq client."""
    global _LLM_CLIENT
    if _LLM_CLIENT is None:
        apiKey = os.getenv("GROQ_API_KEY")
        if not apiKey:
            raise ValueError("GROQ_API_KEY not found in environment variables")
        _LLM_CLIENT = Groq(api_key=apiKey)
        print("GROQ LLM CLIENT Loaded Successfully")
    return _LLM_CLIENT

_ASYNC_LLM_CLIENT = None
def get_async_llm_client():
    """Returns a singleton AsyncGroq client."""
    global _ASYNC_LLM_CLIENT
    if _ASYNC_LLM_CLIENT is None:
        apiKey = os.getenv("GROQ_API_KEY")
        if not apiKey:
            raise ValueError("GROQ_API_KEY not found in environment variables")
        _ASYNC_LLM_CLIENT = AsyncGroq(api_key=apiKey)
    return _ASYNC_LLM_CLIENT

def get_embedding_model():
    global _EMBEDDING_MODEL
    if _EMBEDDING_MODEL is None:
        model_path = os.path.join(BASE_DIR, "models", "finetuned-minilm-sales-tutor")
        _EMBEDDING_MODEL = SentenceTransformer(model_path)
    return _EMBEDDING_MODEL
