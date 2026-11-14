"""/api/mission/pyq: reading his papers and slide decks into the review queue (ww_pyq/ingest.py).

    POST   /api/mission/pyq/ingest                          R-12 {path} or {folder: true}, optional {subject, year, exam_kind, source_note}
    GET    /api/mission/pyq/ingest/{job}                    R-13 a reading job: progress, files, trace ("last" is the latest)
    PUT    /api/mission/pyq/crops/{qid}                     R-14 {bbox}: move a crop's edges, cut again from the stored page picture
    POST   /api/mission/pyq/upload?name=&subject=&year=     R-15 the raw bytes of one .pdf or .pptx (40 MB at most), saved in inbox/ and read

Every JSON answer is {state, reason, source, ...} (ww_pyq/api.py). Reading runs in one background
thread, one job at a time (409 while one runs), so a route answers at once with the job and the
screen polls R-13. A path he types is checked like routes_library.check_path (absolute, there, a
file, .pdf or .pptx) and only that file is read; {folder: true} reads only the files of the chosen
folder that are not on file yet (ww_pyq/folder.py). An upload is written under the store's inbox/
and nowhere else. Nothing here predicts a paper or a result.
"""
from __future__ import annotations

import os
import re
import uuid
from pathlib import Path
from typing import Optional

from fastapi import Body, FastAPI, HTTPException, Request
from starlette.concurrency import run_in_threadpool

from . import ww_bank_store
from .ww_pyq import api, crops, folder, ingest
from .ww_pyq import store as store_mod
from .ww_pyq.schema import CROP_DPI, EXAM_KINDS

SOURCE = "your papers on file"
MAX_UPLOAD = 40 * 1024 * 1024      # R-15: a scanned 30-page paper is about 15 MB; 40 MB is room without being a disk filler
MIN_SIDE = 8.0                     # pt: R-14, a crop narrower than this holds no readable line
_EDGE = 1.0                        # pt a box may pass the page edge (the page size is read back from a 150 dpi PNG)
# used with fullmatch: "$" alone also matches before a final newline, and a name ending in a newline then reached the filesystem
_NAME = re.compile(r"^[A-Za-z0-9][A-Za-z0-9 ._()-]{0,119}\.(pdf|pptx)$")
_DEVICE = re.compile(r"^(?:con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\.|$)", re.I)   # Windows opens these names as devices, with any extension
_MAGIC = {".pdf": b"%PDF-", ".pptx": b"PK\x03\x04"}
_META = ("subject", "year", "exam_kind", "source_note")


def _store():
    return store_mod.default_store()


def _plural(n: int, one: str, many: str) -> str:
    return f"{n} {one if n == 1 else many}"


def _meta(body: dict) -> dict:
    """The optional paper fields, refused with a sentence before any job starts."""
    out = {}
    s = body.get("subject")
    if s not in (None, ""):
        out["subject"] = ww_bank_store.slug(s)
    y = body.get("year")
    if y not in (None, ""):
        if isinstance(y, str) and y.strip().isdigit():
            y = int(y.strip())
        if isinstance(y, bool) or not isinstance(y, int) or not 1900 <= y <= 2200:
            raise ValueError("The year must be a whole year.")
        out["year"] = y
    k = body.get("exam_kind")
    if k not in (None, ""):
        if k not in EXAM_KINDS:
            raise ValueError("That kind of exam is not one I know.")
        out["exam_kind"] = k
    n = body.get("source_note")
    if n not in (None, ""):
        if not isinstance(n, str) or len(n) > 500:
            raise ValueError("The source note is at most 500 characters.")
        out["source_note"] = n
    return out


def check_path(raw) -> Path:
    """The file he typed: absolute, there, a file, a .pdf or a .pptx (the routes_library rule)."""
    if not isinstance(raw, str) or not raw.strip():
        raise ValueError("Give the full path of a .pdf or .pptx file on this PC.")
    text = raw.strip().strip('"').strip("'")
    if text.replace("/", "\\").startswith("\\\\"):
        # UNC, extended-length and device paths (two leading separators): exists() on a UNC name opens an SMB connection to that host
        # (and offers the user's Windows login to it) before any check here could say no
        raise ValueError("Give a file on this PC, not a network or device path.")
    p = Path(text)
    if not p.is_absolute():
        raise ValueError("Give the full path of the file, like D:\\Papers\\signals.pdf.")
    if not p.exists():
        raise ValueError("There is no file at that path.")
    if not p.is_file():
        raise ValueError("That is a folder; give one file, or read the watched folder.")
    if p.suffix.lower() not in ingest.SUFFIXES:
        raise ValueError(f"I read .pdf and .pptx files; {p.suffix or 'this file'} is not one of them.")
    return p


def _job_answer(job: Optional[dict]) -> dict:
    if job is None:
        return api.ok("waiting", "No ingest has run.", SOURCE, job=None)
    if job["status"] == "running":
        what = f"Reading {job['current']}" if job.get("current") else "Starting"
        return api.ok("live", f"{what}: {job['done']} of {_plural(job['total'], 'file', 'files')} done.", SOURCE, job=job)
    bad = [f for f in job["files"] if f["status"] == "failed" or (f["status"] == "added" and f.get("note"))]
    if job["status"] == "failed" or bad:
        first = bad[0] if bad else None
        reason = (first.get("note") or f"{first['file']} could not be read.") if first else "The job did not finish."
        return api.ok("fault", reason, SOURCE, job=job)
    added = [f for f in job["files"] if f["status"] == "added"]
    n_q = sum(f["questions"] for f in added)
    dup = len(job["files"]) - len(added)
    return api.ok("live", f"Read {_plural(len(added), 'file', 'files')}: {_plural(n_q, 'draft', 'drafts')} to review"
                  + (f"; {dup} already on file" if dup else "") + ".", SOURCE, job=job)


