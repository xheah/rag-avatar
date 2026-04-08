import os
from dotenv import load_dotenv
import chromadb
from google import genai
from sentence_transformers import SentenceTransformer

# Load environment variables from the .env file
load_dotenv()

GEMINI_API_KEY = os.getenv("GEMINI_API_KEY")
if not GEMINI_API_KEY:
    raise ValueError("GEMINI_API_KEY is not set in the environment or .env file.")

# Force absolute pathing to avoid relative path confusion
BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DB_PATH = os.path.join(BASE_DIR, "avatar_rag_db") # Pointing to the root DB folder

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
    global _LLM_CLIENT
    if _LLM_CLIENT is None:
        _LLM_CLIENT = genai.Client(api_key=GEMINI_API_KEY)
    return _LLM_CLIENT

def get_embedding_model():
    global _EMBEDDING_MODEL
    if _EMBEDDING_MODEL is None:
        model_path = os.path.join(BASE_DIR, "models", "finetuned-minilm-sales-tutor")
        _EMBEDDING_MODEL = SentenceTransformer(model_path)
    return _EMBEDDING_MODEL
