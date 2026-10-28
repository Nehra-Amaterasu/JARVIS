"""Limbs: what JARVIS can physically switch, and the room's modes.

ONE owner of the room's state, and the ONLY writer to the relays: this module. It keeps
the state on disk, drives the real relays, and keeps JARVIS's own copy (core/room.py,
which the voice path reads) in step:

    Limbs tab / palette ─┐                          ┌─▶ Uno relays (uno.py, USB serial)
    voice (set_device) ──┼─▶ Limbs.apply() ── state ┼─▶ ESP32 relays (hub: USB, or Wi-Fi)
    presence_on.py ──────┘                          └─▶ JARVIS's room.state (stdin)

What is wired comes from devices.json (core/room_config.py): id, name, kind light|fan,
board uno|esp32, channel. No file means today's room: the ESP32-S3 wall box with six relays
(2026-10-28). A seventh relay is one line there (and a row in the firmware's RELAY_TABLE),
not code. A device on the Uno is switched only through the Uno transport; one
on the ESP32 only through the hub.

The relays only SWITCH (contacts in parallel with the wall switches): every device is
on or off. There is no brightness and no fan speed (the fan's speed is its wall
regulator's); "set", "dim" and "brighten" switch a device on, and the voice path answers
a level request with core/room.py no_levels() before it gets here.

The board's reply is the truth, on both boards: a switch counts as delivered only when
the board reports the new state (the Uno's reply line; the ESP32's STATUS frame, which
it sends at once after a command, over USB or the Wi-Fi link: hub.set_relay), and on
(re)connect the room adopts the board's state. The Uno's relays boot OFF; the ESP32's
keep their state while Wi-Fi or the laptop is away, and boot OFF after a power cut.
Either way presence_on.py may then switch them back on when he is there. A device whose
board is offline is not switched, and the reason says which board and why.

Modes ("Deep focus" = light on + fan on, ...) are on/off sets, editable here and in
the Limbs tab, persisted in modes.json, and asked for by voice by their name.

Each device is a circuit of the switchboard (circuits.py) by alias: that gives its
rated watts, and it is a safety gate: a relay whose circuit was refused (an AC, a
geyser, anything over 5.6 A) is never driven. Every applied change goes to listeners
(the energy ledger), whoever made it.
"""
from __future__ import annotations

import json
import sys
import threading
import time
from pathlib import Path
from typing import Callable, Optional

from .bus import EventBus
from .core import CoreProcess
from .paths import CORE, DATA

if str(CORE) not in sys.path:
    sys.path.insert(0, str(CORE))
import room_config  # noqa: E402  core/room_config.py

FILE = DATA / "room.json"
ACTIONS = {"on", "off", "set", "dim", "brighten"}       # set/dim/brighten: switch on (no levels)
# Origins that are not a person choosing: the board's own report, the presence rule.
AUTOMATIC_ORIGINS = {"board", "presence", "startup"}
TEST_HOLD_S = 1.0


def fresh_state(devices: list[dict]) -> dict:
    return {d["id"]: {"on": False} for d in devices}


DEFAULT_STATE = fresh_state(room_config.DEFAULT_DEVICES)


def apply_command(state: dict, device: str, action: str, value=None, modes: Optional[list] = None) -> list[str]:
    """Pure: apply one command to `state` in place; return the devices that changed.

    Mirrors core/room.py apply() (tested side by side). `device` "environment" sets the
    mode named by `value` (or `action`); "all" is every device.
    """
    if device == "environment":
        name = str(value) if value else action
        mode = room_config.find_mode(modes if modes is not None else room_config.DEFAULT_MODES, name)
        if mode is None:
            raise ValueError(f"unknown mode {name!r}")
        changed = []
        for d, on in room_config.resolve(mode, list(state)).items():
            if state[d]["on"] != on:
                state[d]["on"] = on
                changed.append(d)
        return changed
    if action not in ACTIONS:
        raise ValueError(f"unknown action {action!r}")
    targets = list(state) if device == "all" else [device]
    changed = []
    for d in targets:
        if d not in state:
            raise ValueError(f"unknown device {d!r}")
        on = action != "off"
        if state[d]["on"] != on:
            state[d]["on"] = on
            changed.append(d)
    return changed


