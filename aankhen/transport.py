"""Byte sources for Aankhen: the live board (USB serial, or Wi-Fi since firmware 3.5.0),
recorded replay, and simulation.

SerialSource and NetSource are the same board over two links: both deliver its AK
frames (NetSource unwraps them from authenticated UDP datagrams, netlink.py), both
take relay commands through write(), and both say "hardware". `link` tells them apart.

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

import ipaddress
import json
import os
import queue
import socket
import struct
import threading
import time
from dataclasses import dataclass, field
from typing import Callable, Iterator, Optional

from .protocol import FrameType, StreamDecoder, decode_packet

# USB-serial chips by vendor id. A HINT, never an identification: it orders the
# probes and describes a port. What a board IS comes from what it says (boards.py):
# the CH340 is on ESP32 dev boards and on every cheap Arduino Uno clone alike, and an
# Arduino Nano ESP32 is an ESP32-S3 behind Arduino's own id. Bluetooth "serial ports"
# (COM3-COM6 on this laptop) have no USB id and are left out: opening one just hangs.
USB_SERIAL_CHIPS = {
    0x303A: "Espressif native USB (ESP32-S3 USB-Serial-JTAG)",
    0x10C4: "Silicon Labs CP210x USB-UART bridge",
    0x1A86: "WCH CH340 / CH343 USB-UART bridge",
    0x0403: "FTDI USB-UART bridge",
    0x2341: "Arduino (ATmega16U2 or native USB)",
    0x2A03: "Arduino.org board",
}
# Probe order: the native Espressif port first (no bridge chip: almost surely an
# ESP32), then the bridges ESP32 dev boards use, then Arduino's ids, then the rest.
_HINT_RANK = {0x303A: 0, 0x10C4: 1, 0x1A86: 1, 0x0403: 1, 0x2341: 2, 0x2A03: 2}
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
    serial_number: Optional[str] = None

    @property
    def hint_rank(self) -> int:
        if self.vid is None:
            return 4
        return _HINT_RANK.get(self.vid, 3)

    @property
    def key(self) -> tuple:
        """Identity while plugged in: a different device on the same COM number is a
        different key (a CH340 has no serial number, so the ids carry it)."""
        return (self.device, self.vid, self.pid, self.serial_number)

    def __str__(self) -> str:
        ids = f"{self.vid:04X}:{self.pid:04X}" if self.vid is not None else "no USB id"
        return f"{self.device}  [{ids}]  {self.chip or self.description}"


# Arduino LLC / Arduino SRL USB vendor ids: an Uno or Mega, never an Aankhen ESP32 ...
ARDUINO_VIDS = {0x2341, 0x2A03}
# ... except Arduino's own ESP32 boards, which carry Arduino's vendor id (Nano ESP32).
ARDUINO_ESP32_PIDS = {0x0070}
# Ports another owner holds (the Uno relay transport registers its port here).
CLAIMED_PORTS: set[str] = set()


def list_candidate_ports(include_all: bool = False, comports: Optional[Callable] = None) -> list[PortCandidate]:
    """Every USB serial port, the likeliest ESP32 first. Listing opens nothing.

    This is not an identification (see boards.py); include_all adds the ports with
    no USB id. `comports` replaces pyserial's list_ports.comports (tests).
    """
    if comports is None:
        from serial.tools import list_ports
        comports = list_ports.comports
    out = []
    for p in comports():
        vid = getattr(p, "vid", None)
        if vid is None and not include_all:
            continue
        # The Uno relay board belongs to the app's Uno transport (jarvis_app/uno.py).
        # Opening an Uno's port pulses DTR, its reset line, which drops both relays:
        # never probe an Arduino AVR id, nor any port the transport has claimed.
        pid = getattr(p, "pid", None)
        if (vid in ARDUINO_VIDS and pid not in ARDUINO_ESP32_PIDS) or p.device in CLAIMED_PORTS:
            continue
        out.append(PortCandidate(p.device, vid, getattr(p, "pid", None), getattr(p, "description", "") or "",
                                 USB_SERIAL_CHIPS.get(vid, ""), getattr(p, "serial_number", None)))
    out.sort(key=lambda c: (c.hint_rank, c.device))
    return out


def open_serial(port: str, baud: int = DEFAULT_BAUD, timeout: float = 0.05):
    """Open a port without resetting what is behind it, as far as the host can.

    Opening an ESP32 port with DTR/RTS asserted can reset the chip or drop it into the
    bootloader, and DTR is an Uno's reset line: deassert both BEFORE opening. (Some
    Windows CH340 drivers still pulse DTR at open; boards.py probes sparingly for it.)
    """
    import serial
    ser = serial.Serial()
    ser.port, ser.baudrate, ser.timeout = port, baud, timeout
    ser.dtr = False
    ser.rts = False
    ser.open()
    return ser


def find_esp32_port(force: bool = False) -> Optional[str]:
    """The port of a board that has SAID it is an Aankhen board (boards.py), or None.

    force asks every port again (a person pressed a button); otherwise ports that
    already answered "not Aankhen" are left alone."""
    from .boards import default_finder
    return default_finder().find(force=force)


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

    link: Optional[str] = None      # "usb" | "wifi" for a live board; None otherwise

    def __init__(self, max_queue: int = 5000):
        self.decoder = StreamDecoder()
        self.stats = SourceStats()
        self.packets: "queue.Queue" = queue.Queue(maxsize=max_queue)
        self.queue_overflows = 0
        self._stop = threading.Event()
        self._thread: Optional[threading.Thread] = None
        self._recorder: Optional["Recorder"] = None
        # The board's last STATUS, as it ARRIVED (not when the engine got round to it):
        # a relay switch is confirmed from these (hub.set_relay). `epoch` counts the
        # link's (re)connects, so a report from before a reconnect is never taken as
        # the board's word about now.
        self.epoch = 0
        self.last_status: Optional[dict] = None
        # time.perf_counter(), not monotonic(): on Windows monotonic() ticks every 15.6 ms,
        # so a command's answer and the STATUS just before it could share a timestamp.
        self.last_status_at: Optional[float] = None
        self.last_status_epoch = -1
        self.status_count = 0                             # STATUS frames seen, ever
        self._status_cond = threading.Condition()

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

    def stop_recording(self) -> None:
        rec, self._recorder = self._recorder, None
        if rec:
            rec.close()

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
        if frame.type == FrameType.STATUS:
            with self._status_cond:
                self.last_status = getattr(pkt, "fields", None)
                self.last_status_at = time.perf_counter()
                self.last_status_epoch = self.epoch
                self.status_count += 1
                self._status_cond.notify_all()
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

    def wait_status(self, after: float, timeout: float,
                    pred: Optional[Callable[[dict], bool]] = None) -> Optional[dict]:
        """The first STATUS that arrives at or after `after` (time.perf_counter()) on the
        current connection and satisfies `pred` (any, without one), waiting up to
        `timeout` s; None if none did."""
        deadline = time.perf_counter() + timeout
        seen = None
        with self._status_cond:
            while True:
                at = self.last_status_at
                if (self.last_status is not None and at is not None and at >= after and self.status_count != seen
                        and self.last_status_epoch == self.epoch):
                    seen = self.status_count
                    st = dict(self.last_status)
                    if pred is None or pred(st):
                        return st
                left = deadline - time.perf_counter()
                if left <= 0:
                    return None
                self._status_cond.wait(min(left, 0.1))

    def fresh_status(self) -> Optional[dict]:
        """The last STATUS of the current connection, or None (none since it (re)connected)."""
        with self._status_cond:
            if self.last_status is None or self.last_status_epoch != self.epoch:
                return None
            return dict(self.last_status)

    def _new_epoch(self) -> None:
        with self._status_cond:
            self.epoch += 1

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
    """Live ESP32 over USB serial, with auto-detection and auto-reconnect.

    `connected` means the HANDSHAKE: this connection has delivered at least one
    CRC-valid frame from the board. Until then nothing is written to the port — not
    on the strength of a USB vendor id, nor of an earlier probe — so whatever else is
    behind a COM number (an Arduino Uno) never receives an Aankhen frame.
    """

    kind = "hardware"
    link = "usb"
    # Longer than the firmware's Wi-Fi join (setup() blocks up to 20 s, silent): an
    # auto-picked port that says nothing for this long is let go and looked at again.
    HANDSHAKE_TIMEOUT_S = 30.0

    def __init__(self, port: Optional[str] = None, baud: int = DEFAULT_BAUD,
                 reconnect_s: float = 2.0, on_status: Optional[Callable[[str], None]] = None,
                 opener: Optional[Callable] = None, finder=None,
                 handshake_timeout_s: Optional[float] = None):
        super().__init__()
        self.requested_port = port
        self.port: Optional[str] = None
        self.baud = baud
        self.reconnect_s = reconnect_s
        self.on_status = on_status or (lambda msg: None)
        self.opener = opener or open_serial
        self.finder = finder                   # boards.BoardFinder; None -> the process-wide one
        self.handshake_timeout_s = (self.HANDSHAKE_TIMEOUT_S if handshake_timeout_s is None
                                    else handshake_timeout_s)
        self.connected = threading.Event()     # the handshake, see the class docstring
        self.handshake_at: Optional[float] = None
        self.opened_at: Optional[float] = None
        self.fw: Optional[str] = None
        self._ser = None
        self._write_lock = threading.Lock()

    def write(self, data: bytes) -> bool:
        """Send bytes to the board (host -> device commands). False unless the board on
        the current connection has identified itself (see the class docstring).

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

    def _boards(self):
        if self.finder is None:
            from .boards import default_finder
            self.finder = default_finder()
        return self.finder

    def _open(self):
        port = self.requested_port or self._boards().find()
        if not port:
            raise OSError("no Aankhen board answered on USB (plugged in with a DATA cable, and flashed?)")
        ser = self.opener(port, self.baud)
        self.port = port
        return ser

    def _emit(self, frame) -> None:
        if frame.type != FrameType.COMMAND:            # the board speaking, not an echo of us
            if frame.type == FrameType.STATUS:
                from .boards import status_fw
                self.fw = status_fw(frame) or self.fw
            if not self.connected.is_set():
                self.handshake_at = time.time()
                self.connected.set()
                took = time.monotonic() - self.opened_at if self.opened_at else 0.0
                self.on_status(f"handshake on {self.port}: {frame.type.name} frame, CRC ok, "
                               f"{took:.1f} s after opening")
        super()._emit(frame)

    def _run(self) -> None:
        while not self._stop.is_set():
            try:
                ser = self._open()
            except Exception as e:           # OSError/SerialException, or a driver's own
                self.on_status(f"waiting for ESP32: {e}")
                self._stop.wait(self.reconnect_s)
                continue
            self.stats.connects += 1
            boards = self._boards()
            boards.claim(self.port, self)
            self.connected.clear()
            self._new_epoch()
            self.opened_at = time.monotonic()
            with self._write_lock:
                self._ser = ser
            self.on_status(f"opened {self.port}; waiting for the board's first frame")
            auto = self.requested_port is None
            try:
                while not self._stop.is_set():
                    data = ser.read(4096)
                    if data:
                        self._ingest(data)
                    if (auto and not self.connected.is_set()
                            and time.monotonic() - self.opened_at > self.handshake_timeout_s):
                        self.on_status(f"{self.port} sent no Aankhen frame in "
                                       f"{self.handshake_timeout_s:.0f} s; letting it go")
                        boards.forget(self.port)
                        break
            except Exception as e:           # unplugged, driver error, etc.
                self.on_status(f"disconnected: {e}")
                self.stats.disconnects += 1
            finally:
                self.connected.clear()
                with self._write_lock:
                    self._ser = None
                boards.release(self.port, self)
                try:
                    ser.close()
                except Exception:
                    pass
            self._stop.wait(self.reconnect_s)


