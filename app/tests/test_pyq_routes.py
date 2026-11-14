"""Routes R-01 to R-11 (routes_ww_pyq.py) through the real app with only the ww_pyq feature mounted.
Each test gets its own Store root under tmp_path; every paper is invented."""
import hashlib
import re
from pathlib import Path

import pytest
from starlette.testclient import TestClient

from jarvis_app import routes_ww_pyq
from jarvis_app.security import Guard
from jarvis_app.server import create_app
from jarvis_app.ww_pyq import schema
from jarvis_app.ww_pyq import store as store_mod
from jarvis_app.ww_pyq.store import Store

TOKEN = "t" * 32
B = "/api/mission/pyq"


@pytest.fixture()
def env(tmp_path, monkeypatch):
    st = Store(tmp_path / "pyq")
    monkeypatch.setattr(store_mod, "default_store", lambda: st)
    app = create_app(Guard(8777, TOKEN, extra_hosts=["testserver"]), autostart_aankhen="off", features=["ww_pyq"])
    with TestClient(app) as c:
        c.headers.update({"X-Jarvis-Token": TOKEN})
        yield c, st, tmp_path


def typed(c, title="Signals mid", subject="signals", n=2, **kw):
    qs = [{"text": f"Define signal {i}.", "marks": 5, "section": "A"} for i in range(n)]
    r = c.post(f"{B}/papers", json={"title": title, "subject": subject, "year": 2025, "questions": qs, **kw})
    assert r.status_code == 200, r.text
    return r.json()


def envelope(j):
    assert j["state"] in schema.STATES and isinstance(j["reason"], str) and j["reason"] and j["source"]


# ------------------------------------------------------------------ 5. every route answers and is documented
def test_every_route_answers_carries_the_envelope_and_is_in_the_docstring(env):
    c, st, tmp = env
    j = typed(c)
    pid, qid = j["paper"]["id"], j["question_ids"][0]
    png = st.paths.crops / pid / f"{qid}.png"
    png.parent.mkdir(parents=True)
    png.write_bytes(b"\x89PNG\r\n")
    st.set_crop(qid, {"page": 1, "bbox": [0, 0, 9, 9], "png": f"crops/{pid}/{qid}.png"})
    (tmp / "watch").mkdir()
    calls = [("GET", "/papers"), ("POST", "/papers"), ("GET", f"/papers/{pid}"), ("PATCH", f"/papers/{pid}"),
             ("GET", "/questions"), ("PATCH", "/questions"), ("GET", f"/crops/{qid}"), ("GET", "/coverage?subject=signals"),
             ("GET", "/folder"), ("PUT", "/folder"), ("DELETE", f"/papers/{pid}")]
    bodies = {("POST", "/papers"): {"title": "Second"}, ("PATCH", f"/papers/{pid}"): {"title": "Renamed"},
              ("PATCH", "/questions"): {"ids": [qid], "set": {"status": "accepted"}}, ("PUT", "/folder"): {"path": str(tmp / "watch")}}
    for method, path in calls:
        r = c.request(method, B + path, json=bodies.get((method, path)))
        assert r.status_code == 200, (method, path, r.status_code, r.text)
        if path.startswith("/crops/"):
            assert r.headers["content-type"] == "image/png" and r.content.startswith(b"\x89PNG")
        else:
            envelope(r.json())
    doc = routes_ww_pyq.__doc__
    for rid in [f"R-{n:02d}" for n in range(1, 12)]:
        assert rid in doc
    rows = re.findall(r"^\s{2,}(GET|POST|PUT|PATCH|DELETE)\s+(/api/\S+)", doc, re.M)
    assert len(rows) == 11
    defined = {(m, r.path) for r in c.app.routes for m in getattr(r, "methods", ()) if r.path.startswith(B)} - {("HEAD", p) for _, p in []}
    documented = {(m, p.split("?")[0]) for m, p in rows}
    assert documented <= defined and {x for x in defined if x[0] != "HEAD"} == documented
    assert c.get("/api/mission/pyq/papers", headers={"X-Jarvis-Token": "wrong"}).status_code in (401, 403)


