"""Deadline rows (ww_career_deadlines.py, routes K-05 to K-07 and the settings route in routes_ww_career_deadlines.py).

Every programme, organisation, document and date here is invented. Each test gets its own inputs file (through
JARVIS_ENGINE_INPUTS), its own applications store, its own file of deadline rows and the app's real reminder store on a
scratch file, all under tmp_path, with a fixed today and a fixed reminder clock. Sockets are blocked for every test:
nothing in this package may reach the network.
"""
import json
import socket
from datetime import date, datetime, timedelta
from types import SimpleNamespace

import pytest
from fastapi import FastAPI
from starlette.testclient import TestClient

from jarvis_app import germoney as g
from jarvis_app import routes_ww_career_deadlines as R
from jarvis_app import ww_career_deadlines as D
from jarvis_app.reminders import ReminderStore
from jarvis_app.ww_pyq import schema

BASE = "/api/mission/career/deadlines"
TODAY = date(2026, 11, 27)
BANNED = ("important", "likely", "expected", "probability", "chance", "forecast", "predict", "on track")


def strings(obj):
    if isinstance(obj, str):
        yield obj
    elif isinstance(obj, dict):
        for k, v in obj.items():
            yield str(k)
            yield from strings(v)
    elif isinstance(obj, list):
        for v in obj:
            yield from strings(v)


def envelope(j):
    assert j["state"] in schema.STATES and isinstance(j["reason"], str) and j["reason"] and j["source"], j
    for text in strings(j):
        assert not any(w in text.lower() for w in BANNED), text
    return j


class Bus:
    def __init__(self):
        self.events = []

    def publish(self, *a, **k):
        self.events.append(a)
        return {"a": a}


def block_network(monkeypatch):
    # called once the test client's event loop is up (on Windows it makes its own local socket pair through connect);
    # from then on, connecting, resolving a name or sending to an address fails the test
    def refuse(*a, **k):
        raise AssertionError("this package must not reach the network")
    monkeypatch.setattr(socket.socket, "connect", refuse)
    monkeypatch.setattr(socket.socket, "connect_ex", refuse)
    monkeypatch.setattr(socket.socket, "sendto", refuse)
    monkeypatch.setattr(socket, "create_connection", refuse)
    monkeypatch.setattr(socket, "getaddrinfo", refuse)


@pytest.fixture()
def env(tmp_path, monkeypatch):
    inputs = tmp_path / "inputs.json"
    inputs.write_text(json.dumps({"deadlines": [
        {"id": "grant-form", "title": "Invented grant form", "date": "2027-01-10", "kind": "scholarship"},
        {"title": "Invented test sitting", "date": "2026-12-20", "kind": "exam"},
    ]}), encoding="utf-8")
    monkeypatch.setenv("JARVIS_ENGINE_INPUTS", str(inputs))
    apps = g.Applications(calendar=tmp_path / "no-calendar.json", store=tmp_path / "apps.json")
    apps.upsert({"id": "lab-summer", "org": "Invented Lab", "programme": "Summer school", "closes": "2026-12-03"})
    apps.upsert({"id": "no-date", "org": "Invented Works", "programme": "Winter role"})
    clock = [datetime(2026, 11, 27, 8, 0).timestamp()]
    rs = ReminderStore(tmp_path / "reminders.json", clock=lambda: clock[0])
    svc = SimpleNamespace(plan=SimpleNamespace(apps=apps), reminders=rs)
    app = FastAPI()
    R.register(app, svc, Bus())
    dl = app.state.career_deadlines
    dl.path, dl.today = tmp_path / "ww_career" / "deadlines.json", (lambda: TODAY)
    with TestClient(app) as c:
        block_network(monkeypatch)
        yield SimpleNamespace(c=c, rs=rs, svc=svc, apps=apps, dl=dl, clock=clock, tmp=tmp_path, inputs=inputs)


