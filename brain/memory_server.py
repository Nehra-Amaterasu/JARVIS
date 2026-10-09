"""JARVIS Second Brain REST API Server (FastAPI + Qdrant + Ollama Embeddings)."""
import os
import sys
import uuid
import time
from typing import List, Optional, Dict, Any
from pydantic import BaseModel

import uvicorn
from fastapi import FastAPI, HTTPException, BackgroundTasks
from qdrant_client import QdrantClient
from qdrant_client.models import Distance, VectorParams, PointStruct
import fitz  # PyMuPDF
import requests

from graphrag_engine import graph_rag

app = FastAPI(
    title="JARVIS Second Brain API",
    description="Unified REST API layer for local multi-client memory ingestion, hybrid retrieval, and document parsing.",
    version="2.0.0"
)

# Local Storage Directory
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
QDRANT_PATH = os.path.join(BASE_DIR, "qdrant_db")
os.makedirs(QDRANT_PATH, exist_ok=True)

COLLECTION_NAME = "jarvis_second_brain"
EMBEDDING_DIM = 768  # nomic-embed-text vector size

# Initialize local file-based Qdrant client (Zero-Docker, 100% Native)
qdrant_client = QdrantClient(path=QDRANT_PATH)

# Ensure collection exists
try:
    collections = [c.name for c in qdrant_client.get_collections().collections]
    if COLLECTION_NAME not in collections:
        qdrant_client.create_collection(
            collection_name=COLLECTION_NAME,
            vectors_config=VectorParams(size=EMBEDDING_DIM, distance=Distance.COSINE),
        )
        print(f"[Second Brain]: Created Qdrant collection '{COLLECTION_NAME}'.")
except Exception as e:
    print(f"[Second Brain Warning]: Qdrant initialization note: {e}")

# Helper: Generate Embeddings using local Ollama nomic-embed-text
OLLAMA_URL = "http://localhost:11434/api/embeddings"

def get_embedding(text: str, is_query: bool = False) -> List[float]:
    """Fetches 768-dim embeddings from local Ollama nomic-embed-text model with Nomic task prefixes."""
    prefix = "search_query: " if is_query else "search_document: "
    prefixed_text = prefix + text
    
    try:
        res = requests.post(OLLAMA_URL, json={"model": "nomic-embed-text", "prompt": prefixed_text}, timeout=10)
        if res.status_code == 200:
            embedding = res.json().get("embedding")
            if embedding and len(embedding) == EMBEDDING_DIM and any(v != 0 for v in embedding):
                return embedding
    except Exception as e:
        print(f"[Embedding Error]: {e}")
    
    raise RuntimeError(f"Failed to generate valid embedding from Ollama for text snippet: {text[:30]}...")

def recursive_chunk_text(text: str, chunk_size: int = 500, overlap: int = 50) -> List[str]:
    """Recursively splits text on double newlines, single newlines, and periods to preserve semantic integrity."""
    if not text or not text.strip():
        return []
    
    separators = ["\n\n", "\n", ". ", " "]
    
    def _split(txt, sep_idx):
        if len(txt) <= chunk_size or sep_idx >= len(separators):
            return [txt.strip()] if txt.strip() else []
        
        sep = separators[sep_idx]
        parts = txt.split(sep)
        chunks = []
        current = ""
        
        for part in parts:
            candidate = current + sep + part if current else part
            if len(candidate) <= chunk_size:
                current = candidate
            else:
                if current:
                    chunks.append(current.strip())
                if len(part) > chunk_size:
                    chunks.extend(_split(part, sep_idx + 1))
                    current = ""
                else:
                    current = part
        if current:
            chunks.append(current.strip())
        return chunks

    raw_chunks = _split(text, 0)
    final_chunks = []
    for i, c in enumerate(raw_chunks):
        if i > 0 and overlap > 0 and len(final_chunks[-1]) > overlap:
            c = final_chunks[-1][-overlap:] + " " + c
        final_chunks.append(c)
    return final_chunks


# --- Pydantic Data Models ---
class IngestRequest(BaseModel):
    content: str
    source: Optional[str] = "user_interaction"
    user_id: Optional[str] = "boss"
    tags: Optional[List[str]] = []
    metadata: Optional[Dict[str, Any]] = {}

class QueryRequest(BaseModel):
    query: str
    top_k: Optional[int] = 5
    user_id: Optional[str] = "boss"

class DocumentIngestRequest(BaseModel):
    file_path: str
    category: Optional[str] = "general"

# --- REST Endpoints ---

