"""Which serial port is the Aankhen board — decided by what the board SAYS.

THE PROBLEM (ROADMAP F3)
Ports used to be picked by USB vendor id. The CH340 bridge (0x1A86) sits on many
ESP32 dev boards and on every cheap Arduino Uno clone, so an Uno plugged in beside
(or instead of) the ESP32 was "the ESP32": it would have been auto-selected, and the
relay COMMAND frames meant for the ESP32 written to it.

THE RULE
A port is an Aankhen board only after a CRC-valid Aankhen frame (protocol.py: SYNC,
version, a known type with a sane length, CRC-16) has been READ from it. The firmware
sends a STATUS frame every second, and 100 CSI frames a second once Wi-Fi is up, so
listening for PROBE_WINDOW_S is enough. Nothing is ever written while probing. The
vendor id stays, as a hint only: it orders the probes and describes the port.

A probe is not a licence to write, either. SerialSource refuses to send anything on a
connection until that connection itself has delivered a valid frame, so even a port
swapped between a probe and the open (same COM number, another device) is safe.

Why there is no HELLO frame type: the board's native USB port drops whatever is sent
while no program has the port open, so a once-at-boot greeting would be lost exactly
when it matters (a board plugged in while the app runs). The 1 Hz STATUS frame is a
greeting that repeats, and it carries the firmware version. The firmware is unchanged.

THE COST OF LOOKING
Opening a port can reset what is behind it: on Windows a CH340 driver can pulse DTR
at open even with DTR held low, and DTR is wired to an Uno's reset pin. So a port is
probed once when it appears. A SILENT port is probed again on each look during its
first BOOT_GRACE_S (an ESP32 joining Wi-Fi sends nothing for up to 20 s: setup() in
the firmware blocks on WiFi.begin). A FOREIGN port (it talks, just not Aankhen) is
left alone until it is unplugged, or until a person asks for a fresh look
(force=True: the ESP32 button, "Scan" in the app, `python -m aankhen doctor`).

Verdicts:
    aankhen   a CRC-valid Aankhen frame arrived                     -> usable
    claimed   Aankhen's own SerialSource has it open, no frame yet
    foreign   bytes arrived, none an Aankhen frame (an Arduino sketch, another baud)
    silent    nothing arrived (an unflashed ESP32, a board still booting, an idle Arduino)
    busy      another program holds the port (Arduino IDE, a serial monitor)
    error     the port could not be opened or read for another reason
"""
from __future__ import annotations

import json
import threading
import time
from dataclasses import dataclass, field
from typing import Callable, Optional

from .protocol import Frame, FrameType, StreamDecoder
from .transport import DEFAULT_BAUD, PortCandidate, list_candidate_ports, open_serial

PROBE_WINDOW_S = 2.0      # two STATUS frames' worth; a talking board answers in < 1 s
BOOT_GRACE_S = 30.0       # a silent port is re-probed this long after it appears
SILENT_RETRY_S = 1.0      # ...but not twice in the same second by back-to-back looks
BUSY_RETRY_S = 10.0       # a port another program holds is tried again this often
FORCE_FRESH_S = 2.0       # a forced look reuses verdicts younger than this

BOARD_VERDICTS = ("aankhen",)


def status_fw(frame: Frame) -> Optional[str]:
    """The firmware version a STATUS frame reports ("aankhen-3.1.0"), if any."""
    if frame.type != FrameType.STATUS:
        return None
    try:
        fw = json.loads(frame.payload.decode("utf-8", "replace")).get("fw")
    except (ValueError, AttributeError):
        return None
    return str(fw)[:40] if fw else None


@dataclass
class ProbeResult:
    device: str
    verdict: str
    detail: str
    port: Optional[PortCandidate] = None
    bytes_read: int = 0
    frame: Optional[str] = None       # type of the first valid frame ("STATUS", "CSI", ...)
    fw: Optional[str] = None
    listened_s: float = 0.0
    at: float = field(default_factory=time.time)   # wall clock, for display
    mono: float = 0.0                 # the finder's clock, for scheduling re-probes
    in_use: bool = False              # Aankhen's own SerialSource has the port open

    @property
    def is_board(self) -> bool:
        return self.verdict in BOARD_VERDICTS

    def to_dict(self) -> dict:
        p = self.port
        return {
            "device": self.device, "verdict": self.verdict, "detail": self.detail,
            "vid": f"{p.vid:04X}" if p is not None and p.vid is not None else None,
            "pid": f"{p.pid:04X}" if p is not None and p.pid is not None else None,
            "chip": p.chip if p is not None else "",
            "description": p.description if p is not None else "",
            "bytes": self.bytes_read, "frame": self.frame, "fw": self.fw,
            "listened_s": round(self.listened_s, 2), "at": self.at, "in_use": self.in_use,
        }


