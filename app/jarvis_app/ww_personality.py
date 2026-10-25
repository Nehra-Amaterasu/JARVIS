"""Personality engine: his profile -> how the day is framed, never what it is for.

    personality(inputs, today, contracts=None, open_projects=None, active_days=None) -> dict

Reads inputs["profile"] (traits, weak points, preferences) and inputs["rules"].
Four things come out:

  * style: which framings apply, each with the profile line that switched it on
      novelty_first  (creative / problem solver / puzzle / novelty) -> try it cold first
      finish_lines   (follow-through / finishing / drops things)    -> a sprint with a done-when
      variety        (variety / loses interest / bored / routine)   -> no two of a kind in a row
      stretch        (challenge / hard / expert)                    -> one stretch version a day
    No profile, no framing: the contracts are passed through plainly.
  * the project cap: at most 3 open projects, whatever the inputs say (a hard cap);
    past it, a new idea goes to the parking lot.
  * gap recovery: after `recovery_after_days` (default 2) without a logged action,
    the day shrinks to two contracts and the first becomes a 15-minute version.
    The words are plain and kind; nothing about what was missed beyond the count.
  * framed: each open contract as a contract (title, done-when, minutes), in an
    order with variety.
Pure: no I/O, the arguments are never changed.
"""
from __future__ import annotations

import re
from typing import Optional

from .ww_base import EngineSpec, add_days, days_between, plural

HARD_CAP = 3
FLAGS = {
    "novelty_first": re.compile(r"creative|problem[- ]solv|puzzle|novelty|curious", re.I),
    "finish_lines": re.compile(r"follow[- ]?through|finish|drops? (things|projects)|starts? (things|many)|leaves? .*incomplete", re.I),
    "variety": re.compile(r"variety|loses? interest|bored|rigid routine|routine drains", re.I),
    "stretch": re.compile(r"challenge|hard problems|expert|stretch", re.I),
}


def style_from(profile: dict) -> dict:
    lines = [*profile.get("traits", []), *profile.get("weak_points", []), *profile.get("prefers", [])]
    out = {}
    for flag, rx in FLAGS.items():
        hit = next((s for s in lines if rx.search(s)), None)
        out[flag] = {"on": hit is not None, "from": hit}
    return out


def project_cap(rules: dict, open_projects: list[dict]) -> dict:
    cap = max(1, min(HARD_CAP, int(rules.get("max_open_projects") or HARD_CAP)))
    n = len(open_projects)
    room = cap - n
    if room > 0:
        say = f"{n} of {cap} projects open: room for {room} more."
    elif room == 0:
        say = f"{n} of {cap} projects open: a new idea goes to the parking lot until one ships or is dropped."
    else:
        say = f"{n} projects are open and the cap is {cap}: finishing or pausing {-room} gets back under it."
    return {"cap": cap, "open": n, "room": max(0, room), "over": room < 0, "projects": [p.get("title") or p.get("id") for p in open_projects],
            "say": say}


def gap(active_days: list[str], today: str, after: int) -> dict:
    past = sorted(d for d in active_days if d < today)
    if today in active_days:
        return {"last_active": today, "idle_days": 0, "mode": "normal", "say": None}
    if not past:
        return {"last_active": None, "idle_days": None, "mode": "normal", "say": None}
    idle = days_between(past[-1], today) - 1                # whole days in between with nothing logged
    if idle < after:
        return {"last_active": past[-1], "idle_days": idle, "mode": "normal", "say": None}
    return {"last_active": past[-1], "idle_days": idle, "mode": "recovery",
            "say": f"Welcome back. {plural(idle, 'day')} off happens. Today is two short contracts, and the first one takes 15 minutes."}


def _variety(cs: list[dict]) -> list[dict]:
    """Greedy reorder: never two of the same branch (or node) back to back when another is left."""
    left, out = list(cs), []
    while left:
        prev = out[-1] if out else None
        pick = next((c for c in left if prev is None or (c.get("branch") or c.get("node_id")) != (prev.get("branch") or prev.get("node_id"))),
                    left[0])
        out.append(pick)
        left.remove(pick)
    return out


