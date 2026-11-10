"""Sharpen and de-master (ww_mastery.py, routes_ww_mastery.py) on the fixture skill tree:
dl-basics -> hdl-verilog -> {hdlbits, fsm} -> uart -> riscv-core. Every bank and store is a scratch one."""
import shutil
from pathlib import Path

import pytest
from starlette.testclient import TestClient

from jarvis_app import germoney as g
from jarvis_app import ww_bank_store, ww_mastery
from jarvis_app.security import Guard
from jarvis_app.server import create_app

FIX = Path(__file__).resolve().parents[1] / "ui" / "src" / "__tests__" / "fixtures" / "mission-bank"
DAY = "2026-11-10"
TOKEN = "mastery-token-123456"


@pytest.fixture(autouse=True)
def bank_dir(tmp_path, monkeypatch):
    monkeypatch.setenv("WW_BANK_DIR", str(tmp_path / "questions"))
    return tmp_path / "questions"


@pytest.fixture()
def plan(tmp_path):
    d = tmp_path / "bank"
    d.mkdir()
    for n in g.BANK_FILES:
        shutil.copy(FIX / n, d / n)
    bank = g.load_bank(d)
    return g.Plan(g.KVStore(tmp_path / "kv", tmp_path / "bk"), bank_loader=lambda: bank, academics_loader=lambda: None)


def master_chain(plan, *ids):
    for i in ids:
        r = plan.master_node(i, DAY)
        assert r["ok"], r


def add_gate(topic="Verilog state machines", ref="GATE 2024 EC Q31", n=1):
    for i in range(n):
        r = ww_bank_store.add_pointer("digital", "gate_official", "Official GATE papers", f"{ref} part {i}", topic)
        assert r["added"] == 1, r


def events(plan, note):
    return [e for e in plan.load(DAY)["events"] if e.get("kind") == "node" and e.get("note") == note]


# ------------------------------------------------------------------ sharpen
def test_sharpen_is_blocked_with_the_gate_reason_when_there_is_no_gate_bank(plan):
    master_chain(plan, "dl-basics")
    m = ww_mastery.mastery(plan, "dl-basics", DAY)
    assert m["sharpen"]["allowed"] is False and m["gate_bank"] == 0
    assert m["sharpen"]["blocker"] == ("Sharpen needs one GATE-tier question solved on this node. "
                                      "No GATE bank yet: the question harvester has fetched none.")
    r = ww_mastery.sharpen(plan, "dl-basics", DAY)
    assert r["ok"] is False and r["say"] == m["sharpen"]["blocker"]
    assert events(plan, "sharpened") == []


def test_sharpen_asks_for_a_solve_when_the_bank_has_gate_questions_but_none_is_recorded(plan):
    master_chain(plan, "dl-basics")
    add_gate(n=2)
    m = ww_mastery.mastery(plan, "dl-basics", DAY)
    assert "2 GATE-tier questions are on disk" in m["sharpen"]["blocker"]
    assert len(m["sharpen"]["candidates"]) == 2


def test_candidates_put_topic_matches_first(plan):
    master_chain(plan, "dl-basics")
    add_gate("Thermodynamics cycles", "GATE 2023 ME Q4")
    add_gate("Digital logic minimisation", "GATE 2022 EC Q9")
    c = ww_mastery.mastery(plan, "dl-basics", DAY)["sharpen"]["candidates"]
    assert [x["matched"] for x in c] == [True, False] and "minimisation" in c[0]["topic"]


def test_a_node_that_is_not_mastered_cannot_be_sharpened_or_take_a_solve(plan):
    add_gate()
    m = ww_mastery.mastery(plan, "dl-basics", DAY)
    assert m["sharpen"]["allowed"] is False and "Only a mastered node" in m["sharpen"]["blocker"]
    q = ww_mastery.gate_questions()[0]["id"]
    assert ww_mastery.record_gate_solve(plan, "dl-basics", q, DAY)["ok"] is False


def test_a_solve_must_be_a_real_gate_question(plan):
    master_chain(plan, "dl-basics")
    add_gate()
    r = ww_mastery.record_gate_solve(plan, "dl-basics", "h:digital:nope", DAY)
    assert r["ok"] is False and "not a GATE-tier question" in r["say"]


