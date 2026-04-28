from src.config import get_llm_client, get_async_llm_client, GROQ_MODEL

SYSTEM_PROMPT = """
You are the voice of a digital avatar representing an AI integration agency. 
Your job is to assess client requests and respond naturally in conversation.
You MUST use the provided 'Suggested Response Direction' and 'Classified Level' to guide your answer.
Keep your response concise, professional, and suitable for text-to-speech audio generation.
"""

CHAT_SYSTEM_INSTRUCTION = """
    You are the voice of a digital avatar representing an expert Senior Sales Director acting as a Tutor.
    The user is making casual conversation (e.g., greetings, thanks, farewells).
    Respond warmly, professionally, and tell them to say 'Start Quiz' whenever they are ready.
"""

RAG_SYSTEM_INSTRUCTION = """
    You are the voice of a digital avatar representing an expert Senior Sales Director acting as a Tutor.
    Your job is to run a simulation with the user (a Sales Representative under your mentorship).
    The <context> contains the different scenarios that you are to pose to the user by roleplaying as a client. The user will provide a response which you are to then grade.
    
    You have three modes:
    1. POSING A SCENARIO: If the conversation just started, or you just finished grading an answer, you must pick one of the Scenarios from the <context> block and pose ONLY the 'Question' part to the user. Do NOT reveal the rubric yet.
    2. GRADING AN ANSWER: If the user is responding to a scenario you previously asked, read their response, evaluate it against the strict 'Rubric/Key Points' for that specific scenario in the <context>.
    3. CASUAL CHATTING: If the user is simply making casual conversation (e.g., greetings, thanks, farewells), respond warmly, professionally, and remind them to say 'Start Quiz' whenever they are ready to continue. There is no need to refer to the <context> in this mode.
    GRADING RULES:
    - Provide a score (e.g. "Score: 70%").
    - Give constructive, encouraging feedback highlighting exactly what they missed from the rubric.
    - IMMEDIATELY after giving feedback, automatically ask them a DIFFERENT scenario that has not already been asked in the chat history from the <context> to continue the quiz.
    
    CRITICAL RULES:
    1. Read the <chat_history> and refer to the <context> to know which scenario they are answering so you use the correct Rubric.
    2. Keep your response conversational and suitable for text-to-speech audio.

    FORMATTING RULES:
    1. Do NOT use bullet points or numbered lists; use full, conversational sentences that flow naturally for an audio avatar.
    2. Ensure there are no special characters or symbols that would look messy on a screen or confuse a text-to-speech engine.
    3. Write your thinking process in a <thought> tag, then write your actual answer in a <speech> tag.
    4. In your answer, ONLY mention the question, do not preface it with "Sales Scenario 1:" or "Question:"

    <example>
    <thought>
    The user is answering the question for scenario 1. I should check the rubrics for scenario 1 from the context and give them a score and feedback.
    </thought>
    <speech>
    Score: 70%
    Good start, but you missed a few key points.
    Here's the next scenario. I like it, but I need to check with my manager before deciding. 
    </speech>
    </example>
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
    system_instruction = """
    You are a routing system for an AI Sales Tutor digital avatar. 
    Look at the user's latest query. 
    - If the user is answering a sales scenario or trying to start the quiz, output EXACTLY the word: RAG
    - If the user is just saying hello, goodbye, expressing thanks, or making casual small talk not related to the quiz, output EXACTLY the word: CHAT
    
    Output nothing else. Only RAG or CHAT.
    """
    
    client = get_llm_client()
    response = client.chat.completions.create(
        model=GROQ_MODEL,
        messages=[
            {"role": "system", "content": system_instruction},
            {"role": "user", "content": f"Chat history:\n{chat_history}\n\nLatest query: {latest_user_query}"}
        ],
        temperature=0.0
    )
    
    route = response.choices[0].message.content.strip().upper()
    return route if route in ["RAG", "CHAT"] else "RAG"

def generate_chat_response(user_query, chat_history):
    client = get_llm_client()
    response = client.chat.completions.create(
        model=GROQ_MODEL,
        messages=[
            {"role": "system", "content": CHAT_SYSTEM_INSTRUCTION},
            {"role": "user", "content": f"<chat_history>{chat_history}</chat_history>\n\n<question>{user_query}</question>"}
        ],
        temperature=0.5,
        max_tokens=150
    )
    
    return response.choices[0].message.content.strip()

def generate_rag_response_v4(user_query, retrieved_documents, chat_history=""):
    context_str = "\n\n".join([
        f"[Sales Scenario {i+1}]:\n{doc['document']}" 
        for i, doc in enumerate(retrieved_documents)
    ])
    
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
    
    client = get_llm_client()
    response = client.chat.completions.create(
        model=GROQ_MODEL,
        messages=[
            {"role": "system", "content": RAG_SYSTEM_INSTRUCTION},
            {"role": "user", "content": user_prompt}
        ],
        temperature=0.3,
        max_tokens=800,
        stop=["User:", "Client:"]
    )
    
    raw_text = response.choices[0].message.content
    
    import re
    speech_match = re.search(r"<speech>(.*?)</speech>", raw_text, re.DOTALL | re.IGNORECASE)
    thought_match = re.search(r"<thought>(.*?)</thought>", raw_text, re.DOTALL | re.IGNORECASE)
    
    final_spoken_answer = speech_match.group(1).strip() if speech_match else raw_text
    thought = thought_match.group(1).strip() if thought_match else "No thoughts provided"
        
    return final_spoken_answer, thought

async def generate_chat_response_stream(user_query, chat_history):
    client = get_async_llm_client()
    stream = await client.chat.completions.create(
        model=GROQ_MODEL,
        messages=[
            {"role": "system", "content": CHAT_SYSTEM_INSTRUCTION},
            {"role": "user", "content": f"<chat_history>{chat_history}</chat_history>\n\n<question>{user_query}</question>"}
        ],
        temperature=0.5,
        max_tokens=150,
        stream=True
    )
    async for chunk in stream:
        token = chunk.choices[0].delta.content
        if token:
            yield token

async def generate_rag_response_v4_stream(user_query, retrieved_documents, chat_history=""):
    context_str = "\n\n".join([
        f"[Sales Scenario {i+1}]:\n{doc['document']}" 
        for i, doc in enumerate(retrieved_documents)
    ])
    
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
    client = get_async_llm_client()
    stream = await client.chat.completions.create(
        model=GROQ_MODEL,
        messages=[
            {"role": "system", "content": RAG_SYSTEM_INSTRUCTION},
            {"role": "user", "content": user_prompt}
        ],
        temperature=0.2,
        top_p=0.85,
        max_tokens=800,
        stop=["User:", "Client:"],
        stream=True
    )
    async for chunk in stream:
        token = chunk.choices[0].delta.content
        if token:
            yield token

def rewrite_query(chat_history, latest_user_query):
    system_instruction = """
    You are a query rewriter. Look at the chat history and the latest user query.
    If the user's query contains pronouns (it, that, they, etc.) or relies on previous context, rewrite it into a single standalone sentence.
    If the query is already standalone, just output the exact same query.
    DO NOT answer the question. ONLY output the rewritten query.
    """

    client = get_llm_client()
    response = client.chat.completions.create(
        model=GROQ_MODEL,
        messages=[
            {"role": "system", "content": system_instruction},
            {"role": "user", "content": f"Chat History:\n{chat_history}\n\nLatest Query: {latest_user_query}"}
        ],
        temperature=0.0
    )

    return response.choices[0].message.content.strip()
