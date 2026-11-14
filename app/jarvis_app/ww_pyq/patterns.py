"""Counted patterns over the papers he has accepted, with their N and an honest interval.

    wilson(k, n, z=1.96)                              -> (low, high)    the Wilson score interval of k out of n
    compute_patterns(qs, papers, floor_papers, floor_questions) -> PatternSet
    quiet_topics(qs, papers, r=3)                     -> [topic key]    seen, but not in the last r papers

Everything here is a count of what is on file. A topic's k is the number of papers that set it, N
the number of papers with at least one accepted question; the interval says how far k / N can be
trusted with that few papers (Wilson, because it stays inside 0..1 and is honest at k = 0 and k = N,
where the plain normal interval is not). Nothing is a forecast: the sentence restates the counts.

Only ACCEPTED questions that carry a unit and a topic are counted (a pending or rejected question
is not evidence, an untagged one has no topic); the untagged accepted ones are counted in
`n_untagged` so the screen can say how many are still waiting for a tag. The floor (3 papers and 20
counted questions, spec 20.7.9, assumptions to tune) is a flag, not a gate: below it the numbers
are still returned, with `provisional` true and what is still needed in `floor`.

No clock is read: years_since is measured from the newest paper's year, so the same files give the
same answer on any day (the gate compares two runs).
"""
from __future__ import annotations

import math
from itertools import combinations
from statistics import median
from typing import Optional, TypedDict

from .. import ww_generator
from .families import Family, find_families
from .schema import FLOOR_PAPERS, FLOOR_QUESTIONS, PaperMeta, Question

PAIR_MIN_PAPERS = 4        # fewer papers than this: a pair of topics is chance co-occurrence, not a pattern
PAIR_MIN_SHARED = 3        # a pair is listed only when it shares at least this many papers
QUIET_R = 3


class TopicCount(TypedDict, total=False):
    key: str
    unit: int
    topic: str
    k: int
    n: int
    low: float
    high: float
    last_year: Optional[int]
    years_since: Optional[int]
    marks_weight: dict
    typical_marks: Optional[float]
    questions: list[str]


class PatternSet(TypedDict, total=False):
    n_papers: int
    n_questions: int
    n_untagged: int
    papers: list[dict]
    topics: list[TopicCount]
    pairs: list[dict]
    quiet: dict
    families: list[Family]
    sentence: str
    floor: dict
    provisional: bool


def wilson(k: int, n: int, z: float = 1.96) -> tuple[float, float]:
    if n <= 0:
        return 0.0, 1.0
    p = k / n
    denom = 1 + z * z / n
    centre = (p + z * z / (2 * n)) / denom
    half = z * math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / denom
    # at k = 0 the lower bound and at k = n the upper bound are exactly 0 and 1; float arithmetic lands a hair off
    return (0.0 if k <= 0 else max(0.0, centre - half)), (1.0 if k >= n else min(1.0, centre + half))


def _counted(qs: list[Question]) -> list[Question]:
    return [q for q in qs if q.get("status") == "accepted" and q.get("unit") is not None and q.get("topic")]


def _key(q: Question) -> str:
    return ww_generator.topic_key(q["unit"], str(q["topic"]))


def _ordered(papers: list[PaperMeta]) -> list[PaperMeta]:
    """Oldest first: by year, a paper without a year before every dated one, then by when it was added."""
    return sorted(papers, key=lambda p: (p.get("year") is not None, p.get("year") or 0, p.get("added") or "", p.get("id") or ""))


def _with_accepted(qs: list[Question], papers: list[PaperMeta]) -> list[PaperMeta]:
    have = {q.get("paper_id") for q in qs if q.get("status") == "accepted"}
    return [p for p in papers if p.get("id") in have]


def quiet_topics(qs: list[Question], papers: list[PaperMeta], r: int = QUIET_R) -> list[str]:
    on_file = _ordered(_with_accepted(qs, papers))
    recent = {p["id"] for p in on_file[-min(r, len(on_file)):]} if on_file else set()
    seen_before, seen_recent = set(), set()
    ids = {p["id"] for p in on_file}
    for q in _counted(qs):
        if q.get("paper_id") not in ids:
            continue
        (seen_recent if q["paper_id"] in recent else seen_before).add(_key(q))
    return sorted(seen_before - seen_recent)


def _plural(n: int, one: str, many: str) -> str:
    return f"{n} {one if n == 1 else many}"


