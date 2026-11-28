"""Wave EW13 L2, the ladder (ww_pyq/ladder.py, R-76 and R-77 in routes_ww_pyq_ladder.py).

The pure functions are fed invented rows; the routes run on a Store under tmp_path with invented questions and evening
sheet files in the shape N01 writes, read through the ledger's own readers. Nothing reads the real data directory, the
network or a model.
"""
from __future__ import annotations

import json
import re
from types import SimpleNamespace

import pytest
from fastapi import FastAPI
from starlette.testclient import TestClient

from jarvis_app import routes_ww_pyq_ladder as R
from jarvis_app.security import Guard
from jarvis_app.server import create_app
from jarvis_app.ww_pyq import ladder
from jarvis_app.ww_pyq import store as store_mod
from jarvis_app.ww_pyq.next import MIN_ATTEMPTS
from jarvis_app.ww_pyq.store import Store
from test_pyq_prep import SUBJECTS, FakePlan, add_q, paper

FORBIDDEN = re.compile(r"important|likely|expected|probability|chance|forecast|predict|on track|will be asked", re.I)
L = "/api/mission/pyq/ladder"


def qs(*levels):
    return [{"id": f"q-{i}", "level": n} for i, n in enumerate(levels)]


def att(qid, got, mx=5, **kw):
    return {"question_id": qid, "got": got, "max": mx, **kw}


def row(rows, n):
    return next(r for r in rows if r["level"] == n)


# ------------------------------------------------------------------ the pure functions
def test_under_three_attempts_a_level_is_not_measured():
    assert MIN_ATTEMPTS == 3
    q = qs(1, 1)
    rows = ladder.rows_for_topic(q, [att("q-0", 5), att("q-1", 5)])
    assert row(rows, 1) == {"level": 1, "questions": 2, "attempts": 2, "distinct_questions": 2, "single_question": False,
                            "got": 10, "max": 10}
    assert ladder.state_of(row(rows, 1), 60) == "not measured"
    n, s = ladder.stands_on(rows, 60)
    assert n == 1 and "2 marked attempts of the 3" in s and "not measured" in s and not FORBIDDEN.search(s)


def test_passed_at_exactly_the_percent_and_not_a_hair_under():
    rows = ladder.rows_for_topic(qs(1, 2), [att("q-0", 3)] * 3 + [att("q-1", 1)])
    assert row(rows, 1)["got"] == 9 and row(rows, 1)["max"] == 15                    # 60%
    assert ladder.state_of(row(rows, 1), 60) == "passed" and ladder.state_of(row(rows, 1), 61) == "not passed"
    n, s = ladder.stands_on(rows, 60)
    assert n == 2 and "Level 1 is passed" in s
    n, s = ladder.stands_on(rows, 61)
    assert n == 1 and "9 of 15 over 3 attempts, 60%, under the 61%" in s


@pytest.mark.parametrize("got,mx,pct", [(0.6, 1, 60), (1.4, 2, 70), (0.7, 1, 70), (2.5, 5, 50), (1.1, 2, 55)])
def test_marks_sum_exactly_so_the_percent_itself_passes(got, mx, pct):
    rows = ladder.rows_for_topic(qs(1), [att("q-0", got, mx)] * 3)        # got / max is exactly pct each time
    assert ladder.state_of(row(rows, 1), pct) == "passed", (got, mx, pct, row(rows, 1))
    assert ladder.state_of(row(rows, 1), pct + 1) == "not passed"


def test_float_sums_that_fooled_the_compare_now_pass():
    assert 0.6 + 0.6 + 0.6 < 1.8 and 1.4 + 1.4 + 1.4 < 4.2       # the float edge the review found
    rows = ladder.rows_for_topic(qs(1, 2), [att("q-0", 0.6, 1)] * 3 + [att("q-1", 1.4, 2)] * 3)
    assert row(rows, 1)["got"] == 1.8 and ladder.state_of(row(rows, 1), 60) == "passed"
    assert row(rows, 2)["got"] == 4.2 and ladder.state_of(row(rows, 2), 70) == "passed"
    assert ladder.state_of(row(rows, 2), 71) == "not passed"


