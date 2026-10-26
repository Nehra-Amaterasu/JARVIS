"""Exams engine: the papers ahead, how ready he says he is for each, and where the
study minutes between now and the last paper should go.

    exams(inputs, today, subjects=None, prep=None) -> dict

inputs["exams"]: [{id, subject, title, code, date, start, end, units, may_miss}] (the
date sheet, typed in Settings); inputs["study"]: minutes he can study on a weekday,
a weekend day, and the evening of an exam day.
subjects: the academics.json subjects (id, name, units: [{n, title, topics, exam_weight}]).
prep: the plan state's record {subject: {"topics": {key: {"state", "date"}},
"minutes": [{date, minutes}], "papers": [{date, score, max}]}}.

Three answers, each with how it was made:
  * coverage per paper: from his own taps (a topic "learned" or "solid"), weighted by
    the unit's exam weight. It is a self-report, so it is never called a score; the
    only measured number is a timed practice paper's marks, shown next to it.
  * the block plan: every free stretch until the last paper (whole days, the gap
    between two papers on one day, the evening after a paper) gets minutes assigned.
    His rule from the sprint plan (2026-10-25): the last full block before a paper's
    day belongs to that day's papers; a gap between two papers belongs to the second.
    The rest goes, 30 minutes at a time, to the paper whose remaining work is largest
    against the minutes left before it.
  * a forecast: coverage on the day if he follows half of the plan, and all of it.
    A range with its assumption stated, never a promise.

Topic estimates (minutes to first learn one): 45 for a high-weight unit, 35 medium,
25 low; a topic marked "learned" still needs 40 % of that to become solid (a closed-
book redo). A timed practice paper with marking is 80 minutes. These are planning
guesses written here so they can be argued with, not measurements. Pure.
"""
from __future__ import annotations

from datetime import date
from typing import Optional

from .ww_base import EngineSpec, add_days, days_between, plural

LEARN_MIN = {"high": 45, "med": 35, "low": 25}
WEIGHT = {"high": 3, "med": 2, "low": 1}
CREDIT = {"none": 0.0, "learned": 0.6, "solid": 1.0}
SOLIDIFY = 0.4            # share of the learn time a "learned" topic still needs
PAPER_MIN = 80            # one timed practice paper (60) + marking it (20)
CHUNK = 30                # the free blocks are handed out in half hours
GAP_OVERHEAD = 60         # between two papers: travel, lunch, settling in
GAP_CAP = 150
PRE_PAPER = 30            # a short look at the 2-mark list before a morning paper
STATES = tuple(CREDIT)


def topic_key(unit: int, topic: str) -> str:
    return f"{unit}|{topic}"


def _minutes(hhmm: Optional[str]) -> Optional[int]:
    if not hhmm:
        return None
    h, m = hhmm.split(":")
    return int(h) * 60 + int(m)


def _paper_topics(paper: dict, subject: Optional[dict], rec: dict) -> list[dict]:
    units = (subject or {}).get("units") or []
    scope = set(paper.get("units") or []) or {u.get("n") for u in units}
    states = rec.get("topics") or {}
    out = []
    for u in units:
        if u.get("n") not in scope:
            continue
        w = str(u.get("exam_weight") or "med")
        w = w if w in WEIGHT else "med"
        for t in u.get("topics") or []:
            k = topic_key(int(u["n"]), str(t))
            s = (states.get(k) or {}).get("state", "none")
            out.append({"key": k, "unit": int(u["n"]), "unit_title": str(u.get("title") or ""), "topic": str(t),
                        "weight": w, "state": s if s in CREDIT else "none"})
    return out


