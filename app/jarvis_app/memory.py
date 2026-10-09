"""Yaadash in the app: search, the beliefs JARVIS wants confirmed, people, taste.

Thin, read-mostly wrappers over the brain/yaadash_* modules. They load lazily (the
embedding model takes a few seconds the first time) and run in a worker thread
so a search never freezes the window.

Privacy: this module reads the archive of real conversations — both sides. It is
served only over the token-protected 127.0.0.1 server and nothing is cached
outside the existing gitignored brain/yaadash_data/.
"""
from __future__ import annotations

import json
import math
import re
import time
from typing import Any

from .paths import BRAIN, ensure_brain_importable

DATA = BRAIN / "yaadash_data"
_HEADER = re.compile(r"^\[(?P<date>[^\]]+?) - chat with (?P<who>[^\]]+)\]$")


def _clean(v: Any) -> Any:
    """numpy / pandas values -> plain JSON values."""
    if hasattr(v, "item"):
        v = v.item()
    if isinstance(v, float) and (math.isnan(v) or math.isinf(v)):
        return None
    if isinstance(v, (list, tuple)):
        return [_clean(x) for x in v]
    if isinstance(v, dict):
        return {k: _clean(x) for k, x in v.items()}
    return v


def _rows(path) -> int | None:
    try:
        import pyarrow.parquet as pq
        return pq.ParquetFile(str(path)).metadata.num_rows
    except Exception:
        return None


def _lance():
    """Open the memory database directly: counting rows must not load the
    embedding model (importing yaadash_v2 does, which made this take 16 s)."""
    import lancedb
    return lancedb.connect(str(BRAIN / "lancedb"))


def _columns(tbl, cols: list[str]):
    return tbl.to_arrow().select(cols).to_pandas()


def stats() -> dict:
    out: dict = {"archive_messages": _rows(DATA / "archive_msgs.parquet"),
                 "threads": _rows(DATA / "threads.parquet")}
    try:
        import pandas as pd
        p = pd.read_parquet(DATA / "people.parquet")
        out["people"] = int(len(p))
        out["people_scored"] = int(p.closeness.notna().sum())
    except Exception:
        out["people"] = out["people_scored"] = None
    try:
        tbl = _lance().open_table("memories")
        out["memories"] = int(tbl.count_rows())
        src = _columns(tbl, ["source"])["source"].str.split(":").str[0].value_counts()
        out["memory_sources"] = {str(k): int(v) for k, v in src.items()}
    except Exception as e:
        out["memories"] = None
        out["memories_error"] = str(e)
    try:
        tbl = _lance().open_table("beliefs")
        if tbl.count_rows():
            df = _columns(tbl, ["status", "category"])
            out["beliefs"] = {str(k): int(v) for k, v in df.status.value_counts().items()}
            out["belief_categories"] = {str(k): int(v) for k, v in df.category.value_counts().items()}
        else:
            out["beliefs"] = {}
    except Exception:
        out["beliefs"] = None
    try:
        t = json.loads((DATA / "taste_profile.json").read_text(encoding="utf-8"))
        out["taste_topics"] = len(t.get("topics", []))
        out["taste_captions"] = t.get("n_captions")
    except Exception:
        out["taste_topics"] = None
    return out


def _parse_excerpt(text: str) -> dict:
    lines = text.splitlines()
    head = _HEADER.match(lines[0].strip()) if lines else None
    msgs = []
    for ln in lines[1:]:
        speaker, _, said = ln.partition(": ")
        msgs.append({"speaker": speaker, "text": said, "me": speaker == "Aman"})
    return {"date": head["date"] if head else None, "who": head["who"] if head else None,
            "messages": msgs}


def search(q: str, k: int = 4) -> dict:
    """Hybrid search: dated conversation excerpts + facts from the memory store."""
    ensure_brain_importable()
    t0 = time.time()
    out: dict = {"query": q, "excerpts": [], "facts": []}
    try:
        import yaadash_recall as yr
        out["excerpts"] = [_parse_excerpt(e) for e in yr.recall(q, k=k)]
    except Exception as e:
        out["excerpts_error"] = str(e)
    try:
        import yaadash_v2 as y
        for r in y.search(q, top_k=6):
            d = r.get("_distance")
            out["facts"].append({"text": r.get("text"), "source": r.get("source"),
                                 "distance": round(float(d), 3) if d is not None else None,
                                 "created": str(r.get("created_at") or r.get("timestamp") or "")})
    except Exception as e:
        out["facts_error"] = str(e)
    out["took_ms"] = round((time.time() - t0) * 1000)
    return _clean(out)


def questions(n: int = 6) -> list[dict]:
    ensure_brain_importable()
    import yaadash_beliefs as yb
    keep = ("id", "claim", "category", "era", "confidence", "support", "source", "evidence", "status")
    return [_clean({k: q.get(k) for k in keep if k != "vector"}) for q in yb.next_questions(n)]


def answer(belief_id: str, verdict: str, correction: str | None = None) -> bool:
    if verdict not in ("confirmed", "rejected", "outdated"):
        raise ValueError("verdict must be confirmed | rejected | outdated")
    ensure_brain_importable()
    import yaadash_beliefs as yb
    return bool(yb.record(belief_id, verdict, correction or None))


def beliefs(status: str = "confirmed", limit: int = 40) -> list[dict]:
    tbl = _lance().open_table("beliefs")
    if not tbl.count_rows():
        return []
    df = _columns(tbl, ["id", "claim", "category", "era", "confidence", "support",
                        "status", "updated"])
    df = df[df.status == status].sort_values(["support", "confidence"], ascending=False).head(limit)
    return [_clean(r) for r in df.to_dict("records")]


def people(limit: int = 30) -> list[dict]:
    import pandas as pd
    p = pd.read_parquet(DATA / "people.parquet")
    p = p[p.closeness.notna()].sort_values("closeness", ascending=False).head(limit)
    keep = ["name", "closeness", "rank", "span_days", "n_msgs", "n_me", "n_them", "reciprocity",
            "share_ratio", "calls", "call_min", "voice_notes", "recency_days", "first_iso",
            "last_iso", "why"]
    return [_clean({k: r.get(k) for k in keep}) for r in p.to_dict("records")]


def taste() -> dict:
    try:
        t = json.loads((DATA / "taste_profile.json").read_text(encoding="utf-8"))
    except FileNotFoundError:
        return {"topics": []}
    topics = sorted(t.get("topics", []), key=lambda x: -x.get("share", 0))
    return {"built": t.get("built"), "n_captions": t.get("n_captions"),
            "recent_from": t.get("recent_from"),
            "topics": [{k: x.get(k) for k in ("label", "words", "share", "share_recent",
                                               "share_before", "trend", "by_year")} for x in topics]}
