"""Questions the local model drafts from his own notes (plan 9.0, 25 Nov 2026; routes R-50 to R-52).

    passages(notes, topic, unit_title, limit)     the parts of his notes that mention the topic, and which notes they came from
    draft_from_notes(store, ...)                  asks the model, checks every draft, stores them pending
    list_drafts(store, subject, status)           what is stored
    decide(store, draft_id, changes)              accept (makes one question) or reject

The model drafts and nothing more. It is asked for questions on passages of his own notes; what comes back is checked
(ww_counsel validates the shape and refuses an answer, a grade or a number of marks it made up) and stored as PENDING.
A draft becomes a question only when he accepts it and it has marks, and it keeps origin "model-draft" for good, so every
screen can say who wrote it. A draft whose words stand in the notes already (0.7 or more of its 5-word runs) is not a new
question but a copy: it is stored rejected with that reason. The order of topics is not the model's: that is R-17, counted.

One drafting at a time in this process, and none while OCR reads: both use the processor fully.
"""
from __future__ import annotations

import json
import re
import threading
import uuid
from datetime import datetime
from pathlib import Path
from typing import Callable, Optional

from .. import ww_counsel
from . import api, families, segment, settings
from .blueprint import write_json_atomic

MAX_PASSAGE = 6000          # characters of notes given to the model: about 1,500 tokens, well inside a 4B model's window
MAX_TEXT = 600              # a draft is one question, not an essay
COPY_AT = 0.7               # share of a draft's 5-word runs found in the notes at which it is a copy
MAX_PER_SUBJECT = 500
DRAFTS_TITLE = "Drafts"
SOURCE_NOTE = "drafted by the local model, accepted by you"
_ID = re.compile(r"^d-[0-9a-f]{12}$")
_SUBJECT = re.compile(r"^[a-z0-9][a-z0-9_-]{0,59}$")
_STOP = {"the", "and", "for", "with", "from", "that", "this", "are", "was", "its", "into", "using", "use", "of", "to", "in", "on", "a", "an"}
_busy = threading.Lock()
_file_lock = threading.Lock()


def _words(text: str) -> list[str]:
    return [w[:7] for w in re.findall(r"[a-z][a-z0-9]{2,}", str(text).lower()) if w not in _STOP]


def passages(notes: list[dict], topic: str, unit_title: str = "", limit: int = MAX_PASSAGE) -> tuple[str, list[dict]]:
    """The paragraphs of his notes that mention the topic, best first, up to `limit` characters, with the notes they came
    from. A paragraph counts when it holds at least half of the topic's words (all of them for a topic of one or two)."""
    want = set(_words(topic))
    if not want:
        return "", []
    need = len(want) if len(want) <= 2 else (len(want) + 1) // 2
    extra = set(_words(unit_title)) - want
    found = []
    for n in notes:
        for para in re.split(r"\n\s*\n", str(n.get("text") or "")):
            para = " ".join(para.split())
            if len(para) < 60 or para.startswith(("---", "#", ">")):
                continue
            have = set(_words(para))
            hits = len(want & have)
            if hits >= need:
                found.append((-(hits * 10 + len(extra & have)), len(found), para[:1500], n))
    found.sort(key=lambda f: f[:2])
    out, sources, used = [], [], 0
    for _, _, para, n in found:
        if used + len(para) > limit:
            continue
        out.append(para)
        used += len(para) + 2
        if not any(s["file_id"] == n.get("file_id") for s in sources):
            sources.append({"file_id": n.get("file_id", ""), "title": str(n.get("title") or "")[:200]})
    return "\n\n".join(out), sources


def _path(store, subject: str) -> Path:
    if not _SUBJECT.match(subject or ""):
        raise KeyError("No such subject.")
    return Path(store.root) / "drafts" / f"{subject}.json"


