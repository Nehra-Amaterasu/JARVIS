"""Empty-room waste: a load left on in a room Aankhen says is empty.

SIH 2022 DR704 asks for appliances that turn off when people leave. Switching mains
loads off on a sensor's say-so is exactly how a family learns to hate a smart home,
so the order is fixed and slow:

    room empty ── grace (5 min) ──▶ counted as WASTE (minutes, kWh, ₹)
               ── 20 min ─────────▶ NUDGE: a bus event, and JARVIS says it aloud if he is
                                     running, it is not night, and the presence is REAL
               ── 45 min ─────────▶ AUTO-OFF, only if every one of these holds:
                                       auto-off is enabled (it is off by default)
                                       the nudge was SPOKEN at least 10 min earlier
                                       nobody pressed "keep it on"
                                       presence comes from the real sensors, not the simulator
                                       it is not the night window, and the learned model
                                       does not say someone is in bed
                                       the load is switchable and not must-not-auto-off

The hold is counted from the later of "the room went empty" and "the load came on":
a light someone switches on in a room the sensors call empty gets the full hold again,
so a wrong "empty" can never switch the same light off twice in quick succession.

Anything that is not a confident "empty" (moving, still, uncertain, no data) ends the
episode: a still person the radar half-sees is never "nobody here". The learned
model's "bed" counts as someone being there even when fusion says empty, because a
sleeper is the one person the radar loses.

SIMULATED PRESENCE stays simulated: nudges are logged with sim=True and an explicit
"[simulated presence]" prefix, never spoken, never acted on, and their waste minutes
are kept apart from real ones.

A second, presence-free rule covers loads Aankhen cannot see (the bathroom geyser):
"remind_after_min" in circuits.json gives one reminder per on-period.

This module is pure logic on a clock; energy.EnergyService feeds it and carries out
what it returns (publish, speak, switch).
"""
from __future__ import annotations

import itertools
import json
import threading
import time
from collections import deque
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path
from typing import Callable, Optional

MIN_AUTO_OFF_HOLD_MIN = 30.0      # the shortest "long hold" the config may ask for
TICK_CAP_S = 60.0                 # a stalled loop never books more than this per tick
LIVE_SOURCES = {"hardware"}       # presence from anything else is simulated/replayed
OCCUPIED_LEARNED = {"bed"}        # the learned model's states that mean "someone is here"


@dataclass
class WasteConfig:
    sensed_room: Optional[str] = None
    grace_min: float = 5.0
    nudge_after_min: float = 20.0
    auto_off_enabled: bool = False
    auto_off_after_min: float = 45.0
    min_after_nudge_min: float = 10.0
    night_start: str = "23:00"
    night_end: str = "07:00"
    speak_at_night: bool = False
    notes: list = field(default_factory=list)       # clamps applied to the config, shown in the UI

    @classmethod
    def from_config(cls, d: Optional[dict], sensed_default: Optional[str] = None) -> "WasteConfig":
        d = d or {}
        ao = d.get("auto_off") or {}
        night = d.get("night") or {}
        c = cls(sensed_room=d.get("sensed_room") or sensed_default,
                grace_min=float(d.get("grace_min", 5)), nudge_after_min=float(d.get("nudge_after_min", 20)),
                auto_off_enabled=bool(ao.get("enabled", False)),
                auto_off_after_min=float(ao.get("after_min", 45)),
                min_after_nudge_min=float(ao.get("min_after_nudge_min", 10)),
                night_start=str(night.get("start", "23:00")), night_end=str(night.get("end", "07:00")),
                speak_at_night=bool(d.get("speak_at_night", False)))
        c.clamp()
        return c

    def clamp(self) -> None:
        """The long hold is a safety rule, not a preference: refuse shorter ones."""
        self.notes = []
        if self.grace_min < 0:
            self.grace_min = 0.0
        if self.nudge_after_min < self.grace_min:
            self.notes.append(f"nudge_after_min raised to the grace period ({self.grace_min:g} min)")
            self.nudge_after_min = self.grace_min
        if self.min_after_nudge_min < 5:
            self.notes.append("min_after_nudge_min raised to 5 min: a nudge needs time to be answered")
            self.min_after_nudge_min = 5.0
        floor = max(MIN_AUTO_OFF_HOLD_MIN, self.nudge_after_min + self.min_after_nudge_min)
        if self.auto_off_after_min < floor:
            self.notes.append(f"auto_off after_min raised from {self.auto_off_after_min:g} to {floor:g} min "
                              f"(the hold must be long and come after a spoken nudge)")
            self.auto_off_after_min = floor
        for name in ("night_start", "night_end"):
            try:
                _hm(getattr(self, name))
            except ValueError:
                self.notes.append(f"{name} {getattr(self, name)!r} is not HH:MM; using the default")
                setattr(self, name, "23:00" if name == "night_start" else "07:00")

    def is_night(self, ts: float) -> bool:
        d = datetime.fromtimestamp(ts)
        m = d.hour * 60 + d.minute
        a, b = _hm(self.night_start), _hm(self.night_end)
        return (a <= m < b) if a <= b else (m >= a or m < b)

    def to_dict(self) -> dict:
        return {"sensed_room": self.sensed_room, "grace_min": self.grace_min,
                "nudge_after_min": self.nudge_after_min, "auto_off_enabled": self.auto_off_enabled,
                "auto_off_after_min": self.auto_off_after_min, "min_after_nudge_min": self.min_after_nudge_min,
                "night": {"start": self.night_start, "end": self.night_end},
                "speak_at_night": self.speak_at_night, "notes": list(self.notes)}


