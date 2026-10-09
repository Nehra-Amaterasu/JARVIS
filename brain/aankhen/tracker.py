"""Multi-target tracker for room-scale person tracking (LD2450 radar and similar).

A radar reports up to three detections per frame, each with jitter of roughly
10-20 cm, occasional ghost targets from multipath, and dropouts when a person
sits still. A tracker turns that into a small set of stable, identified people.

PIPELINE PER FRAME
  1. predict   every track forward with a constant-velocity Kalman filter
  2. gate      ignore track/detection pairs too unlikely to be the same person
               (Mahalanobis distance, chi-square 99% for 2 DOF = 9.21)
  3. assign    Hungarian algorithm (optimal one-to-one matching) on the gated
               costs, so two people walking past each other don't swap IDs
  4. update    matched tracks absorb their detection
  5. birth     unmatched detections start TENTATIVE tracks
  6. confirm   a tentative track needs M hits in its first N frames
               (default 3 of 5) before it is shown — this is what removes
               single-frame ghost targets
  7. coast     unmatched tracks keep predicting with growing uncertainty,
               and are deleted after max_coast_s without a detection

STATE  x = [px, py, vx, vy] in room metres and metres/second.

The noise values below are starting points, documented so they can be tuned
against recordings rather than guessed at: walking humans accelerate at roughly
1-2 m/s^2, and LD2450 position jitter is on the order of 0.1-0.2 m.
"""
from __future__ import annotations

import itertools
import math
from dataclasses import dataclass, field
from typing import Callable, Optional

import numpy as np
from scipy.optimize import linear_sum_assignment

CHI2_2DOF_99 = 9.21


@dataclass
class TrackerConfig:
    """Defaults from the TI people-tracking tuning guide and LD2450 field reports
    (see docs/DECISIONS.md). The first version used generic textbook values;
    these replace them."""
    meas_std_m: float = 0.15          # radar position noise (1 sigma)
    accel_std: float = 1.0            # process noise while walking, m/s^2
    accel_std_still: float = 0.2      # ... while sitting / standing still
    gate_chi2: float = CHI2_2DOF_99   # Mahalanobis gate
    gate_euclid_m: float = 1.2        # AND a hard distance cap (guards inflated P)
    confirm_hits: int = 4             # M ...
    confirm_window: int = 6           # ... of N frames (0.6 s at 10 Hz) to confirm
    max_coast_s: float = 1.0          # moving track deleted after ~10 missed frames
    max_coast_tentative_s: float = 0.3
    init_vel_std: float = 1.0         # unknown initial velocity, m/s
    max_speed: float = 3.0            # reject physically absurd velocities
    max_tracks: int = 8
    # STILL MODE. The LD2450 is built for moving targets and routinely loses a
    # person who sits still (widely reported). A track that has moved less than
    # still_disp_m over the last still_after_s is held through radar silence for
    # still_hold_s instead of being deleted after one second, and a returning
    # detection re-attaches to it
    # within still_reattach_m rather than spawning a new identity.
    # Stillness is judged on DISPLACEMENT of the filtered position, not on the
    # instantaneous velocity. The first version used speed < 0.15 m/s, but with
    # 0.15 m radar noise the Kalman velocity itself jitters by ~0.16 m/s, so a
    # seated person flickered between still and moving: the benchmark counted
    # 13 % "moving" for someone sitting motionless, and every flicker dropped the
    # long still-hold, so radar dropouts caused ID switches. Net displacement
    # over 2 s averages that jitter away. Hysteresis: still below 0.30 m, moving
    # again only above 0.50 m.
    still_speed: float = 0.15         # kept for callers; no longer decides stillness
    still_after_s: float = 2.0
    still_disp_m: float = 0.30
    move_disp_m: float = 0.50
    # STICKY ZONES (desk, bed: Zone.expect_stationary). People stop there, and
    # the radar then sees them in only ~20-50 % of frames, so:
    #  - a slow track that starts coasting inside one is switched to still mode
    #    at once (velocity zeroed) instead of dying after max_coast_s, and
    #  - a new track there may confirm on confirm_hits detections within
    #    sticky_confirm_s, which a lying person (~2 detections/s) can achieve
    #    but a one-frame multipath ghost at a random position cannot.
    # Found by the benchmark: a person lying on the bed vanished within a second.
    # Any speed: people WALK to the bed and stop. With 0.6 m/s the walking track
    # coasted on at ~0.9 m/s after the radar lost the now-still person, overshot
    # by most of a metre and died — and a new identity was born in its place.
    sticky_slow_speed: float = 3.0
    sticky_coast_trigger_s: float = 0.3
    sticky_confirm_s: float = 4.0
    sticky_tentative_coast_s: float = 1.5
    # No new track may be born this close to a confirmed one. Without it, a
    # detection that narrowly missed a still track (whose covariance has grown)
    # seeded a duplicate with a tight covariance, which then won every Hungarian
    # assignment and starved the real track: 17 ID switches for ONE seated person
    # in 90 s on the benchmark.
    min_birth_sep_m: float = 0.7
    still_hold_s: float = 30.0
    still_reattach_m: float = 1.5
    # WAKE-UP. A still track that receives a detection farther than wake_m away
    # treats a single one as an outlier (a multipath ghost dragged a long-silent
    # still track 0.8 m off on the benchmark) but wakes on a second within
    # wake_window_s: it leaves still mode and its velocity uncertainty is reset so
    # it can follow someone who just stood up. Without this the slow still-mode
    # filter lagged behind them, they escaped the gate, a new track was born and
    # the old one haunted the chair for 30 s.
    wake_m: float = 0.45
    wake_window_s: float = 0.6


