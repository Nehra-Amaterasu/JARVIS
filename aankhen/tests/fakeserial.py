"""Fake USB serial devices for the board-identification and hot-plug tests (no hardware).

A FakeBoard is what sits behind a COM number. Every open() hands out a FakeSerial,
which delivers what the board sends AFTER that moment — bytes sent while no program
had the port open are lost, as on the ESP32's native USB:
    "esp32"   a STATUS frame every period_s (the firmware's 1 Hz health report), from
              `talks_at` on; silent before that, like a board still joining Wi-Fi.
              radar=True adds one LD2450 frame per STATUS, through the RADAR type.
    "uno"     a line of text every 0.1 s (an Arduino sketch's Serial.println)
    "silent"  nothing
    "busy"    open() fails the way Windows says a port is held by another program
A port is exclusive, as on Windows: a second open while one is held fails as busy.
Every open and every written byte is recorded, so a test can prove that the Uno was
never sent a thing.
"""
from __future__ import annotations

import json
import math
import threading
import time
import types

from aankhen.boards import BoardFinder
from aankhen.protocol import Frame, FrameType
from aankhen.radar import build_frame

BUSY = "could not open port '{}': PermissionError(13, 'Access is denied.', None, 5)"


class FakeBoard:
    def __init__(self, device: str, kind: str = "esp32", vid=0x1A86, pid=0x7523,
                 talks_at: float = 0.0, period_s: float = 0.2, fw: str = "aankhen-3.1.0",
                 radar: bool = False):
        self.device, self.kind, self.vid, self.pid = device, kind, vid, pid
        self.talks_at = talks_at              # time.monotonic() from which an esp32 talks
        self.period_s = period_s
        self.fw = fw
        self.radar = radar
        self.plugged = True
        self.opens = 0
        self.written = bytearray()
        self.held = 0
        self.first_frame_at = None            # monotonic time the first frame was delivered
        self._seq = 0
        self._lock = threading.Lock()

    def info(self):
        """What pyserial's list_ports.comports() shows for it."""
        return types.SimpleNamespace(device=self.device, vid=self.vid, pid=self.pid,
                                     description=f"fake {self.kind}", serial_number=None)

    def open(self, baud: int):
        if not self.plugged:
            raise OSError(f"could not open port '{self.device}': FileNotFoundError(2)")
        with self._lock:
            if self.kind == "busy" or self.held:
                raise OSError(BUSY.format(self.device))
            self.opens += 1
            self.held += 1
        return FakeSerial(self)

    def frames(self) -> bytes:
        self._seq += 1
        body = json.dumps({"fw": self.fw, "uptime_s": round(time.monotonic(), 1),
                           "relays": {"light": False, "fan": False}}).encode()
        out = Frame(FrameType.STATUS, self._seq & 0xFFFF, int(time.monotonic() * 1e6), body).encode()
        if self.radar:
            out += Frame(FrameType.RADAR, self._seq & 0xFFFF, int(time.monotonic() * 1e6),
                         build_frame([])).encode()
        return out


class FakeSerial:
    def __init__(self, board: FakeBoard):
        self.b = board
        self.closed = False
        opened = time.monotonic()
        # The board's own schedule: frame k leaves at talks_at + k * period_s.
        self.k = max(0, math.ceil((opened - board.talks_at) / board.period_s))
        self.next_text = opened

    def read(self, n: int) -> bytes:
        if self.closed:
            raise OSError("port is closed")
        if not self.b.plugged:
            raise OSError("ClearCommError failed (device disconnected)")
        now = time.monotonic()
        b = self.b
        if b.kind == "esp32":
            due = b.talks_at + self.k * b.period_s
            if now >= due:
                self.k = max(self.k + 1, math.ceil((now - b.talks_at) / b.period_s))
                if b.first_frame_at is None:
                    b.first_frame_at = now
                return b.frames()
        elif b.kind == "uno" and now >= self.next_text:
            self.next_text = now + 0.1
            return b"temp=24.5C relay=off\r\n"
        time.sleep(0.01)                       # pyserial's read timeout
        return b""

    def write(self, data: bytes) -> int:
        if self.closed or not self.b.plugged:
            raise OSError("WriteFile failed")
        self.b.written += data
        return len(data)

    def flush(self) -> None:
        pass

    def close(self) -> None:
        if not self.closed:
            self.closed = True
            with self.b._lock:
                self.b.held -= 1


class FakeUsb:
    """The USB bus: which boards are plugged in, and how to open them."""

    def __init__(self, *boards: FakeBoard):
        self.boards = {b.device: b for b in boards}

    def plug(self, board: FakeBoard) -> FakeBoard:
        board.plugged = True
        self.boards[board.device] = board
        return board

    def unplug(self, device: str) -> None:
        self.boards[device].plugged = False

    def comports(self):
        return [b.info() for b in self.boards.values() if b.plugged]

    def opener(self, device: str, baud: int = 921_600):
        b = self.boards.get(device)
        if b is None:
            raise OSError(f"could not open port '{device}': FileNotFoundError(2)")
        return b.open(baud)

    def finder(self, **kw) -> BoardFinder:
        return BoardFinder(comports=self.comports, opener=self.opener, **kw)
