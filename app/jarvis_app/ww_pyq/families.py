"""Families: the same question set again with other numbers.

    find_families(qs, years_by_paper=None) -> [Family]

Two questions are one family when their normalised text shares at least JACCARD (0.8) of its
5-word shingles. Normalising lower-cases, turns every number into "#" and drops the unit written
after it, so "R = 10 kΩ" and "R = 4.7 kΩ" read the same: the numbers change between sittings and the
question does not. 5 words is long enough that two different questions on one topic share few
shingles, short enough that a one-line question still has one; a question under 5 words has no
shingle to compare and is its own family. Merging is transitive (union-find). A family id is
"f-" plus a short hash of its sorted member ids, so it is the same on every run and in any input
order; `confirmed` is false until he confirms a family (EW8). Every question is in exactly one
family, a single question included; compute_patterns reports only the repeated ones.
"""
from __future__ import annotations

import hashlib
import re
from typing import Optional, TypedDict

from .schema import Question

SHINGLE = 5
JACCARD = 0.8

_NUM = re.compile(r"\d+(?:[.,]\d+)*")
# a unit right after a number: an SI prefix and a symbol, or a word for it
_UNIT = re.compile(r"(?<=#)\s*(?:[kmµμunp]?(?:ω|ohms?|hz|v|a|f|h|s|w|db|rad|g|m|n|j|c|k)|degrees?|deg|percent|%|°)\b", re.I)
_PUNCT = re.compile(r"[^\w#]+", re.U)


class Family(TypedDict, total=False):
    id: str
    question_ids: list[str]
    years: list[Optional[int]]
    confirmed: bool


def normalise(text: str) -> str:
    t = _NUM.sub("#", str(text or "").lower())
    t = _UNIT.sub("", t)
    # a symbol that follows "#" but is not in the list still must not split the shingle: drop lone unit tails
    t = _PUNCT.sub(" ", t)
    return re.sub(r"\s+", " ", t).strip()


def shingles(norm: str) -> frozenset:
    w = norm.split()
    if len(w) < SHINGLE:
        return frozenset()
    return frozenset(" ".join(w[i:i + SHINGLE]) for i in range(len(w) - SHINGLE + 1))


def _jaccard(a: frozenset, b: frozenset) -> float:
    return len(a & b) / len(a | b) if a and b else 0.0


def family_id(ids) -> str:
    return "f-" + hashlib.sha1("|".join(sorted(ids)).encode("utf-8")).hexdigest()[:10]


def find_families(qs: list[Question], years_by_paper: Optional[dict] = None) -> list[Family]:
    rows = [(str(q.get("id") or ""), shingles(normalise(q.get("text") or "")), q.get("paper_id")) for q in qs]
    parent = list(range(len(rows)))

    def find(i: int) -> int:
        while parent[i] != i:
            parent[i] = parent[parent[i]]
            i = parent[i]
        return i

    for i in range(len(rows)):
        if not rows[i][1]:
            continue
        for j in range(i + 1, len(rows)):
            if rows[j][1] and _jaccard(rows[i][1], rows[j][1]) >= JACCARD:
                parent[find(j)] = find(i)
    groups: dict[int, list[int]] = {}
    for i in range(len(rows)):
        groups.setdefault(find(i), []).append(i)
    out: list[Family] = []
    for members in groups.values():
        ids = sorted(rows[i][0] for i in members)
        years = sorted({(years_by_paper or {}).get(rows[i][2]) for i in members} - {None}) if years_by_paper else []
        out.append({"id": family_id(ids), "question_ids": ids, "years": years, "confirmed": False})
    return sorted(out, key=lambda f: (f["question_ids"][0], f["id"]))
