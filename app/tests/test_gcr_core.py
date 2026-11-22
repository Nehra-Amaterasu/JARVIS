"""The Google link's core against a fake Google (httpx.MockTransport): sign-in state, Classroom reading, the sync to disk.

No test touches the network (conftest blocks it), the real credential store, or the real client file.
"""
import json

import httpx
import pytest

from jarvis_app.ww_gcr import auth, classroom, sync
from jarvis_app.ww_gcr.api import ApiError, GoogleApi

CR = "https://classroom.googleapis.com/v1"
DR = "https://www.googleapis.com/drive/v3"
DOC = "application/vnd.google-apps.document"
PPT_OLD = "application/vnd.ms-powerpoint"


def pdf_bytes(pages):
    """A small PDF: a str is a text page, None is a page that is only a picture (what a scan looks like)."""
    import fitz
    doc = fitz.open()
    for body in pages:
        page = doc.new_page()
        if body is None:
            src = fitz.open()
            sp = src.new_page()
            sp.insert_text((72, 100), "handwritten page", fontsize=20)
            page.insert_image(page.rect, pixmap=sp.get_pixmap(dpi=60))
            src.close()
        else:
            page.insert_text((72, 100), body, fontsize=12)
    data = doc.tobytes()
    doc.close()
    return data


class FakeGoogle:
    def __init__(self):
        self.calls = []
        self.files = {
            "fileNotes0001": {"name": "Unit 2 Laplace transform notes.pdf", "mimeType": "application/pdf", "modifiedTime": "2026-11-01T10:00:00Z",
                              "body": pdf_bytes(["The Laplace transform of a unit step is one over s.", None])},
            "fileDoc000002": {"name": "Assignment sheet", "mimeType": DOC, "modifiedTime": "2026-11-02T10:00:00Z",
                              "export": pdf_bytes(["Solve the five problems on convolution."])},
            "filePpt000003": {"name": "Lecture 4.ppt", "mimeType": PPT_OLD, "modifiedTime": "2026-11-03T10:00:00Z", "body": b"\xd0\xcf\x11\xe0old"},
            "filePaper0004": {"name": "paper-2.pdf", "mimeType": "application/pdf", "modifiedTime": "2026-11-04T10:00:00Z",
                              "body": pdf_bytes(["1. Define a causal system. [2]"])},
            "fileLocked005": {"name": "locked.pdf", "mimeType": "application/pdf", "modifiedTime": "2026-11-05T10:00:00Z", "deny": True},
            "folderAAAA006": {"name": "Unit 3", "mimeType": sync.FOLDER, "children": ["fileInFold007"]},
            "fileInFold007": {"name": "Unit 3 Fourier series.pdf", "mimeType": "application/pdf", "modifiedTime": "2026-11-06T10:00:00Z",
                              "body": pdf_bytes(["A periodic signal is a sum of harmonics."])},
        }

    def drive(self, fid):
        return {"driveFile": {"driveFile": {"id": fid, "title": self.files[fid]["name"], "alternateLink": f"https://drive.example/{fid}"}}}

    def handler(self, request: httpx.Request) -> httpx.Response:
        url = str(request.url).split("?")[0]
        q = dict(request.url.params)
        self.calls.append(url.replace(CR, "CR").replace(DR, "DR") + ("?alt=media" if q.get("alt") else ""))
        assert request.method == "GET" and request.headers["authorization"] == "Bearer tok"
        if url == f"{CR}/courses":
            if not q.get("pageToken"):
                return httpx.Response(200, json={"courses": [{"id": "1001", "name": "Signals and Systems", "section": "V A", "courseState": "ACTIVE"}],
                                                 "nextPageToken": "p2"})
            return httpx.Response(200, json={"courses": [{"id": "1002", "name": "Seminar", "courseState": "ARCHIVED"}]})
        if url.endswith("/topics"):
            return httpx.Response(200, json={"topic": [{"topicId": "t1", "name": "CIE 2"}]} if "/1001/" in url else {})
        if url == f"{CR}/courses/1001/courseWorkMaterials":
            return httpx.Response(200, json={"courseWorkMaterial": [
                {"id": "m1", "title": "Unit 2", "updateTime": "2026-11-01T00:00:00Z",
                 "materials": [self.drive("fileNotes0001"), self.drive("filePpt000003"), {"link": {"url": "https://example.org/x", "title": "Reference"}}]},
                {"id": "m2", "title": "Sheet two", "topicId": "t1", "updateTime": "2026-11-04T00:00:00Z", "materials": [self.drive("filePaper0004")]},
                {"id": "m3", "title": "Unit 3 folder", "updateTime": "2026-11-06T00:00:00Z", "materials": [self.drive("folderAAAA006"), self.drive("fileLocked005")]},
            ]})
        if url == f"{CR}/courses/1001/courseWork":
            return httpx.Response(200, json={"courseWork": [{"id": "w1", "title": "Assignment 1", "dueDate": {"year": 2026, "month": 11, "day": 30},
                                                             "updateTime": "2026-11-02T00:00:00Z", "materials": [self.drive("fileDoc000002")]}]})
        if url == f"{CR}/courses/1001/announcements":
            return httpx.Response(403, json={"error": {"status": "PERMISSION_DENIED", "message": "Request had insufficient authentication scopes."}})
        if url.startswith(f"{CR}/courses/1002/"):
            return httpx.Response(200, json={})
        if url == f"{DR}/files" and "in parents" in q.get("q", ""):
            parent = q["q"].split("'")[1]
            return httpx.Response(200, json={"files": [{"id": c, **{k: v for k, v in self.files[c].items() if k in ("name", "mimeType", "modifiedTime")}}
                                                       for c in self.files[parent]["children"]]})
        if url.startswith(f"{DR}/files/"):
            fid = url[len(f"{DR}/files/"):].split("/")[0]
            f = self.files[fid]
            if url.endswith("/export"):
                assert q["mimeType"] == "application/pdf"
                return httpx.Response(200, content=f["export"])
            if q.get("alt") == "media":
                if f.get("deny"):
                    return httpx.Response(403, json={"error": {"errors": [{"reason": "cannotDownload"}], "message": "no"}})
                return httpx.Response(200, content=f["body"])
            extra = {k: f[k] for k in ("shortcutDetails", "webViewLink") if k in f}
            return httpx.Response(200, json={"id": fid, "name": f["name"], "mimeType": f["mimeType"], "modifiedTime": f.get("modifiedTime", ""),
                                             **extra})
        return httpx.Response(404, json={"error": {"message": "nope"}})


