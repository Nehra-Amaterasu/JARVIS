"""Reminders in the app: the store, the scheduler that fires them, the routes, and
JARVIS's tools driving the real routes end to end. Clocks are injected; nothing waits
on wall time except one test of the background loop (a 1-second timer)."""
import time
from datetime import datetime

import pytest
from starlette.testclient import TestClient

from jarvis_app.bus import EventBus
from jarvis_app.reminders import (LATE_GRACE_S, ReminderError, ReminderScheduler, ReminderStore, describe_list,
                                  describe_new, fire_line)
from jarvis_app.security import Guard
from jarvis_app.server import create_app

MON_7PM = datetime(2026, 10, 12, 19, 0).timestamp()
TOKEN = "test-token-reminders"


class Clock:
    def __init__(self, t):
        self.t = t

    def __call__(self):
        return self.t


@pytest.fixture
def clock():
    return Clock(MON_7PM)


@pytest.fixture
def store(tmp_path, clock):
    return ReminderStore(tmp_path / "reminders.json", clock=clock)


def ts(d, h, m=0):
    return datetime(2026, 10, d, h, m).timestamp()


# ------------------------------------------------------------------ the store
def test_create_resolves_the_time_and_says_it_back(store, clock):
    r = store.create("call my mum", when="remind me at 9 to call my mum")
    assert r["due"] == ts(12, 21) and r["status"] == "pending" and r["kind"] == "reminder"
    assert describe_new(r, clock()) == "Reminder set: call your mum, at 9 pm today."
    t = store.create("", kind="timer", when="timer for 10 minutes")
    assert t["due"] == ts(12, 19, 10) and t["length_s"] == 600
    assert describe_new(t, clock()) == "Timer set for 10 minutes; it ends at 7:10 pm."
    m = store.create("medicine", when="medicine at 8 am every day")
    assert m["repeat"] == "daily" and m["due"] == ts(13, 8)
    assert describe_new(m, clock()) == "Reminder set: medicine, every day at 8 am. The first one is at 8 am tomorrow."
    a = store.create("", kind="alarm", when="wake me up at 6:30")
    assert a["due"] == ts(13, 6, 30) and "only rings while the JARVIS app is open" in describe_new(a, clock())


def test_a_timer_at_a_clock_time_is_a_reminder(store, clock):
    # The live model sent kind=timer with "at 9 pm": "Timer set for 3 hours 28 minutes".
    r = store.create("call with mum", kind="timer", when="at 9 pm")
    assert r["kind"] == "reminder" and "length_s" not in r
    assert describe_new(r, clock()) == "Reminder set: call with mum, at 9 pm today."


def test_create_accepts_an_exact_time_and_refuses_nonsense(store, clock):
    assert store.create("x", due="2026-10-12T22:15")["due"] == ts(12, 22, 15)
    assert store.create("x", due=ts(12, 23))["due"] == ts(12, 23)
    with pytest.raises(ReminderError, match="already passed"):
        store.create("gym", when="today at 7 am")
    with pytest.raises(ReminderError, match="couldn't tell when"):
        store.create("x", when="whenever")
    with pytest.raises(ReminderError, match="say when"):
        store.create("x")
    with pytest.raises(ReminderError, match="kind"):
        store.create("x", kind="nuke", when="in 5 minutes")
    with pytest.raises(ReminderError, match="unknown device"):
        store.create("x", kind="action", when="in 5 minutes", action={"device": "geyser", "action": "on"})
    with pytest.raises(ReminderError, match="between 5 minutes"):
        store.create("x", when="in 5 minutes", interval_min=1)


def test_it_survives_a_restart(tmp_path, clock):
    s1 = ReminderStore(tmp_path / "r.json", clock=clock)
    r = s1.create("call mum", when="at 9 pm")
    s2 = ReminderStore(tmp_path / "r.json", clock=clock)
    assert [x["id"] for x in s2.pending()] == [r["id"]]


def test_cancel_by_words_by_kind_and_all(store):
    a = store.create("call mum", when="at 9 pm")
    store.create("pay rent", when="at 10 pm")
    t1 = store.create("", kind="timer", when="in 5 minutes")
    store.create("", kind="timer", when="in 20 minutes")
    assert [r["id"] for r in store.cancel_matching("the reminder to call mum")] == [a["id"]]
    assert [r["id"] for r in store.cancel_matching("", "timer")] == [t1["id"]]       # the soonest one
    assert store.cancel_matching("dentist") == []
    assert len(store.cancel_matching("", None, all=True)) == 2
    assert store.pending() == []


def test_firing_a_one_off_finishes_it_and_a_daily_one_moves_on(store, clock):
    one = store.create("call mum", when="at 9 pm")
    daily = store.create("medicine", when="every day at 8 am")
    clock.t = ts(13, 8)
    done = store.mark_fired(one["id"], clock.t, spoken=True)
    assert done["status"] == "done" and done["fired"][-1]["spoken"] is True
    moved = store.mark_fired(daily["id"], clock.t, spoken=False)
    assert moved["status"] == "pending" and moved["due"] == ts(14, 8)


