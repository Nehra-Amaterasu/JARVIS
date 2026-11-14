"""Rule tags: which syllabus topic a question belongs to, by words and nothing else.

    topics_of(subject)             -> [Topic]     one per syllabus topic, with its keywords and its key
    tag_question(q, topics)        -> TagResult   the best topic when the rule is certain, else "none"

A topic's keywords are the words of the topic and of its unit title (lower case, no stop words, a
light stem). The score is the cosine between the term-frequency vector of the question's text and the
keyword vector of the topic. The rule is certain only when the best score is at least MIN_SCORE
(0.25) and it leads the second best by at least MIN_MARGIN (0.15): below the first the words barely
overlap, below the second two topics claim the question about equally and a wrong tag would put it
in the wrong counts. These are the numbers of spec 20.7.9 (assumptions to tune against hand tags).
A model is never called here (EW8); an uncertain question stays untagged and carries its top three
candidates so the review screen can offer them.
"""
from __future__ import annotations

import math
import re
from collections import Counter
from typing import Optional, TypedDict

from .. import ww_generator
from .schema import Question, Topic

MIN_SCORE = 0.25
MIN_MARGIN = 0.15

_WORD = re.compile(r"[a-z][a-z0-9]+")
_STOP = frozenset("""a an and are as at be by can for from given has have how if in into is it its of on or that the then
there these this to under using use via was were what when where which while who why will with within without your you
find show state explain define describe write derive obtain calculate determine discuss list give draw sketch prove
consider also each both about between over per than their them they not no any all one two three""".split())


def stem(w: str) -> str:
    """A light suffix strip, enough to join 'transforms' and 'transform'; not a linguistic stemmer."""
    if len(w) > 4 and w.endswith("ies"):
        return w[:-3] + "y"
    if len(w) > 5 and w.endswith("sses"):
        return w[:-2]
    if len(w) > 5 and w.endswith("ing"):
        return w[:-3]
    if len(w) > 4 and w.endswith("ed"):
        return w[:-2]
    if len(w) > 4 and w.endswith("es") and not w.endswith(("ses", "xes")):
        return w[:-2]
    if len(w) > 3 and w.endswith("s") and not w.endswith(("ss", "us", "is")):
        return w[:-1]
    return w


def words(text: str) -> list[str]:
    return [stem(w) for w in _WORD.findall(str(text or "").lower()) if w not in _STOP]


class Candidate(TypedDict, total=False):
    unit: int
    topic: str
    score: float


class TagResult(TypedDict, total=False):
    id: str
    unit: Optional[int]
    topic: str
    score: float
    margin: float
    tag_source: str                   # "rule" or "none"
    candidates: list[Candidate]       # the best three, best first


def topics_of(subject: dict) -> list[Topic]:
    out: list[Topic] = []
    for u in (subject or {}).get("units") or []:
        if u.get("n") is None:
            continue
        unit_words = words(u.get("title") or "")
        for t in u.get("topics") or []:
            kws = list(dict.fromkeys(words(t) + unit_words))
            out.append({"unit": int(u["n"]), "topic": str(t), "key": ww_generator.topic_key(int(u["n"]), str(t)),
                        "keywords": kws, "weight": str(u.get("exam_weight") or "med")})
    return out


def _cosine(a: Counter, b: Counter) -> float:
    dot = sum(c * b.get(w, 0) for w, c in a.items())
    na, nb = math.sqrt(sum(c * c for c in a.values())), math.sqrt(sum(c * c for c in b.values()))
    return dot / (na * nb) if na and nb else 0.0


def tag_question(q: Question, topics: list[Topic]) -> TagResult:
    vec = Counter(words(q.get("text") or ""))
    scored = sorted(((_cosine(vec, Counter(t.get("keywords") or [])), t) for t in topics),
                    key=lambda s: (-s[0], s[1]["unit"], s[1]["topic"]))
    cands = [{"unit": t["unit"], "topic": t["topic"], "score": round(s, 4)} for s, t in scored[:3] if s > 0]
    best = scored[0][0] if scored else 0.0
    second = scored[1][0] if len(scored) > 1 else 0.0
    margin = best - second
    out: TagResult = {"id": str(q.get("id") or ""), "unit": None, "topic": "", "score": round(best, 4),
                      "margin": round(margin, 4), "tag_source": "none", "candidates": cands}
    # compare the unrounded numbers: a rounded 0.2499 must not read as 0.25
    if scored and best >= MIN_SCORE and margin >= MIN_MARGIN:
        out.update(unit=scored[0][1]["unit"], topic=scored[0][1]["topic"], tag_source="rule")
    return out
