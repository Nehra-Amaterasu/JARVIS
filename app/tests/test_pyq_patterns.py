"""E07: rule tags, families, counted patterns, the Quiet list, practise-next and the purity gate
(ww_pyq/tag.py, families.py, patterns.py, next.py, ww_check_pyq.py). Every paper and question is invented
and built in memory: these are pure functions, so no store and no disk."""
import json
import math
import re
from fractions import Fraction

import pytest

from jarvis_app import ww_check_pyq, ww_generator
from jarvis_app.ww_pyq import families, next as nxt, patterns, tag

UNITS = [
    {"n": 1, "title": "Signals and systems", "exam_weight": "high", "topics": ["Convolution sum", "Fourier series"]},
    {"n": 2, "title": "Laplace transform", "exam_weight": "med", "topics": ["Inverse Laplace transform", "Region of convergence"]},
    {"n": 3, "title": "Sampling", "exam_weight": "low", "topics": ["Nyquist sampling theorem"]},
]
SUBJECT = {"id": "signals", "name": "Signals", "units": UNITS}
FORBIDDEN = ("important", "likely", "expected", "will be asked", "probability", "chance", "predict")


def key(u, t):
    return ww_generator.topic_key(u, t)


CONV, FOUR = key(1, "Convolution sum"), key(1, "Fourier series")
ILAP, ROC, NYQ = key(2, "Inverse Laplace transform"), key(2, "Region of convergence"), key(3, "Nyquist sampling theorem")


def mk(qid, paper, text, unit, topic, marks, status="accepted", **kw):
    q = {"id": qid, "paper_id": paper, "text": text, "status": status, "marks": marks, "unit": unit, "topic": topic,
         "tag_source": "hand" if topic else "none", "type": "short", "family_id": ""}
    q.update(kw)
    return q


def paper(pid, year, total=50.0, title=None):
    return {"id": pid, "title": title or f"Signals {year}", "year": year, "total_marks": total, "subject": "signals"}


def five_papers():
    """Five papers 2020 to 2024. conv in all five (3 questions each, 14 of 50 marks); fourier in four
    (paper 4 lacks it); inverse laplace and roc in the first three; nyquist in the first only."""
    papers = [paper(f"p-{i}", 2020 + i) for i in range(5)]
    qs = []
    for i in range(5):
        p = f"p-{i}"
        qs += [mk(f"q-{i}c1", p, f"Find the convolution sum of x[n] and h[n] for case {i}.", 1, "Convolution sum", 10),
               mk(f"q-{i}c2", p, f"State the commutative property of convolution sum, variant {i}.", 1, "Convolution sum", 2),
               mk(f"q-{i}c3", p, f"Name two uses of the convolution sum, variant {i}.", 1, "Convolution sum", 2)]
        if i < 4:
            qs.append(mk(f"q-{i}f", p, f"Expand the periodic wave number {i} in a Fourier series.", 1, "Fourier series", 10))
        if i < 3:
            qs.append(mk(f"q-{i}l", p, f"Invert the transform number {i} using the inverse Laplace transform.", 2, "Inverse Laplace transform", 10))
            qs.append(mk(f"q-{i}r", p, f"Sketch the region of convergence for pole set {i}.", 2, "Region of convergence", 10))
    qs.append(mk("q-0n", "p-0", "State the Nyquist sampling theorem.", 3, "Nyquist sampling theorem", 10))
    return papers, qs


# ------------------------------------------------------------------ 1. wilson
def exact_wilson(k, n, z=Fraction(196, 100)):
    k, n = Fraction(k), Fraction(n)
    p = k / n
    denom = 1 + z * z / n
    centre = (p + z * z / (2 * n)) / denom
    half = Fraction(math.sqrt(float(p * (1 - p) / n + z * z / (4 * n * n)))) * z / denom
    return float(max(Fraction(0), centre - half)), float(min(Fraction(1), centre + half))


@pytest.mark.parametrize("n", range(1, 11))
def test_wilson_matches_the_formula_in_exact_arithmetic_for_every_k_of_n(n):
    for k in range(n + 1):
        lo, hi = patterns.wilson(k, n)
        elo, ehi = exact_wilson(k, n)
        assert round(lo, 4) == round(elo, 4) and round(hi, 4) == round(ehi, 4), (k, n, lo, hi, elo, ehi)
        assert 0.0 <= lo <= k / n <= hi <= 1.0