def get(e):
    r = e.c.get(BASE)
    assert r.status_code == 200, r.text
    return envelope(r.json())


def row_of(e, rid):
    return next(x for x in get(e)["items"] if x["id"] == rid)


def put(e, rid, body, code=200):
    r = e.c.put(f"{BASE}/{rid}", json=body)
    assert r.status_code == code, r.text
    return envelope(r.json()) if code == 200 else r.json()


def remind(e, rid, code=200):
    r = e.c.post(f"{BASE}/{rid}/remind")
    assert r.status_code == code, r.text
    return envelope(r.json()) if code == 200 else r.json()


def pending(e):
    return [r for r in e.rs.pending() if r["origin"] == "career"]


# ------------------------------------------------------------------ the route table
def test_every_route_is_in_the_docstring_and_defined():
    import re
    doc = R.__doc__
    for rid in ("K-05", "K-06", "K-07"):
        assert rid in doc
    rows = set(re.findall(r"^\s{2,}(GET|POST|PUT)\s+(/api/\S+)", doc, re.M))
    want = {("GET", BASE), ("PUT", f"{BASE}/settings"), ("PUT", f"{BASE}/{{row_id}}"), ("POST", f"{BASE}/{{row_id}}/remind")}
    assert rows == want
    app = FastAPI()
    R.register(app, SimpleNamespace(), Bus())
    defined = {(m, r.path) for r in app.routes for m in getattr(r, "methods", ()) if r.path.startswith(BASE)}
    assert defined == want


# ------------------------------------------------------------------ K-05
def test_rows_come_from_inputs_and_applications_soonest_first_with_days_left(env):
    j = get(env)
    assert j["state"] == "live" and j["auto_remind"] is False
    ids = [x["id"] for x in j["items"]]
    assert ids == ["app.lab-summer", "in.dl-invented-test-sitting", "in.grant-form", "app.no-date"]
    first = j["items"][0]
    assert first["days_left"] == 6 and first["closes"] == "2026-12-03" and first["kind"] == "application"
    assert first["requires"] == [] and first["next_start_by"] is None and first["stale"] is True
    undated = j["items"][-1]
    assert undated["closes"] is None and undated["days_left"] is None


def test_the_example_inputs_are_never_listed_as_his(env, monkeypatch):
    monkeypatch.setenv("JARVIS_ENGINE_INPUTS", str(env.tmp / "missing.json"))
    j = get(env)
    assert all(x["id"].startswith("app.") for x in j["items"])
    assert any("example" in n for n in j["notes"])


def test_no_rows_is_waiting(env):
    env.inputs.write_text(json.dumps({"deadlines": []}), encoding="utf-8")
    env.apps.remove("lab-summer")
    env.apps.remove("no-date")
    j = get(env)
    assert j["state"] == "waiting" and j["items"] == []


# ------------------------------------------------------------------ start_by arithmetic
def test_start_by_across_a_month_boundary(env):
    j = put(env, "app.lab-summer", {"requires": [{"doc": "Transcript", "lead_days": 5}, {"doc": "Letter", "lead_days": 0}]})
    docs = {d["doc"]: d for d in j["row"]["requires"]}
    assert docs["Transcript"]["start_by"] == "2026-11-28"          # 3 Dec minus 5 days
    assert docs["Letter"]["start_by"] == "2026-12-03"
    assert j["row"]["next_start_by"] == "2026-11-28"


def test_start_by_across_a_year_boundary_and_a_leap_day(env):
    j = put(env, "in.grant-form", {"requires": [{"doc": "Essay", "lead_days": 15}, {"doc": "Form", "lead_days": 365}]})
    docs = {d["doc"]: d for d in j["row"]["requires"]}
    assert docs["Essay"]["start_by"] == "2026-12-26"               # 10 Jan 2027 minus 15 days
    assert docs["Form"]["start_by"] == "2026-01-10" and docs["Form"]["late"] is True
    j = put(env, "in.grant-form", {"closes": "2028-03-01", "requires": [{"doc": "Essay", "lead_days": 1}]})
    assert j["row"]["requires"][0]["start_by"] == "2028-02-29" and j["row"]["closes_typed"] is True


