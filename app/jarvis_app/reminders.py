"""Reminders, timers, alarms and timed switches: kept by the app, fired by the app.

Why here and not in JARVIS's process: JARVIS sleeps, restarts, and runs in text mode
with no voice; the app is what stays open. So the app owns the list (JSON in
data/app/reminders.json, atomic writes) and a scheduler that checks it every second.
When one is due the scheduler
  * always publishes a bus event (the window shows it and chimes),
  * speaks it through JARVIS (core.speak) when he is running — audible only in voice
    mode, and the event says which happened,
  * for a timed switch ("fan off in 30 minutes"), drives Limbs, the room's one owner.

Honesty rules, in code:
  * Fired late because the app was closed: the line says so ("I missed this at 9 pm
    while the app was closed"). A timed switch more than 15 minutes late is SKIPPED —
    turning the fan off three hours late is not what was asked.
  * A repeating reminder that was missed many times is announced once, then moves to
    its next future time.
  * Every confirmation says the resolved time back ("9 pm today"), so a misheard
    "at 9" is caught when it is said, not when it fires.

Times are parsed by core/tools/when.py, the same parser JARVIS's fast path uses.
"""
from __future__ import annotations

import asyncio
import json
import re
import secrets
import threading
import time
from datetime import datetime
from typing import Any, Callable, Optional

from .paths import DATA, ensure_jarvis_importable

ensure_jarvis_importable()
from tools import when as W  # noqa: E402  core/tools/when.py

FILE = DATA / "reminders.json"
KINDS = ("reminder", "timer", "alarm", "action")
REPEATS = (None, "daily", "weekdays", "weekly")
DEVICES = ("light", "fan", "all", "environment")
SWITCH_ACTIONS = ("on", "off", "set", "dim", "brighten")
SCENES = ("focus", "relaxation", "sleep")
LATE_GRACE_S = 15 * 60          # later than this, the app was closed: said as missed; switches skipped
LATE_SAY_S = 120                 # later than this, the line apologises for being late
KEEP_DONE_S = 7 * 86400          # finished ones stay a week (the "recent" list), then go
MAX_PENDING = 200
MAX_TEXT = 200
MAX_AHEAD_S = 400 * 86400


class ReminderError(ValueError):
    pass


def _dt(ts: float) -> datetime:
    return datetime.fromtimestamp(ts)


def _parse_due(when: Optional[str], due: Any, kind: str,
               now: float) -> tuple[float, Optional[str], Optional[int], bool]:
    """(due epoch, repeat, interval_min, relative) from an explicit `due` or a spoken
    `when`. `relative`: the time was a duration ("in 10 minutes")."""
    if due not in (None, ""):
        if isinstance(due, (int, float)):
            return float(due), None, None, False
        try:
            return datetime.fromisoformat(str(due)).timestamp(), None, None, False
        except ValueError:
            raise ReminderError(f"I couldn't read the time {due!r}.")
    phrase = (when or "").strip()
    if not phrase:
        raise ReminderError("say when: a time like 'at 9 pm' or 'in 10 minutes'.")
    try:                                               # the model sometimes sends ISO
        return datetime.fromisoformat(phrase).timestamp(), None, None, False
    except ValueError:
        pass
    w = W.parse_when(phrase, _dt(now), bare_duration=kind == "timer", prefer_am=kind == "alarm")
    if w is None:
        raise ReminderError(f"I couldn't tell when “{phrase[:60]}” is. Say a time like 'at 9 pm' or 'in 10 minutes'.")
    return w.due.timestamp(), w.repeat, w.interval_min, w.relative_s is not None


