"""Body & life engine: weekly habits with evidence, and one self-upgrade focus a week.

    body(inputs, today, habit_log=None, quest_days=None) -> dict

habits come from the inputs ({id, target, days, opt_in}); habit_log is
{habit_id: [dates he tapped "done"]}; quest_days are dates with a logged
calisthenics session (they count for any habit about movement).

Each habit gets a weekly number to hit, read from its own wording ("daily" = 7,
"Mon-Fri" = 5, "3x/week" = 3, "per week" = 1), what is done this week (Monday to
today), and whether that is still reachable. Habits he has not opted in to
(opt_in false) are never shown or counted.

The upgrade focus rotates weekly through LIFE: grooming, skin, hair, wardrobe,
posture, voice. Each is one small concrete action, advice only, never a judgement
of how he looks. Pure: the arguments are never changed.
"""
from __future__ import annotations

import re
from datetime import date
from typing import Optional

from .ww_base import EngineSpec, add_days, plural

LIFE = (
    ("grooming", "Grooming", "Pick a fixed beard/shave day and a nail-trim day; put both in the calendar."),
    ("skin", "Skin", "Two minutes, morning and night: gentle face wash, moisturiser, and sunscreen in the morning."),
    ("hair", "Hair", "Book a haircut every 4-6 weeks on the same weekday; ask the barber which length suits your face shape."),
    ("wardrobe", "Wardrobe", "Lay out 3 plain T-shirts, 1 shirt, 2 trousers that fit at the shoulders and waist; give away one thing that doesn't."),
    ("posture", "Posture", "Every study hour: stand, roll the shoulders back, 10 wall angels. Screen at eye height."),
    ("voice", "Articulation", "Record a 60-second explanation of today's concept, play it back once, cut one filler word next time."),
)
MOVEMENT = ("movement", "calisthenics", "workout", "exercise", "gym")


def per_week(h: dict) -> int:
    t = f"{h.get('target', '')} {h.get('days', '')}".lower()
    if m := re.search(r"(\d+)\s*x\s*/?\s*(?:a\s*)?week", t):
        return max(1, min(7, int(m.group(1))))
    if "mon-fri" in t or "weekday" in t:
        return 5
    if "daily" in t or "/day" in t or "a day" in t or "every day" in t:
        return 7
    return 1


def week_start(today: str) -> str:
    return add_days(today, -date.fromisoformat(today).weekday())   # Monday


def body(inputs: dict, today: str, habit_log: Optional[dict] = None, quest_days: Optional[list[str]] = None) -> dict:
    log = habit_log or {}
    start = week_start(today)
    days_left = 7 - date.fromisoformat(today).weekday() - 1           # after today
    rows = []
    for h in inputs.get("habits") or []:
        if not h.get("opt_in", True):
            continue
        dates = set(log.get(h["id"], []))
        if any(k in f"{h['id']} {h.get('target', '')}".lower() for k in MOVEMENT):
            dates |= set(quest_days or [])
        done = len({d for d in dates if start <= d <= today})
        need = per_week(h)
        today_done = today in dates
        reachable = done + days_left + (0 if today_done else 1) >= need
        rows.append({"id": h["id"], "target": h.get("target", ""), "per_week": need, "done_this_week": done,
                     "today_done": today_done, "on_track": done >= need or reachable, "met": done >= need})
    week_no = date.fromisoformat(today).isocalendar()[1]
    fid, fname, ftext = LIFE[week_no % len(LIFE)]
    behind = [r for r in rows if not r["on_track"]]
    open_today = [r for r in rows if not r["today_done"] and not r["met"]]
    if behind:
        say = f"{behind[0]['id']} can't reach {behind[0]['per_week']} this week any more; pick one day next week and protect it."
    elif open_today:
        say = f"{plural(len(open_today), 'habit')} still open today, starting with {open_today[0]['id']}. This week's upgrade: {fname}."
    else:
        say = f"Habits are on track. This week's upgrade: {fname}. {ftext}"
    return {"engine": "body", "version": 1, "status": "ok", "date": today, "week_start": start,
            "habits": rows, "focus": {"id": fid, "name": fname, "text": ftext}, "say": say,
            "note": "Advice only. Health matters beyond habits go to a doctor."}


ENGINE = EngineSpec(
    name="body", version=1, fn=body,
    about="Weekly habits with evidence, and one small self-upgrade focus a week (grooming, skin, hair, wardrobe, posture, voice).",
    needs=("habits (inputs)", "habit taps", "calisthenics sessions"),
    inputs={"habits": {"type": "list", "items": {"type": "dict", "required": {"id": {"type": "str"}}}}},
    data={"habit_log": {"type": "dict", "values": {"type": "list", "items": {"type": "date"}}},
          "quest_days": {"type": "list", "items": {"type": "date"}}},
)
