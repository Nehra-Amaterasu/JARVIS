"""Movement watcher: how I move through Aankhen's Wi-Fi, kept all day.

Twice a second Aankhen's learned models (aankhen/learn.py, trained on my own labelled
recordings) say which ZONE I am in (empty / outside / room / desk / bed, with
probabilities) and what I am DOING (none / still / typing / waving / walking). Raw, the
answers flicker: on the real board the zone was right 88 % of the time and the activity
67 % (typing the weakest). This agent turns that stream into what a butler would know:
where I am and since when, what I'm doing, whether I waved, how restless I have been.

Holds keep a one-frame flicker from counting:
    zone       a change must last 4 s; leaving the room (to outside or empty) 8 s, because
               a wrong "he left" costs more than a late one
    activity   2 s (the engine already smooths it over ~2 s)
    wave       an episode is >= 1 s of "waving"; a gap under 1 s does not end it
A change that holds is dated from when it STARTED, not from when its hold ran out.

Events go on the board with a short text; each event's data carries its tags (the zone,
where from, the numbers behind the text):
    arrived         from empty/outside into the room; "back after N min" when away >= 3 min
    left            from the room to outside or empty
    moved           between the desk, the bed and the rest of the room
    waved           a waving episode; at most one event per 5 s
    typing_started  typing for 20 s                               (routine: not on the bus)
    typing_stopped  the end of such a stretch                     (routine)
    walking         walking for 3 s; at most one per 30 s, so pacing is not a stream (routine)
    sedentary       45 min at the desk without getting up, once per stretch
    restless        the restlessness index crosses 0.5 upwards (again only after it fell below 0.4)

Getting up means leaving the desk zone or 3 s of walking. A wave, or a moment the model
calls "none", does not end a sitting stretch: with the activity right 2 times in 3, a
stretch any odd frame could break would never reach 45 minutes.

Restlessness: the share of the last 5 min, while I was at the desk or in bed, in which
the human band (motion.py: power at body speeds, 0.4-4 Hz) was busy, i.e. its last second
was at or above the gate that starts motion (1.6x the window's own noise). It says
nothing until it has a minute of such data.

Only frames whose source is "hardware" describe me. In simulation or replay the agent
says so, keeps nothing and posts NOTHING: a simulated person waving is not me waving. A
board that stops sending is not "still at the desk": after 3 s without a new reading
nothing advances, and after 30 s what it knew is dropped.
"""
from __future__ import annotations

import math
import time
from collections import deque
from typing import Callable, Optional

from ..base import Agent

CANNOT_SEE = "fingers, elbow or knee angles, posture details, facial expressions: one Wi-Fi link cannot see them"

IN_ROOM = ("room", "desk", "bed")
AWAY = ("empty", "outside")
ACTIVITIES = ("none", "still", "typing", "waving", "walking")

ZONE_HOLD_S = 4.0
LEAVE_HOLD_S = 8.0
ACTIVITY_HOLD_S = 2.0
BACK_AFTER_S = 180.0             # an arrival says "back after N min" when away this long
WAVE_MIN_S = 1.0
WAVE_GAP_S = 1.0
WAVE_COOLDOWN_S = 5.0
WAVES_WINDOW_S = 60.0
TYPING_MIN_S = 20.0
WALK_MIN_S = 3.0
WALK_COOLDOWN_S = 30.0
SEDENTARY_S = 45 * 60.0
RESTLESS_WINDOW_S = 300          # seconds, one sample each
RESTLESS_MIN_SAMPLES = 60
RESTLESS_ON = 0.5
RESTLESS_OFF = 0.4
VERY_RESTLESS = 0.75
ENERGY_SECONDS = 120
STALE_S = 3.0
FORGET_S = 30.0
SURE_P = 0.6                     # a zone less likely than this is said with "probably"

# Where I am, for the summary and JARVIS's line; NEAR is the short form for event texts.
PLACE = {"desk": "at the desk", "bed": "on the bed", "room": "in the room but not at the desk or bed",
         "outside": "out of the room", "empty": "out of the room"}
