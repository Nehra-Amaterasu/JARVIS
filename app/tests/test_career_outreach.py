"""Follow-ups and outreach (EW10 KC, K-08 to K-10): ww_career_outreach.py, routes_ww_career_outreach.py and the one edit
to germoney.py (an application's history survives its views). Every application, note and message here is invented;
each test has its own applications file and outreach file under tmp_path and an injected clock.

Nothing in this package may connect anywhere: for the whole module socket.socket, socket.create_connection,
webbrowser.open, os.startfile, subprocess.Popen and smtplib.SMTP raise. The test client's event loop makes its own
self-pipe when it starts (a socket pair on Windows), so the block goes on just after the client is up."""
from __future__ import annotations

import contextlib
import json
import os
import smtplib
import socket
import subprocess
import webbrowser
from datetime import date

import pytest
from starlette.testclient import TestClient

from jarvis_app import germoney as g
from jarvis_app import ww_career_outreach as K
from jarvis_app.security import Guard
from jarvis_app.server import create_app
from jarvis_app.ww_pyq import schema

TOKEN = "t" * 32
F = "/api/mission/career/followups"
O = "/api/mission/career/outreach"
TODAY = date(2026, 11, 27)

# The row keys of GET /api/mission/applications before EW10, read from germoney.py at 9cf4015:
# clean_application's 15 keys plus the 5 that view() adds. The edit may add "history" and nothing else.
OLD_ROW_KEYS = {"id", "org", "programme", "url", "opens", "closes", "status", "requirements", "linked_nodes",
                "prep_contracts", "stipend", "notes", "reason", "verified", "source",
                "days_left", "opens_in", "open_now", "prep", "nodes"}


class NetworkUsed(AssertionError):
    pass


def _refuse(*a, **k):
    raise NetworkUsed("this package must not open a connection, a browser or a program")


@contextlib.contextmanager
def no_network():
    with pytest.MonkeyPatch.context() as mp:
        # Outgoing connections are refused, not socket creation itself: the test client and the thread pool make their own
        # socket pairs on Windows whenever a loop starts, and refusing those hung the whole file (found 28 Nov).
        mp.setattr(socket.socket, "connect", _refuse)
        mp.setattr(socket.socket, "connect_ex", _refuse)
        mp.setattr(socket, "getaddrinfo", _refuse)
        mp.setattr(socket, "create_connection", _refuse)
        mp.setattr(webbrowser, "open", _refuse)
        mp.setattr(os, "startfile", _refuse, raising=False)
        mp.setattr(subprocess, "Popen", _refuse)
        mp.setattr(smtplib, "SMTP", _refuse)
        yield


@pytest.fixture(autouse=True)
def _block(request):
    if "env" in request.fixturenames:      # the client fixture puts the block on after its loop is up
        yield
        return
    with no_network():
        yield


class FakePlan:
    def __init__(self, apps):
        self.apps = apps


def write_apps(path, apps: dict):
    path.write_text(json.dumps({"applications": apps}), encoding="utf-8")


def hist(*pairs):
    return [{"status": s, "at": d, "note": ""} for s, d in pairs]


@pytest.fixture()
def env(tmp_path, monkeypatch):
    apps = g.Applications(calendar=tmp_path / "calendar.json", store=tmp_path / "applications.json")
    store = K.OutreachStore(tmp_path / "career" / "outreach.json")
    clock = {"today": TODAY}
    monkeypatch.setattr(K, "default_store", lambda: store)
    monkeypatch.setattr(K, "_today", lambda: clock["today"])
    app = create_app(Guard(8777, TOKEN, extra_hosts=["testserver"]), autostart_aankhen="off",
                     features=["ww_career_outreach"])
    with TestClient(app) as c:
        c.headers.update({"X-Jarvis-Token": TOKEN})
        app.state.svc.plan = FakePlan(apps)
        with no_network():
            yield c, apps, store, clock, tmp_path


def envelope(j):
    assert j["state"] in schema.STATES and isinstance(j["reason"], str) and j["reason"] and j["source"]
    return j


