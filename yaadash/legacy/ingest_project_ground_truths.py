"""Ingests verified project ground-truth memories and entity-typed graph nodes into Yaadash."""
import requests
import json
from graphrag_engine import graph_rag

SECOND_BRAIN_API = "http://127.0.0.1:8000"

GROUND_TRUTH_PROJECTS = [
    {
        "name": "Glitched.CultFit",
        "content": (
            "Project Ground Truth: 'Glitched.CultFit' is a fitness application specifically designed for physically disabled people. "
            "It was created by Boss and his friend Devansh. The app integrates OpenCV into the camera system to track character posture "
            "and body movements in real-time, providing accessible physical therapy and workout guidance."
        ),
        "relations": [
            ("Boss", "DEVELOPED_PROJECT", "Glitched.CultFit", 2.0),
            ("Glitched.CultFit", "CO_DEVELOPER", "Devansh", 1.0),
            ("Glitched.CultFit", "USES_TECH", "OpenCV", 1.0),
            ("Glitched.CultFit", "TARGET_AUDIENCE", "Physically Disabled People", 1.0),
            ("Glitched.CultFit", "CATEGORY", "Fitness App", 1.0)
        ]
    },
    {
        "name": "ShareKart",
        "content": (
            "Project Ground Truth: 'ShareKart' is a Person-to-Person (P2P) item and asset lending platform. "
            "It bridges the accessibility gap by allowing lenders to list items safely with built-in asset protection, "
            "enabling borrowers to access items affordably while lenders earn monetary returns."
        ),
        "relations": [
            ("Boss", "DEVELOPED_PROJECT", "ShareKart", 2.0),
            ("ShareKart", "CATEGORY", "P2P Asset Lending Platform", 1.0),
            ("ShareKart", "MISSION", "Financial Accessibility & Asset Lending", 1.0),
            ("ShareKart", "FEATURE", "Lender Asset Protection", 1.0)
        ]
    },
    {
        "name": "SPARK Society",
        "content": (
            "Project Ground Truth: 'SPARK' is an official student Research & Development (R&D) Society at JSS University in Noida. "
            "Boss is the Head of Research & Development (R&D Head) leading a core technical team of 5 to 6 developers and researchers "
            "building websites, AI projects, and innovative software solutions."
        ),
        "relations": [
            ("Boss", "HEAD_OF_RD", "SPARK Society", 2.0),
            ("SPARK Society", "INSTITUTION", "JSS University Noida", 1.0),
            ("SPARK Society", "TEAM_SIZE", "5-6 People", 1.0),
            ("SPARK Society", "ROLE", "Research & Development", 1.0)
        ]
    },
    {
        "name": "Comeback",
        "content": "Project Ground Truth: 'Comeback' is a personal software development project created by Boss.",
        "relations": [
            ("Boss", "DEVELOPED_PROJECT", "Comeback", 1.5)
        ]
    },
    {
        "name": "jarvis-room",
        "content": (
            "Project Ground Truth: 'jarvis-room' is the flagship personal local AI operating system and Second Brain environment "
            "for Boss, integrating Llama 3.1 8B, Qdrant vector memory, GraphRAG, FastMCP hardware controls, and spatial intelligence."
        ),
        "relations": [
            ("Boss", "DEVELOPED_PROJECT", "jarvis-room", 2.0),
            ("jarvis-room", "CORE_ENGINE", "Llama 3.1 8B", 1.0),
            ("jarvis-room", "MEMORY_SYSTEM", "Yaadash Second Brain", 1.0)
        ]
    }
]

def run_ground_truth_ingestion():
    print("==========================================================")
    print("  INGESTING VERIFIED PROJECT GROUND TRUTHS INTO YAADASH    ")
    print("==========================================================")
    
    all_relations = []
    
    for item in GROUND_TRUTH_PROJECTS:
        print(f"Ingesting Ground Truth: {item['name']}...")
        
        # 1. Ingest into Qdrant Vector Store
        try:
            res = requests.post(f"{SECOND_BRAIN_API}/ingest", json={
                "content": item["content"],
                "source": f"ground_truth/{item['name']}",
                "user_id": "boss",
                "tags": ["ground_truth", "project", item["name"].lower()],
                "metadata": {"is_ground_truth": True, "entity_type": "PROJECT"}
            }, timeout=5)
            print(f"   Vector Ingest Result: {res.json().get('status', 'ok')}")
        except Exception as e:
            print(f"   Vector Ingest Note: {e}")
            
        # 2. Collect Graph Relations
        all_relations.extend(item["relations"])
        
    # Add relations to GraphRAG
    graph_rag.add_relations_batch(all_relations)
    
    print("==========================================================")
    print("  GROUND TRUTH INGESTION COMPLETE!")
    print("==========================================================")

if __name__ == "__main__":
    run_ground_truth_ingestion()
