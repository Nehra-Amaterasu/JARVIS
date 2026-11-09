"""The disk bank for Well Wisher's questions: data/bank/questions/<subject>/*.jsonl.

    add(subject, records, source_id)  validate, dedupe and append; returns what happened to each
    load_for(subject)                 the records the generator may serve (the one-line hook in ww_generator)
    counts(subject=None)              how many are on disk, per subject, tier and origin
    add_pointer(...)                  a reference to a question the owner owns a copy of (no text)

Two kinds of record, and the rule that keeps them apart (docs/research/question-sources.md):
  origin "cc-verbatim"  openly licensed text (MIT OCW, OpenStax, Stack Exchange). Stored with
                        source, source_url, license, ref. A record with no licence line is refused.
  origin "pointer"      a GATE paper, an NPTEL lecture, a textbook problem: year, paper, question
                        number, topic, marks, url. NEVER the question text; a record that carries any
                        is refused rather than trimmed, so a bug in a fetcher cannot leak a stem to disk.
  (origin "own-written" is allowed for questions the owner or the app writes; it needs no licence.)

Where it lives: WW_BANK_DIR if set (tests, sandboxes), else <JARVIS_DATA_DIR>/bank/questions if the
test/dev data dir is set, else the repo's data/bank/questions (git-ignored; never leaves the machine).
The _harvest/ folder beside the subjects holds the queue state and the page cache; a subject name never
starts with an underscore, so the two cannot collide.

An empty or missing folder serves [], and the generator then behaves byte for byte as before the hook.
"""
from __future__ import annotations

import hashlib
import json
import os
import re
import threading
from pathlib import Path
from typing import Any, Iterable, Optional

from . import paths  # noqa: F401  (puts core/ on sys.path so `home` imports)
import home  # noqa: E402

TIERS = ("exam", "gate")
ORIGINS = ("cc-verbatim", "pointer", "own-written")
# Licence lines the store accepts on a verbatim record. A new one is added here on purpose, after
# the licence is read from the source (question-sources.md), never inferred by a fetcher.
OPEN_LICENSES = ("CC BY-NC-SA 4.0", "CC BY-NC-SA 3.0", "CC BY-SA 4.0", "CC BY-SA 3.0", "CC BY-SA 2.5", "CC BY 4.0",
                 "CC BY-NC 4.0", "CC BY-NC-SA 2.5")
POINTER_LICENSE = "pointer-only"
MAX_TEXT = 2000                  # the same ceiling as a typed question (ww_generator.QUESTION_MAX_CHARS)
MAX_PER_SUBJECT = 20000          # a runaway fetcher stops here, not at a full disk

_SLUG = re.compile(r"^[a-z0-9][a-z0-9_-]{0,59}$")
_lock = threading.RLock()
_cache: dict[str, tuple[tuple, list[dict]]] = {}


def bank_root() -> Path:
    env = os.environ.get("WW_BANK_DIR")
    if env:
        return Path(env)
    scratch = os.environ.get("JARVIS_DATA_DIR")
    if scratch:
        return Path(scratch) / "bank" / "questions"
    return home.DATA / "bank" / "questions"


def harvest_dir() -> Path:
    return bank_root() / "_harvest"


def slug(subject: Any) -> str:
    s = str(subject or "").strip().lower()
    if not _SLUG.match(s):
        raise ValueError("subject is a short id of letters, digits, - and _ (and does not start with _)")
    return s


def norm_text(text: str) -> str:
    """The dedupe key's text: lower case, maths delimiters and punctuation dropped, whitespace
    collapsed, so the same problem from a PDF and from a web page collapses to one."""
    t = re.sub(r"\s+", " ", str(text or "").lower())
    t = re.sub(r"[^a-z0-9 ]+", "", t)
    return re.sub(r"\s+", " ", t).strip()


def text_hash(rec: dict) -> str:
    """Verbatim: the normalised text. Pointer: the reference and url (it has no text to hash)."""
    base = norm_text(rec["question"]) if rec.get("question") else norm_text(f"{rec.get('ref')} {rec.get('source_url') or ''}")
    return hashlib.sha256(base.encode("utf-8")).hexdigest()[:16]


