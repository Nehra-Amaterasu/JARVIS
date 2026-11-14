"""PDFs and slide decks into the review queue as crop-first drafts, with a trace of what happened (E06).

    ingest_pdf(path, *, store, meta=None, ocr=None, on_event=None) -> IngestResult
    ingest_slides(path, *, store, meta=None, on_event=None) -> IngestResult
    ingest_file(path, *, store, meta=None, on_event=None) -> IngestResult      by suffix: .pdf or .pptx
    read_pdf_text(data, first=None, last=None) -> str                           plain text with PyMuPDF
    class IngestJob                                                             one background job at a time

A PDF, in order (each step is a TraceEvent, sent to on_event as it happens):
  open    hash the bytes (SHA-256); a hash on file already is a duplicate and nothing is added
  page    every page is drawn once at 150 dpi to pages/<paper>/p<nnn>.png, then the text-layer
          test of the specification (40 characters, 80 % word-like tokens); a page that fails it and
          holds a picture is a fault ("p. 3: no text layer; OCR arrives in EW8") and the rest imports
  table   a ruled table whose header names a question and a marks column: one question per row
  segment question starts at the modal left margin (segment.py), stitched across pages
  crop    the drafts are added first (Store.add_questions gives the ids), then each crop is cut from
          its page picture to crops/<paper>/<qid>.png and recorded with Store.set_crop (plan 9.1.8)
  done    the counts and the seconds
A landscape PDF with no question start on any page is a deck saved as PDF: one "slide" unit per page,
the whole page its crop. A .pptx gives one "slide" unit per slide with verified text and no crop.

What is NOT done here, on purpose: no OCR (EW8; the `ocr` argument is accepted and unused so the call
sites need not change), no model, no marks from text length. The original bytes are copied to
originals/<sha256>.<ext>; nothing outside the store root is written. If reading fails after the paper
row was made, the paper and its files are removed, so a second attempt is not called a duplicate.
"""
from __future__ import annotations

import hashlib
import os
import threading
import time
import uuid
from datetime import datetime
from pathlib import Path
from typing import Any, Callable, Optional, TypedDict

from .. import ww_bank_store
from . import api, crops, segment, slides
from .schema import CROP_DPI, EXAM_KINDS, MAX_TEXT, PaperMeta, QuestionDraft, TraceEvent
from .store import Store

SUFFIXES = (".pdf", ".pptx")
MAX_FILE = 200 * 1024 * 1024         # yaadash library.MAX_FILE_BYTES: a paper is a few MB, a 200 MB file is not one
NO_TEXT = "p. {n}: no text layer; OCR arrives in EW8"
UNREADABLE = "p. {n}: the text layer does not read as words; OCR arrives in EW8"
PICTURE_SLIDE = "slide {n}: pictures only, no text; OCR arrives in EW8"
MAX_PAGES = 300                      # a paper is 2 to 30 pages; 300 pages at 0.13 s is 40 s and 300 PNGs, a bounded cost
MAX_PAGE_AREA = 4.5e6                # pt squared: A1 is 4.0e6 and 150 dpi draws it as 19 Mpx (58 MB); 14400 x 14400 pt would be 2.5 GB
MAX_PAGE_SIDE = 6000.0               # pt: a 6000 x 700 strip passes the area test and still draws 12500 px wide
MAX_UNZIPPED = slides.MAX_UNZIPPED
TRACE_CAP = 5000                     # events kept per job: 20 pages with 5 questions make about 130
JOBS_KEPT = 5


class IngestResult(TypedDict):
    paper: PaperMeta
    question_ids: list[str]
    drafts: list[QuestionDraft]
    trace: list[TraceEvent]
    duplicate: bool


