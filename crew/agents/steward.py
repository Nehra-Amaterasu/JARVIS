"""Steward: keeps an eye on JARVIS's own health, so a failure comes with a reason.

On 2026-10-10 Ollama had quietly closed and every reply failed with a raw socket error;
it looked like JARVIS refusing me. Every 10 s the steward checks:

    ollama   GET /api/version answers within 0.5 s (a healthy server answers in
             milliseconds; a dead one must not hold up the other checks)
    core     JARVIS's process: running, offline, or exited with an error code
    aankhen  the hub's mode; on the real board, whether Wi-Fi packets are arriving now
             (the engine's own 2 s liveness test: the packet rate it reports is an average
             that does not fall to zero when the board goes quiet) and how fast
    errors   error lines in the transcripts in the last hour: how many, and the most
             common message (its first 80 characters)

Each check is injected (the app wires the real ones), so a test can break any of them. A
check that raises is "unknown" for that tick, which is not a problem and never stops the
other checks.

It posts an event only when a check's health CHANGES, fine to problem or back. Its first
look posts only problems: "all fine" at startup is not news. Problems come first in its
summary and in its line for JARVIS.
"""
from __future__ import annotations

import json
import threading
import time
from collections import Counter
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path
from typing import Callable, Optional

import httpx

from ..base import Agent

OLLAMA_URL = "http://127.0.0.1:11434/api/version"
OLLAMA_TIMEOUT_S = 0.5
ERROR_WINDOW_S = 3600.0
MESSAGE_CHARS = 80
NORMAL_EXIT = (None, 0, 1)       # core.py's reading: 1 is the terminate() that stops voice mode
CHECKS = ("ollama", "core", "aankhen", "errors")      # the order problems are named in
DOWN = {"ollama": "ollama_down", "core": "core_crashed", "aankhen": "aankhen_silent", "errors": "errors"}
UP = {"ollama": "ollama_up", "core": "core_back", "aankhen": "aankhen_back", "errors": "errors_cleared"}
WENT_DOWN = {"ollama": "Ollama stopped answering: replies will fail until it is back"}   # else the problem
CAME_BACK = {"ollama": "Ollama is answering again", "errors": "No errors in the last hour any more"}


_client: Optional[httpx.Client] = None
_client_lock = threading.Lock()


def ollama_answers(url: str = OLLAMA_URL, timeout: float = OLLAMA_TIMEOUT_S) -> bool:
    """True when Ollama answers its version endpoint in time.

    One client for the whole process, made at the first probe: measured on this laptop, a
    fresh httpx client per call cost 220-580 ms (it loads the CA bundle) and a reused one
    ~2 ms. A probe of this machine goes through no proxy, so the environment's is not read.
    """
    global _client
    with _client_lock:
        if _client is None:
            _client = httpx.Client(trust_env=False)
    try:
        return _client.get(url, timeout=timeout).status_code == 200
    except httpx.HTTPError:
        return False


class RecentErrors:
    """Error lines in the transcripts in the hour before `now`: (count, most common message).

    transcripts.py appends {"kind": "error", "ts", "message", ...} to the day's file. A
    file is parsed again only when its size or time changed, so a check every 10 s costs
    a stat() while nothing goes wrong.
    """

    def __init__(self, folder: Path, window_s: float = ERROR_WINDOW_S):
        self.folder = Path(folder)
        self.window_s = window_s
        self._cache: dict[Path, tuple[tuple[int, int], list[tuple[float, str]]]] = {}

    def __call__(self, now: float) -> tuple[int, Optional[str]]:
        start = now - self.window_s
        paths = sorted({self.folder / f"{datetime.fromtimestamp(t):%Y-%m-%d}.jsonl" for t in (start, now)})
        self._cache = {p: v for p, v in self._cache.items() if p in paths}   # yesterday's file drops out
        messages = [m for p in paths for ts, m in self._errors(p) if start <= ts <= now]
        if not messages:
            return 0, None
        return len(messages), Counter(m[:MESSAGE_CHARS] for m in messages).most_common(1)[0][0]

    def _errors(self, path: Path) -> list[tuple[float, str]]:
        try:
            st = path.stat()
        except FileNotFoundError:
            return []
        key = (st.st_mtime_ns, st.st_size)
        hit = self._cache.get(path)
        if hit is not None and hit[0] == key:
            return hit[1]
        found = []
        with open(path, encoding="utf-8") as f:
            for line in f:
                if '"error"' not in line:        # most lines are turns: skip them unparsed
                    continue
                try:
                    e = json.loads(line)
                except json.JSONDecodeError:
                    continue
                if isinstance(e, dict) and e.get("kind") == "error" and isinstance(e.get("ts"), (int, float)):
                    found.append((float(e["ts"]), " ".join(str(e.get("message") or "").split())))
        self._cache[path] = (key, found)
        return found


@dataclass
class Reading:
    ok: Optional[bool]                   # None: could not tell this time
    text: str                            # how it is, as JARVIS's line says it
    problem: str = ""                    # the sentence when it is not ok
    data: dict = field(default_factory=dict)


