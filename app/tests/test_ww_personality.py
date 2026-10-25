"""Personality engine (ww_personality.py): the profile sets the framing, never the goal;
a hard cap of 3 open projects; recovery after missed days with no shame wording.
Profiles here are fictional."""
import copy
from pathlib import Path

import pytest

from jarvis_app import ww_base as wb
from jarvis_app import ww_engines as we
from jarvis_app import ww_personality as wp

MON = "2026-10-26"


@pytest.fixture()
def example():
    return we.load_inputs(Path("no-such-inputs.json"))


def C(key, branch, minutes=45, source="tree", **kw):
    return {"key": key, "title": key.replace("/", " "), "branch": branch, "node_id": key.split("/")[0], "minutes": minutes,
            "source": source, "success_check": f"{key} passes its check", "done": False, **kw}


CANDS = [C("a/1", "digital"), C("b/1", "digital"), C("c/1", "maths", 30), C("d/1", "academics", 60, source="academics"),
         C("e/1", "digital", done=True)]


def test_profile_lines_switch_the_framings_on_and_say_which_line_did(example):
    p = we.personality(example, MON)
    st = p["style"]
    assert st["novelty_first"] == {"on": True, "from": "creative problem solver: open problems, variety, autonomy"}
    assert st["finish_lines"]["on"] and "follow-through" in st["finish_lines"]["from"]
    assert st["variety"]["on"] and st["stretch"]["on"] and p["profile_known"]
    assert any(r.startswith("Puzzle first") for r in p["rules_applied"])


def test_no_profile_no_framing(example):
    bare = we.normalize_inputs({})
    p = we.personality(bare, MON, contracts=CANDS)
    assert not p["profile_known"] and not any(v["on"] for v in p["style"].values())
    assert [f["key"] for f in p["framed"]] == ["a/1", "b/1", "c/1", "d/1"]          # passed through in order, done one dropped
    assert p["framed"][0]["frame"] == "Contract: a 1. Done when: a/1 passes its check."


def test_framing_and_variety(example):
    p = we.personality(example, MON, contracts=CANDS)
    keys = [f["key"] for f in p["framed"]]
    assert keys == ["a/1", "c/1", "b/1", "d/1"]                        # never two digital in a row
    a = p["framed"][0]["frame"]
    assert a.startswith("Contract: a 1. Done when: a/1 passes its check.")
    assert "One 45-minute sprint with that finish line." in a and "Try it cold for ten minutes" in a
    d = next(f for f in p["framed"] if f["key"] == "d/1")["frame"]
    assert "Try it cold" not in d                                       # puzzle-first is for tree contracts only
    assert p["n_today"] == 3 and p["gap"]["mode"] == "normal"


def test_the_project_cap_is_three_whatever_the_inputs_say(example):
    loose = copy.deepcopy(example)
    loose["rules"]["max_open_projects"] = 10
    projects = [{"id": f"p{i}", "title": f"Project {i}"} for i in range(4)]
    cap = we.personality(loose, MON, open_projects=projects)["cap"]
    assert cap["cap"] == 3 and cap["open"] == 4 and cap["over"] and cap["room"] == 0
    assert cap["say"] == "4 projects are open and the cap is 3: finishing or pausing 1 gets back under it."
    full = we.personality(example, MON, open_projects=projects[:3])["cap"]
    assert not full["over"] and "a new idea goes to the parking lot" in full["say"]
    assert we.personality(example, MON, open_projects=projects[:1])["cap"]["say"] == "1 of 3 projects open: room for 2 more."
    assert wp.project_cap({"max_open_projects": 2}, [])["cap"] == 2


@pytest.mark.parametrize("days,idle,mode", [
    ([], None, "normal"), ([MON], 0, "normal"), (["2026-10-25"], 0, "normal"), (["2026-10-24"], 1, "normal"),
    (["2026-10-20", "2026-10-23"], 2, "recovery"), (["2026-10-01"], 24, "recovery")])
def test_gap_recovery(example, days, idle, mode):
    g = we.personality(example, MON, active_days=days)["gap"]
    assert g["idle_days"] == idle and g["mode"] == mode


def test_after_a_gap_two_contracts_the_shortest_first_as_a_15_minute_version(example):
    p = we.personality(example, MON, contracts=CANDS, active_days=["2026-10-20"])
    assert p["n_today"] == 2 and p["gap"]["mode"] == "recovery"
    first = p["framed"][0]
    assert first["key"] == "c/1" and first["minutes"] == 15 and "A 15-minute version" in first["frame"]
    assert p["gap"]["say"] == "Welcome back. 5 days off happens. Today is two short contracts, and the first one takes 15 minutes."
    assert any("After a gap" in r for r in p["rules_applied"])


def test_never_shame_and_pure(example):
    acts = ["2026-10-01"]
    before = copy.deepcopy((example, CANDS, acts))
    p = we.personality(example, MON, contracts=CANDS, active_days=acts, open_projects=[{"id": "x"}] * 5)
    assert p == we.personality(copy.deepcopy(example), MON, contracts=copy.deepcopy(CANDS), active_days=list(acts),
                               open_projects=[{"id": "x"}] * 5)
    assert (example, CANDS, acts) == before
    for line in [p["gap"]["say"], p["cap"]["say"], *p["rules_applied"], *(f["frame"] for f in p["framed"])]:
        assert wb.no_shame(line), line
    assert p["never_shame"] is True
    assert we.run("personality", example, MON, active_days=["yesterday"])["status"] == "invalid_input"
