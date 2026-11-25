"""Papers whose marks stand in the heading of a part (ww_pyq/heads.py, found on real papers 25 Nov 2026).

Two layouts, both invented here in the frames of the real ones: "PART A: ... Each question carries
1 mark 4x1=4" over Q | QUESTIONS | CO | BL tables, and "2. Attempt any three of the following:
10*3 = 30" over "(a) | text | CO" tables. Marks are read from the heading or stay missing.
"""
import pytest

from jarvis_app.ww_pyq import heads
from jarvis_app.ww_pyq.blueprint import infer_blueprint
from jarvis_app.ww_pyq.ingest import ingest_pdf
from jarvis_app.ww_pyq.store import Store
from pyq_fixtures import build_pdf

W5 = [40, 24, 300, 40, 30]
W4 = [40, 324, 40, 30]

INTERNAL = {
    "name": "internal_test",
    "pages": [
        [
            {"t": "Internal Test One", "c": True},
            "Time: 1 hour      Max. Marks: 20",
            "Course Outcomes:",
            {"table": {"cols": ["COURSE OUTCOMES", ""], "widths": [60, 360], "rows": [
                ["CO1", "Understand the sampling of signals."], ["CO2", "Apply filters to a given signal."]]}},
            {"gap": 6},
            "PART A: ANSWER ALL THE QUESTIONS Each question carries 1mark 4x1=4",
            {"table": {"cols": ["Q. No.", "", "Question", "CO", "BL"], "widths": W5, "rows": [
                ["1.", "a", "State the sampling theorem.", "CO1", "1"], ["", "b", "Define aliasing in a signal.", "CO1", "1"],
                ["", "c", "List two kinds of filters.", "CO2", "2"], ["", "d", "Define the cut-off frequency.", "CO2", "2"]]}},
            {"gap": 8},
            "PART-B: Attempt all the questions of this section(3 X 4M = 12M)",
            {"table": {"cols": ["Q", "", "QUESTIONS", "BL", "CO"], "widths": [40, 24, 300, 30, 40], "rows": [
                ["2", "a", "Explain the sampling of a band-limited", "2", "1"], ["", "", "signal with a neat sketch.", "", ""],
                ["", "", "OR", "", ""], ["", "b", "Derive the sampling rate needed for a given band.", "3", "1"],
                ["3", "a", "Design a low pass filter for the data given.", "4", "2"], ["", "", "OR", "", ""],
                ["", "b", "Compare two kinds of filters in a table.", "4", "2"]]}},
        ],
        [
            # the table goes on without its header on the next page
            {"table": {"cols": ["4.", "Find the spectrum of the sampled signal given below.", "3", "2"], "widths": [40, 324, 30, 40], "rows": []}},
            {"gap": 8},
            "PART C: ANSWER ANY ONE QUESTION. Each question carries 4 marks 1x4=4",
            {"table": {"cols": ["Q. No", "Part C", "CO", "B L"], "widths": W4, "rows": [
                ["5", "Discuss the use of filters in a receiver.", "2", "4"], ["6", "Explain how a signal is rebuilt from samples.", "1", "4"]]}},
        ],
    ],
}

UNIVERSITY = {
    "name": "university_frame",
    "pages": [[
        {"t": "Theory Examination", "c": True},
        "Time: 3 Hours      Total Marks: 100",
        "SECTION A",
        "1. Attempt all questions in brief. 2*10 = 20",
        {"table": {"cols": ["Q No", "Questions", "CO"], "widths": [40, 340, 30], "rows":
            [[f"({c})", f"State property number {i} of a stable system.", "1"] for i, c in enumerate("abcdefgh", 1)]
            + [["(a)", "State property number nine of a stable system.", "2"], ["(b)", "State property number ten of a stable system.", "2"]]}},
        {"gap": 6},
        "SECTION B",
        "2. Attempt any three of the following: 10*3 = 30",
        {"table": {"cols": ["Q No", "Questions", "CO"], "widths": [40, 340, 30], "rows": [
            [f"({c})", f"Derive result {i} for a second order system.", "3"] for i, c in enumerate("abcde", 1)]}},
    ]],
}


def read(spec, tmp_path):
    st = Store(tmp_path / "pyq")
    r = ingest_pdf(build_pdf(spec, tmp_path / "made"), store=st)
    return st, r, r["drafts"]