def ok(r):
    assert r.status_code == 200, r.text
    return envelope(r.json())


def draft(c, application="widget-lab", **kw):
    body = {"application": application, "to_note": "the lab's intake desk", "subject": "Following up",
            "body": "A short note about my application.", **kw}
    return ok(c.post(O, json=body))["row"]


# ------------------------------------------------------------------ germoney: history survives the views
def test_history_survives_all_and_view_and_old_files_without_history_load(tmp_path):
    write_apps(tmp_path / "applications.json", {
        "widget-lab": {"org": "Widget Lab", "programme": "Summer research", "status": "applied",
                       "history": hist(("preparing", "2026-10-01"), ("applied", "2026-10-05"))},
        "old-gizmo": {"org": "Gizmo Works", "status": "applied"},                       # a file older than history
        "bad-hist": {"org": "Sprocket Co", "status": "idea", "history": "not a list"},
    })
    apps = g.Applications(calendar=tmp_path / "none.json", store=tmp_path / "applications.json")
    by = {a["id"]: a for a in apps.all()}
    assert [h["at"] for h in by["widget-lab"]["history"]] == ["2026-10-01", "2026-10-05"]
    assert by["old-gizmo"]["history"] == [] and by["bad-hist"]["history"] == []
    rows = {r["id"]: r for r in apps.view("2026-11-27")["applications"]}
    for r in rows.values():
        assert set(r) == OLD_ROW_KEYS | {"history"}          # one field added, none lost
    assert rows["widget-lab"]["history"][1] == {"status": "applied", "at": "2026-10-05", "note": ""}


def test_set_status_history_reaches_the_view_and_put_keeps_its_answer(tmp_path):
    apps = g.Applications(calendar=tmp_path / "none.json", store=tmp_path / "applications.json")
    put = apps.upsert({"id": "widget-lab", "org": "Widget Lab", "status": "preparing"})
    assert "history" not in put                                  # the PUT answer keeps its old shape
    apps.set_status("widget-lab", "applied", "sent the form")
    row = apps.view()["applications"][0]
    assert row["history"] == [{"status": "applied", "at": date.today().isoformat(), "note": "sent the form"}]
    apps.upsert({"id": "widget-lab", "org": "Widget Lab", "notes": "x", "history": []})   # PUT cannot wipe it
    assert len(apps.view()["applications"][0]["history"]) == 1


def test_a_hand_edited_history_entry_with_a_bad_date_or_status_is_left_out(tmp_path):
    write_apps(tmp_path / "applications.json", {"w": {"org": "Widget Lab", "status": "applied", "history": [
        {"status": "applied", "at": "2026-02-30"}, {"status": "bribed", "at": "2026-10-01"}, 7,
        {"status": "applied", "at": "2026-10-09", "note": "n" * 900}]}})
    a = g.Applications(calendar=tmp_path / "none.json", store=tmp_path / "applications.json").all()[0]
    assert a["history"] == [{"status": "applied", "at": "2026-10-09", "note": "n" * 200}]


def test_calendar_rows_carry_an_empty_history(tmp_path):
    (tmp_path / "cal.json").write_text(json.dumps([{"id": "r1", "org": "Research Desk"}]), encoding="utf-8")
    a = g.Applications(calendar=tmp_path / "cal.json", store=tmp_path / "applications.json").all()[0]
    assert a["history"] == [] and a["source"] == "research"


# ------------------------------------------------------------------ K-08
def test_k08_follow_up_across_a_month_boundary(env):
    c, apps, store, clock, tmp = env
    write_apps(tmp / "applications.json", {"widget-lab": {"org": "Widget Lab", "status": "applied",
                                                          "history": hist(("applied", "2026-10-20"))}})
    j = ok(c.get(F))
    assert j["state"] == "live" and j["count"] == 1 and j["undated"] == []
    it = j["items"][0]
    assert it["applied_at"] == "2026-10-20" and it["follow_up_days"] == 14 and it["follow_up_on"] == "2026-11-03"
    assert it["days_since"] == 38 and it["due"] is True and it["last_outreach"] is None
    assert it["counts_from"] == "applied"