NEAR = {"desk": " at the desk", "bed": " on the bed", "room": " in the room"}
DOING = ("still", "typing", "waving", "walking")
TIMES = {1: "once", 2: "twice"}

Frames = Callable[[], tuple[Optional[str], Optional[dict]]]


def _num(x) -> Optional[float]:
    """A finite float or None: a NaN reading must not reach the API's JSON."""
    try:
        v = float(x)
    except (TypeError, ValueError):
        return None
    return v if math.isfinite(v) else None


def duration(seconds: float) -> str:
    """"40 s", "25 min", "1 h 5 min": minutes rounded, as JARVIS's presence tool says them."""
    if seconds < 60:
        return f"{max(0, int(seconds))} s"
    m = int(round(seconds / 60))
    return f"{m // 60} h {m % 60} min" if m >= 60 else f"{m} min"


def _moved(old: str, new: str) -> str:
    if new == "room":
        return f"Got up from the {old}"
    if old == "room":
        return "Sat down at the desk" if new == "desk" else "Went to the bed"
    return f"Moved from the {old} to the {new}"


class MovementWatcher(Agent):
    id = "movement"
    name = "Movement watcher"
    role = "watches how you move through Aankhen's Wi-Fi"
    cadence_s = 0.5

    def __init__(self, frames: Frames, clock: Callable[[], float] = time.time):
        """frames() -> (the hub's mode, its latest frame); (None, None) while Aankhen is off."""
        super().__init__(clock)
        self.frames = frames
        self.source: Optional[str] = None        # hardware / simulation / replay, None while off
        self.fresh = False                       # a new reading arrived within STALE_S
        self.modelled = False                    # ...and it carries the learned models' estimate
        self._reading_t = None                   # the reading's device time,
        self._reading_at: Optional[float] = None  # and when (this clock) it last changed
        self._forget()

    def _forget(self) -> None:
        """Drop everything known about me: a new source, or a board silent for FORGET_S."""
        self.zone: Optional[str] = None
        self.zone_since: Optional[float] = None
        self.zone_seen = False                   # I saw this zone begin (False: it already was)
        self.zone_p: Optional[float] = None
        self.activity: Optional[str] = None
        self.activity_since: Optional[float] = None
        self.activity_p: Optional[float] = None
        self._zone_pending: Optional[tuple[str, float]] = None   # (zone, or "in"/"out" when crossing; since)
        self._act_pending: Optional[tuple[str, float]] = None
        self._entered: Optional[tuple[float, bool]] = None       # (came into the room at, seen it)
        self._left: Optional[tuple[float, bool]] = None          # (left it at, seen it)
        self._wave_start: Optional[float] = None
        self._wave_last: Optional[float] = None
        self._wave_counted = False
        self._waves: deque[float] = deque()                      # starts of waving episodes, last minute
        self._wave_posted_at: Optional[float] = None
        self._typing_posted = False
        self._walk_posted = False
        self._walk_posted_at: Optional[float] = None
        self._sit_start: Optional[float] = None
        self._sedentary_for: Optional[float] = None              # the sitting stretch already announced
        # One sample a second: (second, human-band energy, busy at the desk or in bed, else None)
        self._series: deque[tuple[int, Optional[float], Optional[bool]]] = deque(maxlen=RESTLESS_WINDOW_S + 5)
        self._restless_armed = True

    # ------------------------------------------------------------ the tick
    def tick(self, now: float) -> None:
        mode, frame = self.frames()
        source = frame.get("source") if frame else mode
        if source != self.source:                # a new source starts from nothing
            self.source = source
            self._reading_t, self._reading_at = None, None
            self._forget()
        if frame is None or source != "hardware" or mode not in (None, "hardware"):
            self.fresh = self.modelled = False   # simulated, replayed or off: never about me
            return
        learned = frame.get("learned") if isinstance(frame.get("learned"), dict) else None
        t = (learned or frame).get("t")
        if t is not None and t != self._reading_t:
            self._reading_t, self._reading_at = t, now
        self.fresh = self._reading_at is not None and now - self._reading_at <= STALE_S
        if not self.fresh:
            self.modelled = False
            if self._reading_at is not None and now - self._reading_at >= FORGET_S \
                    and (self.zone is not None or self._series):
                self._forget()
            return
        self.modelled = learned is not None and learned.get("state") in PLACE
        if self.modelled:
            act = learned.get("activity") if isinstance(learned.get("activity"), dict) else {}
            act_p = act.get("p") or {}
            self._step_zone(now, learned["state"], learned.get("p") or {})
            self._step_activity(now, act.get("state"), act_p)
            self._step_wave(now, act.get("state"), act_p.get("waving"))
        self._sample(now, (frame.get("motion_detail") or {}).get("human_band"))
        if self.modelled:
            self._check_typing(now)
            self._check_walking(now)
            self._check_sedentary(now)
            self._check_restless()

    # ------------------------------------------------------------ zone
    def _step_zone(self, now: float, raw: str, p: dict) -> None:
        cur = self.zone
        if raw == cur:
            self._zone_pending = None
        else:
            # Crossing the room's edge is held as one change whichever side's zones flicker
            # (outside -> room -> desk is one arrival, not three restarts of the hold).
            crossing = cur is not None and (cur in IN_ROOM) != (raw in IN_ROOM)
            key = ("in" if raw in IN_ROOM else "out") if crossing else raw
            if self._zone_pending is None or self._zone_pending[0] != key:
                self._zone_pending = (key, now)
            hold = LEAVE_HOLD_S if crossing and raw in AWAY else ZONE_HOLD_S
            if now - self._zone_pending[1] >= hold:
                since = self._zone_pending[1]
                self._zone_pending = None
                self._commit_zone(cur, raw, since)
        self.zone_p = _num(p.get(self.zone)) if self.zone else None

    def _commit_zone(self, old: Optional[str], new: str, since: float) -> None:
        self.zone, self.zone_since, self.zone_seen = new, since, old is not None
        if new != "desk":
            self._sit_start = None
        elif self.activity != "walking":
            self._sit_start = since
        if old is None:                          # watching began here: no change I saw happen
            if new in IN_ROOM:
                self._entered = (since, False)
            else:
                self._left = (since, False)
            return
        if old in AWAY and new in IN_ROOM:
            left_at, seen = self._left
            away = since - left_at
            self._entered = (since, True)
            where = f" ({PLACE[new]})" if new != "room" else ""
            if away >= BACK_AFTER_S:
                text = f"Back in the room after {'' if seen else 'at least '}{duration(away)} away{where}"
            else:
                text = f"Came into the room{where}"
            self.post("arrived", text, zone=new, from_zone=old, away_min=round(away / 60), at_least=not seen)
        elif old in IN_ROOM and new in AWAY:
            came_at, seen = self._entered
            stayed = since - came_at
            self._left = (since, True)
            self.post("left", f"Left the room after {'' if seen else 'at least '}{duration(stayed)} in it",
                      zone=new, from_zone=old, stayed_min=round(stayed / 60), at_least=not seen)
        elif old in IN_ROOM and new in IN_ROOM:
            self.post("moved", _moved(old, new), zone=new, from_zone=old)
        # empty <-> outside: still away; nothing to say

    # ------------------------------------------------------------ activity
    def _step_activity(self, now: float, raw: Optional[str], p: dict) -> None:
        if raw not in ACTIVITIES:
            return                               # this board has no activity model
        cur = self.activity
        if raw == cur:
            self._act_pending = None
        else:
            if self._act_pending is None or self._act_pending[0] != raw:
                self._act_pending = (raw, now)
            if now - self._act_pending[1] >= ACTIVITY_HOLD_S:
                since = self._act_pending[1]
                self._act_pending = None
                self._commit_activity(cur, raw, since)
        self.activity_p = _num(p.get(self.activity)) if self.activity else None

    def _commit_activity(self, old: Optional[str], new: str, since: float) -> None:
        if old == "typing" and self._typing_posted:
            took = since - self.activity_since
            self.post("typing_stopped", f"Stopped typing after {duration(took)}", notable=False,
                      zone=self.zone, minutes=round(took / 60, 1))
        if old == "walking" and self.zone == "desk" and self._sit_start is None:
            self._sit_start = since              # sat back down
        self.activity, self.activity_since = new, since
        self._typing_posted = self._walk_posted = False

    def _step_wave(self, now: float, raw: Optional[str], p) -> None:
        while self._waves and now - self._waves[0] > WAVES_WINDOW_S:
            self._waves.popleft()
        if raw != "waving":
            return
        if self._wave_last is None or now - self._wave_last > WAVE_GAP_S:
            self._wave_start, self._wave_counted = now, False      # a new episode
        self._wave_last = now
        if self._wave_counted or now - self._wave_start < WAVE_MIN_S:
            return
        self._wave_counted = True
        self._waves.append(self._wave_start)
        if self._wave_posted_at is not None and now - self._wave_posted_at < WAVE_COOLDOWN_S:
            return
        self._wave_posted_at = now
        self.post("waved", "Waved" + NEAR.get(self.zone, ""), zone=self.zone, p=_num(p))

    def _check_typing(self, now: float) -> None:
        if self.activity == "typing" and not self._typing_posted and now - self.activity_since >= TYPING_MIN_S:
            self._typing_posted = True
            self.post("typing_started", "Started typing" + NEAR.get(self.zone, ""), notable=False,
                      zone=self.zone, p=self.activity_p)

    def _check_walking(self, now: float) -> None:
        if self.activity != "walking" or now - self.activity_since < WALK_MIN_S:
            return
        self._sit_start = None                   # three seconds of walking: he got up
        if self._walk_posted or (self._walk_posted_at is not None and now - self._walk_posted_at < WALK_COOLDOWN_S):
            return
        self._walk_posted, self._walk_posted_at = True, now
        self.post("walking", "Walking around" + (" the room" if self.zone in IN_ROOM else ""), notable=False,
                  zone=self.zone, p=self.activity_p)

    def _check_sedentary(self, now: float) -> None:
        start = self._sit_start
        if start is None or self._sedentary_for == start or now - start < SEDENTARY_S:
            return
        self._sedentary_for = start
        self.post("sedentary", f"At the desk {duration(now - start)} without getting up",
                  minutes=round((now - start) / 60))

    # ------------------------------------------------------------ the human band
    def _sample(self, now: float, hb) -> None:
        second = int(now)
        if self._series and self._series[-1][0] == second:
            return
        hb = hb if isinstance(hb, dict) else {}
        busy = None
        if self.zone in ("desk", "bed"):
            recent, gate = _num(hb.get("recent")), _num(hb.get("start_gate"))
            if recent is not None and gate:
                busy = recent >= gate
        self._series.append((second, _num(hb.get("energy")), busy))

    def _restlessness(self) -> Optional[float]:
        cut = int(self.now) - RESTLESS_WINDOW_S
        flags = [b for s, _, b in self._series if s > cut and b is not None]
        return sum(flags) / len(flags) if len(flags) >= RESTLESS_MIN_SAMPLES else None

    def _check_restless(self) -> None:
        idx = self._restlessness()
        if idx is None or idx < RESTLESS_OFF:
            self._restless_armed = True
        elif idx >= RESTLESS_ON and self._restless_armed:
            self._restless_armed = False
            self.post("restless", f"Restless{NEAR.get(self.zone, '')}: moving in {idx:.0%} of the last 5 min",
                      zone=self.zone, index=round(idx, 2))

    def _energy(self) -> list[Optional[float]]:
        """The last 120 s of human-band energy, one value a second, None where nothing came."""
        now_s = int(self.now)
        got = {s: e for s, e, _ in self._series if s > now_s - ENERGY_SECONDS}
        return [got.get(s) for s in range(now_s - ENERGY_SECONDS + 1, now_s + 1)]

    def _waves_recent(self) -> int:
        return sum(1 for t in self._waves if self.now - t <= WAVES_WINDOW_S)

    # ------------------------------------------------------------ what it says
    def _blind(self) -> str:
        """Why nothing can be said about me right now ("" when something can)."""
        if self.source is None:
            return "Aankhen is off, so the room sensors see nothing."
        if self.source == "simulation":
            return "Aankhen is running a simulation: nothing real to watch, so nothing is said about you."
        if self.source == "replay":
            return "Aankhen is replaying a recording: nothing live to watch."
        if self.source != "hardware":
            return f"Aankhen's source is {self.source}, not a live board."
        if self._reading_at is None:
            return "The board is connected but has sent no reading yet."
        if not self.fresh:
            return f"No new reading from the board since {time.strftime('%H:%M', time.localtime(self._reading_at))}."
        if not self.modelled:
            return "The board is live but gives no room estimate (no trained room model, or still warming up)."
        return ""

    @property
    def live(self) -> bool:
        return self.source == "hardware" and self.fresh and self.modelled and self.zone is not None

    @property
    def idle(self) -> bool:
        return not self.live

    def _for(self) -> str:
        return ("" if self.zone_seen else "at least ") + duration(self.now - self.zone_since)

    @property
    def summary(self) -> str:
        why = self._blind()
        if why:
            return why
        if self.zone is None:
            return "Watching the board; not sure yet where you are."
        s = f"You've been {PLACE[self.zone]} for {self._for()}"
        if self.zone in IN_ROOM and self.activity in DOING:
            s += f", {self.activity}"
        return s + "."

    def context_line(self) -> str:
        if self.source is None:
            return "Movement: Aankhen is off, so you cannot see the room."
        if self.source != "hardware":
            what = "replaying a recording" if self.source == "replay" else "running a simulation"
            return f"Movement: Aankhen is {what}, so the room sensors show nothing real about him."
        if not self.fresh:
            return "Movement: the room sensors have sent nothing new, so where he is now is unknown."
        if not self.modelled:
            return "Movement: the board is live but gives no room estimate, so where he is is unknown."
        if self.zone is None:
            return ""                            # the first seconds: nothing worth a token yet
        where = PLACE[self.zone]
        if self.zone_p is not None and self.zone_p < SURE_P:
            where = "probably " + where
        line = f"Movement (Wi-Fi estimate): {where} {self._for()}"
        if self.zone in IN_ROOM and self.activity in DOING:
            line += f", {self.activity}" + (f" ({self.activity_p:.0%})" if self.activity_p is not None else "")
        extras = []
        waves = self._waves_recent()
        if waves:
            extras.append(f"waved {TIMES.get(waves, f'{waves} times')} in the last minute")
        idx = self._restlessness()
        if self.zone in ("desk", "bed") and idx is not None and idx >= RESTLESS_ON:
            extras.append("very restless" if idx >= VERY_RESTLESS else "fairly restless")
        return line + "".join(f"; {e}" for e in extras) + "."

    def _span(self, state: Optional[str], since: Optional[float], p: Optional[float]) -> Optional[dict]:
        if state is None:
            return None
        return {"state": state, "p": p, "since": since, "seconds": round(self.now - since, 1)}

    @property
    def data(self) -> dict:
        idx = self._restlessness()
        zone = self._span(self.zone, self.zone_since, self.zone_p)
        if zone is not None:
            zone["seen_start"] = self.zone_seen
        return {
            "source": self.source,
            "live": self.live,
            "note": self._blind() or None,
            "zone": zone,
            "activity": self._span(self.activity, self.activity_since, self.activity_p),
            "waves_60s": self._waves_recent(),
            "restlessness": None if idx is None else round(idx, 2),
            "sitting_s": None if self._sit_start is None else round(self.now - self._sit_start),
            "energy": self._energy(),
            "energy_unit": "human-band energy in units of the window's own noise, one value a second",
            "cannot_see": CANNOT_SEE,
        }
