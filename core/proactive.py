"""Proactive speech: when JARVIS may speak without being asked, and what he says.

The app's event feed (crew/feed.py) hands the voice core one event at a time ("he came
back into the room", "the relay board disconnected"). This module decides whether that
event is worth an unprompted remark NOW, and turns the event's facts into one short
butler line. Every decision, spoken or not, is reported back to the app with its reason
(the app writes data/app/proactive.jsonl).

The rules, in the order they are checked (the first that fails is the logged reason):
    off            proactive speech is switched off in the settings
    muted          "Jarvis, quiet mode" (until "you can talk again", or the settings switch)
    text_mode      JARVIS has no voice right now
    nobody_there   the event says he has just left: talking to an empty room is noise
    handled        another part already said it (a due reminder speaks for itself)
    no_evidence    the event carries no real evidence (simulation, or "can't tell")
    quiet_hours    00:30-07:00 by default
    stale          the event is older than STALE_S
    busy           he is talking, JARVIS is talking, a turn is in progress, or he spoke
                   within RECENT_TURN_S
    media          something is playing (Windows media sessions or the window's player);
                   loudness cannot be read, so any playback counts as loud
    rate_limited   less than min_gap_min since the last unprompted remark (default 20)
    speak          all of the above passed

Honesty: Aankhen's room estimates are Wi-Fi guesses. An event marked "probable" must be
said with a hedge ("it seems", "probably"), and the LLM's line is checked for one; a line
that adds numbers the facts do not have, runs long, or drops the hedge is replaced by a
fixed template line built from the same facts.

Settings (data/app/settings.json, "proactive"; JARVIS reads them per decision):
    {"enabled": true, "muted": false, "quiet_start": "00:30", "quiet_end": "07:00",
     "min_gap_min": 20}
"""
from __future__ import annotations

import re
import time
from dataclasses import dataclass
from typing import Callable, Optional

DEFAULTS = {"enabled": True, "muted": False, "quiet_start": "00:30", "quiet_end": "07:00", "min_gap_min": 20}
STALE_S = 600.0                  # an event older than this is history, not news
RECENT_TURN_S = 60.0             # he spoke this recently: the conversation is his, not ours
MAX_WORDS = 28
HEDGES = ("probably", "seems", "seem to", "looks like", "it appears", "appear to", "if i'm reading",
          "if the sensors", "i think", "by the look", "sensors think", "might")
SPOKEN_ELSEWHERE = {"reminder_due"}          # reminders.py already speaks these itself
NOBODY_THERE = {"left"}


@dataclass
class Decision:
    speak: bool
    reason: str

    def to_dict(self) -> dict:
        return {"speak": self.speak, "reason": self.reason}


# ------------------------------------------------------------------ settings
def settings_from(all_settings: Optional[dict]) -> dict:
    """The "proactive" block with defaults filled in and bad values replaced."""
    raw = (all_settings or {}).get("proactive") if isinstance(all_settings, dict) else None
    out = dict(DEFAULTS)
    if isinstance(raw, dict):
        for k in ("enabled", "muted"):
            if isinstance(raw.get(k), bool):
                out[k] = raw[k]
        for k in ("quiet_start", "quiet_end"):
            if parse_hhmm(raw.get(k)) is not None:
                out[k] = raw[k]
        try:
            gap = float(raw.get("min_gap_min", out["min_gap_min"]))
            if 1 <= gap <= 24 * 60:
                out["min_gap_min"] = gap
        except (TypeError, ValueError):
            pass
    return out


def parse_hhmm(text) -> Optional[int]:
    """"00:30" -> 30 (minutes after midnight); anything else -> None."""
    if not isinstance(text, str):
        return None
    m = re.fullmatch(r"\s*(\d{1,2}):(\d{2})\s*", text)
    if not m:
        return None
    h, mi = int(m.group(1)), int(m.group(2))
    return h * 60 + mi if h < 24 and mi < 60 else None


def in_quiet_hours(now: float, start: str, end: str, localtime: Callable = time.localtime) -> bool:
    """True inside [start, end). The window may cross midnight (00:30-07:00 does not,
    22:00-07:00 does). start == end means no quiet hours."""
    s, e = parse_hhmm(start), parse_hhmm(end)
    if s is None or e is None or s == e:
        return False
    lt = localtime(now)
    m = lt.tm_hour * 60 + lt.tm_min
    return s <= m < e if s < e else (m >= s or m < e)


