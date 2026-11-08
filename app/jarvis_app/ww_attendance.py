"""Attendance engine: today's classes to tap, and per subject how many classes of margin
he has above the college's threshold.

    attendance(inputs, today, log=None, subjects=None) -> dict

inputs["timetable"]: the weekly grid (slots: day, start, end, subject, kind) typed once
in Settings; inputs["attendance_rule"]: {threshold, scope, confirmed}.
log: the plan state's record {subject: [{date, slot, status}]}, status present | absent |
cancelled. A class counts only when he tapped it: the grid proposes, it never counts.

The arithmetic (checked in the 6 Nov review): with A attended out of N held and
threshold t, he may skip S more classes while A/(N+S) >= t exactly when
S <= (A - tN)/t; and if below, he needs R consecutive attended classes with
(A+R)/(N+R) >= t, so R >= (tN - A)/(1 - t). Both are shown as a buffer ("classes of
margin"), never as "safe to skip": he lost three papers to attendance this semester.
Until the rule is confirmed, every number says so. Pure.
"""
from __future__ import annotations

import math
from datetime import date
from typing import Optional

from .ww_base import EngineSpec, plural

STATUSES = ("present", "absent", "cancelled")
DAYS = ("mon", "tue", "wed", "thu", "fri", "sat", "sun")


def margin(attended: int, held: int, threshold: float) -> dict:
    """Classes he can still miss (>= 0) or must attend in a row (> 0) to sit at the threshold."""
    if held <= 0:
        return {"pct": None, "can_miss": 0, "need": 0}
    pct = attended / held
    if pct >= threshold:
        return {"pct": round(pct, 3), "can_miss": int(math.floor((attended - threshold * held) / threshold + 1e-9)), "need": 0}
    need = int(math.ceil((threshold * held - attended) / (1 - threshold) - 1e-9))
    return {"pct": round(pct, 3), "can_miss": 0, "need": max(1, need)}


def attendance(inputs: dict, today: str, log: Optional[dict] = None, subjects: Optional[list[dict]] = None) -> dict:
    tt = inputs.get("timetable") or {}
    rule = {"threshold": 0.75, "scope": "per_subject", "confirmed": False, **(inputs.get("attendance_rule") or {})}
    t = float(rule["threshold"])
    log = log or {}
    names = {s.get("id"): str(s.get("name") or s.get("id")) for s in subjects or [] if isinstance(s, dict)}
    slots = tt.get("slots") or []
    base = {"engine": "attendance", "version": 1, "status": "ok", "date": today, "rule": rule}
    if not slots:
        return {**base, "today": [], "subjects": [], "overall": None, "risks": [],
                "say": "No timetable yet. Type the week's classes into Settings and the taps appear here."}
    wd = DAYS[date.fromisoformat(today).weekday()]
    tapped = {(e.get("slot"), e.get("date")): e.get("status") for lst in log.values() for e in lst if isinstance(e, dict)}
    todays = [{"id": s["id"], "start": s["start"], "end": s.get("end"), "subject": s["subject"],
               "name": s.get("title") or names.get(s["subject"], s["subject"]), "kind": s.get("kind", "lecture"),
               "room": s.get("room") or "", "status": tapped.get((s["id"], today))}
              for s in slots if s["day"] == wd]
    rows = []
    for sid in sorted({s["subject"] for s in slots}, key=lambda x: names.get(x, x)):
        ev = [e for e in log.get(sid) or [] if isinstance(e, dict) and e.get("status") in STATUSES]
        held = sum(1 for e in ev if e["status"] != "cancelled")
        att = sum(1 for e in ev if e["status"] == "present")
        m = margin(att, held, t)
        weekly = sum(1 for s in slots if s["subject"] == sid)
        rows.append({"subject": sid, "name": names.get(sid, sid), "held": held, "attended": att, "weekly": weekly,
                     **m, "last": max((e.get("date") or "" for e in ev), default=None)})
    held_all = sum(r["held"] for r in rows)
    att_all = sum(r["attended"] for r in rows)
    overall = {"held": held_all, "attended": att_all, **margin(att_all, held_all, t)} if held_all else None
    risks = []
    if not rule.get("confirmed"):
        risks.append(f"Rule assumed: {round(t * 100)} % {('per subject' if rule['scope'] == 'per_subject' else 'overall')}. "
                     "Confirm the college's real rule (threshold, per subject or overall, condonation) in Settings.")
    low = [r for r in rows if r["held"] and r["need"]]
    for r in low[:4]:
        risks.append(f"{r['name']}: {r['attended']}/{r['held']} ({round((r['pct'] or 0) * 100)} %), "
                     f"{plural(r['need'], 'class', 'classes')} in a row to reach {round(t * 100)} %.")
    tight = [r for r in rows if r["held"] and not r["need"] and r["can_miss"] <= 1]
    if tight:
        risks.append("At the line (0–1 class of margin): " + ", ".join(r["name"] for r in tight) + ".")
    untapped = [c for c in todays if not c["status"]]
    if todays:
        say = f"{plural(len(todays), 'class', 'classes')} today" + (f", {len(untapped)} not tapped yet." if untapped else ", all tapped.")
    else:
        say = "No classes today."
    if low:
        say += f" Below the line: {', '.join(r['name'] for r in low[:3])}."
    return {**base, "today": todays, "subjects": rows, "overall": overall, "risks": risks[:6], "say": say,
            "note": "Margin = classes you could still miss and stay at the threshold; need = classes in a row to get "
                    "back to it. A buffer for a sick day, not a budget to spend."}


ENGINE = EngineSpec(
    name="attendance", version=1, fn=attendance,
    about="Today's classes to tap and, per subject, classes of margin above the attendance threshold.",
    needs=("the weekly timetable (Settings)", "the attendance rule", "your taps"),
    inputs={"timetable": {"type": "dict"}, "attendance_rule": {"type": "dict"}},
    data={"log": {"type": "dict"}, "subjects": {"type": "list", "items": {"type": "dict"}}},
)
