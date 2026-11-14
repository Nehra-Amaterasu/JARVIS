"""Routes R-12 to R-15 (routes_ww_pyq_ingest.py) through the real app with only that feature mounted.
Each test has its own Store under tmp_path; every paper is invented (pyq_fixtures)."""
from __future__ import annotations

import re
import threading

import pytest
from starlette.testclient import TestClient

from jarvis_app import routes_ww_pyq_ingest as R
from jarvis_app.security import Guard
from jarvis_app.server import create_app
from jarvis_app.ww_pyq import folder, ingest, schema
from jarvis_app.ww_pyq import store as store_mod
from jarvis_app.ww_pyq.store import Store
from pyq_fixtures import BY_NAME, DECK, build_pdf, build_pptx

TOKEN = "t" * 32
B = "/api/mission/pyq"


@pytest.fixture()
def env(tmp_path, monkeypatch):
    st = Store(tmp_path / "pyq")
    monkeypatch.setattr(store_mod, "default_store", lambda: st)
    app = create_app(Guard(8777, TOKEN, extra_hosts=["testserver"]), autostart_aankhen="off", features=["ww_pyq_ingest"])
    with TestClient(app) as c:
        c.headers.update({"X-Jarvis-Token": TOKEN})
        yield c, st, tmp_path


def envelope(j):
    assert j["state"] in schema.STATES and isinstance(j["reason"], str) and j["reason"] and j["source"]


def wait(c):
    return c.app.state.pyq_ingest.wait(60)


def ingest_one(c, path, **meta):
    r = c.post(f"{B}/ingest", json={"path": str(path), **meta})
    assert r.status_code == 200, r.text
    wait(c)
    return r.json()


# ------------------------------------------------------------------ every route answers and is documented
def test_every_route_answers_carries_the_envelope_and_is_in_the_docstring(env):
    c, st, tmp = env
    pdf = build_pdf(BY_NAME["signals_basic"], tmp / "in")
    j = ingest_one(c, pdf)
    envelope(j)
    r = c.get(f"{B}/ingest/last")
    assert r.status_code == 200
    envelope(r.json())
    qid = st.list_questions()[0]["id"]
    r = c.put(f"{B}/crops/{qid}", json={"bbox": [60, 90, 400, 130]})
    assert r.status_code == 200, r.text
    envelope(r.json())
    r = c.post(f"{B}/upload?name=paper%20two.pdf", content=build_pdf(BY_NAME["or_pairs"], tmp / "in").read_bytes())
    assert r.status_code == 200, r.text
    envelope(r.json())
    wait(c)
    doc = R.__doc__
    for rid in ("R-12", "R-13", "R-14", "R-15"):
        assert rid in doc
    rows = re.findall(r"^\s{2,}(GET|POST|PUT|PATCH|DELETE)\s+(/api/\S+)", doc, re.M)
    documented = {(m, p.split("?")[0]) for m, p in rows}
    defined = {(m, r.path) for r in c.app.routes for m in getattr(r, "methods", ()) if r.path.startswith(B) and m != "HEAD"}
    assert len(rows) == 4 and documented == defined
    assert c.get(f"{B}/ingest/last", headers={"X-Jarvis-Token": "wrong"}).status_code in (401, 403)


# ------------------------------------------------------------------ R-12 and R-13
def test_r13_waits_before_any_ingest_and_404_for_an_unknown_job(env):
    c, _, _ = env
    j = c.get(f"{B}/ingest/last").json()
    assert (j["state"], j["reason"], j["job"]) == ("waiting", "No ingest has run.", None)
    assert c.get(f"{B}/ingest/j-nosuchjob1").status_code == 404
    assert c.get(f"{B}/ingest/..%2Fx").status_code == 404


