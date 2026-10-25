"""Well Wisher engine registry (ww_engines.py + ww_base.py): engines registered by name
with a version and a schema; run() checks the inputs first; the inputs file is read
in both shapes (life-goal tree and flat goals). Fixtures are fictional."""
import importlib
import json
from pathlib import Path

import pytest

from jarvis_app import ww_base as wb
from jarvis_app import ww_engines as we

FLAT = Path(__file__).with_name("fixtures") / "ww-inputs-flat.json"
MON = "2026-10-26"


@pytest.fixture()
def flat():
    return we.load_inputs(FLAT)


@pytest.fixture()
def example():
    return we.load_inputs(Path("no-such-inputs.json"))


# ------------------------------------------------------------------ the registry
def test_every_engine_is_registered_by_name_with_a_version_and_a_schema():
    assert [n for n, _ in we.ENGINE_TABLE] == list(we.REGISTRY) == list(we.ENGINES)
    for name, mod in we.ENGINE_TABLE:
        spec = we.REGISTRY[name]
        assert spec.name == name and isinstance(spec.version, int) and callable(spec.fn)
        if mod:                                            # one file per engine, exporting ENGINE
            assert importlib.import_module(f"jarvis_app.{mod}").ENGINE is spec
        d = spec.describe()
        assert d["name"] == name and set(d) >= {"version", "inputs", "data", "needs"}
    assert [d["name"] for d in we.describe()] == list(we.REGISTRY)


def test_run_checks_the_schema_before_the_engine(example):
    ok = we.run("goal_ladder", example, MON)
    assert ok["status"] == "ok" and ok["version"] == we.REGISTRY["goal_ladder"].version
    bad = we.run("goal_ladder", {**example, "deadlines": [{"id": "x", "date": "soon"}]}, MON)
    assert bad["status"] == "invalid_input" and any("deadlines[0].date" in p for p in bad["problems"])
    assert we.run("goal_ladder", {k: v for k, v in example.items() if k != "skills"}, MON)["problems"] == ["inputs: missing skills"]
    assert "data: goal_ladder takes no wat" in we.run("goal_ladder", example, MON, wat=1)["problems"]
    assert we.run("evidence", example, "26 Oct")["status"] == "invalid_input"
    with pytest.raises(KeyError):
        we.run("astrology", example, MON)


def test_the_schema_checker():
    s = {"type": "list", "items": {"type": "dict", "required": {"d": {"type": "date"}, "n": {"type": "num", "optional": True}}}}
    assert wb.check([{"d": "2026-01-31", "n": None}, {"d": "2026-02-01", "n": 2.5}], s) == []
    probs = wb.check([{"d": "2026-02-30"}, {"n": True}, "x"], s, "rows")
    assert probs == ["rows[0].d: expected date, got str", "rows[1]: missing d",          # an optional key may be absent
                     "rows[1].n: expected num, got bool", "rows[2]: expected dict, got str"]
    assert wb.check({"a": [1, "2"]}, {"type": "dict", "values": {"type": "list", "items": {"type": "int"}}}) == ["inputs.a[1]: expected int, got str"]
    assert wb.check("2026-13", {"type": "month"}) and not wb.check("2026-12", {"type": "month"})


def test_shared_helpers():
    assert [wb.inr(x) for x in (0, 999, 1000, 123456, 10000000, None)] == \
        ["Rs 0", "Rs 999", "Rs 1,000", "Rs 1,23,456", "Rs 1,00,00,000", "unknown"]
    assert wb.add_days("2026-12-30", 3) == "2027-01-02" and wb.days_between("2026-10-26", "2026-11-02") == 7
    assert wb.no_shame("Welcome back. Two days off happens.") and not wb.no_shame("You failed again?")


