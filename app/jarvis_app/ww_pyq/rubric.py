"""Rubric points of one question (X07, routes R-32 to R-34; plan 9.2.5).

    draft(store, question_id, provider, ocr_running)   the local model splits the marks into points; stored pending
    get(store, question_id)                            the rubric on file, or None
    put(store, question_id, points)                    his rubric: accepted, origin "hand" when he wrote or changed it

A rubric point is a draft like any other: the model proposes, he accepts. The model's points are checked by the validator
(ww_counsel task rubric_points: no answer, no grade, no forecast word, 1 to 6 points, each with marks no larger than the
question's). Points that do not add up to the question's marks are kept pending with the difference printed, because a split
he fixes by hand is still worth reading; only PUT can make a rubric accepted, and PUT refuses points that do not add up.
A rubric he accepted is never replaced by a new draft.

Stored as pyq/rubrics/<question id>.json under the store root (plan 9.2.3); the id reaches the path only after the store
has found the question, so a hostile id is a 404 and never a path.
"""
from __future__ import annotations

import json
import threading
from datetime import datetime
from pathlib import Path
from typing import Callable, Optional

from .. import ww_counsel
from . import api, drafts, settings
from .blueprint import write_json_atomic

MAX_POINTS = 6
MAX_POINT_TEXT = 300
_EPS = 1e-6                  # marks are halves at the finest; a float sum within this is equal
_file_lock = threading.Lock()


def _now() -> str:
    return datetime.now().astimezone().isoformat(timespec="seconds")


def _question(store, question_id) -> dict:
    q = store.get_question(question_id)                 # KeyError (404) for an unknown or hostile id
    return q


def _path(store, qid: str) -> Path:
    return Path(store.root) / "rubrics" / f"{qid}.json"


def _load(store, qid: str) -> Optional[dict]:
    try:
        d = json.loads(_path(store, qid).read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None
    return d if isinstance(d, dict) and isinstance(d.get("points"), list) else None


def _sum(points: list[dict]) -> float:
    return round(sum(float(p["marks"]) for p in points), 2)


def _record(q: dict, points: list[dict], origin: str, status: str, made: Optional[str] = None) -> dict:
    total = _sum(points)
    return {"question_id": q["id"], "points": points, "origin": origin, "status": status, "sum": total,
            "marks": q.get("marks"), "difference": round(total - float(q["marks"]), 2), "made": made or _now(), "updated": _now()}


def get(store, question_id) -> Optional[dict]:
    q = _question(store, question_id)
    with _file_lock:
        r = _load(store, q["id"])
    if r is not None and q.get("marks") is not None:
        r["marks"] = q["marks"]
        r["difference"] = round(float(r.get("sum") or 0) - float(q["marks"]), 2)     # his marks may have changed since
    return r


def draft(store, question_id, provider: Optional[Callable] = None, ocr_running: Callable[[], bool] = lambda: False) -> dict:
    """Returns {"state", "reason", "rubric" or None}."""
    q = _question(store, question_id)
    if q.get("marks") is None:
        raise ValueError("This question has no marks; give its marks first.")
    if not str(q.get("text") or "").strip():
        raise ValueError("This question has no text; type it first.")
    with _file_lock:
        old = _load(store, q["id"])
    if old is not None and old.get("status") == "accepted":
        raise ValueError("This question has a rubric you accepted; change it by hand.")
    if settings.rules_only(store):
        return {"state": "planned", "reason": "Rubric drafts are off: rules only.", "rubric": None}
    if ocr_running():
        raise api.Busy("OCR is reading a paper; draft the rubric when it has finished.")
    if not drafts._busy.acquire(blocking=False):            # one model job at a time, shared with the other drafts
        raise api.Busy("The model is already drafting; wait for it.")
    try:
        if settings.rules_only(store):         # read again at the last step: he may have switched it on since the first look
            return {"state": "planned", "reason": "Rubric drafts are off: rules only.", "rubric": None}
        r = ww_counsel.counsel("rubric_points", {"marks": f"{q['marks']:g}", "stem": q["text"]}, provider,
                               "given" if provider else "local")
    finally:
        drafts._busy.release()
    if r["status"] == "no_model":
        return {"state": "waiting", "reason": "The local model is not running.", "rubric": None}
    if r["status"] != "ok":
        return {"state": "fault", "reason": "The model answered, but not as rubric points; nothing was kept.", "rubric": None}
    rec = _record(q, r["points"], "model-draft", "pending")
    with _file_lock:
        write_json_atomic(_path(store, q["id"]), rec)
    n = len(rec["points"])
    if abs(rec["difference"]) > _EPS:
        reason = (f"{n} {'point' if n == 1 else 'points'} drafted by the local model; they add up to {rec['sum']:g}, "
                  f"not {q['marks']:g}, so change them before you accept.")
    else:
        reason = f"{n} {'point' if n == 1 else 'points'} drafted by the local model, adding up to {q['marks']:g}; waiting for you."
    return {"state": "live", "reason": reason, "rubric": rec}


def _clean(points) -> list[dict]:
    if not isinstance(points, list) or not 1 <= len(points) <= MAX_POINTS:
        raise ValueError(f"A rubric is 1 to {MAX_POINTS} points.")
    out = []
    for p in points:
        if not isinstance(p, dict) or set(p) - {"text", "marks"}:
            raise ValueError("A point is {text, marks}.")
        text, marks = p.get("text"), p.get("marks")
        if not isinstance(text, str) or not text.strip() or len(text) > MAX_POINT_TEXT:
            raise ValueError(f"A point's text is 1 to {MAX_POINT_TEXT} characters.")
        if isinstance(marks, bool) or not isinstance(marks, (int, float)) or not 0 < marks <= 100:
            raise ValueError("A point's marks are a number above 0.")
        out.append({"text": " ".join(text.split()), "marks": round(float(marks), 2)})
    return out


def put(store, question_id, points) -> dict:
    """His rubric, accepted. Origin stays "model-draft" only when he accepted the model's points exactly as drafted."""
    q = _question(store, question_id)
    if q.get("marks") is None:
        raise ValueError("This question has no marks; give its marks first.")
    pts = _clean(points)
    total = _sum(pts)
    if abs(total - float(q["marks"])) > _EPS:
        raise ValueError(f"The points add up to {total:g}, not the question's {q['marks']:g} marks.")
    with _file_lock:
        old = _load(store, q["id"])
        same = old is not None and old.get("origin") == "model-draft" and old.get("points") == pts
        rec = _record(q, pts, "model-draft" if same else "hand", "accepted", made=(old or {}).get("made"))
        write_json_atomic(_path(store, q["id"]), rec)
    return rec