class _Trace:
    """The events of one file, each stamped with the seconds since the file was opened."""

    def __init__(self, on_event: Optional[Callable[[TraceEvent], Any]]):
        self.t0 = time.perf_counter()
        self.events: list[TraceEvent] = []
        self._cb = on_event

    def __call__(self, kind: str, text: str, page: Optional[int] = None) -> None:
        ev: TraceEvent = {"t": round(time.perf_counter() - self.t0, 3), "page": page, "kind": kind, "text": text}
        self.events.append(ev)
        if self._cb is not None:
            try:
                self._cb(ev)
            except Exception:                      # a listener's bug must not stop the reading
                pass

    def took(self) -> float:
        return time.perf_counter() - self.t0


def _plural(n: int, one: str, many: str) -> str:
    return f"{n} {one if n == 1 else many}"


def _clean_meta(meta: Optional[dict], path: Path) -> dict:
    """The paper fields he may give with a file, checked the way R-02 and R-04 check them."""
    meta = dict(meta or {})
    out: dict = {"title": path.stem[:200] or "Untitled paper", "subject": "", "year": None, "exam_kind": "other",
                 "source_note": "manual drop-in"}
    if meta.get("title") not in (None, ""):
        t = meta["title"]
        if not isinstance(t, str) or not t.strip() or len(t) > 200:
            raise ValueError("A paper needs a title of up to 200 characters.")
        out["title"] = t.strip()
    if meta.get("subject") not in (None, ""):
        out["subject"] = ww_bank_store.slug(meta["subject"])
    y = meta.get("year")
    if y is not None:
        if isinstance(y, bool) or not isinstance(y, int) or not 1900 <= y <= 2200:
            raise ValueError("The year must be a whole year.")
        out["year"] = y
    k = meta.get("exam_kind")
    if k not in (None, ""):
        if k not in EXAM_KINDS:
            raise ValueError("That kind of exam is not one I know.")
        out["exam_kind"] = k
    s = meta.get("source_note")
    if s not in (None, ""):
        if not isinstance(s, str) or len(s) > 500:
            raise ValueError("The source note is at most 500 characters.")
        out["source_note"] = s
    return out


def _read(path: Path) -> bytes:
    if not path.is_file():
        raise ValueError("That file is not there.")
    if path.stat().st_size > MAX_FILE:
        raise ValueError(f"This file is larger than {MAX_FILE // (1024 * 1024)} MB.")
    return path.read_bytes()


def _keep_original(store: Store, sha: str, suffix: str, data: bytes) -> None:
    out = store.paths.originals / f"{sha}{suffix}"
    if out.is_file() and out.stat().st_size == len(data):
        return
    tmp = out.with_name(f".{out.name}.{uuid.uuid4().hex[:8]}.tmp")
    try:
        with open(tmp, "wb") as f:
            f.write(data)
            f.flush()
            os.fsync(f.fileno())
        os.replace(tmp, out)
    finally:
        tmp.unlink(missing_ok=True)


def _duplicate(store: Store, pid: str, tr: _Trace) -> IngestResult:
    tr("skip", f"same file as {pid}; nothing added")
    tr("done", f"0 questions added, {tr.took():.2f} s")
    return {"paper": store.get_paper(pid), "question_ids": [], "drafts": [], "trace": tr.events, "duplicate": True}


def _new_paper(store: Store, sha: str, path: Path, kind: str, method: str, pages: int, meta: dict) -> str:
    return store.add_paper({**meta, "sha256": sha, "filename": path.name, "kind": kind, "method": method,
                            "pages": pages, "total_marks": None, "faults": []})


def _cut_text(text: str, label: str, tr: _Trace, page: Optional[int]) -> str:
    if len(text) <= MAX_TEXT:
        return text
    tr("skip", f"q {label}: text cut to {MAX_TEXT} characters; the crop shows all of it", page)
    return text[:MAX_TEXT]


# ------------------------------------------------------------------ PDF
def _flags():
    import fitz
    return fitz.TEXTFLAGS_TEXT | fitz.TEXT_DEHYPHENATE        # the flags yaadash library uses, so the words agree


