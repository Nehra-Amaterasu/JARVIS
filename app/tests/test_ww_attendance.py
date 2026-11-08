"""Attendance engine (classes of margin) and the exams engine's groups, on typed data."""
import json

from jarvis_app import ww_attendance, ww_engines
from jarvis_app.ww_attendance import attendance, margin

TT = {"section": "X-1", "slots": [
    {"day": "mon", "start": "08:45", "end": "09:45", "subject": "control"},
    {"day": "mon", "start": "09:45", "end": "10:45", "subject": "micro"},
    {"day": "tue", "start": "13:45", "end": "15:45", "subject": "lab", "kind": "lab", "title": "ESDM Lab"},
    {"day": "funday", "start": "08:45", "subject": "control"},          # dropped: no such day
    {"day": "wed", "subject": "control"},                               # dropped: no start
]}
SUBJECTS = [{"id": "control", "name": "Modern Control"}, {"id": "micro", "name": "Microelectronic Circuits"}, {"id": "lab", "name": "Lab"}]


def test_margin_arithmetic_matches_the_review():
    # 30 of 40 = 75 %: at the line, nothing to spare, nothing to recover.
    assert margin(30, 40, 0.75) == {"pct": 0.75, "can_miss": 0, "need": 0}
    # 36 of 40: S <= (36 - 30)/0.75 = 8 classes of margin.
    assert margin(36, 40, 0.75)["can_miss"] == 8
    # 24 of 40 = 60 %: R >= (30 - 24)/0.25 = 24 in a row.
    assert margin(24, 40, 0.75) == {"pct": 0.6, "can_miss": 0, "need": 24}
    assert margin(0, 0, 0.75)["pct"] is None


def test_normalize_timetable_and_rule():
    out = ww_engines.normalize_inputs({"timetable": TT, "attendance_rule": {"threshold": 0.8, "scope": "overall"}})
    slots = out["timetable"]["slots"]
    assert [s["id"] for s in slots] == ["mon-0845-control", "mon-0945-micro", "tue-1345-lab"]
    assert slots[2]["kind"] == "lab" and slots[2]["title"] == "ESDM Lab"
    assert sum("timetable slot" in w for w in out["warnings"]) == 2
    assert out["attendance_rule"] == {"threshold": 0.8, "scope": "overall", "confirmed": False, "note": ""}
    assert ww_engines.normalize_inputs({})["attendance_rule"]["threshold"] == 0.75


def test_attendance_counts_only_taps_and_names_today():
    inputs = ww_engines.normalize_inputs({"timetable": TT})
    log = {"control": [{"date": "2026-11-02", "slot": "mon-0845-control", "status": "present"},
                       {"date": "2026-11-09", "slot": "mon-0845-control", "status": "absent"},
                       {"date": "2026-11-16", "slot": "mon-0845-control", "status": "cancelled"}]}
    out = attendance(inputs, "2026-11-09", log=log, subjects=SUBJECTS)       # a Monday
    assert [c["id"] for c in out["today"]] == ["mon-0845-control", "mon-0945-micro"]
    assert out["today"][0]["status"] == "absent" and out["today"][1]["status"] is None
    ctl = next(r for r in out["subjects"] if r["subject"] == "control")
    assert (ctl["held"], ctl["attended"], ctl["pct"], ctl["need"]) == (2, 1, 0.5, 2)   # cancelled is not held
    assert ctl["weekly"] == 1
    micro = next(r for r in out["subjects"] if r["subject"] == "micro")
    assert micro["held"] == 0 and micro["pct"] is None                        # the grid never counts
    assert any("Rule assumed" in r for r in out["risks"])
    assert "Below the line: Modern Control" in out["say"]
    empty = attendance(ww_engines.normalize_inputs({}), "2026-11-09")
    assert empty["today"] == [] and empty["subjects"] == []


def test_attendance_is_pure():
    inputs = ww_engines.normalize_inputs({"timetable": TT})
    log = {"control": [{"date": "2026-11-02", "slot": "mon-0845-control", "status": "present"}]}
    snap = json.dumps([inputs, log], sort_keys=True)
    a = attendance(inputs, "2026-11-09", log=log, subjects=SUBJECTS)
    b = attendance(inputs, "2026-11-09", log=log, subjects=SUBJECTS)
    assert a == b and json.dumps([inputs, log], sort_keys=True) == snap
    assert ww_engines.run("attendance", inputs, "2026-11-09", log=log, subjects=SUBJECTS)["status"] == "ok"


def test_exams_groups_kinds_and_flags_approx_dates():
    sheet = [{"id": "see-a", "subject": "a", "title": "A", "date": "2026-12-08", "start": "10:00", "end": "13:00",
              "kind": "end_sem", "approx": True, "max": 60, "target": 40,
              "pattern": [{"name": "Part A", "questions": 10, "attempt": 10, "marks": 2}, {"questions": 5, "attempt": 3, "marks": 10}, {"questions": 0, "marks": 1}]},
             {"id": "bl-b", "subject": "b", "title": "B (backlog)", "date": "2026-12-28", "kind": "backlog", "max": 60},
             {"id": "c", "subject": "c", "title": "C", "date": "2026-12-30", "kind": "nonsense"}]
    inputs = ww_engines.normalize_inputs({"exams": sheet})
    a = inputs["exams"][0]
    assert a["kind"] == "end_sem" and a["approx"] is True
    assert a["pattern"] == [{"name": "Part A", "questions": 10, "attempt": 10, "marks": 2.0},
                            {"name": "Section 2", "questions": 5, "attempt": 3, "marks": 10.0}]
    assert inputs["exams"][2]["kind"] == "other" and inputs["exams"][1]["approx"] is False
    subjects = [{"id": s, "name": s.upper(), "units": [{"n": 1, "title": "U1", "topics": ["t1", "t2"], "exam_weight": "high"}]} for s in "abc"]
    out = ww_engines.run("exams", inputs, "2026-11-08", subjects=subjects, prep={})
    assert out["version"] == 2
    assert [(g["kind"], g["count"], g["next"]) for g in out["groups"]] == [("end_sem", 1, "see-a"), ("backlog", 1, "bl-b"), ("other", 1, "c")]
    assert out["papers"][0]["duration_min"] == 180 and out["papers"][1]["duration_min"] is None
    assert any(r.startswith("Dates marked approx (1 of 3)") for r in out["risks"])
    assert ww_attendance.ENGINE.name == "attendance"
