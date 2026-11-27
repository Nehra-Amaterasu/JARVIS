"""The seeded sandbox: a scratch data folder filled with INVENTED, shape-true rows, so the real routes answer live.

    seed_study(data_dir) -> {area: ids}       fill one scratch folder; the same ids on every run, no duplicates
    install_fixtures(setter=setattr)          swap Google, the OCR engine's answer sentences and the opening of pages
    attach(app, ocr_delay)                    give one built app the fixture OCR reader and the fixture drafter

Why: every browser test of the UI lane fakes the routes inside the page, so a drift between the plan text and what the
engine really answers was never seen. Here the real app runs on rows the real code wrote. Shape-truth comes from the code
paths, not from hand-written JSON: the Classroom rows come from sync.sync() reading a fake Google over httpx.MockTransport,
the papers from ingest.ingest_pdf() reading invented PDFs, the tags from Store.update_questions(), the drafts from
drafts.draft_from_notes() with a fixture drafter in the model's place, the plan from ww_engines.save_section(), the life
counts from Plan.life_tap(), the pointer from the harvester's own fetch() over a fake network (ww_check_harvest.FakeNet).

Nothing of the owner's is read: seed_study refuses to run unless JARVIS_DATA_DIR points the app at a scratch folder, and it
refuses a target inside the repository's data/ folder. Every name, course, title and text below is made up and says so.

Fixed ids: Drive, course, coursework and draft ids are written here; a paper id is p-<sha256[:12]> of its PDF, and the PDFs
are built byte for byte the same (no_new_id), so it is fixed too; question ids are the store's own shape (q- and 12 hex),
drawn from a hash of the paper and the order instead of uuid4 while seeding.
"""
from __future__ import annotations

import hashlib
import io
import json
import os
import re
import tempfile
import threading
import time
from contextlib import contextmanager
from datetime import date, timedelta
from pathlib import Path
from types import SimpleNamespace
from typing import Any, Callable, Optional

SEED_VERSION = 1
MARKER = ".ww-sandbox-seed.json"         # in the scratch folder: what was seeded there, and proof it is a seed folder
FIXTURE_TAG = "fixture"
OCR_DELAY = 2.0                          # s a page: long enough for a browser to see "running" and press stop

GOOGLE_SOURCE = "an invented Classroom (sandbox fixture)"
GOOGLE_REASON = "Fixture mode: invented Classroom data in the sandbox. No Google account is connected."
OCR_SOURCE = "the fixture OCR reader of the sandbox (invented text)"
DRAFTS_SOURCE = "the fixture drafter of the sandbox (invented questions; no model was asked), from the invented notes"

# ------------------------------------------------------------------ the plan: two invented subjects with units and topics
SUBJECTS = [
    {"id": "fixture-circuits", "name": "Fixture Circuits", "code": "FX101", "units": [
        {"n": 1, "title": "Imaginary networks", "exam_weight": "high", "topics": ["Imaginary resistor ladders", "Pretend node sums"]},
        {"n": 2, "title": "Made-up transients", "exam_weight": "med", "topics": ["Toy capacitor charging", "Invented switch timing"]}]},
    {"id": "fixture-signals", "name": "Fixture Signals", "code": "FX202", "units": [
        {"n": 1, "title": "Pretend waves", "exam_weight": "high", "topics": ["Toy sine sketches", "Invented sampling grids"]},
        {"n": 2, "title": "Made-up filters", "exam_weight": "low", "topics": ["Imaginary low-pass shapes"]}]},
]
COUNTERS = [
    {"id": "fixture-water", "name": "Glasses of water (invented)", "want": "more"},
    {"id": "fixture-scroll", "name": "Hours of scrolling (invented)", "want": "less"},
    {"id": "fixture-walk", "name": "Went for a walk (invented, yes or no)", "want": "yes"},
]
COUNTS = {"fixture-water": 5, "fixture-scroll": 2, "fixture-walk": 1}
EXAMS = [   # days from the seeding day: always in the future
    {"id": "fx-exam-circuits", "subject": "fixture-circuits", "title": "Fixture Circuits end-sem (invented)", "code": "FX101",
     "kind": "end_sem", "days": 12, "start": "10:00", "end": "13:00", "units": [1, 2], "max": 70},
    {"id": "fx-exam-signals", "subject": "fixture-signals", "title": "Fixture Signals internal (invented)", "code": "FX202",
     "kind": "cie", "days": 25, "start": "10:00", "end": "11:30", "units": [1], "max": 30},
]

