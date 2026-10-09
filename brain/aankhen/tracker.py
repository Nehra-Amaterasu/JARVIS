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
from typing import Optional

import numpy as np
from scipy.optimize import linear_sum_assignment

CHI2_2DOF_99 = 9.21


@dataclass
class TrackerConfig:
    meas_std_m: float = 0.15          # radar position noise (1 sigma)
    accel_std: float = 1.5            # process noise: human acceleration, m/s^2
    gate_chi2: float = CHI2_2DOF_99   # Mahalanobis gate
    confirm_hits: int = 3             # M ...
    confirm_window: int = 5           # ... of N frames to confirm a new track
    max_coast_s: float = 1.5          # delete a confirmed track after this silence
    max_coast_tentative_s: float = 0.4
    init_vel_std: float = 1.0         # unknown initial velocity, m/s
    max_speed: float = 3.0            # reject physically absurd velocities
    max_tracks: int = 8


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
    history: list = field(default_factory=list)   # recent (t, x, y) for trails

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
        """0..1 — falls with time since the last real detection."""
        if not self.confirmed:
            return 0.0
        silence = now - self.last_update
        return max(0.0, 1.0 - silence / cfg.max_coast_s)


class MultiTargetTracker:
    def __init__(self, cfg: Optional[TrackerConfig] = None):
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
        for t in self.tracks:
            t.x = F @ t.x
            t.P = F @ t.P @ F.T + Q

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

    def _birth(self, z: np.ndarray, now: float) -> Track:
        P = np.diag([self.cfg.meas_std_m ** 2] * 2 + [self.cfg.init_vel_std ** 2] * 2)
        return Track(next(self._ids), np.array([z[0], z[1], 0.0, 0.0]), P, now, now)

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
                for j, z in enumerate(Z):
                    d2 = self._mahalanobis2(t, z)
                    if d2 <= self.cfg.gate_chi2:
                        cost[i, j] = d2
            rows, cols = linear_sum_assignment(cost)
            for i, j in zip(rows, cols):
                if cost[i, j] < big:
                    self._update(self.tracks[i], Z[j], now)
                    matched_t.add(i)
                    matched_z.add(j)

        for j, z in enumerate(Z):
            if j not in matched_z and len(self.tracks) < self.cfg.max_tracks:
                self.tracks.append(self._birth(z, now))

        survivors = []
        for t in self.tracks:
            if not t.confirmed and t.frames_seen <= self.cfg.confirm_window \
                    and t.hits >= self.cfg.confirm_hits:
                t.confirmed = True
            limit = self.cfg.max_coast_s if t.confirmed else self.cfg.max_coast_tentative_s
            expired_tentative = (not t.confirmed and t.frames_seen > self.cfg.confirm_window)
            if now - t.last_update > limit or expired_tentative:
                continue
            t.history.append((now, float(t.x[0]), float(t.x[1])))
            if len(t.history) > 60:
                del t.history[: len(t.history) - 60]
            survivors.append(t)
        self.tracks = survivors
        return [t for t in self.tracks if t.confirmed]

    def confirmed(self) -> list[Track]:
        return [t for t in self.tracks if t.confirmed]
