"""Preparing his question store for the loop (wave EW11, plan 9.0, the two lines of 28 Nov): roles, marks, topics, acceptance.

    model_for(store, override=None)                       -> Model(mode, provider, name)  which model may be asked, if any
    ask(task, fields, model)                              -> the validated answer, or None for a failed call
    role_of(paper) / role_by_rule(title, filename)        -> "paper", "question_bank", "solution" or "notes"; the rule's pick or ""
    unit_in_title(title, filename) / exam_key(title)      -> the unit a question bank names, or None; the exam a title names ("cie2")
    looks_unasked(text)                                   -> True for the plain cases of an item that is not a question
    reread(store, papers, apply, busy, stop, progress)    -> [row]   R-67 a paper read again with today's reader
    tag_subject(store, subject, apply, use_model, limit, model, stop, progress) -> dict   R-68 rule tags first, then the model
    policy(store) / set_policy(store, on)                 -> {"auto_accept": bool}   R-69, off by default
    accept(store, sid) / unaccept(store, sid)             -> dict    R-70 and R-71
    PrepJob                                               R-72 to R-74: the steps in one background job, one at a time
                                                          (the step `levels`, R-75, is ww_pyq/levels.level_subject)

Why each rule is what it is (measured on his store on 28 Nov: 880 questions, all pending, 0 tagged, 66 with marks; and on
a scratch copy of it the same day, the later section of the research file):
  * Every value written names who set it: tag_source "rule" (as R-18 writes it) or "model" with the model's name in
    `tag_model`; an acceptance by rule carries `accepted_by: "rule"` and status_by "rule"; a role `role_source`; an item
    judged not a question `not_question_source` ("rule" or "model", with `not_question_model`). Nothing he set by hand is
    overwritten: a tag with tag_source "hand", a status he set, a text or marks he edited, a role he chose.
  * A paper has a role. The rule reads the title and the file name: "sol", "solution", "answer key" or "scheme" make a
    solution (checked first: "solution_<code>_Question_Paper" names both and is a solution), "question bank" or "QB" a
    question bank; nothing else is decided by rule, and a role on file is never replaced by it. A solution's items are
    answers: in two such files of his, 9 of 34 items read like questions. So they are never tagged, accepted, counted in
    the patterns (patterns._evidence), set on a sheet or counted in the ledger; "notes" (his own choice only) is held the
    same way here.
  * A question bank gives its unit: his banks are titled "<code>_Unit_4_Question_Bank" or "UNIT3-QUESTION BANK_<code>",
    so the unit number in the title is written to its questions (`unit`, tag_source "rule", unit_source "title") and the
    rule tagger and the model choose a topic among that unit's topics only. A title naming two units gives none.
  * An item that is not a question: a rule catches the plain cases (under 25 characters; over 300 characters with no
    question mark and no verb of asking, which is what an answer paragraph looks like), the model answers `question:
    false` for the rest. Kept as `not_question: true` with who said it; such an item is never tagged or accepted by rule.
  * The model sees a question's text and the subject's own topic list and nothing else; a pick that is not one of his
    topics is dropped. Batches of 20 questions (MODEL_BATCH): about 1,300 tokens of setup per call were measured on the
    command-line model, so 20 questions a call keeps the setup under a tenth of what is sent, and one failed call loses
    at most 20 answers. A failed batch writes nothing and is counted.
  * Acceptance by rule is off until he turns it on (his rule has been that nothing enters the bank unreviewed). When on,
    it takes only questions that are safe to trust without his eye: text from a text layer (never OCR, never a picture),
    more than 40 characters (MIN_TEXT: 785 of his 880 questions pass it, the rest are headings and stubs), a paper with a
    subject, marks present, a unit and topic present. A question bank prints no marks (10 to 24 questions a bank, none
    with marks), so a question of one is accepted without them: marks stay null and marks_source says "not printed".
  * Reading again replaces a paper's questions only when none of them is accepted, tagged by hand or edited by hand, and
    never when today's reader finds fewer questions with marks; the old questions are kept in one backup file a paper,
    and the replacement is one write through Store.replace_questions, so a paper is never half replaced.
  * A job, not a wait: a model batch of 20 took 30 to 50 s and reading 89 papers again 510 s, so R-72 runs the long
    steps in one background thread and stops only between batches or papers.
Every step is safe to call twice: a second call finds nothing left to write. With apply false each answers what it would do.
"""
from __future__ import annotations

