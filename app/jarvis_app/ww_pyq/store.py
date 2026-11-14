"""The private review-staging store of the question engine (E05).

Everything he feeds in (his own papers, typed questions) lands here as `pending` and only becomes
a practice-bank row after he accepts it. Layout under the root (plan 9.1.3), nothing outside it:

    papers.json                 {paper_id: PaperMeta}
    questions/<paper_id>.json   [Question, ...]
    originals/ pages/<paper_id>/ crops/<paper_id>/ inbox/ blueprints/ generated/
    folder.json                 the watched folder (ww_pyq/folder.py)
    attempts.jsonl              marks he typed for a generated paper (E08)

Rules that decided the shape:
- One RLock around every read-modify-write and an atomic replace for every write: 20 threads
  writing at once must lose nothing (test T10), and a crash mid-write must leave the old file.
- A file that does not parse is renamed beside itself with a .corrupt suffix and read as empty,
  so the app keeps running and nothing is silently overwritten (test T4).
- Unknown keys are kept on write and missing keys read with the defaults of schema.py, so a record
  from schema version 0 or from a later wave survives a round trip (test T6).
- A question id is checked against _ID before it can reach a path (test T9).
"""
from __future__ import annotations

import json
import os
import re
import threading
import time
import uuid
from datetime import datetime
from pathlib import Path
from types import SimpleNamespace
from typing import Any, Optional

from .. import ww_bank_store
from .schema import (EXAM_KINDS, FLOOR_PAPERS, FLOOR_QUESTIONS, MAX_TEXT, Q_STATUSES, Q_TYPES,
                     Coverage, Crop, PaperMeta, Question, QuestionDraft)

_ID = re.compile(r"^[a-z]-[a-z0-9-]{1,40}$")
_SHA = re.compile(r"^[0-9a-f]{64}$")
_DIFFICULTIES = ("easy", "medium", "hard", "")
_MAX_MARKS = 1000          # a number this large is a typo, not a question
_REPLACE_TRIES = 8         # Windows can hold a target for a few ms (antivirus, an open reader)
_MAX_PROBLEMS = 50

# keys no caller may change through update_paper / update_question: they are the record's identity
_PAPER_FIXED = ("id", "sha256")
_Q_FIXED = ("id", "paper_id")


def _now() -> str:
    return datetime.now().isoformat(timespec="seconds")


def _check_id(value: Any) -> str:
    """An id that reaches a path: a bad one is an unknown record (404), never a path."""
    if not isinstance(value, str) or not _ID.match(value):
        raise KeyError("No such record.")
    return value


def _num(value: Any, what: str) -> float:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise ValueError(f"{what} must be a number.")
    v = float(value)
    if v != v or v < 0 or v > _MAX_MARKS:
        raise ValueError(f"{what} must be between 0 and {_MAX_MARKS}.")
    return int(v) if v == int(v) else v


def _text(value: Any) -> str:
    if not isinstance(value, str):
        raise ValueError("The text must be words.")
    if len(value) > MAX_TEXT:
        raise ValueError(f"A question is at most {MAX_TEXT} characters.")
    return value


