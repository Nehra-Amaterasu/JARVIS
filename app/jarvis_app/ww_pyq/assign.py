"""Which subject a paper belongs to, and the counts that say how ready his store is (wave EW11 B2, R-65 and R-66).

    load_manifest()                                   -> (manifest or None, fault sentence)  the Classroom manifest, read only
    classroom_file(manifest, paper)                   -> the Classroom file record a paper came from, or None
    counts(store, subjects, manifest)                 -> R-65 {papers, without_subject, ..., by_subject, courses}
    propose(store, subjects, manifest, apply, use_model, model, limit) -> R-66 {items, counts, courses}

A paper is linked to its Classroom file by the file record's `paper_id` (written by the hand-off to the paper desk, G-13 and
the end of a sync), and failing that by the SHA-256 of the fetched original, which is the hash the desk files the paper
under. The course is that record's `course`; its subject is the course's `subject` in the manifest (G-07 sets it).

The subject rules, in order, each saying which one spoke (measured 28 Nov: rules alone find 3 of the 72 papers without one):
  course  the Classroom course its file came from, when that course is mapped to one of his subjects
  code    a subject's course code (letters and digits only, at least 4) in the title, the file name or the first questions
  name    a subject's full name, as words, in the same places; a one-word name only in the title or file name, because a
          word such as "Signals" turns up inside questions of other subjects
  model   only with use_model: the model chooses among his subject ids or "none" from the title and the first 600
          characters of the paper, and nothing else is sent
Two subjects matched by the same rule is no proposal. With apply, course and code and name are written as the subject
(subject_source "rule", subject_rule naming the rule); a model pick only as subject_suggestion (with subject_suggestion_model)
for him to press. A paper that has a subject is never touched: whatever set it, he chose or kept it.
"""
from __future__ import annotations

import re
from collections import Counter
from typing import Optional

from . import next as pnext
from .prep import Model, ask
from .store import Store

OPENING = 600
FIRST_QUESTIONS = 3
MIN_CODE = 4                   # a two- or three-character code ("EC") matches inside ordinary words
NOT_THIS_TERM = "not this term"
MAX_PAPERS = 200


def _norm(s: str) -> str:
    return re.sub(r"[^a-z0-9]", "", str(s or "").lower())


def _words(s: str) -> str:
    return " ".join(re.findall(r"[a-z0-9]+", str(s or "").lower()))


def load_manifest() -> tuple[Optional[dict], str]:
    """The Classroom manifest as the sync wrote it, read only. (None, sentence) when there is none or it is damaged."""
    from ..ww_gcr import sync as gsync
    try:
        m = gsync.GcrStore().manifest()
    except gsync.ManifestError as e:
        return None, str(e)
    except OSError as e:
        return None, f"The Classroom manifest could not be read ({type(e).__name__})."
    return m, ""


def _subject_ids(subjects: list[dict]) -> dict[str, dict]:
    return {str(s["id"]).lower(): s for s in subjects if s.get("id")}


def classroom_file(manifest: Optional[dict], paper: dict) -> Optional[dict]:
    if not manifest:
        return None
    files = manifest.get("files") or {}
    by_id = [r for r in files.values() if isinstance(r, dict) and r.get("paper_id") == paper["id"]]
    if by_id:
        return by_id[0]
    sha = paper.get("sha256")
    if sha:
        by_sha = [r for r in files.values() if isinstance(r, dict) and r.get("sha256") == sha]
        if by_sha:
            return by_sha[0]
    return None


def course_subject(manifest: Optional[dict], rec: Optional[dict]) -> str:
    if not manifest or not rec:
        return ""
    c = (manifest.get("courses") or {}).get(rec.get("course")) or {}
    return str(c.get("subject") or "").lower()