def _looks_busy(e: BaseException) -> bool:
    """pyserial wraps the OS error in its message: 'PermissionError(13, Access is
    denied.)' on Windows, '[Errno 16] Device or resource busy' on Linux."""
    if isinstance(e, PermissionError):
        return True
    s = str(e).lower()
    return "access is denied" in s or "permissionerror" in s or "busy" in s


def probe_port(device: str, opener: Optional[Callable] = None, window_s: float = PROBE_WINDOW_S,
               baud: int = DEFAULT_BAUD, port: Optional[PortCandidate] = None,
               clock: Callable[[], float] = time.monotonic) -> ProbeResult:
    """Listen on one port — never write — until a valid Aankhen frame or `window_s`."""
    opener = opener or open_serial
    t0 = clock()
    try:
        ser = opener(device, baud)
    except Exception as e:                      # SerialException is an OSError; drivers raise others
        busy = _looks_busy(e)
        return ProbeResult(device, "busy" if busy else "error",
                           "another program has it open" if busy else f"could not open it: {e}",
                           port, mono=clock())
    dec = StreamDecoder()
    n = 0
    try:
        while clock() - t0 < window_s:
            try:
                data = ser.read(4096)
            except Exception as e:              # unplugged mid-probe
                return ProbeResult(device, "error", f"read failed after {n} bytes: {e}", port,
                                   bytes_read=n, listened_s=clock() - t0, mono=clock())
            if not data:
                continue
            n += len(data)
            for f in dec.feed(data):
                if f.type == FrameType.COMMAND:
                    continue                    # host -> device; a board never says this
                took = clock() - t0
                fw = status_fw(f)
                return ProbeResult(device, "aankhen",
                                   f"{f.type.name} frame, CRC ok, after {took:.1f} s"
                                   + (f" · {fw}" if fw else ""),
                                   port, bytes_read=n, frame=f.type.name, fw=fw,
                                   listened_s=took, mono=clock())
    finally:
        try:
            ser.close()
        except Exception:
            pass
    took = clock() - t0
    if n == 0:
        return ProbeResult(device, "silent", f"sent nothing in {took:.1f} s", port,
                           listened_s=took, mono=clock())
    return ProbeResult(device, "foreign",
                       f"sent {n} bytes in {took:.1f} s, none of them an Aankhen frame",
                       port, bytes_read=n, listened_s=took, mono=clock())


