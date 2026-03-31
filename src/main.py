import sys
import os

# Ensure that 'src' is importable if run directly from within src directory
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from src.config import get_llm_client
from src.vectorstore.retriever import get_closest_match
from src.llm.prompts import SYSTEM_PROMPT, generate_augmented_prompt

def main():
    llm_client = get_llm_client()

    print("==================================================")
    print("RAG Avatar Backend CLI Initialized")
    print("Type 'exit' or 'quit' to stop.")
    print("==================================================\n")

    # The Interactive Chat Loop
    while True:
        user_query = input("\nClient Request: ")
        
        if user_query.lower() in ['exit', 'quit']:
            print("Shutting down backend...")
            break
            
        if not user_query.strip():
            continue

        print("Searching database for similar context...")
        
        # 1. Retrieval
        try:
            retrieved_doc, retrieved_meta = get_closest_match(user_query)
        except Exception as e:
            print(f"Error Retrieving from Vector DB: {e}")
            continue
            
        # 2. Augmentation
        augmented_prompt = generate_augmented_prompt(user_query, retrieved_doc, retrieved_meta)
        
        # 3. Generation
        try:
            response = llm_client.models.generate_content(
                model='gemini-2.5-flash',
                contents=SYSTEM_PROMPT + augmented_prompt,
            )
            print(f"\nAvatar: {response.text}")
            
            # Debug info
            print(f"   [Backend Debug: Grounded on {retrieved_meta['integration_level'].upper()} level data from the {retrieved_meta['domain']} sector]")
            
        except Exception as e:
            print(f"\nError connecting to LLM: {e}")

if __name__ == "__main__":
    main()
