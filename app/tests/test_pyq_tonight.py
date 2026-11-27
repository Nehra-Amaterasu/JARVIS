"""The evening sheet (ww_pyq/tonight.py, routes R-55 to R-59 in routes_ww_pyq_tonight.py) and its clock.

Every subject, paper and question here is invented. Each test gets its own pyq store and plan under tmp_path, its date
sheet through JARVIS_ENGINE_INPUTS, and the reminder service on a scratch file with a clock the test sets; nothing
reads the real data directory, the network or a model.
"""
import json
import re
import shutil
from datetime import date, datetime, timedelta
from pathlib import Path
from types import SimpleNamespace

import pytest
from fastapi import FastAPI
from starlette.testclient import TestClient

from jarvis_app import germoney as g
from jarvis_app import routes_ww_pyq_tonight as R
from jarvis_app.reminders import ReminderScheduler, ReminderStore
from jarvis_app.security import Guard
from jarvis_app.server import create_app
from jarvis_app.ww_pyq import schema, tonight
from jarvis_app.ww_pyq import store as store_mod
from jarvis_app.ww_pyq.store import Store

TOKEN = "t" * 32
B = "/api/mission/pyq"
T = f"{B}/tonight"
FIX = Path(__file__).resolve().parents[1] / "ui" / "src" / "__tests__" / "fixtures" / "mission-bank"
UNITS = [{"n": 1, "title": "Sampling", "topics": ["sampling theorem", "aliasing"], "exam_weight": "high"},
         {"n": 2, "title": "Circuits", "topics": ["time constant"], "exam_weight": "med"},
         {"n": 3, "title": "Filters", "topics": ["low pass filter"], "exam_weight": "low"}]
ACADEMICS = {"semester": None, "plan": {}, "calendar": {}, "rescue": None, "unresolved": [],
             "subjects": [{"id": "signals", "name": "Signals", "kind": "current", "question_bank": [], "units": UNITS},
                          {"id": "maths", "name": "Maths", "kind": "current", "question_bank": [], "units": []}]}
BANNED = ("important", "likely", "expected", "will be asked", "probability", "chance", "predict")
TODAY = date.today()
IN4 = (TODAY + timedelta(days=4)).isoformat()


def strings(obj):
    if isinstance(obj, str):
        yield obj
    elif isinstance(obj, dict):
        for v in obj.values():
            yield from strings(v)
    elif isinstance(obj, list):
        for v in obj:
            yield from strings(v)


def envelope(j):
    assert j["state"] in schema.STATES and isinstance(j["reason"], str) and j["reason"] and j["source"]
    for text in strings(j):
        assert not any(w in text.lower() for w in BANNED), text


def write_exams(tmp_path, exams):
    (tmp_path / "inputs.json").write_text(json.dumps({"exams": exams}), encoding="utf-8")


def bank(st, papers=4):
    """Four invented papers: each sets 'sampling theorem' twice (5 marks), 'aliasing', 'time constant' and 'low pass
    filter' once (5 marks), so every topic has at least 4 accepted questions and the counted order has four topics."""
    plan = [(1, "sampling theorem"), (1, "sampling theorem"), (1, "aliasing"), (2, "time constant"), (3, "low pass filter")]
    for i in range(papers):
        pid = st.add_paper({"title": f"Invented paper {i}", "subject": "signals", "year": 2020 + i, "sha256": f"{i:x}" * 64,
                            "total_marks": 25})
        ids = st.add_questions(pid, [{"text": f"Explain invented idea {i}-{j} about {t}.", "text_status": "verified",
                                      "marks": 5, "section": "A", "type": "short"} for j, (_, t) in enumerate(plan)])
        for qid, (u, t) in zip(ids, plan):
            st.update_question(qid, {"status": "accepted", "unit": u, "topic": t})


def make_plan(tmp_path):
    bdir = tmp_path / "bankfiles"
    bdir.mkdir(exist_ok=True)
    for n in g.BANK_FILES:
        shutil.copy(FIX / n, bdir / n)
    loaded = g.load_bank(bdir)
    return g.Plan(g.KVStore(tmp_path / "kv", tmp_path / "bk"), bank_loader=lambda: loaded,
                  academics_loader=lambda: json.loads(json.dumps(ACADEMICS)),
                  apps=g.Applications(calendar=tmp_path / "no-calendar.json", store=tmp_path / "apps.json"))


