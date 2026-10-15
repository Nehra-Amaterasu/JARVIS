"""Free teachers: weak labels from Aman's own devices, logged continuously by the hub.

WHAT IS LOGGED (counts and booleans only, never content)
  - laptop input: seconds since the last input (Windows GetLastInputInfo), and over each
    10 s line the number of input changes and of mouse moves (GetCursorPos). The
    difference is "key or click" activity. No key is ever read: GetLastInputInfo says
    THAT something was pressed, not WHAT.
  - phone on home Wi-Fi: optional, from data/aankhen/teachers.json {"phone_ip": "...",
    "phone_mac": "..."}: the ARP table (no packet sent) or one ping. Without a config the
    field is null, never a guess.
  - JARVIS voice turns and relay changes: counted from what the app tells the hub
    (note_voice_turn / note_relay).
  - time of day: hour and weekday on every line.

  One line every 10 s to data/aankhen/teachers/YYYY-MM-DD.jsonl (git-ignored).

WHAT THEY TEACH (hints the belief and the recalibrator use; see belief.py, recal.py)
  typing  input in the last 5 s, not just the mouse    -> at the desk chair, typing
  away    phone off home Wi-Fi 10+ min AND laptop idle 10+ min  -> room empty
          (the only windows the daily empty-room recalibration may use)
"""
from __future__ import annotations

import json
import os
import re
import subprocess
import threading
import time
from typing import Callable, Optional

from . import DATA_DIR

TEACHERS_DIR = os.path.join(DATA_DIR, "teachers")
CONFIG_FILE = os.path.join(DATA_DIR, "teachers.json")
LINE_EVERY_S = 10.0
POLL_S = 0.2
TYPING_RECENT_S = 5.0
AWAY_AFTER_S = 600.0
PHONE_EVERY_S = 30.0


# ---------------------------------------------------------------- probes (Windows)
def _win_idle_and_cursor() -> tuple[Optional[float], Optional[tuple]]:
    """(seconds since the last keyboard/mouse input, cursor position). None off Windows."""
    if os.name != "nt":
        return None, None
    import ctypes
    from ctypes import wintypes

    class LASTINPUTINFO(ctypes.Structure):
        _fields_ = [("cbSize", wintypes.UINT), ("dwTime", wintypes.DWORD)]
    li = LASTINPUTINFO()
    li.cbSize = ctypes.sizeof(LASTINPUTINFO)
    idle = None
    if ctypes.windll.user32.GetLastInputInfo(ctypes.byref(li)):
        idle = ((ctypes.windll.kernel32.GetTickCount() - li.dwTime) & 0xFFFFFFFF) / 1000.0
    pt = wintypes.POINT()
    cur = (pt.x, pt.y) if ctypes.windll.user32.GetCursorPos(ctypes.byref(pt)) else None
    return idle, cur


def _norm_mac(m: str) -> str:
    return re.sub(r"[^0-9a-f]", "", m.lower())


def phone_on_wifi(ip: Optional[str], mac: Optional[str], run: Callable = subprocess.run) -> Optional[bool]:
    """Is the phone on the home network? The ARP table first (no packet sent); then one
    ping to the configured IP. None when nothing is configured."""
    if not ip and not mac:
        return None
    try:
        if ip:
            r = run(["ping", "-n" if os.name == "nt" else "-c", "1", "-w" if os.name == "nt" else "-W",
                     "800" if os.name == "nt" else "1", ip], capture_output=True, text=True, timeout=5)
            if r.returncode == 0 and "unreachable" not in (r.stdout or "").lower():
                return True
        r = run(["arp", "-a"], capture_output=True, text=True, timeout=5)
        table = r.stdout or ""
        if mac and _norm_mac(mac) in _norm_mac(table):
            # the ARP entry outlives the phone by minutes: only a ping is proof when an IP is known
            return True if not ip else False
        return False
    except (OSError, subprocess.SubprocessError):
        return None


def load_config(path: str = CONFIG_FILE) -> dict:
    try:
        with open(path, encoding="utf-8") as f:
            d = json.load(f)
        return {k: d.get(k) for k in ("phone_ip", "phone_mac")}
    except (OSError, ValueError):
        return {}


