"""Presence brings the room back: after the app starts, light and fan on when he is there.

Opening COM8 resets the Uno, so every app start leaves the relays OFF (uno.py). Aman's
brief (2026-10-15): when the app comes online and he is in the room, the light and the
fan come back on. This rule runs ONCE per app start, right after the Uno is adopted:

  1. Guards first, each one logged:
       disabled in settings                     -> nothing
       quiet hours (default 00:30-07:00)        -> nothing (he may be asleep: a mains
                                                   light switching on would wake him)
       any manual relay command since start     -> nothing (his choice wins), also
                                                   checked again just before acting
  2. Then it watches for up to `window_min` minutes for evidence that he is here:
       laptop keyboard or mouse input in the last `input_s` (120 s): he is at the desk
         (Windows GetLastInputInfo, read-only);
       or Aankhen's learned model saying occupied, occupied_p >= 0.8, held for
         `sustain_s` (20 s), on the REAL board (frame source "hardware"; never the
         simulator, never a replay).
  3. On evidence: the last mode he chose (modes.json "last"), or light + fan on when
     that mode would switch nothing on, through Limbs (the single relay writer, origin
     "presence"). JARVIS says "Welcome back, sir: light and fan on." when he is
     running, and the line goes on the event bus either way.

Every decision, acted or not, is one "limbs"/"presence_on" event with its reason.
Settings live in DATA/presence_on.json (GET/POST /api/limbs/presence-on).
"""
from __future__ import annotations

import ctypes
import json
import sys
import threading
import time
from datetime import datetime
from pathlib import Path
from typing import Callable, Optional

from .paths import DATA

FILE = DATA / "presence_on.json"
DEFAULTS = {
    "enabled": True,
    "window_min": 10,          # how long after the Uno is adopted to keep watching
    "quiet_start": "00:30",    # quiet hours: never switch on in this span
    "quiet_end": "07:00",
    "input_s": 120,            # keyboard/mouse input this recent = he is at the desk
    "occupied_p": 0.8,         # Aankhen's learned occupied probability
    "sustain_s": 20,           # ... held this long
}
POLL_S = 2.0


def last_input_idle_s() -> Optional[float]:
    """Seconds since the last keyboard or mouse input on this Windows session; None
    elsewhere or when the call fails. Read-only (user32.GetLastInputInfo)."""
    if sys.platform != "win32":
        return None
    try:
        class LASTINPUTINFO(ctypes.Structure):
            _fields_ = [("cbSize", ctypes.c_uint), ("dwTime", ctypes.c_uint)]
        info = LASTINPUTINFO()
        info.cbSize = ctypes.sizeof(LASTINPUTINFO)
        if not ctypes.windll.user32.GetLastInputInfo(ctypes.byref(info)):
            return None
        now = ctypes.windll.kernel32.GetTickCount() & 0xFFFFFFFF
        return ((now - info.dwTime) & 0xFFFFFFFF) / 1000.0     # both are 32-bit ms ticks: wrap-safe
    except Exception:
        return None


def _minutes(hhmm: str) -> int:
    h, m = str(hhmm).split(":")
    h, m = int(h), int(m)
    if not (0 <= h < 24 and 0 <= m < 60):
        raise ValueError(hhmm)
    return h * 60 + m


def in_quiet_hours(now: datetime, start: str, end: str) -> bool:
    """[start, end) on the clock; a span over midnight (00:30-07:00 does not, 23:00-07:00
    does) is handled."""
    s, e, t = _minutes(start), _minutes(end), now.hour * 60 + now.minute
    if s == e:
        return False
    return s <= t < e if s < e else (t >= s or t < e)


def load_settings(path: Path = FILE) -> dict:
    out = dict(DEFAULTS)
    try:
        raw = json.loads(Path(path).read_text(encoding="utf-8"))
        if isinstance(raw, dict):
            out.update({k: raw[k] for k in DEFAULTS if k in raw})
    except (FileNotFoundError, ValueError, OSError):
        pass
    return out


def check_settings(s: dict) -> dict:
    """Validated copy; raises ValueError with what is wrong."""
    out = dict(DEFAULTS)
    out.update(s)
    out["enabled"] = bool(out["enabled"])
    for k in ("quiet_start", "quiet_end"):
        try:
            _minutes(out[k])
        except Exception:
            raise ValueError(f"{k} must be HH:MM")
    for k, lo, hi in (("window_min", 1, 120), ("input_s", 10, 3600), ("sustain_s", 0, 600)):
        v = out[k]
        if not isinstance(v, (int, float)) or isinstance(v, bool) or not lo <= v <= hi:
            raise ValueError(f"{k} must be a number from {lo} to {hi}")
    p = out["occupied_p"]
    if not isinstance(p, (int, float)) or isinstance(p, bool) or not 0.5 <= p <= 1.0:
        raise ValueError("occupied_p must be from 0.5 to 1.0")
    return out