# ------------------------------------------------------------------ Wi-Fi
@dataclass
class NetStats:
    hellos: int = 0               # HELLOs sent
    handshakes: int = 0           # WELCOMEs verified: sessions begun
    datagrams: int = 0            # DATA datagrams verified
    bad_tag: int = 0              # failed HMAC: wrong key, or altered on the way
    foreign: int = 0              # not ours: another sender, an old session, a stray WELCOME
    commands: int = 0             # CMD datagrams sent
    timeouts: int = 0             # sessions ended because the board went quiet
    rtt_ms: Optional[float] = None    # HELLO -> WELCOME, the last handshake


_DNS_FAILED: dict[str, float] = {}       # name -> when it last failed (time.monotonic())
DNS_RETRY_S = 30.0                       # an mDNS miss can take seconds on Windows: not every look


def _default_resolve(name: str) -> list[str]:
    """IPv4 addresses for a name: an address as it is, a host name (aankhen.local:
    Windows 10+ resolves mDNS names itself) through getaddrinfo. A name that failed is
    not asked again for DNS_RETRY_S, so the hot-plug watcher never stalls on it."""
    try:
        ipaddress.IPv4Address(name)
        return [name]
    except ValueError:
        pass
    if time.monotonic() - _DNS_FAILED.get(name, -1e9) < DNS_RETRY_S:
        return []
    try:
        infos = socket.getaddrinfo(name, None, socket.AF_INET, socket.SOCK_DGRAM)
    except OSError:
        _DNS_FAILED[name] = time.monotonic()
        return []
    _DNS_FAILED.pop(name, None)
    return list(dict.fromkeys(i[4][0] for i in infos))


