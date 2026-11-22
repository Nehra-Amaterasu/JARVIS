"""Papers printed as ruled tables headed by instruction rows (found on real papers, 22 Nov 2026).

The layout: no header names a marks column. A row such as "2. | Attempt ANY ONE of the following. | 7 x 1 = 07 | BL | CO"
heads a group, the rows under it are lettered parts with an OR row between alternatives, and a last section lists whole
numbered questions under an unnumbered instruction row. Before this reader, 11 real papers of this layout came out as 121
questions with scrambled text and 1 with marks; with it, 220 questions (20 a paper), all with marks. The paper below is
invented and has the same frame, the two faults a page break caused on the real ones (a cut-off piece with another column
count and a bare label), and a data table that must not become questions.
"""
import pytest

from jarvis_app.ww_pyq import blueprint, segment
from jarvis_app.ww_pyq.ingest import ingest_pdf
from jarvis_app.ww_pyq.store import Store
from pyq_fixtures import build_pdf

W6 = [52, 22, 300, 60, 30, 45]
W5 = [52, 322, 60, 30, 45]
W5_CUT = [52, 22, 360, 30, 45]          # what a page break left of a six-column table


def pair(n, arith, a, b, co, words="Attempt ANY ONE of the following."):
    rows = [["", "a.", a, "", "3", co], ["", "OR", "", "", "", ""], ["", "b.", b, "", "4", co]]
    return {"table": {"cols": [f"{n}.", "", words, arith, "BL", "CO"], "widths": W6, "rows": rows}}


PAPER = {
    "name": "instruction_rows",
    "pages": [
        [
            {"t": "Second Year Theory Examination", "c": True},
            "Course: Signals and Networks",
            "Max. Marks: 39",
            {"gap": 8},
            {"table": {"cols": ["Section A", "", "", "", "", ""], "widths": W6, "rows": [
                ["1.", "", "Attempt ALL questions in brief.", "2 x 5 = 10", "BL", "CO"],
                ["", "a.", "State the sampling theorem for a band-limited signal.", "", "1", "CO1"],
                ["", "b.", "Define the unit step and the unit impulse signals.", "", "1", "CO1"],
                ["", "c.", "Write the condition for a system to be causal.", "", "2", "CO2"],
                ["", "d.", "State the final value theorem with its condition.", "", "2", "CO3"],
                ["", "e.", "List two properties of the region of convergence.", "", "1", "CO4"],
            ]}},
            {"gap": 10},
            {"table": {"cols": ["Section B", "", "", "", "", ""], "widths": W6, "rows": [
                ["2.", "", "Attempt ANY ONE of the following.", "7 x 1 = 07", "BL", "CO"],
                ["", "a.", "Find the response of an RC network to the data given.", "", "3", "CO1"],
                ["", "OR", "", "", "", ""],
                ["", "b.", "Derive the convolution sum for a discrete system.", "", "4", "CO1"],
            ]}},
            {"gap": 10},
            # a data table of question 2 a: it has no instruction row and must not be read as questions
            {"table": {"cols": ["f", "10", "20", "30"], "widths": [40, 40, 40, 40], "rows": [["g", "4", "9", "15"]]}},
            {"gap": 10},
            pair(3, "7 x 1 = 07", "Compute the Fourier series of a square wave of period two.",
                 "Prove the time shifting property of the transform.", "CO2"),
            {"gap": 10},
            # question 4 is cut by the page break: its instruction row and part a stay here
            {"table": {"cols": ["4.", "", "Attempt ANY ONE of the following.", "7 x 1 = 07", "BL", "CO"], "widths": W6, "rows": [
                ["", "a.", "Determine the inverse transform of the given function.", "", "4", "CO3"],
            ]}},
        ],
        [
            # ... and the rest arrives with five columns and the label without its dot
            {"table": {"cols": ["", "OR", "", "", ""], "widths": W5_CUT, "rows": [
                ["", "b", "Explain why a stable system needs poles inside the circle.", "3", "CO3"],
            ]}},
            {"gap": 14},
            {"table": {"cols": ["Section C", "", "", "", ""], "widths": W5, "rows": [
                ["", "Attempt ANY TWO of the following.", "4 x 2 = 8", "BL", "CO"],
                ["5.", "State and explain the superposition theorem.", "", "2", "CO1"],
                ["6.", "Explain the concept of a phasor with one example.", "", "2", "CO2"],
                ["7.", "Describe a low pass filter and its frequency response.", "", "3", "CO3"],
                ["8.", "Define the transfer function of a linear system.", "", "2", "CO4"],
                ["9.", "Explain resonance in a series circuit briefly.", "", "3", "CO5"],
            ]}},
        ],
    ],
}


@pytest.fixture()
def store(tmp_path):
    return Store(tmp_path / "pyq")


