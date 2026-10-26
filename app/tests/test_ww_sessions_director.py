"""Work sessions from commits (ww_sessions.py), the director that merges the engines
(ww_director.py), and exam difficulty / targets. Fictional commits and papers only."""
import copy
from datetime import datetime, timedelta, timezone

from jarvis_app import github_activity, ww_engines
from jarvis_app.ww_director import director
from jarvis_app.ww_exams import LEARN_MIN, exams
from jarvis_app.ww_sessions import GAP_MIN, LEAD_MIN, area_of, sessions

IST = timezone(timedelta(hours=5, minutes=30))
TODAY = "2026-10-30"


def ts(hhmm: str, day: str = TODAY) -> int:
    return int(datetime.fromisoformat(f"{day}T{hhmm}:00").replace(tzinfo=IST).timestamp())


def C(sha, hhmm, subject="feat(aankhen): x", day=TODAY):
    return {"sha": sha * 8, "ts": ts(hhmm, day), "repo": "proj", "subject": subject, "url": f"https://example.org/{sha}"}


def test_commits_close_together_are_one_session_with_a_lead_in():
    r = sessions({}, TODAY, commits=[C("a", "10:00"), C("b", "11:00"), C("c", "11:45")])
    assert len(r["sessions"]) == 1
    s = r["sessions"][0]
    assert s["minutes"] == 105 + LEAD_MIN and s["start"] == "09:30" and s["end"] == "11:45" and s["commits"] == 3
    assert s["link"] == "https://example.org/c" and r["today_minutes"] == s["minutes"]


def test_a_long_gap_splits_and_a_lone_commit_counts_the_lead_in():
    r = sessions({}, TODAY, commits=[C("a", "09:00"), C("b", f"{9 + (GAP_MIN + 1) // 60}:{(GAP_MIN + 1) % 60:02d}")])
    assert [x["minutes"] for x in r["sessions"]] == [LEAD_MIN, LEAD_MIN]


def test_areas_come_from_the_commit_scope_and_old_names_merge():
    assert area_of("feat(mission): y", "proj") == "well-wisher" == area_of("fix(germoney): z", "proj")
    assert area_of("docs: readme", "proj") == "proj"
    r = sessions({}, TODAY, commits=[C("a", "10:00", "feat(aankhen): a"), C("b", "10:30", "feat(well-wisher): b")])
    assert r["week_areas"] == {"aankhen": 30, "well-wisher": 30}


def test_imported_sessions_are_marked_and_not_pending():
    r = sessions({}, TODAY, commits=[C("a", "10:00")])
    sid = r["sessions"][0]["id"]
    again = sessions({}, TODAY, commits=[C("a", "10:00")], imported=[sid])
    assert r["pending"] == [sid] and again["pending"] == [] and again["sessions"][0]["imported"]


def test_no_commits_is_an_answer_and_the_engine_is_pure():
    assert sessions({}, TODAY)["status"] == "ok"
    cs = [C("a", "10:00")]
    before = copy.deepcopy(cs)
    assert sessions({}, TODAY, commits=cs) == sessions({}, TODAY, commits=copy.deepcopy(cs)) and cs == before


def test_local_commits_parses_git_log_and_skips_missing_repos(tmp_path):
    (tmp_path / ".git").mkdir()
    fake = lambda args, cwd: "abc\x1f1761800000\x1ffeat(x): one\nbroken line\n"
    got = github_activity.local_commits([{"path": str(tmp_path), "name": "p", "url": "https://github.com/u/p"},
                                         {"path": str(tmp_path / "nope")}], run=fake)
    assert got == [{"sha": "abc", "ts": 1761800000, "repo": "p", "subject": "feat(x): one", "url": "https://github.com/u/p/commit/abc"}]


# ------------------------------------------------------------------ exams: difficulty and target
SUBJ = [{"id": "alpha", "name": "Alpha", "units": [{"n": 3, "title": "T", "exam_weight": "high", "topics": ["a", "b"]}]}]


def sheet(**kw):
    return ww_engines.normalize_inputs({"exams": [{"id": "a", "subject": "alpha", "title": "Alpha", "date": "2026-11-02",
                                                   "units": [3], **kw}]})


def test_an_easy_paper_needs_less_time_and_a_target_is_checked():
    hard = exams(sheet(difficulty="hard"), TODAY, subjects=SUBJ)["papers"][0]["work_minutes"]
    easy = exams(sheet(difficulty="easy"), TODAY, subjects=SUBJ)["papers"][0]["work_minutes"]
    assert easy < hard and exams(sheet(difficulty="bogus"), TODAY, subjects=SUBJ)["papers"][0]["difficulty"] == "normal"
    assert easy - 80 == 2 * round(LEARN_MIN["high"] * 0.7 / 5) * 5          # minutes are rounded to 5
    p = exams(sheet(target=16), TODAY, subjects=SUBJ, prep={"alpha": {"papers": [{"date": TODAY, "score": 14, "max": 20}]}})["papers"][0]
    assert p["target"] == 16 and p["paper_score"]["on_target"] is False
    assert ww_engines.normalize_inputs({"exams": [{"subject": "a", "date": "2026-11-02", "target": 99}]})["exams"][0]["target"] == 20


