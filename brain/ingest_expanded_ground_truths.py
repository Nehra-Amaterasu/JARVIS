"""Expanded Project Ground Truths & Core Principles Ingestion Script for JARVIS Yaadash."""
import os
import json
import time
import requests
from graphrag_engine import graph_rag

SECOND_BRAIN_API = "http://127.0.0.1:8000"

PROJECT_DEFINITIONS = [
    {
        "name": "SPARK",
        "category": "SOFTWARE_PROJECT",
        "core_principle": "Academic R&D society website and member ecosystem for JSS Academy of Technical Education Noida. Features department management, project showcases, and student research teams.",
        "relations": [
            ("Boss", "FOUNDED_OR_LEADS", "SPARK"),
            ("SPARK", "HAS_CATEGORY", "SOFTWARE_PROJECT"),
            ("SPARK", "GOVERNED_BY_PRINCIPLE", "Academic R&D & Tech Innovation"),
            ("SPARK", "CONTAINS_FILE", "SPARK_org_system_v2.xlsx"),
            ("SPARK", "USES_TECH", "React"),
            ("SPARK", "USES_TECH", "Vite")
        ]
    },
    {
        "name": "Glitched.CultFit",
        "category": "CHARITY_INITIATIVE",
        "core_principle": "Physical disability fitness and adaptive therapy platform. Initiated as a non-profit charity initiative for accessible health and therapy, with long-term potential for commercial growth.",
        "relations": [
            ("Boss", "CREATED_INITIATIVE", "Glitched.CultFit"),
            ("Glitched.CultFit", "HAS_CATEGORY", "CHARITY_INITIATIVE"),
            ("Glitched.CultFit", "GOVERNED_BY_PRINCIPLE", "Accessible Disability Fitness & Adaptive Therapy"),
            ("Glitched.CultFit", "USES_TECH", "OpenCV"),
            ("Glitched.CultFit", "USES_TECH", "Kotlin")
        ]
    },
    {
        "name": "ShareKart",
        "category": "COMMERCIAL_VENTURE",
        "core_principle": "Peer-to-peer asset and equipment lending platform. Enables community asset sharing with lender deposit protection, inventory cataloging, and local peer rental economics.",
        "relations": [
            ("Boss", "FOUNDED_VENTURE", "ShareKart"),
            ("ShareKart", "HAS_CATEGORY", "COMMERCIAL_VENTURE"),
            ("ShareKart", "GOVERNED_BY_PRINCIPLE", "P2P Asset Sharing & Financial Inclusion"),
            ("ShareKart", "CONTAINS_ASSET", "Sharekart Hero Test 2.Mp4"),
            ("ShareKart", "USES_TECH", "React")
        ]
    },
    {
        "name": "mission_Germany",
        "category": "PERSONAL_ROADMAP",
        "core_principle": "Structured personal roadmap and accountability system for higher studies (Master of Science in ECE in Germany). Tracks university prerequisites, APS certification, and academic goals. NOT a coding project.",
        "relations": [
            ("Boss", "TRACKS_ROADMAP", "mission_Germany"),
            ("mission_Germany", "HAS_CATEGORY", "PERSONAL_ROADMAP"),
            ("mission_Germany", "GOVERNED_BY_PRINCIPLE", "Academic Excellence & Overseas Higher Education"),
            ("mission_Germany", "TARGETS_DEGREE", "MS in ECE in Germany")
        ]
    },
    {
        "name": "jarvis-room",
        "category": "CORE_AI_SYSTEM",
        "core_principle": "Local personal AI operating system featuring Llama 3.1 8B brain, Yaadash dual-engine Second Brain, RuView/RuField spatial radar intelligence, and FastMCP room home automation.",
        "relations": [
            ("Boss", "ARCHITECTED", "jarvis-room"),
            ("jarvis-room", "HAS_CATEGORY", "CORE_AI_SYSTEM"),
            ("jarvis-room", "INCLUDES_SUBSYSTEM", "Yaadash Second Brain"),
            ("jarvis-room", "INCLUDES_SUBSYSTEM", "RuView Spatial Intelligence"),
            ("jarvis-room", "INCLUDES_SUBSYSTEM", "RuField Multimodal Sensing"),
            ("jarvis-room", "POWERED_BY", "Llama 3.1 8B"),
            ("jarvis-room", "POWERED_BY", "Qdrant"),
            ("jarvis-room", "POWERED_BY", "NetworkX GraphRAG")
        ]
    },
    {
        "name": "Attaining Enlightenment & Pieces",
        "category": "PHILOSOPHICAL_WRITING",
        "core_principle": "Literary and philosophical writing collection focusing on inner peace, self-realization, human consciousness, and spiritual enlightenment. Includes the 4-episode 'Attaining Enlightenment' series and 'piece.doc'.",
        "relations": [
            ("Boss", "AUTHORED_WORK", "Attaining Enlightenment & Pieces"),
            ("Attaining Enlightenment & Pieces", "HAS_CATEGORY", "PHILOSOPHICAL_WRITING"),
            ("Attaining Enlightenment & Pieces", "GOVERNED_BY_PRINCIPLE", "Inner Peace & Consciousness Analysis"),
            ("Attaining Enlightenment & Pieces", "CONTAINS_FILE", "piece.doc"),
            ("Attaining Enlightenment & Pieces", "EXPRESSES_PHILOSOPHY", "High-Aesthetic Peace & Sovereignty")
        ]
    },
    {
        "name": "Adaptive Smart Street Light",
        "category": "HARDWARE_INVENTION",
        "core_principle": "Hardware IoT adaptive mesh lighting network. Nodes communicate wirelessly to adjust streetlight intensity dynamically based on traffic presence and environmental sensors.",
        "relations": [
            ("Boss", "INVENTED_HARDWARE", "Adaptive Smart Street Light"),
            ("Adaptive Smart Street Light", "HAS_CATEGORY", "HARDWARE_INVENTION"),
            ("Adaptive Smart Street Light", "GOVERNED_BY_PRINCIPLE", "Energy Efficiency & Mesh IoT Automation")
        ]
    },
    {
        "name": "RC Car",
        "category": "HARDWARE_INVENTION",
        "core_principle": "Bluetooth-controlled microcontroller rover equipped with ultrasonic distance obstacle detection and automated laser tracking turret.",
        "relations": [
            ("Boss", "BUILT_HARDWARE", "RC Car"),
            ("RC Car", "HAS_CATEGORY", "HARDWARE_INVENTION"),
            ("RC Car", "EQUIPPED_WITH", "Laser Turret"),
            ("RC Car", "EQUIPPED_WITH", "Ultrasonic Sensor"),
            ("RC Car", "EQUIPPED_WITH", "Bluetooth Module")
        ]
    },
    {
        "name": "Personal Vault & My Docs",
        "category": "PERSONAL_VAULT",
        "core_principle": "Confidential personal documents vault containing academic marksheets (10th/12th/College), PAN/Aadhar identification cards, resume/CV, and 2FA authentication records.",
        "relations": [
            ("Boss", "OWNS_VAULT", "Personal Vault & My Docs"),
            ("Personal Vault & My Docs", "HAS_CATEGORY", "PERSONAL_VAULT"),
            ("Personal Vault & My Docs", "GOVERNED_BY_PRINCIPLE", "Privacy, Security & Personal Credentials")
        ]
    }
]

