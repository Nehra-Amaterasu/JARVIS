"""The Uno relay board: the transport that switches the real light and fan.

Hardware (2026-10-13): an Arduino Uno on USB running limbs/uno_relay/uno_relay.ino
(1.0.0 flashed; 1.1.0 in the repo), a 2-channel active-low relay board on D4 (light) and
D5 (fan), its contacts in parallel with the wall switches. Text protocol at 115200 baud,
one command per line ("light on", "fan off", "<name> on|off", "status"); every reply is
one JSON line holding the whole state, {"light": true, "fan": false, ...}, or
{"error": "..."}. The channel names come from the board (its banner and its state
lines), so a relay added to the firmware's pin table (1.1.0: D6, D7, ...) is switchable
here with no code change; 1.0.0's replies (light and fan only) read the same way.

Two facts shape this module:
  * OPENING THE PORT RESETS THE UNO (DTR is its reset line) and the relays boot OFF.
    So the port is opened once and held; nothing else may open it (aankhen's board
    finder skips Arduino ids and every port registered in transport.CLAIMED_PORTS).
  * A switch is only "done" when the Uno's reply shows the new state. set() returns
    the board's own answer; limbs.py and the voice reply are built from it.

A watcher thread connects, keeps the link alive with a `status` every
KEEPALIVE_S, and reconnects after an unplug. "Access is denied" means another program
(usually the Arduino IDE's Serial Monitor) holds the port: it is said plainly.
JARVIS_UNO=0 turns the transport off (tests); JARVIS_UNO_PORT forces a port.
"""
from __future__ import annotations

import json
import os
import threading
import time
from typing import Callable, Optional

BAUD = 115200
UNO_VIDS = {0x2341, 0x2A03, 0x1A86}          # Arduino, Arduino SRL, CH340 clones
BANNER = "jarvis-uno-relay"
BANNER_S = 4.0                               # the Uno's bootloader waits ~1.6 s, then the banner
REPLY_S = 1.5
KEEPALIVE_S = 10.0
RETRY_S = 3.0
LEGACY_DEVICES = ("light", "fan")            # what firmware 1.0.0 has
_NOT_STATE = {"board", "version", "pins", "error", "scan", "scan_pin", "help", "note", "channels"}


def is_state(msg) -> bool:
    """A whole-state line: {"light": true, "fan": false, ...}, every value a bool."""
    return (isinstance(msg, dict) and bool(msg) and not (_NOT_STATE & set(msg))
            and all(isinstance(v, bool) for v in msg.values()))


def _default_open(port: str):
    import serial
    return serial.Serial(port, BAUD, timeout=0.3)


def _default_comports():
    from serial.tools import list_ports
    return list_ports.comports()


def find_uno(comports: Callable = _default_comports) -> Optional[str]:
    forced = os.environ.get("JARVIS_UNO_PORT")
    if forced:
        return forced
    for p in comports():
        if getattr(p, "vid", None) in UNO_VIDS:
            return p.device
    return None


def _claim(port: Optional[str], on: bool) -> None:
    try:
        from aankhen import transport
    except Exception:
        return
    if port is None:
        return
    (transport.CLAIMED_PORTS.add if on else transport.CLAIMED_PORTS.discard)(port)