def clean(rec: dict, subject: str, source_id: str) -> dict:
    """One record, checked and reduced to the stored fields. ValueError says what is wrong."""
    if not isinstance(rec, dict):
        raise ValueError("a record is an object")
    origin = str(rec.get("origin") or "").strip()
    if origin not in ORIGINS:
        raise ValueError(f"origin is one of {', '.join(ORIGINS)}")
    tier = str(rec.get("tier") or "exam").strip().lower()
    if tier not in TIERS:
        raise ValueError("tier is exam or gate")
    unit = rec.get("unit")
    if unit is not None and (isinstance(unit, bool) or not isinstance(unit, (int, float)) or int(unit) != unit or not 1 <= int(unit) <= 10):
        raise ValueError("unit is a whole number from 1 to 10, or empty")
    topic = re.sub(r"\s+", " ", str(rec.get("topic") or "")).strip()
    if not topic or len(topic) > 80:
        raise ValueError("topic is required, up to 80 characters")
    marks = rec.get("marks")
    if marks is None:
        marks = 2.0
    if isinstance(marks, bool) or not isinstance(marks, (int, float)) or not 0 < float(marks) <= 100 or (2 * float(marks)) % 1:
        raise ValueError("marks is a number above 0 and up to 100, in steps of 0.5")
    source = re.sub(r"\s+", " ", str(rec.get("source") or "")).strip()
    if not source or len(source) > 200:
        raise ValueError("source is required, up to 200 characters (it is the line printed under the question)")
    url = str(rec.get("source_url") or "").strip()
    if url and not re.match(r"^https?://[^\s]+$", url):
        raise ValueError("source_url must be an http(s) link")
    ref = re.sub(r"\s+", " ", str(rec.get("ref") or "")).strip()
    lic = str(rec.get("license") or "").strip()
    out = {"subject": subject, "source_id": source_id, "origin": origin, "tier": tier, "unit": int(unit) if unit is not None else None,
           "topic": topic, "marks": float(marks), "source": source, "source_url": url, "ref": ref[:120], "license": lic}
    if origin == "pointer":
        if rec.get("question"):
            raise ValueError("a pointer record never carries question text")
        if not ref:
            raise ValueError("a pointer record needs ref: year, paper and question number, or book, edition and problem")
        out["license"] = POINTER_LICENSE
    else:
        text = str(rec.get("question") or "").replace("\r\n", "\n").strip()
        if not text:
            raise ValueError("question text is required for a verbatim or own-written record")
        if len(text) > MAX_TEXT:
            raise ValueError(f"question is over {MAX_TEXT} characters")
        if re.sub(r"\\\$", "", text).count("$") % 2:
            raise ValueError("question has an unmatched $")
        out["question"] = text
        if origin == "cc-verbatim":
            if lic not in OPEN_LICENSES:
                raise ValueError("a verbatim record needs a recorded open licence line; got " + (repr(lic) if lic else "none"))
            if not url:
                raise ValueError("a verbatim record needs source_url")
        elif not lic:
            out["license"] = "own"
    out["hash"] = text_hash(out)
    out["id"] = f"h:{subject}:{out['hash']}"
    return out


def _files(subject: str) -> list[Path]:
    d = bank_root() / subject
    return sorted(d.glob("*.jsonl")) if d.is_dir() else []


def _read(path: Path) -> list[dict]:
    try:
        st = path.stat()
    except OSError:
        return []
    key = (st.st_mtime_ns, st.st_size)
    hit = _cache.get(str(path))
    if hit and hit[0] == key:
        return hit[1]
    rows = []
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line:
            continue
        try:
            r = json.loads(line)
        except ValueError:
            continue                       # a torn last line from a power cut costs one record, not the bank
        if isinstance(r, dict) and r.get("id"):
            rows.append(r)
    _cache[str(path)] = (key, rows)
    return rows