import json
import os
import re
import shutil
import threading
import time
import uuid
from collections import Counter
from datetime import datetime
from pathlib import Path
from typing import Any, Callable, NamedTuple, Optional

from .. import ww_counsel
from . import api, ingest, settings, tag
from .blueprint import write_json_atomic
from .store import NOT_PRINTED, Store

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
ROLES = ("paper", "question_bank", "solution", "notes")
HELD_ROLES = ("solution", "notes")              # their items are not questions he was set
SHORT_ITEM = 25                                  # under this, an item is a heading or a stub ("Q1", "Section B", "OR")
LONG_ITEM = 300                                  # over this with no asking, an answer paragraph
STEPS = ("subjects", "reread", "tags", "levels", "accept")     # levels (EW13, ww_pyq/levels.py) after tags, before accept
MAX_JOB_SUBJECTS = 50
_SHA = re.compile(r"^[0-9a-f]{64}$")
# a verb of asking, as a word start: "stat" also meets "statement", which only ever makes the rule say "question" and
# leave the item to the model; the rule may miss an answer, it must not call a question an answer
_ASKING = re.compile(r"\b(?:explain|defin|deriv|describ|discuss|stat|prov|find|calculat|comput|determin|evaluat|show|list|"
                     r"writ|draw|sketch|design|compar|differen|distinguish|what|why|how|which|when|where|who|obtain|solv|"
                     r"giv|enumerat|illustrat|justif|classif|construct|analy[sz]|mention|identif|outlin|elaborat|plot|"
                     r"verif|convert|simplif|implement|develop|estimat|express|comment|demonstrat|examin|formulat|"
                     r"summari[sz]|tabulat|apply|name|briefly)", re.I)
_UNIT = re.compile(r"(?<![a-z])unit\s*[-_.:#]?\s*(?:(\d{1,2})(?!\d)|([ivx]{1,4})(?![a-z]))")
_UNITS_MANY = re.compile(r"(?<![a-z])unit\s*[-_.:#]?\s*(?:\d{1,2}|[ivx]{1,4})\s*(?:and|&|,|to|/|-)\s*"
                         r"(?:\d{1,2}(?!\d)|[ivx]{1,4}(?![a-z]))")
_ROMAN = {"i": 1, "ii": 2, "iii": 3, "iv": 4, "v": 5, "vi": 6, "vii": 7, "viii": 8, "ix": 9, "x": 10}
_SOLUTION = re.compile(r"(?<!re)(?<!dis)(?<!ab)solution")          # "resolution" is not a solution sheet
_EXAM_WORDS = {"cie", "ct", "pt", "mse", "ese", "ia", "sessional", "midsem", "midterm", "endsem", "endterm", "insem",
               "quiz", "internal"}
_EXAM_PAIRS = {("mid", "sem"): "midsem", ("mid", "term"): "midterm", ("end", "sem"): "endsem", ("end", "term"): "endterm",
               ("in", "sem"): "insem"}


def _now() -> str:
    return datetime.now().isoformat(timespec="seconds")


def _plural(n: int, one: str, many: str) -> str:
    return f"{n} {one if n == 1 else many}"


# ------------------------------------------------------------------ the model
class Model(NamedTuple):
    mode: str                          # "off", "local" or "claude"
    provider: Optional[ww_counsel.Provider]
    name: str                          # written beside every value the model set, e.g. "claude-cli:haiku"


OFF = Model("off", None, "")


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


# ------------------------------------------------------------------ what a paper is, and what an item is
def role_of(paper: Optional[dict]) -> str:
    """The paper's role; one with none on file is a paper."""
    r = (paper or {}).get("role")
    return r if r in ROLES else "paper"


def role_by_rule(*texts: Any) -> str:
    """"solution" or "question_bank" from the words of the title and the file name, else "" (no rule spoke)."""
    low = " ".join(str(t or "") for t in texts).lower()
    toks = re.findall(r"[a-z]+", low)                  # letters only: "CIE2SOLUTION" gives "cie" and "solution"
    squash = re.sub(r"[^a-z0-9]", "", low)            # "QUESTION BANK", "Question_Bank" and "QUESTIONBANK" alike
    if any(_SOLUTION.search(t) for t in toks) or "answerkey" in squash or any(t in ("sol", "sols", "scheme") for t in toks):
        return "solution"
    if "questionbank" in squash or any(t in ("qb", "qbank") for t in toks):
        return "question_bank"
    return ""


