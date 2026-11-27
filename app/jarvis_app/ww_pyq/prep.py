"""Preparing his question store for the loop (wave EW11, plan 9.0, the line of 28 Nov): marks, topics and acceptance.

    model_for(store, override=None)                       -> Model(mode, provider, name)  which model may be asked, if any
    ask(task, fields, model)                              -> the validated answer, or None for a failed call
    reread(store, papers, apply, busy)                    -> [row]   R-67 a paper read again with today's reader
    tag_subject(store, subject, apply, use_model, limit, model) -> dict   R-68 rule tags first, then the model's picks
    policy(store) / set_policy(store, on)                 -> {"auto_accept": bool}   R-69, off by default
    accept(store, sid) / unaccept(store, sid)             -> dict    R-70 and R-71

Why each rule is what it is (measured on his store on 28 Nov: 880 questions, all pending, 0 tagged, 66 with marks):
  * Every value written names who set it: tag_source "rule" (as R-18 writes it) or "model" with the model's name in
    `tag_model`; an acceptance by rule carries `accepted_by: "rule"` and status_by "rule". Nothing he set by hand is
    overwritten: a tag with tag_source "hand", a status he set, a text or marks he edited.
  * The model sees a question's text and the subject's own topic list and nothing else; a pick that is not one of his
    topics is dropped. Batches of 20 questions (MODEL_BATCH): about 1,300 tokens of setup per call were measured on the
    command-line model, so 20 questions a call keeps the setup under a tenth of what is sent, and one failed call loses
    at most 20 answers. A failed batch writes nothing and is counted.
  * Acceptance by rule is off until he turns it on (his rule has been that nothing enters the bank unreviewed). When on,
    it takes only questions that are safe to trust without his eye: text from a text layer (never OCR, never a picture),
    more than 40 characters (MIN_TEXT: 785 of his 880 questions pass it, the rest are headings and stubs), a paper with a
    subject, marks present, a unit and topic present.
  * Reading again replaces a paper's questions only when none of them is accepted, tagged by hand or edited by hand, and
    never when today's reader finds fewer questions with marks; the old questions are kept in one backup file a paper.
Every step is safe to call twice: a second call finds nothing left to write. With apply false each answers what it would do.
"""
from __future__ import annotations

import json
import os
import re
import shutil
import uuid
from collections import Counter
from datetime import datetime
from pathlib import Path
from typing import Any, Callable, NamedTuple, Optional

from .. import ww_counsel
from . import api, ingest, settings, tag
from .blueprint import write_json_atomic
from .store import Store

MODEL_BATCH = 20
MAX_LIMIT = 200
DEFAULT_LIMIT = 100
MIN_TEXT = 40
TEXT_METHODS = ("text-layer", "mixed")          # a mixed paper's OCR questions are told apart by their own fields below
MAX_PAPERS = 200
MAX_QUESTION_CHARS = 500                         # 20 questions of 500 characters stay inside counsel's 12,000 a field
POLICY_FILE = "prep.json"
BACKUP_DIR = "reread-backup"
SCRATCH_DIR = "reread"
_SHA = re.compile(r"^[0-9a-f]{64}$")


def _now() -> str:
    return datetime.now().isoformat(timespec="seconds")


def _plural(n: int, one: str, many: str) -> str:
    return f"{n} {one if n == 1 else many}"


# ------------------------------------------------------------------ the model
class Model(NamedTuple):
    mode: str                          # "off", "local" or "claude"
    provider: Optional[ww_counsel.Provider]
    name: str                          # written beside every value the model set, e.g. "claude-cli:haiku"


def _cli():
    """The switch of the outside model (ww_claude_cli, wave EW11 B1), or None while that module is not in this tree."""
    try:
        from .. import ww_claude_cli
    except ImportError:
        return None
    return ww_claude_cli


def _local_name() -> str:
    return f"local:{os.environ.get('JARVIS_BRAIN_MODEL') or ww_counsel.DEFAULT_MODEL}"


