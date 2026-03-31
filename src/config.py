import os
from dotenv import load_dotenv
import chromadb
from google import genai

# Load environment variables from the .env file
load_dotenv()

# We no longer fall back to the raw key in code. If it's missing, it will raise an error properly.
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY")
if not GEMINI_API_KEY:
    raise ValueError("GEMINI_API_KEY is not set in the environment or .env file.")

DB_PATH = "./avatar_rag_db"

def get_db_client():
    """Returns a PersistentClient for ChromaDB."""
    return chromadb.PersistentClient(path=DB_PATH)

def get_llm_client():
    """Returns the GenAI client."""
    return genai.Client(api_key=GEMINI_API_KEY)
