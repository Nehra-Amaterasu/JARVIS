"""Mission Germoney v2: the bank loader, the skill tree as a DAG, the contract engine
(rotation, WIP cap, exam mode, campaigns), the one XP total, the voice intents and
the findings digest. The fixtures are shared with the UI tests
(app/ui/src/__tests__/fixtures), so both loaders read the same files."""
import json
import shutil
from datetime import date, datetime, timedelta
from pathlib import Path

import pytest
from starlette.testclient import TestClient

from jarvis_app import germoney as g
from jarvis_app.security import Guard
from jarvis_app.server import create_app

FIX = Path(__file__).resolve().parents[1] / "ui" / "src" / "__tests__" / "fixtures"
BANK = FIX / "mission-bank"
MON, TUE, WED, THU, FRI, SAT = "2026-10-26", "2026-10-27", "2026-10-28", "2026-10-29", "2026-10-30", "2026-10-31"


def bank_from(tmp: Path, *names: str) -> Path:
    d = tmp / "bank"
    d.mkdir(exist_ok=True)
    for n in names:
        shutil.copy(BANK / n, d / n)
    return d


@pytest.fixture()
def bank(tmp_path):
    return g.load_bank(bank_from(tmp_path, *g.BANK_FILES))


@pytest.fixture()
def plan(tmp_path, bank):
    kv = g.KVStore(tmp_path / "kv", tmp_path / "bk")
    return g.Plan(kv, bank_loader=lambda: bank, academics_loader=lambda: None)


@pytest.fixture()
def acad(tmp_path):
    p = tmp_path / "ac" / "academics.json"
    p.parent.mkdir()
    shutil.copy(FIX / "academics.json", p)
    shutil.copy(FIX / "math-rescue.json", p.parent / "math-rescue.json")
    return p


@pytest.fixture()
def exam_plan(tmp_path, bank, acad):
    kv = g.KVStore(tmp_path / "kv-e", tmp_path / "bk-e")
    return g.Plan(kv, bank_loader=lambda: bank, academics_loader=lambda: g.load_academics(acad))


def test_the_fixture_dates_are_the_weekdays_the_tests_assume():
    assert [date.fromisoformat(d).isoweekday() for d in (MON, TUE, WED, THU, FRI, SAT)] == [1, 2, 3, 4, 5, 6]


# ------------------------------------------------------------------ the bank
def test_bank_merges_every_file_and_warns_about_unknown_ids(bank):
    assert len(bank["order"]) == 10                      # 8 tree nodes + 2 math nodes
    assert bank["nodes"]["m-calc"]["branch"] == "math"   # math-track nodes default to the math branch
    assert "r-khan-calc" in bank["resources"] and "r-nand2tetris" in bank["resources"]
    w = " | ".join(bank["warnings"])
    assert "unknown prerequisite ghost-prereq" in w and "unknown resource r-missing" in w
    assert "career vlsi: unknown node ghost-node" in w and "certificate cert-nptel-verilog: unknown node nope-node" in w
    assert bank["nodes"]["uart"]["prereqs"] == ["fsm", "hdlbits"]       # the bad reference is dropped
    assert bank["errors"] == []
    assert g.practice_rules(bank) == ["5 min mental sprint", "15 min due reviews"]   # rules as an object, as in the real bank
    assert bank["resources"]["r-khan-calc"]["covers"] == ["derivatives, chain rule"]  # a string is a list of one
    assert bank["contract_index"]["m-calc.c02"] == "m-calc"


def test_a_cert_id_that_is_a_resource_uses_the_resources_certificate(bank):
    # math-track lists resource ids in a node's certs (seen in the real bank, 2026-10-23)
    assert "r-khan-calc" in bank["certs"] and bank["certs"]["r-khan-calc"]["node_ids"] == ["m-calc"]
    assert bank["nodes"]["m-calc"]["certs"] == ["r-khan-calc"]
    assert any("is a resource, not in certs.json" in w for w in bank["warnings"])


def test_bank_works_with_any_subset(tmp_path):
    only_tree = g.load_bank(bank_from(tmp_path, "skilltree.json"))
    assert len(only_tree["order"]) == 8 and only_tree["resources"] == {}
    assert only_tree["nodes"]["hdl-verilog"]["certs"] == ["cert-nptel-verilog"]   # no certs file: kept, not judged
    assert g.load_bank(tmp_path / "nothing-here")["order"] == []


def test_a_prerequisite_cycle_is_an_error():
    files = {"skilltree.json": {"nodes": [
        {"id": "a", "name": "A", "branch": "x", "prereqs": ["c"]},
        {"id": "b", "name": "B", "branch": "x", "prereqs": ["a"]},
        {"id": "c", "name": "C", "branch": "x", "prereqs": ["b"]},
        {"id": "d", "name": "D", "branch": "x", "prereqs": []}]}}
    b = g.merge_bank(files)
    assert len(b["errors"]) == 1 and "cycle" in b["errors"][0]


def test_broken_json_is_reported_not_raised(tmp_path):
    d = bank_from(tmp_path, "certs.json")
    (d / "skilltree.json").write_text("{nope", encoding="utf-8")
    b = g.load_bank(d)
    assert any("not valid JSON" in e for e in b["errors"]) and b["certs"]


# ------------------------------------------------------------------ the tree as a DAG
def test_status_flows_locked_available_in_progress_mastered(plan, bank):
    st = plan.load(MON)
    s = g.statuses(bank, st)
    assert s["dl-basics"] == "available" and s["hdl-verilog"] == "locked" and s["ml-intro"] == "available"
    plan.complete("dl-basics/c1", today=MON)
    assert g.statuses(bank, plan.load(MON))["dl-basics"] == "in_progress"
    r = plan.complete("dl-basics/c2", today=MON)
    assert r["mastered"] == "dl-basics"                      # every contract done -> mastered
    s = g.statuses(bank, plan.load(MON))
    assert s["dl-basics"] == "mastered" and s["hdl-verilog"] == "available"


