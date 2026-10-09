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
         [+ sum_blades a_b * exp(-j 2 pi f L_b / c)   when a ceiling fan spins]

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
  outside the walls, which the tracker and to_room() must reject. 24 GHz does not
  get through a brick wall, so people outside the room are never reported.

WORLD EFFECTS (opt-in per scenario; the original four scenarios use none of them)
  The 2026-10-09 audit ran the pipeline against effects the first model lacked and
  each one broke it: a running ceiling fan (99 % false "occupied" in an empty room),
  someone walking near the router outside the room (100 %), an LD2450 that really
  forgets a still person (74 % false "empty" for someone reading), a static channel
  drifting through a deep subcarrier null (43 %). They are modelled here so the
  benchmark can hold the pipeline to them:
  - radar_still_loss_s: the LD2450 reports a still body for this long, then (almost)
    never again until it moves. Per-frame independent detection — the original
    model — never produces the minutes-long silences the real sensor does.
  - radar_merge_m: two bodies closer than the LD2450's ~0.6 m resolution come back
    as ONE target at their centroid.
  - fan: a ceiling fan's blades as moving point scatterers (spin-up/down, slow speed
    wobble), a relay state in the STATUS frame, and optional radar returns from the
    blades (zero displacement, flickering Doppler).
  - drift: the static multipath slowly rotating in phase (a door, a curtain,
    temperature) — harmless until a subcarrier passes through a deep null.
  - rich physiology per actor: breathing-rate wander, sighs, and fidgets (a few cm of
    movement for 1-2.5 s, which both sensors see) while sitting or lying.
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
_BINS = np.array([bin_of(int(s)) for s in SUBCARRIERS])
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
    # Richer physiology, opt-in (the sleep scenario). The defaults keep the original
    # model — a 3 mm sine at a constant rate, nobody ever fidgets — which flatters a
    # breathing detector: a 60 s spectral window on a perfectly steady rate is the
    # easiest case there is.
    chest_mm: Optional[float] = None           # peak chest/abdomen displacement
    breath_wander: float = 0.0                 # +- fractional slow wander of the rate
    sigh_every_s: Optional[float] = None       # mean interval between deep breaths
    fidget_every_s: Optional[float] = None     # mean interval between fidgets while still


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
    chest_m: Optional[float] = None            # set by the rich physiology model only

    def to_dict(self) -> dict:
        d = asdict(self)
        for k in ("x", "y", "vx", "vy"):
            d[k] = round(d[k], 3)
        if d["chest_m"] is not None:
            d["chest_m"] = round(d["chest_m"], 5)
        d["breathing_bpm"] = round(d["breathing_bpm"], 2)
        return d


@dataclass
class _Leg:
    t0: float
    t1: float
    p0: tuple[float, float]
    p1: tuple[float, float]
    posture: str


@dataclass
class _Fidget:
    t0: float
    dur: float
    dx: float
    dy: float