# ------------------------------------------------------------------ Classroom: two courses, files, work, notices, calendar
COURSES = {"fx1001": "Invented Fixture Circuits", "fx1002": "Invented Fixture Signals"}
F_PDF, F_DOCX, F_STALE, F_SHARED, F_PAPER = "fxNotesPdf001", "fxLabDocx002", "fxStalePdf003", "fxSharedPdf04", "fxPaperPdf005"
W_LATE, W_DONE, W_NODUE, W_SOON = "fxWorkLate01", "fxWorkDone02", "fxWorkNoDue03", "fxWorkSoon04"
NOTICES = {"fx1001": ["fxNotice0001", "fxNotice0002"], "fx1002": ["fxNotice0003"]}
EVENTS = ["fxEvent0001", "fxEvent0002"]
DRAFT_TOPIC = ("fixture-circuits", 1, "Imaginary resistor ladders")
# A sentence of the invented notes that the fixture drafter hands back word for word: the real copy rule
# (drafts.COPY_AT) must set it aside as rejected, so the rejected draft is the rule's own verdict.
COPIED = ("An imaginary resistor ladder in the fixture kit splits a pretend supply into equal invented steps, "
          "one rung after another, so every rung of the ladder holds the same made-up share of the supply.")
NOTES_TEXT = [
    COPIED,
    "The pretend node sums of the fixture kit add every invented current that meets at a node, and the made-up total "
    "is always zero, which is the only rule of these imaginary resistor ladders worth keeping in mind.",
]

# ------------------------------------------------------------------ the paper desk
# (label, text, marks, unit, topic): eight questions a paper, two a topic, 40 marks printed as [5]
_T = [(1, "Imaginary resistor ladders"), (1, "Pretend node sums"), (2, "Toy capacitor charging"), (2, "Invented switch timing")]
_Q = {
    (1, "Imaginary resistor ladders"): ["Explain how an imaginary resistor ladder of the fixture kit splits a pretend supply.",
                                       "Sketch an imaginary resistor ladder with four invented rungs and label each rung."],
    (1, "Pretend node sums"): ["State the pretend node sum rule of the fixture kit in your own words.",
                               "Apply the pretend node sum rule to an invented node with three made-up currents."],
    (2, "Toy capacitor charging"): ["Describe how a toy capacitor of the fixture kit charges through a pretend resistor.",
                                    "Draw the made-up charging curve of a toy capacitor and mark its invented steps."],
    (2, "Invented switch timing"): ["Explain the invented switch timing of the fixture kit with one made-up example.",
                                    "Compare two invented switch timings of the fixture kit and say which is quicker."],
}
TEXT_PAPERS = [   # (name, title, year, variant); the first is the one text paper the UI lane names
    ("fixture-circuits-a", "Invented Fixture Circuits practice paper A (sandbox, not a real exam)", 2024, 0),
    ("fixture-circuits-b", "Invented Fixture Circuits practice paper B (sandbox, not a real exam)", 2025, 1),
    ("fixture-circuits-c", "Invented Fixture Circuits practice paper C (sandbox, not a real exam)", 2026, 2),
]
SCANNED = ("fixture-signals-scan", "Invented Fixture Signals scanned paper (sandbox, pictures only)", 2026)
SCANNED_PAGES = 2

# ------------------------------------------------------------------ the harvester's pointer (an address that is obviously no site)
HARVEST_ADDRESS = "https://papers.invented-fixture.example/past-papers.html"
HARVEST_PDF = "https://papers.invented-fixture.example/fixture/FX-101-invented-sample.pdf"
HARVEST_PAGE = ("<html><body><table><tr><th>Subject code</th><th>Subject name</th><th>Year</th></tr>"
                f"<tr><td><a href=\"{HARVEST_PDF}\">FX 101</a></td>"
                f"<td><a href=\"{HARVEST_PDF}\">Invented Fixture Circuits sample paper (not a real exam)</a></td><td>2026</td></tr>"
                "</table></body></html>")

_seed_lock = threading.Lock()


# ================================================================== guards and context
def _inside(p: Path, root: Path) -> bool:
    try:
        p.resolve().relative_to(root.resolve())
        return True
    except (ValueError, OSError):
        return False


def _refuse_real(data_dir: Path) -> None:
    """Seed mode writes invented rows; it must never write them among his, nor read his while it does."""
    if not os.environ.get("JARVIS_DATA_DIR"):
        # without it paths.DATA (and germoney's profile, academics and kv) is the real data/app folder
        raise RuntimeError("Seed mode needs JARVIS_DATA_DIR set to a scratch folder before jarvis_app is imported.")
    from . import paths
    for real in (paths.REPO / "data", Path(paths.home.DATA)):
        if _inside(data_dir, real):
            raise RuntimeError(f"Seed mode never writes inside {real}.")


