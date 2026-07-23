"""Master User Vault Mapper & Ingestion Engine for JARVIS Second Brain."""
import os
import glob
import json
import requests
import fitz  # PyMuPDF

CONFIG_PATH = os.path.join(os.path.dirname(__file__), "target_vaults.json")
SECOND_BRAIN_API = "http://127.0.0.1:8000"

SUPPORTED_EXTENSIONS = [
    ".md", ".txt", ".json", ".pdf", ".py", ".js", ".ts", ".tsx", 
    ".html", ".css", ".png", ".jpg", ".jpeg", ".srt", ".vtt", ".csv"
]

def load_target_vaults():
    if os.path.exists(CONFIG_PATH):
        with open(CONFIG_PATH, "r", encoding="utf-8") as f:
            return json.load(f)
    return []

from deep_cognitive_extractor import analyze_file_along_22_dimensions, format_22_dimensional_summary

def map_single_file(filepath: str, vault_name: str):
    """Parses a file along 22 cognitive dimensions and streams chunks into Second Brain Qdrant DB."""
    if not os.path.exists(filepath):
        return 0
        
    filename = os.path.basename(filepath)
    ext = os.path.splitext(filename)[1].lower()
    
    if ext not in SUPPORTED_EXTENSIONS:
        return 0

    # 1. Analyze file along 22 Cognitive Dimensions
    extracted_22d = analyze_file_along_22_dimensions(filepath, vault_name=vault_name)
    d22_summary = format_22_dimensional_summary(extracted_22d, filename)
    
    # Ingest 22D Summary Profile
    try:
        requests.post(f"{SECOND_BRAIN_API}/ingest", json={
            "content": d22_summary,
            "source": f"{vault_name}/{filename}_22d_profile",
            "user_id": "boss",
            "tags": [vault_name, "22d_cognitive_profile", ext.replace('.', '')],
            "metadata": extracted_22d
        }, timeout=3)
    except Exception:
        pass
        
    text_content = ""
    source_type = f"vault_{ext.replace('.', '')}"
    
    try:
        if ext in [".md", ".txt", ".json", ".py", ".js", ".ts", ".tsx", ".html", ".css", ".csv"]:
            with open(filepath, "r", encoding="utf-8", errors="ignore") as f:
                text_content = f.read()
                
        elif ext == ".pdf":
            doc = fitz.open(filepath)
            for page in doc:
                text_content += page.get_text() + "\n"
                
        elif ext in [".png", ".jpg", ".jpeg"]:
            text_content = f"Visual Asset Artifact: '{filename}' in Vault '{vault_name}'. File path: {filepath}"
            source_type = "vault_visual_asset"
            
        elif ext in [".srt", ".vtt"]:
            with open(filepath, "r", encoding="utf-8", errors="ignore") as f:
                raw_srt = f.read()
            # Clean timestamps
            lines = [l.strip() for l in raw_srt.split("\n") if l.strip() and "-->" not in l and not l.strip().isdigit()]
            text_content = " ".join(lines)
            source_type = "vault_transcript"
            
    except Exception as e:
        print(f"  [Vault Map Error] {filename}: {e}")
        return 0

    if not text_content.strip():
        return 0
        
    # Split content into ~500 character chunks
    chunks = [text_content[i:i+500] for i in range(0, len(text_content), 450)]
    ingested_count = 0
    
    for idx, chunk in enumerate(chunks):
        if len(chunk.strip()) > 15:
            try:
                requests.post(f"{SECOND_BRAIN_API}/ingest", json={
                    "content": f"[{vault_name.upper()} | {filename} (Chunk {idx+1}/{len(chunks)})]: {chunk.strip()}",
                    "source": f"{vault_name}/{filename}",
                    "user_id": "boss",
                    "tags": [vault_name, source_type, ext.replace('.', '')],
                    "metadata": {"filepath": filepath, "vault": vault_name}
                }, timeout=3)
                ingested_count += 1
            except Exception:
                pass
                
    return ingested_count

def map_all_vaults():
    vaults = load_target_vaults()
    print("==========================================================")
    print("     JARVIS SECOND BRAIN — MASTER VAULT INGESTION         ")
    print("==========================================================\n")
    print(f"Targeting {len(vaults)} User Vault Locations...\n")
    
    total_files = 0
    total_chunks = 0
    
    for idx, vault_path in enumerate(vaults):
        vault_name = os.path.basename(vault_path.strip("\\/")) or f"Vault_{idx+1}"
        print(f"[{idx+1}/{len(vaults)}] Scanning Vault: {vault_name}")
        print(f"   Path: {vault_path}")
        
        if not os.path.exists(vault_path):
            print("   -> (Directory not found on host, skipping safely)\n")
            continue
            
        file_list = []
        for root, _, files in os.walk(vault_path):
            for file in files:
                ext = os.path.splitext(file)[1].lower()
                if ext in SUPPORTED_EXTENSIONS:
                    file_list.append(os.path.join(root, file))
                    
        print(f"   -> Found {len(file_list)} supported files.")
        vault_chunks = 0
        for fpath in file_list:
            vault_chunks += map_single_file(fpath, vault_name=vault_name)
            
        total_files += len(file_list)
        total_chunks += vault_chunks
        print(f"   -> Ingested {vault_chunks} vector chunks into Second Brain.\n")
        
    print("==========================================================")
    print(f"  SUCCESSFULLY MAPPED {total_files} FILES ({total_chunks} CHUNKS) TO SECOND BRAIN!")
    print("==========================================================")

if __name__ == "__main__":
    map_all_vaults()