def test_an_internal_test_gives_every_question_its_heading_marks(tmp_path):
    st, r, qs = read(INTERNAL, tmp_path)
    assert [q["label"] for q in qs] == ["1a", "1b", "1c", "1d", "2a", "2b", "3a", "3b", "4", "5", "6"]
    assert [q["marks"] for q in qs] == [1, 1, 1, 1, 4, 4, 4, 4, 4, 4, 4]
    assert all(q["marks_source"] == "printed" for q in qs)
    assert [q["section"] for q in qs] == ["A"] * 4 + ["B"] * 5 + ["C"] * 2
    assert [(q["co"], q["bl"]) for q in qs[:3]] == [("CO1", 1), ("CO1", 1), ("CO2", 2)]
    assert (qs[4]["co"], qs[4]["bl"]) == ("CO1", 2) and (qs[8]["co"], qs[8]["bl"]) == ("CO2", 3)   # BL before CO in part B
    assert qs[4]["choice_group"] and qs[4]["choice_group"] == qs[5]["choice_group"] != qs[6]["choice_group"] == qs[7]["choice_group"]
    assert "neat sketch" in qs[4]["text"] and "Derive" not in qs[4]["text"]       # a second ruled line joins its question
    assert r["paper"]["total_marks"] == 20 and all(q["crop"] for q in qs)
    assert not any("Understand the sampling" in q["text"] for q in qs)            # the course-outcome table is no question
    assert any("heading gives 4 marks each" in e["text"] for e in r["trace"])


def test_the_internal_test_infers_a_balanced_blueprint(tmp_path):
    st, r, _ = read(INTERNAL, tmp_path)
    bp = infer_blueprint(r["paper"], st.list_questions(r["paper"]["id"]))
    assert bp["total"] == 20 and sum(s["attempt"] * s["marks"] for s in bp["sections"]) == 20


def test_the_university_frame_takes_number_and_marks_from_the_line_above_the_table(tmp_path):
    _, r, qs = read(UNIVERSITY, tmp_path)
    a, b = [q for q in qs if q["section"] == "A"], [q for q in qs if q["section"] == "B"]
    assert len(a) == 10 and len(b) == 5
    assert {q["marks"] for q in a} == {2} and {q["marks"] for q in b} == {10}
    assert a[0]["label"] == "1a" and [q["label"] for q in b] == ["2a", "2b", "2c", "2d", "2e"]
    assert not any(q["text"].lower().startswith("attempt") for q in qs)           # the instruction is not a question


@pytest.mark.parametrize("text, units, marks", [
    ("PART A: ANSWER ALL THE QUESTIONS Each question carries 1mark 4x1=4", 4, 1),
    ("PART B: ANSWER ALL THE QUESTIONS Each question carries 4 marks 3x4=12", 3, 4),
    ("PART-A: Attempt all the questions of this section(1M X 4= 4M)", 4, 1),
    ("PART-B: Attempt all the questions of this section(3 X 4M = 12M)", 3, 4),
    ("PART A:AnswerALL questions. 5Q x2 M =10", 5, 2),
    ("Attempt any three of the following: 10*3 = 30", 5, 10),
    ("Attempt all questions in brief. 2*10 = 20", 10, 2),
    ("PART C: ANSWER ANY ONE QUESTION 4x1=4", 2, 4),
    ("PART C : ANSWER ANY ONE QUESTION. Each question carries 4 marks 1x4=4", 2, 4),
    ("Each question carries 2 marks 5 Q × 2 = 10 Marks", 5, 2),
    ("Section A (4 x 4 = 16)", 4, 4),
    ("TWO MARKS QUESTIONS", 9, 2),
    ("LONG QUESTIONS (8 marks)", 9, 8),
])
def test_the_marks_a_heading_prints(text, units, marks):
    assert heads.section_marks(text, units) == (marks, "")


@pytest.mark.parametrize("text, units", [
    ("PART B: ANSWER ALL THE QUESTIONS", 3),                       # says nothing
    ("PART B: Attempt all questions (3 x 4 = 13)", 3),             # does not multiply out
    ("PART B: (3 x 4 = 12)", 3),                                   # does not say how many to attempt
    ("PART B: Attempt any two (3 x 4 = 12)", 5),                   # neither factor is the two to attempt
    ("SEVEN/EIGHT MARKS QUESTIONS", 5),                            # a range
    ("SHORT QUESTIONS (2-4 marks)", 5),
    ("PART A: each question carries 5 marks 4x1=4", 4),            # the heading disagrees with itself
])
def test_a_heading_that_is_not_clear_gives_no_marks(text, units):
    marks, why = heads.section_marks(text, units)
    assert marks is None and why