def test_a_mark_over_its_max_or_under_zero_is_no_attempt():
    rows = ladder.rows_for_topic(qs(1), [att("q-0", 6, 5), att("q-0", -1, 5), att("q-0", 3, 0), att("q-0", None),
                                         att("q-0", float("nan")), att("q-0", 5, 5)])
    assert (row(rows, 1)["attempts"], row(rows, 1)["got"], row(rows, 1)["max"]) == (1, 5, 5)


def test_attempts_on_one_question_of_two_do_not_pass_a_level_but_one_question_alone_can():
    two = ladder.rows_for_topic(qs(1, 1), [att("q-0", 5)] * 3)
    r = row(two, 1)
    assert (r["questions"], r["distinct_questions"], r["single_question"]) == (2, 1, False)
    assert ladder.state_of(r, 60) == "not measured"
    n, s = ladder.stands_on(two, 60)
    assert n == 1 and "all on one of its 2 questions" in s and not FORBIDDEN.search(s)
    spread = ladder.rows_for_topic(qs(1, 1), [att("q-0", 5)] * 2 + [att("q-1", 5)])
    assert row(spread, 1)["distinct_questions"] == 2 and ladder.state_of(row(spread, 1), 60) == "passed"
    one = ladder.rows_for_topic(qs(1), [att("q-0", 5)] * 3)
    assert row(one, 1)["single_question"] is True and ladder.state_of(row(one, 1), 60) == "passed"


def test_a_level_with_no_question_is_stepped_over_and_the_sentence_says_so():
    rows = ladder.rows_for_topic(qs(2, 4), [att("q-0", 5)] * 3)
    assert ladder.state_of(row(rows, 1), 60) == "no question" and ladder.state_of(row(rows, 3), 60) == "no question"
    n, s = ladder.stands_on(rows, 60)
    assert n == 4 and "Level 2 is passed" in s and "Levels 1 and 3 have no accepted question" in s and "stepped over" in s


def test_every_level_passed_stands_on_the_highest_and_top_caps_the_climb():
    q = qs(1, 2, 4)
    a = [att("q-0", 4)] * 3 + [att("q-1", 5)] * 3 + [att("q-2", 1)] * 3
    rows = ladder.rows_for_topic(q, a)
    assert ladder.stands_on(rows, 60)[0] == 4                                         # level 4: 3 of 15, not passed
    n, s = ladder.stands_on(rows, 60, top=3)
    assert n == 2 and "Every level with a question is passed (levels 1 and 2, at 60%)" in s
    rows = ladder.rows_for_topic(q, a[:6] + [att("q-2", 5)] * 3)
    n, s = ladder.stands_on(rows, 60)
    assert n == 4 and "you stand on the highest, level 4" in s and "Level 3 has no accepted question" in s


def test_no_level_on_file_stands_nowhere():
    n, s = ladder.stands_on(ladder.rows_for_topic(qs(None, None), [att("q-0", 5)] * 3), 60)
    assert n is None and "no ladder" in s
    item = ladder.topic_ladder({"key": "1|aliasing", "unit": 1, "topic": "aliasing"}, qs(None, 1), [att("q-0", 5)])
    assert item["unlabelled"] == {"questions": 1, "attempts": 1} and "1 question has no level yet" in item["sentence"]
    assert [x["state"] for x in item["levels"]] == ["not measured", "no question", "no question", "no question", "no question"]
    assert set(item) >= {"key", "unit", "topic", "stands_on", "top", "levels", "sentence"} and item["top"] == 5


def test_an_attempt_keeps_the_level_it_was_marked_at_and_one_without_takes_today_s():
    q = [{"id": "q-a", "level": 3}]                    # it was level 1 when two of these were marked; relabelled since
    a = [att("q-a", 5, level=1), att("q-a", 5, level=1), att("q-a", 2), att("q-a", 4, level=None), att("q-a", 1, mx=0)]
    rows = ladder.rows_for_topic(q, a)
    assert (row(rows, 1)["attempts"], row(rows, 1)["questions"]) == (2, 0)
    assert (row(rows, 3)["attempts"], row(rows, 3)["got"], row(rows, 3)["questions"]) == (1, 2.0, 1)
    assert sum(r["attempts"] for r in rows) == 3                         # the one marked with no level and the max 0 are out
    assert ladder.unlabelled(q, a) == {"questions": 0, "attempts": 1}
    assert ladder.state_of(row(rows, 1), 60) == "no question"            # its marks are kept in the row, not climbed on


