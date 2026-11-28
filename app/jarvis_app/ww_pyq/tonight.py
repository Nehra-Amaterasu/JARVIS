"""Tonight: the evening practice sheet the app builds by itself, and the marks he types back (N01, R-55 to R-59).

    load_settings(store) / save_settings(store, changes)     tonight/settings.json  {on, hour, count, horizon_days}
    sheet_id(date, subject) / check_sheet_id(sid)           "<date>-<subject>"; a bad id is a KeyError (404), never a path
    load_sheet / save_sheet / list_sheets                   sheets/<id>.json under the pyq store (the shared shape below)
    recent_question_ids(store, subject, before, n=3)        the questions of the last three earlier sheets of a subject
    choose(picks, accepted, exclude, count, salt)           one question a topic, in the counted order of R-17
    make_sheet(...) / why_of(pick, days_left)               the stored sheet and the printed terms that chose each item
    apply_marks(sheet, rows, at)                            marks he typed: checked, and a second mark replaces the first
    clock_step(store, now, build, remind)                   the clock: at most one sheet and one reminder a day

The sheet file is read by the ledger (N02), so its shape is fixed by the plan (9.0, 27 Nov) and nothing else goes in it:

    {id, date, subject, built_at, items: [{n, question_id, marks, unit, topic, topic_key}],
     marks: [{question_id, got, max, minutes or null, at}]}

The printed terms of each item (`why`) live beside it in tonight/why/<id>.json, outside sheets/, so a reader that globs
sheets/*.json meets only sheets. The order of topics is not computed here: the route passes the picks of
ww_pyq.next.practise_next (R-17) and this module only walks them. Which question of a topic stands on the sheet is a
sha256 of the sheet id and the question id, so the same day and subject always draw the same question (no clock, no
random state, no hash()). No number here is a guess: marks are the ones he typed, counts are counts.
"""
from __future__ import annotations

import hashlib
import json
import re
import threading
from datetime import date, datetime
from pathlib import Path
from typing import Any, Callable, Optional

from .blueprint import write_json_atomic
from .store import NOT_PRINTED

SHEETS = "sheets"
DIR = "tonight"
DEFAULTS = {"on": False, "hour": "19:00", "count": 6, "horizon_days": 21}
COUNT_MIN, COUNT_MAX = 3, 12          # fewer than 3 is not a sheet; 12 questions is about an evening at 3 minutes a mark
HORIZON_MIN, HORIZON_MAX = 1, 60      # past 60 days a paper is next semester, not tonight
RECENT_SHEETS = 3                     # a question does not come back while it stood on one of the last 3 sheets
MAX_MINUTES = 600                     # ten hours on one question is a typo
OUT_OF_MAX = 100                      # his own maximum for a question whose marks are not printed; a paper's whole is 100
RETRY_S = 600                         # a day with nothing to set is looked at again every 10 min, not on every 30 s look:
                                      # each try recomputes R-17's order over the whole bank
_SHEET_ID = re.compile(r"^(\d{4}-\d{2}-\d{2})-([a-z0-9][a-z0-9_-]{0,39})$")
_SUBJECT = re.compile(r"^[a-z0-9][a-z0-9_-]{0,39}$")
_HOUR = re.compile(r"^([01]\d|2[0-3]):([0-5]\d)$")
_LOCK = threading.RLock()             # every read-modify-write of a sheet, the settings and the clock


def _plural(n: int, one: str, many: str) -> str:
    return f"{n} {one if n == 1 else many}"


def _g(x: Any) -> str:
    return format(float(x), "g")


def _root(store) -> Path:
    return Path(store.root)


def _read(path: Path) -> Optional[dict]:
    try:
        d = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None
    return d if isinstance(d, dict) else None


# ------------------------------------------------------------------ dates and ids
def check_date(value: Any) -> str:
    if not isinstance(value, str) or not re.fullmatch(r"\d{4}-\d{2}-\d{2}", value):
        raise ValueError("Give the date like 2026-11-27.")
    try:
        return date.fromisoformat(value).isoformat()
    except ValueError:
        raise ValueError("Give the date like 2026-11-27.") from None


def sheet_id(day: str, subject: str) -> str:
    day = check_date(day)
    if not isinstance(subject, str) or not _SUBJECT.match(subject):
        raise ValueError("This subject's id cannot name a sheet.")
    return f"{day}-{subject}"


