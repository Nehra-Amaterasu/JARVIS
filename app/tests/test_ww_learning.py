"""The learning engine (daily concept + Leitner recall) and the LEARN.md parser. Fictional concepts only."""
from jarvis_app import learn_bank, ww_engines
from jarvis_app.ww_learning import INTERVALS, MAX_DUE, box_of, learning

C = [{"id": f"c{i}", "title": f"Concept {i}", "body": "b", "quiz": [f"q{i}a", f"q{i}b", f"q{i}c"]} for i in range(1, 6)]
D0 = "2026-10-20"


def test_first_day_offers_concept_one_and_nothing_due():
    r = learning({}, D0, concepts=C, record={})
    assert r["new"]["id"] == "c1" and r["due"] == []


def test_a_concept_shown_today_stays_todays_concept():
    r = learning({}, D0, concepts=C, record={"seen": {"c1": D0}})
    assert r["new"]["id"] == "c1" and r["due"] == []       # not due on the day it was taught


def test_next_day_brings_a_new_concept_and_the_first_recall():
    r = learning({}, "2026-10-21", concepts=C, record={"seen": {"c1": D0}})
    assert r["new"]["id"] == "c2"
    assert [d["id"] for d in r["due"]] == ["c1"] and r["due"][0]["question"] == "q1a"


def test_correct_recalls_push_the_next_one_further_away():
    rec = {"seen": {"c1": D0}, "reviews": {"c1": [{"date": "2026-10-21", "ok": True}]}}
    assert box_of(rec["reviews"]["c1"]) == 1
    not_yet = learning({}, "2026-10-23", concepts=C, record=rec)        # 1 + 3 days -> due 10-24
    due = learning({}, "2026-10-24", concepts=C, record=rec)
    assert "c1" not in [d["id"] for d in not_yet["due"]] and "c1" in [d["id"] for d in due["due"]]
    assert INTERVALS[1] == 3


def test_a_wrong_answer_resets_to_tomorrow_and_rotates_the_question():
    rec = {"seen": {"c1": D0}, "reviews": {"c1": [{"date": "2026-10-21", "ok": True}, {"date": "2026-10-24", "ok": False}]}}
    assert box_of(rec["reviews"]["c1"]) == 0
    r = learning({}, "2026-10-25", concepts=C, record=rec)
    d = next(x for x in r["due"] if x["id"] == "c1")
    assert d["question"] == "q1c"                                       # third time asked, third question


def test_never_more_than_max_due_and_weakest_first():
    seen = {c["id"]: D0 for c in C}
    rec = {"seen": seen, "reviews": {"c1": [{"date": "2026-10-21", "ok": True}]}}
    r = learning({}, "2026-11-30", concepts=C, record=rec)
    assert len(r["due"]) == MAX_DUE and r["due_total"] == 5 and r["due"][0]["box"] == 0
    assert r["new"] is None


def test_pure_and_registered():
    rec = {"seen": {"c1": D0}}
    before = repr(rec)
    learning({}, "2026-10-21", concepts=C, record=rec)
    assert repr(rec) == before
    assert ww_engines.REGISTRY["learning"].version == 1


def test_parser_reads_heading_body_and_three_questions():
    text = "# LEARN\nintro\n\n## 3. Domain shift [AL][AB]\nThe room changes.\nQuiz: (a) Name one? (b) Why? (c) Cheapest fix?\n"
    got = learn_bank.parse(text)
    assert got == [{"id": "c3", "title": "Domain shift", "body": "The room changes.", "quiz": ["Name one?", "Why?", "Cheapest fix?"]}]


def test_missing_private_file_falls_back_to_the_example_and_says_so(tmp_path):
    got = learn_bank.load(tmp_path / "nope.md")
    assert got["source"] == "example" and got["concepts"] == learn_bank.EXAMPLE
