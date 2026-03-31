import os
import sys
import json
from google import genai
from pydantic import BaseModel, Field

# Ensure that 'src' is importable if run directly
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from src.config import GEMINI_API_KEY

# 1. Initialize the client
client = genai.Client(api_key=GEMINI_API_KEY)

# 2. Define the exact JSON schema using Pydantic
# This forces the LLM to output valid data that matches your database schema perfectly.
class ClientRequest(BaseModel):
    id: str = Field(description="A unique string ID starting with req_")
    document: str = Field(description="The unique, specific client request describing a distinct action and target.")
    integration_level: str = Field(description="Must be exactly 'low', 'mid', or 'high'.")
    avatar_response: str = Field(description="The standard response the avatar should give based on the integration level.")
    domain: str = Field(description="The specific industry domain of the request.")

class RequestDatabase(BaseModel):
    requests: list[ClientRequest]

# 3. Define industries to ensure massive variety
industries = [
    "Healthcare & Medicine", 
    "Logistics & Supply Chain", 
    "Financial Tech & Trading", 
    "Retail & E-commerce", 
    "Manufacturing & Construction"
]

all_synthetic_data = []

print("Generating synthetic data. This will take a moment...")

# 4. Loop through industries to prevent the LLM from repeating itself
for industry in industries:
    print(f"Generating 20 unique requests for {industry}...")
    
    prompt = f"""
    Generate exactly 20 highly unique, distinct client requests for an AI integration agency, specifically for the {industry} sector.
    DO NOT use permutations of the same sentence. Every single request must involve a completely different action, software, or business problem.
    
    Ensure an even mix of 'low', 'mid', and 'high' integration levels:
    - Low: Basic scripts, data entry automation, simple web scraping.
    - Mid: Real-time computer vision, API integrations, RAG pipelines, active databases.
    - High: Artificial General Intelligence, fully autonomous self-improving systems replacing entire human workflows.
    """
    
    # 5. Call the API with Structured Outputs and a high temperature for creativity
    response = client.models.generate_content(
        model='gemini-2.5-flash',
        contents=prompt,
        config={
            'response_mime_type': 'application/json',
            'response_schema': RequestDatabase,
            'temperature': 0.9 
        },
    )
    
    # Extract the parsed Pydantic objects and convert them to a dictionary
    generated_batch = response.parsed.model_dump()["requests"]
    
    # Restructure slightly to match your ChromaDB schema
    for item in generated_batch:
        all_synthetic_data.append({
            "id": item["id"],
            "document": item["document"],
            "metadata": {
                "integration_level": item["integration_level"],
                "avatar_response": item["avatar_response"],
                "domain": item["domain"]
            }
        })

# 6. Save the final dataset to a JSON file
data_path = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))), "data", "true_synthetic_requests.json")
with open(data_path, "w") as f:
    json.dump(all_synthetic_data, f, indent=4)

print("Successfully generated 100 unique synthetic requests!")