def test_order_for_sheet_puts_his_level_first_then_below_then_above_unlabelled_last_and_is_stable():
    cands = [{"id": k, "level": n} for k, n in (("e", 5), ("a", 1), ("c1", 3), ("x", None), ("b", 2), ("c2", 3), ("d", 4),
                                                ("y", "3"))]
    assert [q["id"] for q in ladder.order_for_sheet(cands, 3)] == ["c1", "c2", "b", "a", "d", "e", "x", "y"]
    assert [q["id"] for q in ladder.order_for_sheet(cands, None)] == ["e", "a", "c1", "b", "c2", "d", "x", "y"]
    assert [q["id"] for q in ladder.order_for_sheet(cands, 1)] == ["a", "b", "c1", "c2", "d", "e", "x", "y"]
    assert ladder.order_for_sheet([], 2) == []


# ------------------------------------------------------------------ the routes
@pytest.fixture()
def env(tmp_path, monkeypatch):
    st = Store(tmp_path / "pyq")
    monkeypatch.setattr(store_mod, "default_store", lambda: st)
    app = FastAPI()
    R.register(app, SimpleNamespace(plan=FakePlan()), SimpleNamespace(publish=lambda *a, **k: None))
    with TestClient(app) as c:
        yield SimpleNamespace(c=c, st=st)


def envelope(j):
    assert j["state"] in ("live", "waiting", "planned", "fault") and j["reason"] and j["source"]
    assert not FORBIDDEN.search(json.dumps(j)), json.dumps(j)


def accepted(st, pid, text, level, topic="aliasing", unit=1, source="rule"):
    qid = add_q(st, pid, text)
    st.update_question(qid, {"status": "accepted", "unit": unit, "topic": topic})
    if level is not None:
        st.update_question(qid, {"level": level, "level_source": source}, "rule")
    return qid


def sheet(st, sid, day, items, marks):
    d = st.root / "sheets"
    d.mkdir(exist_ok=True)
    (d / f"{sid}.json").write_text(json.dumps({"id": sid, "subject": "signals", "date": day, "items": items,
                                               "marks": marks}), encoding="utf-8")


def test_the_docstring_lists_every_mounted_route():
    app = create_app(Guard(8777, "t" * 32, extra_hosts=["testserver"]), autostart_aankhen="off", features=["ww_pyq_ladder"])
    mounted = {(m, r.path) for r in app.routes if getattr(r, "path", "").startswith(L)
               for m in (getattr(r, "methods", None) or ()) if m != "HEAD"}
    rows = set(re.findall(r"^\s{2,}(GET|POST|PUT|PATCH|DELETE)\s+(/api/[^\s?]+)", R.__doc__, re.M))
    assert mounted == rows and len(rows) == 3


