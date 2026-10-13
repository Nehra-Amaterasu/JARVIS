"""Second and later Wi-Fi links: CSI from transmitters other than the router.

WHAT A LINK IS
  Link 1 is router -> board. The board pings the router at 500 Hz and keeps the
  replies; they arrive as CSI / CSI_GAIN frames, decoded into CsiPacket, and are the
  engine's input. Link 2 is the owner's phone -> board. A phone on the home Wi-Fi opens
  http://<board>/beacon, the board pings it at ~100 Hz and, in promiscuous receive,
  overhears the replies the phone sends to the router (firmware.ino, "LINK 2"). Those
  arrive as CSI_LINK frames (protocol.py, type 0x08), decoded into CsiLinkPacket, and
  CsiLinkPacket is deliberately NOT a CsiPacket. Everything built for link 1 (engine,
  learn, bench, validate, firstlight) selects isinstance(p, CsiPacket), so it cannot
  pick up link 2 by accident (tests/test_links.py proves it for the engine).

WHAT THIS MODULE DOES
  LinkBank keeps one LinkState per link id. Each conditions its packets with the same
  CsiConditioner the engine runs on link 1 (decode, gain compensation, 100 Hz grid,
  Hampel), and every 0.25 s computes motion.py's human-band energy (HBE) over the last
  3 s. HBE is normalised by each window's own noise (~1 for an empty room), so it means
  something on a link that has never been calibrated. A link restarts (new conditioner,
  empty windows) when its transmitter's MAC changes (another phone, or the same phone
  with a new private address) or when its channel changes. Either is a different
  "empty room", as a router channel change is for link 1 (Engine._on_channel_change).

WHAT IT DOES NOT DO
  Decide anything. Nothing here says "someone is there"; two links are two paths across
  the room, not coordinates. Link 2 is a second viewpoint for the learned models.

INTEGRATION POINTS (engine.py, eyes.py and the UI are someone else's to wire)
  1. Engine. Own one LinkBank, and in Engine.process add a branch beside the CsiPacket
     one:
         elif isinstance(pkt, CsiLinkPacket):
             self.last_host["link2"] = now               # liveness, on the host clock
             for s in self.links.push(pkt): ...          # 100 Hz samples, device clock
     Both links stamp packets with the same esp_timer_get_time(), so a link-2 sample
     and a link-1 sample are within one 10 ms slot of each other (each conditioner
     starts its grid at its own first packet). Gate link 2 with link 1's fan context
     (fan relay, Engine.FAN_SETTLE_S, FanLines). At ~100 Hz link 2 has about one packet
     per slot, so it lacks the slot averaging that protects link 1 from a ceiling
     fan's aliases (firmware CSI_RATE_HZ 500).
  2. Status and UI. LinkBank.summary() is JSON-ready, one entry per link; add it to
     Engine.status_message / frame_message. The board's own view of the phone link is
     in every STATUS frame, fields["beacon"] = {ip, mac_known, pings_ok, rate_hz, rssi,
     dropped, rejected}; Engine._on_status already keeps all of it in device_status.
  3. Eyes view (eyes.py). One EyesBuffer per link: push_raw(t, pkt.raw) per packet, and
     push(s) for each sample LinkBank.push returns, as the engine does for link 1.
  4. Recordings. Nothing to do. An .akr is the raw byte stream (transport.Recorder
     writes before decoding), so CSI_LINK frames are in every recording made while a
     phone is registered (teach, learn-my-room, firstlight, calibrate, record), and
     ReplaySource yields CsiLinkPacket. Recordings made before the host knew 0x08 still
     replay; the type only adds packets.
  5. Learned models (learn.py). learn._packets keeps CsiPacket only, so today's features
     and models are link 1 alone, unchanged by a phone in the stream. For link-2
     features run a second FeatureStream on LinkBank.push's samples and put the two
     vectors side by side per 0.5 s window. Train on sessions recorded with the phone
     already in its spot: link 2's "empty room" is wherever the phone lies.
"""
from __future__ import annotations

import threading
from collections import deque
from typing import Optional

import numpy as np

from .csi import CsiConditioner, Sample
from .motion import HBE_WINDOW_S, human_band_energy
from .protocol import LINK_NAMES, CsiLinkPacket

# MotionConfig.hop_s: link 1's windows are evaluated this often, and link 2's match.
HBE_HOP_S = 0.25


