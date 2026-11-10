"""Status v2: what the Proof panel reads that /api/mission/status does not already give.

    counter_series(log, counters, today)        4 weekly means per Life counter, honest about how many weeks exist
    consistency(log, counters, today)           days on the line over days asked, per counter and overall
    rank_requirements(have, current)            every requirement of the next rank, met and unmet, plus the ladder
    recent_days(events, today)                  the last days of logged work, grouped by day, zero-XP rows collapsed
    wins(events)                                real milestones only (shipped, certificate, rank-up, mastered)
    load_advice() / pick_advice(...)            sourced advice lines and the few that fit today
    suggestions(lines)                          the System's own rule lines, each with the place its button goes to
    status_v2(...)                              all of the above in one answer

Read-only over the plan state (germoney.Plan.load) and the Life log; nothing here writes. Pure functions
except load_advice (reads one JSON file).

Why it is shaped like this:
  * A week with no logged day is NOT a zero. A zero would draw a falling line from a week the app was never
    told about. The series keeps only weeks that have data, says how many of the 4 exist, and the page draws
    a line only from 2 weeks up.
  * The weekly number is the mean per LOGGED day, not the weekly total, so a week with 3 logged days and a
    week with 7 are comparable.
  * Consistency counts a day only if the counter was logged that day: silence is not a miss (the abstinence
    violation effect, see data/ww_advice.json), so there is no "missed" count anywhere in this file. The line
    for a "less" or "more" counter on a past day is recomputed from the 7 logged days before it, exactly as
    ww_life does for today, so the number agrees with what the Life page showed that day.
  * Advice is only ever a line from data/ww_advice.json with author, work, year, kind, strength and limit all
    present; a line missing any of them is dropped, not shown with a blank source.
"""
from __future__ import annotations

import json
import re
from datetime import date
from pathlib import Path
from typing import Any, Optional

from . import wellwisher
from .ww_base import add_days, no_shame
from .ww_life import DEFAULT_COUNTERS, _line

ADVICE_FILE = Path(__file__).resolve().parent / "data" / "ww_advice.json"
WEEKS = 4
MIN_ASKED = 7                   # judged days before a consistency number is shown at all (one week)
MIN_LINE_WEEKS = 2              # weeks with data before a line is drawn (one point is not a line)
RECENT_DAYS = 14
ROWS_PER_DAY = 8
WIN_KINDS = ("ship", "cert", "project", "achievement", "rankup")
NOT_WORK = ("migrate", "xp")    # carried-over and game XP are not logged work (wellwisher.py "not counted")
ADVICE_FIELDS = ("author", "work", "year", "kind")


# ------------------------------------------------------------------ the 4-week series
def _counters(inputs: dict) -> list[dict]:
    return ((inputs.get("life") or {}).get("counters")) or DEFAULT_COUNTERS


def _count(log: dict, d: str, cid: str) -> Optional[int]:
    v = ((log.get(d) or {}).get("counts") or {}).get(cid)
    if isinstance(v, bool) or not isinstance(v, (int, float)):
        return None
    return int(v)


def counter_series(log: dict, counters: list[dict], today: str) -> list[dict]:
    """Per counter, the last 4 weeks (7 days each, ending today) as a mean per logged day.

    `weeks` always has 4 entries so the page can label them; a week without a logged day has days_logged 0 and
    mean None. `points` holds only the weeks WITH data, oldest first, which is what the page draws.
    """
    out = []
    for c in counters:
        cid = c["id"]
        weeks = []
        for w in range(WEEKS - 1, -1, -1):
            end = add_days(today, -7 * w)
            vals = [v for v in (_count(log, add_days(end, -i), cid) for i in range(7)) if v is not None]
            weeks.append({"start": add_days(end, -6), "end": end, "days_logged": len(vals),
                          "mean": round(sum(vals) / len(vals), 2) if vals else None})
        have = [w for w in weeks if w["days_logged"]]
        first = next((d for d in sorted(log) if _count(log, d, cid) is not None), None)
        out.append({"id": cid, "name": c.get("name", cid), "want": c.get("want", "less"), "weeks": weeks,
                    "points": [w["mean"] for w in have], "weeks_with_data": len(have),
                    "first_logged": first, "enough_for_line": len(have) >= MIN_LINE_WEEKS})
    return out


