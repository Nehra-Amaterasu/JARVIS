"""Paste parser for the manual intake: one line, one item.

    parse_paste(text, now) -> ParseResult

Each non-empty line is read for a title, a date and an optional time. Pure: the only clock is the
`now` argument (its calendar date is "today"), no file, no network, no state.

Date forms read: "18 Nov", "18th of November 2026", "Nov 18", "18/11", "18/11/26",
"18-11-2026", "18.11.2026", "2026-11-18", a weekday word ("Friday", "Fri", "next Monday",
"this Friday") and "today", "tonight", "tomorrow", "day after tomorrow". Time forms read:
"5 pm", "5:30pm", "12 am", "17:00".

Resolution rules (each decided so that no guess is hidden):
  - A date without a year resolves to the next occurrence on or after today (today counts).
    "29 Feb" waits for the next leap year.
  - A bare weekday is the next such day on or after today. "this X" is the same. "next X" is the
    first such day strictly after today, so on a Wednesday "next Monday" is 5 days away.
  - A numeric date whose two numbers can both be a day and a month ("03/04") is returned with
    BOTH readings in `readings` (day first, then month first), `ambiguous` true and `date` None:
    the parser never picks one. "18/11" is not ambiguous (there is no month 18) and "11/11" is
    not (both readings are the same day). Two-number dates are read only with "/" so that
    "Chapter 3-4" and "section 1.5" stay in the title; three-number dates take "/", "-" or ".".
  - A line with no date is kept as an item with `date` None and a reason. A line that cannot be
    read at all (an impossible date such as 31/02, an impossible time such as 25:00 or 13 pm, or
    nothing left once the date and time are taken out) goes to `unread`, never to `items`.
  - Only the first date and the first time of a line are used; text after them stays in the title.

TypedDicts (field by field, because C02 builds its store and routes on them):

ParseResult
    today     str    ISO date taken from `now`; every relative date was resolved against it.
    items     list[PasteItem]   readable lines, in input order.
    unread    list[UnreadLine]  lines that could not be read, in input order.

PasteItem
    line       int        1-based line number in the pasted text (blank lines are counted).
    raw        str        the line as pasted, stripped of surrounding blanks.
    title      str        the line without its date, time, bullet and linking words ("due", "on").
    date       str|None   ISO date, or None when there is none or when it is ambiguous.
    time       str|None   "HH:MM" on the 24-hour clock, or None.
    ambiguous  bool       true when the date can be read two ways; then `date` is None.
    readings   list[Reading]  [] without a date, one entry when the date is certain, two when it
                          is ambiguous (day first, then month first).
    date_text  str|None   the words that were read as the date (for showing the person).
    reason     str|None   why the item needs a look: no date, or ambiguous. None when clean.

Reading
    date   str   ISO date.
    order  str   "day-month" or "month-day" for numeric dates, "" for every other form.

UnreadLine
    line    int   1-based line number.
    raw     str   the line as pasted.
    reason  str   a sentence a screen can print.
"""
from __future__ import annotations

import re
from datetime import date, datetime, timedelta
from typing import TypedDict


class Reading(TypedDict):
    date: str
    order: str


class PasteItem(TypedDict):
    line: int
    raw: str
    title: str
    date: str | None
    time: str | None
    ambiguous: bool
    readings: list[Reading]
    date_text: str | None
    reason: str | None


class UnreadLine(TypedDict):
    line: int
    raw: str
    reason: str


class ParseResult(TypedDict):
    today: str
    items: list[PasteItem]
    unread: list[UnreadLine]


_MONTHS = {
    "jan": 1, "feb": 2, "mar": 3, "apr": 4, "may": 5, "jun": 6, "jul": 7, "aug": 8,
    "sep": 9, "oct": 10, "nov": 11, "dec": 12,
}
_MONTH_RE = (
    r"(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|"
    r"sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)"
)
_WEEKDAYS = {
    "mon": 0, "tue": 1, "wed": 2, "thu": 3, "fri": 4, "sat": 5, "sun": 6,
}
_WEEKDAY_RE = (
    r"(?:mon(?:day)?|tue(?:s(?:day)?)?|wed(?:nesday)?|thu(?:r(?:s(?:day)?)?)?|"
    r"fri(?:day)?|sat(?:urday)?|sun(?:day)?)"
)

_FLAGS = re.IGNORECASE
_TIME_AMPM = re.compile(r"(?<![\w:])(\d{1,2})(?::(\d{2}))?\s*([ap])\.?m\.?(?!\w)", _FLAGS)
_TIME_24 = re.compile(r"(?<![\w:])(\d{1,2}):(\d{2})(?![\w:])")
_ISO = re.compile(r"(?<![\w/.-])(\d{4})-(\d{1,2})-(\d{1,2})(?![\w/.-])")
_NUM3 = re.compile(r"(?<![\w/.-])(\d{1,2})([/.-])(\d{1,2})\2(\d{4}|\d{2})(?![\w/.-])")
_NUM2 = re.compile(r"(?<![\w/.-])(\d{1,2})/(\d{1,2})(?![\w/.-])(?!/\d)")
_MD = re.compile(
    rf"(?<!\w)({_MONTH_RE})\.?\s+(\d{{1,2}})(?:st|nd|rd|th)?(?!\d)(?:,?\s+(\d{{4}})(?!\d))?(?!\w)",
    _FLAGS)
