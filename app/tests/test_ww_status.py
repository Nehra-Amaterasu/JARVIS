"""Status v2 (ww_status.py, routes_ww_status.py, data/ww_advice.json): the 4-week series that never pads, the
consistency number that never counts silence, the full rank list, Recent grouped by day, and advice that is
only ever a sourced line. All data is fictional and generated here."""
import json
import re

import pytest
from starlette.testclient import TestClient

from jarvis_app import germoney, wellwisher, ww_status
from jarvis_app.security import Guard
from jarvis_app.server import create_app
from jarvis_app.ww_base import add_days, no_shame

TODAY = "2026-11-10"
TOKEN = "t" * 32
WATER = {"id": "water", "name": "Glasses of water", "want": "more"}
SNACK = {"id": "snacks", "name": "Junk snacks", "want": "less"}
CLASS = {"id": "college", "name": "Went to class", "want": "yes"}


def log_of(counter, by_offset):
    """{offset days before TODAY: value} -> a Life log with that counter filled in."""
    return {add_days(TODAY, -o): {"counts": {counter: v}} for o, v in by_offset.items()}


# ------------------------------------------------------------------ the series
def test_series_has_four_weeks_and_keeps_only_those_with_data():
    log = log_of("water", {1: 4, 2: 6, 9: 3, 10: 5})            # this week and last week only
    s = ww_status.counter_series(log, [WATER], TODAY)[0]
    assert len(s["weeks"]) == 4
    assert [w["days_logged"] for w in s["weeks"]] == [0, 0, 2, 2]
    assert s["weeks_with_data"] == 2 and s["points"] == [4.0, 5.0] and s["enough_for_line"]
    assert s["weeks"][0]["mean"] is None and s["weeks"][1]["mean"] is None      # never a 0


def test_a_gap_week_is_left_out_not_drawn_as_zero():
    log = log_of("water", {1: 4, 2: 6, 17: 2})                  # week 3 back has nothing
    s = ww_status.counter_series(log, [WATER], TODAY)[0]
    assert [w["days_logged"] for w in s["weeks"]] == [0, 1, 0, 2]
    assert s["points"] == [2.0, 5.0] and 0 not in s["points"]


def test_one_week_of_data_is_not_a_line_and_no_data_is_empty():
    one = ww_status.counter_series(log_of("water", {0: 3, 3: 5}), [WATER], TODAY)[0]
    assert one["weeks_with_data"] == 1 and not one["enough_for_line"] and one["points"] == [4.0]
    none = ww_status.counter_series({}, [WATER], TODAY)[0]
    assert none["weeks_with_data"] == 0 and none["points"] == [] and none["first_logged"] is None


def test_a_zero_that_was_logged_is_data_and_a_missing_day_is_not():
    s = ww_status.counter_series(log_of("snacks", {0: 0, 1: 0}), [SNACK], TODAY)[0]
    assert s["points"] == [0.0] and s["weeks"][3]["days_logged"] == 2


def test_the_mean_is_per_logged_day_so_a_thin_week_compares_with_a_full_one():
    log = log_of("water", {i: 4 for i in range(7)} | {7: 4})    # 7 logged days, then 1 logged day, same level
    s = ww_status.counter_series(log, [WATER], TODAY)[0]
    assert s["points"] == [4.0, 4.0]


def test_junk_counts_are_ignored():
    log = {TODAY: {"counts": {"water": True}}, add_days(TODAY, -1): {"counts": {"water": "x"}}, add_days(TODAY, -2): {"counts": {"water": 3}}}
    s = ww_status.counter_series(log, [WATER], TODAY)[0]
    assert s["points"] == [3.0]


# ------------------------------------------------------------------ consistency
def test_a_yes_counter_counts_the_days_it_was_done_over_the_days_logged():
    log = log_of("college", {i: (1 if i % 2 == 0 else 0) for i in range(10)})
    c = ww_status.consistency(log, [CLASS], TODAY)
    r = c["counters"][0]
    assert (r["logged"], r["asked"], r["hit"]) == (10, 10, 5) and r["ratio"] == 0.5 and c["ratio"] == 0.5


def test_silence_is_not_a_miss():
    log = log_of("college", {0: 1, 5: 1, 10: 1, 15: 1, 20: 1, 25: 1, 26: 1})   # 7 logged days, all done, many gaps
    r = ww_status.consistency(log, [CLASS], TODAY)["counters"][0]
    assert (r["logged"], r["asked"], r["hit"], r["ratio"]) == (7, 7, 7, 1.0)


