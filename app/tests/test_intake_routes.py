"""Routes R-36 to R-42 (routes_ww_intake.py) through the real app with the intake, paper-desk and library features
mounted. Each test has its own intake and paper stores under tmp_path; every title, paper and folder is invented."""
from __future__ import annotations

import re
import threading
from datetime import datetime, timezone

import pytest
from starlette.testclient import TestClient

from jarvis_app import routes_ww_intake as R
from jarvis_app.security import Guard
from jarvis_app.server import create_app
from jarvis_app.ww_intake import store as intake_mod
from jarvis_app.ww_pyq import api, folder, schema
from jarvis_app.ww_pyq import store as pyq_mod
from jarvis_app.ww_pyq.store import Store
from pyq_fixtures import BY_NAME, build_pdf

TOKEN = "t" * 32
B = "/api/mission/intake"
NOW = datetime(2026, 11, 14, 10, 0, tzinfo=timezone.utc)


class FakePlan:
    def academics(self):
        return {"subjects": [{"id": "sig", "name": "Signals and Systems"}, {"id": "thermo", "name": "Thermal Physics"}]}


class FakeLibrary:
    def __init__(self):
        self.read: list[str] = []
        self.gate = threading.Event()
        self.gate.set()

    def ingest(self, path, progress=None):
        self.gate.wait(10)
        self.read.append(str(path))
        return {"counts": {"added": 1}, "took_s": 0.0, "files": 1, "results": [{"file": "x", "status": "added"}]}


class BusyJobs:
    def start(self, *a, **k):
        raise api.Busy("Already reading files; wait for that to finish.")


@pytest.fixture()
def env(tmp_path, monkeypatch):
    holder = {"intake": intake_mod.IntakeStore(tmp_path / "intake")}
    pyq = Store(tmp_path / "pyq")
    monkeypatch.setattr(intake_mod, "default_store", lambda: holder["intake"])
    monkeypatch.setattr(pyq_mod, "default_store", lambda: pyq)
    monkeypatch.setattr(R, "_now", lambda: NOW)
    app = create_app(Guard(8777, TOKEN, extra_hosts=["testserver"]), autostart_aankhen="off",
                     features=["ww_intake", "ww_pyq_ingest", "library"])
    with TestClient(app) as c:
        c.headers.update({"X-Jarvis-Token": TOKEN})
        app.state.svc.plan = FakePlan()
        app.state.library = FakeLibrary()
        yield c, holder, pyq, tmp_path


def envelope(j):
    assert j["state"] in schema.STATES and isinstance(j["reason"], str) and j["reason"] and j["source"]
    return j


def cal(*events: str) -> str:
    return "\r\n".join(["BEGIN:VCALENDAR", "VERSION:2.0", *events, "END:VCALENDAR"]) + "\r\n"


def vev(*lines: str) -> str:
    return "\r\n".join(["BEGIN:VEVENT", *lines, "END:VEVENT"])


def paste(c, text):
    r = c.post(f"{B}/paste", json={"text": text})
    assert r.status_code == 200, r.text
    return envelope(r.json())


def watched(tmp, pyq, *names):
    d = tmp / "his watched folder"
    d.mkdir(exist_ok=True)
    out = []
    for n in names:
        out.append(build_pdf(BY_NAME["signals_basic"], tmp / "built").replace(d / n))
    folder.set_folder(pyq, str(d))
    return out


