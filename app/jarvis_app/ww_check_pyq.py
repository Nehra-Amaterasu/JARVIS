"""Purity gate for the question engine's counting (ww_pyq/tag, families, patterns, next).

    python -m jarvis_app.ww_check_pyq       builds a small invented set in memory, runs every pure
                                            function twice, prints the result; exit 1 on a problem
    ww_check_pyq.report()                   {"ok", "problems", "checked"} for ww_check.report()

The counting must be a function of the papers on file and nothing else: no clock, no random draw, no
dependence on the order the files were read. So each function runs twice, the second time on its
input in reverse order where order must not matter, and any difference is a problem. wilson is also
compared with the closed form worked in exact fractions (an independent route to the same number),
and the tag rule's two cut-offs are checked on what it returned. Nothing here touches the disk.
"""
from __future__ import annotations

import json
import math
import sys
from fractions import Fraction

from .ww_pyq import families, next as pnext, patterns, tag

SUBJECT = {"id": "demo", "units": [
    {"n": 1, "title": "Signals and systems", "exam_weight": "high", "topics": ["Convolution sum", "Fourier series"]},
    {"n": 2, "title": "Laplace transform", "exam_weight": "med", "topics": ["Inverse Laplace transform", "Region of convergence"]}]}


def _synthetic() -> tuple[list[dict], list[dict]]:
    papers = [{"id": f"p-{i}", "year": 2020 + i, "title": f"Demo {2020 + i}", "total_marks": 50.0} for i in range(5)]
    qs = []
    for i in range(5):
        spec = [("Convolution sum", 1, f"Find the convolution sum of x[n] and h[n] for case {i}.", 10),
                ("Convolution sum", 1, f"State a property of the convolution sum, variant {i}.", 4)]
        if i < 4:
            spec.append(("Fourier series", 1, f"Expand the periodic wave number {i} in a Fourier series.", 10))
        if i < 3:
            spec += [("Inverse Laplace transform", 2, f"Invert transform number {i} using the inverse Laplace transform.", 10),
                     ("Region of convergence", 2, f"Sketch the region of convergence for pole set {i}.", 8)]
        for j, (topic, unit, text, marks) in enumerate(spec):
            qs.append({"id": f"q-{i}{j}", "paper_id": f"p-{i}", "text": text, "status": "accepted", "marks": marks,
                       "unit": unit, "topic": topic, "tag_source": "hand"})
    qs.append({"id": "q-u", "paper_id": "p-0", "text": "Explain the idea of a transform in your own words.", "status": "accepted",
               "marks": 5, "unit": None, "topic": "", "tag_source": "none"})
    return papers, qs


def _same(label: str, a, b, problems: list[str]) -> None:
    if json.dumps(a, sort_keys=True, default=str) != json.dumps(b, sort_keys=True, default=str):
        problems.append(f"{label} gave two different answers on the same papers")


def _exact_wilson(k: int, n: int) -> tuple[float, float]:
    z, kk, nn = Fraction(196, 100), Fraction(k), Fraction(n)
    p = kk / nn
    denom = 1 + z * z / nn
    centre = (p + z * z / (2 * nn)) / denom
    half = Fraction(math.sqrt(float(p * (1 - p) / nn + z * z / (4 * nn * nn)))) * z / denom
    return float(max(Fraction(0), centre - half)), float(min(Fraction(1), centre + half))


def report() -> dict:
    problems: list[str] = []
    checked = 0
    papers, qs = _synthetic()
    rpapers, rqs = list(reversed(papers)), list(reversed(qs))

    a, b = tag.topics_of(SUBJECT), tag.topics_of(SUBJECT)
    _same("topics_of", a, b, problems)
    checked += 1

    ta = [tag.tag_question(q, a) for q in qs]
    tb = [tag.tag_question(q, b) for q in rqs]
    _same("tag_question", ta, list(reversed(tb)), problems)
    for r in ta:
        if r["tag_source"] == "rule" and not (r["score"] >= tag.MIN_SCORE and r["margin"] >= tag.MIN_MARGIN):
            problems.append(f"tag_question tagged {r['id']} below its cut-offs")
    checked += 1

    _same("find_families", families.find_families(qs), families.find_families(rqs), problems)
    checked += 1

    worst = 0.0
    for n in range(0, 11):
        for k in range(0, n + 1):
            if n == 0:
                if patterns.wilson(0, 0) != (0.0, 1.0):
                    problems.append("wilson(0, 0) is not (0.0, 1.0)")
                continue
            lo, hi = patterns.wilson(k, n)
            elo, ehi = _exact_wilson(k, n)
            worst = max(worst, abs(lo - elo), abs(hi - ehi))
    if worst > 1e-9:
        problems.append(f"wilson differs from its closed form by {worst:.2e}")
    checked += 1

    pa = patterns.compute_patterns(qs, papers)
    pb = patterns.compute_patterns(rqs, rpapers)
    _same("compute_patterns", pa, pb, problems)
    for t in pa["topics"]:
        if not (0 <= t["k"] <= t["n"] and 0.0 <= t["low"] <= t["k"] / t["n"] <= t["high"] <= 1.0):
            problems.append(f"compute_patterns: {t['key']} has k, n or its interval out of order")
    if pa["n_papers"] != 5 or pa["provisional"]:
        problems.append("compute_patterns miscounted the invented set (5 papers, over the floor)")
    checked += 1

    _same("quiet_topics", patterns.quiet_topics(qs, papers), patterns.quiet_topics(rqs, rpapers), problems)
    checked += 1

    _same("practise_next", pnext.practise_next(pa, {}, 90), pnext.practise_next(pb, {}, 90), problems)
    picks = pnext.practise_next(pa, {}, 90)
    if sum(p["terms"]["minutes"] for p in picks) > 90:
        problems.append("practise_next filled more minutes than the gap")
    checked += 1
    return {"ok": not problems, "problems": problems, "checked": checked}


def main(argv=None) -> int:
    r = report()
    print(f"ww_check_pyq: {'ok' if r['ok'] else 'PROBLEMS'}; {r['checked']} functions checked twice")
    for p in r["problems"]:
        print("  " + p)
    return 0 if r["ok"] else 1


if __name__ == "__main__":
    sys.exit(main())
