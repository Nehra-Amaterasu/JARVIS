# Yaadash Second Brain — Technical Deep Dive & Memory Architecture

**Primary Modules:** `memory_server.py`, `graphrag_engine.py`, `universal_vault_ingestor.py`, `visual_information_extractor.py`  
**Storage Architecture:** Local Qdrant Vector Store + NetworkX GraphRAG Engine  

---

## 1. Executive Summary

**Yaadash** is the Second Brain memory engine of JARVIS. It operates under a **Dual-Level Hybrid Retrieval Architecture** that fuses 768-dimensional dense vector similarity search with multi-hop relational graph retrieval using **Personalized PageRank (PPR)** over 130,000+ nodes and 790,000+ edges.

---

## 2. Dual-Engine Architecture Specifications

### A. Qdrant Vector Store Engine
- **Embedding Model:** `nomic-embed-text` (768 dimensions running locally via Ollama).
- **Collection Name:** `jarvis_second_brain`
- **Distance Metric:** Cosine Similarity.
- **Zero-Vector Protection:** `get_embedding()` throws `RuntimeError` on Ollama timeout rather than returning dummy `[0.0]*768` arrays, preserving vector index purity.
- **Temporal Payload Fields:** Each payload stores `valid_from` and `valid_to` UNIX timestamps for historical temporal queries.

### B. NetworkX GraphRAG Relational Engine
- **Graph Topology:** 130,249 Nodes, 791,074 Edges.
- **Node Attributes:** `entity_type` (`PROJECT`, `ORGANIZATION`, `TECH_STACK`, `PHILOSOPHY`, `HARDWARE`, `VAULT_DOC`).
- **Retrieval Protocol:** Runs Personalized PageRank (PPR) starting from query seed nodes to compute target subgraph relevance in **12 ms**.
- **Compact Persistence:** Saved using `json.dump(data, f, separators=(',', ':'))` (compact JSON), shrinking disk size from 780MB down to **~20MB** and speeding up load times by 10x.
- **Concurrency & FileLock Protection:** Graph writes use atomic `os.replace(tmp_path, path)` file operations, completely preventing Windows `[WinError 32]` file locking crashes.

---

## 3. Dual-Level Hybrid Retrieval Flow

When JARVIS queries Yaadash via `/query`:

1. **Step 1 (Dense Vector Search):** Query text is converted to a 768-dim embedding via Ollama (`nomic-embed-text`). Qdrant returns top-k matching memory chunks (similarity score $\ge 0.55$).
2. **Step 2 (GraphRAG Subgraph Retrieval):** Entity keywords are extracted from the query text. NetworkX executes Personalized PageRank over `knowledge_graph.json` to extract relevant 2-hop relational triples (e.g. `Boss -> LEADS -> SPARK -> CO-DEVELOPED -> Glitched.CultFit`).
3. **Step 3 (Context Fusion):** Vector chunks and GraphRAG triples are synthesized into a concise, non-redundant prompt for Llama 3.1 8B.

---

## 4. Multimodal Vault Ingestion Pipeline (`universal_vault_ingestor.py`)

- **Text & Code Files:** Chunked into 500-character segments with 50-character overlap.
- **Documents & PDFs:** Text extracted via `pypdf`, chunked and embedded.
- **Images & Screenshots:** Processed via `visual_information_extractor.py` using **Moondream2 AI Vision** to generate dense natural language scene descriptions before vector/graph indexing.
- **Audio Files:** Ingested using `mutagen` to extract ID3 metadata tags (Artist, Album, Title, Bitrate, Duration) for semantic indexing.
