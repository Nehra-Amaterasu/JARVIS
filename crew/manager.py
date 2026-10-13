"""Crew: runs every agent at its cadence; what the API and JARVIS read.

Each agent gets its own daemon thread. One scheduler thread would do for three agents,
but then the slowest tick delays all the others: the ledger reading a month of
transcripts, or the steward waiting out its 0.5 s on an Ollama that is down, would hold
up the movement watcher's half-second beat. Threads that mostly sleep cost nothing here.

A tick that raises is recorded in that agent's health (Agent.run catches it) and its loop
goes on. A tick that overruns its cadence is not caught up with a burst: the next one
comes a full cadence after the late one ended.

context() is the block JARVIS reads before he replies: a header saying these are
estimates, then each agent's line, problems first, at most 600 characters (~150 tokens
on a 4B model whose prefill is the wait he hears). A line from an agent whose last tick
failed is left out: it would be stale, said as if current.
"""
from __future__ import annotations

import threading
import time
from typing import Optional

from .base import Agent, clip
from .board import Blackboard

CONTEXT_HEADER = "YOUR STAFF (live agents; estimates, not certainties):"
CONTEXT_MAX = 600
SHORTEST_CLIPPED_LINE = 40       # a line cut shorter than this says nothing; it is dropped
EVENTS_SHOWN = 40                # GET /api/crew


class Crew:
    def __init__(self, agents: list[Agent], board: Optional[Blackboard] = None):
        ids = [a.id for a in agents]
        if len(set(ids)) != len(ids):
            raise ValueError(f"agent ids must be unique: {ids}")
        self.board = board or Blackboard()
        self.agents = list(agents)
        self._by_id = {a.id: a for a in agents}
        for a in agents:
            a.board = self.board
        self._threads: list[threading.Thread] = []
        self._stop = threading.Event()
        self._lock = threading.Lock()

    # ------------------------------------------------------------ lifecycle
    @property
    def running(self) -> bool:
        return any(t.is_alive() for t in self._threads)

    def start(self) -> None:
        """Start every agent's loop; its first tick is at once. A second start is a no-op."""
        with self._lock:
            if self.running:
                return
            self._stop = threading.Event()
            self._threads = []
            for a in self.agents:
                a.scheduled = True
                t = threading.Thread(target=self._loop, args=(a, self._stop), name=f"crew-{a.id}", daemon=True)
                self._threads.append(t)
                t.start()

    def stop(self, timeout: float = 2.0) -> None:
        """Stop every loop, waiting up to `timeout` for a tick in progress. Idempotent."""
        with self._lock:
            self._stop.set()
            for a in self.agents:
                a.scheduled = False
            deadline = time.monotonic() + timeout
            for t in self._threads:
                t.join(max(0.0, deadline - time.monotonic()))
            self._threads = []

    @staticmethod
    def _loop(agent: Agent, stop: threading.Event) -> None:
        due = time.monotonic()
        while not stop.is_set():
            agent.run()
            due += agent.cadence_s
            now = time.monotonic()
            if due < now:                        # the tick overran: no catch-up burst
                due = now + agent.cadence_s
            stop.wait(due - now)

    # ------------------------------------------------------------ reading
    def agent(self, agent_id: str) -> Agent:
        """The agent with this id (KeyError if there is none)."""
        return self._by_id[agent_id]

    def run_now(self, agent_id: str) -> dict:
        """One tick of that agent now, outside its schedule; its entry afterwards."""
        a = self.agent(agent_id)
        a.run()
        return self.entry(a)

    def entry(self, a: Agent) -> dict:
        snap = self.board.state(a.id) or {}
        return {"id": a.id, "name": a.name, "role": a.role, "state": a.state,
                "summary": snap.get("summary") or "No reading yet.",
                "data": snap.get("data") or {},
                "health": a.health.to_dict(a.cadence_s)}

    def status(self) -> dict:
        return {"agents": [self.entry(a) for a in self.agents], "events": self.board.recent(EVENTS_SHOWN)}

    def _current(self) -> list[tuple[Agent, dict]]:
        """(agent, snapshot) for agents whose last tick worked, in crew order."""
        out = []
        for a in self.agents:
            snap = self.board.state(a.id)
            if snap is not None and not a.health.failing:
                out.append((a, snap))
        return out

    def lines(self) -> dict[str, str]:
        """Every agent's line for JARVIS ("" when it has nothing to say, or its last tick failed)."""
        got = {a.id: snap.get("context") or "" for a, snap in self._current()}
        return {a.id: got.get(a.id, "") for a in self.agents}

    def live(self) -> list[str]:
        """Agents whose line reports fresh readings from real sensors."""
        return [a.id for a, snap in self._current() if snap.get("live") and snap.get("context")]

    def context(self) -> str:
        """The block for JARVIS's prompt, or "" when no agent has anything to say."""
        snaps = [snap for _, snap in self._current() if snap.get("context")]
        snaps.sort(key=lambda s: not s.get("urgent"))           # stable: problems first, then crew order
        text = CONTEXT_HEADER
        for snap in snaps:
            line = snap["context"]
            room = CONTEXT_MAX - len(text) - 1
            if len(line) > room:
                if room < SHORTEST_CLIPPED_LINE:
                    break
                line = clip(line, room)
            text += "\n" + line
        return "" if text == CONTEXT_HEADER else text