def test_k08_follow_up_across_a_year_boundary_and_days_since_from_the_clock(env):
    c, apps, store, clock, tmp = env
    write_apps(tmp / "applications.json", {"g": {"org": "Gizmo Works", "status": "applied",
                                                 "history": hist(("applied", "2026-12-25"))}})
    clock["today"] = date(2026, 12, 31)
    it = ok(c.get(F))["items"][0]
    assert it["follow_up_on"] == "2027-01-08" and it["days_since"] == 6 and it["due"] is False
    clock["today"] = date(2027, 1, 8)
    it = ok(c.get(F))["items"][0]
    assert it["days_since"] == 14 and it["due"] is True


def test_k08_uses_the_first_applied_day_when_he_applied_twice(env):
    c, apps, store, clock, tmp = env
    write_apps(tmp / "applications.json", {"w": {"org": "Widget Lab", "status": "applied",
                                                 "history": hist(("applied", "2026-11-10"), ("idea", "2026-11-11"),
                                                                 ("applied", "2026-11-15"))}})
    assert ok(c.get(F))["items"][0]["applied_at"] == "2026-11-10"


def test_k08_an_edited_follow_up_days_moves_the_date(env):
    c, apps, store, clock, tmp = env
    write_apps(tmp / "applications.json", {"widget-lab": {"org": "Widget Lab", "status": "applied",
                                                          "history": hist(("applied", "2026-11-20"))}})
    assert ok(c.get(F))["items"][0]["follow_up_on"] == "2026-12-04"
    row = draft(c, follow_up_days=30)
    it = ok(c.get(F))["items"][0]
    assert it["follow_up_on"] == "2026-12-20" and it["follow_up_days"] == 30 and it["follow_up_days_typed"] is True
    ok(c.patch(f"{O}/{row['id']}", json={"follow_up_days": 3}))
    it = ok(c.get(F))["items"][0]
    assert it["follow_up_on"] == "2026-11-23" and it["due"] is True


def test_k08_undated_applications_are_listed_with_the_sentence_and_no_date(env):
    c, apps, store, clock, tmp = env
    write_apps(tmp / "applications.json", {
        "old-gizmo": {"org": "Gizmo Works", "status": "applied"},
        "just-an-idea": {"org": "Sprocket Co", "status": "idea"},
    })
    j = ok(c.get(F))
    assert j["state"] == "waiting" and j["items"] == []
    assert j["undated"] == [{"application": "old-gizmo", "title": "Gizmo Works", "status": "applied", "reason": K.UNDATED}]
    assert "applied_at" not in j["undated"][0] and "follow_up_on" not in j["undated"][0]


def test_k08_waiting_with_no_applications_and_a_closed_one_is_never_due(env):
    c, apps, store, clock, tmp = env
    j = ok(c.get(F))
    assert j["state"] == "waiting" and j["items"] == [] and j["undated"] == []
    write_apps(tmp / "applications.json", {"w": {"org": "Widget Lab", "status": "rejected",
                                                 "history": hist(("applied", "2026-09-01"), ("rejected", "2026-10-01"))}})
    it = ok(c.get(F))["items"][0]
    assert it["due"] is False and it["status"] == "rejected"


def test_k08_is_503_while_the_plan_is_not_up(env):
    c, apps, store, clock, tmp = env
    c.app.state.svc.plan = None
    r = c.get(F)
    assert r.status_code == 503


