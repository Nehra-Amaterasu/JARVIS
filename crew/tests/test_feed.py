"""crew/feed.py: bus events become feed events with honest evidence, the queue gives the
most important fresh one first, and the feed works out stillness, bed and waking up."""
import time

from crew.agents.learner import ChatLearner, folder_signature, nothing_left
from crew.board import Blackboard
from crew.feed import (BED_MIN, MAX_AGE_S, STILL_MIN, UP_MIN, Derivations, EventFeed, classify)


class Clock:
    def __init__(self, t=1_800_000_000.0):
        self.t = t

    def __call__(self):
        return self.t


def test_classify_maps_the_sources_and_marks_estimates_as_probable():
    a = classify({"source": "crew", "kind": "arrived", "text": "Back in the room after 12 min away", "zone": "desk",
                  "away_min": 12, "ts": 5.0})
    assert (a["kind"], a["evidence"], a["certainty"], a["facts"]["away_min"]) == ("arrived", "observed", "probable", 12)
    r = classify({"source": "limbs", "kind": "relay_failed", "text": "light on not confirmed", "device": "light"})
    assert r["priority"] == 3 and r["certainty"] == "sure"
    b = classify({"source": "limbs", "kind": "board", "text": "Relay board (Uno) disconnected: unplugged"})
    assert b["kind"] == "board_disconnected"
    assert classify({"source": "limbs", "kind": "room", "origin": "voice", "state": {"on": True}}) is None
    sched = classify({"source": "limbs", "kind": "room", "origin": "schedule", "device": "fan", "state": {"on": True}})
    assert sched["facts"] == {"device": "fan", "state": "on", "by": "schedule"}
    assert classify({"source": "reminders", "kind": "due", "text": "Water"})["kind"] == "reminder_due"
    sed = classify({"source": "crew", "kind": "sedentary", "text": "At the desk 1 h 5 min without getting up"})
    assert sed["facts"]["minutes"] == 65
    assert classify({"source": "aankhen", "kind": "presence", "text": "Room: occupied"}) is None
    assert classify({"source": "crew", "kind": "waved", "text": "Waved"}) is None


def test_queue_order_cooldown_staleness_and_overflow():
    clock = Clock()
    f = EventFeed(clock=clock, max_queued=3)
    f.push({"kind": "lights_changed", "priority": 1, "summary": "a"})
    clock.t += 1
    f.push({"kind": "relay_failed", "priority": 3, "summary": "b"})
    clock.t += 1
    f.push({"kind": "arrived", "priority": 2, "summary": "c"})
    assert f.push({"kind": "arrived", "priority": 2, "summary": "again"}) is None       # cooldown
    assert [e["kind"] for e in f.peek()] == ["relay_failed", "arrived", "lights_changed"]
    f.push({"kind": "woke_up", "priority": 2, "summary": "d"})                          # 4 > 3: lowest goes
    assert [d["dropped"] for d in f.take_dropped()] == ["duplicate", "overflow"]
    assert f.pop()["kind"] == "relay_failed"
    clock.t += MAX_AGE_S + 1
    assert f.pop() is None and {d["dropped"] for d in f.take_dropped()} == {"stale"}


def movement(zone, zone_s, act="still", act_s=0.0, p=0.9, live=True, since=1.0):
    return {"source": "hardware", "live": live, "zone": {"state": zone, "p": p, "seconds": zone_s},
            "activity": {"state": act, "p": p, "seconds": act_s, "since": since}}


def localtime_at(hour):
    return lambda t: time.struct_time((2026, 10, 15, hour, 0, 0, 3, 288, -1))


def test_long_stillness_once_per_stretch_never_in_bed():
    d = Derivations(localtime=localtime_at(15))
    assert d.update(movement("desk", 4000, "still", STILL_MIN * 60 - 1), 0) == []
    ev = d.update(movement("desk", 4000, "still", STILL_MIN * 60 + 5), 1)
    assert [e["kind"] for e in ev] == ["long_stillness"] and ev[0]["certainty"] == "probable"
    assert d.update(movement("desk", 4100, "still", STILL_MIN * 60 + 60), 2) == []      # same stretch
    assert d.update(movement("bed", 9000, "still", 9000, since=2.0), 3) == []          # in bed: sleep
    unsure = d.update(movement("desk", 4000, "still", STILL_MIN * 60 + 5, p=0.3, since=3.0), 4)
    assert unsure[0]["certainty"] == "unknown"                                          # proactive stays quiet
    assert d.update(movement("desk", 4000, "still", 99999, live=False, since=4.0), 5) == []


def test_bed_at_night_then_up_in_the_morning():
    hours = {"h": 23}
    d = Derivations(localtime=lambda t: time.struct_time((2026, 10, 15, hours["h"], 0, 0, 3, 288, -1)))
    assert d.update(movement("bed", BED_MIN * 60 - 10), 0) == []
    assert [e["kind"] for e in d.update(movement("bed", BED_MIN * 60 + 10), 1)] == ["went_to_bed"]
    assert d.update(movement("bed", BED_MIN * 60 + 100), 2) == []                       # once a night
    hours["h"] = 7
    assert d.update(movement("desk", UP_MIN * 60 - 5), 3) == []
    assert [e["kind"] for e in d.update(movement("desk", UP_MIN * 60 + 5), 4)] == ["woke_up"]
    assert d.update(movement("desk", UP_MIN * 60 + 500), 5) == []                       # once a day


def test_up_in_the_afternoon_is_not_waking_up():
    d = Derivations(localtime=localtime_at(15))
    assert d.update(movement("desk", 9999), 0) == []


# ------------------------------------------------------------------ the learner's skip
def test_learner_skips_unchanged_transcripts_and_remembers_it(tmp_path):
    tdir = tmp_path / "transcripts"
    tdir.mkdir()
    (tdir / "2026-10-15.jsonl").write_text('{"a": 1}\n', encoding="utf-8")
    calls = []

    def learn():
        calls.append(1)
        return {"new_turns": 0, "sessions": 0, "by": "llm+rules"}
    state = tmp_path / "learner.json"
    a = ChatLearner(learn, start_delay_s=0, signature=folder_signature(tdir), state_path=state)
    a.board = Blackboard()
    a.run()
    a.run()
    assert len(calls) == 1 and a.skipped == 1
    b = ChatLearner(learn, start_delay_s=0, signature=folder_signature(tdir), state_path=state)   # a restart
    b.board = Blackboard()
    b.run()
    assert len(calls) == 1 and "already read" in b.summary                  # the embedder never loads
    (tdir / "2026-10-15.jsonl").write_text('{"a": 1}\n{"b": 2}\n', encoding="utf-8")
    b.run()
    assert len(calls) == 2


def test_learner_keeps_going_while_work_is_left():
    assert not nothing_left({"new_turns": 0, "sessions": 0, "by": "rules"})          # Ollama down: redo later
    assert not nothing_left({"new_turns": 3, "sessions": 0, "by": "llm+rules"})
    assert not nothing_left({"skipped": "another run holds the lock"})
    assert nothing_left({"new_turns": 0, "sessions": 0, "by": "llm+rules"})