def test_a_typed_closing_date_can_be_given_back(env):
    put(env, "app.lab-summer", {"closes": "2026-12-10"})
    assert row_of(env, "app.lab-summer")["closes"] == "2026-12-10"
    put(env, "app.lab-summer", {"closes": None})
    r = row_of(env, "app.lab-summer")
    assert r["closes"] == "2026-12-03" and r["closes_typed"] is False
    assert json.loads((env.tmp / "apps.json").read_text(encoding="utf-8"))["applications"]["lab-summer"]["closes"] == "2026-12-03"


def test_a_row_without_a_closing_date_says_so(env):
    j = put(env, "app.no-date", {"requires": [{"doc": "Portfolio", "lead_days": 10}]})
    assert j["row"]["requires"][0]["start_by"] is None and "No closing date" in j["reason"]
    r = remind(env, "app.no-date")
    assert r["reminders"][0]["state"] == "no_date" and pending(env) == []


# ------------------------------------------------------------------ K-06 refusals
@pytest.mark.parametrize("body", [
    {"requires": [{"doc": "A", "lead_days": -1}]},
    {"requires": [{"doc": "A", "lead_days": 366}]},
    {"requires": [{"doc": "A", "lead_days": True}]},
    {"requires": [{"doc": "A", "lead_days": 2.5}]},
    {"requires": [{"doc": "A", "lead_days": "5"}]},
    {"requires": [{"doc": "A"}]},
    {"requires": [{"doc": f"D{i}", "lead_days": 1} for i in range(21)]},
    {"requires": [{"doc": "A", "lead_days": 1}, {"doc": "a", "lead_days": 2}]},
    {"requires": [{"doc": "   ", "lead_days": 1}]},
    {"requires": [{"doc": "x" * 121, "lead_days": 1}]},
    {"requires": [{"doc": "A", "lead_days": 1, "ready": "yes"}]},
    {"requires": [{"doc": "A", "lead_days": 1, "start_by": "2026-12-01"}]},
    {"requires": ["A"]},
    {"requires": {"doc": "A", "lead_days": 1}},
    {"closes": "2026-13-01"},
    {"closes": "next friday"},
    {"closes": 20261231},
    {"checked_on": "2026-11-28"},
    {"checked_on": "2026-02-30"},
    {"days_left": 3},
    {},
    [],
])
def test_every_refusal_of_k06_is_400_and_writes_nothing(env, body):
    r = env.c.put(f"{BASE}/app.lab-summer", json=body)
    assert r.status_code == 400, (body, r.text)
    assert not env.dl.path.exists()


def test_twenty_documents_are_allowed(env):
    j = put(env, "app.lab-summer", {"requires": [{"doc": f"Invented doc {i}", "lead_days": i} for i in range(20)]})
    assert len(j["row"]["requires"]) == 20


@pytest.mark.parametrize("rid,code", [
    ("app.unknown", 404), ("in.unknown", 404), ("settingsx", 400), ("lab-summer", 400), ("app.", 400),
    ("app." + "a" * 121, 400), ("in.<script>", 400), ("app.lab summer", 400),
    ("..%2F..%2Fsecrets", 404),          # the router decodes the slashes and no route matches; the handler never runs
    ("app..", 404),                      # well formed, and no application has the id "."
])
def test_hostile_and_unknown_ids(env, rid, code):
    r = env.c.put(f"{BASE}/{rid}", json={"checked_on": "2026-11-01"})
    assert r.status_code == code, (rid, r.text)
    r = env.c.post(f"{BASE}/{rid}/remind")
    assert r.status_code == code, (rid, r.text)
    assert not env.dl.path.exists() and pending(env) == []