@pytest.fixture()
def env(tmp_path, monkeypatch):
    disk = tmp_path / "disk-bank"
    disk.mkdir()
    monkeypatch.setenv("WW_BANK_DIR", str(disk))
    st = Store(tmp_path / "pyq")
    monkeypatch.setattr(store_mod, "default_store", lambda: st)
    write_exams(tmp_path, [{"id": "cie-sig", "subject": "signals", "title": "Signals mid", "date": IN4, "kind": "cie", "max": 20}])
    monkeypatch.setenv("JARVIS_ENGINE_INPUTS", str(tmp_path / "inputs.json"))
    plan = make_plan(tmp_path)
    app = create_app(Guard(8777, TOKEN, extra_hosts=["testserver"]), autostart_aankhen="off",
                     features=["ww_pyq_tonight", "ww_pyq_patterns"])
    app.state.svc.plan = plan
    with TestClient(app) as c:
        c.headers.update({"X-Jarvis-Token": TOKEN})
        yield c, st, plan, tmp_path


def on(c, **kw):
    r = c.put(f"{T}/settings", json={"on": True, **kw})
    assert r.status_code == 200, r.text
    return r.json()


def sheet_files(st):
    return sorted(p.name for p in (Path(st.root) / "sheets").glob("*")) if (Path(st.root) / "sheets").exists() else []


# ------------------------------------------------------------------ the route table
def test_every_route_is_in_the_docstring_and_no_other(env):
    c, st, plan, _ = env
    doc = R.__doc__
    for rid in ("R-55", "R-56", "R-57", "R-58", "R-59"):
        assert rid in doc
    rows = re.findall(r"^\s{2,}(GET|POST|PUT|PATCH|DELETE)\s+(/api/\S+)", doc, re.M)
    assert len(rows) == 5
    defined = {(m, r.path) for r in c.app.routes for m in getattr(r, "methods", ()) if r.path.startswith(T)}
    assert {x for x in defined if x[0] != "HEAD"} == {(m, p) for m, p in rows}
    assert c.get(T, headers={"X-Jarvis-Token": "wrong"}).status_code in (401, 403)


# ------------------------------------------------------------------ R-56 settings
def test_settings_default_off_and_refuse_values_out_of_range(env):
    c, st, plan, _ = env
    j = c.get(T).json()
    assert j["settings"] == {"on": False, "hour": "19:00", "count": 6, "horizon_days": 21}
    for bad in ({"hour": "7pm"}, {"hour": "24:00"}, {"count": 2}, {"count": 13}, {"count": True}, {"count": 6.5},
                {"horizon_days": 0}, {"horizon_days": 61}, {"on": "yes"}, {"colour": "red"}, {}):
        assert c.put(f"{T}/settings", json=bad).status_code == 400, bad
    j = on(c, hour="20:30", count=4, horizon_days=10)
    envelope(j)
    assert j["state"] == "live" and j["settings"] == {"on": True, "hour": "20:30", "count": 4, "horizon_days": 10}
    j = c.put(f"{T}/settings", json={"on": False}).json()
    assert j["state"] == "planned" and j["settings"]["hour"] == "20:30"


# ------------------------------------------------------------------ R-55 states
def test_off_is_planned_and_builds_nothing(env):
    c, st, plan, _ = env
    bank(st)
    j = c.get(T).json()
    envelope(j)
    assert j["state"] == "planned" and j["sheet"] is None and j["awaiting_marks"] == []
    assert j["next_papers"] == [{"subject": "signals", "title": "Signals mid", "date": IN4, "days_left": 4}]
    assert sheet_files(st) == []


def test_waiting_says_why_in_words(env):
    c, st, plan, tmp = env
    on(c)
    j = c.get(T).json()
    envelope(j)
    assert (j["state"], j["reason"]) == ("waiting", "No accepted question for Signals yet.")
    write_exams(tmp, [{"id": "far", "subject": "signals", "title": "Signals end", "date": (TODAY + timedelta(days=40)).isoformat(),
                       "kind": "end_sem", "max": 60}])
    j = c.get(T).json()
    assert (j["state"], j["reason"], j["next_papers"]) == ("waiting", "No paper on the date sheet in the next 21 days.", [])
    b = c.post(f"{T}/build", json={}).json()
    envelope(b)
    assert b["state"] == "waiting" and b["sheet"] is None and sheet_files(st) == []
    bank(st)
    on(c, horizon_days=45)
    j = c.get(T).json()
    assert j["state"] == "live" and j["sheet"] is None and "built at 19:00" in j["reason"]


