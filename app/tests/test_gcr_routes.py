"""The Google link's routes (routes_ww_gcr.py, G-01 to G-19) through the real app with only that feature and the paper desk mounted.

Google is the fake of test_gcr_core.py (httpx.MockTransport); the credential store is a dict; the client file is invented; the
paper desk writes into a Store under tmp_path; the program opener is a recorder. No test touches the network or his data.
"""
from __future__ import annotations

import json
import re
import threading

import httpx
import pytest
from starlette.testclient import TestClient

from jarvis_app import routes_ww_gcr as R
from jarvis_app import ww_check
from jarvis_app.security import Guard
from jarvis_app.server import create_app
from jarvis_app.ww_gcr import auth, sync
from jarvis_app.ww_gcr.api import GoogleApi
from jarvis_app.ww_pyq import api as pyq_api
from jarvis_app.ww_pyq import schema
from jarvis_app.ww_pyq import store as store_mod
from jarvis_app.ww_pyq.store import Store
from test_gcr_core import SUBJECTS, FakeGoogle, FakeKeyring

TOKEN = "t" * 32
B = "/api/mission/gcr"
SECRETS = ("REFRESH-SECRET", "ACCESS-SECRET", "CLIENT-SECRET", "CLIENT-ID")


class Env:
    def __init__(self, c, g, store, pyq, tmp, opened, kr, client):
        self.c, self.g, self.store, self.pyq, self.tmp, self.opened, self.kr, self.client = c, g, store, pyq, tmp, opened, kr, client

    def connect_fake_account(self):
        self.client.write_text(json.dumps({"installed": {"client_id": "CLIENT-ID", "client_secret": "CLIENT-SECRET"}}), encoding="utf-8")
        auth._store("REFRESH-SECRET", [auth.PREFIX + s for s in auth.SCOPES])

    def wait(self, timeout=60):
        gc = self.c.app.state.gcr
        t = gc.sync_thread
        if t is not None:
            t.join(timeout)
        for w in list(gc.watchers):
            w.join(timeout)
        self.c.app.state.pyq_ingest.wait(timeout)

    def sync(self, **body):
        r = self.c.post(f"{B}/sync", json=body)
        assert r.status_code == 200, r.text
        self.wait()
        j = self.c.get(f"{B}/sync").json()
        assert j["job"]["status"] == "done", j
        return j["job"]


@pytest.fixture()
def env(tmp_path, monkeypatch):
    kr = FakeKeyring()
    monkeypatch.setattr(auth, "_keyring", lambda: kr)
    monkeypatch.setattr(auth, "_access", {"token": "", "until": 0.0})
    client = tmp_path / "client_secret.json"
    monkeypatch.setenv("JARVIS_GOOGLE_CLIENT", str(client))
    monkeypatch.delenv("JARVIS_GOOGLE", raising=False)
    g = FakeGoogle()
    gstore = sync.GcrStore(tmp_path / "gcr")
    pyq = Store(tmp_path / "pyq")
    opened: list = []
    monkeypatch.setattr(R, "_store", lambda: gstore)
    monkeypatch.setattr(R, "_api", lambda: GoogleApi(token=lambda: "tok", transport=httpx.MockTransport(g.handler)))
    monkeypatch.setattr(R, "_subjects", lambda svc: SUBJECTS)
    monkeypatch.setattr(R, "opener", lambda p: opened.append(p))
    monkeypatch.setattr(store_mod, "default_store", lambda: pyq)
    app = create_app(Guard(8777, TOKEN, extra_hosts=["testserver"]), autostart_aankhen="off", features=["ww_gcr", "ww_pyq_ingest"])
    with TestClient(app) as c:
        c.headers.update({"X-Jarvis-Token": TOKEN})
        yield Env(c, g, gstore, pyq, tmp_path, opened, kr, client)


def envelope(j):
    assert j["state"] in schema.STATES and isinstance(j["reason"], str) and j["reason"] and j["source"]


