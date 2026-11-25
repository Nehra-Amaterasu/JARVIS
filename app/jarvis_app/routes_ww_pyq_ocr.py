"""/api/mission/pyq: OCR on demand for the pages of a paper that have no text layer (ww_pyq/ocr.py).

    GET    /api/mission/pyq/ocr                 R-28 the engine, the gate, the job, and how many papers and pages wait
    POST   /api/mission/pyq/papers/{pid}/ocr    R-48 {pages?: [n]} reads the waiting pages of one paper; 409 while a reading runs
    DELETE /api/mission/pyq/ocr                 R-49 stops after the page being read

OCR never starts by itself: a page takes about 14 s on the CPU, so he asks for a paper. What it reads arrives as pending
questions with text_status "unverified" and their confidence; a page under the gate (0.85) gives no question and stays a
picture. One OCR reading at a time, and none while the paper desk reads files, because both use the processor fully.
Every answer is the {state, reason, source, ...} envelope of ww_pyq/api.py.
"""
from __future__ import annotations

from typing import Optional

from fastapi import Body, FastAPI
from starlette.concurrency import run_in_threadpool

from .ww_pyq import api, ocr
from .ww_pyq import store as store_mod

SOURCE = "OCR on this PC"


def _plural(n: int, one: str, many: str) -> str:
    return f"{n} {one if n == 1 else many}"


def _waiting(store) -> dict:
    papers = pages = 0
    for p in store.list_papers():
        n = len(ocr.unread_pages(p))
        if n:
            papers, pages = papers + 1, pages + n
    return {"papers": papers, "pages": pages}


def answer(jobs: ocr.OcrJob, store, stopping: bool = False) -> dict:
    job = jobs.info()
    eng = ocr.engine_info()
    waiting = _waiting(store)
    extra = {"engine": eng, "gate": ocr.GATE, "job": job, "waiting": waiting}
    if job and job["status"] == "running":
        if stopping:
            return api.ok("waiting", "Stopping after the page being read.", SOURCE, **extra)
        return api.ok("live", f"Reading page {min(job['pages_done'] + 1, job['pages_total'])} of {job['pages_total']}.", SOURCE, **extra)
    if job and job["status"] == "failed":
        return api.ok("fault", job.get("error") or "OCR did not finish.", SOURCE, **extra)
    if not eng["installed"]:
        return api.ok("fault", "No OCR engine is installed.", SOURCE, **extra)
    if job:
        below = job["pages_below_gate"]
        text = (f"Read {job['pages_read']} of {_plural(job['pages_total'], 'page', 'pages')}: {_plural(job['questions'], 'draft', 'drafts')} to review"
                + (f"; {_plural(below, 'page was', 'pages were')} below {ocr.GATE:.2f} and {'is' if below == 1 else 'are'} left as {'a picture' if below == 1 else 'pictures'}" if below else "")
                + ("; stopped before the end." if job["status"] == "stopped" else "."))
        return api.ok("live", text, SOURCE, **extra)
    if waiting["pages"]:
        return api.ok("waiting", f"{_plural(waiting['papers'], 'paper has', 'papers have')} {_plural(waiting['pages'], 'page', 'pages')} with no text layer.", SOURCE, **extra)
    return api.ok("waiting", "No page is waiting for OCR.", SOURCE, **extra)


def register(app: FastAPI, svc, bus) -> None:
    jobs = ocr.OcrJob(bus)
    app.state.pyq_ocr = jobs

    def store():
        return store_mod.default_store()

    @app.get("/api/mission/pyq/ocr")
    async def ocr_status():
        return await run_in_threadpool(api.guard, lambda: answer(app.state.pyq_ocr, store()))

    @app.post("/api/mission/pyq/papers/{pid}/ocr")
    async def ocr_start(pid: str, payload: Optional[dict] = Body(None)):
        def work():
            pages = (payload or {}).get("pages")
            if pages is not None:
                if not isinstance(pages, list) or not pages or len(pages) > 2000 or \
                        any(isinstance(n, bool) or not isinstance(n, int) or not 1 <= n <= 9999 for n in pages):
                    raise ValueError("pages is a list of page numbers.")
            desk = getattr(app.state, "pyq_ingest", None)
            if desk is not None and desk.running():
                raise api.Busy("The paper desk is reading files; start OCR when it has finished.")
            app.state.pyq_ocr.start(store(), pid, pages)
            return answer(app.state.pyq_ocr, store())
        return await run_in_threadpool(api.guard, work)

    @app.delete("/api/mission/pyq/ocr")
    async def ocr_stop():
        def work():
            if not app.state.pyq_ocr.stop():
                raise ValueError("No OCR reading is running.")
            return answer(app.state.pyq_ocr, store(), stopping=True)
        return await run_in_threadpool(api.guard, work)
