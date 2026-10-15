"""The energy feature, wired: circuits + ledger + tariff + empty-room detector.

    Limbs (every switch, any origin) ──listener──▶ Ledger.record
    "I switched the geyser on" (app) ─────────────▶ Ledger.record (link "manual")
    every 5 s: Aankhen presence + circuit states ─▶ WasteDetector.tick ─▶ actions
        nudge / reminder  → bus event, and JARVIS says it (core.speak) when he is running
        auto-off          → Limbs.apply(..., "off", origin="energy") — the same path as a button

The detector decides; this module only carries out what it returns, so every rule
(hold, spoken check, night, bed, simulation, must-not-auto-off) lives and is tested in
one place (waste.py).
"""
from __future__ import annotations

import json
import threading
import time
from pathlib import Path
from typing import Callable, Optional

from .circuits import CircuitSet, RelaySafetyError, load_circuits
from .energy import Ledger, Tariff, build_report
from .paths import DATA
from .waste import Load, WasteConfig, WasteDetector

TICK_S = 5.0


def read_presence(hub) -> dict:
    """What the Aankhen hub says about the sensed room right now.

    A hub that is stopped, or whose sensors have gone silent, gives "no data" — a stale
    "empty" from a minute ago must not count as an empty room now."""
    if hub is None or not getattr(hub, "running", False) or getattr(hub, "engine", None) is None:
        return {"state": None, "source": None, "learned": None, "live": False}
    eng = hub.engine
    f = eng.frame_message()
    sensors = (eng.status_message() or {}).get("sensors", {})
    live = any(s.get("state") in ("live", "simulated", "replay")
               for name, s in sensors.items() if name != "ESP32")
    pres = f.get("presence") or {}
    learned = f.get("learned") or {}
    return {"state": pres.get("state") if live else "no data", "source": f.get("source"),
            "learned": learned.get("state"), "learned_trained": learned.get("trained"),
            "confidence": pres.get("confidence"), "reason": pres.get("reason"), "live": live}


