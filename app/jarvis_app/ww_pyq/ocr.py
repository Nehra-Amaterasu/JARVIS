"""OCR on demand for pages of a paper that have no text layer (plan 9.0, 25 Nov 2026).

    installed() / engine_info()                    is there an engine, and which
    read_png(path) -> OcrPage                      one page picture through RapidOCR, lines with a confidence each
    read_pages(store, pid, pages=None, ...)        the unread pages of one paper: questions for the pages that pass the gate
    OcrJob                                         one reading at a time, in a thread, stoppable between pages

Why on demand: a page takes about 14 s on the CPU here (6 to 11 s on an invented page) and 3,374 scan pages are on file,
so nothing is recognised unless he asks for a paper. Why a gate: on his scans a printed page reads at a mean line confidence
of 0.89 and up, and handwriting at 0.75 and down is noise. A page under GATE gives no question and stays a picture, with the
confidence it read at in its fault line.

What a read page gives is never trusted: text_status "unverified", the mean confidence of its lines, a crop, status pending.
The engine's models ship inside its wheel, so nothing is downloaded, and the picture read is the 150 dpi page the ingest
already drew: the paper's file is not opened again.
"""
from __future__ import annotations

import importlib.util
import re
import threading
import time
import uuid
from datetime import datetime
from pathlib import Path
from typing import Any, Callable, Optional, TypedDict

from . import api, ingest, segment
from .schema import CROP_DPI
from .store import Store

GATE = 0.85
MAX_LINES = 400                    # a printed page has 40 to 90 lines; more is a table of numbers or noise, cut for time
MAX_PIXELS = 40_000_000            # the ingest caps a page at 4.5e6 pt squared, which is 19.5 Mpx at 150 dpi
UNREAD = re.compile(r"^p\. (?P<n>\d{1,4}): (?:no text layer|the text layer does not read as words)")
_engine: Any = None
_engine_lock = threading.Lock()


class OcrLine(TypedDict):
    text: str
    confidence: float
    box: list[float]               # x0, y0, x1, y1 in the picture's pixels


class OcrPage(TypedDict):
    lines: list[OcrLine]
    mean_confidence: Optional[float]
    seconds: float
    device: str


def installed() -> bool:
    return importlib.util.find_spec("rapidocr_onnxruntime") is not None


def device() -> str:
    try:
        import onnxruntime
        return "cuda" if "CUDAExecutionProvider" in onnxruntime.get_available_providers() else "cpu"
    except Exception:
        return "cpu"


def engine_info() -> dict:
    version = ""
    if installed():
        try:
            from importlib.metadata import version as v
            version = v("rapidocr-onnxruntime")
        except Exception:
            version = ""
    return {"name": "RapidOCR", "version": version, "device": device(), "installed": installed()}


def _get_engine():
    global _engine
    with _engine_lock:
        if _engine is None:
            if not installed():
                raise ValueError("No OCR engine is installed.")
            from rapidocr_onnxruntime import RapidOCR
            _engine = RapidOCR()
        return _engine


def read_png(path: Path) -> OcrPage:
    """One page picture. The engine answers [[four corner points, text, score], ...] or None for a blank page."""
    eng = _get_engine()
    t0 = time.perf_counter()
    result, _ = eng(str(path))
    lines: list[OcrLine] = []
    for item in (result or [])[:MAX_LINES]:
        pts, text, score = item[0], str(item[1] or "").strip(), float(item[2])
        if not text:
            continue
        xs, ys = [float(p[0]) for p in pts], [float(p[1]) for p in pts]
        lines.append({"text": text, "confidence": score, "box": [min(xs), min(ys), max(xs), max(ys)]})
    mean = sum(l["confidence"] for l in lines) / len(lines) if lines else None
    return {"lines": lines, "mean_confidence": mean, "seconds": time.perf_counter() - t0, "device": device()}


def unread_pages(paper: dict) -> list[int]:
    """The pages of a paper still waiting: no text layer and not yet read below the gate."""
    out = []
    for f in paper.get("faults") or []:
        m = UNREAD.match(str(f))
        if m:
            out.append(int(m.group("n")))
    return sorted(set(out))


# The engine drops thin spaces: a printed "3. Calculate ... shown. (5 marks)" came back as "3.Calculate ... shown.(5 marks)"
# on the first real reading, so no question start was found. Only these two joins are opened again; no letter is changed.
_LABEL_JOIN = re.compile(r"^(\s*(?:[Qq]\s*\.?\s*)?\d{1,3}\s*[.)])(?=[A-Za-z(\[])")
_MARKS_JOIN = re.compile(r"(?<=[A-Za-z.?:;,])(?=[\[(]\s*\d{1,3}(?:\.\d)?\s*(?:marks?|m)?\s*[\])]\s*$)", re.I)