def test_r12_reads_one_file_and_r13_reports_it(env):
    c, st, tmp = env
    pdf = build_pdf(BY_NAME["circuits_sections"], tmp / "in")
    j = ingest_one(c, pdf, subject="circuits", year=2025, exam_kind="cie")
    assert j["state"] == "live" and j["reason"] == "Reading 1 file."
    assert j["job"]["status"] == "running" and j["job"]["total"] == 1 and j["job"]["done"] == 0
    r = c.get(f"{B}/ingest/{j['job']['id']}").json()
    assert r["state"] == "live" and r["job"]["status"] == "done" and r["job"]["done"] == 1
    f = r["job"]["files"][0]
    assert (f["file"], f["status"], f["pages"], f["questions"], f["method"]) == ("circuits_sections.pdf", "added", 1, 6, "text-layer")
    assert r["job"]["trace"][0]["kind"] == "open" and r["job"]["trace"][-1]["kind"] == "done"
    p = st.get_paper(f["paper_id"])
    assert (p["subject"], p["year"], p["exam_kind"]) == ("circuits", 2025, "cie")
    assert c.get(f"{B}/ingest/last").json()["job"]["id"] == j["job"]["id"]
    j2 = ingest_one(c, pdf)
    assert c.get(f"{B}/ingest/{j2['job']['id']}").json()["job"]["files"][0]["status"] == "duplicate"


def test_r12_refuses_a_bad_path_or_type_or_meta(env):
    c, st, tmp = env
    (tmp / "notes.txt").write_text("hello")
    (tmp / "dir.pdf").mkdir()
    pdf = build_pdf(BY_NAME["signals_basic"], tmp / "in")
    for body in ({"path": "relative/paper.pdf"}, {"path": str(tmp / "missing.pdf")}, {"path": str(tmp / "notes.txt")},
                 {"path": str(tmp / "dir.pdf")}, {"path": ""}, {"path": 7}, {}, {"folder": False},
                 {"path": str(pdf), "subject": "Bad Slug"}, {"path": str(pdf), "year": "soon"},
                 {"path": str(pdf), "exam_kind": "party"}, {"path": str(pdf), "source_note": "x" * 501}):
        r = c.post(f"{B}/ingest", json=body)
        assert r.status_code == 400 and r.json()["detail"], body
    assert st.list_papers() == []


def test_r12_folder_reads_the_pending_files_of_the_chosen_folder(env):
    c, st, tmp = env
    r = c.post(f"{B}/ingest", json={"folder": True})
    assert r.status_code == 400 and r.json()["detail"] == "No folder chosen."
    d = tmp / "watch"
    build_pdf(BY_NAME["signals_basic"], d)
    build_pptx(DECK, d)
    (d / "skip.txt").write_text("not a paper")
    folder.set_folder(st, str(d))
    j = c.post(f"{B}/ingest", json={"folder": True, "subject": "signals"}).json()
    assert j["state"] == "live" and j["reason"] == "Reading 2 files." and j["job"]["total"] == 2
    info = wait(c)
    assert sorted(f["file"] for f in info["files"]) == ["deck.pptx", "signals_basic.pdf"]
    assert {f["method"] for f in info["files"]} == {"text-layer", "slides"}
    assert folder.scan(st)["pending_files"] == []
    j = c.post(f"{B}/ingest", json={"folder": True}).json()
    assert (j["state"], j["reason"], j["job"]) == ("live", "Nothing new in the folder.", None)


def test_r13_is_fault_when_a_page_has_no_text_layer(env):
    c, st, tmp = env
    j = ingest_one(c, build_pdf(BY_NAME["scanned_page"], tmp / "in"))
    r = c.get(f"{B}/ingest/{j['job']['id']}").json()
    assert r["state"] == "fault" and r["reason"] == "p. 2: no text layer; OCR arrives in EW8"
    assert r["job"]["files"][0]["status"] == "added" and r["job"]["files"][0]["questions"] == 3


