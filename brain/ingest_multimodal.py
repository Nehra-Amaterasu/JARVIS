"""Universal Multi-Modal Ingestion Pipeline for JARVIS Second Brain.

Supports:
- Markdown & Text (.md, .txt)
- PDF Documents (.pdf)
- Subtitle & Anime Transcripts (.srt, .vtt)
- Images & Screenshots (.png, .jpg, .jpeg)
"""
import os
import re
import glob
import requests
import fitz  # PyMuPDF

SECOND_BRAIN_API = "http://127.0.0.1:8000"

def parse_srt(filepath: str) -> str:
    """Parses SRT subtitle files, stripping timestamps and numbers to extract pure dialogue text."""
    with open(filepath, "r", encoding="utf-8", errors="ignore") as f:
        content = f.read()
    # Remove line numbers and timestamps like 00:01:20,000 --> 00:01:23,000
    cleaned = re.sub(r"\d+\n\d{2}:\d{2}:\d{2},\d{3} --> \d{2}:\d{2}:\d{2},\d{3}\n", "", content)
    lines = [line.strip() for line in cleaned.split("\n") if line.strip() and not line.strip().isdigit()]
    return " ".join(lines)

def ingest_file(filepath: str, category: str = "general"):
    """Determines file type and streams content into Second Brain Qdrant Database."""
    if not os.path.exists(filepath):
        print(f"[Multi-Modal Ingest]: File not found: {filepath}")
        return
        
    filename = os.path.basename(filepath)
    ext = os.path.splitext(filename)[1].lower()
    
    print(f"[Multi-Modal Ingest]: Processing {filename} ({ext})...")
    
    text_content = ""
    source_tag = category
    
    if ext in [".md", ".txt"]:
        with open(filepath, "r", encoding="utf-8", errors="ignore") as f:
            text_content = f.read()
        source_tag = "markdown_note"
        
    elif ext == ".pdf":
        doc = fitz.open(filepath)
        for page in doc:
            text_content += page.get_text() + "\n"
        source_tag = "pdf_document"
        
    elif ext in [".srt", ".vtt"]:
        text_content = parse_srt(filepath)
        source_tag = "anime_movie_transcript"
        
    elif ext in [".png", ".jpg", ".jpeg"]:
        # Image screenshot metadata ingestion
        text_content = f"Image Media Artifact: '{filename}' located at {filepath}. Visual screenshot asset ingested into Second Brain."
        source_tag = "visual_screenshot"
        
    else:
        print(f"[Multi-Modal Ingest]: Unsupported extension: {ext}")
        return

    if not text_content.strip():
        print(f"[Multi-Modal Ingest]: Empty content in {filename}.")
        return
        
    # Chunk content into ~500 character blocks for optimal vector embedding
    chunks = [text_content[i:i+500] for i in range(0, len(text_content), 450)]
    ingested_count = 0
    
    for idx, chunk in enumerate(chunks):
        if len(chunk.strip()) > 15:
            try:
                requests.post(f"{SECOND_BRAIN_API}/ingest", json={
                    "content": f"[{source_tag.upper()}: {filename} (Chunk {idx+1}/{len(chunks)})]: {chunk.strip()}",
                    "source": filename,
                    "user_id": "boss",
                    "tags": [source_tag, ext.replace('.', '')],
                    "metadata": {"filepath": filepath, "chunk_index": idx}
                }, timeout=3)
                ingested_count += 1
            except Exception:
                pass
                
    print(f"[Multi-Modal Ingest]: Successfully ingested {filename} ({ingested_count} vector chunks).")

def ingest_directory(directory_path: str, category: str = "general"):
    """Recursively ingests all supported documents, notes, SRTs, and PDFs from a directory."""
    print(f"\n[Multi-Modal Ingestion Engine]: Scanning directory: {directory_path}...")
    supported_extensions = ["*.md", "*.txt", "*.pdf", "*.srt", "*.vtt", "*.png", "*.jpg"]
    
    files_found = []
    for ext in supported_extensions:
        files_found.extend(glob.glob(os.path.join(directory_path, "**", ext), recursive=True))
        
    print(f"[Multi-Modal Ingestion Engine]: Found {len(files_found)} target files.")
    for filepath in files_found:
        ingest_file(filepath, category=category)
        
    print(f"\n[Multi-Modal Ingestion Engine]: Directory Ingestion Completed for {directory_path}!")

if __name__ == "__main__":
    # Test batch ingestion on project research library
    research_dir = r"C:\Users\nehra\OneDrive\Documents\Projects\jarvis-room\brain"
    ingest_directory(research_dir, category="research_library")