class UnoRelays:
    def __init__(self, bus=None, opener: Callable = _default_open, comports: Callable = _default_comports,
                 sleep: Callable[[float], None] = time.sleep):
        self.bus, self.opener, self.comports, self.sleep = bus, opener, comports, sleep
        self.ser = None
        self.port: Optional[str] = None
        self.version: Optional[str] = None
        self.pins: dict[str, int] = {}                # name -> Uno pin, from the boot banner
        self.state: dict[str, Optional[bool]] = {}
        self.error: Optional[str] = None
        self._lock = threading.RLock()
        self._stop = threading.Event()
        self._thread: Optional[threading.Thread] = None
        # Called by the watcher (never under this lock) after each (re)connect, so the
        # room adopts the board's state: limbs.adopt_board.
        self.on_connect: Optional[Callable[[], None]] = None

    # ------------------------------------------------------------- link
    @property
    def connected(self) -> bool:
        return self.ser is not None

    def _say(self, kind: str, text: str, **data) -> None:
        if self.bus is not None:
            try:
                self.bus.publish("limbs", kind, text, **data)
            except Exception:
                pass

    def connect(self) -> bool:
        """Open the Uno's port once and wait for its banner. True when linked."""
        with self._lock:
            if self.ser is not None:
                return True
            port = find_uno(self.comports)
            if port is None:
                self.error = "No Arduino Uno on USB."
                return False
            try:
                ser = self.opener(port)
            except Exception as e:
                msg = str(e)
                if "denied" in msg.lower() or "PermissionError" in msg:
                    self.error = (f"{port} is held by another program. Close the Arduino IDE's Serial "
                                  f"Monitor (only one program can hold the port), then it reconnects.")
                else:
                    self.error = f"Could not open {port}: {msg}"
                return False
            self.ser, self.port = ser, port
            _claim(port, True)
            deadline = time.monotonic() + BANNER_S
            while time.monotonic() < deadline:
                msg = self._read_json()
                if msg and msg.get("board") == BANNER:
                    self.version = msg.get("version")
                    self.pins = {str(k): int(v) for k, v in (msg.get("pins") or {}).items()
                                 if isinstance(v, int)}
                    break
            reply = self._exchange("status")
            if reply is None or not is_state(reply):
                self._drop(f"{port} answered, but not as the JARVIS Uno relay firmware.")
                return False
            self.error = None
            self._say("board", f"Relay board (Uno) connected on {port}: " + ", ".join(
                f"{d} {'on' if on else 'off'}" for d, on in self.state.items()), port=port, version=self.version)
            return True

    def _drop(self, why: str) -> None:
        with self._lock:
            ser, self.ser = self.ser, None
            _claim(self.port, False)
            self.state = {}
            self.error = why
            if ser is not None:
                try:
                    ser.close()
                except Exception:
                    pass
        self._say("board", f"Relay board (Uno) disconnected: {why}")

    def _read_json(self) -> Optional[dict]:
        raw = self.ser.readline()
        if not raw:
            return None
        text = raw.decode(errors="replace").strip() if isinstance(raw, (bytes, bytearray)) else str(raw).strip()
        if not text.startswith("{"):
            return None
        try:
            msg = json.loads(text)
        except ValueError:
            return None
        if is_state(msg):
            self.state = {str(d): bool(v) for d, v in msg.items()}
        return msg

    def _exchange(self, command: str, timeout: float = REPLY_S) -> Optional[dict]:
        """Write one command; the first state or error line that comes back."""
        try:
            self.ser.reset_input_buffer()
            self.ser.write((command + "\n").encode())
            deadline = time.monotonic() + timeout
            while time.monotonic() < deadline:
                msg = self._read_json()
                if msg is not None and ("error" in msg or is_state(msg)):
                    return msg
        except Exception as e:                       # unplugged mid-command
            self._drop(f"the USB link broke ({e})")
        return None

    # ------------------------------------------------------------- commands
    def set(self, device: str, on: bool) -> tuple[bool, str]:
        """Switch one relay. (confirmed, what happened): confirmed only when the
        Uno's reply shows the device in the asked state."""
        if not device or not device.replace("_", "").isalnum() or len(device) > 12:
            return False, f"no relay for {device!r}"
        with self._lock:
            if self.ser is None and not self.connect():
                return False, self.error or "relay board not connected"
            if self.state and device not in self.state:
                return False, (f"the board has no {device} channel (firmware {self.version or '?'} has "
                               f"{', '.join(self.state)}); add it to uno_relay.ino's pin table and flash 1.1.0")
            reply = self._exchange(f"{device} {'on' if on else 'off'}")
            if reply is not None and "error" in reply and "too fast" in str(reply["error"]):
                self.sleep(0.3)                      # firmware: one flip per relay per 250 ms
                reply = self._exchange(f"{device} {'on' if on else 'off'}")
            if reply is None:
                return False, self.error or "the relay board did not answer"
            if "error" in reply:
                return False, f"the relay board said: {reply['error']}"
            ok = self.state.get(device) == on
            return ok, ("" if ok else f"the board reports {device} {'on' if self.state.get(device) else 'off'}")

    def refresh(self) -> Optional[dict]:
        with self._lock:
            if self.ser is None:
                return None
            return self._exchange("status")

    # ------------------------------------------------------------- watcher
    def start(self) -> None:
        if self._thread is not None and self._thread.is_alive():
            return
        self._stop.clear()
        self._thread = threading.Thread(target=self._watch, name="uno-relays", daemon=True)
        self._thread.start()

    def stop(self) -> None:
        self._stop.set()
        with self._lock:
            if self.ser is not None:
                try:
                    self.ser.close()
                except Exception:
                    pass
                _claim(self.port, False)
                self.ser = None

    def _watch(self) -> None:
        while not self._stop.is_set():
            if self.ser is None:
                if self.connect() and self.on_connect is not None:
                    try:
                        self.on_connect()
                    except Exception:
                        pass
                self._stop.wait(RETRY_S)
                continue
            if self.refresh() is None and self.ser is not None:
                self._drop("the board stopped answering")
            self._stop.wait(KEEPALIVE_S)

    def view(self) -> dict:
        return {"connected": self.connected, "port": self.port, "version": self.version,
                "pins": dict(self.pins), "channels": list(self.state), "state": dict(self.state),
                "error": self.error}


def enabled() -> bool:
    return os.environ.get("JARVIS_UNO", "1") != "0"
