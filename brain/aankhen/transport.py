"""Byte sources for Aankhen: live serial, recorded replay, and simulation.

Every source produces the SAME thing — decoded packets from protocol.py — so the
processing pipeline cannot tell, and does not care, where data came from. What it
DOES carry is `kind`: "hardware", "replay" or "simulation". That tag travels with
every result to the UI and to JARVIS, so simulated data can never be presented as
a measurement. (The first-generation sensing engine did exactly that: it reported
invented heart rates in the same shape as real readings.)

RECORDING is a first-class feature, not a debugging afterthought. A recording is
the exact byte stream that came off the wire, with host arrival times. Replaying
it pushes those bytes through the same decoder, so any algorithm change can be
evaluated against identical real data — the only honest way to tune a detector.

File format (.akr — "Aankhen recording"):
  header : b"AKR1" | u32 header_json_len | header_json (utf-8)
  chunks : f64 host_time_s | u32 n | n raw bytes          (repeated)
"""
from __future__ import annotations

import json
import os
import queue
import struct
import threading
import time
from dataclasses import dataclass, field
from typing import Callable, Iterator, Optional

from .protocol import StreamDecoder, decode_packet

# USB vendor IDs of the bridges ESP32 boards use. The ESP32-S3's built-in USB
# (USB-Serial-JTAG) enumerates as Espressif 0x303A; many dev boards also carry a
# separate UART bridge chip. Bluetooth "serial ports" (COM3-COM6 on this laptop)
# have no USB VID and are excluded — opening one of those just hangs.
ESP_USB_VIDS = {
    0x303A: "Espressif native USB (ESP32-S3 USB-Serial-JTAG)",
    0x1A86: "WCH CH340 / CH343 USB-UART bridge",
    0x10C4: "Silicon Labs CP210x USB-UART bridge",
    0x0403: "FTDI USB-UART bridge",
}
DEFAULT_BAUD = 921_600     # the native USB port ignores baud; a UART bridge needs it
RECORD_MAGIC = b"AKR1"


# ------------------------------------------------------------ port discovery
@dataclass
class PortCandidate:
    device: str
    vid: Optional[int]
    pid: Optional[int]
    description: str
    chip: str

    def __str__(self) -> str:
        ids = f"{self.vid:04X}:{self.pid:04X}" if self.vid is not None else "no USB id"
        return f"{self.device}  [{ids}]  {self.chip or self.description}"


def list_candidate_ports(include_all: bool = False) -> list[PortCandidate]:
    """Serial ports that look like an ESP32, best match first."""
    from serial.tools import list_ports
    out = []
    for p in list_ports.comports():
        chip = ESP_USB_VIDS.get(p.vid, "")
        if not chip and not include_all:
            continue
        out.append(PortCandidate(p.device, p.vid, p.pid, p.description or "", chip))
    # Prefer the native Espressif port: no bridge chip, no baud limit.
    out.sort(key=lambda c: (c.vid != 0x303A, c.device))
    return out


def find_esp32_port() -> Optional[str]:
    c = list_candidate_ports()
    return c[0].device if c else None


# ------------------------------------------------------------------ sources
@dataclass
class SourceStats:
    bytes_in: int = 0
    connects: int = 0
    disconnects: int = 0
    started_at: float = field(default_factory=time.time)
    last_byte_at: float = 0.0

    def seconds_since_data(self) -> float:
        return time.time() - self.last_byte_at if self.last_byte_at else float("inf")


class Source:
    """Base: a background thread turning bytes into packets on a queue."""

    kind = "unknown"

    def __init__(self, max_queue: int = 5000):
        self.decoder = StreamDecoder()
        self.stats = SourceStats()
        self.packets: "queue.Queue" = queue.Queue(maxsize=max_queue)
        self.queue_overflows = 0
        self._stop = threading.Event()
        self._thread: Optional[threading.Thread] = None
        self._recorder: Optional["Recorder"] = None

    # -- lifecycle -------------------------------------------------------
    def start(self) -> "Source":
        self._thread = threading.Thread(target=self._run, name=f"aankhen-{self.kind}",
                                        daemon=True)
        self._thread.start()
        return self

    def stop(self) -> None:
        self._stop.set()
        if self._thread:
            self._thread.join(timeout=3)
        if self._recorder:
            self._recorder.close()

    def record_to(self, path: str, meta: Optional[dict] = None) -> "Recorder":
        self._recorder = Recorder(path, {"source": self.kind, **(meta or {})})
        return self._recorder

    # -- shared plumbing -------------------------------------------------
    def _ingest(self, data: bytes, t: Optional[float] = None) -> None:
        if not data:
            return
        now = time.time() if t is None else t
        self.stats.bytes_in += len(data)
        self.stats.last_byte_at = time.time()
        if self._recorder:
            self._recorder.write(data, now)
        for frame in self.decoder.feed(data):
            self._emit(frame)

    def _emit(self, frame) -> None:
        try:
            pkt = decode_packet(frame)
        except ValueError:
            self.decoder.stats.bad_headers += 1
            return
        try:
            self.packets.put_nowait(pkt)
        except queue.Full:
            # Never block the reader: a stalled consumer must not stall the port,
            # or the OS serial buffer overflows and we lose data invisibly.
            self.queue_overflows += 1
            try:
                self.packets.get_nowait()
                self.packets.put_nowait(pkt)
            except queue.Empty:
                pass

    def iter_packets(self, timeout: float = 0.5) -> Iterator:
        """Blocking iterator over packets until stop() — convenient for tools."""
        while not self._stop.is_set():
            try:
                yield self.packets.get(timeout=timeout)
            except queue.Empty:
                if self._finished():
                    return

    def _finished(self) -> bool:
        return self._thread is not None and not self._thread.is_alive()

    def _run(self) -> None:          # pragma: no cover - overridden
        raise NotImplementedError


