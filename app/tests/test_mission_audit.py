"""Mission Germoney test audit (2026-10-23): property tests on the plan engine,
data-integrity tests on the real bank, the vision-alignment run and the 90-day
usage simulation. Findings and numbers: docs/research/2026-10-23-test-audit-mission.md.

Everything here is offline and in scratch folders: the plan state lives in a
dict-backed store, private files (ladder, profile, learning log, applications) in
tmp_path, academics are fictional subjects. Randomised tests use fixed seeds, so a
failure names the seed that reproduces it.
"""
from __future__ import annotations

import base64
import json
import random
import re
import shutil
import threading
from collections import Counter, defaultdict
from datetime import date, timedelta
from fractions import Fraction
from pathlib import Path
from urllib.parse import urlparse

import pytest

from jarvis_app import germoney as g

FIX = Path(__file__).resolve().parents[1] / "ui" / "src" / "__tests__" / "fixtures"
SEEDS = range(40)


# ------------------------------------------------------------------ helpers
class MemKV:
    """The two calls Plan makes on its store, in memory (fast, nothing on disk)."""

    def __init__(self):
        self.d: dict[str, str] = {}

    def get(self, key):
        return self.d.get(key)

    def set(self, key, value):
        self.d[key] = value


@pytest.fixture()
def private(tmp_path, monkeypatch):
    monkeypatch.setattr(g, "LADDER", tmp_path / "ladder.json")
    monkeypatch.setattr(g, "PROFILE", tmp_path / "profile.json")
    monkeypatch.setattr(g, "LEARNING", tmp_path / "learning")
    return tmp_path


def new_plan(tmp_path: Path, bank: dict, academics=None, apps=None) -> g.Plan:
    apps = apps or g.Applications(tmp_path / "internships.json", tmp_path / "applications.json")
    return g.Plan(MemKV(), bank_loader=lambda: bank, academics_loader=lambda: academics, apps=apps)


BRANCHES = ["digital_logic", "hdl", "verification", "math", "ml", "ai_hardware", "architecture", "programming", "security"]


def random_bank(rng: random.Random, n: int | None = None) -> dict:
    """A random DAG: prerequisites only point at earlier nodes, so it is acyclic by
    construction; 1-3 contracts each, full contract text, a random career."""
    n = n or rng.randint(5, 26)
    nodes, depth = [], {}
    for i in range(n):
        pre = rng.sample([f"n{j}" for j in range(i)], rng.randint(0, min(3, i)))
        depth[f"n{i}"] = 1 + max([depth[p] for p in pre] or [0])
        nodes.append({"id": f"n{i}", "name": f"Node {i}", "branch": rng.choice(BRANCHES), "tier": depth[f"n{i}"],
                      "prereqs": pre, "outcomes": [f"outcome {i}"], "hours_est": 5, "resources": [],
                      "contracts": [{"id": f"n{i}.c{j}", "title": f"Task {i}.{j}", "minutes": rng.choice([20, 30, 45, 60, 90]),
                                     "context": "why it matters", "steps": ["do it"], "hint": "a hint", "success_check": "it works",
                                     "xp": 20} for j in range(rng.randint(1, 3))]})
    careers = [{"id": "c", "name": "C", "weights": {f"n{i}": round(rng.random(), 2) for i in range(n)}}]
    bank = g.merge_bank({"skilltree.json": {"nodes": nodes, "careers": careers}})
    assert bank["errors"] == []
    return bank


def random_progress(rng: random.Random, bank: dict, today: str) -> dict:
    """A legal random state: mastered only after its prerequisites, at most the cap in
    progress, some contracts done, 'last' dates in the past."""
    st = g.default_plan_state(today)
    for nid in bank["order"]:
        s = g.node_status(bank, st, nid)
        r = rng.random()
        last = (date.fromisoformat(today) - timedelta(days=rng.randint(0, 60))).isoformat()
        if s == "available" and r < 0.35:
            st["nodes"][nid] = {"status": "mastered", "mastered": last, "last": last}
            for c in bank["nodes"][nid]["contracts"]:
                st["contracts"][f"{nid}/{c['id']}"] = {"done": last}
        elif s == "available" and r < 0.55 and len(g.wip(bank, st)) < st["wip_cap"]:
            st["nodes"][nid] = {"status": "in_progress", "started": last, "last": last}
            st["contracts"][f"{nid}/{bank['nodes'][nid]['contracts'][0]['id']}"] = {"done": last}
            if not g.open_contracts(st, bank["nodes"][nid]):
                st["nodes"][nid] = {"status": "mastered", "mastered": last, "last": last}
    return st


def assert_tree_invariants(bank: dict, st: dict, where: str = "") -> None:
    sts = g.statuses(bank, st)
    assert len(g.wip(bank, st)) <= int(st["wip_cap"]), f"{where}: over the in-progress cap: {g.wip(bank, st)}"
    for nid, s in sts.items():
        if s in ("in_progress", "mastered"):
            bad = [p for p in bank["nodes"][nid]["prereqs"] if sts[p] != "mastered"]
            assert not bad, f"{where}: {nid} is {s} before its prerequisites {bad}"


def assert_contract_complete(c: dict, where: str = "") -> None:
    for k in ("title", "context", "hint", "success_check", "why"):
        assert isinstance(c.get(k), str) and c[k].strip(), f"{where}: contract {c.get('key')} has no {k}"
    assert c.get("steps"), f"{where}: contract {c.get('key')} has no steps"
    assert c["slot"] != "protected", f"{where}: the protected slot got {c['key']}"


def rand_day(rng: random.Random) -> str:
    return (date(2026, 1, 1) + timedelta(days=rng.randint(0, 3 * 365))).isoformat()


# ------------------------------------------------------------------ 1. engine properties (random DAGs, fixed seeds)
@pytest.mark.parametrize("seed", SEEDS)
def test_property_a_built_day_obeys_the_tree(seed):
    """Over random graphs, progress and dates: today's plan never holds a locked,
    mastered or finished node's contract, never starts more new nodes than the cap
    has room for, keeps the protected slot empty, and every contract is complete."""
    rng = random.Random(seed)
    for _ in range(4):
        bank = random_bank(rng)
        today = rand_day(rng)
        st = random_progress(rng, bank, today)
        assert_tree_invariants(bank, st, f"seed {seed} setup")
        day = g.build_day(bank, st, None, today)
        sts = g.statuses(bank, st)
        tree = [c for c in day["contracts"] if c["source"] == "tree"]
        for c in day["contracts"]:
            assert_contract_complete(c, f"seed {seed} {today}")
        for c in tree:
            assert sts[c["node_id"]] in ("available", "in_progress"), f"seed {seed}: {c['key']} from a {sts[c['node_id']]} node"
            assert c["key"] not in st["contracts"]
        new = {c["node_id"] for c in tree if sts[c["node_id"]] == "available"}
        assert len(new) <= st["wip_cap"] - len(g.wip(bank, st)), f"seed {seed}: {len(new)} new nodes, cap room {st['wip_cap'] - len(g.wip(bank, st))}"
        iso = date.fromisoformat(today).isoweekday()
        assert day["track"] == (st["rotation"][str(iso)]["track"] if iso <= 5 else "weekend")
        lib = [c for c in day["contracts"] if c["slot"] == "library"]
        if lib:
            assert sum(c["minutes"] for c in lib) <= max(180, lib[0]["minutes"])   # one long contract may fill the block alone