# ------------------------------------------------------------------ stale
def test_stale_at_31_days_not_at_30_and_with_no_check(env):
    assert row_of(env, "app.lab-summer")["stale"] is True
    assert "no check on file" in row_of(env, "app.lab-summer")["stale_reason"]
    put(env, "app.lab-summer", {"checked_on": (TODAY - timedelta(days=30)).isoformat()})
    r = row_of(env, "app.lab-summer")
    assert r["stale"] is False and r["stale_reason"] is None and r["checked_on"] == "2026-10-28"
    put(env, "app.lab-summer", {"checked_on": (TODAY - timedelta(days=31)).isoformat()})
    r = row_of(env, "app.lab-summer")
    assert r["stale"] is True and r["stale_reason"] == "date not checked since 2026-10-27"
    put(env, "app.lab-summer", {"checked_on": TODAY.isoformat()})
    assert row_of(env, "app.lab-summer")["stale"] is False


# ------------------------------------------------------------------ K-07
def test_one_reminder_a_document_and_a_second_press_adds_none(env):
    put(env, "in.grant-form", {"requires": [{"doc": "Essay", "lead_days": 15}, {"doc": "Referee note", "lead_days": 20}]})
    assert pending(env) == []                                          # saving alone raises nothing: the switch is off
    j = remind(env, "in.grant-form")
    assert j["raised"] == 2 and j["already"] == 0 and len(pending(env)) == 2
    due = {r["text"].split(" for ")[0]: r["due"] for r in pending(env)}
    assert due["Start Essay"] == datetime(2026, 12, 26, 9, 0).timestamp()
    assert due["Start Referee note"] == datetime(2026, 12, 21, 9, 0).timestamp()
    first = {x["doc"]: x["reminder_id"] for x in j["reminders"]}
    again = remind(env, "in.grant-form")
    assert again["raised"] == 0 and again["already"] == 2 and len(pending(env)) == 2
    assert {x["doc"]: x["reminder_id"] for x in again["reminders"]} == first
    assert {d["doc"]: d["reminder_id"] for d in row_of(env, "in.grant-form")["requires"]} == first


def test_a_past_start_by_is_late_with_no_reminder_and_a_ready_one_gets_none(env):
    put(env, "app.lab-summer", {"requires": [{"doc": "Transcript", "lead_days": 10}, {"doc": "Letter", "lead_days": 2},
                                             {"doc": "Photo", "lead_days": 1, "ready": True}]})
    j = remind(env, "app.lab-summer")
    states = {x["doc"]: x["state"] for x in j["reminders"]}
    assert states == {"Transcript": "late", "Letter": "raised", "Photo": "ready"}
    assert j["late"] == ["Transcript"] and len(pending(env)) == 1 and "late" in j["reason"]
    assert row_of(env, "app.lab-summer")["requires"][0]["late"] is True


def test_a_start_by_of_today_after_nine_is_raised_a_minute_ahead(env):
    env.clock[0] = datetime(2026, 11, 27, 10, 30).timestamp()
    put(env, "app.lab-summer", {"requires": [{"doc": "Letter", "lead_days": 6}]})   # 3 Dec minus 6 = today
    j = remind(env, "app.lab-summer")
    assert j["reminders"][0]["state"] == "raised"
    assert pending(env)[0]["due"] == pytest.approx(env.clock[0] + 60)


def test_a_reminder_he_cancelled_elsewhere_is_raised_again_on_a_press(env):
    put(env, "in.grant-form", {"requires": [{"doc": "Essay", "lead_days": 15}]})
    rid = remind(env, "in.grant-form")["reminders"][0]["reminder_id"]
    env.rs.cancel(rid)
    assert row_of(env, "in.grant-form")["requires"][0]["reminder_id"] is None
    j = remind(env, "in.grant-form")
    assert j["raised"] == 1 and len(pending(env)) == 1 and pending(env)[0]["id"] != rid