class ActorTimeline:
    """An actor's script compiled into time-stamped legs.

    `rng` draws the random parts of the script (fidget and sigh times). It is its
    own generator, never the simulator's noise stream, so adding a fidget cannot
    shift every later noise sample.
    """

    def __init__(self, actor: Actor, rng: Optional[np.random.Generator] = None):
        self.actor = actor
        self.legs: list[_Leg] = []
        self.leave_at: Optional[float] = None
        self.fidgets: list[_Fidget] = []
        self.sighs: list[float] = []
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
        rng = rng if rng is not None else np.random.default_rng(0)
        if actor.fidget_every_s:
            for leg in self.legs:
                if leg.p0 != leg.p1:
                    continue
                ft = leg.t0 + 5.0
                while True:
                    ft += float(rng.exponential(actor.fidget_every_s))
                    if ft > leg.t1 - 5.0:
                        break
                    dx, dy = np.clip(rng.normal(0, 0.05, 2), -0.12, 0.12)
                    self.fidgets.append(_Fidget(ft, float(rng.uniform(1.0, 2.5)), float(dx), float(dy)))
        if actor.sigh_every_s:
            st_t = actor.enter_at
            stop = self.leave_at if self.leave_at is not None else max(self.end, actor.enter_at) + 10_000
            while True:
                st_t += float(rng.exponential(actor.sigh_every_s))
                if st_t >= stop:
                    break
                self.sighs.append(st_t)
        self._wander_phase = rng.uniform(0, 2 * np.pi, 2)
        self._breath_phase = float(rng.uniform(0, 2 * np.pi))

    # ---- physiology ------------------------------------------------------
    _T1, _T2 = 47.0, 113.0                     # wander periods, s

    def _breathing(self, t: float) -> tuple[float, Optional[float]]:
        """(instantaneous rate in breaths/min, chest displacement in m or None)."""
        a = self.actor
        if a.chest_mm is None:
            return a.breathing_bpm, None
        f0 = a.breathing_bpm / 60.0
        w = a.breath_wander
        p1, p2 = self._wander_phase
        T1, T2 = self._T1, self._T2
        # Phase is the integral of the wandering rate, so the rate can change
        # smoothly without the waveform jumping.
        ph = 2 * math.pi * f0 * (t - w * 0.6 * T1 / (2 * math.pi) * math.cos(2 * math.pi * t / T1 + p1)
                                 - w * 0.4 * T2 / (2 * math.pi) * math.cos(2 * math.pi * t / T2 + p2))
        f = f0 * (1 + w * (0.6 * math.sin(2 * math.pi * t / T1 + p1) + 0.4 * math.sin(2 * math.pi * t / T2 + p2)))
        amp = a.chest_mm / 1000.0
        for s in self.sighs:
            if abs(t - s) < 6.0:
                amp *= 1 + 1.5 * math.exp(-0.5 * ((t - s) / 1.5) ** 2)
        return f * 60.0, amp * math.sin(ph + self._breath_phase)

    def _fidget(self, t: float) -> Optional[tuple[float, float, float, float]]:
        for fg in self.fidgets:
            if fg.t0 <= t < fg.t0 + fg.dur:
                k = math.pi * (t - fg.t0) / fg.dur
                s, ds = math.sin(k), math.cos(k) * math.pi / fg.dur
                return fg.dx * s, fg.dy * s, fg.dx * ds, fg.dy * ds
        return None

    def at(self, t: float) -> Optional[TruthState]:
        a = self.actor
        if t < a.enter_at or (self.leave_at is not None and t >= self.leave_at):
            return None
        bpm, chest = self._breathing(t)
        for leg in self.legs:
            if leg.t0 <= t < leg.t1:
                k = (t - leg.t0) / (leg.t1 - leg.t0)
                x = leg.p0[0] + (leg.p1[0] - leg.p0[0]) * k
                y = leg.p0[1] + (leg.p1[1] - leg.p0[1]) * k
                dur = leg.t1 - leg.t0
                vx, vy = (leg.p1[0] - leg.p0[0]) / dur, (leg.p1[1] - leg.p0[1]) / dur
                moving = math.hypot(vx, vy) > 0.05
                if not moving and self.fidgets:
                    fg = self._fidget(t)
                    if fg is not None:
                        # A fidget is real movement: both sensors see it, so the
                        # answer key calls it "moving".
                        x, y, vx, vy = x + fg[0], y + fg[1], fg[2], fg[3]
                        moving = True
                return TruthState(a.name, x, y, vx, vy, leg.posture, moving, bpm, chest)
        last = self.legs[-1] if self.legs else None
        x, y = (last.p1 if last else a.start)
        return TruthState(a.name, x, y, 0.0, 0.0, self._last_posture, False, bpm, chest)