# ------------------------------------------------------------------ K-09
def test_k09_a_draft_is_stored_listed_and_edited(env):
    c, apps, store, clock, tmp = env
    write_apps(tmp / "applications.json", {"widget-lab": {"org": "Widget Lab", "status": "applied"}})
    row = draft(c)
    assert row["state"] == "draft" and row["made"] == "2026-11-27" and row["application"] == "widget-lab"
    assert row["to_note"] == "the lab's intake desk" and row["application_exists"] is True
    lst = ok(c.get(O, params={"application": "widget-lab"}))
    assert lst["state"] == "live" and [r["id"] for r in lst["items"]] == [row["id"]]
    assert ok(c.get(O, params={"application": "someone-else"}))["state"] == "waiting"
    out = ok(c.patch(f"{O}/{row['id']}", json={"subject": "A second try", "to_note": ""}))["row"]
    assert out["subject"] == "A second try" and out["to_note"] == "" and out["body"] == row["body"]
    on_file = json.loads((tmp / "career" / "outreach.json").read_text(encoding="utf-8"))
    assert on_file["version"] == 1 and on_file["rows"][0]["subject"] == "A second try"


def test_k09_list_waiting_when_empty(env):
    c, *_ = env
    j = ok(c.get(O))
    assert j["state"] == "waiting" and j["reason"] == "No drafts yet."


@pytest.mark.parametrize("body, word", [
    ({"subject": "s" * 201}, "200"),
    ({"body": "b" * 20_001}, "20,000"),
    ({"to_note": "n" * 501}, "500"),
    ({"subject": "", "body": "  "}, "subject or a message"),
    ({"subject": 5}, "text"),
    ({"follow_up_days": 0}, "1 to 120"),
    ({"follow_up_days": 121}, "1 to 120"),
    ({"follow_up_days": True}, "1 to 120"),
    ({"follow_up_days": "14"}, "1 to 120"),
    ({"application": ""}, "which application"),
    ({"application": 7}, "which application"),
    ({"application": "x" * 81}, "80"),
])
def test_k09_refusals_and_caps_are_400_with_a_sentence(env, body, word):
    c, apps, store, clock, tmp = env
    write_apps(tmp / "applications.json", {"widget-lab": {"org": "Widget Lab", "status": "applied"}})
    full = {"application": "widget-lab", "to_note": "", "subject": "Hello", "body": "Text", **body}
    r = c.post(O, json=full)
    assert r.status_code == 400 and word in r.json()["detail"], r.text
    assert store.rows() == []


def test_k09_the_caps_themselves_are_accepted(env):
    c, apps, store, clock, tmp = env
    write_apps(tmp / "applications.json", {"widget-lab": {"org": "Widget Lab", "status": "applied"}})
    row = draft(c, subject="s" * 200, body="b" * 20_000, to_note="n" * 500, follow_up_days=120)
    assert len(row["subject"]) == 200 and len(row["body"]) == 20_000 and len(row["to_note"]) == 500


@pytest.mark.parametrize("body", [None, [], "text", 5])
def test_k09_a_body_that_is_not_an_object_is_400(env, body):
    c, *_ = env
    assert c.post(O, json=body).status_code == 400


def test_k09_an_unknown_application_is_404(env):
    c, apps, store, clock, tmp = env
    r = c.post(O, json={"application": "no-such", "subject": "Hello", "body": "x"})
    assert r.status_code == 404 and store.rows() == []


def test_k09_patch_refusals(env):
    c, apps, store, clock, tmp = env
    write_apps(tmp / "applications.json", {"widget-lab": {"org": "Widget Lab", "status": "applied"}})
    row = draft(c)
    for body, code in [({}, 400), ({"application": "other"}, 400), ({"state": "sent"}, 400),
                       ({"subject": "s" * 201}, 400), ({"body": "b" * 20_001}, 400), ({"to_note": "n" * 501}, 400),
                       ({"subject": "", "body": ""}, 400), ({"follow_up_days": 500}, 400), ([], 400)]:
        r = c.patch(f"{O}/{row['id']}", json=body)
        assert r.status_code == code, (body, r.text)
    assert store.get(row["id"])["subject"] == "Following up"


@pytest.mark.parametrize("rid", ["..%2F..%2Fsecrets", "o-XYZ", "o-123", "o-0123456789ab0", "%00", "o-0123456789aB"])
def test_hostile_ids_are_404_on_every_id_route(env, rid):
    c, *_ = env
    assert c.patch(f"{O}/{rid}", json={"subject": "x"}).status_code == 404
    assert c.post(f"{O}/{rid}/sent", json={}).status_code == 404


