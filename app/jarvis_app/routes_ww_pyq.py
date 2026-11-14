"""/api/mission/pyq: his own papers as a private review queue (store in ww_pyq/store.py).

    GET    /api/mission/pyq/papers?subject=                 R-01 papers on file with counts of their questions
    POST   /api/mission/pyq/papers                          R-02 type a paper in: {title, subject?, year?, exam_kind?, source_note?, questions?}
    GET    /api/mission/pyq/papers/{pid}                    R-03 one paper, its counts and which page pictures exist
    PATCH  /api/mission/pyq/papers/{pid}                    R-04 edit title, subject, year, exam_kind or source_note
    DELETE /api/mission/pyq/papers/{pid}                    R-05 remove a paper with its questions and crops
    GET    /api/mission/pyq/questions?paper=&subject=&status=&limit=&offset=   R-06 questions in review or accepted
    PATCH  /api/mission/pyq/questions                       R-07 {ids, set}: accept, reject or correct questions, all or none
    GET    /api/mission/pyq/crops/{qid}                     R-08 the page crop of a question as image/png
    GET    /api/mission/pyq/coverage?subject=               R-09 what a subject has, against the floor for a pattern
    GET    /api/mission/pyq/folder                          R-10 the watched folder and the files in it not read yet
    PUT    /api/mission/pyq/folder                          R-11 {path}: choose the folder, or null to stop

Every JSON answer is {state, reason, source, ...} (ww_pyq/api.py); the screen prints `reason` as it is.
A question without marks cannot be accepted ("Give its marks first."), and a PATCH naming one unknown
id changes nothing. Nothing here predicts a paper or a result. The store is read at request time through
the module (ww_pyq.store.default_store) so a test can point it at a scratch folder.
"""
from __future__ import annotations

from typing import Any, Optional

from fastapi import Body, FastAPI, HTTPException, Query
from fastapi.responses import FileResponse
from starlette.concurrency import run_in_threadpool

from . import ww_bank_store
from .ww_pyq import api, folder
from .ww_pyq import store as store_mod
from .ww_pyq.schema import EXAM_KINDS, MAX_TEXT, Q_STATUSES, Q_TYPES

SOURCE = "your papers on file"
_PAPER_FIELDS = ("title", "subject", "year", "exam_kind", "source_note")
_Q_FIELDS = ("status", "text", "marks", "type", "unit", "topic", "section", "difficulty")
_MAX_TYPED = 300           # questions typed into one paper; a bigger paper comes through the file reader
_MAX_IDS = 200


def _store():
    return store_mod.default_store()


def _plural(n: int, one: str, many: str) -> str:
    return f"{n} {one if n == 1 else many}"


def _counts(qs: list[dict]) -> dict:
    return {"questions": len(qs), "pending": sum(q["status"] == "pending" for q in qs),
            "accepted": sum(q["status"] == "accepted" for q in qs),
            "rejected": sum(q["status"] == "rejected" for q in qs),
            "marks_missing": sum(1 for q in qs if q.get("marks") is None)}


def _subject(value: Optional[str]) -> Optional[str]:
    if value in (None, ""):
        return None
    return ww_bank_store.slug(value)               # ValueError -> 400 with its own sentence


def _typed_draft(i: int, row: Any) -> dict:
    if not isinstance(row, dict):
        raise ValueError(f"Question {i}: give its text and marks.")
    text = row.get("text")
    if not isinstance(text, str) or not text.strip():
        raise ValueError(f"Question {i} has no text.")
    if len(text) > MAX_TEXT:
        raise ValueError(f"Question {i}: a question is at most {MAX_TEXT} characters.")
    marks = row.get("marks")
    d = {"label": str(i), "text": text, "text_status": "verified", "marks": marks,
         "marks_source": "hand" if marks is not None else "missing",
         "type": row.get("type") or "unknown", "section": str(row.get("section") or "")}
    if d["type"] not in Q_TYPES:
        raise ValueError(f"Question {i}: that kind of question is not one I know.")
    if len(d["section"]) > 8:
        raise ValueError(f"Question {i}: a section is a short letter.")
    return d


