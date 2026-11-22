"""The Google link after the review of 22 Nov 2026: the manifest keeps every writer's lines, one bad file, course or account
does not end a run, the counts are true, and what comes from Google is treated as untrusted.

Each test names the fault it pins (A1 to E24, the numbers of the review). The fake Google is test_gcr_core's, with hooks; no
test touches the network, the real credential store or his data.
"""
from __future__ import annotations

import json
import os
import sys
import threading

import httpx
import pytest

from jarvis_app import routes_ww_gcr as R
from jarvis_app.ww_gcr import api as api_mod
from jarvis_app.ww_gcr import auth, sync
from jarvis_app.ww_gcr.api import GoogleApi
from test_gcr_core import CR, DR, SUBJECTS, FakeGoogle, FakeKeyring, pdf_bytes
from test_gcr_routes import B, env, envelope  # noqa: F401  (env is a fixture)


class Fake(FakeGoogle):
    """FakeGoogle with seams: `hook(url, params)` may answer first; `more` adds material posts to a course."""

    def __init__(self):
        super().__init__()
        self.hook = None
        self.more: dict[str, list] = {}
        self.params: list[tuple[str, dict]] = []

    def handler(self, request: httpx.Request) -> httpx.Response:
        url = str(request.url).split("?")[0]
        q = dict(request.url.params)
        self.params.append((url, q))
        if self.hook is not None:
            r = self.hook(url, q)
            if r is not None:
                self.calls.append(url.replace(CR, "CR").replace(DR, "DR") + ("?alt=media" if q.get("alt") else ""))
                return r
        if url.endswith("/courseWorkMaterials"):
            cid = url.split("/courses/")[1].split("/")[0]
            if cid in self.more:
                r = super().handler(request)
                body = json.loads(r.content or b"{}")
                body.setdefault("courseWorkMaterial", []).extend(self.more[cid])
                return httpx.Response(200, json=body)
        return super().handler(request)


@pytest.fixture()
def fake(tmp_path):
    g = Fake()
    a = GoogleApi(token=lambda: "tok", transport=httpx.MockTransport(g.handler))
    yield g, a, sync.GcrStore(tmp_path / "gcr")
    a.close()


def media_calls(g):
    return [c for c in g.calls if c.endswith("?alt=media") or c.endswith("/export")]


# ------------------------------------------------------------------ A: the manifest
def test_A1_two_stores_of_one_folder_share_one_lock(tmp_path):
    a, b = sync.GcrStore(tmp_path / "gcr"), sync.GcrStore(tmp_path / "gcr" / ".." / "gcr")
    assert a._lock is b._lock and sync.GcrStore(tmp_path / "other")._lock is not a._lock
    assert a.update(lambda m: m["courses"].setdefault("c1", {"name": "x"})) == {"name": "x"}
    assert b.manifest()["courses"]["c1"] == {"name": "x"}


def test_A2_hand_edits_and_a_paper_id_made_during_a_sync_survive_it(fake):
    g, a, store = fake
    sync.sync(a, store, subjects=SUBJECTS)
    g.files["filePaper0004"]["modifiedTime"] = "2026-11-10T10:00:00Z"
    other = sync.GcrStore(store.root)                       # a route builds its own store object, as before

    def edit(url, q):
        if url.endswith("filePaper0004") and q.get("alt") == "media":
            def put(m):
                m["courses"]["1001"].update(subject="modern-control", subject_source="hand")
                m["files"]["fileNotes0001"].update(kind="other", kind_source="hand")
                m["files"]["fileInFold007"]["paper_id"] = "p-handed"
            other.update(put)
        return None
    g.hook = edit
    sync.sync(a, store, subjects=SUBJECTS)
    m = store.manifest()
    assert (m["courses"]["1001"]["subject"], m["courses"]["1001"]["subject_source"]) == ("modern-control", "hand")
    assert (m["files"]["fileNotes0001"]["kind"], m["files"]["fileNotes0001"]["kind_source"]) == ("other", "hand")
    assert m["files"]["fileInFold007"]["paper_id"] == "p-handed"
    assert m["files"]["filePaper0004"]["subject"] == "modern-control"      # the file fetched after his edit takes his subject


