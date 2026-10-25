"""Well Wisher v1 (wellwisher.py on top of the Mission plan engine): the Status
window's stats are derived from logged actions only, rank-ups need proof, and the
optional calisthenics quest line moves a level only when its standard is logged on
two different days. Fixtures are the shared fictional mission bank; no personal data."""
import json
import shutil
from pathlib import Path

import pytest
from starlette.testclient import TestClient

from jarvis_app import germoney as g
from jarvis_app import wellwisher as ww
from jarvis_app.security import Guard
from jarvis_app.server import create_app

FIX = Path(__file__).resolve().parents[1] / "ui" / "src" / "__tests__" / "fixtures"
BANK = FIX / "mission-bank"
MON, TUE, WED = "2026-10-26", "2026-10-27", "2026-10-28"
TOKEN = "t" * 32


@pytest.fixture()
def bank(tmp_path):
    d = tmp_path / "bank"
    d.mkdir()
    for n in g.BANK_FILES:
        shutil.copy(BANK / n, d / n)
    return g.load_bank(d)


@pytest.fixture()
def plan(tmp_path, bank):
    kv = g.KVStore(tmp_path / "kv", tmp_path / "bk")
    return g.Plan(kv, bank_loader=lambda: bank, academics_loader=lambda: None)


def values(plan, today=MON):
    return {s["id"]: s["value"] for s in plan.status(today)["stats"]}


# ------------------------------------------------------------------ the quest-line bank
def test_the_real_questlines_file_loads_clean_and_holds_a_calisthenics_progression():
    lines = ww.load_questlines()
    assert lines["warnings"] == [] and lines["order"] == ["fitness"]
    fit = lines["lines"]["fitness"]
    assert [t["id"] for t in fit["tracks"]] == ["push", "pull", "legs", "core"]
    for t in fit["tracks"]:
        ns = [lv["n"] for lv in t["levels"]]
        assert ns == list(range(1, len(ns) + 1)) and len(ns) >= 5
        assert all(lv["unit"] in ww.UNITS and 1 <= lv["sets"] <= ww.MAX_SETS and lv["cue"] for lv in t["levels"])
    assert fit["sessions_to_rank"] == 2 and fit["minutes"] <= 20 and "not medical advice" in fit["safety"]


def test_a_bad_level_is_dropped_with_a_warning(tmp_path):
    raw = {"lines": [{"id": "x", "tracks": [{"id": "a", "levels": [{"n": 1, "name": "ok", "sets": 3, "target": 5, "unit": "reps"},
                                                                    {"n": 2, "name": "bad unit", "sets": 3, "target": 5, "unit": "kg"},
                                                                    {"n": 3, "name": "no sets", "sets": 0, "target": 5, "unit": "reps"}]}]},
                       {"id": "empty", "tracks": []}]}
    (tmp_path / ww.QUESTLINES_FILE).write_text(json.dumps(raw), encoding="utf-8")
    lines = ww.load_questlines(tmp_path)
    assert [lv["n"] for lv in lines["lines"]["x"]["tracks"][0]["levels"]] == [1]
    assert len(lines["warnings"]) == 3 and "empty" not in lines["lines"]
    assert ww.load_questlines(tmp_path / "missing") == {"lines": {}, "order": [], "warnings": []}


# ------------------------------------------------------------------ stats: no stat moves without a logged action
def test_every_stat_starts_at_zero_and_explains_itself(plan):
    s = plan.status(MON)
    assert [x["id"] for x in s["stats"]] == ["knowledge", "focus", "consistency", "proof", "recall", "vitality"]
    for x in s["stats"]:
        assert x["value"] == 0 and x["explain"] and isinstance(x["inputs"], dict)
    assert s["rank"]["rank"] == "E" and s["rank"]["next"]["rank"] == "D"
    assert "you decide" in s["rule"].lower()


def test_no_stat_moves_without_a_logged_action(plan, bank):
    before = values(plan)
    plan.today(MON)                                   # planning the day
    plan.reroll(MON)
    plan.start_node("ml-intro", MON)                  # starting is not doing
    plan.pause_node("ml-intro", MON)
    plan.master_node("dl-basics", MON)                # a claim with no finished contract
    plan.add_xp(2000, "crucible")                     # window-game XP: no logged action behind it
    plan.set_career(bank["careers"][0]["id"])
    plan.park("an idea", today=MON)
    plan.set_settings(window_days=10)
    plan.quest_set("fitness", True, {"push": 4}, MON)  # a placement is where he chooses to start, not an earned level
    plan.quest_set("fitness", False, None, MON)
    after = plan.status(MON)
    assert values(plan) == before
    assert after["not_counted"]["xp_from_games"] == 2000 and after["not_counted"]["nodes_claimed"] == ["dl-basics"]
    assert after["xp"] >= 2050 and after["level"]["level"] > 1 and after["rank"]["rank"] == "E"   # XP level moved, rank did not