def check_sheet_id(sid: Any) -> str:
    """An id that reaches a path: anything but <date>-<subject> is an unknown sheet (404)."""
    if not isinstance(sid, str) or not _SHEET_ID.match(sid):
        raise KeyError("No such sheet.")
    try:
        date.fromisoformat(sid[:10])
    except ValueError:
        raise KeyError("No such sheet.") from None
    return sid


# ------------------------------------------------------------------ settings
def _settings_path(store) -> Path:
    return _root(store) / DIR / "settings.json"


def load_settings(store) -> dict:
    d = _read(_settings_path(store)) or {}
    out = dict(DEFAULTS)
    if isinstance(d.get("on"), bool):
        out["on"] = d["on"]
    if isinstance(d.get("hour"), str) and _HOUR.match(d["hour"]):
        out["hour"] = d["hour"]
    for k, lo, hi in (("count", COUNT_MIN, COUNT_MAX), ("horizon_days", HORIZON_MIN, HORIZON_MAX)):
        v = d.get(k)
        if isinstance(v, int) and not isinstance(v, bool) and lo <= v <= hi:
            out[k] = v
    return out


def _whole(v: Any, what: str, lo: int, hi: int) -> int:
    if isinstance(v, bool) or not isinstance(v, int) or not lo <= v <= hi:
        raise ValueError(f"The {what} is a whole number from {lo} to {hi}.")
    return v


def save_settings(store, changes: Any) -> dict:
    if not isinstance(changes, dict) or not changes:
        raise ValueError("Send any of on, hour, count and horizon_days.")
    unknown = set(changes) - set(DEFAULTS)
    if unknown:
        raise ValueError("Send only on, hour, count and horizon_days.")
    new = {}
    if "on" in changes:
        if not isinstance(changes["on"], bool):
            raise ValueError("On is true or false.")
        new["on"] = changes["on"]
    if "hour" in changes:
        if not isinstance(changes["hour"], str) or not _HOUR.match(changes["hour"]):
            raise ValueError("Give the hour like 19:00.")
        new["hour"] = changes["hour"]
    if "count" in changes:
        new["count"] = _whole(changes["count"], "number of questions", COUNT_MIN, COUNT_MAX)
    if "horizon_days" in changes:
        new["horizon_days"] = _whole(changes["horizon_days"], "horizon", HORIZON_MIN, HORIZON_MAX)
    with _LOCK:
        cur = _read(_settings_path(store)) or {}
        write_json_atomic(_settings_path(store), {**cur, **new})
    return load_settings(store)


# ------------------------------------------------------------------ sheets on disk
def _sheet_path(store, sid: str) -> Path:
    return _root(store) / SHEETS / f"{check_sheet_id(sid)}.json"


def _why_path(store, sid: str) -> Path:
    return _root(store) / DIR / "why" / f"{check_sheet_id(sid)}.json"


def load_sheet(store, sid: str) -> dict:
    d = _read(_sheet_path(store, sid))
    if d is None or d.get("id") != sid or not isinstance(d.get("items"), list):
        raise KeyError("No such sheet.")
    d.setdefault("marks", [])
    return d


def find_sheet(store, sid: str) -> Optional[dict]:
    try:
        return load_sheet(store, sid)
    except KeyError:
        return None


def save_sheet(store, sheet: dict, why: Optional[dict] = None) -> dict:
    with _LOCK:
        write_json_atomic(_sheet_path(store, sheet["id"]), sheet)
        if why is not None:
            write_json_atomic(_why_path(store, sheet["id"]), why)
    return sheet


def load_why(store, sid: str) -> dict:
    return _read(_why_path(store, sid)) or {}


def list_sheets(store, subject: Optional[str] = None) -> list[dict]:
    """Sheets on file, newest date first."""
    out = []
    for f in (_root(store) / SHEETS).glob("*.json"):
        try:
            check_sheet_id(f.stem)
        except KeyError:
            continue
        s = find_sheet(store, f.stem)
        if s is None or (subject and s.get("subject") != subject):
            continue
        out.append(s)
    return sorted(out, key=lambda s: (s.get("date") or "", s["id"]), reverse=True)


def recent_question_ids(store, subject: str, before: str, n: int = RECENT_SHEETS) -> set:
    """The questions of the last n sheets of the subject dated before `before` (the sheet being built is not one)."""
    earlier = [s for s in list_sheets(store, subject) if (s.get("date") or "") < before][:n]
    return {it.get("question_id") for s in earlier for it in s.get("items") or [] if it.get("question_id")}


def unmarked(sheet: dict) -> int:
    done = {m.get("question_id") for m in sheet.get("marks") or []}
    return sum(1 for it in sheet.get("items") or [] if it.get("question_id") not in done)