def open_joins(text: str) -> str:
    return _MARKS_JOIN.sub(" ", _LABEL_JOIN.sub(lambda m: m.group(1) + " ", text))


def _page_dict(lines: list[OcrLine], scale: float, width: float, height: float) -> dict:
    """The lines in the shape PyMuPDF gives a text page, so the same segmenter reads them: pixels become points."""
    out = []
    for l in lines:
        x0, y0, x1, y1 = (v * scale for v in l["box"])
        out.append({"type": 0, "lines": [{"bbox": [x0, y0, x1, y1], "spans": [{"text": open_joins(l["text"]), "size": max(1.0, y1 - y0)}]}]})
    return {"width": width, "height": height, "blocks": out}


def read_pages(store: Store, pid: str, pages: Optional[list[int]] = None, *, ocr: Callable[[Path], OcrPage] = read_png,
               on_page: Optional[Callable[[dict], Any]] = None, stop: Optional[threading.Event] = None) -> dict:
    """Read the waiting pages of one paper. Returns {pages_total, pages_done, pages_read, pages_below_gate, questions,
    seconds_per_page, stopped, trace}. Nothing is accepted; a page under the gate keeps its picture and gains no question."""
    from PIL import Image
    paper = store.get_paper(pid)
    waiting = unread_pages(paper)
    todo = [n for n in waiting if pages is None or n in pages]
    if not todo:
        raise ValueError("This paper has no page waiting for OCR.")
    tr = ingest._Trace(None)
    faults = [str(f) for f in paper.get("faults") or []]
    boxes: list[dict] = []
    conf_of: dict[str, float] = {}
    sizes: dict[int, tuple[float, float]] = {}
    out = {"pages_total": len(todo), "pages_done": 0, "pages_read": 0, "pages_below_gate": 0, "questions": 0,
           "seconds_per_page": None, "stopped": False}
    spent = 0.0
    scale = 72.0 / CROP_DPI
    for n in todo:
        if stop is not None and stop.is_set():
            out["stopped"] = True
            break
        if on_page:
            on_page({**out, "page_now": n})
        png = store.paths.pages / pid / f"p{n:03d}.png"
        old = next((f for f in faults if f.startswith(f"p. {n}:")), None)

        def set_fault(text: Optional[str]):
            if old in faults:
                faults.remove(old)
            if text:
                faults.append(text)

        if not png.is_file():
            set_fault(f"p. {n}: the page picture is gone; read the paper again")
            out["pages_done"] += 1
            continue
        with Image.open(png) as im:
            im.load()
            if im.width * im.height > MAX_PIXELS:
                set_fault(f"p. {n}: the page picture is too large to read")
                out["pages_done"] += 1
                continue
            try:
                res = ocr(png)
            except ValueError:
                raise
            except Exception as e:                       # one page the engine cannot read does not end the paper
                set_fault(f"p. {n}: OCR could not read this page ({type(e).__name__})")
                out["pages_done"] += 1
                continue
            spent += float(res.get("seconds") or 0)
            mean = res.get("mean_confidence")
            w, h = im.width * scale, im.height * scale
            sizes[n] = (w, h)
            if not res["lines"] or mean is None:
                set_fault(f"p. {n}: OCR found no text on this page")
                tr("fault", f"p{n} ocr: no text found", n)
            elif mean < GATE:
                set_fault(f"p. {n}: read at confidence {mean:.2f}, below {GATE:.2f}; left as a picture")
                out["pages_below_gate"] += 1
                tr("fault", f"p{n} ocr {res['device']} {mean:.2f} mean, below the gate of {GATE:.2f}", n)
            else:
                low = sum(1 for l in res["lines"] if l["confidence"] < 0.6)
                tr("page", f"p{n} ocr {res['device']} {mean:.2f} mean, {len(res['lines'])} lines" + (f", {low} under 0.60" if low else ""), n)
                page_boxes = segment.segment_page(_page_dict(res["lines"], scale, w, h), page_no=n)
                found = [b for b in page_boxes if b["kind"] == "question"]
                if not found:
                    # On 5 of 7 real scanned pages the rule found no question start: the papers are ruled tables and the
                    # engine returns cells, not rows. A page that was read must not vanish from review, so the whole page
                    # becomes one draft with its recognised text, and the page keeps a line that says so.
                    whole = {"kind": "question", "page": n, "label": f"p{n}", "bbox": [0.0, 0.0, w, h], "own_marks": None,
                             "text": " ".join(open_joins(l["text"]) for l in res["lines"]), "parts": [], "marks": None,
                             "marks_source": "missing", "closed": True}
                    page_boxes, found = [whole], [whole]
                    set_fault(f"p. {n}: read at confidence {mean:.2f}; no question start was found, so the whole page is one draft to split by hand")
                    tr("segment", f"p{n} ocr: no question start found; the whole page is one draft", n)
                else:
                    set_fault(None)
                for b in found:
                    ingest._cut(store, pid, b, b["bbox"], (w, h), im, n, tr)
                    inside = [l["confidence"] for l in res["lines"]
                              if b["bbox"][1] - 1 <= (l["box"][1] + l["box"][3]) / 2 * scale <= b["bbox"][3] + 1]
                    conf_of[b["id"]] = round(sum(inside) / len(inside), 3) if inside else round(mean, 3)
                boxes.extend(page_boxes)
                out["pages_read"] += 1
        out["pages_done"] += 1
    drafts, total = ingest._stitch(boxes, tr)
    for d in drafts:
        d["text_status"] = "unverified"                  # recognised, not confirmed: never shown as verified
        d["ocr_confidence"] = conf_of.get(d.get("id") or "", None)
    ids = ingest._add_with_crops(store, pid, drafts, sizes, tr) if drafts else []
    out["questions"] = len(ids)
    out["seconds_per_page"] = round(spent / out["pages_done"], 1) if out["pages_done"] and spent else None
    changes: dict = {"faults": faults}
    if out["pages_read"]:
        text_pages = int(paper.get("pages") or 0) - len(waiting)
        changes["method"] = "mixed" if text_pages > 0 or unread_pages({"faults": faults}) else "ocr"
        if paper.get("total_marks") is None and total is not None:
            changes["total_marks"] = total
    store.update_paper(pid, changes)
    out["trace"] = tr.events
    return out


