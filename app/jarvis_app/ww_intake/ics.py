"""Calendar-file parser for the manual intake (RFC 5545 subset, standard library only).

    parse_ics(text, now, horizon_days=120) -> list[IcsEvent]

Pure: the only clock is `now`, no file, no network, no state. Steps: unfold folded lines, read
each VEVENT block (properties inside a nested VALARM are ignored), unescape text values, convert
every time to the local zone of `now`, expand simple repeats.

Times. DTSTART, DTEND and DUE are read in four shapes: UTC ("...Z"), a named zone
(TZID=Europe/Berlin, through zoneinfo), floating (no zone: read as wall time in the local zone)
and VALUE=DATE (all day). An unknown TZID is kept as floating time with a note, never dropped.
Every time is returned as an aware ISO string in the local zone of `now` (`now.tzinfo`; a naive
`now` is taken as UTC), so an event at 23:30Z lands on the next local day when the local zone is
ahead; `local_date` is that local day. An all-day event is returned as local midnight with
`all_day` true, and its end is the day after (RFC 5545 DTEND is exclusive).

Repeats. FREQ=WEEKLY and FREQ=DAILY, with INTERVAL, COUNT, UNTIL (inclusive), WKST and, for
weekly only, BYDAY (plain weekday codes) are expanded into one IcsEvent per occurrence whose local
date lies between today and today + horizon_days, both included. COUNT is counted from DTSTART,
so occurrences before today use up the count. A repeat is stepped in the event's own zone, so a
09:00 lesson in a named zone stays at 09:00 there across a daylight-saving change; an event in
UTC keeps its UTC time. EXDATE removes occurrences. Any other rule (monthly, yearly, BYMONTH,
BYDAY on a daily rule, an ordinal weekday such as 1MO, an unreadable value) returns the event
once, as written, with repeats "not expanded". RDATE and RECURRENCE-ID are not read (noted).
A repeating event with no occurrence inside the window returns nothing. An event without a
repeat is returned whatever its date; the caller decides what is past.

Malformed events never raise. They come back with status "skipped", a note saying why, and null
times, in the position they had in the file, so a screen can say "1 event could not be read".

IcsEvent (field by field; C02 builds its store and routes on it)
    status         str         "ok" or "skipped".
    uid            str         UID, "" when the file has none.
    summary        str         SUMMARY, unescaped ("" when missing, with a note).
    description    str         DESCRIPTION, unescaped.
    location       str         LOCATION, unescaped.
    start          str|None    aware ISO datetime in the local zone; None when skipped.
    end            str|None    aware ISO datetime, or None when the file gives neither DTEND nor
                               DURATION (all-day events always get one).
    due            str|None    aware ISO datetime of a DUE property, or None.
    all_day        bool        true for VALUE=DATE.
    local_date     str|None    ISO date of `start` in the local zone.
    original_zone  str         "UTC", the TZID name as written (also when unknown), "floating"
                               or "date".
    repeats        str         "none", "expanded" or "not expanded".
    rrule          str|None    the RRULE text as written.
    occurrence     int         0 for a single event or the first occurrence, then 1, 2, ...
    notes          list[str]   what the parser did that a person may want to see.
"""
from __future__ import annotations

import re
from dataclasses import dataclass
from datetime import date, datetime, time, timedelta, timezone, tzinfo
from typing import TypedDict
from zoneinfo import ZoneInfo

# One occurrence loop never runs past this many steps: a daily rule from a 1970 DTSTART with a
# COUNT of 10 million is cut off instead of freezing the app (50 years of days is 18,263).
_MAX_STEPS = 40000


class IcsEvent(TypedDict):
    status: str
    uid: str
    summary: str
    description: str
    location: str
    start: str | None
    end: str | None
    due: str | None
    all_day: bool
    local_date: str | None
    original_zone: str
    repeats: str
    rrule: str | None
    occurrence: int
    notes: list[str]


Prop = tuple[str, dict[str, str], str]  # name, params, raw value


class _BadValue(ValueError):
    pass


@dataclass
class _When:
    dt: datetime          # aware, in `tz`
    tz: tzinfo            # the zone repeats are stepped in
    all_day: bool
    zone: str             # original_zone text
    note: str | None = None


def _unfold(text: str) -> list[str]:
    # RFC 5545 3.1: a line break followed by one space or tab continues the line.
    flat = re.sub(r"\r\n[ \t]|\n[ \t]|\r[ \t]", "", text or "")
    return [ln for ln in re.split(r"\r\n|\n|\r", flat) if ln.strip()]


