"""The practice-paper generator and proficiency (ww_generator.py): proficiency is an EWMA
seeded by taps, weights favour weak and asked topics without zeroing the never-asked, a
paper fits its pattern exactly, the same seed is the same paper, and a thin bank says so."""
import random

import pytest

from jarvis_app import ww_generator as gen

UNITS = [{"n": u, "title": f"U{u}", "exam_weight": w, "topics": [f"t{u}a", f"t{u}b"]} for u, w in ((1, "high"), (2, "med"), (3, "low"))]


def bank(n_per_section=(6, 12, 6), sittings=("Jun 2026", "Dec 2025")):
    out, i = [], 0
    for sec, n, mk in zip("ABC", n_per_section, (2, 7, 5)):
        for k in range(n):
            u = 1 + k % 3
            out.append({"id": f"q{i}", "unit": u, "topic": f"t{u}{'ab'[k % 2]}", "question": f"Question {i} on t{u}", "marks": mk,
                        "type": "pyq_see", "section": sec, "sitting": sittings[k % len(sittings)]})
            i += 1
    return out


EXAM = {"id": "see-x", "subject": "x", "title": "X", "units": [], "max": 60, "pattern": gen.DEFAULT_PATTERN}


def test_proficiency_is_seeded_by_taps_and_moves_with_marks_newest_most():
    states = {"1|t1a": {"state": "solid"}, "1|t1b": {"state": "learned"}}
    p = gen.proficiency(states, {}, keys=["2|t2a"])
    assert p == {"1|t1a": 0.8, "1|t1b": 0.5, "2|t2a": 0.1}
    # two attempts: 0 then full marks; newest weighs most, and it never runs away
    p = gen.proficiency(states, {"1|t1a": [{"got": 0, "max": 7}, {"got": 7, "max": 7}]})
    assert p["1|t1a"] == round((0.8 * 0.5 + 0) * 0.5 + 0.5, 3) == 0.7
    p = gen.proficiency({}, {"3|t3a": [{"got": 9, "max": 7}]})         # over the max is clamped
    assert p["3|t3a"] == round(0.1 * 0.5 + 0.5, 3)


def test_weights_favour_weak_and_asked_topics_but_never_zero_the_unasked():
    b = bank()
    prof = {gen.topic_key(q["unit"], q["topic"]): 0.1 for q in b}
    prof["1|t1a"] = 0.9                                       # solid: should weigh far less
    w = gen.topic_weights(b, UNITS, prof, papers=2)
    assert w["1|t1a"] < w["1|t1b"]
    assert w["1|t1b"] > w["2|t2b"] > w["3|t3b"]               # unit weight high > med > low at equal p
    never = {"id": "n", "unit": 2, "topic": "new", "question": "never asked", "marks": 7, "type": "typed", "section": "B", "sitting": "typed"}
    w2 = gen.topic_weights(b + [never], UNITS, prof, papers=2)
    assert w2["2|new"] > 0                                     # (0 + 1)/(papers + 2) keeps it alive


def test_a_paper_fits_the_pattern_and_the_seed_fixes_it():
    b = bank()
    a = gen.generate(EXAM, b, UNITS, {}, {}, seed=7)
    assert gen.paper_invariants(a, EXAM) == []
    assert [len(s["questions"]) for s in a["sections"]] == [5, 10, 5] and a["total_marks"] == 60 and a["shortfall"] == []
    assert a == gen.generate(EXAM, b, UNITS, {}, {}, seed=7)
    other = gen.generate(EXAM, b, UNITS, {}, {}, seed=8)
    assert [q["id"] for s in a["sections"] for q in s["questions"]] != [q["id"] for s in other["sections"] for q in s["questions"]]
    md = gen.as_markdown(a)
    assert md.startswith("# X: practice paper (seed 7") and "## Section B: 7 marks each, answer any 5 of 10" in md


def test_weak_topics_come_up_more_over_many_seeds():
    b = bank(n_per_section=(12, 24, 12))
    states = {gen.topic_key(q["unit"], q["topic"]): {"state": "solid"} for q in b if q["topic"] != "t1a"}
    counts = {"t1a": 0, "t1b": 0}
    for seed in range(60):
        a = gen.generate(EXAM, b, UNITS, states, {}, seed=seed)
        for s in a["sections"]:
            for q in s["questions"]:
                if q["topic"] in counts:
                    counts[q["topic"]] += 1
    assert counts["t1a"] > counts["t1b"] * 1.5, counts         # never tapped vs solid, same unit


