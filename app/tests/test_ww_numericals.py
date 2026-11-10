"""Parameterised numericals (ww_numericals.py) and their independent checker (ww_check_numericals.py):
the same seed is the same item, 200 seeds per template agree with a checker that never touches sympy,
a gate item chains concepts, a wrecked key is caught, and a paper on an empty bank gets generated
numericals and says so. All subjects and numbers here are made up for the test."""
import json
import subprocess
import sys
from pathlib import Path

import pytest

from jarvis_app import germoney, ww_check, ww_check_numericals as chk, ww_generator as gen, ww_numericals as num

APP = Path(__file__).resolve().parents[1]
ALL = num.templates()
EXAM, GATE = num.templates("exam"), num.templates("gate")

UNITS = [{"n": 1, "title": "Stability", "exam_weight": "high", "topics": ["Routh-Hurwitz stability", "Steady-state error"]},
         {"n": 2, "title": "Time response", "exam_weight": "med", "topics": ["Second-order transient response", "Thevenin and RC circuits"]},
         {"n": 3, "title": "Laplace", "exam_weight": "low", "topics": ["Laplace transform and partial fractions", "Transfer function and DC gain"]}]
EXAM_ROW = {"id": "see-x", "subject": "x", "title": "X", "units": [], "max": 60, "pattern": gen.DEFAULT_PATTERN}


# ------------------------------------------------------------------ determinism
@pytest.mark.parametrize("tpl", ALL)
def test_same_seed_same_item_and_another_seed_another_item(tpl):
    assert num.make(tpl, 7) == num.make(tpl, 7)
    assert num.make(tpl, 7)["params"] != num.make(tpl, 8)["params"] or num.make(tpl, 7)["answer"] != num.make(tpl, 8)["answer"]


def test_same_item_in_another_process_with_another_hash_salt():
    code = "import json;from jarvis_app import ww_numericals as n;print(json.dumps([n.make(t,41) for t in n.templates()],sort_keys=True))"
    runs = []
    for salt in ("1", "977"):
        env = {"PYTHONHASHSEED": salt, "PYTHONPATH": str(APP), "JARVIS_DATA_DIR": str(APP / "data" / "x"), "SYSTEMROOT": "C:\\Windows"}
        runs.append(subprocess.run([sys.executable, "-c", code], capture_output=True, text=True, env=env, timeout=120, cwd=str(APP)).stdout)
    here = json.dumps([num.make(t, 41) for t in ALL], sort_keys=True)
    assert runs[0] and runs[0] == runs[1] == here + "\n"


# ------------------------------------------------------------------ the keys
@pytest.mark.parametrize("tpl", ALL)
def test_200_seeds_have_no_key_mismatch_against_the_independent_checker(tpl):
    bad = []
    for seed in range(200):
        for pr in chk.check_item(num.make(tpl, seed)):
            bad.append(f"seed {seed}: {pr}")
    assert bad == [], bad[:5]


def test_the_checker_does_not_load_sympy():
    # the items arrive as JSON (the public form); checking all of them must never import sympy
    items = [num.make(t, s) for t in ALL for s in range(3)]
    code = ("import sys,json;from jarvis_app import ww_check_numericals as c;"
            "its=json.loads(sys.stdin.read());bad=[p for it in its for p in c.check_item(it)];print(bad,'sympy' in sys.modules)")
    env = {"PYTHONPATH": str(APP), "JARVIS_DATA_DIR": str(APP / "data" / "x"), "SYSTEMROOT": "C:\\Windows"}
    r = subprocess.run([sys.executable, "-c", code], input=json.dumps(items), capture_output=True, text=True, env=env, timeout=120, cwd=str(APP))
    assert r.stdout.strip() == "[] False", (r.stdout, r.stderr[-400:])
    assert "import sympy" not in Path(chk.__file__).read_text(encoding="utf-8").replace("independent checker never imports sympy", "")