def _split_unquoted(s: str, sep: str, maxsplit: int = -1) -> list[str]:
    parts, cur, quoted = [], [], False
    for ch in s:
        if ch == '"':
            quoted = not quoted
        if ch == sep and not quoted and (maxsplit < 0 or len(parts) < maxsplit):
            parts.append("".join(cur))
            cur = []
        else:
            cur.append(ch)
    parts.append("".join(cur))
    return parts


def _parse_prop(line: str) -> Prop | None:
    head = _split_unquoted(line, ":", 1)
    if len(head) < 2:
        return None
    bits = _split_unquoted(head[0], ";")
    params: dict[str, str] = {}
    for p in bits[1:]:
        if "=" in p:
            k, v = p.split("=", 1)
            params[k.strip().upper()] = v.strip().strip('"')
    return bits[0].strip().upper(), params, head[1]


_ESC = re.compile(r"\\(.)", re.S)


def _unescape(v: str) -> str:
    # One pass, so "\\n" (backslash, then n) stays two characters and "\n" becomes a newline.
    return _ESC.sub(lambda m: "\n" if m.group(1) in "nN" else m.group(1), v)


def _zone(name: str) -> tzinfo | None:
    try:
        return ZoneInfo(name)
    except (KeyError, ValueError, OSError):
        return None


_DATE = re.compile(r"(\d{4})(\d{2})(\d{2})")
_DATETIME = re.compile(r"(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})?(Z?)", re.I)


def _read_when(value: str, params: dict[str, str], local: tzinfo) -> _When:
    v = value.strip()
    try:
        if params.get("VALUE", "").upper() == "DATE" or _DATE.fullmatch(v):
            m = _DATE.fullmatch(v)
            if not m:
                raise _BadValue(f"'{v}' is not a date")
            d = date(int(m.group(1)), int(m.group(2)), int(m.group(3)))
            return _When(datetime.combine(d, time(0), tzinfo=local), local, True, "date")
        m = _DATETIME.fullmatch(v)
        if not m:
            raise _BadValue(f"'{v}' is not a date-time")
        y, mo, d, h, mi = (int(m.group(i)) for i in range(1, 6))
        s = int(m.group(6) or 0)
        naive = datetime(y, mo, d, h, mi, s)
    except _BadValue:
        raise
    except ValueError as e:
        raise _BadValue(f"'{v}' is not a real date-time ({e})") from None
    if m.group(7):
        return _When(naive.replace(tzinfo=timezone.utc), timezone.utc, False, "UTC")
    tzid = params.get("TZID", "")
    if not tzid:
        return _When(naive.replace(tzinfo=local), local, False, "floating")
    zone = _zone(tzid)
    if zone is None:
        return _When(naive.replace(tzinfo=local), local, False, tzid,
                     f"Unknown time zone '{tzid}': read as local time.")
    return _When(naive.replace(tzinfo=zone), zone, False, tzid)


_DURATION = re.compile(
    r"([+-])?P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?", re.I)


def _read_duration(v: str) -> timedelta:
    m = _DURATION.fullmatch(v.strip())
    if not m or not any(m.group(i) for i in range(2, 7)):
        raise _BadValue(f"'{v}' is not a duration")
    w, d, h, mi, s = (int(m.group(i) or 0) for i in range(2, 7))
    td = timedelta(weeks=w, days=d, hours=h, minutes=mi, seconds=s)
    return -td if m.group(1) == "-" else td


_WD = {"MO": 0, "TU": 1, "WE": 2, "TH": 3, "FR": 4, "SA": 5, "SU": 6}


@dataclass
class _Rule:
    freq: str
    interval: int
    count: int | None
    until: _When | None
    byday: list[int]
    wkst: int


class _NotExpanded(Exception):
    pass