# ------------------------------------------------------------------ R-57 build
def test_the_sheet_follows_the_counted_order_and_prints_its_terms(env):
    c, st, plan, _ = env
    bank(st)
    on(c)
    j = c.post(f"{T}/build", json={}).json()
    envelope(j)
    sheet = j["sheet"]
    assert j["state"] == "live" and sheet["id"] == f"{TODAY.isoformat()}-signals" and sheet["subject"] == "signals"
    order = c.get(f"{B}/practise-next", params={"subject": "signals", "gap_minutes": 1440}).json()["items"]
    assert [it["topic_key"] for it in sheet["items"]] == [p["key"] for p in order][:len(sheet["items"])]
    assert len(sheet["items"]) == 4 and len({it["topic_key"] for it in sheet["items"]}) == 4       # one question a topic
    by = {p["key"]: p for p in order}
    for n, it in enumerate(sheet["items"], 1):
        assert it["n"] == n and it["marks"] == 5 and it["text"].startswith("Explain invented idea") and it["crop"] is None
        t = by[it["topic_key"]]["terms"]
        assert it["why"] == {"days_left": 4, "marks_weight": t["marks_weight"], "share": t["seen_share"],
                             "proficiency": t["proficiency"], "syllabus_weight": t["syllabus_weight"]}
        assert it["question_id"] in by[it["topic_key"]]["question_ids"]
    assert j["reason"] == "Tonight's sheet: 4 questions, Signals, paper in 4 days. 4 topics had a question to give."
    # the file holds the shared shape and nothing else (the ledger reads it)
    raw = json.loads((Path(st.root) / "sheets" / f"{sheet['id']}.json").read_text(encoding="utf-8"))
    assert set(raw) == {"id", "date", "subject", "built_at", "items", "marks"} and raw["marks"] == []
    assert all(set(it) == {"n", "question_id", "marks", "unit", "topic", "topic_key"} for it in raw["items"])
    assert sheet_files(st) == [f"{sheet['id']}.json"]
    got = c.get(T).json()
    assert got["state"] == "live" and got["sheet"]["id"] == sheet["id"]


def test_the_same_day_and_subject_give_the_same_sheet(env):
    c, st, plan, _ = env
    bank(st)
    a = c.post(f"{T}/build", json={"subject": "signals"}).json()["sheet"]
    b = c.post(f"{T}/build", json={"subject": "Signals", "date": TODAY.isoformat()}).json()["sheet"]
    assert a == b
    (Path(st.root) / "sheets" / f"{a['id']}.json").unlink()
    (Path(st.root) / "tonight" / "why" / f"{a['id']}.json").unlink()
    again = c.post(f"{T}/build", json={"subject": "signals"}).json()["sheet"]
    assert [it["question_id"] for it in again["items"]] == [it["question_id"] for it in a["items"]]
    assert [it["why"] for it in again["items"]] == [it["why"] for it in a["items"]]
    other = c.post(f"{T}/build", json={"subject": "signals", "date": (TODAY + timedelta(days=1)).isoformat()}).json()["sheet"]
    assert other["id"] != a["id"]


def test_no_question_repeats_from_the_last_three_sheets(env):
    c, st, plan, _ = env
    bank(st)                                        # 'aliasing' etc. have 4 questions each: sheets 1 to 4 can all differ
    sheets = []
    for k in range(5):
        day = (TODAY + timedelta(days=k - 4)).isoformat()
        j = c.post(f"{T}/build", json={"subject": "signals", "date": day}).json()
        sheets.append(j)
    for k in range(5):
        assert sheets[k]["state"] == "live", sheets[k]
        mine = {it["question_id"] for it in sheets[k]["sheet"]["items"]}
        for prev in sheets[max(0, k - 3):k]:
            assert not mine & {it["question_id"] for it in prev["sheet"]["items"]}
    # 'aliasing' has 4 questions and sheets 1 to 4 took all of them; on the fifth only the first sheet's is free again
    alias = [next(it["question_id"] for it in s["sheet"]["items"] if it["topic"] == "aliasing") for s in sheets]
    assert len(set(alias[:4])) == 4 and alias[4] == alias[0]