def test_removing_a_document_cancels_its_reminder_and_the_answer_says_so(env):
    put(env, "in.grant-form", {"requires": [{"doc": "Essay", "lead_days": 15}, {"doc": "Form", "lead_days": 5}]})
    ids = {x["doc"]: x["reminder_id"] for x in remind(env, "in.grant-form")["reminders"]}
    j = put(env, "in.grant-form", {"requires": [{"doc": "Essay", "lead_days": 15}]})
    assert j["cancelled"] == [{"doc": "form", "reminder_id": ids["Form"], "why": "removed", "cancelled": True}]
    assert "cancelled" in j["reason"]
    assert env.rs.get(ids["Form"])["status"] == "cancelled" and env.rs.get(ids["Essay"])["status"] == "pending"
    assert [r["id"] for r in pending(env)] == [ids["Essay"]]


def test_moving_closes_cancels_the_old_reminders_and_the_next_press_raises_at_the_new_date(env):
    put(env, "in.grant-form", {"requires": [{"doc": "Essay", "lead_days": 15}]})
    old = remind(env, "in.grant-form")["reminders"][0]["reminder_id"]
    j = put(env, "in.grant-form", {"closes": "2027-01-20"})
    assert j["cancelled"][0]["reminder_id"] == old and j["cancelled"][0]["why"] == "start_by moved"
    assert pending(env) == [] and j["row"]["requires"][0]["reminder_id"] is None
    new = remind(env, "in.grant-form")
    assert new["raised"] == 1 and pending(env)[0]["due"] == datetime(2027, 1, 5, 9, 0).timestamp()


def test_changing_a_lead_or_marking_ready_cancels_and_keeping_it_does_not(env):
    put(env, "in.grant-form", {"requires": [{"doc": "Essay", "lead_days": 15}, {"doc": "Form", "lead_days": 5}]})
    remind(env, "in.grant-form")
    j = put(env, "in.grant-form", {"requires": [{"doc": "Essay", "lead_days": 15}, {"doc": "Form", "lead_days": 5}],
                                   "checked_on": "2026-11-20"})
    assert j["cancelled"] == [] and len(pending(env)) == 2
    j = put(env, "in.grant-form", {"requires": [{"doc": "Essay", "lead_days": 16}, {"doc": "Form", "lead_days": 5, "ready": True}]})
    assert sorted(x["why"] for x in j["cancelled"]) == ["ready", "start_by moved"] and pending(env) == []
    j = put(env, "in.grant-form", {"requires": [{"doc": "Essay", "lead_days": 16}, {"doc": "Form", "lead_days": 5}]})
    assert {d["doc"]: d["ready"] for d in j["row"]["requires"]} == {"Essay": False, "Form": True}   # ready kept when not sent


def test_without_the_reminder_service_nothing_is_raised(env):
    put(env, "in.grant-form", {"requires": [{"doc": "Essay", "lead_days": 15}]})
    env.svc.reminders = None
    j = remind(env, "in.grant-form")
    assert j["state"] == "fault" and j["reminders"] == []
    env.svc.reminders = env.rs
    assert pending(env) == []


def test_a_row_with_no_documents_is_waiting_on_a_press(env):
    j = remind(env, "app.lab-summer")
    assert j["state"] == "waiting" and pending(env) == []


# ------------------------------------------------------------------ the switch
def test_auto_remind_is_off_by_default_and_raises_on_save_when_on(env):
    assert get(env)["auto_remind"] is False
    put(env, "in.grant-form", {"requires": [{"doc": "Essay", "lead_days": 15}]})
    assert pending(env) == []
    r = env.c.put(f"{BASE}/settings", json={"auto_remind": True})
    assert r.status_code == 200 and envelope(r.json())["settings"] == {"auto_remind": True}
    assert pending(env) == []                                          # switching on raises nothing by itself
    j = put(env, "in.grant-form", {"checked_on": "2026-11-26"})
    assert pending(env) == []                                          # only saving documents raises
    j = put(env, "in.grant-form", {"requires": [{"doc": "Essay", "lead_days": 15}, {"doc": "Form", "lead_days": 5}]})
    assert len(pending(env)) == 2 and "raised" in j["reason"]
    put(env, "in.grant-form", {"requires": [{"doc": "Essay", "lead_days": 15}, {"doc": "Form", "lead_days": 5}]})
    assert len(pending(env)) == 2                                      # a second save is a second press: none new
    r = env.c.put(f"{BASE}/settings", json={"auto_remind": False})
    assert envelope(r.json())["state"] == "planned" and get(env)["auto_remind"] is False


