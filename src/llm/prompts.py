from src.config import get_llm_client

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

def adaptive_router(chat_history, latest_user_query):
    """
    Decides whether the query requires retrieving documents from the database (RAG)
    or if it's just casual conversation/small talk (CHAT).
    """
    router_instruction = """
    You are a routing system for an AI Agency digital avatar. 
    Look at the user's latest query. 
    - If the user is asking about services, capabilities, costs, tech, or asking for help building something, output EXACTLY the word: RAG
    - If the user is just saying hello, goodbye, expressing thanks, or making casual small talk, output EXACTLY the word: CHAT
    
    Output nothing else. Only RAG or CHAT.
    """
    
    llm_client = get_llm_client()
    response = llm_client.models.generate_content(
        model="gemini-3.1-flash-lite-preview", # Extremely fast and cheap
        contents=f"{router_instruction}\n\nQuery: {latest_user_query}",
        config={'temperature': 0.0} 
    )
    
    route = response.text.strip().upper()
    return route if route in ["RAG", "CHAT"] else "RAG" # Default to RAG if it glitches


def generate_chat_response(user_query, chat_history):
    system_instruction = """
    You are the voice of a digital avatar representing an expert AI integration agency.
    The user is making casual conversation (e.g., greetings, thanks, farewells).
    Respond warmly, professionally, and very concisely.
    """
    
    user_prompt = f"<chat_history>{chat_history}</chat_history>\n\n<question>{user_query}</question>"
    
    llm_client = get_llm_client()
    response = llm_client.models.generate_content(
        model='gemini-3.1-flash-lite-preview',
        contents=system_instruction + "\n\n" + user_prompt,
        config={'temperature': 0.5, 'max_output_tokens': 100} # Higher temp for natural chat
    )
    
    return response.text.strip()

def generate_rag_response_v4(user_query, retrieved_documents, chat_history=""):
    # 1. Format the context
    context_str = "\n\n".join([
        f"[Doc {i+1}]:\nDocument: {doc['document']}\nIntegration Level: {doc['integration_level']}\nDomain: {doc['domain']}\nSuggested Tone/Response: {doc['avatar_response']}" 
        for i, doc in enumerate(retrieved_documents)
    ])
    
    # 2. Build the engineered prompt
    system_instruction = """
    You are the voice of a digital avatar representing an expert AI integration agency. 
    Your job is to assess client requests and respond naturally in conversation.
    
    You will be provided with 'Suggested Tone/Response' and 'Integration Level'. Use these to guide the VIBE and direction of your answer, but DO NOT just copy-paste them repeatedly.
    Vary your phrasing naturally like a real human having a continuous conversation.
    
    The <context> block contains all the relevant documents your agency possesses regarding the <question>.
    Keep your response professional, warm, and suitable for text-to-speech audio generation.
    
    CRITICAL RULES:
    1. You must ONLY supply facts derived from the <context> given. If there is no info, say: "Sorry, I do not have enough information to provide an adequate answer."
    2. Read the <chat_history>. Do NOT repeat greetings or exact phrases you have already said recently. Make your response flow logically from the previous turn.
    3. Always cite your sources safely by saying things like "As mentioned in our capabilities..." rather than reading raw bracket citations out loud.
    
    FORMATTING:
    First write your logic inside <thought> tags. Then, write the final spoken response inside <speech> tags.
    
    <example>
    <thought>
    The user is asking about automating email sorting. Document 1 talks about categorizing customer support emails based on keywords. Integration level is low, domain is retail. The suggested avatar response is "A simple scripting solution can be developed." I will synthesize this into a warm, confident response.
    </thought>
    <speech>
    Yes, we can absolutely help with your emails! A simple scripting solution can be developed to automatically categorize your incoming support emails based on keywords like 'refund' or 'shipping'. Because this is a low-level integration, we can set this up for you very quickly.
    </speech>
    </example>
    """
    
    user_prompt = f"""
    <chat_history>
    {chat_history}
    </chat_history>
    
    <context>
    {context_str}
    </context>
    
    <question>
    {user_query}
    </question>
    """
    
    llm_client = get_llm_client()
    
    response = llm_client.models.generate_content(
        model='gemini-3.1-flash-lite-preview',
        contents=system_instruction + "\n\n" + user_prompt,
        config={
            'temperature': 0.3,            # Raised slightly so the LLM can vary its phrasing!
            'top_p': 0.85,                 
            'top_k': 40,                   
            'max_output_tokens': 800,      
            'stop_sequences': ["User:", "Client:"] 
        }
    )
    
    raw_text = response.text
    
    import re
    speech_match = re.search(r"<speech>(.*?)</speech>", raw_text, re.DOTALL | re.IGNORECASE)
    thought_match = re.search(r"<thought>(.*?)</thought>", raw_text, re.DOTALL | re.IGNORECASE)
    
    if speech_match:
        final_spoken_answer = speech_match.group(1).strip()
        final_spoken_answer = raw_text
    if thought_match:
        thought = thought_match.group(1).strip()
    else:
        thought = 'Invalid thoughts'
        
    return final_spoken_answer, thought