# ------------------------------------------------------------------ the table is real
def test_every_documented_route_is_defined_and_the_gates_pass(env):
    c = env.c
    doc = R.__doc__
    for n in range(1, 20):
        assert f"G-{n:02d}" in doc
    rows = re.findall(r"^\s{2,}(GET|POST|PUT|PATCH|DELETE)\s+(/api/\S+)", doc, re.M)
    documented = {(m, p.split("?")[0]) for m, p in rows}
    defined = {(m, r.path) for r in c.app.routes for m in getattr(r, "methods", ()) if r.path.startswith(B) and m != "HEAD"}
    assert len(rows) == 19 and documented == defined
    d = ww_check.route_drift()
    assert d["doc_without_route"] == [] and d["ui_without_route"] == []
    assert ww_check.routes_documented() >= documented            # the gate reads this file's table


def test_the_sandbox_switches_the_link_off_and_does_not_copy_originals():
    from jarvis_app import ww_sandbox
    assert "gcr" in ww_sandbox.SKIP
    src = open(ww_sandbox.__file__, encoding="utf-8").read()
    assert 'os.environ["JARVIS_GOOGLE"] = "off"' in src


# ------------------------------------------------------------------ G-01
def test_status_in_each_sign_in_state_never_carries_a_secret(env):
    c = env.c
    j = c.get(f"{B}/status").json()
    envelope(j)
    assert j["state"] == "planned" and j["connecting"] is False and j["job"] is None
    assert [s["name"] for s in j["scopes"]] == list(auth.SCOPES) and not any(s["granted"] for s in j["scopes"])
    assert all(s["label"] for s in j["scopes"]) and j["counts"] == {"courses": 0, "files": 0, "notes": 0, "papers": 0, "faults": 0}
    env.client.write_text(json.dumps({"installed": {"client_id": "CLIENT-ID", "client_secret": "CLIENT-SECRET"}}), encoding="utf-8")
    assert c.get(f"{B}/status").json()["state"] == "waiting"
    auth._store("REFRESH-SECRET", [auth.PREFIX + s for s in auth.SCOPES])
    j = c.get(f"{B}/status").json()
    assert j["state"] == "live" and all(s["granted"] for s in j["scopes"])
    auth._store("REFRESH-SECRET", [auth.PREFIX + "classroom.courses.readonly"])
    j = c.get(f"{B}/status").json()
    assert j["state"] == "fault" and any(s["granted"] for s in j["scopes"]) and not all(s["granted"] for s in j["scopes"])
    for body in (c.get(f"{B}/status").text, c.post(f"{B}/disconnect").text):
        assert not any(s in body for s in SECRETS)
    assert c.get(f"{B}/status").json()["state"] == "waiting" and env.kr.box == {}


# ------------------------------------------------------------------ G-02, G-03
def test_connect_starts_once_and_a_second_press_is_409(env, monkeypatch):
    c = env.c
    gate, started = threading.Event(), threading.Event()

    def slow_connect(timeout=300, **kw):
        assert timeout == 300
        started.set()
        gate.wait(20)
        env.connect_fake_account()
        return auth.status()
    monkeypatch.setattr(auth, "connect", slow_connect)
    r = c.post(f"{B}/connect")
    assert r.status_code == 200
    j = r.json()
    envelope(j)
    assert (j["state"], j["reason"], j["connecting"]) == ("waiting", "Approve in the browser window that opened.", True)
    assert started.wait(5)
    assert c.post(f"{B}/connect").status_code == 409
    s = c.get(f"{B}/status").json()
    assert s["connecting"] is True and s["state"] == "waiting"
    gate.set()
    c.app.state.gcr.connect_thread.join(10)
    s = c.get(f"{B}/status").json()
    assert s["connecting"] is False and s["state"] == "live"


