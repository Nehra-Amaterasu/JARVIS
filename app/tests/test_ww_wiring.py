"""Well Wisher engines wired into the plan: Today's 3 from goal ladder + career +
personality, the weekly-review card, the money log, the routes under /api/mission/
and the spoken "weekly review". Fictional bank fixture and fictional example inputs."""
import shutil
from pathlib import Path

import pytest
from starlette.testclient import TestClient

from jarvis_app import germoney as g
from jarvis_app import ww_base as wb
from jarvis_app import ww_engines as we
from jarvis_app.security import Guard
from jarvis_app.server import create_app

FIX = Path(__file__).resolve().parents[1] / "ui" / "src" / "__tests__" / "fixtures" / "mission-bank"
MON = "2026-10-26"
TOKEN = "t" * 32


@pytest.fixture()
def inputs():
    return we.load_inputs(Path("no-such-inputs.json"))


@pytest.fixture()
def plan(tmp_path):
    d = tmp_path / "bank"
    d.mkdir()
    for n in g.BANK_FILES:
        shutil.copy(FIX / n, d / n)
    bank = g.load_bank(d)
    apps = g.Applications(calendar=tmp_path / "no-calendar.json", store=tmp_path / "apps.json")
    return g.Plan(g.KVStore(tmp_path / "kv", tmp_path / "bk"), bank_loader=lambda: bank, academics_loader=lambda: None, apps=apps)


# ------------------------------------------------------------------ Today's 3 (pure composition)
def C(key, node, minutes=45, branch="digital", **kw):
    return {"key": key, "title": f"{node} contract", "node_id": node, "minutes": minutes, "branch": branch, "source": "tree",
            "success_check": "the check passes", "done": False, **kw}


CANDS = [C("hdl-verilog/c1", "hdl-verilog"), C("hdl-verilog/c2", "hdl-verilog"), C("fsm/c1", "fsm", 30),
         C("ml-intro/c1", "ml-intro", 60, "ml"), C("dl-basics/c1", "dl-basics", done=True)]


def test_today_three_names_the_engines_behind_each_pick(inputs):
    t = we.today_three(inputs, MON, candidates=CANDS)
    assert t["mode"] == "normal" and t["n"] == 3 and len(t["picks"]) == 3
    keys = [p["key"] for p in t["picks"]]
    assert keys[0] == "hdl-verilog/c1" and "dl-basics/c1" not in keys
    assert len({k.split("/")[0] for k in keys}) == 3                       # one per node
    for p in t["picks"]:
        assert p["engines"][0] == "goal_ladder" and p["engines"][-1] == "personality"
        assert p["frame"].startswith("Contract: ") and "Done when: the check passes" in p["frame"]
        assert p["why"] and wb.no_shame(p["why"] + p["frame"])
    top = t["picks"][0]
    assert "career" in top["engines"] and "Career: Example summer research programme closes asks for it (35 days left)" in top["why"]
    assert t["career_next"]["id"] == "dl-summer-school" and t["cap"]["cap"] == 3
    assert t["versions"] == {"goal_ladder": 2, "career": 1, "personality": 1}


def test_career_lifts_a_contract_the_next_career_step_asks_for(inputs):
    plain = we.today_three(inputs, MON, candidates=CANDS)
    boosted = {p["key"]: p["score"] for p in plain["picks"]}
    lad = {p["key"]: p["score"] for p in we.goal_ladder(inputs, MON, candidates=CANDS, n=10)["today"]}
    assert boosted["hdl-verilog/c1"] > lad["hdl-verilog/c1"]               # hdl-verilog is asked for by two career items
    assert boosted["fsm/c1"] == lad["fsm/c1"]                              # fsm is not


def test_after_a_gap_today_is_two_and_the_shortest_comes_first(inputs):
    t = we.today_three(inputs, MON, candidates=CANDS, active_days=["2026-10-19"])
    assert t["mode"] == "recovery" and len(t["picks"]) == 2
    assert t["picks"][0]["minutes"] == 15 and "A 15-minute version" in t["picks"][0]["frame"]
    assert t["welcome_back"].startswith("Welcome back. 6 days off happens.")


def test_no_candidates_falls_back_to_the_ladders_own_steps(inputs):
    t = we.today_three(inputs, MON)
    assert 1 <= len(t["picks"]) <= 3 and all(p["key"].startswith("ladder/") for p in t["picks"])


