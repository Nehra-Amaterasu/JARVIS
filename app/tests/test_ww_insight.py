"""Insight engine (ww_insight.py): the weekly review from logged events. What moved,
what stalled, one change for next week, every line with its numbers. Fictional events."""
import copy
from pathlib import Path

import pytest

from jarvis_app import ww_base as wb
from jarvis_app import ww_engines as we
from jarvis_app import ww_insight as wi

MON = "2026-10-26"           # the week is 10-20 .. 10-26, the one before 10-13 .. 10-19


@pytest.fixture()
def inputs():
    return we.load_inputs(Path("no-such-inputs.json"))


def ev(d, kind, **kw):
    return {"date": d, "kind": kind, **kw}


NODES = [{"id": "n-verilog", "name": "Verilog", "status": "in_progress"}, {"id": "n-fsm", "name": "State machines", "status": "in_progress"},
         {"id": "n-logic", "name": "Logic", "status": "mastered"}]
EVENTS = [
    # last week: logic and German
    ev("2026-10-14", "contract", key="n-logic/c1", node="n-logic", minutes=40),
    ev("2026-10-15", "log", track="deutsch", minutes=30),
    ev("2026-10-16", "contract", key="n-verilog/c1", node="n-verilog", minutes=30),
    # this week: verilog moved, German went quiet, fsm never touched
    ev("2026-10-20", "contract", key="n-verilog/c2", node="n-verilog", minutes=45, verified=True),
    ev("2026-10-22", "contract", key="n-verilog/c3", node="n-verilog", minutes=45),
    ev("2026-10-23", "learning", minutes=30),
    ev("2026-10-25", "log", track="silicon", minutes=60),
    ev("2026-10-25", "xp", xp=500),                                   # game XP is not an action
]
PLANNED = {"2026-10-20": ["n-verilog/c2", "n-fsm/c1", "acad/x"], "2026-10-22": ["n-verilog/c3", "n-fsm/c1"],
           "2026-10-25": ["n-fsm/c2"], "2026-10-12": ["old"]}


def test_totals_moved_and_stalled_each_with_numbers(inputs):
    r = we.insight(inputs, MON, events=EVENTS, planned=PLANNED, nodes=NODES)
    assert r["status"] == "ok" and r["week"] == {"start": "2026-10-20", "end": MON}
    tw = r["this_week"]
    assert (tw["active_days"], tw["minutes"], tw["contracts"], tw["with_link"]) == (4, 180, 2, 1)
    assert (tw["planned"], tw["planned_done"]) == (5, 2)
    assert r["totals"] == ("4/7 active days, 180 minutes, 2 contracts finished (2 of 5 planned); "
                           "last week 3/7 days, 100 minutes")
    assert r["moved"][0] == "Verilog: 2 contracts, 90 min this week (last week 1, 30 min)"
    assert any(m.startswith("Silicon: 0 contracts, 60 min") for m in r["moved"])
    assert "State machines: in progress, 0 min this week (nothing logged yet)" in r["stalled"]
    assert any(s.startswith("German: 30 min and 0 contracts last week, nothing this week") for s in r["stalled"])


def test_one_change_follows_the_rules_in_order(inputs):
    r = we.insight(inputs, MON, events=EVENTS, planned=PLANNED, nodes=NODES)
    assert r["change"]["rule"] == "too_much"                           # 2 of 5 planned: 40%
    assert r["change"]["text"] == ("Next week: plan two contracts a day instead of three. "
                                   "This week 2 of 5 planned contracts got done (40%).")
    w = {"active_days": 5, "planned": 4, "planned_done": 4, "contracts": 3, "with_link": 0, "minutes": 200}
    assert wi.one_change(w, [{"id": "n", "name": "FSM"}])["rule"] == "stalled"
    assert wi.one_change(w, [])["rule"] == "proof" and "3 contracts finished this week, 0 with a link" in wi.one_change(w, [])["text"]
    assert wi.one_change({**w, "with_link": 1}, [])["rule"] == "keep"
    assert wi.one_change({**w, "active_days": 1}, [])["text"].endswith("This week had 1 active day of 7.")


def test_an_empty_fortnight_says_so(inputs):
    r = we.insight(inputs, MON)
    assert r["moved"] == [] and r["stalled"] == [] and r["change"]["rule"] == "empty"
    assert r["say"].startswith("Weekly review, 2026-10-20 to 2026-10-26: 0/7 active days")


def test_the_spoken_review_is_short_and_carries_the_numbers(inputs):
    r = we.insight(inputs, MON, events=EVENTS, planned=PLANNED, nodes=NODES)
    s = r["say"]
    assert s.startswith("Weekly review, 2026-10-20 to 2026-10-26: 4/7 active days, 180 minutes")
    assert "Moved: Verilog: 2 contracts, 90 min" in s and "Stalled: " in s and s.endswith("(40%).")
    assert s.count(".") <= 8 and len(s) < 600
    assert wi.weekly_say(r) == s


def test_pure_and_kind(inputs):
    evs, pl = copy.deepcopy(EVENTS) + ["junk", {"kind": "log"}], copy.deepcopy(PLANNED)
    before = copy.deepcopy((evs, pl, NODES))
    a = we.insight(inputs, MON, events=evs, planned=pl, nodes=NODES)
    assert a == we.insight(inputs, MON, events=copy.deepcopy(evs), planned=copy.deepcopy(pl), nodes=copy.deepcopy(NODES))
    assert (evs, pl, NODES) == before
    for line in [a["totals"], a["say"], a["change"]["text"], *a["moved"], *a["stalled"]]:
        assert wb.no_shame(line), line
    assert we.run("insight", inputs, MON, events=[{"date": "2026-10-20"}])["status"] == "invalid_input"
