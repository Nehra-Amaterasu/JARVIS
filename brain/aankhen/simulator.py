"""Aankhen simulator — synthetic sensor BYTES with known ground truth.

WHAT THIS IS FOR
  1. Driving the 3D twin and the whole host pipeline before the ESP32 is plugged in.
  2. End-to-end tests and benchmarks with KNOWN ground truth: the simulator knows
     where every simulated person really is, so the pipeline's output can be scored
     (position error, count, detection latency) instead of eyeballed.

WHAT IT IS NOT
  Evidence that the pipeline works on real signals. The radio model below is a few
  lines of textbook physics — a line-of-sight path, a handful of static wall
  reflections, and one moving reflection per body — while real rooms add furniture
  scattering, interference and neighbours' traffic. Every packet it emits is tagged
  kind="simulation" and the UI draws it in amber, never as live data. Real accuracy
  comes only from `python -m aankhen bench` on labelled recordings of the real room.

IT GOES THROUGH THE REAL WIRE FORMAT
  It does not hand numbers to the pipeline. It builds ESP-IDF-shaped CSI buffers
  (int8, imaginary first, FFT bin order, garbage in the invalid first word) and
  byte-exact LD2450 frames, wraps them in protocol.py frames with CRCs and sequence
  numbers, drops some, corrupts a few, and feeds the bytes to the same StreamDecoder
  the serial port uses. A decoder or conditioner bug shows up here, not in the room.

THE RADIO MODEL (per CSI packet)
  H(f) = shadow * H_los(f) + H_static(f) + sum_people a_p * exp(-j 2 pi f L_p / c)

  - H_los: the direct router -> ESP32 path. A body inside the link's first Fresnel
    zone partially blocks it ("shadow"), which is why crossing the link is the most
    visible event a single Wi-Fi link can see.
  - H_static: fixed reflections off walls and furniture (random excess paths 1-14 m).
  - Body path: L_p = |tx - p| + |p - rx| + 2 * chest_displacement. As a person walks,
    L_p changes by ~2 m/s and its phase rotates ~16 turns a second; the interference
    with the static paths makes per-subcarrier amplitudes fluctuate. That fluctuation
    is exactly what the turbulence/MVS detector in motion.py measures.
  - Breathing moves the chest ~3 mm, changing L_p by ~6 mm (~0.3 rad of phase).
  - The body path is ~18 dB below line-of-sight (body_gain 0.12). The first value,
    0.35, made a seated person's breathing score 23x the empty-room level — far
    stronger than published through-wall ESP32 results, where a still person is
    usually indistinguishable from an empty room. A simulator that flatters the
    detector is worse than none.
  - Thermal noise at a fixed SNR, automatic-gain steps, int8 quantisation.

THE RADAR MODEL (per LD2450 frame, ~10 Hz)
  Bodies inside the radar's field of view are projected into its own frame with
  Room.room_to_radar (slant range — the LD2450 measures 3D distance, no elevation).
  Detection probability falls for still bodies, because the LD2450 really does lose
  people who stop moving. One-frame multipath ghosts appear inside and (mirrored)
  outside the walls, which the tracker and to_room() must reject.
"""
from __future__ import annotations

import json
import math
import time
from dataclasses import asdict, dataclass, field
from typing import Iterator, Optional

import numpy as np

from .csi import bin_of
from .protocol import CsiPacket, Frame, FrameType
from .radar import build_frame
from .room import TORSO_HEIGHT_M, Room, SensorPose, default_room
from .transport import RECORD_MAGIC, Source

C = 299_792_458.0
WIFI_CENTER_HZ = 2.437e9                 # channel 6
SUBCARRIER_SPACING_HZ = 312_500.0
SUBCARRIERS = np.array([s for s in range(-26, 27) if s != 0])   # 52 occupied bins
FAKE_ROUTER_MAC = bytes.fromhex("020000000001")   # locally administered: obviously fake

POSTURE_HEIGHT = TORSO_HEIGHT_M        # one definition, shared with the pipeline


# ============================================================== scenarios
@dataclass
class Step:
    """One leg of an actor's script."""
    kind: str                                  # "walk" | "stay" | "leave"
    to: Optional[tuple[float, float]] = None
    seconds: float = 0.0
    speed: float = 0.9                         # m/s, a relaxed indoor walk
    posture: str = "standing"