def _load(store, subject: str) -> list[dict]:
    try:
        d = json.loads(_path(store, subject).read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return []
    return [x for x in d if isinstance(x, dict)] if isinstance(d, list) else []


def _save(store, subject: str, rows: list[dict]) -> None:
    p = _path(store, subject)
    p.parent.mkdir(parents=True, exist_ok=True)
    write_json_atomic(p, rows[-MAX_PER_SUBJECT:])


def list_drafts(store, subject: Optional[str] = None, status: Optional[str] = None) -> list[dict]:
    if status not in (None, "", "pending", "accepted", "rejected"):
        raise ValueError("status is pending, accepted or rejected.")
    folder = Path(store.root) / "drafts"
    names = [subject] if subject else sorted(p.stem for p in folder.glob("*.json")) if folder.is_dir() else []
    rows = [d for s in names if _SUBJECT.match(s or "") for d in _load(store, s)]
    rows = [d for d in rows if not status or d.get("status") == status]
    return sorted(rows, key=lambda d: d.get("made", ""), reverse=True)


def copied(text: str, passage: str) -> float:
    """The share of the draft's 5-word runs that stand in the notes: 1.0 is a sentence lifted whole."""
    a = families.shingles(families.normalise(text))
    if not a:
        return 0.0
    return round(len(a & families.shingles(families.normalise(passage))) / len(a), 3)


def draft_from_notes(store, *, subject: str, topic: str, unit: Optional[int], unit_title: str = "", count: int = 3,
                     marks: Optional[float] = None, notes: list[dict], provider: Optional[Callable] = None,
                     ocr_running: Callable[[], bool] = lambda: False) -> dict:
    """Returns {"state", "reason", "items"}: the drafts made by this call, checked and stored."""
    if isinstance(count, bool) or not isinstance(count, int) or not 1 <= count <= 5:
        raise ValueError("count is 1 to 5.")
    if marks is not None and (isinstance(marks, bool) or not isinstance(marks, (int, float)) or not 0 < marks <= 100):
        raise ValueError("marks is a number up to 100.")
    if settings.rules_only(store):
        return {"state": "planned", "reason": "Drafting is off: rules only.", "items": []}
    text, sources = passages(notes, topic, unit_title)
    if not text:
        return {"state": "waiting", "reason": "No note of this subject mentions this topic.", "items": []}
    if ocr_running():
        raise api.Busy("OCR is reading a paper; draft when it has finished.")
    if not _busy.acquire(blocking=False):
        raise api.Busy("The model is already drafting; wait for it.")
    try:
        r = ww_counsel.counsel("question_drafts", {"topic": topic, "count": count, "marks": f"{marks:g}" if marks else "not given",
                                                   "passages": text}, provider, "given" if provider else "local")
    finally:
        _busy.release()
    if r["status"] == "no_model":
        return {"state": "waiting", "reason": "The local model is not running.", "items": []}
    if r["status"] != "ok":
        return {"state": "fault", "reason": "The model answered, but not as questions; nothing was kept.", "items": []}
    made = []
    now = datetime.now().astimezone().isoformat(timespec="seconds")
    with _file_lock:
        rows = _load(store, subject)
        have = {families.normalise(d.get("text", "")) for d in rows}
        for q in r["questions"][:count]:
            norm = families.normalise(q)
            if norm in have:
                continue                                   # the same draft twice is one draft
            have.add(norm)
            sim = copied(q, text)
            d = {"id": f"d-{uuid.uuid4().hex[:12]}", "subject": subject, "unit": unit, "topic": topic, "text": q, "marks": marks,
                 "status": "rejected" if sim >= COPY_AT else "pending", "origin": "model-draft", "sources": sources,
                 "checks": {"copied": sim >= COPY_AT, "similarity": sim}, "made": now}
            if sim >= COPY_AT:
                d["reason"] = f"A copy of the notes ({sim:.2f} of its wording stands there), not a new question."
            rows.append(d)
            made.append(d)
        _save(store, subject, rows)
    pending = sum(1 for d in made if d["status"] == "pending")
    if not made:
        return {"state": "waiting", "reason": "The model gave no question that is not already drafted.", "items": []}
    reason = (f"{pending} {'draft' if pending == 1 else 'drafts'} to review, written from {len(sources)} of your notes."
              + (f" {len(made) - pending} copied the notes and {'was' if len(made) - pending == 1 else 'were'} set aside." if pending < len(made) else ""))
    return {"state": "live", "reason": reason, "items": made}


def _drafts_paper(store, subject: str) -> str:
    for p in store.list_papers(subject):
        if p.get("kind") == "hand" and p.get("title") == DRAFTS_TITLE and p.get("source_note") == SOURCE_NOTE:
            return p["id"]
    return store.add_paper({"kind": "hand", "method": "typed", "title": DRAFTS_TITLE, "subject": subject, "exam_kind": "other",
                            "year": None, "pages": 0, "faults": [], "source_note": SOURCE_NOTE})


def decide(store, draft_id: str, changes: dict, topic_ok: Callable[[Optional[int], str], bool] = lambda u, t: True) -> dict:
    """Accept or reject one draft. Accepting needs marks and makes one accepted question that says it was drafted by the
    model; a rejected draft stays on file as rejected. Returns {"draft", "question" or None}."""
    if not _ID.match(str(draft_id)):
        raise KeyError("No such draft.")
    if not isinstance(changes, dict) or changes.get("status") not in ("accepted", "rejected"):
        raise ValueError("status is accepted or rejected.")
    unknown = set(changes) - {"status", "text", "marks", "unit", "topic"}
    if unknown:
        raise ValueError(f"I do not know the field {sorted(unknown)[0]}.")
    with _file_lock:
        for subject in sorted(p.stem for p in (Path(store.root) / "drafts").glob("*.json")):
            rows = _load(store, subject)
            d = next((x for x in rows if x.get("id") == draft_id), None)
            if d is None:
                continue
            if d["status"] == "accepted":
                raise ValueError("This draft is already a question.")
            if changes["status"] == "rejected":
                d["status"] = "rejected"
                _save(store, subject, rows)
                return {"draft": d, "question": None}
            text = changes.get("text", d["text"])
            if not isinstance(text, str) or not text.strip() or len(text) > MAX_TEXT:
                raise ValueError(f"A question is 1 to {MAX_TEXT} characters.")
            marks = changes.get("marks", d.get("marks"))
            if marks is None or isinstance(marks, bool) or not isinstance(marks, (int, float)) or not 0 < marks <= 100:
                raise ValueError("Give its marks first.")
            unit, topic = changes.get("unit", d.get("unit")), changes.get("topic", d.get("topic"))
            if not topic_ok(unit, str(topic or "")):
                raise ValueError("That topic is not in the syllabus of this subject.")
            pid = _drafts_paper(store, subject)
            n = len(store.list_questions(pid)) + 1
            qid = store.add_questions(pid, [{"label": f"d{n}", "kind": "question", "text": text.strip(), "text_status": "verified",
                                             "crop": None, "page": 0, "marks": marks, "marks_source": "hand",
                                             "type": segment.guess_type(text), "section": "", "choice_group": "", "co": "", "bl": None,
                                             "parts": [], "origin": "model-draft", "source_question": ""}])[0]
            q = store.update_question(qid, {"status": "accepted", "unit": unit, "topic": topic}, by="hand")
            d.update(status="accepted", text=text.strip(), marks=marks, unit=unit, topic=topic, question_id=qid,
                     edited=text.strip() != d["text"])
            _save(store, subject, rows)
            return {"draft": d, "question": q}
    raise KeyError("No such draft.")
