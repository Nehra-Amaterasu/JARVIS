"""The staff -> orchestrator feed: what the crew, Aankhen and the limbs notice, queued for
JARVIS by importance, so he can comment on it without being asked.

Sources (the app's event bus carries all of them; the app hands each bus event to offer()):
    crew      arrived / left (movement watcher), sedentary, aankhen_silent / aankhen_back,
              core_crashed / ollama_down (steward)
    limbs     a relay that did not confirm (relay_failed), the Uno relay board
              connecting / disconnecting, a light or fan changed by something other than
              him (a schedule, a presence rule)
    reminders a reminder coming due (reminders.py speaks it itself: logged, never repeated)
and three the feed works out itself (derive(), from the movement watcher's state and
the clock):
    long_stillness  "still" for STILL_MIN at the desk or in the room (not in bed), once a stretch
    went_to_bed     on the bed BED_MIN between 21:00 and 04:00, once a night
    woke_up         off the bed for UP_MIN between 05:00 and 12:00 after a night in it, once a day

Every event gets:
    kind, priority (3 urgent .. 1 chit-chat), ts, summary (one plain sentence), facts
    (what the line may use, nothing else), evidence ("observed": a live sensor; "system":
    the app's own state; "none"), certainty ("sure" / "probable" / "unknown"), sim.
Aankhen's room estimates are Wi-Fi guesses: they are never "sure". A zone or activity
the model gives under UNSURE_P is "unknown", and core/proactive.py says nothing about it.

The queue: highest priority first, then oldest; the same kind is not queued twice within
its cooldown; at most MAX_QUEUED (the least important are dropped); pop() discards events
older than MAX_AGE_S (logged as "stale"). Nothing here speaks: the app forwards popped
events to the voice core, where core/proactive.py decides.
"""
from __future__ import annotations

import heapq
import itertools
import re
import time
from typing import Callable, Optional

MAX_QUEUED = 50
MAX_AGE_S = 600.0
UNSURE_P = 0.5
STILL_MIN = 60.0
BED_MIN = 15.0
UP_MIN = 2.0
COOLDOWN_S = {"arrived": 300, "lights_changed": 60, "relay_failed": 120, "board_disconnected": 600,
              "board_back": 600, "long_stillness": 3600, "sedentary": 3600}
DEFAULT_COOLDOWN_S = 120

URGENT, NORMAL, LOW = 3, 2, 1
USER_ORIGINS = {"voice", "app", "core", "phone", "ui", "user", "api"}   # he did it himself: nothing to say


def _event(kind: str, priority: int, summary: str, facts: Optional[dict] = None, evidence: str = "system",
           certainty: str = "sure", ts: Optional[float] = None, sim: bool = False, source: str = "") -> dict:
    return {"kind": kind, "priority": priority, "summary": summary, "facts": dict(facts or {}),
            "evidence": evidence, "certainty": certainty, "ts": ts, "sim": bool(sim), "source": source}


def classify(ev: dict) -> Optional[dict]:
    """One bus event -> a feed event, or None when it is nothing JARVIS would mention."""
    src, kind, text = ev.get("source"), ev.get("kind"), str(ev.get("text") or "")
    ts = ev.get("ts")
    sim = bool(ev.get("sim"))
    if src == "crew":
        if kind == "arrived":
            facts = {"zone": ev.get("zone"), "away_min": ev.get("away_min")}
            return _event("arrived", NORMAL, text or "He came back into the room", facts, "observed",
                          "probable", ts, sim, "movement")
        if kind == "left":
            return _event("left", LOW, text or "He left the room", {"stayed_min": ev.get("stayed_min")},
                          "observed", "probable", ts, sim, "movement")
        if kind == "sedentary":
            h = re.search(r"(\d+)\s*h", text)
            m = re.search(r"(\d+)\s*min", text)
            mins = (int(h.group(1)) * 60 if h else 0) + (int(m.group(1)) if m else 0) or None
            return _event("sedentary", LOW, text, {"minutes": mins}, "observed", "probable", ts, sim, "movement")
        if kind == "aankhen_silent":
            return _event("board_disconnected", NORMAL, text or "The Aankhen board stopped sending",
                          {"board": "Aankhen board"}, "system", "sure", ts, sim, "steward")
        if kind == "aankhen_back":
            return _event("board_back", LOW, text or "The Aankhen board is sending again",
                          {"board": "Aankhen board"}, "system", "sure", ts, sim, "steward")
        return None
    if src == "limbs":
        if kind == "relay_failed":
            return _event("relay_failed", URGENT, text, {"device": ev.get("device")}, "system", "sure", ts,
                          False, "limbs")
        if kind == "board" and "disconnected" in text.lower():
            return _event("board_disconnected", URGENT, text, {"board": "relay board"}, "system", "sure", ts,
                          False, "limbs")
        if kind == "board" and "connected" in text.lower():
            return _event("board_back", LOW, text, {"board": "relay board"}, "system", "sure", ts, False, "limbs")
        if kind == "room":
            origin = str(ev.get("origin") or "")
            if origin in USER_ORIGINS or ev.get("delivered") is False:
                return None
            st = ev.get("state") or {}
            return _event("lights_changed", LOW, text, {"device": ev.get("device"),
                                                        "state": "on" if st.get("on") else "off",
                                                        "by": origin or "unknown"},
                          "system", "sure", ts, False, "limbs")
        return None
    if src == "reminders" and kind in ("due", "missed"):
        return _event("reminder_due", URGENT, text, {}, "system", "sure", ts, False, "reminders")
    return None