@dataclass
class Actor:
    name: str
    start: tuple[float, float]
    steps: list[Step]
    enter_at: float = 0.0
    breathing_bpm: float = 14.0


@dataclass
class TruthState:
    """Where a simulated person really is — the answer key for every test."""
    name: str
    x: float
    y: float
    vx: float
    vy: float
    posture: str
    moving: bool
    breathing_bpm: float

    def to_dict(self) -> dict:
        d = asdict(self)
        for k in ("x", "y", "vx", "vy"):
            d[k] = round(d[k], 3)
        return d


@dataclass
class _Leg:
    t0: float
    t1: float
    p0: tuple[float, float]
    p1: tuple[float, float]
    posture: str


class ActorTimeline:
    """An actor's script compiled into time-stamped legs."""

    def __init__(self, actor: Actor):
        self.actor = actor
        self.legs: list[_Leg] = []
        self.leave_at: Optional[float] = None
        t, pos, posture = actor.enter_at, actor.start, "standing"
        for st in actor.steps:
            if st.kind == "walk":
                dist = math.dist(pos, st.to)
                dur = dist / max(st.speed, 1e-3)
                self.legs.append(_Leg(t, t + dur, pos, st.to, "standing"))
                t, pos, posture = t + dur, st.to, "standing"
            elif st.kind == "stay":
                self.legs.append(_Leg(t, t + st.seconds, pos, pos, st.posture))
                t, posture = t + st.seconds, st.posture
            elif st.kind == "leave":
                self.leave_at = t
                break
            else:
                raise ValueError(f"unknown step kind {st.kind!r}")
        self.end = t
        self._last_posture = posture

    def at(self, t: float) -> Optional[TruthState]:
        a = self.actor
        if t < a.enter_at or (self.leave_at is not None and t >= self.leave_at):
            return None
        for leg in self.legs:
            if leg.t0 <= t < leg.t1:
                k = (t - leg.t0) / (leg.t1 - leg.t0)
                x = leg.p0[0] + (leg.p1[0] - leg.p0[0]) * k
                y = leg.p0[1] + (leg.p1[1] - leg.p0[1]) * k
                dur = leg.t1 - leg.t0
                vx, vy = (leg.p1[0] - leg.p0[0]) / dur, (leg.p1[1] - leg.p0[1]) / dur
                moving = math.hypot(vx, vy) > 0.05
                return TruthState(a.name, x, y, vx, vy, leg.posture, moving, a.breathing_bpm)
        last = self.legs[-1] if self.legs else None
        x, y = (last.p1 if last else a.start)
        return TruthState(a.name, x, y, 0.0, 0.0, self._last_posture, False, a.breathing_bpm)


@dataclass
class Scenario:
    name: str
    actors: list[Actor]
    period_s: Optional[float] = None           # loop the script with this period
    description: str = ""

    def compile(self) -> list[ActorTimeline]:
        return [ActorTimeline(a) for a in self.actors]


def scenario_evening() -> Scenario:
    """A plausible evening in the default 4 x 4 m study, looped every 110 s.

    A walks in through the door, sits at the desk for 35 s, moves to the bed and
    lies down for 25 s, then leaves. B comes in while A is lying down, looks at the
    wardrobe, wanders and leaves — so there are two people, a crossing of the Wi-Fi
    link, seated and lying stillness, and ~35 s of genuinely empty room per loop.
    """
    door, chair, bedside = (0.4, 3.6), (0.8, 0.95), (3.0, 3.0)
    a = Actor("A", door, enter_at=4.0, steps=[
        Step("walk", (1.2, 2.0)), Step("walk", chair),
        Step("stay", seconds=35, posture="seated"),
        Step("walk", (2.0, 1.6)), Step("walk", bedside),
        Step("stay", seconds=25, posture="lying"),
        Step("walk", (1.5, 2.6)), Step("walk", door), Step("leave")])
    b = Actor("B", door, enter_at=55.0, breathing_bpm=17.0, steps=[
        Step("walk", (2.6, 1.0)), Step("stay", seconds=6, posture="standing"),
        Step("walk", (3.0, 1.6)), Step("walk", (1.0, 2.5)), Step("walk", door),
        Step("leave")])
    return Scenario("evening", [a, b], period_s=110.0,
                    description="enter, sit at desk, lie on bed, a second person visits, both leave")