def test_A3_a_damaged_manifest_is_set_aside_never_replaced_by_a_blank(tmp_path):
    store = sync.GcrStore(tmp_path / "gcr")
    store.root.mkdir(parents=True)
    (store.root / "manifest.json").write_text('{"courses": {"1001": {"name": "kept by hand"}}, "files": ', encoding="utf-8")
    with pytest.raises(sync.ManifestError) as e:
        store.manifest()
    assert "set aside" in str(e.value) and "nothing was overwritten" in str(e.value)
    bad = list(store.root.glob("manifest.json.bad-*"))
    assert len(bad) == 1 and "kept by hand" in bad[0].read_text(encoding="utf-8")
    with pytest.raises(sync.ManifestError):                 # still a fault for the screen until something is saved again
        store.manifest()
    with pytest.raises(sync.ManifestError):                 # a hand edit is not written onto a blank
        store.update(lambda m: m["courses"].setdefault("2001", {}))
    store.update(lambda m: m["courses"].setdefault("2002", {}), fresh_ok=True)   # the sync may rebuild from blank
    assert store.manifest()["courses"] == {"2002": {}}
    (store.root / "manifest.json").write_text("[1, 2]", encoding="utf-8")   # valid JSON that is not a manifest
    with pytest.raises(sync.ManifestError):
        store.manifest()


def test_A3_routes_answer_fault_with_the_sentence_for_a_damaged_manifest(env):
    env.connect_fake_account()
    env.store.root.mkdir(parents=True, exist_ok=True)
    (env.store.root / "manifest.json").write_text("{not json", encoding="utf-8")
    c = env.c
    for path in ("/status", "/files", "/courses", "/files/fileNotes0001/note"):
        r = c.get(B + path)
        assert r.status_code == 200, (path, r.text)
        j = r.json()
        envelope(j)
        assert j["state"] == "fault" and "set aside" in j["reason"], path
    assert c.patch(f"{B}/files/fileNotes0001", json={"kind": "paper"}).json()["state"] == "fault"
    env.sync()                                              # a sync rebuilds it
    j = c.get(f"{B}/status").json()
    assert j["state"] == "live" and j["counts"]["files"] == 6


def test_A4_many_writers_never_collide_on_one_temporary_name(tmp_path):
    store = sync.GcrStore(tmp_path / "gcr")
    errors = []

    def writer(n):
        try:
            for i in range(25):
                sync.GcrStore(store.root).save({"courses": {}, "files": {}, "w": n, "i": i})
        except Exception as e:                              # noqa: BLE001  the test collects what the old fixed name raised
            errors.append(repr(e))
    ts = [threading.Thread(target=writer, args=(n,)) for n in range(8)]
    for t in ts:
        t.start()
    for t in ts:
        t.join(30)
    assert errors == []
    assert isinstance(json.loads((store.root / "manifest.json").read_text(encoding="utf-8")), dict)
    assert not list(store.root.glob("*.tmp"))


def test_A4_a_reader_holding_the_manifest_open_only_delays_the_save(tmp_path, monkeypatch):
    store = sync.GcrStore(tmp_path / "gcr")
    real, refused = os.replace, []

    def busy_three_times(src, dst):
        if str(dst).endswith("manifest.json") and len(refused) < 3:
            refused.append(dst)
            raise PermissionError(13, "in use")
        return real(src, dst)
    monkeypatch.setattr(os, "replace", busy_three_times)
    store.save({"courses": {"1": {}}, "files": {}})
    assert len(refused) == 3 and store.manifest()["courses"] == {"1": {}}


def test_A4_a_download_that_cannot_take_its_name_is_a_fault_of_that_file_only(fake, monkeypatch):
    g, a, store = fake
    real = os.replace

    def viewer_holds_it(src, dst):
        if str(dst).endswith("fileNotes0001.pdf"):
            raise PermissionError(13, "open in a viewer")
        return real(src, dst)
    monkeypatch.setattr(os, "replace", viewer_holds_it)
    out = sync.sync(a, store, subjects=SUBJECTS)
    f = store.manifest()["files"]
    assert out["fetched"] == 4 and f["fileNotes0001"]["state"] == "fault"
    assert "open in another program" in f["fileNotes0001"]["reason"] and f["filePpt000003"]["state"] == "live"