def test_the_wip_cap_refuses_a_fourth_and_pausing_makes_room(plan):
    assert plan.load(MON)["wip_cap"] == 3
    for n in ("dl-basics", "ml-intro", "m-calc"):
        assert plan.start_node(n, today=MON)["ok"]
    plan.master_node("dl-basics", today=MON)
    assert plan.start_node("hdl-verilog", today=MON)["ok"]   # dl-basics mastered: room again
    assert not plan.start_node("systolic", today=MON)["ok"]  # locked: ml-intro is not mastered
    plan.master_node("ml-intro", today=MON)
    plan.master_node("hdl-verilog", today=MON)
    assert plan.start_node("systolic", today=MON)["ok"] and plan.start_node("fsm", today=MON)["ok"]
    assert sorted(g.wip(plan.bank(), plan.load(MON))) == ["fsm", "m-calc", "systolic"]
    r = plan.start_node("hdlbits", today=MON)
    assert not r["ok"] and r["cap"] and "pause one" in r["say"]
    plan.pause_node("m-calc", today=MON)
    assert plan.start_node("hdlbits", today=MON)["ok"]


def test_attributes_record_certs_projects_and_achievements_with_links(plan):
    plan.add_attribute("hdl-verilog", "cert", "NPTEL Verilog", "https://nptel.ac.in/x", cert="cert-nptel-verilog", today=MON)
    plan.add_attribute("fsm", "project", "FSM suite", "https://github.com/aman/fsm", today=MON)
    st = plan.load(MON)
    assert st["nodes"]["hdl-verilog"]["attributes"]["certs"][0]["url"].startswith("https://")
    assert st["certs"]["cert-nptel-verilog"]["earned"] == MON
    with pytest.raises(ValueError):
        plan.add_attribute("fsm", "achievement", "x", "javascript:alert(1)", today=MON)


# ------------------------------------------------------------------ contracts
def test_monday_is_digital_and_every_contract_carries_its_context(plan):
    d = plan.today(MON)
    lib = [c for c in d["contracts"] if c["slot"] == "library"]
    assert lib and all(c["branch"] == "digital" for c in lib)
    c = lib[0]
    assert c["title"] == "Full adder from gates" and c["steps"] and c["hint"] and c["success_check"]
    assert c["read_first"][0]["title"].startswith("Nand2Tetris")
    assert {b["kind"] for b in d["blocks"]} == {"library", "protected", "evening"}
    assert sum(c["minutes"] for c in lib) <= 180


def test_a_contract_links_the_lesson_it_depends_on(plan):
    plan.master_node("dl-basics", today=MON)
    c = g.contract_lookup(plan.bank(), plan.load(MON), None, "hdl-verilog/c1", MON)
    assert c["title"].startswith("HDLBits") and c["depends_on"][0]["name"] == "Digital logic basics"
    assert any("Builds on Digital logic basics" in r["why"] for r in c["read_first"])


def test_the_rotation_gives_each_weekday_its_track(plan):
    assert {c["branch"] for c in plan.today(TUE)["contracts"] if c["slot"] == "library"} == {"math"}
    assert {c["branch"] for c in plan.today(WED)["contracts"] if c["slot"] == "library"} == {"ml"}
    fri = plan.today(FRI)                                    # nothing open on arch: borrow, and say so
    assert fri["note"] and [c for c in fri["contracts"] if c["slot"] == "library"]


def test_the_day_is_frozen_and_the_protected_slot_stays_empty(plan):
    a = plan.today(MON)
    plan.complete(a["contracts"][0]["key"], today=MON)
    b = plan.today(MON)
    assert [c["key"] for c in a["contracts"]] == [c["key"] for c in b["contracts"]]
    assert b["contracts"][0]["done"] and b["wins"]["contracts"] == 1
    assert not [c for c in b["contracts"] if c["slot"] == "protected"]


def test_weekends_are_light(plan):
    d = plan.today(SAT)
    assert len(d["contracts"]) <= 1 and {b["kind"] for b in d["blocks"]} == {"weekend", "protected"}


def test_new_nodes_wait_while_three_are_in_progress(plan):
    for n in ("dl-basics", "ml-intro", "m-calc"):
        plan.start_node(n, today=MON)
    plan.complete("dl-basics/c1", today=MON)
    plan.complete("dl-basics/c2", today=MON)                 # mastered: hdl-verilog opens
    plan.start_node("hdl-verilog", today=MON)                # back to three in progress
    d = plan.today(TUE)
    nodes = {c["node_id"] for c in d["contracts"] if c["source"] == "tree"}
    assert nodes <= {"ml-intro", "m-calc", "hdl-verilog"}


def test_the_rotation_resumes_where_it_stopped(plan):
    plan.complete("dl-basics/c1", today=MON)
    nxt = plan.today("2026-11-02")                           # next Monday
    assert nxt["contracts"][0]["node_id"] == "dl-basics" and nxt["contracts"][0]["key"] == "dl-basics/c2"


def test_the_evening_is_spaced_practice_from_another_track(plan):
    plan.complete("ml-intro/c1", today=MON)
    d = plan.today(TUE)
    ev = [c for c in d["contracts"] if c["slot"] == "evening"]
    assert ev and ev[0]["node_id"] == "ml-intro" and "quiz me" in " ".join(ev[0]["steps"])


# ------------------------------------------------------------------ exam mode
def subj(ac, sid):
    return next(s for s in ac["subjects"] if s["id"] == sid)


def test_academics_dates_come_from_the_calendar(acad):
    ac = g.load_academics(acad)
    assert ac["calendar"]["internals_start"] == "2026-11-09" and ac["calendar"]["backlog_block_start"] is None
    assert g.next_exam(ac, subj(ac, "dsp"), MON) == ("2026-11-09", "internals", False)
    assert g.next_exam(ac, subj(ac, "dsp"), "2026-11-20") == ("2026-12-07", "end-sem", True)       # approximate
    assert g.next_exam(ac, subj(ac, "nas"), MON)[0] is None                                      # backlog date TBC
    assert subj(ac, "dsp")["units"][1]["exam_weight"] > subj(ac, "dsp")["units"][0]["exam_weight"]  # high > med
    assert ac["rescue"]["subject"] == "math-re1"                                             # matched by code


