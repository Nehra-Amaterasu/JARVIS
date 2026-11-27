"""The ledger: per syllabus topic, what is on file about it, every number counted from files (plan 9.0, 27 Nov 2026, N02).

    sheet_rows(sheets, subject)                       -> (rows, skipped)   the marks typed on evening sheets (N01's files)
    paper_rows(attempts, papers, subject)             -> (rows, skipped)   the marks typed on generated papers (R-27)
    newest_first(rows)                                -> rows              the one order every list of marks uses
    filter_rows(rows, topic_key, frm, to)             -> rows              R-61's filters; dates are inclusive days
    build_ledger(topics, questions, papers, notes, rows) -> {items, holes, totals}          R-60
    build_pace(topic_keys, rows, exams, subject, today)  -> {paper_date, days_left, ...}    R-62
    parse_day(value, name)                            -> "YYYY-MM-DD" or None; ValueError with a sentence

Pure: inputs in, dicts out, no file and no clock read here (the routes file gathers both), so two runs on the same
inputs give the same answer and the gate can compare them.

Where each number comes from, so it can be redone by hand:
  - the topics are tag.topics_of(subject): one per syllabus topic, keyed "<unit>|<topic>" (ww_generator.topic_key);
    `syllabus_weight` is the unit's exam weight as R-17 prints it (high 3, med 2, low 1).
  - past_questions, past_marks and papers_seen are patterns.compute_patterns over his accepted, tagged questions:
    past_questions is the length of the topic's question list, papers_seen its k, past_marks the sum of their marks.
    A question the local model drafted (origin "model-draft") is left out first: it was never set in a paper.
  - families is the number of distinct families (families.find_families, a single question being its own family)
    among those questions: 5 questions where two came back with other numbers are 4 families.
  - notes is the number of his notes that drafts.passages finds a passage in for the topic (the rule R-50 uses to
    choose what the model reads), with no length cut so every note that mentions the topic is counted.
  - attempts, got, max, minutes and last_practised add up the marks rows of the topic: one row per question marked,
    from a sheet (the last mark of a question on a sheet replaces the earlier one, as R-58 says) or from a generated
    paper (one sitting of one question per paper and day: a later line that day is a correction and replaces it;
    a mark outside 0..max or not a finite number is left out and reported). minutes is the sum of the minutes he typed,
    null when no row of the topic has any.
  - a hole is a count of zero (no_notes, no_past_question, never_practised) or `got` under half of `max` over at least
    2 attempts (under_half): one mark under half is one bad evening, two are a pattern he can see.
The pace (R-62) is plain division on his own log: over the last 7 days with a mark (fewer when fewer exist), the
topics marked for the first time on those days, divided by those days. Nothing here forecasts a mark or a result.
"""
from __future__ import annotations

import math
import re
from datetime import date
from typing import Any, Iterable, Optional

from .. import ww_generator
from . import drafts, families, patterns

PACE_DAYS = 7               # the window of R-62: a week of evenings is enough rows to divide and short enough to be his now
UNDER_HALF_MIN = 2          # under_half needs this many attempts: one bad sheet is not a hole
WEIGHTS = {"high": 3, "med": 2, "low": 1}     # the same numbers R-17 prints as syllabus_weight
_NO_CUT = 10 ** 9           # passages() with no length cut: every note that mentions the topic counts
_DAY = re.compile(r"^\d{4}-\d{2}-\d{2}$")
HOLE_KINDS = ("no_notes", "no_past_question", "never_practised", "under_half")


def _plural(n: int, one: str, many: str) -> str:
    return f"{n} {one if n == 1 else many}"


def _g(x: float) -> str:
    return format(float(x), "g")


def _num(x: Any) -> Optional[float]:
    # NaN and Infinity read as numbers from a hand-edited file (Python's json accepts them) and would make every sum
    # NaN and the answer unprintable as JSON: they are not marks
    if isinstance(x, bool) or not isinstance(x, (int, float)) or not math.isfinite(x):
        return None
    return float(x)


def _bad_mark(got: float, mx: float) -> bool:
    """A mark outside 0..max (or a question of no marks) cannot be one he typed through N01 or R-27, which both refuse
    it; counting a 50 of 5 from a damaged file would lift the topic's total, so it is left out and reported."""
    return mx <= 0 or got < 0 or got > mx