# ------------------------------------------------------------------ B: a run that keeps going, counts that are true
def test_B5_a_dropped_connection_on_one_file_and_a_broken_course_end_nothing_else(fake):
    g, a, store = fake

    def flaky(url, q):
        if url.endswith("fileNotes0001") and q.get("alt") == "media":
            raise httpx.ConnectError("reset by peer")
        if url == f"{CR}/courses/1002/courseWorkMaterials":
            return httpx.Response(200, json={"courseWorkMaterial": [{"id": "x", "title": "bad", "materials": [None]}]})
        return None
    g.hook = flaky
    out = sync.sync(a, store, subjects=SUBJECTS)
    f = store.manifest()["files"]
    assert f["fileNotes0001"]["state"] == "fault" and f["fileNotes0001"]["reason"] == "The connection dropped while fetching it."
    assert out["fetched"] == 4 and any(x.startswith("Seminar: the course stopped part way") for x in out["fault_lines"])


def test_B6_B7_a_sign_in_that_dies_part_way_keeps_what_was_fetched_and_counts_only_that(fake):
    g, a, store = fake
    events = []
    g.hook = lambda url, q: httpx.Response(401, json={}) if url.endswith("fileDoc000002/export") else None
    out = sync.sync(a, store, subjects=SUBJECTS, on_event=events.append)
    assert "Connect again" in out["error"] and out["fetched"] == 2
    f = store.manifest()["files"]
    assert f["fileInFold007"]["state"] == "live" and f["filePaper0004"]["state"] == "live"   # saved as they were fetched
    assert [e["kind"] for e in events].count("fetched") == 2 and store.manifest()["synced_at"] == ""


def test_B7_one_file_attached_twice_is_counted_once(fake):
    g, a, store = fake
    g.more["1001"] = [{"id": "m8", "title": "Again", "updateTime": "2026-10-01T00:00:00Z", "materials": [g.drive("fileNotes0001")]}]
    out = sync.sync(a, store, subjects=SUBJECTS)
    assert out["files"] == 6 and media_calls(g).count("DR/files/fileNotes0001?alt=media") == 1


def test_B7_route_counts_of_a_failed_run_are_the_real_ones(env, monkeypatch):
    env.connect_fake_account()
    g = Fake()
    g.hook = lambda url, q: httpx.Response(401, json={}) if url.endswith("fileDoc000002/export") else None
    monkeypatch.setattr(R, "_api", lambda *a: GoogleApi(token=lambda: "tok", transport=httpx.MockTransport(g.handler)))
    assert env.c.post(f"{B}/sync", json={}).status_code == 200
    env.wait()
    j = env.c.get(f"{B}/sync").json()["job"]
    assert j["status"] == "failed" and j["counts"]["fetched"] == 2        # four fetches were STARTED, two ended


def test_B5_one_account_failing_does_not_fail_the_run(env, monkeypatch):
    env.connect_fake_account()
    monkeypatch.setattr(auth, "_access_more", {})
    auth._store("REFRESH-SECRET", [auth.PREFIX + s for s in auth.SCOPES], "college")
    g = Fake()

    def make(account="main"):
        h = g.handler if account == "main" else (lambda r: httpx.Response(401, json={}))
        return GoogleApi(token=lambda: "tok", transport=httpx.MockTransport(h))
    monkeypatch.setattr(R, "_api", make)
    job = env.sync()
    assert job["counts"]["fetched"] == 5 and any(x.startswith("college: ") and "Connect again" in x for x in job["fault_lines"])