def test_the_exam_plan_phase_decides_the_library_day(exam_plan):
    d = exam_plan.today(MON)                                  # 14 days to internals: phase 1, its day-14 blocks
    assert d["exam"]["phase"]["name"] == "Internals sprint" and d["exam"]["phase"]["days_left"] == 14
    lib = [c for c in d["contracts"] if c["slot"] == "library"]
    assert lib[0]["title"] == "Digital Signal Processing · U2 FFT radix-2 by hand" and lib[0]["minutes"] == 100
    assert "2024 Q1" in " ".join(lib[0]["steps"])            # the unit named in the block (U2), with its past paper
    assert lib[1]["key"] == "m-calc/m-calc.c01"               # the maths block is the rescue triage: a real bank contract
    assert lib[2]["title"].startswith("VLSI Technology")
    ev = [c for c in d["contracts"] if c["slot"] == "evening"]
    assert ev[0]["key"] == "m-calc/m-calc.c03"                # the rescue's foundation feed for Unit III
    assert d["exam"]["rescue_week"]["library"].startswith("Diagnostic")
    t = exam_plan.today(TUE)                                  # no day entry: the phase template
    assert [c["title"] for c in t["contracts"] if c["slot"] == "library"][0].endswith("Unit 2: FFT")


def test_phases_hand_over_and_the_week_template_applies(exam_plan):
    d = exam_plan.today("2026-11-09")                         # internals day: next internal paper
    assert d["exam"]["phase"]["name"] == "Internals week"
    assert d["contracts"][0]["title"].startswith("Digital Signal Processing · next day's paper only")
    d = exam_plan.today("2026-11-16")                         # a Monday, 21 days to end-sem: backlog-first build
    assert d["exam"]["phase"]["name"] == "Backlog-first build"
    titles = [c["title"] for c in d["contracts"] if c["slot"] == "library"]
    assert titles[0] == "20 derivatives" and any(t.startswith("Circuit Theory") for t in titles)
    sun = exam_plan.today("2026-11-15")                       # Sunday of the same phase: the timed paper
    assert [c["title"] for c in sun["contracts"]][:2] == ["Timed full paper · timed full paper", "Error log: redo every miss"]
    fri = exam_plan.today("2026-11-13")                       # no Friday template: the nearest paper fills the day
    assert fri["exam"]["milestone"] == "maths U3 done; NAS U4 Laplace done" and fri["contracts"]
    last = exam_plan.today("2026-12-06")                      # the day before the first paper
    assert last["exam"]["phase"]["name"] == "Exam window" and "formula sheet" in last["contracts"][0]["title"]


def test_exam_focus_overrides_the_plan(exam_plan):
    exam_plan.exam_focus("nas", today=MON)
    lib = [c for c in exam_plan.today(MON)["contracts"] if c["slot"] == "library"]
    assert lib[0]["title"].startswith("Circuit Theory") and lib[0]["minutes"] == 180
    assert exam_plan.exam_focus(None, today=MON)["ok"]
    assert exam_plan.today(MON)["exam"]["phase"]["name"] == "Internals sprint"


def test_without_a_phase_plan_the_window_rule_and_skip_if_short_apply(tmp_path, bank, acad):
    raw = json.loads(acad.read_text(encoding="utf-8"))
    raw["plan"] = {"rules": [], "by_days_left": {"7": "High-weight units + PYQs."}}
    acad.write_text(json.dumps(raw), encoding="utf-8")
    ov = acad.parent / "overrides.json"
    g.set_exam_date("dsp", "2026-11-02", acad, ov)            # 7 days after MON
    p = g.Plan(g.KVStore(tmp_path / "kw", tmp_path / "bw"), bank_loader=lambda: bank, academics_loader=lambda: g.load_academics(acad))
    d = p.today(MON)
    assert d["exam"]["subject"]["id"] == "dsp" and d["exam"]["advice"] == "High-weight units + PYQs."
    lib = [c for c in d["contracts"] if c["slot"] == "library"]
    assert lib[0]["title"].endswith("Unit 2: FFT") and not any("Filter history" in c["title"] for c in lib)


def test_exam_dates_are_set_here_and_survive_a_rewrite(acad):
    ov = acad.parent / "overrides.json"
    ac = g.set_exam_date("vlsi-th", "2026-12-10", acad, ov)
    assert g.next_exam(ac, subj(ac, "vlsi-th"), MON) == ("2026-12-10", "set by you", False)
    ac = g.set_exam_date("calendar:backlog_block_start", "2026-12-14", acad, ov)
    assert g.next_exam(ac, subj(ac, "nas"), MON) == ("2026-12-14", "backlog block", False)
    shutil.copy(FIX / "academics.json", acad)                 # its author rewrites the file
    ac = g.load_academics(acad)
    assert g.next_exam(ac, subj(ac, "vlsi-th"), MON)[0] == "2026-12-10" and ac["calendar"]["set_here"] == ["backlog_block_start"]
    with pytest.raises(KeyError):
        g.set_exam_date("nope", "2026-12-10", acad, ov)
    with pytest.raises(KeyError):
        g.set_exam_date("calendar:holidays", "2026-12-10", acad, ov)
    with pytest.raises(ValueError):
        g.set_exam_date("dsp", "next week", acad, ov)


def test_subjects_are_found_by_name_code_or_initials(acad):
    ac = g.load_academics(acad)
    assert g.match_subject(ac, "NAS")["id"] == "nas"
    assert g.match_subject(ac, "MTH 201")["id"] == "math-re1"
    assert g.match_subject(ac, "maths")["id"] == "math-re1"
    assert g.match_subject(ac, "signal processing")["id"] == "dsp"
    assert g.match_subject(ac, "cooking") is None


