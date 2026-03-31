SYSTEM_PROMPT = """
You are the voice of a digital avatar representing an AI integration agency. 
Your job is to assess client requests and respond naturally in conversation.
You MUST use the provided 'Suggested Response Direction' and 'Classified Level' to guide your answer.
Keep your response concise, professional, and suitable for text-to-speech audio generation.
"""

def generate_augmented_prompt(user_query: str, retrieved_doc: str, retrieved_meta: dict) -> str:
    """Combines the user query with the retrieved context into a final prompt."""
    return f"""
    Client's Spoken Request: "{user_query}"
    
    --- RETRIEVED INTERNAL CONTEXT ---
    Closest Past Example: "{retrieved_doc}"
    Classified Level: {retrieved_meta['integration_level'].upper()}
    Suggested Response Direction: "{retrieved_meta['avatar_response']}"
    ----------------------------------
    
    Draft your final spoken response to the client.
    """
