"""Agent: one recurring job, done all the time, by cheap deterministic code.

A subclass sets id, name, role (one line) and cadence_s, and implements tick(now). After
every tick its view goes onto the blackboard as one snapshot:

    summary       one human sentence for the app ("You've been at the desk for 25 min.")
    data          a dict for the agent's card in the UI
    context       context_line(): at most 200 characters for JARVIS's prompt, or "" when
                  nothing is worth his attention (every character is prefill time)
    live          the line reports fresh readings from real sensors, so JARVIS may treat
                  it as evidence, not just as something he was told
    urgent        the line reports a problem; the crew puts it first

run() is how a tick is called: timed, counted and serialised (the scheduler and a "run
now" from the API never tick one agent twice at once). An exception is recorded in
health instead of raised, so one bad tick never ends an agent's loop; the last good
snapshot stays on the board.

state: "off" (the crew is not running it), "error" (its last tick raised), "idle"
(nothing to work on: no live board, no conversations, no tick yet) or "running".
"""
from __future__ import annotations

import threading
import time
from collections import deque
from typing import Callable, Optional

from .board import Blackboard

CONTEXT_MAX = 200                # characters of one agent's line in JARVIS's prompt
TICKS_AVERAGED = 50              # avg_ms is over this many ticks


def clip(text: str, limit: int) -> str:
    """At most `limit` characters, cut at a word with an ellipsis rather than mid-word."""
    text = " ".join(text.split())
    if len(text) <= limit:
        return text
    head = text[:limit - 1]
    if " " in head:
        head = head[:head.rfind(" ")]
    return head.rstrip(" ,;:") + "…"


class Health:
    def __init__(self):
        self.runs = 0
        self.errors = 0
        self.last_error: Optional[str] = None
        self.last_tick: Optional[float] = None
        self.failing = False                     # the last tick raised
        self.avg_ms: Optional[float] = None
        self._ms: deque[float] = deque(maxlen=TICKS_AVERAGED)

    def record(self, now: float, ms: float, error: Optional[str]) -> None:
        self.runs += 1
        self.last_tick = now
        self._ms.append(ms)
        self.avg_ms = round(sum(self._ms) / len(self._ms), 3)
        self.failing = error is not None
        if error is not None:
            self.errors += 1
            self.last_error = error

    def to_dict(self, cadence_s: float) -> dict:
        return {"runs": self.runs, "errors": self.errors, "last_error": self.last_error,
                "avg_ms": self.avg_ms, "last_tick": self.last_tick, "cadence_s": cadence_s}


class Agent:
    id: str = ""
    name: str = ""
    role: str = ""
    cadence_s: float = 1.0

    def __init__(self, clock: Callable[[], float] = time.time):
        self.clock = clock
        self.board = Blackboard()                # the crew hands every agent the shared one
        self.health = Health()
        self.scheduled = False                   # set by the crew while it runs this agent
        self.now = clock()                       # the time of the current (or last) tick
        self._tick_lock = threading.Lock()

    # ------------------------------------------------------------ what a subclass provides
    def tick(self, now: float) -> None:
        raise NotImplementedError

    @property
    def summary(self) -> str:
        return ""

    @property
    def data(self) -> dict:
        return {}

    def context_line(self) -> str:
        return ""

    @property
    def idle(self) -> bool:
        return False

    @property
    def live(self) -> bool:
        return False

    @property
    def urgent(self) -> bool:
        return False

    # ------------------------------------------------------------ what every agent gets
    @property
    def state(self) -> str:
        if not self.scheduled:
            return "off"
        if self.health.failing:
            return "error"
        if self.health.runs == 0 or self.idle:
            return "idle"
        return "running"

    def post(self, kind: str, text: str, notable: bool = True, **data) -> dict:
        """An event on the board, stamped with this tick's time; `data` holds its tags."""
        return self.board.post(self.id, kind, text, data, notable=notable, ts=self.now)

    def run(self, now: Optional[float] = None) -> bool:
        """One tick and its bookkeeping. Returns False when the tick raised."""
        with self._tick_lock:
            self.now = self.clock() if now is None else now
            t0 = time.perf_counter()
            error = None
            try:
                self.tick(self.now)
                snapshot = {"ts": self.now, "summary": self.summary, "data": self.data,
                            "context": clip(self.context_line(), CONTEXT_MAX),
                            "live": self.live, "urgent": self.urgent}
            except Exception as e:
                error = f"{type(e).__name__}: {e}"[:300]
            self.health.record(self.now, (time.perf_counter() - t0) * 1000.0, error)
            if error is None:
                self.board.set_state(self.id, snapshot)
            return error is None