# ------------------------------------------------------------------ campaigns
def test_campaigns_have_a_finish_line_a_ship_step_and_a_cap(plan):
    cs = plan.campaigns(MON)["campaigns"]
    fsm = next(c for c in cs if c["node_id"] == "fsm")
    assert fsm["finish_line"].startswith("Traffic light") and any("LinkedIn" in s for s in fsm["ship_steps"])
    assert [p["id"] for p in fsm["path"]] == ["dl-basics", "hdl-verilog", "fsm"]
    assert plan.campaign("camp/fsm", "start", today=MON)["ok"] and plan.campaign("camp/uart", "start", today=MON)["ok"]
    st = plan.load(MON)
    st["wip_cap"] = 2
    plan.save(st)
    r = plan.campaign("camp/systolic", "start", today=MON)
    assert not r["ok"] and r["cap"]
    assert plan.campaigns(MON)["active"] == 2
    r = plan.campaign("camp/fsm", "ship", "https://github.com/aman/fsm", today=MON)
    assert r["ok"] and plan.load(MON)["nodes"]["fsm"]["attributes"]["projects"][0]["url"].endswith("/fsm")
    with pytest.raises(ValueError):
        plan.campaign("camp/uart", "ship", "ftp://x", today=MON)


def test_career_weight_and_campaigns_order_the_borrowed_work(plan):
    # Friday's arch track has nothing open, so it works on what unlocks it (riscv-core
    # needs dl-basics first), not on the career's favourite node elsewhere.
    plan.set_career("aihw")
    fri = plan.today(FRI)["contracts"][0]
    assert fri["node_id"] == "dl-basics" and "unlocks" in fri["why"]
    # Anywhere else the career weight orders the work: ml-intro 1.0 beats dl-basics 0.8.
    ranked = g.rank_nodes(plan.bank(), plan.load(FRI), None, FRI)
    assert [n["id"] for _, n in ranked][:2] == ["ml-intro", "dl-basics"]
    plan.campaign("camp/uart", "start", today=FRI)            # its path starts at dl-basics
    assert plan.reroll(FRI)["contracts"][0]["node_id"] == "dl-basics"


def test_certs_show_cost_against_the_budget(plan):
    fit = lambda: {x["id"]: x["budget_fit"] for x in plan.certs()["certs"]}
    assert plan.certs()["budget"]["cert_inr_month"] == 3000
    assert fit() == {"cert-nptel-verilog": "in budget", "r-khan-calc": "free"}
    plan.set_settings(budget={"cert_inr_month": 500})
    assert fit()["cert-nptel-verilog"] == "stretch"                  # credibility 4 of 5: worth the stretch budget
    plan.set_settings(budget={"cert_stretch_inr": 800})
    assert fit()["cert-nptel-verilog"] == "over budget"


# ------------------------------------------------------------------ one XP total, migration
def test_xp_starts_from_the_old_save_and_every_source_adds_to_it(tmp_path, bank):
    kv = g.KVStore(tmp_path / "kv3", tmp_path / "bk3")
    kv.set(g.PLAYER_KEY, json.dumps({"xp": 1234, "level": 3}))
    kv.set("@silicon_game_v1", json.dumps({"marks": 99}))
    p = g.Plan(kv, bank_loader=lambda: bank, academics_loader=lambda: None)
    st = p.load(MON)
    assert st["xp"] == 1234 and st["xp_migrated_from"] == 1234
    p.complete("dl-basics/c1", today=MON)
    p.log(60, "deutsch", today=MON)
    p.add_xp(20, "crucible", today=MON)
    assert p.load(MON)["xp"] == 1234 + 25 + 20 + 20
    assert json.loads(kv.get("@silicon_game_v1")) == {"marks": 99}          # the old saves are untouched
    assert json.loads(kv.get(g.PLAYER_KEY))["xp"] == 1234


def test_the_plan_is_in_the_daily_snapshots(tmp_path, bank):
    kv = g.KVStore(tmp_path / "kv4", tmp_path / "bk4")
    p = g.Plan(kv, bank_loader=lambda: bank, academics_loader=lambda: None)
    p.load(MON)
    p.log(30, "silicon", today=MON)
    snaps = list((tmp_path / "bk4").iterdir())
    assert len(snaps) == 1 and any(json.loads(f.read_text())["key"] == g.PLAN_KEY for f in snaps[0].glob("*.json"))


def test_log_events_say_which_floor_rep_they_count_for(plan):
    assert plan.log(20, "deutsch", today=MON)["event"]["rep"] == "deutsch"
    assert g.rep_for("digital") == "silicon" and g.rep_for(None) is None


# ------------------------------------------------------------------ voice
def test_voice_today_explain_finish(plan):
    say = g.voice(plan, "today", {}, today=MON)["say"]
    assert "Digital logic & HDL day" in say and "Full adder from gates" in say
    ex = g.voice(plan, "explain", {}, today=MON)["say"]
    assert "Read first: Nand2Tetris" in ex and "Hint:" in ex and "done when" in ex
    fin = g.voice(plan, "finish", {"utterance": "I finished it"}, today=MON)
    assert fin["ok"] and "Full adder from gates: done" in fin["say"] and "Next: K-map drill" in fin["say"]
    assert not plan.load(MON)["contracts"]["dl-basics/c1"]["verified"]      # a voice claim, drawn amber
    fin2 = g.voice(plan, "finish", {"query": "k map"}, today=MON)
    assert "K-map drill: done" in fin2["say"] and "masters Digital logic basics" in fin2["say"]


def test_voice_next_on_the_tree_and_park(plan):
    plan.set_career("vlsi")
    assert "Next on the tree: Digital logic basics" in g.voice(plan, "next_node", {}, today=MON)["say"]
    assert g.voice(plan, "park", {"text": "build a GPU in a weekend"}, today=MON)["ok"]
    assert plan.load(MON)["parking"][0]["text"] == "build a GPU in a weekend"


