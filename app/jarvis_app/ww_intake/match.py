"""Name match for the manual intake: token Jaccard on lower-cased alphanumeric tokens.

    match_name(a, b) -> float in [0.0, 1.0]

Pure: no clock, no file, no network, no state. The specification's course-to-subject mapping
(21.4.3) suggests a mapping at 0.6 or more and calls anything below "unmapped"; this function only
returns the score and leaves that threshold to the caller, so the threshold is written once in
the store that applies it.

Why Jaccard on token sets: a course title and a subject name differ in word order, case and
punctuation ("Signals & Systems" against "systems, signals") and the score must not depend on
any of them, so the answer is symmetric and ignores order and repeats.
"""
from __future__ import annotations

import re

# [^\W_]+ is "letters and digits of any script, no underscore": a name in another script still
# splits into tokens instead of vanishing the way an ASCII-only class would make it.
_TOKEN = re.compile(r"[^\W_]+")


def _tokens(s: str) -> frozenset[str]:
    return frozenset(_TOKEN.findall((s or "").lower()))


def match_name(a: str, b: str) -> float:
    """Token Jaccard of two names: 1.0 for equal token sets, 0.0 for disjoint or empty ones."""
    ta, tb = _tokens(a), _tokens(b)
    if not ta or not tb:
        return 0.0
    return len(ta & tb) / len(ta | tb)