class EnergyService:
    def __init__(self, limbs, bus, core=None, hub=None, circuits: Optional[CircuitSet] = None,
                 folder: Optional[Path] = None, clock: Callable[[], float] = time.time,
                 presence: Optional[Callable[[], dict]] = None):
        self.limbs, self.bus, self.core, self.hub = limbs, bus, core, hub
        self.clock = clock
        self.folder = Path(folder) if folder else DATA / "energy"
        self.folder.mkdir(parents=True, exist_ok=True)
        self.circuits = circuits or getattr(limbs, "circuits", None) or load_circuits()
        limbs.circuits = self.circuits                     # one switchboard for both
        self.problems: list[str] = []
        try:
            self.tariff = Tariff.from_config(self.circuits.tariff)
        except (ValueError, TypeError, KeyError) as e:
            self.tariff = Tariff()
            self.problems.append(f"The tariff in circuits.json could not be read ({e}); rupees are not priced.")
        light = self.circuits.by_alias("light")
        self.detector = WasteDetector(WasteConfig.from_config(self.circuits.waste, light.room if light else None),
                                      self.folder, clock)
        self.ledger = Ledger(self.folder, clock)
        self.settings_file = self.folder / "settings.json"
        self._load_settings()
        self.presence = presence or (lambda: read_presence(hub))
        self.last_presence: dict = {}
        self._tick_lock = threading.Lock()
        # Whatever the ledger still had on when the app last stopped is closed at that
        # moment (not counted after it); then today's state is what Limbs says now.
        self.ledger.resume()
        self._observe_limbs("startup")
        limbs.add_listener(self.on_limbs)

    # -------------------------------------------------------------- settings
    def _load_settings(self) -> None:
        try:
            s = json.loads(self.settings_file.read_text(encoding="utf-8"))
        except (FileNotFoundError, ValueError):
            return
        if isinstance(s.get("auto_off"), bool):
            self.detector.cfg.auto_off_enabled = s["auto_off"]

    def set_auto_off(self, enabled: bool) -> dict:
        self.detector.cfg.auto_off_enabled = bool(enabled)
        tmp = self.settings_file.with_suffix(".tmp")
        tmp.write_text(json.dumps({"auto_off": bool(enabled)}), encoding="utf-8")
        tmp.replace(self.settings_file)
        cfg = self.detector.cfg
        self.bus.publish("energy", "settings",
                         f"Auto-off {'on' if enabled else 'off'}"
                         + (f": after {cfg.auto_off_after_min:g} min empty, and only after JARVIS has asked aloud"
                            if enabled else ""), auto_off=bool(enabled))
        return cfg.to_dict()

    # -------------------------------------------------------------- recording
    def _link(self, device=None) -> str:
        """Whether a relay board really carries the switches: the Uno (or the ESP32) as
        Limbs sees it, not just "an ESP32 is plugged in"."""
        linked = getattr(self.limbs, "linked", None)
        if callable(linked):
            try:
                return "usb" if linked(device) else "virtual"
            except Exception:
                pass
        return "usb" if (self.hub is not None and getattr(self.hub, "can_command", False)) else "virtual"

    def _observe_limbs(self, origin: str) -> None:
        for device, st in self.limbs.state.items():
            c = self.circuits.by_alias(device)
            if c is not None:
                on = bool(st["on"])
                self.ledger.record(c.id, on, 100 if on else 0, c.watts(on), origin, self._link(device))

    def on_limbs(self, ev: dict) -> None:
        """Limbs listener: every applied change, from the app, a scene, a voice command
        or an auto-off, lands in the ledger."""
        c = self.circuits.by_alias(ev["device"])
        if c is None:
            return
        on = bool(ev["state"]["on"])
        # The ledger's "lvl" is 100 for on and 0 for off: the relays have no levels.
        self.ledger.record(c.id, on, 100 if on else 0, c.watts(on), ev["origin"], ev["link"])

    def set_state(self, cid: str, on: bool, level: Optional[int] = None, origin: str = "you") -> dict:
        """Switch a circuit JARVIS can switch; RECORD one he cannot (it is said so).
        On/off only: a `level` from an older caller is ignored."""
        c = self.circuits.get(cid)
        if c is None:
            raise KeyError(cid)
        if c.switchable:
            r = self.limbs.apply(c.alias, "on" if on else "off")
            return {"switched": True, "delivered": r["delivered"].get(c.alias), "circuit": c.id,
                    "note": "switched through Limbs"}
        self.ledger.record(cid, bool(on), 100 if on else 0, c.watts(bool(on)), origin, "manual")
        why = c.refused or ("it must never be on a relay" if c.never_on_relay
                            else "only the light and fan relays are driven until the Uno firmware exists")
        self.bus.publish("energy", "manual", f"{c.name}: recorded {'on' if on else 'off'} (not switched: {why})",
                         circuit=cid, on=bool(on))
        return {"switched": False, "recorded": True, "circuit": c.id,
                "note": f"Recorded as you reported it; JARVIS did not switch it ({why})."}

    def assign_relay(self, cid: str, channel: Optional[int]) -> dict:
        c = self.circuits.assign_relay(cid, channel)          # raises RelaySafetyError / KeyError
        self.bus.publish("energy", "relay", f"{c.id} {c.name}: " + (f"relay {channel}" if channel else "no relay"),
                         circuit=cid, channel=channel)
        return c.to_dict()

    def keep(self, nudge_id: str) -> dict:
        n = self.detector.keep(nudge_id)
        if n is None:
            raise KeyError(nudge_id)
        self.bus.publish("energy", "kept", "Kept on: no automatic switch-off this time", nudge=n)
        return n

    # -------------------------------------------------------------- the loop
    def loads(self) -> list[Load]:
        out = []
        for c in self.circuits.circuits:
            ev = self.ledger.last(c.id)
            on = bool(ev and ev["on"])
            out.append(Load(id=c.id, name=c.name, room=c.room, on=on, watts=c.watts(on),
                            switchable=c.switchable, kind=c.kind, must_not_auto_off=c.must_not_auto_off,
                            on_since=self.ledger.on_since(c.id) if on else None,
                            remind_after_min=c.remind_after_min))
        return out

    def tick(self) -> list[dict]:
        with self._tick_lock:
            now = self.clock()
            try:
                pres = self.presence() or {}
            except Exception as e:                      # a sensing fault is "no data", never "empty"
                pres = {"state": None, "source": None, "learned": None, "error": str(e)}
            self.last_presence = pres
            running = bool(self.core is not None and getattr(self.core, "running", False))
            actions = self.detector.tick(pres, self.loads(), now, core_running=running)
            for a in actions:
                self._carry_out(a)
            self.detector.flush()
            self.ledger.beat(now)
            return actions

    def _speak(self, text: str) -> bool:
        if self.core is None or not getattr(self.core, "running", False):
            return False
        try:
            self.core.speak(text)
            return True
        except Exception:
            return False

    def _carry_out(self, a: dict) -> None:
        n = a["nudge"]
        if a["type"] in ("nudge", "remind"):
            self.bus.publish("energy", a["type"], n["text"], sim=n["sim"], nudge=n)
            if a.get("speak"):
                self.detector.mark_spoken(n["id"], self._speak(a["speak"]))
        elif a["type"] == "auto_off":
            switched = []
            for load in a["loads"]:
                c = self.circuits.get(load.id)
                if c is not None and c.switchable:
                    self.limbs.apply(c.alias, "off", origin="energy")
                    switched.append(c.name)
            self.bus.publish("energy", "auto_off", f"Switched off after an empty room: {', '.join(switched)}",
                             nudge=n)
            if a.get("speak"):
                self._speak(a["speak"])
        elif a["type"] == "resolved":
            self.bus.publish("energy", "resolved", f"Nudge closed: {n.get('resolved_why', '')}", nudge=n,
                             sim=n["sim"])

    # -------------------------------------------------------------- views
    def report(self, period: str = "day", at: Optional[float] = None) -> dict:
        return build_report(self.ledger, self.circuits, self.tariff, period, at, self.clock(), self.detector.days)

    def view(self, period: str = "day") -> dict:
        now = self.clock()
        states = {}
        for load in self.loads():
            ev = self.ledger.last(load.id)
            states[load.id] = {"on": load.on, "watts": load.watts,
                               "since": load.on_since, "link": ev["link"] if ev else None,
                               "origin": ev["o"] if ev else None}
        pres = dict(self.last_presence)
        pres["sim"] = pres.get("source") not in ("hardware",)
        return {"now": now, "estimate": True, "meter": None,
                "report": self.report(period),
                "circuits": self.circuits.to_dict(), "states": states,
                "waste": self.detector.view(), "presence": pres,
                "auto_off": self.detector.cfg.auto_off_enabled,
                "core_running": bool(self.core is not None and getattr(self.core, "running", False)),
                "relay_board": self._link() == "usb",
                "problems": self.problems + [p["error"] for p in self.circuits.problems]}


__all__ = ["EnergyService", "RelaySafetyError", "read_presence", "TICK_S"]
