"""Limbs: what JARVIS can physically switch — the room's light and fan.

ONE owner of the room's state: this module. It keeps the state on disk, drives the
real relays, and keeps JARVIS's own copy (brain/room.py, which voice commands use)
in step:

    Limbs tab / palette ─┐                         ┌─▶ ESP32 relays (USB COMMAND frame)
                         ├─▶ Limbs.apply() ── state ┤
    "Hey Jarvis, light off" ─▶ room.apply() ─▶ event ┘  └─▶ JARVIS's room.state (stdin)

So the buttons work whether or not JARVIS is awake, and a voice command flips the
real relay. Hardware state is reported back by the board in every STATUS frame;
the UI calls a state "confirmed" only when the board's report agrees with it.

The command semantics mirror brain/room.py exactly (on / off / set / dim /
brighten, "all", and the environment scenes); tests/test_limbs.py holds the two
side by side so they cannot drift apart.
"""
from __future__ import annotations

import json
import threading
from typing import Optional

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

    Mirrors brain/room.py apply() — keep the two identical (tested).
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
    def __init__(self, core: CoreProcess, hub, bus: EventBus, path=FILE):
        self.core, self.hub, self.bus, self.path = core, hub, bus, path
        self._lock = threading.RLock()
        self.state = self._load()
        self._sent: dict[str, Optional[bool]] = {}        # last relay level sent to the board
        core.room_listener = self._on_core_room

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
    def _drive(self, devices: list[str], force: bool = False) -> dict[str, bool]:
        """Send relay commands for `devices`; returns {device: delivered}."""
        out = {}
        for d in devices:
            on = bool(self.state[d]["on"])
            if not force and self._sent.get(d) == on:
                continue                                  # relay already there
            ok = bool(self.hub and self.hub.command({"relay": d, "on": on}))
            if ok:
                self._sent[d] = on
            out[d] = ok
        return out

    def resync_hardware(self) -> dict[str, bool]:
        """Push the whole room to the board (e.g. after it reconnects)."""
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
        reported = (self.hub.device_status().get("relays") if self.hub else None) or {}
        usb = bool(self.hub and self.hub.can_command)
        devices = []
        for d in DEVICES:
            st = self.state[d["id"]]
            hw = reported.get(d["id"]) if isinstance(reported, dict) else None
            devices.append({
                **d, "state": dict(st),
                "link": "usb" if usb else ("mqtt" if info.get("mqtt") else "virtual"),
                # True/False: the board's own report; None: no board / relay not wired.
                "hardware_on": hw,
                "confirmed": usb and hw is not None and bool(hw) == bool(st["on"]),
                "note": "on/off relay — brightness and speed need a dimmer, not wired",
            })
        if usb:
            hardware = "ESP32 connected over USB: switches drive the real relays."
        else:
            hardware = "No relay board connected: the room is virtual until the ESP32 is plugged in."
        return {"devices": devices, "scenes": SCENES, "core_running": info["running"],
                "usb": usb, "mqtt": info.get("mqtt"), "hardware": hardware}
