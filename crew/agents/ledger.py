"""Task ledger: what I ask JARVIS for, counted, and which jobs deserve an agent of their own.

The crew exists because some requests recur. This agent finds them in the transcripts
(app/jarvis_app/transcripts.py: one YYYY-MM-DD.jsonl per day). Every "you" turn is one
request. Its answer is the next "jarvis" turn in the same session that carries reply
seconds (an announcement JARVIS speaks in between, a reminder firing, carries none and is
skipped). An error line is a failure of the request before it in that session.

Each request falls into one FAMILY by the transparent rules below, in English and in the
romanised Hinglish the transcripts hold. hinglish.py writes long vowels short ("yaad"
arrives as "yad"), and the same folding is applied before matching, so a typed "yaad"
matches too. The first family whose rule matches wins, so the order is deliberate:
actions (reminders, the room) before topics, topics before generic questions, a bare
hello last. A leading "hey Jarvis" is not part of the request; alone, it is a greeting.

Per family: count, share, the days it was seen on, the median reply time, failures and
when it was last seen. The ranking is by TIME COST, count x median reply seconds: a job
asked often and answered slowly is where an agent of its own saves the most. Ties go to
the family seen on more days (a habit, not a burst). A family seen 3 times, or on 2
different days, is a CANDIDATE, with a one-line proposal and whether the crew already has
an agent doing it.

PRIVACY: request text is read, matched and dropped. It is never copied anywhere: not into
this agent's data, not onto the board, not to disk. Only family names, counts and timings
are kept (data/app/crew/ledger.json).

It reads the last 30 days (a month covers my weekly routines several times over, and what
I asked in spring should not decide what gets an agent now), every 10 minutes and once
at start.
"""
from __future__ import annotations

import json
import os
import re
import statistics
import time
from dataclasses import dataclass
from datetime import date, datetime, timedelta
from pathlib import Path
from typing import Callable, Iterator, Optional

from ..base import Agent

WINDOW_DAYS = 30
CANDIDATE_COUNT = 3
CANDIDATE_DAYS = 2
TOP_SHOWN = 3                    # families named in JARVIS's line
SLOWEST_MIN_REPLIES = 2          # "slowest" needs more than one timed reply to mean anything
DAY_FILE = re.compile(r"^(\d{4}-\d{2}-\d{2})\.jsonl$")


@dataclass(frozen=True)
class Family:
    id: str
    name: str
    short: str                   # how JARVIS's line says it
    rules: tuple[str, ...]
    proposal: str
    agent: Optional[str] = None  # the crew agent that already does this job