def parse_day(value: Any, name: str = "date") -> Optional[str]:
    """A day as YYYY-MM-DD, or None for no value; anything else is a ValueError the screen can print."""
    if value is None or value == "":
        return None
    s = str(value).strip()
    if _DAY.match(s):
        try:
            date.fromisoformat(s)
            return s
        except ValueError:
            pass
    raise ValueError(f"{name} is a date like 2026-11-27.")


def day_of(at: Any) -> Optional[str]:
    """The day of a mark's `at` (a date or a date-time); None when it is not one."""
    s = str(at or "")[:10]
    try:
        return parse_day(s) if s else None
    except ValueError:
        return None


# ------------------------------------------------------------------ the marks on file
def sheet_rows(sheets: Iterable[dict], subject: str) -> tuple[list[dict], list[dict]]:
    """Marks rows from evening sheets already read from disk ({file, sheet}); a mark that is not on the sheet, or has
    no numbers, is left out and reported, never guessed."""
    rows, skipped = [], []
    for entry in sheets:
        name, sh = entry.get("file", ""), entry.get("sheet") or {}
        if str(sh.get("subject") or "").lower() != subject:
            continue
        keys = {}
        for it in sh.get("items") or []:
            if isinstance(it, dict) and isinstance(it.get("question_id"), str):
                key = it.get("topic_key") or ww_generator.topic_key(it.get("unit"), str(it.get("topic") or ""))
                keys[it["question_id"]] = (str(key), _num(it.get("marks")))
        last: dict[str, dict] = {}
        for m in sh.get("marks") or []:
            qid = m.get("question_id") if isinstance(m, dict) else None
            got = _num((m or {}).get("got")) if isinstance(m, dict) else None
            if qid not in keys or got is None:
                skipped.append({"file": name, "reason": "A mark that names no question of its sheet, or has no number, was left out."})
                continue
            mx = _num(m.get("max"))
            mx = mx if mx is not None else keys[qid][1]
            day = day_of(m.get("at")) or day_of(sh.get("date"))
            if mx is None or day is None:
                skipped.append({"file": name, "reason": "A mark without its maximum or its day was left out."})
                continue
            if _bad_mark(got, mx):
                skipped.append({"file": name, "reason": "A mark under 0 or over its question's marks was left out."})
                continue
            row = {"at": str(m.get("at") or day), "source": "sheet", "source_id": str(sh.get("id") or ""), "question_id": qid,
                   "topic_key": keys[qid][0], "got": got, "max": mx, "minutes": _num(m.get("minutes"))}
            # a second mark for the same question replaces the first (R-58): the later one stands
            if qid not in last or str(row["at"]) >= str(last[qid]["at"]):
                last[qid] = row
        rows.extend(last.values())
    return rows, skipped


def paper_rows(attempts: Iterable[dict], papers: dict, subject: str) -> tuple[list[dict], list[dict]]:
    """Marks rows from attempts.jsonl as R-27 appends them ({question_id, paper_id, got, max, marked_by, date}), with the
    topic read from the seat of the generated paper. `papers` maps a paper id to the generated paper, or to None when
    that file is missing; only ids of generated papers (g-...) are read here, so a line another writer adds for a sheet
    is counted once, from the sheet."""
    rows, skipped = [], []
    last: dict[tuple, dict] = {}
    for a in attempts:
        pid = a.get("paper_id")
        if pid not in papers:
            continue
        paper = papers[pid]
        if paper is None:
            skipped.append({"file": "attempts.jsonl", "reason": "A mark names a practice paper that is no longer on file; it was left out."})
            continue
        if str(paper.get("subject") or "").lower() != subject:
            continue
        seats = {x.get("question_id"): x for s in paper.get("sections") or [] for x in s.get("slots") or []
                 if isinstance(x, dict) and x.get("question_id")}
        seat = seats.get(a.get("question_id"))
        got, mx, day = _num(a.get("got")), _num(a.get("max")), day_of(a.get("date"))
        if seat is None or got is None or mx is None or day is None:
            skipped.append({"file": "attempts.jsonl", "reason": "A mark with no seat on its paper, no number or no day was left out."})
            continue
        if _bad_mark(got, mx):
            skipped.append({"file": "attempts.jsonl", "reason": "A mark under 0 or over its question's marks was left out."})
            continue
        # R-27 refuses a question twice in one post but appends a second post, so a corrected mark is a second line:
        # on the same paper and day the later line replaces the earlier (as a second post does on a sheet, R-58);
        # on another day it is another sitting and counts again
        last[(pid, str(a["question_id"]), day)] = {
            "at": day, "source": "paper", "source_id": str(pid), "question_id": str(a["question_id"]),
            "topic_key": ww_generator.topic_key(seat.get("unit"), str(seat.get("topic") or "")),
            "got": got, "max": mx, "minutes": None}
    rows.extend(last.values())
    return rows, skipped