@pytest.mark.parametrize("tpl", ALL)
def test_a_wrecked_key_is_caught(tpl):
    it = num.make(tpl, 3)
    wrecked = {**it, "answer": it["answer"] + 1 if it["answer"] == int(it["answer"]) else it["answer"] * 1.05}
    assert chk.check_item(it) == []
    assert any("independent value" in p for p in chk.check_item(wrecked))


def test_wrecked_structure_is_caught_too():
    it = num.make("rc_thevenin", 3)
    assert any("concept" in p for p in chk.check_item({**it, "concepts": it["concepts"][:1]}))
    ex = num.make("rc_tau", 3)
    assert any("concepts" in p for p in chk.check_item({**ex, "concepts": ["a", "b"]}))
    assert any("off the grid" in p for p in chk.check_item({**ex, "params": {**ex["params"], "C_uf": 22.5}}))
    assert any("not the printed" in p for p in chk.check_item({**ex, "ranges": {**ex["ranges"], "C_uf": [1, 500, 1]}}))
    assert any("generated" in p for p in chk.check_item({**ex, "origin": "typed"}))
    assert any("unmatched" in p for p in chk.check_item({**ex, "question": ex["question"] + " $"}))


def test_the_printed_ranges_are_pinned():
    assert num.RANGES["zeta_s"] == (0.1, 0.7, 0.05)             # past 0.7 the 4/(zeta wn) estimate runs 33 percent long
    assert num.RANGES["C_uf"] == (1, 100, 1) and num.RANGES["Mp"] == (5, 50, 5)
    assert len(EXAM) == 7 and len(GATE) == 6


def test_settling_estimate_stays_inside_the_measured_band():
    s = chk.settling_spread(200)
    assert s["worst_abs"] < chk.SETTLING_BAND and s["worst_abs"] > 0.2, s      # the band is measured, not slack


# ------------------------------------------------------------------ tiers
@pytest.mark.parametrize("tpl", EXAM)
def test_exam_items_are_one_concept(tpl):
    for seed in range(20):
        it = num.make(tpl, seed)
        assert it["tier"] == "exam" and len(it["concepts"]) == 1 and it["marks"] == 5
        assert it["question"].replace("\\$", "").count("$") % 2 == 0 and "$" in it["question"]


@pytest.mark.parametrize("tpl", GATE)
def test_gate_items_really_chain_concepts(tpl):
    same: dict[str, int] = {}
    for seed in range(40):
        it = num.make(tpl, seed)
        assert it["tier"] == "gate" and len(it["concepts"]) >= 2 and it["marks"] == 10
        # one worked line per concept plus the heading: the solution walks the chain
        assert len(it["solution"].split("\n")) >= len(it["concepts"]) + 1
        # the key is none of the intermediate values: answering the first step alone does not score
        assert it["values"], tpl
        for k, v in it["values"].items():
            same[k] = same.get(k, 0) + (abs(v - it["answer"]) <= 1e-6 * max(1.0, abs(v)))
    # a coincidence (a step of height 1 makes y_ss equal T(0)) is allowed now and then, never as the rule
    assert all(n <= 20 for n in same.values()), (tpl, same)
    # and the key moves when the first link of the chain moves
    base = num.make(tpl, 5)
    assert any(num.make(tpl, s)["answer"] != base["answer"] for s in range(6, 30))


def test_gate_items_are_harder_to_guess_than_exam_items():
    # an exam question has one step; the gate worked solutions are longer in lines
    ex = sum(len(num.make(t, s)["solution"].split("\n")) for t in EXAM for s in range(10)) / (10 * len(EXAM))
    ga = sum(len(num.make(t, s)["solution"].split("\n")) for t in GATE for s in range(10)) / (10 * len(GATE))
    assert ga > ex + 1


def test_routh_items_cover_both_stable_and_unstable_counts():
    counts = {num.make("routh_count", s)["answer"] for s in range(80)} | {num.make("routh_param", s)["answer"] for s in range(80)}
    assert {0, 1, 2}.issubset(counts), counts


