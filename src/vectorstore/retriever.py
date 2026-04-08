from src.config import get_db_client, get_embedding_model

def get_closest_match(user_query: str):
    """Old implementation. Use get_closest_matches instead."""
    pass

def get_closest_matches(user_query: str, k=5):
    """Queries the fine-tuned ChromaDB collection for the k most relevant documents."""
    
    # 1. Get embedding model and embed query
    model = get_embedding_model()
    embeddings = model.encode(user_query, normalize_embeddings=True).tolist()
    
    # 2. Get DB Client and collection
    db_client = get_db_client()
    collection = db_client.get_or_create_collection(name="collection_sales_scenarios")
    
    # 3. Query
    result = collection.query(query_embeddings=[embeddings], n_results=k)
    
    if not result["ids"] or len(result["ids"][0]) == 0:
        return []

    # ChromaDB returns lists of lists for multiple queries. 
    # Since we are sending 1 query at a time, we index at [0]
    ids = result["ids"][0]
    documents = result["documents"][0]
    metadatas = result["metadatas"][0]
    
    # 4. Zip them together to assemble the list of dictionaries
    formatted_results = []
    for i in range(len(ids)):
        formatted_results.append({
            "id": ids[i],
            "document": documents[i],
            "type": metadatas[i].get("type", "Unknown")
        })
        
    return formatted_results