# ------------------------------------------------------------------ R-58 marks
def test_marks_are_checked_kept_and_a_second_post_replaces_the_first(env):
    c, st, plan, _ = env
    bank(st)
    sheet = c.post(f"{T}/build", json={}).json()["sheet"]
    sid, q1, q2 = sheet["id"], sheet["items"][0]["question_id"], sheet["items"][1]["question_id"]
    for bad in ({"items": [{"question_id": q1, "got": 6}]}, {"items": [{"question_id": q1, "got": -1}]},
                {"items": [{"question_id": "q-notonsheet", "got": 1}]}, {"items": [{"question_id": q1, "got": True}]},
                {"items": [{"question_id": q1, "got": 2}, {"question_id": q1, "got": 3}]}, {"items": []},
                {"items": [{"question_id": q1, "got": 2, "minutes": 9999}]}, {"items": [{"question_id": q1, "got": 2, "grade": "A"}]}):
        assert c.post(f"{T}/{sid}/marks", json=bad).status_code == 400, bad
    assert tonight.load_sheet(st, sid)["marks"] == [] and not (plan.load().get("paper_marks") or {}).get("signals")
    j = c.post(f"{T}/{sid}/marks", json={"items": [{"question_id": q1, "got": 2, "minutes": 12}, {"question_id": q2, "got": 5}]}).json()
    envelope(j)
    assert j["reason"] == "Saved marks for 2 questions: 7 of 10. 2 questions are still unmarked." and j["marked_by"] == "you"
    j = c.post(f"{T}/{sid}/marks", json={"items": [{"question_id": q1, "got": 4}]}).json()
    kept = tonight.load_sheet(st, sid)["marks"]
    assert [(m["question_id"], m["got"], m["max"], m["minutes"]) for m in kept] == [(q1, 4, 5, None), (q2, 5, 5, None)]
    assert set(kept[0]) == {"question_id", "got", "max", "minutes", "at"}
    pm = plan.load()["paper_marks"]["signals"]
    rows = [e for lst in pm.values() for e in lst]
    assert sorted((e["q"], e["got"]) for e in rows) == sorted([(q1, 4), (q2, 5)])
    assert all(e["origin"] == "sheet" and e["sheet"] == sid and e["max"] == 5 for e in rows)
    assert pm[sheet["items"][0]["topic_key"]][-1]["q"] == q1


def test_marks_move_the_counted_order(env):
    c, st, plan, _ = env
    bank(st)
    sheet = c.post(f"{T}/build", json={}).json()["sheet"]
    first = sheet["items"][0]
    before = [p["key"] for p in c.get(f"{B}/practise-next", params={"subject": "signals", "gap_minutes": 1440}).json()["items"]]
    assert before[0] == first["topic_key"]
    # four marks he typed on that topic earlier (R-27's place); the sheet's mark is the fifth, so proficiency is measured
    with plan._lock:
        s = plan.load()
        s.setdefault("paper_marks", {}).setdefault("signals", {})[first["topic_key"]] = [
            {"date": TODAY.isoformat(), "got": 5, "max": 5, "q": "q-earlier"} for _ in range(4)]
        plan.save(s)
    j = c.post(f"{T}/{sheet['id']}/marks", json={"items": [{"question_id": first["question_id"], "got": 5}]}).json()
    assert j["proficiency"][first["topic_key"]] > 0.9
    after = [p["key"] for p in c.get(f"{B}/practise-next", params={"subject": "signals", "gap_minutes": 1440}).json()["items"]]
    assert after[0] != first["topic_key"] and after.index(first["topic_key"]) > 0
    nxt = c.post(f"{T}/build", json={"date": (TODAY + timedelta(days=1)).isoformat()}).json()["sheet"]
    assert nxt["items"][0]["topic_key"] == after[0]


def test_earlier_sheets_without_all_marks_are_awaiting(env):
    c, st, plan, _ = env
    bank(st)
    on(c)
    old = c.post(f"{T}/build", json={"date": (TODAY - timedelta(days=1)).isoformat()}).json()["sheet"]
    j = c.get(T).json()
    assert j["awaiting_marks"] == [{"id": old["id"], "date": old["date"], "subject": "signals", "unmarked": 4}]
    c.post(f"{T}/{old['id']}/marks", json={"items": [{"question_id": it["question_id"], "got": 1} for it in old["items"]]})
    assert c.get(T).json()["awaiting_marks"] == []