def scenario_walk() -> Scenario:
    """One person doing slow laps — the easiest case, for checking the renderer."""
    door = (0.4, 3.6)
    a = Actor("A", door, enter_at=1.0, steps=[
        Step("walk", (1.2, 1.6)), Step("walk", (3.0, 1.4)), Step("walk", (2.0, 0.9)),
        Step("walk", (1.2, 1.6)), Step("walk", door), Step("leave")])
    return Scenario("walk", [a], period_s=16.0, description="one person walking laps")


def scenario_empty() -> Scenario:
    return Scenario("empty", [], description="nobody — used for calibration and false-alarm tests")


def scenario_still() -> Scenario:
    """Someone sitting at the desk the whole time: the hardest case for Wi-Fi."""
    a = Actor("A", (0.8, 0.95), steps=[Step("stay", seconds=10_000, posture="seated")])
    return Scenario("still", [a], description="one person seated and still")


SCENARIOS = {
    "evening": scenario_evening,
    "walk": scenario_walk,
    "empty": scenario_empty,
    "still": scenario_still,
}


# ============================================================== radio models
class CsiChannelModel:
    """Frequency response of the router -> ESP32 link, as described in the header."""

    def __init__(self, room: Room, tx: SensorPose, rx: SensorPose,
                 rng: np.random.Generator, n_static: int = 6, snr_db: float = 28.0,
                 body_gain: float = 0.12):
        self.room, self.tx, self.rx, self.rng = room, tx, rx, rng
        self.f = WIFI_CENTER_HZ + SUBCARRIERS * SUBCARRIER_SPACING_HZ
        self.k = 2 * np.pi * self.f / C                           # wavenumber per bin
        self.tx3 = np.array([tx.x, tx.y, tx.z])
        self.rx3 = np.array([rx.x, rx.y, rx.z])
        self.d_los = float(np.linalg.norm(self.tx3 - self.rx3))
        self.H_los = np.exp(-1j * self.k * self.d_los)
        lens = self.d_los + rng.uniform(1.0, 14.0, n_static)
        amps = rng.uniform(0.15, 0.6, n_static)
        phs = rng.uniform(0, 2 * np.pi, n_static)
        self.H_static = (amps * np.exp(1j * (phs - np.outer(self.k, lens)))).sum(axis=1)
        self.rms = float(np.sqrt(np.mean(np.abs(self.H_los + self.H_static) ** 2)))
        self.noise_sigma = self.rms / (10 ** (snr_db / 20)) / math.sqrt(2)
        self.body_gain = body_gain
        self._body_phase: dict[str, float] = {}

    def response(self, t: float, people: list[TruthState]) -> np.ndarray:
        shadow = 1.0
        H_body = np.zeros_like(self.H_los)
        for p in people:
            h = POSTURE_HEIGHT[p.posture]
            P = np.array([p.x, p.y, h])
            phase0 = self._body_phase.setdefault(p.name, float(self.rng.uniform(0, 2 * np.pi)))
            chest = 0.003 * math.sin(2 * math.pi * p.breathing_bpm / 60.0 * t + phase0)
            L = float(np.linalg.norm(self.tx3 - P) + np.linalg.norm(P - self.rx3)) + 2 * chest
            a = self.body_gain * math.exp(-(L - self.d_los) / 2.5)
            H_body += a * np.exp(1j * (phase0 - self.k * L))
            perp, frac = self.room.link_distance_to(self.tx, self.rx, p.x, p.y)
            r_f = max(self.room.fresnel_radius(self.tx, self.rx, max(0.05, min(0.95, frac))), 0.05)
            shadow *= 1.0 - 0.4 * math.exp(-0.5 * (perp / (1.5 * r_f)) ** 2)
        H = shadow * self.H_los + self.H_static + H_body
        noise = self.rng.normal(0, self.noise_sigma, (2, H.size))
        return H + noise[0] + 1j * noise[1]


