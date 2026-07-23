"""Deep Generative Vault Graph Miner & Relational Knowledge Synthesizer.

Scans all files and subfolders across the 17 target vault locations, analyzes their 
contents, extracts entities (projects, design assets, components, topics), and builds
an extensive interconnected NetworkX Knowledge Graph saved in knowledge_graph.json.
"""
import os
import glob
import json
import re
from graphrag_engine import graph_rag

CONFIG_PATH = os.path.join(os.path.dirname(__file__), "target_vaults.json")

def load_target_vaults():
    if os.path.exists(CONFIG_PATH):
        with open(CONFIG_PATH, "r", encoding="utf-8") as f:
            return json.load(f)
    return []

def extract_file_relations(filepath: str, vault_name: str) -> list:
    """Analyzes a single file's content and path to construct multi-directional graph edges."""
    filename = os.path.basename(filepath)
    ext = os.path.splitext(filename)[1].lower()
    
    relations = []
    
    # 1. Connect File -> Vault/Project
    relations.append((filename, "BELONGS_TO_VAULT", vault_name, 1.0))
    relations.append(("Boss", "OWNS_ASSET", filename, 1.0))
    
    # 2. Extract content topics & code/design components
    try:
        if ext in [".md", ".txt", ".json", ".py", ".js", ".ts", ".tsx", ".html", ".css", ".csv"]:
            with open(filepath, "r", encoding="utf-8", errors="ignore") as f:
                content = f.read(4000) # Read first 4KB for deep analysis
                
            # Extract headers and title keywords
            headers = re.findall(r"^#+\s+(.+)$", content, re.MULTILINE)
            for h in headers[:5]:
                clean_h = h.strip()[:40]
                if len(clean_h) > 3:
                    relations.append((filename, "DEFINES_TOPIC", clean_h, 1.0))
                    relations.append((clean_h, "PART_OF_PROJECT", vault_name, 1.0))
                    
            # Extract code imports and dependencies
            imports = re.findall(r"(?:import|from|require)\s+['\"]?([a-zA-Z0-9_\-\./]+)['\"]?", content)
            for imp in set(imports[:8]):
                if len(imp) > 2 and not imp.startswith("."):
                    mod_name = os.path.basename(imp)
                    relations.append((filename, "USES_DEPENDENCY", mod_name, 1.0))
                    relations.append((vault_name, "DEPENDS_ON", mod_name, 1.0))

            # Extract design & UI keywords
            design_terms = ["glassmorphism", "gradient", "dark mode", "palette", "typography", "animation", "flexbox", "grid", "component", "hero", "card", "dashboard"]
            for dt in design_terms:
                if dt in content.lower():
                    relations.append((filename, "HAS_DESIGN_PATTERN", dt.title(), 1.0))
                    relations.append((vault_name, "USES_DESIGN_STYLE", dt.title(), 1.0))
                    
    except Exception as e:
        print(f"  [Graph Miner Note] {filename}: {e}", flush=True)

    return relations

def run_deep_vault_graph_mining():
    vaults = load_target_vaults()
    print("==========================================================", flush=True)
    print("   DEEP GENERATIVE VAULT GRAPH MINER & RELATION ENGINE    ", flush=True)
    print("==========================================================\n", flush=True)
    print(f"Deeply analyzing files & subfolders across {len(vaults)} Vaults...\n", flush=True)
    
    total_files_analyzed = 0
    
    for idx, vault_path in enumerate(vaults):
        vault_name = os.path.basename(vault_path.strip("\\/")) or f"Vault_{idx+1}"
        if not os.path.exists(vault_path):
            continue
            
        print(f"[{idx+1}/{len(vaults)}] Mining Relations in Vault: {vault_name}", flush=True)
        file_count = 0
        batch_relations = []
        
        for root, _, files in os.walk(vault_path):
            for file in files:
                filepath = os.path.join(root, file)
                rels = extract_file_relations(filepath, vault_name=vault_name)
                batch_relations.extend(rels)
                file_count += 1
                total_files_analyzed += 1
                
                if file_count % 100 == 0:
                    print(f"   ... Mapped {file_count} files in {vault_name}...", flush=True)
                if len(batch_relations) >= 1000:
                    graph_rag.add_relations_batch(batch_relations)
                    batch_relations = []
                    
        if batch_relations:
            graph_rag.add_relations_batch(batch_relations)
                
        print(f"   -> Completed Mapping {file_count} files in {vault_name} into Knowledge Graph.\n", flush=True)
        
    print("==========================================================", flush=True)
    print(f"  MINING COMPLETE! Analyzed {total_files_analyzed} files.", flush=True)
    try:
        graph_rag.load_graph()
        print(f"  KNOWLEDGE GRAPH TELEMETRY:", flush=True)
        print(f"  -> Total Relational Nodes : {graph_rag.graph.number_of_nodes()}", flush=True)
        print(f"  -> Total Relational Edges : {graph_rag.graph.number_of_edges()}", flush=True)
    except Exception:
        pass
    print("==========================================================", flush=True)

if __name__ == "__main__":
    run_deep_vault_graph_mining()
