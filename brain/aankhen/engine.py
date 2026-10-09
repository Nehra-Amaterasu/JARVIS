"""Aankhen engine: decoded packets in, one coherent picture of the room out.

    CsiPacket   -> CsiConditioner -> MotionDetector (+ fan lines) ─┐
                                 -> RespirationDetector            │
    RadarPacket -> parse_frame -> to_room -> Tracker ──────────────┼─> PresenceFusion -> messages
                                          -> Occupancy             ┘
    StatusPacket -> device health, fan relay (selects the Wi-Fi baseline)

The engine knows nothing about where packets come from (serial, replay or the
simulator); the caller passes `source_kind`, and it is stamped on every message so
the UI can never show simulated data as measured.

Clocks: all processing runs on the DEVICE clock (packet timestamps), so a replay at
10x speed produces exactly the same tracks as the live run did. Liveness — "is the
radar still sending?" — runs on the HOST clock, because that is a question about
packets arriving now.

Thread safety: process() is called from the source's consumer thread; the
*_message() builders are called from the web server. One lock covers both.
"""
from __future__ import annotations

import math
import threading
import time
from collections import deque
from dataclasses import dataclass
from typing import Callable, Optional

import numpy as np

from .csi import CsiConditioner
from .fusion import Evidence, FusionConfig, PresenceFusion
from .motion import STATE_MOTION, STATE_UNCALIBRATED, Baseline, MotionConfig, MotionDetector, \
    RespirationDetector
from .occupancy import OccupancyMap
from .protocol import CsiPacket, RadarPacket, StatusPacket
from .radar import FrameError, parse_frame, to_room
from .room import TORSO_HEIGHT_M, Room
from .tracker import MultiTargetTracker, TrackerConfig

SENSOR_STATE_BY_SOURCE = {"hardware": "live", "simulation": "simulated", "replay": "replay"}
LIVE_WINDOW_S = 2.0          # a sensor is "live" if a packet arrived this recently


@dataclass
class EngineEvent:
    id: int
    t: float                 # device seconds
    ts: float                # host epoch seconds (for display)
    kind: str                # enter | exit | appear | lost | motion | quiet | still
    text: str

    def to_dict(self) -> dict:
        return {"id": self.id, "t": round(self.t, 2), "ts": self.ts, "kind": self.kind,
                "text": self.text}