def _udp_socket(host: str, port: int) -> socket.socket:
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    if hasattr(socket, "SIO_UDP_CONNRESET"):
        # Windows: an ICMP "port unreachable" (the board rebooting) would otherwise make
        # the NEXT recvfrom raise ConnectionResetError on this socket.
        try:
            s.ioctl(socket.SIO_UDP_CONNRESET, False)
        except (OSError, ValueError):
            pass
    s.bind((host, port))
    s.settimeout(0.05)
    return s


def _hello_round(sock: socket.socket, key: bytes, ips: list[str], board_port: int, wait_s: float,
                 stop: Optional[threading.Event] = None, stats: Optional[NetStats] = None):
    """HELLO to every address at once; the first verified WELCOME that echoes the nonce
    sent to ITS sender. (ip, sender, datagram, host_nonce, rtt_ms) or None."""
    from . import netlink as nl
    nonces = {}
    t0 = time.perf_counter()                    # monotonic() ticks every 15.6 ms on Windows
    for ip in ips:
        nonces[ip] = os.urandom(nl.NONCE_SIZE)
        try:
            sock.sendto(nl.hello(key, nonces[ip]), (ip, board_port))
            if stats is not None:
                stats.hellos += 1
        except OSError:
            continue
    deadline = t0 + wait_s
    while time.perf_counter() < deadline and not (stop is not None and stop.is_set()):
        try:
            data, addr = sock.recvfrom(2048)
        except (socket.timeout, BlockingIOError, ConnectionResetError):
            continue
        except OSError:
            break
        nonce = nonces.get(addr[0])
        try:
            if nonce is None:
                raise nl.LinkError("not an address we greeted")
            d = nl.verify(key, data)
            if d.kind != nl.Kind.WELCOME:
                raise nl.LinkError("not a WELCOME")
            hn, _bn, _fw = nl.parse_welcome(d.payload)
            if hn != nonce:
                raise nl.LinkError("a WELCOME for another HELLO (a replay, or an old one)")
        except nl.LinkError as e:
            if stats is not None:
                if "bad tag" in str(e):
                    stats.bad_tag += 1
                else:
                    stats.foreign += 1
            continue
        return addr[0], addr, d, nonce, round((time.perf_counter() - t0) * 1000, 2)
    return None