@pytest.fixture()
def google():
    g = FakeGoogle()
    api = GoogleApi(token=lambda: "tok", transport=httpx.MockTransport(g.handler))
    yield g, api
    api.close()


SUBJECTS = [{"id": "signals-systems", "name": "Signals and Systems"}, {"id": "modern-control", "name": "Modern Control"}]


def test_courses_follow_pages_and_posts_keep_what_they_could_read(google):
    g, api = google
    cs = classroom.courses(api)
    assert [(c["id"], c["state"]) for c in cs] == [("1001", "active"), ("1002", "archived")]
    posts, faults = classroom.posts(api, "1001")
    assert sorted(p["kind"] for p in posts) == ["coursework", "material", "material", "material"]
    assert len(faults) == 1 and faults[0].startswith("announcements:") and "permission was not granted" in faults[0]
    by = {p["id"]: p for p in posts}
    assert by["m2"]["topic"] == "CIE 2" and by["w1"]["due"] == "2026-11-30"
    assert [a["type"] for a in by["m1"]["attachments"]] == ["drive", "drive", "link"]


def test_sync_writes_originals_notes_and_an_honest_manifest(google, tmp_path):
    g, api = google
    store = sync.GcrStore(tmp_path / "gcr")
    out = sync.sync(api, store, subjects=SUBJECTS)
    assert (out["courses"], out["files"], out["fetched"], out["faults"]) == (2, 6, 5, 2)        # 6 files met, 1 refused; + the announcements fault line
    m = store.manifest()
    course = m["courses"]["1001"]
    assert (course["subject"], course["subject_source"]) == ("signals-systems", "rule") and m["courses"]["1002"]["subject"] == ""
    assert course["links"] == [{"type": "link", "title": "Reference", "url": "https://example.org/x", "post": "Unit 2", "post_kind": "material"}]
    f = m["files"]
    # a PDF with one text page and one picture page: the note has the text and says what is missing
    notes = f["fileNotes0001"]
    assert notes["state"] == "live" and notes["ext"] == "pdf" and notes["kind"] == "notes" and notes["scanned_pages"] == 1
    text = store.note("fileNotes0001").read_text(encoding="utf-8")
    assert "Laplace transform of a unit step" in text and "1 of 2 pages are pictures" in text and text.startswith("---\ntitle: ")
    assert "source: Google Classroom" in text and store.original("fileNotes0001").read_bytes().startswith(b"%PDF")
    # a Google Doc has no bytes of its own: exported as PDF, then read like any PDF
    assert f["fileDoc000002"]["exported"] is True and f["fileDoc000002"]["ext"] == "pdf"
    assert "five problems on convolution" in store.note("fileDoc000002").read_text(encoding="utf-8")
    # an old PowerPoint keeps its original and says why there is no note
    assert f["filePpt000003"]["state"] == "live" and f["filePpt000003"]["note"] == "" and f["filePpt000003"]["note_state"] == "waiting"
    assert "old PowerPoint" in f["filePpt000003"]["note_reason"]
    # the post's topic names a test, so the rule calls the file a paper, and says it is a rule
    assert (f["filePaper0004"]["kind"], f["filePaper0004"]["kind_source"]) == ("paper", "rule")
    # a file inside an attached folder is found; a file whose owner forbids download is a fault with Google's reason
    assert f["fileInFold007"]["state"] == "live" and "harmonics" in store.note("fileInFold007").read_text(encoding="utf-8")
    assert f["fileLocked005"]["state"] == "fault" and "does not allow downloads" in f["fileLocked005"]["reason"]
    assert "folderAAAA006" not in f
    assert any("announcements" in x for x in m["faults"]) and any("locked.pdf" in x for x in m["faults"])