def _by_text(subjects: dict[str, dict], short: str, long: str) -> tuple[str, str, list[str]]:
    """(subject id, rule, every id that matched) from a code or a name; ("", "", ids) when none or more than one."""
    for rule in ("code", "name"):
        hits = []
        for sid, s in subjects.items():
            if rule == "code":
                code = _norm(s.get("code"))
                if len(code) >= MIN_CODE and (code in _norm(short) or code in _norm(long)):
                    hits.append(sid)
            else:
                name = _words(s.get("name"))
                if not name:
                    continue
                pat = re.compile(r"\b" + re.escape(name) + r"\b")
                where = f"{_words(short)} | {_words(long)}" if len(name.split()) >= 2 else _words(short)
                if pat.search(where):
                    hits.append(sid)
        if len(hits) == 1:
            return hits[0], rule, hits
        if hits:
            return "", rule, hits
    return "", "", []


def _first_text(store: Store, pid: str) -> str:
    return " ".join(str(q.get("text") or "") for q in store.list_questions(paper_id=pid)[:FIRST_QUESTIONS])


def _opening(store: Store, paper: dict) -> str:
    """The first 600 characters of the paper: its first page's text layer when the original PDF is on file, else its first
    questions. This, with the title, is all the model is shown."""
    sha = str(paper.get("sha256") or "")
    p = store.paths.originals / f"{sha}.pdf"
    if sha and re.fullmatch(r"[0-9a-f]{64}", sha) and p.is_file():
        try:
            from .ingest import read_pdf_text
            text = read_pdf_text(p.read_bytes(), 1, 1)
            if text.strip():
                return re.sub(r"\s+", " ", text).strip()[:OPENING]
        except Exception:
            pass
    return re.sub(r"\s+", " ", _first_text(store, paper["id"])).strip()[:OPENING]


# ------------------------------------------------------------------ R-65
def counts(store: Store, subjects: list[dict], manifest: Optional[dict], fault: str = "") -> dict:
    names = {sid: str(s.get("name") or sid) for sid, s in _subject_ids(subjects).items()}
    papers = store.list_papers()
    by: dict[str, dict] = {}
    blank = {"papers": 0, "questions": 0, "pending": 0, "accepted": 0, "with_marks": 0, "tagged": 0, "sheet_ready_topics": 0}
    for sid in names:
        by[sid] = {"subject": sid, "name": names[sid], **blank}
    for p in papers:
        sid = str(p.get("subject") or "")
        if not sid:
            continue
        row = by.setdefault(sid, {"subject": sid, "name": names.get(sid, sid), **blank})
        row["papers"] += 1
        for q in store.list_questions(paper_id=p["id"]):
            row["questions"] += 1
            row["pending"] += q.get("status") == "pending"
            row["accepted"] += q.get("status") == "accepted"
            row["with_marks"] += q.get("marks") is not None
            row["tagged"] += q.get("unit") is not None and bool(str(q.get("topic") or "").strip())
    for sid, row in by.items():
        # a topic can stand on an evening sheet when it has 3 accepted questions with text and marks (next.MIN_QUESTIONS)
        per = Counter((r["unit"], r["topic"]) for r in store.bank_for(sid) if r.get("unit") is not None and r.get("topic"))
        row["sheet_ready_topics"] = sum(1 for n in per.values() if n >= pnext.MIN_QUESTIONS)
    total = {k: 0 for k in blank}
    loose = [p for p in papers if not p.get("subject")]
    for p in loose:
        for q in store.list_questions(paper_id=p["id"]):
            total["questions"] += 1
            total["pending"] += q.get("status") == "pending"
            total["accepted"] += q.get("status") == "accepted"
            total["with_marks"] += q.get("marks") is not None
            total["tagged"] += q.get("unit") is not None and bool(str(q.get("topic") or "").strip())
    for row in by.values():
        for k in blank:
            total[k] += row[k] if k != "papers" else 0
    total["papers"] = len(papers)
    if manifest is None:
        courses = {"mapped": None, "unmapped": None, "state": "fault" if fault else "waiting",
                   "reason": fault or "No Classroom sync on file."}
    else:
        cs = manifest.get("courses") or {}
        mapped = sum(1 for c in cs.values() if isinstance(c, dict) and c.get("subject"))
        courses = {"mapped": mapped, "unmapped": len(cs) - mapped, "state": "live", "reason": ""}
    return {**total, "without_subject": len(loose), "by_subject": sorted(by.values(), key=lambda r: r["subject"]),
            "courses": courses}