# ------------------------------------------------------------------ inputs, schema 2
def test_flat_goals_deadlines_without_ids_and_word_levels_are_read(flat):
    assert flat["source"] == "private" and flat["schema"] == 2
    assert [g["id"] for g in flat["goals"]] == ["G-quiz", "G-repo", "G-offer", "G-msapps", "G-pay"]
    kinds = {g["id"]: g["kind"] for g in flat["goals"]}
    assert kinds == {"G-quiz": "exam", "G-repo": "other", "G-offer": "internship", "G-msapps": "ms", "G-pay": "income"}
    assert [d["kind"] for d in flat["deadlines"]] == ["exam", "internship", "internship", "gsoc", "ms"]
    assert all(d["id"].startswith("dl-") and d["id"].endswith(d["date"]) for d in flat["deadlines"])
    assert {k: v["level"] for k, v in flat["skills"].items()} == {"rtl": 1, "firmware": 4, "maths": 1, "odd": 0}
    assert any("goal without id" in w for w in flat["warnings"]) and any("deadline without" in w for w in flat["warnings"])


def test_rules_keep_the_hard_cap_and_never_shame(flat):
    assert flat["rules"]["max_open_projects"] == 3          # 9 asked for; 3 is the ceiling
    assert flat["rules"]["never_shame"] is True             # cannot be switched off


def test_income_experiments_and_money_are_cleaned(flat, example):
    by = {x["id"]: x for x in flat["income_experiments"]}
    assert by["IE-tutor"]["inr_per_hour"] == [300, 500] and by["IE-tutor"]["start"] == "2026-09-01"
    assert by["IE-stipend"]["inr_total"] == [50000, 50000] and by["IE-stipend"]["probability"] == 1.0
    assert by["IE-gig"]["review_after_weeks"] == 4 and by["IE-gig"]["usd_per_hour_ref"] == 10
    assert flat["money"] == {"monthly_budget": None, "assumptions": {"annual_return_pct": None, "usd_inr": None}}
    assert example["money"]["assumptions"]["annual_return_pct"] == 6
    assert [h["opt_in"] for h in flat["habits"]] == [True, False]


def test_old_files_with_life_goals_under_goals_still_work(tmp_path):
    p = tmp_path / "old.json"
    p.write_text(json.dumps({"goals": [{"id": "lg", "title": "A life goal", "years": [{"year": 2026, "milestones": [
        {"id": "m", "title": "M", "by": "2026-12-01", "skills": ["s"]}]}]}],
        "skills": [{"id": "s", "level": 1}]}), encoding="utf-8")
    inp = we.load_inputs(p)
    assert inp["life_goals"][0]["id"] == "lg" and inp["goals"] == []
    assert we.goal_ladder(inp, MON)["year"]["milestones"][0]["id"] == "m"


def test_the_ladder_uses_flat_goals_and_links_exam_contracts_to_exams(flat):
    lad = we.goal_ladder(flat, MON)
    q = [r["id"] for r in lad["quarter"]["items"]]
    assert q[:2] == ["G-quiz", "dl-class-quiz-example-2026-11-03"] and "G-repo" not in q   # Jan 2027: next quarter
    chain = next(r for r in lad["quarter"]["items"] if r["id"] == "G-quiz")["chain"]
    assert chain == [{"rung": "week", "id": "G-quiz", "title": "class quiz score"}]
    cands = [{"key": "acad/quiz/1", "title": "Quiz unit 2", "minutes": 40, "node_id": None, "source": "academics", "branch": "academics"},
             {"key": "n1/c1", "title": "Ripple adder", "minutes": 30, "node_id": "n1", "source": "tree", "branch": "digital"}]
    picks = we.goal_ladder(flat, MON, candidates=cands)["today"]
    assert picks[0]["key"] == "acad/quiz/1" and picks[0]["serves"] in ("G-quiz", "dl-class-quiz-example-2026-11-03")
    assert picks[1]["serves"] is None and picks[1]["score"] == 0


def test_a_shared_word_links_a_contract_to_a_goal_more_weakly_than_a_skill():
    r = {"id": "g", "title": "Public RTL repository", "skills": ["n-rtl"], "kind": "other"}
    assert we.link_strength({"node_id": "n-rtl"}, r) == 1.0
    assert we.link_strength({"node_id": "x", "title": "Push the repository README"}, r) == 0.6
    assert we.link_strength({"node_id": "x", "title": "Karnaugh maps"}, r) == 0.0