def read_pdf_text(data: bytes, first: Optional[int] = None, last: Optional[int] = None) -> str:
    """The plain text of pages first..last (1-based, both included; None is the first or the last page)."""
    import fitz
    with fitz.open(stream=data, filetype="pdf") as doc:
        n = doc.page_count
        lo = max(1, first or 1)
        hi = min(n, last if last is not None else n)
        return "\n".join(doc[i - 1].get_text("text", flags=_flags()) for i in range(lo, hi + 1))


def _open_pdf(data: bytes):
    import fitz
    try:
        doc = fitz.open(stream=data, filetype="pdf")
    except Exception as e:
        raise ValueError("This file does not open as a PDF.") from e
    if doc.needs_pass:
        doc.close()
        raise ValueError("This PDF is locked with a password.")
    if doc.page_count < 1:
        doc.close()
        raise ValueError("This file does not open as a PDF.")
    try:
        if doc.page_count > MAX_PAGES:
            raise ValueError(f"This PDF has {doc.page_count} pages; I read at most {MAX_PAGES}.")
        for i in range(doc.page_count):       # sizes first: nothing is drawn or stored for a page that cannot be drawn safely
            r = doc[i].rect
            w, h = float(r.width), float(r.height)
            if not (0 < w <= MAX_PAGE_SIDE and 0 < h <= MAX_PAGE_SIDE and w * h <= MAX_PAGE_AREA):
                raise ValueError(f"Page {i + 1} is too large to draw safely ({w:.0f} x {h:.0f} points).")
    except BaseException:
        doc.close()
        raise
    return doc


def ingest_pdf(path: Path, *, store: Store, meta: Optional[dict] = None, ocr=None,
               on_event: Optional[Callable[[TraceEvent], Any]] = None) -> IngestResult:
    path = Path(path)
    tr = _Trace(on_event)
    meta = _clean_meta(meta, path)
    data = _read(path)
    sha = hashlib.sha256(data).hexdigest()
    doc = _open_pdf(data)
    try:
        tr("open", f"{path.name}: {_plural(doc.page_count, 'page', 'pages')}, {len(data) / 1024:.0f} KB")
        pid = store.find_by_sha(sha)
        if pid:
            return _duplicate(store, pid, tr)
        pid = _new_paper(store, sha, path, "pdf", "text-layer", doc.page_count, meta)
        try:
            _keep_original(store, sha, ".pdf", data)
            return _read_pdf(doc, pid, store, tr)
        except BaseException:
            store.delete_paper(pid)
            raise
    finally:
        doc.close()


def _read_pdf(doc, pid: str, store: Store, tr: _Trace) -> IngestResult:
    faults: list[str] = []
    sizes: dict[int, tuple[float, float]] = {}
    boxes: list[dict] = []               # every box of the paper in page order
    slide_pages: list[tuple[int, list[dict]]] = []
    maybe_slides = True                  # a deck saved as PDF: landscape pages and not one question start
    for n in range(1, doc.page_count + 1):
        page = doc[n - 1]
        w, h = float(page.rect.width), float(page.rect.height)
        sizes[n] = (w, h)
        im = crops.render_page_image(doc, n, store.paths.pages / pid / f"p{n:03d}.png", dpi=CROP_DPI)
        try:
            new = _read_page(page, n, w, h, im, pid, store, tr, faults)
        finally:
            im.close()
        if new is None:
            continue
        page_boxes, n_questions, rows = new
        if n_questions or w <= h:
            maybe_slides = False
            slide_pages = []
        elif maybe_slides:
            slide_pages.append((n, rows))
        boxes.extend(page_boxes)
    drafts, total = _stitch(boxes, tr)
    method = "text-layer"
    if not drafts and maybe_slides and slide_pages:
        method = "slides"
        drafts = []
        for n, rows in slide_pages:
            u = slides.pdf_slide(rows, n)
            label = u["heading"] or f"slide {n}"
            w, h = sizes[n]
            drafts.append({"label": label, "kind": "slide", "text": _cut_text(u["text"], label, tr, n), "text_status": "verified",
                           "crop": {"page": n, "bbox": [0, 0, w, h], "png": "", "dpi": CROP_DPI}, "page": n, "marks": None,
                           "marks_source": "missing", "type": "slide", "section": "", "choice_group": "", "co": "", "bl": None,
                           "parts": []})
        tr("segment", f"no question starts and landscape pages: read as {_plural(len(drafts), 'slide', 'slides')}")
    ids = _add_with_crops(store, pid, drafts, sizes, tr)
    store.update_paper(pid, {"faults": faults, "total_marks": total, "method": method, "pages": doc.page_count})
    with_marks = sum(1 for d in drafts if d.get("marks") is not None)
    tr("done", f"{_plural(len(ids), 'question', 'questions') if method != 'slides' else _plural(len(ids), 'slide', 'slides')}, "
       f"{with_marks} with printed marks, {_plural(len(faults), 'fault', 'faults')}, {tr.took():.2f} s")
    return {"paper": store.get_paper(pid), "question_ids": ids, "drafts": drafts, "trace": tr.events, "duplicate": False}