@dataclass
class Fan:
    """A ceiling fan: blade scatterers on a circle, switched by a relay."""
    x: float = 2.0
    y: float = 2.2
    z: float = 2.6
    blade_r: float = 0.55
    n_blades: int = 3
    rps: float = 4.0                           # 240 rpm, a mid regulator setting
    wobble: float = 0.03                       # +- fractional slow speed variation
    blade_gain: float = 0.015                  # the audit's crossover: 0.005 harmless, 0.015 saturates
    radar_p: float = 0.0                       # chance per radar frame the LD2450 reports the blades
    on: list = field(default_factory=list)     # relay-on intervals [(t_on, t_off), ...]
    spin_up_s: float = 4.0
    spin_down_s: float = 12.0

    def relay_on(self, t: float) -> bool:
        return any(a <= t < b for a, b in self.on)


class FanState:
    """Rotation of a Fan, advanced in time order by whoever looks at it first."""

    def __init__(self, fan: Fan):
        self.fan = fan
        self.t: Optional[float] = None
        self.rps = 0.0
        self.angle = 0.0

    def advance(self, t: float) -> None:
        if self.t is None:
            self.t = t
            self.rps = self._target(t) if self.fan.relay_on(t) else 0.0
            return
        dt = t - self.t
        if dt <= 0:
            return
        target = self._target(t) if self.fan.relay_on(t) else 0.0
        tau = self.fan.spin_up_s if target > self.rps else self.fan.spin_down_s
        self.rps = target + (self.rps - target) * math.exp(-dt / tau)
        self.angle += 2 * math.pi * self.rps * dt
        self.t = t

    def _target(self, t: float) -> float:
        f = self.fan
        return f.rps * (1 + f.wobble * math.sin(2 * math.pi * t / 37.0))

    @property
    def spinning(self) -> bool:
        return self.rps > 0.5

    def blades(self) -> list[np.ndarray]:
        f = self.fan
        c = np.array([f.x, f.y, f.z])
        return [c + f.blade_r * np.array([math.cos(self.angle + 2 * math.pi * b / f.n_blades),
                                           math.sin(self.angle + 2 * math.pi * b / f.n_blades), 0.0])
                for b in range(f.n_blades)]


@dataclass
class Drift:
    """Static multipath rotating in phase: 0 -> phase_rad along a smooth ramp."""
    phase_rad: float = 1.0
    ramp_s: float = 250.0
    start_s: float = 0.0

    def phase(self, t: float) -> float:
        k = min(max((t - self.start_s) / self.ramp_s, 0.0), 1.0)
        return self.phase_rad * (1 - math.cos(math.pi * k)) / 2


@dataclass
class Scenario:
    name: str
    actors: list[Actor]
    period_s: Optional[float] = None           # loop the script with this period
    description: str = ""
    radar_still_loss_s: Optional[float] = None
    radar_merge_m: Optional[float] = None
    fan: Optional[Fan] = None
    drift: Optional[Drift] = None

    def compile(self, rng: Optional[np.random.Generator] = None) -> list[ActorTimeline]:
        return [ActorTimeline(a, rng) for a in self.actors]


DOOR = (0.4, 3.6)


def scenario_evening() -> Scenario:
    """A plausible evening in the default 4 x 4 m study, looped every 110 s.

    A walks in through the door, sits at the desk for 35 s, moves to the bed and
    lies down for 25 s, then leaves. B comes in while A is lying down, looks at the
    wardrobe, wanders and leaves — so there are two people, a crossing of the Wi-Fi
    link, seated and lying stillness, and ~35 s of genuinely empty room per loop.
    """
    door, chair, bedside = DOOR, (0.8, 0.95), (3.0, 3.0)
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
    door = DOOR
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


