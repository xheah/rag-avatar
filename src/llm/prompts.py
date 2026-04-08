from src.config import get_llm_client, get_async_llm_client, OLLAMA_MODEL, OLLAMA_THINK_KWARGS

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
    system_instruction = """
    You are a routing system for an AI Sales Tutor digital avatar. 
    Look at the user's latest query. 
    - If the user is answering a sales scenario or trying to start the quiz, output EXACTLY the word: RAG
    - If the user is just saying hello, goodbye, expressing thanks, or making casual small talk not related to the quiz, output EXACTLY the word: CHAT
    
    Output nothing else. Only RAG or CHAT.
    """
    
    llm_client = get_llm_client()
    response = llm_client.chat(
        model=OLLAMA_MODEL,
        messages=[
            {"role": "system", "content": system_instruction},
            {"role": "user", "content": f"Chat history:\n{chat_history}\n\nLatest query: {latest_user_query}"}
        ],
        options={"temperature": 0.0},
        **OLLAMA_THINK_KWARGS
    )
    
    route = response.message.content.strip().upper()
    return route if route in ["RAG", "CHAT"] else "RAG" # Default to RAG if it glitches


def generate_chat_response(user_query, chat_history):
    system_instruction = """
    You are the voice of a digital avatar representing an expert Senior Sales Director acting as a Tutor.
    The user is making casual conversation (e.g., greetings, thanks, farewells).
    Respond warmly, professionally, and tell them to say 'Start Quiz' whenever they are ready.
    """
    
    llm_client = get_llm_client()
    response = llm_client.chat(
        model=OLLAMA_MODEL,
        messages=[
            {"role": "system", "content": system_instruction},
            {"role": "user", "content": f"<chat_history>{chat_history}</chat_history>\n\n<question>{user_query}</question>"}
        ],
        options={"temperature": 0.5, "num_predict": 100},
        **OLLAMA_THINK_KWARGS
    )
    
    return response.message.content.strip()

def generate_rag_response_v4(user_query, retrieved_documents, chat_history=""):
    # 1. Format the context
    context_str = "\n\n".join([
        f"[Sales Scenario {i+1}]:\n{doc['document']}" 
        for i, doc in enumerate(retrieved_documents)
    ])
    
    # 2. Build the engineered prompt
    system_instruction = """
    You are the voice of a digital avatar representing an expert Senior Sales Director acting as a Tutor.
    Your job is to run a simulation with the user (a Sales Representative under your mentorship).
    
    You have two modes:
    1. POSING A SCENARIO: If the conversation just started, or you just finished grading an answer, you must pick one of the Scenarios from the <context> block and pose ONLY the 'Question' part to the user. Do NOT reveal the rubric yet.
    2. GRADING AN ANSWER: If the user is responding to a scenario you previously asked, read their response, evaluate it against the strict 'Rubric/Key Points' for that specific scenario in the <context>.
    
    GRADING RULES:
    - Provide a score (e.g. "Score: 70%").
    - Give constructive, encouraging feedback highlighting exactly what they missed from the rubric.
    - IMMEDIATELY after giving feedback, automatically ask them a NEW scenario from the <context> to continue the quiz.
    
    CRITICAL RULES:
    1. Read the <chat_history> to know which scenario they are answering so you use the correct Rubric.
    2. Keep your response conversational and suitable for text-to-speech audio.
    
    FORMATTING:
    First write your logic inside <thought> tags. Then, write the final spoken response inside <speech> tags.
    
    <example>
    <thought>
    The user answered and fulfilled 2 out of 3 of the rubrics. I will give them a score of 70% and ask them the next question.
    </thought>
    <speech>
    Score: 70%. You did a good job of identifying the key points, but you missed the part about pinpointing the specific features that solve the prospect's unique pain point. Next question: Your product is too expensive, similar solutions cost half as much.
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
    
    <student_input>
    {user_query}
    </student_input>
    """
    
    llm_client = get_llm_client()
    
    response = llm_client.chat(
        model=OLLAMA_MODEL,
        messages=[
            {"role": "system", "content": system_instruction},
            {"role": "user", "content": user_prompt}
        ],
        options={
            "temperature": 0.3,
            "top_p": 0.85,
            "top_k": 40,
            "num_predict": 800,
            "stop": ["User:", "Client:"]
        },
        **OLLAMA_THINK_KWARGS
    )
    
    raw_text = response.message.content
    
    import re
    speech_match = re.search(r"<speech>(.*?)</speech>", raw_text, re.DOTALL | re.IGNORECASE)
    thought_match = re.search(r"<thought>(.*?)</thought>", raw_text, re.DOTALL | re.IGNORECASE)
    
    final_spoken_answer = speech_match.group(1).strip() if speech_match else raw_text
    thought = thought_match.group(1).strip() if thought_match else "Invalid thoughts"
        
    return final_spoken_answer, thought