def model_for(store: Store, override: Optional[ww_counsel.Provider] = None) -> Model:
    """Which model may be asked. "off" (or rules only, R-35) means no call at all, even with a provider given; a test's
    provider stands in for the real one otherwise. With no switch module the local model is the default, as before."""
    cli = _cli()
    if cli is None:
        mode, provider, name = "local", None, _local_name()
    else:
        mode = cli.mode_for(store)
        provider = cli.provider_for(store) if mode == "claude" else None
        name = cli.name_for(store) or (_local_name() if mode == "local" else mode)
    if mode not in ("off", "local", "claude"):
        mode = "off"                     # an unknown answer from the switch never reads as permission to send
    if mode == "off" or settings.rules_only(store):
        return Model("off", None, name)
    return Model(mode, override if override is not None else provider, name)


def ask(task: str, fields: dict, model: Model) -> Optional[dict]:
    """The validated answer of one call, or None when the model is down, rambled or broke the shape."""
    if model.mode == "off":
        return None
    r = ww_counsel.counsel(task, fields, provider=model.provider, provider_name=model.name)
    if r.get("status") != "ok":
        return None
    return {k: v for k, v in r.items() if k not in ("engine", "version", "task", "provider", "status")}


# ------------------------------------------------------------------ R-67 read again
def _with_marks(rows: list[dict]) -> int:
    return sum(1 for q in rows if q.get("marks") is not None)


def _signature(rows: list[dict]) -> list[tuple]:
    return [(str(q.get("label") or ""), str(q.get("text") or ""), q.get("marks")) for q in rows]


def held_by_him(rows: list[dict]) -> str:
    """Why a paper's questions may not be replaced, or "" when nothing on it is his."""
    acc = sum(1 for q in rows if q.get("status") == "accepted")
    hand = sum(1 for q in rows if q.get("tag_source") == "hand")
    edited = sum(1 for q in rows if q.get("edited"))
    parts = [s for n, s in ((acc, f"{acc} accepted"), (hand, f"{hand} tagged by you"), (edited, f"{edited} edited by you")) if n]
    return ", ".join(parts)


def _original(store: Store, paper: dict) -> Optional[Path]:
    sha = str(paper.get("sha256") or "")
    if not _SHA.match(sha):
        return None
    for ext in (".pdf", ".docx", ".doc"):
        p = store.paths.originals / f"{sha}{ext}"
        if p.is_file():
            return p
    return None


def _backup(store: Store, pid: str, paper: dict, rows: list[dict]) -> str:
    """One file a paper, every earlier reading kept in it, oldest first: a second replacement never loses the first."""
    path = store.root / BACKUP_DIR / f"{pid}.json"
    try:
        old = json.loads(path.read_text(encoding="utf-8"))
        versions = old if isinstance(old, list) else []
    except (OSError, ValueError):
        versions = []
    versions.append({"saved": _now(), "paper": paper, "questions": rows})
    write_json_atomic(path, versions)
    return f"{BACKUP_DIR}/{pid}.json"


def _transplant(store: Store, pid: str, scratch: Store, sp: str) -> str:
    """The scratch reading becomes the paper's questions. The store has no public way to replace a paper's questions
    (it only appends), so its own lock and atomic write are used here; every check is repeated under that lock."""
    new = scratch.list_questions(paper_id=sp)
    smeta = scratch.get_paper(sp)
    with store._lock:
        paper = store.get_paper(pid)
        cur = store.list_questions(paper_id=pid)
        why = held_by_him(cur)
        if why:
            raise ValueError(f"Kept as it is: {why} since the reading began.")
        taken = {q["id"] for q in store.list_questions()} - {q["id"] for q in cur}
        rows = []
        for q in new:
            q = dict(q)
            old_png = ((q.get("crop") or {}).get("png") or "")
            while q["id"] in taken:                  # 48 random bits: a clash is not expected, but an id must stay unique
                q["id"] = f"q-{uuid.uuid4().hex[:12]}"
            taken.add(q["id"])
            q["paper_id"] = pid
            if q.get("crop"):
                rel = ""
                if old_png and (scratch.root / old_png).is_file():
                    rel = f"crops/{pid}/{q['id']}.png"
                    (store.root / rel).parent.mkdir(parents=True, exist_ok=True)
                    os.replace(scratch.root / old_png, store.root / rel)
                q["crop"] = {**q["crop"], "png": rel}
            rows.append(q)
        pages_from, pages_to = scratch.paths.pages / sp, store.paths.pages / pid
        if pages_from.is_dir():
            pages_to.mkdir(parents=True, exist_ok=True)
            for f in pages_from.glob("*.png"):
                os.replace(f, pages_to / f.name)
        backup = _backup(store, pid, paper, cur)
        store._save(store._qpath(pid), rows)
        store.update_paper(pid, {"faults": smeta.get("faults") or [], "total_marks": smeta.get("total_marks"),
                                 "method": smeta.get("method") or paper.get("method"), "pages": smeta.get("pages") or paper.get("pages"),
                                 "reread_at": _now()})
    return backup