def test_a_second_sync_fetches_nothing_that_did_not_change_and_keeps_a_hand_correction(google, tmp_path):
    g, api = google
    store = sync.GcrStore(tmp_path / "gcr")
    sync.sync(api, store, subjects=SUBJECTS)
    m = store.manifest()
    m["files"]["fileNotes0001"].update(kind="paper", kind_source="hand")
    m["courses"]["1001"].update(subject="modern-control", subject_source="hand")
    store.save(m)
    g.calls.clear()
    g.files["filePaper0004"]["modifiedTime"] = "2026-11-09T10:00:00Z"                       # one file changed at Google
    out = sync.sync(api, store, subjects=SUBJECTS)
    media = [c for c in g.calls if c.endswith("?alt=media") or c.endswith("/export")]
    # only the changed one: the file whose owner forbids downloads is a lasting refusal and is not asked again until it changes
    assert sorted(media) == ["DR/files/filePaper0004?alt=media"]
    assert out["fetched"] == 1 and out["unchanged"] == 4
    assert any("locked.pdf" in x and "Not asked again" in x for x in out["fault_lines"])
    m = store.manifest()
    assert (m["files"]["fileNotes0001"]["kind"], m["files"]["fileNotes0001"]["kind_source"]) == ("paper", "hand")
    assert (m["courses"]["1001"]["subject"], m["courses"]["1001"]["subject_source"]) == ("modern-control", "hand")


def test_a_course_switched_off_is_not_read_and_only_narrows_a_run(google, tmp_path):
    g, api = google
    store = sync.GcrStore(tmp_path / "gcr")
    out = sync.sync(api, store, only=["1002"])
    assert out["courses"] == 1 and out["files"] == 0 and "1001" not in store.manifest()["courses"]
    m = store.manifest()
    m["courses"]["1002"]["include"] = False
    store.save(m)
    assert sync.sync(api, store)["courses"] == 1 and "1001" in store.manifest()["courses"]   # 1002 skipped, 1001 read


