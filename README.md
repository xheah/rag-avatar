# rag-avatar
Retrieval-Augmented Generation (RAG) chatbot to serve as a tutor for sales reps.

Step 1: Create a virtual environment
python -m venv venv
Step 2: Activate the virtual environment
source venv/Scripts/activate
Step 3: Install dependencies
pip install -r requirements.txt
cd frontend && npm install
Step 4: Add API KEYS
Create a .env file and write GEMINI_API_KEY='your-api-key' (GEMINI, DEEPGRAM, GROQ, CARTESIA, DEEPGRAM)
Step 5: Create Fine-tuned Model
Run the "Fine Tuning a new model to fit the new database" section in notebooks/rag.ipynb to create the model needed for the retriever.
Be sure to import everything first at the very beginning of the notebook.
Step 5: Run the application
python src/main.py