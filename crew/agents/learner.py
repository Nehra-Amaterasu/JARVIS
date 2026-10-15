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

MEMORY (2026-10-15): a pass imports the embedder (torch + sentence-transformers, ~400 MB of
RAM and ~700 MB of private bytes in the app). When nothing changed in the transcripts
folder since a pass that left nothing to do (every chat read by the model, none still
going), the pass is skipped, so an app started at night does not load the embedder until
there is a conversation to read. The folder's signature and that verdict are kept in
state_path, so this holds across restarts. Skipped passes count as "idle".
"""
from __future__ import annotations

import json
import time
from pathlib import Path
from typing import Callable, Optional

from ..base import Agent

START_DELAY_S = 60.0


def folder_signature(folder) -> Callable[[], Optional[list]]:
    """() -> [[name, size, mtime_ns], ...] for the files in `folder` (None when it is missing)."""
    def sig() -> Optional[list]:
        try:
            return sorted([f.name, f.stat().st_size, f.stat().st_mtime_ns] for f in Path(folder).iterdir() if f.is_file())
        except OSError:
            return None
    return sig


def nothing_left(got: dict) -> bool:
    """A pass that read every chat with the model and found nothing new to do."""
    return (not got.get("skipped") and got.get("by") == "llm+rules" and not got.get("new_turns")
            and not got.get("sessions") and not got.get("retracted"))


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
                 clock: Callable[[], float] = time.time, signature: Optional[Callable[[], Optional[list]]] = None,
                 state_path: Optional[Path] = None):
        super().__init__(clock)
        self.learn = learn
        self.started = clock()
        self.start_delay_s = start_delay_s
        self.last: Optional[dict] = None
        self.totals = {"passes": 0, "turns": 0, "learned": 0, "merged": 0, "superseded": 0}
        self.signature = signature
        self.state_path = Path(state_path) if state_path else None
        self.skipped = 0
        self._done_sig = self._load_done()

    def _load_done(self) -> Optional[list]:
        if self.state_path is None:
            return None
        try:
            return json.loads(self.state_path.read_text(encoding="utf-8")).get("done_signature")
        except (OSError, ValueError, AttributeError):
            return None

    def _save_done(self, sig: Optional[list]) -> None:
        if self.state_path is None:
            return
        try:
            self.state_path.parent.mkdir(parents=True, exist_ok=True)
            self.state_path.write_text(json.dumps({"done_signature": sig}), encoding="utf-8")
        except OSError:
            pass

    def tick(self, now: float) -> None:
        if now - self.started < self.start_delay_s:
            return
        sig = self.signature() if self.signature is not None else None
        if sig is not None and sig == self._done_sig:
            self.skipped += 1                      # nothing new since a pass that finished everything
            return
        got = self.learn() or {}
        self.last = {**got, "at": now}
        if self.signature is not None:
            done = sig if nothing_left(got) else None
            if done != self._done_sig:
                self._done_sig = done
                self._save_done(done)
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
            if self.skipped:
                return "Every chat is already read; waiting for a new one."
            return "Waiting to read your chats."
        t = self.totals
        return (f"{t['turns']} turns indexed, {t['learned']} memories learned, {t['superseded']} replaced "
                f"since the app started.")

    @property
    def data(self) -> dict:
        return {"totals": dict(self.totals), "last": dict(self.last or {}), "skipped_unchanged": self.skipped}