@pytest.mark.parametrize("fid", ["../../secrets", "a", "fileNotes0001/../x", "", "unknownFile999"])
def test_the_store_serves_only_files_it_wrote(google, tmp_path, fid):
    g, api = google
    store = sync.GcrStore(tmp_path / "gcr")
    sync.sync(api, store)
    with pytest.raises(KeyError):
        store.original(fid)
    m = store.manifest()
    m["files"]["fileNotes0001"]["path"] = "../outside.pdf"                                   # a manifest line that points outside
    store.save(m)
    (tmp_path / "outside.pdf").write_bytes(b"%PDF")
    with pytest.raises(KeyError):
        store.original("fileNotes0001")


@pytest.mark.parametrize("names, paper", [
    (("CIE-1 Question Paper",), True), (("Unit 2 notes",), False), (("Mid Sem QP 2025",), True), (("Lecture 4 slides",), False),
    (("notes.pdf", "Unit 1", "Sessional 2"), False),              # the file's own name decides first: notes under a test heading stay notes
    (("scan7.pdf", "Unit 1", "Sessional 2"), True), (("Science of materials",), False), (("recipe",), False), (("Internal assessment 2",), True),
])
def test_the_paper_rule(names, paper):
    assert sync.is_paper(*names) is paper


@pytest.mark.parametrize("name, context, kind", [
    ("CIE 1 marks.xlsx", ("CIE-2 marks",), "other"),                         # a mark list names a test and is not a paper
    ("Eligible student_CIE3_Microelectronics.pdf", ("ELIGIBLE STUDENT LIST FOR CIE3",), "other"),
    ("AB510_CIE1.docx", ("CIE",), "paper"),
    ("Sol of AB510_CIE1.docx", ("CIE",), "paper"),                           # its own name still names the test
    ("AB510_Unit_4_Question_Bank.pdf", ("Unit-4",), "paper"),
    ("AB510_Unit_4_Test.pdf", ("Unit-4",), "notes"),                         # "test" alone is too loose a word to decide
    ("AB510_Unit_5_Notes.pdf", ("Unit-5",), "notes"),
    ("AB102 Model QP.pdf", ("Model QP",), "paper"),
    ("Important Questions For End Term.pdf", ("Important Questions",), "paper"),
    ("Unit-5(Notes).pdf", ("CIE",), "notes"),                                # notes posted under a test heading stay notes
    ("scan0042.pdf", ("Sessional 2 paper",), "paper"),                       # a name that says nothing takes the post's word
    ("scan0042.pdf", ("Internal marks",), "other"),
    ("university syllabus1.pdf", ("syllabus",), "notes"),
])
def test_classify_on_the_kinds_of_names_met_in_a_real_classroom(name, context, kind):
    assert sync.classify(name, *context) == kind


def test_api_refusals_are_sentences_and_the_api_cannot_write():
    def handler(request):
        if "disabled" in str(request.url):
            return httpx.Response(403, json={"error": {"status": "PERMISSION_DENIED", "message": "Classroom API has not been used in project 1 before or it is disabled.",
                                                       "details": [{"reason": "SERVICE_DISABLED"}]}})
        return httpx.Response(401, json={})
    api = GoogleApi(token=lambda: "tok", transport=httpx.MockTransport(handler))
    with pytest.raises(ApiError) as e:
        api.get(f"{CR}/disabled")
    assert str(e.value) == "The Google Classroom API is not switched on in your Google Cloud project." and e.value.status == 403
    with pytest.raises(auth.NotConnected):
        api.get(f"{CR}/courses")
    assert not any(hasattr(api, verb) for verb in ("post", "put", "patch", "delete"))


# ------------------------------------------------------------------ sign-in state
class FakeKeyring:
    def __init__(self):
        self.box = {}

    def get_password(self, service, name):
        return self.box.get((service, name))

    def set_password(self, service, name, value):
        assert len(value) < 1200                                  # Windows Credential Manager's limit for one secret
        self.box[(service, name)] = value

    def delete_password(self, service, name):
        self.box.pop((service, name), None)