def _check_bbox(bbox, size: tuple[float, float]) -> list[float]:
    if not isinstance(bbox, (list, tuple)) or len(bbox) != 4 or \
            any(isinstance(v, bool) or not isinstance(v, (int, float)) for v in bbox):
        raise ValueError("A crop box is four numbers: left, top, right, bottom, in points.")
    x0, y0, x1, y1 = (float(v) for v in bbox)
    w, h = size
    if x0 < -_EDGE or y0 < -_EDGE or x1 > w + _EDGE or y1 > h + _EDGE:
        raise ValueError("The box must lie inside the page.")
    if x1 - x0 < MIN_SIDE or y1 - y0 < MIN_SIDE:
        raise ValueError(f"A crop is at least {MIN_SIDE:.0f} points on each side.")
    return [v if isinstance(v, int) else round(v, 2) for v in bbox]


def register(app: FastAPI, svc, bus) -> None:
    jobs = ingest.IngestJob(bus)
    app.state.pyq_ingest = jobs

    def start(paths: list[Path], meta: dict) -> dict:
        job = jobs.start(paths, store=_store(), meta=meta)
        return api.ok("live", f"Reading {_plural(len(paths), 'file', 'files')}.", SOURCE, job=job)

    # ------------------------------------------------------------------ R-12, R-13
    @app.post("/api/mission/pyq/ingest")
    async def ingest_start(body: dict = Body(...)):
        def work():
            meta = _meta(body)
            if body.get("folder") is True:
                st = _store()
                if not folder.get_folder(st).get("path"):
                    raise ValueError("No folder chosen.")
                paths = folder.pending_paths(st)
                if not paths:
                    return api.ok("live", "Nothing new in the folder.", "the folder you chose", job=None)
                return start(paths, meta)
            if "path" not in body:
                raise ValueError("Give the full path of a file, or {folder: true}.")
            return start([check_path(body.get("path"))], meta)
        return await run_in_threadpool(api.guard, work)

    @app.get("/api/mission/pyq/ingest/{job}")
    async def ingest_job(job: str):
        return api.guard(lambda: _job_answer(jobs.get(job)))

    # ------------------------------------------------------------------ R-14
    @app.put("/api/mission/pyq/crops/{qid}")
    async def move_crop(qid: str, body: dict = Body(...)):
        def work():
            st = _store()
            q = st.get_question(qid)
            c = q.get("crop") or {}
            n = int(c.get("page") or q.get("page") or 0)
            page_png = st.paths.pages / q["paper_id"] / f"p{n:03d}.png"
            if n < 1 or not page_png.is_file():
                raise KeyError("No page picture for this question.")
            if "bbox" not in body:
                raise ValueError("Give the new box as bbox: [left, top, right, bottom] in points.")
            size = crops.page_size_of(page_png, int(c.get("dpi") or CROP_DPI))
            bbox = _check_bbox(body["bbox"], size)
            rel = f"crops/{q['paper_id']}/{qid}.png"
            crops.render_crop(page_png, bbox, size, st.root / rel)
            new = st.set_crop(qid, {"page": n, "bbox": bbox, "png": rel, "dpi": int(c.get("dpi") or CROP_DPI)})
            return api.ok("live", "Crop moved.", SOURCE, question=new)
        return await run_in_threadpool(api.guard, work)

    # ------------------------------------------------------------------ R-15
    @app.post("/api/mission/pyq/upload")
    async def upload(request: Request, name: Optional[str] = None, subject: Optional[str] = None, year: Optional[str] = None):
        def checks() -> tuple[str, dict]:
            if not isinstance(name, str) or not _NAME.fullmatch(name) or _DEVICE.match(name):
                raise ValueError("Give the file a plain name ending in .pdf or .pptx, with no folder in it.")
            return name, _meta({"subject": subject, "year": year})

        fname, meta = api.guard(checks)
        if jobs.running():
            raise HTTPException(409, "Already reading files; wait for that to finish.")
        size = request.headers.get("content-length")
        if size is not None and size.strip().isdigit() and int(size) > MAX_UPLOAD:
            raise HTTPException(413, f"A file is at most {MAX_UPLOAD // (1024 * 1024)} MB.")
        st = _store()
        out = st.paths.inbox / fname
        tmp = st.paths.inbox / f".{uuid.uuid4().hex[:12]}.part"
        n = 0
        head = b""
        try:
            with open(tmp, "wb") as f:
                async for chunk in request.stream():
                    n += len(chunk)
                    if n > MAX_UPLOAD:              # the header was missing or lied: stop at the cap
                        raise HTTPException(413, f"A file is at most {MAX_UPLOAD // (1024 * 1024)} MB.")
                    if len(head) < 8:
                        head = (head + chunk)[:8]
                    f.write(chunk)
                f.flush()
                os.fsync(f.fileno())
            if n == 0:
                raise HTTPException(400, "The file is empty.")
            suffix = Path(fname).suffix.lower()
            if not head.startswith(_MAGIC[suffix]):
                raise HTTPException(400, f"This is not a {suffix} file inside.")
            os.replace(tmp, out)
        finally:
            tmp.unlink(missing_ok=True)
        try:
            return api.guard(start, [out], meta)
        except HTTPException:
            out.unlink(missing_ok=True)             # a job started between the check and now: keep no stray file
            raise