# ------------------------------------------------------------------ R-01, R-02, R-03
def test_r01_empty_is_waiting_then_lists_with_counts(env):
    c, st, _ = env
    j = c.get(f"{B}/papers").json()
    assert (j["state"], j["reason"], j["items"], j["count"]) == ("waiting", "No papers on file yet.", [], 0)
    p = typed(c, n=3)
    typed(c, title="Circuits", subject="circuits", n=1)
    qid = p["question_ids"][0]
    c.patch(f"{B}/questions", json={"ids": [qid], "set": {"status": "accepted"}})
    c.patch(f"{B}/questions", json={"ids": [p["question_ids"][1]], "set": {"status": "rejected"}})
    j = c.get(f"{B}/papers?subject=signals").json()
    assert j["state"] == "live" and j["count"] == 1
    assert j["items"][0]["counts"] == {"questions": 3, "pending": 1, "accepted": 1, "rejected": 1, "marks_missing": 0}
    assert c.get(f"{B}/papers").json()["count"] == 2
    assert c.get(f"{B}/papers?subject=Bad Slug").status_code == 400


def test_r02_a_typed_paper_and_its_refusals(env):
    c, st, _ = env
    j = typed(c)
    assert j["state"] == "live" and len(j["question_ids"]) == 2
    assert j["paper"]["kind"] == "hand" and j["paper"]["method"] == "typed" and j["paper"]["source_note"] == "manual drop-in"
    q = st.get_question(j["question_ids"][0])
    assert (q["status"], q["marks_source"], q["text_status"]) == ("pending", "hand", "verified")
    j2 = c.post(f"{B}/papers", json={"title": "No marks", "questions": [{"text": "Why?"}]}).json()
    assert st.get_question(j2["question_ids"][0])["marks_source"] == "missing"
    n = len(st.list_papers())
    for body in ({"title": "  "}, {}, {"title": "x" * 201}, {"title": "t", "subject": "Bad Slug"}, {"title": "t", "exam_kind": "party"},
                 {"title": "t", "year": "soon"}, {"title": "t", "questions": [{"text": "x" * 2001, "marks": 1}]},
                 {"title": "t", "questions": [{"text": ""}]}, {"title": "t", "questions": [{"text": "a", "marks": -2}]},
                 {"title": "t", "questions": [{"text": "a", "type": "essay"}]}, {"title": "t", "questions": "no"}):
        r = c.post(f"{B}/papers", json=body)
        assert r.status_code == 400 and r.json()["detail"], body
    assert len(st.list_papers()) == n                                     # a refused paper leaves nothing behind


def test_r03_a_paper_with_pages_and_faults(env):
    c, st, _ = env
    pid = st.add_paper({"sha256": hashlib.sha256(b"x").hexdigest(), "title": "Scan", "kind": "pdf", "subject": "signals", "pages": 3})
    (st.paths.pages / pid).mkdir(parents=True)
    (st.paths.pages / pid / "p002.png").write_bytes(b"\x89PNG")
    j = c.get(f"{B}/papers/{pid}").json()
    assert j["state"] == "live" and j["pages"] == [{"n": 1, "png": False}, {"n": 2, "png": True}, {"n": 3, "png": False}]
    assert j["counts"]["questions"] == 0
    st.update_paper(pid, {"faults": ["p. 3: no text layer and no OCR engine", "p. 4: unreadable"]})
    j = c.get(f"{B}/papers/{pid}").json()
    assert j["state"] == "fault" and j["reason"] == "p. 3: no text layer and no OCR engine; p. 4: unreadable"
    assert c.get(f"{B}/papers/p-nosuchpaper1").status_code == 404
    assert c.get(f"{B}/papers/not..valid").status_code == 404


# ------------------------------------------------------------------ R-04, R-05
def test_r04_edit_a_paper_and_refuse_a_foreign_field(env):
    c, st, _ = env
    pid = typed(c)["paper"]["id"]
    j = c.patch(f"{B}/papers/{pid}", json={"title": "Better", "year": 2024, "subject": "circuits", "exam_kind": "cie", "source_note": "mine"}).json()
    assert j["state"] == "live" and j["paper"]["title"] == "Better" and j["paper"]["subject"] == "circuits"
    for body in ({"sha256": "x"}, {"pages": 9}, {}, {"subject": "Bad Slug"}, {"title": ""}, {"exam_kind": "x"}):
        assert c.patch(f"{B}/papers/{pid}", json=body).status_code == 400, body
    assert c.patch(f"{B}/papers/p-nosuchpaper1", json={"title": "x"}).status_code == 404
    assert st.get_paper(pid)["title"] == "Better"