def probe_board(key: bytes, addresses: list, board_port: Optional[int] = None,
                host_port: Optional[int] = None, wait_s: float = 1.0,
                resolver: Optional[Callable[[str], list[str]]] = None) -> Optional[dict]:
    """Is the board on Wi-Fi, and does it know the key? One HELLO round, no session:
    {"ip", "fw", "rtt_ms"} or None. The board drops the half-open session after 3 s."""
    from . import netlink as nl
    board_port = nl.BOARD_PORT if board_port is None else board_port
    host_port = nl.HOST_PORT if host_port is None else host_port
    ips = _resolve_all(addresses, resolver or _default_resolve)
    if not ips:
        return None
    try:
        sock = _udp_socket("0.0.0.0", host_port)
    except OSError:
        sock = _udp_socket("0.0.0.0", 0)          # the port is in use (a NetSource has it)
    try:
        got = _hello_round(sock, key, ips, board_port, wait_s)
    finally:
        sock.close()
    if got is None:
        return None
    ip, _addr, d, _hn, rtt = got
    return {"ip": ip, "fw": nl.parse_welcome(d.payload)[2] or None, "rtt_ms": rtt}


def _resolve_all(names: list, resolver: Callable[[str], list[str]]) -> list[str]:
    out = []
    for n in names or []:
        try:
            out += resolver(str(n))
        except (OSError, UnicodeError, ValueError):
            continue
    return list(dict.fromkeys(out))