def unit_in_title(*texts: Any) -> Optional[int]:
    """The one unit number a title or file name names ("Unit_4", "UNIT3", "unit-iv"), or None for none or more than one."""
    found = set()
    for t in texts:
        low = str(t or "").lower()
        if _UNITS_MANY.search(low):
            return None
        for d, r in _UNIT.findall(low):
            n = int(d) if d else _ROMAN.get(r)
            if n:
                found.add(n)
    return found.pop() if len(found) == 1 else None


def exam_key(*texts: Any) -> str:
    """The exam a title names, as one short key ("cie2", "midsem", "endsem1"), or ""."""
    toks = re.findall(r"[a-z]+|\d+", " ".join(str(t or "") for t in texts).lower())
    for i, t in enumerate(toks):
        word, j = None, i + 1
        if i + 1 < len(toks) and (t, toks[i + 1]) in _EXAM_PAIRS:
            word, j = _EXAM_PAIRS[(t, toks[i + 1])], i + 2
        elif t in _EXAM_WORDS:
            word = t
        if word:
            n = toks[j] if j < len(toks) and toks[j].isdigit() and len(toks[j]) <= 2 else ""
            return word + n
    return ""


def looks_unasked(text: Any) -> bool:
    """The plain cases of an item that is not a question. An item with no words (a picture) is not judged here."""
    t = re.sub(r"\s+", " ", str(text or "")).strip()
    if not t:
        return False
    if len(t) < SHORT_ITEM:
        return True
    return len(t) > LONG_ITEM and "?" not in t and not _ASKING.search(t)


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
    level = sum(1 for q in rows if q.get("level_source") == "hand")      # a level he set counts like a tag he set (EW13)
    parts = [s for n, s in ((acc, f"{acc} accepted"), (hand, f"{hand} tagged by you"), (edited, f"{edited} edited by you"),
                            (level, f"{level} given a level by you")) if n]
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
    """The scratch reading becomes the paper's questions, in one write through Store.replace_questions. The check that
    nothing on the paper is his, the backup and the move of the new crops and pages run under the store's lock, just
    before that write, so a question he accepted meanwhile keeps the paper as it is."""
    new = scratch.list_questions(paper_id=sp)
    smeta = scratch.get_paper(sp)
    taken = {q["id"] for q in store.list_questions() if q["paper_id"] != pid}
    rows, moves = [], []
    for q in new:
        q = dict(q)
        old_png = ((q.get("crop") or {}).get("png") or "")
        while q["id"] in taken:                  # 48 random bits: a clash is not looked for, but an id must stay unique
            q["id"] = f"q-{uuid.uuid4().hex[:12]}"
        taken.add(q["id"])
        if q.get("crop"):
            rel = ""
            if old_png and (scratch.root / old_png).is_file():
                rel = f"crops/{pid}/{q['id']}.png"
                moves.append((scratch.root / old_png, store.root / rel))
            q["crop"] = {**q["crop"], "png": rel}
        for k in ("paper_id", "status", "status_by", "updated"):
            q.pop(k, None)
        rows.append(q)
    done: dict = {}

    def before(cur: list[dict]) -> None:
        why = held_by_him(cur)
        if why:
            raise ValueError(f"Kept as it is: {why} since the reading began.")
        done["backup"] = _backup(store, pid, store.get_paper(pid), cur)
        for src, dst in moves:
            dst.parent.mkdir(parents=True, exist_ok=True)
            os.replace(src, dst)
        pages_from, pages_to = scratch.paths.pages / sp, store.paths.pages / pid
        if pages_from.is_dir():
            pages_to.mkdir(parents=True, exist_ok=True)
            for f in pages_from.glob("*.png"):
                os.replace(f, pages_to / f.name)

    store.replace_questions(pid, rows, before)
    paper = store.get_paper(pid)
    store.update_paper(pid, {"faults": smeta.get("faults") or [], "total_marks": smeta.get("total_marks"),
                             "method": smeta.get("method") or paper.get("method"), "pages": smeta.get("pages") or paper.get("pages"),
                             "reread_at": _now()})
    return done["backup"]


def _reread_one(store: Store, pid: str, apply: bool) -> dict:
    paper = store.get_paper(pid)
    before = store.list_questions(paper_id=pid)
    row = {"paper": pid, "title": paper.get("title") or "", "questions_before": len(before), "marks_before": _with_marks(before),
           "questions_after": None, "marks_after": None, "changed": False, "failed": False, "reason": "", "backup": ""}
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
            row["failed"] = True
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


