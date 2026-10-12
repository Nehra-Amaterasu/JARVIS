"""JARVIS Yaadash v2 — the clean second-brain memory engine.

Replaces the old yaadash_core.py stack, which needed:
  - a separate FastAPI server on :8000 (silent fallback when down),
  - an 8B LLM (llama3.1) call to "extract facts" on EVERY save,
  - a 130k-node GraphRAG injection on the voice hot-path (~95% noise).

This module is ONE self-contained thing:
  - LanceDB   : embedded vector store, no server, on-disk at data/yaadash/lancedb/
  - bge-small : 384-d embedder pinned to CPU, so the 6GB GPU stays free for the LLM

Public API is drop-in compatible with the old yaadash_core so agent.py needs
no change: get_context(str) -> str, store_interaction(user, reply).
"""
import os
import re
import threading
import time
from datetime import datetime, timedelta, timezone

import lancedb
import pyarrow as pa
from sentence_transformers import SentenceTransformer

from home import LANCEDB  # noqa: E402  data/yaadash/lancedb, git-ignored
DB_PATH = str(LANCEDB)
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
                # Two processes write this table: the brain (turns, "remember that")
                # and the app (beliefs he confirms, corrections he teaches). A handle
                # opened with the default never re-reads the table, so until
                # 2026-10-09 a fact confirmed in the app reached JARVIS only after a
                # restart (checked: another process's row stayed invisible). Re-checking
                # the table version every 5 s costs one small manifest read.
                _db = lancedb.connect(DB_PATH, read_consistency_interval=timedelta(seconds=5))
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


def search_authored(query: str, top_k: int = 4, user_id: str = USER_ID):
    """Search ONLY authored ground-truth facts (data/identity/core_facts.md)."""
    tbl = _get_table()
    if tbl.count_rows() == 0:
        return []
    qv = embed(query, is_query=True)[0].tolist()
    return (
        tbl.search(qv)
        .metric("cosine")
        .where(f"user_id = '{user_id}' AND source LIKE 'authored%'")
        .limit(top_k)
        .to_list()
    )


# Past-chat fragments are only shown when genuinely relevant. Measured 2026-10-08
# on bge-small cosine distance (lower = closer) against the Instagram corpus:
#   relevant:   "which anime?" -> 0.300 (One Piece/Black Clover message)
#               "<friend name>" -> 0.291 (message mentioning that friend)
#   irrelevant: "tell me my name" -> 0.349+ (a love letter, a username chat)
#               "what music?"     -> 0.404+ (three Spotify Jam invite links)
# Without a cutoff the top-3 were injected unconditionally, so "what's my name"
# arrived wrapped in a 2022 love confession. 0.32 separates the two groups.
FRAGMENT_MAX_DISTANCE = 0.32

# Sources never retrieved on the hot path:
#   claude            — my own dev-session logs: instructions while building this
#                       ("push to git, fix the folders"). Retrieved, the model
#                       read them as CURRENT orders and started talking about
#                       spark-website and git mid-conversation.
#   voice_interaction — JARVIS's own past replies, including the bad ones. Feeding
#                       them back creates a loop that reinforces earlier mistakes.
# The rows are kept on disk (reversible); they are simply not retrieved.
EXCLUDED_FRAGMENT_SOURCES = ("claude", "voice_interaction", "authored")


def search_fragments(query: str, top_k: int = 3, user_id: str = USER_ID):
    """Past-chat evidence, excluding poisoned sources and irrelevant matches."""
    tbl = _get_table()
    if tbl.count_rows() == 0:
        return []
    qv = embed(query, is_query=True)[0].tolist()
    excl = " AND ".join(f"source NOT LIKE '{s}%'" for s in EXCLUDED_FRAGMENT_SOURCES)
    rows = (
        tbl.search(qv)
        .metric("cosine")
        .where(f"user_id = '{user_id}' AND {excl}")
        .limit(top_k)
        .to_list()
    )
    return [r for r in rows if r.get("_distance", 1.0) <= FRAGMENT_MAX_DISTANCE]