def test_voice_exam_intents(exam_plan, acad):
    p = exam_plan
    assert g.voice(p, "days_to", {"subject": "DSP"}, today=MON)["say"] == \
        "Internals for Digital Signal Processing start in 14 days, on Monday 9 November."
    nas = g.voice(p, "days_to", {"subject": "NAS"}, today=MON)["say"]
    assert "isn't confirmed" in nas and "around 7 December" in nas          # never an invented date
    g.set_exam_date("calendar:backlog_block_start", "2026-12-14", acad)
    assert "in 49 days" in g.voice(p, "days_to", {"subject": "circuit theory"}, today=MON)["say"]
    assert "Exam plan: Internals sprint, 14 days to go." in g.voice(p, "today", {}, today=MON)["say"]
    assert "Exam mode on for Digital Signal Processing" in g.voice(p, "exam_mode", {"subject": "DSP"}, today=MON)["say"]
    assert "No subject like" in g.voice(p, "days_to", {"subject": "cooking"}, today=MON)["say"]


def test_voice_log_works_without_the_window(plan):
    r = g.voice(plan, "log", {"track": "deutsch", "minutes": 120}, today=MON)
    assert r["say"].startswith("Logged 2 hours of German. Plus 40 XP.")
    ev = plan.load(MON)["events"][-1]
    assert ev["kind"] == "log" and ev["rep"] == "deutsch" and ev["via"] == "voice"
    assert not g.voice(plan, "log", {"track": "cooking", "minutes": 5}, today=MON)["ok"]


def test_voice_without_a_bank_says_so(tmp_path):
    p = g.Plan(g.KVStore(tmp_path / "k", tmp_path / "b"), bank_loader=lambda: g.merge_bank({}), academics_loader=lambda: None)
    assert "hasn't landed" in g.voice(p, "today", {}, today=MON)["say"]
    assert "hasn't landed" in g.voice(p, "next_node", {}, today=MON)["say"]


# ------------------------------------------------------------------ findings
def test_findings_fetch_once_a_day_and_survive_offline(plan, tmp_path):
    plan.start_node("dl-basics", today=MON)
    calls = []

    def fetch(terms, cats, n):
        calls.append((terms, cats))
        return [{"id": "1", "title": "A paper", "summary": "", "published": "", "url": "https://arxiv.org/abs/1"}]
    path = tmp_path / "findings.json"
    f = g.findings(plan, MON, fetch=fetch, path=path)
    assert f["nodes"][0]["cats"] == ["cs.AR"] and f["nodes"][0]["papers"][0]["title"] == "A paper"
    g.findings(plan, MON, fetch=fetch, path=path)
    assert len(calls) == 1                                     # cached for the day

    def down(*a):
        raise OSError("no network")
    f = g.findings(plan, TUE, fetch=down, path=path)
    assert f["nodes"][0]["stale"] and f["nodes"][0]["papers"] and "offline" in f["nodes"][0]["error"]


def test_arxiv_categories_follow_the_branch(bank):
    assert g.cats_for(bank["nodes"]["ml-intro"]) == ["cs.LG"]
    assert g.cats_for(bank["nodes"]["m-prob"]) == ["math.HO", "math.PR"]
    assert g.cats_for(bank["nodes"]["riscv-core"]) == ["cs.AR"]


# ------------------------------------------------------------------ the routes
TOKEN = "test-token-mission"


@pytest.fixture()
def client(tmp_path, monkeypatch):
    monkeypatch.setenv("JARVIS_MISSION_BANK", str(bank_from(tmp_path, *g.BANK_FILES)))
    ac = tmp_path / "academics" / "academics.json"
    ac.parent.mkdir()
    shutil.copy(FIX / "academics.json", ac)
    shutil.copy(FIX / "math-rescue.json", ac.parent / "math-rescue.json")
    monkeypatch.setattr(g, "ACADEMICS", ac)
    monkeypatch.setattr(g, "ACADEMICS_OVERRIDES", ac.parent / "overrides.json")
    app = create_app(Guard(8777, TOKEN, extra_hosts=["testserver"]), autostart_aankhen="off")
    with TestClient(app) as c:
        c.headers.update({"X-Jarvis-Token": TOKEN})
        c.app.state.svc.kv = g.KVStore(tmp_path / "kv", tmp_path / "bk")
        c.app.state.svc.plan.kv = c.app.state.svc.kv
        yield c


def test_routes_round_trip_without_a_window(client):
    d = client.get("/api/mission/today").json()
    assert d["bank_ready"] and "blocks" in d and "wins" in d
    key = next((c["key"] for c in d["contracts"] if not c["done"]), None)
    if key:
        r = client.post("/api/mission/contract", json={"key": key, "proof": "https://github.com/aman/x"})
        assert r.status_code == 200 and r.json()["contract"]["verified"]
    assert client.post("/api/mission/contract", json={"key": "nope/c1"}).status_code == 404
    assert client.post("/api/mission/log", json={"minutes": 0, "track": "x"}).status_code == 400
    assert client.post("/api/mission/log", json={"minutes": 45, "track": "deutsch"}).json()["ok"]
    s = client.get("/api/mission/state").json()
    assert s["bank"]["nodes"] == 10 and s["bank"]["warnings"]
    assert client.post("/api/mission/node/dl-basics/start").status_code == 200
    assert client.post("/api/mission/node/nope/start").status_code == 404
    assert client.post("/api/mission/node/dl-basics/fly").status_code == 400
    assert client.get("/api/mission/campaigns").json()["campaigns"]
    assert client.get("/api/mission/certs").json()["budget"]["cert_inr_month"] == 3000
    assert client.post("/api/mission/parking", json={"text": "an idea"}).json()["ok"]
    pid = client.get("/api/mission/parking").json()["parking"][0]["id"]
    assert client.delete(f"/api/mission/parking/{pid}").json()["ok"]
    assert client.post("/api/mission/xp", json={"amount": 10, "reason": "crucible"}).json()["ok"]


def test_mission_routes_reject_wrong_json_shapes_instead_of_crashing(client):
    """BUG-R1: browser or voice clients can send malformed JSON while reconnecting.

    These endpoints must preserve the plan and return a client error, never leak an
    AttributeError/TypeError as a 500 response from the background plan worker.
    """
    assert client.put("/api/mission/settings", json={"rotation": []}).status_code == 400
    assert client.put("/api/mission/settings", json={"schedule": "later"}).status_code == 400
    assert client.put("/api/mission/settings", json={"budget": []}).status_code == 400
    assert client.put("/api/mission/settings", json={"window_days": []}).status_code == 400
    assert client.post("/api/mission/exam", json={"subject": "math-re1", "days": []}).status_code == 400
    assert client.post("/api/mission/exam", json={"subject": "math-re1", "days": "soon"}).status_code == 400
    assert client.post("/api/mission/learning", json={"what": "Read a chapter", "minutes": "ten"}).status_code == 400
    assert client.post("/api/mission/learning", json={"what": "Read a chapter", "minutes": {"n": 1}}).status_code == 400