# ------------------------------------------------------------------ R-66
def _course_rows(subjects: dict[str, dict], manifest: Optional[dict]) -> list[dict]:
    out = []
    for cid, c in sorted(((manifest or {}).get("courses") or {}).items()):
        if not isinstance(c, dict) or c.get("subject"):
            continue
        title = " ".join(str(c.get(k) or "") for k in ("name", "section"))
        sid, rule, hits = _by_text(subjects, title, "")
        out.append({"id": cid, "name": str(c.get("name") or ""), "suggestion": sid or NOT_THIS_TERM, "rule": rule if sid else "",
                    "matched": hits if not sid else []})
    return out


def propose(store: Store, subjects: list[dict], manifest: Optional[dict], *, apply: bool, use_model: bool, model: Model,
            limit: int = MAX_PAPERS) -> dict:
    if not isinstance(apply, bool) or not isinstance(use_model, bool):
        raise ValueError("Apply and use_model are true or false.")
    if isinstance(limit, bool) or not isinstance(limit, int) or not 1 <= limit <= MAX_PAPERS:
        raise ValueError(f"The limit is between 1 and {MAX_PAPERS}.")
    subs = _subject_ids(subjects)
    listing = "\n".join(f"{sid}: {s.get('name') or sid}" for sid, s in subs.items())
    tally = Counter()
    items = []
    asked = 0
    for p in store.list_papers():
        if p.get("subject"):
            tally["has_subject"] += 1
            continue
        item = {"paper": p["id"], "title": p.get("title") or "", "subject": "", "rule": "", "written": "", "reason": ""}
        sid = course_subject(manifest, classroom_file(manifest, p))
        rule = "course" if sid in subs else ""
        if not rule:
            sid, rule, hits = _by_text(subs, f"{p.get('title') or ''} {p.get('filename') or ''}", _first_text(store, p["id"]))
            if hits and not sid:
                item["reason"] = f"The {rule} of more than one subject is on it ({', '.join(hits)}); left for you."
                rule = ""
        kept = str(p.get("subject_suggestion") or "")
        if not sid and use_model and model.mode != "off" and kept in subs and p.get("subject_suggestion_model") == model.name:
            sid, rule = kept, "model"                    # this model was asked before: its pick is on file, not asked twice
        elif not sid and use_model and model.mode != "off" and asked < limit and subs:
            asked += 1
            ans = ask("subject_pick", {"title": str(p.get("title") or "")[:200], "opening": _opening(store, p),
                                       "subjects": listing, "subject_ids": ",".join(subs)}, model)
            if ans is None:
                tally["model_failed"] += 1
                item["reason"] = "The model did not answer in the shape asked; nothing changed."
            elif ans["subject"] == "none":
                item["reason"] = "The model found none of your subjects in it."
            elif not ans["subject"]:
                tally["model_dropped"] += 1
                item["reason"] = "The model named a subject that is not one of yours; dropped."
            else:
                sid, rule = ans["subject"], "model"
        if sid and rule:
            item.update(subject=sid, rule=rule)
            tally[rule] += 1
            if rule == "model":
                item["reason"] = f"The model ({model.name}) suggests {sid}; it waits for your press."
                if apply and (p.get("subject_suggestion") != sid or p.get("subject_suggestion_model") != model.name):
                    store.update_paper(p["id"], {"subject_suggestion": sid, "subject_suggestion_model": model.name})
                if apply:
                    item["written"] = "suggestion"
            else:
                item["reason"] = {"course": "Its Classroom course is mapped to this subject.",
                                  "code": "The subject's course code is on it.", "name": "The subject's name is on it."}[rule]
                if apply:
                    fresh = store.get_paper(p["id"])
                    if not fresh.get("subject"):         # he may have chosen one while this ran
                        store.update_paper(p["id"], {"subject": sid, "subject_source": "rule", "subject_rule": rule})
                        item["written"] = "subject"
        else:
            tally["none"] += 1
            item["reason"] = item["reason"] or "No rule found a subject."
        items.append(item)
    return {"items": items, "counts": {k: tally.get(k, 0) for k in ("course", "code", "name", "model", "none", "has_subject",
                                                                      "model_failed", "model_dropped")},
            "asked": asked, "courses": _course_rows(subs, manifest)}
