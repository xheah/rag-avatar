import sys
import os

# Ensure that 'src' is importable if run directly from within src directory
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from src.config import get_llm_client, get_embedding_model
from src.vectorstore.retriever import get_closest_match, get_closest_matches
from src.vectorstore.database_creation import initialize_database
from src.llm.prompts import (
    SYSTEM_PROMPT, generate_augmented_prompt, adaptive_router, 
    generate_chat_response, generate_rag_response_v4, rewrite_query
)

def main():
    print("==================================================")
    print("RAG Avatar Backend CLI Initialized")
    print("Verifying database and model structures...")
    initialize_database()
    print("Warming up embedding model (this may take a second)...")
    get_embedding_model() # Trigger the lazy load here before the chat loop starts!
    print("==================================================\n")

    chat_history = ""
    # The Interactive Chat Loop
    while True:
        user_query = input("\nClient Request: ")
        
        if user_query.lower() in ['exit', 'quit']:
            print("Shutting down backend...")
            break
            
        if not user_query.strip():
            continue

        # -- Adaptive Retrieval/Routing --
        route = adaptive_router(chat_history=chat_history, latest_user_query=user_query)
        print(f"System routed to [{route}]")

        if route == "CHAT":
            response = generate_chat_response(user_query=user_query, chat_history=chat_history)
            print(f"\nAvatar: {response}")
        else: # RAG
            # -- INPUT ENHANCEMENT --
            new_prompt = rewrite_query(chat_history=chat_history, latest_user_query=user_query)
            
            # -- RETRIEVAL --
            print("Searching database for similar context...")
            try:
                retrieved = get_closest_matches(user_query=new_prompt, k=3)
            except Exception as e:
                print(f"Error Retrieving from Vector DB: {e}")
                continue
            
            # -- GENERATION --
            try:
                response, thoughts = generate_rag_response_v4(user_query=new_prompt, retrieved_documents=retrieved, chat_history=chat_history)
                print(f"\nThinking: {thoughts}")
                print(f"Avatar: {response}")
            except Exception as e:
                print(f"\nError connecting to LLM: {e}")
                continue

        # -- UPDATE RECORD OF CONVERSATION --
        chat_history += f"User: {user_query}\nAvatar: {response}\n"

if __name__ == "__main__":
    main()
