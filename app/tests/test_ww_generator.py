"""The practice-paper generator and proficiency (ww_generator.py): proficiency is an EWMA
seeded by taps, weights favour weak and asked topics without zeroing the never-asked, a
paper fits its pattern exactly, the same seed is the same paper, and a thin bank says so."""
import random

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