def _not_read(ids: list[str], reason: str) -> list[dict]:
    return [{"paper": i, "title": "", "questions_before": None, "questions_after": None, "marks_before": None,
             "marks_after": None, "changed": False, "failed": False, "backup": "", "reason": reason} for i in ids]


def reread(store: Store, papers: Optional[list], apply: bool, busy: Callable[[], bool] = lambda: False,
           stop: Callable[[], bool] = lambda: False, progress: Optional[Callable[[int], None]] = None) -> list[dict]:
    """R-67. Busy (409) while the paper desk or OCR reads, checked before the first paper and before each next one. `stop`
    (the job's R-74) is looked at between papers only: a paper is read and replaced whole or not at all."""
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
        if k and stop():
            rows.extend(_not_read(ids[k:], "Stopped before this paper."))
            break
        if k and busy():
            rows.extend(_not_read(ids[k:], "The paper desk started reading; stopped before this paper."))
            break
        rows.append(_reread_one(store, pid, apply))
        if progress is not None:
            progress(1)
    return rows


# ------------------------------------------------------------------ R-68 topics
def _one_line(text: str) -> str:
    return re.sub(r"\s+", " ", str(text or "")).strip()[:MAX_QUESTION_CHARS]


def _topic_lines(topics: list[dict]) -> tuple[str, dict]:
    ids = {f"T{i + 1}": t for i, t in enumerate(topics)}
    return "\n".join(f"{k}: unit {t['unit']}, {t['topic']}" for k, t in ids.items()), ids


def _done(q: dict) -> bool:
    """A question whose tag is settled: set by hand, or a topic set by the rule or the model."""
    src = q.get("tag_source")
    return src == "hand" or (src in ("rule", "model") and bool(str(q.get("topic") or "").strip()))


def _held_unit(q: dict) -> Optional[int]:
    """The unit a question is held to: one the rule wrote without a topic (a question bank's title)."""
    if q.get("unit") is not None and q.get("tag_source") == "rule" and not str(q.get("topic") or "").strip():
        return q["unit"]
    return None


