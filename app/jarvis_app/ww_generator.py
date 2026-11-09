"""Practice-paper generator and per-topic proficiency (Sprint 2, items 5 and 6). Pure.

    proficiency(states, marks) -> {topic_key: p}
    generate(exam, bank, units, states, marks, seed, tier) -> a paper that fits the exam's pattern
    as_markdown(paper) -> the paper as text for the Reader or the phone

The pattern comes from the exam (Settings), read off the real papers: JSS SEE Jun 2026
(QP 10424401/02/06) is A: 5 × 2 marks, B: 10 set / 5 attempted × 7, C: 5 set / 3 attempted × 5,
total 60. The bank is academics.json's question_bank (the real papers, transcribed) plus
whatever he adds; every question keeps its source line.

Proficiency per topic (6 Nov review): an exponentially weighted mean of marks got ÷ marks
available over his attempts, newest weighted most (alpha 0.5), seeded by his tap: none 0.1,
learned 0.5, solid 0.8. It rises when he improves and cannot run away. A topic the syllabus
does not name takes its unit's mean.

Topic weight = unit weight (high 3, med 2, low 1) × smoothed past-paper frequency
((count + 1)/(papers + 2)) × (1 − p): a topic never asked still gets practised, one old paper
cannot dominate, weak topics come up more. Picking is weighted sampling without replacement
with a fixed seed, so the same seed is the same paper and a new seed is a new one.
"""
from __future__ import annotations

import random
from typing import Optional

SEED_P = {"none": 0.1, "learned": 0.5, "solid": 0.8}
ALPHA = 0.5
WEIGHT = {"high": 3, "med": 2, "low": 1}
TIERS = ("exam", "gate")
# JSS SEE, 60 marks: used when an exam has no pattern of its own.
DEFAULT_PATTERN = [{"name": "A", "questions": 5, "attempt": 5, "marks": 2},
                   {"name": "B", "questions": 10, "attempt": 5, "marks": 7},
                   {"name": "C", "questions": 5, "attempt": 3, "marks": 5}]


def topic_key(unit, topic: str) -> str:
    return f"{unit}|{topic}"


def proficiency(states: dict, marks: dict, keys: Optional[list[str]] = None) -> dict[str, float]:
    """states: {key: {"state"}}; marks: {key: [{got, max}, ...]} oldest first."""
    out = {}
    for k in set(keys or []) | set(states) | set(marks):
        p = SEED_P.get((states.get(k) or {}).get("state", "none"), SEED_P["none"])
        for m in marks.get(k) or []:
            mx = float(m.get("max") or 0)
            if mx > 0:
                p = p * (1 - ALPHA) + max(0.0, min(1.0, float(m.get("got") or 0) / mx)) * ALPHA
        out[k] = round(p, 3)
    return out


def _unit_weight(units: list[dict]) -> dict[int, int]:
    return {int(u["n"]): WEIGHT.get(str(u.get("exam_weight") or "med"), 2) for u in units if u.get("n") is not None}


def topic_weights(bank: list[dict], units: list[dict], prof: dict[str, float], papers: int) -> dict[str, float]:
    """Weight per bank question key. Frequency counts how many past sittings asked the topic."""
    uw = _unit_weight(units)
    freq: dict[str, set] = {}
    for q in bank:
        if q.get("type") == "pyq_see":
            freq.setdefault(_qkey(q), set()).add(q.get("sitting"))
    sittings = max(papers, len({q.get("sitting") for q in bank if q.get("type") == "pyq_see"}))
    unit_mean: dict[int, float] = {}
    for u in uw:
        ps = [p for k, p in prof.items() if k.split("|")[0] == str(u)]
        unit_mean[u] = sum(ps) / len(ps) if ps else SEED_P["none"]
    out = {}
    for q in bank:
        k = _qkey(q)
        u = q.get("unit")
        p = prof.get(k, unit_mean.get(u, SEED_P["none"]))
        f = (len(freq.get(k, ())) + 1) / (sittings + 2)
        out[k] = round(uw.get(u, 2) * f * (1 - p) + 1e-6, 6)
    return out


def _qkey(q: dict) -> str:
    return topic_key(q.get("unit"), str(q.get("topic") or ""))


def _pick(rnd: random.Random, cands: list[dict], n: int, w: dict[str, float]) -> list[dict]:
    """Weighted sampling without replacement; a unit already picked weighs half next time."""
    pool, out, seen_units = list(cands), [], {}
    while pool and len(out) < n:
        weights = [w.get(_qkey(q), 1e-6) * (0.5 ** seen_units.get(q.get("unit"), 0)) for q in pool]
        tot = sum(weights)
        r, acc, idx = rnd.random() * tot, 0.0, len(pool) - 1
        for i, x in enumerate(weights):
            acc += x
            if r <= acc:
                idx = i
                break
        q = pool.pop(idx)
        out.append(q)
        seen_units[q.get("unit")] = seen_units.get(q.get("unit"), 0) + 1
    return out


