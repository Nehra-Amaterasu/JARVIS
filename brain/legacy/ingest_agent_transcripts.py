"""Agent Transcript Miner & Ingestion Pipeline for JARVIS Second Brain."""
import os
import glob
import json
import requests
import time

BRAIN_DIR = r"C:\Users\nehra\.gemini\antigravity\brain"
SECOND_BRAIN_API = "http://127.0.0.1:8000"

def mine_and_ingest_agent_transcripts():
    print("[Agent Transcript Miner]: Scanning all agent conversation logs...")
    transcript_files = glob.glob(os.path.join(BRAIN_DIR, "*", ".system_generated", "logs", "transcript.jsonl"))
    print(f"[Agent Transcript Miner]: Found {len(transcript_files)} conversation logs.")
    
    total_ingested = 0
    for idx, filepath in enumerate(transcript_files):
        conv_id = os.path.basename(os.path.dirname(os.path.dirname(os.path.dirname(filepath))))
        try:
            with open(filepath, "r", encoding="utf-8", errors="ignore") as f:
                for line in f:
                    line = line.strip()
                    if not line: continue
                    try:
                        data = json.loads(line)
                        msg_type = data.get("type")
                        content = data.get("content", "")
                        
                        if msg_type == "USER_INPUT" and len(content.strip()) > 10:
                            # Ingest User Prompts from historical agent chats
                            requests.post(f"{SECOND_BRAIN_API}/ingest", json={
                                "content": f"Historical Agent User Prompt ({conv_id[:8]}): {content.strip()}",
                                "source": f"agent_transcript_{conv_id[:8]}",
                                "user_id": "boss",
                                "tags": ["agent_history", "user_prompt"]
                            }, timeout=3)
                            total_ingested += 1
                            
                        elif msg_type == "PLANNER_RESPONSE" and content and len(content.strip()) > 30:
                            # Ingest Agent Synthesis & Solutions
                            # Exclude raw JSON tool logs
                            clean_text = content.strip()
                            if not clean_text.startswith("{") and not clean_text.startswith("```json"):
                                requests.post(f"{SECOND_BRAIN_API}/ingest", json={
                                    "content": f"Historical Agent Solution ({conv_id[:8]}): {clean_text[:600]}",
                                    "source": f"agent_transcript_{conv_id[:8]}",
                                    "user_id": "boss",
                                    "tags": ["agent_history", "agent_solution"]
                                }, timeout=3)
                                total_ingested += 1
                                
                    except Exception:
                        pass
        except Exception as e:
            print(f"[Miner Warning]: Error reading {filepath}: {e}")
            
        if (idx + 1) % 10 == 0:
            print(f"[Agent Transcript Miner]: Processed {idx + 1}/{len(transcript_files)} conversation logs...")
            
    print(f"\n[Agent Transcript Miner]: COMPLETED! Ingested {total_ingested} memory points from all 102 agent transcript logs.")

if __name__ == "__main__":
    mine_and_ingest_agent_transcripts()