def test_a_well_formed_id_that_is_not_on_file_is_404(env):
    c, *_ = env
    assert c.patch(f"{O}/o-0123456789ab", json={"subject": "x"}).status_code == 404
    assert c.post(f"{O}/o-0123456789ab/sent", json={}).status_code == 404


def test_a_hostile_application_filter_matches_nothing(env):
    c, apps, store, clock, tmp = env
    write_apps(tmp / "applications.json", {"widget-lab": {"org": "Widget Lab", "status": "applied"}})
    draft(c)
    for q in ["../../x", "widget-lab' OR 1=1", "w" * 5000]:
        assert ok(c.get(O, params={"application": q}))["items"] == []


# ------------------------------------------------------------------ K-10
def test_k10_marks_sent_the_follow_up_counts_from_it_and_twice_is_409(env):
    c, apps, store, clock, tmp = env
    write_apps(tmp / "applications.json", {"widget-lab": {"org": "Widget Lab", "status": "applied",
                                                          "history": hist(("applied", "2026-11-01"))}})
    row = draft(c)
    assert ok(c.get(F))["items"][0]["follow_up_on"] == "2026-11-15"
    out = ok(c.post(f"{O}/{row['id']}/sent", json={"sent_on": "2026-11-20"}))
    assert out["row"]["state"] == "sent" and out["row"]["sent_on"] == "2026-11-20"
    it = ok(c.get(F))["items"][0]
    assert it["counts_from"] == "sent" and it["from_date"] == "2026-11-20" and it["follow_up_on"] == "2026-12-04"
    assert it["days_since"] == 7 and it["due"] is False and it["applied_at"] == "2026-11-01"
    assert it["last_outreach"] == {"id": row["id"], "subject": "Following up", "state": "sent",
                                   "made": "2026-11-27", "sent_on": "2026-11-20"}
    again = c.post(f"{O}/{row['id']}/sent", json={})
    assert again.status_code == 409 and "2026-11-20" in again.json()["detail"]
    assert store.get(row["id"])["sent_on"] == "2026-11-20"


def test_k10_without_a_date_is_today_and_a_sent_row_keeps_its_text(env):
    c, apps, store, clock, tmp = env
    write_apps(tmp / "applications.json", {"widget-lab": {"org": "Widget Lab", "status": "applied",
                                                          "history": hist(("applied", "2026-11-01"))}})
    row = draft(c)
    assert ok(c.post(f"{O}/{row['id']}/sent"))["row"]["sent_on"] == "2026-11-27"
    r = c.patch(f"{O}/{row['id']}", json={"subject": "edited after sending"})
    assert r.status_code == 409
    assert ok(c.patch(f"{O}/{row['id']}", json={"follow_up_days": 7}))["row"]["subject"] == "Following up"
    assert ok(c.get(F))["items"][0]["follow_up_on"] == "2026-12-04"


@pytest.mark.parametrize("sent_on", ["2026-11-28", "27/11/2026", "2026-02-30", 20261127, "yesterday"])
def test_k10_a_future_or_malformed_date_is_400(env, sent_on):
    c, apps, store, clock, tmp = env
    write_apps(tmp / "applications.json", {"widget-lab": {"org": "Widget Lab", "status": "applied"}})
    row = draft(c)
    r = c.post(f"{O}/{row['id']}/sent", json={"sent_on": sent_on})
    assert r.status_code == 400 and store.get(row["id"])["state"] == "draft"


def test_an_outreach_row_survives_its_application_being_deleted(env):
    c, apps, store, clock, tmp = env
    write_apps(tmp / "applications.json", {"widget-lab": {"org": "Widget Lab", "status": "applied",
                                                          "history": hist(("applied", "2026-11-01"))}})
    row = draft(c)
    apps.remove("widget-lab")
    lst = ok(c.get(O))
    assert lst["items"][0]["id"] == row["id"] and lst["items"][0]["application_exists"] is False
    assert "deleted" in lst["items"][0]["application_title"]
    assert ok(c.get(F))["items"] == []                          # nothing left to follow up
    assert ok(c.post(f"{O}/{row['id']}/sent", json={}))["row"]["state"] == "sent"
    assert c.post(O, json={"application": "widget-lab", "subject": "x", "body": "y"}).status_code == 404


