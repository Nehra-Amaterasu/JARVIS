"""Well Wisher engines (ww_engines.py): every engine is a pure function over data;
the goal ladder chains today's contracts up to a life goal; the evidence engine
gives no XP without a logged action carrying its evidence. Inputs are the
fictional engine-inputs.example.json; nothing here is about a real person."""
import copy
import json
import random
import shutil
from pathlib import Path

import pytest
from starlette.testclient import TestClient

from jarvis_app import germoney as g
from jarvis_app import ww_engines as we
from jarvis_app.security import Guard
from jarvis_app.server import create_app

FIX = Path(__file__).resolve().parents[1] / "ui" / "src" / "__tests__" / "fixtures" / "mission-bank"
MON = "2026-10-26"
TOKEN = "t" * 32


@pytest.fixture()
def inputs():
    return we.load_inputs(Path("no-such-inputs.json"))


# ------------------------------------------------------------------ the contract every engine keeps
def test_the_registry_holds_the_eight_engines_and_each_is_pure(inputs):
    assert list(we.ENGINES) == ["goal_ladder", "evidence", "career", "money", "personality", "body", "learning", "insight"]
    for name, f in we.ENGINES.items():
        before = copy.deepcopy(inputs)
        a, b = f(inputs, MON), f(copy.deepcopy(inputs), MON)
        assert a == b, name                                # same data, same answer
        assert inputs == before, name                      # the data is never mutated
        assert a["engine"] == name and a["status"] in ("ok", "not_built") and a["date"] == MON
        if a["status"] == "not_built":
            assert a["needs"] and a["plan"]                # an interface says what it will need


def test_inputs_fall_back_to_the_fictional_example_and_say_so(tmp_path):
    assert we.load_inputs(tmp_path / "missing.json")["source"] == "example"
    (tmp_path / "bad.json").write_text("{not json", encoding="utf-8")
    assert we.load_inputs(tmp_path / "bad.json")["source"] == "example"
    p = tmp_path / "mine.json"
    p.write_text(json.dumps({"life_goals": [{"id": "x", "title": "X"}], "deadlines": [{"id": "d", "date": "2026-13-01"}],
                             "skills": [{"id": "s", "level": 9, "target": -2}]}), encoding="utf-8")
    mine = we.load_inputs(p)
    assert mine["source"] == "private" and mine["life_goals"][0]["id"] == "x"
    assert mine["deadlines"] == [] and mine["warnings"]                     # a bad date is dropped, with a warning
    assert mine["skills"]["s"]["level"] == 5 and mine["skills"]["s"]["target"] == 0   # clamped to 0..5


# ------------------------------------------------------------------ 1. goal ladder
def test_the_ladder_runs_from_life_goal_to_this_quarter_and_week(inputs):
    lad = we.goal_ladder(inputs, MON)
    assert lad["life_goals"][0]["id"] == "lg-chip-architect" and len(lad["five_year"]) == 2
    assert [m["id"] for m in lad["year"]["milestones"]] == ["y26-verilog"]
    assert lad["quarter"]["ends"] == "2026-12-31"
    assert [r["id"] for r in lad["quarter"]["items"]] == ["dl-internal-test", "dl-summer-school", "y26-verilog"]
    assert lad["week"]["ends"] == "2026-11-01" and len(lad["week"]["items"]) == 3
    verilog = next(w for w in lad["week"]["items"] if w["serves"] == "y26-verilog")
    assert verilog["skill"] == "hdl-verilog"                         # the biggest weighted gap of its skills goes first


def test_without_candidates_today_gets_at_most_three_steps_each_chained_to_a_goal(inputs):
    lad = we.goal_ladder(inputs, MON)
    assert 1 <= len(lad["today"]) <= 3
    for p in lad["today"]:
        assert p["serves"] and p["why"].startswith("Serves")
    chain = next(p for p in lad["today"] if p["serves"] == "y26-verilog")["chain"]
    assert [c["rung"] for c in chain] == ["life", "five_year", "year"]


def test_with_candidates_it_picks_three_by_the_goals_they_serve_with_variety(inputs):
    c = lambda key, node: {"key": key, "title": key, "minutes": 30, "node_id": node, "done": False}
    cands = [c("ml-intro/c1", "ml-intro"), c("hdl-verilog/c1", "hdl-verilog"), c("hdl-verilog/c2", "hdl-verilog"),
             c("fsm/c1", "fsm"), c("dl-basics/c1", "dl-basics"), {**c("fsm/c0", "fsm"), "done": True}]
    lad = we.goal_ladder(inputs, MON, candidates=cands, done={"dl-basics/c1"})
    keys = [p["key"] for p in lad["today"]]
    assert len(keys) == 3 and keys[0] == "hdl-verilog/c1"       # due soonest, biggest weight
    assert "fsm/c0" not in keys and "dl-basics/c1" not in keys   # done ones are skipped
    assert len({k.split("/")[0] for k in keys}) == 3             # one per node before any repeat
    ml = next(p for p in lad["today"] if p["key"] == "ml-intro/c1")
    assert ml["score"] == 0 and ml["serves"] is None             # its goal is next year: honest "serves no dated goal"