@app.get("/")
def health_check():
    return {"status": "online", "system": "JARVIS Second Brain Engine v2.0", "storage": QDRANT_PATH}

@app.post("/ingest")
def ingest_memory(req: IngestRequest, background_tasks: BackgroundTasks):
    """Ingests a text memory into BOTH Qdrant vector memory and GraphRAG knowledge graph."""
    def _process_ingest():
        try:
            # 1. Vector Ingestion into Qdrant
            vector = get_embedding(req.content, is_query=False)
            point_id = str(uuid.uuid4())
            payload = {
                "content": req.content,
                "source": req.source,
                "user_id": req.user_id,
                "tags": req.tags,
                "timestamp": time.time(),
                "metadata": req.metadata
            }
            qdrant_client.upsert(
                collection_name=COLLECTION_NAME,
                points=[PointStruct(id=point_id, vector=vector, payload=payload)]
            )
            
            # 2. GraphRAG Automatic Entity & Relationship Ingestion
            graph_rag.extract_and_ingest(req.content)
            print(f"[Second Brain Dual-Ingest]: Successfully ingested into Qdrant & GraphRAG: '{req.content[:40]}...'")
        except Exception as e:
            print(f"[Second Brain Ingest Error]: Failed background ingestion: {e}")
    
    background_tasks.add_task(_process_ingest)
    return {"status": "queued", "message": "Memory queued for dual-engine background ingestion (Vector + GraphRAG)."}

@app.post("/query")
def query_memory(req: QueryRequest):
    """Queries the Second Brain using Dual-Level Hybrid Retrieval (Qdrant Vector Search + GraphRAG PPR Subgraph)."""
    vector = get_embedding(req.query, is_query=True)
    
    # Fetch GraphRAG Subgraph Context (Multi-hop PPR Triples)
    graph_context = ""
    try:
        graph_context = graph_rag.get_subgraph_context(req.query)
    except Exception as e:
        print(f"[GraphRAG Query Note]: {e}")

    # Fetch Vector Matches from Qdrant
    memories = []
    for attempt in range(3):
        try:
            search_results = qdrant_client.query_points(
                collection_name=COLLECTION_NAME,
                query=vector,
                limit=req.top_k,
                score_threshold=0.55
            ).points
            for hit in search_results:
                memories.append({
                    "score": hit.score,
                    "content": hit.payload.get("content", ""),
                    "source": hit.payload.get("source", ""),
                    "timestamp": hit.payload.get("timestamp", 0)
                })
            break
        except Exception as e:
            if attempt == 2:
                print(f"[Memory Query Note]: Local segment flush retry note: {e}")
            time.sleep(0.3)

    return {
        "query": req.query,
        "count": len(memories),
        "memories": memories,
        "graph_context": graph_context
    }

class SpatialEventRequest(BaseModel):
    user_id: str = "boss"
    zone: str = "Workstation"
    posture_state: str = "Sitting"
    target_x_m: float = 0.0
    target_y_m: float = 2.0
    target_z_m: float = 1.1
    heart_rate_bpm: int = 74
    respiration_rpm: int = 18
    valid_from: Optional[float] = None
    valid_to: Optional[float] = None

@app.get("/spatial/telemetry")
@app.get("/aankhen/telemetry")
def get_aankhen_spatial_telemetry():
    """Fetches live physical Aankhen telemetry from connected ESP32-S3 hardware on COM7."""
    import aankhen_esp32_hardware
    try:
        reader = aankhen_esp32_hardware.ESP32SerialReader(port="COM7", baud=115200)
        time.sleep(0.2)
        snap = reader.get_telemetry_snapshot()
        return snap
    except Exception as e:
        return {"status": "simulated", "system": "Aankhen", "note": str(e)}

