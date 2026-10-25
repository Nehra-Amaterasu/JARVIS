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
from .eyes import EyesBuffer
from .fusion import Evidence, FusionConfig, PresenceFusion
from .belief import BeliefTracker, OodGuard, feature_ranges_from_model, motion01
from .learn import CLASSES as LEARNED_CLASSES, FEATURES as LEARNED_FEATURES, OCCUPIED as LEARNED_OCCUPIED, \
    FeatureStream, TemporalFilter
from .motion import HBE_RECENT_GATE, STATE_MOTION, STATE_UNCALIBRATED, Baseline, MotionConfig, \
    MotionDetector, RespirationDetector
from .occupancy import OccupancyMap
from .protocol import CsiPacket, RadarPacket, StatusPacket
from .radar import FrameError, parse_frame, to_room
from .room import TORSO_HEIGHT_M, Room
from .tracker import MultiTargetTracker, TrackerConfig

SENSOR_STATE_BY_SOURCE = {"hardware": "live", "simulation": "simulated", "replay": "replay"}
LIVE_WINDOW_S = 2.0          # a sensor is "live" if a packet arrived this recently
# Gain compensation (firmware 3.3.0, esp_csi_gain_ctrl) changes the normalisation
# (absolute level over a 30 s reference instead of each packet's median). The
# baseline and both learned models were made on the per-packet path, and with
# compensation on (10-13) the real board read "typing" while he sat still and "desk"
# after he stood up. Off until a session recorded with it is calibrated, trained and
# shown better on the same moments. AANKHEN_GAIN_COMP=1 turns it on.
import os as _os
GAIN_COMP = _os.environ.get("AANKHEN_GAIN_COMP", "0") == "1"


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
                 fan_baseline: Optional[Baseline] = None,
                 spatial_model=None, activity_model=None, zone_model=None, zone_map=None,
                 references=None):
        self.room = room
        self.source_kind = source_kind
        self.room_measured = room_measured
        self.clock = clock
        self.lock = threading.RLock()

        self.cond = CsiConditioner()
        # What the channel looks like, for a person to watch (eyes.py). Display only:
        # nothing below reads it.
        self.eyes = EyesBuffer()
        self.motion = MotionDetector(motion_cfg or MotionConfig(), baseline, fan_baseline)
        self.resp = RespirationDetector(floor=baseline.resp_floor if baseline else None)
        self.tracker_cfg = tracker_cfg or TrackerConfig()
        self.radar_sensor = next(iter(room.sensors_of("ld2450")), None)
        self.tracker = MultiTargetTracker(
            self.tracker_cfg, sticky_at=self._sticky,
            origin=(self.radar_sensor.x, self.radar_sensor.y) if self.radar_sensor else None)
        self.occ = OccupancyMap(room)
        self.fusion = PresenceFusion(fusion_cfg or FusionConfig())
        # LEARNED SPATIAL MODEL (learn.py), ADVISORY: its answer is shown beside the
        # fusion's, never used to decide, until it has been trained and scored on
        # recordings from this room (`python -m aankhen learn`).
        self.spatial = spatial_model
        self.activity = activity_model                # what I am doing, when I am in (learn.py)
        self.zone_model = zone_model                  # drill-trained zones + activities (dayeval.py)
        self._activity_p = None                       # its probabilities, smoothed over ~2 s
        self._spatial_filter = TemporalFilter(spatial_model.priors) if spatial_model is not None else None
        self.learned: Optional[dict] = None
        # HONESTY (belief.py): one belief over the zone map, an out-of-distribution guard
        # on the models' inputs, and the empty-room reference matched to firmware + fan.
        from .zones import load_zones
        self.zmap = zone_map if zone_map is not None else load_zones(room)
        self.belief = BeliefTracker(self.zmap)
        if source_kind == "hardware":
            # Real room: a zone is named only with a measured layout and a floor that a
            # passed day-7 drill test calibrated (readiness.py). The simulator knows its
            # own truth and keeps the default floor; it is labelled simulated everywhere.
            from .readiness import zone_floor
            self.belief.layout_measured = bool(room_measured)
            self.belief.zone_floor = zone_floor()
        guard_model = zone_model if zone_model is not None else spatial_model
        self.ood = OodGuard(getattr(guard_model, "features", None) or LEARNED_FEATURES,
                            feature_ranges_from_model(guard_model))
        from .recal import Recalibrator, ReferenceStore
        self.recal = Recalibrator(ReferenceStore(references) if references else None)
        self.reference: dict = {"source": "baseline" if baseline is not None and baseline.ref else "none",
                                "matched": False}
        self.fan_external: Optional[bool] = None      # the fan as the Uno reports it (hub.note_fan)
        self.teacher_hint: Optional[dict] = None      # free teachers' current hint (hub)
        self._belief_at = float("-inf")
        self._ref_key: Optional[tuple] = None
        self._spatial_fs = self.new_feature_stream() if self._has_models() else None

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
        # The frame the consumer thread last published (publish_frame), read without
        # the lock by every viewer (latest_frame). See publish_frame for why.
        self._frame: Optional[dict] = None
        self._frame_at = float("-inf")
        # Raw-stream recorder (stream.py), set by the hub on the real board only.
        # Every call into it is one deque append: it never waits on the writer or a disk.
        self.tap = None
        self.errors = 0                            # packets run_engine could not process
        self.last_error: Optional[dict] = None
        if source_kind == "simulation":
            # the simulator's baseline is made for this very run: it always matches
            self.reference = {"source": "simulated", "matched": True}
        else:
            self._match_reference()

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
        if isinstance(fan, bool):
            t = p.timestamp_us / 1e6
            # With the Uno reporting the fan, the ESP32's relay drives nothing: no pause.
            if self.fan_relay is not None and fan != self.fan_relay and self.fan_external is None:
                self._csi_settle_until = t + self.FAN_SETTLE_S
                self._event(t, "fan", f"Fan switched {'on' if fan else 'off'}: "
                                      f"Wi-Fi ignored for {self.FAN_SETTLE_S:.0f} s while it settles")
            self.fan_relay = fan
            if self.fan_external is None:
                self.motion.set_fan(fan)
        if self._ref_key != (self.firmware(), self.fan_on):
            self._match_reference()

    @property
    def fan_on(self) -> Optional[bool]:
        """The fan as best known: the Uno's report (the switch that really drives it since
        10-13) over the ESP32's own relay, which nothing is wired to any more."""
        return self.fan_external if self.fan_external is not None else self.fan_relay

    def set_fan_external(self, on: Optional[bool], t: Optional[float] = None) -> None:
        """The hub tells the engine what the Uno says the fan is doing. A switch starts the
        same settling pause as the ESP32 relay used to, and picks the matching reference."""
        with self.lock:
            if on is None:
                self.fan_external = None
                return
            on = bool(on)
            t = self.device_t if t is None else t
            if self.fan_external is not None and on != self.fan_external and t is not None:
                self._csi_settle_until = t + self.FAN_SETTLE_S
                self._event(t, "fan", f"Fan switched {'on' if on else 'off'} (relay board): "
                                      f"Wi-Fi ignored for {self.FAN_SETTLE_S:.0f} s while it settles")
            self.fan_external = on
            self.motion.set_fan(on)
            self._match_reference()

    def firmware(self) -> Optional[str]:
        fw = self.device_status.get("fw") if isinstance(self.device_status, dict) else None
        return str(fw) if fw else None

    def _match_reference(self) -> None:
        """Use the empty-room reference made on THIS firmware with the fan as it is now
        (recal.py). None matching: keep the old one and mark it stale, so no zone is named."""
        fs = self._spatial_fs
        self._ref_key = (self.firmware(), self.fan_on)
        if self.source_kind == "simulation":
            # The simulator's baseline is made for this very run and always matches. Its
            # first STATUS ("aankhen-simulator") used to look itself up in the REAL
            # reference store, find nothing, and mark the reference stale for the rest
            # of the run: a simulation could never name a zone.
            self.reference = {"source": "simulated", "matched": True}
            self.belief.reference_ok = True
            return
        ref = self.recal.store.load(self.firmware(), self.fan_on)
        if ref is not None and fs is not None:
            fs.ref_shape = np.asarray(ref["shape"], float)
            fs.ref_level, fs.ref_rssi = ref.get("level"), ref.get("rssi")
            fs.seeded = True
        if ref is not None:
            self.reference = {"source": f"{ref.get('source', '?')} {ref.get('day', '?')}", "matched": True,
                              "firmware": self.firmware(), "fan_on": self.fan_on}
        else:
            self.reference = {"source": self.reference.get("source", "none") if not self.reference.get("matched")
                              else "none", "matched": False, "firmware": self.firmware(), "fan_on": self.fan_on}
        self.belief.reference_ok = ref is not None

    def recalibrate_from(self, source: Optional[str]) -> None:
        """Start ("teachers" | "drill") or stop (None) collecting empty-room windows for
        today's reference under the current firmware and fan."""
        with self.lock:
            if self.source_kind == "simulation" and source is not None:
                return      # a simulated empty room is never saved into the real reference store
            self.recal.set_active(source, self.firmware(), self.fan_on)

    # A router that changes channel (auto channel selection, a reboot) hands the
    # ESP32 a different multipath — a different "empty room". The signal history is
    # dropped and Wi-Fi ignored while the windows refill; the baseline then follows
    # the radar-confirmed empty room (MotionDetector radar-gated adaptation).
    CHANNEL_SETTLE_S = 10.0

    def _on_channel_change(self, t: float, old: int, new: int) -> None:
        self.cond = CsiConditioner()
        self.eyes.reset()
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
        self.eyes.push_raw(t, p.raw)                 # phase needs the packet itself
        tap = self.tap
        if tap is not None:
            tap.raw(t, p.raw, p.channel, self.fan_relay)
        for s in self.cond.push(t, p.raw, p.rssi, gain_comp_db=p.gain_comp_db if GAIN_COMP else None):
            self.eyes.push(s)
            if tap is not None:
                tap.sample(s.t, s.amp, s.filled)
            self.resp.push(s)
            if self._spatial_fs is not None:
                v = self._spatial_fs.push(s, p.rssi, self._fan_feature())
                if v is not None:
                    self._learned_step(s.t, v)
                    saved = self.recal.push(self._spatial_fs.last)
                    if saved is not None:
                        self._event(s.t, "calibrated", "New empty-room reference saved for this firmware and fan")
                        self._match_reference()
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
            if self._spatial_fs is None:              # no models: the belief still ticks
                self._belief_step(r.t)

    def new_feature_stream(self) -> FeatureStream:
        """The spatial model's feature stream, starting from the calibrated empty room
        when the baseline carries one (Baseline.ref)."""
        b = self.motion.baseline
        return FeatureStream(ref=b.ref if b is not None else None)

    def _has_models(self) -> bool:
        return self.spatial is not None or self.zone_model is not None

    def _fan_feature(self) -> bool:
        """The models' fan_on input. The installed models were trained with it always 0
        (the ESP32 relay, never wired to the fan), so they keep getting the relay; a model
        trained on drills, which record the real fan, gets the real fan."""
        m = self.zone_model if self.zone_model is not None else self.spatial
        src = (getattr(m, "trained_on", {}) or {}).get("fan_source") if m is not None else None
        return bool(self.fan_on if src == "uno" else self.fan_relay)

    # The coarse model's top class must be this sure to be shown; below it, "unsure".
    LEARNED_FLOOR = 0.6
    ACTIVITY_FLOOR = 0.7

    def _learned_step(self, t: float, v: np.ndarray) -> None:
        ood = self.ood.check(v)
        coarse_raw = None
        if self.spatial is not None:
            raw = self.spatial.proba(v[None, :])[0]
            coarse_raw = {c: float(x) for c, x in zip(LEARNED_CLASSES, raw)}
            b = self._spatial_filter.step(raw)
            k = int(np.argmax(b))
            sim_only = "sim" in str(self.spatial.trained_on.get("note", "")) and ".akr" not in str(
                self.spatial.trained_on.get("note", ""))
            # Honest: below the floor, or on input unlike anything trained, it says so
            # instead of falling into "bed" (where these models land on anything unseen).
            state = LEARNED_CLASSES[k] if ood is None and b[k] >= self.LEARNED_FLOOR else "unsure"
            self.learned = {"t": round(t, 2), "state": state,
                            "p": {c: round(float(x), 3) for c, x in zip(LEARNED_CLASSES, b)},
                            "occupied_p": round(float(sum(x for c, x in zip(LEARNED_CLASSES, b)
                                                          if c in LEARNED_OCCUPIED)), 3),
                            "advisory": True,
                            "unsure": ood,
                            # what "changed" is measured against: the calibrated empty room,
                            # or (no calibration yet) whatever the first seconds saw
                            "reference": "calibrated" if self._spatial_fs.seeded else "first seconds",
                            "reference_matched": bool(self.reference.get("matched")),
                            "trained": "simulator only" if sim_only else "includes your recordings"}
        act_p = None
        if self.activity is not None and self.learned is not None:
            from .learn import ACTIVITIES
            a = self.activity.proba(v[None, :])[0].copy()
            # "waving" is never shown: it was the dumping ground for anything unseen (94 %
            # of away windows went there). Its mass is dropped and the rest renormalised.
            if "waving" in ACTIVITIES:
                a[ACTIVITIES.index("waving")] = 0.0
                a = a / max(a.sum(), 1e-9)
            # Smoothed (EMA over ~4 windows = 2 s) so the label does not flicker, and only
            # meaningful while I am in the room: out of it, the activity is "none".
            self._activity_p = a if self._activity_p is None else 0.5 * self._activity_p + 0.5 * a
            act_p = {c: float(x) for c, x in zip(ACTIVITIES, self._activity_p) if c != "waving"}
            occ = self.learned["occupied_p"]
            pa = self._activity_p * occ
            pa[ACTIVITIES.index("none")] += 1.0 - occ
            j = int(np.argmax(pa))
            shown = ACTIVITIES[j] if ood is None and pa[j] >= self.ACTIVITY_FLOOR else None
            self.learned["activity"] = {"state": shown,
                                        "p": {c: round(float(x), 3) for c, x in zip(ACTIVITIES, pa)
                                              if c != "waving"},
                                        "trained": "your recordings"}
        zone_p = None
        if self.zone_model is not None:
            zone_p = self.zone_model.zone_proba(v)
            za = self.zone_model.activity_proba(v)
            act_p = za if za is not None else act_p
        self._belief_step(t, coarse_raw, zone_p, act_p, ood, force=True)
        if self.tap is not None and self.learned is not None:
            a = self.learned.get("activity") or {}
            self.tap.learned(t, self.learned["state"], self.learned["occupied_p"], a.get("state"))

    BELIEF_EVERY_S = 0.5

    def _belief_step(self, t: float, coarse_p=None, zone_p=None, act_p=None, ood=None,
                     force: bool = False) -> None:
        if not force and t - self._belief_at < self.BELIEF_EVERY_S:
            return
        self._belief_at = t
        m = self.motion.last
        f = m.features if m else {}
        mot = motion01(f.get("hbe"), f.get("hbe_threshold"))
        if self._csi_settling(t):
            ood = ood or "Wi-Fi settling after a fan or channel change"
            coarse_p = zone_p = act_p = None
        # The coarse model's training priors turn its posterior into a likelihood
        # (belief.coarse_likelihood): without them "knows nothing" read as "empty".
        pri = getattr(self.spatial, "priors", None) if coarse_p is not None else None
        prior = ({c: float(x) for c, x in zip(LEARNED_CLASSES, pri)}
                 if pri is not None and len(pri) == len(LEARNED_CLASSES) else None)
        self.belief.step(t, mot, coarse_p=coarse_p, zone_p=zone_p, activity_p=act_p, ood=ood,
                         teacher=self.teacher_hint, coarse_prior=prior)

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
                "learned": self.learned,
                "belief": self.belief.contract(),
                "honest": self.belief.honest(),
                "reference": dict(self.reference),
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
                    "fan": {"relay": self.fan_relay, "board": self.fan_external, "on": self.fan_on,
                            **self.motion.fan.summary()},
                    # Human-band energy (motion.py): power at body speeds (0.4-4 Hz)
                    # over the last 3 s / 1 s, in units of the window's own noise.
                    "human_band": _human_band(m),
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

    # How often the consumer thread publishes a frame for the viewers: 20 Hz, twice the
    # websocket's 10 Hz, so a viewer's frame is at most ~50 ms older than the packets.
    FRAME_EVERY_S = 0.05

    def publish_frame(self, force: bool = False) -> None:
        """Build the viewers' frame, at most every FRAME_EVERY_S. Called by the consumer
        thread (run_engine), between packets.

        WHY. Every viewer used to build its own frame under the engine lock: the 10 Hz
        websocket, the app's 2 Hz event watcher, the crew's 2 Hz movement watcher, the
        1 Hz journal, the steward. Building one costs ~0.03 ms; WAITING for the lock was
        the cost. The consumer thread holds it for every packet (~290/s on the real
        board) and for ~15 ms per learned-model call (HistGradientBoosting
        predict_proba on one row, twice every 0.5 s). A busy consumer re-takes the lock
        before a waiting thread is scheduled, so with the rest of the app competing for
        the GIL a reader waited out whole bursts. Bench (hub + simulator at 290 packets/s,
        docs/research/2026-10-13-raw-stream-and-crew-speed.md): a movement tick took
        19.5 ms and the stream ran at 6.1 Hz with one thread busy 75 % of the time,
        582 ms and 2.2 Hz at 90 %; the live app measured ~106 ms and 6.6 Hz. Published
        here, a read is one attribute load: 0.5 and 1.2 ms per tick at the same loads."""
        now = self.clock()
        if not force and now - self._frame_at < self.FRAME_EVERY_S:
            return
        msg = self.frame_message()
        self._frame, self._frame_at = msg, now

    def latest_frame(self) -> dict:
        """The last published frame, without the engine lock; a fresh one when nothing
        has been published (an engine driven directly, as the tests do). A shallow copy:
        callers add keys to it (hub.frame adds the simulator's truth)."""
        f = self._frame
        return dict(f) if f is not None else self.frame_message()

    def eyes_message(self) -> dict:
        """What the channel looks like right now (eyes.py), for viewers that asked.

        column / phase_column: the ripples' newest columns (51 values, noise units,
        +-6), None while warming up or when nothing arrived since the last call. Each
        call CONSUMES what arrived, so one caller (the streamer's tick) builds it once
        and hands the same message to every viewer."""
        with self.lock:
            return {"type": "eyes", "source": self.source_kind, "t": round(self.device_t or 0.0, 3),
                    "column": self.eyes.column(), "phase_column": self.eyes.phase_column(),
                    "spectrum": self.eyes.spectrum(), "rate_hz": round(self.cond.rate.hz, 1),
                    "seconds": round(self.eyes.seconds, 1)}

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
            # No radar in this project: its row appears only if a layout still lists one.
            sensors = {"Wi-Fi CSI": csi, "ESP32": esp}
            if self.radar_sensor is not None:
                sensors = {"Wi-Fi CSI": csi, "LD2450 radar": radar, "ESP32": esp}
            return {"type": "status", "source": self.source_kind,
                    "sensors": sensors,
                    "link": link or {}, "room_measured": self.room_measured,
                    "counters": dict(self.counters),
                    "engine_errors": self.errors,
                    "engine_last_error": ({k: v for k, v in self.last_error.items() if k != "trace"}
                                          if self.last_error else None)}

    def note_error(self, e: BaseException, trace: str = "") -> None:
        """A packet the engine could not process (run_engine): counted and kept, shown in
        status, so a failure is said instead of silently ending the consumer thread."""
        self.errors += 1
        self.last_error = {"t": time.time(), "error": f"{type(e).__name__}: {e}", "trace": trace[-1500:],
                           "count": self.errors}
        if self.errors in (1, 10, 100) or self.errors % 1000 == 0:
            print(f"aankhen engine: packet {self.errors} failed: {type(e).__name__}: {e}", flush=True)

    def snapshot(self) -> dict:
        """Compact summary for JARVIS's brain (agent.py presence context)."""
        f = self.frame_message()
        return {"source": f["source"], "presence": f["presence"],
                "people": [{"id": t["id"], "zone": t["zone"], "still": t["still"]} for t in f["tracks"]],
                "motion": f["motion_detail"]["state"],
                "learned": honest_learned(f.get("learned"), (f.get("belief") or {}).get("zones_trusted", True)),
                "belief": f.get("belief"),
                "honest": f.get("honest"),
                "human_band": f["motion_detail"].get("human_band")}