def tag_subject(store: Store, subject: dict, *, apply: bool, use_model: bool, limit: Optional[int], model: Model,
                stop: Optional[Callable[[], bool]] = None, progress: Optional[Callable[[int], None]] = None) -> dict:
    """R-68. Solutions, notes and items already judged not a question are left out. Then for each open question: the
    not-a-question rule; the unit a question bank's title names; the rule tagger of R-18 (tag.tag_question, written the way
    R-18 writes it) among that unit's topics or all of them; then the model for what the rule left, in batches of
    MODEL_BATCH, at most `limit` questions a call (None: all, for the job). Counts: rule and model are what this call wrote
    (or would write), none what the model answered "none" for or picked outside his topics, left what is still untagged."""
    if not isinstance(apply, bool) or not isinstance(use_model, bool):
        raise ValueError("Apply and use_model are true or false.")
    if limit is not None and (isinstance(limit, bool) or not isinstance(limit, int) or not 1 <= limit <= MAX_LIMIT):
        raise ValueError(f"The limit is between 1 and {MAX_LIMIT}.")
    sid = str(subject["id"]).lower()
    topics = tag.topics_of(subject)
    out = {"rule": 0, "model": 0, "none": 0, "left": 0, "dropped": 0, "failed_batches": 0, "held_by_hand": 0,
           "no_text": 0, "model_name": "", "asked": 0, "not_question": 0, "unit_from_title": 0, "solution_items": 0,
           "stopped": False}
    if not topics:
        return {**out, "state": "waiting", "reason": "This subject has no syllabus topics yet."}
    papers = {p["id"]: p for p in store.list_papers(sid)}
    rows = [q for q in store.list_questions(subject=sid) if q.get("status") != "rejected"]
    out["solution_items"] = sum(1 for q in rows if role_of(papers.get(q["paper_id"])) in HELD_ROLES)
    rows = [q for q in rows if role_of(papers.get(q["paper_id"])) not in HELD_ROLES and q.get("not_question") is not True]
    out["held_by_hand"] = sum(1 for q in rows if q.get("tag_source") == "hand")
    open_ = [q for q in rows if not _done(q)]
    out["no_text"] = sum(1 for q in open_ if not str(q.get("text") or "").strip())
    open_ = [q for q in open_ if str(q.get("text") or "").strip()]
    units = {t["unit"] for t in topics}
    remaining: list[tuple[dict, Optional[int]]] = []
    for q in open_:
        if looks_unasked(q.get("text")):
            out["not_question"] += 1
            if apply:
                store.update_question(q["id"], {"not_question": True, "not_question_source": "rule"}, "rule")
            continue
        p = papers.get(q["paper_id"]) or {}
        if q.get("unit") is None and role_of(p) == "question_bank":
            n = unit_in_title(p.get("title"), p.get("filename"))
            if n in units:
                out["unit_from_title"] += 1
                q = {**q, "unit": n, "tag_source": "rule", "unit_source": "title"}
                if apply:
                    store.update_question(q["id"], {"unit": n, "tag_source": "rule", "unit_source": "title"}, "rule")
        held = _held_unit(q)
        ts = [t for t in topics if t["unit"] == held] if held is not None else topics
        r = tag.tag_question(q, ts) if ts else {"tag_source": "none"}
        if r["tag_source"] != "rule":
            remaining.append((q, held))
            continue
        out["rule"] += 1
        if apply:
            store.update_question(q["id"], {"unit": r["unit"], "topic": r["topic"], "tag_source": "rule",
                                            "tag_score": r["score"], "tag_margin": r["margin"]}, "rule")
    answered: set[str] = set()
    if use_model and model.mode != "off" and remaining:
        out["model_name"] = model.name
        send = remaining if limit is None else remaining[:limit]
        groups: dict[Optional[int], list[dict]] = {}
        for q, held in send:
            groups.setdefault(held, []).append(q)
        for held, qs in groups.items():
            ts = [t for t in topics if t["unit"] == held] if held is not None else topics
            lines, by_id = _topic_lines(ts)
            for i in range(0, len(qs), MODEL_BATCH):
                if stop is not None and stop():
                    out["stopped"] = True
                    break
                batch = qs[i:i + MODEL_BATCH]
                qmap = {f"Q{j + 1}": q for j, q in enumerate(batch)}
                fields = {"subject": str(subject.get("name") or sid), "topics": lines,
                          "questions": "\n".join(f"{k}: {_one_line(q['text'])}" for k, q in qmap.items()),
                          "question_ids": ",".join(qmap), "topic_ids": ",".join(by_id)}
                out["asked"] += len(batch)
                ans = ask("tag_topics", fields, model)
                if ans is None:
                    out["failed_batches"] += 1         # its questions stay as they were and count as left
                    if progress is not None:
                        progress(len(batch))
                    continue
                fresh = {q["id"]: q for q in store.list_questions(subject=sid)} if apply else {}
                for t in ans["tags"]:
                    q = qmap[t["q"]]
                    answered.add(q["id"])
                    now = fresh.get(q["id"])
                    # he (or another call) tagged it, or it was judged, while the model was thinking
                    gone = now is None or _done(now) or now.get("not_question") is True
                    if t.get("question") is False:
                        out["not_question"] += 1
                        if apply and not gone:
                            store.update_question(q["id"], {"not_question": True, "not_question_source": "model",
                                                            "not_question_model": model.name}, "rule")
                        continue
                    if t["topic"] == "none" or not t["topic"]:
                        out["none"] += 1
                        out["dropped"] += 0 if t["topic"] == "none" else 1
                        continue
                    pick = by_id[t["topic"]]
                    if apply:
                        if gone:
                            continue
                        store.update_question(q["id"], {"unit": pick["unit"], "topic": pick["topic"], "tag_source": "model",
                                                        "tag_model": model.name, "tag_score": None, "tag_margin": None}, "rule")
                    out["model"] += 1
                if progress is not None:
                    progress(len(batch))
            if out["stopped"]:
                break
    out["left"] = sum(1 for q, _ in remaining if q["id"] not in answered)
    did = "Tagged" if apply else "Would tag"
    reason = (f"{did} {out['rule']} by rule and {out['model']} by the model; {out['none']} fit none of the topics, "
              f"{out['left']} {'is' if out['left'] == 1 else 'are'} still without a topic.")
    if out["not_question"]:
        reason += f" {_plural(out['not_question'], 'item is', 'items are')} not a question and {'is' if out['not_question'] == 1 else 'are'} kept out."
    if out["unit_from_title"]:
        reason += f" {out['unit_from_title']} from a question bank took the unit its title names."
    if out["solution_items"]:
        reason += f" {_plural(out['solution_items'], 'item', 'items')} of solution sheets or notes {'was' if out['solution_items'] == 1 else 'were'} left out."
    if out["failed_batches"]:
        reason += f" {_plural(out['failed_batches'], 'batch', 'batches')} of the model failed and changed nothing."
    if out["stopped"]:
        reason += " Stopped after the batch in hand."
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
    role = role_of(paper)
    if role == "solution":
        return "a solution sheet"
    if role == "notes":
        return "notes, not a paper"
    if paper.get("method") not in TEXT_METHODS or q.get("kind", "question") != "question" or q.get("origin", "paper") != "paper":
        return "not from a text layer"
    if q.get("text_status") != "verified" or q.get("ocr_confidence") is not None:
        return "not from a text layer"                # OCR text stays "unverified"; a picture-only question has "none"
    if len(str(q.get("text") or "").strip()) <= MIN_TEXT:
        return f"{MIN_TEXT} characters or fewer"
    if q.get("not_question") is True or looks_unasked(q.get("text")):
        return "not a question"
    if not paper.get("subject"):
        return "no subject"
    if q.get("marks") is None and role != "question_bank":
        return "no marks"
    if q.get("unit") is None or not str(q.get("topic") or "").strip():
        return "no unit and topic"
    return ""


