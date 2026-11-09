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

import math
import random
import re
from typing import Optional

SEED_P = {"none": 0.1, "learned": 0.5, "solid": 0.8}
ALPHA = 0.5
WEIGHT = {"high": 3, "med": 2, "low": 1}
TIERS = ("exam", "gate")
# JSS SEE, 60 marks: used when an exam has no pattern of its own.
DEFAULT_PATTERN = [{"name": "A", "questions": 5, "attempt": 5, "marks": 2},
                   {"name": "B", "questions": 10, "attempt": 5, "marks": 7},
                   {"name": "C", "questions": 5, "attempt": 3, "marks": 5}]


def _round_half_up(x: float) -> int:
    return int(math.floor(x + 0.5))        # round() is banker's: 2.5 -> 2 would scale 5 and 15 inconsistently


def scale_pattern(total, base: Optional[list] = None) -> Optional[list]:
    """The base shape (the 60-mark JSS SEE) scaled so the attempted marks add up to exactly `total`.

    Why not just multiply: 20 / 60 turns a 7-mark question into 2.33 marks, and a paper that
    totals 19.9 or 21 is one he cannot trust a score on. So the two big sections keep the
    base's share of the budget (35/60 and 15/60) with whole-mark questions (7 -> 2 at 20
    marks), and the smallest section (A, the short answers) takes what is left, in the
    biggest question size that divides the remainder exactly. The sum is the point, and the
    gate checks it for every maximum from 1 to 300. Half-marks are kept when the maximum is
    a multiple of 0.5; anything else, or above 300, answers None and the caller says the
    unscaled default was used."""
    base = base or DEFAULT_PATTERN
    try:
        total = float(total)
    except (TypeError, ValueError):
        return None
    if not 0 < total <= 300:
        return None
    q = 1.0 if total.is_integer() else 0.5 if (2 * total).is_integer() else None
    if q is None:
        return None
    base_marks = [int(s.get("attempt") or s["questions"]) * float(s["marks"]) for s in base]
    f = total / sum(base_marks)
    U = _round_half_up(total / q)
    order = sorted(range(len(base)), key=lambda i: -base_marks[i])       # biggest budgets first; the smallest takes the rest
    left, got = U, {}
    for i in order[:-1]:
        s = base[i]
        mk = max(1, _round_half_up(float(s["marks"]) * f / q))
        att = min(_round_half_up(total * base_marks[i] / sum(base_marks) / q / mk), left // mk)
        if att >= 1:
            ratio = int(s["questions"]) / int(s.get("attempt") or s["questions"])
            got[i] = (mk, att, max(att, _round_half_up(att * ratio)))
            left -= mk * att
    i = order[-1]
    if left:
        mk = max(1, _round_half_up(float(base[i]["marks"]) * f / q))
        while mk > 1 and left % mk:
            mk -= 1                                                       # one unit always divides, so this ends
        got[i] = (mk, left // mk, left // mk)
    out = [{"name": base[i]["name"], "questions": got[i][2], "attempt": got[i][1], "marks": got[i][0] * q} for i in range(len(base)) if i in got]
    ok = out and abs(sum(s["attempt"] * s["marks"] for s in out) - total) < 1e-9
    return out if ok else None


def describe_pattern(pattern: list) -> str:
    return ", ".join(f"{s['name']}: " + (f"{s['attempt']} x {s['marks']:g}" if s["attempt"] == s["questions"]
                                         else f"{s['attempt']} of {s['questions']} x {s['marks']:g}") for s in pattern)


def effective_pattern(exam: dict) -> dict:
    """Which pattern a paper uses and why: typed (his), the default (a 60-mark paper or no
    maximum), or the default shape scaled to the row's maximum. The old behaviour put a
    60-mark paper behind a 20-mark CIE row (audit STUDY-05, 9 Nov); `missing` keeps that flag
    (the shape is still not his), `scaled` says how the total was met."""
    if exam.get("pattern"):
        return {"pattern": exam["pattern"], "missing": False, "scaled": False, "note": None, "source": exam.get("pattern_source") or ""}
    mx = exam.get("max")
    if mx in (None, 60):
        return {"pattern": DEFAULT_PATTERN, "missing": False, "scaled": False, "note": None, "source": "JSS SEE Jun 2026 default"}
    scaled = scale_pattern(mx)
    if scaled:
        return {"pattern": scaled, "missing": True, "scaled": True, "source": f"JSS SEE shape scaled to {mx:g} marks",
                "note": (f"No pattern typed for this {mx:g}-mark paper. The 60-mark JSS SEE shape was scaled to {mx:g} marks "
                         f"({describe_pattern(scaled)}). Type the real pattern in Settings → Date sheet.")}
    return {"pattern": DEFAULT_PATTERN, "missing": True, "scaled": False, "source": "JSS SEE Jun 2026 default",
            "note": (f"No pattern typed for this {mx!r}-mark paper and it cannot be scaled to whole or half marks; "
                     f"the 60-mark JSS SEE shape was used. Type the real pattern in Settings → Date sheet.")}


_LATEX = re.compile(r"\$[^$]+\$")


def has_latex(text: str) -> bool:
    """True when the stored text carries `$...$` maths, so the UI renders it as is and does not run toTex on it."""
    return bool(_LATEX.search(text or ""))


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
    eff = effective_pattern(exam)
    pattern = eff["pattern"]
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
    # No pattern typed and the paper is not a 60-mark SEE: the default shape is scaled to the row's
    # maximum and the paper says so (pattern_missing stays true: the shape is still not his).
    pattern_missing, pattern_note = eff["missing"], eff["note"]
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
                                        "source": q.get("sitting") or q.get("source") or "", "type": q.get("type") or "",
                                        "bank_marks": q.get("marks"), "latex": has_latex(q["question"])}
                                       for i, q in enumerate(picked)]})
    total = sum(s["attempt"] * s["marks"] for s in sections)
    return {"exam": exam.get("id"), "subject": exam.get("subject"), "title": exam.get("title"), "seed": seed, "tier": tier,
            "tier_requested": tier_requested, "tier_note": tier_note, "pattern_missing": pattern_missing, "pattern_note": pattern_note,
            "pattern_scaled": eff["scaled"], "empty": not bank,
            "date": today, "pattern_source": eff["source"],
            "sections": sections, "total_marks": total, "max": exam.get("max"),
            "bank_size": len(bank), "shortfall": shortfall,
            "rule": "Weak topics come up more (weight = unit weight × smoothed past frequency × (1 − proficiency)); "
                    "the same seed is the same paper. Proficiency is your taps until you log marks."}


