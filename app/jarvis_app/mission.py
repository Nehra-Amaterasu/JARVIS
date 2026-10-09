"""The mission tracker: the Germany roadmap's weekly numbers, on JARVIS's home screen.

Targets come from the roadmap (MS in VLSI, TU9, Winter 2028): 50 numericals and
10 hours of German every week. JARVIS exists to serve that goal, so the two numbers
sit where they can't be ignored. Stored locally in app/data/mission.json, one
entry per ISO week, so the history shows the trend rather than one good day.
"""
from __future__ import annotations

import datetime as dt
import json
import threading

from .paths import DATA

FILE = DATA / "mission.json"
TARGETS = {"numericals": 50, "german_min": 600}
LABELS = {"numericals": "VLSI numericals", "german_min": "German"}
_lock = threading.Lock()


def _week(d: dt.date | None = None) -> str:
    y, w, _ = (d or dt.date.today()).isocalendar()
    return f"{y}-W{w:02d}"


def _load() -> dict:
    try:
        return json.loads(FILE.read_text(encoding="utf-8"))
    except (FileNotFoundError, json.JSONDecodeError):
        return {"weeks": {}}


def view() -> dict:
    with _lock:
        data = _load()
    this = _week()
    weeks = data.get("weeks", {})
    cur = {k: weeks.get(this, {}).get(k, 0) for k in TARGETS}
    today = dt.date.today()
    days_left = 7 - today.isoweekday()
    history = []
    for i in range(7, -1, -1):
        wk = _week(today - dt.timedelta(weeks=i))
        w = weeks.get(wk, {})
        history.append({"week": wk, **{k: w.get(k, 0) for k in TARGETS}})
    return {"week": this, "days_left": days_left, "targets": TARGETS, "labels": LABELS,
            "current": cur, "history": history}


def add(kind: str, delta: int) -> dict:
    if kind not in TARGETS:
        raise ValueError(f"kind must be one of {sorted(TARGETS)}")
    with _lock:
        data = _load()
        wk = data.setdefault("weeks", {}).setdefault(_week(), {})
        wk[kind] = max(0, int(wk.get(kind, 0)) + int(delta))
        FILE.write_text(json.dumps(data, indent=2), encoding="utf-8")
    return view()
