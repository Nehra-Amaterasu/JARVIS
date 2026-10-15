"""The microphone JARVIS listens on, and the watchdog that keeps it alive overnight.

Two ways the wake loop used to go deaf with nothing in the log (feature inventory 5.2,
risk 2): the stream stops delivering blocks (a driver reset, resume from standby, a USB
mic unplugged) and the loop waits on `q.get(timeout=0.1)` forever; or Windows switches
the DEFAULT input to a Bluetooth headset's hands-free mic when the headset connects, and
every stream opened with device=None follows it.

So:
  - The mic is PINNED by name: settings "mic": {"name": "<part of its name>"}; when that is
    unset, the default input at JARVIS's start is pinned for the session. A headset that
    becomes the Windows default later does not move him.
  - MicWatchdog: no block for STALL_S -> reopen. Reopening refreshes PortAudio's device
    list (it is read once at start-up) and finds the pinned mic again by name, so a mic
    that came back under a new index is found.
  - A heartbeat every HEARTBEAT_S (the app's health line shows "mic alive").

PortAudio lists one microphone once per host API (MME, DirectSound, WASAPI, WDM-KS).
pick_device() prefers the host API of the default input, which is what JARVIS always
opened before (device=None), so the audio path is unchanged.
"""
from __future__ import annotations

import time
from typing import Callable, Optional

STALL_S = 5.0                    # no audio block for this long: the stream is dead
HEARTBEAT_S = 60.0


def _norm(name: str) -> str:
    return " ".join(str(name or "").lower().split())


def pick_device(devices: list[dict], wanted: Optional[str], default_index: Optional[int]) -> tuple[Optional[int], str]:
    """(index, name) of the input device to open. `devices` is sd.query_devices() as dicts.

    wanted set: the first input device whose name contains it (case-insensitive), on the
    default input's host API when there is one there. No match, or wanted unset: the
    default input. (None, "") when there is no input device at all."""
    inputs = [(i, d) for i, d in enumerate(devices) if int(d.get("max_input_channels") or 0) > 0]
    if not inputs:
        return None, ""
    default = devices[default_index] if default_index is not None and 0 <= default_index < len(devices) else None
    if default is not None and int(default.get("max_input_channels") or 0) <= 0:
        default = None
    if wanted and _norm(wanted):
        w = _norm(wanted)
        hits = [(i, d) for i, d in inputs if w in _norm(d.get("name")) or _norm(d.get("name")) in w]
        if hits:
            if default is not None:
                same = [(i, d) for i, d in hits if d.get("hostapi") == default.get("hostapi")]
                if same:
                    hits = same
            i, d = hits[0]
            return i, str(d.get("name"))
    if default is not None:
        return default_index, str(default.get("name"))
    i, d = inputs[0]
    return i, str(d.get("name"))


class MicWatchdog:
    """Fed once per audio block; says when the stream must be reopened and when a
    heartbeat is due. All times come from `clock` (tests drive it)."""

    def __init__(self, stall_s: float = STALL_S, heartbeat_s: float = HEARTBEAT_S,
                 clock: Callable[[], float] = time.monotonic):
        self.stall_s, self.heartbeat_s, self.clock = stall_s, heartbeat_s, clock
        self.opened_at: Optional[float] = None
        self.last_block: Optional[float] = None
        self.blocks = 0
        self.reopens = 0
        self.last_reason: Optional[str] = None
        self._peak = 0.0
        self._beat_at: Optional[float] = None

    def opened(self) -> None:
        now = self.clock()
        self.opened_at, self.last_block = now, None
        if self._beat_at is None:
            self._beat_at = now

    def block(self, peak: float = 0.0) -> None:
        self.last_block = self.clock()
        self.blocks += 1
        if peak > self._peak:
            self._peak = peak

    def stalled(self) -> bool:
        """True when no block has arrived for stall_s (counted from the open if none ever did)."""
        if self.opened_at is None:
            return False
        ref = self.last_block if self.last_block is not None else self.opened_at
        return self.clock() - ref >= self.stall_s

    def reopened(self, reason: str) -> None:
        self.reopens += 1
        self.last_reason = reason

    def heartbeat(self) -> Optional[dict]:
        """A status dict once per heartbeat_s (else None); the peak level resets each time."""
        now = self.clock()
        if self._beat_at is None or now - self._beat_at < self.heartbeat_s:
            return None
        self._beat_at = now
        out = {"alive": not self.stalled(), "blocks": self.blocks, "reopens": self.reopens,
               "peak": round(self._peak, 4), "last_reason": self.last_reason}
        self._peak = 0.0
        return out


class Mic:
    """The pinned microphone: resolve() it (refreshing PortAudio when asked) and open
    streams on it. `sd` is the sounddevice module (a fake in tests)."""

    def __init__(self, sd, wanted: Callable[[], Optional[str]] = lambda: None, log: Callable[[str], None] = print):
        self.sd = sd
        self.wanted = wanted
        self.log = log
        self.index: Optional[int] = None
        self.name = ""
        self.pinned: Optional[str] = None       # the name this session keeps to

    def _default_input(self) -> Optional[int]:
        """The default input's index. sounddevice's query_devices(kind="input") resolves it
        (sd.default.device is a pair-like object, often -1 meaning "the host's default")."""
        try:
            idx = int(self.sd.query_devices(kind="input")["index"])
            if idx >= 0:
                return idx
        except Exception:
            pass
        try:
            idx = int(self.sd.default.device[0])
            return idx if idx >= 0 else None
        except Exception:
            return None

    def resolve(self, refresh: bool = False) -> tuple[Optional[int], str]:
        if refresh:
            try:                                  # PortAudio reads the device list once; read it again
                self.sd._terminate()
                self.sd._initialize()
            except Exception as e:
                self.log(f"[mic] could not refresh the device list: {e}")
        try:
            devices = [dict(d) for d in self.sd.query_devices()]
        except Exception as e:
            self.log(f"[mic] could not list devices: {e}")
            return None, ""
        wanted = (self.wanted() or "").strip() or self.pinned
        idx, name = pick_device(devices, wanted, self._default_input())
        if self.pinned is None and name:
            self.pinned = name                    # the default at start becomes this session's mic
        if (idx, name) != (self.index, self.name):
            self.log(f"[mic] listening on: {name or 'no input device'}" + (f" (#{idx})" if idx is not None else ""))
        self.index, self.name = idx, name
        return idx, name

    def device(self) -> Optional[int]:
        if self.index is None and not self.name:
            self.resolve()
        return self.index