def test_wilson_known_values_and_the_empty_case():
    assert patterns.wilson(0, 0) == (0.0, 1.0)
    lo, hi = patterns.wilson(4, 6)
    assert (round(lo, 4), round(hi, 4)) == (0.3, 0.9032)           # 4 of 6 at 95 percent, worked by hand


# ------------------------------------------------------------------ 2. topics and tags
def test_topics_of_builds_keys_and_keywords_from_the_syllabus():
    ts = tag.topics_of(SUBJECT)
    assert [t["key"] for t in ts] == [CONV, FOUR, ILAP, ROC, NYQ]
    conv = ts[0]
    assert conv["unit"] == 1 and conv["topic"] == "Convolution sum" and conv["weight"] == "high"
    assert {"convolution", "sum", "signal", "system"} <= set(conv["keywords"])         # topic words and unit-title words
    assert "and" not in conv["keywords"]                                               # stop words are gone
    assert tag.topics_of({"units": []}) == [] and tag.topics_of({}) == []


def test_a_clear_question_is_tagged_by_rule():
    ts = tag.topics_of(SUBJECT)
    r = tag.tag_question(mk("q-1", "p-0", "Find the convolution sum of two finite sequences.", None, "", 5, status="pending"), ts)
    assert r["tag_source"] == "rule" and (r["unit"], r["topic"]) == (1, "Convolution sum")
    assert r["score"] >= 0.25 and r["margin"] >= 0.15 and r["id"] == "q-1"
    assert len(r["candidates"]) <= 3 and r["candidates"][0]["topic"] == "Convolution sum"


def test_a_vague_question_is_left_untagged_with_its_top_three_candidates():
    ts = tag.topics_of(SUBJECT)
    r = tag.tag_question(mk("q-2", "p-0", "Explain the idea of a transform in your own words.", None, "", 5, status="pending"), ts)
    assert r["tag_source"] == "none" and r["unit"] is None and r["topic"] == ""
    assert 1 <= len(r["candidates"]) <= 3
    assert tag.tag_question(mk("q-3", "p-0", "", None, "", 5, status="pending"), ts)["tag_source"] == "none"
    assert tag.tag_question(mk("q-4", "p-0", "Anything at all here.", None, "", 5, status="pending"), [])["tag_source"] == "none"


def test_a_tie_between_two_topics_has_no_margin_and_is_not_tagged():
    """Two topics with the same words in different units: the score is high and the margin is zero.
    A rule that ignored the margin (the mutation) would tag this one."""
    units = [{"n": 1, "title": "Filters", "exam_weight": "med", "topics": ["Butterworth design"]},
             {"n": 2, "title": "Filters", "exam_weight": "med", "topics": ["Butterworth design"]}]
    ts = tag.topics_of({"units": units})
    r = tag.tag_question(mk("q-5", "p-0", "Butterworth design of a filter.", None, "", 5, status="pending"), ts)
    assert r["score"] >= 0.25 and r["margin"] < 0.15 and r["tag_source"] == "none"


def test_the_two_cut_offs_are_exactly_the_stated_ones():
    assert (tag.MIN_SCORE, tag.MIN_MARGIN) == (0.25, 0.15)


# ------------------------------------------------------------------ 3. families
def test_two_questions_that_differ_only_in_their_numbers_merge():
    a = mk("q-a", "p-0", "Find the time constant of an RC circuit with R = 10 kΩ and C = 2 µF.", 1, "x", 5)
    b = mk("q-b", "p-1", "Find the time constant of an RC circuit with R = 4.7 kΩ and C = 1 µF.", 1, "x", 5)
    c = mk("q-c", "p-2", "Derive the transfer function of a second order low pass filter with unity gain.", 1, "x", 5)
    fs = families.find_families([a, b, c])
    assert sorted(sorted(f["question_ids"]) for f in fs) == [["q-a", "q-b"], ["q-c"]]
    assert all(f["confirmed"] is False for f in fs)


def test_different_questions_do_not_merge_and_short_ones_stand_alone():
    qs = [mk("q-1", "p-0", "Define a causal system and give one example of it.", 1, "x", 2),
          mk("q-2", "p-1", "Define a stable system and give one example of it.", 1, "x", 2),
          mk("q-3", "p-2", "State Parseval.", 1, "x", 2), mk("q-4", "p-3", "State Parseval.", 1, "x", 2)]
    fs = families.find_families(qs)
    assert len(fs) == 4                      # a question under 5 words is its own family, even when the text repeats