# ---- every confirmed fact, always --------------------------------------------
# Until 2026-10-09 only the 4 authored facts most similar to the question reached
# the prompt, so a question worded unlike its fact missed it ("mera ghar kahan
# hai?" never matched "He lives in ..."). Audit on 33 memory questions with the
# live model: 81/99 correct with top-4 (3 seeds); 193/198 with every fact in the
# system message (6 seeds; DECISIONS 2026-10-09). All of them are ~950 tokens, and
# in the system message they are part of the prefix Ollama caches, so after the
# first turn they cost almost no prefill (median stayed ~0.1 s). The block is
# rebuilt only when the facts change, so the prefix stays identical turn to turn.
FACTS_RECHECK_S = 15
MAX_TOLD = 40            # "remember that ..." facts kept in the prompt (newest)
MAX_CORRECTIONS = 30     # taught corrections kept in the prompt (newest)
TOLD_SOURCE = "authored:confirmed:told"
CORRECTION_SOURCE = "authored:confirmed:correction"
_SECTION_ORDER = ("authored:Who he is", "authored:What he is building", "authored:Taste",
                  "authored:Boundaries", "authored:confirmed")
_facts = {"sig": None, "block": "", "checked": -1e9}


def _authored_rows():
    return (_get_table().search().where("source LIKE 'authored%'")
            .select(["text", "source", "timestamp"]).limit(100000).to_list())


def _format_facts(rows) -> str:
    def rank(src):
        return next((i for i, s in enumerate(_SECTION_ORDER) if src.startswith(s)), len(_SECTION_ORDER))

    now, past, told, fixes = [], [], [], []
    for r in sorted(rows, key=lambda r: (rank(r["source"]), r.get("timestamp") or "", r["text"])):
        src, text = r["source"], " ".join((r.get("text") or "").split())
        if not text:
            continue
        if src.startswith(TOLD_SOURCE):
            told.append(text)
        elif src.startswith(CORRECTION_SOURCE):
            fixes.append(text)
        elif ":past" in src or src.startswith("authored:HISTORY"):
            past.append(text)
        else:
            now.append(text)
    now, past = list(dict.fromkeys(now)), list(dict.fromkeys(past))
    told, fixes = list(dict.fromkeys(told))[-MAX_TOLD:], list(dict.fromkeys(fixes))[-MAX_CORRECTIONS:]
    if not (now or past or told or fixes):
        return ""
    out = ("CONFIRMED FACTS ABOUT AMAN. This is everything you know for certain about him. If he asks "
           "about himself and the answer is not here or in CONTEXT, you do not know it: say so and ask "
           "him. Never guess a number, a date or a name.\n")
    out += "".join(f"- {t}\n" for t in now)
    if past:
        out += "TRUE IN THE PAST, NOT NOW:\n" + "".join(f"- {t}\n" for t in past)
    if told:
        out += "THINGS HE TOLD YOU TO REMEMBER (his own words, dated):\n" + "".join(f"- {t}\n" for t in told)
    if fixes:
        out += ("CORRECTIONS HE GAVE YOU (they override anything else you think):\n"
                + "".join(f"- {t}\n" for t in fixes))
    return out.rstrip("\n")


def authored_block(force: bool = False) -> str:
    """Every authored fact, formatted for the STATIC system message (cached)."""
    now = time.monotonic()
    if not force and now - _facts["checked"] < FACTS_RECHECK_S:
        return _facts["block"]
    _facts["checked"] = now
    try:
        rows = _authored_rows()
    except Exception as e:                  # never let memory break a reply
        print(f"\n[Yaadash facts error: {e}]")
        return _facts["block"]
    sig = tuple(sorted((r["source"], r["text"]) for r in rows))
    if sig != _facts["sig"]:
        _facts["sig"], _facts["block"] = sig, _format_facts(rows)
    return _facts["block"]


def _add_fact(text: str, source: str, already: str = None) -> bool:
    """Store one authored fact unless it is already there (`already`: a substring
    that identifies a duplicate; defaults to the whole text)."""
    text = " ".join(text.split())
    key = already or text
    if any(key in r["text"] for r in _authored_rows()):
        return False
    add_many([{"text": text, "role": "fact", "source": source}])
    _facts["checked"] = -1e9                # rebuild on the next turn
    return True