class NetSource(Source):
    """The board over Wi-Fi: AK frames in authenticated UDP datagrams (netlink.py).

    The same contract as SerialSource: `kind` "hardware", `connected` is the handshake
    (a verified WELCOME, then the board's first DATA), `write()` sends a command and
    returns False while there is no session. Frames go through the same decoder,
    recorder and engine; `link` is "wifi".

    Timing: the frames carry the board's own esp_timer microseconds (protocol.py
    TIMESTAMP), and the engine times everything by those. A datagram's arrival time
    jitters by milliseconds on Wi-Fi and comes in batches of ~8 frames; it is used only
    for liveness and as the recorder's chunk time, as on USB.
    """

    kind = "hardware"
    link = "wifi"
    HELLO_WAIT_S = 1.0
    KEEPALIVE_S = 1.0          # the board ends a session after 10 s without one
    TIMEOUT_S = 5.0            # the board sends STATUS every second even with CSI paused
    NEGATIVE_DNS_S = 30.0      # a name that did not resolve is not asked again for this long

    def __init__(self, key: bytes, addresses, board_port: Optional[int] = None,
                 host_port: Optional[int] = None, bind_host: str = "0.0.0.0", reconnect_s: float = 1.0,
                 on_status: Optional[Callable[[str], None]] = None,
                 on_peer: Optional[Callable[[str], None]] = None,
                 resolver: Optional[Callable[[str], list[str]]] = None,
                 keepalive_s: Optional[float] = None, timeout_s: Optional[float] = None,
                 hello_wait_s: Optional[float] = None, reorder_wait_s: float = 0.05):
        from . import netlink as nl
        super().__init__()
        if not isinstance(key, (bytes, bytearray)) or len(key) != nl.KEY_SIZE:
            raise ValueError("the link key is 32 bytes")
        self.key = bytes(key)
        self._addresses = addresses
        self.board_port = nl.BOARD_PORT if board_port is None else board_port
        self.host_port = nl.HOST_PORT if host_port is None else host_port
        self.bind_host = bind_host
        self.reconnect_s = reconnect_s
        self.on_status = on_status or (lambda msg: None)
        self.on_peer = on_peer
        self.resolver = resolver or _default_resolve
        self.keepalive_s = self.KEEPALIVE_S if keepalive_s is None else keepalive_s
        self.timeout_s = self.TIMEOUT_S if timeout_s is None else timeout_s
        self.hello_wait_s = self.HELLO_WAIT_S if hello_wait_s is None else hello_wait_s
        self.reorder_wait_s = reorder_wait_s
        self.connected = threading.Event()
        self.port: Optional[str] = None          # no serial port: hub.info()["port"] stays None
        self.address: Optional[str] = None       # the board's IP: the session's, else the last one
        self.bound_port: Optional[int] = None    # the UDP port this laptop listens on
        self.handshake_at: Optional[float] = None
        self.fw: Optional[str] = None
        self.note: Optional[str] = None
        self.net = NetStats()
        self.reorder = None
        self._sock: Optional[socket.socket] = None
        self._lock = threading.Lock()            # the session, its counter, and sending
        self._session: Optional[tuple] = None    # (session id, session key, (ip, port))
        self._tx = 0
        self._dns_fail: dict[str, float] = {}

    # ------------------------------------------------------------ public
    def addresses(self) -> list[str]:
        a = self._addresses() if callable(self._addresses) else self._addresses
        return [str(x) for x in (a or []) if x]

    def write(self, data: bytes) -> bool:
        """One AK COMMAND frame to the board, in a CMD datagram. False without a session."""
        from . import netlink as nl
        if not self.connected.is_set():
            return False
        ok = self._send(nl.Kind.CMD, data)
        if ok:
            self.net.commands += 1
        return ok

    def link_info(self) -> dict:
        r = self.reorder.stats if self.reorder is not None else None
        n = self.net
        return {"address": self.address, "board_port": self.board_port, "host_port": self.bound_port or self.host_port,
                "session": self._session is not None, "handshakes": n.handshakes, "hellos": n.hellos,
                "datagrams": n.datagrams, "bad_tag": n.bad_tag, "foreign": n.foreign, "commands": n.commands,
                "timeouts": n.timeouts, "rtt_ms": n.rtt_ms,
                "lost": r.lost if r else 0, "late": r.late if r else 0, "duplicate": r.duplicate if r else 0,
                "reordered": r.reordered if r else 0}

    def stop(self) -> None:
        from . import netlink as nl
        if self._session is not None:
            self._send(nl.Kind.BYE)              # the board lets the session go at once
        super().stop()

    # ------------------------------------------------------------ internals
    def _say(self, msg: str) -> None:
        self.note = msg
        self.on_status(msg)

    def _resolve(self, names: list[str]) -> list[str]:
        now = time.monotonic()
        live = [n for n in names if now - self._dns_fail.get(n, -1e9) >= self.NEGATIVE_DNS_S]
        out = []
        for n in live:
            try:
                got = self.resolver(n)
            except (OSError, UnicodeError, ValueError):
                got = []
            if not got:
                self._dns_fail[n] = now
            out += got
        return list(dict.fromkeys(out))

    def _send(self, kind, payload: bytes = b"") -> bool:
        from . import netlink as nl
        with self._lock:
            if self._session is None or self._sock is None:
                return False
            sid, ks, peer = self._session
            self._tx += 1
            try:
                self._sock.sendto(nl.pack(ks, kind, sid, self._tx, payload), peer)
                return True
            except OSError:
                return False

    def _emit(self, frame) -> None:
        if frame.type != FrameType.COMMAND:
            if frame.type == FrameType.STATUS:
                from .boards import status_fw
                self.fw = status_fw(frame) or self.fw
            if not self.connected.is_set():
                self.handshake_at = time.time()
                self.connected.set()
        super()._emit(frame)

    def _run(self) -> None:
        while not self._stop.is_set():
            try:
                sock = _udp_socket(self.bind_host, self.host_port)
            except OSError as e:
                self._say(f"cannot listen on UDP {self.host_port}: {e} (another JARVIS running?)")
                self._stop.wait(max(self.reconnect_s, 2.0))
                continue
            self.bound_port = sock.getsockname()[1]
            with self._lock:
                self._sock = sock
            try:
                while not self._stop.is_set():
                    if self._handshake(sock):
                        self._stream(sock)
                    else:
                        self._stop.wait(self.reconnect_s)
            finally:
                with self._lock:
                    self._sock = None
                    self._session = None
                self.connected.clear()
                try:
                    sock.close()
                except OSError:
                    pass

    def _handshake(self, sock: socket.socket) -> bool:
        from . import netlink as nl
        names = self.addresses()
        ips = self._resolve(names)
        if not ips:
            self._say("no address for the board: set it in Limbs → Firmware, or let it report its IP over USB once"
                      if not names else f"could not resolve {', '.join(names)}")
            return False
        got = _hello_round(sock, self.key, ips, self.board_port, self.hello_wait_s, self._stop, self.net)
        if got is None:
            self._say(f"no answer from {', '.join(ips)} on UDP {self.board_port} in {self.hello_wait_s:g} s "
                      "(board off or on another network, LINK_KEY_VALUE not flashed or different, or the "
                      "firewall dropped the reply)")
            return False
        ip, addr, d, host_nonce, rtt = got
        _hn, board_nonce, fw = nl.parse_welcome(d.payload)
        ks = nl.session_key(self.key, d.session, host_nonce, board_nonce)
        self._new_epoch()
        self.reorder = nl.Reorderer(wait_s=self.reorder_wait_s)
        with self._lock:
            self._session = (d.session, ks, (ip, addr[1]))
            self._tx = 0
        self._send(nl.Kind.READY)
        self.address = ip
        self.fw = fw or self.fw
        self.net.handshakes += 1
        self.net.rtt_ms = rtt
        self.stats.connects += 1
        self._say(f"handshake with {ip}: WELCOME verified (HMAC-SHA256){', ' + fw if fw else ''}, {rtt:g} ms")
        if self.on_peer is not None:
            try:
                self.on_peer(ip)
            except Exception:
                pass
        return True

    def _stream(self, sock: socket.socket) -> None:
        from . import netlink as nl
        sid, ks, peer = self._session
        now = time.monotonic()
        last_rx = last_ka = now
        while not self._stop.is_set():
            now = time.monotonic()
            if now - last_ka >= self.keepalive_s:
                self._send(nl.Kind.KEEPALIVE)
                last_ka = now
            for p in self.reorder.poll():
                self._ingest(p)
            if now - last_rx >= self.timeout_s:
                self.net.timeouts += 1
                self.stats.disconnects += 1
                self._say(f"the board at {peer[0]} went quiet ({self.timeout_s:g} s without a verified "
                          "datagram); greeting it again")
                break
            try:
                data, addr = sock.recvfrom(2048)
            except (socket.timeout, BlockingIOError, ConnectionResetError):
                continue
            except OSError as e:
                self._say(f"UDP receive failed: {e}")
                break
            if addr[0] != peer[0]:
                self.net.foreign += 1
                continue
            try:
                d = nl.peek(data)
                if d.kind != nl.Kind.DATA or d.session != sid:
                    raise nl.LinkError("not this session's DATA")
            except nl.LinkError:
                self.net.foreign += 1
                continue
            try:
                nl.verify(ks, data)
            except nl.LinkError:
                self.net.bad_tag += 1
                continue
            last_rx = now
            self.net.datagrams += 1
            for p in self.reorder.push(d.counter, d.payload):
                self._ingest(p)
        with self._lock:
            self._session = None
        self.connected.clear()


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
