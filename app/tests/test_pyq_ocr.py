"""OCR on demand (ww_pyq/ocr.py, routes R-28, R-48, R-49). The engine is a fake here: lines the test writes, with the
confidence the test chooses, so the gate and the honesty rules are tested without 14 s a page. One real reading is opt-in.
"""
import os
import threading

import pytest
from starlette.testclient import TestClient

from jarvis_app.security import Guard
from jarvis_app.server import create_app
from jarvis_app.ww_pyq import ingest, ocr
from jarvis_app.ww_pyq import store as store_mod
from jarvis_app.ww_pyq.store import Store
from pyq_fixtures import build_pdf

TOKEN = "t" * 32
B = "/api/mission/pyq"
SCAN_LINES = ["3. Calculate the gain of the amplifier shown. (5 marks)", "4. Define the bandwidth of a filter. (2 marks)"]
PAPER = {"name": "one_scan", "pages": [
    ["Max. Marks: 10", "1. State the sampling theorem. (3 marks)"],
    {"image": SCAN_LINES},
    {"image": ["5. Explain aliasing with a sketch. (4 marks)"]},
]}
TEXT = {2: SCAN_LINES, 3: ["5. Explain aliasing with a sketch. (4 marks)"]}


def fake(lines_by_page, conf=0.95, calls=None, hold=None):
    """An engine that reads what the test says is on each page: 150 px is the 72 pt left margin at 150 dpi."""
    def read(png):
        n = int(png.stem[1:])
        if calls is not None:
            calls.append(n)
        if hold is not None:
            hold.wait(10)
        c = conf[n] if isinstance(conf, dict) else conf
        lines = [{"text": t, "confidence": c, "box": [150.0, 200.0 + 60 * i, 1100.0, 232.0 + 60 * i]}
                 for i, t in enumerate(lines_by_page.get(n, []))]
        return {"lines": lines, "mean_confidence": c if lines else None, "seconds": 0.5, "device": "cpu"}
    return read


@pytest.fixture()
def paper(tmp_path):
    st = Store(tmp_path / "pyq")
    r = ingest.ingest_pdf(build_pdf(PAPER, tmp_path / "made"), store=st)
    return st, r["paper"]["id"]


def test_a_scanned_page_waits_and_nothing_is_read_until_he_asks(paper):
    st, pid = paper
    p = st.get_paper(pid)
    assert p["faults"] == ["p. 2: no text layer; run OCR on this paper", "p. 3: no text layer; run OCR on this paper"]
    assert ocr.unread_pages(p) == [2, 3] and len(st.list_questions(pid)) == 1


def test_read_pages_give_pending_unverified_questions_with_their_confidence_and_crop(paper):
    st, pid = paper
    r = ocr.read_pages(st, pid, ocr=fake(TEXT, 0.93))
    assert (r["pages_read"], r["pages_below_gate"], r["questions"], r["seconds_per_page"]) == (2, 0, 3, 0.5)
    qs = {q["label"]: q for q in st.list_questions(pid)}
    assert set(qs) == {"1", "3", "4", "5"}
    for label in ("3", "4", "5"):
        q = qs[label]
        assert q["status"] == "pending" and q["text_status"] == "unverified" and q["ocr_confidence"] == 0.93
        assert (st.root / q["crop"]["png"]).is_file() and q["marks_source"] == "printed"
    assert (qs["3"]["marks"], qs["4"]["marks"], qs["5"]["marks"], qs["3"]["page"], qs["5"]["page"]) == (5, 2, 4, 2, 3)
    assert qs["1"]["text_status"] == "verified" and qs["1"].get("ocr_confidence") is None      # the text page is untouched
    p = st.get_paper(pid)
    assert p["faults"] == [] and p["method"] == "mixed"
    assert any("p2 ocr cpu 0.93 mean, 2 lines" in e["text"] for e in r["trace"])
    assert st.bank_for("signals") == []                                                         # nothing was accepted for him


def test_a_page_under_the_gate_stays_a_picture_and_says_the_confidence(paper):
    st, pid = paper
    r = ocr.read_pages(st, pid, ocr=fake(TEXT, {2: 0.71, 3: 0.9}))
    assert (r["pages_read"], r["pages_below_gate"], r["questions"]) == (1, 1, 1)
    p = st.get_paper(pid)
    assert p["faults"] == ["p. 2: read at confidence 0.71, below 0.85; left as a picture"]
    assert ocr.unread_pages(p) == [] and {q["label"] for q in st.list_questions(pid)} == {"1", "5"}
    with pytest.raises(ValueError, match="no page waiting"):
        ocr.read_pages(st, pid, ocr=fake(TEXT))                                                 # a page under the gate is not read again by itself


