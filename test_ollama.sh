#!/bin/bash
cd /c/Users/adenc/OneDrive/DSAC/rag-avatar/rag-avatar
source .venv/Scripts/activate

python - << 'EOF'
import sys
sys.path.insert(0, '.')

from src.llm.prompts import adaptive_router, generate_chat_response_stream, generate_rag_response_v4_stream

print("[1] Router test...")
route = adaptive_router(chat_history="", latest_user_query="Start quiz")
print(f"    Route: '{route}'")

print("\n[2] Chat stream test...")
chunks = list(generate_chat_response_stream(user_query="Hello!", chat_history=""))
full = "".join(chunks)
print(f"    Chunks: {len(chunks)}, Output: {full[:120]}")

print("\n[3] RAG stream test...")
docs = [{"document": "Scenario: Customer says price is too high.\nQuestion: How do you respond?\nRubric: Acknowledge, justify value, offer alternative."}]
chunks = list(generate_rag_response_v4_stream(user_query="Start quiz", retrieved_documents=docs, chat_history=""))
full = "".join(chunks)
print(f"    Chunks: {len(chunks)}, Output: {full[:200]}")

print("\n=== ALL TESTS PASSED ===" if all([route in ["RAG","CHAT"], len(list(generate_chat_response_stream("hi","")))] ) else "\n=== SOME TESTS FAILED ===")
EOF