# ------------------------------------------------------------------ acceptance 6: every route answers and is documented
def test_every_route_answers_carries_the_envelope_and_is_in_the_docstring(env):
    c, holder, pyq, tmp = env
    envelope(c.get(B).json())
    rid = paste(c, "Widget lab report due 2026-11-20")["items"][0]["id"]
    envelope(c.post(f"{B}/ics", content=cal(vev("UID:a@x", "SUMMARY:Gizmo seminar", "DTSTART:20261120T090000Z"))).json())
    envelope(c.patch(f"{B}/{rid}", json={"state": "accepted"}).json())
    envelope(c.get(f"{B}/deadlines").json())
    row = holder["intake"].add_file("copy.pdf", b"%PDF-1.4 invented")
    r = c.post(f"{B}/{row['id']}/take", json={"to": "notes"})
    assert r.status_code == 200, r.text
    envelope(r.json())
    c.app.state.library_jobs.wait(10)
    envelope(c.delete(f"{B}/{rid}").json())
    doc = R.__doc__
    for n in range(36, 43):
        assert f"R-{n}" in doc
    rows = re.findall(r"^\s{2,}(GET|POST|PUT|PATCH|DELETE)\s+(/api/\S+)", doc, re.M)
    documented = {(m, re.sub(r"\{[^}]+\}", "{}", p.split("?")[0])) for m, p in rows}
    defined = {(m, re.sub(r"\{[^}]+\}", "{}", r.path)) for r in c.app.routes for m in getattr(r, "methods", ())
               if r.path.startswith(B) and m != "HEAD"}
    assert len(rows) == 7 and documented == defined
    assert c.get(B, headers={"X-Jarvis-Token": "wrong"}).status_code in (401, 403)


# ------------------------------------------------------------------ R-36
def test_r36_waits_when_empty_and_refuses_a_bad_state_or_source(env):
    c, *_ = env
    j = c.get(B).json()
    assert (j["state"], j["reason"], j["items"]) == ("waiting", "Nothing brought in yet.", [])
    for q in ("state=done", "state=../x", "source=email"):
        r = c.get(f"{B}?{q}")
        assert r.status_code == 400 and r.json()["detail"]


def test_r36_filters_by_state_and_source(env):
    c, *_ = env
    ids = [r["id"] for r in paste(c, "Widget lab report due 2026-11-20\nGizmo quiz 2026-11-22")["items"]]
    c.post(f"{B}/ics", content=cal(vev("UID:a@x", "SUMMARY:Gizmo seminar", "DTSTART:20261120T090000Z")))
    c.patch(f"{B}/{ids[0]}", json={"state": "declined"})
    assert {r["source"] for r in c.get(f"{B}?source=ics").json()["items"]} == {"ics"}
    assert [r["id"] for r in c.get(f"{B}?state=declined").json()["items"]] == [ids[0]]
    assert c.get(f"{B}?state=taken").json()["state"] == "waiting"


# ------------------------------------------------------------------ R-37 and acceptance 1, 5
def test_r37_paste_makes_new_rows_shows_unread_lines_and_writes_nothing_else(env):
    c, holder, pyq, tmp = env
    j = paste(c, "Widget lab report due 2026-11-20\nGizmo test 31/02\n\nSignals and Systems quiz 2026-11-25 5pm")
    assert j["state"] == "live" and [r["state"] for r in j["items"]] == ["new", "new"]
    assert j["unread"] == [{"line": 2, "text": "Gizmo test 31/02", "reason": j["unread"][0]["reason"]}]
    quiz = j["items"][1]
    assert quiz["subject"] == "" and quiz["subject_suggestion"] == {"subject": "sig", "score": 0.75}
    assert pyq.list_papers() == [] and pyq.list_questions() == []      # nothing reaches the question store
    assert sorted(p.name for p in tmp.iterdir()) == ["intake", "pyq"]  # nothing written outside the two stores


def test_r37_the_same_paste_twice_adds_no_rows(env):
    c, *_ = env
    text = "Widget lab report due 2026-11-20\nGizmo quiz 2026-11-22"
    assert len(paste(c, text)["items"]) == 2
    again = paste(c, text)
    assert again["items"] == [] and "already here" in again["reason"]
    assert c.get(B).json()["count"] == 2


@pytest.mark.parametrize("body", [{"text": ""}, {"text": "   \n "}, {}, {"text": 5}, ["Widget"], "Widget", None])
def test_r37_refuses_an_empty_or_malformed_paste_with_400(env, body):
    c, *_ = env
    r = c.post(f"{B}/paste", json=body)
    assert r.status_code == 400 and r.json()["detail"]


def test_r37_refuses_more_than_20000_characters(env):
    c, *_ = env
    r = c.post(f"{B}/paste", json={"text": "x" * (R.MAX_PASTE + 1)})
    assert r.status_code == 400 and "20,000" in r.json()["detail"]
    assert c.get(B).json()["count"] == 0
    assert c.post(f"{B}/paste", json={"text": ("Widget quiz 2026-11-20\n" * 900)[:R.MAX_PASTE]}).status_code == 200