def test_r12_and_r15_answer_409_while_a_job_runs(env, monkeypatch):
    c, st, tmp = env
    gate = threading.Event()
    real = ingest.ingest_file

    def slow(path, **kw):
        gate.wait(10)
        return real(path, **kw)

    monkeypatch.setattr(ingest, "ingest_file", slow)
    pdf = build_pdf(BY_NAME["signals_basic"], tmp / "in")
    assert c.post(f"{B}/ingest", json={"path": str(pdf)}).status_code == 200
    r = c.post(f"{B}/ingest", json={"path": str(pdf)})
    assert r.status_code == 409 and r.json()["detail"]
    r = c.post(f"{B}/upload?name=x.pdf", content=pdf.read_bytes())
    assert r.status_code == 409
    assert not (st.paths.inbox / "x.pdf").exists()
    j = c.get(f"{B}/ingest/last").json()
    assert j["state"] == "live" and j["job"]["status"] == "running"
    gate.set()
    wait(c)


# ------------------------------------------------------------------ R-14
def test_r14_moves_a_crop_and_re_renders_it_from_the_page_picture(env):
    from PIL import Image
    c, st, tmp = env
    ingest_one(c, build_pdf(BY_NAME["signals_basic"], tmp / "in"))
    q = st.list_questions()[0]
    before = st.crop_path(q["id"]).read_bytes()
    r = c.put(f"{B}/crops/{q['id']}", json={"bbox": [50, 80, 550, 140]})
    assert r.status_code == 200
    j = r.json()
    assert j["state"] == "live" and j["question"]["crop"]["bbox"] == [50, 80, 550, 140] and j["question"]["crop"]["page"] == 1
    png = st.crop_path(q["id"])
    assert png.read_bytes() != before
    with Image.open(png) as im:
        assert abs(im.width - 500 * 150 / 72) <= 2 and abs(im.height - 60 * 150 / 72) <= 2
    for bbox in ([0, 0, 5, 50], [10, 10, 100, 15], [-20, 0, 100, 100], [0, 0, 700, 100], [0, 0, 100, 900],
                 [100, 100, 50, 200], [1, 2, 3], "box", [0, 0, "x", 9], [0, 0, True, 50]):
        r = c.put(f"{B}/crops/{q['id']}", json={"bbox": bbox})
        assert r.status_code == 400 and r.json()["detail"], bbox
    assert c.put(f"{B}/crops/{q['id']}", json={}).status_code == 400
    assert c.put(f"{B}/crops/q-nosuchone01", json={"bbox": [50, 80, 550, 140]}).status_code == 404
    assert st.get_question(q["id"])["crop"]["bbox"] == [50, 80, 550, 140]


def test_r14_a_slide_from_a_deck_has_no_page_picture(env):
    c, st, tmp = env
    ingest_one(c, build_pptx(DECK, tmp / "in"))
    q = st.list_questions()[0]
    r = c.put(f"{B}/crops/{q['id']}", json={"bbox": [0, 0, 100, 100]})
    assert r.status_code == 404 and r.json()["detail"]


# ------------------------------------------------------------------ R-15
def test_r15_upload_writes_only_under_the_inbox_and_reads_the_file(env):
    c, st, tmp = env
    before = {p for p in tmp.rglob("*")}
    data = build_pdf(BY_NAME["or_pairs"], tmp / "src").read_bytes()
    before |= {p for p in tmp.rglob("*")}
    r = c.post(f"{B}/upload?name=Digital%20(1).pdf&subject=digital&year=2024", content=data,
               headers={"content-type": "application/octet-stream"})
    assert r.status_code == 200, r.text
    j = r.json()
    assert j["state"] == "live" and j["job"]["total"] == 1
    info = wait(c)
    assert info["files"][0]["status"] == "added" and info["files"][0]["questions"] == 6
    assert (st.paths.inbox / "Digital (1).pdf").read_bytes() == data
    p = st.get_paper(info["files"][0]["paper_id"])
    assert (p["subject"], p["year"], p["filename"]) == ("digital", 2024, "Digital (1).pdf")
    new = {x for x in tmp.rglob("*") if x not in before and x.is_file()}
    assert new and all(st.root in x.parents for x in new)
    assert not list(st.paths.inbox.glob(".*"))                         # no temporary file left behind
    r = c.post(f"{B}/upload?name=deck.pptx", content=build_pptx(DECK, tmp / "src").read_bytes())
    assert r.status_code == 200 and wait(c)["files"][0]["method"] == "slides"