# ------------------------------------------------------------------ the paper
def test_a_paper_on_an_empty_bank_with_a_template_gets_numericals_and_says_so():
    p = gen.generate(EXAM_ROW, [], UNITS, {}, {}, seed=4)
    qs = [q for s in p["sections"] for q in s["questions"]]
    assert len(qs) == 20 and all(q["origin"] == "generated" for q in qs) and p["empty"] is False
    # the bank is still empty and the paper says so, seat by seat; the numericals only fill the seats
    assert len(p["shortfall"]) == 3 and all("0 of" in x and "generated numerical" in x for x in p["shortfall"])
    assert "generated numericals" in p["numericals_note"] and p["numericals"] == 20
    assert "generated numericals" in gen.as_markdown(p) and "generated, seed" in gen.as_markdown(p)
    assert gen.paper_invariants(p, EXAM_ROW) == []
    assert len({q["text"] for q in qs}) == 20                                  # no question twice
    assert all(q["seed"] == num.question_from_id(q["id"], UNITS)["seed"] and q["topic"] for q in qs)
    assert p == gen.generate(EXAM_ROW, [], UNITS, {}, {}, seed=4)              # same seed, same paper
    assert [q["id"] for q in qs] != [q["id"] for s in gen.generate(EXAM_ROW, [], UNITS, {}, {}, seed=5)["sections"] for q in s["questions"]]


def test_a_gate_paper_is_gate_tier_and_built_from_the_gate_templates():
    p = gen.generate(EXAM_ROW, [], UNITS, {}, {}, seed=2, tier="gate")
    qs = [q for s in p["sections"] for q in s["questions"]]
    assert p["tier"] == "gate" and p["tier_note"] is None and qs
    assert all(q["template"] in GATE and len(q["concepts"]) >= 2 for q in qs)
    assert p["bank_size"] == 0 and p["numericals"] == len(qs)


def test_a_short_bank_is_topped_up_and_a_full_bank_is_left_alone():
    b = [{"id": f"q{i}", "unit": 1, "topic": "Routh-Hurwitz stability", "question": f"Real question {i}", "marks": 2, "type": "pyq_see",
          "section": "A", "sitting": "Jun 2026"} for i in range(5)]
    p = gen.generate(EXAM_ROW, b, UNITS, {}, {}, seed=1)
    a, rest = p["sections"][0]["questions"], [q for s in p["sections"][1:] for q in s["questions"]]
    assert all(q.get("origin") != "generated" for q in a) and all(q["origin"] == "generated" for q in rest)
    assert p["bank_size"] == 5 and p["empty"] is False
    assert [x.split(":")[0] for x in p["shortfall"]] == ["Section B", "Section C"]      # A is full from the bank
    full = [{"id": f"f{sec}{i}", "unit": 1, "topic": "Routh-Hurwitz stability", "question": f"Full {sec}{i}", "marks": mk, "type": "pyq_see", "section": sec,
             "sitting": "Jun 2026"} for sec, mk, n in (("A", 2, 5), ("B", 7, 10), ("C", 5, 5)) for i in range(n)]
    q = gen.generate(EXAM_ROW, full, UNITS, {}, {}, seed=1)
    assert "numericals" not in q and "numericals_note" not in q
    assert all(x.get("origin") != "generated" for s in q["sections"] for x in s["questions"])


def test_topics_without_a_template_get_nothing_generated():
    other = [{"n": 1, "title": "U", "exam_weight": "high", "topics": ["Tort law", "Contracts"]}]
    p = gen.generate(EXAM_ROW, [], other, {}, {}, seed=1)
    assert p["empty"] is True and "numericals" not in p
    g = gen.generate(EXAM_ROW, [], other, {}, {}, seed=1, tier="gate")
    assert g["tier"] == "exam" and "No GATE-tier questions" in g["tier_note"]          # the old honest downgrade


def test_a_unit_outside_the_exam_scope_is_not_used():
    row = {**EXAM_ROW, "units": [3]}
    p = gen.generate(row, [], UNITS, {}, {}, seed=1)
    assert {q["unit"] for s in p["sections"] for q in s["questions"]} == {3}


