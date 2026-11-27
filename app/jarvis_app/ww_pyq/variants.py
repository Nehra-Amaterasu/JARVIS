"""Variants of his own questions (X07, routes R-29 to R-31; plan 9.2.5).

    make(store, question_id, count, provider, ocr_running)   numerical ones by template, descriptive ones drafted; all stored
    list_variants(store, question, subject, status)          what is stored, newest first
    decide(store, variant_id, changes)                       accept (makes one question) or reject

Two kinds, and only one of them asks a model:
- **numerical**: a question whose type is numerical gets new numbers from a ww_numericals template that fits its topic. The
  key is the template's own, computed by sympy from the drawn numbers; nothing here or in the model ever writes a key. With
  no template for the topic there is no numerical variant at all, never a model's wording with numbers in it.
- **descriptive**: the local model (ww_counsel task variant_descriptive) rewrites the question. Its answer is checked whole
  by the validator, and each draft is measured against the original by 5-word-shingle Jaccard: under 0.2 it is another
  question, over 0.7 it is the same one reworded; outside that band it is stored rejected by rule with the reason, never
  offered as pending. A descriptive variant carries no key.

Every variant keeps the original's marks, unit and topic. It becomes a question only when he accepts it, and that question
keeps `origin` ("template" or "model-draft") and `source_question` for good. With the rules-only switch on the model is never
called; numerical variants still come, because a template is a rule (ww_pyq/settings.py).

Stored as pyq/variants/<subject>.json under the store root (plan 9.2.3).
"""
from __future__ import annotations

import hashlib
import json
import re
import threading
import uuid
from datetime import datetime
from pathlib import Path
from typing import Callable, Optional

from .. import ww_counsel, ww_numericals
from . import api, drafts, families, segment, settings
from .blueprint import write_json_atomic

BAND = (0.2, 0.7)           # 5-word-shingle Jaccard against the original: below is another question, above is a copy
MAX_TEXT = 600
MAX_PER_SUBJECT = 500
TITLE = "Variants"
SOURCE_NOTE = "variants of your own questions, accepted by you"
_ID = re.compile(r"^v-[0-9a-f]{12}$")
_SUBJECT = re.compile(r"^[a-z0-9][a-z0-9_-]{0,59}$")
_STATUSES = ("pending", "accepted", "rejected")
_file_lock = threading.Lock()


def similarity(a: str, b: str) -> float:
    """5-word-shingle Jaccard of two texts after families.normalise (numbers read as one token)."""
    x, y = families.shingles(families.normalise(a)), families.shingles(families.normalise(b))
    return round(len(x & y) / len(x | y), 3) if x and y else 0.0


def in_band(sim: float) -> bool:
    return BAND[0] <= sim <= BAND[1]


def _now() -> str:
    return datetime.now().astimezone().isoformat(timespec="seconds")


def _path(store, subject: str) -> Path:
    if not _SUBJECT.match(subject or ""):
        raise KeyError("No such subject.")
    return Path(store.root) / "variants" / f"{subject}.json"


