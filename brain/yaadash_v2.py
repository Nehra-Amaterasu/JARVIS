"""JARVIS Yaadash v2 — the clean second-brain memory engine.

Replaces the old yaadash_core.py stack, which needed:
  - a separate FastAPI server on :8000 (silent fallback when down),
  - an 8B LLM (llama3.1) call to "extract facts" on EVERY save,
  - a 130k-node GraphRAG injection on the voice hot-path (~95% noise).

This module is ONE self-contained thing:
  - LanceDB   : embedded vector store, no server, on-disk at brain/lancedb/
  - bge-small : 384-d embedder pinned to CPU, so the 6GB GPU stays free for the LLM

Public API is drop-in compatible with the old yaadash_core so agent.py needs
no change: get_context(str) -> str, store_interaction(user, reply).
"""
import os
import threading
from datetime import datetime, timezone

import lancedb
import pyarrow as pa
from sentence_transformers import SentenceTransformer

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DB_PATH = os.path.join(BASE_DIR, "lancedb")
TABLE_NAME = "memories"
USER_ID = "boss"

# bge-small-en-v1.5: 384-d, ~130MB, runs comfortably on CPU in a few ms/query.
# Pinned to CPU on purpose — embedding must NOT contend with the LLM for VRAM.
_MODEL_NAME = "BAAI/bge-small-en-v1.5"
_EMBED_DIM = 384
# bge retrieval convention: prefix QUERIES (not stored docs) with this instruction.
_QUERY_PREFIX = "Represent this sentence for searching relevant passages: "

# --- lazy singletons (first call pays the model-load cost, not import time) ---
_model = None
_db = None
_table = None
_lock = threading.Lock()


def _get_model() -> SentenceTransformer:
    global _model
    if _model is None:
        with _lock:
            if _model is None:
                _model = SentenceTransformer(_MODEL_NAME, device="cpu")
    return _model


def _schema() -> pa.Schema:
    return pa.schema([
        pa.field("id", pa.string()),
        pa.field("text", pa.string()),
        pa.field("vector", pa.list_(pa.float32(), _EMBED_DIM)),
        pa.field("source", pa.string()),
        pa.field("role", pa.string()),
        pa.field("timestamp", pa.string()),
        pa.field("user_id", pa.string()),
    ])


def _get_table():
    global _db, _table
    if _table is None:
        with _lock:
            if _table is None:
                os.makedirs(DB_PATH, exist_ok=True)
                _db = lancedb.connect(DB_PATH)
                if TABLE_NAME in _db.table_names():
                    _table = _db.open_table(TABLE_NAME)
                else:
                    _table = _db.create_table(TABLE_NAME, schema=_schema())
    return _table


def embed(texts, is_query: bool = False):
    """Return L2-normalized embeddings so cosine == dot product."""
    if isinstance(texts, str):
        texts = [texts]
    if is_query:
        texts = [_QUERY_PREFIX + t for t in texts]
    return _get_model().encode(
        texts, normalize_embeddings=True, show_progress_bar=False
    )


def add_memory(text: str, source: str = "voice_interaction",
               role: str = "interaction", timestamp: str = None,
               user_id: str = USER_ID):
    """Embed and persist a single memory row. Returns the row id."""
    text = (text or "").strip()
    if not text:
        return None
    ts = timestamp or datetime.now(timezone.utc).isoformat()
    row_id = f"{source}:{abs(hash((text, ts)))}"
    vec = embed(text)[0].tolist()
    _get_table().add([{
        "id": row_id, "text": text, "vector": vec,
        "source": source, "role": role, "timestamp": ts, "user_id": user_id,
    }])
    return row_id


def add_many(rows):
    """Batch insert. rows: list of dicts with keys text/source/role/timestamp.

    Embeds in one batched encode call (far faster than one-at-a-time).
    """
    clean = [r for r in rows if (r.get("text") or "").strip()]
    if not clean:
        return 0
    vecs = embed([r["text"] for r in clean])
    now = datetime.now(timezone.utc).isoformat()
    payload = []
    for r, v in zip(clean, vecs):
        ts = r.get("timestamp") or now
        payload.append({
            "id": r.get("id") or f"{r.get('source','import')}:{abs(hash((r['text'], ts)))}",
            "text": r["text"], "vector": v.tolist(),
            "source": r.get("source", "import"), "role": r.get("role", "note"),
            "timestamp": ts, "user_id": r.get("user_id", USER_ID),
        })
    _get_table().add(payload)
    return len(payload)


def search(query: str, top_k: int = 3, user_id: str = USER_ID):
    """Return the top_k most relevant memory rows as dicts."""
    tbl = _get_table()
    if tbl.count_rows() == 0:
        return []
    qv = embed(query, is_query=True)[0].tolist()
    res = (
        tbl.search(qv)
        .metric("cosine")
        .where(f"user_id = '{user_id}'")
        .limit(top_k)
        .to_list()
    )
    return res


# ---- drop-in API compatible with the old yaadash_core -----------------------

def store_interaction(user_input: str, jarvis_reply: str):
    """Fire-and-forget save of one turn (mirrors old signature)."""
    interaction = f"User: {user_input}\nJARVIS: {jarvis_reply}"

    def _bg():
        try:
            add_memory(interaction, source="voice_interaction", role="interaction")
        except Exception as e:  # never let memory crash the voice loop
            print(f"\n[Yaadash save error: {e}]")

    threading.Thread(target=_bg, daemon=True).start()


def get_context(user_input: str) -> str:
    """Retrieve relevant memories, formatted for the system prompt."""
    try:
        hits = search(user_input, top_k=3)
    except Exception as e:
        print(f"\n[Yaadash search error: {e}]")
        return ""
    if not hits:
        return ""
    out = "RELEVANT MEMORIES & SECOND BRAIN KNOWLEDGE:\n"
    seen = set()
    for h in hits:
        t = h.get("text", "").strip()
        if t and t not in seen:
            seen.add(t)
            out += f"- {t}\n"
    return out


if __name__ == "__main__":
    print("Yaadash v2 self-test")
    print("Loading embedder + LanceDB...")
    add_memory("I am studying Electronics & Communication Engineering, targeting an MS in VLSI in Germany.",
               source="self_test", role="fact")
    add_memory("My favorite music is hip-hop — Seedhe Maut, KR$NA, Travis Scott.",
               source="self_test", role="fact")
    print(f"Rows in store: {_get_table().count_rows()}")
    print("\nQuery: 'what am I studying?'")
    print(get_context("what am I studying?"))
    print("Query: 'what music do I like?'")
    print(get_context("what music do I like?"))