# ------------------------------------------------------------------ marks on generated ids, through the real plan
def _plan(tmp_path, monkeypatch):
    subject = {"id": "ctl", "name": "Control", "units": UNITS, "question_bank": []}
    row = {"id": "ctl-exam", "subject": "ctl", "title": "Control exam", "date": "2026-12-14", "kind": "end_sem", "max": 60, "target": 40}
    (tmp_path / "inputs.json").write_text(json.dumps({"exams": [row], "subjects": [subject]}), encoding="utf-8")
    monkeypatch.setenv("JARVIS_ENGINE_INPUTS", str(tmp_path / "inputs.json"))
    return germoney.Plan(germoney.KVStore(tmp_path / "kv", tmp_path / "bk"), bank_loader=lambda: germoney.merge_bank({}), academics_loader=lambda: None,
                         apps=germoney.Applications(calendar=tmp_path / "no-calendar.json", store=tmp_path / "apps.json"))


def test_marks_on_generated_numericals_are_saved_and_move_proficiency(tmp_path, monkeypatch):
    plan = _plan(tmp_path, monkeypatch)
    paper = plan.practice_paper("ctl-exam", seed=3, today="2026-11-10")
    assert paper["numericals"] == 20 and paper["empty"] is False
    qs = [q for s in paper["sections"] for q in s["questions"]]
    topic = qs[0]["key"]
    items = [{"id": q["id"], "got": 0, "max": q["marks"]} for q in qs if q["key"] == topic]
    before = plan.load("2026-11-10").get("paper_marks") or {}
    res = plan.paper_marks("ctl-exam", {"items": items, "seed": 3}, today="2026-11-10")
    assert res["saved"] == len(items) and res["score"] == 0
    saved = plan.load("2026-11-10")["paper_marks"]["ctl"][topic]
    assert len(saved) == len(items) and all(e["origin"] == "generated" and isinstance(e["seed"], int) for e in saved) and not before
    full = plan.paper_marks("ctl-exam", {"items": [{"id": q["id"], "got": q["marks"], "max": q["marks"]} for q in qs if q["key"] == topic]}, today="2026-11-10")
    assert full["proficiency"][topic] > res["proficiency"][topic]


def test_marks_on_a_made_up_generated_id_are_refused(tmp_path, monkeypatch):
    plan = _plan(tmp_path, monkeypatch)
    for bad in ("n:rc_tau:5:u9", "n:nope:5:u1", "n:rc_tau:x:u1", "n:routh_count:5:u3"):       # unit 9 absent; unknown template; no seed; unit 3 has no Routh topic
        with pytest.raises(ValueError):
            plan.paper_marks("ctl-exam", {"items": [{"id": bad, "got": 1, "max": 5}]}, today="2026-11-10")
    ok = plan.paper_marks("ctl-exam", {"items": [{"id": "n:routh_count:5:u1", "got": 2, "max": 5}]}, today="2026-11-10")
    assert ok["saved"] == 1


def test_the_practice_route_json_carries_the_answer_and_seed_of_each_numerical(tmp_path, monkeypatch):
    plan = _plan(tmp_path, monkeypatch)
    p = plan.practice_paper("ctl-exam", seed=6, tier="gate", today="2026-11-10")
    q = p["sections"][0]["questions"][0]
    assert q["origin"] == "generated" and isinstance(q["seed"], int) and q["answer_text"] and q["solution"] and q["concepts"]
    json.dumps(p)                                                                       # plain data all the way down


# ------------------------------------------------------------------ the gate
def test_the_gate_report_carries_the_numericals_check():
    r = ww_check.report(None, "2026-11-10")
    assert r["numericals"]["problems"] == [] and r["numericals"]["templates"] == 13 and r["numericals"]["items"] == 20 * 13
    assert "Numericals" in ww_check.as_markdown(r)
    assert r["numericals"]["seconds"] < 40, r["numericals"]["seconds"]      # 3.4 s alone; 21 s measured with other builders running