def newest_first(rows: Iterable[dict]) -> list[dict]:
    """Newest first by `at`; equal times in a fixed order (source, source id, question) so two runs list alike."""
    out = sorted(rows, key=lambda r: (r["source"], r["source_id"], r["question_id"]))
    return sorted(out, key=lambda r: str(r["at"]), reverse=True)


def filter_rows(rows: Iterable[dict], topic_key: Optional[str] = None, frm: Optional[str] = None,
                to: Optional[str] = None) -> list[dict]:
    if frm and to and frm > to:
        raise ValueError("from is a day on or before to.")
    out = []
    for r in rows:
        d = day_of(r["at"]) or ""
        if topic_key and r["topic_key"] != topic_key:
            continue
        if (frm and d < frm) or (to and d > to):
            continue
        out.append(r)
    return newest_first(out)


# ------------------------------------------------------------------ R-60
def _hole(item: dict, kind: str) -> dict:
    t = item["topic"]
    text = {
        "no_notes": f"No note of yours mentions {t}.",
        "no_past_question": f"No accepted past question on file is tagged {t}.",
        "never_practised": f"No mark on file for {t}.",
        "under_half": f"{t}: {_g(item['got'])} of {_g(item['max'])} over {_plural(item['attempts'], 'attempt', 'attempts')}, under half.",
    }[kind]
    return {"key": item["key"], "kind": kind, "sentence": text}


def build_ledger(topics: list[dict], questions: list[dict], papers: list[dict], notes: list[dict],
                 rows: list[dict], unit_titles: Optional[dict] = None) -> dict:
    """One item per syllabus topic, the holes among them and the totals. `topics` is tag.topics_of(subject),
    `questions` and `papers` the subject's from the store, `notes` [{file_id, title, text}], `rows` every mark."""
    past = [q for q in questions if q.get("origin") != "model-draft"]
    ps = patterns.compute_patterns(past, papers)
    by_topic = {t["key"]: t for t in ps["topics"]}
    qmarks = {q["id"]: float(q.get("marks") or 0) for q in past}
    counted_ids = {qid for t in ps["topics"] for qid in t["questions"]}
    fam_of = {qid: f["id"] for f in families.find_families([q for q in past if q["id"] in counted_ids]) for qid in f["question_ids"]}
    marks_by: dict[str, list[dict]] = {}
    for r in rows:
        marks_by.setdefault(r["topic_key"], []).append(r)
    items, holes = [], []
    for t in topics:
        key = t["key"]
        pt = by_topic.get(key) or {}
        qids = list(pt.get("questions") or [])
        _, sources = drafts.passages(notes, t["topic"], (unit_titles or {}).get(t["unit"], ""), _NO_CUT)
        mine = marks_by.get(key) or []
        mins = [r["minutes"] for r in mine if r.get("minutes") is not None]
        item = {"key": key, "unit": t["unit"], "topic": t["topic"], "syllabus_weight": WEIGHTS.get(t.get("weight", "med"), 2),
                "notes": len(sources), "past_questions": len(qids), "past_marks": sum(qmarks.get(q, 0.0) for q in qids),
                "papers_seen": int(pt.get("k") or 0), "families": len({fam_of.get(q, q) for q in qids}),
                "attempts": len(mine), "got": sum(r["got"] for r in mine), "max": sum(r["max"] for r in mine),
                "minutes": sum(mins) if mins else None,
                "last_practised": max((day_of(r["at"]) for r in mine), default=None),
                # the rows behind two of the counts, so the screen can open them (R-61 opens the marks)
                "question_ids": sorted(qids), "note_files": [s["file_id"] for s in sources]}
        items.append(item)
        if not item["notes"]:
            holes.append(_hole(item, "no_notes"))
        if not item["past_questions"]:
            holes.append(_hole(item, "no_past_question"))
        if not item["attempts"]:
            holes.append(_hole(item, "never_practised"))
        elif item["attempts"] >= UNDER_HALF_MIN and item["got"] < item["max"] / 2:
            holes.append(_hole(item, "under_half"))
    keys = {t["key"] for t in topics}
    mins = [i["minutes"] for i in items if i["minutes"] is not None]
    totals = {"topics": len(items), "with_notes": sum(1 for i in items if i["notes"]),
              "with_past_question": sum(1 for i in items if i["past_questions"]),
              "practised": sum(1 for i in items if i["attempts"]),
              "past_questions": sum(i["past_questions"] for i in items), "past_marks": sum(i["past_marks"] for i in items),
              "attempts": sum(i["attempts"] for i in items), "got": sum(i["got"] for i in items),
              "max": sum(i["max"] for i in items), "minutes": sum(mins) if mins else None,
              "holes": {k: sum(1 for h in holes if h["kind"] == k) for k in HOLE_KINDS},
              # marks whose topic is not (or no longer) in the syllabus: listed by R-61, counted here, in no item
              "attempts_outside_syllabus": sum(1 for r in rows if r["topic_key"] not in keys)}
    return {"items": items, "holes": holes, "totals": totals}