def _load(store, subject: str) -> list[dict]:
    try:
        d = json.loads(_path(store, subject).read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return []
    return [x for x in d if isinstance(x, dict)] if isinstance(d, list) else []


def _save(store, subject: str, rows: list[dict]) -> None:
    write_json_atomic(_path(store, subject), rows[-MAX_PER_SUBJECT:])


def _subjects(store) -> list[str]:
    folder = Path(store.root) / "variants"
    return sorted(p.stem for p in folder.glob("*.json") if _SUBJECT.match(p.stem)) if folder.is_dir() else []


def _is_numerical(q: dict) -> bool:
    t = q.get("type") or "unknown"
    return t == "numerical" or (t == "unknown" and segment.guess_type(q.get("text") or "") == "numerical")


def _source(store, question_id) -> tuple[dict, str]:
    """The question a variant is made from and its paper's subject. KeyError for an unknown or hostile id."""
    q = store.get_question(question_id)
    subject = str(store.get_paper(q["paper_id"]).get("subject") or "")
    return q, subject


def list_variants(store, question: Optional[str] = None, subject: Optional[str] = None, status: Optional[str] = None) -> list[dict]:
    if status not in (None, "") + _STATUSES:
        raise ValueError("status is pending, accepted or rejected.")
    names = ([subject] if _SUBJECT.match(subject) else []) if subject else _subjects(store)
    rows = [v for s in names for v in _load(store, s)]
    rows = [v for v in rows if (not question or v.get("question_id") == question) and (not status or v.get("status") == status)]
    return sorted(rows, key=lambda v: (v.get("made", ""), v.get("id", "")), reverse=True)


def _record(q: dict, subject: str, kind: str, text: str, origin: str, sim: float, status: str, **extra) -> dict:
    return {"id": f"v-{uuid.uuid4().hex[:12]}", "question_id": q["id"], "subject": subject, "kind": kind, "text": text,
            "marks": q.get("marks"), "topic": q.get("topic") or "", "unit": q.get("unit"), "origin": origin,
            "checks": {"similarity": sim, "band": list(BAND), "marks_equal": True, "topic_equal": True},
            "status": status, "made": _now(), **extra}


def _numerical(q: dict, subject: str, count: int, have: set) -> dict:
    tpls = ww_numericals.matching(q.get("topic") or "", "exam") + ww_numericals.matching(q.get("topic") or "", "gate")
    if not tpls:
        return {"state": "waiting", "items": [],
                "reason": "No numerical template fits this topic, so no numerical variant can be made; none is drafted by the model."}
    out, i = [], 0
    # seeds come from the question id, so the same question gives the same first numbers on every PC; 12 tries a variant
    # is enough to step past an item already on file (a template draws from a grid of hundreds of values)
    while len(out) < count and i < count * 12:
        tpl = tpls[i % len(tpls)]
        seed = int(hashlib.sha1(f"{q['id']}:{i}".encode()).hexdigest()[:8], 16) % 2_000_000_000
        i += 1
        item = ww_numericals.make(tpl, seed)
        if families.normalise(item["question"]) in have:
            continue
        have.add(families.normalise(item["question"]))
        out.append(_record(q, subject, "numerical", item["question"], "template", similarity(item["question"], q["text"]), "pending",
                           key=item["answer_text"], template=item["id"]))
    if not out:
        return {"state": "waiting", "items": [], "reason": "Every variant these templates give is on file already."}
    n = len(out)
    return {"state": "live", "items": out,
            "reason": f"{n} numerical {'variant' if n == 1 else 'variants'} to review, with keys computed by the template."}


def _descriptive(store, q: dict, subject: str, count: int, have: set, provider, ocr_running) -> dict:
    if settings.rules_only(store):
        return {"state": "planned", "reason": "Variants are off: rules only.", "items": []}
    if not families.shingles(families.normalise(q["text"])):
        raise ValueError("This question is under five words, so a variant cannot be measured against it.")
    if ocr_running():
        raise api.Busy("OCR is reading a paper; ask for variants when it has finished.")
    # one model job at a time in this process, shared with the drafts from notes: both fill the processor
    if not drafts._busy.acquire(blocking=False):
        raise api.Busy("The model is already drafting; wait for it.")
    try:
        if settings.rules_only(store):         # read again at the last step: he may have switched it on since the first look
            return {"state": "planned", "reason": "Variants are off: rules only.", "items": []}
        r = ww_counsel.counsel("variant_descriptive", {"topic": q.get("topic") or "not tagged", "count": count,
                                                       "marks": f"{q['marks']:g}", "stem": q["text"]},
                               provider, "given" if provider else "local")
    finally:
        drafts._busy.release()
    if r["status"] == "no_model":
        return {"state": "waiting", "reason": "The local model is not running.", "items": []}
    if r["status"] != "ok":
        return {"state": "fault", "reason": "The model answered, but not as questions; nothing was kept.", "items": []}
    out = []
    for text in r["variants"][:count]:
        norm = families.normalise(text)
        if norm in have:
            continue                                   # the same wording twice is one variant
        have.add(norm)
        sim = similarity(text, q["text"])
        v = _record(q, subject, "descriptive", text, "model-draft", sim, "pending" if in_band(sim) else "rejected", key=None, template=None)
        if not in_band(sim):
            v["reason"] = (f"Too far from the question ({sim:.2f} of shared wording, under {BAND[0]}): it is another question."
                           if sim < BAND[0] else f"Too close to the question ({sim:.2f} of shared wording, over {BAND[1]}): it is the same one reworded.")
        out.append(v)
    if not out:
        return {"state": "waiting", "reason": "The model gave no variant that is not already on file.", "items": []}
    pending = sum(1 for v in out if v["status"] == "pending")
    off = len(out) - pending
    reason = (f"{pending} {'variant' if pending == 1 else 'variants'} to review, drafted by the local model."
              + (f" {off} fell outside the similarity band and {'was' if off == 1 else 'were'} set aside." if off else ""))
    return {"state": "live", "reason": reason, "items": out}


def make(store, question_id, count=1, provider: Optional[Callable] = None,
         ocr_running: Callable[[], bool] = lambda: False) -> dict:
    """Returns {"state", "reason", "items"}: the variants made by this call, checked and stored."""
    if isinstance(count, bool) or not isinstance(count, int) or not 1 <= count <= 3:
        raise ValueError("count is 1 to 3.")
    q, subject = _source(store, question_id)
    if not str(q.get("text") or "").strip():
        raise ValueError("This question has no text; type it first.")
    if q.get("marks") is None:
        raise ValueError("This question has no marks; give its marks first.")
    if q.get("status") == "rejected":
        raise ValueError("This question was rejected; make variants of a question you kept.")
    if not _SUBJECT.match(subject):
        raise ValueError("This question's paper has no subject; give it one first.")
    with _file_lock:
        have = {families.normalise(v.get("text", "")) for v in _load(store, subject) if v.get("question_id") == q["id"]}
    have.add(families.normalise(q["text"]))
    if _is_numerical(q):
        r = _numerical(q, subject, count, have)
    else:
        r = _descriptive(store, q, subject, count, have, provider, ocr_running)
    if r["items"]:
        with _file_lock:
            rows = _load(store, subject)
            _save(store, subject, rows + r["items"])
    return r


def _template_gives(v: dict) -> bool:
    """The template drawn again from the seed in its id ("n:<template>:<seed>") gives this text and this key."""
    try:
        _, tpl, seed = str(v.get("template") or "").split(":")
        item = ww_numericals.make(tpl, int(seed))
    except Exception:                       # an unknown template or a mangled id proves nothing
        return False
    return item["question"] == v.get("text") and item["answer_text"] == v.get("key")


def _variants_paper(store, subject: str) -> str:
    for p in store.list_papers(subject):
        if p.get("kind") == "hand" and p.get("title") == TITLE and p.get("source_note") == SOURCE_NOTE:
            return p["id"]
    return store.add_paper({"kind": "hand", "method": "typed", "title": TITLE, "subject": subject, "exam_kind": "other",
                            "year": None, "pages": 0, "faults": [], "source_note": SOURCE_NOTE})


def decide(store, variant_id, changes: dict) -> dict:
    """Accept or reject one variant. Returns {"variant", "question" or None}.

    Accepting is refused when the variant is outside the similarity band (descriptive), when its marks are no longer the
    original's, or when the original is gone; a numerical variant's text cannot be edited, because its key belongs to the
    numbers the template drew."""
    if not isinstance(variant_id, str) or not _ID.match(variant_id):
        raise KeyError("No such variant.")
    if not isinstance(changes, dict) or changes.get("status") not in ("accepted", "rejected"):
        raise ValueError("status is accepted or rejected.")
    unknown = set(changes) - {"status", "text"}
    if unknown:
        raise ValueError(f"I do not know the field {sorted(unknown)[0]}.")
    with _file_lock:
        for subject in _subjects(store):
            rows = _load(store, subject)
            v = next((x for x in rows if x.get("id") == variant_id), None)
            if v is None:
                continue
            if v["status"] == "accepted":
                raise ValueError("This variant is already a question.")
            if changes["status"] == "rejected":
                v["status"] = "rejected"
                _save(store, subject, rows)
                return {"variant": v, "question": None}
            try:
                src = store.get_question(v["question_id"])
            except KeyError:
                raise ValueError("The question it came from is gone, so it cannot be checked; reject it.")
            text = changes.get("text", v["text"])
            if not isinstance(text, str) or not text.strip() or len(text) > MAX_TEXT:
                raise ValueError(f"A question is 1 to {MAX_TEXT} characters.")
            text = text.strip()
            if v["kind"] == "numerical" and text != v["text"]:
                raise ValueError("A numerical variant's numbers come from its template, so its text cannot be changed.")
            if v["kind"] == "numerical" and not _template_gives(v):
                # the key enters the bank only as the code computes it now, never as a file says it (review, 27 Nov)
                raise ValueError("Its template no longer gives this question and key; make the variant again.")
            checks = dict(v.get("checks") or {})
            checks["marks_equal"] = src.get("marks") is not None and src.get("marks") == v.get("marks")
            checks["topic_equal"] = (src.get("topic") or "") == (v.get("topic") or "")
            if v["kind"] == "descriptive":
                checks["similarity"] = similarity(text, src.get("text") or "")
                if not in_band(checks["similarity"]):
                    raise ValueError(f"Outside the similarity band {BAND[0]} to {BAND[1]} ({checks['similarity']:.2f}); "
                                     "it is not a variant of the question.")
            if not checks["marks_equal"]:
                raise ValueError("The question it came from now has other marks; make the variant again.")
            pid = _variants_paper(store, subject)
            n = len(store.list_questions(pid)) + 1
            draft = {"label": f"v{n}", "kind": "question", "text": text, "text_status": "verified", "crop": None, "page": 0,
                     "marks": v["marks"], "marks_source": "hand",
                     "type": "numerical" if v["kind"] == "numerical" else (src.get("type") or segment.guess_type(text)),
                     "section": "", "choice_group": "", "co": "", "bl": src.get("bl"), "parts": [],
                     "origin": v["origin"], "source_question": v["question_id"]}
            if v["kind"] == "numerical":
                draft.update(key=v.get("key"), template=v.get("template"))      # the template's key, kept for the check
            qid = store.add_questions(pid, [draft])[0]
            q = store.update_question(qid, {"status": "accepted", "unit": v.get("unit"), "topic": v.get("topic") or ""}, by="hand")
            v.update(status="accepted", text=text, checks=checks, accepted_as=qid, edited=text != v["text"])
            _save(store, subject, rows)
            return {"variant": v, "question": q}
    raise KeyError("No such variant.")