def test_under_a_week_of_judged_days_shows_no_ratio_and_says_how_many_are_needed():
    c = ww_status.consistency(log_of("college", {0: 1, 1: 1, 2: 0}), [CLASS], TODAY)
    r = c["counters"][0]
    assert r["asked"] == 3 and r["ratio"] is None and r["need"] == 4
    assert c["ratio"] is None and c["asked"] == 0


def test_a_less_counter_is_judged_against_the_line_of_the_days_before_it():
    # 10 days at 10 snacks, then today 8: the line is floor(median 10 * 0.9) = 9, so today is on the line;
    # the early days have no line yet (fewer than 3 prior days) and are not judged.
    log = log_of("snacks", {o: 10 for o in range(1, 11)} | {0: 8})
    r = ww_status.consistency(log, [SNACK], TODAY)["counters"][0]
    assert r["logged"] == 11
    judged_days_have_a_line = r["asked"]
    assert judged_days_have_a_line == 8                              # the first 3 days have fewer than 3 prior days
    assert r["hit"] == 1                                             # only today (8 <= 9); the 10s sit above their 9 line


def test_the_consistency_window_is_28_days_and_ignores_older_days():
    log = log_of("college", {o: 1 for o in range(0, 40)})
    r = ww_status.consistency(log, [CLASS], TODAY)["counters"][0]
    assert r["logged"] == 28 and r["asked"] == 28


# ------------------------------------------------------------------ rank
def test_rank_lists_every_requirement_of_the_next_rank_met_and_unmet():
    have = {"hours": 55, "nodes": 2, "proof": 5, "projects": 0, "certs": 0}
    r = ww_status.rank_requirements(have, "C")
    assert r["next"] == "B" and r["target"] == "B" and not r["top"]
    assert [x["req"] for x in r["requirements"]] == ["hours", "nodes", "proof", "projects"]      # all four, not only the unmet
    assert [x["met"] for x in r["requirements"]] == [False, False, False, False]
    assert r["of"] == 4 and r["met"] == 0
    r2 = ww_status.rank_requirements({"hours": 130, "nodes": 10, "proof": 15, "projects": 0, "certs": 0}, "C")
    assert [x["met"] for x in r2["requirements"]] == [True, True, True, False] and r2["met"] == 3


def test_rank_at_the_top_lists_the_top_rank_and_the_ladder_has_every_rank():
    r = ww_status.rank_requirements({"hours": 700, "nodes": 40, "proof": 90, "projects": 7, "certs": 4}, "S")
    assert r["top"] and r["next"] is None and r["target"] == "S" and r["met"] == r["of"] == 5
    assert [x["rank"] for x in r["ladder"]] == [n for n, _ in wellwisher.RANKS]
    assert ww_status.rank_requirements({}, "E")["requirements"][0]["req"] == "hours"             # E -> D needs hours first


# ------------------------------------------------------------------ recent and wins
def ev(d, kind, t=0, **kw):
    return {"date": d, "kind": kind, "t": t, **kw}


def test_recent_groups_by_day_newest_first_with_totals():
    events = [ev("2026-11-10", "contract", 2, title="Unit 2 problems", minutes=45, xp=30),
              ev("2026-11-10", "log", 1, note="reading", minutes=20, xp=10),
              ev("2026-11-08", "contract", 1, title="Older", minutes=30, xp=20)]
    days = ww_status.recent_days(events, TODAY)
    assert [d["date"] for d in days] == ["2026-11-10", "2026-11-08"]
    d0 = days[0]
    assert (d0["count"], d0["xp"], d0["minutes"]) == (2, 40, 65)
    assert [r["label"] for r in d0["rows"]] == ["Unit 2 problems", "reading"]              # newest event first


def test_recent_collapses_zero_xp_rows_into_one_count():
    events = [ev("2026-11-10", "contract", 5, title="Paid", minutes=30, xp=25)] + \
             [ev("2026-11-10", "quest", i, line="body", xp=0, minutes=5) for i in range(4)]
    d = ww_status.recent_days(events, TODAY)[0]
    assert len(d["rows"]) == 1 and d["zero_xp"] == {"count": 4, "minutes": 20, "kinds": ["quest"]}
    assert d["count"] == 5 and d["xp"] == 25


def test_recent_leaves_out_carried_over_and_game_xp_and_old_days():
    events = [ev("2026-11-10", "migrate", xp=0), ev("2026-11-10", "xp", xp=40, note="a game"),
              ev("2026-10-01", "contract", xp=10, title="Too old")]
    assert ww_status.recent_days(events, TODAY) == []