def _read_page(page, n: int, w: float, h: float, im, pid: str, store: Store, tr: _Trace, faults: list[str]):
    """One page: the text-layer test, its tables, its boxes, and the crops of its questions cut from
    the page picture still in memory. None when the page gives nothing to read."""
    text = page.get_text("text", flags=_flags())
    chars, share = segment.text_quality(text)
    if not segment.has_text_layer(text):
        if chars == 0 and not page.get_images(full=False):
            tr("skip", f"p{n}: blank page", n)
            return None
        if page.get_images(full=False) or share < 0.8:
            msg = (NO_TEXT if chars < 40 else UNREADABLE).format(n=n)
            faults.append(msg)
            tr("fault", msg, n)
            return None
    tr("page", f"p{n}: text layer, {chars} characters" + ("" if chars >= 40 else " (a short page, read as it is)"), n)
    tables = segment.read_tables(page, n)
    for t in tables:
        tr("table", t["trace"], n)
    d = page.get_text("dict")
    page_boxes = segment.segment_page(d, page_no=n, skip=[t["bbox"] for t in tables if t["boxes"]])
    from_table = [b for t in tables for b in t["boxes"]]
    page_boxes = sorted(page_boxes + from_table, key=lambda b: (b["kind"] != "cont", b["bbox"][1]))
    questions = [b for b in page_boxes if b["kind"] == "question"]
    k_line = len(questions) - len(from_table)
    if questions:
        tr("segment", f"p{n}: {_plural(k_line, 'question start', 'question starts')} at the left margin"
           + (f", {_plural(len(from_table), 'table row', 'table rows')}" if from_table else ""), n)
    else:
        tr("skip", f"p{n}: no question starts on this page", n)
    for b in questions:
        _cut(store, pid, b, b["bbox"], (w, h), im, n, tr)
    return page_boxes, len(questions), (segment.rows_of(d) if not questions and w > h else [])


def _new_id() -> str:
    return f"q-{uuid.uuid4().hex[:12]}"


def _cut(store: Store, pid: str, item: dict, bbox, size, im, n: int, tr: _Trace) -> None:
    """Give a box or draft its question id and its crop file now; add_questions keeps the id."""
    item["id"] = item.get("id") or _new_id()
    rel = f"crops/{pid}/{item['id']}.png"
    crops.cut(im, bbox, size, store.root / rel)
    item["png"] = rel
    x0, y0, x1, y1 = bbox
    tr("crop", f"crop {item['id']} p{n} [{x0:.0f}, {y0:.0f}, {x1:.0f}, {y1:.0f}]", n)