class _Ids:
    """Question and draft ids of the store's own shape, drawn from a hash instead of uuid4 while seeding."""

    def __init__(self):
        self.ns, self.n = "", 0

    def name(self, ns: str) -> None:
        self.ns, self.n = ns, 0

    def hex12(self) -> str:
        self.n += 1
        return hashlib.sha256(f"ww-seed:{self.ns}:{self.n}".encode()).hexdigest()[:12]


@contextmanager
def _seeding(data_dir: Path):
    """Point every call-time lookup at the scratch folder for the length of the seed, then put everything back."""
    from . import paths
    from .ww_pyq import drafts, ingest
    ids = _Ids()
    env = {"JARVIS_ENGINE_INPUTS": str(data_dir / "engine-inputs.json"), "WW_BANK_DIR": str(data_dir / "bank" / "questions")}
    old_env = {k: os.environ.get(k) for k in env}
    old = (paths.DATA, ingest._new_id, drafts.uuid)
    with _seed_lock:
        os.environ.update(env)
        paths.DATA = data_dir
        ingest._new_id = lambda: f"q-{ids.hex12()}"
        drafts.uuid = SimpleNamespace(uuid4=lambda: SimpleNamespace(hex=ids.hex12()))
        try:
            yield ids
        finally:
            paths.DATA, ingest._new_id, drafts.uuid = old
            for k, v in old_env.items():
                if v is None:
                    os.environ.pop(k, None)
                else:
                    os.environ[k] = v


# ================================================================== invented files
def _pdf(pages: list) -> bytes:
    """A PDF built the same byte for byte on every run (no_new_id), so its paper id is fixed. A page is a list of
    (x, text) lines, or {"image": [lines]} for a page that is only a picture (a scan has no text layer)."""
    import fitz
    doc = fitz.open()
    for body in pages:
        page = doc.new_page(width=595, height=842)
        if isinstance(body, dict):
            src = fitz.open()
            sp = src.new_page(width=595, height=842)
            for i, line in enumerate(body["image"]):
                sp.insert_text((72, 100 + 30 * i), line, fontsize=14)
            page.insert_image(page.rect, pixmap=sp.get_pixmap(dpi=72))
            src.close()
            continue
        y = 72
        for x, line in body:
            if x == "box":                                   # a wrapped paragraph of notes
                rect = fitz.Rect(72, y, 523, y + 120)
                page.insert_textbox(rect, line, fontsize=11)
                y += 130
            else:
                page.insert_text((x, y), line, fontsize=10)
                y += 24
    doc.set_metadata({})
    data = doc.tobytes(garbage=3, deflate=True, no_new_id=True)
    doc.close()
    return data


def _docx(paragraphs: list[str]) -> bytes:
    import docx
    d = docx.Document()
    for p in paragraphs:
        d.add_paragraph(p)
    buf = io.BytesIO()
    d.save(buf)
    return buf.getvalue()


def _text_paper(title: str, variant: int) -> tuple[bytes, list[tuple[str, int, str]]]:
    """One invented paper and, for each label, the (label, unit, topic) it was written for."""
    lines = [(150, title), (72, "Max. Marks: 40          Time: 1 hour          (invented for the sandbox)")]
    tags = []
    n = 0
    for k in range(2):
        for unit, topic in _T:
            n += 1
            text = _Q[(unit, topic)][(k + variant) % 2]
            lines.append((72, f"{n}. {text} [5]"))
            tags.append((str(n), unit, topic))
    return _pdf([lines]), tags


# ================================================================== a fake Google, read through the real GoogleApi
CR = "https://classroom.googleapis.com/v1"
DR = "https://www.googleapis.com/drive/v3"