def _reread_one(store: Store, pid: str, apply: bool) -> dict:
    paper = store.get_paper(pid)
    before = store.list_questions(paper_id=pid)
    row = {"paper": pid, "title": paper.get("title") or "", "questions_before": len(before), "marks_before": _with_marks(before),
           "questions_after": None, "marks_after": None, "changed": False, "reason": "", "backup": ""}
    if paper.get("kind") == "pptx":
        row["reason"] = "A slide deck prints no marks; nothing to read again."
        return row
    if paper.get("method") in ("ocr", "mixed"):
        # today's text reader would drop the pages OCR read, and their questions with them
        row["reason"] = "Some pages were read by OCR; read it again with OCR instead."
        return row
    orig = _original(store, paper)
    if orig is None:
        row["reason"] = "The original is not on file, so there is nothing to read again."
        return row
    scratch_root = store.root / SCRATCH_DIR / uuid.uuid4().hex[:12]
    try:
        scratch = Store(scratch_root)
        title = paper.get("title")
        meta = {"title": title} if isinstance(title, str) and title.strip() and len(title) <= 200 else None
        try:
            res = ingest.ingest_file(orig, store=scratch, meta=meta)
        except Exception as e:                       # one paper that does not read never stops the others
            row["reason"] = (str(e) if isinstance(e, ValueError) else f"Could not be read ({type(e).__name__}).")[:200]
            return row
        sp = res["paper"]["id"]
        after = scratch.list_questions(paper_id=sp)
        row.update(questions_after=len(after), marks_after=_with_marks(after))
        why = held_by_him(before)
        if row["marks_after"] < row["marks_before"]:
            row["reason"] = (f"Today's reader finds fewer questions with marks ({row['marks_after']} against "
                             f"{row['marks_before']}); nothing changed.")
        elif _signature(after) == _signature(before):
            row["reason"] = "Today's reader gives the same questions and marks; nothing to change."
        elif why:
            row["reason"] = f"Kept as it is: {why}."
        elif not apply:
            row["changed"] = True
            row["reason"] = (f"Reading again would give {_plural(len(after), 'question', 'questions')}, "
                             f"{row['marks_after']} with marks; nothing was written.")
        else:
            try:
                row["backup"] = _transplant(store, pid, scratch, sp)
            except ValueError as e:
                row["reason"] = str(e)
                return row
            row["changed"] = True
            row["reason"] = (f"Replaced: {_plural(len(after), 'question', 'questions')}, {row['marks_after']} with marks; "
                             f"the old ones are kept in {row['backup']}.")
        return row
    finally:
        shutil.rmtree(scratch_root, ignore_errors=True)


def reread(store: Store, papers: Optional[list], apply: bool, busy: Callable[[], bool] = lambda: False) -> list[dict]:
    """R-67. Busy (409) while the paper desk or OCR reads, checked before the first paper and before each next one."""
    if not isinstance(apply, bool):
        raise ValueError("Apply is true or false.")
    if papers is None:
        ids = [p["id"] for p in store.list_papers() if p.get("kind") != "pptx"]
    else:
        if not isinstance(papers, list) or not papers or len(papers) > MAX_PAPERS or not all(isinstance(i, str) for i in papers):
            raise ValueError(f"Give up to {MAX_PAPERS} paper ids.")
        ids = list(dict.fromkeys(papers))
        for i in ids:
            store.get_paper(i)                       # an unknown or hostile id is 404 before anything is read
    if busy():
        raise api.Busy("The paper desk is reading files; read again when it has finished.")
    rows = []
    for k, pid in enumerate(ids):
        if k and busy():
            rows.extend({"paper": i, "title": "", "questions_before": None, "questions_after": None, "marks_before": None,
                         "marks_after": None, "changed": False, "backup": "",
                         "reason": "The paper desk started reading; stopped before this paper."} for i in ids[k:])
            break
        rows.append(_reread_one(store, pid, apply))
    return rows