# ------------------------------------------------------------------ the store file
def test_a_corrupt_store_file_is_set_aside_and_said(env):
    c, apps, store, clock, tmp = env
    p = tmp / "career" / "outreach.json"
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text("{ not json", encoding="utf-8")
    write_apps(tmp / "applications.json", {"widget-lab": {"org": "Widget Lab", "status": "applied",
                                                          "history": hist(("applied", "2026-11-01"))}})
    j = ok(c.get(F))
    assert j["state"] == "fault" and "could not be parsed" in j["reason"] and j["problems"]
    assert j["items"][0]["follow_up_days"] == 14                 # the clock still runs, on the default gap
    aside = [x.name for x in p.parent.iterdir() if x.name.endswith(".corrupt")]
    assert len(aside) == 1 and (p.parent / aside[0]).read_text(encoding="utf-8") == "{ not json"
    assert ok(c.get(O))["state"] == "fault"
    draft(c)                                                      # a new file is written; the old one stays aside
    assert len(store.rows()) == 1 and (p.parent / aside[0]).exists()


def test_rows_and_gaps_edited_badly_by_hand_are_dropped_on_load(tmp_path):
    p = tmp_path / "outreach.json"
    good = {"id": "o-0123456789ab", "application": "w", "to_note": "", "subject": "s", "body": "b",
            "state": "draft", "made": "2026-11-27", "updated": "", "sent_on": None}
    p.write_text(json.dumps({"version": 1, "future_key": [1], "rows": [good, {"id": "../x", "state": "draft"},
                 {**good, "id": "o-0123456789ac", "state": "posted"}, 5],
                 "follow_up_days": {"w": 500, "v": 10, "u": True}}), encoding="utf-8")
    st = K.OutreachStore(p)
    assert [r["id"] for r in st.rows()] == ["o-0123456789ab"] and st.days_for() == {"v": 10}
    st.set_days("w", 20)
    assert json.loads(p.read_text(encoding="utf-8"))["future_key"] == [1]        # a later wave's field survives


def test_a_corrupt_file_that_cannot_be_moved_aside_is_never_written_over(tmp_path, monkeypatch):
    # review 27 Nov: when the move aside failed (a reader holding the file on Windows), the next save wrote an empty
    # store over the only copy, and the problem sentence still said it was kept beside it
    p = tmp_path / "outreach.json"
    p.write_text("{ not json", encoding="utf-8")
    real = os.replace

    def held(src, dst):
        if str(dst).endswith(".corrupt"):
            raise PermissionError("held by another reader")
        return real(src, dst)

    monkeypatch.setattr(K.os, "replace", held)
    st = K.OutreachStore(p)
    assert st.rows() == [] and "could not be moved aside" in st.problems[-1]
    with pytest.raises(K.Conflict):
        st.add("w", "", "s", "b")
    with pytest.raises(K.Conflict):
        st.set_days("w", 5)
    assert p.read_text(encoding="utf-8") == "{ not json"


def test_two_corrupt_files_in_the_same_second_are_both_kept(tmp_path, monkeypatch):
    p = tmp_path / "outreach.json"
    monkeypatch.setattr(K.time, "time", lambda: 1000.0)
    st = K.OutreachStore(p)
    p.write_text("{ first", encoding="utf-8")
    st.rows()
    p.write_text("{ second", encoding="utf-8")
    st.rows()
    kept = sorted(x.read_text(encoding="utf-8") for x in tmp_path.iterdir() if x.name.endswith(".corrupt"))
    assert kept == ["{ first", "{ second"]


