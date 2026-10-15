"""Restart budget: how long to wait before bringing something back, and when to stop.

Shared by the voice core's supervisor (core.py: the app restarts jarvis.py when it exits
on its own) and the login watchdog (app/watchdog.pyw: restarts the whole app). No
imports beyond the standard library, so the watchdog stays tiny.

    delays        the wait before the 1st, 2nd, 3rd ... restart in a row (the last repeats)
    max_per_hour  restarts allowed in any rolling hour; past it, next_delay() is None
    healthy_s     a run that lasted this long resets the "in a row" count
"""
from __future__ import annotations

import time
from collections import deque
from typing import Callable, Optional, Sequence


class RestartBudget:
    def __init__(self, delays: Sequence[float] = (5, 15, 60, 300), max_per_hour: int = 5,
                 healthy_s: float = 600.0, clock: Callable[[], float] = time.time):
        self.delays = tuple(float(d) for d in delays) or (5.0,)
        self.max_per_hour = int(max_per_hour)
        self.healthy_s = float(healthy_s)
        self.clock = clock
        self.in_a_row = 0
        self.history: deque[float] = deque()          # when each restart was granted

    def _trim(self, now: float) -> None:
        while self.history and now - self.history[0] >= 3600:
            self.history.popleft()

    def used_last_hour(self) -> int:
        self._trim(self.clock())
        return len(self.history)

    def next_delay(self, ran_for_s: Optional[float]) -> Optional[float]:
        """The wait before the next restart, after a run that lasted ran_for_s (None:
        unknown), or None when the hourly budget is spent. Granting it counts it."""
        now = self.clock()
        self._trim(now)
        if ran_for_s is not None and ran_for_s >= self.healthy_s:
            self.in_a_row = 0
        if len(self.history) >= self.max_per_hour:
            return None
        delay = self.delays[min(self.in_a_row, len(self.delays) - 1)]
        self.in_a_row += 1
        self.history.append(now)
        return delay

    def wait_until_allowed(self) -> float:
        """Seconds until the oldest restart in the window leaves it (0 when allowed now)."""
        now = self.clock()
        self._trim(now)
        if len(self.history) < self.max_per_hour:
            return 0.0
        return max(0.0, 3600 - (now - self.history[0]))

    def reset(self) -> None:
        self.in_a_row = 0
