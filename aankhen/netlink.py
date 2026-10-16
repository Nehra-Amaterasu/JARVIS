"""The board's Wi-Fi link: the same AK frames as on USB, batched into authenticated UDP.

WHY
The ESP32-S3 moves into a box beside the switchboard on a 5 V phone charger: no USB
cable to the laptop. Its sensor frames and the relay commands have to cross the home
Wi-Fi instead, and a relay that switches mains must not obey anybody else on that Wi-Fi.

WHAT TRAVELS
Exactly the AK frames the USB link carries (protocol.py: SYNC, version, type, seq, the
board's own microsecond timestamp, payload, CRC-16), several whole frames per datagram.
NetSource (transport.py) feeds the frame bytes to the same StreamDecoder, recorder and
engine as SerialSource: nothing downstream can tell the links apart, except `link`.

DATAGRAM (little-endian; the C side is AkLink in aankhen/firmware/firmware.ino)

    offset size field
    0      4    MAGIC    b"AKN1"
    4      1    KIND     Kind below
    5      1    FLAGS    0
    6      2    LENGTH   payload bytes
    8      4    SESSION  the board's session id (0 in HELLO)
    12     8    COUNTER  per direction, per session, starts at 1 (0 in HELLO/WELCOME)
    20     N    PAYLOAD
    20+N   16   TAG      HMAC-SHA256(key, bytes [0 .. 20+N)), first 16 bytes

THE HANDSHAKE (K = the shared link key, 32 random bytes, LINK_KEY_VALUE in secrets.h)

    laptop                                   board
    HELLO    host_nonce               (K)  ->      verifies the tag; makes a PENDING session
                                           <-  WELCOME  host_nonce | board_nonce | fw   (K)
    verifies the tag and its own nonce
    Ks = HMAC(K, "AKN1 session" | session | host_nonce | board_nonce)
    READY    counter 1                (Ks) ->      the session is live; the board streams
                                           <-  DATA     counter 1, 2, 3 ...  (Ks)
    CMD      one AK COMMAND frame     (Ks) ->      switches; answers with a STATUS frame
    KEEPALIVE every second            (Ks) ->      (10 s without one: the session ends)

Replay: a replayed HELLO gets a WELCOME for a session nobody can finish (READY needs Ks,
which needs K); a replayed READY, CMD or KEEPALIVE carries a counter that is not above
the last one accepted, or a session id that is no longer current: dropped. Reflection:
every kind travels in one direction only. The board answers nothing it cannot verify, so
it is no amplifier either.
"""
from __future__ import annotations

import enum
import hashlib
import hmac
import os
import struct
import time
from collections import deque
from dataclasses import dataclass, field
from typing import Callable, Optional

from .protocol import CRC_SIZE, HEADER_FMT, HEADER_SIZE, SYNC

MAGIC = b"AKN1"
HDR_FMT = "<4sBBHIQ"
HDR_SIZE = struct.calcsize(HDR_FMT)           # 20
TAG_SIZE = 16
NONCE_SIZE = 16
KEY_SIZE = 32
MAX_DATAGRAM = 1392                           # < 1400 B on the air, with UDP/IP on top: one 802.11 frame
MAX_PAYLOAD = MAX_DATAGRAM - HDR_SIZE - TAG_SIZE   # 1356: eight 166-byte CSI frames
BOARD_PORT = 47269                            # the board listens here (UDP)
HOST_PORT = 47270                             # the laptop listens here (UDP): the firewall rule's port
FLUSH_S = 0.02                                # the board sends a part-full batch after 20 ms
SESSION_LABEL = b"AKN1 session"


class Kind(enum.IntEnum):
    HELLO = 1          # laptop -> board, K
    WELCOME = 2        # board -> laptop, K
    READY = 3          # laptop -> board, Ks
    DATA = 4           # board -> laptop, Ks: AK frames
    CMD = 5            # laptop -> board, Ks: one AK COMMAND frame
    KEEPALIVE = 6      # laptop -> board, Ks
    BYE = 7            # laptop -> board, Ks


TO_BOARD = {Kind.HELLO, Kind.READY, Kind.CMD, Kind.KEEPALIVE, Kind.BYE}
TO_HOST = {Kind.WELCOME, Kind.DATA}
UNDER_K = {Kind.HELLO, Kind.WELCOME}          # everything else is under the session key