def test_a_failed_connect_shows_its_sentence_until_the_next_connect(env, monkeypatch):
    c = env.c
    env.client.write_text(json.dumps({"installed": {"client_id": "i", "client_secret": "s"}}), encoding="utf-8")

    def refuse(timeout=300, **kw):
        raise auth.NotConnected("Google returned no refresh token. Connect again and approve the whole screen.")
    monkeypatch.setattr(auth, "connect", refuse)
    assert c.post(f"{B}/connect").status_code == 200
    c.app.state.gcr.connect_thread.join(10)
    s = c.get(f"{B}/status").json()
    assert s["state"] == "fault" and s["reason"].startswith("Google returned no refresh token") and s["connecting"] is False

    def crash(timeout=300, **kw):
        raise TimeoutError("the browser never answered")
    monkeypatch.setattr(auth, "connect", crash)
    c.post(f"{B}/connect")
    c.app.state.gcr.connect_thread.join(10)
    s = c.get(f"{B}/status").json()
    assert s["state"] == "fault" and "did not finish" in s["reason"] and "never answered" not in s["reason"]
    monkeypatch.setattr(auth, "connect", lambda timeout=300, **kw: auth.status())
    c.post(f"{B}/connect")
    c.app.state.gcr.connect_thread.join(10)
    assert c.get(f"{B}/status").json()["state"] == "waiting"      # the old error is gone


# ------------------------------------------------------------------ G-04, G-05
def test_sync_refuses_when_not_connected_and_says_why(env):
    c = env.c
    r = c.post(f"{B}/sync", json={})
    assert r.status_code == 400 and "client file" in r.json()["detail"]
    env.client.write_text(json.dumps({"installed": {"client_id": "i", "client_secret": "s"}}), encoding="utf-8")
    r = c.post(f"{B}/sync", json={})
    assert r.status_code == 400 and "Not connected" in r.json()["detail"]
    j = c.get(f"{B}/sync").json()
    envelope(j)
    assert j["job"] == {"status": "idle", "started": "", "finished": "", "text": "", "counts": {}, "fault_lines": []}
    env.connect_fake_account()
    assert c.post(f"{B}/sync", json={"courses": "1001"}).status_code == 400


def test_a_sign_in_that_dies_at_the_start_ends_the_job_failed_with_the_sentence(env, monkeypatch):
    env.connect_fake_account()

    def dead(request):
        return httpx.Response(401, json={})
    monkeypatch.setattr(R, "_api", lambda: GoogleApi(token=lambda: "tok", transport=httpx.MockTransport(dead)))
    assert env.c.post(f"{B}/sync", json={}).status_code == 200
    env.wait()
    j = env.c.get(f"{B}/sync").json()
    assert j["state"] == "fault" and j["job"]["status"] == "failed" and "Connect again" in j["job"]["text"] and j["job"]["fault_lines"]


def test_a_second_sync_while_one_runs_is_409(env, monkeypatch):
    env.connect_fake_account()
    gate, started = threading.Event(), threading.Event()

    def slow(request):
        started.set()
        gate.wait(20)
        return env.g.handler(request)
    monkeypatch.setattr(R, "_api", lambda: GoogleApi(token=lambda: "tok", transport=httpx.MockTransport(slow)))
    r = env.c.post(f"{B}/sync", json={})
    assert r.status_code == 200 and r.json()["job"]["status"] == "running"
    assert started.wait(5)
    assert env.c.post(f"{B}/sync", json={}).status_code == 409
    j = env.c.get(f"{B}/status").json()
    assert j["job"]["status"] == "running"
    # a hand edit during a run is no longer refused: every writer goes through one locked update (test_gcr_integrity.py)
    assert env.c.patch(f"{B}/courses/1001", json={"include": True}).status_code in (200, 404)
    gate.set()
    env.wait()
    assert env.c.get(f"{B}/sync").json()["job"]["status"] == "done"


# ------------------------------------------------------------------ a whole sync through the routes
@pytest.fixture()
def synced(env):
    env.connect_fake_account()
    env.job = env.sync()
    return env


