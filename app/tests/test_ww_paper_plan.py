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


def test_the_bank_lists_with_sizes_and_a_question_is_added_to_a_file_subject(plan):
    from jarvis_app import routes_mission as rm
    before = rm.bank_listing(plan, "x")
    assert before["sizes"]["total"] == 24 and before["sizes"]["tiers"] == {"exam": 24, "gate": 0} and before["sizes"]["typed"] == 0
    assert [u["n"] for u in before["units"]] == [1, 2]
    r = rm.add_bank_question(plan, "x", {"unit": 2, "topic": "t2", "question": r"Find $\int_0^1 x\,dx$.", "marks": 2, "section": "A", "tier": "gate", "source": "own"})
    assert r["added"]["id"] == "x:typed:0" and r["added"]["latex"] is True and r["added"]["tier"] == "gate" and r["added"]["source"] == "own"
    after = rm.bank_listing(plan, "x")
    assert after["sizes"]["total"] == before["sizes"]["total"] + 1 and after["sizes"]["tiers"] == {"exam": 24, "gate": 1} and after["sizes"]["typed"] == 1
    assert r["sizes"] == after["sizes"]
    # the file's own units survive the typed entry (it carries none)
    assert [u["n"] for u in plan.academics()["subjects"][0]["units"]] == [1, 2]
    # the stored text is what he typed, not a conversion
    assert next(q for q in after["questions"] if q["id"] == "x:typed:0")["question"] == r"Find $\int_0^1 x\,dx$."
    # a gate paper now exists and is made of the gate question
    p = plan.practice_paper("see-x", seed=1, tier="gate", today=TODAY)
    assert p["tier"] == "gate" and p["tier_note"] is None and p["bank_size"] == 1


def test_a_plain_question_is_added_to_a_typed_subject_and_ids_only_grow(plan):
    from jarvis_app import routes_mission as rm
    a = rm.add_bank_question(plan, "typed-one", {"unit": 1, "topic": "b", "question": "Plain words, no maths.", "marks": 5})
    b = rm.add_bank_question(plan, "typed-one", {"unit": 1, "topic": "a", "question": "A second one.", "marks": 2, "section": "b"})
    assert (a["added"]["id"], b["added"]["id"]) == ("typed-one:typed:1", "typed-one:typed:2")      # after the one already typed
    assert a["added"]["latex"] is False and b["added"]["section"] == "B" and b["sizes"]["total"] == 3
    raw = ww_engines.raw_inputs()
    assert len([s for s in raw["subjects"] if s["id"] == "typed-one"]) == 1                          # appended, not a second entry
    assert raw["subjects"][0]["question_bank"][0]["question"] == "Typed Q"


def test_an_invalid_question_is_refused_and_nothing_is_written(plan):
    from jarvis_app import routes_mission as rm
    good = {"unit": 1, "topic": "t1", "question": "Fine?", "marks": 2}
    snapshot = json.dumps(ww_engines.raw_inputs(), sort_keys=True)
    for bad in ({"unit": 5}, {"topic": ""}, {"question": ""}, {"question": "broken $x"}, {"marks": 0}, {"marks": "two"}, {"tier": "hard"}, {"section": "way too long"}):
        with pytest.raises(ValueError):
            rm.add_bank_question(plan, "x", {**good, **bad})
    with pytest.raises(KeyError):
        rm.add_bank_question(plan, "no-such-subject", good)
    with pytest.raises(KeyError):
        rm.bank_listing(plan, "no-such-subject")
    assert json.dumps(ww_engines.raw_inputs(), sort_keys=True) == snapshot                           # nothing written by a refusal
    rm.add_bank_question(plan, "x", good)
    with pytest.raises(ValueError, match="already in the bank"):
        rm.add_bank_question(plan, "x", {**good, "question": "  fine?  "})                           # same text, any case or spacing
    assert len(rm.bank_listing(plan, "x")["questions"]) == 25


def test_the_typed_bank_has_a_cap_and_says_so(plan, monkeypatch):
    from jarvis_app import ww_generator, routes_mission as rm
    monkeypatch.setattr(ww_generator, "TYPED_BANK_CAP", 2)
    rm.add_bank_question(plan, "typed-one", {"unit": 1, "topic": "a", "question": "Cap question 1", "marks": 2})
    with pytest.raises(ValueError, match="typed bank is full"):
        rm.add_bank_question(plan, "typed-one", {"unit": 1, "topic": "a", "question": "One too many", "marks": 2})


def test_an_empty_subject_gets_an_empty_paper_then_a_real_one_after_adding(plan):
    from jarvis_app import routes_mission as rm
    subs = ww_engines.raw_inputs()["subjects"]
    subs.append({"id": "bare", "name": "Bare", "units": [{"n": 1, "title": "One", "exam_weight": "high", "topics": ["z"]}]})
    ww_engines.save_section("subjects", subs)
    exams = ww_engines.raw_inputs()["exams"]
    exams.append({"id": "cie-bare", "subject": "bare", "title": "Bare CIE", "date": "2026-11-20", "kind": "cie", "max": 20})
    ww_engines.save_section("exams", exams)
    empty = plan.practice_paper("cie-bare", seed=0, today=TODAY)
    assert empty["empty"] is True and empty["bank_size"] == 0 and empty["total_marks"] == 20 and "No questions in the bank" in empty["markdown"]
    for i in range(3):
        rm.add_bank_question(plan, "bare", {"unit": 1, "topic": "z", "question": f"Bare question {i}", "marks": 2, "section": "B"})
    full = plan.practice_paper("cie-bare", seed=0, today=TODAY)
    assert full["empty"] is False and full["bank_size"] == 3 and full["pattern_scaled"] is True and full["total_marks"] == 20


def test_marks_are_saved_against_the_marks_the_paper_showed(plan):
    paper = plan.practice_paper("see-x", seed=5, today=TODAY)
    q = paper["sections"][0]["questions"][0]
    # the same bank question answered on a paper that showed it at 6 marks
    r = plan.paper_marks("see-x", {"items": [{"id": q["id"], "got": 6, "max": 6}]}, today=TODAY)
    assert (r["score"], r["max"]) == (6, 6)
    with pytest.raises(ValueError):
        plan.paper_marks("see-x", {"items": [{"id": q["id"], "got": 7, "max": 6}]}, today=TODAY)
    # without max, the bank's marks still bound the answer
    with pytest.raises(ValueError):
        plan.paper_marks("see-x", {"items": [{"id": q["id"], "got": q["marks"] + 1}]}, today=TODAY)