def test_an_empty_quarter_borrows_the_nearest_milestone_and_overdue_ones_drop(inputs):
    lad = we.goal_ladder(inputs, "2027-01-05")
    assert [r["id"] for r in lad["quarter"]["items"]] == ["y27-intern"] or lad["quarter"]["items"][0]["by"] <= "2027-03-31"
    assert "y26-verilog" not in {r["id"] for r in lad["quarter"]["items"]}
    assert we.goal_ladder(we.normalize_inputs({}), MON)["today"] == []


def test_quarter_end_and_urgency():
    assert [we.quarter_end(d) for d in ("2026-01-01", "2026-03-31", "2026-04-01", "2026-12-31")] == \
        ["2026-03-31", "2026-03-31", "2026-06-30", "2026-12-31"]
    assert we.urgency(-1) == 0 and we.urgency(3) == 1 and we.urgency(70) == 0.1 and we.urgency(None) == 0.1


# ------------------------------------------------------------------ 2. evidence: no action, no XP
def test_no_actions_no_xp(inputs):
    assert we.evidence(inputs, MON)["xp"] == 0 and we.evidence(inputs, MON, [])["ledger"] == []


def test_an_action_without_its_evidence_earns_nothing(inputs):
    acts = [{"kind": "log", "minutes": 0}, {"kind": "cert"}, {"kind": "cert", "url": "ftp://x"}, {"kind": "reps", "sets": [0, 0]},
            {"kind": "game_xp", "xp": 500}, {"kind": "money_saved", "amount": -5}, "junk",
            {"kind": "log", "minutes": 45}, {"kind": "cert", "url": "https://example.org/c"}, {"kind": "reps", "sets": [10, 12]}]
    ev = we.evidence(inputs, MON, acts)
    assert [x["i"] for x in ev["ledger"]] == [7, 8, 9]
    assert ev["xp"] == 10 + 150 + 10
    reasons = {r["i"]: r["reason"] for r in ev["rejected"]}
    assert "missing evidence: minutes" in reasons[0] and "no rule" in reasons[4] and reasons[6] == "not an action record"


def test_evidence_invariant_on_random_actions(inputs):
    rnd = random.Random(7)
    kinds = list(we.EVIDENCE_RULES) + ["game_xp", "", "streak"]
    for _ in range(300):
        acts = [{"kind": rnd.choice(kinds), "minutes": rnd.choice([0, 15, 90, None]), "url": rnd.choice(["", "https://x.y", None]),
                 "key": rnd.choice(["", "n/c1"]), "sets": rnd.choice([[], [0], [5]]), "amount": rnd.choice([0, 100]),
                 "what": rnd.choice(["", "read"]), "name": rnd.choice(["", "quiz"]), "xp": rnd.choice([0, 20])} for _ in range(8)]
        ev = we.evidence(inputs, MON, acts)
        assert ev["xp"] == sum(x["xp"] for x in ev["ledger"])
        assert len(ev["ledger"]) + len(ev["rejected"]) == len(acts)
        for x in ev["ledger"]:                                  # XP only where every required field is present
            a = acts[x["i"]]
            assert all(we._present(a, f) for f in we.EVIDENCE_RULES[a["kind"]][0])


@pytest.fixture()
def plan(tmp_path):
    d = tmp_path / "bank"
    d.mkdir()
    for n in g.BANK_FILES:
        shutil.copy(FIX / n, d / n)
    bank = g.load_bank(d)
    return g.Plan(g.KVStore(tmp_path / "kv", tmp_path / "bk"), bank_loader=lambda: bank, academics_loader=lambda: None)


def test_the_plan_audit_counts_logged_work_and_not_game_xp(plan, inputs):
    plan.add_xp(900, "crucible")
    assert plan.engines(MON, inputs)["evidence"]["xp"] == 0
    plan.log(60, "silicon", today=MON)
    e = plan.engines(MON, inputs)
    assert e["evidence"]["xp"] == 20 and any("no rule" in r["reason"] for r in e["evidence"]["rejected"])
    assert e["engines"]["goal_ladder"] == "ok" and e["engines"]["money"] == "not_built" and e["source"] == "example"
    assert len(e["ladder"]["today"]) <= 3


def test_engines_route(tmp_path, monkeypatch):
    d = tmp_path / "bank"
    d.mkdir()
    for n in g.BANK_FILES:
        shutil.copy(FIX / n, d / n)
    monkeypatch.setenv("JARVIS_MISSION_BANK", str(d))
    monkeypatch.setenv("JARVIS_ENGINE_INPUTS", str(tmp_path / "none.json"))
    monkeypatch.setattr(g, "ACADEMICS", tmp_path / "no-academics.json")
    app = create_app(Guard(8777, TOKEN, extra_hosts=["testserver"]), autostart_aankhen="off")
    with TestClient(app) as c:
        c.headers.update({"X-Jarvis-Token": TOKEN})
        c.app.state.svc.kv = g.KVStore(tmp_path / "kv", tmp_path / "bk")
        c.app.state.svc.plan.kv = c.app.state.svc.kv
        r = c.get("/api/mission/engines").json()
        assert r["source"] == "example" and "today" in r["ladder"] and set(r["engines"]) == set(we.ENGINES)
