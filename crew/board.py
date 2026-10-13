"""The blackboard: where the crew writes what it knows, and JARVIS and the app read it.

Two things live here:
  - each agent's latest STATE: its summary, UI data and context line as of its last tick,
    replaced whole every time, so a reader never sees half an update;
  - a ring of EVENTS, the last 300: {id, ts, agent, kind, text, data}. Ids keep rising for
    the board's whole life, so a client polling since(last_id) never misses or repeats an
    event while the ring still holds it.

A notable event is also handed to the sink (in the app: the bus, so the ticker shows it).
Routine events (typing started, walking) stay on the board, and states never go to the
sink: they change every tick, and the bus is for news, not heartbeats.

Agents write from their own threads while the API reads from the server's, so all of it
sits behind one lock. The sink is called outside the lock, so a slow sink never holds up
another agent's write.
"""
from __future__ import annotations

import itertools
import threading
import time
from collections import deque
from typing import Callable, Optional

EVENTS_KEPT = 300


class Blackboard:
    def __init__(self, sink: Optional[Callable[[dict], None]] = None, maxlen: int = EVENTS_KEPT,
                 clock: Callable[[], float] = time.time):
        self.sink = sink
        self.clock = clock
        self._events: deque[dict] = deque(maxlen=maxlen)
        self._states: dict[str, dict] = {}
        self._ids = itertools.count(1)
        self._lock = threading.Lock()

    def post(self, agent: str, kind: str, text: str, data: Optional[dict] = None, notable: bool = True,
             ts: Optional[float] = None) -> dict:
        """Add an event (stamped `ts`, else now) and, when notable, hand it to the sink."""
        with self._lock:
            ev = {"id": next(self._ids), "ts": self.clock() if ts is None else ts, "agent": agent,
                  "kind": kind, "text": text, "data": dict(data or {})}
            self._events.append(ev)
        if notable and self.sink is not None:
            try:
                self.sink(ev)
            except Exception:
                pass            # the sink's problem (a closed bus), never the agent's
        return ev

    def set_state(self, agent: str, state: dict) -> None:
        with self._lock:
            self._states[agent] = state

    def state(self, agent: str) -> Optional[dict]:
        with self._lock:
            return self._states.get(agent)

    def since(self, event_id: int) -> list[dict]:
        """Events newer than `event_id`, oldest first (0: everything still kept)."""
        with self._lock:
            return [e for e in self._events if e["id"] > event_id]

    def recent(self, n: int) -> list[dict]:
        """The last `n` events, oldest first."""
        with self._lock:
            return list(self._events)[-n:] if n > 0 else []
