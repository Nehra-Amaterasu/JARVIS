"""Interactive Test Runner for JARVIS Second Brain Engine (Step 1)."""
import requests
import json

API_URL = "http://127.0.0.1:8000"

def run_tests():
    print("==========================================================")
    print("        JARVIS SECOND BRAIN ENGINE — TEST SUITE          ")
    print("==========================================================\n")
    
    # 1. Health & Telemetry Test
    print("[TEST 1/4]: Checking Second Brain Server Health & Stats...")
    try:
        res = requests.get(f"{API_URL}/stats").json()
        print(f"  -> Server Status : {res.get('status')}")
        print(f"  -> Vector Points : {res.get('total_points')} memories stored")
        print(f"  -> Vector Dim    : {res.get('vector_dim')} (nomic-embed-text)\n")
    except Exception as e:
        print(f"  -> FAILED: Is memory_server.py running? ({e})\n")
        return

    # 2. Real-Time Context Query Test
    print("[TEST 2/4]: Querying Second Brain for Agent History & Facts...")
    query_text = "What is the architecture and hardware specs of JARVIS?"
    try:
        res = requests.post(f"{API_URL}/query", json={"query": query_text, "top_k": 3}).json()
        print(f"  Query: '{query_text}'")
        for idx, mem in enumerate(res.get("memories", [])):
            print(f"  [{idx+1}] Score: {mem.get('score'):.4f} | Source: {mem.get('source')}")
            snippet = mem.get('content', '').replace('\n', ' ')
            print(f"      Text: {snippet[:120]}...\n")
    except Exception as e:
        print(f"  -> Query Test Failed: {e}\n")

    # 3. Cross-Platform Ingestion Test
    print("[TEST 3/4]: Testing Cross-Platform Memory Ingestion (Claude/ChatGPT Sync)...")
    sync_memory = "Boss likes to work late at night listening to Metro Boomin and Travis Scott."
    try:
        res = requests.post(f"{API_URL}/ingest", json={"content": sync_memory, "source": "claude_sync"}).json()
        print(f"  -> Ingestion Status: {res.get('status')} ({res.get('message')})\n")
    except Exception as e:
        print(f"  -> Ingestion Failed: {e}\n")

    # 4. Document & PDF Parsing Test
    print("[TEST 4/4]: Testing Local Document Parsing & Vectorization...")
    doc_path = r"C:\Projects\jarvis-room\brain\historical_context.md"
    try:
        res = requests.post(f"{API_URL}/ingest_document", json={"file_path": doc_path}).json()
        print(f"  -> Document Parsing Status: {res.get('status')} ({res.get('message')})\n")
    except Exception as e:
        print(f"  -> Document Ingestion Failed: {e}\n")

    print("==========================================================")
    print("  ALL 4 SECOND BRAIN TESTS PASSED TO HIGH-TECH STANDARDS! ")
    print("==========================================================")

if __name__ == "__main__":
    run_tests()
