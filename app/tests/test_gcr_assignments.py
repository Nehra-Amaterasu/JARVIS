"""Assignments, announcements, calendar and reminders from the Google link (routes G-14 to G-19, plan 9.0 of 25 Nov 2026).

Google is a fake transport and the reminder list is the app's own on a scratch folder. Nothing here signs in.
"""
import threading
from datetime import datetime, timedelta, timezone

import httpx
import pytest
from starlette.testclient import TestClient

import jarvis_app.routes_ww_gcr as R
from jarvis_app.security import Guard
from jarvis_app.server import create_app
from jarvis_app.ww_gcr import classroom, sync
from jarvis_app.ww_gcr.api import GoogleApi

TOKEN = "t" * 32
B = "/api/mission/gcr"
CR = "https://classroom.googleapis.com/v1"
IST = timezone(timedelta(hours=5, minutes=30))
SOON = (datetime.now() + timedelta(days=2)).strftime("%Y-%m-%d")
LATER = (datetime.now() + timedelta(days=20)).strftime("%Y-%m-%d")


def due(day: str, hours=None, minutes=0) -> dict:
    y, m, d = (int(x) for x in day.split("-"))
    out = {"dueDate": {"year": y, "month": m, "day": d}}
    if hours is not None:
        out["dueTime"] = {"hours": hours, "minutes": minutes}
    return out


class Google:
    """One course with three pieces of coursework, two announcements and a calendar."""

    def __init__(self):
        self.calls: list[str] = []
        self.methods: set[str] = set()
        self.calendar_status = 200
        self.submissions_status = 200

    def handler(self, request: httpx.Request) -> httpx.Response:
        url = str(request.url).split("?")[0]
        self.calls.append(url)
        self.methods.add(request.method)
        if url == f"{CR}/courses":
            return httpx.Response(200, json={"courses": [{"id": "1001", "name": "Signals", "courseState": "ACTIVE",
                                                          "alternateLink": "https://classroom.google.com/c/abc"}]})
        if url == f"{CR}/courses/1001/courseWorkMaterials":
            return httpx.Response(200, json={"courseWorkMaterial": []})
        if url == f"{CR}/courses/1001/courseWork":
            return httpx.Response(200, json={"courseWork": [
                {"id": "w1", "title": "Assignment 1", "alternateLink": "https://classroom.google.com/c/abc/a/w1", **due(SOON, 12, 30)},
                {"id": "w2", "title": "Lab record", "alternateLink": "https://classroom.google.com/c/abc/a/w2", **due(LATER)},
                {"id": "w3", "title": "Reading list", "alternateLink": "https://evil.example/x"},
            ]})
        if url == f"{CR}/courses/1001/courseWork/-/studentSubmissions":
            if self.submissions_status != 200:
                return httpx.Response(self.submissions_status, json={"error": {"message": "no"}})
            return httpx.Response(200, json={"studentSubmissions": [
                {"courseWorkId": "w1", "state": "CREATED"}, {"courseWorkId": "w2", "state": "TURNED_IN", "late": True},
                {"courseWorkId": "w3", "state": "SOMETHING_NEW"}]})
        if url == f"{CR}/courses/1001/announcements":
            return httpx.Response(200, json={"announcements": [
                {"id": "a1", "text": "Unit test moved to Friday.", "creationTime": "2026-11-20T10:00:00Z", "alternateLink": "https://classroom.google.com/c/abc/p/a1"},
                {"id": "a2", "text": "x" * 900, "creationTime": "2026-11-22T10:00:00Z"}]})
        if url == classroom.CALENDAR:
            if self.calendar_status != 200:
                return httpx.Response(self.calendar_status, json={"error": {"message": "no"}})
            return httpx.Response(200, json={"items": [
                {"id": "e1", "summary": "Lab viva", "start": {"dateTime": f"{SOON}T10:00:00+05:30"}, "end": {"dateTime": f"{SOON}T11:00:00+05:30"}, "htmlLink": "https://calendar.google.com/e1"},
                {"id": "e2", "start": {"date": LATER}, "end": {"date": LATER}}]})
        return httpx.Response(404, json={"error": {"message": "nope"}})


def run_sync(tmp_path, g=None, **kw):
    g = g or Google()
    store = sync.GcrStore(tmp_path / "gcr")
    api = GoogleApi(token=lambda: "tok", transport=httpx.MockTransport(g.handler))
    return store, sync.sync(api, store, extract=lambda p: None, **kw), g


@pytest.mark.parametrize("cw, expect", [
    ({}, ("", "")),
    (due("2026-11-27"), ("2026-11-27", "")),                                   # a date alone stays that date
    (due("2026-11-27", 18, 29), ("2026-11-27", "23:59")),                      # 18:29 UTC is 23:59 here
    (due("2026-11-27", 21, 30), ("2026-11-28", "03:00")),                      # the date moves with the time
    ({"dueDate": {"year": 2026, "month": 11, "day": 27}, "dueTime": {}}, ("2026-11-27", "05:30")),   # an empty time is midnight UTC
    ({"dueDate": {"year": 2026, "month": 2, "day": 31}, "dueTime": {"hours": 1}}, ("", "")),          # a date that does not exist
])
def test_a_due_date_and_time_are_converted_to_local_time_together(cw, expect):
    assert classroom.due_local(cw, IST) == expect


