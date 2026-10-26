"""The exams engine (ww_exams.py) and the Settings save path for engine inputs. Fictional subjects only."""
import copy
import json

import pytest

from jarvis_app import ww_engines
from jarvis_app.ww_exams import LEARN_MIN, PAPER_MIN, exams, topic_key

SUBJ = [
    {"id": "alpha", "name": "Alpha", "units": [
        {"n": 1, "title": "One", "exam_weight": "high", "topics": ["a1", "a2"]},
        {"n": 3, "title": "Three", "exam_weight": "high", "topics": ["a3", "a4"]},
        {"n": 4, "title": "Four", "exam_weight": "low", "topics": ["a5"]}]},
    {"id": "beta", "name": "Beta", "units": [
        {"n": 3, "title": "Three", "exam_weight": "med", "topics": ["b1", "b2"]}]},
]
TODAY = "2026-10-30"       # a Friday
SHEET = [
    {"id": "a", "subject": "alpha", "title": "Alpha", "date": "2026-11-02", "start": "10:45", "end": "11:45", "units": [3, 4]},
    {"id": "b", "subject": "beta", "title": "Beta", "date": "2026-11-02", "start": "15:00", "end": "16:00", "units": [3]},
]


def inp(sheet=SHEET, **study):
    return ww_engines.normalize_inputs({"exams": sheet, "study": study})


def test_only_the_units_the_paper_covers_are_planned():
    r = exams(inp(), TODAY, subjects=SUBJ)
    a = r["papers"][0]
    assert [t["topic"] for t in a["topics"]] == ["a3", "a4", "a5"]          # unit 1 is not on this paper
    assert a["work_minutes"] == 2 * LEARN_MIN["high"] + LEARN_MIN["low"] + PAPER_MIN
    assert a["coverage"] == 0.0 and a["counts"]["none"] == 3


def test_coverage_is_weighted_and_learned_counts_part():
    prep = {"alpha": {"topics": {topic_key(3, "a3"): {"state": "solid"}, topic_key(4, "a5"): {"state": "learned"}}}}
    a = exams(inp(), TODAY, subjects=SUBJ, prep=prep)["papers"][0]
    # weights 3, 3, 1; credits 1.0, 0, 0.6 -> (3 + 0.6) / 7
    assert a["coverage"] == round(3.6 / 7, 3)


def test_a_practice_paper_is_the_measured_number_and_leaves_the_work_list():
    prep = {"alpha": {"papers": [{"date": TODAY, "score": 14, "max": 20}]}}
    a = exams(inp(), TODAY, subjects=SUBJ, prep=prep)["papers"][0]
    assert a["paper_score"] == {"score": 14, "max": 20, "date": TODAY, "on_target": None}
    assert a["work_minutes"] == 2 * LEARN_MIN["high"] + LEARN_MIN["low"]


def test_the_gap_between_two_papers_belongs_to_the_second():
    r = exams(inp(), TODAY, subjects=SUBJ)
    exam_day = next(d for d in r["days"] if d["date"] == "2026-11-02")
    gap = next(s for s in exam_day["slots"] if s["label"].startswith("Gap"))
    assert gap["reserved"] and [b["paper"] for b in gap["blocks"]] == ["b"]
    assert gap["minutes"] == (15 * 60 - (11 * 60 + 45)) - 60           # 3 h 15 gap minus travel and lunch


def test_the_day_before_belongs_to_that_days_papers():
    r = exams(inp(), TODAY, subjects=SUBJ)
    sunday = next(d for d in r["days"] if d["date"] == "2026-11-01")
    assert sunday["slots"][0]["reserved"]
    assert {b["paper"] for b in sunday["slots"][0]["blocks"]} <= {"a", "b"}
    assert sum(b["minutes"] for b in sunday["slots"][0]["blocks"]) == 300   # weekend default


def test_every_block_says_what_to_do_and_unseen_heavy_topics_come_first():
    r = exams(inp(), TODAY, subjects=SUBJ)
    first = r["days"][0]["slots"][0]["blocks"][0]
    assert first["focus"] and first["focus"][0]["kind"] == "learn"
    alpha = [f for d in r["days"] for s in d["slots"] for b in s["blocks"] if b["paper"] == "a" for f in b["focus"]]
    learn = [f["title"] for f in alpha if f["kind"] == "learn"]
    assert learn.index("a3") < learn.index("a5")                       # high weight before low


