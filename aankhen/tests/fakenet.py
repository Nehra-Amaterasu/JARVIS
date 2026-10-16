"""A fake Aankhen board on the Wi-Fi link, for the tests (no hardware, no LAN).

It listens on 127.0.0.1 only and plays the firmware's side of netlink.py exactly as
firmware.ino's WI-FI LINK section does: HELLO verified under the link key -> a pending
session and a WELCOME; READY under the session key -> live, streaming DATA (a STATUS
frame every `period_s`, optionally CSI frames) batched like the board; CMD -> the relay
switched and a STATUS sent at once; KEEPALIVE; BYE; replay and forgery dropped and
counted. Knobs a test turns: `silent` (stops answering, as a board that lost Wi-Fi),
`restart()` (a reboot: every session forgotten, relays off), `swap_next` (send the next
two DATA datagrams in the wrong order), `drop_cmds` (lose this many CMD datagrams).
"""
from __future__ import annotations

import json
import os
import socket
import struct
import threading
import time

from aankhen import netlink as nl
from aankhen.protocol import CSI_GAIN_FMT, CSI_META_FMT, Frame, FrameType, StreamDecoder

FW = "aankhen-3.5.0"


class FakeNetBoard:
    def __init__(self, key: bytes, relays=("light", "fan", "light2", "light3", "light4"),
                 unwired=(), period_s: float = 0.2, csi_hz: float = 0.0, fw: str = FW,
                 timeout_s: float = 10.0):
        self.key, self.fw, self.period_s, self.csi_hz, self.timeout_s = key, fw, period_s, csi_hz, timeout_s
        self.relays = {r: (None if r in unwired else False) for r in relays}
        self.sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        self.sock.bind(("127.0.0.1", 0))
        self.sock.settimeout(0.01)
        self.port = self.sock.getsockname()[1]
        self.silent = False
        self.swap_next = False
        self.drop_cmds = 0
        self.pending = None           # dict(id, key, peer, created)
        self.live = None              # dict(id, key, peer, tx, rx, last)
        self.batcher = nl.Batcher(flush_s=0.02)
        self.counts = {"hello": 0, "welcome": 0, "sessions": 0, "cmds": 0, "bad": 0, "replays": 0,
                       "dgrams": 0, "frames": 0}
        self.commands: list[dict] = []
        self.datagram_sizes: list[int] = []
        self._seq = {}
        self._held = None
        self._stop = threading.Event()
        self._lock = threading.RLock()
        self._thread = threading.Thread(target=self._run, name="fake-net-board", daemon=True)

    # ------------------------------------------------------------ control
    def start(self) -> "FakeNetBoard":
        self._thread.start()
        return self

    def stop(self) -> None:
        self._stop.set()
        self._thread.join(timeout=2)
        self.sock.close()

    def restart(self) -> None:
        """A reboot: sessions forgotten, relays OFF (a power cut)."""
        with self._lock:
            self.pending = self.live = None
            self.relays = {r: (None if v is None else False) for r, v in self.relays.items()}
            self.batcher.flush()

    @property
    def peer(self):
        return self.live["peer"] if self.live else None

    # ------------------------------------------------------------ frames
    def _frame(self, ftype: FrameType, payload: bytes) -> bytes:
        s = self._seq.get(ftype, 0)
        self._seq[ftype] = s + 1
        return Frame(ftype, s & 0xFFFF, int(time.monotonic() * 1e6), payload).encode()

    def status_frame(self) -> bytes:
        body = {"fw": self.fw, "uptime_s": round(time.monotonic(), 1), "relays": dict(self.relays),
                "relay_pins": {r: (-1 if v is None else 4 + i) for i, (r, v) in enumerate(self.relays.items())},
                "wifi": "connected", "ip": "127.0.0.1", "mdns": "aankhen.local", "rssi": -58, "channel": 6,
                "csi_hz": int(self.csi_hz), "net": {"key": nl.fingerprint(self.key), "port": self.port,
                                                    "peer": "%s:%d" % self.peer if self.peer else None}}
        return self._frame(FrameType.STATUS, json.dumps(body, separators=(",", ":")).encode())

    def csi_frame(self) -> bytes:
        meta = struct.pack(CSI_META_FMT, -55, -92, 6, 0, 1, 0, 0, 0, b"\x11" * 6, 128)
        gain = struct.pack(CSI_GAIN_FMT, 30, 2, 0)
        return self._frame(FrameType.CSI_GAIN, meta + gain + os.urandom(128))

    # ------------------------------------------------------------ the wire
    def _send(self, key, kind, sid, counter, payload, peer) -> None:
        dg = nl.pack(key, kind, sid, counter, payload)
        self.datagram_sizes.append(len(dg))
        self.sock.sendto(dg, peer)

    def _send_data(self, payload: bytes) -> None:
        live = self.live
        if not payload or live is None:
            return
        live["tx"] += 1
        dg = nl.pack(live["key"], nl.Kind.DATA, live["id"], live["tx"], payload)
        self.datagram_sizes.append(len(dg))
        self.counts["dgrams"] += 1
        if self.swap_next and self._held is None:
            self._held = dg                            # sent after the next one
            return
        self.sock.sendto(dg, live["peer"])
        if self._held is not None:
            self.sock.sendto(self._held, live["peer"])
            self._held = None
            self.swap_next = False

    def offer(self, frame: bytes, now: bool = False) -> None:
        with self._lock:
            if self.live is None:
                return
            self.counts["frames"] += 1
            for p in self.batcher.add(frame):
                self._send_data(p)
            if now:
                self._send_data(self.batcher.flush())

    def _handle(self, data: bytes, peer) -> None:
        try:
            d = nl.peek(data)
        except nl.LinkError:
            self.counts["bad"] += 1
            return
        if d.kind == nl.Kind.HELLO:
            self.counts["hello"] += 1
            try:
                nl.verify(self.key, data)
            except nl.LinkError:
                self.counts["bad"] += 1
                return
            host_nonce, board_nonce = d.payload, os.urandom(nl.NONCE_SIZE)
            sid = int.from_bytes(os.urandom(4), "little") | 1
            self.pending = {"id": sid, "key": nl.session_key(self.key, sid, host_nonce, board_nonce),
                            "peer": peer, "created": time.monotonic(), "rx": 0}
            self._send(self.key, nl.Kind.WELCOME, sid, 0, nl.welcome_payload(host_nonce, board_nonce, self.fw), peer)
            self.counts["welcome"] += 1
            return
        if d.kind not in nl.TO_BOARD:
            self.counts["bad"] += 1
            return
        s = None
        if d.kind == nl.Kind.READY and self.pending and d.session == self.pending["id"]:
            s = self.pending
        elif d.kind != nl.Kind.READY and self.live and d.session == self.live["id"]:
            s = self.live
        if s is None or peer != s["peer"]:
            self.counts["bad"] += 1
            return
        try:
            nl.verify(s["key"], data)
        except nl.LinkError:
            self.counts["bad"] += 1
            return
        if d.counter <= s["rx"]:
            self.counts["replays"] += 1
            return
        s["rx"] = d.counter
        s["last"] = time.monotonic()
        if s is self.pending:
            with self._lock:
                self.batcher.flush()
                self.live = {**s, "tx": 0}
                self.pending = None
                self.counts["sessions"] += 1
            self.offer(self.status_frame(), now=True)
            return
        if d.kind == nl.Kind.BYE:
            self.live = None
        elif d.kind == nl.Kind.CMD:
            if self.drop_cmds > 0:
                self.drop_cmds -= 1
                return
            frames = list(StreamDecoder().feed(d.payload))
            if len(frames) != 1 or frames[0].type != FrameType.COMMAND:
                self.counts["bad"] += 1
                return
            cmd = json.loads(frames[0].payload)
            self.counts["cmds"] += 1
            self.commands.append(cmd)
            name = cmd.get("relay")
            if name is not None:
                for r in self.relays:
                    if (name == "all" or name == r) and self.relays[r] is not None:
                        self.relays[r] = bool(cmd.get("on"))
            self.offer(self.status_frame(), now=True)

    def _run(self) -> None:
        next_status = time.monotonic()
        next_csi = time.monotonic()
        while not self._stop.is_set():
            try:
                data, peer = self.sock.recvfrom(2048)
            except (socket.timeout, ConnectionResetError):
                data = None
            except OSError:
                if self._stop.is_set():
                    return
                data = None
            if data is not None and not self.silent:
                with self._lock:
                    self._handle(data, peer)
            now = time.monotonic()
            with self._lock:
                if self.pending and now - self.pending["created"] > 3.0:
                    self.pending = None
                if self.live and now - self.live.get("last", now) > self.timeout_s:
                    self.live = None
            if self.silent or self.live is None:
                continue
            if now >= next_status:
                next_status = now + self.period_s
                self.offer(self.status_frame())
            if self.csi_hz and now >= next_csi:
                while next_csi <= now:
                    self.offer(self.csi_frame())
                    next_csi += 1.0 / self.csi_hz
            with self._lock:
                if self.batcher.due():
                    self._send_data(self.batcher.flush())