class FakeClassroom:
    """Answers the Classroom, Drive and Calendar requests the sync makes, with invented rows. `phase` 1 serves every file;
    phase 2 serves a newer version of F_STALE that may not be downloaded, so the real sync keeps the old copy as stale."""

    def __init__(self, today: date):
        self.today = today
        self.phase = 2
        notes = _pdf([[("box", t) for t in NOTES_TEXT]])
        self.files = {
            F_PDF: {"name": "Fixture Circuits unit 1 notes (invented).pdf", "mimeType": "application/pdf",
                    "modifiedTime": "2026-11-02T10:00:00Z", "body": notes},
            F_DOCX: {"name": "Fixture Signals lab sheet (invented).docx",
                     "mimeType": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
                     "modifiedTime": "2026-11-03T10:00:00Z",
                     "body": _docx(["Fixture Signals lab sheet. Everything on this sheet is invented for the sandbox.",
                                    "Sketch a toy sine wave on the pretend grid and count its invented peaks."])},
            F_STALE: {"name": "Fixture Circuits unit 2 slides (invented).pdf", "mimeType": "application/pdf",
                      "modifiedTime": "2026-11-04T10:00:00Z",
                      "body": _pdf([[("box", "Toy capacitor charging, as the invented slides of the fixture kit show it: "
                                             "a pretend capacitor fills in made-up steps through an imaginary resistor.")]])},
            F_SHARED: {"name": "Fixture shared formula sheet (invented).pdf", "mimeType": "application/pdf",
                       "modifiedTime": "2026-11-05T10:00:00Z",
                       "body": _pdf([[("box", "A formula sheet shared by both invented courses: every formula on it is made up.")]])},
            F_PAPER: {"name": "Fixture Circuits unit test paper (invented).pdf", "mimeType": "application/pdf",
                      "modifiedTime": "2026-11-06T10:00:00Z",
                      "body": _pdf([[(72, "Invented unit test of the fixture kit (sandbox, not a real exam)"),
                                     (72, "1. Explain an imaginary resistor ladder of the fixture kit. [5]"),
                                     (72, "2. State the pretend node sum rule of the fixture kit. [5]")]])},
        }

    def api(self):
        import httpx
        from .ww_gcr.api import GoogleApi
        return GoogleApi(token=lambda: "fixture-token", transport=httpx.MockTransport(self.handler))

    def _day(self, n: int) -> date:
        return self.today + timedelta(days=n)

    def _stamp(self, n: int, hour: int = 9) -> str:
        return f"{self._day(n).isoformat()}T{hour:02d}:00:00Z"

    def _drive(self, fid: str) -> dict:
        return {"driveFile": {"driveFile": {"id": fid, "title": self.files[fid]["name"],
                                            "alternateLink": f"https://drive.invented-fixture.example/{fid}"}}}

    def _link(self, kind: str, pid: str) -> str:
        # an address under Classroom's own prefix: G-16 opens only those, and the sandbox swaps the opening for a refusal
        return f"https://classroom.google.com/c/fixture/{kind}/{pid}"

    def _due(self, n: int) -> dict:
        d = self._day(n)
        return {"dueDate": {"year": d.year, "month": d.month, "day": d.day}, "dueTime": {"hours": 12, "minutes": 30}}

    def _meta(self, fid: str) -> dict:
        f = self.files[fid]
        modified = "2026-11-20T10:00:00Z" if (fid == F_STALE and self.phase == 2) else f["modifiedTime"]
        return {"id": fid, "name": f["name"], "mimeType": f["mimeType"], "modifiedTime": modified,
                "webViewLink": f"https://drive.invented-fixture.example/{fid}"}

    def handler(self, request):
        import httpx
        url = str(request.url).split("?")[0]
        q = dict(request.url.params)
        if request.method != "GET":
            return httpx.Response(405, json={"error": {"message": "read only"}})
        if url == f"{CR}/courses":
            return httpx.Response(200, json={"courses": [
                {"id": cid, "name": name, "section": "Sandbox", "courseState": "ACTIVE",
                 "alternateLink": f"https://classroom.google.com/c/fixture/{cid}", "updateTime": self._stamp(-10)}
                for cid, name in COURSES.items()]})
        m = re.fullmatch(rf"{re.escape(CR)}/courses/(fx100[12])/(.+)", url)
        if m:
            return httpx.Response(200, json=self._course(m.group(1), m.group(2)))
        if url == "https://www.googleapis.com/calendar/v3/calendars/primary/events":
            return httpx.Response(200, json={"items": [
                {"id": EVENTS[0], "summary": "Invented study group (sandbox)", "htmlLink": "https://calendar.invented-fixture.example/1",
                 "start": {"dateTime": self._stamp(2, 10)}, "end": {"dateTime": self._stamp(2, 11)}},
                {"id": EVENTS[1], "summary": "Invented fixture holiday (sandbox)", "htmlLink": "https://calendar.invented-fixture.example/2",
                 "start": {"date": self._day(9).isoformat()}, "end": {"date": self._day(10).isoformat()}}]})
        if url.startswith(f"{DR}/files/"):
            fid = url[len(f"{DR}/files/"):].split("/")[0]
            if fid not in self.files:
                return httpx.Response(404, json={"error": {"message": "not found"}})
            if q.get("alt") == "media":
                if fid == F_STALE and self.phase == 2:
                    return httpx.Response(403, json={"error": {"errors": [{"reason": "cannotDownload"}], "message": "no"}})
                return httpx.Response(200, content=self.files[fid]["body"])
            return httpx.Response(200, json=self._meta(fid))
        return httpx.Response(404, json={"error": {"message": "not in the fixture"}})

    def _course(self, cid: str, rest: str) -> dict:
        if rest == "topics":
            return {"topic": [{"topicId": f"{cid}-t1", "name": "Unit 1 (invented)"}]}
        if rest == "courseWorkMaterials":
            if cid == "fx1001":
                return {"courseWorkMaterial": [
                    {"id": "fxMat0001", "title": "Unit 1 notes (invented)", "topicId": f"{cid}-t1", "updateTime": self._stamp(-6),
                     "alternateLink": self._link("m", "fxMat0001"), "materials": [self._drive(F_PDF), self._drive(F_SHARED)]},
                    {"id": "fxMat0002", "title": "Unit 2 slides (invented)", "updateTime": self._stamp(-5),
                     "alternateLink": self._link("m", "fxMat0002"), "materials": [self._drive(F_STALE)]},
                    {"id": "fxMat0003", "title": "Unit test paper (invented)", "updateTime": self._stamp(-4),
                     "alternateLink": self._link("m", "fxMat0003"), "materials": [self._drive(F_PAPER)]}]}
            return {"courseWorkMaterial": [
                {"id": "fxMat0004", "title": "Lab sheet (invented)", "updateTime": self._stamp(-6),
                 "alternateLink": self._link("m", "fxMat0004"), "materials": [self._drive(F_DOCX)]},
                {"id": "fxMat0005", "title": "Shared formula sheet (invented)", "updateTime": self._stamp(-3),
                 "alternateLink": self._link("m", "fxMat0005"), "materials": [self._drive(F_SHARED)]}]}
        if rest == "courseWork":
            if cid != "fx1001":
                return {}
            return {"courseWork": [
                {"id": W_LATE, "title": "Invented ladder worksheet (late)", "updateTime": self._stamp(-8),
                 "alternateLink": self._link("a", W_LATE), **self._due(-3)},
                {"id": W_DONE, "title": "Invented node sums exercise (turned in)", "updateTime": self._stamp(-9),
                 "alternateLink": self._link("a", W_DONE), **self._due(-5)},
                {"id": W_NODUE, "title": "Invented reading log (no due date)", "updateTime": self._stamp(-7),
                 "alternateLink": self._link("a", W_NODUE)},
                {"id": W_SOON, "title": "Invented capacitor report (due soon)", "updateTime": self._stamp(-2),
                 "alternateLink": self._link("a", W_SOON), **self._due(6)}]}
        if rest == "courseWork/-/studentSubmissions":
            if cid != "fx1001":
                return {}
            return {"studentSubmissions": [
                {"courseWorkId": W_LATE, "state": "CREATED", "late": True, "updateTime": self._stamp(-2)},
                {"courseWorkId": W_DONE, "state": "TURNED_IN", "updateTime": self._stamp(-6)},
                {"courseWorkId": W_NODUE, "state": "NEW", "updateTime": self._stamp(-7)},
                {"courseWorkId": W_SOON, "state": "NEW", "updateTime": self._stamp(-2)}]}
        if rest == "announcements":
            texts = {"fxNotice0001": "Invented notice: the fixture lab moves to the pretend room on Friday.",
                     "fxNotice0002": "Invented notice: bring the made-up formula sheet to the next class.",
                     "fxNotice0003": "Invented notice: the toy sine lab is open all week in the sandbox."}
            return {"announcements": [{"id": nid, "text": texts[nid], "creationTime": self._stamp(-1 - i), "updateTime": self._stamp(-1 - i),
                                       "alternateLink": self._link("p", nid)} for i, nid in enumerate(NOTICES[cid])]}
        return {}