def test_family_ids_are_stable_and_follow_the_member_ids_not_their_order():
    a = mk("q-a", "p-0", "Find the time constant of an RC circuit with R = 10 kΩ and C = 2 µF.", 1, "x", 5)
    b = mk("q-b", "p-1", "Find the time constant of an RC circuit with R = 4.7 kΩ and C = 1 µF.", 1, "x", 5)
    f1 = families.find_families([a, b])[0]["id"]
    f2 = families.find_families([b, a])[0]["id"]
    assert f1 == f2 and re.fullmatch(r"f-[0-9a-f]{10}", f1)


def test_families_carry_the_years_of_their_papers_when_given():
    a = mk("q-a", "p-0", "Find the time constant of an RC circuit with R = 10 kΩ and C = 2 µF.", 1, "x", 5)
    b = mk("q-b", "p-1", "Find the time constant of an RC circuit with R = 4.7 kΩ and C = 1 µF.", 1, "x", 5)
    f = families.find_families([a, b], {"p-0": 2021, "p-1": 2023})[0]
    assert f["years"] == [2021, 2023]


def test_normalise_replaces_digit_runs_and_strips_units():
    n = families.normalise("Find the gain at 1.5 kHz when V = 12 mV and R = 4,7 kΩ")
    assert "12" not in n and "kΩ" not in n and "khz" not in n and "#" in n


# ------------------------------------------------------------------ 4. counted patterns
def test_patterns_count_k_of_n_per_topic_with_the_wilson_interval():
    papers, qs = five_papers()
    ps = patterns.compute_patterns(qs, papers)
    assert ps["n_papers"] == 5 and ps["n_questions"] == len(qs) and ps["provisional"] is False
    by = {t["key"]: t for t in ps["topics"]}
    assert set(by) == {CONV, FOUR, ILAP, ROC, NYQ}
    assert (by[CONV]["k"], by[CONV]["n"]) == (5, 5) and (by[FOUR]["k"], by[FOUR]["n"]) == (4, 5)
    lo, hi = patterns.wilson(4, 5)
    assert (by[FOUR]["low"], by[FOUR]["high"]) == (round(lo, 4), round(hi, 4))
    assert by[CONV]["last_year"] == 2024 and by[CONV]["years_since"] == 0
    assert by[FOUR]["last_year"] == 2023 and by[FOUR]["years_since"] == 1
    assert by[NYQ]["last_year"] == 2020 and by[NYQ]["years_since"] == 4
    assert by[CONV]["marks_weight"] == {"mean": 0.28, "min": 0.28, "max": 0.28}      # 14 of 50 marks in each paper
    assert by[FOUR]["marks_weight"]["mean"] == 0.2
    assert sorted(by[ROC]["questions"]) == ["q-0r", "q-1r", "q-2r"]
    assert by[CONV]["typical_marks"] == 2 and by[FOUR]["typical_marks"] == 10
    assert all(p["id"] and "year" in p and "title" in p for p in ps["papers"]) and len(ps["papers"]) == 5


def test_marks_weight_uses_the_sum_of_accepted_marks_when_the_paper_has_no_total():
    papers, qs = five_papers()
    for p in papers:
        p["total_marks"] = None
    ps = patterns.compute_patterns(qs, papers)
    p0_total = sum(q["marks"] for q in qs if q["paper_id"] == "p-0")                  # 14 + 10 + 10 + 10 + 10
    conv = next(t for t in ps["topics"] if t["key"] == CONV)
    assert p0_total == 54 and conv["marks_weight"]["min"] == round(14 / 54, 4)
    assert conv["marks_weight"]["max"] == 1.0                                         # the last paper holds nothing else


def test_only_accepted_tagged_questions_are_counted_and_untagged_ones_are_reported():
    papers, qs = five_papers()
    qs += [mk("q-x1", "p-0", "A rejected one.", 1, "Fourier series", 10, status="rejected"),
           mk("q-x2", "p-1", "A pending one.", 1, "Fourier series", 10, status="pending"),
           mk("q-x3", "p-1", "Accepted but no topic yet.", None, "", 5)]
    ps = patterns.compute_patterns(qs, papers)
    by = {t["key"]: t for t in ps["topics"]}
    assert by[FOUR]["k"] == 4 and "q-x1" not in by[FOUR]["questions"] and "q-x2" not in by[FOUR]["questions"]
    assert ps["n_untagged"] == 1