# ------------------------------------------------------------------ R-59 print
def test_the_print_is_a4_html_with_the_words_escaped(env):
    c, st, plan, _ = env
    bank(st)
    sheet = c.post(f"{T}/build", json={}).json()["sheet"]
    st.update_question(sheet["items"][0]["question_id"], {"text": "<script>alert(1)</script> invented"})
    r = c.get(f"{T}/{sheet['id']}/print")
    assert r.status_code == 200 and r.headers["content-type"].startswith("text/html")
    html = r.text
    assert "size: A4" in html and "<script>" not in html and "&lt;script&gt;" in html
    assert f"<footer>Sheet {sheet['id']}" in html and "Seed" not in html
    assert html.count("<li value=") == len(sheet["items"])


# ------------------------------------------------------------------ hostile ids
@pytest.mark.parametrize("sid", ["..%2F..%2Fsecrets", "a" * 300, "2026-13-45-signals", "2026-11-27-Signals", "2026-11-27-../x",
                                 "2026-11-27-" + "s" * 60, "g-000000000000"])
def test_hostile_sheet_ids_are_404_and_write_nothing(env, sid):
    c, st, plan, _ = env
    bank(st)
    assert c.post(f"{T}/{sid}/marks", json={"items": [{"question_id": "q-x", "got": 1}]}).status_code in (404, 405)
    assert c.get(f"{T}/{sid}/print").status_code in (404, 405)
    assert sheet_files(st) == [] and not (plan.load().get("paper_marks") or {})


def test_hostile_build_bodies_are_refused_and_write_nothing(env):
    c, st, plan, _ = env
    bank(st)
    assert c.post(f"{T}/build", json={"subject": "../../etc"}).status_code == 404
    assert c.post(f"{T}/build", json={"subject": "x" * 5000}).status_code == 404
    assert c.post(f"{T}/build", json={"date": "2026-02-30"}).status_code == 400
    assert c.post(f"{T}/build", json={"date": "../2026-11-27"}).status_code == 400
    assert c.post(f"{T}/build", json={"subject": 7}).status_code == 400
    assert c.post(f"{T}/build", json={"seed": 1}).status_code == 400
    assert sheet_files(st) == []


# ------------------------------------------------------------------ the clock
class Bus:
    def __init__(self):
        self.events = []

    def publish(self, *a, **k):
        self.events.append((a, k))
        return {"a": a}


@pytest.fixture()
def clock_env(tmp_path, monkeypatch):
    """The routes on a bare app with the app's real reminder store and scheduler (scratch file, a clock the test moves)."""
    disk = tmp_path / "disk-bank"
    disk.mkdir()
    monkeypatch.setenv("WW_BANK_DIR", str(disk))
    st = Store(tmp_path / "pyq")
    monkeypatch.setattr(store_mod, "default_store", lambda: st)
    write_exams(tmp_path, [{"id": "cie-sig", "subject": "signals", "title": "Signals mid", "date": IN4, "kind": "cie", "max": 20}])
    monkeypatch.setenv("JARVIS_ENGINE_INPUTS", str(tmp_path / "inputs.json"))
    now = [datetime.combine(TODAY, datetime.min.time()).replace(hour=12).timestamp()]
    rs = ReminderStore(path=tmp_path / "reminders.json", clock=lambda: now[0])
    bus = Bus()
    sched = ReminderScheduler(rs, bus, clock=lambda: now[0])
    svc = SimpleNamespace(plan=make_plan(tmp_path), reminders=rs, reminder_scheduler=sched)
    app = FastAPI()
    R.register(app, svc, bus)
    bank(st)

    def at(day_offset, hh, mm=0):
        now[0] = datetime.combine(TODAY + timedelta(days=day_offset), datetime.min.time()).replace(hour=hh, minute=mm).timestamp()
        sched.tick()
        return [r for r in rs.pending() + rs.recent(within_s=10 ** 7) if r.get("origin") == "tonight"]

    return st, rs, sched, at


def tonight_reminders(rs):
    seen = {}
    for r in rs.pending() + rs.recent(within_s=10 ** 7):
        if r.get("origin") == "tonight":
            seen[r["id"]] = r
    return list(seen.values())


def test_off_the_clock_builds_nothing_and_raises_no_reminder(clock_env):
    st, rs, sched, at = clock_env
    at(0, 19, 30)
    at(0, 23, 59)
    assert tonight_reminders(rs) == [] and sheet_files(st) == []
    assert not (Path(st.root) / "tonight" / "clock.json").exists()