def all_records(subject: str) -> list[dict]:
    out = []
    for f in _files(slug(subject)):
        out += _read(f)
    return out


def add(subject: str, records: Iterable[dict], source_id: str) -> dict:
    """Append the valid, new records to <subject>/<source_id>.jsonl.

    Returns {"added": n, "duplicate": n, "rejected": [reason, ...]}: a rejected record is never
    stored and says why (so a fetcher's bad parse shows up in the queue, not as a bad question)."""
    subject = slug(subject)
    source_id = slug(source_id)
    added, dup, rejected = 0, 0, []
    with _lock:
        seen = {r.get("hash") for r in all_records(subject)}
        room = MAX_PER_SUBJECT - len(seen)
        fresh = []
        for rec in records:
            try:
                c = clean(rec, subject, source_id)
            except ValueError as e:
                rejected.append(str(e))
                continue
            if c["hash"] in seen:
                dup += 1
                continue
            if len(fresh) >= room:
                rejected.append(f"the subject's disk bank is full ({MAX_PER_SUBJECT} records)")
                break
            seen.add(c["hash"])
            fresh.append(c)
        if fresh:
            d = bank_root() / subject
            d.mkdir(parents=True, exist_ok=True)
            with (d / f"{source_id}.jsonl").open("a", encoding="utf-8", newline="\n") as fh:
                for c in fresh:
                    fh.write(json.dumps(c, ensure_ascii=False, sort_keys=True) + "\n")
            added = len(fresh)
    return {"added": added, "duplicate": dup, "rejected": rejected[:10]}


def add_pointer(subject: str, source_id: str, source: str, ref: str, topic: str, unit: Optional[int] = None,
                marks: float = 2.0, url: str = "", tier: str = "gate") -> dict:
    """One reference the owner can open in his own copy: 'Ogata 5th ed. 6-12', 'GATE 2024 EC Q31'."""
    return add(subject, [{"origin": "pointer", "tier": tier, "unit": unit, "topic": topic, "marks": marks, "source": source,
                          "source_url": url, "ref": ref}], source_id)


def served(rec: dict) -> dict:
    """A stored record as the generator reads it. A pointer has no stem, so the paper prints
    'Solve: <reference>' and the app never held the copyrighted text."""
    r = dict(rec)
    if r.get("origin") == "pointer":
        r["question"] = f"Solve: {r.get('ref')}"
    r["type"] = "harvested"
    r["sitting"] = r.get("source") or ""
    r.setdefault("section", "")
    return r


def load_for(subject: Any, tier: Optional[str] = None) -> list[dict]:
    """What the generator may serve for a subject: [] unless a disk bank exists for it. With a tier, only that
    tier's records: a gate-level harvest never turns up in an exam-tier (SEE-level) paper."""
    try:
        s = slug(subject)
    except ValueError:
        return []
    d = bank_root() / s
    if not d.is_dir():
        return []
    return [served(r) for r in all_records(s) if tier is None or r.get("tier", "exam") == tier]


def counts(subject: Optional[str] = None) -> dict:
    """How many records are on disk, from the files themselves (nothing is reported that is not there)."""
    root = bank_root()
    subjects = [slug(subject)] if subject else sorted(p.name for p in root.iterdir() if p.is_dir() and _SLUG.match(p.name)) if root.is_dir() else []
    per, tiers, origins = {}, {t: 0 for t in TIERS}, {o: 0 for o in ORIGINS}
    topics: dict[str, dict[str, int]] = {}
    for s in subjects:
        rows = all_records(s)
        per[s] = len(rows)
        for r in rows:
            tiers[r.get("tier") if r.get("tier") in TIERS else "exam"] += 1
            origins[r.get("origin") if r.get("origin") in ORIGINS else "own-written"] += 1
            t = topics.setdefault(s, {})
            t[r.get("topic") or ""] = t.get(r.get("topic") or "", 0) + 1
    return {"total": sum(per.values()), "subjects": per, "tiers": tiers, "origins": origins, "topics": topics}
