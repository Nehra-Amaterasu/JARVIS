"""The paper loop through the Plan: a date sheet entry + a subject (from academics.json or
typed in Settings) gives a paper; marking it stores per-topic marks, moves proficiency, and
becomes the measured practice score the exams engine shows. Scratch store, synthetic data."""
import json
import shutil
from pathlib import Path

import pytest

from jarvis_app import germoney as g
from jarvis_app import ww_engines

FIX = Path(__file__).resolve().parents[1] / "ui" / "src" / "__tests__" / "fixtures" / "mission-bank"
TODAY = "2026-11-09"
BANK = [{"id": f"q{i}", "unit": 1 + i % 2, "topic": f"t{1 + i % 2}", "question": f"Q{i}", "marks": m, "type": "pyq_see", "section": s, "sitting": "Jun 2026"}
        for i, (s, m) in enumerate([("A", 2)] * 6 + [("B", 7)] * 12 + [("C", 5)] * 6)]
ACADEMICS = {"semester": None, "plan": {}, "calendar": {}, "rescue": None, "unresolved": [],
             "subjects": [{"id": "x", "name": "X", "kind": "current", "question_bank": BANK,
                           "units": [{"n": 1, "title": "U1", "topics": ["t1"], "exam_weight": "high"}, {"n": 2, "title": "U2", "topics": ["t2"], "exam_weight": "med"}]}]}


@pytest.fixture()
def plan(tmp_path, monkeypatch):
    d = tmp_path / "bank"
    d.mkdir()
    for n in g.BANK_FILES:
        shutil.copy(FIX / n, d / n)
    bank = g.load_bank(d)
    inputs = {"exams": [{"id": "see-x", "subject": "x", "title": "X", "date": "2026-12-08", "kind": "end_sem", "max": 60, "target": 40},
                        {"id": "see-typed", "subject": "typed-one", "title": "Typed", "date": "2026-12-10", "max": 60}],
              "subjects": [{"id": "typed-one", "name": "Typed One", "units": [{"n": 1, "title": "Only", "exam_weight": "high", "topics": ["a", "b"]}],
                           "question_bank": [{"unit": 1, "topic": "a", "question": "Typed Q", "marks": 2, "section": "A"}]}]}
    (tmp_path / "inputs.json").write_text(json.dumps(inputs), encoding="utf-8")
    monkeypatch.setenv("JARVIS_ENGINE_INPUTS", str(tmp_path / "inputs.json"))
    apps = g.Applications(calendar=tmp_path / "no-calendar.json", store=tmp_path / "apps.json")
    return g.Plan(g.KVStore(tmp_path / "kv", tmp_path / "bk"), bank_loader=lambda: bank, academics_loader=lambda: json.loads(json.dumps(ACADEMICS)), apps=apps)


def test_typed_subjects_merge_into_academics(plan):
    ac = plan.academics()
    ids = [s["id"] for s in ac["subjects"]]
    assert ids == ["x", "typed-one"]
    typed = ac["subjects"][1]
    assert typed["typed"] and typed["units"][0]["topics"] == ["a", "b"]
    assert typed["question_bank"][0]["id"] == "typed-one:typed:0" and typed["question_bank"][0]["tier"] == "exam"
    # the exams engine now plans the typed paper: it has topics, so it is real work
    ex = plan.engine("exams", TODAY)
    typed_row = next(p for p in ex["papers"] if p["id"] == "see-typed")
    assert typed_row["subject_known"] and len(typed_row["topics"]) == 2


def test_paper_marks_move_proficiency_and_the_measured_score(plan):
    paper = plan.practice_paper("see-x", seed=3, today=TODAY)
    assert paper["total_marks"] == 60 and paper["shortfall"] == [] and paper["markdown"].startswith("# X: practice paper")
    assert paper == plan.practice_paper("see-x", seed=3, today=TODAY)       # nothing stored by generating
    qs = [q for s in paper["sections"] for q in s["questions"]]
    first = qs[0]
    assert first["p"] == 0.1                                                  # untapped topic
    r = plan.paper_marks("see-x", {"items": [{"id": first["id"], "got": first["marks"]}, {"id": qs[1]["id"], "got": 0}], "seed": 3}, today=TODAY)
    assert r["saved"] == 2 and r["score"] == first["marks"]
    assert r["proficiency"][first["key"]] == round(0.1 * 0.5 + 0.5, 3)
    ex = plan.engine("exams", TODAY)
    row = next(p for p in ex["papers"] if p["id"] == "see-x")
    assert row["paper_score"] == {"score": first["marks"], "max": first["marks"] + qs[1]["marks"], "date": TODAY,
                                  "on_target": (first["marks"] / (first["marks"] + qs[1]["marks"])) >= 40 / 60}
    # the next paper weighs the just-aced topic less than its untouched twin: same unit, same section
    again = plan.practice_paper("see-x", seed=3, today=TODAY)
    p_of = {q["key"]: q["p"] for s in again["sections"] for q in s["questions"]}
    assert p_of.get(first["key"], 1) > 0.1
    with pytest.raises(ValueError):
        plan.paper_marks("see-x", {"items": [{"id": first["id"], "got": first["marks"] + 1}]}, today=TODAY)
    with pytest.raises(ValueError):
        plan.paper_marks("see-x", {"items": [{"id": "nope", "got": 1}]}, today=TODAY)
    with pytest.raises(ValueError):
        plan.practice_paper("not-on-sheet", today=TODAY)


def test_normalize_keeps_typed_subjects_tidy():
    out = ww_engines.normalize_inputs({"subjects": [{"id": "My Sub!", "units": [{"n": 99, "topics": ["a", 3, " "]}, "junk"]}, {"name": "no id"}]})
    assert out["subjects"][0]["id"] == "my-sub" and out["subjects"][0]["units"][0]["topics"] == ["a"]
    assert out["subjects"][0]["units"][0]["n"] == 1                       # 99 is out of range: the position wins
    assert any("subject without an id" in w for w in out["warnings"])