class LinkState:
    """One link: its conditioner, its last 3 s of samples, and what they say."""

    def __init__(self, link: int, rate_hz: float = 100.0):
        self.link = link
        self.rate_hz = rate_hz
        self.cond = CsiConditioner(rate_hz)
        n = int(round(HBE_WINDOW_S * rate_hz))
        self._amps: deque = deque(maxlen=n)
        self._filled: deque = deque(maxlen=n)
        self._hop = max(1, int(round(HBE_HOP_S * rate_hz)))
        self._since = 0
        self.mac: Optional[bytes] = None         # current transmitter (kept here, never in summary())
        self.channel: Optional[int] = None
        self.packets = 0
        self.samples = 0
        self.restarts = 0
        self.restart_reason: Optional[str] = None
        self.last_t: Optional[float] = None      # device seconds of the newest packet
        self.hbe: Optional[float] = None         # human-band energy of the last 3 s (~1: noise only)
        self.hbe_recent: Optional[float] = None  # the same band over its last second
        self.hbe_t: Optional[float] = None

    @property
    def name(self) -> str:
        return LINK_NAMES.get(self.link, f"link {self.link}")

    def restart(self, reason: str) -> None:
        """A different empty room: drop the signal history, keep the counters."""
        self.cond = CsiConditioner(self.rate_hz)
        self._amps.clear()
        self._filled.clear()
        self._since = 0
        self.hbe = self.hbe_recent = self.hbe_t = None
        self.restarts += 1
        self.restart_reason = reason

    def push(self, p: CsiLinkPacket) -> list[Sample]:
        if self.mac is not None and p.mac != self.mac:
            self.restart("a different transmitter")
        elif self.channel is not None and p.channel != self.channel:
            self.restart(f"channel {self.channel} -> {p.channel}")
        self.mac, self.channel = p.mac, p.channel
        self.packets += 1
        t = p.timestamp_us / 1e6
        self.last_t = t
        out = self.cond.push(t, p.raw, p.rssi, gain_comp_db=p.gain_comp_db)
        for s in out:
            self._amps.append(s.amp)
            self._filled.append(s.filled)
            self._since += 1
            if len(self._amps) == self._amps.maxlen and self._since >= self._hop:
                self._since = 0
                self._evaluate(s.t)
        self.samples += len(out)
        return out

    def _evaluate(self, t: float) -> None:
        # None when more than 20 % of the window was forward-filled (HBE_MIN_REAL): a
        # phone delivering under ~80 packets a second gives no reading, not a wrong one.
        r = human_band_energy(np.stack(self._amps), np.fromiter(self._filled, bool),
                              self.rate_hz, detail=True)
        self.hbe, self.hbe_recent = (None, None) if r is None else (float(r[0]), float(r[2]))
        self.hbe_t = t

    def summary(self) -> dict:
        c = self.cond
        return {"link": self.link, "name": self.name, "packets": self.packets,
                "samples": self.samples, "rate_hz": round(c.rate.hz, 1),
                "fill_ratio": round(c.resampler.fill_ratio(), 3), "rssi": c.last_rssi,
                "channel": self.channel, "compensated": c.compensated,
                # A private (randomised) address changes now and then; each change is a
                # restart. The address itself never leaves this object.
                "private_mac": bool(self.mac and self.mac[0] & 0x02),
                "hbe": None if self.hbe is None else round(self.hbe, 2),
                "hbe_recent": None if self.hbe_recent is None else round(self.hbe_recent, 2),
                "restarts": self.restarts, "restart_reason": self.restart_reason}


class LinkBank:
    """Every link other than the router's, each conditioned the way link 1 is.

    Thread-safe like Engine: push()/process() from the consumer thread, summary() from
    the web server.
    """

    def __init__(self, rate_hz: float = 100.0):
        self.rate_hz = rate_hz
        self.lock = threading.RLock()
        self._links: dict[int, LinkState] = {}

    def push(self, pkt: CsiLinkPacket) -> list[Sample]:
        """One link packet in; that link's new 100 Hz samples out (often none: the grid
        emits a slot when the next one starts, and the Hampel filter lags 3 samples)."""
        if not isinstance(pkt, CsiLinkPacket):
            raise TypeError(f"LinkBank takes CsiLinkPacket, not {type(pkt).__name__}")
        with self.lock:
            st = self._links.get(pkt.link)
            if st is None:
                st = self._links[pkt.link] = LinkState(pkt.link, self.rate_hz)
            return st.push(pkt)

    def process(self, pkt) -> list[Sample]:
        """Engine-style dispatch: any decoded packet in, link samples out ([] for the rest)."""
        return self.push(pkt) if isinstance(pkt, CsiLinkPacket) else []

    def get(self, link: int) -> Optional[LinkState]:
        with self.lock:
            return self._links.get(link)

    @property
    def links(self) -> list[int]:
        with self.lock:
            return sorted(self._links)

    def reset(self) -> None:
        with self.lock:
            self._links.clear()

    def summary(self) -> dict:
        """{link name: LinkState.summary()}, e.g. {"phone": {...}}."""
        with self.lock:
            return {st.name: st.summary() for _, st in sorted(self._links.items())}