def _read_rule(text: str, event_when: _When) -> _Rule:
    parts: dict[str, str] = {}
    for piece in text.split(";"):
        if "=" not in piece:
            raise _NotExpanded(f"RRULE part '{piece}' is not KEY=VALUE")
        k, v = piece.split("=", 1)
        parts[k.strip().upper()] = v.strip()
    freq = parts.pop("FREQ", "").upper()
    if freq not in ("DAILY", "WEEKLY"):
        raise _NotExpanded(f"FREQ={freq or '(missing)'} is not expanded (daily and weekly only)")
    try:
        interval = int(parts.pop("INTERVAL", "1"))
        count_s = parts.pop("COUNT", None)
        count = int(count_s) if count_s is not None else None
    except ValueError:
        raise _NotExpanded("INTERVAL or COUNT is not a number") from None
    if interval < 1 or (count is not None and count < 1):
        raise _NotExpanded("INTERVAL and COUNT must be 1 or more")
    until = None
    if "UNTIL" in parts:
        uv = parts.pop("UNTIL")
        try:
            # A floating UNTIL is wall time in the event's own zone (RFC 5545 3.3.10).
            until = _read_when(uv, {}, event_when.tz)
        except _BadValue:
            raise _NotExpanded(f"UNTIL '{uv}' is not readable") from None
    wkst = _WD.get(parts.pop("WKST", "MO").upper())
    if wkst is None:
        raise _NotExpanded("WKST is not a weekday code")
    byday: list[int] = []
    if "BYDAY" in parts:
        if freq != "WEEKLY":
            raise _NotExpanded("BYDAY on a daily rule is not expanded")
        for code in parts.pop("BYDAY").split(","):
            wd = _WD.get(code.strip().upper())
            if wd is None:
                raise _NotExpanded(f"BYDAY '{code}' is not a plain weekday code")
            byday.append(wd)
    if parts:
        raise _NotExpanded("RRULE part " + ", ".join(sorted(parts)) + " is not expanded")
    return _Rule(freq, interval, count, until, byday, wkst)


