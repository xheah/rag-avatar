from src.config import get_db_client

def get_closest_match(user_query: str):
    """Queries the ChromaDB collection for the most relevant document."""
    # Connect to your existing ChromaDB
    db_client = get_db_client()
    collection = db_client.get_collection(name="client_requests")
    
    # --- RETRIEVAL ---
    results = collection.query(
        query_texts=[user_query],
        n_results=1 # Pull the single best match
    )
    
    # Extract
    retrieved_doc = results['documents'][0][0]
    retrieved_meta = results['metadatas'][0][0]
    
    return retrieved_doc, retrieved_meta
