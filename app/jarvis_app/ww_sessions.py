"""Work-sessions engine: hours of building, read back from the commits they left.

    sessions(inputs, today, commits=None, imported=None) -> dict

commits: [{sha, ts (unix seconds), repo, subject, url?}] from the local git repos
he names in Settings (github_activity.local_commits reads them).
imported: the session ids already logged into the plan (so nothing counts twice).

A session is a run of commits with no gap longer than GAP_MIN between two of
them. Its length is last commit - first commit + LEAD_MIN, because work starts
before the first commit lands (reading, prompting, testing). A lone commit counts
LEAD_MIN. These two numbers are the whole model; they are written here so they can
be argued with. What is counted is real (the commits exist, with links); the
minutes are an estimate from their timestamps, and the card says so.

The area of a commit comes from its conventional-commit scope, "feat(aankhen): ..."
-> aankhen; a commit without a scope takes the repo's name. Pure.
"""
from __future__ import annotations

import re
from datetime import datetime, timedelta, timezone
from typing import Optional

from .ww_base import EngineSpec, add_days, plural

IST = timezone(timedelta(hours=5, minutes=30))
GAP_MIN = 90       # vibe coding: long reads and test runs between commits are normal
LEAD_MIN = 30      # work before the first commit of a session
MAX_SESSION = 8 * 60
_SCOPE = re.compile(r"^\w+\(([\w./-]+)\)!?:")


# Old names of the same part, so one area is not split three ways.
ALIASES = {"mission": "well-wisher", "germoney": "well-wisher", "wellwisher": "well-wisher", "jarvis": "JARVIS"}


def area_of(subject: str, repo: str) -> str:
    m = _SCOPE.match(subject or "")
    a = m.group(1).lower() if m else repo
    return ALIASES.get(a, a)


def _local(ts: float) -> datetime:
    return datetime.fromtimestamp(ts, IST)


def group(commits: list[dict]) -> list[dict]:
    cs = sorted((c for c in commits if isinstance(c.get("ts"), (int, float))), key=lambda c: c["ts"])
    out: list[list[dict]] = []
    for c in cs:
        if out and (c["ts"] - out[-1][-1]["ts"]) / 60 <= GAP_MIN:
            out[-1].append(c)
        else:
            out.append([c])
    rows = []
    for run in out:
        span = (run[-1]["ts"] - run[0]["ts"]) / 60
        minutes = int(min(MAX_SESSION, round(span + LEAD_MIN)))
        start = _local(run[0]["ts"] - LEAD_MIN * 60)
        areas: dict[str, int] = {}
        for c in run:
            a = area_of(c.get("subject", ""), c.get("repo", "work"))
            areas[a] = areas.get(a, 0) + 1
        rows.append({"id": f"ws-{run[0]['sha'][:12]}", "date": _local(run[-1]["ts"]).date().isoformat(),
                     "start": start.strftime("%H:%M"), "end": _local(run[-1]["ts"]).strftime("%H:%M"),
                     "minutes": minutes, "commits": len(run), "areas": areas,
                     "main_area": max(areas, key=lambda a: (areas[a], a)),
                     "subjects": [c.get("subject", "")[:120] for c in run][:8],
                     "link": run[-1].get("url")})
    return rows


def sessions(inputs: dict, today: str, commits: Optional[list[dict]] = None, imported: Optional[list[str]] = None) -> dict:
    rows = group(commits or [])
    done = set(imported or [])
    for r in rows:
        r["imported"] = r["id"] in done
    since = add_days(today, -13)
    days = []
    for i in range(14):
        d = add_days(since, i)
        days.append({"date": d, "minutes": sum(r["minutes"] for r in rows if r["date"] == d)})
    week = [r for r in rows if r["date"] >= add_days(today, -6)]
    areas: dict[str, int] = {}
    for r in week:
        for a, n in r["areas"].items():
            # A session's minutes are split across its areas by commit count.
            areas[a] = areas.get(a, 0) + round(r["minutes"] * n / r["commits"])
    today_min = sum(r["minutes"] for r in rows if r["date"] == today)
    pending = [r for r in rows if not r["imported"] and r["date"] >= since]
    if not commits:
        say = "No commits found in the repos named in Settings, so no building hours to count yet."
    else:
        say = (f"Building today: {plural(today_min, 'minute')} across "
               f"{plural(sum(1 for r in rows if r['date'] == today), 'session')}. This week: {round(sum(r['minutes'] for r in week) / 60, 1)} h.")
    return {"engine": "sessions", "version": 1, "status": "ok", "date": today,
            "sessions": [r for r in rows if r["date"] >= since][::-1][:40], "days": days,
            "today_minutes": today_min, "week_minutes": sum(r["minutes"] for r in week),
            "week_areas": dict(sorted(areas.items(), key=lambda kv: -kv[1])), "pending": [r["id"] for r in pending],
            "model": {"gap_minutes": GAP_MIN, "lead_minutes": LEAD_MIN,
                      "explain": f"Commits less than {GAP_MIN} min apart are one session; each session also counts "
                                 f"{LEAD_MIN} min before its first commit. Minutes are estimated from timestamps; the commits are real."},
            "say": say}


ENGINE = EngineSpec(
    name="sessions", version=1, fn=sessions,
    about="Hours of building, estimated from the timestamps of real commits, split by area.",
    needs=("local git repos (Settings)",),
    inputs={},
    data={"commits": {"type": "list", "items": {"type": "dict", "required": {"sha": {"type": "str"}, "ts": {"type": "num"}}}},
          "imported": {"type": "list", "items": {"type": "str"}}},
)