def accept(store: Store, sid: str) -> dict:
    """R-70: only when the policy is on; each question written with accepted_by "rule" and status_by "rule". A question
    of a question bank without marks is first marked marks_source "not printed", the only way the store takes it."""
    if not policy(store)["auto_accept"]:
        return {"accepted": 0, "held": {}, "on": False, "unmarked": 0}
    papers = {p["id"]: p for p in store.list_papers(sid)}
    ids, unmarked, held = [], [], Counter()
    for q in store.list_questions(subject=sid):
        why = why_not_trusted(q, papers[q["paper_id"]])
        if why:
            if why != "not pending":
                held[why] += 1
            continue
        ids.append(q["id"])
        if q.get("marks") is None:
            unmarked.append(q["id"])
    if unmarked:
        store.update_questions(unmarked, {"marks_source": NOT_PRINTED}, "rule")
    if ids:
        store.update_questions(ids, {"status": "accepted", "accepted_by": "rule"}, "rule")
    return {"accepted": len(ids), "held": dict(held), "on": True, "unmarked": len(unmarked)}


def unaccept(store: Store, sid: str) -> dict:
    """R-71: every question accepted by the rule goes back to pending. One he accepted himself (status_by "hand", even
    after the rule had accepted it once) is not touched."""
    ids = [q["id"] for q in store.list_questions(subject=sid, status="accepted")
           if q.get("accepted_by") == "rule" and q.get("status_by") == "rule"]
    if ids:
        store.update_questions(ids, {"status": "pending", "accepted_by": ""}, "rule")
    return {"returned": len(ids)}


# ------------------------------------------------------------------ R-72 to R-74 the job
def check_steps(steps: Any) -> list[str]:
    """The steps asked for, in the one order they run (subjects, reread, tags, levels, accept)."""
    if not isinstance(steps, list) or not steps or not all(isinstance(s, str) for s in steps):
        raise ValueError(f"Give the steps as a list of {', '.join(STEPS)}.")
    bad = [s for s in steps if s not in STEPS]
    if bad:
        raise ValueError(f"Not a step: {bad[0][:40]}.")
    if len(set(steps)) != len(steps):
        raise ValueError("A step is named once.")
    return [s for s in STEPS if s in steps]