# ---------------------------------------------------------------- the logger
class FreeTeachers:
    def __init__(self, folder: str = TEACHERS_DIR, config: Optional[dict] = None,
                 clock: Callable[[], float] = time.time,
                 probe: Callable = _win_idle_and_cursor, phone: Callable = phone_on_wifi,
                 write_lines: bool = True):
        self.folder = folder
        self.write_lines = write_lines
        self.config = config if config is not None else load_config()
        self.clock, self.probe, self.phone = clock, probe, phone
        self.lock = threading.Lock()
        self._stop = threading.Event()
        self._thread: Optional[threading.Thread] = None
        self._reset_counts()
        self._last_idle: Optional[float] = None       # the moment of the last input (clock)
        self._last_cursor = None
        self.idle_s: Optional[float] = None
        self.last_key_at: Optional[float] = None     # last input that was not a mouse move
        self.phone_home: Optional[bool] = None
        self.phone_gone_since: Optional[float] = None
        self._phone_at = float("-inf")
        self.relay: dict = {}
        self.lines = 0

    def _reset_counts(self) -> None:
        self.counts = {"input_events": 0, "mouse_moves": 0, "keyish_events": 0, "voice_turns": 0,
                       "relay_changes": 0}

    # -------------------------------------------------------- feeding
    def note_voice_turn(self) -> None:
        with self.lock:
            self.counts["voice_turns"] += 1

    def note_relay(self, device: str, on: Optional[bool]) -> None:
        with self.lock:
            if self.relay.get(device) is not None and self.relay.get(device) != on:
                self.counts["relay_changes"] += 1
            self.relay[device] = on

    def poll(self) -> None:
        """One look at the input clock and the cursor (called every POLL_S)."""
        idle, cur = self.probe()
        now = self.clock()
        with self.lock:
            if idle is not None:
                # A new input moved the "last input" moment (now - idle) forward. Inputs
                # closer together than one poll count once: a rate, not a key log.
                last_input_at = now - idle
                if self._last_idle is not None and last_input_at > self._last_idle + 0.05:
                    self.counts["input_events"] += 1
                    moved = cur is not None and self._last_cursor is not None and cur != self._last_cursor
                    if moved:
                        self.counts["mouse_moves"] += 1
                    else:
                        self.counts["keyish_events"] += 1
                        self.last_key_at = now
                self._last_idle = last_input_at
                self.idle_s = idle
            self._last_cursor = cur

    def poll_phone(self) -> None:
        now = self.clock()
        if now - self._phone_at < PHONE_EVERY_S:
            return
        self._phone_at = now
        home = self.phone(self.config.get("phone_ip"), self.config.get("phone_mac"))
        with self.lock:
            self.phone_home = home
            if home is False:
                if self.phone_gone_since is None:
                    self.phone_gone_since = now
            else:
                self.phone_gone_since = None

    # -------------------------------------------------------- reading
    def hint(self) -> dict:
        """What the teachers say right now (belief.py reads "typing" and "away")."""
        now = self.clock()
        with self.lock:
            typing = self.last_key_at is not None and now - self.last_key_at <= TYPING_RECENT_S
            away = (self.phone_gone_since is not None and now - self.phone_gone_since >= AWAY_AFTER_S
                    and self.idle_s is not None and self.idle_s >= AWAY_AFTER_S)
            return {"at": now, "typing": bool(typing), "away": bool(away), "idle_s": self.idle_s,
                    "phone_home": self.phone_home}

    def line(self) -> dict:
        now = self.clock()
        h = self.hint()
        lt = time.localtime(now)
        with self.lock:
            d = {"t": round(now, 2), "iso": time.strftime("%Y-%m-%dT%H:%M:%S", lt), "hour": lt.tm_hour,
                 "weekday": lt.tm_wday, "idle_s": None if self.idle_s is None else round(self.idle_s, 1),
                 **self.counts, "phone_home": self.phone_home,
                 "phone_gone_s": None if self.phone_gone_since is None else round(now - self.phone_gone_since),
                 "relay": dict(self.relay), "typing": h["typing"], "away": h["away"]}
            self._reset_counts()
        return d

    def write_line(self) -> str:
        d = self.line()
        os.makedirs(self.folder, exist_ok=True)
        path = os.path.join(self.folder, time.strftime("%Y-%m-%d", time.localtime(d["t"])) + ".jsonl")
        with open(path, "a", encoding="utf-8") as f:
            f.write(json.dumps(d) + "\n")
        self.lines += 1
        return path

    # -------------------------------------------------------- thread
    def start(self) -> "FreeTeachers":
        if self._thread is not None and self._thread.is_alive():
            return self
        self._stop.clear()
        self._thread = threading.Thread(target=self._run, name="aankhen-teachers", daemon=True)
        self._thread.start()
        return self

    def stop(self) -> None:
        self._stop.set()
        t = self._thread
        if t is not None and t is not threading.current_thread():
            t.join(timeout=3)
        self._thread = None

    @property
    def running(self) -> bool:
        return self._thread is not None and self._thread.is_alive()

    def _run(self) -> None:
        next_line = self.clock() + LINE_EVERY_S
        while not self._stop.is_set():
            try:
                self.poll()
                if self.write_lines:
                    self.poll_phone()
                if self.write_lines and self.clock() >= next_line:
                    self.write_line()
                    next_line = self.clock() + LINE_EVERY_S
            except Exception:
                pass                                 # a teacher must never take the hub down
            self._stop.wait(POLL_S)


def enabled() -> bool:
    return os.environ.get("AANKHEN_TEACHERS", "1") != "0"