def test_a_thin_bank_fills_from_other_sections_and_says_so():
    a = gen.generate(EXAM, bank(n_per_section=(2, 3, 1)), UNITS, {}, {}, seed=1)
    assert a["shortfall"] and all("of" in x for x in a["shortfall"])
    assert gen.paper_invariants(a, EXAM) == []
    ids = [q["id"] for s in a["sections"] for q in s["questions"]]
    assert len(ids) == len(set(ids)) == 6


def test_invariants_catch_a_wrong_paper():
    a = gen.generate(EXAM, bank(), UNITS, {}, {}, seed=1)
    bad = {**a, "total_marks": 59}
    assert gen.paper_invariants(bad, EXAM)
    dup = {**a, "sections": [{**a["sections"][0], "questions": a["sections"][0]["questions"] + a["sections"][0]["questions"][:1]}, *a["sections"][1:]]}
    assert any("twice" in x or "more questions" in x for x in gen.paper_invariants(dup, EXAM))


def test_generate_is_pure():
    b = bank()
    before = repr((b, UNITS))
    rnd_state = random.getstate()
    gen.generate(EXAM, b, UNITS, {"1|t1a": {"state": "solid"}}, {"1|t1b": [{"got": 1, "max": 2}]}, seed=3)
    assert repr((b, UNITS)) == before and random.getstate() == rnd_state


def test_a_gate_paper_without_gate_questions_says_it_is_an_exam_paper():
    a = gen.generate(EXAM, bank(), UNITS, {}, {}, seed=2, tier="gate")
    assert a["tier"] == "exam" and a["tier_requested"] == "gate" and "No GATE-tier questions" in a["tier_note"]
    assert "No GATE-tier questions" in gen.as_markdown(a)
    tiered = bank() + [{"id": "g1", "unit": 1, "topic": "t1a", "question": "A GATE-level question", "marks": 2, "type": "typed",
                        "section": "A", "sitting": "typed", "tier": "gate"}]
    b = gen.generate(EXAM, tiered, UNITS, {}, {}, seed=2, tier="gate")
    assert b["tier"] == "gate" and b["tier_note"] is None and b["bank_size"] == 1


def test_an_empty_bank_and_a_foreign_pattern_are_flagged_not_hidden():
    a = gen.generate(EXAM, [], UNITS, {}, {}, seed=1)
    assert a["empty"] is True and a["bank_size"] == 0 and "No questions in the bank" in gen.as_markdown(a)
    assert gen.paper_invariants(a, EXAM) == []                       # short, and it says so
    cie = {"id": "cie", "subject": "x", "title": "CIE", "units": [5], "max": 20}
    c = gen.generate(cie, bank(), UNITS, {}, {}, seed=1)
    assert c["pattern_missing"] is True and "20-mark" in c["pattern_note"] and "scaled to 20 marks" in c["pattern_note"]
    assert c["total_marks"] == 20 and c["pattern_scaled"] is True and c["pattern_source"] == "JSS SEE shape scaled to 20 marks"
    see = {"id": "see", "subject": "x", "title": "SEE", "units": [], "max": 60}
    assert gen.generate(see, bank(), UNITS, {}, {}, seed=1)["pattern_missing"] is False


def test_a_cie_pattern_is_scaled_to_the_rows_maximum_for_every_maximum():
    # Not only 20: every whole and half maximum to 300 sums exactly, with whole or half-mark questions.
    for mx in [x / 2 for x in range(1, 601)]:
        p = gen.scale_pattern(mx)
        assert p and sum(s["attempt"] * s["marks"] for s in p) == mx, mx
        assert all(s["attempt"] >= 1 and s["questions"] >= s["attempt"] and s["marks"] > 0 for s in p), mx
    assert gen.describe_pattern(gen.scale_pattern(20)) == "A: 2 x 1, B: 6 of 12 x 2, C: 3 of 5 x 2"
    assert sum(s["attempt"] * s["marks"] for s in gen.scale_pattern(60)) == 60
    assert gen.scale_pattern(7.3) is None and gen.scale_pattern(0) is None and gen.scale_pattern(301) is None and gen.scale_pattern("x") is None


