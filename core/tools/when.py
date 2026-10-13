"""Times and reminders, parsed without the model (English and Hinglish).

"remind me at 9 to call Mum", "medicine at 8 am every day", "timer for 10 minutes",
"kal subah 7 baje yaad dilana ki form bharna hai", "fan band kar do 1 ghante baad".

Why a parser and not the model: a reminder at the wrong hour is worse than none, and
the 4B model is weak at clock arithmetic. The common forms are parsed here, instantly
and the same way every time; the model's set_reminder tool hands its `when` phrase to
this same parser, so there is one notion of time. Every confirmation says the
resolved time back ("9 pm today"), so a wrong guess is heard at once.

Rules for the ambiguous cases (each tested):
  * "at 9" with no am/pm and no day: the next 9:00 or 21:00, whichever comes first.
  * "tomorrow at 9" (a day, no am/pm): 7–11 is morning, 12 is noon, 1–6 is afternoon.
  * subah/morning, dopahar/afternoon, shaam/evening and raat/night settle am/pm;
    "raat 2 baje" is 2 am.
  * a date or day with no time: 9 am.
  * "kal" is tomorrow (a reminder is never for yesterday).
  * a time that has already passed today, with no day said, means tomorrow.

All functions take `now` (a naive local datetime) so tests are deterministic.
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from typing import Callable, Optional

# ------------------------------------------------------------------ numbers
_NUM_WORDS = {
    "a": 1, "an": 1, "one": 1, "ek": 1, "two": 2, "do": 2, "three": 3, "teen": 3, "four": 4, "char": 4,
    "chaar": 4, "five": 5, "paanch": 5, "panch": 5, "six": 6, "chhe": 6, "chhah": 6, "seven": 7, "saat": 7,
    "eight": 8, "aath": 8, "nine": 9, "nau": 9, "ten": 10, "das": 10, "eleven": 11, "gyarah": 11,
    "twelve": 12, "barah": 12, "fifteen": 15, "pandrah": 15, "twenty": 20, "bees": 20, "twenty five": 25,
    "pachees": 25, "thirty": 30, "tees": 30, "forty": 40, "chalees": 40, "forty five": 45, "fifty": 50,
    "pachaas": 50, "sixty": 60, "ninety": 90, "half": 0.5, "aadha": 0.5, "adha": 0.5, "aadhe": 0.5,
    "dedh": 1.5, "dhai": 2.5, "dhaai": 2.5, "couple of": 2, "a couple of": 2,
}
_NUM_ALT = "|".join(sorted((re.escape(k) for k in _NUM_WORDS), key=len, reverse=True))
_UNIT_H = r"hours?|hrs?|ghante|ghanta|ghanton"
_UNIT_M = r"minutes?|mins?|minat|minute"
_UNIT_S = r"seconds?|secs?|sec"
_UNIT_D = r"days?|din|dino|dinon"
_UNIT_W = r"weeks?|hafte|hafta|haftey"
_UNITS = "|".join((_UNIT_W, _UNIT_D, _UNIT_H, _UNIT_M, _UNIT_S))
# Digits may touch the unit ("10min", "2h"); a word-number needs a space ("an hour").
_DUR_ONE = re.compile(
    r"(?:(?P<d>\d+(?:\.\d+)?)\s*-?\s*(?P<du>" + _UNITS + r"|h)"
    r"|\b(?P<w>" + _NUM_ALT + r")\s+(?P<wu>" + _UNITS + r"))\b", re.I)
_DUR_SPECIAL = [
    (re.compile(r"\b(?:an?|one|1)\s+(?:and\s+a\s+)?half\s+hours?\b|\b(?:an?|one|1)\s+hour\s+and\s+a\s+half\b", re.I), 90 * 60),
    (re.compile(r"\bhalf\s+an?\s+hour\b|\bhalf\s+hour\b|\b(?:aadha|adha)\s+ghant[aey]\b", re.I), 30 * 60),
    (re.compile(r"\b(?:a\s+)?quarter\s+(?:of\s+an\s+)?hour\b", re.I), 15 * 60),
]
_JOIN = re.compile(r"^\s*(?:,|and|aur|&)?\s*$", re.I)


def _unit_seconds(unit: str) -> int:
    u = unit.lower()
    if u.startswith(("week", "haft")):
        return 7 * 86400
    if u.startswith(("day", "din")):
        return 86400
    if u.startswith(("h", "g")):
        return 3600
    if u.startswith("s"):
        return 1
    return 60


def find_duration(text: str) -> Optional[tuple[int, int, int]]:
    """(seconds, start, end) of the first duration ("1 hour 30 minutes", "dedh ghanta")."""
    for rx, secs in _DUR_SPECIAL:
        m = rx.search(text)
        if m:
            return secs, m.start(), m.end()
    parts = list(_DUR_ONE.finditer(text))
    if not parts:
        return None
    first = parts[0]
    total, start, end = 0.0, first.start(), first.end()
    for i, m in enumerate(parts):
        if i and not _JOIN.match(text[end:m.start()]):
            break
        if m.group("d"):
            n, unit = float(m.group("d")), m.group("du")
        else:
            n, unit = float(_NUM_WORDS[m.group("w").lower()]), m.group("wu")
        total += n * _unit_seconds(unit)
        end = m.end()
    return (int(round(total)), start, end) if total > 0 else None


# ------------------------------------------------------------------ words for time
_WEEKDAYS = {
    0: r"monday|mon|somvar|somwar", 1: r"tuesday|tues|tue|mangalvar|mangalwar",
    2: r"wednesday|wed|budhvar|budhwar", 3: r"thursday|thurs|thu|guruvar|guruwar|brihaspativar",
    4: r"friday|fri|shukravar|shukrawar", 5: r"saturday|sat|shanivar|shaniwar",
    6: r"sunday|sun|ravivar|raviwar|itvar|itwar",
}
_MONTHS = ["january|jan", "february|feb", "march|mar", "april|apr", "may", "june|jun", "july|jul",
           "august|aug", "september|sept|sep", "october|oct", "november|nov", "december|dec"]
_MONTH_ALT = "|".join(_MONTHS)
_WD_ALT = "|".join(_WEEKDAYS.values())

_DAYPART = [
    ("morning", re.compile(r"\b(?:morning|subah|subha|savere|sawere|in the am)\b", re.I)),
    ("noon", re.compile(r"\b(?:noon|midday)\b", re.I)),
    ("midnight", re.compile(r"\b(?:midnight|aadhi raat)\b", re.I)),
    ("afternoon", re.compile(r"\b(?:afternoon|dopahar|dupahar|dopehar)\b", re.I)),
    ("evening", re.compile(r"\b(?:evening|shaam|sham)\b", re.I)),
    ("night", re.compile(r"\b(?:tonight|night|raat|rat)\b", re.I)),
]
_DAYPART_DEFAULT = {"morning": (8, 0), "noon": (12, 0), "midnight": (0, 0), "afternoon": (14, 0),
                    "evening": (18, 0), "night": (21, 0)}
# The hour each part of the day ends: "this evening" said at 7 pm is still evening.
_DAYPART_END = {"morning": 12, "noon": 13, "midnight": 0, "afternoon": 17, "evening": 21, "night": 24}

_DAY_WORDS = [
    (7, re.compile(r"\b(?:next\s+week|agle\s+hafte)\b", re.I)),
    (2, re.compile(r"\b(?:day after tomorrow|parso|parson)\b", re.I)),
    (1, re.compile(r"\b(?:tomorrow|tmrw|tmr|kal)\b", re.I)),
    (0, re.compile(r"\b(?:today|aaj|tonight)\b", re.I)),
]
_WEEKDAY = re.compile(r"\b(?:(?P<next>next|this|agle|aane wale)\s+)?(?P<wd>" + _WD_ALT + r")\b(?:\s+ko\b)?", re.I)
_DATE_DM = re.compile(r"\b(?P<d>\d{1,2})(?:st|nd|rd|th)?\s+(?:of\s+)?(?P<mon>" + _MONTH_ALT + r")\b", re.I)
_DATE_MD = re.compile(r"\b(?P<mon>" + _MONTH_ALT + r")\s+(?P<d>\d{1,2})(?:st|nd|rd|th)?\b", re.I)
_DATE_NUM = re.compile(r"\b(?P<d>\d{1,2})[/-](?P<m>\d{1,2})(?:[/-](?P<y>\d{2,4}))?\b")
_DATE_NTH = re.compile(r"\bon\s+the\s+(?P<d>\d{1,2})(?:st|nd|rd|th)\b", re.I)

_PREP = r"(?:\b(?:at|@|by|around|for|till|until|se)\s+)"
_CLOCK = re.compile(
    r"(?P<prep>" + _PREP + r")?"
    r"(?<![\d.:/])(?P<h>\d{1,2})(?:[:.](?P<m>\d{2}))?(?![\d/])"
    r"(?:\s*(?P<ap>a\.\s?m\.?|p\.\s?m\.?|am\b|pm\b|baje\b|bje\b|o'?\s?clock\b|hrs\b|hours\b(?=\s*$)))?", re.I)
_HINDI_CLOCK = re.compile(r"\b(?P<q>saa?dh?e|sa?wa|sava|paune|pone)\s+(?P<h>\d{1,2})(?:\s+baje)?\b"
                          r"|\b(?P<frac>dedh|dhaa?i)\s+baje\b", re.I)

_REPEAT = [
    ("weekdays", re.compile(r"\b(?:every\s+weekday|on\s+weekdays|weekdays|monday\s+to\s+friday)\b", re.I)),
    ("daily", re.compile(r"\b(?:every\s*day|each\s+day|daily|every\s+single\s+day|roz(?:ana)?|roj|"
                         r"har\s+(?:din|roz)|harroz|every\s+(?:morning|evening|night|afternoon)|"
                         r"har\s+(?:subah|shaam|sham|raat))\b", re.I)),
    ("weekly", re.compile(r"\b(?:every\s+week|weekly|har\s+hafte)\b", re.I)),
]
_EVERY_WD = re.compile(r"\b(?:every|each|har)\s+(?P<wd>" + _WD_ALT + r")\b", re.I)
_INTERVAL = re.compile(r"\b(?:every|har)\s+(?:(?P<n>\d+|" + _NUM_ALT + r")\s+)?(?P<u>" + _UNIT_H + "|" + _UNIT_M
                       + r")\b", re.I)
_RELATIVE_BEFORE = re.compile(r"\b(?:in|after|within)\s+(?:the\s+next\s+)?$", re.I)
_RELATIVE_AFTER = re.compile(r"^\s*(?:baad|ke\s+baad|later|from\s+now|mein|me|main)\b", re.I)


@dataclass
class When:
    due: datetime
    repeat: Optional[str] = None          # "daily" | "weekdays" | "weekly"
    interval_min: Optional[int] = None    # "every 8 hours"
    explicit_clock: bool = False           # a clock time was said ("at 9", "8 am", "9 baje")
    relative_s: Optional[int] = None       # "in 10 minutes"
    spans: list = field(default_factory=list)

    @property
    def repeating(self) -> bool:
        return bool(self.repeat or self.interval_min)


def _overlaps(a: tuple, spans: list) -> bool:
    return any(a[0] < b[1] and b[0] < a[1] for b in spans)


def _pick_ampm(h: int, m: int, ap: Optional[str], daypart: Optional[str]) -> list[int]:
    """Candidate 24-hour values for a spoken hour."""
    ap = (ap or "").lower().replace(".", "").replace(" ", "")
    if ap.startswith("a"):
        return [h % 12]
    if ap.startswith("p"):
        return [h % 12 + 12]
    if h >= 13 or h == 0:
        return [h % 24]
    if daypart == "morning":
        return [h % 12]
    if daypart in ("afternoon", "evening"):
        return [h if h == 12 else h + 12]
    if daypart == "night":
        if h == 12:
            return [0]
        return [h] if h <= 4 else [h + 12 if h < 12 else h]
    if daypart == "noon":
        return [12]
    return [h % 12, h % 12 + 12] if h != 12 else [12, 0]


def parse_when(text: str, now: datetime, bare_duration: bool = False, prefer_am: bool = False) -> Optional[When]:
    """The time a phrase points at, or None. `bare_duration`: a duration with no "in"/
    "baad" still counts (timers: "timer for 10 minutes", "10 minute ka timer").
    `prefer_am`: alarms — "wake me at 6:30" said in the evening is 6:30 am."""
    usual = (lambda h: h % 12 if h != 12 else 12) if prefer_am else _usual_hour
    s = text or ""
    spans: list = []
    repeat, interval_min, weekly_wd = None, None, None

    m = _INTERVAL.search(s)
    if m:
        n = m.group("n")
        k = float(n) if n and n[0].isdigit() else float(_NUM_WORDS.get((n or "one").lower(), 1))
        interval_min = int(round(k * (60 if m.group("u").lower().startswith(("h", "g")) else 1)))
        spans.append(m.span())
    m = _EVERY_WD.search(s)
    if m:
        repeat = "weekly"
        weekly_wd = next(i for i, alt in _WEEKDAYS.items() if re.fullmatch(alt, m.group("wd"), re.I))
        spans.append(m.span())
    for name, rx in _REPEAT:
        m = rx.search(s)
        if m and not _overlaps(m.span(), spans):
            repeat = repeat or name
            spans.append(m.span())

    # Relative: "in 10 minutes", "2 ghante baad"; a bare duration only for timers.
    relative_s = None
    if not interval_min:
        d = find_duration(s)
        if d and not _overlaps(d[1:], spans):
            secs, a, b = d
            before = _RELATIVE_BEFORE.search(s[:a])
            after = _RELATIVE_AFTER.match(s[b:])
            if before or after or bare_duration:
                relative_s = secs
                a2 = before.start() if before else a
                b2 = b + (after.end() if after else 0)
                spans.append((a2, b2))

    # Clock: "at 9", "9:30 pm", "21:00", "9 baje", "saade 9 baje".
    hour = minute = None
    ap = None
    explicit = False
    hm = _HINDI_CLOCK.search(s)
    if hm and not _overlaps(hm.span(), spans):
        if hm.group("frac"):
            hour, minute = (1, 30) if hm.group("frac").lower().startswith("ded") else (2, 30)
        else:
            q, h = hm.group("q").lower(), int(hm.group("h"))
            if q.startswith(("saa", "sad", "sade")):
                hour, minute = h, 30
            elif q.startswith(("saw", "sav", "sw")):
                hour, minute = h, 15
            else:
                hour, minute = (h - 1) % 12 or 12, 45
        explicit = True
        spans.append(hm.span())
    if hour is None:
        for cm in _CLOCK.finditer(s):
            if _overlaps(cm.span(), spans):
                continue
            h, mm, prep, apm = int(cm.group("h")), cm.group("m"), cm.group("prep"), cm.group("ap")
            # A bare number is a clock only with "at"/"by" before it or am/pm/baje after
            # it, and never when a duration unit follows ("10 minutes").
            if not (prep or apm or mm):
                continue
            if prep and prep.strip().lower() == "for" and not (apm or mm):
                continue
            if re.match(r"\s*(?:" + _UNITS + r")\b", s[cm.end("h"):], re.I) \
                    and not mm:
                continue
            if h > 23 or (mm and int(mm) > 59):
                continue
            hour, minute, ap, explicit = h, int(mm) if mm else 0, apm, True
            if apm and apm.lower().startswith("hours"):
                ap = None
            spans.append(cm.span())
            break

    daypart = None
    for name, rx in _DAYPART:
        dm = rx.search(s)
        if dm and not _overlaps(dm.span(), spans):
            daypart = name
            spans.append(dm.span())
            break

    # The day: tomorrow / a weekday / a date.
    day = None
    for offset, rx in _DAY_WORDS:
        dm = rx.search(s)
        if dm and not _overlaps(dm.span(), spans):
            day = (now + timedelta(days=offset)).date()
            spans.append(dm.span())
            if dm.group(0).lower() == "tonight" and daypart is None:
                daypart = "night"
            break
    if day is None:
        wm = _WEEKDAY.search(s)
        if wm and not _overlaps(wm.span(), spans):
            wd = next(i for i, alt in _WEEKDAYS.items() if re.fullmatch(alt, wm.group("wd"), re.I))
            delta = (wd - now.weekday()) % 7
            if delta == 0 and wm.group("next"):
                delta = 7
            day = (now + timedelta(days=delta)).date()
            spans.append(wm.span())
    if day is None:
        for rx in (_DATE_DM, _DATE_MD, _DATE_NUM, _DATE_NTH):
            dm = rx.search(s)
            if not dm or _overlaps(dm.span(), spans):
                continue
            try:
                dd = int(dm.group("d"))
                if rx is _DATE_NUM:
                    mon = int(dm.group("m"))
                    y = int(dm.group("y")) if dm.group("y") else now.year
                    y = y + 2000 if y < 100 else y
                elif rx is _DATE_NTH:
                    mon, y = now.month, now.year
                else:
                    mon = next(i + 1 for i, alt in enumerate(_MONTHS) if re.fullmatch(alt, dm.group("mon"), re.I))
                    y = now.year
                cand = datetime(y, mon, dd).date()
            except (ValueError, StopIteration):
                continue
            if cand < now.date() and not (rx is _DATE_NUM and dm.group("y")):
                cand = (datetime(y + 1, mon, dd) if rx is not _DATE_NTH else
                        (datetime(y + (mon == 12), mon % 12 + 1, dd))).date()
            day = cand
            spans.append(dm.span())
            break

    # ---------------------------------------------------------- resolve
    if relative_s is not None:
        return When(due=now + timedelta(seconds=relative_s), repeat=repeat, interval_min=None,
                    explicit_clock=False, relative_s=relative_s, spans=spans)
    if hour is None and daypart is None and day is None:
        if interval_min:
            return When(due=now + timedelta(minutes=interval_min), interval_min=interval_min, spans=spans)
        return None
    ambiguous = False
    if hour is None:
        if daypart is None and repeat is not None and day is None:
            return None                              # "every day" — but when?
        hour, minute = _DAYPART_DEFAULT.get(daypart or "", (9, 0))
        if daypart is not None and not repeat and (day is None or day == now.date()):
            passed = now.replace(hour=hour, minute=minute, second=0, microsecond=0) <= now
            if passed and now.hour < _DAYPART_END[daypart]:
                return None                          # "this evening", said in the evening: ask when
        cands = [hour]
    else:
        cands = _pick_ampm(hour, minute or 0, ap, daypart)
        ambiguous = len(cands) == 2
        if ambiguous and (day is not None or repeat or interval_min):
            cands, ambiguous = [usual(hour)], False

    if repeat == "weekly" and weekly_wd is not None and day is None:
        delta = (weekly_wd - now.weekday()) % 7
        day = (now + timedelta(days=delta)).date()
    base = day or now.date()
    if daypart == "night" and day is not None and cands and max(cands) <= 4:
        base = base + timedelta(days=1)              # "aaj raat 2 baje" is after midnight

    def at(d, hours):
        return sorted(datetime.combine(d, datetime.min.time()).replace(hour=h, minute=minute or 0) for h in hours)
    options = at(base, cands)
    future = [o for o in options if o > now]
    if future:
        due = future[0]                              # "at 9" at 7 pm: 9 pm today
    elif day is not None and not repeat:
        due = options[0]                             # an explicit day in the past: the caller refuses it
    else:
        if ambiguous:                                # "5 baje" at 7 pm: 5 pm tomorrow, not 5 am
            options = at(base, [usual(hour)])
        step = 7 if repeat == "weekly" else 1
        due = options[0] + timedelta(days=step)
        while due <= now:
            due += timedelta(days=step)
    if repeat == "weekdays":
        while due.weekday() >= 5:
            due += timedelta(days=1)
    return When(due=due, repeat=repeat, interval_min=interval_min, explicit_clock=explicit, spans=spans)


def _usual_hour(h: int) -> int:
    """An hour with no am/pm when it is not today's next one: 7–11 morning, 12 noon,
    1–6 afternoon/evening (how people in this house schedule things)."""
    return h if 7 <= h <= 11 else 12 if h == 12 else h + 12 if 1 <= h <= 6 else h


def next_occurrence(due: datetime, repeat: Optional[str], interval_min: Optional[int], now: datetime) -> Optional[datetime]:
    """The first repeat of `due` strictly after `now` (None for a one-off)."""
    if interval_min:
        step = timedelta(minutes=interval_min)
    elif repeat in ("daily", "weekdays"):
        step = timedelta(days=1)
    elif repeat == "weekly":
        step = timedelta(days=7)
    else:
        return None
    nxt = due + step
    if nxt <= now:
        n = int((now - due) / step)
        nxt = due + step * max(1, n)
        while nxt <= now:
            nxt += step
    while repeat == "weekdays" and nxt.weekday() >= 5:
        nxt += timedelta(days=1)
    return nxt


# ------------------------------------------------------------------ saying a time back
def fmt_clock(dt: datetime) -> str:
    """'9 pm', '9:30 am', '12 noon', 'midnight' — how a person says it."""
    if dt.hour == 0 and dt.minute == 0:
        return "midnight"
    if dt.hour == 12 and dt.minute == 0:
        return "12 noon"
    h = dt.hour % 12 or 12
    return f"{h}{'' if dt.minute == 0 else f':{dt.minute:02d}'} {'am' if dt.hour < 12 else 'pm'}"


def fmt_due(dt: datetime, now: datetime) -> str:
    """'9 pm today', '6:30 am tomorrow', '9 am on Friday', '9 am on 25 October'."""
    days = (dt.date() - now.date()).days
    if days == 0:
        return f"{fmt_clock(dt)} today"
    if days == 1:
        return f"{fmt_clock(dt)} tomorrow"
    if 1 < days < 7:
        return f"{fmt_clock(dt)} on {dt.strftime('%A')}"
    return f"{fmt_clock(dt)} on {dt.day} {dt.strftime('%B')}" + (f" {dt.year}" if dt.year != now.year else "")


def fmt_repeat(repeat: Optional[str], interval_min: Optional[int], due: datetime) -> str:
    if interval_min:
        if interval_min % 60 == 0:
            h = interval_min // 60
            return "every hour" if h == 1 else f"every {h} hours"
        return f"every {interval_min} minutes"
    return {"daily": f"every day at {fmt_clock(due)}", "weekdays": f"every weekday at {fmt_clock(due)}",
            "weekly": f"every {due.strftime('%A')} at {fmt_clock(due)}"}.get(repeat or "", "")


def fmt_span(seconds: int) -> str:
    """'10 minutes', '1 hour 30 minutes', '45 seconds'."""
    seconds = int(seconds)
    h, rem = divmod(seconds, 3600)
    m, s = divmod(rem, 60)
    out = []
    if h:
        out.append(f"{h} hour{'s' if h != 1 else ''}")
    if m:
        out.append(f"{m} minute{'s' if m != 1 else ''}")
    if s and not h:
        out.append(f"{s} second{'s' if s != 1 else ''}")
    return " ".join(out) or "0 seconds"


_TO_YOU = [(re.compile(r"\bmy\b", re.I), "your"), (re.compile(r"\bmyself\b", re.I), "yourself"),
           (re.compile(r"\bi'm\b", re.I), "you're"), (re.compile(r"\bi am\b", re.I), "you are"),
           (re.compile(r"\bi\b"), "you"), (re.compile(r"\bme\b", re.I), "you"), (re.compile(r"\bmine\b", re.I), "yours")]


def second_person(text: str) -> str:
    """'call my mum' -> 'call your mum': a reminder is read back to him."""
    out = text or ""
    for rx, rep in _TO_YOU:
        out = rx.sub(rep, out)
    return out


# ------------------------------------------------------------------ reminder intents
_ADDRESS = re.compile(r"^\s*(?:(?:hey|ok(?:ay)?|oi|arre?)\s+)?jarvis\b[\s,.:!-]*", re.I)
_POLITE = re.compile(r"^\s*(?:please|plz|pls|bhai|sun(?:o)?|listen|and|aur|can you|could you|would you|will you)\b[\s,.:!-]*", re.I)
_QUESTIONY = re.compile(r"\?\s*$|^\s*(?:is|are|was|what|which|why|how|did|does|do\s+i|kya|kab|kitne)\b", re.I)
# Asking ABOUT a reminder ("did you set my alarm for tomorrow?"). A polite request
# ("can you remind me at 9?") has had "can you" stripped by then, so it is not one.
_ASKING = re.compile(r"^\s*(?:is|are|was|were|what|which|why|how|did|does|do(?!\s+(?:remind|wake|set|start))|"
                     r"have|has|had|kya|kab|kitne|when)\b", re.I)

_T_TIMER = re.compile(r"\btimers?\b", re.I)
_T_ALARM = re.compile(r"\balarms?\b|\bwake\s+me(?:\s+up)?\b|\b(?:utha|jaga|uthaa|jagaa)\s*(?:dena|do|dijiye|dijie|na|dijiyega)\b|\buthana\b", re.I)
# "remind me/us" or "a reminder" — "remind Mum that I'm late" is a message to someone
# else (which JARVIS cannot send), not a reminder for him.
_T_REMIND = re.compile(r"\bremind(?=\s+(?:me|us|myself)\b)|\breminders?\b|\byaad\s+dila\w*|\bnotify\s+me\b|"
                       r"\balert\s+me\b|\bping\s+me\b|\bnudge\s+me\b"
                       r"|\b(?:remember|don'?t\s+forget|do\s+not\s+forget)\s+to\b", re.I)
_MEDICINE = re.compile(r"\b(?:medicine|medicines|meds|medication|dawai|dawa|dava|tablets?|pills?|goli|insulin|inhaler|"
                       r"syrup|vitamins?|bp\s+(?:medicine|tablet))\b", re.I)
_FIRST_PERSON = re.compile(r"^\s*(?:i|i'm|i've|we|main|mai|mein|hum|my|mera|meri|maine)\b", re.I)
_LIST = re.compile(r"\b(?:what|which|any|list|show|read|tell me)\b.{0,30}\b(?:reminders?|alarms?|timers?)\b|"
                   r"\b(?:reminders?|alarms?|timers?)\b.{0,20}\b(?:kya|kaun|kitne|list|batao|dikhao)\b|"
                   r"\bhow\s+(?:much|long)\b.{0,30}\b(?:left|remaining)\b.{0,20}\btimer\b|"
                   r"\btimer\b.{0,30}\b(?:kitna|how\s+much|how\s+long)\b.{0,20}\b(?:bacha|left|remaining)\b", re.I)
_CANCEL = re.compile(r"\b(?:cancel|delete|remove|clear|stop|dismiss|turn\s+off|switch\s+off|band\s+kar\w*|hata\w*|"
                     r"mita\w*|rok\w*)\b", re.I)
_KIND_NOUN = re.compile(r"\b(?:reminders?|alarms?|timers?)\b", re.I)
_ALL = re.compile(r"\b(?:all|every|sab|sabhi|saare|sare)\b", re.I)
_FILLER = re.compile(r"\b(?:please|plz|jarvis|set|start|create|add|make|put|a|an|the|up|for|of|me|mujhe|mujhko|"
                     r"laga|lagao|lagado|do|dena|karo|kar|de|na|ka|ki|ke|ko|liye|wala|wali|ek|my|mera|meri|new|"
                     r"remind|reminder|timer|alarm|alarms|reminders|timers|to|that|about|hai|hain|wake|utha|jaga|"
                     r"dijiye|yaad|dilana|dila|dilao|dilaana|dena|notify|alert|ping|nudge|remember|don't|dont|"
                     r"forget|cancel|delete|remove|clear|stop|dismiss|band|hatao|hata|mita|all|every|sab|saare)\b",
                     re.I)


@dataclass
class ReminderIntent:
    op: str                               # "create" | "cancel" | "list"
    kind: str = "reminder"                # "reminder" | "timer" | "alarm" | "action"
    text: str = ""                        # what to remind about, in his words
    when: Optional[When] = None
    action: Optional[dict] = None         # kind "action": {"device", "action", "value"}
    missing: Optional[str] = None         # "time": he did not say when
    query: str = ""                       # cancel: words to match
    all: bool = False


def _clean(s: str) -> str:
    s = re.sub(r"\x00+", " ", s)
    s = re.sub(r"\s+", " ", s).strip(" ,.;:!-–—\"'")
    return s


def _mask(s: str, spans: list) -> str:
    out = list(s)
    for a, b in spans:
        for i in range(a, min(b, len(out))):
            out[i] = "\x00"
    return "".join(out)


def _task_text(s: str, trigger: Optional[re.Match]) -> str:
    """What he wants to be reminded of: after "to"/"that"/"about"/"ki", else what is left."""
    if trigger is not None:
        after = s[trigger.end():]
        m = re.search(r"(?:^|[\s\x00])(?:to|that|about|of|ki|ke\s+liye|:)\s+(?P<w>.+)$", after, re.I)
        if trigger.group(0).lower().startswith(("remember", "don", "do not")):
            m = re.match(r"\s*(?P<w>.+)$", after)
        if m and _clean(m.group("w")):
            return _clean(m.group("w"))
        before = s[:trigger.start()]
        hm = re.search(r"\bki\s+(?P<w>.+)$", before, re.I)
        cand = _clean(hm.group("w") if hm else before)
        cand = re.sub(r"^(?:mujhe|mujhko|me|please)\s+", "", cand, flags=re.I)
        if _clean(cand):
            return _clean(cand)
        rest = _clean(after)
        return _clean(_FILLER.sub(" ", rest)) if rest else ""
    return _clean(s)


def parse_reminder(text: str, now: datetime,
                   room_parse: Optional[Callable[[str], list]] = None) -> Optional[ReminderIntent]:
    """A reminder / timer / alarm / scheduled-switch intent, or None (not ours)."""
    t = " ".join((text or "").split())
    if len(t) < 3:
        return None
    t = _ADDRESS.sub("", t)
    for _ in range(2):
        t = _POLITE.sub("", t)

    if _LIST.search(t):
        k = _KIND_NOUN.search(t)
        return ReminderIntent(op="list", kind=_kind_of(k.group(0)) if k else "reminder")
    if _ASKING.match(t):
        # A question is never an instruction: about reminders, it gets the list.
        k = _KIND_NOUN.search(t)
        return ReminderIntent(op="list", kind=_kind_of(k.group(0))) if k else None
    kind_noun = _KIND_NOUN.search(t)
    if kind_noun and _CANCEL.search(t) and not _T_REMIND.search(t.replace(kind_noun.group(0), "")):
        if not parse_when(t, now) or _ALL.search(t):
            q = _clean(_FILLER.sub(" ", _KIND_NOUN.sub(" ", t)))
            return ReminderIntent(op="cancel", kind=_kind_of(kind_noun.group(0)), query=q, all=bool(_ALL.search(t)))

    timer, alarm, remind = _T_TIMER.search(t), _T_ALARM.search(t), _T_REMIND.search(t)
    if timer:
        w = parse_when(t, now, bare_duration=True)
        label = _clean(_FILLER.sub(" ", _mask(t, w.spans if w else [])))
        label = re.sub(r"^(?:for|ke liye)\s+", "", label, flags=re.I)
        if w is None:
            return ReminderIntent(op="create", kind="timer", text=label, missing="time")
        return ReminderIntent(op="create", kind="timer" if w.relative_s else "reminder", text=label, when=w)
    if alarm and not remind:
        w = parse_when(t, now, prefer_am=True)
        label = _clean(_FILLER.sub(" ", _mask(t, w.spans if w else [])))
        return ReminderIntent(op="create", kind="alarm", text=label, when=w, missing=None if w else "time")
    if remind:
        w = parse_when(t, now)
        masked = _mask(t, w.spans if w else [])
        trig = _T_REMIND.search(masked)
        task = _task_text(masked, trig)
        return ReminderIntent(op="create", kind="reminder", text=task, when=w, missing=None if w else "time")

    if _QUESTIONY.search(t) or _FIRST_PERSON.search(t):
        return None
    w = parse_when(t, now)
    if w is None:
        return None
    rest = _mask(t, w.spans)
    # "turn off the fan in 30 minutes", "light on at 6 am": a switch at a later time.
    if room_parse is not None and (w.relative_s or w.explicit_clock):
        # A speed or brightness request is not a switch: the relays can't do it later either.
        cmds = [c for c in room_parse(_clean(rest)) if c[1] != "level"]
        if cmds:
            device, action, value = cmds[0]
            return ReminderIntent(op="create", kind="action", text=_clean(rest), when=w,
                                  action={"device": device, "action": action, "value": value})
    # "medicine at 8 am every day", "gym at 6 every day": a schedule said tersely.
    if w.explicit_clock and (w.repeating or _MEDICINE.search(t)):
        return ReminderIntent(op="create", kind="reminder", text=_clean(rest), when=w)
    return None


def _kind_of(noun: str) -> str:
    n = noun.lower()
    return "timer" if n.startswith("timer") else "alarm" if n.startswith("alarm") else "reminder"


def time_only(text: str, now: datetime) -> Optional[When]:
    """When the whole utterance is just a time ("at 9", "kal subah 7 baje") — the answer
    to "When should I remind you?"."""
    t = _POLITE.sub("", _ADDRESS.sub("", " ".join((text or "").split())))
    w = parse_when(t, now)
    if w is None:
        return None
    rest = _clean(re.sub(r"\b(?:at|on|in|ko|pe|par|baje|please|jarvis|around|by|about|okay|ok|then|so)\b", " ",
                         _mask(t, w.spans), flags=re.I))
    return w if not rest else None