def test_r15_refuses_a_bad_name_type_or_body(env):
    c, st, tmp = env
    data = build_pdf(BY_NAME["signals_basic"], tmp / "src").read_bytes()
    for name in ("../x.pdf", "a/b.pdf", "a\\b.pdf", ".hidden.pdf", "x.txt", "x.pdf.exe", "x", "", "C:x.pdf",
                 "a" * 121 + ".pdf", "x .PDF;", "con\x00.pdf"):
        r = c.post(f"{B}/upload", params={"name": name}, content=data)
        assert r.status_code == 400 and r.json()["detail"], name
    assert c.post(f"{B}/upload", content=data).status_code == 400
    r = c.post(f"{B}/upload?name=fake.pdf", content=b"hello, not a pdf")
    assert r.status_code == 400 and r.json()["detail"]
    r = c.post(f"{B}/upload?name=fake.pptx", content=data)
    assert r.status_code == 400
    assert c.post(f"{B}/upload?name=empty.pdf", content=b"").status_code == 400
    for bad in ({"subject": "Bad Slug"}, {"year": "soon"}):
        assert c.post(f"{B}/upload", params={"name": "ok.pdf", **bad}, content=data).status_code == 400
    assert list(st.paths.inbox.iterdir()) == [] and st.list_papers() == []


def test_r15_a_body_over_the_cap_is_413_by_header_and_by_count(env, monkeypatch):
    c, st, tmp = env
    assert R.MAX_UPLOAD == 40 * 1024 * 1024
    monkeypatch.setattr(R, "MAX_UPLOAD", 1024)
    data = build_pdf(BY_NAME["signals_basic"], tmp / "src").read_bytes()
    assert len(data) > 2 * 1024
    r = c.post(f"{B}/upload?name=big.pdf", content=data)                        # refused by Content-Length
    assert r.status_code == 413 and r.json()["detail"]

    def chunks():                                                                 # no Content-Length: counted while read
        for i in range(0, len(data), 1000):
            yield data[i:i + 1000]

    r = c.post(f"{B}/upload?name=big.pdf", content=chunks())
    assert r.status_code == 413
    assert list(st.paths.inbox.iterdir()) == [] and st.list_papers() == []


# ------------------------------------------------------------------ review fixes
@pytest.mark.parametrize("bad", ["NaN", "Infinity", "-Infinity"])
def test_r14_refuses_a_box_with_a_number_that_is_not_finite(env, bad):
    # json.loads accepts NaN and Infinity; every comparison against NaN is False, so the range checks
    # alone let it through and a NaN would be written into the questions file
    c, st, tmp = env
    ingest_one(c, build_pdf(BY_NAME["signals_basic"], tmp / "in"))
    q = st.list_questions()[0]
    before = q["crop"]
    body = '{"bbox": [60, 90, %s, 130]}' % bad
    r = c.put(f"{B}/crops/{q['id']}", content=body, headers={"content-type": "application/json"})
    assert r.status_code == 400, r.text
    assert st.get_question(q["id"])["crop"] == before


@pytest.mark.parametrize("name", ["NUL.pdf", "con.pdf", "COM1.pptx", "lpt3.pdf", "Aux.PDF", "prn.pdf"])
def test_r15_refuses_a_windows_device_name(env, name):
    # inbox/NUL.pdf on Windows is the NUL device: the bytes would vanish instead of being kept
    c, st, tmp = env
    pdf = build_pdf(BY_NAME["signals_basic"], tmp / "in")
    r = c.post(f"{B}/upload", params={"name": name}, content=pdf.read_bytes())
    assert r.status_code == 400, r.text


