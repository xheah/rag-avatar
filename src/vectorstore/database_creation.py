import sys
import os
import json

# Ensure that 'src' is importable if run directly
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from src.config import get_db_client

client = get_db_client()

collection = client.get_or_create_collection(name="client_requests")

data_path = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))), "data", "true_synthetic_requests.json")
with open(data_path, "r") as f:
    data = json.load(f)

# Extract lists for ChromaDB ingestion
documents = [item["document"] for item in data]
metadatas = [item["metadata"] for item in data]
ids = [item["id"] for item in data]

# Inject all 100 items
collection.upsert(
    documents=documents,
    metadatas=metadatas,
    ids=ids
)

print(f"Successfully injected {len(documents)} requests into the vector database.")