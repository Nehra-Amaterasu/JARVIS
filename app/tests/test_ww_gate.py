"""The Well Wisher gate (ww_check.py) in the suite: route drift, engine purity, allocation and
margin invariants, and the time budgets, on synthetic data. The CLI runs the same on his real
inputs and appends a dated report."""
from jarvis_app import ww_check, ww_engines


def test_no_route_drift_between_decorators_docstrings_and_ui():
    r = ww_check.route_drift()
    assert r["defined"] > 40 and r["documented"] > 20 and r["ui_paths"] > 30
    assert r["doc_without_route"] == []
    assert r["ui_without_route"] == []


def test_every_engine_is_pure_and_declares_real_inputs():
    s = ww_check.engine_smoke(ww_engines.normalize_inputs({}), "2026-11-08")
    assert s["engines"] >= 16 and s["problems"] == []
    assert ww_check.schema_consistency() == []


def test_margin_formula_agrees_with_brute_force():
    assert ww_check.margin_sweep(0.75, 60) == []
    assert ww_check.margin_sweep(0.8, 30) == []


def test_exams_allocation_invariants_hold_under_load_and_within_budget():
    r = ww_check.stress("2026-11-08")
    assert r["exams"]["papers"] == 20 and r["exams"]["topics"] == 800
    assert r["exams"]["problems"] == []
    assert r["attendance"]["taps"] == 3000 and r["attendance"]["problems"] == []
    assert r["exams"]["seconds"] < ww_check.BUDGET_S["exams"], r["exams"]
    assert r["attendance"]["seconds"] < ww_check.BUDGET_S["attendance"], r["attendance"]


def test_generator_sweep_holds_and_is_within_budget():
    r = ww_check.generator_sweep(30)
    assert r["problems"] == [], r
    assert r["seconds"] < ww_check.BUDGET_S["generator"], r
    assert r["asked"]["t1a"] > r["asked"]["t1b"]


def test_invariant_checkers_catch_a_broken_answer():
    inputs, subjects, prep = ww_check.synthetic_exams(n_papers=2, topics_per_unit=2)
    out = ww_engines.run("exams", inputs, "2026-11-08", subjects=subjects, prep=prep)
    assert ww_check.exams_invariants(out) == []
    broken = {**out, "papers": [{**out["papers"][0], "planned_minutes": -1}, *out["papers"][1:]]}
    assert any("planned_minutes" in p for p in ww_check.exams_invariants(broken))
    ai, log = ww_check.synthetic_attendance(n_taps=50)
    at = ww_engines.run("attendance", ai, "2026-11-08", log=log)
    assert ww_check.attendance_invariants(at) == []
    bad = {**at, "subjects": [{**at["subjects"][0], "can_miss": 99, "need": 0}]}
    assert ww_check.attendance_invariants(bad)


def test_report_without_a_plan_is_self_contained_and_renders():
    r = ww_check.report(None, "2026-11-08")
    assert set(r) >= {"routes", "schema", "smoke", "margin_sweep", "stress", "generator", "ok"}
    md = ww_check.as_markdown(r)
    assert md.startswith("## 2026-11-08: gate") and "Stress:" in md