def test_a_blank_or_broken_page_is_a_fault_of_that_page_only(paper):
    st, pid = paper
    assert ocr.GATE == 0.85

    def engine(png):
        if png.stem == "p002":
            raise RuntimeError("native failure")
        return {"lines": [], "mean_confidence": None, "seconds": 0.1, "device": "cpu"}

    r = ocr.read_pages(st, pid, ocr=engine)
    assert r["pages_read"] == 0 and r["questions"] == 0 and r["pages_done"] == 2
    assert sorted(st.get_paper(pid)["faults"]) == ["p. 2: OCR could not read this page (RuntimeError)", "p. 3: OCR found no text on this page"]
    assert st.get_paper(pid)["method"] == "text-layer"                                          # nothing was read, so the method stays


def test_only_the_pages_asked_for_are_read_and_a_stop_ends_before_the_next_page(paper):
    st, pid = paper
    calls = []
    r = ocr.read_pages(st, pid, [3], ocr=fake(TEXT, calls=calls))
    assert calls == [3] and r["pages_read"] == 1 and ocr.unread_pages(st.get_paper(pid)) == [2]
    stop = threading.Event()
    stop.set()
    r = ocr.read_pages(st, pid, ocr=fake(TEXT, calls=calls), stop=stop)
    assert r["stopped"] is True and r["pages_done"] == 0 and calls == [3]


@pytest.mark.parametrize("read, opened", [
    ("3.Calculate the gain of the amplifier shown.(5 marks)", "3. Calculate the gain of the amplifier shown. (5 marks)"),
    ("Q4)Define the bandwidth.[2]", "Q4) Define the bandwidth. [2]"),
    ("12.(a) State the theorem", "12. (a) State the theorem"),
    ("3.5 V is applied to the gate.", "3.5 V is applied to the gate."),            # a number, not a label
    ("4. Define the bandwidth of a filter. (2 marks)", "4. Define the bandwidth of a filter. (2 marks)"),
    ("the value f(5) is found", "the value f(5) is found"),                          # not at the end of the line
])
def test_the_spaces_the_engine_drops_are_opened_again_and_nothing_else_changes(read, opened):
    assert ocr.open_joins(read) == opened


def test_text_read_without_its_spaces_still_gives_questions_with_marks(paper):
    st, pid = paper
    glued = {2: ["3.Calculate the gain of the amplifier shown.(5 marks)", "4.Define the bandwidth of a filter.(2 marks)"]}
    r = ocr.read_pages(st, pid, [2], ocr=fake(glued))
    got = {q["label"]: q["marks"] for q in st.list_questions(pid) if q["page"] == 2}
    assert r["questions"] == 2 and got == {"3": 5, "4": 2}


@pytest.fixture()
def client(tmp_path, monkeypatch):
    st = Store(tmp_path / "pyq")
    monkeypatch.setattr(store_mod, "default_store", lambda: st)
    pid = ingest.ingest_pdf(build_pdf(PAPER, tmp_path / "made"), store=st)["paper"]["id"]
    app = create_app(Guard(8777, TOKEN, extra_hosts=["testserver"]), autostart_aankhen="off",
                     features=["ww_pyq", "ww_pyq_ingest", "ww_pyq_ocr"])
    with TestClient(app) as c:
        c.headers.update({"X-Jarvis-Token": TOKEN})
        yield c, st, pid, app