def generate(exam: dict, bank: list[dict], units: list[dict], states: dict, marks: dict,
             seed: int = 0, tier: str = "exam", today: Optional[str] = None) -> dict:
    pattern = exam.get("pattern") or DEFAULT_PATTERN
    scope = set(exam.get("units") or []) or {int(u["n"]) for u in units if u.get("n") is not None}
    bank = [q for q in bank if q.get("question") and (q.get("unit") in scope or q.get("unit") is None)]
    # A tier is a promise: when the bank has no GATE-tier question the paper is an exam-tier paper
    # and says so, instead of wearing the label (audit STUDY-06, 9 Nov).
    tier_requested, tier_note = tier, None
    if tier == "gate":
        tiered = [q for q in bank if q.get("tier") == "gate"]
        if tiered:
            bank = tiered
        else:
            tier, tier_note = "exam", "No GATE-tier questions in this bank yet: this is an exam-tier paper."
    # No pattern typed and the paper is not a 60-mark SEE: the default is used, and the paper says so.
    pattern_missing = not exam.get("pattern") and exam.get("max") not in (None, 60)
    pattern_note = (f"No pattern typed for this {exam.get('max'):g}-mark paper; the 60-mark JSS SEE shape was used. "
                    f"Type the real pattern in Settings → Date sheet.") if pattern_missing else None
    keys = [_qkey(q) for q in bank]
    prof = proficiency(states, marks, keys)
    w = topic_weights(bank, units, prof, papers=len({q.get("sitting") for q in bank}))
    rnd = random.Random(seed)
    used, sections, shortfall = set(), [], []
    for sec in pattern:
        name, n, att, mk = sec["name"], int(sec["questions"]), int(sec.get("attempt") or sec["questions"]), float(sec["marks"])
        by_section = [q for q in bank if q.get("id") not in used and str(q.get("section") or "").upper() == str(name).upper()]
        by_marks = [q for q in bank if q.get("id") not in used and q not in by_section and float(q.get("marks") or 0) == mk]
        picked = _pick(rnd, by_section, n, w)
        if len(picked) < n:
            picked += _pick(rnd, by_marks, n - len(picked), w)
        if len(picked) < n:
            rest = [q for q in bank if q.get("id") not in used and q not in picked]
            picked += _pick(rnd, rest, n - len(picked), w)
        if len(picked) < n:
            shortfall.append(f"Section {name}: {len(picked)} of {n} questions in the bank")
        used.update(q.get("id") for q in picked)
        sections.append({"name": name, "marks": mk, "attempt": att, "set": n,
                         "questions": [{"id": q.get("id"), "n": i + 1, "text": q["question"], "marks": mk, "unit": q.get("unit"),
                                        "topic": q.get("topic") or "", "key": _qkey(q), "p": prof.get(_qkey(q)),
                                        "source": q.get("sitting") or q.get("source") or "", "type": q.get("type") or ""}
                                       for i, q in enumerate(picked)]})
    total = sum(s["attempt"] * s["marks"] for s in sections)
    return {"exam": exam.get("id"), "subject": exam.get("subject"), "title": exam.get("title"), "seed": seed, "tier": tier,
            "tier_requested": tier_requested, "tier_note": tier_note, "pattern_missing": pattern_missing, "pattern_note": pattern_note,
            "empty": not bank,
            "date": today, "pattern_source": exam.get("pattern_source") or ("JSS SEE Jun 2026 default" if not exam.get("pattern") else ""),
            "sections": sections, "total_marks": total, "max": exam.get("max"),
            "bank_size": len(bank), "shortfall": shortfall,
            "rule": "Weak topics come up more (weight = unit weight × smoothed past frequency × (1 − proficiency)); "
                    "the same seed is the same paper. Proficiency is your taps until you log marks."}


def as_markdown(paper: dict) -> str:
    L = [f"# {paper.get('title') or paper.get('exam')}: practice paper (seed {paper['seed']}, {paper['tier']} tier)", "",
         f"_Total {paper['total_marks']:g} marks. Pattern: {paper.get('pattern_source') or 'from the date sheet'}._", ""]
    for s in paper["sections"]:
        att = f"answer any {s['attempt']} of {s['set']}" if s["attempt"] < s["set"] else "answer all"
        L += [f"## Section {s['name']}: {s['marks']:g} marks each, {att}", ""]
        for q in s["questions"]:
            L.append(f"{q['n']}. {q['text']}  \n   _Unit {q['unit']}, {q['topic']}; source: {q['source'] or 'bank'}_")
        L.append("")
    for note in (paper.get("pattern_note"), paper.get("tier_note")):
        if note:
            L += [f"> {note}", ""]
    if paper.get("empty"):
        L += ["> No questions in the bank for this subject yet.", ""]
    elif paper.get("shortfall"):
        L += ["> Bank short: " + "; ".join(paper["shortfall"]), ""]
    return "\n".join(L)


def paper_invariants(paper: dict, exam: dict) -> list[str]:
    """What must hold in any generated paper (the gate uses it)."""
    p = []
    pattern = exam.get("pattern") or DEFAULT_PATTERN
    if len(paper["sections"]) != len(pattern):
        return [f"{len(paper['sections'])} sections for a {len(pattern)}-section pattern"]
    ids = []
    for s, sec in zip(paper["sections"], pattern):
        if s["marks"] != float(sec["marks"]) or s["set"] != int(sec["questions"]):
            p.append(f"section {s['name']}: {s['set']} × {s['marks']} vs pattern {sec['questions']} × {sec['marks']}")
        if len(s["questions"]) > s["set"]:
            p.append(f"section {s['name']}: more questions than set")
        if len(s["questions"]) < s["set"] and not paper.get("shortfall"):
            p.append(f"section {s['name']}: short without saying so")
        for q in s["questions"]:
            if q["marks"] != s["marks"]:
                p.append(f"{q['id']}: {q['marks']} marks in a {s['marks']}-mark section")
            if q["p"] is not None and not 0 <= q["p"] <= 1:
                p.append(f"{q['id']}: proficiency {q['p']}")
            ids.append(q["id"])
    if len(set(ids)) != len(ids):
        p.append("a question appears twice")
    expect = sum(int(sec.get("attempt") or sec["questions"]) * float(sec["marks"]) for sec in pattern)
    if paper["total_marks"] != expect:
        p.append(f"total {paper['total_marks']} vs pattern {expect}")
    return p