@dataclass
class Track:
    id: int
    x: np.ndarray                     # state [px, py, vx, vy]
    P: np.ndarray                     # covariance 4x4
    born_at: float
    last_update: float
    hits: int = 1
    frames_seen: int = 1              # frames since birth (for M-of-N)
    confirmed: bool = False
    slow_since: Optional[float] = None    # when speed first dropped below still_speed
    still: bool = False
    history: list = field(default_factory=list)   # recent (t, x, y) for trails
    last_z: Optional[np.ndarray] = None   # last measurement that updated this track
    wake_since: Optional[float] = None    # first far detection while still

    @property
    def position(self) -> tuple[float, float]:
        return float(self.x[0]), float(self.x[1])

    @property
    def velocity(self) -> tuple[float, float]:
        return float(self.x[2]), float(self.x[3])

    @property
    def speed(self) -> float:
        return math.hypot(*self.velocity)

    @property
    def position_std(self) -> float:
        """1-sigma positional uncertainty, metres (mean of the x/y variances)."""
        return float(math.sqrt(max(0.0, (self.P[0, 0] + self.P[1, 1]) / 2)))

    def confidence(self, now: float, cfg: TrackerConfig) -> float:
        """0..1 — falls with time since the last real detection.

        A still track decays over its longer hold window: the radar going quiet
        is expected when someone sits down, so it is weaker evidence of absence.
        """
        if not self.confirmed:
            return 0.0
        silence = now - self.last_update
        window = cfg.still_hold_s if self.still else cfg.max_coast_s
        return max(0.0, 1.0 - silence / window)


