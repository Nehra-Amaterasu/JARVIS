"""Universal Multi-Format File & Chat Transcript Ingestion Engine for JARVIS Second Brain."""
import os
import sys
import glob
import json
import requests
import zipfile
from PIL import Image
import pytesseract
import docx
import pptx
import openpyxl
from deep_cognitive_extractor import analyze_file_along_22_dimensions, format_22_dimensional_summary
from graphrag_engine import graph_rag

SECOND_BRAIN_API = "http://127.0.0.1:8000"
CONFIG_PATH = os.path.join(os.path.dirname(__file__), "target_vaults.json")

def load_target_vaults():
    if os.path.exists(CONFIG_PATH):
        with open(CONFIG_PATH, "r", encoding="utf-8") as f:
            return json.load(f)
    return []

# --- MULTI-FORMAT PARSERS ---

def parse_word_doc(filepath: str) -> str:
    """Extracts text from Word .docx documents."""
    try:
        doc = docx.Document(filepath)
        full_text = [p.text for p in doc.paragraphs if p.text.strip()]
        return "\n".join(full_text)
    except Exception:
        return ""

def parse_pptx(filepath: str) -> str:
    """Extracts text from PowerPoint .pptx presentations."""
    try:
        prs = pptx.Presentation(filepath)
        text_runs = []
        for slide in prs.slides:
            for shape in slide.shapes:
                if hasattr(shape, "text") and shape.text.strip():
                    text_runs.append(shape.text.strip())
        return "\n".join(text_runs)
    except Exception:
        return ""

def parse_excel(filepath: str) -> str:
    """Extracts text and values from Excel .xlsx spreadsheets."""
    try:
        wb = openpyxl.load_workbook(filepath, data_only=True)
        sheet_texts = []
        for sheetname in wb.sheetnames:
            sheet = wb[sheetname]
            sheet_texts.append(f"Sheet: {sheetname}")
            for row in sheet.iter_rows(values_only=True):
                row_vals = [str(cell) for cell in row if cell is not None]
                if row_vals:
                    sheet_texts.append(" | ".join(row_vals[:10]))
        return "\n".join(sheet_texts[:200]) # Cap to first 200 lines
    except Exception:
        return ""

def parse_zip(filepath: str) -> str:
    """Parses file manifest from Zip archives."""
    try:
        with zipfile.ZipFile(filepath, 'r') as zip_ref:
            files = zip_ref.namelist()
            return f"Zip Archive Manifest ({len(files)} files): " + ", ".join(files[:50])
    except Exception:
        return ""

def parse_audio_metadata(filepath: str) -> str:
    """Extracts ID3 and audio stream metadata (Artist, Title, Album, Genre, Duration) using mutagen."""
    try:
        import mutagen
        audio = mutagen.File(filepath)
        if audio is None:
            return f"Audio Asset: '{os.path.basename(filepath)}' (Format unrecognized by mutagen)."
        
        meta = []
        meta.append(f"Audio File: {os.path.basename(filepath)}")
        meta.append(f"Length: {int(audio.info.length)}s" if hasattr(audio, 'info') and hasattr(audio.info, 'length') else "")
        meta.append(f"Bitrate: {getattr(audio.info, 'bitrate', 'N/A')}")
        
        tags_found = []
        if audio.tags:
            for key in ['TIT2', 'TPE1', 'TALB', 'TCON', 'TRCK', 'title', 'artist', 'album', 'genre']:
                if key in audio.tags:
                    val = str(audio.tags[key])
                    tags_found.append(f"{key}: {val}")
        
        if tags_found:
            meta.append("Tags: " + ", ".join(tags_found))
        return "\n".join([m for m in meta if m])
    except Exception as e:
        return f"Audio File: '{os.path.basename(filepath)}' (Metadata read error: {e})"

def parse_image_file(filepath: str) -> str:
    """Extracts OCR text via pytesseract and image properties via PIL."""
    try:
        img = Image.open(filepath)
        info = [f"Image Asset: {os.path.basename(filepath)}", f"Dimensions: {img.width}x{img.height}", f"Format: {img.format}", f"Mode: {img.mode}"]
        
        # Try OCR
        try:
            ocr_text = pytesseract.image_to_string(img).strip()
            if ocr_text:
                info.append(f"OCR Extracted Text:\n{ocr_text[:800]}")
        except Exception:
            pass
            
        return "\n".join(info)
    except Exception as e:
        return f"Image Asset: '{os.path.basename(filepath)}' (Load error: {e})"