# ------------------------------------------------------------------ building
def _draw(salt: str, qid: str) -> str:
    return hashlib.sha256(f"{salt}|{qid}".encode("utf-8")).hexdigest()


def can_stand(q: dict) -> bool:
    """Marks on file, or a question-bank question accepted with its marks not printed (wave EW11): he gives out_of
    when he marks it (R-58)."""
    return q.get("marks") is not None or q.get("marks_source") == NOT_PRINTED


def choose(picks: list[dict], accepted: dict, exclude: set, count: int, salt: str) -> list[tuple[dict, dict]]:
    """Walk the picks of R-17 in their order and take one question of each topic that is accepted, can stand (marks, or
    marks not printed), did not stand on the last sheets and is not on this one yet. `salt` is the sheet id: the same
    id, the same draw."""
    chosen: list[tuple[dict, dict]] = []
    taken: set = set()
    for p in picks:
        if len(chosen) >= count:
            break
        cands = [qid for qid in p.get("question_ids") or []
                 if qid in accepted and qid not in exclude and qid not in taken and can_stand(accepted[qid])]
        if not cands:
            continue
        qid = min(cands, key=lambda q: (_draw(salt, q), q))
        taken.add(qid)
        chosen.append((p, accepted[qid]))
    return chosen


def why_of(pick: dict, days_left: Optional[int]) -> dict:
    """The printed terms of R-17 that put this topic on the sheet, and the days to the paper."""
    t = pick.get("terms") or {}
    # measured as R-17 has it: false while the topic has fewer than MIN_ATTEMPTS marks, so a screen can say the
    # proficiency printed is the neutral default and not his own
    return {"days_left": days_left, "marks_weight": t.get("marks_weight"), "share": t.get("seen_share"),
            "proficiency": t.get("proficiency"), "measured": t.get("measured") is True,
            "syllabus_weight": t.get("syllabus_weight")}


def make_sheet(sid: str, day: str, subject: str, chosen: list[tuple[dict, dict]], built_at: str) -> dict:
    items = []
    for n, (p, q) in enumerate(chosen, 1):
        m = None if q.get("marks") is None else float(q["marks"])        # null: marks not printed, out_of comes with his mark
        items.append({"n": n, "question_id": q["id"], "marks": None if m is None else int(m) if m == int(m) else m,
                      "unit": p.get("unit"), "topic": p.get("topic") or "", "topic_key": p.get("key") or ""})
    return {"id": sid, "date": day, "subject": subject, "built_at": built_at, "items": items, "marks": []}


# ------------------------------------------------------------------ marks
def _number(v: Any, what: str) -> float:
    if isinstance(v, bool) or not isinstance(v, (int, float)) or v != v:
        raise ValueError(f"{what} is a number.")
    return float(v)


def keeps(rows: list) -> dict:
    """{question_id: out_of} of the marks he asked to keep as the question's own marks (`keep: true`, R-58). Call it
    only on rows apply_marks has passed."""
    return {r["question_id"]: r["out_of"] for r in rows if r.get("keep") is True}