def test_the_clock_raises_one_reminder_a_day_at_most(clock_env):
    st, rs, sched, at = clock_env
    tonight.save_settings(st, {"on": True, "hour": "19:00", "count": 3})
    at(0, 18, 59)
    assert tonight_reminders(rs) == [] and sheet_files(st) == []
    at(0, 19, 0)
    rem = tonight_reminders(rs)
    assert len(rem) == 1 and rem[0]["text"] == "Tonight's sheet: 3 questions, Signals, paper in 4 days"
    assert sheet_files(st) == [f"{TODAY.isoformat()}-signals.json"]
    for hh, mm in ((19, 1), (20, 0), (23, 59)):
        at(0, hh, mm)
    tonight.save_settings(st, {"count": 4})        # a change after the day's sheet neither rebuilds nor reminds again
    at(0, 22, 0)
    assert len(tonight_reminders(rs)) == 1 and len(sheet_files(st)) == 1
    at(1, 19, 5)                                   # the next day: its own sheet and its own one reminder
    texts = sorted(r["text"] for r in tonight_reminders(rs))
    assert texts == ["Tonight's sheet: 3 questions, Signals, paper in 4 days", "Tonight's sheet: 4 questions, Signals, paper in 3 days"]
    assert len(sheet_files(st)) == 2


def test_the_clock_with_no_paper_ahead_raises_nothing(clock_env, tmp_path):
    st, rs, sched, at = clock_env
    write_exams(tmp_path, [])
    tonight.save_settings(st, {"on": True})
    at(0, 19, 30)
    assert tonight_reminders(rs) == [] and sheet_files(st) == []


def test_clock_step_is_pure_on_its_arguments(tmp_path):
    st = Store(tmp_path / "pyq")
    calls = []
    built = {"sheet": {"id": "2026-11-27-signals", "subject": "signals", "items": [{}] * 6}, "subject_name": "Signals", "days_left": 1}
    noon, evening = datetime(2026, 11, 27, 12, 0), datetime(2026, 11, 27, 19, 0)
    assert tonight.clock_step(st, evening, lambda d: built, calls.append) is None           # off
    tonight.save_settings(st, {"on": True})
    assert tonight.clock_step(st, noon, lambda d: built, calls.append) is None
    out = tonight.clock_step(st, evening, lambda d: built, calls.append)
    assert out["reminded"] and calls == ["Tonight's sheet: 6 questions, Signals, paper in 1 day"]
    assert tonight.clock_step(st, evening.replace(hour=22), lambda d: built, calls.append) is None and len(calls) == 1
    assert tonight.reminder_text(1, "Maths", 0) == "Tonight's sheet: 1 question, Maths, paper today"


# ------------------------------------------------------------------ review of 27 Nov: the clock at its edges
def test_the_clock_after_the_hour_and_across_sleep_and_midnight(clock_env):
    st, rs, sched, at = clock_env
    tonight.save_settings(st, {"on": True, "hour": "19:00", "count": 3})
    assert len(at(0, 20, 0)) == 1                  # the app starts an hour after the hour: tonight's sheet still comes
    assert len(at(0, 23, 59)) == 1 and len(at(1, 0, 0)) == 1   # midnight between two ticks: the new day waits for its hour
    assert len(at(1, 8, 0)) == 1                   # the next morning: nothing new
    assert len(at(3, 21, 0)) == 2                  # the laptop slept from day 1 to day 3: one sheet for day 3, none made up
    assert sorted(sheet_files(st)) == [f"{TODAY.isoformat()}-signals.json", f"{(TODAY + timedelta(days=3)).isoformat()}-signals.json"]


def test_the_hour_moved_and_the_switch_flipped_while_running(clock_env):
    st, rs, sched, at = clock_env
    tonight.save_settings(st, {"on": True, "hour": "21:00", "count": 3})
    assert at(0, 19, 0) == []
    tonight.save_settings(st, {"hour": "18:30"})   # moved earlier than now: the next look builds
    assert len(at(0, 19, 1)) == 1
    tonight.save_settings(st, {"on": False})
    tonight.save_settings(st, {"on": True})
    tonight.save_settings(st, {"hour": "19:30"})
    assert len(at(0, 20, 0)) == 1 and len(sheet_files(st)) == 1


def test_two_ticks_in_one_second_look_once(clock_env, monkeypatch):
    st, rs, sched, at = clock_env
    calls = []
    real = tonight.clock_step
    monkeypatch.setattr(tonight, "clock_step", lambda *a, **k: calls.append(1) or real(*a, **k))
    t = datetime.combine(TODAY, datetime.min.time()).replace(hour=19).timestamp()
    sched.tick(t)
    sched.tick(t)
    sched.tick(t + 0.5)
    assert len(calls) == 1