def _work_items(topics: list[dict], paper_done: bool) -> list[dict]:
    """What is left, in the order it should be done: unseen topics (heaviest units
    first), then a timed paper, then turning 'learned' into 'solid'."""
    unseen = sorted((t for t in topics if t["state"] == "none"), key=lambda t: (-WEIGHT[t["weight"]], t["unit"]))
    items = [{"kind": "learn", "title": t["topic"], "unit": t["unit"], "minutes": LEARN_MIN[t["weight"]]} for t in unseen]
    if not paper_done and topics:
        items.append({"kind": "paper", "title": "Timed practice paper, then mark it and log the lost marks", "unit": None,
                      "minutes": PAPER_MIN})
    items += [{"kind": "solid", "title": f"Redo closed book: {t['topic']}", "unit": t["unit"],
               "minutes": round(LEARN_MIN[t["weight"]] * SOLIDIFY)}
              for t in sorted((t for t in topics if t["state"] == "learned"), key=lambda t: (-WEIGHT[t["weight"]], t["unit"]))]
    return items


def _coverage(topics: list[dict]) -> Optional[float]:
    tot = sum(WEIGHT[t["weight"]] for t in topics)
    if not tot:
        return None
    return round(sum(WEIGHT[t["weight"]] * CREDIT[t["state"]] for t in topics) / tot, 3)


def _slots(papers: list[dict], today: str, study: dict, logged_today: int) -> list[dict]:
    """Free stretches from today to the last paper, in time order. `reserved` names
    the papers a slot belongs to (None: shared by everything still ahead)."""
    by_day: dict[str, list[dict]] = {}
    for p in papers:
        by_day.setdefault(p["date"], []).append(p)
    last = max(p["date"] for p in papers)
    out, d = [], today
    while d <= last:
        todays = sorted(by_day.get(d, []), key=lambda p: _minutes(p.get("start")) or 0)
        weekend = date.fromisoformat(d).weekday() >= 5
        if not todays:
            mins = study["weekend_minutes" if weekend else "weekday_minutes"]
            nxt = min((x for x in by_day if x > d), default=None)
            # The last free day before a day of papers belongs to that day's papers.
            reserved = [p["id"] for p in by_day[nxt]] if nxt and add_days(d, 1) == nxt else None
            out.append({"date": d, "label": "Weekend day" if weekend else "Study day", "minutes": mins, "reserved": reserved})
        else:
            first = todays[0]
            if (_minutes(first.get("start")) or 0) >= 10 * 60:
                out.append({"date": d, "label": f"Before {first['title']}", "minutes": PRE_PAPER, "reserved": [first["id"]], "light": True})
            for a, b in zip(todays, todays[1:]):
                gap = (_minutes(b.get("start")) or 0) - (_minutes(a.get("end")) or _minutes(a.get("start")) or 0)
                m = max(0, min(GAP_CAP, gap - GAP_OVERHEAD))
                if m:
                    out.append({"date": d, "label": f"Gap before {b['title']}", "minutes": m, "reserved": [b["id"]]})
            later = [p for p in papers if p["date"] > d]
            if later and study["exam_evening_minutes"]:
                nxt = min(p["date"] for p in later)
                reserved = [p["id"] for p in later if p["date"] == nxt] if add_days(d, 1) == nxt else None
                out.append({"date": d, "label": "Evening after the paper", "minutes": study["exam_evening_minutes"], "reserved": reserved})
        d = add_days(d, 1)
    if out and out[0]["date"] == today and logged_today:
        out[0] = {**out[0], "minutes": max(0, out[0]["minutes"] - logged_today)}
    return [s for s in out if s["minutes"] > 0]


def _paper_ts(p: dict) -> tuple[str, int]:
    return p["date"], _minutes(p.get("start")) or 0


def _slot_before(slot: dict, p: dict) -> bool:
    """Is this stretch still before paper p? A slot on the paper's own day is before it
    only if it is reserved for it (the morning look or the gap)."""
    if slot["date"] < p["date"]:
        return True
    return slot["date"] == p["date"] and p["id"] in (slot.get("reserved") or [])