_DM = re.compile(
    rf"(?<![\w/.-])(\d{{1,2}})(?:st|nd|rd|th)?\s+(?:of\s+)?({_MONTH_RE})\b\.?(?:,?\s+(\d{{4}})(?!\d))?",
    _FLAGS)
_WEEKDAY = re.compile(rf"(?<!\w)(?:(next|this|coming)\s+)?({_WEEKDAY_RE})(?!\w)", _FLAGS)
_RELATIVE = re.compile(r"(?<!\w)(day\s+after\s+tomorrow|tomorrow|tonight|today)(?!\w)", _FLAGS)
_REL_DAYS = {"today": 0, "tonight": 0, "tomorrow": 1, "day after tomorrow": 2}

_BULLET = re.compile(r"^\s*(?:[-*•]\s+|\d{1,2}[.)]\s+(?!" + _MONTH_RE + r"\b))", _FLAGS)
_LEAD_WORDS = re.compile(r"^(?:due|on|at|by|before|for|@)\b[\s,:;.-]*", _FLAGS)
_TRAIL_WORDS = re.compile(r"[\s,:;.-]*\b(?:due|on|at|by|before|for|@)$", _FLAGS)
_EDGE_PUNCT = " \t-–—:,;|@.()[]"


def _real_date(y: int, m: int, d: int) -> date | None:
    try:
        return date(y, m, d)
    except ValueError:
        return None


def _next_occurrence(m: int, d: int, today: date) -> date | None:
    # 9 years reach the next 29 Feb even across a skipped century year (2096 to 2104).
    for y in range(today.year, today.year + 9):
        got = _real_date(y, m, d)
        if got is not None and got >= today:
            return got
    return None


def _year4(y: str) -> int:
    n = int(y)
    return 2000 + n if len(y) == 2 else n


def _overlaps(a: tuple[int, int], b: tuple[int, int]) -> bool:
    return a[0] < b[1] and b[0] < a[1]


class _Unreadable(Exception):
    """A piece that was recognised but is impossible (31/02, 25:00)."""


def _read_time(text: str) -> tuple[str | None, tuple[int, int] | None]:
    m = _TIME_AMPM.search(text)
    if m:
        h, mi = int(m.group(1)), int(m.group(2) or 0)
        if not (1 <= h <= 12) or mi > 59:
            raise _Unreadable(f"'{m.group(0).strip()}' is not a time on the 12-hour clock")
        pm = m.group(3).lower() == "p"
        h = (h % 12) + (12 if pm else 0)
        return f"{h:02d}:{mi:02d}", m.span()
    m = _TIME_24.search(text)
    if m:
        h, mi = int(m.group(1)), int(m.group(2))
        if h > 23 or mi > 59:
            raise _Unreadable(f"'{m.group(0)}' is not a time")
        return f"{h:02d}:{mi:02d}", m.span()
    return None, None


def _explicit_dates(text: str, today: date):
    """Candidates with a stated day and month: (span, priority, readings, ambiguous, label)."""
    out = []
    bad: str | None = None

    def add(span, prio, readings, ambiguous):
        out.append((span, prio, readings, ambiguous))

    for m in _ISO.finditer(text):
        d = _real_date(int(m.group(1)), int(m.group(2)), int(m.group(3)))
        if d is None:
            bad = bad or m.group(0)
            continue
        add(m.span(), 0, [{"date": d.isoformat(), "order": ""}], False)

    for m in _NUM3.finditer(text):
        a, b, y = int(m.group(1)), int(m.group(3)), _year4(m.group(4))
        df, mf = _real_date(y, b, a), _real_date(y, a, b)
        _numeric(add, m, df, mf)
        if df is None and mf is None:
            bad = bad or m.group(0)

    for m in _NUM2.finditer(text):
        a, b = int(m.group(1)), int(m.group(2))
        df, mf = _next_occurrence(b, a, today), _next_occurrence(a, b, today)
        _numeric(add, m, df, mf)
        if df is None and mf is None:
            bad = bad or m.group(0)

    for m in _MD.finditer(text):
        mo, d = _MONTHS[m.group(1)[:3].lower()], int(m.group(2))
        got = _dated(mo, d, m.group(3), today)
        if got is None:
            bad = bad or m.group(0)
            continue
        add(m.span(), 1, [{"date": got.isoformat(), "order": ""}], False)

    for m in _DM.finditer(text):
        mo, d = _MONTHS[m.group(2)[:3].lower()], int(m.group(1))
        got = _dated(mo, d, m.group(3), today)
        if got is None:
            bad = bad or m.group(0)
            continue
        add(m.span(), 1 if m.group(3) else 2, [{"date": got.isoformat(), "order": ""}], False)
    return out, bad