def test_sharpen_round_one_then_done_is_logged_and_a_second_round_needs_a_second_solve(plan):
    master_chain(plan, "dl-basics")
    add_gate(n=2)
    q1, q2 = [x["id"] for x in ww_mastery.gate_questions()]
    assert ww_mastery.record_gate_solve(plan, "dl-basics", q1, DAY)["ok"]
    assert ww_mastery.record_gate_solve(plan, "dl-basics", q1, DAY)["say"] == "Already recorded for this node."
    r = ww_mastery.sharpen(plan, "dl-basics", DAY)
    assert r["ok"] and r["round"] == 1
    # the node's two contracts again, each cap under its first time
    items = r["check"]["items"]
    assert len(items) == 2 and all(i["cap_minutes"] < i["minutes"] and i["harder"].startswith("Cold:") for i in items)
    assert [e["round"] for e in events(plan, "sharpened")] == [1]
    # mastered stays mastered: nothing above it moves
    assert g.node_status(plan.bank(), plan.load(DAY), "dl-basics") == "mastered"
    assert ww_mastery.sharpen(plan, "dl-basics", DAY)["ok"] is False        # a round is already open
    done = ww_mastery.finish_sharpen(plan, "dl-basics", DAY)
    assert done["ok"] and [e["round"] for e in events(plan, "re-proved")] == [1]
    assert ww_mastery.finish_sharpen(plan, "dl-basics", DAY)["ok"] is False  # nothing open now
    again = ww_mastery.mastery(plan, "dl-basics", DAY)["sharpen"]
    assert again["allowed"] is False and "solve one and record it" in again["blocker"] and again["reproved"] == 1
    ww_mastery.record_gate_solve(plan, "dl-basics", q2, DAY)
    r2 = ww_mastery.sharpen(plan, "dl-basics", DAY)
    assert r2["ok"] and r2["round"] == 2
    assert all(b["cap_minutes"] <= a["cap_minutes"] for a, b in zip(r["check"]["items"], r2["check"]["items"]))


def test_sharpen_gives_no_xp(plan):
    master_chain(plan, "dl-basics")
    add_gate()
    xp = plan.load(DAY)["xp"]
    ww_mastery.record_gate_solve(plan, "dl-basics", ww_mastery.gate_questions()[0]["id"], DAY)
    ww_mastery.sharpen(plan, "dl-basics", DAY)
    ww_mastery.finish_sharpen(plan, "dl-basics", DAY)
    assert plan.load(DAY)["xp"] == xp


# ------------------------------------------------------------------ de-master
def test_demaster_is_refused_while_anything_above_is_mastered_and_the_server_names_it(plan):
    master_chain(plan, "dl-basics", "hdl-verilog", "fsm")
    m = ww_mastery.mastery(plan, "dl-basics", DAY)["demaster"]
    assert m["allowed"] is False
    assert [(b["id"], b["now"]) for b in m["blockers"]] == [("hdl-verilog", False), ("fsm", True)]
    assert m["first"] == ["fsm"]
    assert "Verilog fundamentals, Finite state machines are above it" in m["blocker"] and "De-master Finite state machines first." in m["blocker"]
    r = ww_mastery.demaster(plan, "dl-basics", DAY)
    assert r["ok"] is False and r["first"] == ["fsm"] and "Finite state machines" in r["say"]
    assert g.node_status(plan.bank(), plan.load(DAY), "dl-basics") == "mastered"
    assert events(plan, "de-mastered") == []


def test_a_node_in_progress_above_also_blocks_and_says_to_pause(plan):
    master_chain(plan, "dl-basics", "hdl-verilog")
    assert plan.start_node("fsm", DAY)["ok"]
    m = ww_mastery.mastery(plan, "hdl-verilog", DAY)["demaster"]
    assert m["allowed"] is False and m["blockers"][0]["status"] == "in_progress" and m["first"] == []
    assert "Pause what is in progress" in m["blocker"]