def test_every_item_is_one_question_with_marks_from_the_instruction_row(store, tmp_path):
    res = ingest_pdf(build_pdf(PAPER, tmp_path / "made"), store=store)
    ds = res["drafts"]
    assert [d["label"] for d in ds] == ["1a", "1b", "1c", "1d", "1e", "2a", "2b", "3a", "3b", "4a", "4b", "5", "6", "7", "8", "9"]
    assert [d["marks"] for d in ds] == [2] * 5 + [7] * 6 + [4] * 5
    assert all(d["marks_source"] == "table" and d["crop"] and d["crop"]["png"] for d in ds)
    assert [d["section"] for d in ds] == ["A"] * 5 + ["B"] * 6 + ["C"] * 5
    assert res["paper"]["total_marks"] == 39 and res["paper"]["faults"] == []
    # the text is the row's own words: no label, no BL digit, no CO tag, nothing from the row beside it
    by = {d["label"]: d for d in ds}
    assert by["1c"]["text"] == "Write the condition for a system to be causal."
    assert by["7"]["text"] == "Describe a low pass filter and its frequency response."
    assert (by["1c"]["co"], by["1c"]["bl"]) == ("CO2", 2) and (by["9"]["co"], by["9"]["bl"]) == ("CO5", 3)


def test_or_rows_pair_the_alternatives_and_the_blueprint_adds_up(store, tmp_path):
    res = ingest_pdf(build_pdf(PAPER, tmp_path / "made"), store=store)
    by = {d["label"]: d for d in res["drafts"]}
    for n in "234":
        assert by[f"{n}a"]["choice_group"] and by[f"{n}a"]["choice_group"] == by[f"{n}b"]["choice_group"]
    assert len({by[f"{n}a"]["choice_group"] for n in "234"}) == 3
    assert all(not by[k]["choice_group"] for k in ("1a", "1e", "5", "9"))
    pid = res["paper"]["id"]
    bp = blueprint.infer_blueprint(store.get_paper(pid), store.list_questions(paper_id=pid))
    assert [(s["name"], s["questions"], s["attempt"], s["marks"]) for s in bp["sections"]] == [("A", 5, 5, 2), ("B", 6, 3, 7), ("C", 5, 2, 4)]
    assert bp["total"] == 39 and blueprint.validate_blueprint(bp) == []


def test_a_piece_cut_off_by_a_page_break_is_followed_and_a_data_table_is_not_a_question(store, tmp_path):
    res = ingest_pdf(build_pdf(PAPER, tmp_path / "made"), store=store)
    by = {d["label"]: d for d in res["drafts"]}
    assert by["4a"]["page"] == 1 and by["4b"]["page"] == 2          # the second alternative sits on the next page
    assert by["4b"]["text"] == "Explain why a stable system needs poles inside the circle."
    assert (by["4b"]["marks"], by["4b"]["co"], by["4b"]["bl"]) == (7, "CO3", 3)
    assert not any(d["label"] in ("f", "g") for d in res["drafts"])
    assert not any("15" in d["text"].split() for d in res["drafts"])  # the data rows went into no question either
    lines = [e["text"] for e in res["trace"] if e["kind"] == "table"]
    assert any("instruction rows, 5 read as questions" in t for t in lines)
    assert any("not a question table" in t for t in lines)


@pytest.mark.parametrize("a, b, t, attempt, all_, items, marks, why", [
    (2, 5, 10, None, True, 5, 2, ""),                       # ALL of five parts: two marks each
    (5, 2, 10, None, True, 5, 2, ""),                       # the same written the other way round
    (7, 1, 7, 1, False, 2, 7, ""),                          # ANY ONE of an OR pair
    (5, 3, 15, 3, False, 5, 5, ""),                         # ANY THREE of five
    (4, 4, 16, 4, False, 6, 4, ""),                         # equal factors need no count
    (3, 4, 12, 2, False, 3, None, "neither 3 nor 4"),       # fits neither way: left for review, never guessed
    (2, 5, 11, None, True, 5, None, "2 x 5 is not 11"),     # arithmetic that does not multiply out
    (6, 2, 12, None, False, 3, None, "how many to attempt"),
])
def test_marks_come_only_from_arithmetic_that_fits(a, b, t, attempt, all_, items, marks, why):
    got, reason = segment._group_marks({"a": a, "b": b, "t": t, "attempt": attempt, "all": all_, "items": [{}] * items})
    assert got == marks and why in reason


def test_marks_that_do_not_fit_stay_missing_and_the_trace_says_why(store, tmp_path):
    spec = {"name": "no_fit", "pages": [[
        "Max. Marks: 12",
        {"gap": 8},
        {"table": {"cols": ["3.", "", "Attempt ANY TWO of the following.", "3 x 4 = 12", "BL", "CO"], "widths": W6, "rows": [
            ["", "a.", "Explain the working of a bridge rectifier circuit.", "", "2", "CO1"],
            ["", "b.", "Derive the ripple factor of a full wave rectifier.", "", "3", "CO1"],
            ["", "c.", "Compare a clipper circuit with a clamper circuit.", "", "2", "CO2"],
        ]}},
    ]]}
    res = ingest_pdf(build_pdf(spec, tmp_path / "made"), store=store)
    assert [d["label"] for d in res["drafts"]] == ["3a", "3b", "3c"]
    assert all(d["marks"] is None and d["marks_source"] == "missing" for d in res["drafts"])
    assert any("marks left for review" in e["text"] and "neither 3 nor 4" in e["text"] for e in res["trace"] if e["kind"] == "segment")