class LinkError(ValueError):
    """A datagram that is not ours, or not intact. Never acted on."""


@dataclass
class Datagram:
    kind: Kind
    session: int
    counter: int
    payload: bytes


# ------------------------------------------------------------------ keys
def parse_key(text: str) -> bytes:
    """The 64 hex characters of LINK_KEY_VALUE -> 32 bytes."""
    t = (text or "").strip().lower()
    if len(t) != 2 * KEY_SIZE or any(c not in "0123456789abcdef" for c in t):
        raise ValueError("the link key is 64 hex characters (32 random bytes)")
    return bytes.fromhex(t)


def new_key() -> bytes:
    return os.urandom(KEY_SIZE)


def fingerprint(key: bytes) -> str:
    """Safe to show and log: 8 hex characters of SHA-256(key), never the key."""
    return hashlib.sha256(b"AKN1 fingerprint" + key).hexdigest()[:8]


def session_key(key: bytes, session: int, host_nonce: bytes, board_nonce: bytes) -> bytes:
    return hmac.new(key, SESSION_LABEL + struct.pack("<I", session) + host_nonce + board_nonce,
                    hashlib.sha256).digest()


def _tag(key: bytes, data: bytes) -> bytes:
    return hmac.new(key, data, hashlib.sha256).digest()[:TAG_SIZE]


# ------------------------------------------------------------------ datagrams
def pack(key: bytes, kind: Kind, session: int, counter: int, payload: bytes = b"") -> bytes:
    if len(payload) > MAX_PAYLOAD:
        raise ValueError(f"payload {len(payload)} B exceeds {MAX_PAYLOAD}")
    head = struct.pack(HDR_FMT, MAGIC, int(kind), 0, len(payload), session & 0xFFFFFFFF,
                       counter & 0xFFFFFFFFFFFFFFFF)
    return head + payload + _tag(key, head + payload)


def peek(data: bytes) -> Datagram:
    """The header and payload, NOT yet verified: only to pick the key to verify with."""
    if len(data) < HDR_SIZE + TAG_SIZE or len(data) > MAX_DATAGRAM:
        raise LinkError(f"{len(data)} bytes is not an AKN1 datagram")
    magic, kind, flags, length, session, counter = struct.unpack_from(HDR_FMT, data)
    if magic != MAGIC:
        raise LinkError("not AKN1")
    try:
        k = Kind(kind)
    except ValueError:
        raise LinkError(f"unknown kind {kind}") from None
    if length != len(data) - HDR_SIZE - TAG_SIZE:
        raise LinkError("length does not match the datagram")
    return Datagram(k, session, counter, bytes(data[HDR_SIZE:HDR_SIZE + length]))


def verify(key: bytes, data: bytes) -> Datagram:
    """The datagram, if its tag is right under `key`; LinkError otherwise."""
    d = peek(data)
    want = _tag(key, bytes(data[:-TAG_SIZE]))
    if not hmac.compare_digest(want, bytes(data[-TAG_SIZE:])):
        raise LinkError("bad tag")
    return d


def hello(key: bytes, host_nonce: bytes) -> bytes:
    return pack(key, Kind.HELLO, 0, 0, host_nonce)


def welcome_payload(host_nonce: bytes, board_nonce: bytes, fw: str) -> bytes:
    return host_nonce + board_nonce + fw.encode("utf-8")[:31]


def parse_welcome(payload: bytes) -> tuple[bytes, bytes, str]:
    if len(payload) < 2 * NONCE_SIZE:
        raise LinkError("WELCOME too short")
    return (payload[:NONCE_SIZE], payload[NONCE_SIZE:2 * NONCE_SIZE],
            payload[2 * NONCE_SIZE:].decode("utf-8", "replace"))


# ------------------------------------------------------------------ batching
def frame_spans(payload: bytes) -> list[bytes]:
    """The whole AK frames in a DATA payload, as they were sent (no CRC check here:
    the StreamDecoder does that). A payload never splits a frame across datagrams."""
    out, i = [], 0
    while i + HEADER_SIZE <= len(payload):
        if payload[i:i + 2] != SYNC:
            raise LinkError(f"no frame at byte {i}")
        length = struct.unpack_from(HEADER_FMT, payload, i)[3]
        end = i + HEADER_SIZE + length + CRC_SIZE
        if end > len(payload):
            raise LinkError("a frame runs past the datagram")
        out.append(payload[i:end])
        i = end
    if i != len(payload):
        raise LinkError("trailing bytes after the last frame")
    return out