def apply_marks(sheet: dict, rows: Any, at: str) -> tuple[dict, list[dict]]:
    """Check every mark before any is kept: a question on this sheet, `got` from 0 to its marks, minutes from 0 to 600
    or none. A question whose marks are not printed (its item's marks null) needs `out_of`, his own number from 1 to 100,
    and `got` is from 0 to that; `keep` (true or false) may only come with out_of, and a question that prints its
    marks takes neither. The kept row holds out_of as its max, so the ledger and proficiency read got over max as for
    any other. A question marked again replaces its earlier mark. Returns the new sheet and the kept rows."""
    if not isinstance(rows, list) or not rows:
        raise ValueError("Send the marks as {items: [{question_id, got, minutes?, out_of?, keep?}]}.")
    if len(rows) > COUNT_MAX:
        raise ValueError(f"A sheet holds at most {COUNT_MAX} questions.")
    on_sheet = {it["question_id"]: it for it in sheet.get("items") or []}
    kept, seen = [], set()
    for r in rows:
        if not isinstance(r, dict) or set(r) - {"question_id", "got", "minutes", "out_of", "keep"}:
            raise ValueError("Each mark is {question_id, got, minutes?, out_of?, keep?}.")
        qid = r.get("question_id")
        if not isinstance(qid, str) or qid not in on_sheet:
            raise ValueError("That question is not on this sheet.")
        if qid in seen:
            raise ValueError("A question is marked once in one post.")
        seen.add(qid)
        printed = on_sheet[qid].get("marks")
        if printed is None:
            if "out_of" not in r:
                raise ValueError("This question's marks are not printed: give out_of, your own number from 1 to 100.")
            mx = _number(r["out_of"], "Out of")
            if not 1 <= mx <= OUT_OF_MAX:
                raise ValueError(f"Out of is a number from 1 to {OUT_OF_MAX}.")
            if "keep" in r and not isinstance(r["keep"], bool):
                raise ValueError("Keep is true or false.")
        else:
            if "out_of" in r or "keep" in r:
                raise ValueError("This question prints its marks; out_of and keep are for one whose marks are not printed.")
            mx = float(printed)
        got = _number(r.get("got"), "Got")
        if not 0 <= got <= mx:
            raise ValueError(f"Marks for a {_g(mx)}-mark question are from 0 to {_g(mx)}.")
        minutes = r.get("minutes")
        if minutes is not None:
            minutes = _number(minutes, "Minutes")
            if not 0 <= minutes <= MAX_MINUTES:
                raise ValueError(f"Minutes are from 0 to {MAX_MINUTES}.")
            minutes = int(minutes) if minutes == int(minutes) else minutes
        kept.append({"question_id": qid, "got": int(got) if got == int(got) else got,
                     "max": int(mx) if mx == int(mx) else mx, "minutes": minutes, "at": at})
    marks = [m for m in sheet.get("marks") or [] if m.get("question_id") not in seen] + kept
    order = {it["question_id"]: it["n"] for it in sheet.get("items") or []}
    marks.sort(key=lambda m: order.get(m.get("question_id"), 0))
    return {**sheet, "marks": marks}, kept


# ------------------------------------------------------------------ the clock
def _clock_path(store) -> Path:
    return _root(store) / DIR / "clock.json"


def reminder_text(n: int, subject_name: str, days_left: Optional[int]) -> str:
    paper = ("" if days_left is None else ", paper today" if days_left == 0
             else f", paper in {_plural(days_left, 'day', 'days')}")
    return f"Tonight's sheet: {_plural(n, 'question', 'questions')}, {subject_name}{paper}"


def _since(iso: Any, now: datetime) -> Optional[float]:
    try:
        return (now - datetime.fromisoformat(str(iso))).total_seconds()
    except ValueError:
        return None


def _not_handled(store, before: dict, day: str, now: datetime) -> None:
    """Nothing was reminded for `day`: give the day back, with the time of the try, so a later look tries again."""
    with _LOCK:
        write_json_atomic(_clock_path(store), {"day": before.get("day"), "at": before.get("at"), "waiting": day,
                                               "tried": now.isoformat(timespec="seconds")})


def clock_step(store, now: datetime, build: Callable[[str], Optional[dict]], remind: Callable[[str], Any]) -> Optional[dict]:
    """One look at the clock. Off: nothing at all. On and past `hour` on a day not handled yet: the day is written as
    handled first (so a crash after it can never give a second reminder), then the sheet is built and, when there
    is one, one reminder is raised. When the build gives nothing or fails, no reminder went out, so the day is given
    back and tried again RETRY_S later: a question accepted at 19:05 still gives tonight's sheet (review, 27 Nov).
    `build(day)` answers {sheet, subject_name, days_left} or None (nothing to set); `remind(text)` hands the line to
    the app's reminder service. Returns what was done, or None."""
    s = load_settings(store)
    if not s["on"]:
        return None
    h, m = (int(x) for x in s["hour"].split(":"))
    if (now.hour, now.minute) < (h, m):
        return None
    day = now.date().isoformat()
    with _LOCK:
        before = _read(_clock_path(store)) or {}
        if before.get("day") == day:
            return None
        ago = _since(before.get("tried"), now) if before.get("waiting") == day else None
        if ago is not None and 0 <= ago < RETRY_S:
            return None
        write_json_atomic(_clock_path(store), {"day": day, "at": now.isoformat(timespec="seconds")})
    try:
        made = build(day)
    except Exception:
        _not_handled(store, before, day, now)
        raise
    if not made or not (made.get("sheet") or {}).get("items"):
        _not_handled(store, before, day, now)
        return {"day": day, "sheet": None, "reminded": False}
    text = reminder_text(len(made["sheet"]["items"]), made.get("subject_name") or made["sheet"]["subject"], made.get("days_left"))
    remind(text)
    return {"day": day, "sheet": made["sheet"]["id"], "reminded": True, "text": text}