def test_recent_with_no_events_is_empty_and_caps_rows_per_day():
    assert ww_status.recent_days([], TODAY) == []
    many = [ev("2026-11-10", "contract", i, title=f"c{i}", xp=1) for i in range(12)]
    d = ww_status.recent_days(many, TODAY)[0]
    assert len(d["rows"]) == ww_status.ROWS_PER_DAY and d["more"] == 4 and d["count"] == 12


def test_wins_are_real_milestones_newest_first():
    events = [ev("2026-11-01", "ship", 1, note="Shipped a thing", xp=300, verified=True),
              ev("2026-11-05", "rankup", 2, line="body", track="push", xp=25),
              ev("2026-11-06", "node", 3, node="n.alpha", note="mastered", xp=50),
              ev("2026-11-07", "node", 4, node="n.beta", note="started", xp=0),
              ev("2026-11-09", "contract", 5, title="not a win", xp=10)]
    w = ww_status.wins(events)
    assert [x["kind"] for x in w] == ["node", "rankup", "ship"]
    assert w[0]["label"] == "n.alpha" and w[2]["link"] is True
    assert ww_status.wins([]) == []


# ------------------------------------------------------------------ advice
def test_every_shipped_line_has_a_full_source_and_a_limit_and_is_kind():
    adv = ww_status.load_advice()
    assert adv["dropped"] == [] and len(adv["lines"]) >= 10
    raw = json.loads(ww_status.ADVICE_FILE.read_text(encoding="utf-8"))
    assert len(adv["lines"]) == len(raw["lines"])
    for ln in adv["lines"]:
        s = ln["source"]
        assert s["author"] and s["work"] and isinstance(s["year"], int) and s["kind"] in raw["kinds"], ln["id"]
        assert ln["strength"] in raw["strengths"] and ln["limit"] and ln["strength_note"], ln["id"]
        assert no_shame(ln["text"]), ln["id"]
    assert len({ln["id"] for ln in adv["lines"]}) == len(adv["lines"])


def test_no_line_claims_more_than_its_source():
    """A group average, a theory and a philosophy must say so; no line may promise a result or use an absolute."""
    banned = re.compile(r"\b(proves?|proven|guarantees?|cures?|always|never fails|will work|will make you|everyone)\b", re.I)
    adv = ww_status.load_advice()
    for ln in adv["lines"]:
        assert not banned.search(ln["text"]), (ln["id"], banned.search(ln["text"]).group(0))
        if ln["strength"] == "philosophy":
            assert re.search(r"view|argu|not a finding|habit|prompt", ln["text"], re.I), ln["id"]
        if ln["strength"] in ("meta-analysis", "theory", "observational"):
            assert re.search(r"average|theory|model|association|study|review|pooled|describes|one |influential|worth a try", ln["text"], re.I), ln["id"]
        if ln["strength"] == "experiment":
            assert re.search(r"lab|one |experiment|study", ln["text"], re.I), ln["id"]


def test_a_line_without_a_complete_source_is_dropped(tmp_path):
    p = tmp_path / "a.json"
    good = {"id": "ok", "when": ["any"], "text": "Try a small start.", "strength": "theory", "limit": "A model.",
            "source": {"author": "A. Author", "work": "A work", "year": 2001, "kind": "book"}}
    bad_year = json.loads(json.dumps(good)) | {"id": "no-year"}
    bad_year["source"].pop("year")
    unkind = json.loads(json.dumps(good)) | {"id": "shame", "text": "You failed again."}
    no_limit = json.loads(json.dumps(good)) | {"id": "no-limit", "limit": ""}
    odd_strength = json.loads(json.dumps(good)) | {"id": "odd", "strength": "certain"}
    p.write_text(json.dumps({"strengths": {"theory": "an explanation"}, "lines": [good, bad_year, unkind, no_limit, odd_strength]}), encoding="utf-8")
    adv = ww_status.load_advice(p)
    assert [ln["id"] for ln in adv["lines"]] == ["ok"] and sorted(adv["dropped"]) == ["no-limit", "no-year", "odd", "shame"]
    assert ww_status.load_advice(tmp_path / "missing.json")["lines"] == []