class Engine:
    def __init__(self, room: Room, source_kind: str, room_measured: bool = False,
                 baseline: Optional[Baseline] = None,
                 motion_cfg: Optional[MotionConfig] = None,
                 tracker_cfg: Optional[TrackerConfig] = None,
                 fusion_cfg: Optional[FusionConfig] = None,
                 clock: Callable[[], float] = time.monotonic,
                 fan_baseline: Optional[Baseline] = None):
        self.room = room
        self.source_kind = source_kind
        self.room_measured = room_measured
        self.clock = clock
        self.lock = threading.RLock()

        self.cond = CsiConditioner()
        self.motion = MotionDetector(motion_cfg or MotionConfig(), baseline, fan_baseline)
        self.resp = RespirationDetector(floor=baseline.resp_floor if baseline else None)
        self.tracker_cfg = tracker_cfg or TrackerConfig()
        self.radar_sensor = next(iter(room.sensors_of("ld2450")), None)
        self.tracker = MultiTargetTracker(
            self.tracker_cfg, sticky_at=self._sticky,
            origin=(self.radar_sensor.x, self.radar_sensor.y) if self.radar_sensor else None)
        self.occ = OccupancyMap(room)
        self.fusion = PresenceFusion(fusion_cfg or FusionConfig())

        self.device_t: Optional[float] = None
        self.last_host = {"csi": None, "radar": None, "status": None}
        self.tracks = []
        self._prev: dict[int, tuple[float, float, bool]] = {}   # id -> (x, y, still)
        # Last MEASURED position per track. Exit detection must use this: a track
        # that coasts for a second after its last detection drifts along its
        # velocity, often out of the doorway polygon, and was misread as "lost".
        self._last_seen: dict[int, tuple[float, float]] = {}
        self._still_zone: dict[int, str] = {}                     # id -> zone it was last still in
        self._born: dict[int, tuple[float, float, float]] = {}    # id -> (born_at, x, y)
        self._entered: set[int] = set()                           # ids that appeared in a doorway
        self._radar_empty_since: Optional[float] = None           # device time the tracker emptied
        self.events: deque[EngineEvent] = deque(maxlen=40)
        self._event_id = 0
        self._last_motion_state: Optional[str] = None
        self.device_status: dict = {}
        self.fan_relay: Optional[bool] = None      # from the board's STATUS frames
        self.csi_channel: Optional[int] = None     # Wi-Fi channel of the last CSI packet
        self._csi_settle_until = float("-inf")     # device time; Wi-Fi ignored before it
        self.counters = {"csi_packets": 0, "radar_frames": 0, "radar_bad": 0,
                         "radar_detections": 0, "outside_room": 0}
        self._radar_times: deque = deque(maxlen=50)
        self.seq = 0

    # ================================================================ input
    def process(self, pkt) -> None:
        with self.lock:
            now = self.clock()
            if isinstance(pkt, CsiPacket):
                self.last_host["csi"] = now
                self._on_csi(pkt)
            elif isinstance(pkt, RadarPacket):
                self.last_host["radar"] = now
                self._on_radar(pkt)
            elif isinstance(pkt, StatusPacket):
                self.last_host["status"] = now
                self._on_status(pkt)

    # A fan spinning up or down sweeps through every frequency on its way, which no
    # baseline describes: Wi-Fi is ignored for this long after the relay switches.
    FAN_SETTLE_S = 30.0

    def _on_status(self, p: StatusPacket) -> None:
        """The board reports its relays in every STATUS frame (firmware sendStatus).
        The fan relay selects the Wi-Fi detector's baseline; a switch starts a
        settling period. A fan on the wall switch, not the relay, is not seen here —
        the detector's own line lock still removes its lines."""
        self.device_status = p.fields
        relays = p.fields.get("relays")
        fan = relays.get("fan") if isinstance(relays, dict) else None
        if not isinstance(fan, bool):
            return
        t = p.timestamp_us / 1e6
        if self.fan_relay is not None and fan != self.fan_relay:
            self._csi_settle_until = t + self.FAN_SETTLE_S
            self._event(t, "fan", f"Fan switched {'on' if fan else 'off'}: "
                                  f"Wi-Fi ignored for {self.FAN_SETTLE_S:.0f} s while it settles")
        self.fan_relay = fan
        self.motion.set_fan(fan)

    # A router that changes channel (auto channel selection, a reboot) hands the
    # ESP32 a different multipath — a different "empty room". The signal history is
    # dropped and Wi-Fi ignored while the windows refill; the baseline then follows
    # the radar-confirmed empty room (MotionDetector radar-gated adaptation).
    CHANNEL_SETTLE_S = 10.0

    def _on_channel_change(self, t: float, old: int, new: int) -> None:
        self.cond = CsiConditioner()
        self.motion.restart()
        self.resp = RespirationDetector(floor=self.resp.floor)
        self._csi_settle_until = max(self._csi_settle_until, t + self.CHANNEL_SETTLE_S)
        self._event(t, "channel", f"Wi-Fi moved from channel {old} to {new}: "
                                  f"Wi-Fi ignored for {self.CHANNEL_SETTLE_S:.0f} s")

    def _csi_settling(self, t: float) -> bool:
        return t < self._csi_settle_until

    def _advance(self, t: float) -> None:
        if self.device_t is None or t > self.device_t:
            self.device_t = t

    def _on_csi(self, p: CsiPacket) -> None:
        t = p.timestamp_us / 1e6
        self._advance(t)
        self.counters["csi_packets"] += 1
        if self.csi_channel is not None and p.channel != self.csi_channel:
            self._on_channel_change(t, self.csi_channel, p.channel)
        self.csi_channel = p.channel
        radar_up = self.radar_sensor is not None and self._live("radar")
        self.motion.radar_empty_s = (t - self._radar_empty_since
                                     if radar_up and self._radar_empty_since is not None else None)
        self.motion.settling = self._csi_settling(t)
        for s in self.cond.push(t, p.raw, p.rssi, gain_comp_db=p.gain_comp_db):
            self.resp.push(s)
            r = self.motion.push(s)
            if r is None:
                continue
            x = self.motion.over_calibrated(r.features["mvs"])
            if x is not None and x >= self.BREATH_BLOCK_X:
                self.resp.note_motion(r.t)
            if r.state != self._last_motion_state and r.state != STATE_UNCALIBRATED:
                if r.state == STATE_MOTION:
                    self._event(r.t, "motion", f"Wi-Fi motion {r.score:.1f}x empty-room level")
                elif self._last_motion_state == STATE_MOTION:
                    self._event(r.t, "quiet", "Wi-Fi motion stopped")
            self._last_motion_state = r.state
            self._fuse(r.t)

    def _on_radar(self, p: RadarPacket) -> None:
        t = p.timestamp_us / 1e6
        self._advance(t)
        self.counters["radar_frames"] += 1
        self._radar_times.append(t)
        if self.radar_sensor is None:
            return
        try:
            dets = parse_frame(p.raw)
        except FrameError:
            self.counters["radar_bad"] += 1
            return
        rds = to_room(self.room, self.radar_sensor, dets, refine=self._refine)
        self.counters["radar_detections"] += len(rds)
        # Speed goes to the tracker too: it is how a fan's blades are told from a person.
        inside = [(d.x, d.y, d.speed_mps) for d in rds if d.in_room]
        self.counters["outside_room"] += len(rds) - len(inside)
        self.tracks = self.tracker.step(inside, t)
        for tr in self.tracker.tracks:
            if tr.last_update == t:
                self._last_seen[tr.id] = tr.position
        self._track_events(t)
        if self.tracks:
            self._radar_empty_since = None
        elif self._radar_empty_since is None:
            self._radar_empty_since = t
        self.occ.update(t, [(*tr.position, tr.confidence(t, self.tracker_cfg)) for tr in self.tracks])
        self._fuse(t)

    # ================================================================ events
    def _event(self, t: float, kind: str, text: str) -> None:
        self._event_id += 1
        self.events.append(EngineEvent(self._event_id, t, time.time(), kind, text))

    def _zone_name(self, x: float, y: float) -> Optional[str]:
        z = self.room.zone_at(x, y)
        return z.name if z else None

    def _sticky(self, x: float, y: float) -> bool:
        z = self.room.zone_at(x, y)
        return bool(z and z.expect_stationary)

    def _refine(self, d, x: float, y: float) -> tuple[float, float]:
        """Posture-aware projection for a detection near a still track.

        The default projection assumes a standing torso (1.1 m). For a person
        seated at the desk that lands them ~0.34 m too far from the radar — often
        OUTSIDE the desk polygon, so "which zone is the track in" cannot decide
        the posture. Instead, re-project with each posture zone's torso height and
        keep the projection that lands inside that zone next to a still track.

        "Next to" is REFINE_NEAR_M, and the projection must not collapse onto the
        radar. Someone standing up from the desk is closer in slant range than the
        seated torso height allows, so the seated projection put them at the wall
        under the radar (y = 0.05), 0.9 m from their still track: the old 1.0 m test
        accepted it, the track was dragged to the wall, a new identity walked off,
        and the stranded track held an empty room "occupied" (evening dev seed 104,
        42 % false occupied). A seated person's own projection lands within ~0.2 m
        of the track it built.
        """
        if self.radar_sensor is None or not any(tr.still for tr in self.tracks):
            return x, y
        for z in self.room.zones:
            h = TORSO_HEIGHT_M.get(z.posture or "")
            if h is None:
                continue
            dh = self.radar_sensor.z - h
            if d.y_m * d.y_m - dh * dh < 0.3 ** 2:      # forward < 0.3 m: not this posture
                continue
            px, py = self.room.radar_to_room(self.radar_sensor, d.x_m, d.y_m, body_height_m=h)
            if z.contains(px, py) and any(
                    tr.still and math.dist(tr.position, (px, py)) < self.REFINE_NEAR_M
                    for tr in self.tracks):
                return px, py
        return x, y

    REFINE_NEAR_M = 0.5

    EXIT_TOLERANCE_M = 0.35

    def _is_exit(self, x: float, y: float) -> bool:
        """In an exit zone, or within EXIT_TOLERANCE_M of one: people leave through
        the doorway, so their last detection often lies just past its edge."""
        tol = self.EXIT_TOLERANCE_M
        for z in self.room.zones:
            if not (z.is_exit or z.name.lower() == "door"):
                continue
            for dx, dy in ((0, 0), (tol, 0), (-tol, 0), (0, tol), (0, -tol)):
                if z.contains(x + dx, y + dy):
                    return True
        return False

    # A still track left behind in the zone someone just walked out of, with no
    # detection for this long, is treated as their duplicate (see _drop_duplicates).
    DUPLICATE_STALE_S = 3.0

    def _drop_duplicates(self, t: float, gone_id: int, now: dict) -> None:
        """Someone walked out through the door: forget still tracks they left behind.

        On evening seed 3 a duplicate track sat on the bed after the person who had
        been lying there left, blocked the exit cue (it counted as "someone still
        here") and kept an empty room occupied for 51 s. A still track the radar has
        not seen for DUPLICATE_STALE_S, never seen in the same frame as the leaver,
        was that same person if either
          - the leaver had been still in the same zone (a duplicate of them), or
          - the leaver's track was born within 1.5 m of it just as it went silent
            (they stood up, and the tracker gave them a new identity).
        A second sleeper the radar has lost matches neither: they did not walk out.
        """
        zone = self._still_zone.pop(gone_id, None)
        born = self._born.pop(gone_id, None)
        for tr in list(self.tracker.tracks):
            if (not tr.confirmed or not tr.still or tr.id == gone_id
                    or t - tr.last_update <= self.DUPLICATE_STALE_S
                    or self.tracker.distinct(gone_id, tr.id)):
                continue
            same_zone = zone is not None and self._zone_name(*tr.position) == zone
            stood_up = (born is not None and -2.0 <= born[0] - tr.last_update <= 10.0
                        and math.dist(born[1:], tr.position) <= 1.5)
            if same_zone or stood_up:
                self.tracker.drop(tr.id)
                now.pop(tr.id, None)
                self._still_zone.pop(tr.id, None)
                where = self._zone_name(*tr.position)
                self._event(t, "lost", f"P{tr.id} dropped" + (f" at the {where}" if where else "")
                            + f": the same person as P{gone_id}, who left")
        self.tracks = [tr for tr in self.tracks if tr.id in now]

    def _track_events(self, t: float) -> None:
        now = {tr.id: tr for tr in self.tracks}
        for tid, tr in now.items():
            x, y = tr.position
            if tr.still:
                where = self._zone_name(x, y)
                if where:
                    self._still_zone[tid] = where
            if tid not in self._prev:
                h = tr.history[0] if tr.history else (tr.born_at, x, y)
                self._born[tid] = (tr.born_at, h[1], h[2])
                where = self._zone_name(x, y)
                if self._is_exit(x, y):
                    self._event(t, "enter", f"P{tid} entered via the {where}")
                    self._entered.add(tid)
                    if not tr.still:
                        self.fusion.entry_observed(t)
                else:
                    self._event(t, "appear", f"P{tid} appeared" + (f" at the {where}" if where else ""))
            elif tr.still and not self._prev[tid][2]:
                where = self._zone_name(x, y)
                self._event(t, "still", f"P{tid} is still" + (f" at the {where}" if where else ""))
        for tid, (px, py, _) in self._prev.items():
            if tid in now:
                continue
            x, y = self._last_seen.pop(tid, (px, py))
            if self._is_exit(x, y):
                self._event(t, "exit", f"P{tid} left via the {self._zone_name(x, y)}")
                self._drop_duplicates(t, tid, now)
                self.fusion.exit_observed(t, tracks_remaining=len(now))
            else:
                where = self._zone_name(x, y)
                self._event(t, "lost", f"P{tid} lost by the radar" + (f" near the {where}" if where else ""))
            self._still_zone.pop(tid, None)
            self._born.pop(tid, None)
            self._entered.discard(tid)
        self._prev = {tid: (*tr.position, tr.still) for tid, tr in now.items()}

    # ================================================================ fusion
    def _live(self, kind: str) -> bool:
        last = self.last_host[kind]
        return last is not None and self.clock() - last < LIVE_WINDOW_S

    # A track that did not walk in through the door counts as evidence only once it
    # has been confirmed this long. Real people mid-room were usually tracked
    # already; what appears there out of nothing and dies within a second or two —
    # a multipath ghost, a fan blade that slipped past the tracker — used to add
    # +4/s for its whole short life and leave the room "occupied" for ~40 s after.
    PROBATION_S = 1.0

    def _counts(self, tr, t: float) -> bool:
        return (tr.id in self._entered or tr.confirmed_at is None
                or t - tr.confirmed_at >= self.PROBATION_S)

    # Only movement this many times the CALIBRATED motion threshold blanks the
    # breathing detector for a window. A sleeper's sighs (2.5x a normal breath)
    # crossed the threshold itself — 1.0-1.9x it, against 5-9x for walking — and each
    # blanked 25 s of breathing: the radar's hold ran out and a dev-seed sleeper was
    # called "empty" for 61 % of the night. Calibrated, not adapted: once the
    # baseline had adapted to a neighbour pacing by the router, the pacing (a 0.15 Hz
    # rhythm, inside the breathing band) no longer blanked anything and read as 17x
    # an empty room's breathing statistic.
    BREATH_BLOCK_X = 2.0

    def _breathing_usable(self, t: float) -> bool:
        """Breathing counts only with the fan off and still (its lines and their
        leftovers are not something a breathing detector should be trusted on)."""
        return (not self.motion.fan.locked and self.motion.context == MotionDetector.FAN_OFF
                and not self._csi_settling(t) and self._live("csi"))

    def _fuse(self, t: float) -> None:
        usable = self._breathing_usable(t)
        breathing = usable and self.resp.last.present
        r = self.resp.last.ratio
        if usable and (breathing or (r is not None and r >= self.resp.k_floor)):
            # The radar's still track for this person would otherwise run out after
            # its 30 s hold and the count drop to zero under a sleeper. One passing
            # window is enough for THIS (it only keeps a track the radar already had);
            # the presence evidence below waits for 2 of 3. Waiting for 2 of 3 here
            # too let the first window land ~5 s after the hold ran out: count
            # accuracy 78 % on a sleep run.
            still = [tr for tr in self.tracker.tracks if tr.confirmed and tr.still
                     and self._sticky(*tr.position)]
            if still:
                self.tracker.extend_hold(max(still, key=lambda tr: tr.last_update).id, t)
        counted = [tr for tr in self.tracks if self._counts(tr, t)]
        recent = [tr for tr in counted if t - tr.last_update < 0.6]
        m = self.motion.last
        ev = Evidence(
            radar_live=self._live("radar") and self.radar_sensor is not None,
            n_moving=sum(1 for tr in recent if not tr.still),
            n_still=sum(1 for tr in counted if tr.still or tr not in recent),
            csi_live=(self._live("csi") and m is not None and m.state != STATE_UNCALIBRATED
                      and not self._csi_settling(t)),
            csi_state=m.state if m else None,
            csi_auto_baseline=bool(m and m.baseline_source == "auto"),
            csi_score=m.score if m else None,
            breathing=breathing,
        )
        self.fusion.update(t, ev)

    # ================================================================ output
    def radar_rate_hz(self) -> float:
        ts = self._radar_times
        if len(ts) < 2 or ts[-1] <= ts[0]:
            return 0.0
        return (len(ts) - 1) / (ts[-1] - ts[0])

    def frame_message(self) -> dict:
        with self.lock:
            self.seq += 1
            t = self.device_t or 0.0
            tracks = []
            zones = {z.name: False for z in self.room.zones}
            for tr in self.tracks:
                x, y = tr.position
                zone = self._zone_name(x, y)
                if zone:
                    zones[zone] = True
                vx, vy = tr.velocity
                tracks.append({"id": f"P{tr.id}", "x": round(x, 3), "y": round(y, 3),
                               "vx": round(vx, 3), "vy": round(vy, 3),
                               "speed": round(math.hypot(vx, vy), 3),
                               "conf": round(tr.confidence(t, self.tracker_cfg), 3),
                               "std": round(tr.position_std, 3), "zone": zone,
                               "still": tr.still})
            m = self.motion.last
            b = self.resp.last
            amps = self.cond.last_raw_amp
            return {
                "type": "frame", "seq": self.seq, "source": self.source_kind, "t": round(t, 3),
                "tracks": tracks,
                "motion": round(m.motion01, 3) if m else 0.0,
                "zones": zones,
                "zone_seconds": {k: round(v, 1) for k, v in self.occ.zone_seconds.items()},
                "presence": self.fusion.summary(t),
                "motion_detail": {
                    "state": m.state if m else None,
                    "score": m.score if m else None,
                    "threshold": m.threshold if m else None,
                    "unit": "x empty room",
                    "confidence": m.confidence if m else None,
                    "baseline": m.baseline_source if m else "none",
                    "reason": m.reason if m else "no Wi-Fi CSI received",
                    "breathing_bpm": b.bpm,
                    "breathing_present": b.present,
                    "breathing_ratio": b.ratio,
                    "breathing_conf": (min(1.0, b.ratio / (3 * self.resp.k_floor))
                                       if b.present and b.ratio else 0.0),
                    "breathing_note": b.note,
                    "context": self.motion.context,
                    "settling": self._csi_settling(t),
                    "fan": {"relay": self.fan_relay, **self.motion.fan.summary()},
                },
                "csi": {
                    "channel": self.csi_channel,
                    "n_subcarriers": int(len(amps)) if amps is not None else 0,
                    "rate_hz": round(self.cond.rate.hz, 1),
                    "rssi": self.cond.last_rssi,
                    "fill_ratio": round(self.cond.resampler.fill_ratio(), 3),
                    "amplitudes": [round(float(a), 1) for a in amps] if amps is not None else [],
                },
                "rates": {"csi_hz": round(self.cond.rate.hz, 1), "radar_hz": round(self.radar_rate_hz(), 1)},
                "events": [e.to_dict() for e in list(self.events)[-8:]],
            }

    def heatmap_message(self, layer: str = "live") -> dict:
        with self.lock:
            grid = self.occ.learned if layer == "learned" else self.occ.live
            g = grid.grid
            vmax = float(g.max())
            data = (g / vmax) if vmax > 0 else np.zeros_like(g)
            return {"type": "heatmap", "layer": layer, "w": int(g.shape[1]), "h": int(g.shape[0]),
                    "cell": self.occ.spec.cell, "vmax": 1.0,
                    "data": [round(float(v), 3) for v in data.ravel()],
                    "hotspots": [h.__dict__ for h in self.occ.hotspots()]}

    def room_message(self) -> dict:
        return {"type": "room", "source": self.source_kind, "room": self.room.to_dict(),
                "room_measured": self.room_measured}

    def status_message(self, link: Optional[dict] = None) -> dict:
        with self.lock:
            state = SENSOR_STATE_BY_SOURCE.get(self.source_kind, "unknown")

            def sensor(kind: str, configured: bool, detail: str) -> dict:
                if not configured:
                    return {"state": "absent", "detail": "not in the room layout"}
                if self._live(kind):
                    return {"state": state, "detail": detail}
                return {"state": "silent", "detail": "no packets in the last 2 s"}

            m = self.motion.last
            base = m.baseline_source if m else "none"
            csi = sensor("csi", bool(self.room.links),
                         f"{self.cond.rate.hz:.0f} Hz · {self.cond.resampler.fill_ratio() * 100:.1f}% filled"
                         f" · baseline {base}")
            radar = sensor("radar", self.radar_sensor is not None,
                           f"{self.radar_rate_hz():.0f} Hz · {self.counters['radar_bad']} bad frames")
            dev = self.device_status
            esp = sensor("status", True,
                         f"{dev.get('fw', '?')} · up {dev.get('uptime_s', 0):.0f} s" if dev else "")
            return {"type": "status", "source": self.source_kind,
                    "sensors": {"Wi-Fi CSI": csi, "LD2450 radar": radar, "ESP32": esp},
                    "link": link or {}, "room_measured": self.room_measured,
                    "counters": dict(self.counters)}

    def snapshot(self) -> dict:
        """Compact summary for JARVIS's brain (agent.py presence context)."""
        f = self.frame_message()
        return {"source": f["source"], "presence": f["presence"],
                "people": [{"id": t["id"], "zone": t["zone"], "still": t["still"]} for t in f["tracks"]],
                "motion": f["motion_detail"]["state"]}


def run_engine(source, engine: Engine, stop: threading.Event) -> None:
    """Consumer loop: drain the source's packet queue into the engine."""
    import queue
    while not stop.is_set():
        try:
            pkt = source.packets.get(timeout=0.2)
        except queue.Empty:
            continue
        engine.process(pkt)