UNTRAINED_CAP = 0.9     # an untrained model never says 100 %


def honest_learned(learned: Optional[dict], zones_trusted: bool) -> Optional[dict]:
    """What JARVIS may SAY from the learned model. Untrusted zones: desk / bed collapse
    to "room" (in the room, not sure where), and no probability above UNTRAINED_CAP."""
    if not learned or zones_trusted:
        return learned
    out = dict(learned)
    st = out.get("state")
    occ = float(out.get("occupied_p") or 0.0)
    if st in ("desk", "bed", "room"):
        out["state"] = "room"
        out["p"] = {"room": round(min(occ, UNTRAINED_CAP), 3)}
    else:
        p = dict(out.get("p") or {})
        out["p"] = {k: round(min(float(v), UNTRAINED_CAP), 3) for k, v in p.items() if k not in ("desk", "bed")}
    out["occupied_p"] = round(min(occ, UNTRAINED_CAP), 3)
    out["zones_trusted"] = False
    out["note"] = "in the room, not sure where: zones are not trusted yet (measure the room, drill 7 days)"
    return out


def _human_band(m) -> Optional[dict]:
    """The HBE test as the frame shows it: how far over its threshold, and how busy
    the last second was against the start gate. None until there is a reading."""
    f = m.features if m else {}
    hbe, thr = f.get("hbe"), f.get("hbe_threshold")
    if hbe is None:
        return None
    return {"energy": round(float(hbe), 2),
            "threshold": round(float(thr), 2) if thr else None,
            "ratio": round(float(hbe) / thr, 2) if thr else None,
            "recent": round(float(f.get("hbe_recent") or 0.0), 2),
            "start_gate": HBE_RECENT_GATE}


def run_engine(source, engine: Engine, stop: threading.Event) -> None:
    """Consumer loop: drain the source's packet queue into the engine."""
    import queue
    import traceback
    while not stop.is_set():
        try:
            pkt = source.packets.get(timeout=0.2)
        except queue.Empty:
            engine.publish_frame()               # nothing arriving: the frame still ages
            continue
        # One bad packet (or a library failing under it) costs that packet, never the
        # thread: on 10-24 an OSError from threadpoolctl ended this loop, the board kept
        # sending, the link said "connected", and nothing was read again until a restart.
        try:
            engine.process(pkt)
            engine.publish_frame()
        except Exception as e:
            engine.note_error(e, traceback.format_exc(limit=4))