def _dated(month: int, day: int, year: str | None, today: date) -> date | None:
    if year:
        return _real_date(int(year), month, day)
    return _next_occurrence(month, day, today)


def _numeric(add, m, df: date | None, mf: date | None) -> None:
    if df is None and mf is None:
        return
    if df is not None and mf is not None and df != mf:
        add(m.span(), 0, [{"date": df.isoformat(), "order": "day-month"},
                          {"date": mf.isoformat(), "order": "month-day"}], True)
        return
    got, order = (df, "day-month") if df is not None else (mf, "month-day")
    add(m.span(), 0, [{"date": got.isoformat(), "order": order}], False)


def _word_date(text: str, today: date):
    """A weekday word or a relative word: (span, date, label) or None."""
    m = _RELATIVE.search(text)
    if m:
        key = re.sub(r"\s+", " ", m.group(1).lower())
        return m.span(), today + timedelta(days=_REL_DAYS[key])
    m = _WEEKDAY.search(text)
    if m:
        target = _WEEKDAYS[m.group(2)[:3].lower()]
        delta = (target - today.weekday()) % 7
        if (m.group(1) or "").lower() == "next" and delta == 0:
            delta = 7
        return m.span(), today + timedelta(days=delta)
    return None


def _clean_title(text: str) -> str:
    t = re.sub(r"\s+", " ", text).strip(_EDGE_PUNCT + " ")
    for _ in range(4):  # "due by" is two linking words
        before = t
        t = _LEAD_WORDS.sub("", t)
        t = _TRAIL_WORDS.sub("", t)
        t = t.strip(_EDGE_PUNCT)
        if t == before:
            break
    return re.sub(r"\s+", " ", t).strip()


def _blank(text: str, spans: list[tuple[int, int]]) -> str:
    chars = list(text)
    for a, b in spans:
        for i in range(a, b):
            chars[i] = " "
    return "".join(chars)


def _read_line(raw: str, today: date) -> tuple[PasteItem | None, str | None]:
    """Return (item, None) or (None, reason)."""
    body = _BULLET.sub("", raw, count=1)
    spans: list[tuple[int, int]] = []
    try:
        clock, tspan = _read_time(body)
    except _Unreadable as e:
        return None, f"{e}."
    if tspan:
        spans.append(tspan)
    work = _blank(body, spans)

    cands, bad = _explicit_dates(work, today)
    readings: list[Reading] = []
    ambiguous = False
    date_text: str | None = None
    if cands:
        # Highest priority wins an overlap ("Nov 18" beats the "18 Nov" read inside "test 2 Nov 18"
        # only through its own span); then the leftmost kept candidate is the date of the line.
        kept: list = []
        for c in sorted(cands, key=lambda c: (c[1], c[0][0])):
            if all(not _overlaps(c[0], k[0]) for k in kept):
                kept.append(c)
        span, _prio, readings, ambiguous = min(kept, key=lambda c: c[0][0])
        date_text = work[span[0]:span[1]].strip()
        # A weekday word written right before the date ("Friday 20 Nov") is a label, not a title.
        lead = re.search(rf"{_WEEKDAY_RE}[\s,.]*$", work[:span[0]], _FLAGS)
        if lead:
            span = (lead.start(), span[1])
        spans.append(span)
    elif bad:
        return None, f"'{bad}' is not a real date."
    else:
        word = _word_date(work, today)
        if word:
            span, d = word
            readings = [{"date": d.isoformat(), "order": ""}]
            date_text = work[span[0]:span[1]].strip()
            spans.append(span)

    title = _clean_title(_blank(body, spans))
    if not title:
        return None, "Nothing is left for a title once the date and time are taken out."
    reason: str | None = None
    if not readings:
        reason = "No date found in this line."
    elif ambiguous:
        reason = "The date can be read day first or month first; pick one."
    return {
        "line": 0, "raw": raw, "title": title,
        "date": readings[0]["date"] if len(readings) == 1 else None,
        "time": clock, "ambiguous": ambiguous, "readings": readings,
        "date_text": date_text, "reason": reason,
    }, None


def parse_paste(text: str, now: datetime) -> ParseResult:
    """Read pasted lines into items. `now` supplies today's date and nothing else."""
    today = now.date()
    items: list[PasteItem] = []
    unread: list[UnreadLine] = []
    for n, line in enumerate((text or "").splitlines(), start=1):
        raw = line.strip()
        if not raw:
            continue
        item, why = _read_line(raw, today)
        if item is None:
            unread.append({"line": n, "raw": raw, "reason": why or "Could not be read."})
        else:
            item["line"] = n
            items.append(item)
    return {"today": today.isoformat(), "items": items, "unread": unread}