def test_a_full_sync_then_courses_files_filters_note_and_original(synced):
    c = synced.c
    job = synced.job
    assert job["counts"]["fetched"] == 5 and job["counts"]["papers_sent"] == 1 and job["counts"]["notes"] >= 3
    assert any("locked.pdf" in x for x in job["fault_lines"]) and job["finished"] >= job["started"]
    st = c.get(f"{B}/status").json()
    envelope(st)
    assert st["synced_at"] and st["counts"]["courses"] == 2 and st["counts"]["files"] == 6 and st["counts"]["papers"] == 1
    assert st["counts"]["notes"] >= 3 and st["counts"]["faults"] >= 2 and st["job"]["status"] == "done"
    assert not any(s in json.dumps(st) for s in SECRETS)

    cs = c.get(f"{B}/courses").json()
    envelope(cs)
    by = {x["id"]: x for x in cs["items"]}
    assert cs["count"] == 2 and set(by["1001"]) == {"id", "name", "section", "state", "subject", "subject_source", "include", "files", "notes",
                                                    "papers", "read_at", "link"}
    assert (by["1001"]["subject"], by["1001"]["subject_source"], by["1001"]["include"]) == ("signals-systems", "rule", True)
    assert by["1001"]["files"] == 6 and by["1001"]["papers"] == 1 and by["1002"]["files"] == 0

    fs = c.get(f"{B}/files").json()
    envelope(fs)
    assert fs["state"] == "live" and fs["count"] == 6
    mods = [x["modified"] for x in fs["items"]]
    assert mods == sorted(mods, reverse=True)
    f = {x["id"]: x for x in fs["items"]}
    n = f["fileNotes0001"]
    assert set(n) == {"id", "course", "course_name", "subject", "title", "ext", "kind", "kind_source", "state", "reason", "note_state",
                      "note_reason", "pages", "words", "scanned_pages", "size", "modified", "post", "has_note", "has_original", "paper_id",
                      "stale", "also_in"}                       # the last two added on 22 Nov; nothing of the first contract is gone
    assert (n["ext"], n["kind"], n["has_note"], n["has_original"], n["scanned_pages"]) == ("pdf", "notes", True, True, 1)
    assert set(n["post"]) == {"kind", "title", "topic"} and n["course_name"] == "Signals and Systems"
    assert f["filePpt000003"]["has_note"] is False and f["filePpt000003"]["note_state"] == "waiting"
    assert f["fileLocked005"]["has_original"] is False and f["fileLocked005"]["state"] == "fault"
    assert f["filePaper0004"]["kind"] == "paper" and f["filePaper0004"]["paper_id"].startswith("p")

    assert {x["id"] for x in c.get(f"{B}/files?kind=paper").json()["items"]} == {"filePaper0004"}
    assert c.get(f"{B}/files?kind=bogus").status_code == 400
    assert c.get(f"{B}/files?course=1002").json()["count"] == 0
    assert c.get(f"{B}/files?course=1001").json()["count"] == 6
    assert {x["id"] for x in c.get(f"{B}/files?q=LAPLACE").json()["items"]} == {"fileNotes0001"}        # title, any case
    assert {x["id"] for x in c.get(f"{B}/files?q=cie 2").json()["items"]} == {"filePaper0004"}           # the post's topic
    assert {x["id"] for x in c.get(f"{B}/files?q=sheet two").json()["items"]} == {"filePaper0004"}       # the post's title

    nt = c.get(f"{B}/files/fileNotes0001/note").json()
    envelope(nt)
    assert nt["state"] == "live" and "Laplace transform of a unit step" in nt["markdown"] and nt["scanned_pages"] == 1 and nt["pages"] == 2
    wt = c.get(f"{B}/files/filePpt000003/note").json()
    assert wt["state"] == "waiting" and wt["markdown"] == "" and "old PowerPoint" in wt["reason"]

    r = c.get(f"{B}/files/fileNotes0001/original")
    assert r.status_code == 200 and r.content.startswith(b"%PDF") and r.headers["content-type"] == "application/pdf"
    assert r.headers["x-content-type-options"] == "nosniff"
    assert r.headers["content-disposition"] == 'inline; filename="Unit 2 Laplace transform notes.pdf"'
    assert c.get(f"{B}/files/fileLocked005/original").status_code == 404                              # never fetched