def test_a_sync_keeps_coursework_submission_state_announcements_and_the_calendar(tmp_path):
    store, res, g = run_sync(tmp_path)
    m = store.manifest()
    c = m["courses"]["1001"]
    work = {w["id"]: w for w in c["work"]}
    assert work["w1"]["work"] == "assigned" and work["w1"]["due"] and work["w1"]["due_time"] and not work["w1"]["late"]
    assert (work["w2"]["work"], work["w2"]["late"], work["w2"]["due"], work["w2"]["due_time"]) == ("turned_in", True, LATER, "")
    assert work["w3"]["work"] == "unknown" and work["w3"]["due"] == ""         # a state Google adds later is not guessed
    assert [a["id"] for a in c["announcements"]] == ["a2", "a1"] and len(c["announcements"][0]["text"]) == 600
    assert c["work_fault"] == "" and res["faults"] == 0
    cal = m["calendar"]["main"]
    assert [e["title"] for e in cal["events"]] == ["Lab viva", "(no title)"] and cal["events"][1]["all_day"] is True and cal["fault"] == ""
    assert g.methods == {"GET"}                                                 # nothing is ever written to Google


def test_a_refused_submission_or_calendar_is_kept_as_a_reason_and_does_not_fail_the_file_run(tmp_path):
    g = Google()
    g.submissions_status, g.calendar_status = 403, 403
    store, res, _ = run_sync(tmp_path, g)
    c = store.manifest()["courses"]["1001"]
    assert c["work_fault"] and all(w["work"] == "unknown" for w in c["work"]) and res["faults"] == 0
    assert store.manifest()["calendar"]["main"] == {"read_at": store.manifest()["calendar"]["main"]["read_at"], "events": [], "fault": "permission"}


def test_a_sync_of_chosen_courses_does_not_read_the_calendar(tmp_path):
    store, _, g = run_sync(tmp_path, only=["1001"])
    assert classroom.CALENDAR not in g.calls and "calendar" not in store.manifest()


@pytest.fixture()
def env(tmp_path, monkeypatch):
    monkeypatch.delenv("JARVIS_GOOGLE", raising=False)
    store, _, g = run_sync(tmp_path)
    opened: list = []
    monkeypatch.setattr(R, "_store", lambda: store)
    monkeypatch.setattr(R, "open_url", lambda url: opened.append(url))
    app = create_app(Guard(8777, TOKEN, extra_hosts=["testserver"]), autostart_aankhen="off", features=["reminders", "ww_gcr"])
    with TestClient(app) as c:
        c.headers.update({"X-Jarvis-Token": TOKEN})
        rs = app.state.svc.reminders
        for r in rs.pending():                       # the reminder list is one file for the whole test session
            rs.cancel(r["id"])
        yield c, store, opened, app
        for r in rs.pending():
            rs.cancel(r["id"])


def test_the_assignments_list_says_what_classroom_says_and_counts_what_is_open(env):
    c, store, opened, app = env
    j = c.get(f"{B}/assignments").json()
    assert j["state"] == "live" and j["reason"] == "2 open: 1 is due in the next 3 days." and j["source"]
    assert [r["id"] for r in j["items"]] == ["w1", "w3"]                        # dated first, the undated one last; turned-in work is not open
    w1 = j["items"][0]
    assert (w1["work"], w1["late"], w1["days_left"], w1["course_name"], w1["reminder"]) == ("assigned", False, 2, "Signals", None)
    assert j["counts"] == {"open": 2, "turned_in": 1, "late": 1, "no_due_date": 1} and j["read_at"]
    everything = c.get(f"{B}/assignments", params={"show": "all"}).json()
    assert [r["id"] for r in everything["items"]] == ["w1", "w2", "w3"] and everything["items"][1]["work"] == "turned_in"
    assert c.get(f"{B}/assignments", params={"show": "done"}).status_code == 400
    assert c.get(f"{B}/assignments", params={"course": "9999"}).json()["items"] == []
    for word in ("grade", "score", "should", "must"):
        assert word not in str(j).lower()


def test_before_any_sync_the_lists_wait_and_say_so(tmp_path, monkeypatch):
    monkeypatch.delenv("JARVIS_GOOGLE", raising=False)
    store = sync.GcrStore(tmp_path / "empty")
    monkeypatch.setattr(R, "_store", lambda: store)
    app = create_app(Guard(8777, TOKEN, extra_hosts=["testserver"]), autostart_aankhen="off", features=["reminders", "ww_gcr"])
    with TestClient(app) as c:
        c.headers.update({"X-Jarvis-Token": TOKEN})
        assert c.get(f"{B}/assignments").json()["reason"] == "No coursework read yet: run a sync."
        assert c.get(f"{B}/announcements").json()["state"] == "waiting"
        assert c.get(f"{B}/calendar").json()["reason"] == "The calendar has not been read yet: run a sync."
        assert c.delete(f"{B}/sync").status_code == 400