def test_a_row_this_version_cannot_read_stays_on_disk_after_a_write(tmp_path):
    # a later wave's state ("replied") is left out of every answer, but a save must not erase it from his file
    p = tmp_path / "outreach.json"
    good = {"id": "o-0123456789ab", "application": "w", "to_note": "", "subject": "s", "body": "b",
            "state": "draft", "made": "2026-11-27", "updated": "", "sent_on": None}
    later = {**good, "id": "o-0123456789ac", "state": "replied"}
    p.write_text(json.dumps({"version": 1, "rows": [good, later]}), encoding="utf-8")
    st = K.OutreachStore(p)
    assert [r["id"] for r in st.rows()] == ["o-0123456789ab"]
    st.set_days("w", 5)
    st.add("w", "", "s2", "b2")
    on_disk = json.loads(p.read_text(encoding="utf-8"))["rows"]
    assert later in on_disk and len(on_disk) == 3 and len(st.rows()) == 2


def test_k08_a_new_application_after_a_rejection_counts_from_the_new_applied_day():
    # review 27 Nov: the first "applied" ever was used, so a second round after a rejection was 300 days overdue at once
    a = {"id": "w", "org": "Widget Lab", "status": "applied",
         "history": hist(("applied", "2026-01-05"), ("rejected", "2026-02-01"), ("applied", "2026-11-20"))}
    assert K.applied_at(a) == "2026-11-20"
    a2 = {**a, "history": hist(("applied", "2026-11-10"), ("idea", "2026-11-11"), ("applied", "2026-11-15"))}
    assert K.applied_at(a2) == "2026-11-10"          # a slip back to idea is not a new round


def test_k08_an_application_moved_back_to_idea_is_never_due(tmp_path):
    st = K.OutreachStore(tmp_path / "o.json")
    a = {"id": "w", "org": "Widget Lab", "status": "idea", "history": hist(("applied", "2026-10-01"), ("idea", "2026-10-02"))}
    it = K.followups([a], st, TODAY)["items"][0]
    assert it["due"] is False and it["follow_up_on"] == "2026-10-15"


def test_k10_a_sent_day_before_the_applied_day_says_the_clock_stays_on_the_applied_day(env):
    c, apps, store, clock, tmp = env
    write_apps(tmp / "applications.json", {"widget-lab": {"org": "Widget Lab", "status": "applied",
                                                          "history": hist(("applied", "2026-11-10"))}})
    row = draft(c)
    out = ok(c.post(f"{O}/{row['id']}/sent", json={"sent_on": "2026-11-01"}))
    assert "2026-11-10" in out["reason"] and "counts from that day" not in out["reason"]
    assert ok(c.get(F))["items"][0]["counts_from"] == "applied"


# ------------------------------------------------------------------ nothing is sent
def test_every_route_runs_with_the_network_blocked_and_nothing_is_sent(env):
    c, apps, store, clock, tmp = env
    with pytest.raises(NetworkUsed):                              # the block is really on
        socket.create_connection(("192.0.2.1", 9), timeout=1)      # a documentation address: nothing may leave
    write_apps(tmp / "applications.json", {"widget-lab": {"org": "Widget Lab", "status": "applied",
                                                          "history": hist(("applied", "2026-11-01"))}})
    row = draft(c, to_note="someone@example.invalid")
    ok(c.get(O))
    ok(c.patch(f"{O}/{row['id']}", json={"body": "Changed."}))
    ok(c.post(f"{O}/{row['id']}/sent", json={}))
    ok(c.get(F))
    assert store.get(row["id"])["to_note"] == "someone@example.invalid"   # kept as a note, nothing more
    assert sorted(x.name for x in tmp.iterdir()) == ["applications.json", "career"]


def test_the_module_never_names_a_way_to_send(tmp_path):
    src = (K.__file__, K.__file__.replace("ww_career_outreach.py", "routes_ww_career_outreach.py"))
    for path in src:
        text = open(path, encoding="utf-8").read()
        for word in ("import socket", "smtplib", "webbrowser", "startfile", "subprocess", "urllib", "requests",
                     "httpx", "mailto:", "logging", "print("):
            assert word not in text, (path, word)