def test_r76_waits_without_a_tagged_accepted_question_then_reads_the_ledger_s_marks(env):
    st = env.st
    j = env.c.get(L, params={"subject": "signals"}).json()
    envelope(j)
    assert j["state"] == "waiting" and "accept and tag" in j["reason"]
    pid = paper(st, "Signals paper", "signals")
    q1 = accepted(st, pid, "Define aliasing.", 1)
    q2 = accepted(st, pid, "Explain aliasing in a sampled tone.", 2)
    accepted(st, pid, "Write short notes on aliasing.", None)
    sol = paper(st, "A solution sheet", "signals")
    st.update_paper(sol, {"role": "solution"})
    s_id = add_q(st, sol, "Define aliasing as the overlap of shifted spectra.")
    st.update_question(s_id, {"status": "accepted", "unit": 1, "topic": "aliasing", "level": 2})
    item = {"unit": 1, "topic": "aliasing", "marks": 5}
    for i, (g1, g2) in enumerate(((4, 1), (3, 2), (5, 3))):
        sheet(st, f"2026-11-2{i}-s", f"2026-11-2{i}", [{**item, "question_id": q1}, {**item, "question_id": q2}],
              [{"question_id": q1, "got": g1, "max": 5, "at": f"2026-11-2{i}T20:00"},
               {"question_id": q2, "got": g2, "max": 5, "at": f"2026-11-2{i}T20:10"}])
    j = env.c.get(L, params={"subject": "signals"}).json()
    envelope(j)
    assert j["state"] == "live" and j["pass_percent"] == 60 and j["min_attempts"] == 3 and j["top"] == 5
    it = {i["key"]: i for i in j["items"]}
    a = it["1|aliasing"]
    assert a["stands_on"] == 2 and a["levels"][0] == {"level": 1, "questions": 1, "attempts": 3, "distinct_questions": 1,
                                                      "single_question": True, "got": 12, "max": 15, "state": "passed"}
    assert a["levels"][1]["state"] == "not passed" and a["levels"][1]["questions"] == 1           # the solution is out
    assert a["unlabelled"]["questions"] == 1 and "1 question has no level yet" in a["sentence"]
    assert it["1|sampling theorem"]["stands_on"] is None
    env.c.put(f"{L}/settings", json={"pass_percent": 85})
    a = {i["key"]: i for i in env.c.get(L, params={"subject": "signals"}).json()["items"]}["1|aliasing"]
    assert a["stands_on"] == 1 and a["levels"][0]["state"] == "not passed"                       # 12 of 15 is 80%
    assert env.c.get(L).status_code == 400 and env.c.get(L, params={"subject": "nope"}).status_code == 404


def test_r76_reads_each_paper_s_questions_once(env, monkeypatch):
    st = env.st
    for k in range(4):
        pid = paper(st, f"Signals paper {k}", "signals")
        for i in range(5):
            accepted(st, pid, f"Define aliasing, item {k}-{i}.", 1 + i % 3)
    other = paper(st, "Circuits paper", "circuits")
    add_q(st, other, "Find the Thevenin equivalent.")
    calls = []
    real = Store._questions_of
    monkeypatch.setattr(Store, "_questions_of", lambda self, pid: calls.append(pid) or real(self, pid))
    j = env.c.get(L, params={"subject": "signals"}).json()
    assert j["state"] == "live"
    assert len(calls) <= 4 and len(set(calls)) == len(calls), calls        # the subject's 4 papers, each once


def test_r77_bounds_and_a_damaged_file_reads_as_the_default(env):
    j = env.c.get(f"{L}/settings").json()
    envelope(j)
    assert j["pass_percent"] == 60 and j["settings"] == {"pass_percent": 60}
    for bad in ({"pass_percent": 49}, {"pass_percent": 101}, {"pass_percent": 60.5}, {"pass_percent": 60.0},
                {"pass_percent": "60"}, {"pass_percent": True}, {"pass_percent": None}, {}, {"pass_percent": 60, "x": 1}):
        assert env.c.put(f"{L}/settings", json=bad).status_code == 400, bad
    for ok in (50, 100, 75):
        r = env.c.put(f"{L}/settings", json={"pass_percent": ok})
        assert r.status_code == 200 and r.json()["pass_percent"] == ok
    assert ladder.load_settings(env.st) == {"pass_percent": 75}
    (env.st.root / ladder.SETTINGS_FILE).write_text("{not json", encoding="utf-8")
    assert env.c.get(f"{L}/settings").json()["pass_percent"] == 60
    (env.st.root / ladder.SETTINGS_FILE).write_text(json.dumps({"pass_percent": 20}), encoding="utf-8")
    assert ladder.load_settings(env.st)["pass_percent"] == 60


def test_the_plan_not_up_is_503(tmp_path, monkeypatch):
    st = Store(tmp_path / "pyq")
    monkeypatch.setattr(store_mod, "default_store", lambda: st)
    app = FastAPI()
    R.register(app, SimpleNamespace(), SimpleNamespace(publish=lambda *a, **k: None))
    with TestClient(app) as c:
        assert c.get(L, params={"subject": "signals"}).status_code == 503
    assert SUBJECTS[0]["id"] == "signals"