def test_open_goes_to_the_browser_only_for_a_classroom_address(env):
    c, store, opened, app = env
    j = c.post(f"{B}/assignments/w1/open").json()
    assert j["state"] == "live" and opened == ["https://classroom.google.com/c/abc/a/w1"]
    assert c.post(f"{B}/assignments/w3/open").status_code == 400 and len(opened) == 1      # an address that is not Classroom's is not opened
    assert c.post(f"{B}/assignments/nope/open").status_code == 404


def test_a_reminder_is_made_only_on_his_press_once_and_at_six_the_evening_before(env):
    c, store, opened, app = env
    rs = app.state.svc.reminders
    assert rs.pending() == []                                                   # the sync made none by itself
    j = c.post(f"{B}/assignments/w2/remind").json()
    before = datetime.strptime(LATER, "%Y-%m-%d") - timedelta(days=1)
    assert j["state"] == "live" and j["reminder"]["due"] == before.strftime("%Y-%m-%dT18:00")
    assert "Lab record" in j["reminder"]["text"] and "Signals" in j["reminder"]["text"]
    assert len(rs.pending()) == 1 and rs.pending()[0]["id"] == j["reminder"]["id"]
    again = c.post(f"{B}/assignments/w2/remind").json()
    assert again["reason"] == "This assignment already has a reminder." and again["reminder"]["id"] == j["reminder"]["id"] and len(rs.pending()) == 1
    row = next(r for r in c.get(f"{B}/assignments", params={"show": "all"}).json()["items"] if r["id"] == "w2")
    assert row["reminder"]["id"] == j["reminder"]["id"]
    rs.cancel(j["reminder"]["id"])                                              # he removes it in the reminder list
    row = next(r for r in c.get(f"{B}/assignments", params={"show": "all"}).json()["items"] if r["id"] == "w2")
    assert row["reminder"] is None


def test_a_reminder_needs_a_time_that_exists_and_has_not_passed(env):
    c, store, opened, app = env
    assert c.post(f"{B}/assignments/w3/remind").json()["detail"] == "This assignment has no due date; give a time."
    assert c.post(f"{B}/assignments/w3/remind", json={"at": "2020-01-01T10:00"}).json()["detail"] == "That time has passed."
    assert c.post(f"{B}/assignments/w3/remind", json={"at": "next week"}).status_code == 400
    at = (datetime.now() + timedelta(days=1)).strftime("%Y-%m-%dT09:15")
    j = c.post(f"{B}/assignments/w3/remind", json={"at": at}).json()
    assert j["reminder"]["due"] == at and c.post(f"{B}/assignments/nope/remind").status_code == 404
    assert len(app.state.svc.reminders.pending()) == 1


def test_announcements_and_calendar_read_what_the_sync_kept(env):
    c, store, opened, app = env
    j = c.get(f"{B}/announcements").json()
    assert j["state"] == "live" and [a["id"] for a in j["items"]] == ["a2", "a1"] and j["items"][1]["course_name"] == "Signals"
    assert len(c.get(f"{B}/announcements", params={"limit": 1}).json()["items"]) == 1
    j = c.get(f"{B}/calendar").json()
    assert j["state"] == "live" and [e["id"] for e in j["items"]] == ["e1", "e2"] and j["read_at"]
    assert c.get(f"{B}/calendar", params={"from": SOON, "to": SOON}).json()["count"] == 1
    assert c.get(f"{B}/calendar", params={"from": "tomorrow"}).status_code == 400
    store.update(lambda m: m["calendar"].__setitem__("main", {"read_at": "x", "events": [], "fault": "permission"}))
    j = c.get(f"{B}/calendar").json()
    assert j["state"] == "fault" and j["reason"] == "The calendar permission was not granted: connect again and tick it."


def test_stop_ends_a_running_sync_and_the_job_times_are_iso(env):
    c, store, opened, app = env
    g = app.state.gcr
    with g.lock:
        g.job = {"status": "running", "started": sync._now(), "finished": "", "text": "Reading.", "counts": {}, "fault_lines": []}
    g.stop.clear()
    j = c.delete(f"{B}/sync").json()
    assert j["state"] == "waiting" and j["reason"] == "Stopping after the file being fetched." and g.stop.is_set()
    assert datetime.strptime(j["job"]["started"], "%Y-%m-%dT%H:%M:%SZ")
    with g.lock:
        g.job = None
    g.stop.clear()


def test_with_the_link_switched_off_nothing_opens_and_no_reminder_is_made(env, monkeypatch):
    c, store, opened, app = env
    monkeypatch.setenv("JARVIS_GOOGLE", "off")
    assert c.get(f"{B}/assignments").json()["state"] == "planned"
    assert c.post(f"{B}/assignments/w1/open").status_code == 400 and opened == []
    assert c.post(f"{B}/assignments/w2/remind").status_code == 400 and app.state.svc.reminders.pending() == []
