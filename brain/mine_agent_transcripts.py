"""Deep Psychological & Project Identity Transcripts Miner for JARVIS Yaadash Memory.

Crawls Claude, Antigravity, Gemini, and local chat transcripts to extract:
- User psychological traits, ambitions, role models, and ideologies.
- Deep real-world project context & architectural preferences.
- Personal design taste library references.
Ingests extracted insights into Qdrant Vector Memory and GraphRAG Knowledge Graph.
"""

import os
import sys
import json
import glob
import re
import requests
from graphrag_engine import graph_rag

SECOND_BRAIN_API = "http://127.0.0.1:8000"

TRANSCRIPT_DIRS = [
    r"C:\Users\nehra\.claude",
    r"C:\Users\nehra\.gemini\antigravity\brain",
    r"C:\Users\nehra\OneDrive\Documents\Projects",
    r"C:\Users\nehra\Documents\Projects"
]

KEYWORD_TRIGGERS = [
    "spark", "glitched", "cultfit", "sharekart", "comeback", "jarvis",
    "ideology", "philosophy", "ambition", "goal", "inspired", "admire",
    "project", "ece", "jss", "noida", "r&d", "devansh", "design taste",
    "vibe coding", "glassmorphism", "hardware", "radar", "esp32"
]

def is_user_insight(text: str) -> bool:
    """Filters text for rich personal statements, project descriptions, or psychological insights."""
    t_lower = text.lower()
    if len(text) < 40 or len(text) > 4000:
        return False
    return any(kw in t_lower for kw in KEYWORD_TRIGGERS)

def extract_insights_from_file(filepath: str):
    insights = []
    try:
        with open(filepath, "r", encoding="utf-8", errors="ignore") as f:
            for line in f:
                if not line.strip():
                    continue
                try:
                    data = json.loads(line)
                    # Check user input or planner content
                    content = ""
                    if data.get("type") == "USER_INPUT" and "content" in data:
                        content = data["content"]
                    elif "content" in data and isinstance(data["content"], str):
                        content = data["content"]
                    elif "text" in data and isinstance(data["text"], str):
                        content = data["text"]
                        
                    if content and is_user_insight(content):
                        insights.append(content[:1500])
                except Exception:
                    pass
    except Exception:
        pass
    return insights

def run_transcript_mining():
    print("==========================================================")
    print("  DEEP PSYCHOLOGICAL & PROJECT TRANSCRIPT MINER FOR YAADASH")
    print("==========================================================\n")
    
    extracted_count = 0
    all_relations = []
    
    for base_dir in TRANSCRIPT_DIRS:
        if not os.path.exists(base_dir):
            continue
        print(f"Scanning directory: {base_dir}...")
        
        # Walk directory for transcript.jsonl or *.json files
        for root, _, files in os.walk(base_dir):
            for file in files:
                if file.endswith(".jsonl") or "transcript" in file.lower() or "chat" in file.lower():
                    fpath = os.path.join(root, file)
                    insights = extract_insights_from_file(fpath)
                    
                    for snippet in insights:
                        extracted_count += 1
                        fname = os.path.basename(fpath)
                        
                        # 1. Ingest into Qdrant Vector Store
                        try:
                            requests.post(f"{SECOND_BRAIN_API}/ingest", json={
                                "content": f"User Identity & Project Insight ({fname}):\n" + snippet,
                                "source": f"transcript_miner/{fname}",
                                "user_id": "boss",
                                "tags": ["psychological_profile", "user_identity", "transcript_miner"],
                                "metadata": {"is_transcript_insight": True, "source_file": fname}
                            }, timeout=3)
                        except Exception:
                            pass
                            
                        # 2. Extract quick relations
                        s_lower = snippet.lower()
                        if "spark" in s_lower:
                            all_relations.append(("Boss", "LEADS_PROJECT", "SPARK Society", 1.5))
                        if "glitched" in s_lower or "cultfit" in s_lower:
                            all_relations.append(("Boss", "BUILDING", "Glitched.CultFit", 1.5))
                        if "sharekart" in s_lower:
                            all_relations.append(("Boss", "BUILDING", "ShareKart", 1.5))
                        if "glassmorphism" in s_lower or "design" in s_lower:
                            all_relations.append(("Boss", "PREFERS_DESIGN", "Glassmorphism Aesthetics", 1.0))
                            
                        if extracted_count % 20 == 0:
                            print(f"   ... Mined {extracted_count} psychological & project insights...")

    if all_relations:
        graph_rag.add_relations_batch(all_relations)
        
    print("\n==========================================================")
    print(f"  TRANSCRIPT MINING COMPLETE! Total Insights Ingested: {extracted_count}")
    print("==========================================================")

if __name__ == "__main__":
    run_transcript_mining()
