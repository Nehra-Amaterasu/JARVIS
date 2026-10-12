"""The study library over HTTP (ROADMAP Y5 / SIH-4): my notes, asked with citations.

    GET    /api/library               status, documents, and the ingest in progress
    POST   /api/library/ingest        {path}: a file or folder on this PC, read in the background
    GET    /api/library/job           that ingest's progress
    POST   /api/library/ask           {question, k}: an answer whose [n] map to file + page
    DELETE /api/library/doc/{doc_id}  forget one document (the file itself is untouched)

The library itself is yaadash/library.py. Reading a folder of PDFs takes a while (the
embedder alone loads in ~13 s), so ingest runs in a thread and the UI polls /job;
one ingest at a time. The path comes from me, typed into my own window behind the
token guard; it is still checked (absolute, exists, a supported type, not a whole
drive) and nothing outside it is read.
"""
from __future__ import annotations

import threading
import time
from pathlib import Path
from typing import Callable, Optional

from fastapi import Body, FastAPI, HTTPException
from starlette.concurrency import run_in_threadpool

from .paths import ensure_jarvis_importable

MAX_QUESTION = 500
KINDS = "PDF, Word (.docx), PowerPoint (.pptx), Markdown and text files"


class IngestJob:
    """One background ingest and its progress, for the UI to poll."""

    def __init__(self, get_lib: Callable, bus):
        self._get_lib, self._bus = get_lib, bus
        self._lock = threading.Lock()
        self._thread: Optional[threading.Thread] = None
        self._state: dict = {"state": "idle"}

    def info(self) -> dict:
        with self._lock:
            return dict(self._state)

    def start(self, path: str) -> dict:
        with self._lock:
            if self._state.get("state") == "running":
                raise RuntimeError("Already reading notes — wait for that to finish.")
            self._state = {"state": "running", "path": path, "done": 0, "total": None,
                           "current": None, "started": time.time()}
            self._thread = threading.Thread(target=self._run, args=(path,), daemon=True,
                                            name="library-ingest")
            self._thread.start()
        return self.info()

    def wait(self, timeout: float = 60) -> dict:
        """For tests: block until the running ingest ends."""
        t = self._thread
        if t is not None:
            t.join(timeout)
        return self.info()

    def _progress(self, p: dict) -> None:
        with self._lock:
            self._state.update(done=p["done"], total=p["total"], current=p["current"])
        last = p.get("last")
        if last and last.get("status") in ("added", "updated"):
            pages = f"{last['pages']} pages, " if last.get("pages") else ""
            self._bus.publish("memory", "library", f"Library: read {last['file']} — {pages}"
                              f"{last.get('chunks', 0)} passages", file=last["file"])

    def _run(self, path: str) -> None:
        try:
            rep = self._get_lib().ingest(path, progress=self._progress)
        except Exception as e:                        # report it; never kill the server
            with self._lock:
                self._state.update(state="failed", error=f"{type(e).__name__}: {e}"[:300],
                                   finished=time.time())
            self._bus.publish("memory", "error", f"Library: could not read {Path(path).name} — {e}"[:200])
            return
        c = rep["counts"]
        problems = [r for r in rep["results"] if r["status"] in ("failed", "skipped")]
        with self._lock:
            self._state.update(state="done", finished=time.time(), counts=c,
                               took_s=rep["took_s"], files=rep["files"],
                               problems=[{k: r.get(k) for k in ("file", "status", "note")} for r in problems[:20]])
        new = c.get("added", 0) + c.get("updated", 0)
        self._bus.publish("memory", "library",
                          f"Library: {new} new or changed, {c.get('unchanged', 0)} unchanged"
                          + (f", {len(problems)} not read" if problems else "")
                          + f" ({rep['took_s']:.0f} s)", counts=c)


def check_path(raw: str) -> Path:
    """The path I typed, or HTTPException(400) saying what is wrong with it."""
    import library
    p = Path((raw or "").strip().strip('"').strip("'")).expanduser()
    if not str(p) or not p.is_absolute():
        raise HTTPException(400, "Give the full path of a file or folder on this PC, e.g. D:\\Notes\\Sem 5.")
    if not p.exists():
        raise HTTPException(400, f"No such file or folder: {p}")
    if p.is_dir() and p.parent == p:
        raise HTTPException(400, "Pick a folder of notes, not a whole drive.")
    if p.is_file() and p.suffix.lower() not in library.SUPPORTED:
        raise HTTPException(400, f"JARVIS reads {KINDS}; {p.suffix or 'this file'} is not one of them.")
    return p


def register(app: FastAPI, svc, bus) -> None:
    ensure_jarvis_importable()

    def lib():
        # Built on first use, so starting the app never touches the library folder,
        # and a test can put its own Library in app.state.library first.
        if getattr(app.state, "library", None) is None:
            import library
            app.state.library = library.Library()
        return app.state.library

    jobs = IngestJob(lib, bus)
    app.state.library_jobs = jobs

    @app.get("/api/library")
    async def library_view():
        def view():
            lb = lib()
            return {**lb.status(), "docs": lb.documents()}
        out = await run_in_threadpool(view)
        out["job"] = jobs.info()
        return out

    @app.get("/api/library/job")
    def library_job():
        return jobs.info()

    @app.post("/api/library/ingest")
    def library_ingest(path: str = Body(..., embed=True)):
        p = check_path(path)
        try:
            return jobs.start(str(p))
        except RuntimeError as e:
            raise HTTPException(409, str(e))

    @app.post("/api/library/ask")
    async def library_ask(question: str = Body(..., embed=True), k: int = Body(5, embed=True)):
        q = (question or "").strip()
        if not q:
            raise HTTPException(400, "Ask a question.")
        if len(q) > MAX_QUESTION:
            raise HTTPException(400, f"Keep the question under {MAX_QUESTION} characters.")
        res = await run_in_threadpool(lib().ask, q, max(1, min(int(k), 8)))
        short = q[:40] + ("…" if len(q) > 40 else "")
        if res.get("abstained"):
            bus.publish("memory", "library", f"Library: “{short}” — not in my notes, said so")
        elif res.get("llm_error"):
            bus.publish("memory", "error", f"Library: model down; showed {len(res['sources'])} passages for “{short}”")
        else:
            bus.publish("memory", "library", f"Library: answered “{short}” citing {len(res['used'])} passage(s)"
                        + (" — UNCITED" if res.get("uncited") else ""))
        return res

    @app.delete("/api/library/doc/{doc_id}")
    async def library_forget(doc_id: str):
        ok = await run_in_threadpool(lib().remove, doc_id)
        if not ok:
            raise HTTPException(404, "No such document in the library.")
        bus.publish("memory", "library", "Library: forgot a document (the file itself is untouched)")
        return {"ok": True}
