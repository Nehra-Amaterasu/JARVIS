"""Chat learner: reads JARVIS's finished conversations and keeps what matters.

The crew's job for Yaadash's feedback loop (yaadash/learn_chats.py does the work). Every
two minutes it runs one pass: new transcript lines are indexed at once (cheap, CPU), and a
chat that has been quiet for ten minutes is read over: by the local model when Ollama is
up and nobody is talking, by the rules otherwise. Its first tick waits START_DELAY_S after
the app starts, so loading the embedder never competes with JARVIS's own start-up; that
tick then catches up on anything missed while the app was closed.

The pass is injected (learn), so a test runs it with a fake. It posts an event only when a
pass learned or replaced something. It adds no line to JARVIS's prompt: what it learns
reaches him through chat_memory.py, not through the staff block.

PRIVACY: counts only. No memory text and no conversation text goes onto the board.
"""
from __future__ import annotations

import time
from typing import Callable, Optional

from ..base import Agent

START_DELAY_S = 60.0


def default_learn(transcripts=None) -> Callable[[], dict]:
    """The real pass, imported on first use (it loads the embedder: seconds, not at app start)."""
    def learn() -> dict:
        import learn_chats
        import yaadash_v2  # noqa: F401  the embedder chat_memory reads through
        return learn_chats.run(transcripts=transcripts)
    return learn


class ChatLearner(Agent):
    id = "learner"
    name = "Chat learner"
    role = "reads your finished chats with JARVIS and keeps facts, corrections, instructions and what you liked"
    cadence_s = 120.0

    def __init__(self, learn: Callable[[], dict], start_delay_s: float = START_DELAY_S,
                 clock: Callable[[], float] = time.time):
        super().__init__(clock)
        self.learn = learn
        self.started = clock()
        self.start_delay_s = start_delay_s
        self.last: Optional[dict] = None
        self.totals = {"passes": 0, "turns": 0, "learned": 0, "merged": 0, "superseded": 0}

    def tick(self, now: float) -> None:
        if now - self.started < self.start_delay_s:
            return
        got = self.learn() or {}
        self.last = {**got, "at": now}
        if got.get("skipped"):
            return
        self.totals["passes"] += 1
        self.totals["turns"] += int(got.get("new_turns") or 0)
        self.totals["learned"] += int(got.get("added") or 0)
        self.totals["merged"] += int(got.get("merged") or 0)
        self.totals["superseded"] += int(got.get("superseded") or 0)
        if got.get("added") or got.get("superseded"):
            self.post("learned", f"Read {got.get('sessions', 0)} finished chat(s): {got.get('added', 0)} new "
                                 f"memories, {got.get('superseded', 0)} replaced ({got.get('by', 'rules')}).",
                      added=int(got.get("added") or 0), superseded=int(got.get("superseded") or 0),
                      by=str(got.get("by") or "rules"))

    @property
    def idle(self) -> bool:
        return self.last is None

    @property
    def summary(self) -> str:
        if self.last is None:
            return "Waiting to read your chats."
        t = self.totals
        return (f"{t['turns']} turns indexed, {t['learned']} memories learned, {t['superseded']} replaced "
                f"since the app started.")

    @property
    def data(self) -> dict:
        return {"totals": dict(self.totals), "last": dict(self.last or {})}