def test_r05_delete_removes_questions_and_crops_and_counts_them(env):
    c, st, _ = env
    j = typed(c, n=3)
    pid, ids = j["paper"]["id"], j["question_ids"]
    for qid in ids[:2]:
        f = st.paths.crops / pid / f"{qid}.png"
        f.parent.mkdir(parents=True, exist_ok=True)
        f.write_bytes(b"\x89PNG")
        st.set_crop(qid, {"page": 1, "png": f"crops/{pid}/{qid}.png"})
    r = c.delete(f"{B}/papers/{pid}").json()
    assert r["state"] == "live" and r["removed"] == {"questions": 3, "crops": 2}
    assert not (st.paths.crops / pid).exists() and st.list_questions() == []
    assert c.delete(f"{B}/papers/{pid}").status_code == 404


# ------------------------------------------------------------------ R-06, R-07
def test_r06_questions_filters_paging_and_has_crop(env):
    c, st, _ = env
    a = typed(c, n=3)
    b = typed(c, title="Circuits", subject="circuits", n=2)
    qa = a["question_ids"]
    f = st.paths.crops / a["paper"]["id"] / f"{qa[0]}.png"
    f.parent.mkdir(parents=True)
    f.write_bytes(b"\x89PNG")
    st.set_crop(qa[0], {"page": 1, "png": f"crops/{a['paper']['id']}/{qa[0]}.png"})
    c.patch(f"{B}/questions", json={"ids": [qa[1]], "set": {"status": "accepted"}})
    j = c.get(f"{B}/questions").json()
    assert (j["state"], j["total"], j["count"]) == ("live", 5, 5)
    assert {q["id"]: q["has_crop"] for q in j["items"]}[qa[0]] is True and sum(q["has_crop"] for q in j["items"]) == 1
    assert c.get(f"{B}/questions?paper={a['paper']['id']}").json()["total"] == 3
    assert c.get(f"{B}/questions?subject=circuits").json()["total"] == 2
    assert [q["id"] for q in c.get(f"{B}/questions?status=accepted").json()["items"]] == [qa[1]]
    p = c.get(f"{B}/questions?limit=2&offset=4").json()
    assert (p["count"], p["total"]) == (1, 5)
    assert c.get(f"{B}/questions?limit=2").json()["count"] == 2
    e = c.get(f"{B}/questions?status=accepted&subject=circuits").json()
    assert (e["state"], e["items"], e["total"]) == ("waiting", [], 0)
    assert c.get(f"{B}/questions?status=bogus").status_code == 400
    assert c.get(f"{B}/questions?paper=../x").status_code == 404


def test_r07_accept_edit_and_the_all_or_nothing_rules(env):
    c, st, _ = env
    j = typed(c, n=2)
    ids = j["question_ids"]
    r = c.patch(f"{B}/questions", json={"ids": ids, "set": {"status": "accepted", "unit": 2, "topic": "convolution"}}).json()
    assert r["state"] == "live" and r["count"] == 2 and all(q["status"] == "accepted" and q["tag_source"] == "hand" for q in r["items"])
    r = c.patch(f"{B}/questions", json={"ids": [ids[0]], "set": {"text": "New words.", "marks": 9, "difficulty": "hard", "type": "short", "section": "B"}}).json()
    q = r["items"][0]
    assert q["edited"] is True and q["marks_source"] == "hand" and q["marks"] == 9 and q["status_by"] == "hand"
    # marks first
    nm = c.post(f"{B}/papers", json={"title": "No marks", "questions": [{"text": "Q"}, {"text": "R", "marks": 4}]}).json()["question_ids"]
    before = [st.get_question(i) for i in nm]
    r = c.patch(f"{B}/questions", json={"ids": nm, "set": {"status": "accepted"}})
    assert r.status_code == 400 and r.json()["detail"] == "Give its marks first."
    assert [st.get_question(i) for i in nm] == before
    ok = c.patch(f"{B}/questions", json={"ids": [nm[0]], "set": {"status": "accepted", "marks": 3}})
    assert ok.status_code == 200
    # one unknown id changes nothing
    before = [st.get_question(i) for i in ids]
    r = c.patch(f"{B}/questions", json={"ids": [ids[0], "q-nosuchone01"], "set": {"status": "rejected"}})
    assert r.status_code == 404 and [st.get_question(i) for i in ids] == before
    for body in ({"ids": [], "set": {"status": "pending"}}, {"ids": ids}, {"ids": ids, "set": {}}, {"set": {"text": "x"}},
                 {"ids": ids, "set": {"status": "maybe"}}, {"ids": ids, "set": {"type": "essay"}},
                 {"ids": ids, "set": {"text": "x" * 2001}}, {"ids": ids, "set": {"paper_id": "p-x"}},
                 {"ids": ids, "set": {"id": "q-new"}}, {"ids": ids, "set": {"marks": "five"}},
                 {"ids": ids, "set": {"difficulty": "brutal"}}, {"ids": ["x"] * 201, "set": {"status": "pending"}}):
        assert c.patch(f"{B}/questions", json=body).status_code in (400, 404), body
    assert [st.get_question(i) for i in ids] == before