class Derivations:
    """Events no single agent posts, worked out from the movement watcher's state and the
    clock: a long stillness, going to bed, waking up. update() is called every few seconds
    with the watcher's data dict (crew/agents/movement.py MovementWatcher.data)."""

    def __init__(self, localtime: Callable = time.localtime):
        self.localtime = localtime
        self._still_reported_since: Optional[float] = None
        self._bed_night: Optional[str] = None        # the night (date it began) "went to bed" was said for
        self._in_bed_night = False                   # he was in bed during the night hours
        self._woke_day: Optional[str] = None
        self._off_bed_since: Optional[float] = None

    def _night_key(self, now: float) -> str:
        lt = self.localtime(now - 12 * 3600)          # 21:00-04:00 belongs to the evening's date
        return time.strftime("%Y-%m-%d", lt)

    def update(self, data: Optional[dict], now: float) -> list[dict]:
        out: list[dict] = []
        if not data or not data.get("live") or data.get("source") != "hardware":
            self._off_bed_since = None
            return out
        zone = data.get("zone") or {}
        act = data.get("activity") or {}
        z, zp, zs = zone.get("state"), zone.get("p"), zone.get("seconds") or 0
        a, ap, a_since, as_ = act.get("state"), act.get("p"), act.get("since"), act.get("seconds") or 0
        hour = self.localtime(now).tm_hour
        sure_zone = zp is None or zp >= UNSURE_P

        # long stillness (not in bed: lying still in bed is sleep, not a worry)
        if a == "still" and z in ("desk", "room") and as_ >= STILL_MIN * 60:
            if self._still_reported_since != a_since:
                self._still_reported_since = a_since
                certain = "probable" if (ap is None or ap >= UNSURE_P) and sure_zone else "unknown"
                out.append(_event("long_stillness", LOW, f"Very still {'at the desk' if z == 'desk' else 'in the room'}"
                                  f" for {int(as_ // 60)} min", {"still_min": int(as_ // 60), "zone": z},
                                  "observed", certain, now, False, "feed"))

        # bed at night
        night = hour >= 21 or hour < 4
        if z == "bed" and night:
            self._in_bed_night = True
            key = self._night_key(now)
            if zs >= BED_MIN * 60 and self._bed_night != key:
                self._bed_night = key
                out.append(_event("went_to_bed", LOW, f"On the bed for {int(zs // 60)} min at night",
                                  {"minutes": int(zs // 60)}, "observed", "probable" if sure_zone else "unknown",
                                  now, False, "feed"))
        if z == "bed" and 4 <= hour < 7:
            self._in_bed_night = True                  # still in bed before seven counts as the night

        # up in the morning
        today = time.strftime("%Y-%m-%d", self.localtime(now))
        if z in ("desk", "room") and 5 <= hour < 12 and self._in_bed_night and self._woke_day != today:
            if zs >= UP_MIN * 60:
                self._woke_day = today
                self._in_bed_night = False
                out.append(_event("woke_up", NORMAL, "Up and out of bed this morning", {},
                                  "observed", "probable" if sure_zone else "unknown", now, False, "feed"))
        if 12 <= hour < 21:                            # the afternoon: the night is over
            self._in_bed_night = False
        return out


class EventFeed:
    """The priority queue between the staff and JARVIS."""

    def __init__(self, clock: Callable[[], float] = time.time, max_queued: int = MAX_QUEUED,
                 max_age_s: float = MAX_AGE_S):
        self.clock = clock
        self.max_queued = max_queued
        self.max_age_s = max_age_s
        self._heap: list = []
        self._seq = itertools.count(1)
        self._last_kind: dict[str, float] = {}
        self.dropped: list[dict] = []                 # (stale, duplicate, overflow) for the decision log
        self.offered = 0

    def __len__(self) -> int:
        return len(self._heap)

    def offer_bus_event(self, ev: dict) -> Optional[dict]:
        fe = classify(ev)
        return self.push(fe) if fe is not None else None

    def push(self, fe: dict) -> Optional[dict]:
        now = self.clock()
        fe = dict(fe)
        if fe.get("ts") is None:
            fe["ts"] = now
        self.offered += 1
        kind = fe["kind"]
        last = self._last_kind.get(kind)
        if last is not None and now - last < COOLDOWN_S.get(kind, DEFAULT_COOLDOWN_S):
            self._drop(fe, "duplicate")
            return None
        self._last_kind[kind] = now
        fe["id"] = f"f{next(self._seq)}"
        heapq.heappush(self._heap, (-int(fe.get("priority") or 1), float(fe["ts"]), fe["id"], fe))
        while len(self._heap) > self.max_queued:
            worst = max(self._heap, key=lambda x: (x[0], x[1]))   # lowest priority, newest
            self._heap.remove(worst)
            heapq.heapify(self._heap)
            self._drop(worst[3], "overflow")
        return fe

    def pop(self) -> Optional[dict]:
        """The most important event that is still news, or None."""
        now = self.clock()
        while self._heap:
            _, ts, _, fe = heapq.heappop(self._heap)
            if now - ts > self.max_age_s:
                self._drop(fe, "stale")
                continue
            return fe
        return None

    def _drop(self, fe: dict, why: str) -> None:
        self.dropped.append({**fe, "dropped": why})
        del self.dropped[:-100]

    def take_dropped(self) -> list[dict]:
        out, self.dropped = self.dropped, []
        return out

    def peek(self) -> list[dict]:
        return [x[3] for x in sorted(self._heap)]
