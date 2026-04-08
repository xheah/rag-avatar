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

# 2. Define the exact JSON schema for the Eval Dataset using Pydantic
class EvalQAPair(BaseModel):
    rep_answer: str = Field(description="A hypothetical answer spoken by a human sales rep trying to address the scenario.")
    quality: str = Field(description="Must be exactly 'good' (passes most of the rubric) or 'bad' (fails the rubric heavily).")
    expected_score: str = Field(description="The approximate score out of 100% this answer deserves based on the rubric.")
    expected_feedback: str = Field(description="Constructive feedback evaluating the rep's answer against the rubric key points.")

class ScenarioEvalData(BaseModel):
    eval_pairs: list[EvalQAPair]

def generate_eval_dataset():
    base_dir = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    data_path = os.path.join(base_dir, "data", "sales_scenarios.json")
    
    if not os.path.exists(data_path):
        print("Error: Could not find data/sales_scenarios.json")
        sys.exit(1)
        
    with open(data_path, "r") as f:
        scenarios = json.load(f)
        
    all_eval_data = []

    print("Generating synthetic Sales Rep Eval QA Data. This will take a moment...")

    # 3. Loop through the base scenarios and generate eval paths
    for scenario in scenarios:
        print(f"Generating 6 eval responses for: {scenario['id']}...")
        
        prompt = f"""
        You are creating an evaluation dataset for an AI Sales Tutor.
        Below is a specific Sales Scenario and the strict grading Rubric for it.
        
        SCENARIO INFO:
        {scenario['document']}
        
        Generate exactly 6 hypothetical answers a human sales rep might give to the prospect in this scenario:
        - 3 "Good" answers that hit most or all of the rubric's key points.
        - 3 "Bad" answers that fail the rubric (e.g. falling for the trap, being defensive, failing to shift focus).
        
        For each answer, also generate the 'expected_score' and the 'expected_feedback' the AI Tutor should yield.
        """
        
        # 4. Call the API with Structured Outputs (with retry)
        import time
        max_retries = 3
        for attempt in range(max_retries):
            try:
                response = client.models.generate_content(
                    model='gemini-2.5-flash',
                    contents=prompt,
                    config={
                        'response_mime_type': 'application/json',
                        'response_schema': ScenarioEvalData,
                        'temperature': 0.7 
                    },
                )
                break # Success
            except Exception as e:
                print(f"API Error at attempt {attempt+1}: {e}")
                if attempt == max_retries - 1:
                    raise e
                time.sleep(3)
        
        generated_batch = response.parsed.model_dump()["eval_pairs"]
        
        for item in generated_batch:
            all_eval_data.append({
                "scenario_id": scenario["id"],
                "scenario_context": scenario["document"],
                "rep_answer_query": item["rep_answer"],
                "quality": item["quality"],
                "expected_score": item["expected_score"],
                "expected_feedback": item["expected_feedback"]
            })

    # 5. Save the final eval dataset to a JSON file
    out_path = os.path.join(base_dir, "data", "eval_qa_dataset.json")
    with open(out_path, "w") as f:
        json.dump(all_eval_data, f, indent=4)

    print(f"Successfully generated {len(all_eval_data)} Eval QA pairs and saved to data/eval_qa_dataset.json!")

if __name__ == "__main__":
    generate_eval_dataset()