# ------------------------------------------------------------------ consistency
def _on_line(want: str, val: int, line: Optional[int]) -> Optional[bool]:
    """True/False when the day can be judged, None when it cannot (no line yet)."""
    if want == "yes":
        return val >= 1
    if line is None:
        return None
    return val <= line if want == "less" else val >= line if want == "more" else None


def consistency(log: dict, counters: list[dict], today: str, window: int = 28) -> dict:
    start = add_days(today, -(window - 1))
    rows, hit_all, asked_all = [], 0, 0
    for c in counters:
        cid, want = c["id"], c.get("want", "less")
        logged = judged = hit = 0
        for i in range(window):
            d = add_days(start, i)
            val = _count(log, d, cid)
            if val is None:
                continue
            logged += 1
            prior = [d2 for d2 in sorted(log) if d2 < d and _count(log, d2, cid) is not None][-7:]
            ok = _on_line(want, val, _line([_count(log, d2, cid) for d2 in prior], want))
            if ok is None:
                continue
            judged += 1
            hit += 1 if ok else 0
        enough = judged >= MIN_ASKED
        rows.append({"id": cid, "name": c.get("name", cid), "want": want, "window_days": window, "logged": logged,
                     "asked": judged, "hit": hit, "ratio": round(hit / judged, 3) if enough else None,
                     "need": max(0, MIN_ASKED - judged)})
        if enough:
            hit_all += hit
            asked_all += judged
    return {"window_days": window, "from": start, "to": today, "counters": rows,
            "hit": hit_all, "asked": asked_all, "ratio": round(hit_all / asked_all, 3) if asked_all else None,
            "rule": "A day counts when the counter was logged that day. A day with nothing logged is not counted "
                    "either way. The line for a counter you want less of is the median of your last 7 logged days "
                    "minus 10 %, as on the Life page."}


# ------------------------------------------------------------------ rank
def rank_requirements(have: dict, current: str) -> dict:
    """Every requirement of the NEXT rank with what he has and whether it is met (the older answer listed only
    the unmet ones, so a half-done rank looked emptier than it was). At the top rank, the top rank's own."""
    names = [n for n, _ in wellwisher.RANKS]
    idx = names.index(current) if current in names else 0
    nxt = names[idx + 1] if idx + 1 < len(names) else None
    target = nxt or names[idx]
    req = dict(wellwisher.RANKS)[target]

    def row(k: str, need: int) -> dict:
        h = int(have.get(k) or 0)
        return {"req": k, "name": wellwisher.REQ_NAMES[k], "have": h, "need": need, "met": h >= need}

    reqs = [row(k, v) for k, v in req.items()]
    return {"rank": current, "next": nxt, "target": target, "top": nxt is None, "requirements": reqs,
            "met": sum(1 for r in reqs if r["met"]), "of": len(reqs),
            "ladder": [{"rank": n, "requirements": [{"req": k, "name": wellwisher.REQ_NAMES[k], "need": v} for k, v in r.items()]}
                       for n, r in wellwisher.RANKS]}


# ------------------------------------------------------------------ recent and wins
def _int(v: Any) -> int:
    try:
        return max(0, int(v or 0))
    except (TypeError, ValueError):
        return 0


def _label(e: dict) -> str:
    return str(e.get("title") or e.get("note") or e.get("key") or e.get("kind") or "").strip()[:90]