def scenario_sleep() -> Scenario:
    """Walk in, lie on the bed for nine minutes, get up and leave.

    The LD2450 forgets the sleeper 8 s after they stop moving and sees them again
    only when they fidget (every ~2.5 min on average). Breathing wanders by +-12 %,
    with a sigh every ~3 min. This is the case where the system must not decide the
    room is empty: the audit measured 39 % false "empty" here.
    """
    bed = (3.0, 3.0)
    a = Actor("A", DOOR, enter_at=2.0, breathing_bpm=13.0, chest_mm=4.5, breath_wander=0.12,
              sigh_every_s=180.0, fidget_every_s=150.0, steps=[
                  Step("walk", (1.5, 2.6)), Step("walk", bed),
                  Step("stay", seconds=540, posture="lying"),
                  Step("walk", (1.5, 2.6)), Step("walk", DOOR), Step("leave")])
    return Scenario("sleep", [a], radar_still_loss_s=8.0,
                    description="nine minutes asleep; the radar loses the sleeper between fidgets")


def scenario_hallway() -> Scenario:
    """The room is EMPTY; someone paces in the hallway next to the router.

    The Wi-Fi link runs from the router (3 m outside the wall) across the room, so a
    person near the router perturbs it more than anyone inside. The audit measured
    100 % false "occupied" for this.
    """
    n = Actor("N", (-2.6, 1.2), steps=[Step("walk", (-0.4, 2.8), speed=0.8),
                                        Step("walk", (-2.6, 1.2), speed=0.8)] * 40)
    return Scenario("hallway", [n], description="empty room, a neighbour pacing near the router")


def scenario_fan() -> Scenario:
    """The ceiling fan runs the whole time (relay on at 3 s). The room is empty for
    100 s, A comes in, works at the desk for a minute, and leaves. The LD2450 also
    picks up the blades in 30 % of its frames."""
    a = Actor("A", DOOR, enter_at=100.0, steps=[
        Step("walk", (1.2, 2.0)), Step("walk", (0.8, 0.95)),
        Step("stay", seconds=60, posture="seated"),
        Step("walk", (1.5, 2.6)), Step("walk", DOOR), Step("leave")])
    return Scenario("fan", [a], fan=Fan(radar_p=0.3, on=[(3.0, 1e9)]),
                    description="ceiling fan on; empty, then a visit to the desk, then empty")


def scenario_pair() -> Scenario:
    """Two people sit side by side on the edge of the bed, 0.45 m apart — closer than
    the LD2450 can separate, so it reports one target."""
    a = Actor("A", DOOR, enter_at=2.0, steps=[
        Step("walk", (1.5, 2.6)), Step("walk", (2.6, 2.4)),
        Step("stay", seconds=90, posture="seated"), Step("walk", (1.5, 2.6)),
        Step("walk", DOOR), Step("leave")])
    b = Actor("B", DOOR, enter_at=5.0, breathing_bpm=17.0, steps=[
        Step("walk", (1.6, 2.9)), Step("walk", (3.05, 2.4)),
        Step("stay", seconds=86, posture="seated"), Step("walk", (1.6, 2.9)),
        Step("walk", DOOR), Step("leave")])
    return Scenario("pair", [a, b], radar_merge_m=0.6,
                    description="two people seated 0.45 m apart on the bed edge")


def scenario_drift() -> Scenario:
    """Empty room whose static multipath slowly rotates by 1 rad over ~4 min (a door
    easing open, a curtain, temperature). With the default channel a subcarrier passes
    through a deep null around 150-250 s; the audit measured the empty-room motion
    score rising to 27x there. Then someone walks laps and leaves."""
    a = Actor("A", DOOR, enter_at=300.0, steps=[
        Step("walk", (1.2, 1.6)), Step("walk", (3.0, 1.4)), Step("walk", (2.0, 0.9)),
        Step("walk", (1.2, 1.6)), Step("walk", (3.0, 1.4)), Step("walk", (2.0, 0.9)),
        Step("walk", (1.2, 1.6)), Step("walk", DOOR), Step("leave")])
    return Scenario("drift", [a], drift=Drift(phase_rad=1.0, ramp_s=250.0),
                    description="empty room drifting through a subcarrier null, then a visit")