async def generate_chat_response_stream(user_query, chat_history):
    system_instruction = """
    You are the voice of a digital avatar representing an expert Senior Sales Director acting as a Tutor.
    The user is making casual conversation (e.g., greetings, thanks, farewells).
    Respond warmly, professionally, and tell them to say 'Start Quiz' whenever they are ready.
    """
    llm_client = get_async_llm_client()
    stream = await llm_client.chat(
        model=OLLAMA_MODEL,
        messages=[
            {"role": "system", "content": system_instruction},
            {"role": "user", "content": f"<chat_history>{chat_history}</chat_history>\n\n<question>{user_query}</question>"}
        ],
        options={"temperature": 0.5, "num_predict": 100},
        stream=True,
        **OLLAMA_THINK_KWARGS
    )
    async for chunk in stream:
        token = chunk.message.content
        if token:
            yield token

async def generate_rag_response_v4_stream(user_query, retrieved_documents, chat_history=""):
    context_str = "\n\n".join([
        f"[Sales Scenario {i+1}]:\n{doc['document']}" 
        for i, doc in enumerate(retrieved_documents)
    ])
    
    system_instruction = """
    You are the voice of a digital avatar representing an expert Senior Sales Director acting as a Tutor.
    Your job is to run a simulation with the user (a Sales Representative under your mentorship).
    
    You have two modes:
    1. POSING A SCENARIO: If the conversation just started, or you just finished grading an answer, you must pick one of the Scenarios from the <context> block and pose ONLY the 'Question' part to the user. Do NOT reveal the rubric yet.
    2. GRADING AN ANSWER: If the user is responding to a scenario you previously asked, read their response, evaluate it against the strict 'Rubric/Key Points' for that specific scenario in the <context>.
    
    GRADING RULES:
    - Provide a score (e.g. "Score: 70%").
    - Give constructive, encouraging feedback highlighting exactly what they missed from the rubric.
    - IMMEDIATELY after giving feedback, automatically ask them a NEW scenario from the <context> to continue the quiz.
    
    CRITICAL RULES:
    1. Read the <chat_history> to know which scenario they are answering so you use the correct Rubric.
    2. Keep your response conversational and suitable for text-to-speech audio.
    
    FORMATTING:
    First write your logic inside <thought> tags. Then, write the final spoken response inside <speech> tags.
    
    <example>
    <thought>
    The user answered and fulfilled 2 out of 3 of the rubrics. I will give them a score of 70% and ask them the next question.
    </thought>
    <speech>
    Score: 70%. You did a good job of identifying the key points, but you missed the part about pinpointing the specific features that solve the prospect's unique pain point. Next question: Your product is too expensive, similar solutions cost half as much.
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
    
    <student_input>
    {user_query}
    </student_input>
    """
    llm_client = get_async_llm_client()
    stream = await llm_client.chat(
        model=OLLAMA_MODEL,
        messages=[
            {"role": "system", "content": system_instruction},
            {"role": "user", "content": user_prompt}
        ],
        options={
            "temperature": 0.3,
            "top_p": 0.85,
            "top_k": 40,
            "num_predict": 800,
            "stop": ["User:", "Client:"]
        },
        stream=True,
        **OLLAMA_THINK_KWARGS
    )
    async for chunk in stream:
        token = chunk.message.content
        if token:
            yield token

def rewrite_query(chat_history, latest_user_query):
    # should be super fast to save latency, so no complex prompting
    system_instruction = """
    You are a query rewriter. Look at the chat history and the latest user query.
    If the user's query contains pronouns (it, that, they, etc.) or relies on previous context, rewrite it into a single standalone sentence.
    If the query is already standalone, just output the exact same query.
    DO NOT answer the question. ONLY output the rewritten query.
    """

    user_prompt = f"""
    Chat History:
    {chat_history}

    Latest Query: {latest_user_query}

    Rewritten Query:
    """

    llm_client = get_llm_client()
    response = llm_client.chat(
        model=OLLAMA_MODEL,
        messages=[
            {"role": "system", "content": system_instruction},
            {"role": "user", "content": user_prompt}
        ],
        options={"temperature": 0.0},
        **OLLAMA_THINK_KWARGS
    )

    return response.message.content.strip()