def test_a_failing_build_keeps_the_reminders_and_is_tried_again(clock_env, monkeypatch):
    st, rs, sched, at = clock_env
    tonight.save_settings(st, {"on": True, "count": 3})
    other = rs.create(text="call the invented friend", kind="reminder", due=rs.clock() + 60)
    real = tonight.choose
    monkeypatch.setattr(tonight, "choose", lambda *a, **k: (_ for _ in ()).throw(RuntimeError("invented failure")))
    assert at(0, 19, 0) == []
    assert rs.get(other["id"])["status"] != "pending"     # the scheduler's own reminder still fired
    monkeypatch.setattr(tonight, "choose", real)
    assert at(0, 19, 5) == []                      # not every 30 s: the order is not recomputed in a loop
    assert len(at(0, 19, 15)) == 1                 # tried again later the same evening: one sheet, one reminder
    assert len(at(0, 21, 0)) == 1


def test_a_question_accepted_after_the_hour_still_gives_tonights_sheet(clock_env):
    st, rs, sched, at = clock_env
    tonight.save_settings(st, {"on": True, "count": 3})
    ids = [q["id"] for q in st.list_questions(subject="signals", status="accepted")]
    for q in ids:
        st.set_status(q, "pending")
    assert at(0, 19, 0) == [] and sheet_files(st) == []
    for q in ids:
        st.set_status(q, "accepted")
    rem = at(0, 19, 10)
    assert len(rem) == 1 and len(sheet_files(st)) == 1
    assert len(at(0, 22, 0)) == 1


def test_the_wrapper_does_not_stack_when_the_routes_register_twice(clock_env, monkeypatch):
    st, rs, sched, at = clock_env
    svc = SimpleNamespace(plan=make_plan(Path(st.root).parent), reminders=rs, reminder_scheduler=sched)
    R.register(FastAPI(), svc, Bus())
    R.register(FastAPI(), svc, Bus())
    calls = []
    real = tonight.clock_step
    monkeypatch.setattr(tonight, "clock_step", lambda *a, **k: calls.append(1) or real(*a, **k))
    sched.tick(datetime.combine(TODAY, datetime.min.time()).replace(hour=12).timestamp())
    assert len(calls) == 1


def test_no_plan_or_no_reminders_uses_nothing_up(clock_env, tmp_path):
    st, rs, sched, at = clock_env
    tonight.save_settings(st, {"on": True})
    app = FastAPI()
    R.register(app, SimpleNamespace(plan=None, reminders=rs, reminder_scheduler=None), Bus())
    assert app.state.pyq_tonight_clock(datetime.combine(TODAY, datetime.min.time()).replace(hour=20).timestamp()) is None
    app = FastAPI()
    R.register(app, SimpleNamespace(plan=make_plan(tmp_path), reminders=None), Bus())
    assert app.state.pyq_tonight_clock(datetime.combine(TODAY, datetime.min.time()).replace(hour=20).timestamp()) is None
    assert not (Path(st.root) / "tonight" / "clock.json").exists() and sheet_files(st) == []


# ------------------------------------------------------------------ review of 27 Nov: marks and the sheet
def test_marks_refuse_strings_and_none_and_keep_r27_rows(env):
    c, st, plan, _ = env
    bank(st)
    sheet = c.post(f"{T}/build", json={}).json()["sheet"]
    sid, it = sheet["id"], sheet["items"][0]
    for bad in ("3", None, float("inf"), [1]):
        body = json.dumps({"items": [{"question_id": it["question_id"], "got": bad}]}, allow_nan=True)
        assert c.post(f"{T}/{sid}/marks", content=body, headers={"content-type": "application/json"}).status_code == 400, bad
    with plan._lock:
        s = plan.load()
        s.setdefault("paper_marks", {}).setdefault("signals", {})[it["topic_key"]] = [
            {"date": TODAY.isoformat(), "got": 1, "max": 5, "q": it["question_id"], "origin": "generated", "seed": 3}]
        plan.save(s)
    for got in (2, 4):
        assert c.post(f"{T}/{sid}/marks", json={"items": [{"question_id": it["question_id"], "got": got}]}).status_code == 200
    rows = plan.load()["paper_marks"]["signals"][it["topic_key"]]
    assert [(r["got"], r.get("origin")) for r in rows] == [(1, "generated"), (4, "sheet")]
    assert all(k in ("date", "got", "max", "q", "origin", "sheet", "seed") for r in rows for k in r)