def _occurrences(start: datetime, rule: _Rule, lo: date, hi: date,
                 local: tzinfo) -> list[datetime]:
    """Occurrence starts (aware, in start's zone) whose local date lies in [lo, hi]."""
    tz = start.tzinfo
    wall = start.timetz().replace(tzinfo=None)
    d0 = start.date()
    out: list[datetime] = []

    def make(d: date) -> datetime:
        return datetime.combine(d, wall, tzinfo=tz)

    def past_until(occ: datetime) -> bool:
        u = rule.until
        if u is None:
            return False
        if u.all_day:
            return occ.date() > u.dt.date()
        return occ > u.dt

    def local_date(occ: datetime) -> date:
        return occ.astimezone(local).date()

    if rule.freq == "DAILY":
        # The occurrence index is k itself, so the jump to the window is valid with a COUNT too.
        k = max(0, ((lo - d0).days - 2) // rule.interval)
        for step in range(_MAX_STEPS):
            if rule.count is not None and k >= rule.count:
                break
            d = d0 + timedelta(days=k * rule.interval)
            if d > hi + timedelta(days=1):
                break
            occ = make(d)
            if past_until(occ):
                break
            if lo <= local_date(occ) <= hi:
                out.append(occ)
            k += 1
        return out

    days = sorted(set(rule.byday or [start.weekday()]), key=lambda w: (w - rule.wkst) % 7)
    anchor = d0 - timedelta(days=(d0.weekday() - rule.wkst) % 7)
    w = 0
    if rule.count is None:
        w = max(0, ((lo - anchor).days // (7 * rule.interval)) - 1)
    produced = 0
    for _ in range(_MAX_STEPS):
        week_start = anchor + timedelta(days=7 * rule.interval * w)
        if week_start > hi + timedelta(days=1):
            break
        for wd in days:
            d = week_start + timedelta(days=(wd - rule.wkst) % 7)
            if d < d0:
                continue
            if rule.count is not None and produced >= rule.count:
                return out
            occ = make(d)
            if past_until(occ):
                return out
            produced += 1
            if lo <= local_date(occ) <= hi:
                out.append(occ)
        w += 1
    return out


def _iso(dt: datetime, local: tzinfo) -> str:
    return dt.astimezone(local).isoformat()


def _skipped(props: dict[str, list[tuple[dict[str, str], str]]], why: str) -> IcsEvent:
    def first(name: str) -> str:
        return _unescape(props[name][0][1]) if props.get(name) else ""
    return {
        "status": "skipped", "uid": first("UID"), "summary": first("SUMMARY"),
        "description": "", "location": "", "start": None, "end": None, "due": None,
        "all_day": False, "local_date": None, "original_zone": "", "repeats": "none",
        "rrule": None, "occurrence": 0, "notes": [why],
    }


def _event(props: dict[str, list[tuple[dict[str, str], str]]], now: datetime,
           local: tzinfo, horizon_days: int) -> list[IcsEvent]:
    def first(name: str) -> tuple[dict[str, str], str] | None:
        return props[name][0] if props.get(name) else None

    notes: list[str] = []
    ds, due_p = first("DTSTART"), first("DUE")
    try:
        due = _read_when(due_p[1], due_p[0], local) if due_p else None
    except _BadValue as e:
        due = None
        notes.append(f"DUE not read: {e}.")
    try:
        if ds:
            start = _read_when(ds[1], ds[0], local)
        elif due is not None:
            start = due
            notes.append("No DTSTART: the start is taken from DUE.")
        else:
            return [_skipped(props, "No DTSTART: the event has no start time.")]
    except _BadValue as e:
        return [_skipped(props, f"DTSTART not read: {e}.")]
    if start.note:
        notes.append(start.note)

    end_dt: datetime | None = None
    de, dur = first("DTEND"), first("DURATION")
    try:
        if de:
            end = _read_when(de[1], de[0], local)
            end_dt = end.dt
            if end.note and end.note not in notes:
                notes.append(end.note)
        elif dur:
            end_dt = start.dt + _read_duration(dur[1])
        elif start.all_day:
            end_dt = start.dt + timedelta(days=1)
    except _BadValue as e:
        notes.append(f"End not read: {e}.")
    if end_dt is not None and end_dt < start.dt:
        notes.append("The end is before the start.")
    length = (end_dt - start.dt) if end_dt is not None else None

    summary = _unescape(first("SUMMARY")[1]) if first("SUMMARY") else ""
    if not summary:
        notes.append("No SUMMARY: the event has no title.")
    rr = first("RRULE")
    if first("RDATE"):
        notes.append("RDATE is not read.")
    base: IcsEvent = {
        "status": "ok",
        "uid": _unescape(first("UID")[1]) if first("UID") else "",
        "summary": summary,
        "description": _unescape(first("DESCRIPTION")[1]) if first("DESCRIPTION") else "",
        "location": _unescape(first("LOCATION")[1]) if first("LOCATION") else "",
        "start": None, "end": None,
        "due": _iso(due.dt, local) if due else None,
        "all_day": start.all_day, "local_date": None, "original_zone": start.zone,
        "repeats": "none", "rrule": rr[1] if rr else None, "occurrence": 0, "notes": notes,
    }

    def build(s: datetime, occurrence: int, repeats: str, extra: list[str]) -> IcsEvent:
        e = dict(base)
        e["start"] = _iso(s, local)
        e["end"] = _iso(s + length, local) if length is not None else None
        e["local_date"] = s.astimezone(local).date().isoformat()
        e["repeats"] = repeats
        e["occurrence"] = occurrence
        e["notes"] = list(notes) + extra
        return e  # type: ignore[return-value]

    if not rr:
        return [build(start.dt, 0, "none", [])]
    try:
        rule = _read_rule(rr[1], start)
    except _NotExpanded as e:
        return [build(start.dt, 0, "not expanded", [f"Repeat not expanded: {e}."])]

    today = now.date()
    lo, hi = today, today + timedelta(days=max(0, horizon_days))
    skip_dt: set[datetime] = set()
    skip_days: set[date] = set()
    for params, val in props.get("EXDATE", []):
        for piece in val.split(","):
            try:
                ex = _read_when(piece, params, start.tz)
            except _BadValue:
                notes.append(f"EXDATE '{piece}' not read.")
                continue
            if ex.all_day:
                skip_days.add(ex.dt.date())
            else:
                skip_dt.add(ex.dt)
    occs = _occurrences(start.dt, rule, lo, hi, local)
    kept = [o for o in occs if o not in skip_dt and o.date() not in skip_days]
    return [build(o, i, "expanded", []) for i, o in enumerate(kept)]


def parse_ics(text: str, now: datetime, horizon_days: int = 120) -> list[IcsEvent]:
    """Read the VEVENT blocks of an iCalendar text; see the module docstring for every rule."""
    local: tzinfo = now.tzinfo or timezone.utc
    out: list[IcsEvent] = []
    cur: dict[str, list[tuple[dict[str, str], str]]] | None = None
    depth = 0  # nesting inside the event (a VALARM): its properties are not the event's
    for line in _unfold(text):
        prop = _parse_prop(line)
        if prop is None:
            continue
        name, params, value = prop
        kind = value.strip().upper()
        if name == "BEGIN":
            if kind == "VEVENT":
                if cur is not None:
                    out.append(_skipped(cur, "The event was not closed with END:VEVENT."))
                cur, depth = {}, 0
            elif cur is not None:
                depth += 1
            continue
        if name == "END":
            if cur is None:
                continue
            if kind == "VEVENT" and depth == 0:
                try:
                    out.extend(_event(cur, now, local, horizon_days))
                except Exception as e:  # a parser bug must not lose the other events
                    out.append(_skipped(cur, f"The event could not be read ({type(e).__name__})."))
                cur = None
            elif depth > 0:
                depth -= 1
            continue
        if cur is not None and depth == 0:
            cur.setdefault(name, []).append((params, value))
    if cur is not None:
        out.append(_skipped(cur, "The event was not closed with END:VEVENT."))
    return out