def test_academics_route_and_exam_date(client):
    ac = client.get("/api/mission/academics").json()
    assert {s["id"] for s in ac["subjects"]} == {"math-re1", "nas", "dsp", "vlsi-th"}
    assert ac["rescue"]["subject"] == "math-re1" and "calendar" in ac
    later = (date.today() + timedelta(days=40)).isoformat()
    r = client.put("/api/mission/academics/exam", json={"subject": "vlsi-th", "date": later})
    assert r.status_code == 200
    vt = next(s for s in client.get("/api/mission/academics").json()["subjects"] if s["id"] == "vlsi-th")
    assert vt["days_left"] == 40 and vt["date_kind"] == "set by you"
    assert client.put("/api/mission/academics/exam", json={"subject": "calendar:backlog_block_start", "date": later}).status_code == 200
    nas = next(s for s in client.get("/api/mission/academics").json()["subjects"] if s["id"] == "nas")
    assert nas["days_left"] == 40 and nas["date_kind"] == "backlog block"
    assert client.put("/api/mission/academics/exam", json={"subject": "zzz", "date": later}).status_code == 404


def test_voice_route(client):
    r = client.post("/api/mission/voice", json={"intent": "next_node", "args": {}})
    assert r.status_code == 200 and r.json()["say"].startswith("Next on the tree")
    assert client.post("/api/mission/voice", json={"intent": "today", "args": [1]}).status_code == 400


# ------------------------------------------------------------------ real papers: question bank, pass rules, files
def test_question_bank_pass_rule_and_file_resources_load(acad):
    ac = g.load_academics(acad)
    m = subj(ac, "math-re1")
    assert len(m["question_bank"]) == 3 and m["question_bank"][0]["id"] == "math-re1:Jun-2026-SEE-QP-90000001:4a"
    assert m["units"][0]["files"][0]["title"] == "MTH 201 SEE June 2026" and m["units"][0]["resources"] == ["r-khan-calc"]
    assert m["paper_pattern"]["max_marks"] == 60
    assert m["pass_rule"]["see_needed_computed"] == 24                      # 45 % of 100 = 45, minus IA 21 = 24 (the SEE floor too)
    assert g.pass_needs({"see_min": 24, "see_max": 60, "cie_max": 40, "aggregate_min_pct": 45, "ia_carried_over": 10})["see_needed_computed"] == 35
    assert g.pass_needs(None) is None


def test_exam_contracts_pull_real_questions_and_never_repeat_one(exam_plan):
    d = exam_plan.today("2026-11-16")                         # Monday template: maths 75 min = rescue + a real PYQ
    pyq = next(c for c in d["contracts"] if c["key"].endswith("/pyq"))
    assert pyq["title"] == "Solve Jun 2026 SEE Q4a: false position"
    assert "x - e^-x = 0" in pyq["steps"][0] and pyq["pass"]["see_needed_computed"] == 24
    nas = next(c for c in d["contracts"] if c["title"].startswith("Circuit Theory"))
    assert any("Find i(t)" in s for s in nas["steps"])
    exam_plan.complete(pyq["key"], today="2026-11-16")
    assert "math-re1:Jun-2026-SEE-QP-90000001:4a" in exam_plan.load("2026-11-16")["questions_done"]
    nxt = exam_plan.today("2026-11-23")                       # next Monday: a different question
    pyq2 = next((c for c in nxt["contracts"] if c["key"].endswith("/pyq")), None)
    assert pyq2 is None or "x - e^-x" not in pyq2["steps"][0]


def test_backlogs_show_the_marks_needed_to_pass(exam_plan):
    q = {x["id"]: x for x in exam_plan.today(MON)["exam"]["queue"]}
    assert q["math-re1"]["see_needed"] == 24 and q["nas"]["see_needed"] == 24 and q["math-re1"]["see_max"] == 60


def test_the_file_route_serves_only_allowed_study_files(client, tmp_path):
    papers = g.ACADEMICS.parent / "papers"
    papers.mkdir(parents=True, exist_ok=True)
    (papers / "MTH201.pdf").write_bytes(b"%PDF-1.4 fixture")
    r = client.get("/api/mission/academics/file", params={"path": str(papers / "MTH201.pdf")})
    assert r.status_code == 200 and r.content.startswith(b"%PDF") and r.headers["content-type"] == "application/pdf"
    outside = tmp_path / "secret.pdf"
    outside.write_bytes(b"%PDF no")
    assert client.get("/api/mission/academics/file", params={"path": str(outside)}).status_code == 404
    assert client.get("/api/mission/academics/file", params={"path": str(papers / ".." / ".." / "secret.pdf")}).status_code == 404
    (papers / "notes.exe").write_bytes(b"MZ")
    assert client.get("/api/mission/academics/file", params={"path": str(papers / "notes.exe")}).status_code == 404
    assert client.get("/api/mission/academics/file", params={"path": "C:/Windows/win.ini"}).status_code == 404


# ------------------------------------------------------------------ the internship campaign + long-term goals
def make_apps(tmp_path):
    cal = tmp_path / "internships.json"
    cal.write_text(json.dumps([
        {"id": "eth-ssrf", "org": "ETH Zurich", "programme": "SSRF", "url": "https://inf.ethz.ch/", "opens": "2026-11-01",
         "closes": "2026-11-05", "linked_nodes": ["hdl-verilog"], "prep_contracts": ["c1"]},
        {"id": "gsoc", "org": "GSoC", "programme": "2027", "closes": "2027-03-31"},
        {"id": "wise", "org": "DAAD", "programme": "WISE", "closes": "2026-11-01", "status": "not_eligible", "reason": "partner institutions only"},
    ]), encoding="utf-8")
    return g.Applications(cal, tmp_path / "applications.json")


