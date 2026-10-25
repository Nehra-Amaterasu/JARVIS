"""Proof engine: the GitHub streak, kept honest.

    proof(inputs, today, days=None, user=None, fetched=None) -> dict

days: [{date, commits}] of public activity (github_activity.py fetches and caches it;
this file never does I/O). Out come the current streak, the longest streak in the
window, the last 30 days as a strip of counts, whether today already has proof, and
ONE suggestion for today's proof commit.

Why "proof" and not "commits": a green square from a junk commit fools nobody who
opens the repo. The engine never proposes an empty or generated commit; every
suggestion is a real artefact (a solved problem, a note, a fix), and a streak counts
only days GitHub itself recorded. Pure: the arguments are never changed.
"""
from __future__ import annotations

from typing import Optional

from .ww_base import EngineSpec, add_days, plural

# The suggestion list, in order of how little it asks; the first that fits today wins.
PROOF_IDEAS = (
    ("problem", "Solve one problem (LeetCode, a lab question, a past paper) and commit the solution with a two-line note on the idea."),
    ("note", "Write today's concept as a short Markdown note in your learning repo: what it is, one example, one mistake to avoid."),
    ("fix", "Fix one small thing in JARVIS or Aankhen (a typo, a test, a comment) and commit it."),
)


def _streak_back(active: set[str], start: str) -> int:
    n, d = 0, start
    while d in active:
        n += 1
        d = add_days(d, -1)
    return n


def proof(inputs: dict, today: str, days: Optional[list[dict]] = None, user: Optional[str] = None,
          fetched: Optional[str] = None) -> dict:
    if not user:
        return {"engine": "proof", "version": 1, "status": "ok", "configured": False, "date": today,
                "say": "I don't know your GitHub username yet. Add profile.github to engine-inputs.json."}
    counts: dict[str, int] = {}
    for d in days or []:
        try:
            c = int(d.get("commits") or 0)
        except (TypeError, ValueError):
            c = 0
        if c > 0 and d.get("date") and d["date"] <= today:
            counts[d["date"]] = counts.get(d["date"], 0) + c
    active = set(counts)
    done_today = today in active
    # A streak survives until the day is over: if today has nothing yet, count back from yesterday.
    current = _streak_back(active, today if done_today else add_days(today, -1))
    longest, run, prev = 0, 0, None
    for d in sorted(active):
        run = run + 1 if prev and add_days(prev, 1) == d else 1
        longest, prev = max(longest, run), d
    strip = [{"date": add_days(today, -i), "commits": counts.get(add_days(today, -i), 0)} for i in range(29, -1, -1)]
    last30 = sum(1 for s in strip if s["commits"])
    kind, idea = PROOF_IDEAS[0] if not done_today else ("done", "Today already has proof. Anything more is a bonus, not a debt.")
    if done_today:
        say = f"GitHub: today is green. Streak {plural(current, 'day')}, {last30} of the last 30 days active."
    elif current:
        say = f"GitHub: streak {plural(current, 'day')} and today is still open. {idea}"
    else:
        say = f"GitHub: no streak right now; {last30} of the last 30 days active. Start one today: {idea}"
    return {"engine": "proof", "version": 1, "status": "ok", "configured": True, "date": today, "user": user, "fetched": fetched,
            "current_streak": current, "longest_in_window": longest, "today_done": done_today,
            "active_last_30": last30, "strip": strip, "suggestion": {"kind": kind, "text": idea}, "say": say,
            "note": "Public activity only; GitHub's events feed covers about the last 90 days."}


ENGINE = EngineSpec(
    name="proof", version=1, fn=proof,
    about="GitHub streak from public activity, plus one real proof-of-work idea for today (never a generated commit).",
    needs=("GitHub username", "public activity per day (github_activity.py)"),
    inputs={},
    data={"days": {"type": "list", "items": {"type": "dict", "required": {"date": {"type": "date"}}}},
          "user": {"type": "str", "optional": True},
          "fetched": {"type": "str", "optional": True}},
)