class PrepJob:
    """One preparation run at a time (R-72 to R-74), on a thread of its own. A second start raises api.Busy (409); stop()
    ends it after the model batch or the paper in hand, so no batch is half written and no paper half replaced."""

    def __init__(self, bus=None):
        self._bus = bus
        self._lock = threading.Lock()
        self._job: Optional[dict] = None
        self._thread: Optional[threading.Thread] = None
        self._stop = threading.Event()
        self._t0 = 0.0

    def info(self) -> Optional[dict]:
        with self._lock:
            if not self._job:
                return None
            j = json.loads(json.dumps(self._job))
            if j["status"] == "running":
                j["seconds"] = round(time.monotonic() - self._t0, 1)
            return j

    def running(self) -> bool:
        with self._lock:
            return bool(self._job and self._job["status"] == "running")

    def start(self, store: Store, steps: list[str], *, subjects: list[dict], use_model: bool, model: Model,
              manifest: Optional[dict], counts: Callable[[], dict], busy: Callable[[], bool] = lambda: False,
              every_paper: bool = False) -> dict:
        """`subjects` are the subjects to work on (all of his when he named none, with `every_paper` true so the reread
        step takes papers without a subject too); `counts` gives R-65's counts; `busy` says the paper desk or OCR reads.
        Nothing runs until the counts before are taken."""
        steps = check_steps(steps)
        with self._lock:
            if self._job and self._job["status"] == "running":
                raise api.Busy("A preparation run is already going; wait for it or stop it.")
        before = counts()
        md = model if use_model else OFF
        with self._lock:
            if self._job and self._job["status"] == "running":
                raise api.Busy("A preparation run is already going; wait for it or stop it.")
            self._stop.clear()
            self._t0 = time.monotonic()
            self._job = {"id": f"r-{uuid.uuid4().hex[:12]}", "status": "running", "steps": steps, "step": steps[0],
                         "unit": "", "done": 0, "total": 0, "counts_before": before, "counts_now": before,
                         "started": _now(), "finished": None, "seconds": 0.0, "failures": 0, "notes": [], "results": {},
                         "subjects": [str(s["id"]).lower() for s in subjects], "model": md.name if md.mode != "off" else "",
                         "error": None}
            ctx = {"store": store, "subjects": subjects, "model": md, "manifest": manifest, "counts": counts, "busy": busy,
                   "every_paper": every_paper}
            self._thread = threading.Thread(target=self._run, args=(steps, ctx), daemon=True, name="pyq-prep")
            self._thread.start()
            return json.loads(json.dumps(self._job))

    def stop(self) -> bool:
        with self._lock:
            if not (self._job and self._job["status"] == "running"):
                return False
        self._stop.set()
        return True

    def wait(self, timeout: float = 60) -> Optional[dict]:
        t = self._thread
        if t is not None:
            t.join(timeout)
        return self.info()

    # -------------------------------------------------------------- inside the thread
    def _set(self, **kw) -> None:
        with self._lock:
            self._job.update(kw)

    def _tick(self, n: int = 1) -> None:
        with self._lock:
            self._job["done"] += n

    def _note(self, text: str, failures: int = 0) -> None:
        with self._lock:
            self._job["notes"].append(text[:200])
            self._job["failures"] += failures

    def _result(self, step: str, value: dict) -> None:
        with self._lock:
            self._job["results"][step] = value

    def _run(self, steps: list[str], ctx: dict) -> None:
        cut = False
        try:
            for step in steps:
                if self._stop.is_set():
                    cut = True
                    break
                self._set(step=step, done=0, total=0, unit="")
                cut = getattr(self, f"_step_{step}")(ctx) or self._stop.is_set()
                self._set(counts_now=ctx["counts"]())
                if cut:
                    break
            end = {"status": "stopped" if cut else "done"}
        except Exception as e:                             # the job says why; the server goes on
            end = {"status": "failed", "error": (str(e) if isinstance(e, (ValueError, KeyError, api.Busy))
                                                 else f"The run stopped on an error ({type(e).__name__}).")[:200]}
            try:
                self._set(counts_now=ctx["counts"]())
            except Exception:
                pass
        with self._lock:
            self._job.update(end, finished=_now(), seconds=round(time.monotonic() - self._t0, 1))
            job = dict(self._job)
        if self._bus is not None:
            try:
                self._bus.publish("mission", "update", f"Preparation {job['status']}: {job['failures']} failures"[:140])
            except Exception:
                pass

    def _step_subjects(self, ctx: dict) -> bool:
        from . import assign
        st = ctx["store"]
        self._set(unit="papers", total=sum(1 for p in st.list_papers() if not p.get("subject")))
        r = assign.propose(st, ctx["subjects"], ctx["manifest"], apply=True, use_model=ctx["model"].mode != "off",
                           model=ctx["model"], stop=self._stop.is_set, progress=self._tick)
        k = r["counts"]
        if k["model_failed"]:
            self._note(f"The model did not answer for {_plural(k['model_failed'], 'paper', 'papers')}.", k["model_failed"])
        self._result("subjects", {**k, "roles": len(r["roles"]), "pairs": len(r["pairs"])})
        return bool(r.get("stopped"))

    def _step_reread(self, ctx: dict) -> bool:
        st = ctx["store"]
        mine = {str(s["id"]).lower() for s in ctx["subjects"]}
        # no subject named: every paper, those without a subject too (a better reading helps R-66 find one)
        ids = [p["id"] for p in st.list_papers() if p.get("kind") != "pptx" and (ctx["every_paper"] or p.get("subject") in mine)]
        self._set(unit="papers", total=len(ids))
        changed = failed = 0
        cut = False
        for i in range(0, len(ids), MAX_PAPERS):
            if self._stop.is_set():
                cut = True
                break
            try:
                rows = reread(st, ids[i:i + MAX_PAPERS], True, ctx["busy"], self._stop.is_set, self._tick)
            except api.Busy as e:
                self._note(str(e), 1)
                cut = True
                break
            changed += sum(1 for r in rows if r["changed"])
            failed += sum(1 for r in rows if r.get("failed"))
            if any(r["questions_before"] is None for r in rows):
                cut = True                                 # stopped, or the desk began reading, before a paper
                break
        if failed:
            self._note(f"{_plural(failed, 'paper', 'papers')} could not be read again.", failed)
        self._result("reread", {"papers": len(ids), "changed": changed, "failed": failed})
        return cut

    def _step_tags(self, ctx: dict) -> bool:
        st, md = ctx["store"], ctx["model"]
        subs = [s for s in ctx["subjects"] if tag.topics_of(s)]
        by_model = md.mode != "off"
        if by_model:
            dry = [tag_subject(st, s, apply=False, use_model=False, limit=None, model=OFF)["left"] for s in subs]
            self._set(unit="questions", total=sum(dry))
        else:
            self._set(unit="subjects", total=len(subs))
        res, cut = {}, False
        for s in subs:
            if self._stop.is_set():
                cut = True
                break
            r = tag_subject(st, s, apply=True, use_model=by_model, limit=None, model=md, stop=self._stop.is_set,
                            progress=self._tick if by_model else None)
            if r["failed_batches"]:
                self._note(f"{s.get('name') or s['id']}: {_plural(r['failed_batches'], 'batch', 'batches')} of the model "
                           f"failed; {'its' if r['failed_batches'] == 1 else 'their'} questions are as they were.",
                           r["failed_batches"])
            if not by_model:
                self._tick(1)
            res[str(s["id"]).lower()] = {k: r[k] for k in ("rule", "model", "none", "left", "not_question",
                                                            "unit_from_title", "failed_batches")}
            if r["stopped"]:
                cut = True
                break
        self._result("tags", res)
        return cut

    def _step_levels(self, ctx: dict) -> bool:
        from . import levels                               # levels imports this module; the import waits for the step
        st, md = ctx["store"], ctx["model"]
        subs = ctx["subjects"]
        by_model = md.mode != "off"
        if by_model:
            dry = [levels.level_subject(st, s, apply=False, use_model=False, limit=None, model=OFF)["left"] for s in subs]
            self._set(unit="questions", total=sum(dry))
        else:
            self._set(unit="subjects", total=len(subs))
        res, cut = {}, False
        for s in subs:
            if self._stop.is_set():
                cut = True
                break
            r = levels.level_subject(st, s, apply=True, use_model=by_model, limit=None, model=md, stop=self._stop.is_set,
                                     progress=self._tick if by_model else None)
            if r["failed_batches"]:
                self._note(f"{s.get('name') or s['id']}: {_plural(r['failed_batches'], 'batch', 'batches')} of the model "
                           f"failed; {'its' if r['failed_batches'] == 1 else 'their'} questions are as they were.",
                           r["failed_batches"])
            if not by_model:
                self._tick(1)
            res[str(s["id"]).lower()] = {k: r[k] for k in ("rule", "model", "none", "left", "failed_batches")}
            if r["stopped"]:
                cut = True
                break
        self._result("levels", res)
        return cut

    def _step_accept(self, ctx: dict) -> bool:
        st = ctx["store"]
        if not policy(st)["auto_accept"]:
            self._note("Acceptance by rule is off; only you can turn it on, so nothing was accepted.")
            self._result("accept", {"on": False, "accepted": 0})
            return False
        subs = [str(s["id"]).lower() for s in ctx["subjects"]]
        self._set(unit="subjects", total=len(subs))
        total = unmarked = 0
        for sid in subs:
            if self._stop.is_set():
                self._result("accept", {"on": True, "accepted": total, "unmarked": unmarked})
                return True
            r = accept(st, sid)
            total, unmarked = total + r["accepted"], unmarked + r["unmarked"]
            self._tick(1)
        self._result("accept", {"on": True, "accepted": total, "unmarked": unmarked})
        return False