# ------------------------------------------------------------------ R-38
def test_r38_a_calendar_file_becomes_rows_with_skipped_and_past_counted(env):
    c, *_ = env
    body = cal(vev("UID:a@x", "SUMMARY:Gizmo seminar", "DTSTART:20261120T090000Z"),
               vev("UID:b@x", "SUMMARY:Old lecture", "DTSTART:20260101T090000Z"),
               "BEGIN:VEVENT\r\nSUMMARY:Never closed\r\nDTSTART:20261121T090000Z")
    j = envelope(c.post(f"{B}/ics", content=body, headers={"Content-Type": "text/calendar"}).json())
    assert [r["title"] for r in j["items"]] == ["Gizmo seminar"] and j["items"][0]["state"] == "new"
    assert (j["skipped"], j["past"]) == (1, 1)
    again = c.post(f"{B}/ics", content=body).json()
    assert again["items"] == []


@pytest.mark.parametrize("body", [b"", b"hello", b"%PDF-1.4", b"BEGIN:VCARD\r\nEND:VCARD", b"\xff\xfe\x00"])
def test_r38_refuses_what_is_not_a_calendar_with_400(env, body):
    c, *_ = env
    assert c.post(f"{B}/ics", content=body).status_code == 400


def test_r38_refuses_more_than_2_mb_with_413(env):
    c, *_ = env
    big = cal(vev("UID:a@x", "SUMMARY:" + "x" * (R.MAX_ICS + 10), "DTSTART:20261120T090000Z")).encode()
    r = c.post(f"{B}/ics", content=big)
    assert r.status_code == 413 and "2 MB" in r.json()["detail"]

    def chunks():                       # no Content-Length: the cap is held while reading
        for _ in range(3):
            yield b"x" * (R.MAX_ICS // 2 + 1)
    assert c.post(f"{B}/ics", content=chunks()).status_code == 413
    assert c.get(B).json()["count"] == 0


def test_r38_refuses_a_small_file_that_repeats_into_hundreds_of_thousands_of_rows(env):
    """45 KB of 500 open daily repeats parsed into 60,500 events (40 MB, 7.7 s, measured 27 Nov); 2 MB of them
    would be about 2.7 million rows. Half the repeats are folded across lines so the count must unfold first."""
    c, *_ = env
    events = []
    for i in range(R.MAX_ICS_RULES + 1):
        rule = "RRULE:FREQ=DAILY" if i % 2 else "RR\r\n ULE:FREQ=DAILY"
        events.append(vev(f"UID:r{i}@x", "SUMMARY:Gadget drill", "DTSTART:20261115T090000Z", rule))
    r = c.post(f"{B}/ics", content=cal(*events))
    assert r.status_code == 400 and "repeat" in r.json()["detail"]
    assert c.get(B).json()["count"] == 0
    ok = c.post(f"{B}/ics", content=cal(*events[:3]))
    assert ok.status_code == 200 and ok.json()["count"] > 3


# ------------------------------------------------------------------ R-39 and acceptance 2
def test_r39_an_ambiguous_date_cannot_be_accepted_without_a_date(env):
    c, *_ = env
    row = paste(c, "Widget viva 03/04")["items"][0]
    assert row["ambiguous"] is True and row["date"] is None and len(row["readings"]) == 2
    r = c.patch(f"{B}/{row['id']}", json={"state": "accepted"})
    assert r.status_code == 400 and "two ways" in r.json()["detail"]
    assert c.get(B).json()["items"][0]["state"] == "new"
    ok = c.patch(f"{B}/{row['id']}", json={"state": "accepted", "date": row["readings"][1]["date"]}).json()["row"]
    assert ok["state"] == "accepted" and ok["ambiguous"] is False and ok["date"] == row["readings"][1]["date"]
    assert len(ok["readings"]) == 2


def test_r39_declining_an_ambiguous_row_needs_no_date(env):
    c, *_ = env
    row = paste(c, "Widget viva 03/04")["items"][0]
    assert c.patch(f"{B}/{row['id']}", json={"state": "declined"}).json()["row"]["state"] == "declined"


def test_r39_a_suggestion_is_never_applied_by_itself(env):
    c, *_ = env
    row = paste(c, "Signals and Systems quiz 2026-11-25")["items"][0]
    out = c.patch(f"{B}/{row['id']}", json={"state": "accepted"}).json()["row"]
    assert out["subject"] == "" and out["subject_suggestion"]["subject"] == "sig"
    assert c.get(f"{B}/deadlines").json()["items"][0]["subject"] == ""
    out = c.patch(f"{B}/{row['id']}", json={"state": "accepted", "subject": "sig"}).json()["row"]
    assert out["subject"] == "sig" and out["subject_suggestion"] is None


def test_r39_edits_title_date_and_time_and_refuses_bad_values(env):
    c, *_ = env
    rid = paste(c, "Widget lab report due 2026-11-20")["items"][0]["id"]
    out = c.patch(f"{B}/{rid}", json={"state": "accepted", "title": " Widget report ", "date": "2026-11-21",
                                      "time": "09:30"}).json()["row"]
    assert (out["title"], out["date"], out["time"]) == ("Widget report", "2026-11-21", "09:30")
    for bad in ({"state": "taken"}, {}, {"state": "accepted", "date": "21/11/2026"},
                {"state": "accepted", "time": "25:00"}, {"state": "accepted", "title": ""},
                {"state": "accepted", "subject": 5}, ["accepted"]):
        r = c.patch(f"{B}/{rid}", json=bad)
        assert r.status_code == 400, bad


def test_r39_unknown_row_is_404(env):
    c, *_ = env
    assert c.patch(f"{B}/i-0123456789ab", json={"state": "accepted"}).status_code == 404


# ------------------------------------------------------------------ R-42
def test_r42_lists_accepted_rows_with_a_date_in_range_only(env):
    c, *_ = env
    items = paste(c, "Widget report 2026-11-20\nGizmo quiz 2026-11-28 5pm\nThermo essay 2026-12-05\nUndated thing")["items"]
    assert c.get(f"{B}/deadlines").json()["state"] == "waiting"
    for r in items[1:]:
        c.patch(f"{B}/{r['id']}", json={"state": "accepted"})
    j = envelope(c.get(f"{B}/deadlines").json())
    assert [d["title"] for d in j["items"]] == ["Gizmo quiz", "Thermo essay"]      # not the new one, not the undated one
    assert set(j["items"][0]) == {"id", "title", "date", "time", "subject", "source"} and j["items"][0]["time"] == "17:00"
    assert [d["title"] for d in c.get(f"{B}/deadlines?from=2026-12-01").json()["items"]] == ["Thermo essay"]
    assert c.get(f"{B}/deadlines?from=2026-11-01&to=2026-11-27").json()["state"] == "waiting"


@pytest.mark.parametrize("q", ["from=tomorrow", "to=2026-02-30", "from=2026-12-01&to=2026-11-01", "from=1"])
def test_r42_refuses_a_bad_date_with_400(env, q):
    c, *_ = env
    assert c.get(f"{B}/deadlines?{q}").status_code == 400


# ------------------------------------------------------------------ R-40 and acceptance 3
def test_folder_files_appear_as_rows_and_take_to_papers_starts_the_ingest(env):
    c, holder, pyq, tmp = env
    paper, = watched(tmp, pyq, "widget paper.pdf")
    j = c.get(f"{B}?source=folder").json()
    assert [r["title"] for r in j["items"]] == ["widget paper.pdf"]
    row = j["items"][0]
    assert row["file"]["owned"] is False and row["state"] == "new" and holder["intake"].list_rows() == []
    r = c.post(f"{B}/{row['id']}/take", json={"to": "papers"})
    assert r.status_code == 200, r.text
    out = envelope(r.json())
    assert out["row"]["state"] == "taken" and out["job"]["status"] == "running"
    done = c.app.state.pyq_ingest.wait(60)
    assert done["status"] == "done" and len(pyq.list_papers()) == 1 and pyq.list_questions()
    listed = c.get(f"{B}?source=folder").json()["items"]
    assert [(x["id"], x["state"]) for x in listed] == [(row["id"], "taken")]       # stored once, not offered again
    assert paper.exists()                                                           # his file is only read


def test_take_to_notes_starts_the_library_ingest(env):
    c, holder, pyq, tmp = env
    watched(tmp, pyq, "widget notes.pdf")
    row = c.get(B).json()["items"][0]
    out = c.post(f"{B}/{row['id']}/take", json={"to": "notes"}).json()
    assert out["row"]["state"] == "taken" and out["job"]["state"] in ("running", "done")
    assert c.app.state.library_jobs.wait(10)["state"] == "done"
    assert c.app.state.library.read == [str(tmp / "his watched folder" / "widget notes.pdf")]


def test_take_refuses_a_date_row_and_a_bad_target_with_400(env):
    c, holder, pyq, tmp = env
    rid = paste(c, "Widget lab report due 2026-11-20")["items"][0]["id"]
    r = c.post(f"{B}/{rid}/take", json={"to": "papers"})
    assert r.status_code == 400 and "Only a file" in r.json()["detail"]
    row = holder["intake"].add_file("copy.pdf", b"%PDF-1.4 invented")
    for bad in ({"to": "trash"}, {}, {"to": None}, ["papers"]):
        assert c.post(f"{B}/{row['id']}/take", json=bad).status_code == 400


def test_take_is_409_while_a_job_runs_and_the_row_stays_new(env):
    c, holder, pyq, tmp = env
    row = holder["intake"].add_file("copy.pdf", b"%PDF-1.4 invented")
    c.app.state.pyq_ingest = BusyJobs()
    r = c.post(f"{B}/{row['id']}/take", json={"to": "papers"})
    assert r.status_code == 409 and holder["intake"].get(row["id"])["state"] == "new"
    c.app.state.library.gate.clear()
    c.app.state.library_jobs.start(str(tmp))         # a library ingest already running
    try:
        assert c.post(f"{B}/{row['id']}/take", json={"to": "notes"}).status_code == 409
    finally:
        c.app.state.library.gate.set()
        c.app.state.library_jobs.wait(10)
    assert holder["intake"].get(row["id"])["state"] == "new"


def test_take_of_a_file_that_is_gone_or_unknown_is_404(env):
    c, holder, pyq, tmp = env
    paper, = watched(tmp, pyq, "gone.pdf")
    rid = c.get(B).json()["items"][0]["id"]
    row = holder["intake"].add_file("copy.pdf", b"%PDF-1.4 invented")
    holder["intake"].owned_path(row).unlink()
    assert c.post(f"{B}/{row['id']}/take", json={"to": "papers"}).status_code == 404
    paper.unlink()
    assert c.post(f"{B}/{rid}/take", json={"to": "papers"}).status_code == 404
    assert c.post(f"{B}/i-0123456789ab/take", json={"to": "papers"}).status_code == 404


# ------------------------------------------------------------------ R-41 and acceptance 4
def test_r41_deletes_the_row_and_the_apps_own_copy(env):
    c, holder, *_ = env
    row = holder["intake"].add_file("copy.pdf", b"%PDF-1.4 invented")
    p = holder["intake"].owned_path(row)
    j = envelope(c.delete(f"{B}/{row['id']}").json())
    assert j["removed"] == {"row": True, "file": True} and not p.exists()
    assert c.delete(f"{B}/{row['id']}").status_code == 404


def test_r41_never_removes_a_file_in_his_own_folder(env):
    c, holder, pyq, tmp = env
    paper, = watched(tmp, pyq, "keep me.pdf")
    rid = c.get(B).json()["items"][0]["id"]
    j = c.delete(f"{B}/{rid}").json()
    assert j["removed"] == {"row": True, "file": False} and paper.is_file()
    assert c.get(B).json()["state"] == "waiting"                    # hidden, not offered again
    forged = holder["intake"].make_row(source="folder", kind="file", title="keep me.pdf", raw_hash="ab" * 32,
                                       file={"name": "../his watched folder/keep me.pdf", "size": 1, "owned": True})
    holder["intake"].put(forged)
    assert c.delete(f"{B}/{forged['id']}").json()["removed"] == {"row": True, "file": False} and paper.is_file()


def test_r41_a_taken_folder_row_deleted_leaves_his_file(env):
    c, holder, pyq, tmp = env
    paper, = watched(tmp, pyq, "taken.pdf")
    rid = c.get(B).json()["items"][0]["id"]
    c.post(f"{B}/{rid}/take", json={"to": "papers"})
    c.app.state.pyq_ingest.wait(60)
    assert c.delete(f"{B}/{rid}").json()["removed"]["file"] is False and paper.is_file()


# ------------------------------------------------------------------ hostile ids
@pytest.mark.parametrize("rid", ["i-zzzzzzzzzzzz", "..%2F..%2Fetc", "i-0123456789AB", "x" * 300, "i-0123456789ab%00",
                                 "%2e%2e", "i-0123456789abc"])
def test_hostile_ids_are_404_on_every_id_route(env, rid):
    c, *_ = env
    assert c.patch(f"{B}/{rid}", json={"state": "accepted"}).status_code == 404
    assert c.post(f"{B}/{rid}/take", json={"to": "papers"}).status_code == 404
    assert c.delete(f"{B}/{rid}").status_code == 404


# ------------------------------------------------------------------ restart
def test_after_a_restart_the_store_reloads_what_it_wrote(env, tmp_path):
    c, holder, *_ = env
    items = paste(c, "Widget report 2026-11-20\nGizmo viva 03/04")["items"]
    c.patch(f"{B}/{items[0]['id']}", json={"state": "accepted", "subject": "sig"})
    before = c.get(B).json()["items"]
    holder["intake"] = intake_mod.IntakeStore(tmp_path / "intake")      # a new process reading the same folder
    after = c.get(B).json()["items"]
    assert after == before
    assert c.get(f"{B}/deadlines").json()["items"][0]["subject"] == "sig"
    assert c.patch(f"{B}/{items[1]['id']}", json={"state": "accepted"}).status_code == 400   # still ambiguous


# ------------------------------------------------------------------ request 20
def test_r39_new_undoes_accepted_or_declined_and_a_taken_row_stays_refused(env):
    c, holder, *_ = env
    rid = paste(c, "Widget lab report due 2026-11-20")["items"][0]["id"]
    r = c.patch(f"{B}/{rid}", json={"state": "new"})
    assert r.status_code == 400 and "nothing to undo" in r.json()["detail"]
    for decided in ("accepted", "declined"):
        assert c.patch(f"{B}/{rid}", json={"state": decided}).status_code == 200
        j = c.patch(f"{B}/{rid}", json={"state": "new"}).json()
        envelope(j)
        assert j["row"]["state"] == "new" and j["reason"] == "Row back to new."
    assert c.get(f"{B}/deadlines").json()["items"] == []
    row = holder["intake"].add_file("copy.pdf", b"%PDF-1.4 invented")
    holder["intake"].update(row["id"], {"state": "taken"})
    r = c.patch(f"{B}/{row['id']}", json={"state": "new"})
    assert r.status_code == 400 and holder["intake"].get(row["id"])["state"] == "taken"


def test_r37_a_pasted_row_carries_its_raw_line(env):
    c, *_ = env
    j = paste(c, "Widget lab report due 2026-11-20")
    assert j["items"][0]["raw"] == "Widget lab report due 2026-11-20"
    assert c.get(B).json()["items"][0]["raw"] == "Widget lab report due 2026-11-20"


def test_r39_a_take_finishing_between_the_read_and_the_write_is_not_undone(env, monkeypatch):
    c, holder, *_ = env
    st = holder["intake"]
    rid = paste(c, "Widget lab report due 2026-11-20")["items"][0]["id"]
    c.patch(f"{B}/{rid}", json={"state": "accepted"})
    stale = st.get(rid)
    st.update(rid, {"state": "taken"})                # the take lands after R-39 read the row
    st.get = lambda r: dict(stale)                    # R-39's read sees the row as it was
    try:
        r = c.patch(f"{B}/{rid}", json={"state": "new"})
    finally:
        del st.get
    assert r.status_code == 400
    assert st.get(rid)["state"] == "taken"