def test_below_the_floor_the_counts_are_still_there_and_the_set_is_provisional():
    papers, qs = five_papers()
    keep = {"p-0", "p-1"}
    ps = patterns.compute_patterns([q for q in qs if q["paper_id"] in keep], [p for p in papers if p["id"] in keep])
    assert ps["provisional"] is True and ps["n_papers"] == 2
    f = ps["floor"]
    assert f["papers"] == 3 and f["questions"] == 20 and f["papers_needed"] == 1 and f["questions_needed"] == 20 - ps["n_questions"] > 0
    assert ps["topics"] and ps["sentence"]


def test_floor_of_twenty_questions_is_needed_as_well_as_three_papers():
    papers, qs = five_papers()
    few = [q for pid in ("p-0", "p-1", "p-2") for q in [x for x in qs if x["paper_id"] == pid][:4]]
    ps = patterns.compute_patterns(few, papers)
    assert ps["provisional"] is True and ps["floor"]["papers_needed"] == 0 and ps["floor"]["questions_needed"] == 20 - len(few)


def test_a_custom_floor_is_honoured():
    papers, qs = five_papers()
    assert patterns.compute_patterns(qs, papers, floor_papers=6)["provisional"] is True
    assert patterns.compute_patterns(qs, papers, floor_papers=5, floor_questions=len(qs))["provisional"] is False


def test_a_paper_with_no_accepted_question_is_not_counted_in_n():
    papers, qs = five_papers()
    papers.append(paper("p-9", 2025))
    assert patterns.compute_patterns(qs, papers)["n_papers"] == 5


def test_years_since_is_none_when_papers_have_no_year():
    papers, qs = five_papers()
    for p in papers:
        p["year"] = None
    ps = patterns.compute_patterns(qs, papers)
    assert all(t["last_year"] is None and t["years_since"] is None for t in ps["topics"])


def test_pairs_need_four_papers_and_three_in_common():
    papers, qs = five_papers()
    ps = patterns.compute_patterns(qs, papers)
    pairs = {(p["a"], p["b"]): p for p in ps["pairs"]}
    assert pairs[tuple(sorted((CONV, FOUR)))]["k"] == 4 and pairs[tuple(sorted((CONV, FOUR)))]["n"] == 5
    assert tuple(sorted((CONV, ILAP))) in pairs and tuple(sorted((ILAP, ROC))) in pairs
    assert not any(NYQ in k for k in pairs)                                           # nyquist shares one paper only
    # three papers only: N is below 4, so no pair is listed
    keep = {"p-0", "p-1", "p-2"}
    three = patterns.compute_patterns([q for q in qs if q["paper_id"] in keep], [p for p in papers if p["id"] in keep])
    assert three["pairs"] == []


def test_a_pair_in_only_two_papers_is_not_listed_even_with_many_papers():
    papers = [paper(f"p-{i}", 2020 + i) for i in range(5)]
    qs = []
    for i in range(5):
        qs.append(mk(f"q-{i}a", f"p-{i}", f"Question A {i} on convolution.", 1, "Convolution sum", 10))
        if i < 2:
            qs.append(mk(f"q-{i}b", f"p-{i}", f"Question B {i} on series.", 1, "Fourier series", 10))
    assert patterns.compute_patterns(qs, papers)["pairs"] == []


def test_the_sentence_is_built_from_the_counts():
    papers, qs = five_papers()
    s = patterns.compute_patterns(qs, papers)["sentence"]
    assert "5 papers" in s and "Convolution sum" in s and "5 of 5" in s


def test_patterns_are_the_same_twice_over():
    papers, qs = five_papers()
    assert json.dumps(patterns.compute_patterns(qs, papers), sort_keys=True) == json.dumps(patterns.compute_patterns(list(reversed(qs)), list(reversed(papers))), sort_keys=True)


def test_families_inside_patterns_list_only_repeated_questions():
    papers, qs = five_papers()
    qs.append(mk("q-rep", "p-4", "Find the convolution sum of x[n] and h[n] for case 99.", 1, "Convolution sum", 10))
    ps = patterns.compute_patterns(qs, papers)
    assert ps["families"] and all(len(f["question_ids"]) >= 2 for f in ps["families"])
    assert all(f["confirmed"] is False for f in ps["families"])