def compute_patterns(qs: list[Question], papers: list[PaperMeta], floor_papers: int = FLOOR_PAPERS,
                     floor_questions: int = FLOOR_QUESTIONS) -> PatternSet:
    on_file = _ordered(_with_accepted(qs, papers))
    ids = {p["id"] for p in on_file}
    N = len(on_file)
    counted = [q for q in _counted(qs) if q.get("paper_id") in ids]
    accepted_all = [q for q in qs if q.get("status") == "accepted" and q.get("paper_id") in ids]
    years = {p["id"]: p.get("year") for p in on_file}
    newest = max((y for y in years.values() if y is not None), default=None)
    # the paper's own total when printed; else what its accepted questions add up to
    totals = {}
    for p in on_file:
        t = p.get("total_marks")
        totals[p["id"]] = float(t) if t else sum(float(q.get("marks") or 0) for q in accepted_all if q["paper_id"] == p["id"])

    by_topic: dict[str, list[Question]] = {}
    for q in counted:
        by_topic.setdefault(_key(q), []).append(q)
    topics: list[TopicCount] = []
    paper_sets: dict[str, set] = {}
    for key, rows in by_topic.items():
        in_papers = sorted({q["paper_id"] for q in rows})
        paper_sets[key] = set(in_papers)
        weights = []
        for pid in in_papers:
            if totals.get(pid):
                weights.append(sum(float(q.get("marks") or 0) for q in rows if q["paper_id"] == pid) / totals[pid])
        lo, hi = wilson(len(in_papers), N)
        dated = [years[pid] for pid in in_papers if years.get(pid) is not None]
        last = max(dated) if dated else None
        marks = [float(q["marks"]) for q in rows if q.get("marks") is not None]
        topics.append({
            "key": key, "unit": rows[0]["unit"], "topic": str(rows[0]["topic"]), "k": len(in_papers), "n": N,
            "low": round(lo, 4), "high": round(hi, 4), "last_year": last,
            "years_since": (newest - last) if (last is not None and newest is not None) else None,
            "marks_weight": ({"mean": round(sum(weights) / len(weights), 4), "min": round(min(weights), 4), "max": round(max(weights), 4)}
                             if weights else {"mean": None, "min": None, "max": None}),
            "typical_marks": float(median(marks)) if marks else None,
            "questions": sorted(q["id"] for q in rows)})
    topics.sort(key=lambda t: (-t["k"], t["unit"], t["topic"]))

    pairs = []
    if N >= PAIR_MIN_PAPERS:
        for a, b in combinations(sorted(paper_sets), 2):
            shared = len(paper_sets[a] & paper_sets[b])
            if shared >= PAIR_MIN_SHARED:
                pairs.append({"a": a, "b": b, "k": shared, "n": N})
        pairs.sort(key=lambda p: (-p["k"], p["a"], p["b"]))

    fams = [f for f in find_families(counted, years) if len(f["question_ids"]) >= 2]
    quiet = {"r": min(QUIET_R, N), "topics": quiet_topics(qs, papers, QUIET_R)}
    need_p, need_q = max(0, floor_papers - N), max(0, floor_questions - len(counted))
    return {
        "n_papers": N, "n_questions": len(counted), "n_untagged": len(accepted_all) - len(counted),
        "papers": [{"id": p["id"], "year": p.get("year"), "title": str(p.get("title") or "")} for p in on_file],
        "topics": topics, "pairs": pairs, "quiet": quiet, "families": fams,
        "sentence": _sentence(N, len(counted), topics, quiet, fams),
        "floor": {"papers": floor_papers, "questions": floor_questions, "papers_needed": need_p, "questions_needed": need_q},
        "provisional": bool(need_p or need_q)}


def _sentence(n_papers: int, n_q: int, topics: list[TopicCount], quiet: dict, fams: list[Family]) -> str:
    if not n_papers or not topics:
        return "No accepted question carries a topic yet."
    top = topics[0]
    s = (f"{_plural(n_papers, 'paper', 'papers')} on file with {_plural(n_q, 'counted question', 'counted questions')}; "
         f"{top['topic']} was set in {top['k']} of {top['n']}")
    if len(topics) > 1 and topics[1]["k"] == top["k"]:
        s += f", as were {_plural(sum(1 for t in topics if t['k'] == top['k']) - 1, 'other topic', 'other topics')}"
    s += "."
    if quiet["topics"]:
        s += f" {_plural(len(quiet['topics']), 'topic', 'topics')} set before but not in the last {_plural(quiet['r'], 'paper', 'papers')}."
    if fams:
        s += f" {_plural(len(fams), 'question set', 'question sets')} came back with other numbers."
    return s