class Steward(Agent):
    id = "steward"
    name = "Steward"
    role = "keeps an eye on JARVIS's own health"
    cadence_s = 10.0

    def __init__(self, ollama: Callable[[], bool], aankhen: Callable[[], Optional[dict]],
                 errors: Callable[[float], tuple[int, Optional[str]]],
                 core: Optional[Callable[[], Optional[dict]]] = None, clock: Callable[[], float] = time.time):
        """ollama() -> it answers; aankhen() -> {"mode", "rate_hz", "rssi", "csi"} or None while
        the hub is off; errors(now) -> (count, most common message) in the last hour;
        core() -> CoreProcess.info(), or no core at all when JARVIS's process is not ours."""
        super().__init__(clock)
        self._ollama, self._aankhen, self._errors, self._core = ollama, aankhen, errors, core
        self.readings: dict[str, Reading] = {}
        self._ok: dict[str, bool] = {}           # each check's last known health
        self._since: dict[str, float] = {}       # ... and since when

    def tick(self, now: float) -> None:
        readings = {}
        for name in CHECKS:
            try:
                r = self._read(name, now)
            except Exception as e:
                r = Reading(None, f"{name} unknown (the check failed: {type(e).__name__})")
            if r is not None:
                readings[name] = r
                self._compare(name, r, now)
        self.readings = readings

    def _read(self, name: str, now: float) -> Optional[Reading]:
        if name == "ollama":
            if self._ollama():
                return Reading(True, "Ollama ok")
            return Reading(False, "Ollama not answering",
                           "Ollama isn't answering: replies will fail until it is back")
        if name == "core":
            return self._read_core()
        if name == "aankhen":
            return self._read_aankhen()
        count, top = self._errors(now)
        if not count:
            return Reading(True, "no errors in the last hour")
        what = f"{count} error{'s' if count != 1 else ''} in the last hour"
        return Reading(False, f"{what} (most often: {top})", f"{what}; most often: {top}",
                       {"count": count, "top": top})

    def _read_core(self) -> Optional[Reading]:
        info = self._core() if self._core is not None else None
        if not info:
            return None                          # no JARVIS process to watch from here
        if info.get("running"):
            mode = f" ({info['mode']})" if info.get("mode") else ""
            return Reading(True, f"JARVIS {info.get('state') or 'running'}{mode}")
        code = info.get("exit_code")
        if code in NORMAL_EXIT:
            return Reading(True, "JARVIS offline")
        return Reading(False, f"JARVIS exited with code {code}",
                       f"JARVIS exited with code {code}: he is down until he is started again",
                       {"exit_code": code})

    def _read_aankhen(self) -> Reading:
        info = self._aankhen() or {}
        mode = info.get("mode")
        if mode is None:
            return Reading(True, "Aankhen off", data={"mode": None})
        if mode == "simulation":
            return Reading(True, "Aankhen in simulation (no real room data)", data={"mode": mode})
        if mode == "replay":
            return Reading(True, "Aankhen replaying a recording", data={"mode": mode})
        rate, rssi, csi = info.get("rate_hz"), info.get("rssi"), info.get("csi")
        data = {"mode": mode, "rate_hz": rate, "rssi": rssi, "csi": csi}
        if csi == "absent":
            return Reading(True, "Aankhen board connected (no Wi-Fi link in the room layout)", data=data)
        if csi == "silent" or (csi is None and not rate):
            return Reading(False, "Aankhen board silent",
                           "The Aankhen board is sending no Wi-Fi data, so the room sensors are blind", data)
        return Reading(True, f"Aankhen live, {rate:.0f} packets/s" if rate else "Aankhen live", data=data)

    def _compare(self, name: str, r: Reading, now: float) -> None:
        if r.ok is None:
            return                               # unknown: neither a problem nor a recovery
        before = self._ok.get(name)
        if before is None:                       # the first look: only a problem is news
            if not r.ok:
                self.post(DOWN[name], r.problem, check=name, **r.data)
        elif before != r.ok:
            if r.ok:
                self.post(UP[name], CAME_BACK.get(name, f"Back to normal: {r.text}"), check=name, **r.data)
            else:
                self.post(DOWN[name], WENT_DOWN.get(name, r.problem), check=name, **r.data)
        if before != r.ok:
            self._since[name] = now
        self._ok[name] = r.ok

    def _problems(self) -> list[Reading]:
        return [self.readings[n] for n in CHECKS if n in self.readings and self.readings[n].ok is False]

    @property
    def urgent(self) -> bool:
        return bool(self._problems())

    @property
    def summary(self) -> str:
        problems = self._problems()
        if problems:
            return " ".join(r.problem + "." for r in problems)
        unknown = [n for n, r in self.readings.items() if r.ok is None]
        if unknown:
            return f"No problems seen, but I could not check {', '.join(unknown)}."
        return "All systems normal."

    def context_line(self) -> str:
        fine = [self.readings[n].text for n in ("ollama", "aankhen") if n in self.readings and self.readings[n].ok]
        problems = self._problems()
        if not problems:
            return f"Systems: {'; '.join(fine)}." if fine else ""
        line = "Systems: PROBLEM: " + "; ".join(r.text for r in problems) + "."
        return line + (f" Fine: {'; '.join(fine)}." if fine else "")

    @property
    def data(self) -> dict:
        return {"checks": {n: {"ok": r.ok, "text": r.text, "since": self._since.get(n), **r.data}
                           for n, r in self.readings.items()},
                "problems": [r.problem for r in self._problems()]}
