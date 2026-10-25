"""Money engine (ww_money.py): budget and savings by month, income experiments scored
in rupees per hour after four weeks, a projection that prints its assumptions.
Education, never advice; no invented numbers. Every amount here is fictional."""
import copy
from pathlib import Path

import pytest

from jarvis_app import ww_base as wb
from jarvis_app import ww_engines as we

FLAT = Path(__file__).with_name("fixtures") / "ww-inputs-flat.json"
MON = "2026-10-26"


@pytest.fixture()
def example():
    return we.load_inputs(Path("no-such-inputs.json"))


@pytest.fixture()
def flat():
    return we.load_inputs(FLAT)


def E(d, kind, amount, **kw):
    return {"date": d, "kind": kind, "amount": amount, **kw}


LOG = [E("2026-09-01", "budget", 5000), E("2026-09-03", "income", 8000), E("2026-09-10", "expense", 4500),
       E("2026-09-28", "saving", 2000), E("2026-10-02", "income", 6000), E("2026-10-05", "expense", 6500),
       E("2026-10-20", "saving", 1000),
       # tutoring: started 2026-09-14, 6 weeks of log by MON, 10 h for Rs 4,500
       E("2026-09-14", "experiment", 1500, hours=3, experiment="ie-tutoring"),
       E("2026-10-10", "experiment", 3000, hours=7, experiment="ie-tutoring"),
       # freelance: two weeks in, still too early
       E("2026-10-12", "experiment", 800, hours=2, experiment="ie-freelance"),
       E("2026-11-01", "income", 999)]            # after today: ignored


def test_nothing_logged_means_unknown_not_zero(flat):
    m = we.money(flat, MON)
    assert m["status"] == "ok" and m["advice"] is False and "not investment advice" in m["label"]
    assert m["this_month"] is None and "unknown" in m["say"]
    assert all(x["at_0_pct"] is None and x["at_assumed"] is None for x in m["projection"]["lines"])
    assert "monthly saving: unknown (nothing logged yet)" in m["projection"]["assumptions"]
    assert "annual return: not set in the inputs, so only the 0% line is shown" in m["projection"]["assumptions"]
    assert {x["id"]: x["verdict"] for x in m["experiments"]}["IE-tutor"] == "not started: no hours logged yet"
    pay = m["income_goals"][0]
    assert pay["growth_needed_pct_per_year"] is None and "unknown, because no income is logged" in pay["explain"]


def test_months_savings_rate_and_budget(example):
    m = we.money(example, MON, entries=LOG)
    sep, oct_ = m["months"]
    assert sep["month"] == "2026-09" and sep["budget"] == 5000 and sep["income"] == 8000 + 1500
    assert sep["savings_rate"] == round(2000 / 9500, 3) and sep["budget_left"] == 500
    assert oct_["budget"] == 6000                                  # no budget entry: the inputs' monthly budget
    assert oct_["income"] == 6000 + 3000 + 800 and oct_["budget_left"] == -500
    assert m["this_month"]["month"] == "2026-10"
    assert m["say"].startswith("This month: Rs 9,800 in, Rs 6,500 spent, Rs 1,000 saved, a savings rate of 10%.")


def test_experiments_are_scored_in_rupees_per_hour_only_after_their_weeks(example):
    m = we.money(example, MON, entries=LOG)
    by = {x["id"]: x for x in m["experiments"]}
    t = by["ie-tutoring"]
    assert t["hours"] == 10 and t["earned"] == 4500 and t["weeks"] == 6 and t["scored"]
    assert t["rupees_per_hour"] == 450 and "at or above its assumed Rs 400/h" in t["verdict"]
    f = by["ie-freelance"]
    assert not f["scored"] and f["verdict"].startswith("too early: 2 of 4 weeks") and f["rupees_per_hour"] == 400
    assert by["ie-internship"]["verdict"].startswith("not started")
    assert by["ie-internship"]["expected_from_inputs"] == {"inr_per_month": [10000, 30000], "probability": 0.3}
    assert "Best scored experiment: ie-tutoring at Rs 450 an hour." in m["say"]


def test_a_usd_reference_needs_an_exchange_rate_from_the_inputs(example):
    log = [E("2026-09-01", "experiment", 3000, hours=4, experiment="ie-freelance"),
           E("2026-10-01", "experiment", 1000, hours=6, experiment="ie-freelance")]
    f = {x["id"]: x for x in we.money(example, MON, entries=log)["experiments"]}["ie-freelance"]
    assert f["scored"] and f["rupees_per_hour"] == 400 and "below USD 12/h at the inputs' rate of 80 = Rs 960/h" in f["verdict"]
    no_fx = copy.deepcopy(example)
    no_fx["money"]["assumptions"]["usd_inr"] = None
    f2 = {x["id"]: x for x in we.money(no_fx, MON, entries=log)["experiments"]}["ie-freelance"]
    assert "no reference rate in the inputs" in f2["verdict"]


def test_an_experiment_only_in_the_log_is_still_scored(example):
    log = [E("2026-09-01", "experiment", 900, hours=3, experiment="ie-new")]
    x = {x["id"]: x for x in we.money(example, MON, entries=log)["experiments"]}["ie-new"]
    assert x["type"] == "logged only" and x["rupees_per_hour"] == 300 and x["scored"]


def test_the_projection_is_arithmetic_on_the_log_and_states_every_assumption(example):
    m = we.money(example, MON, entries=LOG)
    monthly = (2000 + 1000) / 2
    y1, y5, y10 = m["projection"]["lines"]
    assert y1["at_0_pct"] == monthly * 12 and y10["at_0_pct"] == monthly * 120
    i = 0.06 / 12
    assert y5["at_assumed"] == round(monthly * (((1 + i) ** 60 - 1) / i), 0)
    a = m["projection"]["assumptions"]
    assert a[0] == "monthly saving: Rs 1,500 = the average over 2 months with income or savings logged"
    assert a[1].startswith("annual return: 6% a year") and "not a forecast" in a[1]
    assert "no inflation, tax, fees" in a[2] and any("80 rupees per US dollar" in x for x in a)


def test_the_income_goal_shows_the_growth_it_needs_from_logged_income(example):
    g = we.money(example, MON, entries=LOG)["income_goals"][0]
    year = 9500 + 9800
    assert g["income_last_12_months"] == year
    yrs = round(wb.days_between(MON, "2035-06-30") / 365.25, 1)
    assert g["years_left"] == yrs and g["growth_needed_pct_per_year"] > 0
    assert g["explain"].startswith("From Rs 19,300 logged in the last 12 months to Rs 24,00,000 a year by 2035-06-30 needs")


def test_pure_and_tolerant(example):
    log = copy.deepcopy(LOG) + [{"kind": "income"}, "junk", E("2026-10-01", "lottery", 5), E("2026-10-01", "expense", "lots")]
    before_log, before_inp = copy.deepcopy(log), copy.deepcopy(example)
    a = we.money(example, MON, entries=log)
    assert a == we.money(copy.deepcopy(example), MON, entries=copy.deepcopy(log))
    assert log == before_log and example == before_inp
    assert we.run("money", example, MON, entries=[{"date": "x", "kind": "income"}])["status"] == "invalid_input"
    for line in [a["say"], a["label"], *a["projection"]["assumptions"], *(x["verdict"] for x in a["experiments"])]:
        assert wb.no_shame(line)
        assert "invest in" not in line.lower() and "you should buy" not in line.lower()