def test_B8_a_stop_leaves_every_loop_and_does_not_claim_a_sync(fake):
    g, a, store = fake
    sync.sync(a, store, subjects=SUBJECTS)
    before = store.manifest()["synced_at"]
    for f in g.files.values():
        f["modifiedTime"] = "2026-11-20T10:00:00Z"
    stop, at = threading.Event(), []

    def halt(url, q):
        if q.get("alt") == "media" and not stop.is_set():
            stop.set()
            at.append(len(g.calls))
        return None
    g.hook = halt
    out = sync.sync(a, store, subjects=SUBJECTS, stop=stop)
    assert out["stopped"] is True and store.manifest()["synced_at"] == before
    assert g.calls[at[0] + 1:] == []                        # nothing asked of Google after the stop


def test_B8_a_stopped_job_says_stopped(env, monkeypatch):
    env.connect_fake_account()
    g, gate, started = Fake(), threading.Event(), threading.Event()

    def slow(url, q):
        if q.get("alt") == "media":
            started.set()
            gate.wait(20)
        return None
    g.hook = slow
    monkeypatch.setattr(R, "_api", lambda *a: GoogleApi(token=lambda: "tok", transport=httpx.MockTransport(g.handler)))
    env.c.post(f"{B}/sync", json={})
    assert started.wait(10)
    env.c.app.state.gcr.stop.set()
    gate.set()
    env.wait()
    j = env.c.get(f"{B}/sync").json()
    envelope(j)
    assert (j["job"]["status"], j["job"]["text"]) == ("stopped", "Stopped before it finished.")
    assert env.c.get(f"{B}/status").json()["synced_at"] == ""


def test_B9_a_401_forgets_the_token_and_tries_once_more():
    tok = {"v": "old"}
    forgot = []

    def handler(request):
        if request.headers["authorization"] != "Bearer new":
            return httpx.Response(401, json={})
        if "alt" in str(request.url):
            return httpx.Response(200, content=b"%PDF-bytes")
        return httpx.Response(200, json={"ok": True})

    def rejected():
        forgot.append(1)
        tok["v"] = "new"
    a = GoogleApi(token=lambda: tok["v"], transport=httpx.MockTransport(handler), on_unauthorized=rejected)
    assert a.get(f"{CR}/courses") == {"ok": True} and forgot == [1]
    tok["v"] = "old"
    import tempfile
    with tempfile.TemporaryDirectory() as d:
        assert a.download("fileNotes0001", os.path.join(d, "x.pdf")) == len(b"%PDF-bytes") and forgot == [1, 1]
    dead = GoogleApi(token=lambda: "old", transport=httpx.MockTransport(handler))
    with pytest.raises(auth.NotConnected):
        dead.get(f"{CR}/courses")


def test_B9_forget_token_clears_the_cache(monkeypatch):
    monkeypatch.setattr(auth, "_access", {"token": "CACHED", "until": 9e12})
    auth.forget_token()
    assert auth._access == {"token": "", "until": 0.0}


@pytest.fixture()
def signin(tmp_path, monkeypatch):
    kr = FakeKeyring()
    monkeypatch.setattr(auth, "_keyring", lambda: kr)
    monkeypatch.setattr(auth, "_access", {"token": "", "until": 0.0})
    monkeypatch.setattr(auth, "_access_more", {})
    monkeypatch.setattr(auth, "_failed", {})
    client = tmp_path / "client_secret.json"
    client.write_text(json.dumps({"installed": {"client_id": "i", "client_secret": "s"}}), encoding="utf-8")
    monkeypatch.setenv("JARVIS_GOOGLE_CLIENT", str(client))
    auth._store("R1", [auth.PREFIX + s for s in auth.SCOPES])
    return kr


def test_B10_a_revoked_sign_in_shows_fault_until_a_refresh_succeeds(signin):
    assert auth.status()["state"] == "live"
    with pytest.raises(auth.NotConnected):
        auth.access_token(post=lambda url, data: httpx.Response(400, json={"error": "invalid_grant"}))
    st = auth.status()
    assert st["state"] == "fault" and st["reason"] == auth.REVOKED and "7 days" in st["reason"]
    auth.access_token(post=lambda url, data: httpx.Response(200, json={"access_token": "A", "expires_in": 3600}))
    assert auth.status()["state"] == "live"