class MultiTargetTracker:
    def __init__(self, cfg: Optional[TrackerConfig] = None,
                 sticky_at: Optional[Callable[[float, float], bool]] = None):
        self.sticky_at = sticky_at
        self.cfg = cfg or TrackerConfig()
        self.tracks: list[Track] = []
        self._ids = itertools.count(1)
        self._last_t: Optional[float] = None
        H = np.zeros((2, 4))
        H[0, 0] = H[1, 1] = 1.0
        self.H = H
        self.R = np.eye(2) * self.cfg.meas_std_m ** 2

    # ----------------------------------------------------------------- model
    def _F_Q(self, dt: float) -> tuple[np.ndarray, np.ndarray]:
        F = np.eye(4)
        F[0, 2] = F[1, 3] = dt
        # Discrete white-noise acceleration model (piecewise constant accel).
        q = self.cfg.accel_std ** 2
        dt2, dt3, dt4 = dt * dt, dt ** 3, dt ** 4
        Q1 = np.array([[dt4 / 4, dt3 / 2], [dt3 / 2, dt2]]) * q
        Q = np.zeros((4, 4))
        Q[np.ix_([0, 2], [0, 2])] = Q1
        Q[np.ix_([1, 3], [1, 3])] = Q1
        return F, Q

    def _predict(self, dt: float) -> None:
        if dt <= 0:
            return
        F, Q = self._F_Q(dt)
        Q_still = Q * (self.cfg.accel_std_still / self.cfg.accel_std) ** 2
        for t in self.tracks:
            t.x = F @ t.x
            t.P = F @ t.P @ F.T + (Q_still if t.still else Q)
            if t.still:
                t.x[2:] = 0.0          # a seated person does not drift while unseen

    def _innovation(self, t: Track, z: np.ndarray):
        y = z - self.H @ t.x
        S = self.H @ t.P @ self.H.T + self.R
        return y, S

    def _mahalanobis2(self, t: Track, z: np.ndarray) -> float:
        y, S = self._innovation(t, z)
        return float(y @ np.linalg.solve(S, y))

    def _update(self, t: Track, z: np.ndarray, now: float) -> None:
        y, S = self._innovation(t, z)
        K = t.P @ self.H.T @ np.linalg.inv(S)
        t.x = t.x + K @ y
        # Joseph form: numerically stable, keeps P symmetric positive-definite.
        I_KH = np.eye(4) - K @ self.H
        t.P = I_KH @ t.P @ I_KH.T + K @ self.R @ K.T
        sp = math.hypot(t.x[2], t.x[3])
        if sp > self.cfg.max_speed:              # clamp physically absurd speeds
            t.x[2:] *= self.cfg.max_speed / sp
        t.last_update = now
        t.hits += 1
        t.last_z = np.array(z, dtype=float)

    def _birth(self, z: np.ndarray, now: float) -> Track:
        P = np.diag([self.cfg.meas_std_m ** 2] * 2 + [self.cfg.init_vel_std ** 2] * 2)
        return Track(next(self._ids), np.array([z[0], z[1], 0.0, 0.0]), P, now, now,
                     last_z=np.array(z, dtype=float))

    # --------------------------------------------------------------- public
    def step(self, detections: list[tuple[float, float]], now: float) -> list[Track]:
        """Advance to time `now` with this frame's detections (room metres).

        Returns the CONFIRMED tracks — the only ones that should ever be shown.
        """
        dt = 0.0 if self._last_t is None else max(0.0, now - self._last_t)
        self._last_t = now
        self._predict(dt)
        for t in self.tracks:
            t.frames_seen += 1

        Z = [np.asarray(d, dtype=float) for d in detections]
        matched_t, matched_z = set(), set()
        if self.tracks and Z:
            big = 1e6
            cost = np.full((len(self.tracks), len(Z)), big)
            for i, t in enumerate(self.tracks):
                cap = self.cfg.still_reattach_m if t.still else self.cfg.gate_euclid_m
                for j, z in enumerate(Z):
                    if math.hypot(z[0] - t.x[0], z[1] - t.x[1]) > cap:
                        continue
                    d2 = self._mahalanobis2(t, z)
                    # A still track's covariance has grown during the silence, so
                    # the euclidean cap (not chi-square) is what bounds re-attachment.
                    if d2 <= self.cfg.gate_chi2 or t.still:
                        cost[i, j] = d2
            rows, cols = linear_sum_assignment(cost)
            for i, j in zip(rows, cols):
                if cost[i, j] >= big:
                    continue
                t, z = self.tracks[i], Z[j]
                matched_t.add(i)
                matched_z.add(j)
                if t.still and math.hypot(z[0] - t.x[0], z[1] - t.x[1]) > self.cfg.wake_m:
                    if t.wake_since is not None and now - t.wake_since <= self.cfg.wake_window_s:
                        t.still, t.slow_since, t.wake_since = False, None, None
                        t.P[2:, 2:] = np.eye(2) * self.cfg.init_vel_std ** 2
                        t.P[:2, :2] += np.eye(2) * self.cfg.wake_m ** 2
                        self._update(t, z, now)
                    else:
                        t.wake_since = now      # possible outlier: consume, don't apply
                    continue
                t.wake_since = None
                self._update(t, z, now)

        confirmed_pos = [t.x[:2] for t in self.tracks if t.confirmed]
        for j, z in enumerate(Z):
            if j in matched_z or len(self.tracks) >= self.cfg.max_tracks:
                continue
            if any(math.hypot(z[0] - p[0], z[1] - p[1]) < self.cfg.min_birth_sep_m
                   for p in confirmed_pos):
                continue
            self.tracks.append(self._birth(z, now))

        survivors = []
        for t in self.tracks:
            sticky = self.sticky_at is not None and self.sticky_at(t.x[0], t.x[1])
            if not t.confirmed and t.hits >= self.cfg.confirm_hits and (
                    t.frames_seen <= self.cfg.confirm_window
                    or (sticky and now - t.born_at <= self.cfg.sticky_confirm_s)):
                t.confirmed = True
            if (t.confirmed and not t.still and sticky
                    and now - t.last_update >= self.cfg.sticky_coast_trigger_s
                    and t.speed < self.cfg.sticky_slow_speed):
                t.still, t.slow_since = True, now
                t.x[2:] = 0.0                     # stopped: don't coast along old velocity
                if t.last_z is not None:          # and undo the coasting overshoot
                    t.x[:2] = t.last_z
            # Still-mode state machine (confirmed tracks only).
            if t.confirmed and t.last_update == now:
                disp = self._displacement(t, now - self.cfg.still_after_s)
                if disp is not None:
                    if not t.still and disp < self.cfg.still_disp_m:
                        t.still, t.slow_since = True, now
                    elif t.still and disp > self.cfg.move_disp_m:
                        t.still, t.slow_since = False, None
            if not t.confirmed:
                limit = self.cfg.sticky_tentative_coast_s if sticky else self.cfg.max_coast_tentative_s
            elif t.still:
                limit = self.cfg.still_hold_s
            else:
                limit = self.cfg.max_coast_s
            expired_tentative = (not t.confirmed and t.frames_seen > self.cfg.confirm_window
                                 and not (sticky and now - t.born_at <= self.cfg.sticky_confirm_s))
            if now - t.last_update > limit or expired_tentative:
                continue
            t.history.append((now, float(t.x[0]), float(t.x[1])))
            if len(t.history) > 60:
                del t.history[: len(t.history) - 60]
            survivors.append(t)
        self.tracks = survivors
        return [t for t in self.tracks if t.confirmed]

    @staticmethod
    def _displacement(t: Track, since: float) -> Optional[float]:
        """Net distance moved since `since`, or None if history is too short."""
        h = t.history
        if not h or h[0][0] > since + 1e-9:
            return None
        for ts, x, y in reversed(h):
            if ts <= since + 1e-9:
                return math.hypot(t.x[0] - x, t.x[1] - y)
        return None

    def confirmed(self) -> list[Track]:
        return [t for t in self.tracks if t.confirmed]