def test_an_empty_store_says_whether_to_connect_or_to_sync(env):
    c = env.c
    j = c.get(f"{B}/files").json()
    envelope(j)
    assert j["state"] == "waiting" and j["items"] == [] and "Connect" in j["reason"]
    env.connect_fake_account()
    j = c.get(f"{B}/files").json()
    assert j["state"] == "waiting" and "Press Sync" in j["reason"]
    assert c.get(f"{B}/courses").json()["state"] == "waiting"


HOSTILE = ["..%2Fx", "a%2Fb", "..%5C..%5Cx", "unknownFile999", "%00", "fileNotes0001%2F..%2Fx"]


@pytest.mark.parametrize("fid", HOSTILE + [""])
def test_unknown_and_hostile_ids_are_404_and_write_nothing(synced, fid):
    c = synced.c
    before = (synced.store.root / "manifest.json").read_bytes()
    papers_before = len(synced.pyq.list_papers())
    urls = [("patch", f"{B}/files/{fid}", {"json": {"kind": "other"}}), ("get", f"{B}/files/{fid}/note", {}),
            ("get", f"{B}/files/{fid}/original", {}), ("post", f"{B}/files/{fid}/open", {}), ("post", f"{B}/files/{fid}/to-papers", {})]
    for method, url, kw in urls:
        r = getattr(c, method)(url, **kw)
        # Refused either way, and the lines below prove nothing was changed. Which refusal depends on the checkout: an id
        # with an encoded slash (or no id at all) is no longer one path segment, so it matches no route of this file. With
        # no built UI that is a 404; in a checkout that has app/ui/dist the static handler is asked next and answers 405
        # for a PATCH or POST (seen on main, 22 Nov 2026: 4 of these cases gave 405 there and 404 in a worktree).
        shaped = fid == "" or "%2F" in fid
        assert r.status_code == 404 or (shaped and method != "get" and r.status_code == 405), (method, url, r.status_code)
    assert (synced.store.root / "manifest.json").read_bytes() == before
    assert synced.opened == [] and len(synced.pyq.list_papers()) == papers_before


# ------------------------------------------------------------------ G-07
def test_patch_course_sets_the_subject_by_hand_and_checks_it_against_the_plan(synced):
    c = synced.c
    assert c.patch(f"{B}/courses/9999", json={"include": False}).status_code == 404
    for bad in ({}, {"subject": "no-such-subject"}, {"subject": 5}, {"include": "yes"}):
        assert c.patch(f"{B}/courses/1001", json=bad).status_code == 400, bad
    r = c.patch(f"{B}/courses/1001", json={"subject": "modern-control"})
    assert r.status_code == 200
    j = r.json()
    envelope(j)
    assert (j["course"]["subject"], j["course"]["subject_source"]) == ("modern-control", "hand")
    assert {x["subject"] for x in c.get(f"{B}/files?course=1001").json()["items"]} == {"modern-control"}
    synced.sync()                                                                              # a second sync keeps his choice
    assert c.get(f"{B}/courses").json()["items"][1]["subject"] == "modern-control" or \
        {x["id"]: x for x in c.get(f"{B}/courses").json()["items"]}["1001"]["subject_source"] == "hand"
    r = c.patch(f"{B}/courses/1001", json={"subject": "", "include": False})
    assert r.status_code == 200 and r.json()["course"]["subject_source"] == "none" and r.json()["course"]["include"] is False
    assert {x["subject"] for x in c.get(f"{B}/files?course=1001").json()["items"]} == {""}
    synced.g.calls.clear()
    synced.sync()                                                                              # switched off: not read again
    assert not any("/courses/1001/" in x for x in synced.g.calls)