def test_B11_the_files_route_knows_a_second_account_is_connected(env):
    env.client.write_text(json.dumps({"installed": {"client_id": "i", "client_secret": "s"}}), encoding="utf-8")
    auth._store("R2", [auth.PREFIX + s for s in auth.SCOPES], "college")     # only the second account signed in
    assert "Press Sync" in env.c.get(f"{B}/files").json()["reason"]


# ------------------------------------------------------------------ C: what comes from Google is untrusted
@pytest.mark.parametrize("name, ext", [("Notes v1.5 final", "bin"), ("setup.exe", "bin"), ("Link.lnk", "bin"),
                                       ("Scan.JPEG", "jpeg"), ("Unit 1.pdf", "pdf"), ("no extension", "bin")])
def test_C12_a_name_gives_an_extension_only_from_the_known_list(name, ext):
    assert sync._name_ext(name) == ext


def test_C12_C13_a_file_named_like_a_program_is_saved_as_bin_and_every_download_is_marked(fake):
    g, a, store = fake
    g.files["fileProg00011"] = {"name": "lecture.exe", "mimeType": "application/octet-stream", "modifiedTime": "2026-11-07T00:00:00Z",
                                "body": b"MZ"}
    g.more["1001"] = [{"id": "m11", "title": "Tools", "updateTime": "2026-10-01T00:00:00Z", "materials": [g.drive("fileProg00011")]}]
    sync.sync(a, store, subjects=SUBJECTS)
    rec = store.manifest()["files"]["fileProg00011"]
    assert rec["ext"] == "bin" and rec["path"].endswith("fileProg00011.bin")
    if sys.platform == "win32":
        p = store.original("fileNotes0001")
        with open(str(p) + ":Zone.Identifier", encoding="ascii", newline="") as f:
            assert f.read() == "[ZoneTransfer]\r\nZoneId=3\r\n"


@pytest.mark.skipif(sys.platform != "win32", reason="alternate data streams are an NTFS feature")
def test_C13_the_zone_mark_reads_back(tmp_path):
    p = tmp_path / "a.pdf"
    p.write_bytes(b"%PDF")
    assert api_mod.mark_from_internet(p) is True
    with open(str(p) + ":Zone.Identifier", encoding="ascii", newline="") as f:
        assert f.read() == "[ZoneTransfer]\r\nZoneId=3\r\n"
    assert p.read_bytes() == b"%PDF"


def test_C14_a_file_in_two_courses_stays_with_the_first_and_lists_the_other(fake):
    g, a, store = fake
    g.more["1002"] = [{"id": "s1", "title": "Shared notes", "updateTime": "2026-11-01T00:00:00Z", "materials": [g.drive("fileNotes0001")]}]
    sync.sync(a, store, subjects=SUBJECTS)
    sync.sync(a, store, subjects=SUBJECTS, only=["1002"])     # the second course alone must not take it over
    rec = store.manifest()["files"]["fileNotes0001"]
    assert rec["course"] == "1001" and rec["post"]["title"] == "Unit 2"
    assert rec["also_in"] == [{"course": "1002", "post_title": "Shared notes"}]
    assert media_calls(g).count("DR/files/fileNotes0001?alt=media") == 1
    assert not list((store.root / "originals").glob("seminar-*/fileNotes0001.*"))


def test_C15_a_failed_refetch_keeps_the_good_copy_and_says_it_is_stale(fake):
    g, a, store = fake
    sync.sync(a, store, subjects=SUBJECTS)
    first = store.manifest()["files"]["fileNotes0001"]
    g.files["fileNotes0001"].update(modifiedTime="2026-11-21T10:00:00Z", deny=True)
    sync.sync(a, store, subjects=SUBJECTS)
    rec = store.manifest()["files"]["fileNotes0001"]
    assert rec["state"] == "live" and rec["stale"] is True and rec["path"] == first["path"] and rec["note"] == first["note"]
    assert rec["reason"].startswith("The newer version could not be fetched") and "does not allow downloads" in rec["reason"]
    assert store.original("fileNotes0001").read_bytes().startswith(b"%PDF") and store.note("fileNotes0001").is_file()


