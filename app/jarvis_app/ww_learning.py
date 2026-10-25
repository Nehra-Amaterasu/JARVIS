"""Learning engine: one new concept a day, and spaced recall of the old ones.

    learning(inputs, today, concepts=None, record=None) -> dict

concepts: [{id, title, body, quiz: [question, ...]}] in teaching order (learn_bank.py
reads them from his private LEARN.md, or a fictional example).
record: {"seen": {id: date first shown}, "reviews": {id: [{date, ok}]}} (the plan state).

The schedule is a Leitner box system, the simplest spaced repetition that works:
a concept sits in box b = number of correct recalls in a row; it is due again
INTERVALS[b] days after the last review (or after it was first shown). A wrong
answer sends it back to box 0, so tomorrow it comes back. Why spaced recall and
not rereading: pulling an answer out of memory is what strengthens it (the
"testing effect"); rereading only feels like learning.

Out come today's new concept (one a day, only once yesterday's is no longer
unseen), the reviews due today with one quiz question each (rotating, so the
same question isn't asked every time), and a spoken summary. Pure.
"""
from __future__ import annotations

from typing import Optional

from .ww_base import EngineSpec, add_days, days_between, plural

INTERVALS = (1, 3, 7, 16, 35, 90)   # days until the next recall, by box
MAX_DUE = 3                          # more than three recalls a day stops being done


def box_of(reviews: list[dict]) -> int:
    b = 0
    for r in reviews:
        b = min(b + 1, len(INTERVALS) - 1) if r.get("ok") else 0
    return b


def due_date(first_seen: str, reviews: list[dict]) -> str:
    last = reviews[-1]["date"] if reviews else first_seen
    return add_days(last, INTERVALS[box_of(reviews)])


def learning(inputs: dict, today: str, concepts: Optional[list[dict]] = None, record: Optional[dict] = None) -> dict:
    concepts = [c for c in (concepts or []) if c.get("id")]
    seen = dict((record or {}).get("seen") or {})
    reviews = (record or {}).get("reviews") or {}
    if not concepts:
        return {"engine": "learning", "version": 1, "status": "ok", "date": today, "new": None, "due": [],
                "say": "No concepts to teach yet."}
    due = []
    for c in concepts:
        if c["id"] not in seen or seen[c["id"]] >= today:
            continue
        revs = [r for r in reviews.get(c["id"], []) if r.get("date", "") <= today]
        when = due_date(seen[c["id"]], revs)
        if when <= today:
            quiz = c.get("quiz") or []
            q = quiz[len(revs) % len(quiz)] if quiz else f"Explain {c['title']} in two sentences."
            due.append({"id": c["id"], "title": c["title"], "question": q, "box": box_of(revs),
                        "overdue_days": days_between(when, today)})
    due.sort(key=lambda d: (d["box"], -d["overdue_days"]))   # weakest and most overdue first
    shown_today = [c for c in concepts if seen.get(c["id"]) == today]
    new = shown_today[0] if shown_today else next((c for c in concepts if c["id"] not in seen), None)
    n_seen = sum(1 for c in concepts if c["id"] in seen)
    parts = []
    if new:
        parts.append(f"Today's concept: {new['title']}.")
    if due:
        parts.append(f"{plural(len(due[:MAX_DUE]), 'recall')} due: " + "; ".join(d["question"] for d in due[:MAX_DUE]))
    if not parts:
        parts.append(f"All {len(concepts)} concepts introduced and nothing due today.")
    return {"engine": "learning", "version": 1, "status": "ok", "date": today,
            "new": {k: new.get(k) for k in ("id", "title", "body", "quiz")} if new else None,
            "due": due[:MAX_DUE], "due_total": len(due), "progress": {"seen": n_seen, "total": len(concepts)},
            "say": " ".join(parts)}


ENGINE = EngineSpec(
    name="learning", version=1, fn=learning,
    about="One new concept a day and spaced recall (Leitner boxes) of the ones already taught.",
    needs=("concepts in teaching order (LEARN.md)", "the recall record"),
    inputs={},
    data={"concepts": {"type": "list", "items": {"type": "dict", "required": {"id": {"type": "str"}, "title": {"type": "str"}}}},
          "record": {"type": "dict"}},
)