def test_the_pipeline_merges_research_and_his_entries_with_countdowns(tmp_path, bank):
    apps = make_apps(tmp_path)
    apps.upsert({"id": "srfp", "org": "IAS", "programme": "SRFP", "closes": "2026-11-30", "status": "preparing", "verified": False})
    apps.set_status("eth-ssrf", "preparing", "transcript asked")
    v = apps.view(MON, bank, g.default_plan_state(MON))
    rows = {r["id"]: r for r in v["applications"]}
    assert rows["eth-ssrf"]["days_left"] == 10 and rows["eth-ssrf"]["status"] == "preparing" and rows["eth-ssrf"]["source"] == "research"
    assert rows["srfp"]["source"] == "you" and rows["srfp"]["verified"] is False
    assert rows["wise"]["status"] == "not_eligible" and rows["wise"]["reason"] == "partner institutions only"
    assert v["pipeline"]["not_eligible"] == ["wise"] and set(v["pipeline"]["preparing"]) == {"eth-ssrf", "srfp"}
    assert [r["id"] for r in v["due_soon"]] == ["eth-ssrf"]                  # within 14 days; not-eligible never nags
    assert rows["eth-ssrf"]["prep"][0]["title"] == "Full adder from gates" and rows["eth-ssrf"]["nodes"][0]["status"] == "locked"
    with pytest.raises(ValueError):
        apps.set_status("gsoc", "maybe")
    with pytest.raises(KeyError):
        apps.set_status("nope", "applied")


def test_deadlines_reach_today_and_the_voice(tmp_path, bank):
    apps = make_apps(tmp_path)
    apps.set_task({"id": "transcript", "title": "Official transcript from EXU", "due": "2026-10-30"})
    p = g.Plan(g.KVStore(tmp_path / "kv-a", tmp_path / "bk-a"), bank_loader=lambda: bank, academics_loader=lambda: None, apps=apps)
    d = p.today(MON)
    assert [x["id"] for x in d["deadlines"]] == ["eth-ssrf", "transcript"]
    say = g.voice(p, "deadlines", {}, today=MON)["say"]
    assert say.startswith("Internship deadlines: ETH Zurich closes in 10 days; GSoC closes in 156 days.")
    assert "This week: Official transcript from EXU." in say
    apps.set_task({"id": "transcript", "done": True})
    assert [x["id"] for x in p.today(MON)["deadlines"]] == ["eth-ssrf"]


def test_long_term_goal_milestones_follow_the_tree(tmp_path, bank):
    apps = make_apps(tmp_path)
    assert [x["id"] for x in apps.goals()] == ["internship-2027", "one-crore"]
    apps.set_goal({"id": "one-crore", "title": "Rs 1 crore career", "milestones": [
        {"title": "RTL foundations", "linked_nodes": ["dl-basics", "hdl-verilog"], "by": "2027-06-30"}]})
    st = g.default_plan_state(MON)
    st["nodes"]["dl-basics"] = {"status": "mastered"}
    m = next(x for x in apps.goals(bank, st) if x["id"] == "one-crore")["milestones"][0]
    assert m["progress"] == 0.5 and m["mastered"] == ["dl-basics"] and not m["done"]


def test_application_routes(client):
    assert client.put("/api/mission/applications", json={"entry": {"id": "x1", "org": "Acme", "closes": "2027-01-10"}}).status_code == 200
    assert client.post("/api/mission/applications/x1/status", json={"status": "applied"}).json()["ok"]
    v = client.get("/api/mission/applications").json()
    assert next(a for a in v["applications"] if a["id"] == "x1")["status"] == "applied"
    assert client.post("/api/mission/applications/x1/status", json={"status": "bogus"}).status_code == 400
    assert client.put("/api/mission/tasks", json={"task": {"title": "Ask a referee", "due": "2027-01-01"}}).status_code == 200
    assert client.put("/api/mission/goals", json={"goal": {"title": "no id"}}).status_code == 400
    assert client.delete("/api/mission/applications/x1").json()["ok"]
    assert client.post("/api/mission/voice", json={"intent": "deadlines", "args": {}}).status_code == 200


# ------------------------------------------------------------------ extras: goal ladder, gaps, profile, learning log
@pytest.fixture()
def private(tmp_path, monkeypatch):
    """The private files (ladder, profile, learning) in a scratch folder."""
    monkeypatch.setattr(g, "LADDER", tmp_path / "ladder.json")
    monkeypatch.setattr(g, "PROFILE", tmp_path / "profile.json")
    monkeypatch.setattr(g, "LEARNING", tmp_path / "learning")
    return tmp_path


def test_every_contract_says_which_goal_it_serves(private, exam_plan, plan):
    d = exam_plan.today(MON)
    lib = [c for c in d["contracts"] if c["slot"] == "library"]
    assert lib[0]["serves"]["id"] == "ms-apps"                           # sem-5 grades → MS applications
    assert lib[1]["serves"]["id"] == "backlogs"                          # the maths rescue → clear the backlogs
    t = plan.today(MON)
    assert t["contracts"][0]["serves"]["id"] == "rtl-portfolio" and "digital" in t["contracts"][0]["serves"]["why"]


def test_the_ladder_keeps_the_vision_and_derives_the_short_term(private, exam_plan):
    v = g.ladder_view(exam_plan, MON)
    assert v["vision"]["band"] == "around ₹1 crore a year" and v["year"] == 2027
    assert any(x["title"].startswith("Pass the backlogs") and "24 marks" in x["title"] for x in v["quarter"]["goals"])
    assert v["month"]["label"] == "October 2026" and v["review_due"]
    g.save_review({"went_well": "maths drill daily", "slipped": "NAS", "milestones": [{"year": 2027, "id": "gsoc", "title": "A GSoC project", "match": ["programming"]}]}, MON)
    v = g.ladder_view(exam_plan, MON)
    assert not v["review_due"] and v["vision"]["band"] == "around ₹1 crore a year"
    assert "gsoc" in {m["id"] for y in v["years"] for m in y["milestones"]}