class FakeFlow:
    granted = [auth.PREFIX + s for s in auth.SCOPES]

    def __init__(self, config, scopes):
        self.scopes = scopes

    def run_local_server(self, **kw):
        assert kw["access_type"] == "offline" and kw["bind_addr"] == "127.0.0.1" and kw["host"] == "localhost"
        return type("Creds", (), {"refresh_token": "REFRESH-SECRET", "token": "ACCESS-SECRET", "granted_scopes": type(self).granted})()


@pytest.fixture()
def signin(tmp_path, monkeypatch):
    kr = FakeKeyring()
    monkeypatch.setattr(auth, "_keyring", lambda: kr)
    monkeypatch.setattr(auth, "_access", {"token": "", "until": 0.0})
    client = tmp_path / "client_secret.json"
    monkeypatch.setenv("JARVIS_GOOGLE_CLIENT", str(client))
    return kr, client


def test_status_goes_planned_waiting_live_and_never_shows_a_secret(signin):
    kr, client = signin
    assert auth.status()["state"] == "planned"                    # no client file yet
    client.write_text(json.dumps({"web": {"client_id": "x"}}), encoding="utf-8")
    assert auth.status()["state"] == "planned" and "desktop app client" in auth.status()["reason"]
    client.write_text(json.dumps({"installed": {"client_id": "CLIENT-ID", "client_secret": "CLIENT-SECRET"}}), encoding="utf-8")
    assert auth.status()["state"] == "waiting"
    out = auth.connect(flow_factory=lambda cfg, scopes: FakeFlow(cfg, scopes))
    assert out["state"] == "live" and out["missing"] == [] and len(out["scopes"]) == len(auth.SCOPES)
    blob = json.dumps(out) + json.dumps(auth.status())
    assert not any(s in blob for s in ("REFRESH-SECRET", "ACCESS-SECRET", "CLIENT-SECRET", "CLIENT-ID"))
    assert auth.access_token() == "ACCESS-SECRET"                 # the one from the consent, still fresh: no request made


def test_an_unticked_permission_is_named_and_notes_wait_for_it(signin, monkeypatch):
    kr, client = signin
    client.write_text(json.dumps({"installed": {"client_id": "i", "client_secret": "s"}}), encoding="utf-8")
    monkeypatch.setattr(FakeFlow, "granted", [auth.PREFIX + "classroom.courses.readonly", auth.PREFIX + "calendar.readonly"])
    out = auth.connect(flow_factory=lambda cfg, scopes: FakeFlow(cfg, scopes))
    assert out["state"] == "fault" and "drive.readonly" in out["missing"] and "the files those posts attach" in out["reason"]


def test_a_scope_google_reports_under_another_name_counts_as_granted(signin):
    kr, client = signin
    client.write_text(json.dumps({"installed": {"client_id": "i", "client_secret": "s"}}), encoding="utf-8")
    granted = [auth.PREFIX + s for s in auth.SCOPES if s != "classroom.coursework.me.readonly"]
    auth._store("R1", granted + [auth.PREFIX + "classroom.student-submissions.me.readonly"])
    out = auth.status()
    assert out["state"] == "live" and out["missing"] == [] and "classroom.coursework.me.readonly" in out["scopes"]


def test_the_token_is_renewed_and_a_dead_sign_in_says_so(signin):
    kr, client = signin
    client.write_text(json.dumps({"installed": {"client_id": "i", "client_secret": "s"}}), encoding="utf-8")
    with pytest.raises(auth.NotConnected):
        auth.access_token()
    auth._store("R1", [auth.PREFIX + s for s in auth.SCOPES])
    sent = []

    def post(url, data):
        sent.append((url, dict(data)))
        return httpx.Response(200, json={"access_token": "A2", "expires_in": 3600})
    assert auth.access_token(post=post) == "A2" and auth.access_token(post=post) == "A2" and len(sent) == 1
    assert sent[0][0] == auth.TOKEN_URI and sent[0][1]["refresh_token"] == "R1" and sent[0][1]["grant_type"] == "refresh_token"
    auth._access.update(token="", until=0.0)
    with pytest.raises(auth.NotConnected) as e:
        auth.access_token(post=lambda url, data: httpx.Response(400, json={"error": "invalid_grant"}))
    assert "Connect again" in str(e.value)
    auth.disconnect(post=lambda url, data: httpx.Response(200, json={}))
    assert auth.status()["state"] == "waiting" and kr.box == {}


