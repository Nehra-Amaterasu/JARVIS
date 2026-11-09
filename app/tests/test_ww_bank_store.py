"""The disk bank (ww_bank_store.py): what it accepts, what it refuses, how it dedupes, what the generator sees.

Every test points WW_BANK_DIR at a pytest tmp folder: never the real data/bank."""
import json

import pytest

from jarvis_app import ww_bank_store as store
from jarvis_app import ww_generator


@pytest.fixture(autouse=True)
def bank(tmp_path, monkeypatch):
    monkeypatch.setenv("WW_BANK_DIR", str(tmp_path / "bank"))
    return tmp_path / "bank"


def verbatim(**kw):
    r = {"origin": "cc-verbatim", "tier": "gate", "unit": 2, "topic": "Bode plot", "marks": 5,
         "question": "Sketch the Bode magnitude plot of a lead compensator and mark the corner frequencies.",
         "source": "Fixture course 6.000, Problem Set 1, CC BY-NC-SA 4.0", "source_url": "https://example.org/ps1.pdf",
         "license": "CC BY-NC-SA 4.0", "ref": "6.000 PS1 Problem 2"}
    r.update(kw)
    return r


def pointer(**kw):
    r = {"origin": "pointer", "tier": "gate", "unit": 2, "topic": "Bode plot", "marks": 2, "source": "GATE 2024 EC, pointer only",
         "source_url": "https://example.org/gate.pdf", "ref": "GATE 2024 EC Q31"}
    r.update(kw)
    return r


def test_a_verbatim_record_is_stored_with_every_field_and_served_with_its_source_line():
    res = store.add("control", [verbatim()], "mit_ocw")
    assert res == {"added": 1, "duplicate": 0, "rejected": []}
    (q,) = store.load_for("control")
    for k in ("source", "source_url", "license", "origin", "ref", "tier", "unit", "topic", "marks", "question", "id"):
        assert q[k] not in (None, ""), k
    assert q["sitting"] == q["source"] and q["type"] == "harvested" and q["license"] == "CC BY-NC-SA 4.0"
    assert q["id"].startswith("h:control:")


@pytest.mark.parametrize("change,why", [
    ({"license": ""}, "licence"), ({"license": "All rights reserved"}, "licence"), ({"source_url": ""}, "source_url"),
    ({"source": ""}, "source"), ({"question": ""}, "question"), ({"question": "x" * 2001}, "2000"), ({"tier": "hard"}, "tier"),
    ({"marks": 0}, "marks"), ({"marks": 1.3}, "marks"), ({"unit": 0}, "unit"), ({"topic": ""}, "topic"),
    ({"origin": "scraped"}, "origin"), ({"question": "an $unclosed formula about control"}, "unmatched"), ({"source_url": "javascript:alert(1)"}, "http"),
])
def test_a_bad_verbatim_record_is_rejected_with_the_reason_and_never_stored(change, why):
    res = store.add("control", [verbatim(**change)], "mit_ocw")
    assert res["added"] == 0 and len(res["rejected"]) == 1 and why in res["rejected"][0]
    assert store.load_for("control") == []


def test_a_pointer_never_carries_text_and_is_served_as_solve_reference():
    res = store.add("control", [pointer(question="The full copyrighted stem of the question goes here.")], "gate_official")
    assert res["added"] == 0 and "never carries question text" in res["rejected"][0]
    assert store.add("control", [pointer(ref="")], "gate_official")["added"] == 0
    assert store.add("control", [pointer()], "gate_official")["added"] == 1
    stored = (store.bank_root() / "control" / "gate_official.jsonl").read_text(encoding="utf-8")
    assert "question" not in json.loads(stored) and json.loads(stored)["license"] == "pointer-only"
    (q,) = store.load_for("control")
    assert q["question"] == "Solve: GATE 2024 EC Q31" and q["origin"] == "pointer" and q["source"]


def test_dedupe_is_by_normalised_text_across_sources():
    store.add("control", [verbatim()], "mit_ocw")
    same = verbatim(question="  SKETCH the Bode magnitude plot of a lead compensator -- and mark the corner frequencies!  ",
                    source="Another site, CC BY-SA 4.0", license="CC BY-SA 4.0", source_url="https://example.org/other")
    res = store.add("control", [same, same], "stackexchange")
    assert res["added"] == 0 and res["duplicate"] == 2
    assert len(store.load_for("control")) == 1
    store.add("control", [pointer(), pointer()], "gate_official")
    assert len(store.all_records("control")) == 2           # a repeated pointer is one pointer