# ------------------------------------------------------------------ 5. the Quiet list
def test_quiet_topics_are_seen_before_but_not_in_the_last_three_papers():
    papers, qs = five_papers()
    assert patterns.quiet_topics(qs, papers) == [NYQ]                                  # ilap and roc were set in 2022, the third last
    assert patterns.quiet_topics(qs, papers, r=2) == sorted([NYQ, ILAP, ROC])
    assert patterns.quiet_topics(qs, papers, r=5) == []                                # the last five papers are all of them


def test_quiet_uses_n_when_there_are_fewer_papers_than_r():
    papers, qs = five_papers()
    keep = {"p-0", "p-1"}
    assert patterns.quiet_topics([q for q in qs if q["paper_id"] in keep], [p for p in papers if p["id"] in keep]) == []


def test_quiet_orders_papers_by_year_not_by_the_order_they_are_given():
    papers, qs = five_papers()
    assert patterns.quiet_topics(list(reversed(qs)), list(reversed(papers))) == [NYQ]


# ------------------------------------------------------------------ 6. practise next
def hand_set(topics, n=6):
    return {"n_papers": n, "n_questions": 99, "papers": [], "pairs": [], "families": [], "quiet": {"r": 3, "topics": []},
            "sentence": "", "provisional": False, "floor": {}, "n_untagged": 0, "topics": topics}


def topic(k, unit, name, kk=6, mw=0.2, typical=5, nq=4):
    return {"key": ww_generator.topic_key(unit, name), "unit": unit, "topic": name, "k": kk, "n": 6, "low": 0.0, "high": 1.0,
            "last_year": 2024, "years_since": 0, "marks_weight": {"mean": mw, "min": mw, "max": mw}, "typical_marks": typical,
            "questions": [f"q-{k}-{i}" for i in range(nq)]}


def test_practise_next_prints_its_terms_and_uses_a_half_when_unmeasured():
    papers, qs = five_papers()
    ps = patterns.compute_patterns(qs, papers)
    picks = nxt.practise_next(ps, {}, 600)
    assert picks and all(p["terms"]["proficiency"] == 0.5 and p["terms"]["measured"] is False for p in picks)
    for p in picks:
        t = next(x for x in ps["topics"] if x["key"] == p["key"])
        assert len(t["questions"]) >= 3                                                # eligibility: three accepted questions
        want = t["marks_weight"]["mean"] * (t["k"] / t["n"]) * 0.5
        assert abs(p["gain"] - want) < 1e-6
        assert p["terms"]["marks_weight"] == t["marks_weight"]["mean"] and p["terms"]["seen_share"] == round(t["k"] / t["n"], 4)
        assert p["terms"]["minutes"] == t["typical_marks"] * 3.0
        assert p["question_ids"] == t["questions"]
    assert NYQ not in {p["key"] for p in picks}                                        # one accepted question only


def test_a_measured_proficiency_is_used_and_flagged():
    ps = hand_set([topic(1, 1, "Alpha"), topic(2, 2, "Beta")])
    a, b = ww_generator.topic_key(1, "Alpha"), ww_generator.topic_key(2, "Beta")
    picks = nxt.practise_next(ps, {a: 0.9}, 600, attempts={a: 6})
    pa = next(p for p in picks if p["key"] == a)
    pb = next(p for p in picks if p["key"] == b)
    assert pa["terms"]["measured"] is True and pa["terms"]["proficiency"] == 0.9
    assert pb["terms"]["measured"] is False and pb["terms"]["proficiency"] == 0.5
    assert picks[0]["key"] == b                                                        # the weaker topic gains more per minute


def test_a_topic_with_fewer_than_five_marked_attempts_is_unmeasured_even_if_a_value_is_passed():
    ps = hand_set([topic(1, 1, "Alpha")])
    a = ww_generator.topic_key(1, "Alpha")
    p = nxt.practise_next(ps, {a: 0.9}, 600, attempts={a: 4})[0]
    assert p["terms"]["measured"] is False and p["terms"]["proficiency"] == 0.5
    assert "4 marked attempts" in p["reason"]


def test_never_more_than_two_picks_in_a_row_from_one_unit():
    tops = [topic(i, 1, f"U1 {i}", mw=0.3) for i in range(5)] + [topic(9, 2, "U2 only", mw=0.05)]
    picks = nxt.practise_next(hand_set(tops), {}, 600)
    units = [p["unit"] for p in picks]
    assert len(units) == 5                    # 1 1 2 1 1: a sixth pick would be a third in a row from unit 1
    assert all(not (units[i] == units[i + 1] == units[i + 2]) for i in range(len(units) - 2)), units
    assert units[:3] == [1, 1, 2]