@pytest.mark.parametrize("body", [{"auto_remind": "yes"}, {"auto_remind": 1}, {}, {"auto_remind": True, "x": 1}, []])
def test_the_switch_refuses_anything_but_a_bool(env, body):
    assert env.c.put(f"{BASE}/settings", json=body).status_code == 400


# ------------------------------------------------------------------ rows that go away
def test_a_row_that_leaves_his_applications_keeps_its_documents_as_an_orphan(env):
    put(env, "app.lab-summer", {"requires": [{"doc": "Letter", "lead_days": 2}]})
    rid = remind(env, "app.lab-summer")["reminders"][0]["reminder_id"]
    env.apps.remove("lab-summer")
    j = get(env)
    assert "app.lab-summer" not in [x["id"] for x in j["items"]]
    assert j["orphans"] == [{"id": "app.lab-summer", "documents": ["Letter"], "pending_reminders": [rid],
                             "reason": j["orphans"][0]["reason"]}]
    assert put(env, "app.lab-summer", {"checked_on": "2026-11-01"}, code=404)
    assert remind(env, "app.lab-summer", code=404)
    env.apps.upsert({"id": "lab-summer", "org": "Invented Lab", "programme": "Summer school", "closes": "2026-12-03"})
    back = row_of(env, "app.lab-summer")
    assert back["requires"][0]["doc"] == "Letter" and back["requires"][0]["reminder_id"] == rid


def test_a_deadline_that_leaves_his_inputs_is_an_orphan(env):
    put(env, "in.grant-form", {"requires": [{"doc": "Essay", "lead_days": 15}]})
    env.inputs.write_text(json.dumps({"deadlines": []}), encoding="utf-8")
    j = get(env)
    assert [o["id"] for o in j["orphans"]] == ["in.grant-form"] and all(x["id"].startswith("app.") for x in j["items"])


# ------------------------------------------------------------------ his file
def test_the_file_is_his_own_with_a_schema_and_the_sources_are_untouched(env):
    before_apps = (env.tmp / "apps.json").read_text(encoding="utf-8")
    before_inputs = env.inputs.read_text(encoding="utf-8")
    put(env, "app.lab-summer", {"requires": [{"doc": "Letter", "lead_days": 2}], "checked_on": "2026-11-20"})
    remind(env, "app.lab-summer")
    st = json.loads(env.dl.path.read_text(encoding="utf-8"))
    assert st["schema"] == D.SCHEMA and st["settings"] == {"auto_remind": False}
    assert set(st["rows"]) == {"app.lab-summer"} and "start_by" not in st["rows"]["app.lab-summer"]["requires"][0]
    assert not list(env.dl.path.parent.glob("*.tmp"))
    assert (env.tmp / "apps.json").read_text(encoding="utf-8") == before_apps
    assert env.inputs.read_text(encoding="utf-8") == before_inputs


@pytest.mark.parametrize("text", ["{not json", json.dumps([1, 2]), json.dumps({"schema": 99, "rows": {}}),
                                  json.dumps({"schema": 1, "rows": {"app.lab-summer": {"requires": [{"doc": "A", "lead_days": "x"}]}}}),
                                  json.dumps({"schema": 1, "rows": {"app.lab-summer": {"closes": "soon"}}})])
