"""Practise next: the topics where an hour of work moves the most marks, from counts he can check.

    practise_next(patterns, proficiency, gap_minutes, *, attempts=None, minutes_per_mark=3.0) -> [Pick]

For every topic with at least MIN_QUESTIONS (3) accepted questions:

    gain    = marks_weight mean  x  (k / N)  x  (1 - proficiency)
    minutes = marks of a typical question  x  minutes_per_mark

marks_weight is the share of a paper's marks the topic took when it was set, k / N the share of papers
that set it, proficiency how well he does it (0..1). The picks are ranked by gain per minute and
filled greedily into the gap, never three in a row from one unit (a block of one unit is a poor use
of a gap; two still lets a deep topic have a pair). The terms of every pick are printed with it, so
he can disagree with a number instead of trusting a ranking.

Proficiency is MEASURED only from MIN_ATTEMPTS (5) marked attempts at the topic (the same count after
which a paper's marks stop being a handful of lucky answers); with fewer the term is 0.5 and
`measured` is false, whatever the caller passed. `attempts` is {topic key: marked attempts}; a call
without it treats every topic as unmeasured. 3.0 minutes per mark is a starting assumption (a 10 mark
answer takes about half an hour of practice including checking it); it is an argument so a screen can
let him change it, and the figure used is printed in every pick.
"""
from __future__ import annotations

from typing import Optional, TypedDict

from .patterns import PatternSet

MIN_QUESTIONS = 3
MIN_ATTEMPTS = 5
MINUTES_PER_MARK = 3.0
UNMEASURED = 0.5
MAX_RUN = 2


class Pick(TypedDict, total=False):
    key: str
    unit: int
    topic: str
    gain: float
    terms: dict               # {marks_weight, seen_share, proficiency, measured, minutes}
    question_ids: list[str]
    reason: str


def _plural(n: int, one: str, many: str) -> str:
    return f"{n} {one if n == 1 else many}"


def practise_next(patterns: PatternSet, proficiency: dict[str, float], gap_minutes: int, *,
                  attempts: Optional[dict[str, int]] = None, minutes_per_mark: float = MINUTES_PER_MARK) -> list[Pick]:
    attempts = attempts or {}
    cands: list[tuple[float, Pick]] = []
    for t in patterns.get("topics") or []:
        mw = (t.get("marks_weight") or {}).get("mean")
        typical = t.get("typical_marks")
        if len(t.get("questions") or []) < MIN_QUESTIONS or mw is None or not typical or typical <= 0 or not t.get("n"):
            continue
        n_att = int(attempts.get(t["key"], 0))
        measured = n_att >= MIN_ATTEMPTS and t["key"] in proficiency
        prof = float(proficiency[t["key"]]) if measured else UNMEASURED
        share = t["k"] / t["n"]
        minutes = round(float(typical) * float(minutes_per_mark), 2)
        gain = mw * share * (1 - prof)
        if minutes <= 0:
            continue
        reason = (f"set in {t['k']} of {t['n']} papers on file; "
                  + ("no marked attempts" if n_att == 0 else _plural(n_att, "marked attempt", "marked attempts")))
        cands.append((gain / minutes, {
            "key": t["key"], "unit": t["unit"], "topic": t["topic"], "gain": round(gain, 6),
            "terms": {"marks_weight": mw, "seen_share": round(share, 4), "proficiency": round(prof, 3),
                      "measured": measured, "minutes": minutes},
            "question_ids": list(t["questions"]), "reason": reason}))
    cands.sort(key=lambda c: (-c[0], c[1]["key"]))
    left = [p for _, p in cands]
    picks: list[Pick] = []
    remaining = float(gap_minutes)
    while left:
        for i, p in enumerate(left):
            run = [x["unit"] for x in picks[-MAX_RUN:]]
            if p["terms"]["minutes"] > remaining:
                continue
            if len(run) == MAX_RUN and all(u == p["unit"] for u in run):
                continue
            picks.append(left.pop(i))
            remaining -= p["terms"]["minutes"]
            break
        else:
            break
    return picks