def _hm(s: str) -> int:
    h, m = s.split(":")
    h, m = int(h), int(m)
    if not (0 <= h < 24 and 0 <= m < 60):
        raise ValueError(s)
    return h * 60 + m


@dataclass
class Load:
    """One circuit's state as the detector needs it."""
    id: str
    name: str
    room: str
    on: bool
    watts: float
    switchable: bool
    kind: str = "light"
    must_not_auto_off: bool = False
    on_since: Optional[float] = None
    remind_after_min: Optional[float] = None


class WasteDetector:
    def __init__(self, cfg: WasteConfig, folder: Optional[Path] = None,
                 clock: Callable[[], float] = time.time):
        self.cfg = cfg
        self.clock = clock
        self.folder = Path(folder) if folder else None
        self._lock = threading.RLock()
        self._ids = itertools.count(1)
        self.empty_since: Optional[float] = None
        self.empty_sim: Optional[bool] = None
        self.nudge: Optional[dict] = None              # this empty episode's nudge
        self.nudges: deque = deque(maxlen=60)
        self.reminded: dict[str, float] = {}           # circuit -> the on_since it was reminded for
        self.last_tick: Optional[float] = None
        self.status: dict = {"state": "starting", "text": "Waiting for the first presence reading."}
        self.days: dict = {}                           # "YYYY-MM-DD" -> circuit -> waste seconds/Wh
        self._dirty_at: Optional[float] = None
        self._load()

    # -------------------------------------------------------------- persistence
    def _path(self, name: str) -> Optional[Path]:
        if self.folder is None:
            return None
        self.folder.mkdir(parents=True, exist_ok=True)
        return self.folder / name

    def _load(self) -> None:
        p = self._path("waste.json")
        if p and p.exists():
            try:
                self.days = json.loads(p.read_text(encoding="utf-8"))
            except ValueError:
                self.days = {}
        p = self._path("nudges.jsonl")
        if p and p.exists():
            latest: dict[str, dict] = {}
            for line in p.read_text(encoding="utf-8").splitlines()[-400:]:
                try:
                    n = json.loads(line)
                    latest[n["id"]] = n
                except (ValueError, KeyError):
                    continue
            for n in sorted(latest.values(), key=lambda n: n["ts"])[-60:]:
                if n.get("status") == "open":
                    n["status"] = "closed"               # an episode cannot survive a restart
                self.nudges.append(n)
            nums = [int(n["id"][1:]) for n in latest.values() if str(n["id"])[1:].isdigit()]
            self._ids = itertools.count(max(nums, default=0) + 1)

    def _log_nudge(self, n: dict) -> None:
        p = self._path("nudges.jsonl")
        if p:
            with p.open("a", encoding="utf-8") as f:
                f.write(json.dumps(n, ensure_ascii=False) + "\n")

    def flush(self, force: bool = False) -> None:
        p = self._path("waste.json")
        if not p or self._dirty_at is None:
            return
        if not force and self.clock() - self._dirty_at < 30:
            return
        tmp = p.with_suffix(".tmp")
        tmp.write_text(json.dumps(self.days), encoding="utf-8")
        tmp.replace(p)
        self._dirty_at = None

    # -------------------------------------------------------------- the tick
    def tick(self, presence: dict, loads: list[Load], now: Optional[float] = None,
             core_running: bool = False) -> list[dict]:
        """Advance one step. Returns actions for the caller:
            {"type": "nudge", "nudge": n, "speak": text | None}
            {"type": "auto_off", "nudge": n, "loads": [Load], "speak": text | None}
            {"type": "remind", "nudge": n, "speak": text | None}
            {"type": "resolved", "nudge": n}
        """
        with self._lock:
            now = self.clock() if now is None else now
            dt = 0.0 if self.last_tick is None else max(0.0, min(TICK_CAP_S, now - self.last_tick))
            self.last_tick = now
            actions: list[dict] = []
            night = self.cfg.is_night(now)
            actions += self._reminders(loads, now, night, core_running)

            state = (presence or {}).get("state")
            source = (presence or {}).get("source")
            learned = (presence or {}).get("learned")
            sim = source not in LIVE_SOURCES
            room = self.cfg.sensed_room
            watched = [l for l in loads if room and l.room == room]
            on = [l for l in watched if l.on]

            if room is None:
                self.status = {"state": "off", "text": "No sensed room set in circuits.json (waste.sensed_room)."}
                return actions + self._end_episode("no sensed room")
            if state != "empty" or learned in OCCUPIED_LEARNED:
                why = {None: "no presence data", "no data": "no presence data"}.get(state, f"room {state}")
                if state == "empty" and learned in OCCUPIED_LEARNED:
                    why = "the learned model says someone is in bed"
                self.status = {"state": "occupied" if state in ("moving", "still") else "unknown",
                               "text": f"Not counting waste: {why}.", "sim": sim}
                return actions + self._end_episode(why)
            if self.empty_since is None or self.empty_sim != sim:
                if self.nudge is not None:
                    actions += self._end_episode("presence source changed")
                self.empty_since, self.empty_sim = now, sim
            empty_min = (now - self.empty_since) / 60.0

            # Waste: loads on after the grace period, counted per day (real and simulated apart).
            # Only the part of this tick that lies beyond the grace period counts.
            counted = min(dt, max(0.0, (empty_min - self.cfg.grace_min) * 60.0))
            if counted > 0 and on:
                day = datetime.fromtimestamp(now).strftime("%Y-%m-%d")
                k = "sim_" if sim else ""
                # "_room": wall-clock time with anything left on (the headline minutes);
                # per circuit: that circuit's minutes and watt-hours.
                # Accumulated unrounded: rounding every 5 s step to 0.001 Wh over-counted
                # a 20 W light by 0.8 % (0.0278 -> 0.028 per tick). Reports round.
                room_v = self.days.setdefault(day, {}).setdefault("_room", {"s": 0.0, "sim_s": 0.0})
                room_v[k + "s"] += counted
                for l in on:
                    v = self.days.setdefault(day, {}).setdefault(l.id, {"s": 0.0, "wh": 0.0, "sim_s": 0.0,
                                                                       "sim_wh": 0.0})
                    v[k + "s"] += counted
                    v[k + "wh"] += l.watts * counted / 3600.0
                self._dirty_at = self._dirty_at or now

            if not on:
                # The room stays empty (the timer keeps running); only the nudge closes.
                self.status = {"state": "empty", "sim": sim,
                               "text": f"{'Simulated: r' if sim else 'R'}oom empty {empty_min:.0f} min; nothing is on."}
                return actions + self._close_nudge("everything is off")

            self.status = {"state": "wasting" if empty_min >= self.cfg.grace_min else "empty", "sim": sim,
                           "empty_min": round(empty_min, 1), "loads": [l.id for l in on],
                           "text": f"{'Simulated: r' if sim else 'R'}oom empty {empty_min:.0f} min with "
                                   f"{_names(on)} on."}

            # The HOLD runs from the later of "the room went empty" and "a load came on".
            # Someone switching a light on in a room the sensors call empty is evidence
            # they want it (or that the sensors are wrong): it gets the full hold again,
            # never a quick second switch-off.
            latest_on = max((l.on_since for l in on if l.on_since is not None), default=self.empty_since)
            hold_min = (now - max(self.empty_since, latest_on)) / 60.0
            if self.nudge is None and hold_min >= self.cfg.nudge_after_min:
                actions.append(self._new_nudge(on, empty_min, sim, night, core_running, now))
            elif self.nudge is not None and self.nudge["status"] == "open":
                actions += self._maybe_auto_off(on, hold_min, empty_min, sim, night, learned, now, core_running)
            return actions

    # -------------------------------------------------------------- nudges
    def _new_nudge(self, on: list[Load], empty_min: float, sim: bool, night: bool, core_running: bool,
                   now: float) -> dict:
        room = self.cfg.sensed_room
        mins = int(round(empty_min))
        verb = "is" if len(on) == 1 else "are"
        switch = [l for l in on if l.switchable]
        text = (f"The {room} has been empty for {_minutes(mins)} and {_names(on)} {verb} still on.")
        if switch:
            text += f" Say {_say_off(switch)} and I'll switch {'it' if len(switch) == 1 else 'them'} off."
        plan = self._plan(on, sim, night, core_running)
        if plan["will_auto_off"]:
            text += (f" If nobody keeps {'it' if len(plan['targets']) == 1 else 'them'} on from the app, I'll "
                     f"switch {_names([l for l in on if l.id in plan['targets']])} off at "
                     f"{_minutes(self.cfg.auto_off_after_min)}.")
        n = {"id": f"n{next(self._ids)}", "ts": now, "kind": "empty_room", "room": room,
             "circuits": [l.id for l in on], "empty_min": mins, "sim": sim,
             "text": ("[simulated presence] " if sim else "") + text,
             "spoken": False, "spoken_at": None, "status": "open", "night": night,
             "auto_off": plan}
        self.nudge = n
        self.nudges.append(n)
        self._log_nudge(n)
        speak = None if (sim or not core_running or (night and not self.cfg.speak_at_night)) else text
        if speak is None:
            n["not_spoken"] = ("simulated presence" if sim else "JARVIS is not running" if not core_running
                               else "night: nudges are not spoken")
        return {"type": "nudge", "nudge": n, "speak": speak}

    def _plan(self, on: list[Load], sim: bool, night: bool, core_running: bool) -> dict:
        """Will this episode end in an automatic switch-off, and if not, why not?"""
        targets = [l.id for l in on if l.switchable and not l.must_not_auto_off]
        blockers = []                  # any of these stops auto-off for the whole episode
        if not self.cfg.auto_off_enabled:
            blockers.append("auto-off is off")
        if sim:
            blockers.append("presence is simulated")
        if night:
            blockers.append("it is night")
        if not core_running:
            blockers.append("JARVIS is not running to ask first")
        if not targets:
            blockers.append("nothing on can be switched automatically")
        spared = [l.name for l in on if l.must_not_auto_off]
        spared += [l.name for l in on if not l.switchable and not l.must_not_auto_off]
        notes = [f"{', '.join(n for n in spared)} will be left alone"] if spared else []
        return {"will_auto_off": not blockers, "targets": targets,
                "after_min": self.cfg.auto_off_after_min, "why_not": blockers + notes}

    def mark_spoken(self, nudge_id: str, ok: bool, now: Optional[float] = None) -> None:
        with self._lock:
            for n in self.nudges:
                if n["id"] == nudge_id:
                    n["spoken"] = bool(ok)
                    n["spoken_at"] = (self.clock() if now is None else now) if ok else None
                    if not ok:
                        n["not_spoken"] = n.get("not_spoken") or "JARVIS could not say it"
                    self._log_nudge(n)

    def keep(self, nudge_id: str) -> Optional[dict]:
        """"Keep it on": this episode will not end in an automatic switch-off."""
        with self._lock:
            for n in self.nudges:
                if n["id"] == nudge_id:
                    if n["status"] == "open":
                        n["status"] = "kept"
                        n["auto_off"] = {**n.get("auto_off", {}), "will_auto_off": False,
                                         "why_not": (n.get("auto_off", {}).get("why_not") or []) + ["you kept it on"]}
                        self._log_nudge(n)
                    return n
            return None

    def _maybe_auto_off(self, on: list[Load], hold_min: float, empty_min: float, sim: bool, night: bool,
                        learned: Optional[str], now: float, core_running: bool) -> list[dict]:
        n = self.nudge
        if not self.cfg.auto_off_enabled or sim or night or learned in OCCUPIED_LEARNED:
            return []
        if not n.get("spoken") or n.get("spoken_at") is None:
            return []                                    # the rule: a spoken check comes first
        if now - n["spoken_at"] < self.cfg.min_after_nudge_min * 60.0:
            return []
        if hold_min < self.cfg.auto_off_after_min:
            return []
        targets = [l for l in on if l.id in n["circuits"] and l.switchable and not l.must_not_auto_off]
        if not targets:
            return []
        n["status"] = "auto_off"
        n["auto_off_at"] = now
        n["switched"] = [l.id for l in targets]
        self._log_nudge(n)
        text = (f"I've switched {_names(targets)} off. The {self.cfg.sensed_room} had been empty for "
                f"{_minutes(empty_min)}.")
        return [{"type": "auto_off", "nudge": n, "loads": targets,
                 "speak": text if core_running and not night else None}]

    def _end_episode(self, why: str) -> list[dict]:
        """Someone is (or may be) here: the empty timer and the nudge both end."""
        self.empty_since, self.empty_sim = None, None
        return self._close_nudge(why)

    def _close_nudge(self, why: str) -> list[dict]:
        n, self.nudge = self.nudge, None
        if n is not None and n["status"] == "open":
            n["status"] = "resolved"
            n["resolved_why"] = why
            self._log_nudge(n)
            return [{"type": "resolved", "nudge": n}]
        return []

    # -------------------------------------------------------------- reminders (presence-free)
    def _reminders(self, loads: list[Load], now: float, night: bool, core_running: bool) -> list[dict]:
        out = []
        for l in loads:
            if not l.on or l.on_since is None:
                self.reminded.pop(l.id, None)
                continue
            if not l.remind_after_min or self.reminded.get(l.id) == l.on_since:
                continue
            on_min = (now - l.on_since) / 60.0
            if on_min < l.remind_after_min:
                continue
            self.reminded[l.id] = l.on_since
            text = f"The {_lower1(l.name)} has been on for {_minutes(on_min, floor=True)}."
            if l.kind == "geyser":
                text += " Switch it off once the water is hot."
            n = {"id": f"n{next(self._ids)}", "ts": now, "kind": "long_on", "room": l.room,
                 "circuits": [l.id], "on_min": int(on_min), "sim": False, "text": text,
                 "spoken": False, "spoken_at": None, "status": "reminder", "night": night,
                 "auto_off": {"will_auto_off": False, "targets": [], "why_not": ["reminders never switch anything"]}}
            self.nudges.append(n)
            self._log_nudge(n)
            speak = text if core_running and (not night or self.cfg.speak_at_night) else None
            if speak is None:
                n["not_spoken"] = "JARVIS is not running" if not core_running else "night: not spoken"
            out.append({"type": "remind", "nudge": n, "speak": speak})
        return out

    # -------------------------------------------------------------- view
    def view(self) -> dict:
        with self._lock:
            return {"status": dict(self.status), "config": self.cfg.to_dict(),
                    "nudges": [dict(n) for n in reversed(self.nudges)],
                    "episode": {"empty_since": self.empty_since, "sim": self.empty_sim,
                                "nudge": self.nudge["id"] if self.nudge else None}}


def _minutes(m: float, floor: bool = False) -> str:
    """ "1 minute", "20 minutes" — these lines are spoken aloud."""
    n = int(m) if floor else int(round(m))
    return f"{n} minute" if n == 1 else f"{n} minutes"


def _lower1(s: str) -> str:
    return s[:1].lower() + s[1:] if s else s


def _names(loads: list[Load]) -> str:
    names = [f"the {_lower1(l.name)}" for l in loads]
    if len(names) <= 1:
        return names[0] if names else "nothing"
    return ", ".join(names[:-1]) + " and " + names[-1]


def _say_off(loads: list[Load]) -> str:
    """The words the room parser (core/room.py) already understands."""
    kinds = {"fan" if l.kind == "fan" else "light" for l in loads}
    if len(loads) > 1:
        return "“sab band karo”" if kinds == {"light", "fan"} else "“lights off”"
    return "“fan off”" if kinds == {"fan"} else "“light off”"