# ------------------------------------------------------------------ R-08
def test_r08_crop_is_a_png_or_404(env):
    c, st, _ = env
    j = typed(c, n=1)
    pid, qid = j["paper"]["id"], j["question_ids"][0]
    r = c.get(f"{B}/crops/{qid}")
    assert r.status_code == 404 and r.json()["detail"] == "No crop for this question."
    f = st.paths.crops / pid / f"{qid}.png"
    f.parent.mkdir(parents=True)
    f.write_bytes(b"\x89PNG\r\n\x1a\nbytes")
    st.set_crop(qid, {"page": 1, "png": f"crops/{pid}/{qid}.png"})
    r = c.get(f"{B}/crops/{qid}")
    assert r.status_code == 200 and r.headers["content-type"] == "image/png" and r.content == f.read_bytes()
    f.unlink()
    assert c.get(f"{B}/crops/{qid}").status_code == 404
    assert c.get(f"{B}/crops/q-nosuchone01").status_code == 404
    assert c.get(f"{B}/crops/..%2Fpapers").status_code == 404


# ------------------------------------------------------------------ R-09
def test_r09_coverage_waits_with_the_exact_missing_counts(env):
    c, st, _ = env
    r = c.get(f"{B}/coverage?subject=signals").json()
    assert r["state"] == "waiting" and r["reason"] == "3 more papers, 20 more reviewed questions."
    assert r["coverage"]["papers"] == 0 and r["coverage"]["floor_met"] is False
    for i in range(2):
        j = typed(c, title=f"P{i}", n=6 if i else 5)
        c.patch(f"{B}/questions", json={"ids": j["question_ids"], "set": {"status": "accepted"}})
    r = c.get(f"{B}/coverage?subject=signals").json()
    assert r["state"] == "waiting" and r["reason"] == "1 more paper, 9 more reviewed questions."
    j = typed(c, title="P3", n=9)
    c.patch(f"{B}/questions", json={"ids": j["question_ids"], "set": {"status": "accepted"}})
    r = c.get(f"{B}/coverage?subject=signals").json()
    assert r["state"] == "live" and r["coverage"]["floor_met"] is True and r["coverage"]["accepted"] == 20
    assert c.get(f"{B}/coverage").status_code == 400 and c.get(f"{B}/coverage?subject=Bad Slug").status_code == 400


# ------------------------------------------------------------------ R-10, R-11
def test_r10_r11_folder_states_and_refusals(env):
    c, st, tmp = env
    j = c.get(f"{B}/folder").json()
    assert (j["state"], j["reason"], j["folder"]["path"]) == ("waiting", "No folder chosen.", None)
    d = tmp / "watch"
    d.mkdir()
    (d / "a.pdf").write_bytes(b"%PDF a")
    (d / "b.pdf").write_bytes(b"%PDF b")
    j = c.put(f"{B}/folder", json={"path": str(d)}).json()
    assert (j["state"], j["reason"]) == ("waiting", "2 files not read yet.") and j["folder"]["pending_files"] == ["a.pdf", "b.pdf"]
    st.add_paper({"sha256": hashlib.sha256(b"%PDF a").hexdigest(), "title": "a"})
    j = c.get(f"{B}/folder").json()                                       # reading the route is what scans
    assert (j["state"], j["reason"]) == ("waiting", "1 file not read yet.") and j["folder"]["pending_files"] == ["b.pdf"]
    st.add_paper({"sha256": hashlib.sha256(b"%PDF b").hexdigest(), "title": "b"})
    j = c.get(f"{B}/folder").json()
    assert (j["state"], j["reason"]) == ("live", "Nothing new in the folder.") and j["folder"]["files_seen"] == 2
    for f in d.iterdir():
        f.unlink()
    d.rmdir()
    j = c.get(f"{B}/folder").json()
    assert (j["state"], j["reason"], j["folder"]["exists"]) == ("fault", "The folder is not there.", False)
    for bad in ("relative/dir", ".", str(tmp / "nope"), str(tmp / "papers.txt"), tmp.anchor, "", 7):
        r = c.put(f"{B}/folder", json={"path": bad})
        assert r.status_code == 400 and r.json()["detail"], bad
    assert c.put(f"{B}/folder", json={}).status_code == 400
    j = c.put(f"{B}/folder", json={"path": None}).json()
    assert (j["state"], j["folder"]["path"]) == ("waiting", None)