def test_a_repeat_missed_for_days_is_announced_once(store, clock):
    daily = store.create("medicine", when="every day at 8 am")
    clock.t = ts(16, 10)                                     # the app was closed for three days
    sched = ReminderScheduler(store, EventBus(), clock=clock)
    events = sched.tick()
    assert len(events) == 1 and events[0]["kind"] == "missed"
    assert "While the app was closed I missed a reminder at 8 am: medicine." == events[0]["text"]
    assert store.get(daily["id"])["due"] == ts(17, 8)


def test_snooze_and_ack(store, clock):
    r = store.create("call mum", when="at 9 pm")
    clock.t = ts(12, 21)
    store.mark_fired(r["id"], clock.t, spoken=True)
    s = store.snooze(r["id"], 10)
    assert s["status"] == "pending" and s["due"] == ts(12, 21, 10)
    acked = store.ack(r["id"])
    assert acked["acked"] == clock.t and acked["fired"][-1]["acked"] == clock.t
    med = store.create("medicine", when="every day at 8 am")
    extra = store.snooze(med["id"], 15)                      # a series stays; an extra one-off is added
    assert extra["id"] != med["id"] and store.get(med["id"])["repeat"] == "daily"


# ------------------------------------------------------------------ the scheduler
class FakeCore:
    def __init__(self, running=True, mode="voice"):
        self.running, self.mode, self.said = running, mode, []

    def speak(self, text):
        self.said.append(text)


class FakeLimbs:
    def __init__(self):
        self.applied = []

    def apply(self, device, action, value=None, origin="app"):
        self.applied.append((device, action, value, origin))
        return {"changed": [device], "delivered": {device: False}, "state": {device: {"on": action != "off"}}}

    def view(self):
        return {"usb": False}


def test_due_reminders_are_spoken_and_always_published(store, clock):
    bus, core = EventBus(), FakeCore()
    r = store.create("call my mum", when="at 9 pm")
    sched = ReminderScheduler(store, bus, core=core, clock=clock)
    assert sched.tick() == []                               # not yet
    clock.t = ts(12, 21, 0) + 0.5
    ev = sched.tick()[0]
    assert core.said == ["Reminder: call your mum."]
    assert ev["source"] == "reminders" and ev["kind"] == "due" and ev["spoken"] is True
    assert store.get(r["id"])["status"] == "done"
    assert sched.tick() == []                               # fired once


def test_in_text_mode_or_asleep_it_is_not_called_spoken(store, clock):
    store.create("a", when="at 9 pm")
    store.create("b", when="at 9 pm")
    text_core = FakeCore(mode="text")
    clock.t = ts(12, 21)
    evs = ReminderScheduler(store, EventBus(), core=text_core, clock=clock).tick()
    assert [e["spoken"] for e in evs] == [False, False] and len(text_core.said) == 2
    store.create("c", when="at 10 pm")
    asleep = FakeCore(running=False)
    clock.t = ts(12, 22)
    evs = ReminderScheduler(store, EventBus(), core=asleep, clock=clock).tick()
    assert asleep.said == [] and evs[0]["spoken"] is False and evs[0]["text"] == "Reminder: c."


def test_a_late_reminder_says_it_is_late(store, clock):
    store.create("call mum", when="at 9 pm")
    clock.t = ts(12, 21, 5)
    ev = ReminderScheduler(store, EventBus(), clock=clock).tick()[0]
    assert ev["text"] == "Sorry, this is late; it was due at 9 pm. Reminder: call mum."


def test_a_timed_switch_drives_limbs_and_says_virtual(store, clock):
    limbs = FakeLimbs()
    store.create("", kind="action", when="in 30 minutes", action={"device": "fan", "action": "off"})
    clock.t = ts(12, 19, 30)
    ev = ReminderScheduler(store, EventBus(), limbs=limbs, clock=clock).tick()[0]
    assert limbs.applied == [("fan", "off", None, "schedule")]
    assert ev["text"] == "As scheduled: fan off. Virtual room only; no relay board is connected."


def test_a_timed_switch_long_overdue_is_skipped_not_done(store, clock):
    limbs = FakeLimbs()
    store.create("", kind="action", when="in 30 minutes", action={"device": "fan", "action": "off"})
    clock.t = ts(12, 19, 30) + LATE_GRACE_S + 60
    ev = ReminderScheduler(store, EventBus(), limbs=limbs, clock=clock).tick()[0]
    assert limbs.applied == [] and ev["kind"] == "skipped" and "I skipped" in ev["text"]


def test_lines_for_every_kind(clock):
    base = {"text": "", "due": ts(13, 6, 30), "repeat": None, "interval_min": None}
    assert fire_line(dict(base, kind="alarm"), ts(13, 6, 30)) == "Good morning. It's 6:30 am; this is your alarm."
    assert fire_line(dict(base, kind="timer", length_s=600), ts(13, 6, 30)) == \
        "Time's up: your timer for 10 minutes is done."
    assert fire_line(dict(base, kind="reminder"), ts(13, 6, 30)) == "This is the reminder you asked for."
    assert describe_list([], clock()) == "You have no reminders, timers or alarms."