# ------------------------------------------------------------------ G-09
def test_patch_file_kind_survives_a_second_sync(synced):
    c = synced.c
    assert c.patch(f"{B}/files/fileNotes0001", json={"kind": "weird"}).status_code == 400
    assert c.patch(f"{B}/files/fileNotes0001", json={}).status_code == 400
    r = c.patch(f"{B}/files/fileNotes0001", json={"kind": "paper"})
    assert r.status_code == 200
    envelope(r.json())
    assert (r.json()["file"]["kind"], r.json()["file"]["kind_source"]) == ("paper", "hand")
    synced.g.files["filePaper0004"]["modifiedTime"] = "2026-11-09T10:00:00Z"
    job = synced.sync()
    f = {x["id"]: x for x in c.get(f"{B}/files").json()["items"]}
    assert (f["fileNotes0001"]["kind"], f["fileNotes0001"]["kind_source"]) == ("paper", "hand")
    assert job["counts"]["papers_sent"] == 1                                                   # his hand-made paper went to the desk
    assert f["fileNotes0001"]["paper_id"]


# ------------------------------------------------------------------ G-12
def test_open_uses_the_injected_opener_and_refuses_a_program(synced):
    c = synced.c
    r = c.post(f"{B}/files/fileNotes0001/open")
    assert r.status_code == 200
    envelope(r.json())
    assert (r.json()["state"], r.json()["reason"]) == ("live", "Opened in its own program.")
    assert [p.name for p in synced.opened] == ["fileNotes0001.pdf"]
    # a manifest line that names an executable: refused, and the opener is not called
    m = synced.store.manifest()
    exe = synced.store.root / "originals" / "evil.exe"
    exe.parent.mkdir(parents=True, exist_ok=True)
    exe.write_bytes(b"MZ")
    m["files"]["fileNotes0001"].update(path="originals/evil.exe", ext="exe")
    synced.store.save(m)
    r = c.post(f"{B}/files/fileNotes0001/open")
    assert r.status_code == 400 and "never run" in r.json()["detail"]
    assert len(synced.opened) == 1
    for ext in ("pdf", "pptx", "ppt", "docx", "doc", "xlsx", "txt", "md", "jpg", "png", "webp"):
        assert ext in R.OPENABLE
    assert not ({"exe", "bat", "cmd", "lnk", "js", "ps1", "html", "svg", "msi", "py"} & R.OPENABLE)


# ------------------------------------------------------------------ G-13
def test_to_papers_makes_a_pending_paper_and_never_an_accepted_question(env):
    env.connect_fake_account()
    # a PDF the rule calls notes: he sends it by hand
    assert env.sync()["counts"]["papers_sent"] == 1
    c = env.c
    assert c.get(f"{B}/files").json()["items"]
    before = {p["id"] for p in env.pyq.list_papers()}
    r = c.post(f"{B}/files/fileInFold007/to-papers")
    assert r.status_code == 200, r.text
    j = r.json()
    envelope(j)
    assert j["state"] == "live" and j["job"]["status"] in ("running", "done")
    env.wait()
    f = {x["id"]: x for x in c.get(f"{B}/files").json()["items"]}["fileInFold007"]
    assert f["paper_id"] and f["paper_id"] not in before
    paper = env.pyq.get_paper(f["paper_id"])
    assert paper["subject"] == "signals-systems" and paper["title"] == "Unit 3 Fourier series"
    qs = env.pyq.list_questions()
    assert not [q for q in qs if q["status"] == "accepted"]
    assert all(q["status"] == "pending" for q in qs if q["paper_id"] == f["paper_id"])
    # the same file again is the desk's duplicate: it answers with the paper it already has
    assert c.post(f"{B}/files/fileInFold007/to-papers").status_code == 200
    env.wait()
    assert {x["id"]: x for x in c.get(f"{B}/files").json()["items"]}["fileInFold007"]["paper_id"] == f["paper_id"]


def test_to_papers_refuses_a_non_pdf_and_a_missing_original_and_a_busy_desk(synced, monkeypatch):
    c = synced.c
    r = c.post(f"{B}/files/filePpt000003/to-papers")
    assert r.status_code == 400 and "PDF" in r.json()["detail"]
    r = c.post(f"{B}/files/fileLocked005/to-papers")
    assert r.status_code == 400 and "not fetched" in r.json()["detail"]

    def busy(*a, **k):
        raise pyq_api.Busy("Already reading files; wait for that to finish.")
    monkeypatch.setattr(c.app.state.pyq_ingest, "start", busy)
    assert c.post(f"{B}/files/fileInFold007/to-papers").status_code == 409
    assert c.app.state.gcr.pending == 0                                                        # a refused hand-off leaves no mark
    assert not {x["id"]: x for x in c.get(f"{B}/files").json()["items"]}["fileInFold007"]["paper_id"]