QUESTION_MAX_CHARS = 2000
TYPED_BANK_CAP = 500             # ww_engines.normalize_inputs keeps 500 typed questions per subject: refuse the 501st loudly


def validate_question(body: dict, unit_numbers: list[int]) -> dict:
    """One question he adds to a subject's bank, checked and cleaned; ValueError says what is wrong.

    The text is stored exactly as typed, LaTeX (`$\\int_0^1 x\\,dx$`) or plain: the backend never
    converts maths (the UI's toTex does that for old content only), it refuses only what would
    break rendering later, an odd number of `$`. `unit_numbers` are the subject's units; a subject
    with no unit list accepts 1..10, the range the inputs normalizer allows."""
    if not isinstance(body, dict):
        raise ValueError("send an object: {unit, topic, question, marks, section?, tier?, source?}")
    allowed = unit_numbers or list(range(1, 11))
    u = body.get("unit")
    if isinstance(u, bool) or not isinstance(u, (int, float)) or int(u) != u or int(u) not in allowed:
        raise ValueError(f"unit must be one of {allowed}")
    topic = re.sub(r"\s+", " ", str(body.get("topic") or "")).strip()
    if not topic or len(topic) > 80:
        raise ValueError("topic is required, up to 80 characters")
    text = str(body.get("question") or "").replace("\r\n", "\n").strip()
    if not text:
        raise ValueError("question is required")
    if len(text) > QUESTION_MAX_CHARS:
        raise ValueError(f"question is over {QUESTION_MAX_CHARS} characters")
    if re.sub(r"\\\$", "", text).count("$") % 2:
        raise ValueError("question has an unmatched $: close the maths with a second $ (or write \\$ for a dollar sign)")
    m = body.get("marks")
    if isinstance(m, bool) or not isinstance(m, (int, float)) or not 0 < float(m) <= 100 or (2 * float(m)) % 1:
        raise ValueError("marks must be a number above 0 and up to 100, in steps of 0.5")
    section = str(body.get("section") or "").strip().upper()
    if section and not re.fullmatch(r"[A-Z0-9]{1,4}", section):
        raise ValueError("section is a short label such as A, B or C")
    tier = str(body.get("tier") or "exam").strip().lower()
    if tier not in TIERS:
        raise ValueError("tier is exam or gate")
    source = re.sub(r"\s+", " ", str(body.get("source") or "")).strip()
    if len(source) > 120:
        raise ValueError("source is up to 120 characters")
    return {"unit": int(u), "topic": topic, "question": text, "marks": float(m), "section": section, "tier": tier,
            "type": "typed", "sitting": source or "typed"}


def same_question(a: str, b: str) -> bool:
    norm = lambda s: re.sub(r"\s+", " ", s).strip().lower()
    return norm(a) == norm(b)


def bank_summary(bank: list[dict]) -> dict:
    """Sizes of a subject's bank: the whole, per tier, per unit and per section. Honest about a
    question with no tier (the files' own questions carry none: they are exam-tier by default)."""
    tiers = {t: 0 for t in TIERS}
    by_unit: dict[str, int] = {}
    by_section: dict[str, int] = {}
    for q in bank:
        tiers[q.get("tier") if q.get("tier") in TIERS else "exam"] += 1
        by_unit[str(q.get("unit"))] = by_unit.get(str(q.get("unit")), 0) + 1
        by_section[str(q.get("section") or "")] = by_section.get(str(q.get("section") or ""), 0) + 1
    return {"total": len(bank), "tiers": tiers, "by_unit": by_unit, "by_section": by_section,
            "typed": sum(1 for q in bank if ":typed:" in str(q.get("id")))}


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
    eff = effective_pattern(exam)
    pattern = eff["pattern"]
    if eff["scaled"] and paper["total_marks"] != float(exam["max"]):
        p.append(f"scaled pattern totals {paper['total_marks']:g}, the row's maximum is {exam['max']:g}")
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