def test_demaster_from_the_top_down_reopens_each_node_and_logs_it(plan):
    master_chain(plan, "dl-basics", "hdl-verilog")
    xp = plan.load(DAY)["xp"]
    assert ww_mastery.demaster(plan, "dl-basics", DAY)["ok"] is False
    r = ww_mastery.demaster(plan, "hdl-verilog", DAY)
    assert r["ok"] and r["xp_back"] == 50 and r["xp"] == xp - 50
    st, bank = plan.load(DAY), plan.bank()
    assert g.node_status(bank, st, "hdl-verilog") == "available"
    assert [e["node"] for e in events(plan, "de-mastered")] == ["hdl-verilog"]
    assert ww_mastery.demaster(plan, "dl-basics", DAY)["ok"]
    assert g.node_status(bank, plan.load(DAY), "hdl-verilog") == "locked"          # its prerequisite is open again
    assert ww_mastery.demaster(plan, "dl-basics", DAY)["ok"] is False             # no longer mastered
    assert "Only a mastered node" in ww_mastery.mastery(plan, "dl-basics", DAY)["demaster"]["blocker"]


def test_master_demaster_master_does_not_farm_xp(plan):
    plan.master_node("dl-basics", DAY)
    once = plan.load(DAY)["xp"]
    ww_mastery.demaster(plan, "dl-basics", DAY)
    plan.master_node("dl-basics", DAY)
    assert plan.load(DAY)["xp"] == once


def test_demaster_never_takes_xp_below_zero_and_drops_an_open_sharpen_round(plan):
    master_chain(plan, "dl-basics")
    add_gate()
    ww_mastery.record_gate_solve(plan, "dl-basics", ww_mastery.gate_questions()[0]["id"], DAY)
    ww_mastery.sharpen(plan, "dl-basics", DAY)
    st = plan.load(DAY)
    st["xp"] = 20
    plan.save(st)
    r = ww_mastery.demaster(plan, "dl-basics", DAY)
    assert r["ok"] and r["xp"] == 0 and r["xp_back"] == 20
    assert "sharpen" not in plan.load(DAY)["nodes"]["dl-basics"]


def test_unknown_node_is_a_key_error(plan):
    with pytest.raises(KeyError):
        ww_mastery.mastery(plan, "nope", DAY)


def test_master_node_itself_is_unchanged(plan):
    r = plan.master_node("dl-basics", DAY)
    assert r == {"ok": True, "say": "Digital logic basics mastered. Plus 50 XP."}
    assert plan.master_node("dl-basics", DAY) == {"ok": True, "say": "Already mastered."}
    assert plan.master_node("riscv-core", DAY)["ok"] is False


# ------------------------------------------------------------------ the routes
@pytest.fixture()
def client(plan):
    app = create_app(Guard(8777, TOKEN, extra_hosts=["testserver"]), autostart_aankhen="off", features=["mission", "ww_mastery"])
    with TestClient(app) as c:
        c.headers.update({"X-Jarvis-Token": TOKEN})
        c.app.state.svc.plan = plan                    # the fixture plan on a scratch store, read by the route at request time
        yield c


def test_routes_round_trip_and_never_collide_with_the_node_catch_all(client, plan):
    master_chain(plan, "dl-basics", "hdl-verilog")
    r = client.get("/api/mission/mastery/dl-basics")
    assert r.status_code == 200 and r.json()["demaster"]["blockers"][0]["id"] == "hdl-verilog"
    blocked = client.post("/api/mission/mastery/dl-basics/demaster")
    assert blocked.status_code == 200 and blocked.json()["ok"] is False and blocked.json()["first"] == ["hdl-verilog"]
    ok = client.post("/api/mission/mastery/hdl-verilog/demaster")
    assert ok.status_code == 200 and ok.json()["ok"] is True
    assert client.post("/api/mission/mastery/hdl-verilog/sharpen").json()["ok"] is False
    assert client.post("/api/mission/mastery/hdl-verilog/wat").status_code == 400
    assert client.get("/api/mission/mastery/nope").status_code == 404
    # the old catch-all still says what it said
    assert client.post("/api/mission/node/dl-basics/sharpen").status_code == 400


def test_route_gate_solve_then_sharpen(client, plan):
    master_chain(plan, "dl-basics")
    add_gate()
    q = ww_mastery.gate_questions()[0]["id"]
    assert client.post("/api/mission/mastery/dl-basics/gate-solve", json={"question_id": q}).json()["ok"]
    s = client.post("/api/mission/mastery/dl-basics/sharpen").json()
    assert s["ok"] and s["round"] == 1
    assert client.post("/api/mission/mastery/dl-basics/sharpen-done").json()["ok"]