def _allocate(slots: list[dict], papers: list[dict], work: dict[str, int]) -> list[dict]:
    left = dict(work)
    plan = [{**s, "alloc": {}} for s in slots]
    # 1. reserved stretches first: they are fixed by his rule, so earlier days plan around them.
    for s in plan:
        r = [pid for pid in (s.get("reserved") or []) if pid in left]
        if not r:
            continue
        tot = sum(left[pid] for pid in r) or len(r)
        rem = s["minutes"]
        for i, pid in enumerate(r):
            share = rem if i == len(r) - 1 else round(s["minutes"] * ((left[pid] or 1) / tot) / 15) * 15
            share = min(share, rem)
            s["alloc"][pid] = s["alloc"].get(pid, 0) + share
            left[pid] = max(0, left[pid] - share)
            rem -= share
    # 2. shared stretches: half hours to the paper with the most work per free minute before it.
    for i, s in enumerate(plan):
        if s.get("reserved"):
            continue
        rem = s["minutes"]
        while rem > 0:
            ahead = [p for p in papers if _slot_before(s, p)]
            if not ahead:
                break
            def density(p: dict) -> float:
                cap = sum(x["minutes"] for x in plan[i:] if not x.get("reserved") and _slot_before(x, p))
                return left[p["id"]] / max(cap, 1)
            best = max(ahead, key=lambda p: (density(p), -days_between(s["date"], p["date"])))
            if left[best["id"]] <= 0:
                best = min(ahead, key=_paper_ts)          # all planned work fits: spare time revises the nearest paper
            take = min(CHUNK, rem)
            s["alloc"][best["id"]] = s["alloc"].get(best["id"], 0) + take
            left[best["id"]] = max(0, left[best["id"]] - take)
            rem -= take
    return plan


def _fill(plan: list[dict], items: dict[str, list[dict]], titles: dict[str, str]) -> list[dict]:
    """Turn minutes into named work, in time order, so each block says what to do."""
    queue = {pid: [dict(x) for x in v] for pid, v in items.items()}
    days: dict[str, dict] = {}
    for s in plan:
        blocks = []
        for pid, mins in s["alloc"].items():
            if not mins:
                continue
            focus, budget = [], mins
            q = queue.get(pid) or []
            while budget > 0 and q:
                it = q[0]
                take = min(budget, it["minutes"])
                focus.append({"kind": it["kind"], "title": it["title"], "unit": it["unit"], "minutes": take})
                it["minutes"] -= take
                budget -= take
                if it["minutes"] <= 0:
                    q.pop(0)
            if budget > 0:
                focus.append({"kind": "revise", "title": "Revise: 2-mark list, formula sheet, error log", "unit": None, "minutes": budget})
            blocks.append({"paper": pid, "title": titles[pid], "minutes": mins, "focus": focus})
        day = days.setdefault(s["date"], {"date": s["date"], "slots": []})
        day["slots"].append({"label": s["label"], "minutes": s["minutes"], "light": bool(s.get("light")),
                             "reserved": bool(s.get("reserved")), "blocks": blocks})
    return list(days.values())