# ------------------------------------------------------------------ "Jarvis, quiet mode"
# "Be quiet" alone is not here: said over a reply it means "stop talking now" (wake.is_stop).
_MUTE = re.compile(r"\b(quiet mode|silent mode|stop commenting|no (more )?comments|don'?t comment|"
                   r"mute (yourself|your comments|comments))\b", re.I)
_UNMUTE = re.compile(r"\b(you can (talk|speak) (again|now)|talk again|speak again|quiet mode off|"
                     r"(end|exit|stop|turn off|disable|cancel) (the )?quiet mode|unmute( yourself)?|"
                     r"(you can|feel free to) comment( again)?)\b", re.I)


def voice_command(text: str) -> Optional[str]:
    """"mute" / "unmute" when what he said is about JARVIS's unprompted remarks, else None.
    Unmute wins when both match ("quiet mode off")."""
    if not text:
        return None
    t = text.strip()
    if len(t.split()) > 12:                     # a long sentence is a conversation, not a switch
        return None
    if _UNMUTE.search(t):
        return "unmute"
    if _MUTE.search(t):
        return "mute"
    return None


def set_muted(muted: bool, path=None) -> bool:
    """Write the mute switch into the app's settings file (the one JARVIS_SETTINGS names),
    so the app's switch and the voice command are one switch. False when there is no file."""
    import user_settings
    path = path or user_settings.path_from_env()
    if path is None:
        return False
    user_settings.SettingsFile(path).update(lambda s: s.setdefault("proactive", {}).update(muted=bool(muted)))
    return True


MUTE_REPLY = "Understood, sir. I'll keep my remarks to myself until you say I can talk again."
UNMUTE_REPLY = "Very good, sir. I'll speak up when something worth mentioning happens."


# ------------------------------------------------------------------ the policy
class Policy:
    """decide(event, ctx) -> Decision. ctx: {"talking", "in_turn", "last_heard_at",
    "media_playing", "text_mode"}. Call spoke() after a remark is actually queued."""

    def __init__(self, settings: Callable[[], dict], clock: Callable[[], float] = time.time,
                 localtime: Callable = time.localtime):
        self.settings = settings
        self.clock = clock
        self.localtime = localtime
        self.last_spoken_at: Optional[float] = None
        self.counts: dict[str, int] = {}

    def decide(self, event: dict, ctx: Optional[dict] = None) -> Decision:
        d = self._decide(event or {}, ctx or {})
        self.counts[d.reason] = self.counts.get(d.reason, 0) + 1
        return d

    def _decide(self, ev: dict, ctx: dict) -> Decision:
        s = settings_from(self.settings())
        now = self.clock()
        kind = str(ev.get("kind") or "")
        if not s["enabled"]:
            return Decision(False, "off")
        if s["muted"]:
            return Decision(False, "muted")
        if ctx.get("text_mode"):
            return Decision(False, "text_mode")
        if kind in NOBODY_THERE:
            return Decision(False, "nobody_there")
        if kind in SPOKEN_ELSEWHERE:
            return Decision(False, "handled")
        if not evidence_ok(ev):
            return Decision(False, "no_evidence")
        if in_quiet_hours(now, s["quiet_start"], s["quiet_end"], self.localtime):
            return Decision(False, "quiet_hours")
        ts = ev.get("ts")
        if isinstance(ts, (int, float)) and now - ts > STALE_S:
            return Decision(False, "stale")
        last_heard = ctx.get("last_heard_at")
        if ctx.get("talking") or ctx.get("in_turn") or (
                isinstance(last_heard, (int, float)) and now - last_heard < RECENT_TURN_S):
            return Decision(False, "busy")
        if ctx.get("media_playing"):
            return Decision(False, "media")
        if self.last_spoken_at is not None and now - self.last_spoken_at < s["min_gap_min"] * 60:
            return Decision(False, "rate_limited")
        return Decision(True, "speak")

    def spoke(self) -> None:
        self.last_spoken_at = self.clock()


def evidence_ok(ev: dict) -> bool:
    """Real evidence only: a live sensor reading or a system fact, never a simulation,
    and never an estimate the sensors themselves call a coin toss."""
    if ev.get("sim"):
        return False
    if ev.get("evidence") not in ("observed", "system"):
        return False
    return ev.get("certainty") in ("sure", "probable")