def test_subject_names_cannot_climb_out_or_hit_the_harvest_folder():
    for bad in ("../x", "_harvest", "a/b", "", "X Y", "a" * 61):
        with pytest.raises(ValueError):
            store.add(bad, [verbatim()], "mit_ocw")
        assert store.load_for(bad) == []
    with pytest.raises(ValueError):
        store.add("control", [verbatim()], "../evil")


def test_an_empty_bank_serves_nothing_and_creates_nothing(bank):
    assert store.load_for("control") == [] and store.load_for(None) == [] and store.counts()["total"] == 0
    assert not bank.exists()


def test_a_torn_last_line_costs_one_record_not_the_bank(bank):
    store.add("control", [verbatim()], "mit_ocw")
    f = bank / "control" / "mit_ocw.jsonl"
    f.write_text(f.read_text(encoding="utf-8") + '{"id": "h:control:x", "quest', encoding="utf-8")
    assert len(store.load_for("control")) == 1


def test_counts_come_from_the_files_by_subject_tier_and_origin():
    store.add("control", [verbatim(), verbatim(question="A second, different Bode question about gain margin and phase.", tier="exam")], "mit_ocw")
    store.add("control", [pointer()], "gate_official")
    store.add("network", [verbatim(question="Find the Thevenin equivalent of the fictional two-terminal network drawn.", topic="Thevenin")], "mit_ocw")
    c = store.counts()
    assert c["total"] == 4 and c["subjects"] == {"control": 3, "network": 1}
    assert c["tiers"] == {"exam": 1, "gate": 3} and c["origins"]["pointer"] == 1 and c["origins"]["cc-verbatim"] == 3
    assert store.counts("network")["total"] == 1


def test_the_location_is_a_scratch_folder_in_tests_never_the_real_data(monkeypatch, tmp_path):
    monkeypatch.delenv("WW_BANK_DIR")
    monkeypatch.setenv("JARVIS_DATA_DIR", str(tmp_path / "d"))
    assert store.bank_root() == tmp_path / "d" / "bank" / "questions"
    monkeypatch.setenv("WW_BANK_DIR", str(tmp_path / "w"))
    assert store.bank_root() == tmp_path / "w"


# ---- the generator hook
EXAM = {"id": "x", "subject": "control", "title": "X", "units": [], "max": 10,
        "pattern": [{"name": "A", "questions": 2, "attempt": 2, "marks": 5}]}
UNITS = [{"n": 2, "title": "Frequency response", "exam_weight": "high", "topics": ["Bode plot"]}]


def test_with_an_empty_disk_bank_the_generator_is_byte_for_byte_what_it_was(monkeypatch):
    typed = [{"id": f"t{i}", "unit": 2, "topic": "Bode plot", "question": f"Typed question {i}", "marks": 5, "section": "A", "sitting": "typed"} for i in range(4)]
    with_hook = ww_generator.generate(EXAM, typed, UNITS, {}, {}, seed=3)
    monkeypatch.setattr(store, "load_for", lambda subject, tier=None: [])
    assert json.dumps(with_hook, sort_keys=True) == json.dumps(ww_generator.generate(EXAM, typed, UNITS, {}, {}, seed=3), sort_keys=True)


def test_a_gate_paper_is_served_from_disk_and_a_pointer_prints_solve_reference():
    store.add("control", [verbatim()], "mit_ocw")
    store.add("control", [pointer()], "gate_official")
    paper = ww_generator.generate(EXAM, [], UNITS, {}, {}, seed=1, tier="gate")
    assert paper["tier"] == "gate" and paper["tier_note"] is None and paper["empty"] is False and paper["bank_size"] == 2
    qs = [q for s in paper["sections"] for q in s["questions"]]
    assert {q["text"] for q in qs} == {verbatim()["question"], "Solve: GATE 2024 EC Q31"}
    assert all(q["source"] for q in qs)
    # a gate harvest does not turn up in an exam-tier paper
    exam_paper = ww_generator.generate(EXAM, [], UNITS, {}, {}, seed=1, tier="exam")
    assert exam_paper["empty"] is True and exam_paper["bank_size"] == 0
    assert paper["total_marks"] == 10 and ww_generator.paper_invariants(paper, EXAM) == []


def test_another_subjects_disk_bank_does_not_leak_into_a_paper():
    store.add("network", [verbatim()], "mit_ocw")
    paper = ww_generator.generate(EXAM, [], UNITS, {}, {}, seed=1)
    assert paper["empty"] is True and paper["bank_size"] == 0
