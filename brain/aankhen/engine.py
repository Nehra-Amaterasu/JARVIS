"""Aankhen engine: decoded packets in, one coherent picture of the room out.

    CsiPacket   -> CsiConditioner -> MotionDetector  ─┐
                                 -> BreathingEstimator│
    RadarPacket -> parse_frame -> to_room -> Tracker ─┼─> PresenceFusion -> messages
                                          -> Occupancy┘
    StatusPacket -> device health

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
from .motion import STATE_MOTION, STATE_UNCALIBRATED, Baseline, BreathingEstimator, \
    MotionConfig, MotionDetector
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
                 clock: Callable[[], float] = time.monotonic):
        self.room = room
        self.source_kind = source_kind
        self.room_measured = room_measured
        self.clock = clock
        self.lock = threading.RLock()

        self.cond = CsiConditioner()
        self.motion = MotionDetector(motion_cfg or MotionConfig(), baseline)
        self.breath = BreathingEstimator()
        self.tracker_cfg = tracker_cfg or TrackerConfig()
        self.tracker = MultiTargetTracker(self.tracker_cfg, sticky_at=self._sticky)
        self.occ = OccupancyMap(room)
        self.fusion = PresenceFusion(fusion_cfg or FusionConfig())
        self.radar_sensor = next(iter(room.sensors_of("ld2450")), None)

        self.device_t: Optional[float] = None
        self.last_host = {"csi": None, "radar": None, "status": None}
        self.tracks = []
        self._prev: dict[int, tuple[float, float, bool]] = {}   # id -> (x, y, still)
        # Last MEASURED position per track. Exit detection must use this: a track
        # that coasts for a second after its last detection drifts along its
        # velocity, often out of the doorway polygon, and was misread as "lost".
        self._last_seen: dict[int, tuple[float, float]] = {}
        self.events: deque[EngineEvent] = deque(maxlen=40)
        self._event_id = 0
        self._last_motion_state: Optional[str] = None
        self.breathing = None
        self._breath_due = 0.0
        self.device_status: dict = {}
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
                self.device_status = pkt.fields

    def _advance(self, t: float) -> None:
        if self.device_t is None or t > self.device_t:
            self.device_t = t

    def _on_csi(self, p: CsiPacket) -> None:
        t = p.timestamp_us / 1e6
        self._advance(t)
        self.counters["csi_packets"] += 1
        for s in self.cond.push(t, p.raw, p.rssi):
            self.breath.push(s)
            r = self.motion.push(s)
            if r is None:
                continue
            if r.state != self._last_motion_state and r.state != STATE_UNCALIBRATED:
                if r.state == STATE_MOTION:
                    self._event(r.t, "motion", f"Wi-Fi motion {r.score:.1f}x empty-room level")
                elif self._last_motion_state == STATE_MOTION:
                    self._event(r.t, "quiet", "Wi-Fi motion stopped")
            self._last_motion_state = r.state
            if r.t >= self._breath_due:
                self._breath_due = r.t + 2.0
                self.breathing = self.breath.estimate(r.state)
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
        inside = [(d.x, d.y) for d in rds if d.in_room]
        self.counters["outside_room"] += len(rds) - len(inside)
        self.tracks = self.tracker.step(inside, t)
        for tr in self.tracker.tracks:
            if tr.last_update == t:
                self._last_seen[tr.id] = tr.position
        self._track_events(t)
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
        """
        if self.radar_sensor is None or not any(tr.still for tr in self.tracks):
            return x, y
        for z in self.room.zones:
            h = TORSO_HEIGHT_M.get(z.posture or "")
            if h is None:
                continue
            px, py = self.room.radar_to_room(self.radar_sensor, d.x_m, d.y_m, body_height_m=h)
            if z.contains(px, py) and any(
                    tr.still and math.dist(tr.position, (px, py)) < 1.0 for tr in self.tracks):
                return px, py
        return x, y

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

    def _track_events(self, t: float) -> None:
        now = {tr.id: tr for tr in self.tracks}
        for tid, tr in now.items():
            x, y = tr.position
            if tid not in self._prev:
                where = self._zone_name(x, y)
                if self._is_exit(x, y):
                    self._event(t, "enter", f"P{tid} entered via the {where}")
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
                self.fusion.exit_observed(t, tracks_remaining=len(now))
            else:
                where = self._zone_name(x, y)
                self._event(t, "lost", f"P{tid} lost by the radar" + (f" near the {where}" if where else ""))
        self._prev = {tid: (*tr.position, tr.still) for tid, tr in now.items()}

    # ================================================================ fusion
    def _live(self, kind: str) -> bool:
        last = self.last_host[kind]
        return last is not None and self.clock() - last < LIVE_WINDOW_S

    def _fuse(self, t: float) -> None:
        recent = [tr for tr in self.tracks if t - tr.last_update < 0.6]
        m = self.motion.last
        ev = Evidence(
            radar_live=self._live("radar") and self.radar_sensor is not None,
            n_moving=sum(1 for tr in recent if not tr.still),
            n_still=sum(1 for tr in self.tracks if tr.still or tr not in recent),
            csi_live=self._live("csi") and m is not None and m.state != STATE_UNCALIBRATED,
            csi_state=m.state if m else None,
            csi_auto_baseline=bool(m and m.baseline_source == "auto"),
            csi_score=m.score if m else None,
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
            b = self.breathing
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
                    "breathing_bpm": b.bpm if b else None,
                    "breathing_conf": b.confidence if b else None,
                    "breathing_note": b.note if b else None,
                },
                "csi": {
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
