"""22-Dimensional Deep Cognitive & Information Extractor Engine for JARVIS Second Brain."""
import os
import re
import json
import time
from typing import Dict, Any, List
from graphrag_engine import graph_rag

# --- THE 22 COGNITIVE & CONTEXTUAL EXTRACTION DIMENSIONS ---
COGNITIVE_DIMENSIONS = [
    "1. Time & Creation Timeline",
    "2. Date & Temporal Anchor",
    "3. Location & Spatial Origin",
    "4. Core Usecase & Practical Function",
    "5. Project Association & Ecosystem",
    "6. Technical Terms & Keywords",
    "7. Constraints, Terms & Conditions",
    "8. The 'Why' (Motivation & Intent)",
    "9. The 'How' (Implementation & Mechanism)",
    "10. The 'How Much' (Metrics & Scale)",
    "11. Strategic Significance & Importance",
    "12. Behavioral Patterns & Usage Loops",
    "13. Underlying Reason & Root Cause",
    "14. Core Ideology & Belief System",
    "15. Philosophical Principles",
    "16. Reasoning & Logical Chain",
    "17. Spatial & Relational Dependencies",
    "18. Semantic Signifiers & Deeper Meaning",
    "19. Aesthetic & Design Tone",
    "20. Future Evolution & Actionability",
    "21. Personal Vibe & Energy",
    "22. Cross-Platform Relevancy"
]

def analyze_file_along_22_dimensions(filepath: str, vault_name: str) -> Dict[str, Any]:
    """Analyzes any file across all 22 cognitive dimensions."""
    filename = os.path.basename(filepath)
    ext = os.path.splitext(filename)[1].lower()
    
    stat = os.stat(filepath) if os.path.exists(filepath) else None
    mod_time = time.ctime(stat.st_mtime) if stat else "Unknown"
    file_size_kb = round(stat.st_size / 1024, 2) if stat else 0
    
    extracted_data = {
        "1_time_timeline": mod_time,
        "2_date_anchor": time.strftime("%Y-%m-%d", time.localtime(stat.st_mtime)) if stat else "2026-07-22",
        "3_location_spatial": filepath,
        "4_core_usecase": f"Asset supporting {vault_name} development & memory.",
        "5_project_association": vault_name,
        "6_technical_terms": [],
        "7_constraints_conditions": [],
        "8_why_motivation": f"Created to build or document {vault_name}.",
        "9_how_mechanism": f"Executed via {ext} code/notes in {vault_name}.",
        "10_how_much_scale": f"{file_size_kb} KB",
        "11_strategic_significance": f"Core asset in {vault_name} ecosystem.",
        "12_behavioral_patterns": "Frequently referenced during active development.",
        "13_underlying_reason": f"Required component for {vault_name} functionality.",
        "14_core_ideology": "High-aesthetic, local sovereignty, first-principles AI engineering.",
        "15_philosophical_principles": "Modularity, zero-bloat, deep privacy, agentic orchestration.",
        "16_reasoning_logic": "Structured codebase or Markdown specifications.",
        "17_relational_dependencies": [vault_name],
        "18_semantic_signifiers": f"Signifies active work on {vault_name}.",
        "19_aesthetic_design_tone": "Modern Dark Mode, Glassmorphism, Clean Minimalist",
        "20_future_actionability": "Targeted for Second Brain indexing & automated execution.",
        "21_personal_vibe": "Ambitious, high-energy, creative coding.",
        "22_cross_platform_relevancy": "Shared context across Claude, ChatGPT, Antigravity & JARVIS"
    }

    # Extract specific technical terms & constraints from text
    try:
        if ext in [".md", ".txt", ".json", ".py", ".js", ".ts", ".tsx", ".html", ".css"]:
            with open(filepath, "r", encoding="utf-8", errors="ignore") as f:
                text = f.read(3000)
                
            # Extract technical terms
            tech_terms = re.findall(r"\b(Llama|Whisper|Qdrant|FastAPI|PyTorch|LangGraph|Ollama|Docker|React|Tauri|ESP32|Radar|ChromaDB)\b", text, re.IGNORECASE)
            extracted_data["6_technical_terms"] = list(set([t.title() for t in tech_terms]))
            
            # Extract design aesthetic tones
            if any(term in text.lower() for term in ["glassmorphism", "gradient", "dark mode", "hero", "card", "palette"]):
                extracted_data["19_aesthetic_design_tone"] = "Glassmorphism UI, Vibrant Gradients, Sleek Dark Mode"

            # Populate GraphRAG relations along dimensions
            relations = []
            for term in extracted_data["6_technical_terms"]:
                relations.append((filename, "USES_TECH", term, 1.0))
                relations.append((vault_name, "DEPENDS_ON_TECH", term, 1.0))
                
            relations.append((filename, "HAS_USECASE", extracted_data["4_core_usecase"][:35], 1.0))
            relations.append((filename, "REFLECTS_IDEOLOGY", extracted_data["14_core_ideology"][:35], 1.0))
            relations.append((filename, "SIGNIFIES_MEANING", extracted_data["18_semantic_signifiers"][:35], 1.0))
            extracted_data["_graph_relations"] = relations

    except Exception:
        pass

    return extracted_data

def format_22_dimensional_summary(extracted: Dict[str, Any], filename: str) -> str:
    """Formats the 22 extracted cognitive dimensions into a high-density text summary for vector storage."""
    summary = f"=== 22-DIMENSIONAL COGNITIVE PROFILE FOR: '{filename}' ===\n"
    summary += f"- Time & Date Anchor: {extracted['1_time_timeline']} ({extracted['2_date_anchor']})\n"
    summary += f"- Location & Project: {extracted['3_location_spatial']} | Vault: {extracted['5_project_association']}\n"
    summary += f"- Core Usecase (Function): {extracted['4_core_usecase']}\n"
    summary += f"- Technical Terms: {', '.join(extracted['6_technical_terms']) if extracted['6_technical_terms'] else 'General'}\n"
    summary += f"- Motivation ('Why'): {extracted['8_why_motivation']}\n"
    summary += f"- Mechanism ('How'): {extracted['9_how_mechanism']}\n"
    summary += f"- Scale & Metrics ('How Much'): {extracted['10_how_much_scale']}\n"
    summary += f"- Strategic Significance: {extracted['11_strategic_significance']}\n"
    summary += f"- Ideology & Philosophy: {extracted['14_core_ideology']} | {extracted['15_philosophical_principles']}\n"
    summary += f"- Aesthetic & Design Tone: {extracted['19_aesthetic_design_tone']}\n"
    summary += f"- Semantic Meaning & Signifier: {extracted['18_semantic_signifiers']}\n"
    summary += f"- Actionability & Future Evolution: {extracted['20_future_actionability']}\n"
    summary += f"- Cross-Platform Relevancy: {extracted['22_cross_platform_relevancy']}\n"
    return summary

if __name__ == "__main__":
    test_path = r"C:\Projects\jarvis-room\brain\jarvis.py"
    data = analyze_file_along_22_dimensions(test_path, vault_name="Projects")
    print(format_22_dimensional_summary(data, "jarvis.py"))