def recent_days(events: list[dict], today: str, days: int = RECENT_DAYS) -> list[dict]:
    """The last `days` days that have logged work, newest first. Each day: totals and the rows that earned XP;
    rows that earned none (a quest set, a note) are folded into one count, so a quiet day is one line."""
    since = add_days(today, -(days - 1))
    by_day: dict[str, list[dict]] = {}
    for e in events:
        if not isinstance(e, dict) or e.get("kind") in NOT_WORK:
            continue
        d = e.get("date")
        if isinstance(d, str) and since <= d <= today:
            by_day.setdefault(d, []).append(e)
    out = []
    for d in sorted(by_day, reverse=True):
        evs = sorted(by_day[d], key=lambda e: e.get("t") or 0, reverse=True)
        paying = [e for e in evs if _int(e.get("xp")) > 0]
        flat = [e for e in evs if _int(e.get("xp")) == 0]
        out.append({"date": d, "count": len(evs), "xp": sum(_int(e.get("xp")) for e in evs),
                    "minutes": sum(_int(e.get("minutes")) for e in evs),
                    "rows": [{"kind": e.get("kind"), "label": _label(e), "xp": _int(e.get("xp")),
                              "minutes": _int(e.get("minutes")) or None, "link": bool(e.get("verified"))}
                             for e in paying[:ROWS_PER_DAY]],
                    "more": max(0, len(paying) - ROWS_PER_DAY),
                    "zero_xp": {"count": len(flat), "minutes": sum(_int(e.get("minutes")) for e in flat),
                                "kinds": sorted({str(e.get("kind")) for e in flat})}})
    return out


def wins(events: list[dict], limit: int = 8) -> list[dict]:
    """Milestones that exist as events: something shipped, a certificate, a rank-up, a node mastered. Newest
    first. The old game's achievements are not here: they are client state, not a record the server holds."""
    keep = []
    for e in events:
        if not isinstance(e, dict) or not isinstance(e.get("date"), str):
            continue
        k = e.get("kind")
        if k in WIN_KINDS or (k == "node" and e.get("note") == "mastered"):
            keep.append(e)
    keep.sort(key=lambda e: (e["date"], e.get("t") or 0), reverse=True)
    names = {"ship": "Shipped", "cert": "Certificate", "project": "Project", "achievement": "Achievement",
             "rankup": "Level up", "node": "Mastered"}
    return [{"date": e["date"], "kind": e["kind"], "what": names.get(e["kind"], e["kind"]),
             "label": _label(e) if e["kind"] != "node" else str(e.get("node") or ""), "link": bool(e.get("verified")),
             "xp": _int(e.get("xp"))} for e in keep[:limit]]


# ------------------------------------------------------------------ advice
def load_advice(path: Optional[Path] = None) -> dict:
    """The advice file, cleaned: a line missing its author, work, year, kind, strength or limit is dropped (and
    listed in `dropped`), as is one whose text is not kind (ww_base.no_shame)."""
    p = path or ADVICE_FILE
    out: dict = {"lines": [], "dropped": [], "strengths": {}}
    try:
        raw = json.loads(p.read_text(encoding="utf-8-sig"))
    except (OSError, ValueError):
        out["dropped"].append("advice file unreadable")
        return out
    out["strengths"] = raw.get("strengths") or {}
    for ln in raw.get("lines") or []:
        src = ln.get("source") if isinstance(ln, dict) else None
        ok = (isinstance(src, dict) and all(src.get(k) for k in ADVICE_FIELDS) and ln.get("id") and ln.get("text")
              and ln.get("strength") in out["strengths"] and ln.get("limit") and no_shame(ln["text"]))
        if not ok:
            out["dropped"].append(str((ln or {}).get("id") if isinstance(ln, dict) else ln))
            continue
        out["lines"].append({"id": ln["id"], "when": [str(w) for w in ln.get("when") or []], "text": ln["text"],
                             "source": {k: src[k] for k in ADVICE_FIELDS},
                             "strength": ln["strength"], "strength_note": out["strengths"][ln["strength"]],
                             "limit": ln["limit"]})
    return out