def generate_chat_response_stream(user_query, chat_history):
    system_instruction = """
    You are the voice of a digital avatar representing an expert AI integration agency.
    The user is making casual conversation (e.g., greetings, thanks, farewells).
    Respond warmly, professionally, and very concisely.
    """
    user_prompt = f"<chat_history>{chat_history}</chat_history>\n\n<question>{user_query}</question>"
    llm_client = get_llm_client()
    response_stream = llm_client.models.generate_content_stream(
        model='gemini-3.1-flash-lite-preview',
        contents=system_instruction + "\n\n" + user_prompt,
        config={'temperature': 0.5, 'max_output_tokens': 100}
    )
    for chunk in response_stream:
        if chunk.text:
            yield chunk.text

def generate_rag_response_v4_stream(user_query, retrieved_documents, chat_history=""):
    context_str = "\n\n".join([
        f"[Doc {i+1}]:\nDocument: {doc['document']}\nIntegration Level: {doc['integration_level']}\nDomain: {doc['domain']}\nSuggested Tone/Response: {doc['avatar_response']}" 
        for i, doc in enumerate(retrieved_documents)
    ])
    
    system_instruction = """
    You are the voice of a digital avatar representing an expert AI integration agency. 
    Your job is to assess client requests and respond naturally in conversation.
    
    You will be provided with 'Suggested Tone/Response' and 'Integration Level'. Use these to guide the VIBE and direction of your answer, but DO NOT just copy-paste them repeatedly.
    Vary your phrasing naturally like a real human having a continuous conversation.
    
    The <context> block contains all the relevant documents your agency possesses regarding the <question>.
    Keep your response professional, warm, and suitable for text-to-speech audio generation.
    
    CRITICAL RULES:
    1. You must ONLY supply facts derived from the <context> given. If there is no info, say: "Sorry, I do not have enough information to provide an adequate answer."
    2. Read the <chat_history>. Do NOT repeat greetings or exact phrases you have already said recently. Make your response flow logically from the previous turn.
    3. Always cite your sources safely by saying things like "As mentioned in our capabilities..." rather than reading raw bracket citations out loud.
    
    FORMATTING:
    First write your logic inside <thought> tags. Then, write the final spoken response inside <speech> tags.
    
    <example>
    <thought>
    The user is asking about automating email sorting. Document 1 talks about categorizing customer support emails based on keywords. Integration level is low, domain is retail. The suggested avatar response is "A simple scripting solution can be developed." I will synthesize this into a warm, confident response.
    </thought>
    <speech>
    Yes, we can absolutely help with your emails! A simple scripting solution can be developed to automatically categorize your incoming support emails based on keywords like 'refund' or 'shipping'. Because this is a low-level integration, we can set this up for you very quickly.
    </speech>
    </example>
    """
    
    user_prompt = f"""
    <chat_history>
    {chat_history}
    </chat_history>
    
    <context>
    {context_str}
    </context>
    
    <question>
    {user_query}
    </question>
    """
    llm_client = get_llm_client()
    response_stream = llm_client.models.generate_content_stream(
        model='gemini-3.1-flash-lite-preview',
        contents=system_instruction + "\n\n" + user_prompt,
        config={
            'temperature': 0.3,
            'top_p': 0.85,                 
            'top_k': 40,                   
            'max_output_tokens': 800,      
            'stop_sequences': ["User:", "Client:"] 
        }
    )
    for chunk in response_stream:
        if chunk.text:
            yield chunk.text

def rewrite_query(chat_history, latest_user_query):
    # should be super fast to save latency, so no complex prompting
    rewrite_instruction = """
    You are a query rewriter. Look at the chat history and the latest user query.
    If the user's query contains pronouns (it, that, they, etc.) or relies or previous context, rewrite it into a single standalone sentence.
    If the query is already standalone, just output the exact same query.
    DO NOT answer the question. ONLY output the rewritten query.
    """

    prompt = f"""
    Chat History:
    {chat_history}

    Latest Query: {latest_user_query}

    Rewritten Query:
    """

    llm_client = get_llm_client()
    response = llm_client.models.generate_content(
        model="gemini-3.1-flash-lite-preview", 
        contents=rewrite_instruction + '\n' + prompt,
        config={'temperature': 0.0} # 0 temperature for robotic precision
    )

    return response.text.strip()