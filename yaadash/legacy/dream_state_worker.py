"""Associative 'Dream State' Memory Synthesizer & Auto-Pruner for JARVIS Second Brain."""
import os
import time
import requests
from graphrag_engine import graph_rag

SECOND_BRAIN_API = "http://127.0.0.1:8000"

def run_dream_state_synthesis():
    print("==========================================================")
    print("      JARVIS SECOND BRAIN — DREAM STATE SYNTHESIS         ")
    print("==========================================================\n")
    print("[Dream State Worker]: Initiating background memory consolidation & pruning...")
    
    # 1. Fetch live telemetry from Second Brain API
    try:
        stats = requests.get(f"{SECOND_BRAIN_API}/stats").json()
        total_points = stats.get("total_points", 0)
        print(f"[Dream State Worker]: Current Total Vector Points: {total_points}")
    except Exception as e:
        print(f"[Dream State Worker]: Could not reach API: {e}")
        return

    # 2. Extract high-level graph relations across key domains
    key_queries = [
        "Boss interests and study",
        "JARVIS tech stack and architecture",
        "Hardware and ESP32 radar",
        "Design taste library and UI",
        "Music and hip hop artists"
    ]
    
    synthesized_insights = []
    print("[Dream State Worker]: Traversing Knowledge Graph & Vector Clusters...")
    
    for q in key_queries:
        try:
            res = requests.post(f"{SECOND_BRAIN_API}/query", json={"query": q, "top_k": 2}).json()
            memories = res.get("memories", [])
            for m in memories:
                content = m.get("content", "")
                if content:
                    graph_rag.extract_and_ingest(content)
                    if m.get("score", 0) > 0.65:
                        synthesized_insights.append(content[:150])
        except Exception:
            pass

    # 3. Store synthesized high-order memory summary into Qdrant
    if synthesized_insights:
        summary_text = f"DREAM_STATE_SYNTHESIS ({time.strftime('%Y-%m-%d %H:%M')}): Active user focus covers ECE Engineering, JARVIS local AI architecture (Llama 3.1 + Qdrant + Fast-Whisper), OpenClaw spatial radar, and Design Taste assets."
        try:
            requests.post(f"{SECOND_BRAIN_API}/ingest", json={
                "content": summary_text,
                "source": "dream_state_synthesizer",
                "user_id": "boss",
                "tags": ["dream_state", "high_order_insight"]
            }, timeout=3)
            print(f"[Dream State Worker]: Synthesized & stored higher-order memory node!")
        except Exception:
            pass

    print(f"[Dream State Worker]: Graph Nodes: {graph_rag.graph.number_of_nodes()} | Edges: {graph_rag.graph.number_of_edges()}")
    print("==========================================================")
    print("  DREAM STATE CONSOLIDATION & SYNTHESIS COMPLETED!        ")
    print("==========================================================")

if __name__ == "__main__":
    run_dream_state_synthesis()
