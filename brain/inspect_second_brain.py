"""Interactive Second Brain Knowledge Graph & Memory Inspector.

Run this script to inspect what memories and graph relations JARVIS has learned from your 17 target vaults!
"""
import requests
import json

API_URL = "http://127.0.0.1:8000"

def inspect_topic(topic: str):
    print(f"\n==========================================================")
    print(f"   INSPECTING SECOND BRAIN FOR: '{topic}'")
    print(f"==========================================================\n")
    
    # 1. Fetch Vector Memories
    print("--- 1. SEMANTIC VECTOR MEMORIES (Qdrant) ---")
    try:
        res = requests.post(f"{API_URL}/query", json={"query": topic, "top_k": 3}).json()
        hits = res.get("memories", [])
        if not hits:
            print("  (No direct vector hits found)")
        for idx, h in enumerate(hits):
            print(f"  [{idx+1}] Score: {h.get('score'):.4f} | Source: {h.get('source')}")
            snippet = h.get('content', '').replace('\n', ' ')
            print(f"      Content: {snippet[:140]}...\n")
    except Exception as e:
        print(f"  Vector Query Error: {e}")

    # 2. Fetch GraphRAG Relational Connections
    print("--- 2. GRAPH-RAG KNOWLEDGE CONNECTIONS (NetworkX) ---")
    try:
        res = requests.get(f"{API_URL}/graph/context?query={topic}").json()
        graph_ctx = res.get("graph_context", "")
        if graph_ctx.strip():
            print(graph_ctx)
        else:
            print("  (No direct graph edges for this keyword; showing core vault nodes...)")
            res_boss = requests.get(f"{API_URL}/graph/context?query=Boss").json()
            print(res_boss.get("graph_context", ""))
    except Exception as e:
        print(f"  Graph Query Error: {e}")

    print("==========================================================\n")

def main():
    print("Welcome to JARVIS Second Brain Inspector!")
    print("Type any project name, file name, or topic to see its memory and relations.")
    print("Type 'exit' to quit.\n")
    
    sample_queries = ["Spark", "Sharekart", "Mission Germoney", "Design Taste Library", "Hardware", "Audio"]
    print(f"Running automated inspection for sample topics: {sample_queries}\n")
    
    for q in sample_queries:
        inspect_topic(q)

if __name__ == "__main__":
    main()
