"""Limbs: what JARVIS can physically switch — the room's light and fan.

ONE owner of the room's state: this module. It keeps the state on disk, drives the
real relays, and keeps JARVIS's own copy (core/room.py, which voice commands use)
in step:

    Limbs tab / palette ─┐                         ┌─▶ Uno relays (uno.py, USB serial)
                         ├─▶ Limbs.apply() ── state ┤
    "Hey Jarvis, light off" ─▶ room.apply() ─▶ event ┘  └─▶ JARVIS's room.state (stdin)

Since 2026-10-13 the relays hang off an Arduino Uno (uno.py), not the ESP32: when the
Uno transport is given, it is the ONLY relay writer (the ESP32 still answers relay
commands for pins nothing is wired to, and would "confirm" switches that never
happened). The board's reply is the truth: a switch counts as delivered only when the
Uno reports the new state, and on (re)connect the app adopts the board's state (its
relays boot OFF) instead of pushing yesterday's file onto the room.

So the buttons work whether or not JARVIS is awake, and a voice command flips the
real relay. Hardware state is reported back by the board in every STATUS frame;
the UI calls a state "confirmed" only when the board's report agrees with it.

The command semantics mirror core/room.py exactly (on / off / set / dim /
brighten, "all", and the environment scenes); tests/test_limbs.py holds the two
side by side so they cannot drift apart.

The two devices are circuits of the switchboard (circuits.py): the circuit with
alias "light" is what the light relay carries, "fan" likewise. That mapping gives
each device its rated watts, and it is also a safety gate — a relay whose circuit
was refused (an AC, a geyser, anything over 5.6 A) is never driven. Every change is
handed to listeners (the energy ledger) after it is applied, whoever made it.
"""
from __future__ import annotations

import json
import threading
from typing import Callable, Optional

from .bus import EventBus
from .core import CoreProcess
from .paths import DATA

FILE = DATA / "room.json"
STEP = 20                                   # room.py: "dim a bit" / "brighten a bit"

DEVICES = [
    {"id": "light", "name": "Room light", "kind": "light", "unit": "brightness", "mains": True},
    {"id": "fan", "name": "Ceiling fan", "kind": "fan", "unit": "speed", "mains": True},
]
SCENES = [
    {"id": "focus", "name": "Deep focus", "detail": "light 80%, fan low and quiet"},
    {"id": "relaxation", "name": "Wind down", "detail": "light 30%, fan medium"},
    {"id": "sleep", "name": "Sleep", "detail": "lights off, fan low"},
]
ACTIONS = {"on", "off", "set", "dim", "brighten"}
DEFAULT_STATE = {"light": {"on": False, "level": 100}, "fan": {"on": False, "level": 60}}


def apply_command(state: dict, device: str, action: str, value=None) -> list[str]:
    """Pure: apply one command to `state` in place; return the devices that changed.

    Mirrors core/room.py apply() — keep the two identical (tested).
    """
    if device == "environment":
        name = str(value).lower() if value else action
        if name in ("deep_focus", "focus"):
            return apply_command(state, "light", "set", 80) + apply_command(state, "fan", "set", 30)
        if name in ("relaxation", "chill"):
            return apply_command(state, "light", "set", 30) + apply_command(state, "fan", "set", 50)
        if name == "sleep":
            return apply_command(state, "light", "off") + apply_command(state, "fan", "set", 20)
        raise ValueError(f"unknown scene {name!r}")
    targets = ["light", "fan"] if device == "all" else [device]
    changed = []
    for d in targets:
        if d not in state:
            raise ValueError(f"unknown device {d!r}")
        if action not in ACTIONS:
            raise ValueError(f"unknown action {action!r}")
        s = state[d]
        before = dict(s)
        if action == "on":
            s["on"] = True
            if value is not None:
                s["level"] = int(value)
        elif action == "off":
            s["on"] = False
        elif action == "set":
            s["on"] = True
            if value is not None:
                s["level"] = int(value)
        elif action == "dim":
            s["on"] = True
            s["level"] = int(value) if value is not None else max(10, s["level"] - STEP)
        elif action == "brighten":
            s["on"] = True
            s["level"] = int(value) if value is not None else min(100, s["level"] + STEP)
        s["level"] = max(0, min(100, int(s["level"])))
        if s != before:
            changed.append(d)
    return changed


