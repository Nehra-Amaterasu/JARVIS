"""Life engine: the day in a few taps, and a slow, kind taper on what he wants less of.

    life(inputs, today, log=None) -> dict

log: {date: {"counts": {id: n}, "items": [{kind, text, minutes?, url?, explained?}]}} from
the plan state. Counters come from inputs["life"]["counters"] (Settings), each
{id, name, want: "less" | "more" | "yes"}; the defaults below are generic placeholders.

Why it is shaped like this (the sources are in docs/research/well-wisher.md):
  * logging must cost seconds, or it stops: one tap per counter, no forms;
  * a slip is data, not a verdict: no streak resets to zero, no red, no blame
    (the "abstinence violation effect": one slip framed as failure tends to turn
    into a binge);
  * "less" is a taper, not a cliff: this week's line is the median of the last
    7 logged days minus 10 % (gradual reduction is how cutting down is usually
    taught), and a day on or under the line earns a point;
  * points are the reward signal, and the System shows the trend over 4 weeks,
    since a single day says little.
Advice only; nothing here is medical. Pure.
"""
from __future__ import annotations

import math
from statistics import median
from typing import Optional

from .ww_base import EngineSpec, add_days, plural

# Generic defaults only: his own counters live in the private engine-inputs.json
# ("life": {"counters": [...]}, editable in Settings), never in this public file.
DEFAULT_COUNTERS = [
    {"id": "college", "name": "Went to class", "want": "yes"},
    {"id": "snacks", "name": "Junk snacks", "want": "less"},
    {"id": "screen", "name": "Hours of scrolling", "want": "less"},
    {"id": "water", "name": "Glasses of water", "want": "more"},
]
ITEM_KINDS = ("meal", "anime", "movie", "series", "reel", "note")
STEP = 0.9          # each week's line is 10 % under the last 7 logged days


def _line(history: list[int], want: str) -> Optional[int]:
    if len(history) < 3:            # fewer than 3 logged days: no line yet, only logging
        return None
    m = median(history)
    if want == "less":
        return max(0, math.floor(m * STEP)) if m > 0 else 0
    if want == "more":
        return math.ceil(m / STEP) if m > 0 else 1
    return None


def life(inputs: dict, today: str, log: Optional[dict] = None) -> dict:
    log = log or {}
    counters = ((inputs.get("life") or {}).get("counters")) or DEFAULT_COUNTERS
    day = log.get(today) or {}
    rows, points_today = [], 0
    for c in counters:
        cid, want = c["id"], c.get("want", "less")
        past = [d for d in sorted(log) if d < today and cid in (log[d].get("counts") or {})][-7:]
        hist = [int(log[d]["counts"][cid]) for d in past]
        line = _line(hist, want)
        val = (day.get("counts") or {}).get(cid)
        ok = None
        if val is not None:
            ok = (val >= 1) if want == "yes" else (val <= line if want == "less" and line is not None else
                                                   val >= line if want == "more" and line is not None else None)
        points_today += 1 if ok else 0
        rows.append({"id": cid, "name": c.get("name", cid), "want": want, "today": val, "line": line, "on_line": ok,
                     "last7": hist, "logged_days": len(hist)})
    weeks = []
    for w in range(4):
        end = add_days(today, -7 * w)
        days = [add_days(end, -i) for i in range(7)]
        weeks.append({"ends": end, "points": sum(int(log.get(d, {}).get("points") or 0) for d in days),
                      "logged": sum(1 for d in days if d in log)})
    items = day.get("items") or []
    reels = [{"date": d, "index": i, **it} for d in sorted(log, reverse=True)[:30]
             for i, it in enumerate(x for x in (log[d].get("items") or []) if x.get("kind") == "reel")]
    explain = [r for r in reels if not r.get("explained") and r["date"] < today][:3]
    logged = sum(1 for r in rows if r["today"] is not None)
    say = (f"Today: {logged} of {len(rows)} logged, {plural(points_today, 'point')}."
           + (f" {plural(len(explain), 'reel')} waiting for you to explain what you learned." if explain else ""))
    return {"engine": "life", "version": 1, "status": "ok", "date": today, "counters": rows, "items": items,
            "points_today": points_today, "weeks": weeks, "reels_to_explain": explain, "say": say,
            "rule": "A counter you want less of gets a line: the median of your last 7 logged days minus 10 %. "
                    "On or under it earns a point. A day over it is information, never a reset."}


ENGINE = EngineSpec(
    name="life", version=1, fn=life,
    about="The day in taps: counters with a gentle weekly taper, meals, media and reels with an explain-back.",
    needs=("taps from the Life page",),
    inputs={},
    data={"log": {"type": "dict"}},
)