# ------------------------------------------------------------------ R-68 topics
def _one_line(text: str) -> str:
    return re.sub(r"\s+", " ", str(text or "")).strip()[:MAX_QUESTION_CHARS]


def _topic_lines(topics: list[dict]) -> tuple[str, dict]:
    ids = {f"T{i + 1}": t for i, t in enumerate(topics)}
    return "\n".join(f"{k}: unit {t['unit']}, {t['topic']}" for k, t in ids.items()), ids


def tag_subject(store: Store, subject: dict, *, apply: bool, use_model: bool, limit: int, model: Model) -> dict:
    """R-68. The rule tagger of R-18 first (tag.tag_question, written the way R-18 writes it), then the model for what the
    rule left, in batches of MODEL_BATCH, at most `limit` questions a call. Counts: rule and model are what this call wrote
    (or would write), none what the model answered "none" for or picked outside his topics, left what is still untagged."""
    if not isinstance(apply, bool) or not isinstance(use_model, bool):
        raise ValueError("Apply and use_model are true or false.")
    if isinstance(limit, bool) or not isinstance(limit, int) or not 1 <= limit <= MAX_LIMIT:
        raise ValueError(f"The limit is between 1 and {MAX_LIMIT}.")
    sid = str(subject["id"]).lower()
    topics = tag.topics_of(subject)
    out = {"rule": 0, "model": 0, "none": 0, "left": 0, "dropped": 0, "failed_batches": 0, "held_by_hand": 0,
           "no_text": 0, "model_name": "", "asked": 0}
    if not topics:
        return {**out, "state": "waiting", "reason": "This subject has no syllabus topics yet."}
    rows = [q for q in store.list_questions(subject=sid) if q.get("status") != "rejected"]
    out["held_by_hand"] = sum(1 for q in rows if q.get("tag_source") == "hand")
    open_ = [q for q in rows if q.get("tag_source") not in ("hand", "rule", "model")]
    out["no_text"] = sum(1 for q in open_ if not str(q.get("text") or "").strip())
    open_ = [q for q in open_ if str(q.get("text") or "").strip()]
    remaining = []
    for q in open_:
        r = tag.tag_question(q, topics)
        if r["tag_source"] != "rule":
            remaining.append(q)
            continue
        out["rule"] += 1
        if apply:
            store.update_question(q["id"], {"unit": r["unit"], "topic": r["topic"], "tag_source": "rule",
                                            "tag_score": r["score"], "tag_margin": r["margin"]}, "rule")
    answered: set[str] = set()
    if use_model and model.mode != "off" and remaining:
        out["model_name"] = model.name
        lines, by_id = _topic_lines(topics)
        send = remaining[:limit]
        for i in range(0, len(send), MODEL_BATCH):
            batch = send[i:i + MODEL_BATCH]
            qmap = {f"Q{j + 1}": q for j, q in enumerate(batch)}
            fields = {"subject": str(subject.get("name") or sid), "topics": lines,
                      "questions": "\n".join(f"{k}: {_one_line(q['text'])}" for k, q in qmap.items()),
                      "question_ids": ",".join(qmap), "topic_ids": ",".join(by_id)}
            out["asked"] += len(batch)
            ans = ask("tag_topics", fields, model)
            if ans is None:
                out["failed_batches"] += 1             # its questions stay as they were and count as left
                continue
            fresh = {q["id"]: q for q in store.list_questions(subject=sid)} if apply else {}
            for t in ans["tags"]:
                q = qmap[t["q"]]
                answered.add(q["id"])
                if t["topic"] == "none" or not t["topic"]:
                    out["none"] += 1
                    out["dropped"] += 0 if t["topic"] == "none" else 1
                    continue
                pick = by_id[t["topic"]]
                if apply:
                    now = fresh.get(q["id"])
                    if now is None or now.get("tag_source") in ("hand", "rule", "model"):
                        continue                     # he (or another call) tagged it while the model was thinking
                    store.update_question(q["id"], {"unit": pick["unit"], "topic": pick["topic"], "tag_source": "model",
                                                    "tag_model": model.name, "tag_score": None, "tag_margin": None}, "rule")
                out["model"] += 1
    out["left"] = sum(1 for q in remaining if q["id"] not in answered)
    did = "Tagged" if apply else "Would tag"
    reason = (f"{did} {out['rule']} by rule and {out['model']} by the model; {out['none']} fit none of the topics, "
              f"{out['left']} {'is' if out['left'] == 1 else 'are'} still without a topic.")
    if out["failed_batches"]:
        reason += f" {_plural(out['failed_batches'], 'batch', 'batches')} of the model failed and changed nothing."
    if use_model and model.mode == "off":
        reason += " The model is off, so only the rule was used."
    return {**out, "state": "live", "reason": reason}