def test_a_second_account_has_its_own_sign_in_and_its_own_token(signin, monkeypatch):
    kr, client = signin
    monkeypatch.setattr(auth, "_access_more", {})
    client.write_text(json.dumps({"installed": {"client_id": "i", "client_secret": "s"}}), encoding="utf-8")
    assert auth.accounts() == []
    auth.connect(flow_factory=lambda cfg, scopes: FakeFlow(cfg, scopes))
    assert auth.accounts() == ["main"] and auth.status("college")["state"] == "waiting"
    out = auth.connect(flow_factory=lambda cfg, scopes: FakeFlow(cfg, scopes), account="college")
    assert out["state"] == "live" and auth.accounts() == ["main", "college"]
    # each account renews with its own refresh token
    auth._store("R-MAIN", FakeFlow.granted)
    auth._store("R-COLLEGE", FakeFlow.granted, "college")
    auth._access.update(token="", until=0.0)
    auth._access_more["college"].update(token="", until=0.0)
    sent = []

    def post(url, data):
        sent.append(data["refresh_token"])
        return httpx.Response(200, json={"access_token": "A-" + data["refresh_token"], "expires_in": 3600})
    assert auth.access_token(post=post, account="college") == "A-R-COLLEGE" and auth.access_token(post=post) == "A-R-MAIN"
    assert sent == ["R-COLLEGE", "R-MAIN"]
    # disconnecting one leaves the other
    auth.disconnect(post=lambda url, data: httpx.Response(200, json={}), account="college")
    assert auth.accounts() == ["main"] and auth.status()["state"] == "live"


@pytest.mark.parametrize("name", ["", "College", "a b", "../x", "x" * 21, "9lives"])
def test_an_account_name_is_a_short_lower_case_word(signin, name):
    with pytest.raises(ValueError):
        auth.status(name)


def test_a_sync_of_one_account_marks_its_courses_and_keeps_the_other_accounts_faults(google, tmp_path):
    g, api = google
    store = sync.GcrStore(tmp_path / "gcr")
    sync.sync(api, store, only=["1001"], account="main")
    sync.sync(api, store, only=["1002"], account="college")
    m = store.manifest()
    assert (m["courses"]["1001"]["account"], m["courses"]["1002"]["account"]) == ("main", "college")
    assert m["files"]["fileNotes0001"]["account"] == "main"
    assert any("announcements" in x for x in m["faults"]) and m["faults_by"]["college"] == []   # main's lines survive college's clean run


PLAN = [{"id": "micro-circuits", "name": "Microelectronic Circuits", "code": "25AB510"},
        {"id": "digital-comm", "name": "Digital Communication and Applications", "code": "25AB520"},
        {"id": "control", "name": "Control System Theory & Application", "code": "25AB540"},
        {"id": "product", "name": "Product Innovation and Entrepreneurship", "code": "25XY510"},
        {"id": "nas", "name": "Network Analysis and Synthesis", "code": "KEC 401"},
        {"id": "elective-1", "name": "Electric Vehicles (Open Elective)", "code": "25EL552"},
        {"id": "digital-design", "name": "Digital Design", "code": "25AB303"}]


@pytest.mark.parametrize("course, subject", [
    ("Microelectronics Circuit_5th_AB_XYZU", "micro-circuits"),      # a plural the plan does not use, and the class added
    ("25XY510", "product"),                                         # the course is named by its code alone
    ("Electric Vehicles- V sem", "elective-1"),
    ("NAS", "nas"),                                                 # the subject's initials
    ("Control Systems (5th sem)", "control"),
    ("Digital Communication & it's applications", "digital-comm"),
    ("Vth Semester AB", ""),                                        # a class group, not a subject
    ("TECHNICAL WRITING", ""),
    ("Digital", ""),                                                # one common word is not enough
])
def test_a_course_finds_its_subject_by_code_initials_or_telling_words(course, subject):
    assert sync.match_subject(course, PLAN)[0] == subject