# Ordered: the first family whose rule matches a request takes it.
FAMILIES: tuple[Family, ...] = (
    Family("reminders", "reminders & timers", "reminders", (
        r"\bremind", r"\btimers?\b", r"\balarms?\b", r"\bsnooze\b", r"\bwake me\b", r"\bcountdown\b",
        r"\byad dila", r"\bjaga (dena|do|dijiye)\b", r"\butha (dena|do|dijiye)\b"),
        "A reminders clerk: set, list and cancel reminders straight from the words, with no model call."),
    Family("room", "room control", "room control", (
        r"\blights?\b", r"\blamps?\b", r"\bfans?\b", r"\bscenes?\b", r"\bbatti\b", r"\bbati\b", r"\bpankh?a\b",
        r"\b(turn|switch)(ed)? (it |them |the \w+ )?(on|off)\b", r"\b(band|bandh|chalu) (karo|kar do|kardo|kar dena)\b",
        r"\bjala (do|dena)\b", r"\bbujha (do|dena)\b", r"\bdim\b", r"\bbrightness\b"),
        "A room clerk: map light, fan and scene words straight to the switches, with no model call."),
    Family("presence", "presence & movement", "presence & movement", (
        r"\bwhere am i\b", r"\bsee me\b", r"\bankhen\b", r"\bmotion\b", r"\bcoordinates?\b", r"\btrack (my|me)\b",
        r"\bmovements?\b", r"\bam i (moving|sitting|at|in|on)\b", r"\bdekh (sakte|sakta|sakti|rahe|raha|rahi|pa)",
        r"\bdikh (raha|rahi|rahe|ta|ti)\b", r"\bmujhe dekh", r"\bkahan? h(u|o|oo)n?\b",
        r"\b(anyone|someone|anybody|somebody) (in|here)\b", r"\bwho('?s| is) (in|here)\b", r"\bkoi (hai|he|h)\b",
        r"\bkitne log\b", r"\bpresence\b", r"\bsensors?\b", r"\bwav(e|es|ed|ing)\b"),
        "The movement watcher does this already: zone, activity, waves and restlessness from Aankhen's Wi-Fi.",
        agent="movement"),
    Family("status", "status & diagnostics", "status", (
        r"\bnot listening\b", r"\berrors?\b", r"\bwhat happened\b",
        r"\bare you (working|there|ok|okay|alive|online|listening|awake)\b", r"\bdiagnos", r"\bconnection\b",
        r"\bsun (rahe|raha|rahi|rhe|rha)\b", r"\bkya hua\b", r"\bkam (kar|kr) (raha|rahe|rha|rhe)\b",
        r"\bnot working\b", r"\bbroken\b", r"\bcrash", r"\bstatus\b", r"\bollama\b", r"\b(so|too|very) slow\b"),
        "The steward does this already: Ollama, Aankhen, JARVIS's process and recent errors, every 10 s.",
        agent="steward"),
    Family("study", "study & mission", "study", (
        r"\bstud(y|ied|ying)\b", r"\bpadh", r"\bgerman\b", r"\bdeutsch\b", r"\bvlsi\b", r"\bverilog\b",
        r"\blog(ged)? (\d|my|the|this|today|a|an|some)\b", r"\bbrief(ing)?\b", r"\bmission\b", r"\bexams?\b",
        r"\bgermoney\b", r"\blectures?\b", r"\bassignments?\b", r"\bquiz\b", r"\brevis(e|ion)\b", r"\bsyllabus\b",
        r"\bstreak\b"),
        "A study clerk: keep today's plan, logged hours and streak ready to read out."),
    Family("time", "time & date", "time & date", (
        r"\bwhat('?s| is)? (the )?time\b", r"\btime (kya|kitna|batao|bata)\b", r"\bkya time\b", r"\bkitna time\b",
        r"\bkitne baje\b", r"\bkya baja\b", r"\bbaj (gaye|gye|rahe|raha)\b",
        r"\bwhat('?s| is)? (the |today'?s )?date\b", r"\bdate (kya|batao|bata)\b", r"\bwhat day\b", r"\bwhich day\b",
        r"\bkaun ?sa din\b", r"\baj (kya|kaun ?sa) (din|date|tarikh)\b", r"\btarikh\b", r"\btareekh\b", r"\bsamay\b"),
        "A clock: answer the time and date from the system clock at once, with no model call."),
    Family("memory", "memory & people", "memory & people", (
        r"\bremember\b", r"\byad\b", r"\bwho('?s| is| was)\b", r"\bdo you know\b", r"\bkaun (hai|he|h|tha|thi)\b",
        r"\bjant(e|a|i) (ho|hai|he|h)\b", r"\bpehchan", r"\bforget\b", r"\bfriends?\b", r"\bdost\b"),
        "A memory clerk: keep the people and facts he asks about ready, so recall does not wait on a search."),
    Family("music", "music & performance", "music", (
        r"\bsing(ing)?\b", r"\bsongs?\b", r"\braps?\b", r"\brapping\b", r"\bbars\b", r"\bplay(ing)?\b", r"\bgan[ae]\b",
        r"\bgao\b", r"\bmusic\b", r"\blyrics\b", r"\bverses?\b", r"\bbeat(box)?\b", r"\bfreestyle\b", r"\bpoem\b",
        r"\bshayari\b"),
        "A performer: keep a repertoire of songs and raps ready to recite, instead of writing one each time."),
    Family("advice", "advice & life", "advice & life", (
        r"\bhelp me\b", r"\bconsisten(t|cy)\b", r"\bmotivat", r"\bwin (at|in) life\b", r"\bguide\b", r"\bguidance\b",
        r"\badvi(c|s)e\b", r"\bwhat should i\b", r"\bhow (do|can|should) i\b", r"\bkya kar(u|un|oon)\b",
        r"\bkaise (kar|ban)(u|un|oon)\b", r"\btips?\b", r"\bdisciplin", r"\bproductiv", r"\bhabits?\b",
        r"\b(my|in|at) life\b", r"\bprocrastinat", r"\bfocus\b"),
        "A coach: keep his goals and streaks at hand, so advice cites his real progress."),
    Family("chat", "greeting & chat", "chat", (
        r"^(hi+|hey+|hello|yo|namaste|namaskar|salam)\b", r"\bhow are you\b", r"\bhow r u\b", r"\bwhat'?s up\b",
        r"\bwhats up\b", r"\bkaise ho\b", r"\bkaisa hai\b", r"\bkya hal\b", r"\bkya chal raha\b", r"\bthank(s| you)\b",
        r"\bshukriya\b", r"\bdhanyavad\b", r"\bgood (morning|afternoon|evening|night)\b", r"\bbye\b",
        r"\bwho are you\b", r"\bjokes?\b"),
        "A greeter: answer a bare wake word or a hello at once, without waiting on the model."),
)
OTHER = Family("other", "unsorted requests", "unsorted", (), "")
BY_ID = {f.id: f for f in FAMILIES + (OTHER,)}
_MATCHERS = [(f.id, re.compile("|".join(f"(?:{r})" for r in f.rules))) for f in FAMILIES]
_WAKE = re.compile(r"^\W*(?:(?:hey|hi|hello|ok|okay|yo|oye|are)\W+)?j[ae]r?v[ie]s\b\W*")