def test_welcome_back_after_a_gap_says_what_slipped_without_drama(private, plan):
    plan.today(MON)
    plan.complete("dl-basics/c1", today=MON)
    plan.today(TUE)                                                       # a planned day that didn't happen
    d = plan.today("2026-11-02")                                          # 7 days later
    wb = d["welcome_back"]
    assert wb["idle_days"] == 7 and "and that's fine" in wb["say"] and wb["slipped"][0].endswith("didn't happen")
    assert g.voice(plan, "today", {}, today="2026-11-02")["say"].startswith("Welcome back.")
    assert plan.today("2026-10-27")["welcome_back"] is None                # the next day: no gap


def test_mastered_nodes_get_refreshers_after_inactivity(private, plan):
    plan.master_node("ml-intro", today=MON)
    late = (date.fromisoformat(MON) + timedelta(days=35)).isoformat()
    d = plan.today(late)
    ref = [c for c in d["contracts"] if c["key"].startswith("refresh/ml-intro/")]
    assert ref and ref[0]["title"] == "Refresher: ML foundations"
    assert plan.complete(ref[0]["key"], today=late)["ok"]


def test_drift_nudge_is_rate_limited_and_quiet_at_night(private, plan):
    plan.complete("dl-basics/c1", today=MON)
    noon = datetime(2026, 10, 31, 12, 0)
    assert "5 days since the last logged work" in g.drift_nudge(plan, noon)
    assert g.drift_nudge(plan, noon) is None                              # once a day
    assert g.drift_nudge(plan, datetime(2026, 11, 1, 23, 30)) is None      # quiet hours
    assert g.drift_nudge(plan, datetime(2026, 10, 27, 12, 0)) is None      # 1 day is not drift


def test_the_profile_shapes_the_engine_and_never_needs_scores(private, plan):
    p = g.load_profile()
    assert p["style"]["choices"] == 3 and not any(ch.isdigit() for t in p["traits"] for ch in t)
    d = plan.today(MON)
    assert d["contracts"][0]["hook"].startswith("Puzzle first")
    assert 1 <= len(d["alternatives"]) <= 2 and all(a["key"] not in {c["key"] for c in d["contracts"]} for a in d["alternatives"])
    alt = d["alternatives"][0]
    assert plan.choose(d["contracts"][0]["key"], alt["key"], today=MON)["ok"]
    assert plan.today(MON)["contracts"][0]["key"] == alt["key"]
    g.save_profile({"style": {"novelty_first": False, "choices": 1, "wip_cap": 2, "quiet_hours": ["22:00", "07:00"]}})
    d = plan.today(TUE)
    assert "hook" not in d["contracts"][0] and d["alternatives"] == [] and plan.load(TUE)["wip_cap"] == 2
    assert g.in_quiet_hours(datetime(2026, 1, 1, 6, 0), ["22:00", "07:00"]) and not g.in_quiet_hours(datetime(2026, 1, 1, 12, 0), ["22:00", "07:00"])


def test_the_learning_log_files_meta_matches_and_xp(private, plan):
    import base64
    r = g.add_learning(plan, "Watched a lecture on gradient descent and linear regression", 40, note="Andrew Ng, lecture 2",
                       files=[{"name": "notes.pdf", "data": base64.b64encode(b"%PDF-1.4 x").decode()},
                              {"name": "../../evil.md", "data": base64.b64encode(b"# notes").decode()}], today=MON)
    e = r["entry"]
    folder = private / "learning" / "2026" / "10" / e["id"]
    assert e["id"].startswith("2026-10-26_lecture-gradient-descent")
    assert sorted(p.name for p in folder.iterdir()) == sorted(["meta.json", e["files"][0], e["files"][1]])
    assert all(f.startswith("lecture-gradient-descent") for f in e["files"])            # renamed from his words, never his path
    assert e["suggested_nodes"][0]["id"] == "ml-intro" and e["nodes"] == ["ml-intro"] and e["xp"] == 15
    ev = plan.load(MON)["events"][-1]
    assert ev["kind"] == "learning" and ev["node"] == "ml-intro"
    m = g.correct_learning(plan, e["id"], ["m-calc", "nope"])
    assert m["nodes"] == ["m-calc"] and g.learning_timeline()[0]["nodes"] == ["m-calc"]
    for bad in ([{"name": "x.exe", "data": "TVo="}], [{"name": "a.pdf", "data": "not base64!"}], [{"name": "a.pdf", "data": ""}]):
        with pytest.raises(ValueError):
            g.add_learning(plan, "something", files=bad, today=MON)
    with pytest.raises(ValueError):
        g.add_learning(plan, "", today=MON)
    with pytest.raises(KeyError):
        g.correct_learning(plan, "../../etc", [])


def test_voice_learning_entry(private, plan):
    say = g.voice(plan, "learning", {"text": "watched a lecture on systolic arrays", "minutes": 40}, today=MON)["say"]
    assert say.startswith("Logged: watched a lecture on systolic arrays.") and "Systolic arrays" in say


def test_extras_routes(client, private):
    import base64
    r = client.post("/api/mission/learning", json={"what": "Read about UART baud generators", "minutes": 30,
                                                   "files": [{"name": "uart.v", "data": base64.b64encode(b"module uart; endmodule").decode()}]})
    assert r.status_code == 200 and r.json()["entry"]["files"] == ["uart-baud-generators.v"]
    assert client.post("/api/mission/learning", json={"what": "x", "files": "nope"}).status_code == 400
    assert client.get("/api/mission/learning").json()["entries"][0]["what"].startswith("Read about UART")
    assert client.get("/api/mission/ladder").json()["vision"]["horizon"] == "10 years"
    assert client.post("/api/mission/review", json={"went_well": "x"}).status_code == 200
    assert client.put("/api/mission/profile", json={"style": {"choices": 2}}).json()["style"]["choices"] == 2
    assert client.get("/api/mission/profile").json()["style"]["choices"] == 2
    assert client.post("/api/mission/choose", json={"key": "nope", "alt": "nope"}).status_code == 404