def _folder_answer(st: dict) -> dict:
    if not st.get("path"):
        return api.ok("waiting", "No folder chosen.", "the folder you chose", folder=st)
    if not st.get("exists"):
        return api.ok("fault", "The folder is not there.", "the folder you chose", folder=st)
    n = len(st.get("pending_files") or [])
    if n:
        return api.ok("waiting", f"{_plural(n, 'file', 'files')} not read yet.", "the folder you chose", folder=st)
    return api.ok("live", "Nothing new in the folder.", "the folder you chose", folder=st)


def register(app: FastAPI, svc, bus) -> None:
    def publish(text: str) -> None:
        try:
            bus.publish("mission", "update", text[:140])
        except Exception:
            pass

    # ------------------------------------------------------------------ papers
    @app.get("/api/mission/pyq/papers")
    async def papers(subject: Optional[str] = None):
        def work():
            s = _subject(subject)
            st = _store()
            by_paper: dict[str, list] = {}
            for q in st.list_questions(subject=s):
                by_paper.setdefault(q["paper_id"], []).append(q)
            rows = [{**p, "counts": _counts(by_paper.get(p["id"], []))} for p in st.list_papers(s)]
            if not rows:
                return api.items(rows, "waiting", "No papers on file yet.", SOURCE)
            return api.items(rows, "live", f"{_plural(len(rows), 'paper', 'papers')} on file.", SOURCE)
        return await run_in_threadpool(api.guard, work)

    @app.post("/api/mission/pyq/papers")
    async def add_paper(body: dict = Body(...)):
        def work():
            title = body.get("title")
            if not isinstance(title, str) or not title.strip():
                raise ValueError("Give the paper a title.")
            if len(title) > 200:
                raise ValueError("A title is at most 200 characters.")
            exam_kind = body.get("exam_kind") or "other"
            if exam_kind not in EXAM_KINDS:
                raise ValueError("That kind of exam is not one I know.")
            year = body.get("year")
            if year is not None and (isinstance(year, bool) or not isinstance(year, int) or not 1900 <= year <= 2200):
                raise ValueError("The year must be a whole year.")
            rows = body.get("questions") or []
            if not isinstance(rows, list) or len(rows) > _MAX_TYPED:
                raise ValueError(f"A typed paper holds up to {_MAX_TYPED} questions.")
            drafts = [_typed_draft(i, r) for i, r in enumerate(rows, 1)]
            st = _store()
            meta = {"kind": "hand", "method": "typed", "title": title.strip(), "subject": _subject(body.get("subject")) or "",
                    "exam_kind": exam_kind, "year": year, "pages": 0, "faults": [],
                    "source_note": str(body.get("source_note") or "manual drop-in")[:500]}
            pid = st.add_paper(meta)
            try:
                ids = st.add_questions(pid, drafts)
            except Exception:
                st.delete_paper(pid)                    # a half-saved paper would confuse the review list
                raise
            publish(f"paper added: {meta['title']}")
            return api.ok("live", f"Saved {_plural(len(ids), 'question', 'questions')} on this paper.", "what you typed",
                          paper=st.get_paper(pid), question_ids=ids)
        return await run_in_threadpool(api.guard, work)

    @app.get("/api/mission/pyq/papers/{pid}")
    async def paper(pid: str):
        def work():
            st = _store()
            p = st.get_paper(pid)
            qs = st.list_questions(paper_id=pid)
            pages = [{"n": n, "png": (st.paths.pages / pid / f"p{n:03d}.png").is_file()}
                     for n in range(1, int(p.get("pages") or 0) + 1)]
            extra = {"paper": p, "counts": _counts(qs), "pages": pages}
            if p.get("faults"):
                return api.ok("fault", "; ".join(str(f) for f in p["faults"]), SOURCE, **extra)
            return api.ok("live", f"{_plural(len(qs), 'question', 'questions')} on this paper.", SOURCE, **extra)
        return await run_in_threadpool(api.guard, work)

    @app.patch("/api/mission/pyq/papers/{pid}")
    async def patch_paper(pid: str, body: dict = Body(...)):
        def work():
            bad = [k for k in body if k not in _PAPER_FIELDS]
            if bad:
                raise ValueError(f"A paper's {bad[0]} cannot be changed here.")
            if not body:
                raise ValueError("Nothing to change.")
            p = _store().update_paper(pid, body)
            return api.ok("live", "Paper updated.", SOURCE, paper=p)
        return await run_in_threadpool(api.guard, work)

    @app.delete("/api/mission/pyq/papers/{pid}")
    async def delete_paper(pid: str):
        def work():
            st = _store()
            st.get_paper(pid)                           # 404 before anything is counted
            qs = st.list_questions(paper_id=pid)
            crops = sum(1 for q in qs if st.crop_path(q["id"]) is not None)
            st.delete_paper(pid)
            publish("paper removed")
            return api.ok("live", f"Removed the paper and {_plural(len(qs), 'question', 'questions')}.", SOURCE,
                          removed={"questions": len(qs), "crops": crops})
        return await run_in_threadpool(api.guard, work)

    # ------------------------------------------------------------------ questions
    @app.get("/api/mission/pyq/questions")
    async def questions(paper: Optional[str] = None, subject: Optional[str] = None, status: Optional[str] = None,
                        limit: int = Query(100), offset: int = Query(0)):
        def work():
            st = _store()
            if status in ("",):
                status_ = None
            else:
                status_ = status
            rows = st.list_questions(paper_id=paper or None, status=status_, subject=_subject(subject))
            total = len(rows)
            lo, n = max(0, offset), max(1, min(limit, 500))
            page = [{**q, "has_crop": st.crop_path(q["id"]) is not None} for q in rows[lo:lo + n]]
            if not total:
                return api.items(page, "waiting", "No questions match.", SOURCE, total=0)
            return api.items(page, "live", f"{_plural(total, 'question', 'questions')}.", SOURCE, total=total)
        return await run_in_threadpool(api.guard, work)

    @app.patch("/api/mission/pyq/questions")
    async def patch_questions(body: dict = Body(...)):
        def work():
            ids, changes = body.get("ids"), body.get("set")
            if not isinstance(ids, list) or not ids or not all(isinstance(i, str) for i in ids):
                raise ValueError("Give the ids of the questions to change.")
            if len(ids) > _MAX_IDS:
                raise ValueError(f"Change up to {_MAX_IDS} questions at once.")
            if not isinstance(changes, dict) or not changes:
                raise ValueError("Say what to set.")
            bad = [k for k in changes if k not in _Q_FIELDS]
            if bad:
                raise ValueError(f"A question's {bad[0]} cannot be set here.")
            if "status" in changes and changes["status"] not in Q_STATUSES:
                raise ValueError("Status is pending, accepted or rejected.")
            rows = _store().update_questions(ids, changes, "hand")
            publish(f"{len(rows)} questions reviewed")
            return api.items(rows, "live", f"Changed {_plural(len(rows), 'question', 'questions')}.", SOURCE)
        return await run_in_threadpool(api.guard, work)

    @app.get("/api/mission/pyq/crops/{qid}")
    async def crop(qid: str):
        def work():
            try:
                p = _store().crop_path(qid)
            except KeyError:
                p = None
            if p is None:
                raise HTTPException(404, "No crop for this question.")
            return p
        p = await run_in_threadpool(work)
        return FileResponse(p, media_type="image/png")

    # ------------------------------------------------------------------ coverage and folder
    @app.get("/api/mission/pyq/coverage")
    async def coverage(subject: Optional[str] = None):
        def work():
            if not subject:
                raise ValueError("Say which subject.")
            cov = _store().coverage(subject)
            need_p = max(0, cov["floor_papers"] - cov["papers"])
            need_q = max(0, cov["floor_questions"] - cov["accepted"])
            if cov["floor_met"]:
                return api.ok("live", f"{_plural(cov['papers'], 'paper', 'papers')}, {cov['accepted']} reviewed questions.", SOURCE, coverage=cov)
            parts = ([f"{need_p} more {'paper' if need_p == 1 else 'papers'}"] if need_p else []) \
                + ([f"{need_q} more reviewed {'question' if need_q == 1 else 'questions'}"] if need_q else [])
            return api.ok("waiting", ", ".join(parts) + ".", SOURCE, coverage=cov)
        return await run_in_threadpool(api.guard, work)

    @app.get("/api/mission/pyq/folder")
    async def get_folder():
        return await run_in_threadpool(api.guard, lambda: _folder_answer(folder.scan(_store())))

    @app.put("/api/mission/pyq/folder")
    async def put_folder(body: dict = Body(...)):
        def work():
            if "path" not in body:
                raise ValueError("Give the folder as a full path, or null to stop watching.")
            return _folder_answer(folder.set_folder(_store(), body["path"]))
        return await run_in_threadpool(api.guard, work)