def signals(cons: dict, series: list[dict], stats: Optional[list[dict]] = None) -> list[str]:
    """Which situations are true today, from the numbers (never from a guess)."""
    s = []
    if cons["ratio"] is not None and cons["ratio"] < 0.5:
        s.append("consistency_low")
    if any(c["want"] != "yes" and c["ratio"] is not None and c["ratio"] < 0.5 for c in cons["counters"]):
        s.append("counter_over")
    if not any(sr["weeks_with_data"] for sr in series):
        s.append("no_history")
    by = {x["id"]: x for x in stats or []}
    if by.get("recall") is not None and by["recall"]["value"] == 0:
        s.append("recall_low")
    if by.get("focus") is not None and by["focus"]["value"] == 0:
        s.append("focus_low")
    return s


def pick_advice(advice: dict, sig: list[str], today: str, n: int = 3) -> list[dict]:
    """Up to n lines whose `when` matches a true signal, else the "any" lines. Rotated by the day so the same
    three do not sit on screen all month; at most one philosophy line, and every line carries its source."""
    pool = [ln for ln in advice["lines"] if set(ln["when"]) & set(sig)] or [ln for ln in advice["lines"] if "any" in ln["when"]]
    pool = sorted(pool, key=lambda ln: ln["id"])
    if not pool:
        return []
    k = date.fromisoformat(today).toordinal() % len(pool)
    pool = pool[k:] + pool[:k]
    out, phil = [], 0
    for ln in pool:
        if ln["strength"] == "philosophy":
            if phil:
                continue
            phil += 1
        out.append(ln)
        if len(out) == n:
            break
    return out


# ------------------------------------------------------------------ suggestions with a place to go
# wellwisher.advice() returns plain sentences. Each rule's sentence starts with a fixed phrase, and the Proof
# panel shows a button under each one. Matching on the phrase keeps wellwisher.py untouched; the test builds
# the four situations from the real function and fails if a rule has no row here, so the two cannot drift.
SUGGESTION_GO: tuple[tuple[str, str, dict], ...] = (
    (r"^Consistency is ", "consistency", {"ws": "study", "view": None, "label": "Go to Study"}),
    (r"^None of the finished work has a link", "links", {"ws": "tree", "view": None, "label": "Go to Tree"}),
    (r"^Some nodes are marked mastered", "unproven", {"ws": "tree", "view": None, "label": "Go to Tree"}),
    (r"^Optional: the calisthenics quest line", "quest", {"card": "P4", "label": "Show quest lines"}),
)


def suggestions(lines: list[str]) -> list[dict]:
    """[{id, text, go, basis}]: `go` is {ws, view, label} (a workspace) or {card, label} (a card in the panel), or
    None for a sentence no row knows (never invented). `basis` says where the line comes from."""
    out = []
    for text in lines or []:
        hit = next(((i, go) for pat, i, go in SUGGESTION_GO if re.search(pat, text)), None)
        out.append({"id": hit[0] if hit else None, "text": text, "go": dict(hit[1]) if hit else None,
                    "basis": "A rule over your logged work; the numbers in the sentence are the ones it used."})
    return out


# ------------------------------------------------------------------ the whole answer
def status_v2(st: dict, inputs: dict, today: str, have: dict, current: str, stats: Optional[list[dict]] = None,
              advice: Optional[dict] = None, rules: Optional[list[str]] = None) -> dict:
    log = st.get("life") or {}
    counters = _counters(inputs)
    series = counter_series(log, counters, today)
    cons = consistency(log, counters, today)
    adv = advice if advice is not None else load_advice()
    events = st.get("events") or []
    return {"date": today, "series": series,
            "weeks_note": "A line needs " + str(MIN_LINE_WEEKS) + " weeks with logged days; a week with none is left out, never drawn as 0.",
            "consistency": cons, "rank": rank_requirements(have, current),
            "recent": recent_days(events, today), "wins": wins(events),
            "suggestions": suggestions(rules or []),
            "advice": pick_advice(adv, signals(cons, series, stats), today), "advice_dropped": adv["dropped"],
            "source": inputs.get("source")}