def normalize(text: str) -> str:
    """Lower case, one space, long vowels short (as hinglish.py writes them)."""
    t = " ".join(text.lower().replace("’", "'").split())
    return re.sub(r"([aiu])\1+", r"\1", t)


def classify(text: str) -> str:
    """The family a request belongs to (its id); "other" when no rule matches."""
    rest = _WAKE.sub("", normalize(text), count=1).strip(" .,!?")
    if not rest:
        return "chat"                            # a bare "hey Jarvis"
    for fid, rx in _MATCHERS:
        if rx.search(rest):
            return fid
    return "other"


@dataclass
class _Request:
    family: str
    ts: Optional[float]
    day: str
    seconds: Optional[float] = None
    failed: bool = False


def _n(count: int, word: str) -> str:
    return f"{count} {word}{'' if count == 1 else 's'}"


def _number(x) -> Optional[float]:
    return float(x) if isinstance(x, (int, float)) and not isinstance(x, bool) else None


def _day_of(ts: Optional[float], fallback: str) -> str:
    """The local date of a timestamp; the file's own date for a missing or impossible one
    (Windows refuses negative timestamps outright)."""
    if ts is None:
        return fallback
    try:
        return datetime.fromtimestamp(ts).strftime("%Y-%m-%d")
    except (OSError, OverflowError, ValueError):
        return fallback


