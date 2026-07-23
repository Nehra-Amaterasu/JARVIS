"""JARVIS v3.0 Memory Ingestion Script
Reads local .jsonl and .md chat logs and injects them into ChromaDB via Mem0.
"""
import os
import json
import glob
from memory_core import memory, USER_ID

def ingest_jsonl(filepath):
    print(f"Parsing JSONL: {filepath}")
    with open(filepath, 'r', encoding='utf-8') as f:
        chat_context = []
        for line in f:
            try:
                data = json.loads(line)
                # Extremely basic heuristic for extracting conversation
                if "content" in data and isinstance(data["content"], str):
                    role = "user" if data.get("source") == "USER_EXPLICIT" or data.get("type") == "USER_INPUT" else "assistant"
                    chat_context.append({"role": role, "content": data["content"][:500]}) # Limit length per message
            except:
                pass
        
        if chat_context:
            print(f"Injecting {len(chat_context)} interactions into Memory Bank...")
            # Batching to prevent overwhelming the local LLM
            batch = chat_context[-50:] # Just inject the last 50 for testing speed
            memory.add(batch, user_id=USER_ID, metadata={"source": "antigravity_log", "file": os.path.basename(filepath)})
            print("Injection complete.")

def ingest_md(filepath):
    print(f"Parsing MD: {filepath}")
    with open(filepath, 'r', encoding='utf-8') as f:
        text = f.read()
        # Grab first 2000 chars to avoid memory overload
        memory.add(text[:2000], user_id=USER_ID, metadata={"source": "markdown_log", "file": os.path.basename(filepath)})
        print("Injection complete.")

if __name__ == "__main__":
    target_dir = input("Enter the absolute path to your chat logs folder: ").strip()
    
    if not os.path.exists(target_dir):
        print("Directory not found.")
        exit()
        
    for file in glob.glob(os.path.join(target_dir, "**", "*.jsonl"), recursive=True):
        ingest_jsonl(file)
        
    for file in glob.glob(os.path.join(target_dir, "**", "*.md"), recursive=True):
        ingest_md(file)
        
    print("\nAll memory ingestion complete. JARVIS has evolved.")