def parse_generic_file(filepath: str, vault_name: str):
    """Universal router parsing any file format into 22D cognitive profile and vector memory."""
    filename = os.path.basename(filepath)
    ext = os.path.splitext(filename)[1].lower()
    
    extracted_text = ""
    
    # Format-specific routing
    if ext in [".docx", ".doc"]:
        extracted_text = parse_word_doc(filepath)
    elif ext in [".pptx", ".ppt"]:
        extracted_text = parse_pptx(filepath)
    elif ext in [".xlsx", ".xls"]:
        extracted_text = parse_excel(filepath)
    elif ext == ".zip":
        extracted_text = parse_zip(filepath)
    elif ext in [".mp3", ".wav", ".flac", ".m4a", ".ogg"]:
        extracted_text = parse_audio_metadata(filepath)
    elif ext in [".png", ".jpg", ".jpeg", ".bmp", ".webp", ".gif"]:
        extracted_text = parse_image_file(filepath)
    elif ext in [".jsonl", ".json"] and ("transcript" in filename or "chat" in filename or "claude" in filepath.lower()):
        try:
            with open(filepath, "r", encoding="utf-8", errors="ignore") as f:
                extracted_text = f.read(50000) # Read up to 50k chars for transcripts
        except Exception:
            pass
    elif ext in [".py", ".js", ".ts", ".tsx", ".html", ".css", ".json", ".md", ".txt", ".csv", ".c", ".cpp", ".java", ".rs", ".go", ".sh", ".ps1"]:
        try:
            with open(filepath, "r", encoding="utf-8", errors="ignore") as f:
                extracted_text = f.read(5000)
        except Exception:
            pass

    if not extracted_text:
        extracted_text = f"File Asset: '{filename}' (Extension: {ext}, Size: {os.path.getsize(filepath) if os.path.exists(filepath) else 0} bytes)."

    # 1. Generate 22-Dimensional Cognitive Profile
    d22_profile = analyze_file_along_22_dimensions(filepath, vault_name=vault_name)
    summary_text = format_22_dimensional_summary(d22_profile, filename) + "\n\nContent Snippet:\n" + extracted_text[:1000]

    # 2. Ingest into Qdrant Vector Store
    try:
        requests.post(f"{SECOND_BRAIN_API}/ingest", json={
            "content": summary_text,
            "source": f"{vault_name}/{filename}",
            "user_id": "boss",
            "tags": [vault_name, ext.replace('.', ''), "universal_vault_file"],
            "metadata": d22_profile
        }, timeout=3)
    except Exception:
        pass

    # 3. Collect relations
    file_relations = d22_profile.pop("_graph_relations", [])
    file_relations.append((vault_name, "CONTAINS_FILE", filename, 1.0))
    file_relations.append((filename, "HAS_FORMAT", ext.replace('.', '').upper(), 1.0))

    return file_relations

def run_universal_vault_ingestion():
    vaults = load_target_vaults()
    # Add Claude transcript folder explicitly
    claude_folder = r"C:\Users\nehra\.claude"
    if os.path.exists(claude_folder) and claude_folder not in vaults:
        vaults.append(claude_folder)

    print("==========================================================", flush=True)
    print("  UNIVERSAL MULTI-FORMAT & CHAT TRANSCRIPT INGESTION      ", flush=True)
    print("==========================================================\n", flush=True)
    print(f"Mining all documents, code, audio, video & chats across {len(vaults)} Vaults...\n", flush=True)

    total_ingested = 0

    for idx, vault_path in enumerate(vaults):
        vault_name = os.path.basename(vault_path.strip("\\/")) or f"Vault_{idx+1}"
        if not os.path.exists(vault_path):
            continue

        print(f"[{idx+1}/{len(vaults)}] Scanning Vault: {vault_name} ({vault_path})", flush=True)
        vault_files = 0

        batch_relations = []
        for root, _, files in os.walk(vault_path):
            for file in files:
                fpath = os.path.join(root, file)
                rels = parse_generic_file(fpath, vault_name=vault_name)
                if rels is not None:
                    batch_relations.extend(rels)
                    vault_files += 1
                    if vault_files % 100 == 0:
                        print(f"   ... Processed {vault_files} files in {vault_name}...", flush=True)
                    if len(batch_relations) > 1000:
                        graph_rag.add_relations_batch(batch_relations)
                        batch_relations = []
        
        if batch_relations:
            graph_rag.add_relations_batch(batch_relations)

        total_ingested += vault_files
        print(f"   -> Completed {vault_name}. Ingested {vault_files} files into Second Brain.\n", flush=True)

    graph_rag.save_graph()

    print("==========================================================")
    print(f"  UNIVERSAL INGESTION COMPLETE! Total Ingested: {total_ingested} files.")
    print("==========================================================")

if __name__ == "__main__":
    run_universal_vault_ingestion()
