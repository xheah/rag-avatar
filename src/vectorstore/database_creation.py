import sys
import os
import json

# Ensure that 'src' is importable if run directly
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from src.config import get_db_client, get_embedding_model

def initialize_database():
    """Checks if the active vector database is populated. If not, it populates it."""
    client = get_db_client()
    collection = client.get_or_create_collection(name="collection_sales_scenarios")

    # Check if the database has items in it
    if collection.count() > 0:
        print(f"Database 'collection_sales_scenarios' already populated with {collection.count()} item(s).")
        return

    print("Database is empty! Reading json source and generating embeddings... This may take a minute.")

    # Get data
    base_dir = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    data_path = os.path.join(base_dir, "data", "sales_scenarios.json")
    
    with open(data_path, "r") as f:
        data = json.load(f)

    # Extract lists for ChromaDB ingestion
    documents = [item["document"] for item in data]
    metadatas = [item["metadata"] for item in data]
    ids = [item["id"] for item in data]

    # Initialize the model and generate embeddings
    model = get_embedding_model()
    embeddings = model.encode(documents, normalize_embeddings=True).tolist()

    # Inject all items into the blank DB
    collection.upsert(
        documents=documents,
        metadatas=metadatas,
        ids=ids,
        embeddings=embeddings
    )

    print(f"Successfully generated embeddings and injected {len(documents)} requests into the root vector database.")

if __name__ == "__main__":
    initialize_database()