def _add_with_crops(store: Store, pid: str, drafts: list[dict], sizes: dict, tr: _Trace) -> list[str]:
    """Add all drafts in one write, their crops already cut.

    Plan 9.1.8 says: add the drafts, then render each crop and call Store.set_crop. Measured on the
    20-page fixture (100 questions), that path took 7.1 s of 12 s, because each set_crop rewrites the
    paper's whole questions file and looks through every paper's file to find the id. So each box
    gets its question id ("q-" + 12 hex, the store's own form) and its crop when its page is read,
    and add_questions keeps an id it is given when the id is well formed and free. Should the store
    choose another id, the crop file is renamed to it and recorded with set_crop, so the store still
    decides. A deck saved as PDF is known only after the last page; its whole-page crops are cut here."""
    from PIL import Image
    slide_pages = sorted({dr["crop"]["page"] for dr in drafts if dr.get("crop") and not dr.get("png")})
    for n in slide_pages:
        with Image.open(store.paths.pages / pid / f"p{n:03d}.png") as im:
            im.load()
            for dr in drafts:
                if dr.get("crop") and not dr.get("png") and dr["crop"]["page"] == n:
                    _cut(store, pid, dr, dr["crop"]["bbox"], sizes[n], im, n, tr)
    for dr in drafts:
        png = dr.pop("png", "")
        if dr.get("crop"):
            dr["crop"] = {**dr["crop"], "png": png}
        dr["id"] = dr.get("id") or _new_id()
    ids = store.add_questions(pid, drafts)
    for dr in drafts:
        dr.pop("id", None)                       # a draft has no id (schema.QuestionDraft); the store's record has
    for qid, dr in zip(ids, drafts):
        c = dr.get("crop")
        if c and c["png"] and c["png"] != f"crops/{pid}/{qid}.png":
            rel = f"crops/{pid}/{qid}.png"
            os.replace(store.root / c["png"], store.root / rel)
            dr["crop"] = {**c, "png": rel}
            store.set_crop(qid, dr["crop"])
    return ids


def _stitch(boxes: list[dict], tr: _Trace) -> tuple[list[dict], Optional[float]]:
    """Boxes of all pages into drafts: carried-over pieces join the question before them, a heading
    sets the section, an OR line puts the questions on either side in one choice group."""
    drafts: list[dict] = []
    total: Optional[float] = None
    section = ""
    last: Optional[dict] = None          # the question still open (a heading or OR closes it)
    or_after: Optional[dict] = None
    groups = 0
    for b in boxes:
        k = b["kind"]
        if k == "section":
            section, last, or_after = b["letter"], None, None
        elif k == "or":
            or_after, last = last, None
        elif k == "total":
            total = b["value"] if total is None else total
        elif k == "cont":
            if last is None:
                continue                 # a title block or instructions at the top of the paper
            if b["text"]:
                last["text"] = segment._ws(last["text"] + " " + b["text"])
            last["parts"] = list(last["parts"]) + list(b["parts"])
            own = last["_own"] if last["_own"] is not None else b.get("own_marks")
            last["_own"] = own
            if last["marks_source"] != "table":
                last["marks"] = segment.final_marks(own, last["parts"])
                last["marks_source"] = "printed" if last["marks"] is not None else "missing"
            tr("segment", f"q {last['label']} runs onto p. {b['page']}; its crop shows p. {last['page']} only", b["page"])
        elif k == "question":
            dr = {"label": b["label"], "kind": "question", "text": b["text"], "text_status": "verified",
                  "crop": {"page": b["page"], "bbox": list(b["bbox"]), "png": "", "dpi": CROP_DPI}, "page": b["page"],
                  "marks": b["marks"], "marks_source": b["marks_source"], "type": "unknown", "section": section,
                  "choice_group": "", "co": b.get("co", ""), "bl": b.get("bl"), "parts": list(b["parts"]), "_own": b.get("own_marks"),
                  "id": b.get("id"), "png": b.get("png", "")}
            if b.get("difficulty_source"):
                dr["difficulty"], dr["difficulty_source"] = b["difficulty"], b["difficulty_source"]
            if or_after is not None:
                if not or_after["choice_group"]:
                    groups += 1
                    or_after["choice_group"] = f"or-{groups}"
                dr["choice_group"] = or_after["choice_group"]
                or_after = None
            drafts.append(dr)
            last = dr
    for dr in drafts:
        dr.pop("_own", None)
        dr["text"] = _cut_text(dr["text"], dr["label"], tr, dr["page"])
        dr["type"] = segment.guess_type(dr["text"])
        if dr["type"] == "mcq":
            dr["parts"] = []             # lettered options are the choices of one question, not sub-parts
    return drafts, total