def test_a_corrupt_file_is_a_fault_and_is_never_overwritten(env, text):
    env.dl.path.parent.mkdir(parents=True, exist_ok=True)
    env.dl.path.write_text(text, encoding="utf-8")
    j = get(env)
    assert j["state"] == "fault" and len(j["items"]) == 4               # the rows still show, without what he typed
    assert env.c.put(f"{BASE}/app.lab-summer", json={"checked_on": "2026-11-01"}).status_code == 409
    assert env.c.post(f"{BASE}/app.lab-summer/remind").status_code == 409
    assert env.c.put(f"{BASE}/settings", json={"auto_remind": True}).status_code == 409
    assert env.dl.path.read_text(encoding="utf-8") == text and pending(env) == []


# ------------------------------------------------------------------ review of 27 Nov: dates that move, and the switch
def test_days_left_on_the_day_around_it_and_across_a_year_end(env):
    put(env, "app.lab-summer", {"closes": "2027-01-01"})
    for today, left in ((date(2027, 1, 1), 0), (date(2026, 12, 31), 1), (date(2027, 1, 2), -1), (date(2025, 12, 31), 366)):
        env.dl.today = lambda t=today: t
        r = row_of(env, "app.lab-summer")
        assert r["days_left"] == left, (today, r)
    env.dl.today = lambda: date(2027, 1, 2)
    j = get(env)
    assert j["today"] == "2027-01-02"                                    # open rows first, then closed (latest first)
    assert [x["id"] for x in j["items"]] == ["in.grant-form", "app.lab-summer", "in.dl-invented-test-sitting", "app.no-date"]


def test_a_start_by_of_today_before_and_at_nine(env):
    put(env, "app.lab-summer", {"requires": [{"doc": "Letter", "lead_days": 6}]})   # 3 Dec minus 6 = today
    env.clock[0] = datetime(2026, 11, 27, 9, 0).timestamp()
    remind(env, "app.lab-summer")
    assert pending(env)[0]["due"] == datetime(2026, 11, 27, 9, 1).timestamp()         # 9:00 itself: a minute on
    env.clock[0] = datetime(2026, 11, 27, 9, 1).timestamp()
    assert remind(env, "app.lab-summer")["already"] == 1 and len(pending(env)) == 1    # a press a minute later adds none


def test_moving_an_inputs_deadline_typed_without_an_id_keeps_its_row(env):
    # the inputs give such a deadline the id dl-<title>-<date>; a moved exam date must not leave his documents and
    # reminders behind on a row that no longer exists, firing for the old day
    put(env, "in.dl-invented-test-sitting", {"requires": [{"doc": "Admit card", "lead_days": 3}]})
    old = remind(env, "in.dl-invented-test-sitting")["reminders"][0]["reminder_id"]
    env.inputs.write_text(json.dumps({"deadlines": [
        {"id": "grant-form", "title": "Invented grant form", "date": "2027-01-10", "kind": "scholarship"},
        {"title": "Invented test sitting", "date": "2026-12-24", "kind": "exam"},
    ]}), encoding="utf-8")
    j = get(env)
    assert j["orphans"] == []
    r = next(x for x in j["items"] if x["id"] == "in.dl-invented-test-sitting")
    assert r["closes"] == "2026-12-24" and r["requires"][0]["start_by"] == "2026-12-21" and r["requires"][0]["reminder_id"] is None
    assert any("moved" in n for n in j["notes"])                       # the old reminder is still pending and GET says so
    again = remind(env, "in.dl-invented-test-sitting")
    assert again["raised"] == 1 and again["cancelled"][0]["reminder_id"] == old
    assert [p["due"] for p in pending(env)] == [datetime(2026, 12, 21, 9, 0).timestamp()]


def test_two_deadlines_with_one_title_keep_their_dated_ids(env):
    env.inputs.write_text(json.dumps({"deadlines": [{"title": "Invented mock", "date": "2026-12-05"},
                                                    {"title": "Invented mock", "date": "2026-12-12"}]}), encoding="utf-8")
    ids = [x["id"] for x in get(env)["items"] if x["id"].startswith("in.")]
    assert ids == ["in.dl-invented-mock-2026-12-05", "in.dl-invented-mock-2026-12-12"]