def plan_subjects() -> list[dict]:
    """The subjects as routes_ww_gcr._subjects gives them to a sync: {id, name, code}."""
    return [{"id": s["id"], "name": s["name"], "code": s["code"]} for s in SUBJECTS]


# ================================================================== the areas
def _seed_plan(data_dir: Path, today: date) -> dict:
    from . import germoney, ww_engines
    inputs = data_dir / "engine-inputs.json"
    ww_engines.save_section("subjects", [dict(s) for s in SUBJECTS], path=inputs, today=today.isoformat())
    exams = [{k: v for k, v in e.items() if k != "days"} | {"date": (today + timedelta(days=e["days"])).isoformat()} for e in EXAMS]
    ww_engines.save_section("exams", exams, path=inputs, today=today.isoformat())
    ww_engines.save_section("life", {"counters": [dict(c) for c in COUNTERS]}, path=inputs, today=today.isoformat())
    root = data_dir / "germoney"
    kv = germoney.KVStore(root=root / "kv", backups=root / "backups")
    plan = germoney.Plan(kv, academics_loader=lambda: germoney.load_academics(root / "academics" / "academics.json"))
    for cid, v in COUNTS.items():
        plan.life_tap("count", {"id": cid, "value": v}, today=today.isoformat())
    return {"subjects": [s["id"] for s in SUBJECTS], "exams": [e["id"] for e in EXAMS],
            "counters": [c["id"] for c in COUNTERS], "yes_no_counter": "fixture-walk"}