class Batcher:
    """Whole frames into payloads of at most MAX_PAYLOAD bytes: the board's batching,
    written once in Python for the tests and the fake board. A batch goes out when the
    next frame would not fit, when it is FLUSH_S old, or at once (a command's answer)."""

    def __init__(self, max_payload: int = MAX_PAYLOAD, flush_s: float = FLUSH_S,
                 clock: Callable[[], float] = time.monotonic):
        self.max_payload, self.flush_s, self.clock = max_payload, flush_s, clock
        self.buf = bytearray()
        self.first_at: Optional[float] = None

    def add(self, frame: bytes) -> list[bytes]:
        if len(frame) > self.max_payload:
            raise ValueError(f"a {len(frame)}-byte frame does not fit one datagram")
        out = []
        if len(self.buf) + len(frame) > self.max_payload:
            out.append(self.flush())
        if not self.buf:
            self.first_at = self.clock()
        self.buf += frame
        return [p for p in out if p]

    def due(self) -> bool:
        return bool(self.buf) and self.clock() - (self.first_at or 0.0) >= self.flush_s

    def flush(self) -> bytes:
        out, self.buf, self.first_at = bytes(self.buf), bytearray(), None
        return out


# ------------------------------------------------------------------ order
@dataclass
class ReorderStats:
    delivered: int = 0
    reordered: int = 0       # arrived after a later one, put back in order
    late: int = 0            # arrived after its gap was given up: dropped
    duplicate: int = 0       # a counter already delivered (a replay, or the network doubling it)
    lost: int = 0            # counters never seen


class Reorderer:
    """DATA in counter order. Wi-Fi rarely reorders, but it can, and the engine expects
    the board's frames in the order the board sent them. A gap is waited for `wait_s`
    (or until `window` datagrams queue behind it), then counted as lost."""

    def __init__(self, window: int = 64, wait_s: float = 0.05, clock: Callable[[], float] = time.monotonic):
        self.window, self.wait_s, self.clock = window, wait_s, clock
        self.next: Optional[int] = None
        self.held: dict[int, tuple[float, bytes]] = {}
        self.recent: deque = deque(maxlen=4 * window)
        self.stats = ReorderStats()

    def push(self, counter: int, payload: bytes) -> list[bytes]:
        if self.next is None:
            self.next = counter
        if counter < self.next:
            if counter in self.recent:
                self.stats.duplicate += 1
            else:
                self.stats.late += 1
            return []
        if counter in self.held:
            self.stats.duplicate += 1
            return []
        if counter == self.next and self.held:
            self.stats.reordered += 1          # it fills a gap: later ones overtook it
        self.held[counter] = (self.clock(), payload)
        out = self._release()
        if len(self.held) > self.window:
            out += self._skip()
        return out

    def poll(self) -> list[bytes]:
        if self.held and self.clock() - min(t for t, _ in self.held.values()) >= self.wait_s:
            return self._skip()
        return []

    def _release(self) -> list[bytes]:
        out = []
        while self.next in self.held:
            out.append(self.held.pop(self.next)[1])
            self.recent.append(self.next)
            self.next += 1
            self.stats.delivered += 1
        return out

    def _skip(self) -> list[bytes]:
        first = min(self.held)
        gap = first - self.next
        self.stats.lost += gap
        self.next = first
        return self._release()


# ------------------------------------------------------------------ the app's settings
@dataclass
class NetConfig:
    """What the hub needs to reach the board over Wi-Fi (the app supplies it: the key
    lives in data/app, never in git). `addresses` in the order to try: what the person
    typed, the last address that answered, the one the board reported over USB, then
    its mDNS name."""
    key: Optional[bytes] = None
    addresses: list = field(default_factory=list)
    prefer: str = "auto"           # auto: USB if a board is on USB, else Wi-Fi | usb | wifi
    board_port: int = BOARD_PORT
    host_port: int = HOST_PORT

    @property
    def configured(self) -> bool:
        return self.key is not None and bool(self.addresses)