def _check_action(action: Any) -> dict:
    if not isinstance(action, dict):
        raise ReminderError("a timed switch needs a device and an action")
    device, act, value = action.get("device"), action.get("action"), action.get("value")
    if device not in DEVICES:
        raise ReminderError(f"unknown device {device!r}")
    if device == "environment":
        name = str(value or act or "")
        if name not in SCENES:
            raise ReminderError(f"unknown scene {name!r}")
        return {"device": "environment", "action": name, "value": name}
    if act not in SWITCH_ACTIONS:
        raise ReminderError(f"unknown action {act!r}")
    if value is not None:
        try:
            value = max(0, min(100, int(value)))
        except (TypeError, ValueError):
            raise ReminderError("the level must be a number from 0 to 100")
    return {"device": device, "action": act, "value": value}


def _action_words(a: dict) -> str:
    if a["device"] == "environment":
        return f"the {a['action']} scene"
    noun = "light and fan" if a["device"] == "all" else a["device"]
    if a["action"] in ("on", "off"):
        return f"{noun} {a['action']}"
    if a["action"] == "set":
        return f"{noun} to {a['value']} percent" if a.get("value") is not None else f"{noun} on"
    return f"{noun} {a['action']}"


# ------------------------------------------------------------------ what is said
def describe_new(r: dict, now: float) -> str:
    """The confirmation, with the resolved time said back."""
    due, nowdt = _dt(r["due"]), _dt(now)
    text = W.second_person(r.get("text") or "")
    if r["kind"] == "timer":
        span = W.fmt_span(r.get("length_s") or round(r["due"] - now))
        return f"Timer set for {span}{f' ({text})' if text else ''}; it ends at {W.fmt_clock(due)}."
    if r["kind"] == "alarm":
        return (f"Alarm set for {W.fmt_due(due, nowdt)}{f', {text}' if text else ''}. "
                "It only rings while the JARVIS app is open on this laptop.")
    if r["kind"] == "action":
        rep = W.fmt_repeat(r.get("repeat"), r.get("interval_min"), due)
        return f"Scheduled: {_action_words(r['action'])}, " + (f"{rep}." if rep else f"at {W.fmt_due(due, nowdt)}.")
    rep = W.fmt_repeat(r.get("repeat"), r.get("interval_min"), due)
    what = f": {text}" if text else ""
    if rep:
        return f"Reminder set{what}, {rep}. The first one is at {W.fmt_due(due, nowdt)}."
    return f"Reminder set{what}, at {W.fmt_due(due, nowdt)}."


def describe_item(r: dict, now: float) -> str:
    due, nowdt = _dt(r["due"]), _dt(now)
    text = W.second_person(r.get("text") or "")
    if r["kind"] == "timer":
        left = max(0, round(r["due"] - now))
        return f"a timer{f' for {text}' if text else ''} ending at {W.fmt_clock(due)} ({W.fmt_span(left)} left)"
    if r["kind"] == "action":
        rep = W.fmt_repeat(r.get("repeat"), r.get("interval_min"), due)
        return f"{_action_words(r['action'])} {rep or 'at ' + W.fmt_due(due, nowdt)}"
    rep = W.fmt_repeat(r.get("repeat"), r.get("interval_min"), due)
    label = "an alarm" if r["kind"] == "alarm" else (text or "a reminder")
    return f"{label} {rep or 'at ' + W.fmt_due(due, nowdt)}"


def describe_list(items: list[dict], now: float) -> str:
    if not items:
        return "You have no reminders, timers or alarms."
    shown = items[:5]
    head = f"You have {len(items)} reminder{'s' if len(items) != 1 else ''}"
    tail = f", and {len(items) - 5} more" if len(items) > 5 else ""
    return f"{head}: " + "; ".join(describe_item(r, now) for r in shown) + tail + "."