# ------------------------------------------------------------------ slide decks
def ingest_slides(path: Path, *, store: Store, meta: Optional[dict] = None,
                  on_event: Optional[Callable[[TraceEvent], Any]] = None) -> IngestResult:
    path = Path(path)
    tr = _Trace(on_event)
    meta = _clean_meta(meta, path)
    data = _read(path)
    sha = hashlib.sha256(data).hexdigest()
    if not data.startswith(b"PK"):
        raise ValueError("This file does not open as a slide deck.")
    tr("open", f"{path.name}: a slide deck, {len(data) / 1024:.0f} KB")
    pid = store.find_by_sha(sha)
    if pid:
        return _duplicate(store, pid, tr)
    deck = slides.read_deck(path)                # ValueError for a damaged deck, before anything is stored
    pid = _new_paper(store, sha, path, "pptx", "slides", deck.pages, meta)
    try:
        _keep_original(store, sha, ".pptx", data)
        faults = []
        for n in deck.scanned:
            msg = PICTURE_SLIDE.format(n=n)
            faults.append(msg)
            tr("fault", msg, n)
        for n in deck.blank:
            tr("skip", f"slide {n}: no text", n)
        drafts = []
        for u in deck.units:
            label = u["heading"] or f"slide {u['page']}"
            tr("page", f"slide {u['page']}: {_plural(len(u['text'].split()), 'word', 'words')}", u["page"])
            drafts.append({"label": label, "kind": "slide", "text": _cut_text(u["text"], label, tr, u["page"]),
                           "text_status": "verified", "crop": None, "page": u["page"], "marks": None,
                           "marks_source": "missing", "type": "slide", "section": "", "choice_group": "", "co": "",
                           "bl": None, "parts": []})
        ids = store.add_questions(pid, drafts)
        store.update_paper(pid, {"faults": faults, "pages": deck.pages})
        tr("done", f"{_plural(len(ids), 'slide', 'slides')}, {_plural(len(faults), 'fault', 'faults')}, {tr.took():.2f} s")
        return {"paper": store.get_paper(pid), "question_ids": ids, "drafts": drafts, "trace": tr.events, "duplicate": False}
    except BaseException:
        store.delete_paper(pid)
        raise


def ingest_file(path: Path, *, store: Store, meta: Optional[dict] = None,
                on_event: Optional[Callable[[TraceEvent], Any]] = None) -> IngestResult:
    path = Path(path)
    suffix = path.suffix.lower()
    if suffix == ".pdf":
        return ingest_pdf(path, store=store, meta=meta, on_event=on_event)
    if suffix == ".pptx":
        return ingest_slides(path, store=store, meta=meta, on_event=on_event)
    raise ValueError(f"I read .pdf and .pptx files; {suffix or 'this file'} is not one of them.")


