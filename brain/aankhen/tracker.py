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
    # ZOMBIES AND DUPLICATES. Evening seed 3 of the 10-seed benchmark read an EMPTY
    # room as occupied for 51 s (53 % false "occupied"): a one-frame ghost inside the
    # bed zone, 0.79 m from the lying person's still track, seeded a second track;
    # it stole the person's detections and confirmed under the sticky rule. When the
    # person walked out, the duplicate stayed behind as a still track, blocked the
    # exit cue, and a single later ghost within 0.45 m renewed its 30 s hold.
    #  - A still track no longer accepts ANY detection within still_reattach_m: it
    #    gates with chi-square on a position uncertainty fixed at still_gate_std_m,
    #    so the gate stays ~1.2 m wide however long the silence (it used to bypass
    #    the gate entirely; see _still_mahalanobis2 for why it is fixed, not capped).
    #  - Its 30 s hold is renewed only by still_refresh_hits detections inside
    #    still_refresh_window_s — one ghost cannot keep a zombie alive.
    #  - Two confirmed tracks closer than merge_m for merge_after_s are one person
    #    unless the radar has seen them BOTH in the same frame at least
    #    distinct_codetections times (two real people walking in together are).
    #  - No birth inside a sticky zone within sticky_birth_sep_m of a still track.
    still_gate_std_m: float = 0.35
    still_refresh_hits: int = 2
    still_refresh_window_s: float = 5.0
    merge_m: float = 0.5
    merge_after_s: float = 1.0
    distinct_codetections: int = 3
    sticky_birth_sep_m: float = 1.0
    # SPINNING CLUTTER. A ceiling fan in the LD2450's beam comes back as a target
    # that never moves yet carries a large Doppler whose sign keeps flipping (the
    # strongest blade alternates between approaching and receding). In the fan
    # scenario such a target, reported in 30 % of frames, kept an empty room
    # "occupied" 98 % of the time. A person's radial speed does not flip sign
    # frame to frame at walking speed, and a person who walked in has moved.
    # All of it applies only to targets whose MEDIAN |Doppler| is clutter_median_v
    # or more — a still person's is ~0 — and:
    #  - such a target is not confirmed until it has moved clutter_confirm_disp_m
    #    AND its Doppler points one way (|sum v| >= clutter_consistency * sum |v|):
    #    a walker does both within its first few frames; blades do neither, except
    #    by chance. Flipping signs alone missed half of them (four random signs show
    #    no flip 1 time in 8), and one confirmed blade track kept an empty room
    #    "occupied" for 40 s;
    #  - a tentative track whose Doppler flips sign clutter_flips times (counting
    #    |v| >= clutter_v), or a confirmed one that flipped 3 times in its last 25
    #    detections while moving less than clutter_disp_m in 3 s, is clutter;
    #  - its spot is remembered for clutter_memory_s: no track is born within
    #    clutter_radius_m of it, and fast (|v| >= clutter_v) detections there are
    #    ignored — a track born elsewhere had wandered onto the blades and stayed.
    # This relies on the radar's speed field, which the engine used to discard.
    clutter_v: float = 0.15
    clutter_median_v: float = 0.3         # and only targets whose MEDIAN |v| is at least this
    clutter_flips: int = 2
    clutter_confirm_disp_m: float = 0.15
    clutter_consistency: float = 0.7
    clutter_disp_m: float = 0.3
    clutter_memory_s: float = 600.0
    clutter_radius_m: float = 0.5


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
    hold_from: float = 0.0                # a still track's hold runs from here
    hit_times: list = field(default_factory=list)   # recent detection times
    dopplers: list = field(default_factory=list)    # recent radial speeds (None if unknown)
    born_xy: Optional[tuple] = None
    max_disp: float = 0.0                 # farthest it has been from where it was born
    confirmed_at: Optional[float] = None

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
                 sticky_at: Optional[Callable[[float, float], bool]] = None,
                 origin: Optional[tuple[float, float]] = None):
        self.sticky_at = sticky_at
        self.origin = origin          # the radar's floor position, for Doppler checks
        self.cfg = cfg or TrackerConfig()
        self.tracks: list[Track] = []
        self._ids = itertools.count(1)
        self._last_t: Optional[float] = None
        self._codetect: dict[tuple[int, int], int] = {}     # frames both were detected
        self._close_since: dict[tuple[int, int], float] = {}
        self.clutter_spots: list[list[float]] = []           # [x, y, until]
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

    def _still_mahalanobis2(self, t: Track, z: np.ndarray) -> float:
        """Gate distance for a still track: its position uncertainty is taken as
        still_gate_std_m, whatever the filter's covariance says (a ~1.2 m gate).

        CAPPED, because the covariance keeps growing through a long silence and an
        uncapped chi-square gate ends up accepting anything in the room. FLOORED
        too: the first version only capped it, so a lying person tracked at 20 % of
        frames had a ~0.55 m gate, and when they stood up and walked off they left
        it before the two far detections that wake a still track arrived. A new
        identity walked out of the door and the old one haunted the bed — evening
        seeds 1, 4 and 5 went to 53-99 % false "occupied"."""
        y = z[:2] - t.x[:2]
        return float(y @ y) / (self.cfg.still_gate_std_m ** 2 + self.cfg.meas_std_m ** 2)

    def _hold_refreshed(self, t: Track, now: float) -> None:
        t.hit_times.append(now)
        if len(t.hit_times) > 4:
            del t.hit_times[0]
        recent = sum(1 for h in t.hit_times if now - h <= self.cfg.still_refresh_window_s)
        if not t.still or recent >= self.cfg.still_refresh_hits:
            t.hold_from = now

    def _go_still(self, t: Track, now: float) -> None:
        t.still, t.slow_since = True, now
        t.hold_from = t.last_update

    def _update(self, t: Track, z: np.ndarray, now: float, v: Optional[float] = None) -> None:
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
        t.last_z = np.array(z[:2], dtype=float)
        self._hold_refreshed(t, now)
        t.dopplers.append(v)
        if len(t.dopplers) > 25:
            del t.dopplers[0]

    def _birth(self, z: np.ndarray, now: float, v: Optional[float] = None) -> Track:
        P = np.diag([self.cfg.meas_std_m ** 2] * 2 + [self.cfg.init_vel_std ** 2] * 2)
        return Track(next(self._ids), np.array([z[0], z[1], 0.0, 0.0]), P, now, now,
                     last_z=np.array(z[:2], dtype=float), hold_from=now, hit_times=[now],
                     dopplers=[v], born_xy=(float(z[0]), float(z[1])))

    # ------------------------------------------------------------ clutter
    def _flips(self, t: Track, last: int) -> int:
        v = [x for x in t.dopplers[-last:] if x is not None and abs(x) >= self.cfg.clutter_v]
        return sum(1 for a, b in zip(v, v[1:]) if a * b < 0)

    def _fast(self, t: Track) -> bool:
        """Median |Doppler| at least clutter_median_v. A still person's is ~0 most of
        the time; without this test, a seated person gesturing could be taken for a fan."""
        v = [abs(x) for x in t.dopplers if x is not None]
        return bool(v) and float(np.median(v)) >= self.cfg.clutter_median_v

    def _one_way(self, t: Track) -> bool:
        v = [x for x in t.dopplers if x is not None and abs(x) >= self.cfg.clutter_v]
        return bool(v) and abs(sum(v)) >= self.cfg.clutter_consistency * sum(abs(x) for x in v)

    def _moves_with_doppler(self, t: Track) -> bool:
        """Has its range from the radar changed the way its Doppler says it should
        (at least 40 % of mean radial speed x age, in that direction)? A walker's
        does; blade returns that happened to show one Doppler sign for a few frames
        (1 time in 8 for four frames) do not. Without it, two such tracks confirmed
        on a dev seed of the fan scenario and kept the room "occupied" 8 % of its
        empty time."""
        v = [x for x in t.dopplers if x is not None]
        if self.origin is None or t.born_xy is None or t.last_z is None or not v:
            return True
        expected = float(np.mean(v)) * (t.last_update - t.born_at)     # + = receding
        dr = math.dist(t.last_z, self.origin) - math.dist(t.born_xy, self.origin)
        return dr * math.copysign(1.0, expected) >= 0.4 * abs(expected)

    def _is_clutter(self, t: Track, now: float) -> bool:
        if not self._fast(t):
            return False
        if not t.confirmed:
            return self._flips(t, len(t.dopplers)) >= self.cfg.clutter_flips
        disp = self._displacement(t, now - 3.0)
        return disp is not None and disp < self.cfg.clutter_disp_m and self._flips(t, 25) >= 3

    def _near_clutter(self, x: float, y: float, now: float) -> bool:
        self.clutter_spots = [c for c in self.clutter_spots if c[2] > now]
        return any(math.hypot(x - c[0], y - c[1]) < self.cfg.clutter_radius_m
                   for c in self.clutter_spots)

    def _remember_clutter(self, t: Track, now: float) -> None:
        x, y = t.position
        for c in self.clutter_spots:
            if math.hypot(x - c[0], y - c[1]) < self.cfg.clutter_radius_m:
                c[2] = now + self.cfg.clutter_memory_s
                return
        self.clutter_spots.append([x, y, now + self.cfg.clutter_memory_s])

    # ------------------------------------------------------------ identity
    @staticmethod
    def _key(a: int, b: int) -> tuple[int, int]:
        return (a, b) if a < b else (b, a)

    def distinct(self, a: int, b: int) -> bool:
        """True once the radar has reported tracks a and b in the same frame often
        enough that they cannot be one person seen twice."""
        return self._codetect.get(self._key(a, b), 0) >= self.cfg.distinct_codetections

    def extend_hold(self, track_id: int, now: float) -> None:
        """Renew a still track's hold on outside evidence (the engine: breathing)."""
        for t in self.tracks:
            if t.id == track_id and t.still:
                t.hold_from = max(t.hold_from, now)

    def drop(self, track_id: int) -> bool:
        """Remove a track (the engine drops duplicates left behind by an exit)."""
        n = len(self.tracks)
        self.tracks = [t for t in self.tracks if t.id != track_id]
        self._forget(track_id)
        return len(self.tracks) < n

    def _forget(self, track_id: int) -> None:
        for d in (self._codetect, self._close_since):
            for k in [k for k in d if track_id in k]:
                del d[k]

    def _merge_duplicates(self, now: float) -> None:
        conf = [t for t in self.tracks if t.confirmed]
        gone: set[int] = set()
        for i, a in enumerate(conf):
            for b in conf[i + 1:]:
                if a.id in gone or b.id in gone:
                    continue
                key = self._key(a.id, b.id)
                if (math.hypot(a.x[0] - b.x[0], a.x[1] - b.x[1]) >= self.cfg.merge_m
                        or self.distinct(a.id, b.id)):
                    self._close_since.pop(key, None)
                    continue
                since = self._close_since.setdefault(key, now)
                if now - since < self.cfg.merge_after_s:
                    continue
                keep, lose = (a, b) if (a.born_at, a.id) <= (b.born_at, b.id) else (b, a)
                if lose.last_update > keep.last_update:
                    # The younger track is the one the radar is actually feeding:
                    # keep the older identity, take the fresher state.
                    keep.x, keep.P = lose.x.copy(), lose.P.copy()
                    keep.last_update, keep.last_z = lose.last_update, lose.last_z
                    keep.still, keep.slow_since = lose.still, lose.slow_since
                    keep.hit_times = list(lose.hit_times)
                keep.hold_from = max(keep.hold_from, lose.hold_from)
                keep.hits += lose.hits
                gone.add(lose.id)
        if gone:
            self.tracks = [t for t in self.tracks if t.id not in gone]
            for tid in gone:
                self._forget(tid)

    # --------------------------------------------------------------- public
    def step(self, detections: list[tuple], now: float) -> list[Track]:
        """Advance to time `now` with this frame's detections (room metres):
        (x, y) or (x, y, radial_speed_mps).

        Returns the CONFIRMED tracks — the only ones that should ever be shown.
        """
        dt = 0.0 if self._last_t is None else max(0.0, now - self._last_t)
        self._last_t = now
        self._predict(dt)
        for t in self.tracks:
            t.frames_seen += 1

        if self.clutter_spots:
            detections = [d for d in detections
                          if not (len(d) > 2 and d[2] is not None and abs(d[2]) >= self.cfg.clutter_v
                                  and self._near_clutter(d[0], d[1], now))]
        Z = [np.asarray(d, dtype=float)[:2] for d in detections]
        V = [float(d[2]) if len(d) > 2 and d[2] is not None else None for d in detections]
        matched_t, matched_z = set(), set()
        if self.tracks and Z:
            big = 1e6
            cost = np.full((len(self.tracks), len(Z)), big)
            for i, t in enumerate(self.tracks):
                cap = self.cfg.still_reattach_m if t.still else self.cfg.gate_euclid_m
                for j, z in enumerate(Z):
                    if math.hypot(z[0] - t.x[0], z[1] - t.x[1]) > cap:
                        continue
                    # A still track's covariance has grown during the silence; its
                    # gate uses the capped covariance instead (see TrackerConfig).
                    d2 = self._still_mahalanobis2(t, z) if t.still else self._mahalanobis2(t, z)
                    if d2 <= self.cfg.gate_chi2:
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
                        self._update(t, z, now, V[j])
                    else:
                        t.wake_since = now      # possible outlier: consume, don't apply
                    continue
                t.wake_since = None
                self._update(t, z, now, V[j])

        # Two confirmed tracks detected in the same frame are two bodies.
        seen = [t.id for t in self.tracks if t.confirmed and t.last_update == now]
        for a, b in itertools.combinations(seen, 2):
            k = self._key(a, b)
            self._codetect[k] = self._codetect.get(k, 0) + 1

        confirmed_pos = [t.x[:2] for t in self.tracks if t.confirmed]
        still_pos = [t.x[:2] for t in self.tracks if t.confirmed and t.still]
        for j, z in enumerate(Z):
            if j in matched_z or len(self.tracks) >= self.cfg.max_tracks:
                continue
            if any(math.hypot(z[0] - p[0], z[1] - p[1]) < self.cfg.min_birth_sep_m
                   for p in confirmed_pos):
                continue
            if still_pos and self.sticky_at is not None and self.sticky_at(z[0], z[1]) and any(
                    math.hypot(z[0] - p[0], z[1] - p[1]) < self.cfg.sticky_birth_sep_m
                    for p in still_pos):
                continue
            if self.clutter_spots and self._near_clutter(z[0], z[1], now):
                continue
            self.tracks.append(self._birth(z, now, V[j]))

        survivors = []
        for t in self.tracks:
            sticky = self.sticky_at is not None and self.sticky_at(t.x[0], t.x[1])
            # A fast target held back only by the displacement rule, whose Doppler
            # points one way, gets twice the window to confirm in: someone walking in
            # from the door toward the radar moves little across the floor at first
            # (0.13 m in 0.4 s), missed the 6-frame window and was reborn — 1 s late,
            # past the doorway, with no entry cue (drift dev seed 104: 25 % false
            # "empty" during the visit).
            walker = (not t.confirmed and self._fast(t) and self._one_way(t)
                      and t.frames_seen <= 2 * self.cfg.confirm_window)
            if not t.confirmed and t.hits >= self.cfg.confirm_hits and (
                    t.frames_seen <= self.cfg.confirm_window or walker
                    or (sticky and now - t.born_at <= self.cfg.sticky_confirm_s)):
                if self._is_clutter(t, now):
                    self._remember_clutter(t, now)
                    self._forget(t.id)
                    continue
                if not self._fast(t) or (t.max_disp >= self.cfg.clutter_confirm_disp_m
                                         and self._one_way(t) and self._moves_with_doppler(t)):
                    t.confirmed, t.confirmed_at = True, now
            if t.confirmed and t.last_update == now and self._is_clutter(t, now):
                self._remember_clutter(t, now)
                self._forget(t.id)
                continue
            if (t.confirmed and not t.still and sticky
                    and now - t.last_update >= self.cfg.sticky_coast_trigger_s
                    and t.speed < self.cfg.sticky_slow_speed):
                self._go_still(t, now)
                t.x[2:] = 0.0                     # stopped: don't coast along old velocity
                if t.last_z is not None:          # and undo the coasting overshoot
                    t.x[:2] = t.last_z
            # Still-mode state machine (confirmed tracks only).
            if t.confirmed and t.last_update == now:
                disp = self._displacement(t, now - self.cfg.still_after_s)
                if disp is not None:
                    if not t.still and disp < self.cfg.still_disp_m:
                        self._go_still(t, now)
                    elif t.still and disp > self.cfg.move_disp_m:
                        t.still, t.slow_since = False, None
            if not t.confirmed:
                expired = now - t.last_update > (self.cfg.sticky_tentative_coast_s if sticky
                                                 else self.cfg.max_coast_tentative_s)
            elif t.still:
                expired = now - t.hold_from > self.cfg.still_hold_s
            else:
                expired = now - t.last_update > self.cfg.max_coast_s
            expired_tentative = (not t.confirmed and t.frames_seen > self.cfg.confirm_window
                                 and not walker
                                 and not (sticky and now - t.born_at <= self.cfg.sticky_confirm_s))
            if expired or expired_tentative:
                self._forget(t.id)
                continue
            t.history.append((now, float(t.x[0]), float(t.x[1])))
            if t.born_xy is not None:
                t.max_disp = max(t.max_disp, math.hypot(t.x[0] - t.born_xy[0], t.x[1] - t.born_xy[1]))
            if len(t.history) > 60:
                del t.history[: len(t.history) - 60]
            survivors.append(t)
        self.tracks = survivors
        self._merge_duplicates(now)
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