def test_one_question_on_two_sheets_keeps_two_rows(env):
    c, st, plan, _ = env
    bank(st)
    sheets = [c.post(f"{T}/build", json={"date": (TODAY + timedelta(days=i)).isoformat()}).json()["sheet"] for i in range(5)]
    a = next(it for it in sheets[0]["items"] if it["topic"] == "aliasing")
    e = next(it for it in sheets[4]["items"] if it["topic"] == "aliasing")
    assert a["question_id"] == e["question_id"]
    c.post(f"{T}/{sheets[0]['id']}/marks", json={"items": [{"question_id": a["question_id"], "got": 1}]})
    c.post(f"{T}/{sheets[4]['id']}/marks", json={"items": [{"question_id": e["question_id"], "got": 3}]})
    rows = [r for r in plan.load()["paper_marks"]["signals"][a["topic_key"]] if r["q"] == a["question_id"]]
    assert sorted((r["sheet"], r["got"]) for r in rows) == sorted([(sheets[0]["id"], 1), (sheets[4]["id"], 3)])


def test_marks_after_the_question_is_gone_or_retagged(env):
    c, st, plan, _ = env
    bank(st)
    sheet = c.post(f"{T}/build", json={}).json()["sheet"]
    first, second = sheet["items"][0], sheet["items"][1]
    st.update_question(second["question_id"], {"topic": "time constant", "unit": 2})
    pid = st.get_question(first["question_id"])["paper_id"]
    st.delete_paper(pid)
    j = c.post(f"{T}/{sheet['id']}/marks", json={"items": [{"question_id": first["question_id"], "got": 3},
                                                          {"question_id": second["question_id"], "got": 2}]})
    assert j.status_code == 200, j.text
    pm = plan.load()["paper_marks"]["signals"]
    assert pm[first["topic_key"]][-1]["q"] == first["question_id"]           # the topic the sheet stood for
    assert any(r["q"] == second["question_id"] for r in pm[second["topic_key"]])
    assert c.get(f"{T}/{sheet['id']}/print").status_code == 200


def test_the_sheet_survives_a_restart_and_a_rebuild_draws_the_same(env):
    c, st, plan, _ = env
    bank(st)
    one = c.post(f"{T}/build", json={}).json()["sheet"]
    again = Store(st.root)
    assert tonight.load_sheet(again, one["id"])["items"] == tonight.load_sheet(st, one["id"])["items"]
    (Path(st.root) / "sheets" / f"{one['id']}.json").unlink()
    two = c.post(f"{T}/build", json={}).json()["sheet"]
    assert [i["question_id"] for i in two["items"]] == [i["question_id"] for i in one["items"]]


def test_only_accepted_questions_stand_and_the_file_has_the_shared_shape(env):
    c, st, plan, _ = env
    bank(st)
    qs = st.list_questions(subject="signals", status="accepted")
    off = {q["id"] for q in qs[::3]}
    for i, q in enumerate(sorted(off)):
        st.set_status(q, "rejected" if i % 2 else "pending")
    sheet = c.post(f"{T}/build", json={}).json()["sheet"]
    assert sheet and not off & {i["question_id"] for i in sheet["items"]}
    raw = json.loads((Path(st.root) / "sheets" / f"{sheet['id']}.json").read_text(encoding="utf-8"))
    assert set(raw) == {"id", "date", "subject", "built_at", "items", "marks"}
    assert all(set(i) == {"n", "question_id", "marks", "unit", "topic", "topic_key"} for i in raw["items"])
    for it in sheet["items"]:
        assert set(it["why"]) == {"days_left", "marks_weight", "share", "proficiency", "syllabus_weight"}


@pytest.mark.parametrize("sid", ["2026-11-27-..\\x", "2026-11-27-c:x", "C:%5Cx", "2026-11-27-signäls", "2026-11-27-%2e%2e"])
def test_more_hostile_ids(env, sid):
    c, st, plan, _ = env
    bank(st)
    assert c.get(f"{T}/{sid}/print").status_code in (404, 405)
    assert c.post(f"{T}/build", json={"subject": sid}).status_code in (400, 404)
    assert sheet_files(st) == []


def test_no_forecast_word_anywhere_in_the_answers(env):
    c, st, plan, _ = env
    bank(st)
    on(c)
    for j in (c.get(T).json(), c.post(f"{T}/build", json={}).json(), c.get(T).json()):
        for text in strings(j):
            assert "forecast" not in text.lower(), text