def test_pick_advice_matches_signals_rotates_by_day_and_limits_philosophy():
    adv = ww_status.load_advice()
    low = ww_status.pick_advice(adv, ["counter_over"], TODAY)
    assert 1 <= len(low) <= 3 and all("counter_over" in ln["when"] for ln in low)
    assert sum(1 for ln in low if ln["strength"] == "philosophy") <= 1
    nxt = ww_status.pick_advice(adv, ["counter_over"], add_days(TODAY, 1))
    assert [ln["id"] for ln in low] != [ln["id"] for ln in nxt]
    assert ww_status.pick_advice(adv, ["consistency_low"], TODAY) == ww_status.pick_advice(adv, ["consistency_low"], TODAY)
    anyline = ww_status.pick_advice(adv, [], TODAY)
    assert anyline and all("any" in ln["when"] for ln in anyline)
    assert ww_status.pick_advice({"lines": []}, [], TODAY) == []


def test_signals_come_from_the_numbers():
    series = ww_status.counter_series({}, [WATER], TODAY)
    cons = ww_status.consistency({}, [WATER], TODAY)
    assert "no_history" in ww_status.signals(cons, series)
    stats = [{"id": "recall", "value": 0}, {"id": "focus", "value": 3}]
    assert ww_status.signals(cons, series, stats) == ["no_history", "recall_low"]
    low = ww_status.consistency(log_of("college", {i: (1 if i < 2 else 0) for i in range(10)}), [CLASS], TODAY)
    assert "consistency_low" in ww_status.signals(low, ww_status.counter_series({}, [CLASS], TODAY))


def test_status_v2_is_pure_and_names_the_source_of_every_advice_line():
    st = {"life": log_of("water", {0: 3, 8: 4}), "events": [ev("2026-11-10", "contract", title="x", xp=5, minutes=10)]}
    before = json.dumps(st, sort_keys=True)
    out = ww_status.status_v2(st, {"life": {"counters": [WATER]}, "source": "example"}, TODAY, {"hours": 0}, "E")
    assert json.dumps(st, sort_keys=True) == before
    assert out["series"][0]["weeks_with_data"] == 2 and out["rank"]["target"] == "D"
    assert out["recent"][0]["date"] == TODAY and out["source"] == "example"
    assert out["advice"] and all(a["source"]["author"] and a["source"]["year"] and a["limit"] for a in out["advice"])


# ------------------------------------------------------------------ the route
@pytest.fixture()
def client(tmp_path, monkeypatch):
    monkeypatch.setenv("JARVIS_ENGINE_INPUTS", str(tmp_path / "none.json"))
    app = create_app(Guard(8777, TOKEN, extra_hosts=["testserver"]), autostart_aankhen="off", features=["mission", "ww_status"])
    with TestClient(app) as c:
        c.headers.update({"X-Jarvis-Token": TOKEN})
        c.app.state.svc.kv = germoney.KVStore(tmp_path / "kv", tmp_path / "bk")        # never the real store
        c.app.state.svc.plan.kv = c.app.state.svc.kv
        yield c


def test_route_on_an_empty_store_says_so_in_every_part(client):
    r = client.get("/api/mission/status/v2", params={"today": TODAY})
    assert r.status_code == 200
    j = r.json()
    assert j["recent"] == [] and j["wins"] == []
    assert all(s["weeks_with_data"] == 0 and s["points"] == [] for s in j["series"])
    assert j["consistency"]["ratio"] is None and j["rank"]["rank"] == "E" and j["rank"]["target"] == "D"
    assert j["advice"] and j["source"] in ("example", "none", "private")


def test_route_reads_what_the_life_page_logged(client):
    plan = client.app.state.svc.plan
    st = plan.load(TODAY)
    st.setdefault("life", {}).update(log_of("water", {0: 5, 1: 3, 8: 4, 9: 2}))
    plan.save(st)
    j = client.get("/api/mission/status/v2", params={"today": TODAY}).json()
    water = next(s for s in j["series"] if s["id"] == "water")
    assert water["weeks_with_data"] == 2 and water["points"] == [3.0, 4.0]


def test_route_refuses_a_bad_date_and_the_get_writes_nothing(client):
    assert client.get("/api/mission/status/v2", params={"today": "tomorrow"}).status_code == 400
    client.get("/api/mission/status/v2", params={"today": TODAY})       # the first read creates the empty plan, as every Mission route does
    kv = client.app.state.svc.kv
    before = kv.get(germoney.PLAN_KEY)
    client.get("/api/mission/status/v2", params={"today": TODAY})
    assert kv.get(germoney.PLAN_KEY) == before