def _seed_classroom(data_dir: Path, today: date) -> dict:
    from .ww_gcr import sync as sync_mod
    store = sync_mod.GcrStore(data_dir / "gcr")
    g = FakeClassroom(today)
    # Phase 2 offers a newer F_STALE that cannot be fetched, so the old copy stays, marked stale. A second seed runs phase 2
    # only: a phase-1 fetch of the older version would clear `stale` while the manifest keeps the refusal, and the next
    # phase 2 then repeats the refusal without asking and leaves the file looking fresh (seen on the first trial run).
    have = store.manifest(fresh_ok=True)["files"].get(F_STALE)
    for phase in ((2,) if have else (1, 2)):
        g.phase = phase
        api = g.api()
        try:
            sync_mod.sync(api, store, subjects=plan_subjects(), account="main")
        finally:
            api.close()
    return {"mode": FIXTURE_TAG, "courses": list(COURSES),
            "files": {"pdf": F_PDF, "docx": F_DOCX, "stale": F_STALE, "also_in": F_SHARED, "paper": F_PAPER},
            "assignments": {"late": W_LATE, "turned_in": W_DONE, "no_due_date": W_NODUE, "future": W_SOON},
            "announcements": [n for c in COURSES for n in NOTICES[c]], "calendar": list(EVENTS)}


def _seed_papers(data_dir: Path, ids: _Ids) -> dict:
    from .ww_pyq import ingest
    from .ww_pyq.store import Store
    st = Store(data_dir / "pyq")
    out: dict = {"text": "", "text_more": [], "scanned": "", "questions": {}}
    with tempfile.TemporaryDirectory(prefix="ww-seed-") as tmp:
        for i, (name, title, year, variant) in enumerate(TEXT_PAPERS):
            data, tags = _text_paper(title, variant)
            p = Path(tmp) / f"{name}.pdf"
            p.write_bytes(data)
            ids.name(hashlib.sha256(data).hexdigest())
            pid = ingest.ingest_pdf(p, store=st, meta={"title": title, "subject": "fixture-circuits", "year": year,
                                                       "exam_kind": "other", "source_note": "invented for the sandbox"})["paper"]["id"]
            by_label = {q["label"]: q for q in st.list_questions(pid)}
            # seven of eight accepted and tagged a paper: 21 counted questions over 3 papers is over the pattern floor
            # (3 papers, 20 questions), and the eighth stays pending so the review queue is not empty
            for label, unit, topic in tags[:-1]:
                q = by_label.get(label)
                if q is not None and (q["status"], q.get("unit"), q.get("topic")) != ("accepted", unit, topic):
                    st.update_question(q["id"], {"status": "accepted", "unit": unit, "topic": topic}, by="hand")
            out["questions"][pid] = [q["id"] for q in st.list_questions(pid)]
            if i == 0:
                out["text"] = pid
            else:
                out["text_more"].append(pid)
        name, title, year = SCANNED
        data = _pdf([{"image": [f"Invented fixture scan, page {n} (not a real paper)", "Pictures only: no text layer."]}
                     for n in range(1, SCANNED_PAGES + 1)])
        p = Path(tmp) / f"{name}.pdf"
        p.write_bytes(data)
        ids.name(hashlib.sha256(data).hexdigest())
        pid = ingest.ingest_pdf(p, store=st, meta={"title": title, "subject": "fixture-signals", "year": year,
                                                   "exam_kind": "other", "source_note": "invented for the sandbox"})["paper"]["id"]
    out["scanned"] = pid
    out["ocr"] = {"paper": pid, "pages": list(range(1, SCANNED_PAGES + 1)), "whole_page_draft_page": 1, "below_gate_page": 2}
    return out