@app.post("/spatial/event")
@app.post("/aankhen/event")
def ingest_aankhen_spatial_event(req: SpatialEventRequest, background_tasks: BackgroundTasks):
    """Ingests an Aankhen spatial state event into Qdrant & GraphRAG with temporal validity timestamps."""
    now_ts = time.time()
    v_from = req.valid_from or now_ts
    v_to = req.valid_to or (now_ts + 3600)  # Default 1-hour temporal validity window

    content_text = f"[AANKHEN SPATIAL EVENT]: User '{req.user_id}' in Zone '{req.zone}' | Posture: {req.posture_state} | Pos: ({req.target_x_m}m, {req.target_y_m}m, {req.target_z_m}m) | Vitals: HR={req.heart_rate_bpm}BPM, Resp={req.respiration_rpm}RPM."

    def _process_spatial_event():
        try:
            vector = get_embedding(content_text)
            payload = {
                "content": content_text,
                "source": "aankhen_spatial_perception",
                "user_id": req.user_id,
                "zone": req.zone,
                "posture": req.posture_state,
                "valid_from": v_from,
                "valid_to": v_to,
                "timestamp": now_ts
            }
            point = PointStruct(id=str(uuid.uuid4()), vector=vector, payload=payload)
            qdrant_client.upsert(collection_name=COLLECTION_NAME, points=[point])
            
            # GraphRAG Subgraph Population
            graph_rag.add_relation("Boss", "PERCEIVED_BY", "Aankhen")
            graph_rag.add_relation("Boss", "LOCATED_IN", req.zone)
            graph_rag.add_relation("Boss", "EXHIBITS_POSTURE", req.posture_state)
            graph_rag.save_graph()
            print(f"[Aankhen Perception Ingest]: Logged spatial event for {req.user_id} in {req.zone} ({req.posture_state}).")
        except Exception as e:
            print(f"[Aankhen Perception Ingest Error]: {e}")

    background_tasks.add_task(_process_spatial_event)
    return {"status": "queued", "system": "Aankhen", "valid_from": v_from, "valid_to": v_to, "message": "Aankhen spatial event logged to Second Brain."}

@app.post("/ingest_document")
def ingest_document(req: DocumentIngestRequest, background_tasks: BackgroundTasks):
    """Parses a PDF or Markdown file and ingests its text into the Second Brain."""
    if not os.path.exists(req.file_path):
        raise HTTPException(status_code=404, detail="File not found.")
        
    def _parse_and_ingest():
        text_content = ""
        ext = os.path.splitext(req.file_path)[1].lower()
        if ext == ".pdf":
            doc = fitz.open(req.file_path)
            for page in doc:
                text_content += page.get_text() + "\n"
        else:
            with open(req.file_path, "r", encoding="utf-8", errors="ignore") as f:
                text_content = f.read()
                
        # Chunk text recursively
        chunks = recursive_chunk_text(text_content, chunk_size=500, overlap=50)
        for idx, chunk in enumerate(chunks):
            if len(chunk.strip()) > 20:
                try:
                    vector = get_embedding(chunk)
                    point_id = str(uuid.uuid4())
                    payload = {
                        "content": chunk,
                        "source": os.path.basename(req.file_path),
                        "user_id": "boss",
                        "chunk_index": idx,
                        "category": req.category,
                        "timestamp": time.time()
                    }
                    qdrant_client.upsert(
                        collection_name=COLLECTION_NAME,
                        points=[PointStruct(id=point_id, vector=vector, payload=payload)]
                    )
                except Exception as e:
                    print(f"[Document Ingest Warning]: Skipped chunk {idx} due to embedding error: {e}")
        print(f"[Second Brain]: Ingested document '{os.path.basename(req.file_path)}' ({len(chunks)} chunks).")

    background_tasks.add_task(_parse_and_ingest)
    return {"status": "queued", "file": os.path.basename(req.file_path), "message": "Document parsing queued."}

from graphrag_engine import graph_rag

@app.get("/graph/context")
def get_graph_context(query: str):
    """Returns multi-hop entity-relationship connections for a given query."""
    ctx = graph_rag.get_subgraph_context(query)
    return {"query": query, "graph_context": ctx, "nodes": graph_rag.graph.number_of_nodes(), "edges": graph_rag.graph.number_of_edges()}

@app.post("/graph/dream_state")
def trigger_dream_state(background_tasks: BackgroundTasks):
    """Triggers background memory consolidation & graph synthesis."""
    from dream_state_worker import run_dream_state_synthesis
    background_tasks.add_task(run_dream_state_synthesis)
    return {"status": "queued", "message": "Dream State memory synthesis triggered in background."}

@app.get("/stats")
def get_stats():
    """Returns database telemetry, vector count, and GraphRAG graph size."""
    try:
        count_res = qdrant_client.count(COLLECTION_NAME)
        total_pts = count_res.count
    except Exception:
        total_pts = -1
        
    return {
        "collection": COLLECTION_NAME,
        "total_points": total_pts,
        "status": "online",
        "vector_dim": EMBEDDING_DIM,
        "graph_nodes": graph_rag.graph.number_of_nodes(),
        "graph_edges": graph_rag.graph.number_of_edges()
    }

if __name__ == "__main__":
    print("[Second Brain Engine]: Starting FastAPI Server on http://127.0.0.1:8000 ...")
    uvicorn.run(app, host="127.0.0.1", port=8000, log_level="info")