def test_a_scaled_paper_is_a_real_paper_of_exactly_the_maximum_and_says_how():
    cie = {"id": "cie", "subject": "x", "title": "CIE", "units": [], "max": 20}
    for seed in range(30):
        a = gen.generate(cie, bank(n_per_section=(12, 24, 12)), UNITS, {}, {}, seed=seed)
        assert a["total_marks"] == 20 and gen.paper_invariants(a, cie) == [], seed
        assert a["pattern_missing"] is True and a["pattern_scaled"] is True
    assert "A: 2 x 1, B: 6 of 12 x 2, C: 3 of 5 x 2" in a["pattern_note"] and "Date sheet" in a["pattern_note"]
    assert "scaled" in gen.as_markdown(a)
    # a typed pattern is never scaled; a max it cannot scale to falls back loudly
    typed = {**cie, "pattern": [{"name": "A", "questions": 4, "attempt": 4, "marks": 5}]}
    t = gen.generate(typed, bank(), UNITS, {}, {}, seed=1)
    assert t["pattern_missing"] is False and t["pattern_scaled"] is False and t["total_marks"] == 20
    odd = gen.generate({**cie, "max": 7.3}, bank(), UNITS, {}, {}, seed=1)
    assert odd["total_marks"] == 60 and odd["pattern_scaled"] is False and "cannot be scaled" in odd["pattern_note"]
    # invariants catch a scaled paper whose total drifts from the maximum
    drift = {**gen.generate(cie, bank(), UNITS, {}, {}, seed=1), "total_marks": 19}
    assert any("row's maximum" in x for x in gen.paper_invariants(drift, cie))


def test_questions_carry_their_bank_marks_and_whether_they_are_latex():
    b = bank()
    for q in b:
        q["question"] = r"Evaluate $\int_0^1 x\,dx$." if q["id"] == "q0" else q["question"]
    a = gen.generate(EXAM, b, UNITS, {}, {}, seed=0, tier="exam")
    qs = {q["id"]: q for s in a["sections"] for q in s["questions"]}
    assert all(q["bank_marks"] is not None for q in qs.values())
    flagged = [i for i, q in qs.items() if q["latex"]]
    assert flagged in ([], ["q0"])
    assert gen.has_latex("a $x^2$ b") and not gen.has_latex("costs 5 rupees") and not gen.has_latex("one $ only")


GOOD = {"unit": 2, "topic": "Series", "question": r"Sum $\sum_{k=1}^{n} k$.", "marks": 2, "section": "a", "tier": "gate", "source": "my notes"}


def test_validate_question_cleans_and_refuses():
    ok = gen.validate_question(GOOD, [1, 2, 3])
    assert ok == {"unit": 2, "topic": "Series", "question": GOOD["question"], "marks": 2.0, "section": "A", "tier": "gate", "type": "typed", "sitting": "my notes"}
    plain = gen.validate_question({"unit": 1, "topic": " Rank  of a matrix ", "question": "  What is rank?\r\n", "marks": 1.5}, [1])
    assert plain["topic"] == "Rank of a matrix" and plain["question"] == "What is rank?" and plain["tier"] == "exam" and plain["sitting"] == "typed" and plain["section"] == ""
    assert gen.validate_question({"unit": 1, "topic": "t", "question": r"Costs \$5 and $x$", "marks": 1}, [1])      # an escaped dollar is not maths
    for bad in ({"unit": 9}, {"unit": True}, {"unit": 1.5}, {"topic": ""}, {"topic": "x" * 81}, {"question": ""}, {"question": "  "},
                {"question": "x" * 2001}, {"question": "open $x^2"}, {"marks": 0}, {"marks": -1}, {"marks": 101}, {"marks": "2"},
                {"marks": 1.3}, {"marks": True}, {"section": "TOOLONG"}, {"section": "A B"}, {"tier": "hard"}, {"source": "s" * 121}):
        with pytest.raises(ValueError):
            gen.validate_question({**GOOD, **bad}, [1, 2, 3])
    with pytest.raises(ValueError):
        gen.validate_question("not an object", [1])
    assert gen.validate_question({**GOOD, "unit": 7}, [])["unit"] == 7                     # no unit list: 1..10


def test_bank_summary_counts_tiers_units_and_sections():
    b = bank()[:6] + [{"id": "s:typed:0", "unit": 1, "topic": "t", "question": "q", "marks": 2, "section": "A", "tier": "gate"}]
    s = gen.bank_summary(b)
    assert s["total"] == 7 and s["tiers"] == {"exam": 6, "gate": 1} and s["typed"] == 1 and s["by_section"]["A"] == 6 + 1
    assert sum(s["by_unit"].values()) == 7
