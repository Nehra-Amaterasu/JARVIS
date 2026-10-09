"""Limbs: what JARVIS can physically switch.

There is ONE source of truth for the room: brain/room.py, the same state voice
commands change ("turn the light down"). The app never keeps a second copy that
could disagree — it sends commands to the running JARVIS process, which applies
them through room.apply() and reports every change back as an event. With an MQTT
broker running, room.py also publishes each change on jarvis/room/<device>, the
topics the ESP32 relay board will subscribe to; until then the devices are
virtual, and the tab says so.
"""
from __future__ import annotations

from .core import CoreProcess

# Mirrors room.py's devices. "unit" is what `level` means for that device.
DEVICES = [
    {"id": "light", "name": "Room light", "kind": "light", "unit": "brightness",
     "mains": True, "note": "relay + dimmer on the ESP32 board (planned)"},
    {"id": "fan", "name": "Ceiling fan", "kind": "fan", "unit": "speed",
     "mains": True, "note": "relay on the ESP32 board (planned)"},
]
SCENES = [
    {"id": "focus", "name": "Deep focus", "detail": "light 80%, fan low and quiet"},
    {"id": "relaxation", "name": "Wind down", "detail": "light 30%, fan medium"},
    {"id": "sleep", "name": "Sleep", "detail": "lights off, fan low"},
]
ACTIONS = {"on", "off", "set", "dim", "brighten"}


class Limbs:
    def __init__(self, core: CoreProcess):
        self.core = core

    def view(self) -> dict:
        info = self.core.info()
        state = info["room"]
        devices = []
        for d in DEVICES:
            devices.append({**d, "state": state.get(d["id"]),
                            "link": "mqtt" if info["mqtt"] else ("virtual" if info["running"] else "offline")})
        return {"devices": devices, "scenes": SCENES, "core_running": info["running"],
                "mqtt": info["mqtt"],
                "hardware": "No relay board yet: devices are virtual and mirror what JARVIS believes."}

    def control(self, device: str, action: str, value=None) -> None:
        if device not in {d["id"] for d in DEVICES} | {"all"}:
            raise ValueError(f"unknown device {device!r}")
        if action not in ACTIONS:
            raise ValueError(f"unknown action {action!r}")
        if value is not None:
            value = max(0, min(100, int(value)))
        self.core.room_command(device, action, value)

    def scene(self, name: str) -> None:
        if name not in {s["id"] for s in SCENES}:
            raise ValueError(f"unknown scene {name!r}")
        self.core.room_command("environment", name, name)