# ------------------------------------------------------------------ director
def ex_answer(days_left=3, minutes=120, score=None):
    p = {"id": "a", "title": "Alpha", "days_left": days_left, "target": 16, "max": 20,
         "paper_score": {"score": score, "max": 20} if score is not None else None}
    blocks = [{"paper": "a", "title": "Alpha", "minutes": minutes, "focus": [{"title": "topic a"}]}] if minutes else []
    return {"papers": [p], "days": [{"date": TODAY, "slots": [{"blocks": blocks}]}]}


INP = ww_engines.normalize_inputs({})


def test_exam_week_puts_study_first_and_caps_building():
    d = director(INP, TODAY, exams=ex_answer(), sessions={"today_minutes": 0, "sessions": []})
    assert d["mode"] == "exam" and d["steps"][0]["kind"] == "study" and d["steps"][-1]["kind"] == "build"
    assert d["split"] == {"study": 120, "build": 60, "built_today": 0} and d["note"] is None


def test_past_the_cap_the_director_says_so_once_without_blame():
    from jarvis_app.ww_base import no_shame
    d = director(INP, TODAY, exams=ex_answer(), sessions={"today_minutes": 150, "sessions": []})
    assert d["note"] and "cap" in d["note"] and no_shame(d["note"] + d["say"])
    assert all(s["kind"] != "build" for s in d["steps"])


def test_with_study_done_or_no_exam_building_gets_the_full_budget():
    done = director(INP, TODAY, exams=ex_answer(minutes=0), sessions={"today_minutes": 30, "sessions": []})
    assert done["split"]["build"] == 150 and "study is done" in done["say"]
    calm = director(INP, TODAY, exams=ex_answer(days_left=40), sessions={"today_minutes": 0, "sessions": []})
    assert calm["mode"] == "normal" and calm["split"]["build"] == 180


def test_a_practice_paper_under_target_is_named_and_small_items_follow():
    d = director(INP, TODAY, exams=ex_answer(score=12), learning={"due": [{"title": "Ohm", "question": "V?"}]},
                 body={"habits": [{"id": "h", "target": "walk", "today_done": False, "done_this_week": 1, "per_week": 3}]})
    assert "12/20, under your 16" in d["steps"][0]["why"]
    assert [s["kind"] for s in d["steps"]][:3] == ["study", "recall", "habit"]


def test_both_new_engines_are_registered_and_run_through_the_schema():
    assert ww_engines.run("director", INP, TODAY, exams=ex_answer())["status"] == "ok"
    assert ww_engines.run("sessions", INP, TODAY, commits=[C("a", "10:00")])["status"] == "ok"
    assert ww_engines.run("sessions", INP, TODAY, commits=[{"sha": 1}])["status"] == "invalid_input"


def test_import_logs_each_session_once_with_its_commit_as_proof(tmp_path, monkeypatch):
    import json
    import shutil
    from pathlib import Path
    from jarvis_app import germoney as g
    fix = Path(__file__).resolve().parents[1] / "ui" / "src" / "__tests__" / "fixtures" / "mission-bank"
    d = tmp_path / "bank"
    d.mkdir()
    for n in g.BANK_FILES:
        shutil.copy(fix / n, d / n)
    bank = g.load_bank(d)
    (tmp_path / "in.json").write_text(json.dumps({}), encoding="utf-8")
    monkeypatch.setenv("JARVIS_ENGINE_INPUTS", str(tmp_path / "in.json"))
    monkeypatch.setattr(g.github_activity, "local_commits", lambda repos, **k: [C("a", "10:00"), C("b", "10:40")])
    plan = g.Plan(g.KVStore(tmp_path / "kv", tmp_path / "bk"), bank_loader=lambda: bank, academics_loader=lambda: None,
                  apps=g.Applications(calendar=tmp_path / "c.json", store=tmp_path / "a.json"))
    r = plan.import_sessions(TODAY)
    assert r["added"] == 1 and r["pending"] == []
    logs = [e for e in plan.load(TODAY)["events"] if e["kind"] == "log" and e.get("track") == "build"]
    assert len(logs) == 1 and logs[0]["minutes"] == 40 + LEAD_MIN and logs[0]["verified"] and logs[0]["proof"] == "https://example.org/b"
    assert plan.import_sessions(TODAY)["added"] == 0
    assert plan.engine("director", TODAY)["status"] == "ok"