# ------------------------------------------------------------------ security review: hostile input
def _failed_job(c):
    j = wait(c)
    assert j["status"] == "failed" and j["files"][0]["status"] == "failed", j
    return j["files"][0]["note"]


def test_upload_name_with_a_trailing_newline_is_refused(env):
    # "$" in a regex also matches before a final newline, so "a.pdf\n" passed the name rule
    c, st, tmp = env
    body = build_pdf(BY_NAME["signals_basic"], tmp / "in").read_bytes()
    for name in ("a.pdf%0A", "a.pdf%0D%0A", "a.pdf%20", "a%0Ab.pdf", "x.pdf.", "..%5Cx.pdf", "C%3Ax.pdf", "a%3Ab.pdf"):
        r = c.post(f"{B}/upload?name={name}", content=body)
        assert r.status_code == 400, (name, r.status_code)
    assert list(st.paths.inbox.iterdir()) == []


@pytest.mark.parametrize("raw", [r"\\10.255.255.1\share\a.pdf", "//10.255.255.1/share/a.pdf",
                                 r"\\?\C:\a.pdf", r"\\.\pipe\a.pdf", r"\\?\UNC\host\share\a.pdf"])
def test_r12_refuses_a_network_or_device_path_before_touching_it(env, monkeypatch, raw):
    # a UNC path would make Windows open an SMB connection (and send the user's credentials) just to test exists()
    c, st, tmp = env
    touched = []
    real = R.Path.exists
    monkeypatch.setattr(R.Path, "exists", lambda self: touched.append(str(self)) or real(self))
    r = c.post(f"{B}/ingest", json={"path": raw})
    assert r.status_code == 400, r.text
    assert touched == []
    assert "10.255" not in r.text


def test_r12_other_bad_bodies_are_400_not_500(env):
    c, _, _ = env
    for body in ({"path": 5}, {"path": ["a"]}, {"path": {"a": 1}}, {"path": "x.pdf"}, {"path": r"C:\nope\a.pdf"},
                 {"path": r"C:\Windows"}, {"folder": "yes"}, {}):
        assert c.post(f"{B}/ingest", json=body).status_code == 400, body
    base = {"path": r"C:\nope\a.pdf"}
    for extra in ({"subject": {"a": 1}}, {"subject": ["x"]}, {"year": [1]}, {"exam_kind": ["cie"]},
                  {"exam_kind": {"a": 1}}, {"source_note": 5}):
        r = c.post(f"{B}/ingest", json={**base, **extra})
        assert r.status_code == 400, (extra, r.status_code)


def test_r14_hostile_question_ids_are_404_or_400_and_write_nothing(env):
    c, st, tmp = env
    ingest_one(c, build_pdf(BY_NAME["signals_basic"], tmp / "in"))
    before = sorted(p for p in st.root.rglob("*") if p.is_file())
    for qid in ("..", "..%5C..%5Cx", "%2E%2E", "C%3A%5Cx", "q-1%00", "q-aaaaaaaaaaaa%5C..%5Cz", "CON", "x" * 400):
        r = c.put(f"{B}/crops/{qid}", json={"bbox": [60, 90, 400, 130]})
        assert r.status_code in (400, 404, 422), (qid, r.status_code)
    assert sorted(p for p in st.root.rglob("*") if p.is_file()) == before


def test_r14_boolean_and_string_numbers_are_refused(env):
    c, st, tmp = env
    ingest_one(c, build_pdf(BY_NAME["signals_basic"], tmp / "in"))
    qid = st.list_questions()[0]["id"]
    for bb in ([True, 0, 100, 100], ["0", "0", "100", "100"], [0, 0, 100], [0, 0, 100, 100, 5], "0,0,100,100", None, [[0], 0, 9, 9]):
        assert c.put(f"{B}/crops/{qid}", json={"bbox": bb}).status_code == 400, bb