class RadarModel:
    """What an LD2450 would report for the current bodies (sensor frame)."""

    # Probability of a detection per frame. Moving bodies are reliable; the LD2450
    # loses still ones, worst when lying down (small cross-section, little motion).
    P_DETECT = {"moving": 0.97, "standing": 0.6, "seated": 0.5, "lying": 0.2}

    def __init__(self, room: Room, sensor: SensorPose, rng: np.random.Generator,
                 sigma_lateral: float = 0.07, sigma_forward: float = 0.05,
                 ghost_p: float = 0.02, mirror_p: float = 0.02):
        self.room, self.s, self.rng = room, sensor, rng
        self.sigma_lateral, self.sigma_forward = sigma_lateral, sigma_forward
        self.ghost_p, self.mirror_p = ghost_p, mirror_p
        self._wander: dict[str, np.ndarray] = {}

    def _project(self, x: float, y: float, h: float) -> Optional[tuple[float, float]]:
        if not self.room.in_fov(self.s, x, y):
            return None
        lat, slant = self.room.room_to_radar(self.s, x, y, body_height_m=h)
        return (lat, slant) if slant > 0.15 else None

    def observe(self, people: list[TruthState]) -> list[tuple[float, float, float]]:
        out = []
        for p in people:
            key = "moving" if p.moving else p.posture
            if self.rng.random() > self.P_DETECT[key]:
                continue
            # The reflecting point wanders over the body (arms, legs): a correlated
            # offset, larger while walking.
            w = self._wander.setdefault(p.name, np.zeros(2))
            amp = 0.06 if p.moving else 0.02
            w[:] = 0.8 * w + self.rng.normal(0, amp * 0.6, 2)
            proj = self._project(p.x + w[0], p.y + w[1], POSTURE_HEIGHT[p.posture])
            if proj is None:
                continue
            lat, slant = proj
            lat += self.rng.normal(0, self.sigma_lateral)
            slant += self.rng.normal(0, self.sigma_forward)
            dx, dy = p.x - self.s.x, p.y - self.s.y
            r = math.hypot(dx, dy) or 1.0
            radial = (p.vx * dx + p.vy * dy) / r            # + = receding (LD2450 sign)
            out.append((lat, slant, radial))
        if people and self.rng.random() < self.mirror_p:
            # Wall reflection: the body mirrored across the nearest side wall. It
            # lands OUTSIDE the room, which to_room() must flag.
            p = people[int(self.rng.integers(len(people)))]
            mx = -p.x if p.x < self.room.width / 2 else 2 * self.room.width - p.x
            proj = self._project(mx, p.y, POSTURE_HEIGHT[p.posture])
            if proj:
                out.append((proj[0], proj[1], 0.0))
        if self.rng.random() < self.ghost_p:
            gx = self.rng.uniform(0.3, self.room.width - 0.3)
            gy = self.rng.uniform(0.3, self.room.depth - 0.3)
            proj = self._project(gx, gy, 1.1)
            if proj:
                out.append((proj[0], proj[1], float(self.rng.normal(0, 0.3))))
        return out[:3]                                   # the LD2450 has three slots


# ============================================================== the simulator
@dataclass
class SimStats:
    csi_sent: int = 0
    csi_dropped: int = 0
    radar_sent: int = 0
    corrupted: int = 0
    bytes_out: int = 0