def test_a_closing_date_moved_in_his_applications_replaces_the_reminder_on_the_next_press(env):
    put(env, "app.lab-summer", {"requires": [{"doc": "Letter", "lead_days": 2}]})
    old = remind(env, "app.lab-summer")["reminders"][0]["reminder_id"]
    env.apps.upsert({"id": "lab-summer", "org": "Invented Lab", "programme": "Summer school", "closes": "2026-12-08"})
    j = remind(env, "app.lab-summer")
    assert j["raised"] == 1 and [c["reminder_id"] for c in j["cancelled"]] == [old]
    assert env.rs.get(old)["status"] == "cancelled" and len(pending(env)) == 1          # never two for one document
    assert pending(env)[0]["due"] == datetime(2026, 12, 6, 9, 0).timestamp()


def test_with_the_switch_on_a_moved_closing_date_raises_the_new_reminders(env):
    env.c.put(f"{BASE}/settings", json={"auto_remind": True})
    put(env, "in.grant-form", {"requires": [{"doc": "Essay", "lead_days": 15}]})
    j = put(env, "in.grant-form", {"closes": "2027-01-20"})
    assert j["cancelled"][0]["why"] == "start_by moved"
    assert [p["due"] for p in pending(env)] == [datetime(2027, 1, 5, 9, 0).timestamp()]


def test_with_the_switch_on_a_reminder_he_cancelled_is_not_raised_again_by_a_save(env):
    env.c.put(f"{BASE}/settings", json={"auto_remind": True})
    j = put(env, "in.grant-form", {"requires": [{"doc": "Essay", "lead_days": 15}, {"doc": "Form", "lead_days": 5}]})
    rid = next(x["reminder_id"] for x in j["reminders"] if x["doc"] == "Essay")
    env.rs.cancel(rid)                                                  # by hand, through the reminder routes
    put(env, "in.grant-form", {"requires": [{"doc": "Essay", "lead_days": 15}, {"doc": "Form", "lead_days": 5, "ready": True}]})
    assert pending(env) == []                                           # Form ready: cancelled; Essay: he cancelled it
    assert remind(env, "in.grant-form")["raised"] == 1                  # his own press still raises it


def test_switching_off_keeps_the_reminders_already_raised(env):
    env.c.put(f"{BASE}/settings", json={"auto_remind": True})
    put(env, "in.grant-form", {"requires": [{"doc": "Essay", "lead_days": 15}]})
    r = envelope(env.c.put(f"{BASE}/settings", json={"auto_remind": False}).json())
    assert len(pending(env)) == 1 and "stay" in r["reason"]


def test_an_orphan_says_its_reminders_still_go_off(env):
    put(env, "app.lab-summer", {"requires": [{"doc": "Letter", "lead_days": 2}]})
    remind(env, "app.lab-summer")
    env.apps.remove("lab-summer")
    o = get(env)["orphans"][0]
    assert len(o["pending_reminders"]) == 1 and "still goes off" in o["reason"]


def test_an_id_with_a_trailing_newline_is_refused(env):
    assert env.c.put(f"{BASE}/app.lab-summer%0A", json={"checked_on": "2026-11-01"}).status_code == 400


def test_two_presses_at_once_raise_one_reminder_a_document(env):
    import threading
    put(env, "in.grant-form", {"requires": [{"doc": "Essay", "lead_days": 15}, {"doc": "Form", "lead_days": 5}]})
    out = []
    ts = [threading.Thread(target=lambda: out.append(env.dl.remind("in.grant-form", env.rs))) for _ in range(4)]
    for t in ts:
        t.start()
    for t in ts:
        t.join()
    assert sum(o["raised"] for o in out) == 2 and len(pending(env)) == 2