# ------------------------------------------------------------------ the plan: Today, money log, engines
def test_today_carries_the_three_and_the_weekly_card(plan):
    plan.log(45, "silicon", today="2026-10-21")
    t = plan.today(MON)
    three, weekly = t["three"], t["weekly"]
    assert three and three["source"] == "example" and 1 <= len(three["picks"]) <= 3
    open_keys = {c["key"] for c in t["contracts"] if not c["done"]}
    assert all(p["key"] in open_keys for p in three["picks"])              # only contracts that are on today's list
    assert weekly and weekly["totals"].startswith("1/7 active days, 45 minutes")
    assert weekly["say"].startswith("Weekly review, 2026-10-20 to 2026-10-26") and weekly["change"]["text"]


def test_a_broken_inputs_file_never_takes_the_day_down(plan, monkeypatch):
    monkeypatch.setattr(we, "load_inputs", lambda *a, **k: (_ for _ in ()).throw(RuntimeError("bad file")))
    t = plan.today(MON)
    assert t["three"] is None and t["weekly"] is None and t["contracts"]


def test_the_money_log_feeds_the_money_engine_and_the_evidence(plan):
    plan.money_log({"kind": "income", "amount": 9000, "date": "2026-10-02"}, today=MON)
    plan.money_log({"kind": "saving", "amount": 1500, "date": "2026-10-03"}, today=MON)
    r = plan.money_log({"kind": "experiment", "amount": 900, "hours": 3, "experiment": "ie-tutoring", "date": "2026-09-20"}, today=MON)
    assert r["say"] == "Logged experiment: Rs 900 for 3 h." and r["entry"]["id"] == "m3"
    for bad in ({"kind": "lottery", "amount": 5}, {"kind": "income", "amount": -1}, {"kind": "income", "amount": "lots"},
                {"kind": "income", "amount": 5, "date": "2026-11-30"}, {"kind": "experiment", "amount": 5},
                {"kind": "income", "amount": 5, "hours": 5000}):
        with pytest.raises(ValueError):
            plan.money_log(bad, today=MON)
    m = plan.engine("money", MON)
    assert m["status"] == "ok" and m["this_month"]["saved"] == 1500 and m["this_month"]["income"] == 9000
    tut = {x["id"]: x for x in m["experiments"]}["ie-tutoring"]
    assert tut["rupees_per_hour"] == 300 and tut["scored"]                 # 5 weeks of log by MON
    assert any(a["kind"] == "money_saved" for a in we.actions_from_plan(plan.load(MON)))
    plan.money_remove("m1", today=MON)
    assert plan.engine("money", MON)["this_month"]["income"] == 0
    with pytest.raises(KeyError):
        plan.money_remove("m1", today=MON)


def test_engines_report_every_engine_and_one_runs_by_name(plan):
    e = plan.engines(MON, we.load_inputs(Path("no-such-inputs.json")))
    assert {e["engines"][k] for k in ("career", "money", "personality", "insight")} == {"ok"}
    assert e["engines"]["body"] == "ok" and e["career"]["next"]["id"] == "dl-summer-school"
    assert [r["name"] for r in e["registry"]] == list(we.REGISTRY) and e["three"]["picks"]
    assert plan.engine("insight", MON)["status"] == "ok"
    with pytest.raises(KeyError):
        plan.engine("astrology", MON)


def test_weekly_review_by_voice(plan):
    plan.log(30, "deutsch", today="2026-10-22")
    r = g.voice(plan, "weekly_review", {}, today=MON)
    assert r["ok"] and r["say"].startswith("Weekly review, 2026-10-20 to 2026-10-26: 1/7 active days, 30 minutes")
    c = g.voice(plan, "career_next", {}, today=MON)
    assert c["ok"] and c["say"].startswith("Next career step:")


# ------------------------------------------------------------------ routes
def test_routes(tmp_path, monkeypatch):
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
        assert c.get("/api/mission/engine/career").json()["engine"] == "career"
        assert c.get("/api/mission/engine/nope").status_code == 404
        assert c.get("/api/mission/weekly").json()["say"].startswith("Weekly review")
        assert c.post("/api/mission/money", json={"kind": "saving", "amount": 500}).json()["ok"]
        assert c.post("/api/mission/money", json={"entry": {"kind": "saving", "amount": -5}}).status_code == 400
        m = c.get("/api/mission/money").json()
        assert m["engine"] == "money" and m["this_month"]["saved"] == 500 and "not investment advice" in m["label"]
        assert c.delete("/api/mission/money/m1").json()["ok"] and c.delete("/api/mission/money/m1").status_code == 404
        t = c.get("/api/mission/today").json()
        assert "three" in t and "weekly" in t
        assert c.post("/api/mission/voice", json={"intent": "weekly_review", "args": {}}).json()["say"].startswith("Weekly review")