def frame(c: dict, style: dict, sprint: int, short: bool) -> dict:
    minutes = int(c.get("minutes") or sprint)
    if short:
        minutes = min(minutes, 15)
    done_when = c.get("success_check") or "you can show the result to someone"
    parts = [f"Contract: {c.get('title')}.", f"Done when: {done_when}"]
    if short:
        parts.append("A 15-minute version: stop when the timer ends, finished or not.")
    elif style["finish_lines"]["on"]:
        parts.append(f"One {minutes}-minute sprint with that finish line.")
    if style["novelty_first"]["on"] and c.get("source") == "tree":
        parts.append("Try it cold for ten minutes before reading anything.")
    return {"key": c.get("key"), "title": c.get("title"), "minutes": minutes, "frame": " ".join(p if p.endswith(".") else p + "." for p in parts)}


def personality(inputs: dict, today: str, contracts: Optional[list[dict]] = None, open_projects: Optional[list[dict]] = None,
                active_days: Optional[list[str]] = None) -> dict:
    profile = inputs.get("profile") or {}
    rules = inputs.get("rules") or {}
    style = style_from(profile)
    known = any(v["on"] for v in style.values())
    after = max(1, int(rules.get("recovery_after_days") or 2))
    sprint = int(rules.get("sprint_minutes") or 45)
    g = gap(list(active_days or []), today, after)
    recovery = g["mode"] == "recovery"
    n_today = 2 if recovery else 3
    open_c = [c for c in contracts or [] if isinstance(c, dict) and not c.get("done")]
    ordered = _variety(open_c) if style["variety"]["on"] else list(open_c)
    if recovery:                                       # the shortest one first
        ordered.sort(key=lambda c: int(c.get("minutes") or sprint))
    framed = [frame(c, style, sprint, short=recovery and i == 0) for i, c in enumerate(ordered)]
    applied = []
    if style["novelty_first"]["on"]:
        applied.append("Puzzle first: try a tree contract cold for ten minutes, then read")
    if style["finish_lines"]["on"]:
        applied.append(f"Every contract is one sprint (about {sprint} minutes) with a written finish line")
    if style["variety"]["on"]:
        applied.append("Variety: no two contracts of the same kind back to back")
    if style["stretch"]["on"]:
        applied.append("One stretch version a day, optional")
    applied.append(f"At most {project_cap(rules, [])['cap']} open projects; new ideas wait in the parking lot")
    if recovery:
        applied.append("After a gap: two contracts, the first a 15-minute version")
    return {"engine": "personality", "version": 1, "status": "ok", "date": today, "profile_known": known,
            "style": style, "cap": project_cap(rules, [p for p in open_projects or [] if isinstance(p, dict)]),
            "gap": g, "n_today": n_today, "framed": framed, "rules_applied": applied,
            "next_check": add_days(today, 1), "never_shame": True}


ENGINE = EngineSpec(
    name="personality", version=1, fn=personality,
    about="Framing from the profile (puzzle first, finish lines, variety), the hard cap of 3 open projects, recovery after missed days.",
    needs=("profile traits", "rules", "open projects", "days with a logged action"),
    inputs={"profile": {"type": "dict", "required": {"traits": {"type": "list", "items": {"type": "str"}},
                                                      "weak_points": {"type": "list", "items": {"type": "str"}},
                                                      "prefers": {"type": "list", "items": {"type": "str"}}}},
            "rules": {"type": "dict", "required": {"max_open_projects": {"type": "int"}}}},
    data={"contracts": {"type": "list", "items": {"type": "dict"}},
          "open_projects": {"type": "list", "items": {"type": "dict"}},
          "active_days": {"type": "list", "items": {"type": "date"}}},
)
