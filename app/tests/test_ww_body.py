"""The body & life engine: weekly habit targets read from their wording, evidence per
week, opt-in respected, a rotating upgrade focus. Fictional habits only."""
from jarvis_app import ww_engines
from jarvis_app.ww_body import LIFE, body, per_week, week_start

WED = "2026-10-28"     # a Wednesday; the week starts Monday 10-26
INPUTS = {"habits": [
    {"id": "H-read", "target": "20 min daily"},
    {"id": "H-gym", "target": "calisthenics 3x/week"},
    {"id": "H-private", "target": "something personal", "opt_in": False},
]}


def test_targets_come_from_the_wording():
    assert per_week({"target": "10 min warm-up daily"}) == 7
    assert per_week({"target": "3 h/day", "days": "Mon-Fri"}) == 5
    assert per_week({"target": "calisthenics 3x/week"}) == 3
    assert per_week({"target": "1 public commit per week"}) == 1


def test_week_starts_monday():
    assert week_start(WED) == "2026-10-26" and week_start("2026-10-26") == "2026-10-26"


def test_counts_only_this_week_and_quests_count_for_movement():
    log = {"H-read": ["2026-10-20", "2026-10-26", WED]}
    r = body(INPUTS, WED, habit_log=log, quest_days=["2026-10-27"])
    rows = {h["id"]: h for h in r["habits"]}
    assert rows["H-read"]["done_this_week"] == 2 and rows["H-read"]["today_done"]
    assert rows["H-gym"]["done_this_week"] == 1                      # the quest session counted


def test_opted_out_habits_are_never_shown():
    r = body(INPUTS, WED, habit_log={"H-private": [WED]})
    assert "H-private" not in [h["id"] for h in r["habits"]]


def test_unreachable_target_is_said_plainly_without_shame():
    # Sunday, nothing logged: a daily habit can no longer reach 7
    r = body(INPUTS, "2026-11-01", habit_log={})
    assert not r["habits"][0]["on_track"] and "next week" in r["say"]
    from jarvis_app.ww_base import no_shame
    assert no_shame(r["say"])


def test_focus_rotates_weekly_and_is_advice():
    a = body(INPUTS, WED)["focus"]["id"]
    b = body(INPUTS, "2026-11-04")["focus"]["id"]
    assert a != b and {a, b} <= {x[0] for x in LIFE}


def test_registered_with_schema():
    assert ww_engines.REGISTRY["body"].version == 1
    bad = ww_engines.run("body", INPUTS, WED, habit_log={"H-read": ["yesterday"]})
    assert bad["status"] == "invalid_input"