def fire_line(r: dict, now: float, outcome: Optional[dict] = None) -> str:
    """What JARVIS says when it is due."""
    due = _dt(r["due"])
    late = now - r["due"]
    text = W.second_person(r.get("text") or "")
    if r["kind"] == "action":
        if outcome and outcome.get("skipped"):
            return (f"I skipped the scheduled {_action_words(r['action'])} at {W.fmt_clock(due)}: the app was "
                    "closed then, and doing it this late could be wrong.")
        if outcome and outcome.get("error"):
            return f"The scheduled {_action_words(r['action'])} failed: {outcome['error']}."
        virtual = outcome is not None and not outcome.get("usb")
        return f"As scheduled: {_action_words(r['action'])}." + (" Virtual room only; no relay board is connected."
                                                                   if virtual else "")
    if late > LATE_GRACE_S:
        what = {"timer": "a timer", "alarm": "an alarm"}.get(r["kind"], "a reminder")
        return f"While the app was closed I missed {what} at {W.fmt_clock(due)}{f': {text}' if text else ''}."
    sorry = f"Sorry, this is late; it was due at {W.fmt_clock(due)}. " if late > LATE_SAY_S else ""
    if r["kind"] == "timer":
        span = W.fmt_span(r["length_s"]) if r.get("length_s") else ""
        return sorry + f"Time's up{f' for {text}' if text else ''}" + (f": your timer for {span} is done." if span else ".")
    if r["kind"] == "alarm":
        hello = "Good morning. " if due.hour < 12 else ""
        return sorry + f"{hello}It's {W.fmt_clock(due)}; this is your alarm." + (f" {text[0].upper() + text[1:]}." if text else "")
    return sorry + (f"Reminder: {text}." if text else "This is the reminder you asked for.")