class SerialSource(Source):
    """Live ESP32 over USB serial, with auto-detection and auto-reconnect."""

    kind = "hardware"

    def __init__(self, port: Optional[str] = None, baud: int = DEFAULT_BAUD,
                 reconnect_s: float = 2.0, on_status: Optional[Callable[[str], None]] = None):
        super().__init__()
        self.requested_port = port
        self.port: Optional[str] = None
        self.baud = baud
        self.reconnect_s = reconnect_s
        self.on_status = on_status or (lambda msg: None)
        self.connected = threading.Event()
        self._ser = None
        self._write_lock = threading.Lock()

    def write(self, data: bytes) -> bool:
        """Send bytes to the board (host -> device commands). False if not connected.

        The reader thread owns the port object; writes take a lock so a command
        never interleaves with a reconnect.
        """
        with self._write_lock:
            ser = self._ser
            if ser is None or not self.connected.is_set():
                return False
            try:
                ser.write(data)
                ser.flush()
                return True
            except Exception:
                return False

    def _open(self):
        import serial
        port = self.requested_port or find_esp32_port()
        if not port:
            raise OSError("no ESP32 serial port found (is it plugged in with a DATA cable?)")
        ser = serial.Serial()
        ser.port, ser.baudrate, ser.timeout = port, self.baud, 0.05
        # Opening an ESP32 port with DTR/RTS asserted can reset the chip or drop it
        # into the bootloader. Deassert both BEFORE opening.
        ser.dtr = False
        ser.rts = False
        ser.open()
        self.port = port
        return ser

    def _run(self) -> None:
        while not self._stop.is_set():
            try:
                ser = self._open()
            except OSError as e:
                self.on_status(f"waiting for ESP32: {e}")
                self._stop.wait(self.reconnect_s)
                continue
            self.stats.connects += 1
            with self._write_lock:
                self._ser = ser
            self.connected.set()
            self.on_status(f"connected on {self.port}")
            try:
                while not self._stop.is_set():
                    data = ser.read(4096)
                    if data:
                        self._ingest(data)
            except Exception as e:           # unplugged, driver error, etc.
                self.on_status(f"disconnected: {e}")
                self.stats.disconnects += 1
            finally:
                self.connected.clear()
                with self._write_lock:
                    self._ser = None
                try:
                    ser.close()
                except Exception:
                    pass
            self._stop.wait(self.reconnect_s)


class ReplaySource(Source):
    """Replays an .akr recording through the real decoder.

    speed=1.0 reproduces original timing (what the live system would have seen);
    speed=0 replays as fast as possible (for benchmarks and tests).
    """

    kind = "replay"

    def __init__(self, path: str, speed: float = 1.0, loop: bool = False):
        super().__init__(max_queue=200_000)
        self.path = path
        self.speed = speed
        self.loop = loop
        self.meta = read_recording_meta(path)

    def _run(self) -> None:
        while True:
            t0_rec = t0_wall = None
            for t, data in iter_recording(self.path):
                if self._stop.is_set():
                    return
                if self.speed > 0:
                    if t0_rec is None:
                        t0_rec, t0_wall = t, time.time()
                    delay = (t - t0_rec) / self.speed - (time.time() - t0_wall)
                    if delay > 0:
                        self._stop.wait(delay)
                self._ingest(data, t)
            for frame in self.decoder.flush():
                self._emit(frame)
            if not self.loop:
                return


class CallbackSource(Source):
    """Source fed by a generator of byte chunks (used by the simulator)."""

    def __init__(self, chunks: Callable[[], Iterator[bytes]], kind: str = "simulation",
                 realtime_hz: float = 0.0):
        super().__init__()
        self.kind = kind
        self._chunks = chunks
        self.realtime_hz = realtime_hz

    def _run(self) -> None:
        period = 1.0 / self.realtime_hz if self.realtime_hz else 0.0
        for chunk in self._chunks():
            if self._stop.is_set():
                return
            self._ingest(chunk)
            if period:
                self._stop.wait(period)
        for frame in self.decoder.flush():
            self._emit(frame)


# ------------------------------------------------------------------ recording
class Recorder:
    def __init__(self, path: str, meta: dict):
        os.makedirs(os.path.dirname(os.path.abspath(path)), exist_ok=True)
        self.path = path
        self._f = open(path, "wb")
        head = json.dumps({"created": time.time(), **meta}).encode("utf-8")
        self._f.write(RECORD_MAGIC + struct.pack("<I", len(head)) + head)
        self._lock = threading.Lock()
        self.bytes_written = 0

    def write(self, data: bytes, t: float) -> None:
        with self._lock:
            if self._f.closed:
                return
            self._f.write(struct.pack("<dI", t, len(data)) + data)
            self.bytes_written += len(data)

    def close(self) -> None:
        with self._lock:
            if not self._f.closed:
                self._f.close()


def read_recording_meta(path: str) -> dict:
    with open(path, "rb") as f:
        if f.read(4) != RECORD_MAGIC:
            raise ValueError(f"{path} is not an Aankhen recording")
        (n,) = struct.unpack("<I", f.read(4))
        return json.loads(f.read(n).decode("utf-8"))


def iter_recording(path: str) -> Iterator[tuple[float, bytes]]:
    with open(path, "rb") as f:
        if f.read(4) != RECORD_MAGIC:
            raise ValueError(f"{path} is not an Aankhen recording")
        (n,) = struct.unpack("<I", f.read(4))
        f.read(n)
        while True:
            head = f.read(12)
            if len(head) < 12:
                return
            t, size = struct.unpack("<dI", head)
            data = f.read(size)
            if len(data) < size:
                return              # truncated final chunk (recording cut off)
            yield t, data