def test_minutes_already_logged_today_come_off_todays_block():
    full = exams(inp(), TODAY, subjects=SUBJ)["days"][0]["slots"][0]["minutes"]
    prep = {"alpha": {"minutes": [{"date": TODAY, "minutes": 90}]}}
    part = exams(inp(), TODAY, subjects=SUBJ, prep=prep)["days"][0]["slots"][0]["minutes"]
    assert full - part == 90


def test_the_forecast_is_a_range_and_never_above_one():
    r = exams(inp(), TODAY, subjects=SUBJ)
    for p in r["papers"]:
        f = p["forecast"]
        assert 0 <= f["half_plan"] <= f["full_plan"] <= 1 and "taps" in f["assumption"]


def test_too_little_time_is_named_as_a_risk_without_shame():
    tight = [{**SHEET[0], "date": "2026-10-31"}]
    r = exams(inp(tight, weekday_minutes=30), TODAY, subjects=SUBJ)
    assert any("more work than free time" in x for x in r["risks"])
    from jarvis_app.ww_base import no_shame
    assert all(no_shame(x) for x in r["risks"] + [r["say"]])


def test_two_papers_on_one_day_are_flagged_and_unknown_syllabus_too():
    sheet = SHEET + [{"id": "c", "subject": "gamma", "title": "Gamma", "date": "2026-11-03", "units": []}]
    r = exams(inp(sheet), TODAY, subjects=SUBJ)
    assert any("on one day" in x for x in r["risks"]) and any("no unit list" in x for x in r["risks"])


def test_past_papers_are_dropped_and_no_papers_is_an_answer():
    assert exams(inp(), "2026-11-03", subjects=SUBJ)["papers"] == []
    r = exams(inp([]), TODAY)
    assert r["status"] == "ok" and r["days"] == [] and "Settings" in r["say"]


def test_pure_and_registered():
    i, prep = inp(), {"alpha": {"topics": {}}}
    before = copy.deepcopy((i, prep, SUBJ))
    a = exams(i, TODAY, subjects=SUBJ, prep=prep)
    assert a == exams(copy.deepcopy(i), TODAY, subjects=copy.deepcopy(SUBJ), prep=copy.deepcopy(prep))
    assert (i, prep, SUBJ) == before
    assert ww_engines.REGISTRY["exams"].version == 1
    assert ww_engines.run("exams", i, TODAY, subjects=SUBJ)["status"] == "ok"


def test_normalize_cleans_the_date_sheet():
    n = ww_engines.normalize_inputs({"exams": [
        {"subject": "alpha", "date": "2026-11-02", "start": "25:00", "units": [3, "4", True, 4.0]},
        {"subject": "alpha", "date": "2026-11-02"},                # same made-up id: dropped
        {"subject": "beta"}]})                                     # no date: dropped
    assert len(n["exams"]) == 1 and n["exams"][0]["start"] is None and n["exams"][0]["units"] == [3, 4]
    assert len(n["warnings"]) == 2
    assert n["study"] == {"weekday_minutes": 240, "weekend_minutes": 300, "exam_evening_minutes": 150, "build_cap_exam": 60, "build_cap": 180}


# ------------------------------------------------------------------ Settings writes the inputs
def test_save_section_keeps_the_rest_backs_up_once_a_day_and_reports_drops(tmp_path):
    p = tmp_path / "engine-inputs.json"
    p.write_text(json.dumps({"profile": {"traits": ["builder"]}}), encoding="utf-8")
    r = ww_engines.save_section("exams", SHEET + [{"subject": "x"}], p, today=TODAY)
    raw = json.loads(p.read_text(encoding="utf-8"))
    assert raw["profile"] == {"traits": ["builder"]} and len(raw["exams"]) == 3
    assert len(r["inputs"]["exams"]) == 2 and r["dropped"] == ["an exam without subject/date dropped"]
    assert (tmp_path / "engine-inputs.json.bak-20261030").exists()
    ww_engines.save_section("study", {"weekday_minutes": 200}, p, today=TODAY)
    assert json.loads((tmp_path / "engine-inputs.json.bak-20261030").read_text(encoding="utf-8")) == {"profile": {"traits": ["builder"]}}