@pytest.mark.parametrize("seed", SEEDS)
def test_property_completing_anything_keeps_the_dag_and_the_cap(seed, tmp_path, private):
    """Random sequences of complete / start / pause / master / choose, including
    contracts picked straight from the tree (locked ones too): the state never has a
    node in progress or mastered before its prerequisites, never more than the cap in
    progress, and XP never goes down."""
    rng = random.Random(1000 + seed)
    bank = random_bank(rng, rng.randint(8, 20))
    plan = new_plan(tmp_path, bank)
    day0 = date(2026, 10, 26)
    xp = 0
    all_keys = [f"{n}/{c['id']}" for n in bank["order"] for c in bank["nodes"][n]["contracts"]]
    for step in range(45):
        today = (day0 + timedelta(days=step // 3)).isoformat()
        d = plan.today(today)
        op = rng.random()
        try:
            if op < 0.45:
                open_c = [c for c in d["contracts"] if not c["done"]]
                if open_c:
                    plan.complete(rng.choice(open_c)["key"], today=today)
            elif op < 0.65:
                plan.complete(rng.choice(all_keys), today=today)        # picked from the tree, maybe locked
            elif op < 0.75:
                plan.start_node(rng.choice(bank["order"]), today=today)
            elif op < 0.82:
                plan.pause_node(rng.choice(bank["order"]), today=today)
            elif op < 0.88:
                plan.master_node(rng.choice(bank["order"]), today=today)
            else:
                lib = [c for c in d["contracts"] if c["slot"] == "library" and not c["done"]]
                if lib:
                    plan.choose(lib[0]["key"], rng.choice(all_keys), today=today)
        except (KeyError, ValueError):
            pass                                                          # a refused move is fine; a broken state is not
        st = plan.load(today)
        assert_tree_invariants(bank, st, f"seed {seed} step {step}")
        assert st["xp"] >= xp
        xp = st["xp"]
        for c in plan.today(today)["contracts"]:
            assert c["slot"] != "protected"


def test_property_concurrent_completes_respect_the_cap(tmp_path, private):
    """Eight threads finishing contracts on eight different available nodes at once:
    the lock serialises them and at most three end up in progress."""
    nodes = [{"id": f"r{i}", "name": f"Root {i}", "branch": "hdl", "prereqs": [],
              "contracts": [{"id": f"r{i}.a", "title": "a", "context": "c", "steps": ["s"], "hint": "h", "success_check": "ok"},
                            {"id": f"r{i}.b", "title": "b", "context": "c", "steps": ["s"], "hint": "h", "success_check": "ok"}]}
             for i in range(8)]
    bank = g.merge_bank({"skilltree.json": {"nodes": nodes}})
    plan = new_plan(tmp_path, bank)
    plan.today("2026-10-26")
    errors = []

    def go(i):
        try:
            plan.complete(f"r{i}/r{i}.a", today="2026-10-26")
        except Exception as e:                                            # pragma: no cover - reported below
            errors.append(e)
    ts = [threading.Thread(target=go, args=(i,)) for i in range(8)]
    for t in ts:
        t.start()
    for t in ts:
        t.join()
    st = plan.load("2026-10-26")
    assert not errors and len(st["contracts"]) == 8                       # every contract counted
    assert len(g.wip(bank, st)) == 3                                      # only three nodes moved
    assert st["xp"] == 8 * 20


def test_a_contract_on_a_locked_node_counts_but_the_node_stays_locked(tmp_path, private):
    bank = g.merge_bank({"skilltree.json": {"nodes": [
        {"id": "a", "name": "A", "branch": "hdl", "prereqs": [], "contracts": [{"id": "a1", "title": "A1"}]},
        {"id": "b", "name": "B", "branch": "hdl", "prereqs": ["a"], "contracts": [{"id": "b1", "title": "B1"}]}]}})
    plan = new_plan(tmp_path, bank)
    r = plan.complete("b/b1", today="2026-10-26")
    assert r["ok"] and r["queued"] == "locked" and "stays locked" in r["say"]
    assert g.node_status(bank, plan.load("2026-10-26"), "b") == "locked"
    r = plan.complete("a/a1", today="2026-10-26")                         # a mastered: b's work was all done already
    st = plan.load("2026-10-26")
    assert r["mastered"] == "a" and g.node_status(bank, st, "b") == "mastered"


def test_choose_refuses_a_locked_or_over_cap_alternative(tmp_path, private):
    bank = g.merge_bank({"skilltree.json": {"nodes": [
        {"id": f"n{i}", "name": f"N{i}", "branch": "hdl", "prereqs": [] if i < 5 else ["n0"],
         "contracts": [{"id": f"n{i}.c", "title": f"T{i}", "minutes": 60}]} for i in range(6)]}})
    plan = new_plan(tmp_path, bank)
    d = plan.today("2026-10-26")
    lib = [c for c in d["contracts"] if c["slot"] == "library"]
    with pytest.raises(ValueError, match="locked"):
        plan.choose(lib[0]["key"], "n5/n5.c", today="2026-10-26")
    for n in ("n2", "n3", "n4"):
        plan.start_node(n, today="2026-10-26")
    plan.reroll("2026-10-26")
    d = plan.today("2026-10-26")
    lib = [c for c in d["contracts"] if c["slot"] == "library"]
    assert {c["node_id"] for c in lib} <= {"n2", "n3", "n4"}
    with pytest.raises(ValueError, match="in progress"):
        plan.choose(lib[0]["key"], "n1/n1.c", today="2026-10-26")
    assert all(g.node_status(bank, plan.load("2026-10-26"), a["node_id"]) == "in_progress" for a in d["alternatives"])


def test_property_prereq_closure_is_a_valid_learning_order():
    rng = random.Random(7)
    for _ in range(60):
        bank = random_bank(rng)
        for nid in bank["order"]:
            order = g.prereq_closure(bank, nid)
            assert order[-1] == nid and len(order) == len(set(order))
            pos = {x: i for i, x in enumerate(order)}
            for x in order:
                assert all(pos[p] < pos[x] for p in bank["nodes"][x]["prereqs"])


def test_property_an_injected_cycle_is_always_caught():
    rng = random.Random(11)
    for _ in range(60):
        bank = random_bank(rng, rng.randint(3, 15))
        raw = [dict(bank["nodes"][n]) for n in bank["order"]]
        a, b = sorted(rng.sample(range(len(raw)), 2))
        chain = g.prereq_closure(bank, raw[b]["id"])
        raw[a] = {**raw[a], "prereqs": raw[a]["prereqs"] + [raw[b]["id"]]}
        broken = g.merge_bank({"skilltree.json": {"nodes": raw}})
        assert bool(broken["errors"]) == (raw[a]["id"] in chain or raw[a]["id"] == raw[b]["id"])
        assert g.find_cycles(bank["nodes"]) == []


# ------------------------------------------------------------------ 2. the rotation across weeks, gaps and year end
def test_the_rotation_is_a_pure_function_of_the_weekday_across_years():
    st = g.default_plan_state("2026-01-01")
    bank = g.merge_bank({})
    for i in range(0, 3 * 366):
        day = date(2026, 1, 1) + timedelta(days=i)
        b = g.build_day(bank, st, None, day.isoformat())
        assert b["track"] == (st["rotation"][str(day.isoweekday())]["track"] if day.isoweekday() <= 5 else "weekend")
        assert not [c for c in b["contracts"] if c["slot"] == "protected"]


@pytest.mark.parametrize("gap_weeks,start", [(1, "2026-10-26"), (3, "2026-10-26"), (2, "2026-12-21"), (5, "2027-02-22"), (1, "2028-02-28")])
def test_the_rotation_resumes_after_any_gap(gap_weeks, start, tmp_path, private):
    """Monday's node, half done, is Monday's first contract again after a week, a
    three-week gap, a gap over New Year, or over a leap day."""
    bank = g.merge_bank({"skilltree.json": {"nodes": [
        {"id": f"h{i}", "name": f"HDL {i}", "branch": "hdl", "prereqs": [],
         "contracts": [{"id": f"h{i}.c{j}", "title": f"H{i}.{j}", "minutes": 60} for j in range(4)]} for i in range(5)]}})
    plan = new_plan(tmp_path, bank)
    assert date.fromisoformat(start).isoweekday() == 1
    first = plan.today(start)["contracts"][0]
    plan.complete(first["key"], today=start)
    back = (date.fromisoformat(start) + timedelta(weeks=gap_weeks)).isoformat()
    again = plan.today(back)["contracts"][0]
    assert again["node_id"] == first["node_id"] and again["key"] != first["key"]


def test_rescue_week_lines_work_across_new_year():
    ac = {"rescue": {"week_plan": [{"week": "9 (Dec 28-Jan 3)", "library": "Unit V"}, {"week": "1 (Oct 24-30)", "library": "Unit III"}]}}
    assert g.rescue_week(ac, "2026-12-30")["library"] == "Unit V"
    assert g.rescue_week(ac, "2027-01-02")["library"] == "Unit V"
    assert g.rescue_week(ac, "2026-10-25")["library"] == "Unit III"
    assert g.rescue_week(ac, "2027-01-04") is None


# ------------------------------------------------------------------ 3. exam mode: re-sits first, never an invented date
def write_academics(tmp: Path, raw: dict) -> dict:
    p = tmp / f"ac-{abs(hash(json.dumps(raw, sort_keys=True))) % 10**8}" / "academics.json"
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(json.dumps(raw), encoding="utf-8")
    return g.load_academics(p)


def random_academics(rng: random.Random, today: date) -> tuple[dict, dict[str, str | None]]:
    subjects, truth = [], {}
    for i in range(rng.randint(1, 5)):
        off = rng.choice([None, "TBC", "2026-02-30", -3, 0, 1, 5, 13, 14, 15, 30, 70])
        d = (today + timedelta(days=off)).isoformat() if isinstance(off, int) else off
        backlog = rng.random() < 0.5
        s = {"id": f"s{i}", "name": f"Subject {i}", "kind": "backlog" if backlog else "current",
             "units": [{"n": 1, "title": "Unit 1", "topics": ["t"], "exam_weight": "high"}]}
        s["exam_date" if backlog else "end_sem_from"] = d
        truth[f"s{i}"] = d if isinstance(off, int) else None
        subjects.append(s)
    return {"calendar": {"backlog_block": {"start": rng.choice([None, "TBC"]), "status": "TBC"}}, "subjects": subjects}, truth


@pytest.mark.parametrize("seed", range(25))
def test_property_exam_mode_takes_the_resit_first_and_never_invents_a_date(seed, tmp_path):
    rng = random.Random(500 + seed)
    for _ in range(6):
        today = date(2026, 1, 1) + timedelta(days=rng.randint(0, 700))
        raw, truth = random_academics(rng, today)
        ac = write_academics(tmp_path, raw)
        st = g.default_plan_state(today.isoformat())
        ex = g.exam_state(ac, st, today.isoformat())
        win = st["exam"]["window_days"]
        left = {sid: (date.fromisoformat(d) - today).days for sid, d in truth.items() if d}
        in_win = {sid: n for sid, n in left.items() if 0 <= n <= win}
        kind = {s["id"]: s["kind"] for s in raw["subjects"]}
        if not in_win:
            assert ex is None, f"seed {seed}: exam mode with nothing within {win} days"
            continue
        resits = {sid: n for sid, n in in_win.items() if kind[sid] == "backlog"}
        pick = ex["subject"]["id"]
        if resits:
            assert pick in resits and in_win[pick] == min(resits.values()), f"seed {seed}: picked {pick} over re-sits {resits}"
        else:
            assert in_win[pick] == min(in_win.values())
        assert ex["date"] == truth[pick], "the exam date is the one in the file, never computed"
        for q in ex["queue"]:
            if truth[q["id"]] is None:
                assert q["days_left"] is None and "confirm" in q["date_kind"]
        for c in g.build_day(g.merge_bank({}), st, ac, today.isoformat())["contracts"]:
            assert_contract_complete(c, f"seed {seed}")


def test_tbc_and_impossible_dates_are_no_date(tmp_path):
    assert g._date_or_none("TBC") is None and g._date_or_none("2026-02-30") is None and g._date_or_none("2026-13-01") is None
    assert g._date_or_none("2028-02-29") == "2028-02-29"
    ac = write_academics(tmp_path, {"calendar": {"backlog_block": {"start": "TBC"}}, "subjects": [
        {"id": "re", "name": "Fictional Maths", "kind": "backlog", "exam_date": "2026-02-31", "units": []}]})
    assert g.next_exam(ac, ac["subjects"][0], "2026-01-01") == (None, "backlog block (date to confirm)", True)
    assert g.exam_state(ac, g.default_plan_state("2026-01-01"), "2026-01-01") is None


def test_a_phase_counting_down_to_an_assumed_date_says_so(tmp_path, private):
    raw = json.loads((FIX / "academics.json").read_text(encoding="utf-8"))
    ac = write_academics(tmp_path, raw)
    ex = g.exam_state(ac, g.default_plan_state("2026-11-16"), "2026-11-16")      # phase 3, anchored on the approximate end-sem
    assert ex["phase"]["name"] == "Backlog-first build" and ex["phase"]["anchor_assumed"] is True
    plan = new_plan(tmp_path, g.merge_bank({}), academics=ac)
    say = g.voice(plan, "today", {}, today="2026-11-16")["say"]
    assert "probably about 21 days to go; the date isn't confirmed" in say
    raw["calendar"]["end_sem_start_approx"] = False
    ex = g.exam_state(write_academics(tmp_path, raw), g.default_plan_state("2026-11-16"), "2026-11-16")
    assert ex["phase"]["anchor_assumed"] is False


# ------------------------------------------------------------------ 4. marks needed: exact at every boundary
def brute_needed(see_min, see_max, cie_max, agg, ia):
    total = see_max + cie_max
    for s in range(0, see_max + 200):
        if s >= see_min and Fraction(s + ia) >= Fraction(agg) * total / 100:
            return s


def test_marks_needed_boundaries():
    rule = {"see_min": 24, "see_max": 60, "cie_min": 20, "cie_max": 40, "aggregate_min_pct": 45}
    r = g.pass_needs({**rule, "ia_carried_over": 21})
    assert r["see_needed_computed"] == 24 and r["cie_ok"] and r["possible"]            # 21 + 24 = 45 of 100: exactly 45 %
    assert g.pass_needs({**rule, "ia_carried_over": 20})["see_needed_computed"] == 25  # IA exactly at the CIE floor: 44 % is short by one
    assert g.pass_needs({**rule, "ia_carried_over": 40})["see_needed_computed"] == 24  # the SEE floor still holds
    low = g.pass_needs({**rule, "ia_carried_over": 12})
    assert low["see_needed_computed"] == 33 and low["cie_ok"] is False and low["possible"] is False
    assert g.pass_needs({"see_min": 40, "see_max": 100, "cie_max": 100, "aggregate_min_pct": 55, "ia_carried_over": 30})["see_needed_computed"] == 80
    assert g.pass_needs({"see_min": 10, "see_max": 50, "cie_max": 50, "aggregate_min_pct": 55, "ia_carried_over": 30})["see_needed_computed"] == 25
    assert g.pass_needs({**rule})["see_needed_computed"] == 24                        # no IA known: the SEE floor only
    assert g.pass_needs({**rule, "ia_carried_over": 21})["possible"] is True


def test_property_marks_needed_matches_brute_force():
    rng = random.Random(3)
    for _ in range(3000):
        see_max = rng.choice([50, 60, 70, 75, 80, 100])
        cie_max = rng.choice([25, 30, 40, 50, 100])
        agg = rng.choice([33, 35, 40, 45, 50, 55, 60, 65])
        see_min = rng.randint(0, see_max // 2)
        ia = rng.randint(0, cie_max)
        r = g.pass_needs({"see_min": see_min, "see_max": see_max, "cie_max": cie_max, "aggregate_min_pct": agg, "ia_carried_over": ia})
        assert r["see_needed_computed"] == brute_needed(see_min, see_max, cie_max, agg, ia), (see_min, see_max, cie_max, agg, ia)
        assert r["possible"] == (r["see_needed_computed"] <= see_max)


# ------------------------------------------------------------------ 5. past-paper questions: one id each, never twice
def or_paper(questions: list[dict]) -> dict:
    return {"calendar": {}, "subjects": [{"id": "re", "name": "Fictional Maths", "kind": "backlog", "exam_date": "2026-11-20",
                                          "units": [{"n": 1, "title": "U1", "topics": ["t"], "exam_weight": "high"}],
                                          "question_bank": questions,
                                          "pass_rule": {"see_min": 24, "see_max": 60, "cie_max": 40, "aggregate_min_pct": 45, "ia_carried_over": 21}}]}


QUESTIONS = [
    {"unit": 1, "topic": "change of order", "question": "Change the order of integration in the given integral.", "marks": 7, "choice_group": "2 (OR)", "sitting": "Fictional Jun 2026"},
    {"unit": 1, "topic": "triple integral", "question": "Evaluate the triple integral over the unit sphere.", "marks": 7, "choice_group": "2 (OR)", "sitting": "Fictional Jun 2026"},
    {"unit": 1, "topic": "beta", "question": "Prove the Beta-Gamma relation.", "marks": 7, "choice_group": "3a", "sitting": "Fictional Jun 2026"},
    {"unit": 1, "topic": "no group", "question": "Define a Jacobian.", "marks": 2, "sitting": "Fictional Jun 2026"},
    {"unit": 1, "topic": "no group 2", "question": "State Green's theorem.", "marks": 2, "sitting": "Fictional Jun 2026"},
]


def test_question_ids_are_unique_and_survive_a_reordered_file(tmp_path):
    ids = [q["id"] for q in write_academics(tmp_path, or_paper(QUESTIONS))["subjects"][0]["question_bank"]]
    assert len(set(ids)) == len(ids) == 5
    assert "re:Fictional-Jun-2026:3a" in ids                                   # a unique group keeps its old id
    shuffled = list(reversed(QUESTIONS))
    again = [q["id"] for q in write_academics(tmp_path, or_paper(shuffled))["subjects"][0]["question_bank"]]
    assert sorted(again) == sorted(ids)


def test_no_question_repeats_across_days_restarts_and_migration(tmp_path, private):
    """A re-sit in the window every day: each day's PYQ contract is finished, the
    plan is reloaded from the store (a restart), and once the raw state goes through
    merge_plan_state with unknown keys (a migration). No question is offered after it
    was done, until the bank runs out."""
    qs = [{"unit": 1, "topic": f"topic {i}", "question": f"Fictional question number {i}, show every step.", "marks": rng_marks,
           "choice_group": f"{i // 2 + 1} (OR)", "sitting": f"Fictional {2020 + i % 3}"} for i, rng_marks in enumerate([7, 7, 5, 5, 10, 10, 2, 2, 7, 7, 3, 3])]
    ac = write_academics(tmp_path, or_paper(qs))
    kv = MemKV()
    seen_done: set[str] = set()
    day0 = date(2026, 11, 9)
    plan = None
    for i in range(12):
        today = (day0 + timedelta(days=i)).isoformat()
        plan = g.Plan(kv, bank_loader=lambda: g.merge_bank({}), academics_loader=lambda: ac,
                      apps=g.Applications(tmp_path / "i.json", tmp_path / "a.json"))       # a fresh Plan: a restart
        if i == 5:                                                                         # a migration: old raw state + junk keys
            raw = json.loads(kv.get(g.PLAN_KEY))
            raw["legacy_field"] = {"x": 1}
            kv.set(g.PLAN_KEY, json.dumps(g.merge_plan_state(raw, today)))
        d = plan.today(today)
        offered = [q["id"] for c in d["contracts"] for q in c.get("questions") or []]
        assert not set(offered) & seen_done, f"{today}: a done question came back: {set(offered) & seen_done}"
        assert len(offered) == len(set(offered))
        for c in d["contracts"]:
            if c.get("questions"):
                plan.complete(c["key"], today=today)
                seen_done |= {q["id"] for q in c["questions"]}
    assert seen_done == {q["id"] for q in ac["subjects"][0]["question_bank"]}            # both halves of every OR pair got practised


# ------------------------------------------------------------------ 6. gaps: welcome back once, refreshers at 30 days
def two_node_bank():
    return g.merge_bank({"skilltree.json": {"nodes": [
        {"id": "hdl.a", "name": "HDL A", "branch": "hdl", "prereqs": [], "contracts": [{"id": f"a{i}", "title": f"A{i}", "minutes": 45} for i in range(6)]},
        {"id": "ml.b", "name": "ML B", "branch": "ml", "prereqs": [], "contracts": [{"id": "b1", "title": "B1", "minutes": 30}]}]}})


SHAMING = re.compile(r"(?i)\b(lazy|failed|failure|disappoint|should have|shame|behind schedule|wasted)\b")


@pytest.mark.parametrize("idle,shown", [(1, False), (3, False), (4, True), (9, True), (40, True)])
def test_welcome_back_starts_at_four_idle_days(idle, shown, tmp_path, private):
    plan = new_plan(tmp_path, two_node_bank())
    plan.complete("hdl.a/a0", today="2026-10-26")
    back = (date(2026, 10, 26) + timedelta(days=idle)).isoformat()
    wb = plan.today(back)["welcome_back"]
    assert bool(wb) is shown
    if wb:
        assert wb["idle_days"] == idle and not SHAMING.search(wb["say"]) and "that's fine" in wb["say"]


def test_welcome_back_fires_once_per_gap(tmp_path, private):
    plan = new_plan(tmp_path, two_node_bank())
    plan.complete("hdl.a/a0", today="2026-10-26")
    d = plan.today("2026-11-02")
    assert d["welcome_back"]
    assert plan.today("2026-11-02")["welcome_back"] == d["welcome_back"]               # the same message on a reload, not a new one
    plan.complete(next(c["key"] for c in d["contracts"] if not c["done"]), today="2026-11-02")
    assert plan.today("2026-11-02")["welcome_back"] is None                            # one win and it's gone
    assert plan.today("2026-11-03")["welcome_back"] is None


@pytest.mark.parametrize("after,shown", [(29, False), (30, True), (90, True)])
def test_refreshers_start_at_thirty_days(after, shown, tmp_path, private):
    plan = new_plan(tmp_path, two_node_bank())
    plan.master_node("ml.b", today="2026-10-26")
    day = (date(2026, 10, 26) + timedelta(days=after)).isoformat()
    ref = [c for c in plan.today(day)["contracts"] if c["key"].startswith("refresh/ml.b/")]
    assert bool(ref) is shown
    if ref:
        assert_contract_complete(ref[0])
        plan.complete(ref[0]["key"], today=day)
        nxt = (date.fromisoformat(day) + timedelta(days=1)).isoformat()
        assert not [c for c in plan.today(nxt)["contracts"] if c["key"].startswith("refresh/ml.b/")]


# ------------------------------------------------------------------ 7. internship deadlines
@pytest.mark.parametrize("days,status,due", [(0, "idea", True), (14, "preparing", True), (15, "idea", False), (-1, "idea", False),
                                             (5, "applied", False), (5, "not_eligible", False)])
def test_deadlines_within_fourteen_days_reach_today(days, status, due, tmp_path, private):
    today = date(2026, 10, 26)
    cal = tmp_path / "internships.json"
    cal.write_text(json.dumps([{"id": "x", "org": "Fictional Lab", "programme": "Summer", "status": status,
                                "closes": (today + timedelta(days=days)).isoformat()}]), encoding="utf-8")
    apps = g.Applications(cal, tmp_path / "applications.json")
    plan = new_plan(tmp_path, two_node_bank(), apps=apps)
    d = plan.today(today.isoformat())
    assert ([x["id"] for x in d["deadlines"]] == ["x"]) is due
    v = apps.view(today.isoformat())
    if days < 0:                                     # past: never nags, sorted last, not open
        row = v["applications"][0]
        assert not row["open_now"] and row["days_left"] == -1 and "closes" not in g.deadlines_say(v).split(":")[-1]


# ------------------------------------------------------------------ 8. the learning log
def b64(data: bytes) -> str:
    return base64.b64encode(data).decode()


@pytest.mark.parametrize("name", ["../../evil.pdf", "..\\..\\evil.pdf", "C:\\Windows\\evil.pdf", "/etc/evil.pdf", "nötes ü.pdf",
                                  "नोट्स.pdf", "a" * 300 + ".pdf", "CON.pdf"])
def test_learning_uploads_stay_in_the_entry_folder(name, tmp_path, private):
    plan = new_plan(tmp_path, two_node_bank())
    r = g.add_learning(plan, "Read about HDL A timing", 30, files=[{"name": name, "data": b64(b"%PDF-1.4")}], today="2026-10-26")
    folder = private / "learning" / "2026" / "10" / r["entry"]["id"]
    saved = folder / r["entry"]["files"][0]
    assert saved.exists() and saved.resolve().parent == folder.resolve()
    assert r["entry"]["files"][0] == "hdl-timing.pdf"                         # named from his words, never from the upload
    assert {p.name for p in (private / "learning").rglob("*") if p.is_file()} == {"meta.json", "hdl-timing.pdf"}


def test_learning_limits_and_nothing_written_on_a_refusal(tmp_path, private):
    plan = new_plan(tmp_path, two_node_bank())
    ok = g.add_learning(plan, "Exactly ten megabytes", files=[{"name": "big.txt", "data": b64(b"x" * g.LEARN_MAX_FILE)}], today="2026-10-26")
    assert ok["ok"]
    before = sorted(str(p) for p in (private / "learning").rglob("*"))
    bad = [
        dict(files=[{"name": "big.txt", "data": b64(b"x" * (g.LEARN_MAX_FILE + 1))}]),
        dict(files=[{"name": f"f{i}.txt", "data": b64(b"x")} for i in range(g.LEARN_MAX_FILES + 1)]),
        dict(files=[{"name": "run.exe", "data": b64(b"MZ")}]),
        dict(files=[{"name": "noext", "data": b64(b"x")}]),
        dict(files=[{"name": "a.pdf", "data": "%%%"}]),
        dict(files="not a list"),
        dict(minutes="ten"),
        dict(today="../../2026-10-26"),
        dict(today="2026-02-30"),
    ]
    for kw in bad:
        with pytest.raises(ValueError):
            g.add_learning(plan, "something", **{"today": "2026-10-27", **kw})
    assert sorted(str(p) for p in (private / "learning").rglob("*")) == before


def test_a_unicode_entry_gets_a_safe_folder(tmp_path, private):
    plan = new_plan(tmp_path, two_node_bank())
    r = g.add_learning(plan, "डिजिटल लॉजिक पढ़ा", 20, today="2026-10-26")
    assert re.fullmatch(r"2026-10-26_[a-z0-9\-]+", r["entry"]["id"])
    assert g.learning_timeline()[0]["what"] == "डिजिटल लॉजिक पढ़ा"


# ------------------------------------------------------------------ 9. the real bank (data integrity)
REAL = g.load_bank(g.BANK_DIR)
RAW_FILES = {p.name: json.loads(p.read_text(encoding="utf-8")) for p in g.BANK_DIR.glob("*.json")}

# Every host a bank link points at, reviewed 2026-10-23: universities, MOOCs (NPTEL,
# Coursera, edX), publishers, official docs, vendor training, open textbooks, practice
# sites. A new host fails this test until someone checks it is a legal source.
LEGAL_HOSTS = {
    "nptel.ac.in", "ocw.mit.edu", "www.youtube.com", "github.com", "tutorial.math.lamar.edu", "www.khanacademy.org",
    "openstax.org", "assets.openstax.org", "www.coursera.org", "gate2026.iitg.ac.in", "gate2025.iitr.ac.in", "jeeadv.ac.in",
    "hdlbits.01xz.net", "projectf.io", "www.chipverify.com", "training.linuxfoundation.org", "verificationacademy.com",
    "yosyshq.readthedocs.io", "cses.fi", "d2l.ai", "arxiv.org", "www.overleaf.com", "www.chu.berkeley.edu",
    "discrete.openmathbooks.org", "mml-book.github.io", "web.stanford.edu", "projecteuler.net", "artofproblemsolving.com",
    "brilliant.org", "math.dartmouth.edu", "apps.ankiweb.net", "www.nand2tetris.org", "safari.ethz.ch", "web.ece.ucsb.edu",
    "www.paradigm-works.com", "ieeexplore.ieee.org", "verilator.org", "www.edaplayground.com", "cs61c.org", "riscv.org",
    "support.arm.com", "docs.amd.com", "www.gem5.org", "www2.eecs.berkeley.edu", "nandland.com", "kastner.ucsd.edu",
    "docs.cocotb.org", "verificationguide.com", "www.accellera.org", "zipcpu.com", "openlane2.readthedocs.io",
    "tinytapeout.com", "sscs.ieee.org", "xschem.sourceforge.io", "docs.espressif.com", "www.freertos.org", "cs50.harvard.edu",
    "beej.us", "docs.python.org", "automatetheboringstuff.com", "linuxcommand.org", "missing.csail.mit.edu", "www.tcl-lang.org",
    "learn.perl.org", "git-scm.com", "skills.github.com", "www.learncpp.com", "en.cppreference.com", "neetcode.io",
    "graphics.stanford.edu", "leetcode.com", "www.kaggle.com", "www.statlearning.com", "karpathy.ai", "course.fast.ai",
    "huggingface.co", "efficientml.ai", "pytorch.org", "www.edx.org", "eyeriss.mit.edu", "abdelfattah-class.github.io",
    "timeloop.csail.mit.edu", "docs.nvidia.com", "mlc.ai", "dlsyscourse.org", "fastmachinelearning.org", "tryhackme.com",
    "overthewire.org", "cryptopals.com", "www.netacad.com", "portswigger.net", "owasp.org", "academy.hackthebox.com",
    "www.offsec.com", "trust-hub.org", "cwe.mitre.org", "ccr.sigcomm.org", "www.microsoft.com",
    "journals.ieeeauthorcenter.ieee.org", "developers.google.com", "docs.github.com", "pages.github.com", "vlsiverify.com",
    "www.techinterviewhandbook.org", "www.asic-world.com", "nm.mathforcollege.com", "www.probabilitycourse.com",
    "services.publishing.umich.edu", "www.fulcrum.org", "www.hivemq.com", "lora-alliance.org", "www.3blue1brown.com",
    "aicdesign.org", "www.cds.caltech.edu", "www.strategyzer.com", "www.startupindia.gov.in", "www.legislative.gov.in",
    "cdnbbsr.s3waas.gov.in", "courses.csail.mit.edu",
    # skill tree v2 (2026-10-25): MIT accelerator course + tools, NVDLA, OpenROAD docs, DAAD and the three MS programmes
    "csg.csail.mit.edu", "accelergy.mit.edu", "nvdla.org", "openroad.readthedocs.io", "www.daad.de", "tu-dresden.de",
    "www.tum.de", "www.uni-stuttgart.de",
    # certificate pages
    "www.nvidia.com", "aws.amazon.com", "cloud.google.com", "learn.microsoft.com", "dac.com", "www.maven-silicon.com",
    "chipedge.com", "www.vlsisystemdesign.com", "ine.com", "www.comptia.org", "www.eccouncil.org",
    # a third-party mirror of university question papers (papers only, no textbooks):
    # kept as a judgment call, see the audit note
    "notesgallery.com",
}
# The publisher serves this one only over plain http (https times out): S. Keshav's
# "How to Read a Paper" on the SIGCOMM CCR site.
HTTP_ONLY = {"http://ccr.sigcomm.org/online/files/p83-keshavA.pdf"}
# Whole NPTEL maths courses that span two or three maths-track nodes on purpose.
SHARED_COURSES = {"math.r.nptel_engmath1_iitkgp", "math.r.nptel_transform_calculus", "math.r.nptel_prp_iitg"}


def all_links():
    for r in REAL["resources"].values():
        yield r["id"], r["url"]
        if r.get("legal_pdf_url"):
            yield r["id"], r["legal_pdf_url"]
    for c in REAL["certs"].values():
        if c.get("url"):
            yield c["id"], c["url"]


def test_real_bank_loads_clean_and_is_a_dag():
    assert REAL["order"], "the bank is committed with the app"
    assert REAL["errors"] == [] and REAL["warnings"] == []           # every prereq, resource, cert and weight resolves
    assert g.find_cycles(REAL["nodes"]) == []
    assert len(REAL["careers"]) >= 2


def test_real_bank_every_node_is_reachable_from_a_starting_node():
    roots = [n for n in REAL["order"] if not REAL["nodes"][n]["prereqs"]]
    assert roots and all(REAL["nodes"][r]["tier"] <= 1 for r in roots)
    for nid in REAL["order"]:
        closure = g.prereq_closure(REAL, nid)
        assert any(r in closure for r in roots), nid


def test_real_bank_every_contract_is_complete_and_ids_are_global():
    ids = Counter()
    for nid in REAL["order"]:
        node = REAL["nodes"][nid]
        assert node["contracts"], f"{nid} has no contracts"
        for c in node["contracts"]:
            ids[c["id"]] += 1
            for k in ("context", "hint", "success_check"):
                assert c[k].strip(), f"{nid}/{c['id']} has no {k}"
            assert c["steps"] and 5 <= c["minutes"] <= 240
    assert [k for k, v in ids.items() if v > 1] == []                 # contract ids are looked up across the whole bank


def test_real_bank_raw_references_resolve():
    """The merge drops a bad reference with a warning; check the files themselves too."""
    tree = RAW_FILES["skilltree.json"]["nodes"] + RAW_FILES["math-track.json"]["nodes"]
    node_ids = {n["id"] for n in tree}
    res_ids = {r["id"] for name in ("resources-career.json", "resources-academic.json") for r in RAW_FILES[name]} | \
        {r["id"] for r in RAW_FILES["math-track.json"]["resources"]}
    cert_ids = {c["id"] for c in RAW_FILES["certs.json"]}
    for n in tree:
        assert set(n.get("prereqs") or []) <= node_ids, n["id"]
        assert set(n.get("resources") or []) <= res_ids, n["id"]
        assert set(n.get("certs") or []) <= cert_ids | res_ids, n["id"]
    for c in RAW_FILES["certs.json"]:
        assert set(c.get("node_ids") or []) <= node_ids, c["id"]


# ------------------------------------------------------------------ 9b. skill tree v2 invariants
CAREER_NODES = [n["id"] for n in RAW_FILES["skilltree.json"]["nodes"]]
# Branches whose every node leans on maths: a node there with no maths weight is a data bug.
MATHS_BRANCHES = {"ml", "deep_learning", "ai_hardware", "analog", "devices"}


def test_real_bank_is_a_dag_with_monotonic_tiers():
    nodes = REAL["nodes"]
    assert g.find_cycles(nodes) == []
    for nid, n in nodes.items():
        for p in n["prereqs"]:
            assert n["tier"] > nodes[p]["tier"], f"{nid} (tier {n['tier']}) <= its prerequisite {p} (tier {nodes[p]['tier']})"


def test_real_bank_has_no_orphan_nodes():
    nodes = REAL["nodes"]
    has_dependents = {p for n in nodes.values() for p in n["prereqs"]}
    for nid in REAL["order"]:
        assert nodes[nid]["prereqs"] or nid in has_dependents, f"{nid} is isolated: no prerequisites and nothing needs it"
    for nid in CAREER_NODES:                                         # every career node is wanted by some career
        assert max(c["weights"].get(nid, 0) for c in REAL["careers"]) > 0, f"{nid}: no career weights it"
    for c in REAL["careers"]:                                        # and every career weighs every career node
        assert set(CAREER_NODES) <= set(c["weights"]), (c["id"], set(CAREER_NODES) - set(c["weights"]))


def test_real_bank_maths_weights_resolve_and_are_present_where_needed():
    math_ids = {n["id"] for n in RAW_FILES["math-track.json"]["nodes"]}
    for raw in RAW_FILES["skilltree.json"]["nodes"]:
        nid = raw["id"]
        assert isinstance(raw.get("maths"), dict), f"{nid}: no maths field"
        assert set(raw["maths"]) <= math_ids, f"{nid}: maths names a non-maths node"
        assert all(0 < w <= 1 for w in raw["maths"].values()), nid
        for p in raw["prereqs"]:                                    # a maths prerequisite is always weighted
            if p in math_ids:
                assert raw["maths"].get(p, 0) > 0, f"{nid}: needs {p} but gives it no maths weight"
        if raw["branch"] in MATHS_BRANCHES:
            assert raw["maths"], f"{nid}: a {raw['branch']} node with no maths weight"
        assert REAL["nodes"][nid]["maths"] == raw["maths"], nid      # the loader keeps them


def test_real_bank_every_cert_link_resolves():
    certs, nodes = REAL["certs"], REAL["nodes"]
    for nid, n in nodes.items():
        for c in n["certs"]:
            assert c in certs, f"{nid}: certificate {c} does not resolve"
    for c in RAW_FILES["certs.json"]:
        assert c["node_ids"], f"{c['id']}: names no node"
        for nid in c["node_ids"]:
            assert nid in nodes, f"{c['id']}: unknown node {nid}"
        assert set(c.get("credibility_by_career") or {}) <= {k["id"] for k in REAL["careers"]}, c["id"]
        assert c.get("url"), f"{c['id']}: no link"


def test_real_bank_third_track_dv_to_ai_accelerator():
    car = {c["id"]: c for c in REAL["careers"]}["dv_ai_accel"]
    top = {k for k, w in car["weights"].items() if w >= 0.9}
    assert {"ver.uvm", "ver.coverage_closure", "ver.sva"} <= top                 # the entry role
    assert {"aiacc.lowpower_arch", "aiacc.capstone"} <= top                       # the long-term role
    new = [n for n in REAL["order"] if n.startswith(("aiacc.", "lp.")) or n in
           {"ver.sva", "ver.cocotb", "ver.coverage_closure", "ver.ref_models", "ver.accel_dv", "ver.lowpower_dv",
            "career.dv_jobs_india", "career.ms_germany_hw"}]
    assert len(new) == 17
    closure = g.prereq_closure(REAL, "aiacc.capstone")
    assert {"ver.uvm", "lp.power_management", "aihw.accelerator"} <= set(closure)


def test_maths_weights_unknown_nodes_and_bad_numbers_warn(tmp_path):
    (tmp_path / "skilltree.json").write_text(json.dumps({"nodes": [
        {"id": "a", "name": "A", "branch": "x", "maths": {"m": 0.5, "ghost": 0.4, "bad": "high", "zero": 0}},
        {"id": "m", "name": "M", "branch": "math"}]}), encoding="utf-8")
    b = g.load_bank(tmp_path)
    assert b["nodes"]["a"]["maths"] == {"m": 0.5}
    w = " | ".join(b["warnings"])
    assert "unknown maths node ghost" in w and "maths weight for bad is not a number" in w


def test_real_bank_resources_have_one_owner():
    own = Counter(r for n in REAL["nodes"].values() for r in n["resources"])
    assert {k for k, v in own.items() if v > 1} <= SHARED_COURSES


def test_real_bank_links_are_https_and_on_the_legal_list():
    for rid, url in all_links():
        u = urlparse(url)
        assert u.scheme == "https" or url in HTTP_ONLY, f"{rid}: not https: {url}"
        assert u.netloc in LEGAL_HOSTS, f"{rid}: host {u.netloc} is not on the reviewed list"
        assert not re.search(r"(?i)(libgen|z-lib|scribd|pdfdrive|sci-hub|torrent|annas-archive)", url), url


def test_real_bank_certificate_prices_say_how_sure_they_are():
    for c in REAL["certs"].values():
        if c["cost_inr"]:
            assert c["price_status"].strip(), f"{c['id']}: a price with no status"


PERSONAL = [r"[\w.+-]+@[\w-]+\.[a-z]{2,}", r"(?<![\d/.=_-])(?:\+91[\s-]?)?[6-9]\d{9}(?!\d)", r"(?i)\b(cgpa|sgpa)\s*[:=]?\s*\d",
            r"(?i)\b(usn|roll\s*no|register\s*no|enrol?ment\s*no)\b", r"(?i)\bmarks\s+(obtained|scored)\b"]


def test_real_bank_and_fixtures_hold_no_personal_data():
    texts = {p.name: p.read_text(encoding="utf-8") for p in g.BANK_DIR.glob("*.json")}
    texts |= {p.name: p.read_text(encoding="utf-8") for p in FIX.rglob("*.json")}
    for name, t in texts.items():
        for pat in PERSONAL:
            hit = re.search(pat, t)
            assert not hit, f"{name}: {hit.group(0)!r}"


def test_every_bank_branch_serves_a_ladder_milestone():
    ladder = g.load_ladder(Path("no-such-ladder.json"))
    for nid in REAL["order"]:
        node = REAL["nodes"][nid]
        c = g._tree_contract(REAL, g.default_plan_state("2026-10-26"), node, node["contracts"][0], "library", "x")
        assert g.serves_for(c, ladder, "2026-10-26"), f"branch {node['branch']} serves no milestone"


# ------------------------------------------------------------------ 10. vision alignment: 8 weeks on the real bank
TRUNK = {"digital_logic", "hdl", "verification", "implementation", "fpga", "architecture", "programming"}
AIHW = {"ai_hardware", "ml", "deep_learning"}


def group_of(c: dict) -> str:
    b = c.get("branch") or ""
    if c["source"] == "academics":
        return "maths" if "math" in (c.get("subject_id") or "") else "academics"
    if b == "math" or "maths" in (c.get("why") or "").lower():
        return "maths"
    return "trunk" if b in TRUNK else "aihw" if b in AIHW else "other"


def simulate(plan: g.Plan, start: str, days: int, rng: random.Random | None = None, skip=None, share: float = 1.0,
             record=None) -> list[tuple[str, dict]]:
    """A user who opens Today and finishes contracts: all of them, or each with
    probability `share`, skipping the days `skip(day)` says."""
    done = []
    for i in range(days):
        day = (date.fromisoformat(start) + timedelta(days=i)).isoformat()
        if skip and skip(day):
            continue
        d = plan.today(day)
        if record:
            record(day, d)
        for c in d["contracts"]:
            if c["done"] or (rng and rng.random() > share):
                continue
            plan.complete(c["key"], today=day)
            done.append((day, c))
    return done


def vision_run(tmp_path: Path, career: str | None, weeks: int = 8) -> dict:
    plan = new_plan(tmp_path / (career or "none"), REAL)
    if career:
        plan.set_career(career)
    done = simulate(plan, "2026-10-26", weeks * 7)
    mins = Counter()
    branch = Counter()
    for _, c in done:
        mins[group_of(c)] += c["minutes"]
        branch[c["branch"]] += c["minutes"]
    st = plan.load("2026-12-20")
    return {"minutes": mins, "branch": branch, "mastered": sum(1 for v in st["nodes"].values() if v.get("status") == "mastered"),
            "contracts": len(done), "wip": len(g.wip(REAL, st))}


@pytest.mark.parametrize("career", [None, "vlsi_design", "ai_hw_architect", "dv_ai_accel"])
def test_vision_eight_weeks_cover_the_trunk_and_feed_the_branch(career, tmp_path, private):
    r = vision_run(tmp_path, career)
    m = r["minutes"]
    total = sum(m.values())
    assert total > 0
    assert m["trunk"] / total >= 0.35, m                         # the VLSI trunk is the biggest share
    assert m["trunk"] >= m["aihw"], m
    assert m["aihw"] > 0 and m["maths"] / total >= 0.12, m       # the branch and the maths are never starved
    assert r["branch"]["verification"] > 0 or r["branch"]["hdl"] > 0
    assert r["wip"] <= 3


def exam_world(tmp_path: Path, backlog_day: str) -> tuple[g.Plan, dict]:
    p = tmp_path / "exam" / "academics.json"
    p.parent.mkdir(parents=True)
    shutil.copy(FIX / "academics.json", p)
    shutil.copy(FIX / "math-rescue.json", p.parent / "math-rescue.json")
    g.set_exam_date("calendar:backlog_block_start", backlog_day, p, p.parent / "overrides.json")
    ac = g.load_academics(p)
    return new_plan(tmp_path, REAL, academics=ac), ac


def test_vision_exam_phases_keep_maths_and_put_resits_first(tmp_path, private):
    """Eight weeks through the fictional exam season: every library day in the 14 days
    before the re-sit block has re-sit work, and no exam-phase week goes without maths."""
    plan, ac = exam_world(tmp_path, "2026-12-14")
    days: dict[str, list[dict]] = {}
    simulate(plan, "2026-10-26", 56, record=lambda day, d: days.__setitem__(day, d["contracts"]))
    backlog = {s["id"] for s in ac["subjects"] if s["kind"] == "backlog"}
    week_maths = defaultdict(int)
    for day, cs in days.items():
        wk = date.fromisoformat(day).isocalendar()[1]
        week_maths[wk] += sum(c["minutes"] for c in cs if group_of(c) == "maths")
        left = (date(2026, 12, 14) - date.fromisoformat(day)).days
        # the plan's own "exam window" phase gives the day of (and before) a sem-5 paper
        # to that paper: he is sitting it. Every other day before the re-sit has re-sit work.
        paper_day = any(0 <= (date.fromisoformat(s["dates"]["end_sem"]) - date.fromisoformat(day)).days <= 1
                        for s in ac["subjects"] if s["kind"] == "current" and s["dates"].get("end_sem"))
        if 0 <= left <= 14 and date.fromisoformat(day).isoweekday() <= 5 and not paper_day:
            assert any(c.get("subject_id") in backlog for c in cs if c["slot"] == "library"), f"{day}: no re-sit prep {left} days out"
        for c in cs:
            assert_contract_complete(c, day)
    assert all(v > 0 for v in week_maths.values()), dict(week_maths)


# ------------------------------------------------------------------ 11. 90 days of realistic use
def realistic_run(tmp_path: Path, seed: int = 2026) -> dict:
    """90 days from 26 Oct: skips ~1 day in 5, a 9-day gap in December, an exam season
    (the fictional academics), half-finished days, the odd swap to an alternative and
    learning-log entries. Returns what the engine did, for the audit note."""
    rng = random.Random(seed)
    plan, ac = exam_world(tmp_path, "2026-12-14")
    stats = Counter()
    issues: list[str] = []
    gap = {(date(2026, 12, 18) + timedelta(days=i)).isoformat() for i in range(9)}
    offered_done: set[str] = set()
    for i in range(90):
        day = (date(2026, 10, 26) + timedelta(days=i)).isoformat()
        if day in gap or rng.random() < 0.2:
            stats["skipped"] += 1
            continue
        d = plan.today(day)
        st = plan.load(day)
        stats["opened"] += 1
        stats["welcome_back"] += bool(d["welcome_back"])
        stats["refreshers"] += sum(1 for c in d["contracts"] if c["key"].startswith("refresh/"))
        lib = [c for c in d["contracts"] if c["slot"] in ("library", "weekend")]
        if not lib:
            issues.append(f"{day}: no library/weekend contract")
        if d["exam"]:
            stats["exam_days"] += 1
        for c in d["contracts"]:
            assert_contract_complete(c, day)
            if not c.get("serves"):
                stats["no_goal"] += 1
            if c["source"] == "tree" and c["key"] in st["contracts"] and not c["done"]:
                issues.append(f"{day}: {c['key']} shown open but done")
        qs = {q["id"] for c in d["contracts"] if not c["done"] for q in c.get("questions") or []}
        if qs & offered_done:
            issues.append(f"{day}: a done question came back")
        if d["alternatives"] and rng.random() < 0.15:
            open_lib = [c for c in lib if not c["done"] and c["source"] == "tree"]
            if open_lib:
                try:
                    plan.choose(open_lib[0]["key"], d["alternatives"][0]["key"], today=day)
                    stats["swaps"] += 1
                except (KeyError, ValueError) as e:
                    issues.append(f"{day}: an offered alternative was refused: {e}")
                d = plan.today(day)
        share = rng.choice([1.0, 1.0, 0.6, 0.3])
        for c in d["contracts"]:
            if not c["done"] and rng.random() < share:
                r = plan.complete(c["key"], today=day)
                stats["completed"] += 1
                stats[f"queued_{r.get('queued')}"] += bool(r.get("queued"))
                offered_done |= {q["id"] for q in c.get("questions") or []}
        if rng.random() < 0.1:
            g.add_learning(plan, "Read a chapter on verification coverage", 30, today=day)
            stats["learning"] += 1
        assert_tree_invariants(REAL, plan.load(day), day)
    st = plan.load("2027-01-23")
    stats["mastered"] = sum(1 for v in st["nodes"].values() if v.get("status") == "mastered")
    stats["questions_done"] = len(st["questions_done"])
    return {"stats": stats, "issues": issues}


def test_ninety_days_of_realistic_use_keep_track(tmp_path, private):
    r = realistic_run(tmp_path)
    s = r["stats"]
    assert r["issues"] == []
    assert s["welcome_back"] >= 1 and s["exam_days"] > 0 and s["mastered"] > 0
    assert s["no_goal"] == 0


# ------------------------------------------------------------------ 12. the voice parser (core/mission.py)
def test_voice_parser_never_completes_on_a_question_and_never_raises():
    import mission                                                       # core/mission.py
    for q in ("did I finish it?", "have I finished it", "should I finish this one?", "what if I finished it", "can I finish it later"):
        p = mission.parse_plan(q)
        assert not p or p.get("action") != "complete", q
    assert mission.parse_plan("I've finished it")["action"] == "complete"
    rng = random.Random(9)
    alphabet = "abcdefghijklmnopqrstuvwxyz :,.?!-0123456789ाकि"
    words = ["log", "park", "exam", "mode", "off", "days", "to", "finished", "it", "deadline", "internship", "next", "tree", "40", "min"]
    for _ in range(2000):
        t = " ".join(rng.choice(words) if rng.random() < 0.7 else "".join(rng.choice(alphabet) for _ in range(rng.randint(1, 6)))
                     for _ in range(rng.randint(0, 9)))
        p = mission.parse_plan(t)
        assert p is None or isinstance(p, dict)