def ledger_sentence(led: dict) -> str:
    t = led["totals"]
    return (f"{_plural(t['topics'], 'topic', 'topics')}: {t['with_notes']} in your notes, {t['with_past_question']} with a past "
            f"question, {t['practised']} practised; {_plural(len(led['holes']), 'hole', 'holes')}.")


# ------------------------------------------------------------------ R-62
def next_paper(exams: Iterable[dict], subject: str, today: str) -> Optional[dict]:
    """The nearest paper of the subject today or later on the date sheet; a paper already sat is not the next one."""
    ahead = [e for e in exams if str(e.get("subject") or "").lower() == subject and day_of(e.get("date"))
             and day_of(e.get("date")) >= today]
    return min(ahead, key=lambda e: (day_of(e["date"]), str(e.get("id") or ""))) if ahead else None


def build_pace(topic_keys: list[str], rows: list[dict], exams: Iterable[dict], subject: str, today: str) -> dict:
    keys = list(dict.fromkeys(topic_keys))
    paper = next_paper(exams, subject, today)
    paper_date = day_of(paper["date"]) if paper else None
    days_left = (date.fromisoformat(paper_date) - date.fromisoformat(today)).days if paper_date else None
    mine = [r for r in rows if (day_of(r["at"]) or "9999") <= today]           # a mark dated after today is not yet his log
    first: dict[str, str] = {}
    for r in mine:
        d = day_of(r["at"])
        if r["topic_key"] in keys and (r["topic_key"] not in first or d < first[r["topic_key"]]):
            first[r["topic_key"]] = d
    window = sorted({day_of(r["at"]) for r in mine}, reverse=True)[:PACE_DAYS]
    practised, left = len(first), len(keys) - len(first)
    out = {"paper_date": paper_date, "days_left": days_left, "topics": len(keys), "practised": practised, "left": left,
           "days_counted": len(window), "from": window[-1] if window else None, "to": window[0] if window else None,
           "practised_in_days": None, "per_day": None, "days_needed": None, "sentence": ""}
    paper_part = (f" The paper is on {paper_date}, {_plural(days_left, 'day', 'days')} from today." if paper_date and days_left
                  else f" The paper is today, {paper_date}." if paper_date else " No paper of this subject is on the date sheet ahead.")
    if not window:
        out["sentence"] = "No mark on file for this subject yet; the pace is counted from your marks." + paper_part
        return out
    new = sum(1 for d in first.values() if d >= window[-1])
    out["practised_in_days"] = new
    out["per_day"] = round(new / len(window), 2)
    span = f"your last {_plural(len(window), 'day', 'days')} with a mark ({window[-1]} to {window[0]})" if len(window) > 1 \
        else f"your one day with a mark ({window[0]})"
    s = f"Counted over {span}: {_plural(new, 'topic', 'topics')} marked for the first time, {out['per_day']:g} a day."
    if left == 0:
        out["days_needed"] = 0
        s += " Every topic of the syllabus has a mark on file."
    elif new:
        out["days_needed"] = -(-left * len(window) // new)        # left / per_day, rounded up to whole days, in whole numbers
        s += f" At that rate the topics left ({left}) take {_plural(out['days_needed'], 'more day', 'more days')} with a mark."
    else:
        s += f" At that rate the topics left ({left}) give no number of days."
    out["sentence"] = s + paper_part
    return out