class Simulator:
    """Generates the byte stream an ESP32 + LD2450 would send for a scenario."""

    kind = "simulation"

    def __init__(self, room: Optional[Room] = None, scenario: Optional[Scenario] = None,
                 seed: int = 0, csi_rate_hz: float = 100.0, radar_rate_hz: float = 10.0,
                 loss: float = 0.03, corrupt: float = 0.002, snr_db: float = 28.0,
                 agc_step_p: float = 0.0005, channel_seed: int = 0):
        self.room = room or default_room()
        self.scenario = scenario or scenario_evening()
        self.timelines = self.scenario.compile()
        self.rng = np.random.default_rng(seed)
        self.csi_dt = 1.0 / csi_rate_hz
        self.radar_dt = 1.0 / radar_rate_hz
        self.loss, self.corrupt, self.agc_step_p = loss, corrupt, agc_step_p
        self.boot_us = 5_000_000
        self.t = 0.0
        self._next = {"csi": 0.0, "radar": 0.003, "status": 0.5}
        self._seq = {FrameType.CSI: 0, FrameType.RADAR: 0, FrameType.STATUS: 0}
        self._burst_until = -1.0
        self._agc_db = 0.0
        self.stats = SimStats()

        link = self.room.links[0] if self.room.links else None
        tx = self.room.sensor(link[0]) if link else None
        rx = self.room.sensor(link[1]) if link else None
        # The static multipath is the ROOM, so it has its own seed: calibrating on
        # one seed and testing on another would be calibrating in a different room.
        self.csi = None
        if tx and rx:
            self.csi = CsiChannelModel(self.room, tx, rx, np.random.default_rng(channel_seed),
                                       snr_db=snr_db)
            self.csi.rng = self.rng                   # per-packet noise follows `seed`
        radars = self.room.sensors_of("ld2450")
        self.radar = RadarModel(self.room, radars[0], self.rng) if radars else None
        if self.csi:
            self._gain = 30.0 / self.csi.rms                  # typical |I|,|Q| ~ 30 counts

    # ---- ground truth ----------------------------------------------------
    def truth_at(self, t: float) -> list[TruthState]:
        if self.scenario.period_s:
            t = t % self.scenario.period_s
        return [s for tl in self.timelines if (s := tl.at(t)) is not None]

    def device_time(self, timestamp_us: int) -> float:
        """Map a packet timestamp back to scenario seconds (for scoring)."""
        return (timestamp_us - self.boot_us) / 1e6

    # ---- packet builders -------------------------------------------------
    def _frame(self, ftype: FrameType, t: float, payload: bytes) -> bytes:
        seq = self._seq[ftype]
        self._seq[ftype] = (seq + 1) & 0xFFFF
        data = bytearray(Frame(ftype, seq, self.boot_us + int(t * 1e6), payload).encode())
        if self.rng.random() < self.corrupt:
            data[int(self.rng.integers(2, len(data)))] ^= 0x5A   # one flipped byte
            self.stats.corrupted += 1
        return bytes(data)

    def _csi_bytes(self, t: float) -> bytes:
        # Packet loss: independent drops plus occasional bursts (a busy router).
        if t < self._burst_until or self.rng.random() < self.loss:
            self.stats.csi_dropped += 1
            return b""
        if self.rng.random() < 0.0005:
            self._burst_until = t + float(self.rng.uniform(0.1, 0.4))
        if self.rng.random() < self.agc_step_p:
            self._agc_db += float(self.rng.choice([-1.5, 1.5]))
        H = self.csi.response(t, self.truth_at(t)) * self._gain * 10 ** (self._agc_db / 20)
        re = np.clip(np.round(H.real), -127, 127).astype(np.int8)
        im = np.clip(np.round(H.imag), -127, 127).astype(np.int8)
        buf = np.zeros(128, dtype=np.int8)
        bins = np.array([bin_of(int(s)) for s in SUBCARRIERS])
        buf[2 * bins], buf[2 * bins + 1] = im, re                  # imaginary FIRST
        buf[:4] = self.rng.integers(-128, 128, 4)                  # invalid first word
        rssi = int(round(-58 + 20 * math.log10(max(np.sqrt(np.mean(np.abs(H) ** 2)), 1e-3) / 30.0)))
        jitter_us = int(self.rng.normal(0, 400))
        pkt = CsiPacket(self.boot_us + int(t * 1e6) + jitter_us, 0, max(-100, min(-20, rssi)),
                        -92, 6, 0, 1, 0, 0, 1, FAKE_ROUTER_MAC, buf.tobytes())
        frame = pkt.to_frame()
        self.stats.csi_sent += 1
        return self._frame(FrameType.CSI, t + jitter_us / 1e6, frame.payload)

    def _radar_bytes(self, t: float) -> bytes:
        targets = self.radar.observe(self.truth_at(t))
        self.stats.radar_sent += 1
        return self._frame(FrameType.RADAR, t, build_frame(targets))

    def _status_bytes(self, t: float) -> bytes:
        body = json.dumps({"fw": "aankhen-simulator", "sim": True, "uptime_s": round(t, 1),
                           "scenario": self.scenario.name, "heap_free": 201_344,
                           "csi_sent": self.stats.csi_sent}).encode()
        return self._frame(FrameType.STATUS, t, body)

    # ---- streaming -------------------------------------------------------
    def advance(self, t_end: float) -> bytes:
        """All bytes the device would have sent between now and t_end."""
        out = bytearray()
        while True:
            kind = min(self._next, key=self._next.get)
            t = self._next[kind]
            if t > t_end:
                break
            if kind == "csi":
                if self.csi:
                    out += self._csi_bytes(t)
                self._next["csi"] = t + self.csi_dt
            elif kind == "radar":
                if self.radar:
                    out += self._radar_bytes(t)
                self._next["radar"] = t + self.radar_dt
            else:
                out += self._status_bytes(t)
                self._next["status"] = t + 1.0
        self.t = t_end
        self.stats.bytes_out += len(out)
        return bytes(out)

    def chunks(self, seconds: float, step_s: float = 0.02) -> Iterator[bytes]:
        """The stream cut into USB-read-sized pieces that ignore frame boundaries."""
        end = self.t + seconds
        while self.t < end - 1e-9:
            data = self.advance(min(end, self.t + step_s))
            i = 0
            while i < len(data):
                n = int(self.rng.integers(64, 2048))
                yield data[i:i + n]
                i += n

    # ---- recordings ------------------------------------------------------
    def write_recording(self, path: str, seconds: float, label_every_s: float = 0.1) -> dict:
        """Write an .akr recording plus a .labels.json answer key beside it.

        Host times in the recording equal device times, so a 1x replay reproduces
        the original pacing exactly.
        """
        import os
        import struct
        os.makedirs(os.path.dirname(os.path.abspath(path)) or ".", exist_ok=True)
        meta = {"created": time.time(), "source": "simulation", "scenario": self.scenario.name,
                "room": self.room.name, "seconds": seconds}
        head = json.dumps(meta).encode("utf-8")
        labels = []
        with open(path, "wb") as f:
            f.write(RECORD_MAGIC + struct.pack("<I", len(head)) + head)
            t, next_label = 0.0, 0.0
            while t < seconds:
                t = min(seconds, t + 0.02)
                data = self.advance(t)
                if data:
                    f.write(struct.pack("<dI", t, len(data)) + data)
                while next_label <= t:
                    labels.append({"t": round(next_label, 3),
                                   "people": [s.to_dict() for s in self.truth_at(next_label)]})
                    next_label += label_every_s
        label_path = path.rsplit(".", 1)[0] + ".labels.json"
        with open(label_path, "w", encoding="utf-8") as f:
            json.dump({"kind": "simulation-truth", "scenario": self.scenario.name,
                       "boot_us": self.boot_us, "labels": labels}, f)
        return {"recording": path, "labels": label_path, "stats": asdict(self.stats)}


class SimulatorSource(Source):
    """Live, wall-clock-paced simulator feeding the real decoder.

    Device timestamps come from simulated time, so the CSI rate the pipeline
    measures is exact even though Windows sleeps in ~15 ms steps.
    speed=0 runs as fast as possible for `duration_s` (tests, benchmarks).
    """

    kind = "simulation"

    def __init__(self, sim: Simulator, speed: float = 1.0, duration_s: Optional[float] = None):
        super().__init__(max_queue=200_000)
        self.sim = sim
        self.speed = speed
        self.duration_s = duration_s

    def _run(self) -> None:
        if self.speed <= 0:
            for chunk in self.sim.chunks(self.duration_s or 60.0):
                if self._stop.is_set():
                    return
                self._ingest(chunk)
            for frame in self.decoder.flush():
                self._emit(frame)
            return
        t0 = time.monotonic()
        while not self._stop.is_set():
            target = (time.monotonic() - t0) * self.speed
            if self.duration_s is not None and target >= self.duration_s:
                target = self.duration_s
            data = self.sim.advance(target)
            for i in range(0, len(data), 1024):
                self._ingest(data[i:i + 1024])
            if self.duration_s is not None and target >= self.duration_s:
                return
            self._stop.wait(0.02)