def test_C16_an_export_over_ten_megabytes_says_so_and_is_not_asked_again(fake):
    g, a, store = fake
    too_big = {"error": {"code": 403, "message": "This file is too large to be exported.", "errors": [{"reason": "exportSizeLimitExceeded"}]}}
    g.hook = lambda url, q: httpx.Response(403, json=too_big) if url.endswith("fileDoc000002/export") else None
    sync.sync(a, store, subjects=SUBJECTS)
    assert store.manifest()["files"]["fileDoc000002"]["reason"] == "Too large for Google to export as PDF (over 10 MB): open it in Google Drive."
    g.calls.clear()
    sync.sync(a, store, subjects=SUBJECTS)
    assert "DR/files/fileDoc000002/export" not in g.calls


def test_C17_a_shortcut_is_followed_and_a_form_is_a_link(fake):
    g, a, store = fake
    g.files["shortcut0008"] = {"name": "Link to unit 4", "mimeType": sync.SHORTCUT, "shortcutDetails": {"targetId": "fileTarget09"}}
    g.files["fileTarget09"] = {"name": "Unit 4 notes.pdf", "mimeType": "application/pdf", "modifiedTime": "2026-11-08T10:00:00Z",
                               "body": pdf_bytes(["State space form."])}
    g.files["formQuiz0010"] = {"name": "Quiz 3", "mimeType": sync.FORM, "webViewLink": "https://docs.example/forms/q3"}
    g.more["1001"] = [{"id": "m12", "title": "Unit 4", "updateTime": "2026-10-01T00:00:00Z",
                       "materials": [g.drive("shortcut0008"), g.drive("formQuiz0010")]}]
    sync.sync(a, store, subjects=SUBJECTS)
    m = store.manifest()
    assert m["files"]["fileTarget09"]["state"] == "live" and "shortcut0008" not in m["files"] and "formQuiz0010" not in m["files"]
    assert {"type": "form", "title": "Quiz 3", "url": "https://docs.example/forms/q3", "post": "Unit 4", "post_kind": "material"} \
        in m["courses"]["1001"]["links"]
    assert not any("shortcut0008?alt" in c or "formQuiz0010?alt" in c or "formQuiz0010/export" in c for c in g.calls)
    asked = next(q for u, q in g.params if u.endswith("/files/shortcut0008"))
    assert "shortcutDetails" in asked["fields"]


def test_C18_a_folder_cut_short_by_the_cap_or_the_depth_says_so(fake, monkeypatch):
    g, a, store = fake
    monkeypatch.setattr(sync, "FOLDER_CAP", 1)
    g.files["folderAAAA006"]["children"] = ["fileInFold007", "fileInFold012", "folderBBBB013"]
    g.files["fileInFold012"] = {"name": "Unit 3 part two.pdf", "mimeType": "application/pdf", "modifiedTime": "2026-11-06T10:00:00Z",
                                "body": pdf_bytes(["More harmonics."])}
    g.files["folderBBBB013"] = {"name": "Deeper", "mimeType": sync.FOLDER, "children": ["folderCCCC014"]}
    g.files["folderCCCC014"] = {"name": "Deepest", "mimeType": sync.FOLDER, "children": []}
    out = sync.sync(a, store, subjects=SUBJECTS)
    assert any("holds more than 1 files" in x for x in out["fault_lines"])
    assert all(q.get("orderBy") == "name" for u, q in g.params if u == f"{DR}/files")
    monkeypatch.setattr(sync, "FOLDER_CAP", 200)
    out = sync.sync(a, store, subjects=SUBJECTS)
    assert any("1 folder nested more than two levels deep" in x for x in out["fault_lines"])