def test_a_pdf_with_too_many_pages_fails_that_file_only(env):
    import fitz
    c, st, tmp = env
    d = fitz.open()
    for _ in range(ingest.MAX_PAGES + 1):
        d.new_page(width=200, height=200)
    big = tmp / "in" / "many.pdf"
    big.parent.mkdir(exist_ok=True)
    d.save(str(big))
    d.close()
    good = build_pdf(BY_NAME["signals_basic"], tmp / "in")
    r = c.post(f"{B}/ingest", json={"path": str(big)})
    assert r.status_code == 200
    j = wait(c)
    assert j["files"][0]["status"] == "failed" and "pages" in j["files"][0]["note"]
    assert st.list_papers() == [] and list(st.paths.pages.iterdir()) == []
    # and the next job is still fine
    assert ingest_one(c, good)["state"] in schema.STATES
    assert len(st.list_papers()) == 1


def test_a_pdf_with_a_huge_page_fails_before_it_is_drawn(env, monkeypatch):
    import fitz
    c, st, tmp = env
    d = fitz.open()
    d.new_page(width=14000, height=14000)          # 14000 pt at 150 dpi is 29167 px a side: 2.5 GB of RGB
    p = tmp / "in" / "huge.pdf"
    p.parent.mkdir(exist_ok=True)
    d.save(str(p))
    d.close()
    drawn = []
    real = ingest.crops.render_page_image
    monkeypatch.setattr(ingest.crops, "render_page_image", lambda *a, **k: drawn.append(1) or real(*a, **k))
    c.post(f"{B}/ingest", json={"path": str(p)})
    note = _failed_job(c)
    assert "Page 1" in note and drawn == []
    assert st.list_papers() == [] and list(st.paths.pages.glob("*/*")) == []


def test_a_deck_that_expands_enormously_is_refused_before_it_is_read(env):
    import zipfile
    c, st, tmp = env
    p = tmp / "in" / "bomb.pptx"
    p.parent.mkdir(exist_ok=True)
    chunk = b"\0" * (1 << 20)
    with zipfile.ZipFile(p, "w", zipfile.ZIP_DEFLATED) as z:
        with z.open("ppt/slides/slide1.xml", "w", force_zip64=True) as f:
            for _ in range(ingest.MAX_UNZIPPED // (1 << 20) + 8):
                f.write(chunk)
    assert p.stat().st_size < 5 * 1024 * 1024
    c.post(f"{B}/ingest", json={"path": str(p)})
    note = _failed_job(c)
    assert "expands" in note or "large" in note
    assert st.list_papers() == []


def test_a_pdf_named_pptx_and_a_pptx_named_pdf_fail_with_a_reason(env):
    c, st, tmp = env
    (tmp / "in").mkdir()
    a = tmp / "in" / "fake.pptx"
    a.write_bytes(b"%PDF-1.4 not really")
    b = tmp / "in" / "fake.pdf"
    b.write_bytes(b"PK\x03\x04 not really")
    for p in (a, b):
        r = c.post(f"{B}/ingest", json={"path": str(p)})
        assert r.status_code == 200
        note = _failed_job(c)
        assert str(tmp) not in note and "Traceback" not in note
    assert st.list_papers() == []


def test_job_answers_never_carry_an_absolute_path_or_traceback(env):
    c, st, tmp = env
    (tmp / "in").mkdir()
    bad = tmp / "in" / "broken.pdf"
    bad.write_bytes(b"%PDF-1.7\n1 0 obj<<>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF")
    good = build_pdf(BY_NAME["signals_basic"], tmp / "in")
    r = c.post(f"{B}/ingest", json={"path": str(bad)})
    assert r.status_code == 200
    j = c.app.state.pyq_ingest.wait(60)
    text = c.get(f"{B}/ingest/last").text
    assert str(tmp) not in text and str(tmp).replace("\\", "\\\\") not in text and "Traceback" not in text
    assert j["files"][0]["status"] == "failed"
    ingest_one(c, good)
    assert len(st.list_papers()) == 1