# ------------------------------------------------------------------ the background job
class IngestJob:
    """One reading job at a time, in one thread, files one by one (the routes_library.IngestJob
    pattern): a file that fails is a "failed" row and the next file is still read. A second start
    while one runs raises api.Busy (409). The last JOBS_KEPT jobs stay readable by id."""

    def __init__(self, bus=None, keep: int = JOBS_KEPT):
        self._bus = bus
        self._keep = keep
        self._lock = threading.Lock()
        self._thread: Optional[threading.Thread] = None
        self._jobs: list[dict] = []

    @staticmethod
    def _copy(job: dict) -> dict:
        return {**job, "files": [dict(f) for f in job["files"]], "trace": list(job["trace"])}

    def running(self) -> bool:
        with self._lock:
            return bool(self._jobs) and self._jobs[-1]["status"] == "running"

    def start(self, paths: list[Path], *, store: Store, meta: Optional[dict] = None) -> dict:
        paths = [Path(p) for p in paths]
        with self._lock:
            if self._jobs and self._jobs[-1]["status"] == "running":
                raise api.Busy("Already reading files; wait for that to finish.")
            job = {"id": f"j-{uuid.uuid4().hex[:10]}", "status": "running", "total": len(paths), "done": 0,
                   "current": None, "files": [], "trace": [], "took_s": None,
                   "started": datetime.now().isoformat(timespec="seconds")}
            self._jobs.append(job)
            del self._jobs[:-self._keep]
            self._thread = threading.Thread(target=self._run, args=(job, paths, store, dict(meta or {})),
                                            daemon=True, name="pyq-ingest")
            self._thread.start()
            return self._copy(job)

    def get(self, job_id: str) -> Optional[dict]:
        """A job by id; "last" is the latest (None before any). An unknown id is KeyError (404)."""
        with self._lock:
            if job_id == "last":
                return self._copy(self._jobs[-1]) if self._jobs else None
            for j in self._jobs:
                if j["id"] == job_id:
                    return self._copy(j)
        raise KeyError("No such ingest job.")

    def wait(self, timeout: float = 60) -> Optional[dict]:
        """For tests: block until the running job ends."""
        t = self._thread
        if t is not None:
            t.join(timeout)
        return self.get("last")

    def _run(self, job: dict, paths: list[Path], store: Store, meta: dict) -> None:
        t0 = time.perf_counter()

        def on_event(ev: TraceEvent) -> None:
            with self._lock:
                job["trace"].append({**ev, "t": round(time.perf_counter() - t0, 3)})
                del job["trace"][:-TRACE_CAP]

        for p in paths:
            with self._lock:
                job["current"] = p.name
            try:
                res = ingest_file(p, store=store, meta=meta, on_event=on_event)
                paper = res["paper"]
                faults = list(paper.get("faults") or [])
                row = {"file": p.name, "status": "duplicate" if res["duplicate"] else "added", "paper_id": paper["id"],
                       "pages": paper.get("pages"), "questions": len(res["question_ids"]), "method": paper.get("method"),
                       "note": f"same file as {paper['id']}" if res["duplicate"] else "; ".join(faults)}
            except Exception as e:                    # one bad file never stops the others
                note = str(e) if isinstance(e, ValueError) else f"could not be read ({type(e).__name__})"
                row = {"file": p.name, "status": "failed", "paper_id": None, "pages": None, "questions": 0,
                       "method": None, "note": note[:200]}
                on_event({"t": 0.0, "page": None, "kind": "fault", "text": f"{p.name}: {row['note']}"})
            with self._lock:
                job["files"].append(row)
                job["done"] += 1
        with self._lock:
            files = job["files"]
            job["status"] = "failed" if files and all(f["status"] == "failed" for f in files) else "done"
            job["current"] = None
            job["took_s"] = round(time.perf_counter() - t0, 2)
            added = [f for f in files if f["status"] == "added"]
            n_q = sum(f["questions"] for f in added)
            n_bad = sum(1 for f in files if f["status"] == "failed")
        if self._bus is not None:
            try:
                self._bus.publish("mission", "update",
                                  (f"Read {_plural(len(added), 'file', 'files')}: {_plural(n_q, 'draft', 'drafts')} to review"
                                   + (f", {n_bad} not read" if n_bad else ""))[:140])
            except Exception:
                pass
