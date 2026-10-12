"""Deep Relational Second Brain Memory Engine for JARVIS (FastAPI + Qdrant + Mem0)."""
import os
import requests
import threading
from mem0 import Memory

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DB_PATH = os.path.join(BASE_DIR, "db")
os.makedirs(DB_PATH, exist_ok=True)

# Configure local fallback Mem0 engine
config = {
    "llm": {
        "provider": "ollama",
        "config": {
            "model": "llama3.1:latest",
            "temperature": 0.1,
        }
    },
    "vector_store": {
        "provider": "chroma",
        "config": {
            "collection_name": "jarvis_memory",
            "path": DB_PATH
        }
    },
    "embedder": {
        "provider": "ollama",
        "config": {
            "model": "nomic-embed-text"
        }
    }
}

memory = Memory.from_config(config)
USER_ID = "boss"
SECOND_BRAIN_API = "http://127.0.0.1:8000"

def store_interaction(user_input: str, jarvis_reply: str):
    """
    Asynchronously ingests interaction into Second Brain REST API and Mem0 background worker.
    """
    interaction = f"User: {user_input}\nJARVIS: {jarvis_reply}"
    
    def _background_save():
        # 1. Post to local Second Brain FastAPI Server
        try:
            requests.post(f"{SECOND_BRAIN_API}/ingest", json={
                "content": interaction,
                "source": "voice_interaction",
                "user_id": USER_ID
            }, timeout=3)
        except Exception:
            pass
            
        # 2. Fallback / Secondary store in Mem0
        try:
            memory.add(interaction, user_id=USER_ID)
        except Exception as e:
            print(f"\n[Memory Alert: Mem0 extraction note - {e}]")
            
    threading.Thread(target=_background_save, daemon=True).start()

def get_context(user_input: str) -> str:
    """
    Retrieves context from Second Brain API (Qdrant) with Mem0 fallback.
    """
    context_memories = []
    
    # 1. Try Second Brain API Query
    try:
        res = requests.post(f"{SECOND_BRAIN_API}/query", json={
            "query": user_input,
            "top_k": 3,
            "user_id": USER_ID
        }, timeout=8)
        if res.status_code == 200:
            hits = res.json().get("memories", [])
            for h in hits:
                if h.get("content"):
                    context_memories.append(h["content"])
    except Exception:
        pass
        
    # 2. Fallback to Mem0 search if API returned empty
    if not context_memories:
        try:
            results = memory.search(user_input, filters={"user_id": USER_ID})
            for r in results:
                if isinstance(r, dict):
                    context_memories.append(r.get('memory', str(r)))
                else:
                    context_memories.append(str(r))
        except Exception:
            pass
            
    if not context_memories:
        return ""
        
    context_str = "RELEVANT MEMORIES & SECOND BRAIN KNOWLEDGE:\n"
    for m in set(context_memories):
        context_str += f"- {m}\n"
        
    # GraphRAG Multi-Hop Connection Injection
    try:
        from graphrag_engine import graph_rag
        graph_ctx = graph_rag.get_subgraph_context(user_input)
        if graph_ctx:
            context_str += f"\n{graph_ctx}\n"
    except Exception:
        pass
        
    return context_str

def get_judgement_prompt() -> str:
    """Core psychological persona directive."""
    return """
[SYSTEM_ROLE: EMPATHETIC_CONTEXT_ENGINE & SECOND_BRAIN]
You are JARVIS, an advanced, self-learning AI assistant deeply integrated into the user's life and living space.
"""

if __name__ == "__main__":
    print("Testing Second Brain Integration...")
    store_interaction("I am studying Electronics & Communication Engineering.", "Noted, boss.")
    print("Memory Ingested.")
    print("Retrieving Context:")
    print(get_context("What am I studying?"))