# ------------------------------------------------------------------ the store
class ReminderStore:
    def __init__(self, path=FILE, clock: Callable[[], float] = time.time):
        self.path, self.clock = path, clock
        self._lock = threading.RLock()
        self._items: list[dict] = self._load()

    def _load(self) -> list[dict]:
        try:
            raw = json.loads(self.path.read_text(encoding="utf-8"))
            items = raw.get("items", []) if isinstance(raw, dict) else []
            return [r for r in items if isinstance(r, dict) and r.get("id") and isinstance(r.get("due"), (int, float))]
        except (FileNotFoundError, ValueError):
            return []

    def _save(self) -> None:
        now = self.clock()
        self._items = [r for r in self._items
                       if r["status"] == "pending" or now - (r.get("finished") or now) < KEEP_DONE_S]
        tmp = self.path.with_suffix(".tmp")
        tmp.write_text(json.dumps({"version": 1, "items": self._items}, ensure_ascii=False, indent=1), encoding="utf-8")
        tmp.replace(self.path)

    # ---------------------------------------------------------------- reading
    def pending(self) -> list[dict]:
        with self._lock:
            return sorted((dict(r) for r in self._items if r["status"] == "pending"), key=lambda r: r["due"])

    def recent(self, within_s: float = 86400, limit: int = 20) -> list[dict]:
        now = self.clock()
        with self._lock:
            done = [dict(r) for r in self._items
                    if (r.get("last_fired") and now - r["last_fired"] < within_s)
                    or (r["status"] != "pending" and now - (r.get("finished") or 0) < within_s)]
        done.sort(key=lambda r: -(r.get("last_fired") or r.get("finished") or 0))
        return done[:limit]

    def get(self, rid: str) -> Optional[dict]:
        with self._lock:
            r = next((r for r in self._items if r["id"] == rid), None)
            return dict(r) if r else None

    def due(self, now: float) -> list[dict]:
        with self._lock:
            return sorted((dict(r) for r in self._items if r["status"] == "pending" and r["due"] <= now),
                          key=lambda r: r["due"])

    # ---------------------------------------------------------------- writing
    def create(self, text: str = "", kind: str = "reminder", when: Optional[str] = None, due: Any = None,
               repeat: Optional[str] = None, interval_min: Optional[int] = None, action: Any = None,
               origin: str = "app") -> dict:
        now = self.clock()
        kind = kind or "reminder"
        if kind not in KINDS:
            raise ReminderError(f"kind must be one of {', '.join(KINDS)}")
        text = re.sub(r"\s+", " ", str(text or "")).strip()[:MAX_TEXT]
        due_ts, rep, every, relative = _parse_due(when, due, kind, now)
        if kind == "timer" and not relative:
            # The model sent kind=timer with "at 9 pm" (live run, 10-12): "Timer set for
            # 3 hours 28 minutes" is true but useless. A time of day is a reminder.
            kind = "reminder"
        repeat = repeat if repeat is not None else rep
        interval_min = interval_min if interval_min is not None else every
        if repeat not in REPEATS:
            raise ReminderError("repeat must be daily, weekdays or weekly")
        if interval_min is not None:
            interval_min = int(interval_min)
            if not 5 <= interval_min <= 7 * 1440:
                raise ReminderError("a repeat interval must be between 5 minutes and a week")
        if due_ts <= now - 60 and not (repeat or interval_min):
            raise ReminderError(f"{W.fmt_due(_dt(due_ts), _dt(now))} has already passed.")
        if repeat or interval_min:
            while due_ts <= now:                       # a repeating one starts at its next time
                nxt = W.next_occurrence(_dt(due_ts), repeat, interval_min, _dt(now))
                due_ts = nxt.timestamp()
        if due_ts - now > MAX_AHEAD_S:
            raise ReminderError("that is more than a year away")
        act = _check_action(action) if kind == "action" else None
        r = {"id": "r_" + secrets.token_hex(4), "kind": kind, "text": text, "due": round(due_ts, 3),
             "repeat": repeat, "interval_min": interval_min, "action": act, "origin": str(origin or "app")[:16],
             "created": round(now, 3), "status": "pending", "fired": [], "last_fired": None, "acked": None,
             "finished": None}
        if kind == "timer":
            r["length_s"] = max(1, round(due_ts - now))
        with self._lock:
            if sum(1 for x in self._items if x["status"] == "pending") >= MAX_PENDING:
                raise ReminderError(f"there are already {MAX_PENDING} pending reminders")
            self._items.append(r)
            self._save()
        return dict(r)

    def _finish(self, r: dict, status: str) -> None:
        r["status"], r["finished"] = status, round(self.clock(), 3)

    def cancel(self, rid: str) -> Optional[dict]:
        with self._lock:
            r = next((r for r in self._items if r["id"] == rid and r["status"] == "pending"), None)
            if r is None:
                return None
            self._finish(r, "cancelled")
            self._save()
            return dict(r)

    def cancel_matching(self, query: str = "", kind: Optional[str] = None, all: bool = False) -> list[dict]:  # noqa: A002
        """"cancel the reminder to call mum" / "stop the timer" / "cancel all alarms".
        Without `all`, only the best match goes (the soonest, on a tie)."""
        words = {w for w in re.findall(r"[a-z0-9]+", (query or "").lower()) if len(w) > 2} - {
            "the", "and", "for", "you", "your", "reminder", "reminders", "timer", "alarm", "please"}
        with self._lock:
            cands = [r for r in self._items if r["status"] == "pending" and (not kind or r["kind"] == kind)]
            if words:
                scored = [(len(words & set(re.findall(r"[a-z0-9]+", (r.get("text") or "").lower()))), r) for r in cands]
                cands = [r for s, r in sorted(scored, key=lambda x: (-x[0], x[1]["due"])) if s > 0]
            else:
                cands.sort(key=lambda r: r["due"])
            chosen = cands if all else cands[:1]
            for r in chosen:
                self._finish(r, "cancelled")
            if chosen:
                self._save()
            return [dict(r) for r in chosen]

    def mark_fired(self, rid: str, now: float, spoken: bool, outcome: Optional[dict] = None) -> Optional[dict]:
        with self._lock:
            r = next((r for r in self._items if r["id"] == rid), None)
            if r is None:
                return None
            r["fired"] = (r.get("fired") or [])[-9:] + [{"at": round(now, 3), "due": r["due"], "spoken": spoken,
                                                          "late_s": round(now - r["due"]), "outcome": outcome}]
            r["last_fired"], r["acked"] = round(now, 3), None
            nxt = W.next_occurrence(_dt(r["due"]), r.get("repeat"), r.get("interval_min"), _dt(now))
            if nxt is not None:
                r["due"] = round(nxt.timestamp(), 3)
            else:
                self._finish(r, "done")
            self._save()
            return dict(r)

    def snooze(self, rid: str, minutes: int = 10) -> Optional[dict]:
        """Again in `minutes` (a one-off that already fired comes back as pending)."""
        minutes = max(1, min(240, int(minutes)))
        now = self.clock()
        with self._lock:
            r = next((r for r in self._items if r["id"] == rid and r["status"] in ("pending", "done")), None)
            if r is None:
                return None
            if r["status"] == "done" or not (r.get("repeat") or r.get("interval_min")):
                r["status"], r["finished"], r["due"] = "pending", None, round(now + minutes * 60, 3)
            else:                                        # a repeating one: an extra one-off, the series stays
                extra = dict(r, id="r_" + secrets.token_hex(4), repeat=None, interval_min=None, fired=[],
                             due=round(now + minutes * 60, 3), created=round(now, 3), origin="snooze")
                self._items.append(extra)
                r = extra
            self._save()
            return dict(r)

    def ack(self, rid: str) -> Optional[dict]:
        """He confirmed it ("done", "le li") — kept with the last firing (SIH-3 starts here)."""
        with self._lock:
            r = next((r for r in self._items if r["id"] == rid), None)
            if r is None:
                return None
            r["acked"] = round(self.clock(), 3)
            if r.get("fired"):
                r["fired"][-1]["acked"] = r["acked"]
            self._save()
            return dict(r)