# ------------------------------------------------------------------ the line
def _facts_text(ev: dict) -> str:
    facts = ev.get("facts") or {}
    return "; ".join(f"{k}: {v}" for k, v in facts.items() if v not in (None, ""))


def prompt(ev: dict) -> str:
    """The strict template the LLM fills: one remark, from these facts only."""
    hedge = ("These are Wi-Fi sensor estimates, not certainties: say it with 'it seems', 'probably' or "
             "'if I'm reading the room right', never as fact. " if ev.get("certainty") == "probable" else "")
    return (
        "You are JARVIS, Aman's British butler. Something happened that you noticed on your own, and you may "
        f"mention it out loud once. Write ONE short remark, at most {MAX_WORDS - 8} words, addressed to him as "
        "'sir'. Use ONLY the facts below; add no times, numbers, places or reasons that are not in them. "
        f"{hedge}No question about his health, no emojis, no quotation marks.\n"
        f"Event: {ev.get('summary') or ev.get('kind')}\n"
        f"Facts: {_facts_text(ev) or 'none'}\n"
        "Remark:")


def _num(facts: dict, key: str) -> Optional[int]:
    v = facts.get(key)
    try:
        return int(round(float(v)))
    except (TypeError, ValueError):
        return None


def fallback_line(ev: dict) -> str:
    """A fixed line from the facts alone (used when the LLM is down or its line fails the checks)."""
    kind = ev.get("kind")
    f = ev.get("facts") or {}
    if kind == "arrived":
        away = _num(f, "away_min")
        if away and away >= 3:
            return f"Welcome back, sir. You seem to have been away about {away} minutes."
        return "Welcome back, sir. The room sensors think you've just come in."
    if kind == "long_stillness":
        mins = _num(f, "still_min")
        return (f"You seem to have been very still for about {mins} minutes, sir. Perhaps a stretch?"
                if mins else "You seem to have been very still for a while, sir. Perhaps a stretch?")
    if kind == "went_to_bed":
        return "It looks like you've turned in, sir. Good night."
    if kind == "woke_up":
        return "Good morning, sir. You seem to be up."
    if kind == "lights_changed":
        return f"The {f.get('device', 'light')} is now {f.get('state', 'switched')}, sir."
    if kind == "relay_failed":
        return f"The {f.get('device', 'relay')} did not confirm the switch, sir. The relay board may need a look."
    if kind == "board_disconnected":
        return f"The {f.get('board', 'board')} has disconnected, sir. I can't rely on it until it's back."
    if kind == "board_back":
        return f"The {f.get('board', 'board')} is back, sir."
    if kind == "sedentary":
        mins = _num(f, "minutes")
        return (f"You seem to have been at the desk about {mins} minutes without a break, sir."
                if mins else "You seem to have been at the desk a long while without a break, sir.")
    return str(ev.get("summary") or "")[:160]


def clean_line(text: str, ev: dict) -> Optional[str]:
    """The LLM's line if it passes the honesty checks, else None (use fallback_line)."""
    if not text:
        return None
    t = " ".join(str(text).replace("\n", " ").split()).strip().strip('"“”\'')
    t = re.sub(r"^(remark|jarvis)\s*:\s*", "", t, flags=re.I).strip()
    if not t or len(t.split()) > MAX_WORDS or len(t) > 220:
        return None
    if "?" in t and ev.get("kind") not in ("long_stillness", "sedentary"):
        return None                                 # a question invites a reply he did not ask for
    allowed = set(re.findall(r"\d+", _facts_text(ev) + " " + str(ev.get("summary") or "")))
    if any(n not in allowed for n in re.findall(r"\d+", t)):
        return None                                 # a number the facts do not have
    if ev.get("certainty") == "probable" and not any(h in t.lower() for h in HEDGES):
        return None                                 # an estimate said as a fact
    return t


def make_line(ev: dict, generate: Optional[Callable[[str], str]] = None) -> tuple[str, str]:
    """(line, "llm" | "template"). generate(prompt) -> text; any failure -> the template."""
    if generate is not None:
        try:
            got = clean_line(generate(prompt(ev)), ev)
            if got:
                return got, "llm"
        except Exception:
            pass
    return fallback_line(ev), "template"