# ------------------------------------------------------------------ the routes
@pytest.fixture
def client():
    guard = Guard(8777, TOKEN, extra_hosts=["testserver"])
    app = create_app(guard, autostart_aankhen="off")
    with TestClient(app) as c:
        c.headers.update({"X-Jarvis-Token": TOKEN})
        for r in app.state.svc.reminders.pending():          # each test starts with an empty list
            app.state.svc.reminders.cancel(r["id"])
        yield c


def test_routes_create_list_cancel(client):
    r = client.post("/api/reminders", json={"text": "call my mum", "when": "in 2 hours"})
    assert r.status_code == 200 and r.json()["say"].startswith("Reminder set: call your mum, at ")
    rid = r.json()["reminder"]["id"]
    v = client.get("/api/reminders").json()
    assert [x["id"] for x in v["items"]] == [rid] and v["say"].startswith("You have 1 reminder: call your mum")
    assert v["voice"] is False
    assert client.post("/api/reminders", json={"text": "x", "when": "whenever"}).status_code == 400
    assert client.post("/api/reminders/cancel", json={"query": "mum"}).json()["say"].startswith("Cancelled: ")
    assert client.delete(f"/api/reminders/{rid}").status_code == 404     # already gone
    events = [e for e in client.app.state.svc.bus.history(50) if e["source"] == "reminders"]
    assert [e["kind"] for e in events][-2:] == ["created", "cancelled"]


def test_routes_snooze_ack_and_unknown_ids(client):
    rid = client.post("/api/reminders", json={"text": "tea", "when": "in 5 minutes"}).json()["reminder"]["id"]
    assert client.post(f"/api/reminders/{rid}/snooze", json={"minutes": 15}).json()["say"] == "Snoozed for 15 minutes."
    assert client.post(f"/api/reminders/{rid}/ack").status_code == 200
    assert client.post("/api/reminders/r_nope/snooze", json={}).status_code == 404
    assert client.post("/api/reminders/r_nope/ack").status_code == 404
    assert client.delete(f"/api/reminders/{rid}").status_code == 200


def test_the_api_needs_the_token(client):
    assert client.get("/api/reminders", headers={"X-Jarvis-Token": "wrong"}).status_code == 401


def test_the_scheduler_runs_with_the_app(client):
    client.post("/api/reminders", json={"text": "", "kind": "timer", "when": "timer for 1 second"})
    bus = client.app.state.svc.bus
    deadline = time.time() + 6
    while time.time() < deadline:
        if any(e["source"] == "reminders" and e["kind"] == "due" for e in bus.history(50)):
            break
        time.sleep(0.1)
    due = [e for e in bus.history(50) if e["source"] == "reminders" and e["kind"] == "due"]
    assert due and due[-1]["text"] == "Time's up: your timer for 1 second is done."
    assert due[-1]["spoken"] is False                       # JARVIS is not running in this test


# ------------------------------------------------------------------ JARVIS's tools against the real routes
@pytest.fixture
def tools_ctx(client):
    from jarvis_app.paths import ensure_jarvis_importable
    ensure_jarvis_importable()
    from tools.builtin import ToolContext, default_registry

    def http(method, path, body, timeout):
        r = client.request(method, path, json=body)
        return r.status_code, r.json()
    return default_registry(), ToolContext(http=http)


def test_tools_set_list_and_cancel_reminders_through_the_app(tools_ctx):
    reg, ctx = tools_ctx
    r = reg.call("set_reminder", {"text": "drink water", "when": "in 30 minutes"}, ctx)
    assert r.ok and r.backs == ("reminder", "schedule") and r.did.startswith("Reminder set: drink water, at ")
    listed = reg.call("list_reminders", {}, ctx)
    assert listed.ok and "drink water" in listed.did
    bad = reg.call("set_reminder", {"text": "x", "when": "sometime"}, ctx)
    assert not bad.ok and bad.backs == () and "couldn't tell when" in bad.did
    gone = reg.call("cancel_reminder", {"query": "water"}, ctx)
    assert gone.ok and gone.did.startswith("Cancelled: drink water")
    assert not reg.call("cancel_reminder", {"query": "water"}, ctx).ok


def test_tools_switch_the_room_through_limbs_and_say_virtual(tools_ctx):
    reg, ctx = tools_ctx
    r = reg.call("set_device", {"device": "light", "action": "set", "value": 30}, ctx)
    assert r.ok and r.simulated and r.did == "The light is on at 30 percent. Virtual room only; no relay board is connected."
    s = reg.call("room_state", {}, ctx)
    assert s.ok and "The light is on at 30 percent." in s.did and s.source == "app · Limbs (virtual room)"
    sw = reg.call("switch_later", {"device": "fan", "action": "off", "when": "in 30 minutes"}, ctx)
    assert sw.ok and sw.did.startswith("Scheduled: fan off, at ")


def test_presence_with_aankhen_off_is_a_failed_receipt(tools_ctx):
    reg, ctx = tools_ctx
    r = reg.call("presence", {}, ctx)
    assert r.ok is False and "Aankhen isn't running" in r.did and r.backs == ()