def fixture_drafter(system: str, user: str) -> str:
    """Stands where the local model stands (ww_counsel provider): invented questions on the topic the request names, in the
    JSON shape asked for. It reads only the request, so the same request gives the same drafts."""
    topic = (re.search(r"^Topic:\s*(.+)$", user, re.M) or [None, "the topic"])[1].strip()
    count = int((re.search(r"^Number of questions:\s*(\d)", user, re.M) or [None, "2"])[1])
    qs = [f"Fixture draft (invented, no model was asked): explain {topic} with one made-up example from the fixture kit.",
          f"Fixture draft (invented, no model was asked): compare two pretend cases of {topic} and say which is simpler.",
          f"Fixture draft (invented, no model was asked): sketch {topic} and label two invented parts."]
    return json.dumps({"questions": qs[:max(1, min(count, 3))]})


def _seed_drafts(data_dir: Path, ids: _Ids) -> dict:
    from .routes_ww_pyq_drafts import notes_of
    from .ww_pyq import drafts
    from .ww_pyq.store import Store
    st = Store(data_dir / "pyq")
    sid, unit, topic = DRAFT_TOPIC
    sub = next(s for s in SUBJECTS if s["id"] == sid)
    title = next(u["title"] for u in sub["units"] if u["n"] == unit)
    notes = notes_of(sid)                                          # the notes the real sync wrote, read the real way
    new = (f"Explain, in your own words, how {topic.lower()} share a pretend supply, using an invented ladder of three rungs.")

    def provider(system: str, user: str) -> str:                  # one new question and one lifted from the notes word for word
        return json.dumps({"questions": [new, COPIED]})
    ids.name(f"drafts:{sid}")
    drafts.draft_from_notes(st, subject=sid, topic=topic, unit=unit, unit_title=title, count=2, notes=notes, provider=provider)
    rows = drafts.list_drafts(st, sid)
    pending = next((d["id"] for d in rows if d["status"] == "pending"), "")
    rejected = next((d["id"] for d in rows if d["status"] == "rejected"), "")
    return {"subject": sid, "topic": topic, "pending": pending, "rejected": rejected,
            "notes": sorted({s["file_id"] for d in rows for s in d.get("sources") or []})}


def _seed_harvest(data_dir: Path) -> dict:
    from . import ww_harvest as wh
    from . import ww_harvest_sources as papers
    from .ww_check_harvest import FakeNet
    net = FakeNet().add(HARVEST_ADDRESS, HARVEST_PAGE, headers={"content-type": "text/html"})
    h = wh.Harvester(transport=net, sleep=lambda s: None, delay=(0.0, 0.0), host_gap=0.0)
    sid = "papers_table"
    key = papers.key_of(HARVEST_PDF)
    if not any(m.get("source") == sid and m.get("url") == HARVEST_PDF for m in papers.manifest(h, sid)):
        # the source is switched on only long enough for its own fetch to write the pointer, then back to its default
        papers.set_switches(h, sid, {"on": True, "address": HARVEST_ADDRESS})
        try:
            papers.index(h, sid)
            papers.fetch(h, sid, key)
        finally:
            papers.set_switches(h, sid, {"on": False, "address": ""})
    return {"sources": sorted(papers.ADAPTERS), "pointer": {"source": sid, "key": key, "url": HARVEST_PDF}}


def seed_study(data_dir, today: Optional[date] = None) -> dict:
    """Fill `data_dir` with the invented study rows. The ids come back grouped by area; a second run into the same folder
    finds every row on file and gives the same ids (dates move with the day it runs: an exam stays in the future)."""
    data_dir = Path(data_dir).resolve()
    _refuse_real(data_dir)
    data_dir.mkdir(parents=True, exist_ok=True)
    today = today or date.today()
    with _seeding(data_dir) as ids:
        out = {"version": SEED_VERSION, "plan": _seed_plan(data_dir, today)}
        lc = out["plan"]
        out["life"] = {"counters": lc.pop("counters"), "yes_no": lc.pop("yes_no_counter")}
        out["classroom"] = _seed_classroom(data_dir, today)
        out["papers"] = _seed_papers(data_dir, ids)
        out["drafts"] = _seed_drafts(data_dir, ids)
        out["harvest"] = _seed_harvest(data_dir)
    (data_dir / MARKER).write_text(json.dumps(out, indent=1), encoding="utf-8")
    return out