SCENARIOS = {
    "evening": scenario_evening,
    "walk": scenario_walk,
    "empty": scenario_empty,
    "still": scenario_still,
    "sleep": scenario_sleep,
    "hallway": scenario_hallway,
    "fan": scenario_fan,
    "pair": scenario_pair,
    "drift": scenario_drift,
}


# ============================================================== radio models
class CsiChannelModel:
    """Frequency response of the router -> ESP32 link, as described in the header."""

    def __init__(self, room: Room, tx: SensorPose, rx: SensorPose,
                 rng: np.random.Generator, n_static: int = 6, snr_db: float = 28.0,
                 body_gain: float = 0.12, fan: Optional[FanState] = None,
                 drift: Optional[Drift] = None):
        self.room, self.tx, self.rx, self.rng = room, tx, rx, rng
        self.f = WIFI_CENTER_HZ + SUBCARRIERS * SUBCARRIER_SPACING_HZ
        self.k = 2 * np.pi * self.f / C                           # wavenumber per bin
        self.tx3 = np.array([tx.x, tx.y, tx.z])
        self.rx3 = np.array([rx.x, rx.y, rx.z])
        self._tx3, self._rx3 = (tx.x, tx.y, tx.z), (rx.x, rx.y, rx.z)   # for math.dist
        self.d_los = float(np.linalg.norm(self.tx3 - self.rx3))
        self.H_los = np.exp(-1j * self.k * self.d_los)
        lens = self.d_los + rng.uniform(1.0, 14.0, n_static)
        amps = rng.uniform(0.15, 0.6, n_static)
        phs = rng.uniform(0, 2 * np.pi, n_static)
        self.H_static = (amps * np.exp(1j * (phs - np.outer(self.k, lens)))).sum(axis=1)
        self.rms = float(np.sqrt(np.mean(np.abs(self.H_los + self.H_static) ** 2)))
        self.noise_sigma = self.rms / (10 ** (snr_db / 20)) / math.sqrt(2)
        self.body_gain = body_gain
        self.fan = fan
        self.drift = drift
        self._body_phase: dict[str, float] = {}

    def static_response(self, t: float) -> np.ndarray:
        if self.drift is None:
            return self.H_static
        return self.H_static * np.exp(1j * self.drift.phase(t))

    def response(self, t: float, people: list[TruthState]) -> np.ndarray:
        shadow = 1.0
        H_body = np.zeros_like(self.H_los)
        for p in people:
            P = (p.x, p.y, POSTURE_HEIGHT[p.posture])
            phase0 = self._body_phase.setdefault(p.name, float(self.rng.uniform(0, 2 * np.pi)))
            if p.chest_m is not None:
                chest = p.chest_m
            else:
                chest = 0.003 * math.sin(2 * math.pi * p.breathing_bpm / 60.0 * t + phase0)
            L = math.dist(self._tx3, P) + math.dist(P, self._rx3) + 2 * chest
            a = self.body_gain * math.exp(-(L - self.d_los) / 2.5)
            H_body += a * np.exp(1j * (phase0 - self.k * L))
            perp, frac = self.room.link_distance_to(self.tx, self.rx, p.x, p.y)
            r_f = max(self.room.fresnel_radius(self.tx, self.rx, max(0.05, min(0.95, frac))), 0.05)
            shadow *= 1.0 - 0.4 * math.exp(-0.5 * (perp / (1.5 * r_f)) ** 2)
        H = shadow * self.H_los + self.static_response(t) + H_body
        if self.fan is not None:
            self.fan.advance(t)
            if self.fan.rps > 0.05:
                g = self.fan.fan.blade_gain
                for P in self.fan.blades():
                    P = tuple(P)
                    L = math.dist(self._tx3, P) + math.dist(P, self._rx3)
                    H = H + g * np.exp(-1j * self.k * L)
        noise = self.rng.normal(0, self.noise_sigma, (2, H.size))
        return H + noise[0] + 1j * noise[1]