def _lines(path: Path) -> Iterator[dict]:
    try:
        with open(path, encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                try:
                    e = json.loads(line)
                except json.JSONDecodeError:
                    continue                     # a torn last line never stops the count
                if isinstance(e, dict):
                    yield e
    except OSError:
        return


def read_requests(folder: Path, today: date, days: int) -> tuple[list[_Request], int]:
    """Every request in the last `days` day files, and the errors that had no request
    before them in their session."""
    first = today - timedelta(days=days - 1)
    files = []
    for p in Path(folder).glob("*.jsonl"):
        m = DAY_FILE.match(p.name)
        if not m:
            continue                             # flags.jsonl and anything else
        try:
            day = date.fromisoformat(m.group(1))
        except ValueError:
            continue
        if first <= day <= today:
            files.append((m.group(1), p))
    requests: list[_Request] = []
    latest: dict[str, _Request] = {}             # session -> its latest request
    stray_errors = 0
    for day, path in sorted(files):
        for e in _lines(path):
            session = str(e.get("session") or "")
            if e.get("kind") == "turn" and e.get("role") == "you":
                ts = _number(e.get("ts"))
                r = _Request(classify(str(e.get("text") or "")), ts, _day_of(ts, day))
                requests.append(r)
                latest[session] = r
            elif e.get("kind") == "turn" and e.get("role") == "jarvis":
                r = latest.get(session)
                if r is not None and r.seconds is None:
                    r.seconds = _number(e.get("seconds"))
            elif e.get("kind") == "error":
                r = latest.get(session)
                if r is None:
                    stray_errors += 1
                else:
                    r.failed = True
    return requests, stray_errors


def rank(requests: list[_Request]) -> list[dict]:
    """One row per family seen, most time-costly first."""
    by: dict[str, list[_Request]] = {}
    for r in requests:
        by.setdefault(r.family, []).append(r)
    rows = []
    for fid, rs in by.items():
        fam = BY_ID[fid]
        secs = [r.seconds for r in rs if r.seconds is not None]
        median = statistics.median(secs) if secs else None
        days = len({r.day for r in rs})
        seen = [r.ts for r in rs if r.ts is not None]
        rows.append({"id": fid, "name": fam.name, "count": len(rs), "share": round(len(rs) / len(requests), 3),
                     "days": days, "median_s": None if median is None else round(median, 2), "timed": len(secs),
                     "failures": sum(r.failed for r in rs), "last_seen": max(seen) if seen else None,
                     "cost_s": round(len(rs) * median, 1) if median is not None else 0.0,
                     "candidate": fid != OTHER.id and (len(rs) >= CANDIDATE_COUNT or days >= CANDIDATE_DAYS),
                     "proposal": fam.proposal or None, "exists": fam.agent is not None,
                     "covered_by": fam.agent})
    rows.sort(key=lambda r: (-r["cost_s"], -r["days"], -r["count"], r["id"]))
    return rows


class TaskLedger(Agent):
    id = "ledger"
    name = "Task ledger"
    role = "counts what you ask JARVIS for and finds the recurring jobs worth their own agent"
    cadence_s = 600.0

    def __init__(self, transcripts: Path, folder: Path, days: int = WINDOW_DAYS,
                 clock: Callable[[], float] = time.time):
        super().__init__(clock)
        self.transcripts = Path(transcripts)
        self.path = Path(folder) / "ledger.json"
        self.days = days
        self.ranking: Optional[dict] = None
        # Candidates already announced, from the last run's file: a restart must not
        # announce the same recurring jobs again.
        self._announced = self._saved_candidates()

    def _saved_candidates(self) -> set[str]:
        try:
            saved = json.loads(self.path.read_text(encoding="utf-8"))
            return {c["id"] for c in saved["candidates"]}
        except (OSError, ValueError, KeyError, TypeError):
            return set()

    def tick(self, now: float) -> None:
        requests, stray = read_requests(self.transcripts, datetime.fromtimestamp(now).date(), self.days)
        rows = rank(requests)
        candidates = [{k: r[k] for k in ("id", "name", "count", "days", "median_s", "proposal", "exists",
                                         "covered_by")}
                      for r in rows if r["candidate"]]
        self.ranking = {"updated": now, "window_days": self.days, "requests": len(requests),
                        "days_seen": len({r.day for r in requests}),
                        "timed": sum(1 for r in requests if r.seconds is not None),
                        "failures": sum(r.failed for r in requests), "stray_errors": stray,
                        "families": rows, "candidates": candidates}
        self._save()
        for c in candidates:
            if c["id"] not in self._announced:
                self.post("candidate", f"Recurring job: {c['name']} ({_n(c['count'], 'ask')} over "
                          f"{_n(c['days'], 'day')}). {c['proposal']}",
                          family=c["id"], count=c["count"], days=c["days"], exists=c["exists"],
                          covered_by=c["covered_by"])
        self._announced = {c["id"] for c in candidates}

    def _save(self) -> None:
        """Written whole and swapped in, so a reader never sees half a file."""
        self.path.parent.mkdir(parents=True, exist_ok=True)
        tmp = self.path.with_name(self.path.name + ".tmp")
        tmp.write_text(json.dumps(self.ranking, indent=1), encoding="utf-8")
        os.replace(tmp, self.path)

    @property
    def idle(self) -> bool:
        return not (self.ranking and self.ranking["requests"])

    @property
    def summary(self) -> str:
        if self.idle:
            return f"No requests to JARVIS in the last {self.days} days to count."
        r = self.ranking
        top = r["families"][0]
        s = (f"{_n(r['requests'], 'request')} over {_n(r['days_seen'], 'day')}; "
             f"most time goes to {top['name']} ({_n(top['count'], 'ask')}")
        s += f", median {top['median_s']} s)." if top["median_s"] is not None else ")."
        new = [c["name"] for c in r["candidates"] if not c["exists"]]
        if new:
            s += f" Recurring, with no agent yet: {', '.join(new)}."
        return s

    def context_line(self) -> str:
        if self.idle:
            return ""
        rows = [r for r in self.ranking["families"] if r["id"] != OTHER.id]
        if not rows:
            return ""
        asked = sorted(rows, key=lambda r: (-r["count"], -r["days"], r["id"]))[:TOP_SHOWN]
        line = "Most asked lately: " + ", ".join(f"{BY_ID[r['id']].short} ({r['count']})" for r in asked)
        timed = [r for r in rows if r["timed"] >= SLOWEST_MIN_REPLIES]
        if timed:
            slow = max(timed, key=lambda r: r["median_s"])
            line += f"; slowest: {BY_ID[slow['id']].short} at {slow['median_s']:.1f} s"
        return line + "."

    @property
    def data(self) -> dict:
        return self.ranking or {"requests": 0, "families": [], "candidates": []}