class Limbs:
    def __init__(self, core: CoreProcess, hub, bus: EventBus, path=FILE, circuits=None, relays=None,
                 config_dir: Optional[Path] = None, sleep: Callable[[float], None] = time.sleep):
        self.core, self.hub, self.bus, self.path = core, hub, bus, Path(path)
        self.config_dir = Path(config_dir) if config_dir is not None else self.path.parent
        self.relays = relays                      # uno.UnoRelays, the Uno transport, if any
        self.sleep = sleep
        self._lock = threading.RLock()
        self.devices, self.device_problems = room_config.load_devices(self.config_dir)
        self._by_id = {d["id"]: d for d in self.devices}
        m = room_config.load_modes(self.config_dir)
        self.modes, self.last_mode, self.mode_problems = m["modes"], m["last"], m["problems"]
        self.state = self._load()
        # Called (no arguments) after the ESP32 (re)connects and its state is adopted:
        # the presence rule hangs here as it does on the Uno's on_connect.
        self.on_board_connect: list[Callable[[], None]] = []
        # Every command a person gave since the app started (origin, time): the presence
        # rule (presence_on.py) never overrides one.
        self.started_at = time.time()
        self.manual: list[tuple[str, float]] = []
        # Called with one dict per applied change: device, state, origin, delivered,
        # link. The energy ledger is one; a listener's failure never breaks a switch.
        self.listeners: list[Callable[[dict], None]] = []
        self.circuits = circuits if circuits is not None else _load_circuits()
        core.room_listener = self._on_core_room

    def add_listener(self, fn: Callable[[dict], None]) -> None:
        self.listeners.append(fn)

    def _notify(self, device: str, origin: str, delivered: Optional[bool]) -> None:
        ev = {"device": device, "state": dict(self.state[device]), "origin": origin, "delivered": delivered,
              "link": self.link_of(device)}
        for fn in list(self.listeners):
            try:
                fn(ev)
            except Exception as e:                       # the switch already happened; say so
                self.bus.publish("limbs", "error", f"A listener failed on {device}: {e}")

    def _mark(self, origin: str) -> None:
        if origin not in AUTOMATIC_ORIGINS:
            self.manual.append((origin, time.time()))
            del self.manual[:-50]

    # ---------------------------------------------------------------- persistence
    def _load(self) -> dict:
        state = fresh_state(self.devices)
        try:
            raw = json.loads(self.path.read_text(encoding="utf-8"))
        except (FileNotFoundError, ValueError, TypeError, OSError):
            return state
        for d in state:
            if isinstance(raw, dict) and isinstance(raw.get(d), dict):
                state[d]["on"] = bool(raw[d].get("on", False))       # an old file's "level" is dropped
        return state

    def _save(self) -> None:
        tmp = self.path.with_suffix(".tmp")
        tmp.write_text(json.dumps(self.state), encoding="utf-8")
        tmp.replace(self.path)

    # ---------------------------------------------------------------- hardware
    def board_of(self, device: str) -> str:
        """The board that switches this device. A device on the Uno goes through the
        ESP32 hub only when the Uno transport is switched off (JARVIS_UNO=0, the tests),
        as before 2026-10-13: with the transport on, the Uno is its ONLY writer."""
        board = self._by_id[device]["board"]
        return "esp32" if board == "uno" and self.relays is None else board

    def linked(self, device: Optional[str] = None) -> bool:
        """Is this device's board connected (any device's, when None)?"""
        if device is None:
            return any(self.linked(d) for d in self.state)
        if self.board_of(device) == "uno":
            return bool(self.relays.connected)
        return bool(self.hub and self.hub.can_command)

    _linked = linked                                    # older name (board_ctl, energy)

    def esp32_link(self) -> Optional[dict]:
        """The ESP32's live link, or None: {"link": "usb"|"wifi", "where": COMx or IP,
        "rssi", "fw"} from the hub's own view of it (never probes)."""
        hub = self.hub
        if hub is None or not hub.can_command:
            return None
        b = {}
        if hasattr(hub, "board_info"):
            try:
                b = hub.board_info() or {}
            except Exception:
                b = {}
        link = b.get("link") or "usb"
        st = hub.device_status() or {}
        return {"link": link, "where": b.get("address") if link == "wifi" else b.get("port"),
                "rssi": b.get("rssi", st.get("rssi")), "fw": b.get("fw") or st.get("fw")}

    def link_of(self, device: str) -> str:
        """"usb" | "wifi" | "virtual": how this device's board is reached right now."""
        if not self.linked(device):
            return "virtual"
        if self.board_of(device) == "uno":
            return "usb"
        return (self.esp32_link() or {}).get("link") or "usb"

    def _esp_reported(self) -> dict:
        """The ESP32's relays as its last STATUS reported them ({} while it is offline)."""
        hub = self.hub
        if hub is None or not hub.can_command:
            return {}
        r = (hub.device_status() or {}).get("relays")
        return dict(r) if isinstance(r, dict) else {}

    def _esp_offline(self) -> str:
        hub = self.hub
        fn = getattr(hub, "offline_reason", None) if hub is not None else None
        return fn() if fn is not None else "the ESP32 is not connected"

    def adopt_board(self) -> list[str]:
        """The Uno just (re)connected: take its relay states as the room's truth."""
        if self.relays is None:
            return []
        with self._lock:
            changed = []
            for d, on in self.relays.state.items():
                if on is None or d not in self.state or self.board_of(d) != "uno" or self.state[d]["on"] == on:
                    continue
                self.state[d]["on"] = on
                changed.append(d)
            if changed:
                self._save()
                for d in changed:
                    self._tell_core(d, "on" if self.state[d]["on"] else "off")
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
            if self.board_of(d) == "uno":
                if not force and self.relays.state.get(d) == on:
                    out[d] = True                         # the board already reports it there
                    continue
                ok, why = self.relays.set(d, on)
                out[d] = ok
                if not ok:
                    self.bus.publish("limbs", "relay_failed", f"{d} {'on' if on else 'off'} not confirmed: {why}",
                                     device=d, reason=why)
                continue
            # The ESP32, over whichever link the hub has (USB or Wi-Fi).
            if self.hub is None or not self.hub.can_command:
                out[d] = False
                why = self._esp_offline()
                self.bus.publish("limbs", "relay_failed", f"{d} {'on' if on else 'off'} not switched: {why}",
                                 device=d, reason=why)
                continue
            if not force and self._esp_reported().get(d) == on:
                out[d] = True                             # the board already reports it there
                continue
            set_relay = getattr(self.hub, "set_relay", None)
            if set_relay is not None:
                ok, why = set_relay(d, on)                # waits for the board's STATUS
            else:                                         # an older hub: sent is all it can say
                ok = bool(self.hub.command({"relay": d, "on": on}))
                why = "" if ok else "not delivered"
            out[d] = ok
            if not ok:
                self.bus.publish("limbs", "relay_failed", f"{d} {'on' if on else 'off'} not confirmed: {why}",
                                 device=d, reason=why)
        return out

    def resync_hardware(self) -> dict[str, bool]:
        """The ESP32 just (re)connected, over USB or Wi-Fi: its relays become the room's
        truth for its devices (returned: the ones that changed, and to what). Adopted,
        never pushed: the board kept its relays while the link was down, or rebooted
        with them OFF after a power cut, and pushing the app's old state back would
        switch mains loads on at whatever hour the link came back (3.4.0 pushed).
        Then the on_board_connect hooks run (the presence rule)."""
        esp = [d for d in self.state if self.board_of(d) == "esp32"]
        if not esp:
            return {}
        report = None
        if self.hub is not None and self.hub.can_command:
            fn = getattr(self.hub, "board_relays", None)
            try:
                report = fn() if fn is not None else (self.hub.device_status() or {}).get("relays")
            except Exception:
                report = None
        changed: dict[str, bool] = {}
        with self._lock:
            for d in esp:
                on = (report or {}).get(d)
                if on is None or self.state[d]["on"] == bool(on):
                    continue
                self.state[d]["on"] = bool(on)
                changed[d] = bool(on)
            if changed:
                self._save()
                for d in changed:
                    self._tell_core(d, "on" if self.state[d]["on"] else "off")
                    self._notify(d, "board", True)
        if report is None:
            self.bus.publish("limbs", "board", "ESP32 connected, but it sent no relay report yet: the room "
                             "keeps its own state until it does")
        for fn in list(self.on_board_connect):
            try:
                fn()
            except Exception as e:
                self.bus.publish("limbs", "error", f"After the ESP32 connected: {e}")
        return changed

    def _tell_core(self, device: str, action: str) -> None:
        """Keep JARVIS's own copy (voice reads it) in step: one on/off per device."""
        if self.core.running:
            try:
                self.core.room_command(device, action, None)
            except Exception:
                pass

    # ---------------------------------------------------------------- commands
    def _apply_locked(self, changed: list[str], origin: str, tell_core: bool = True) -> dict:
        if changed:
            self._save()
        delivered = self._drive(changed)
        # A board that did not confirm: the room is what the board says, not what was asked.
        esp = None
        for d, ok in delivered.items():
            if ok:
                continue
            if self.board_of(d) == "uno":
                board = self.relays.state.get(d) if self.relays is not None and self.relays.connected else None
            else:
                esp = self._esp_reported() if esp is None else esp
                board = esp.get(d)
                if board is None and esp:
                    board = False                     # reporting, but no such relay (or pin -1): off
            if board is not None and self.state[d]["on"] != bool(board):
                self.state[d]["on"] = bool(board)
                self._save()
        for d in changed:
            if tell_core:
                self._tell_core(d, "on" if self.state[d]["on"] else "off")
            st = self.state[d]
            self.bus.publish("limbs", "room", f"{d} " + ("on" if st["on"] else "off"),
                             device=d, state=dict(st), origin=origin, delivered=delivered.get(d))
            self._notify(d, origin, delivered.get(d))
        return {"changed": changed, "delivered": delivered, "state": json.loads(json.dumps(self.state))}

    def apply(self, device: str, action: str, value=None, origin: str = "app") -> dict:
        """One device (or "all") on/off. A scene goes through scene(); "environment"
        is still accepted here for older callers (reminders' switch_later)."""
        if device == "environment":
            return self.scene(str(value or action), origin=origin)
        with self._lock:
            self._mark(origin)
            changed = apply_command(self.state, device, action)
            return self._apply_locked(changed, origin)

    def scene(self, name: str, origin: str = "app") -> dict:
        """Switch to a mode by id or name ("focus", "Deep focus", "wind down")."""
        with self._lock:
            mode = room_config.find_mode(self.modes, name)
            if mode is None:
                raise ValueError(f"unknown mode {name!r}")
            self._mark(origin)
            changed = apply_command(self.state, "environment", mode["id"], mode["id"], modes=self.modes)
            self.last_mode = mode["id"]
            self._save_modes()
            out = self._apply_locked(changed, origin)
            self.bus.publish("limbs", "mode", f"Mode: {mode['name']}", mode=mode["id"], origin=origin)
            out["mode"] = self._mode_view(mode)
            return out

    def _on_core_room(self, device: str, st: dict) -> None:
        """JARVIS changed his own room copy (a voice command without the app's API):
        adopt it and drive the relay."""
        with self._lock:
            on = bool((st or {}).get("on"))
            if device not in self.state or self.state[device]["on"] == on:
                return
            self._mark("voice")
            self.state[device]["on"] = on
            self._apply_locked([device], "voice", tell_core=False)

    def sync_core(self) -> None:
        """When JARVIS boots, his room.py starts with everything off: bring it to ours."""
        for d, st in self.state.items():
            self._tell_core(d, "on" if st["on"] else "off")

    def test_click(self, device: str, hold_s: float = TEST_HOLD_S) -> dict:
        """Flip one relay for `hold_s` and put it back, through apply() (the same path,
        safety gate and receipts as the switches); the board's own replies are the receipt."""
        if device not in self.state:
            raise KeyError(device)
        if not self.linked(device):
            raise RuntimeError(f"the {self.board_of(device)} board is not connected: a test click needs it")
        before = self.state[device]["on"]
        first, back = ("off", "on") if before else ("on", "off")
        steps = []
        for i, action in enumerate((first, back)):
            if i:
                self.sleep(hold_s)
            t = time.monotonic()
            r = self.apply(device, action, origin="test")
            board = ((self.relays.state.get(device) if self.relays else None) if self.board_of(device) == "uno"
                     else self._esp_reported().get(device))
            steps.append({"action": action, "delivered": bool(r["delivered"].get(device)), "board_says": board,
                          "ms": round((time.monotonic() - t) * 1000)})
        ok = all(s["delivered"] for s in steps) and self.state[device]["on"] == before
        text = (f"Test click: {device} {first} for {hold_s:g} s and back {back}; the board confirmed both"
                if ok else f"Test click: the board did not confirm the {device} relay")
        self.bus.publish("limbs", "test", text, device=device)
        return {"device": device, "ok": ok, "steps": steps, "restored": self.state[device]["on"] == before,
                "text": text}

    # ---------------------------------------------------------------- modes
    def _save_modes(self) -> None:
        room_config.save_modes(self.modes, self.last_mode, self.config_dir)

    def _clean_set(self, st: dict) -> dict:
        """{device: on/off}; "on"/"off" strings are accepted, a level never is."""
        out = {}
        for k, v in (st or {}).items():
            if isinstance(v, bool):
                out[str(k)] = v
            elif isinstance(v, str) and v.strip().lower() in ("on", "off", "true", "false"):
                out[str(k)] = v.strip().lower() in ("on", "true")
            else:
                raise ValueError(f"{k} must be on or off; the relays have no levels")
        return out

    def create_mode(self, name: str, st: dict) -> dict:
        with self._lock:
            mode = {"name": str(name or "").strip(), "set": self._clean_set(st)}
            why = room_config.check_mode(mode, list(self.state))
            if why:
                raise ValueError(why)
            if room_config.find_mode(self.modes, mode["name"]) is not None:
                raise ValueError(f"a mode called {mode['name']!r} already exists")
            if len(self.modes) >= room_config.MAX_MODES:
                raise ValueError(f"at most {room_config.MAX_MODES} modes")
            mid, n = room_config.slug(mode["name"]), 2
            while any(m["id"] == mid for m in self.modes) or mid in ("all", "environment"):
                mid, n = f"{room_config.slug(mode['name'])}_{n}", n + 1
            mode = {"id": mid, **mode}
            self.modes.append(mode)
            self._save_modes()
            self.bus.publish("limbs", "mode_saved", f"New mode: {mode['name']}", mode=mid)
            return self._mode_view(mode)

    def update_mode(self, mode_id: str, name: Optional[str] = None, st: Optional[dict] = None) -> dict:
        with self._lock:
            mode = next((m for m in self.modes if m["id"] == mode_id), None)
            if mode is None:
                raise KeyError(mode_id)
            new = {"name": str(name).strip() if name is not None else mode["name"],
                   "set": self._clean_set(st) if st is not None else mode["set"]}
            why = room_config.check_mode(new, list(self.state))
            if why:
                raise ValueError(why)
            other = room_config.find_mode([m for m in self.modes if m["id"] != mode_id], new["name"])
            if other is not None:
                raise ValueError(f"a mode called {new['name']!r} already exists")
            mode.update(new)
            self._save_modes()
            self.bus.publish("limbs", "mode_saved", f"Mode saved: {mode['name']}", mode=mode_id)
            return self._mode_view(mode)

    def delete_mode(self, mode_id: str) -> None:
        with self._lock:
            mode = next((m for m in self.modes if m["id"] == mode_id), None)
            if mode is None:
                raise KeyError(mode_id)
            self.modes.remove(mode)
            if self.last_mode == mode_id:
                self.last_mode = None
            self._save_modes()
            self.bus.publish("limbs", "mode_deleted", f"Mode deleted: {mode['name']}", mode=mode_id)

    def _mode_view(self, m: dict) -> dict:
        return {"id": m["id"], "name": m["name"], "set": dict(m["set"]),
                "resolved": room_config.resolve(m, list(self.state)),
                "detail": room_config.describe_mode(m, self.devices),
                "builtin": m["id"] in room_config.BUILTIN_MODE_IDS}

    # ---------------------------------------------------------------- view
    def view(self) -> dict:
        info = self.core.info()
        esp_reported = self._esp_reported()
        esp_link = self.esp32_link()
        uno_reported = dict(self.relays.state) if self.relays is not None else {}
        devices = []
        for d in self.devices:
            st = self.state[d["id"]]
            reported = uno_reported if self.board_of(d["id"]) == "uno" else esp_reported
            hw = reported.get(d["id"]) if isinstance(reported, dict) else None
            linked = self.linked(d["id"])
            c = self.circuits.by_alias(d["id"]) if self.circuits is not None else None
            pin = f"D{d['channel']}" if d["board"] == "uno" else f"GPIO {d['channel']}"
            devices.append({
                **d, "state": dict(st), "link": self.link_of(d["id"]),
                # True/False: the board's own report; None: no board / no such channel on it.
                "hardware_on": hw,
                "confirmed": linked and hw is not None and bool(hw) == bool(st["on"]),
                "note": f"on/off relay on the {'Uno' if d['board'] == 'uno' else 'ESP32'} {pin}, "
                        f"in parallel with the wall switch",
                "circuit": None if c is None else {
                    "id": c.id, "name": c.name, "room": c.room, "rated_w": c.rated_w, "relay": c.relay,
                    "relay_safe": c.relay_safe, "refused": c.refused, "example": self.circuits.example},
            })
        board = None
        if self.relays is not None:
            board = self.relays.view()
            on_uno = [d["id"] for d in self.devices if d["board"] == "uno"]
            board["devices"] = on_uno
            board["missing_channels"] = ([d for d in on_uno if d not in uno_reported or uno_reported[d] is None]
                                         if self.relays.connected else [])
        usb = self.linked()
        on_esp = [d["id"] for d in self.devices if self.board_of(d["id"]) == "esp32"]
        esp32 = self._esp32_view(on_esp, esp_reported, esp_link)
        parts = []
        if self.relays is not None and (any(self.board_of(d["id"]) == "uno" for d in self.devices) or not on_esp):
            r = board
            if r["connected"]:
                text = (f"Relay board (Arduino Uno, firmware {r.get('version') or '?'}) on {r['port']}: "
                        f"switches drive the real relays, and each one counts only when the board confirms it.")
                if r["missing_channels"]:
                    text += (f" Not on the board yet: {', '.join(r['missing_channels'])} "
                             f"(flash uno_relay 1.1.0 with that pin in its table).")
            else:
                text = (f"Relay board (Arduino Uno) not connected: {r['error'] or 'waiting for it'}. "
                        f"The room is virtual until it is back.")
            parts.append(text)
        if on_esp:
            parts.append(esp32["text"] if esp32["connected"] else
                         esp32["text"] + " The room is virtual for them until it is back.")
        hardware = " ".join(parts) if parts else (
            "No relay board connected: the room is virtual until one is plugged in.")
        modes = [self._mode_view(m) for m in self.modes]
        return {"devices": devices, "modes": modes, "scenes": modes, "last_mode": self.last_mode,
                "core_running": info["running"], "usb": usb, "hardware": hardware, "relay_board": board,
                "esp32": esp32, "links": sorted({x["link"] for x in devices if x["link"] != "virtual"}),
                "problems": self.device_problems + self.mode_problems}

    def _esp32_view(self, on_esp: list, reported: dict, link: Optional[dict]) -> dict:
        """The ESP32 as a relay board: its link in words ("Wi-Fi (192.168.1.50, -58 dBm)"
        or "USB (COM7)"), the devices it should switch but does not report, and pins
        that disagree with devices.json."""
        out = {"devices": on_esp, "connected": link is not None, "link": None, "where": None, "rssi": None,
               "fw": None, "how": None, "missing_channels": [], "pin_mismatch": [], "text": ""}
        if link is None:
            out["text"] = (f"ESP32 relays ({', '.join(on_esp)}): {self._esp_offline()}." if on_esp else "")
            return out
        rssi = link.get("rssi")
        how = (f"Wi-Fi ({link['where'] or '?'}{f', {rssi} dBm' if rssi is not None else ''})"
               if link["link"] == "wifi" else f"USB ({link['where'] or '?'})")
        out.update(link=link["link"], where=link["where"], rssi=rssi, fw=link.get("fw"), how=how)
        out["missing_channels"] = [d for d in on_esp if reported.get(d) is None]
        pins = (self.hub.device_status() or {}).get("relay_pins") if self.hub is not None else None
        if isinstance(pins, dict):
            out["pin_mismatch"] = [{"device": d, "devices_json": self._by_id[d]["channel"], "board": pins.get(d)}
                                   for d in on_esp if d in pins and pins.get(d) not in (-1, None)
                                   and pins.get(d) != self._by_id[d]["channel"]]
        text = (f"ESP32 relay board over {how}" + (f", firmware {link['fw']}" if link.get("fw") else "")
                + ": switches drive its relays, and each one counts only when the board confirms it.")
        if out["missing_channels"]:
            text += (f" Not on the board (or its pin is -1): {', '.join(out['missing_channels'])}; add them "
                     "to RELAY_TABLE in config.h and flash.")
        if out["pin_mismatch"]:
            text += " Pins differ from devices.json: " + ", ".join(
                f"{m['device']} is GPIO {m['board']} on the board, {m['devices_json']} in devices.json"
                for m in out["pin_mismatch"]) + "."
        out["text"] = text
        return out


def _load_circuits():
    """The switchboard config, or None if it cannot be loaded. Limbs must never fail
    to start because of it; the energy card reports the problem instead."""
    try:
        from .circuits import load_circuits
        return load_circuits()
    except Exception:
        return None