class Store:
    def __init__(self, root: Path):
        self.root = Path(root)
        self.paths = SimpleNamespace(
            root=self.root, originals=self.root / "originals", pages=self.root / "pages",
            crops=self.root / "crops", inbox=self.root / "inbox", blueprints=self.root / "blueprints",
            generated=self.root / "generated")
        self._qdir = self.root / "questions"
        self._lock = threading.RLock()
        self.problems: list[str] = []          # what was found broken and set aside; a screen may print it
        for d in (self.root, self._qdir, self.paths.originals, self.paths.pages, self.paths.crops,
                  self.paths.inbox, self.paths.blueprints, self.paths.generated):
            d.mkdir(parents=True, exist_ok=True)

    # ------------------------------------------------------------------ disk
    def _problem(self, text: str) -> None:
        self.problems.append(text)
        del self.problems[:-_MAX_PROBLEMS]

    def _load(self, path: Path, kind: type) -> Any:
        """Parsed JSON of the wanted kind, or an empty one. A broken file is set aside, not deleted."""
        empty = kind()
        try:
            raw = path.read_text(encoding="utf-8")
        except FileNotFoundError:
            return empty
        except OSError as e:
            self._problem(f"{path.name}: could not be read ({type(e).__name__}).")
            return empty
        try:
            data = json.loads(raw)
            if not isinstance(data, kind):
                raise ValueError("wrong shape")
            return data
        except ValueError:
            aside = path.with_name(f"{path.name}.corrupt")
            if aside.exists():
                aside = path.with_name(f"{path.name}.{int(time.time())}.corrupt")
            try:
                os.replace(path, aside)
            except OSError:
                pass
            self._problem(f"{path.name}: could not be parsed; kept beside it as {aside.name}.")
            return empty

    def _save(self, path: Path, data: Any) -> None:
        """Write a temporary file in the same folder, then replace, so a reader sees all or nothing."""
        tmp = path.with_name(f".{path.name}.{uuid.uuid4().hex[:8]}.tmp")
        try:
            with open(tmp, "w", encoding="utf-8") as f:
                json.dump(data, f, ensure_ascii=False, indent=1)
                f.flush()
                os.fsync(f.fileno())
            for i in range(_REPLACE_TRIES):
                try:
                    os.replace(tmp, path)
                    return
                except PermissionError:
                    if i == _REPLACE_TRIES - 1:
                        raise
                    time.sleep(0.02 * (i + 1))
        finally:
            try:
                tmp.unlink()
            except FileNotFoundError:
                pass
            except OSError:
                pass

    def _papers(self) -> dict:
        d = self._load(self.root / "papers.json", dict)
        return {k: self._paper(v, k) for k, v in d.items() if isinstance(v, dict) and _ID.match(str(k))}

    def _save_papers(self, papers: dict) -> None:
        self._save(self.root / "papers.json", papers)

    def _qpath(self, paper_id: str) -> Path:
        return self._qdir / f"{_check_id(paper_id)}.json"

    def _questions_of(self, paper_id: str) -> list[dict]:
        """One paper's questions, normalised; a repeated id keeps its first record (test T7)."""
        rows, seen = self._load(self._qpath(paper_id), list), set()
        out = []
        for r in rows:
            if not isinstance(r, dict) or not _ID.match(str(r.get("id") or "")) or r["id"] in seen:
                continue
            seen.add(r["id"])
            out.append(self._question(r, paper_id))
        return out

    # ------------------------------------------------------------------ defaults for old records
    @staticmethod
    def _paper(rec: dict, pid: str) -> dict:
        p = dict(rec)
        p["id"] = pid
        p.setdefault("sha256", "")
        p.setdefault("filename", "")
        p.setdefault("kind", "hand")
        p.setdefault("method", "typed")
        p.setdefault("subject", "")
        p.setdefault("exam_kind", "other")
        p.setdefault("year", None)
        p.setdefault("title", "")
        p.setdefault("source_note", "")
        p.setdefault("pages", 0)
        p.setdefault("total_marks", None)
        p.setdefault("added", "")
        if not isinstance(p.get("faults"), list):
            p["faults"] = []
        return p

    @staticmethod
    def _question(rec: dict, paper_id: str) -> dict:
        q = dict(rec)
        q["paper_id"] = paper_id
        q.setdefault("label", "")
        q.setdefault("kind", "question")
        q.setdefault("text", "")
        q.setdefault("text_status", "unverified" if q["text"] else "none")
        q.setdefault("crop", None)
        q.setdefault("page", 0)
        q.setdefault("marks", None)
        q.setdefault("marks_source", "missing" if q["marks"] is None else "hand")
        q.setdefault("type", "unknown")
        q.setdefault("section", "")
        q.setdefault("choice_group", "")
        q.setdefault("co", "")
        q.setdefault("bl", None)
        q.setdefault("parts", [])
        if q.get("status") not in Q_STATUSES:
            q["status"] = "pending"                 # an unknown status never reads as accepted (test T5)
        q.setdefault("status_by", "hand")
        q.setdefault("unit", None)
        q.setdefault("topic", "")
        q.setdefault("tag_source", "none")
        q.setdefault("tag_score", None)
        q.setdefault("tag_margin", None)
        q.setdefault("difficulty", "")
        q.setdefault("difficulty_source", "")
        q.setdefault("family_id", "")
        q.setdefault("edited", False)
        q.setdefault("updated", "")
        return q

    # ------------------------------------------------------------------ papers
    def add_paper(self, meta: PaperMeta) -> str:
        """Idempotent by sha256: the same file twice is one paper (acceptance 1)."""
        with self._lock:
            papers = self._papers()
            sha = str(meta.get("sha256") or "")
            if sha and not _SHA.match(sha):
                # the id and the originals/<sha>.* glob are built from it: an odd value would make an
                # id the loader drops (a lost paper) or a glob that leaves originals/
                raise ValueError("A file hash is 64 lowercase hex characters.")
            if sha:
                for pid, p in papers.items():
                    if p.get("sha256") == sha:
                        return pid
            subject = self._subject(meta.get("subject", ""))
            pid = str(meta.get("id") or "")
            if not _ID.match(pid):
                pid = f"p-{sha[:12]}" if len(sha) >= 12 else f"p-hand-{uuid.uuid4().hex[:8]}"
            if pid in papers:
                return pid
            rec = dict(meta)
            rec.update(id=pid, subject=subject, added=meta.get("added") or _now())
            papers[pid] = self._paper(rec, pid)
            self._save_papers(papers)
            return pid

    def get_paper(self, pid: str) -> PaperMeta:
        with self._lock:
            p = self._papers().get(_check_id(pid))
        if p is None:
            raise KeyError("No such paper.")
        return p

    def list_papers(self, subject: Optional[str] = None) -> list[PaperMeta]:
        with self._lock:
            rows = list(self._papers().values())
        if subject:
            rows = [p for p in rows if p.get("subject") == subject]
        return sorted(rows, key=lambda p: (p.get("added") or "", p["id"]))

    @staticmethod
    def _subject(value: Any) -> str:
        if value in (None, ""):
            return ""
        return ww_bank_store.slug(value)          # ValueError: "subject is a short id of letters, ..."

    def update_paper(self, pid: str, changes: dict) -> PaperMeta:
        with self._lock:
            papers = self._papers()
            p = papers.get(_check_id(pid))
            if p is None:
                raise KeyError("No such paper.")
            new = dict(p)
            for k, v in (changes or {}).items():
                if k in _PAPER_FIXED:
                    raise ValueError(f"A paper's {k} cannot change.")
                if k == "subject":
                    v = self._subject(v)
                elif k == "exam_kind" and v not in EXAM_KINDS:
                    raise ValueError("That kind of exam is not one I know.")
                elif k == "year" and v is not None and (isinstance(v, bool) or not isinstance(v, int) or not 1900 <= v <= 2200):
                    raise ValueError("The year must be a whole year.")
                elif k == "title" and (not isinstance(v, str) or not v.strip() or len(v) > 200):
                    raise ValueError("A paper needs a title of up to 200 characters.")
                elif k == "source_note" and (not isinstance(v, str) or len(v) > 500):
                    raise ValueError("The source note is at most 500 characters.")
                new[k] = v
            papers[pid] = new
            self._save_papers(papers)
            return new

    def delete_paper(self, pid: str) -> None:
        import shutil
        with self._lock:
            papers = self._papers()
            p = papers.pop(_check_id(pid), None)
            if p is None:
                raise KeyError("No such paper.")
            self._save_papers(papers)
            for f in (self._qpath(pid),):
                f.unlink(missing_ok=True)
            for d in (self.paths.crops / pid, self.paths.pages / pid):
                shutil.rmtree(d, ignore_errors=True)
            sha = p.get("sha256")
            if sha and not any(o.get("sha256") == sha for o in papers.values()):
                for f in self.paths.originals.glob(f"{sha}.*"):      # the file goes so the same file can be read again
                    f.unlink(missing_ok=True)

    def find_by_sha(self, sha256: str) -> Optional[str]:
        if not sha256:
            return None
        with self._lock:
            for pid, p in self._papers().items():
                if p.get("sha256") == sha256:
                    return pid
        return None

    # ------------------------------------------------------------------ questions
    def _draft(self, d: dict, paper_id: str, taken: set) -> dict:
        q = dict(d)
        q = {**q, "paper_id": paper_id}
        q["text"] = _text(q.get("text") or "")
        if "text_status" not in q:
            q["text_status"] = "unverified" if q["text"] else "none"
        if q.get("marks") is not None:
            q["marks"] = _num(q["marks"], "Marks")
        else:
            q["marks"] = None
        q.setdefault("marks_source", "missing" if q["marks"] is None else "hand")
        if q.get("type", "unknown") not in Q_TYPES:
            raise ValueError("That kind of question is not one I know.")
        qid = str(q.get("id") or "")
        while not _ID.match(qid) or qid in taken:
            qid = f"q-{uuid.uuid4().hex[:12]}"
        q["id"] = qid
        taken.add(qid)
        q["status"] = "pending"                 # a draft never arrives accepted: only update_question accepts
        q["updated"] = _now()
        return self._question(q, paper_id)

    def add_questions(self, paper_id: str, drafts: list[QuestionDraft]) -> list[str]:
        with self._lock:
            if _check_id(paper_id) not in self._papers():
                raise KeyError("No such paper.")
            rows = self._questions_of(paper_id)
            taken = {q["id"] for q in self._all_ids()} | {q["id"] for q in rows}
            new = [self._draft(d, paper_id, taken) for d in drafts]        # all valid or none written
            self._save(self._qpath(paper_id), rows + new)
            return [q["id"] for q in new]

    def _all_ids(self) -> list[dict]:
        out = []
        for f in self._qdir.glob("*.json"):
            if _ID.match(f.stem):
                out.extend(self._questions_of(f.stem))
        return out

    def _find(self, qid: str) -> tuple[str, list[dict], dict]:
        _check_id(qid)
        for f in sorted(self._qdir.glob("*.json")):
            if not _ID.match(f.stem):
                continue
            rows = self._questions_of(f.stem)
            for q in rows:
                if q["id"] == qid:
                    return f.stem, rows, q
        raise KeyError("No such question.")

    def get_question(self, qid: str) -> Question:
        with self._lock:
            return self._find(qid)[2]

    def list_questions(self, paper_id: Optional[str] = None, status: Optional[str] = None,
                       subject: Optional[str] = None) -> list[Question]:
        if status is not None and status not in Q_STATUSES:
            raise ValueError("Status is pending, accepted or rejected.")
        with self._lock:
            papers = self._papers()
            if paper_id is not None:
                _check_id(paper_id)
            order = sorted(papers.values(), key=lambda p: (p.get("added") or "", p["id"]))
            out = []
            for p in order:                     # a questions file with no paper row is not listed (test T1)
                if paper_id is not None and p["id"] != paper_id:
                    continue
                if subject and p.get("subject") != subject:
                    continue
                out.extend(q for q in self._questions_of(p["id"]) if status is None or q["status"] == status)
            return out

    def update_questions(self, ids: list[str], changes: dict, by: str = "hand") -> list[Question]:
        """All the changes or none: every id and value is checked before the first write."""
        with self._lock:
            files: dict[str, list[dict]] = {}
            targets: list[tuple[str, dict]] = []
            for qid in dict.fromkeys(ids):
                pid, rows, _ = self._find(qid)
                rows = files.setdefault(pid, rows)
                targets.append((pid, next(r for r in rows if r["id"] == qid)))
            changed = []
            for pid, q in targets:
                new = self._apply(q, changes or {}, by)
                rows = files[pid]
                rows[rows.index(q)] = new
                changed.append(new)
            for pid, rows in files.items():
                self._save(self._qpath(pid), rows)
            return changed

    def _apply(self, q: dict, changes: dict, by: str) -> dict:
        new = dict(q)
        for k, v in changes.items():
            if k in _Q_FIXED:
                raise ValueError(f"A question's {k} cannot change.")
            if k == "status":
                if v not in Q_STATUSES:
                    raise ValueError("Status is pending, accepted or rejected.")
                new["status_by"] = by
            elif k == "text":
                new["text"] = v = _text(v)
                new["edited"] = True
                new["text_status"] = "verified" if v.strip() else "none"     # words he typed are words he read
                continue
            elif k == "marks":
                if v is None:
                    new["marks_source"] = "missing"
                else:
                    v = _num(v, "Marks")
                    new["marks_source"] = "hand"
                new["edited"] = True
            elif k == "type" and v not in Q_TYPES:
                raise ValueError("That kind of question is not one I know.")
            elif k == "difficulty" and v not in _DIFFICULTIES:
                raise ValueError("Difficulty is easy, medium or hard.")
            elif k == "unit":
                if v is not None and (isinstance(v, bool) or not isinstance(v, int) or v < 0):
                    raise ValueError("The unit is a whole number.")
            elif k in ("topic", "section"):
                if not isinstance(v, str) or len(v) > 200:
                    raise ValueError(f"The {k} is words of up to 200 characters.")
            new[k] = v
        if by == "hand" and ("unit" in changes or "topic" in changes) and "tag_source" not in changes:
            new["tag_source"] = "hand"
        if new["status"] == "accepted" and new.get("marks") is None:
            raise ValueError("Give its marks first.")            # a question without marks never reaches the bank
        new["updated"] = _now()
        return new

    def update_question(self, qid: str, changes: dict, by: str = "hand") -> Question:
        return self.update_questions([qid], changes, by)[0]

    def set_status(self, qid: str, status: str, by: str = "hand") -> None:
        self.update_question(qid, {"status": status}, by)

    def set_crop(self, qid: str, crop: Crop) -> Question:
        if not isinstance(crop, dict):
            raise ValueError("A crop is a page and a box.")
        png = str(crop.get("png") or "")
        if png and (".." in Path(png).parts or Path(png).is_absolute() or ":" in png or png.startswith(("/", "\\"))):
            raise ValueError("A crop picture stays inside the store.")
        bbox = crop.get("bbox")
        if bbox is not None and (not isinstance(bbox, (list, tuple)) or len(bbox) != 4
                                 or any(isinstance(x, bool) or not isinstance(x, (int, float)) for x in bbox)):
            raise ValueError("A crop box is four numbers.")
        with self._lock:
            pid, rows, q = self._find(qid)
            new = dict(q)
            new["crop"] = {**crop, "png": png.replace("\\", "/")}
            new["updated"] = _now()
            rows[rows.index(q)] = new
            self._save(self._qpath(pid), rows)
            return new

    def crop_path(self, qid: str) -> Optional[Path]:
        """The crop picture, or None when the question has none or the file is gone (test T3)."""
        q = self.get_question(qid)
        png = ((q.get("crop") or {}).get("png") or "")
        if not png:
            return None
        try:
            p = (self.root / png).resolve()
            p.relative_to(self.paths.crops.resolve())
        except (ValueError, OSError):
            return None
        return p if p.is_file() else None

    # ------------------------------------------------------------------ views over the questions
    def coverage(self, subject: str) -> Coverage:
        subject = ww_bank_store.slug(subject)
        with self._lock:
            papers = [p for p in self._papers().values() if p.get("subject") == subject]
            qs = [q for p in papers for q in self._questions_of(p["id"])]
        acc = [q for q in qs if q["status"] == "accepted"]
        n_acc = len(acc)
        return {"subject": subject, "papers": len(papers), "questions": len(qs),
                "pending": sum(q["status"] == "pending" for q in qs), "accepted": n_acc,
                "rejected": sum(q["status"] == "rejected" for q in qs),
                "tagged": sum(1 for q in acc if q.get("unit") is not None and q.get("topic")),
                "marks_missing": sum(1 for q in qs if q["status"] != "rejected" and q.get("marks") is None),
                "floor_papers": FLOOR_PAPERS, "floor_questions": FLOOR_QUESTIONS,
                "floor_met": len(papers) >= FLOOR_PAPERS and n_acc >= FLOOR_QUESTIONS}

    def bank_for(self, subject: str) -> list[dict]:
        """Accepted questions with text and marks, in the row shape ww_generator.generate reads.
        `sitting` is one per paper because the generator counts distinct sittings as papers."""
        subject = ww_bank_store.slug(subject)
        with self._lock:
            papers = {p["id"]: p for p in self._papers().values() if p.get("subject") == subject}
            rows = []
            for pid, p in papers.items():
                sitting = " ".join(x for x in (str(p.get("title") or ""), str(p.get("year") or "")) if x) or pid
                for q in self._questions_of(pid):
                    if q["status"] != "accepted" or not str(q.get("text") or "").strip() or q.get("marks") is None:
                        continue
                    rows.append({"id": q["id"], "question": q["text"], "unit": q.get("unit"), "topic": q.get("topic") or "",
                                 "marks": q["marks"], "section": q.get("section") or "", "tier": "exam",
                                 "type": q.get("type") or "unknown", "sitting": sitting, "origin": "own-paper"})
            return rows


_DEFAULTS: dict[str, Store] = {}
_DEFAULT_LOCK = threading.Lock()


def default_store() -> Store:
    """One Store per process at paths.DATA / "pyq". paths.DATA is fixed at import and the tests
    point it at a scratch folder, so it is read here, not at module load."""
    from .. import paths
    root = Path(paths.DATA) / "pyq"
    key = str(root)
    with _DEFAULT_LOCK:
        if key not in _DEFAULTS:
            _DEFAULTS[key] = Store(root)
        return _DEFAULTS[key]