def test_each_logged_action_moves_exactly_its_stats(plan, bank):
    c1, c2 = (f"dl-basics/{c['id']}" for c in bank["nodes"]["dl-basics"]["contracts"])
    plan.complete(c1, "", today=MON)                  # on his word: Knowledge, Focus, Consistency
    v = values(plan)
    assert v["knowledge"] == 1 and v["focus"] == 0 and v["consistency"] == 1 and v["proof"] == 0
    plan.complete(c2, "https://github.com/example/dl-basics", today=MON)   # a link, and the node masters with it
    v = values(plan)
    assert v["knowledge"] == 5 + 2 and v["proof"] == 1
    plan.log(120, "silicon", today=TUE)
    v2 = values(plan, TUE)
    assert v2["consistency"] == 2 and v2["knowledge"] == v["knowledge"] and v2["recall"] == 0
    mins = plan.status(TUE)["stats"][1]["inputs"]
    assert v2["focus"] == (mins["contract"] + mins["log"] + mins["learning"]) // 60 and mins["log"] == 120
    for s in plan.status(TUE)["stats"]:               # the sentence states the number it produced
        assert str(s["value"]) in s["explain"] or s["id"] in ("focus", "recall")


def test_consistency_counts_only_the_last_30_days(plan):
    plan.log(30, "silicon", today="2026-09-01")
    plan.log(30, "silicon", today=MON)
    assert values(plan, MON)["consistency"] == 1


def test_trimmed_events_still_count(plan):
    st = plan.load(MON)
    for i in range(1700):
        plan._event(st, MON, "log", minutes=30, xp=10)
    plan._event(st, MON, "xp", xp=40, note="crucible")
    total = len(st["events"])                         # + the migrate event the first load wrote
    plan.save(st)                                     # keeps the last 1500 events, folds the rest
    st = plan.load(MON)
    assert len(st["events"]) == 1500 and st["archive"]["events"] == total - 1500
    s = plan.status(MON)
    assert values(plan)["focus"] == 1700 * 30 // 60 and s["not_counted"]["xp_from_games"] == 40


def test_a_rank_up_needs_proof_not_xp(plan, bank):
    for _ in range(5):
        plan.add_xp(2000, "drill")
    assert plan.status(MON)["rank"]["rank"] == "E"
    plan.log(600, "silicon", today=MON)               # 10 hours, but no node done yet
    r = plan.status(MON)["rank"]
    assert r["rank"] == "E" and [m["req"] for m in r["next"]["missing"]] == ["nodes"]
    for c in bank["nodes"]["dl-basics"]["contracts"]:
        plan.complete(f"dl-basics/{c['id']}", "", today=MON)
    r = plan.status(MON)["rank"]
    assert r["rank"] == "D" and r["next"]["rank"] == "C"
    assert {m["req"] for m in r["next"]["missing"]} == {"hours", "nodes", "proof"}


def test_advice_is_a_suggestion_and_points_at_the_optional_quest_line(plan):
    adv = plan.status(MON)["advice"]
    assert adv and len(adv) <= 3 and any("Optional" in a for a in adv)
    assert not any(a.lower().startswith(("you must", "do ")) for a in adv)


# ------------------------------------------------------------------ the calisthenics quest line
def quest_of(plan, today):
    return [c for c in plan.today(today)["contracts"] if c["source"] == "quest"]


def test_the_quest_line_is_off_until_he_turns_it_on(plan):
    assert quest_of(plan, MON) == []
    with pytest.raises(ValueError):
        plan.quest_log("fitness", "push", [15, 15, 15], today=MON)
    with pytest.raises(KeyError):
        plan.quest_set("swimming", True, None, MON)
    with pytest.raises(ValueError):
        plan.quest_set("fitness", True, {"push": 99}, MON)


def test_turned_on_it_adds_one_small_contract_to_today(plan):
    n_before = len(plan.today(MON)["contracts"])
    plan.quest_set("fitness", True, None, MON)
    t = plan.today(MON)
    q = [c for c in t["contracts"] if c["source"] == "quest"]
    assert len(t["contracts"]) == n_before + 1 and len(q) == 1
    c = q[0]
    assert c["key"] == f"quest/fitness/push/{MON}" and c["slot"] == "quest" and c["minutes"] == 15 and c["xp"] == 10
    assert c["quest"]["level"] == 1 and c["quest"]["need"] == 2 and "3 x 15" in c["title"] and c["steps"] and c["hint"]
    assert plan.status(MON)["domains"][0]["status"] == "on"


