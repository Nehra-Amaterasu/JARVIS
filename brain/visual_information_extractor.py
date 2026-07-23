"""Visual Photo & Document Information Extractor Engine for JARVIS Second Brain."""
import os
import glob
import json
import requests
from PIL import Image
import pytesseract
from graphrag_engine import graph_rag

CONFIG_PATH = os.path.join(os.path.dirname(__file__), "target_vaults.json")
SECOND_BRAIN_API = "http://127.0.0.1:8000"

def load_target_vaults():
    if os.path.exists(CONFIG_PATH):
        with open(CONFIG_PATH, "r", encoding="utf-8") as f:
            return json.load(f)
    return []

def extract_image_information(filepath: str, vault_name: str):
    """Extracts text, visual dimensions, and semantic metadata from image files using PIL & Pytesseract OCR."""
    filename = os.path.basename(filepath)
    ext = os.path.splitext(filename)[1].lower()
    
    if ext not in [".png", ".jpg", ".jpeg", ".webp"]:
        return False

    try:
        img = Image.open(filepath)
        width, height = img.size
        
        # 1. OCR Text Extraction from Image
        ocr_text = ""
        try:
            ocr_text = pytesseract.image_to_string(img).strip()
            ocr_text = " ".join(ocr_text.split())
        except Exception:
            pass

        # 2. Vision Model Analysis (Moondream2 / Ollama Vision API)
        vision_caption = ""
        try:
            import base64
            with open(filepath, "rb") as image_file:
                b64_image = base64.b64encode(image_file.read()).decode('utf-8')
            res = requests.post("http://127.0.0.1:11434/api/generate", json={
                "model": "moondream",
                "prompt": "Describe what is in this image briefly in 1-2 sentences.",
                "images": [b64_image],
                "stream": False
            }, timeout=8)
            if res.status_code == 200:
                vision_caption = res.json().get("response", "").strip()
        except Exception:
            pass

        # 3. Build Rich Visual Asset Description
        visual_desc = f"[VISUAL ASSET in Vault '{vault_name}']: File '{filename}' (Dimensions: {width}x{height}px)."
        if vision_caption:
            visual_desc += f" Visual Description (Moondream): \"{vision_caption}\"."
        if ocr_text and len(ocr_text) > 5:
            visual_desc += f" Extracted OCR Text: \"{ocr_text[:300]}\"."
        else:
            visual_desc += f" Visual design asset for {vault_name} project UI/graphics."

        # 3. Ingest Visual Description into Qdrant Vector Memory
        requests.post(f"{SECOND_BRAIN_API}/ingest", json={
            "content": visual_desc,
            "source": f"{vault_name}/{filename}",
            "user_id": "boss",
            "tags": ["visual_asset", "ocr_extraction", vault_name],
            "metadata": {"filepath": filepath, "dimensions": f"{width}x{height}", "has_ocr": bool(ocr_text)}
        }, timeout=3)

        # 4. Build Explicit GraphRAG Relations
        graph_rag.add_relation(vault_name, "HAS_VISUAL_ASSET", filename)
        if ocr_text and len(ocr_text) > 10:
            # Extract key phrases from OCR for node creation
            key_words = [w for w in ocr_text.split() if len(w) > 4][:5]
            for kw in key_words:
                graph_rag.add_relation(filename, "CONTAINS_VISUAL_TEXT", kw.title())
                graph_rag.add_relation(vault_name, "DEFINES_VISUAL_CONCEPT", kw.title())

        return True

    except Exception as e:
        print(f"  [Visual Extractor Error] {filename}: {e}")
        return False

def run_visual_vault_extraction():
    vaults = load_target_vaults()
    print("==========================================================")
    print("  VISUAL PHOTO & DOCUMENT INFORMATION EXTRACTOR ENGINE    ")
    print("==========================================================\n")
    print(f"Extracting visual metadata & OCR across {len(vaults)} Vaults...\n")
    
    total_images_processed = 0
    
    for idx, vault_path in enumerate(vaults):
        vault_name = os.path.basename(vault_path.strip("\\/")) or f"Vault_{idx+1}"
        if not os.path.exists(vault_path):
            continue
            
        image_files = []
        for root, _, files in os.walk(vault_path):
            for file in files:
                ext = os.path.splitext(file)[1].lower()
                if ext in [".png", ".jpg", ".jpeg", ".webp"]:
                    image_files.append(os.path.join(root, file))
                    
        if image_files:
            print(f"[{idx+1}/{len(vaults)}] Processing {len(image_files)} Images in Vault: {vault_name}")
            processed = 0
            for img_path in image_files[:30]: # Process up to 30 images per vault
                if extract_image_information(img_path, vault_name=vault_name):
                    processed += 1
            total_images_processed += processed
            print(f"   -> Successfully extracted visual info & OCR for {processed} assets.\n")

    graph_rag.save_graph()
    
    print("==========================================================")
    print(f"  VISUAL EXTRACTION COMPLETE! Processed {total_images_processed} photos & assets.")
    print("==========================================================")

if __name__ == "__main__":
    run_visual_vault_extraction()