def remember_told(words: str) -> bool:
    """'remember that ...' — kept in his own words, so nothing is lost converting
    "my" to "his" (and Hinglish stays exactly as he said it)."""
    words = " ".join(words.split()).strip('"').strip()
    if not words:
        return False
    d = datetime.now()
    return _add_fact(f'On {d.day} {d:%B %Y} he told you: "{words}"', TOLD_SOURCE, already=f'"{words}"')


def remember_correction(question: str, answer: str) -> bool:
    """A reply he flagged as wrong, with what it should have been."""
    question, answer = " ".join((question or "").split()), " ".join((answer or "").split())
    if not answer:
        return False
    text = (f'When he asked "{question[:200]}", the right answer is: {answer[:400]}' if question
            else f"He corrected you: {answer[:400]}")
    return _add_fact(text, CORRECTION_SOURCE)


# A follow-up such as "aur uske baare mein?" or "what about her?" names nothing, so
# memory searched with it alone finds nothing: the person or topic is in the
# previous question. The model sees the conversation history; retrieval did not.
# Measured 2026-10-09 on 11 follow-ups (VLSI/Germany notes, people): grounded 2/11
# searched alone, 7/11 with the previous question. "it" and "this" are left out on
# purpose: with them, "what time is it?" and "is it going to rain?" inherited the
# previous topic (3 of 6 topic switches); without them, 0 of 6.
_LEANS_BACK = re.compile(
    r"^(?:and|aur|or|also|but|toh?|what about|how about|why|kyun?|kyon|kaise|since when|kab se)\b"
    r"|\b(?:uske|uska|uski|unke|unka|unki|usne|unhone|iske|iska|iski|isme|usme|wo|woh|vo|"
    r"he|him|his|she|her|hers|they|them|their)\b", re.I)
FOLLOW_UP_MAX_WORDS = 8


def follow_up_query(text: str, previous: str = "") -> str:
    """The text to search memory with: `text`, plus `previous` (his last message)
    when `text` is short and leans on it."""
    if (not previous or len(text.split()) > FOLLOW_UP_MAX_WORDS
            or not _LEANS_BACK.search(text)):
        return text
    return f"{previous} {text}"


def get_context(user_input: str, fragments: bool = True, facts: bool = True) -> str:
    """Retrieve relevant memories, formatted for the system prompt.

    Two labelled channels:
      CONFIRMED FACTS — authored ground truth from data/identity/core_facts.md.
      PAST CHAT FRAGMENTS — social evidence, shown only when relevant, never fact.

    History of why (2026-10-08): with one undifferentiated store, "what am I
    studying?" returned a friend's DM saying college is a waste of time, and JARVIS
    repeated it as advice. Then "tell me my name" arrived wrapped in a love letter.
    In every case the model reported its context accurately — the context was the
    defect. Provenance labels, a relevance cutoff and source exclusion fix that.
    """
    want_facts, facts, frags = facts, [], []
    try:
        # agent.py passes facts=False: every fact is already in its system message.
        facts = search_authored(user_input, top_k=4) if want_facts else []
    except Exception as e:
        print(f"\n[Yaadash authored-search error: {e}]")
    try:
        frags = search_fragments(user_input, top_k=3) if fragments else []
    except Exception as e:
        print(f"\n[Yaadash fragment-search error: {e}]")
    if not facts and not frags:
        return ""

    out, seen = "", set()
    if facts:
        out += "CONFIRMED FACTS ABOUT THE USER (ground truth — trust these):\n"
        for h in facts:
            t = (h.get("text") or "").strip()
            if t and t not in seen:
                seen.add(t)
                out += f"- {t}\n"
    if frags:
        out += ("\nPAST CHAT FRAGMENTS (his old social messages — may be years out of\n"
                "date. Use only as colour; NEVER state them as current fact):\n")
        for h in frags:
            t = " ".join((h.get("text") or "").split())[:300]
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
