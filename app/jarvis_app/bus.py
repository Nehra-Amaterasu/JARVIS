"""The event bus: one stream of "what just happened", for every tab.

Subsystems publish from any thread (the JARVIS process reader, the Aankhen
engine, request handlers); WebSocket clients receive each event once, in order.
A short history is replayed to a client that connects late, so the ticker isn't
empty after a window reload.

Events marked `ephemeral` (the microphone level at ~12 Hz) are delivered live but
never kept in history — replaying stale mic levels would be meaningless.
"""
from __future__ import annotations

import asyncio
import itertools
import threading
import time
from collections import deque
from typing import Optional


class EventBus:
    def __init__(self, history: int = 300):
        self._history: deque = deque(maxlen=history)
        self._subscribers: set[asyncio.Queue] = set()
        self._loop: Optional[asyncio.AbstractEventLoop] = None
        self._ids = itertools.count(1)
        self._lock = threading.Lock()

    def bind(self, loop: asyncio.AbstractEventLoop) -> None:
        self._loop = loop

    def publish(self, source: str, kind: str, text: str = "", ephemeral: bool = False, **data) -> dict:
        ev = {"id": next(self._ids), "ts": time.time(), "source": source, "kind": kind,
              "text": text, **data}
        if not ephemeral:
            with self._lock:
                self._history.append(ev)
        loop = self._loop
        if loop is not None and not loop.is_closed():
            loop.call_soon_threadsafe(self._fanout, ev)
        return ev

    def _fanout(self, ev: dict) -> None:
        for q in list(self._subscribers):
            if q.qsize() > 500:            # a stuck client loses events, never the bus
                continue
            q.put_nowait(ev)

    def history(self, n: int = 100) -> list[dict]:
        with self._lock:
            return list(self._history)[-n:]

    def subscribe(self) -> asyncio.Queue:
        q: asyncio.Queue = asyncio.Queue()
        self._subscribers.add(q)
        return q

    def unsubscribe(self, q: asyncio.Queue) -> None:
        self._subscribers.discard(q)