def test_picks_fit_the_gap_and_are_filled_in_rank_order():
    tops = [topic(1, 1, "Short", typical=2, mw=0.06), topic(2, 2, "Long", typical=10, mw=0.5), topic(3, 3, "Mid", typical=5, mw=0.2)]
    picks = nxt.practise_next(hand_set(tops), {}, 45)
    assert sum(p["terms"]["minutes"] for p in picks) <= 45
    assert [p["topic"] for p in picks] == ["Long", "Mid"]                              # 30 + 15 minutes; Short (6) no longer fits
    ratios = [p["gain"] / p["terms"]["minutes"] for p in picks]
    assert ratios == sorted(ratios, reverse=True)
    assert nxt.practise_next(hand_set(tops), {}, 0) == []


def test_minutes_per_mark_is_a_parameter_and_is_printed():
    ps = hand_set([topic(1, 1, "Alpha", typical=4)])
    assert nxt.practise_next(ps, {}, 600, minutes_per_mark=2.0)[0]["terms"]["minutes"] == 8.0
    assert nxt.MINUTES_PER_MARK == 3.0


def test_the_reason_is_made_of_counts_only():
    ps = hand_set([topic(1, 1, "Alpha", kk=4)])
    a = ww_generator.topic_key(1, "Alpha")
    r = nxt.practise_next(ps, {}, 600, attempts={a: 2})[0]["reason"]
    assert r == "set in 4 of 6 papers on file; 2 marked attempts"
    assert nxt.practise_next(ps, {}, 600)[0]["reason"] == "set in 4 of 6 papers on file; no marked attempts"
    assert nxt.practise_next(hand_set([topic(1, 1, "Alpha", kk=4)]), {}, 600, attempts={a: 1})[0]["reason"].endswith("1 marked attempt")


def test_topics_with_fewer_than_three_questions_are_not_offered():
    assert nxt.practise_next(hand_set([topic(1, 1, "Thin", nq=2)]), {}, 600) == []


# ------------------------------------------------------------------ 7. words that are never printed
def strings(x):
    if isinstance(x, str):
        yield x
    elif isinstance(x, dict):
        for k, v in x.items():
            yield from strings(k)
            yield from strings(v)
    elif isinstance(x, (list, tuple)):
        for v in x:
            yield from strings(v)


def test_no_string_in_any_payload_holds_a_forbidden_word():
    papers, qs = five_papers()
    ps = patterns.compute_patterns(qs, papers)
    picks = nxt.practise_next(ps, {}, 600)
    tags = [tag.tag_question(q, tag.topics_of(SUBJECT)) for q in qs]
    fams = families.find_families(qs)
    texts = [s.lower() for s in strings([ps, picks, tags, fams])]
    # the topic names come from the syllabus; none holds a forbidden word by construction
    assert len(texts) > 200
    for s in texts:
        for w in FORBIDDEN:
            assert w not in s, (w, s)


def test_the_package_modules_contain_no_forbidden_word_in_a_string_they_build():
    import inspect
    for mod in (patterns, nxt, tag, families):
        src = inspect.getsource(mod)
        for lit in re.findall(r'"([^"\n]{12,})"', src):
            for w in FORBIDDEN:
                assert w not in lit.lower(), (mod.__name__, w, lit)


# ------------------------------------------------------------------ 8. the gate
def test_the_gate_runs_every_pure_function_twice_and_agrees():
    r = ww_check_pyq.report()
    assert r["ok"] is True and r["problems"] == [] and r["checked"] == 7


def test_the_gate_reports_a_difference(monkeypatch):
    state = {"n": 0}
    real = patterns.compute_patterns

    def flaky(*a, **k):
        state["n"] += 1
        out = real(*a, **k)
        out["sentence"] += str(state["n"])
        return out
    monkeypatch.setattr(patterns, "compute_patterns", flaky)
    r = ww_check_pyq.report()
    assert r["ok"] is False and any("compute_patterns" in p for p in r["problems"])


def test_the_gate_main_prints_and_exits_zero_when_clean(capsys):
    assert ww_check_pyq.main() == 0
    assert "ok" in capsys.readouterr().out.lower()