def test_C19_ids_that_are_not_ids_never_reach_a_path_or_a_url(fake):
    g, a, store = fake
    g.more["1001"] = [{"id": "m13", "title": "Odd", "updateTime": "2026-10-01T00:00:00Z",
                       "materials": [{"driveFile": {"driveFile": {"id": "../../evil", "title": "evil"}}}]}]

    def odd_course(url, q):
        if url == f"{CR}/courses" and q.get("pageToken"):
            return httpx.Response(200, json={"courses": [{"id": "1002", "name": "Seminar"}, {"id": "../x", "name": "Odd course"}]})
        return None
    g.hook = odd_course
    out = sync.sync(a, store, subjects=SUBJECTS)
    assert not any("evil" in u or "/../" in u or "%2F" in u for u, q in g.params)
    assert any("Odd course" in x and "not safe" in x for x in out["fault_lines"])
    assert any("evil" in x and "not a Drive id" in x for x in out["fault_lines"])
    assert "../x" not in store.manifest()["courses"]


def test_C20_a_title_with_newlines_cannot_break_the_note():
    class Ex:
        pages, scanned, title = 1, [], ""
        sections = [type("S", (), {"text": "Body text.", "loc": "", "page": 1, "heading": "Part\n# Fake"})()]
    rec = {"title": "Line one\n# Injected\n---\nbad: yes", "course_name": "C\nD", "post": {"title": "P\r\nQ"}, "path": "x"}
    text, _ = sync.to_markdown(Ex(), rec)
    lines = text.splitlines()
    assert lines.count("---") == 2 and "# Injected" not in lines and "bad: yes" not in lines and "# Fake" not in lines
    assert "# Line one # Injected --- bad: yes" in lines


# ------------------------------------------------------------------ D: the paper hand-off
def test_D21_a_desk_job_that_never_ends_releases_the_hand_off(env, monkeypatch):
    env.connect_fake_account()
    env.sync()
    desk = env.c.app.state.pyq_ingest
    monkeypatch.setattr(desk, "start", lambda paths, **k: {"id": "j-forever", "status": "running", "files": []})
    monkeypatch.setattr(desk, "get", lambda job_id: {"id": job_id, "status": "running", "files": []})
    monkeypatch.setattr(desk, "wait", lambda timeout=60: None)
    monkeypatch.setattr(R, "PAPER_WAIT", 0.3)
    assert env.c.post(f"{B}/files/fileInFold007/to-papers").status_code == 200
    for w in list(env.c.app.state.gcr.watchers):
        w.join(10)
    assert env.c.app.state.gcr.pending == 0
    assert env.c.post(f"{B}/sync", json={}).status_code == 200      # not 409 for the rest of the app's life
    env.wait()


def test_D22_a_file_already_at_the_desk_is_not_sent_again(env, monkeypatch):
    env.connect_fake_account()
    env.sync()
    c = env.c
    assert c.post(f"{B}/files/fileInFold007/to-papers").status_code == 200
    env.wait()
    starts = []
    real = c.app.state.pyq_ingest.start
    monkeypatch.setattr(c.app.state.pyq_ingest, "start", lambda *a, **k: starts.append(1) or real(*a, **k))
    j = c.post(f"{B}/files/fileInFold007/to-papers").json()
    envelope(j)
    assert (j["state"], j["reason"], j["job"]) == ("live", "Already at the paper desk.", None) and j["file"]["paper_id"]
    assert starts == []


# ------------------------------------------------------------------ E: small
def test_E23_an_offline_disconnect_forgets_here_and_says_google_was_not_told(signin):
    kr = signin

    def offline(url, data):
        raise httpx.ConnectError("no network")
    out = auth.disconnect(post=offline)
    assert out["reason"] == auth.UNTOLD and kr.box == {}


def test_E23_the_index_entry_goes_even_when_the_secret_cannot_be_deleted(signin):
    kr = signin
    auth._store("R2", [auth.PREFIX + s for s in auth.SCOPES], "college")

    def stuck(service, name):
        raise RuntimeError("credential store locked")
    kr.delete_password = stuck
    auth.disconnect(post=lambda url, data: httpx.Response(200, json={}), account="college")
    assert json.loads(kr.box[(auth.SERVICE, auth.INDEX)]) == []


def test_E24_an_empty_course_list_is_refused_not_read_as_all(env):
    env.connect_fake_account()
    r = env.c.post(f"{B}/sync", json={"courses": []})
    assert r.status_code == 400 and r.json()["detail"] == R.EMPTY_COURSES
    assert env.c.app.state.gcr.sync_thread is None