def test_a_level_goes_up_only_when_the_standard_holds_on_two_different_days(plan):
    plan.quest_set("fitness", True, None, MON)
    xp0 = plan.state(MON)["xp"]
    r = plan.quest_log("fitness", "push", [15, 16, 15], today=MON)
    assert r["met"] and not r["ranked_up"] and r["level_after"] == 1 and r["hits"] == [MON]
    assert plan.state(MON)["xp"] == xp0 + 10                          # the session XP, once
    assert quest_of(plan, MON)[0]["done"]
    r = plan.quest_log("fitness", "push", [20, 20, 20], today=MON)    # same day again: no second hit, no XP
    assert r["hits"] == [MON] and not r["ranked_up"] and plan.state(MON)["xp"] == xp0 + 10
    assert quest_of(plan, TUE)[0]["quest"]["track"] == "pull"         # push rests; the rested-longest track is next
    r = plan.quest_log("fitness", "push", [15, 15, 15], today=TUE)    # the second day at the standard
    assert r["ranked_up"] and r["level_after"] == 2 and r["hits"] == []
    assert plan.state(TUE)["xp"] == xp0 + 10 + 10 + 25
    assert any(e["kind"] == "rankup" for e in plan.state(TUE)["events"])
    v = values(plan, TUE)
    assert v["vitality"] == 3 + 3                                     # 3 sessions + 3 per earned level


def test_below_the_standard_is_logged_but_never_ranks(plan):
    plan.quest_set("fitness", True, {"core": 2}, MON)                # placement: plank 3 x 45 s
    for day in (MON, TUE, WED):
        r = plan.quest_log("fitness", "core", [45, 45, 30], today=day)
        assert not r["met"] and r["level_after"] == 2
    assert values(plan, WED)["vitality"] == 3
    assert plan.status(WED)["domains"][0]["tracks"][3]["earned"] == 0


def test_a_placement_sets_the_work_not_the_stat(plan):
    plan.quest_set("fitness", True, {"pull": 6}, MON)
    c = plan.quests(MON)["lines"][0]
    assert c["record"]["levels"]["pull"] == 6 and c["record"]["earned"]["pull"] == 0
    assert values(plan)["vitality"] == 0


def test_bad_sessions_are_refused(plan):
    plan.quest_set("fitness", True, None, MON)
    for bad in ([], "15", [15] * 11, [15, "x"], [-1], [5000]):
        with pytest.raises(ValueError):
            plan.quest_log("fitness", "push", bad, today=MON)
    with pytest.raises(KeyError):
        plan.quest_log("fitness", "dance", [10], today=MON)
    assert values(plan)["vitality"] == 0 and plan.state(MON)["contracts"] == {}


def test_finishing_the_quest_contract_without_numbers_counts_the_time_not_the_level(plan):
    plan.quest_set("fitness", True, None, MON)
    key = quest_of(plan, MON)[0]["key"]
    r = plan.complete(key, "", today=MON)
    assert r["ok"] and r["xp"] >= 10
    v = values(plan)
    assert v["vitality"] == 0 and v["consistency"] == 1
    with pytest.raises(KeyError):                                     # a quest belongs to its own day
        plan.complete(f"quest/fitness/push/{TUE}", "", today=MON)


def test_quests_view_never_writes_a_record(plan):
    plan.quests(MON)
    assert plan.load(MON)["quests"] == {}


# ------------------------------------------------------------------ the routes
@pytest.fixture()
def client(tmp_path, monkeypatch):
    d = tmp_path / "bank"
    d.mkdir()
    for n in g.BANK_FILES:
        shutil.copy(BANK / n, d / n)
    shutil.copy(g.BANK_DIR / ww.QUESTLINES_FILE, d / ww.QUESTLINES_FILE)
    monkeypatch.setenv("JARVIS_MISSION_BANK", str(d))
    monkeypatch.setattr(g, "ACADEMICS", tmp_path / "no-academics.json")
    app = create_app(Guard(8777, TOKEN, extra_hosts=["testserver"]), autostart_aankhen="off")
    with TestClient(app) as c:
        c.headers.update({"X-Jarvis-Token": TOKEN})
        c.app.state.svc.kv = g.KVStore(tmp_path / "kv", tmp_path / "bk")
        c.app.state.svc.plan.kv = c.app.state.svc.kv
        yield c


def test_status_and_quest_routes_round_trip(client):
    s = client.get("/api/mission/status").json()
    assert len(s["stats"]) == 6 and all(x["explain"] for x in s["stats"]) and s["rank"]["rank"] == "E"
    assert client.get("/api/mission/quests").json()["lines"][0]["id"] == "fitness"
    assert client.put("/api/mission/quest/nope", json={"on": True}).status_code == 404
    assert client.put("/api/mission/quest/fitness", json={"on": True, "levels": []}).status_code == 400
    assert client.post("/api/mission/quest/fitness/log", json={"track": "push", "sets": [15, 15, 15]}).status_code == 400  # off
    assert client.put("/api/mission/quest/fitness", json={"on": True}).json()["ok"]
    assert any(c["source"] == "quest" for c in client.get("/api/mission/today").json()["contracts"])
    assert client.post("/api/mission/quest/fitness/log", json={"track": "push", "sets": "lots"}).status_code == 400
    r = client.post("/api/mission/quest/fitness/log", json={"track": "push", "sets": [15, 15, 15]}).json()
    assert r["ok"] and r["met"] and "XP" in r["say"]
    assert client.get("/api/mission/status").json()["stats"][5]["value"] == 1