def _now() -> str:
    return datetime.now().astimezone().isoformat(timespec="seconds")


class OcrJob:
    """One OCR reading at a time. A second start raises api.Busy (409); stop() ends it after the page being read."""

    def __init__(self, bus=None, ocr: Callable[[Path], OcrPage] = read_png):
        self._bus, self._ocr = bus, ocr
        self._lock = threading.Lock()
        self._job: Optional[dict] = None
        self._thread: Optional[threading.Thread] = None
        self._stop = threading.Event()

    def info(self) -> Optional[dict]:
        with self._lock:
            return dict(self._job) if self._job else None

    def running(self) -> bool:
        with self._lock:
            return bool(self._job and self._job["status"] == "running")

    def start(self, store: Store, pid: str, pages: Optional[list[int]] = None) -> dict:
        paper = store.get_paper(pid)                       # KeyError for an unknown paper: 404
        todo = [n for n in unread_pages(paper) if pages is None or n in pages]
        if not todo:
            raise ValueError("This paper has no page waiting for OCR.")
        if not installed() and self._ocr is read_png:
            raise ValueError("No OCR engine is installed.")
        with self._lock:
            if self._job and self._job["status"] == "running":
                raise api.Busy("OCR is already reading a paper; wait for it or stop it.")
            self._stop.clear()
            self._job = {"id": f"o-{uuid.uuid4().hex[:12]}", "status": "running", "paper_id": pid, "pages_total": len(todo),
                         "pages_done": 0, "page_now": todo[0], "pages_read": 0, "pages_below_gate": 0, "questions": 0,
                         "started": _now(), "finished": None, "seconds_per_page": None, "error": None}
            self._thread = threading.Thread(target=self._run, args=(store, pid, todo), daemon=True, name="pyq-ocr")
            self._thread.start()
            return dict(self._job)

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

    def _progress(self, p: dict) -> None:
        with self._lock:
            if self._job:
                self._job.update({k: p[k] for k in ("pages_done", "pages_read", "pages_below_gate", "page_now") if k in p})

    def _run(self, store: Store, pid: str, todo: list[int]) -> None:
        try:
            r = read_pages(store, pid, todo, ocr=self._ocr, on_page=self._progress, stop=self._stop)
            end = {"status": "stopped" if r["stopped"] else "done", "page_now": None,
                   **{k: r[k] for k in ("pages_done", "pages_read", "pages_below_gate", "questions", "seconds_per_page")}}
        except Exception as e:                             # the job says why; the server goes on
            end = {"status": "failed", "page_now": None,
                   "error": str(e) if isinstance(e, (ValueError, KeyError)) else f"OCR stopped on an error ({type(e).__name__})."}
        with self._lock:
            self._job.update(end, finished=_now())
            job = dict(self._job)
        if self._bus is not None:
            try:
                self._bus.publish("mission", "update", f"OCR: {job['pages_read']} of {job['pages_total']} pages read, "
                                  f"{job['questions']} drafts to review"[:140])
            except Exception:
                pass