def test_the_three_routes_answer_with_the_envelope_and_are_in_the_docstring(client):
    c, st, pid, app = client
    import jarvis_app.routes_ww_pyq_ocr as mod
    for row in ("GET    /api/mission/pyq/ocr", "POST   /api/mission/pyq/papers/{pid}/ocr", "DELETE /api/mission/pyq/ocr"):
        assert row in mod.__doc__
    app.state.pyq_ocr = ocr.OcrJob(None, ocr=fake(TEXT, {2: 0.95, 3: 0.6}))
    j = c.get(f"{B}/ocr").json()
    assert j["state"] == "waiting" and j["reason"] == "1 paper has 2 pages with no text layer." and j["source"]
    assert j["gate"] == 0.85 and j["job"] is None and j["waiting"] == {"papers": 1, "pages": 2}
    assert set(j["engine"]) == {"name", "version", "device", "installed"}
    assert c.delete(f"{B}/ocr").status_code == 400
    assert c.post(f"{B}/papers/p-000000000000/ocr").status_code == 404
    assert c.post(f"{B}/papers/{pid}/ocr", json={"pages": ["2"]}).status_code == 400
    r = c.post(f"{B}/papers/{pid}/ocr")
    assert r.status_code == 200 and r.json()["job"]["paper_id"] == pid
    app.state.pyq_ocr.wait(20)
    j = c.get(f"{B}/ocr").json()
    assert j["state"] == "live" and j["reason"] == "Read 1 of 2 pages: 2 drafts to review; 1 page was below 0.85 and is left as a picture."
    job = j["job"]
    assert job["status"] == "done" and job["started"][:4].isdigit() and "T" in job["started"] and "T" in job["finished"]
    assert c.post(f"{B}/papers/{pid}/ocr").status_code == 400                                   # nothing waits any more
    assert c.get(f"{B}/ocr").json()["waiting"] == {"papers": 0, "pages": 0}


def test_a_second_start_is_409_and_stop_ends_the_job_as_stopped(client):
    c, st, pid, app = client
    hold = threading.Event()
    app.state.pyq_ocr = ocr.OcrJob(None, ocr=fake(TEXT, hold=hold))
    assert c.post(f"{B}/papers/{pid}/ocr").json()["state"] == "live"
    assert c.post(f"{B}/papers/{pid}/ocr").status_code == 409
    j = c.delete(f"{B}/ocr").json()
    assert j["state"] == "waiting" and j["reason"] == "Stopping after the page being read."
    hold.set()
    job = app.state.pyq_ocr.wait(20)
    assert job["status"] == "stopped" and job["pages_done"] == 1 and job["finished"]
    assert ocr.unread_pages(st.get_paper(pid)) == [3]


def test_ocr_does_not_start_while_the_paper_desk_reads_and_says_so_without_an_engine(client, monkeypatch):
    c, st, pid, app = client
    monkeypatch.setattr(app.state.pyq_ingest, "running", lambda: True)
    r = c.post(f"{B}/papers/{pid}/ocr")
    assert r.status_code == 409 and "paper desk" in r.json()["detail"]
    monkeypatch.setattr(app.state.pyq_ingest, "running", lambda: False)
    monkeypatch.setattr(ocr, "installed", lambda: False)
    app.state.pyq_ocr = ocr.OcrJob(None)
    r = c.post(f"{B}/papers/{pid}/ocr")
    assert r.status_code == 400 and r.json()["detail"] == "No OCR engine is installed."
    j = c.get(f"{B}/ocr").json()
    assert j["state"] == "fault" and j["reason"] == "No OCR engine is installed."


@pytest.mark.skipif(os.environ.get("WW_OCR_TEST") != "1" or not ocr.installed(), reason="loads the OCR engine: set WW_OCR_TEST=1 to run")
def test_the_real_engine_reads_a_printed_page(paper):
    st, pid = paper
    r = ocr.read_pages(st, pid, [2])
    assert r["pages_read"] == 1 and r["questions"] == 2
    q = [q for q in st.list_questions(pid) if q["page"] == 2]
    assert all(x["text_status"] == "unverified" and x["ocr_confidence"] >= ocr.GATE for x in q)


def test_a_read_page_with_no_question_start_becomes_one_whole_page_draft_and_says_so(paper):
    st, pid = paper
    cells = {2: ["Roll No", "Course Outcomes", "State the theorem of sampling", "CO1", "Define the gain of an amplifier", "CO2"]}
    r = ocr.read_pages(st, pid, [2], ocr=fake(cells, 0.94))
    assert (r["pages_read"], r["questions"]) == (1, 1)
    q = [x for x in st.list_questions(pid) if x["page"] == 2]
    assert len(q) == 1 and q[0]["label"] == "p2" and q[0]["status"] == "pending" and q[0]["text_status"] == "unverified"
    assert q[0]["marks"] is None and "State the theorem of sampling" in q[0]["text"] and (st.root / q[0]["crop"]["png"]).is_file()
    assert q[0]["crop"]["bbox"][:2] == [0.0, 0.0]                                                # the crop is the whole page
    faults = st.get_paper(pid)["faults"]
    assert "p. 2: read at confidence 0.94; no question start was found, so the whole page is one draft to split by hand" in faults
    assert ocr.unread_pages(st.get_paper(pid)) == [3]                                           # page 2 is not waiting any more