def test_marks_a_question_prints_itself_are_kept(tmp_path):
    spec = {"name": "own_marks", "pages": [["Max. Marks: 20", "PART A: Answer all the questions. Each question carries 2 marks",
                                            "1. State the final value theorem. (5 marks)", "2. Define a causal system."]]}
    _, _, qs = read(spec, tmp_path)
    assert [q["marks"] for q in qs] == [5, 2]


@pytest.mark.parametrize("text", [
    "section provides positive phase compensation, thereby improving stability, bandwidth, and speed",
    "Find x when 3 x 4 = 12 and y is given.", "1. Show that 3 x 4 = 12 by counting.",
    "Part of the energy is lost as heat.", "Attempt to explain the theorem in your own words.",
])
def test_prose_is_neither_a_heading_nor_a_rule(text):
    assert heads.part_letter(text) is None and not heads.is_rule(text)


def test_a_row_with_the_wrong_number_of_values_keeps_none_of_them():
    rows = [(["Q", "Question", "BL", "CO"], [0, 0, 1, 1]), (["1", "a", "Define noise.", "4"], [0, 1, 1, 2]),
            (["", "b", "Define gain.", "2", "1"], [0, 2, 1, 3])]
    ev = [e for e in heads.headed_table(rows, {}) if e["ev"] == "q"]
    assert "bl" not in ev[0] and "co" not in ev[0]                                # a 4 alone is a BL or a CO: not guessed
    assert (ev[1]["bl"], ev[1]["co"]) == (2, 1)


def test_a_table_without_question_columns_gives_nothing():
    assert heads.headed_table([(["x", "1", "2"], [0] * 4), (["f", "3", "4"], [0] * 4)], {"tail": ("co", "bl")}) == []
    assert heads.headed_table([(["CO1", "Understand waves"], [0] * 4)], {"tail": ("co", "bl")}) == []
    assert heads.headed_table([(["Q", "Question", "Marks", "CO"], [0] * 4), (["1", "Define", "5", "1"], [0] * 4)], {}) == []


def test_a_picture_question_has_no_text_and_says_so(tmp_path):
    spec = {"name": "picture_rows", "pages": [["Max. Marks: 8", "PART B: Attempt all the questions (2 X 4M = 8M)",
            {"table": {"cols": ["Q. No.", "Question", "CO", "BL"], "widths": W4, "rows": [["2.", "OR", "CO1", "2"], ["3.", "", "CO2", "3"]]}}]]}
    _, _, qs = read(spec, tmp_path)
    assert [(q["label"], q["text"], q["text_status"], q["marks"]) for q in qs] == [("2", "", "none", 4), ("3", "", "none", 4)]


def test_a_header_garbled_by_a_watermark_is_read_by_its_rows(tmp_path):
    rows = [["(a)", "Compare open loop and closed loop control systems.", "1"], ["(b)", "Draw the block diagram of a servo system.", "1"],
            ["(c)", "State the condition for stability of a system.", "2"]]
    spec = {"name": "garbled", "pages": [["Total Marks: 100", "SECTION A", "1. Attempt all questions in brief. 2*3 = 6",
            {"table": {"cols": ["Q. No", "E . Questions 2 5", "4 CO 2"], "widths": [40, 340, 50], "rows": rows}}]]}
    _, _, qs = read(spec, tmp_path)
    assert [(q["label"], q["marks"], q["co"]) for q in qs] == [("1a", 2, ""), ("1b", 2, ""), ("1c", 2, "")]   # the CO digit is dropped, not guessed
    assert qs[0]["text"] == "Compare open loop and closed loop control systems."


def test_a_data_table_with_lettered_rows_and_no_sentences_is_left_alone():
    rows = [(["(a)", "12", "40"], [0] * 4), (["(b)", "15", "44"], [0] * 4), (["(c)", "19", "51"], [0] * 4)]
    assert heads.headed_table(rows, {}) == []