# ================================================================== the swaps for a running seeded app
def fixture_reader(delay: float = OCR_DELAY) -> Callable[[Path], dict]:
    """Stands where RapidOCR stands (ocr.OcrJob's `ocr`): the 150 dpi page picture in, lines with a confidence out. Page 1
    reads at 0.91 with no question start (the real rule makes it one whole-page draft), page 2 at 0.72 (under the 0.85 gate,
    left as a picture), a later page at 0.90 with one invented question. Every line says it is invented."""
    def read(png: Path) -> dict:
        time.sleep(max(0.0, delay))
        n = int(Path(png).stem[1:] or 0)
        if n == 1:
            texts, conf = ["Fixture OCR cell: invented table header", "Fixture OCR cell: made-up value twelve",
                           "Fixture OCR cell: pretend value seven"], 0.91
        elif n == 2:
            texts, conf = ["Fixture OCR: invented smudged line", "Fixture OCR: another made-up smudge"], 0.72
        else:
            texts, conf = [f"{n}. Fixture OCR question (invented text, not read from this page). [2]"], 0.90
        lines = [{"text": t, "confidence": conf, "box": [150.0, 200.0 + 60 * i, 1100.0, 232.0 + 60 * i]} for i, t in enumerate(texts)]
        return {"lines": lines, "mean_confidence": conf, "seconds": delay, "device": "fixture"}
    return read


def fixture_engine_info() -> dict:
    return {"name": "Fixture OCR (sandbox: invented text, no real reading)", "version": FIXTURE_TAG, "device": "fixture", "installed": True}


def install_fixtures(setter: Callable[[Any, str, Any], None] = setattr) -> None:
    """Swap what reaches outside the box for fixtures, through the same seams the tests use: the Google sign-in and API of
    routes_ww_gcr and ww_gcr.auth, the OCR engine's description, the browser and the PC's program opener, and the source
    sentences of the three families. `setter` is setattr, or a test's monkeypatch.setattr so it is undone after."""
    import httpx  # noqa: F401  (the fake Google rides on httpx.MockTransport)
    from . import routes_ww_gcr, routes_ww_pyq_drafts, routes_ww_pyq_ocr
    from .ww_gcr import auth
    from .ww_pyq import ocr
    scopes = sorted(auth.SCOPES)
    fake = FakeClassroom(date.today())

    def status(account: str = auth.MAIN) -> dict:
        auth._slot(account)
        return {"state": "live", "reason": GOOGLE_REASON, "scopes": scopes, "missing": []}

    def connect(*a, **k) -> dict:
        raise auth.NotConnected("Fixture mode: there is no Google account to connect in the sandbox; the Classroom rows are invented.")

    def disconnect(*a, **k) -> dict:
        return status()

    def refuse_open(url: str) -> None:
        raise ValueError("Fixture mode: the invented assignment page is not opened in the sandbox.")

    def refuse_program(path: Path) -> None:
        raise ValueError("Fixture mode: files are not opened in a program from the sandbox.")

    setter(auth, "status", status)
    setter(auth, "accounts", lambda: [auth.MAIN])
    setter(auth, "access_token", lambda *a, **k: "fixture-token")
    setter(auth, "connect", connect)
    setter(auth, "disconnect", disconnect)
    setter(routes_ww_gcr, "_api", lambda account=auth.MAIN: fake.api())
    setter(routes_ww_gcr, "SOURCE", GOOGLE_SOURCE)
    setter(routes_ww_gcr, "open_url", refuse_open)
    setter(routes_ww_gcr, "opener", refuse_program)
    setter(ocr, "engine_info", fixture_engine_info)
    setter(routes_ww_pyq_ocr, "SOURCE", OCR_SOURCE)
    setter(routes_ww_pyq_drafts, "SOURCE", DRAFTS_SOURCE)
    # The file route serves from four folders. Three follow the scratch data directory; the fourth is a fixed folder in the
    # home directory (germoney.COLLEGE), which a sandbox must not be able to list or serve. It is pointed inside the box.
    from . import germoney
    setter(germoney, "COLLEGE", Path(os.environ.get("JARVIS_DATA_DIR") or tempfile.gettempdir()) / "no-college-folder")


def attach(app, ocr_delay: float = OCR_DELAY) -> None:
    """One built app: its OCR job reads with the fixture reader, and R-50 asks the fixture drafter instead of the model."""
    from .ww_pyq import ocr
    bus = getattr(getattr(app.state, "svc", None), "bus", None)
    app.state.pyq_ocr = ocr.OcrJob(bus, ocr=fixture_reader(ocr_delay))
    app.state.pyq_draft_provider = fixture_drafter


def wrap_create_app(create_app: Callable, ocr_delay: float = OCR_DELAY) -> Callable:
    def build(*a, **k):
        app = create_app(*a, **k)
        attach(app, ocr_delay)
        return app
    return build