# ------------------------------------------------------------------ the scheduler
class ReminderScheduler:
    """Checks the store every second; fires what is due (see the module docstring)."""

    def __init__(self, store: ReminderStore, bus, core=None, limbs=None,
                 clock: Callable[[], float] = time.time, interval: float = 1.0):
        self.store, self.bus, self.core, self.limbs = store, bus, core, limbs
        self.clock, self.interval = clock, interval

    def _switch(self, r: dict, late: float) -> dict:
        if late > LATE_GRACE_S:
            return {"skipped": True}
        if self.limbs is None:
            return {"error": "the room controller is not available"}
        a = r["action"]
        try:
            res = self.limbs.apply(a["device"], a["action"], a.get("value"), origin="schedule")
        except Exception as e:                       # noqa: BLE001 — reported, never raised into the loop
            return {"error": str(e)}
        try:
            usb = bool(self.limbs.view().get("usb"))
        except Exception:
            usb = False
        return {"state": res.get("state"), "delivered": res.get("delivered"), "usb": usb}

    def tick(self, now: Optional[float] = None) -> list[dict]:
        now = self.clock() if now is None else now
        fired = []
        for r in self.store.due(now):
            late = now - r["due"]
            outcome = self._switch(r, late) if r["kind"] == "action" else None
            line = fire_line(r, now, outcome)
            voice = False
            core = self.core
            if core is not None and getattr(core, "running", False):
                try:
                    core.speak(line)
                    voice = getattr(core, "mode", None) == "voice"
                except Exception:                    # JARVIS went away mid-call: the event still goes out
                    voice = False
            rec = self.store.mark_fired(r["id"], now, voice, outcome)
            kind = "skipped" if outcome and outcome.get("skipped") else "missed" if late > LATE_GRACE_S else "due"
            fired.append(self.bus.publish("reminders", kind, line, reminder=rec, spoken=voice,
                                          late_s=round(late), outcome=outcome))
        return fired

    async def run(self) -> None:
        from starlette.concurrency import run_in_threadpool
        while True:
            try:
                await run_in_threadpool(self.tick)
            except Exception as e:                   # the loop must outlive one bad reminder
                self.bus.publish("reminders", "error", f"Reminder check failed: {e}")
            await asyncio.sleep(self.interval)