def exams(inputs: dict, today: str, subjects: Optional[list[dict]] = None, prep: Optional[dict] = None) -> dict:
    subs = {s.get("id"): s for s in subjects or [] if isinstance(s, dict)}
    prep = prep or {}
    study = {"weekday_minutes": 240, "weekend_minutes": 300, "exam_evening_minutes": 150, **(inputs.get("study") or {})}
    papers = sorted((p for p in inputs.get("exams") or [] if p.get("date", "") >= today), key=_paper_ts)
    base = {"engine": "exams", "version": 1, "status": "ok", "date": today, "study": study}
    if not papers:
        return {**base, "papers": [], "days": [], "risks": [],
                "say": "No papers ahead. Type the date sheet into Settings and the plan builds itself."}
    rows, work, items, titles = [], {}, {}, {}
    logged_today = 0
    for p in papers:
        rec = prep.get(p["subject"]) or {}
        topics = _paper_topics(p, subs.get(p["subject"]), rec)
        scores = [x for x in rec.get("papers") or [] if x.get("max")]
        its = _work_items(topics, bool(scores))
        items[p["id"]], titles[p["id"]] = its, p["title"]
        work[p["id"]] = sum(x["minutes"] for x in its)
        logged = sum(int(m.get("minutes") or 0) for m in rec.get("minutes") or [])
        logged_today += sum(int(m.get("minutes") or 0) for m in rec.get("minutes") or [] if m.get("date") == today)
        last = scores[-1] if scores else None
        rows.append({**p, "days_left": days_between(today, p["date"]), "subject_known": p["subject"] in subs,
                     "coverage": _coverage(topics), "topics": topics, "work_minutes": work[p["id"]],
                     "logged_minutes": logged,
                     "paper_score": {"score": last["score"], "max": last["max"], "date": last["date"]} if last else None,
                     "counts": {s: sum(1 for t in topics if t["state"] == s) for s in STATES}})
    plan = _allocate(_slots(papers, today, study, logged_today), papers, work)
    days = _fill(plan, items, titles)
    planned = {p["id"]: 0 for p in papers}
    for s in plan:
        for pid, m in s["alloc"].items():
            planned[pid] += m
    risks = []
    for r in rows:
        w, m = r["work_minutes"], planned[r["id"]]
        cov = r["coverage"] or 0.0
        def proj(frac: float) -> float:
            # Planned minutes do the work in order; coverage rises with the learn and solid items done.
            if not w:
                return cov
            return round(min(1.0, cov + (1 - cov) * min(1.0, frac * m / w)), 2)
        r["planned_minutes"] = m
        r["forecast"] = {"half_plan": proj(0.5), "full_plan": proj(1.0),
                         "assumption": "Coverage on the day if you do half of the planned minutes, or all of them, "
                                       "in the order shown. Your own taps, not a measured score."}
    short = [(r, r["work_minutes"] - r["planned_minutes"]) for r in rows if r["topics"] and r["work_minutes"] > r["planned_minutes"]]
    if short:
        total = sum(x for _, x in short)
        risks.append(f"About {plural(max(1, round(total / 60)), 'hour')} more work than free time, across "
                     f"{', '.join(r['title'] for r, _ in short)}. High-weight topics come first in every block, "
                     f"so what is left over at the end is the low-weight part.")
    for r in rows:
        if not r["topics"]:
            risks.append(f"{r['title']}: no unit list for it yet, so there is nothing to plan. Its blocks are revision until you add one.")
    same_day: dict[str, list[str]] = {}
    for r in rows:
        same_day.setdefault(r["date"], []).append(r["title"])
    for d, ts in same_day.items():
        if len(ts) > 1:
            risks.append(f"{date.fromisoformat(d).strftime('%a %d %b')}: {' and '.join(ts)} on one day, so the day before is shared.")
    nxt = rows[0]
    tail = f" in {plural(nxt['days_left'], 'day')}" if nxt["days_left"] else " today"
    cov = f"{round((nxt['coverage'] or 0) * 100)} % covered by your taps" if nxt["coverage"] is not None else "no topics yet"
    first = next((b for d in days for s in d["slots"] for b in s["blocks"] if d["date"] == today), None)
    say = f"Next paper: {nxt['title']}{tail}, {cov}."
    if first and first["focus"]:
        say += f" Today starts with {first['title']}: {first['focus'][0]['title']}."
    return {**base, "papers": rows, "days": days, "risks": risks[:6], "say": say,
            "estimates": {"learn_minutes": LEARN_MIN, "solidify_share": SOLIDIFY, "paper_minutes": PAPER_MIN},
            "rule": "The last full block before a paper's day belongs to that day's papers; the gap between two papers "
                    "belongs to the second. Coverage comes from your taps; only a practice paper's marks are measured."}


_EXAM = {"type": "dict", "required": {"id": {"type": "str"}, "subject": {"type": "str"}, "title": {"type": "str"},
                                       "date": {"type": "date"}, "units": {"type": "list", "items": {"type": "int"}}}}
ENGINE = EngineSpec(
    name="exams", version=1, fn=exams,
    about="Papers ahead: coverage from your taps, a block plan to the last paper, and a forecast range.",
    needs=("the date sheet (Settings)", "the units each paper covers", "academics.json topics", "your topic taps"),
    inputs={"exams": {"type": "list", "items": _EXAM}, "study": {"type": "dict"}},
    data={"subjects": {"type": "list", "items": {"type": "dict"}}, "prep": {"type": "dict"}},
)