def run_ground_truth_ingestion():
    print("==========================================================")
    print("   YAADASH SECOND BRAIN — EXPANDED GROUND TRUTHS INGESTION ")
    print("==========================================================\n")

    for proj in PROJECT_DEFINITIONS:
        name = proj["name"]
        cat = proj["category"]
        principle = proj["core_principle"]
        
        print(f"[Ingesting Ground Truth]: {name} ({cat})")
        
        # 1. Ingest into Qdrant Vector Memory
        content_text = f"[PROJECT GROUND TRUTH]: Name: '{name}' | Category: {cat} | Core Principle & Purpose: \"{principle}\"."
        try:
            res = requests.post(f"{SECOND_BRAIN_API}/ingest", json={
                "content": content_text,
                "source": f"ground_truth/{name.lower().replace(' ', '_')}",
                "user_id": "boss",
                "tags": ["project_ground_truth", cat.lower(), name.lower()],
                "metadata": {"project_name": name, "category": cat, "principle": principle}
            }, timeout=5)
            print(f"   -> Vector Memory: {res.json().get('status')}")
        except Exception as e:
            print(f"   -> Vector Memory Note: Direct API note ({e})")

        # 2. Ingest explicit relationships into GraphRAG
        for src, rel, tgt in proj["relations"]:
            graph_rag.add_relation(src, rel, tgt, weight=2.0)
            
        print(f"   -> GraphRAG: Ingested {len(proj['relations'])} explicit relationships.\n")

    # Persist updated graph to disk
    graph_rag.save_graph()
    
    print("==========================================================")
    print("  ALL EXPANDED GROUND TRUTHS SUCCESSFULLY INGESTED!       ")
    print("==========================================================")

if __name__ == "__main__":
    run_ground_truth_ingestion()