def test_save_section_refuses_unknown_sections_and_wrong_types(tmp_path):
    p = tmp_path / "e.json"
    with pytest.raises(ValueError):
        ww_engines.save_section("anything", [], p)
    with pytest.raises(ValueError):
        ww_engines.save_section("exams", {"not": "a list"}, p)
    assert not p.exists()


# ------------------------------------------------------------------ wired into the plan
@pytest.fixture()
def plan(tmp_path, monkeypatch):
    import shutil
    from pathlib import Path
    from jarvis_app import germoney as g
    fix = Path(__file__).resolve().parents[1] / "ui" / "src" / "__tests__" / "fixtures" / "mission-bank"
    d = tmp_path / "bank"
    d.mkdir()
    for n in g.BANK_FILES:
        shutil.copy(fix / n, d / n)
    bank = g.load_bank(d)
    p = tmp_path / "inputs.json"
    p.write_text(json.dumps({"exams": SHEET}), encoding="utf-8")
    monkeypatch.setenv("JARVIS_ENGINE_INPUTS", str(p))
    apps = g.Applications(calendar=tmp_path / "no-calendar.json", store=tmp_path / "apps.json")
    return g.Plan(g.KVStore(tmp_path / "kv", tmp_path / "bk"), bank_loader=lambda: bank,
                  academics_loader=lambda: {"subjects": copy.deepcopy(SUBJ)}, apps=apps)


def test_taps_minutes_and_a_paper_flow_through_the_plan(plan):
    k = topic_key(3, "a3")
    r = plan.exam_prep("topic", "alpha", {"key": k, "state": "solid"}, today=TODAY)
    assert r["papers"][0]["counts"]["solid"] == 1
    r = plan.exam_prep("minutes", "alpha", {"minutes": 45}, today=TODAY)
    assert r["papers"][0]["logged_minutes"] == 45
    st = plan.load(TODAY)
    assert any(e["kind"] == "log" and e["minutes"] == 45 for e in st["events"])     # Focus counts it too
    r = plan.exam_prep("paper", "alpha", {"score": 12, "max": 20}, today=TODAY)
    assert r["papers"][0]["paper_score"]["score"] == 12
    r = plan.exam_prep("topic", "alpha", {"key": k, "state": "none"}, today=TODAY)
    assert r["papers"][0]["counts"]["solid"] == 0


@pytest.mark.parametrize("op,subject,payload", [
    ("topic", "nope", {"key": "3|a3", "state": "solid"}),
    ("topic", "alpha", {"key": "9|zz", "state": "solid"}),
    ("topic", "alpha", {"key": "3|a3", "state": "mastered"}),
    ("minutes", "alpha", {"minutes": 0}),
    ("paper", "alpha", {"score": 21, "max": 20}),
    ("dance", "alpha", {}),
])
def test_bad_taps_are_refused(plan, op, subject, payload):
    with pytest.raises(ValueError):
        plan.exam_prep(op, subject, payload, today=TODAY)


def test_habit_learn_and_exam_records_survive_a_reload():
    from jarvis_app import germoney as g
    st = g.default_plan_state(TODAY)
    st.update(habits={"h": [TODAY]}, learn={"seen": {"c": TODAY}, "reviews": {}}, exam_prep={"alpha": {"topics": {}}})
    m = g.merge_plan_state(json.loads(json.dumps(st)), TODAY)
    assert m["habits"] == {"h": [TODAY]} and m["learn"]["seen"] == {"c": TODAY} and "alpha" in m["exam_prep"]


def test_study_files_match_the_subject_id_and_are_served(tmp_path, monkeypatch):
    from jarvis_app import germoney as g
    (tmp_path / "pack").mkdir()
    (tmp_path / "pack" / "01-alpha-revision.md").write_text("# a", encoding="utf-8")
    (tmp_path / "pack" / "02-beta-revision.md").write_text("# b", encoding="utf-8")
    monkeypatch.setenv("JARVIS_EXAM_NOTES", str(tmp_path))
    got = g.study_files("alpha")
    assert [f["name"] for f in got] == ["01-alpha-revision"]
    assert g.file_allowed(got[0]["path"]) is not None
    assert g.study_files("") == [] and g.file_allowed(str(tmp_path.parent)) is None