def test_one_paper_failing_does_not_stop_the_rest_and_is_listed(env, monkeypatch):
    env.connect_fake_account()
    # two papers by the rule: one good, one a file the desk cannot open
    env.g.files["filePaper0009"] = {"name": "CIE 1 question paper.pdf", "mimeType": "application/pdf", "modifiedTime": "2026-11-07T10:00:00Z",
                                    "body": b"%PDF-1.4 this is not a pdf"}
    orig = env.g.handler

    def with_extra(request):
        url = str(request.url).split("?")[0]
        if url.endswith("/courseWorkMaterials") and "/1001/" in url:
            r = orig(request)
            body = json.loads(r.content)
            body["courseWorkMaterial"].append({"id": "m9", "title": "CIE 1", "updateTime": "2026-11-07T00:00:00Z", "materials": [env.g.drive("filePaper0009")]})
            return httpx.Response(200, json=body)
        return orig(request)
    monkeypatch.setattr(R, "_api", lambda: GoogleApi(token=lambda: "tok", transport=httpx.MockTransport(with_extra)))
    job = env.sync()
    assert job["counts"]["papers_sent"] == 1
    assert any(x.startswith("CIE 1 question paper") for x in job["fault_lines"])
    f = {x["id"]: x for x in env.c.get(f"{B}/files").json()["items"]}
    assert f["filePaper0004"]["paper_id"] and not f["filePaper0009"]["paper_id"]


# ------------------------------------------------------------------ the instance switch
def test_the_switch_off_answers_planned_everywhere_and_refuses_connect_and_sync(env, monkeypatch):
    c = env.c
    monkeypatch.setenv("JARVIS_GOOGLE", "off")
    for method, path, kw in [("get", "/status", {}), ("post", "/disconnect", {}), ("get", "/sync", {}), ("get", "/courses", {}),
                             ("patch", "/courses/1001", {"json": {"include": False}}), ("get", "/files", {}),
                             ("patch", "/files/fileNotes0001", {"json": {"kind": "paper"}}), ("get", "/files/fileNotes0001/note", {}),
                             ("get", "/files/fileNotes0001/original", {}), ("post", "/files/fileNotes0001/open", {}),
                             ("post", "/files/fileNotes0001/to-papers", {})]:
        r = getattr(c, method)(B + path, **kw)
        assert r.status_code == 200, (method, path, r.status_code, r.text)
        j = r.json()
        envelope(j)
        assert (j["state"], j["reason"]) == ("planned", "The Google link is switched off in this instance."), path
    for path in ("/connect", "/sync"):
        r = c.post(B + path, json={})
        assert r.status_code == 400 and r.json()["detail"] == "The Google link is switched off in this instance."
    assert env.opened == [] and c.app.state.gcr.connect_thread is None and c.app.state.gcr.sync_thread is None
    monkeypatch.setenv("JARVIS_GOOGLE", "on")
    assert c.get(f"{B}/status").json()["state"] == "planned"        # no client file in this test: the real state shows again


def test_every_route_answers_with_the_envelope_or_a_sentence(synced):
    c = synced.c
    for method, path, kw in [("get", "/status", {}), ("get", "/sync", {}), ("get", "/courses", {}), ("get", "/files", {}),
                             ("get", "/files/fileNotes0001/note", {}), ("patch", "/courses/1001", {"json": {"include": True}}),
                             ("patch", "/files/fileNotes0001", {"json": {"kind": "notes"}}), ("post", "/files/fileNotes0001/open", {}),
                             ("post", "/disconnect", {})]:
        r = getattr(c, method)(B + path, **kw)
        assert r.status_code == 200, (method, path, r.status_code)
        envelope(r.json())