class PresenceOn:
    def __init__(self, limbs, bus, hub=None, core=None, path: Path = FILE,
                 clock: Callable[[], float] = time.time, now: Callable[[], datetime] = datetime.now,
                 idle_s: Callable[[], Optional[float]] = last_input_idle_s,
                 sleep: Optional[Callable[[float], None]] = None):
        self.limbs, self.bus, self.hub, self.core, self.path = limbs, bus, hub, core, Path(path)
        self.clock, self.now, self.idle_s = clock, now, idle_s
        self._stop = threading.Event()
        self.sleep = sleep or (lambda s: self._stop.wait(s))
        self.settings = load_settings(self.path)
        self.started = False                 # once per app start
        self.status = "waiting for the relay board"
        self.decision: Optional[dict] = None
        self._occupied_since: Optional[float] = None
        self._thread: Optional[threading.Thread] = None

    # ------------------------------------------------------------- settings
    def set_settings(self, changes: dict) -> dict:
        self.settings = check_settings({**self.settings, **changes})
        tmp = self.path.with_suffix(".tmp")
        tmp.write_text(json.dumps(self.settings, indent=2), encoding="utf-8")
        tmp.replace(self.path)
        return self.view()

    def view(self) -> dict:
        return {"settings": dict(self.settings), "status": self.status, "decision": self.decision,
                "started": self.started}

    # ------------------------------------------------------------- log
    def _log(self, decision: str, reason: str, **data) -> None:
        self.status = reason
        self.decision = {"decision": decision, "reason": reason, "at": self.clock(), **data}
        try:
            self.bus.publish("limbs", "presence_on", f"Presence rule: {reason}", decision=decision, **data)
        except Exception:
            pass

    # ------------------------------------------------------------- evidence
    def evidence(self) -> Optional[str]:
        """Why he is here, or None."""
        idle = self.idle_s()
        if idle is not None and idle <= self.settings["input_s"]:
            return f"keyboard/mouse input {idle:.0f} s ago"
        occ = self._aankhen_occupied()
        if occ is None:
            self._occupied_since = None
            return None
        t = self.clock()
        if self._occupied_since is None:
            self._occupied_since = t
        held = t - self._occupied_since
        if held >= self.settings["sustain_s"]:
            return f"Aankhen (real board) occupied p={occ:.2f} for {held:.0f} s"
        return None

    def _aankhen_occupied(self) -> Optional[float]:
        """occupied_p when the REAL board's learned model says occupied, else None."""
        eng = getattr(self.hub, "engine", None) if self.hub is not None else None
        if eng is None:
            return None
        try:
            f = eng.latest_frame()
        except Exception:
            return None
        if not isinstance(f, dict) or f.get("source") != "hardware":
            return None                                        # never the simulator or a replay
        learned = f.get("learned") or {}
        p = learned.get("occupied_p")
        if p is None:
            return None
        return float(p) if float(p) >= self.settings["occupied_p"] else None

    # ------------------------------------------------------------- the rule
    def _guard(self) -> Optional[tuple[str, str]]:
        s = self.settings
        if not s["enabled"]:
            return "off", "switched off in settings"
        if in_quiet_hours(self.now(), s["quiet_start"], s["quiet_end"]):
            return "quiet", f"quiet hours ({s['quiet_start']}-{s['quiet_end']}): the room stays as it is"
        if self.limbs.manual:
            origin, _ = self.limbs.manual[-1]
            return "manual", f"a switch was already used since the app started ({origin}): it wins"
        return None

    def start(self) -> bool:
        """Called after each Uno (re)connect; acts only on the first one of this app start."""
        if self.started:
            return False
        self.started = True
        self._thread = threading.Thread(target=self.run, name="presence-on", daemon=True)
        self._thread.start()
        return True

    def stop(self) -> None:
        self._stop.set()

    def run(self) -> Optional[dict]:
        self.started = True
        g = self._guard()
        if g:
            self._log("skipped", g[1], guard=g[0])
            return None
        window = float(self.settings["window_min"]) * 60
        t0 = self.clock()
        self._log("watching", f"watching {self.settings['window_min']:g} min for presence")
        while not self._stop.is_set():
            why = self.evidence()
            if why:
                g = self._guard()                          # time passed: check again
                if g:
                    self._log("skipped", g[1], guard=g[0], evidence=why)
                    return None
                return self.act(why)
            if self.clock() - t0 >= window:
                self._log("skipped", f"no presence evidence in {self.settings['window_min']:g} min: "
                          f"the room stays off", guard="no_evidence")
                return None
            if self.limbs.manual:
                g = self._guard()
                self._log("skipped", g[1] if g else "a switch was used", guard="manual")
                return None
            self.sleep(POLL_S)
        self._log("skipped", "the app is stopping", guard="stopped")
        return None

    def act(self, why: str) -> dict:
        lm = self.limbs
        mode = next((m for m in lm.modes if m["id"] == lm.last_mode), None) if lm.last_mode else None
        import room_config                                   # core/room_config.py (limbs put it on the path)
        if mode is not None and any(room_config.resolve(mode, list(lm.state)).values()):
            r = lm.scene(mode["id"], origin="presence")
            how = f"the last mode, {mode['name']}"
        else:
            delivered, changed = {}, []
            for d in [d for d in ("light", "fan") if d in lm.state] or list(lm.state):
                out = lm.apply(d, "on", origin="presence")
                delivered.update(out["delivered"])
                changed += out["changed"]
            r = {"delivered": delivered, "changed": changed}
            how = "light and fan on"
        on = [d for d, st in lm.state.items() if st["on"]]
        off = [d for d, st in lm.state.items() if not st["on"]]
        failed = [d for d, ok in (r.get("delivered") or {}).items() if not ok]
        if on and set(on) >= {"light", "fan"} and not off:
            line = "Welcome back, sir: light and fan on."
        else:
            line = ("Welcome back, sir: " + " and ".join(on) + " on" + (f", {' and '.join(off)} off" if off else "")
                    + ".") if on else "Welcome back, sir."
        if failed:
            line += f" The relay board did not confirm {', '.join(failed)}."
        spoken = False
        if self.core is not None and getattr(self.core, "running", False):
            try:
                self.core.speak(line)
                spoken = True
            except Exception:
                spoken = False
        self._log("acted", f"{why}: {how}", evidence=why, line=line, spoken=spoken,
                  delivered=r.get("delivered"), mode=mode["id"] if mode else None)
        return {"line": line, "evidence": why, "delivered": r.get("delivered"), "spoken": spoken}