class RadarModel:
    """What an LD2450 would report for the current bodies (sensor frame)."""

    # Probability of a detection per frame. Moving bodies are reliable; the LD2450
    # loses still ones, worst when lying down (small cross-section, little motion).
    P_DETECT = {"moving": 0.97, "standing": 0.6, "seated": 0.5, "lying": 0.2}

    def __init__(self, room: Room, sensor: SensorPose, rng: np.random.Generator,
                 sigma_lateral: float = 0.07, sigma_forward: float = 0.05,
                 ghost_p: float = 0.02, mirror_p: float = 0.02,
                 still_loss_s: Optional[float] = None, p_still_late: float = 0.0,
                 merge_m: Optional[float] = None, fan: Optional[FanState] = None):
        self.room, self.s, self.rng = room, sensor, rng
        self.sigma_lateral, self.sigma_forward = sigma_lateral, sigma_forward
        self.ghost_p, self.mirror_p = ghost_p, mirror_p
        self.still_loss_s, self.p_still_late = still_loss_s, p_still_late
        self.merge_m = merge_m
        self.fan = fan
        self._wander: dict[str, np.ndarray] = {}
        self._still_since: dict[str, float] = {}

    def _project(self, x: float, y: float, h: float) -> Optional[tuple[float, float]]:
        if not self.room.in_fov(self.s, x, y):
            return None
        lat, slant = self.room.room_to_radar(self.s, x, y, body_height_m=h)
        return (lat, slant) if slant > 0.15 else None

    def _merge(self, people: list[TruthState]) -> list[TruthState]:
        """Bodies closer than the range resolution come back as one target."""
        out = list(people)
        merged = True
        while merged and len(out) > 1:
            merged = False
            for i in range(len(out)):
                for j in range(i + 1, len(out)):
                    p, q = out[i], out[j]
                    if math.hypot(p.x - q.x, p.y - q.y) < self.merge_m:
                        m = TruthState(p.name, (p.x + q.x) / 2, (p.y + q.y) / 2, (p.vx + q.vx) / 2,
                                       (p.vy + q.vy) / 2, p.posture, p.moving or q.moving,
                                       p.breathing_bpm, p.chest_m)
                        out = [m] + [o for k, o in enumerate(out) if k not in (i, j)]
                        merged = True
                        break
                if merged:
                    break
        return out

    def observe(self, people: list[TruthState], t: Optional[float] = None) -> list[tuple[float, float, float]]:
        out = []
        # 24 GHz does not get through a brick wall: nobody outside the room is reported.
        people = [p for p in people if self.room.inside(p.x, p.y)]
        if self.merge_m:
            people = self._merge(people)
        for p in people:
            key = "moving" if p.moving else p.posture
            pd = self.P_DETECT[key]
            if self.still_loss_s is not None and t is not None:
                if p.moving:
                    self._still_since.pop(p.name, None)
                elif t - self._still_since.setdefault(p.name, t) > self.still_loss_s:
                    pd = self.p_still_late
            if self.rng.random() > pd:
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
        if self.fan is not None and self.fan.fan.radar_p > 0 and t is not None:
            # Blade returns: a fixed point with a large, sign-flipping Doppler (the
            # strongest blade alternates between approaching and receding). This is
            # an ASSUMPTION about the LD2450's output for a fan, to be checked by
            # recording the real room with the fan on and nobody in it.
            self.fan.advance(t)
            if self.fan.spinning and self.rng.random() < self.fan.fan.radar_p:
                f = self.fan.fan
                proj = self._project(f.x + self.rng.normal(0, 0.1), f.y + self.rng.normal(0, 0.1), f.z)
                if proj:
                    v = float(self.rng.choice([-1.0, 1.0]) * self.rng.uniform(0.2, 1.0))
                    out.append((proj[0] + self.rng.normal(0, 0.05), proj[1] + self.rng.normal(0, 0.05), v))
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
        # The script's own random parts (fidgets, sighs) have their own generator.
        self.timelines = self.scenario.compile(np.random.default_rng([seed, 7]))
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
        self.fan = FanState(self.scenario.fan) if self.scenario.fan else None

        link = self.room.links[0] if self.room.links else None
        tx = self.room.sensor(link[0]) if link else None
        rx = self.room.sensor(link[1]) if link else None
        # The static multipath is the ROOM, so it has its own seed: calibrating on
        # one seed and testing on another would be calibrating in a different room.
        self.csi = None
        if tx and rx:
            self.csi = CsiChannelModel(self.room, tx, rx, np.random.default_rng(channel_seed),
                                       snr_db=snr_db, fan=self.fan, drift=self.scenario.drift)
            self.csi.rng = self.rng                   # per-packet noise follows `seed`
        radars = self.room.sensors_of("ld2450")
        self.radar = RadarModel(self.room, radars[0], self.rng,
                                still_loss_s=self.scenario.radar_still_loss_s,
                                merge_m=self.scenario.radar_merge_m,
                                fan=self.fan) if radars else None
        if self.csi:
            self._gain = 30.0 / self.csi.rms                  # typical |I|,|Q| ~ 30 counts

    # ---- ground truth ----------------------------------------------------
    def truth_at(self, t: float) -> list[TruthState]:
        """Everyone the script places anywhere — including outside the room."""
        if self.scenario.period_s:
            t = t % self.scenario.period_s
        return [s for tl in self.timelines if (s := tl.at(t)) is not None]

    def occupants_at(self, t: float) -> list[TruthState]:
        """The people actually inside the room: what presence is scored against."""
        return [s for s in self.truth_at(t) if self.room.inside(s.x, s.y)]

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
            # Bounded: a real AGC is a loop that keeps the level in range. The first
            # version random-walked without limit — +12 dB after ~4 minutes on one
            # seed, clipping the int8 I/Q and faking a breathing signal in an empty room.
            self._agc_db = min(4.5, max(-4.5, self._agc_db + float(self.rng.choice([-1.5, 1.5]))))
        H = self.csi.response(t, self.truth_at(t)) * self._gain * 10 ** (self._agc_db / 20)
        re = np.clip(np.round(H.real), -127, 127).astype(np.int8)
        im = np.clip(np.round(H.imag), -127, 127).astype(np.int8)
        buf = np.zeros(128, dtype=np.int8)
        buf[2 * _BINS], buf[2 * _BINS + 1] = im, re                # imaginary FIRST
        buf[:4] = self.rng.integers(-128, 128, 4)                  # invalid first word
        rssi = int(round(-58 + 20 * math.log10(max(np.sqrt(np.mean(np.abs(H) ** 2)), 1e-3) / 30.0)))
        jitter_us = int(self.rng.normal(0, 400))
        pkt = CsiPacket(self.boot_us + int(t * 1e6) + jitter_us, 0, max(-100, min(-20, rssi)),
                        -92, 6, 0, 1, 0, 0, 1, FAKE_ROUTER_MAC, buf.tobytes())
        frame = pkt.to_frame()
        self.stats.csi_sent += 1
        return self._frame(FrameType.CSI, t + jitter_us / 1e6, frame.payload)

    def _radar_bytes(self, t: float) -> bytes:
        targets = self.radar.observe(self.truth_at(t), t)
        self.stats.radar_sent += 1
        return self._frame(FrameType.RADAR, t, build_frame(targets))

    def _status_bytes(self, t: float) -> bytes:
        status = {"fw": "aankhen-simulator", "sim": True, "uptime_s": round(t, 1),
                  "scenario": self.scenario.name, "heap_free": 201_344,
                  "csi_sent": self.stats.csi_sent}
        if self.fan is not None:
            # The real firmware reports its relays in every STATUS frame.
            status["relays"] = {"light": False, "fan": self.fan.fan.relay_on(t)}
        return self._frame(FrameType.STATUS, t, json.dumps(status).encode())

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
        the original pacing exactly. The answer key lists the people INSIDE the room.
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
                                   "people": [s.to_dict() for s in self.occupants_at(next_label)]})
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