class Limbs:
    def __init__(self, core: CoreProcess, hub, bus: EventBus, path=FILE, circuits=None, relays=None):
        self.core, self.hub, self.bus, self.path = core, hub, bus, path
        self.relays = relays                      # uno.UnoRelays, the relay transport, if any
        self._lock = threading.RLock()
        self.state = self._load()
        self._sent: dict[str, Optional[bool]] = {}        # last relay level sent to the board
        # Called with one dict per applied change: device, state, origin, delivered,
        # link. The energy ledger is one; a listener's failure never breaks a switch.
        self.listeners: list[Callable[[dict], None]] = []
        self.circuits = circuits if circuits is not None else _load_circuits()
        core.room_listener = self._on_core_room

    def add_listener(self, fn: Callable[[dict], None]) -> None:
        self.listeners.append(fn)

    def _notify(self, device: str, origin: str, delivered: Optional[bool]) -> None:
        ev = {"device": device, "state": dict(self.state[device]), "origin": origin, "delivered": delivered,
              "link": "usb" if self._linked() else "virtual"}
        for fn in list(self.listeners):
            try:
                fn(ev)
            except Exception as e:                       # the switch already happened; say so
                self.bus.publish("limbs", "error", f"A listener failed on {device}: {e}")

    # ---------------------------------------------------------------- persistence
    def _load(self) -> dict:
        try:
            raw = json.loads(self.path.read_text(encoding="utf-8"))
            state = json.loads(json.dumps(DEFAULT_STATE))
            for d in state:
                if isinstance(raw.get(d), dict):
                    state[d]["on"] = bool(raw[d].get("on", False))
                    state[d]["level"] = int(raw[d].get("level", state[d]["level"]))
            return state
        except (FileNotFoundError, ValueError, TypeError):
            return json.loads(json.dumps(DEFAULT_STATE))

    def _save(self) -> None:
        tmp = self.path.with_suffix(".tmp")
        tmp.write_text(json.dumps(self.state), encoding="utf-8")
        tmp.replace(self.path)

    # ---------------------------------------------------------------- hardware
    def _linked(self) -> bool:
        if self.relays is not None:
            return self.relays.connected
        return bool(self.hub and self.hub.can_command)

    def adopt_board(self) -> list[str]:
        """The Uno just (re)connected: take its relay states as the room's truth."""
        if self.relays is None:
            return []
        with self._lock:
            changed = []
            for d, on in self.relays.state.items():
                if on is None or d not in self.state or bool(self.state[d]["on"]) == on:
                    continue
                self.state[d]["on"] = on
                changed.append(d)
            if changed:
                self._save()
                for d in changed:
                    if self.core.running:
                        try:
                            self.core.room_command(d, "on" if self.state[d]["on"] else "off", None)
                        except Exception:
                            pass
                    self._notify(d, "board", True)
            return changed

    def _drive(self, devices: list[str], force: bool = False) -> dict[str, bool]:
        """Send relay commands for `devices`; returns {device: delivered}."""
        out = {}
        for d in devices:
            blocked = self.circuits.blocked(d) if self.circuits is not None else None
            if blocked:
                # circuits.json puts a load on this relay that must never be switched
                # by one. The app's state still changes; the relay is not touched.
                out[d] = False
                self.bus.publish("limbs", "refused", f"Relay {d} not switched: {blocked}", device=d)
                continue
            on = bool(self.state[d]["on"])
            if self.relays is not None:
                if not force and self.relays.state.get(d) == on:
                    out[d] = True                         # the board already reports it there
                    continue
                ok, why = self.relays.set(d, on)
                out[d] = ok
                if not ok:
                    self.bus.publish("limbs", "relay_failed", f"{d} {'on' if on else 'off'} not confirmed: {why}",
                                     device=d, reason=why)
                continue
            if not force and self._sent.get(d) == on:
                continue                                  # relay already there
            ok = bool(self.hub and self.hub.command({"relay": d, "on": on}))
            if ok:
                self._sent[d] = on
            out[d] = ok
        return out

    def resync_hardware(self) -> dict[str, bool]:
        """Push the whole room to the board (e.g. after it reconnects). Not with the
        Uno: it boots with relays OFF and the app adopts that (adopt_board)."""
        if self.relays is not None:
            return {}
        with self._lock:
            self._sent.clear()
            return self._drive(list(self.state), force=True)

    # ---------------------------------------------------------------- commands
    def apply(self, device: str, action: str, value=None, origin: str = "app") -> dict:
        with self._lock:
            # A scene passes its NAME as the value ("sleep"); only a device's value
            # is a level. Coercing both to int broke every scene button.
            if value is not None and device != "environment":
                value = max(0, min(100, int(value)))
            changed = apply_command(self.state, device, action, value)
            if changed:
                self._save()
            delivered = self._drive(changed)
            if self.relays is not None and self.relays.connected:
                # The Uno did not confirm: the room is what the board says, not what was asked.
                for d, ok in delivered.items():
                    board = self.relays.state.get(d)
                    if not ok and board is not None and bool(self.state[d]["on"]) != board:
                        self.state[d]["on"] = board
                        self._save()
            # Keep JARVIS's own copy (voice commands use it) in step.
            if origin != "core" and self.core.running:
                try:
                    self.core.room_command(device, action, value)
                except Exception:
                    pass
            for d in changed:
                st = self.state[d]
                self.bus.publish("limbs", "room", f"{d} " + (f"on · {st['level']}%" if st["on"] else "off"),
                                 device=d, state=dict(st), origin=origin,
                                 delivered=delivered.get(d))
                self._notify(d, origin, delivered.get(d))
            return {"changed": changed, "delivered": delivered, "state": json.loads(json.dumps(self.state))}

    def scene(self, name: str) -> dict:
        if name not in {s["id"] for s in SCENES}:
            raise ValueError(f"unknown scene {name!r}")
        return self.apply("environment", name, name)

    def _on_core_room(self, device: str, st: dict) -> None:
        """JARVIS changed the room (a voice command): adopt it and drive the relay."""
        with self._lock:
            if device not in self.state or self.state[device] == {"on": bool(st.get("on")), "level": int(st.get("level", 0))}:
                return
            self.state[device] = {"on": bool(st.get("on")), "level": int(st.get("level", 0))}
            self._save()
            delivered = self._drive([device])
            self.bus.publish("limbs", "room", f"{device} " + (f"on · {self.state[device]['level']}%"
                                                               if self.state[device]["on"] else "off"),
                             device=device, state=dict(self.state[device]), origin="voice",
                             delivered=delivered.get(device))
            self._notify(device, "voice", delivered.get(device))

    def sync_core(self) -> None:
        """When JARVIS boots, his room.py starts at defaults: bring it to our state."""
        if not self.core.running:
            return
        for d, st in self.state.items():
            try:
                if st["on"]:
                    self.core.room_command(d, "set", st["level"])
                else:
                    self.core.room_command(d, "off", None)
            except Exception:
                pass

    # ---------------------------------------------------------------- view
    def view(self) -> dict:
        info = self.core.info()
        if self.relays is not None:
            reported = dict(self.relays.state)
        else:
            reported = (self.hub.device_status().get("relays") if self.hub else None) or {}
        usb = self._linked()
        devices = []
        for d in DEVICES:
            st = self.state[d["id"]]
            hw = reported.get(d["id"]) if isinstance(reported, dict) else None
            c = self.circuits.by_alias(d["id"]) if self.circuits is not None else None
            devices.append({
                **d, "state": dict(st),
                "link": "usb" if usb else ("mqtt" if info.get("mqtt") else "virtual"),
                # True/False: the board's own report; None: no board / relay not wired.
                "hardware_on": hw,
                "confirmed": usb and hw is not None and bool(hw) == bool(st["on"]),
                "note": "on/off relay — brightness and speed need a dimmer, not wired",
                # The switchboard circuit this device is (circuits.json), if mapped.
                "circuit": None if c is None else {
                    "id": c.id, "name": c.name, "room": c.room, "rated_w": c.rated_w, "relay": c.relay,
                    "relay_safe": c.relay_safe, "refused": c.refused, "speed_steps": c.speed_steps,
                    "example": self.circuits.example},
            })
        if self.relays is not None:
            r = self.relays.view()
            hardware = (f"Relay board (Arduino Uno) on {r['port']}: switches drive the real light and fan, "
                        f"and each one counts only when the board confirms it." if usb else
                        f"Relay board (Arduino Uno) not connected: {r['error'] or 'waiting for it'}. "
                        f"The room is virtual until it is back.")
        elif usb:
            hardware = "ESP32 connected over USB: switches drive the real relays."
        else:
            hardware = "No relay board connected: the room is virtual until the ESP32 is plugged in."
        return {"devices": devices, "scenes": SCENES, "core_running": info["running"],
                "usb": usb, "mqtt": info.get("mqtt"), "hardware": hardware,
                "relay_board": self.relays.view() if self.relays is not None else None}


def _load_circuits():
    """The switchboard config, or None if it cannot be loaded. Limbs must never fail
    to start because of it; the energy card reports the problem instead."""
    try:
        from .circuits import load_circuits
        return load_circuits()
    except Exception:
        return None
