"""Career engine (ww_career.py): career deadlines and the skill tree -> the ranked next
career action, each with why and days left. Fictional fixtures only."""
import copy
from pathlib import Path

import pytest

from jarvis_app import ww_base as wb
from jarvis_app import ww_career as wc
from jarvis_app import ww_engines as we

FLAT = Path(__file__).with_name("fixtures") / "ww-inputs-flat.json"
MON = "2026-10-26"


@pytest.fixture()
def example():
    return we.load_inputs(Path("no-such-inputs.json"))


@pytest.fixture()
def flat():
    return we.load_inputs(FLAT)


def test_on_the_example_the_nearest_application_comes_first_with_why_and_days_left(example):
    c = we.career(example, MON)
    assert c["status"] == "ok" and c["version"] == 1
    top = c["next"]
    assert top["id"] == "dl-summer-school" and top["days_left"] == 35 and top["kind"] == "application"
    assert "closes in 35 days (2026-11-30)" in top["why"] and "Verilog (level 1 of 4)" in top["why"]
    assert "an exam comes first: Example internal test in 7 days" in top["why"]          # the gate, said once
    assert sum("an exam comes first" in a["why"] for a in c["actions"]) == 1
    assert top["action"].startswith("Draft the application") and top["action"].endswith("First node: Verilog")
    assert c["say"].startswith("Next career step: Draft the application") and "35 days left" in c["say"]
    assert [a["id"] for a in c["actions"]] == ["dl-summer-school", "dl-open-source", "g-offer", "dl-ms-example"]
    assert all(c["actions"][i]["score"] >= c["actions"][i + 1]["score"] for i in range(len(c["actions"]) - 1))
    assert c["gates"] == [{"id": "dl-internal-test", "title": "Example internal test", "date": "2026-11-02", "days_left": 7}]


def test_a_goal_with_no_deadline_standing_for_it_is_its_own_item_and_others_serve_goals(example):
    c = we.career(example, MON)
    offer = next(a for a in c["actions"] if a["id"] == "g-offer")
    assert offer["source"] == "goal" and offer["action"].startswith("No dated application stands for this goal")
    ms = next(a for a in c["actions"] if a["id"] == "dl-ms-example")
    assert ms["serves"] == "g-ms-apps" and "serves MS applications sent (by 2028-04-30)" in ms["why"]
    assert ms["action"].startswith("Keep the grades")                                     # more than a year out


def test_flat_inputs_classify_kinds_and_skip_exams(flat):
    c = we.career(flat, MON)
    kinds = [a["kind"] for a in c["actions"]]
    assert "exam" not in kinds and kinds[:2] == ["internship", "internship"]
    assert {a["kind"] for a in c["actions"]} == {"internship", "gsoc", "ms"}
    assert c["gates"][0]["title"] == "Class quiz (example)"


def test_the_pipeline_status_and_prep_decide_the_step_and_duplicates_merge(example):
    apps = [{"id": "a1", "org": "Example Lab", "programme": "summer research programme", "closes": "2026-11-30",
             "status": "preparing", "linked_nodes": ["n-verilog"],
             "prep": [{"id": "cv", "title": "One-page CV", "done": True}, {"id": "sop", "title": "Statement draft", "done": False}]},
            {"id": "a2", "org": "Other", "programme": "x", "closes": "2026-11-10", "status": "applied", "linked_nodes": []},
            {"id": "a3", "org": "Closed", "programme": "y", "closes": "2026-11-05", "status": "rejected"}]
    nodes = [{"id": "n-verilog", "name": "Verilog basics", "status": "in_progress", "prereqs": []},
             {"id": "n-cpu", "name": "Tiny CPU", "status": "locked", "prereqs": ["n-verilog"]}]
    c = we.career(example, MON, nodes=nodes, applications=apps)
    top = c["next"]
    assert top["id"] == "a1" and set(top["ids"]) == {"a1", "dl-summer-school"}         # one item, two sources
    assert top["action"] == "Next prep step: Statement draft (1 of 2 done)" and top["status"] == "preparing"
    applied = next(a for a in c["actions"] if a["id"] == "a2")
    assert applied["action"].startswith("Wait for the answer") and applied["score"] < top["score"]
    assert "a3" not in {a["id"] for a in c["actions"]}
    assert c["unlocks_most"]["id"] == "n-verilog" and c["unlocks_most"]["unlocks"] == 1 and "a1" in c["unlocks_most"]["asked_by"]


@pytest.mark.parametrize("kind,days,status,start", [
    ("gsoc", 90, None, "Pick one organisation"), ("gsoc", 20, None, "Write the proposal"),
    ("ms", 400, None, "Keep the grades"), ("ms", 200, None, "Book the language test"), ("ms", 60, None, "Write the statement"),
    ("internship", 2, None, "Submit it"), ("internship", 15, None, "Finish the application"),
    ("internship", 40, None, "Draft the application"), ("internship", 40, "interview", "Prepare the interview")])
def test_step_templates(kind, days, status, start):
    assert wc.next_step(kind, days, status).startswith(start)


def test_nothing_ahead_is_said_plainly_and_the_engine_is_pure(example):
    empty = we.career(we.normalize_inputs({}), MON)
    assert empty["next"] is None and empty["actions"] == [] and "No career deadline" in empty["say"]
    assert we.career(example, "2030-01-01")["next"] is None
    before = copy.deepcopy(example)
    apps = [{"id": "a1", "org": "X", "programme": "Y", "closes": "2026-11-30", "status": "idea", "linked_nodes": []}]
    apps_before = copy.deepcopy(apps)
    assert we.career(example, MON, applications=apps) == we.career(copy.deepcopy(example), MON, applications=copy.deepcopy(apps))
    assert example == before and apps == apps_before
    for a in we.career(example, MON)["actions"]:
        assert wb.no_shame(a["action"]) and wb.no_shame(a["why"])


def test_run_validates_career_data(example):
    bad = we.run("career", example, MON, applications=[{"org": "no id"}])
    assert bad["status"] == "invalid_input" and "data.applications[0]: missing id" in bad["problems"]
    assert we.run("career", example, MON, nodes=[{"id": "n"}])["status"] == "ok"