class BoardFinder:
    """Remembers what every USB serial port said, and asks again only when worth it.

    One finder per process (default_finder()): the hub, its SerialSource, the hot-plug
    watcher and the Connect page share it, so a port is opened by one of them at a
    time and a verdict found by one is seen by all.
    """

    def __init__(self, comports: Optional[Callable] = None, opener: Optional[Callable] = None,
                 window_s: float = PROBE_WINDOW_S, boot_grace_s: float = BOOT_GRACE_S,
                 busy_retry_s: float = BUSY_RETRY_S, silent_retry_s: float = SILENT_RETRY_S,
                 force_fresh_s: float = FORCE_FRESH_S, clock: Callable[[], float] = time.monotonic):
        self.comports = comports              # None -> pyserial's list_ports.comports
        self.opener = opener or open_serial
        self.window_s = window_s
        self.boot_grace_s = boot_grace_s
        self.busy_retry_s = busy_retry_s
        self.silent_retry_s = silent_retry_s
        self.force_fresh_s = force_fresh_s
        self.clock = clock
        self._first_seen: dict[tuple, float] = {}
        self._results: dict[tuple, ProbeResult] = {}
        self._claims: dict[str, object] = {}  # device -> the SerialSource holding it
        self._ports: list[PortCandidate] = []
        self._scan_lock = threading.Lock()    # one look at a time
        self._lock = threading.Lock()         # claims and cached state
        self.last_scan_at: Optional[float] = None
        self.probes = 0                       # ports opened so far: the disturbance we cause

    # ------------------------------------------------------------ claims
    def claim(self, device: str, source) -> None:
        """Our own SerialSource has `device` open: never probe it (it would read as busy)."""
        with self._lock:
            self._claims[device] = source

    def release(self, device: Optional[str], source) -> None:
        with self._lock:
            if device is not None and self._claims.get(device) is source:
                del self._claims[device]

    def forget(self, device: str) -> None:
        """Drop what `device` said, as if it had just been plugged in."""
        with self._lock:
            for k in [k for k in self._results if k[0] == device]:
                self._results.pop(k, None)
                self._first_seen.pop(k, None)

    # ------------------------------------------------------------ looking
    def ports(self) -> list[PortCandidate]:
        return list_candidate_ports(comports=self.comports)

    def scan(self, force: bool = False) -> list[ProbeResult]:
        """Every USB serial port with its verdict, likeliest ESP32 first. Probes only
        the ports that are due (see the module docstring); force re-probes all of
        them except our own open port and verdicts younger than FORCE_FRESH_S."""
        with self._scan_lock:
            try:
                ports = self.ports()
            except Exception:
                ports = []                      # no pyserial, or the OS listing failed
            now = self.clock()
            live = {p.key for p in ports}
            with self._lock:
                for k in [k for k in self._first_seen if k not in live]:   # unplugged
                    self._first_seen.pop(k, None)
                    self._results.pop(k, None)
                claims = dict(self._claims)
                due = []
                for p in ports:
                    self._first_seen.setdefault(p.key, now)
                    if p.device not in claims and self._due(p, now, force):
                        due.append(p)
            if due:
                self.probes += len(due)
                probed = self._probe_all(due)
                with self._lock:
                    self._results.update(probed)
            with self._lock:
                self._ports = ports
            self.last_scan_at = time.time()
            return self.results()

    def results(self) -> list[ProbeResult]:
        """The last look, without looking again (cheap: safe on every status message)."""
        with self._lock:
            out = []
            for p in self._ports:
                src = self._claims.get(p.device)
                if src is not None:
                    out.append(self._claimed(p, src))
                elif p.key in self._results:
                    out.append(self._results[p.key])
            return out

    def find(self, force: bool = False) -> Optional[str]:
        """The first port that has said it is an Aankhen board and is not in use."""
        for r in self.scan(force):
            if r.is_board and not r.in_use:
                return r.device
        return None

    # ------------------------------------------------------------ internals
    def _due(self, p: PortCandidate, now: float, force: bool) -> bool:
        r = self._results.get(p.key)
        if r is None:
            return True                         # just plugged in (or never looked at)
        age = now - r.mono
        if force:
            return age >= self.force_fresh_s
        if r.verdict == "aankhen":
            return False                        # it said so; SerialSource re-checks on open
        if r.verdict == "silent":
            return now - self._first_seen[p.key] < self.boot_grace_s and age >= self.silent_retry_s
        if r.verdict in ("busy", "error"):
            return age >= self.busy_retry_s     # we never opened it, so asking costs nothing
        return False                            # foreign: it talks, just not Aankhen

    def _probe_all(self, ports: list[PortCandidate]) -> dict[tuple, ProbeResult]:
        """Probe in parallel: three ports take one window, not three."""
        out: dict[tuple, ProbeResult] = {}

        def run(p: PortCandidate) -> None:
            out[p.key] = probe_port(p.device, self.opener, self.window_s, port=p, clock=self.clock)

        threads = [threading.Thread(target=run, args=(p,), name=f"aankhen-probe-{p.device}", daemon=True)
                   for p in ports]
        for t in threads:
            t.start()
        for t in threads:
            t.join(self.window_s + 3.0)
        for p in ports:
            if p.key not in out:                # a driver that hung on open
                out[p.key] = ProbeResult(p.device, "error", "the probe did not finish", p,
                                         mono=self.clock())
        return out

    def _claimed(self, p: PortCandidate, src) -> ProbeResult:
        connected = getattr(src, "connected", None)
        verified = bool(connected is not None and connected.is_set())
        if verified:
            at = getattr(src, "handshake_at", None)
            ago = f" {time.time() - at:.0f} s ago" if at else ""
            fw = getattr(src, "fw", None)
            return ProbeResult(p.device, "aankhen", f"in use by Aankhen · handshake{ago}"
                               + (f" · {fw}" if fw else ""), p, fw=fw, frame="live",
                               mono=self.clock(), in_use=True)
        return ProbeResult(p.device, "claimed", "Aankhen has it open; waiting for the board's first frame",
                           p, mono=self.clock(), in_use=True)


_default: Optional[BoardFinder] = None
_default_lock = threading.Lock()


def default_finder() -> BoardFinder:
    """The process-wide finder (real ports, pyserial)."""
    global _default
    with _default_lock:
        if _default is None:
            _default = BoardFinder()
        return _default