# ------------------------------------------------------------------ R-69 to R-71 acceptance
def _policy_path(store: Store) -> Path:
    return Path(store.root) / POLICY_FILE


def policy(store: Store) -> dict:
    try:
        d = json.loads(_policy_path(store).read_text(encoding="utf-8"))
    except (OSError, ValueError):
        d = {}
    return {"auto_accept": isinstance(d, dict) and d.get("auto_accept") is True}


def set_policy(store: Store, on: Any) -> dict:
    if not isinstance(on, bool):
        raise ValueError("auto_accept is true or false.")
    with store._lock:
        write_json_atomic(_policy_path(store), {"auto_accept": on})
    return policy(store)


def why_not_trusted(q: dict, paper: dict) -> str:
    """"" when the question is safe to accept without his eye, else the first reason it is not (R-70)."""
    if q.get("status") != "pending":
        return "not pending"
    if paper.get("method") not in TEXT_METHODS or q.get("kind", "question") != "question" or q.get("origin", "paper") != "paper":
        return "not from a text layer"
    if q.get("text_status") != "verified" or q.get("ocr_confidence") is not None:
        return "not from a text layer"                # OCR text stays "unverified"; a picture-only question has "none"
    if len(str(q.get("text") or "").strip()) <= MIN_TEXT:
        return f"{MIN_TEXT} characters or fewer"
    if not paper.get("subject"):
        return "no subject"
    if q.get("marks") is None:
        return "no marks"
    if q.get("unit") is None or not str(q.get("topic") or "").strip():
        return "no unit and topic"
    return ""


def accept(store: Store, sid: str) -> dict:
    """R-70: only when the policy is on; each question written with accepted_by "rule" and status_by "rule"."""
    if not policy(store)["auto_accept"]:
        return {"accepted": 0, "held": {}, "on": False}
    papers = {p["id"]: p for p in store.list_papers(sid)}
    ids, held = [], Counter()
    for q in store.list_questions(subject=sid):
        why = why_not_trusted(q, papers[q["paper_id"]])
        if why:
            if why != "not pending":
                held[why] += 1
            continue
        ids.append(q["id"])
    if ids:
        store.update_questions(ids, {"status": "accepted", "accepted_by": "rule"}, "rule")
    return {"accepted": len(ids), "held": dict(held), "on": True}


def unaccept(store: Store, sid: str) -> dict:
    """R-71: every question accepted by the rule goes back to pending. One he accepted himself (status_by "hand", even
    after the rule had accepted it once) is not touched."""
    ids = [q["id"] for q in store.list_questions(subject=sid, status="accepted")
           if q.get("accepted_by") == "rule" and q.get("status_by") == "rule"]
    if ids:
        store.update_questions(ids, {"status": "pending", "accepted_by": ""}, "rule")
    return {"returned": len(ids)}
