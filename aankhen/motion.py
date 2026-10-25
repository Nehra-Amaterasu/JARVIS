"""Wi-Fi CSI motion detection, calibration, and (experimental) breathing rate.

WHAT A SINGLE WI-FI LINK CAN HONESTLY SAY
  Motion near the link:      yes — 87-99 % detection, ~1-3 % false alarms once
                             calibrated in place (ESPectre evaluation; Et Tu Alexa,
                             NDSS 2020, 11 real homes).
  A person sitting still:    mostly NO — 38 % detection in a 12-day real-home study.
  Where in the room:         no.
So the states this module reports are deliberately modest:
  uncalibrated  no empty-room baseline yet — decisions would be guesses
  motion        movement detected now
  recent        no movement for a moment, but there was recently (held 90 s):
                someone is probably still here
  quiet         no movement for a while. NOT "empty" — a still person looks like
                this too. Only the radar (or a presence radar) can say "empty".

DETECTOR (parameters from ESPectre's documented pipeline)
  turbulence(t) = std over subcarriers / mean over subcarriers, per sample
  feature       = moving variance of turbulence over a 1 s window ("MVS"),
                  evaluated every 250 ms
  score         = feature / median(feature in the empty room)   -> "x empty"
  threshold     = 1.2 x 99.5th percentile of the empty-room feature, same unit
  hysteresis    = 2 consecutive windows above to switch on, 8 below to switch off
                  (evaluated every 100 ms since 2026-10-25; was 250 ms, 4 on / 3 off)
  NOTE: windows overlap (1 s window, 0.25 s hop), so one corrupted sample sits in
  four consecutive windows and would satisfy "4 in a row" on its own. Hysteresis
  does NOT reject single-packet glitches — the Hampel filter in csi.py does, and
  it must run before this detector (test_glitch_rejected_by_hampel_not_hysteresis).
  A genuine 0.3 s movement, on the other hand, is real motion and is reported.
Reporting the score as a multiple of the empty-room level gives it a physical
meaning ("motion is 7x the empty-room level"), unlike the old firmware's
"motion %" which had no unit and no calibration behind it.

ADAPTIVE BASELINE
  Rooms drift (doors, furniture, the router). The baseline is updated slowly
  (EMA, 20 min time constant) but ONLY after the room has been quiet for 5
  minutes, and frozen for 5 minutes after any motion — otherwise the detector
  would gradually learn a moving person as "normal".
"""
from __future__ import annotations

import functools
import json
import math
import os
import time
from collections import deque
from dataclasses import asdict, dataclass, field
from typing import Optional

import numpy as np

from .csi import Sample
from .fan import FanLines

STATE_UNCALIBRATED = "uncalibrated"
STATE_MOTION = "motion"
STATE_RECENT = "recent"
STATE_QUIET = "quiet"


@dataclass
class MotionConfig:
    rate_hz: float = 100.0
    window_s: float = 1.0
    # LATENCY (2026-10-25, docs/research/2026-10-25-aankhen-latency-honesty.md): the old
    # 0.25 s hop x 4 windows held every onset back ~0.9 s before the threshold was even
    # crossed. 0.1 s x 2 holds it 0.1-0.2 s; on the real recordings the median onset
    # fell 0.79 -> 0.30 s with 0.0 % false motion on the held-out empty room either way.
    # off_count 8 x 0.1 s keeps the old ~0.75 s release, so stop lag is unchanged.
    hop_s: float = 0.1
    on_count: int = 2
    off_count: int = 8
    hold_s: float = 90.0                 # "recent" lasts this long after motion
    baseline_min_s: float = 60.0         # minimum empty-room calibration
    threshold_quantile: float = 0.995
    threshold_scale: float = 1.2
    auto_baseline_s: float = 30.0        # provisional baseline if never calibrated
    adapt_tau_s: float = 1200.0
    adapt_quiet_needed_s: float = 300.0
    freeze_after_motion_s: float = 300.0
    # RADAR-GATED ADAPTATION. The quiet-only rule above deadlocks: on the simulator,
    # a static channel drifting 1 rad through a deep subcarrier null raised the
    # empty-room score to 27x for ~350 s; that read as motion, motion froze the
    # adaptation, and the baseline only began to move after 750 s. A live radar that
    # has seen nobody for radar_adapt_after_s is independent evidence the room is
    # empty, so the baseline then follows the last minute of readings (EMA,
    # radar_adapt_tau_s) whatever the Wi-Fi detector says — capped at
    # radar_adapt_cap times the calibrated level either way, so a neighbour pacing
    # by the router cannot teach it that any amount of motion is normal.
    radar_adapt_after_s: float = 60.0
    radar_adapt_tau_s: float = 60.0
    radar_adapt_cap: float = 10.0
    # FAN CONTEXT. With the fan relay on, a separate baseline: calibrated with
    # `calibrate --fan`, or learned from fan_learn_s of readings once the radar has
    # seen nobody for fan_learn_after_s. Until then Wi-Fi makes no decisions.
    # The threshold is wider (fan_threshold_scale vs threshold_scale) because what
    # the fan leaves behind after its lines are removed depends on who is in the
    # room: on the simulator ~1.1x the no-fan level for an empty room but ~1.9x
    # with someone seated (dev seeds 101-102; reported numbers use other seeds).
    fan_learn_after_s: float = 20.0
    fan_learn_s: float = 60.0
    fan_threshold_scale: float = 2.0
    # LEVEL CHANNEL. A person moves the whole channel up and down far more than they
    # reshape it across subcarriers, and the shape-only MVS cannot see that part
    # (csi.py). Each sample's level (gain-compensated median in dB, or the packet's
    # RSSI) is detrended over the window; its variance against the empty room's is a
    # second, independent test (OR-ed with MVS). With RSSI only, the threshold never
    # goes below level_floor_rssi_db2: a still person's breathing can sit the level
    # on a 1 dB boundary and flip RSSI between two values, variance <= 0.25 dB^2.
    level_floor_rssi_db2: float = 0.5
    # HUMAN-BAND ENERGY (see HBE above), a third test OR-ed with the two. On by
    # default; AANKHEN_HBE=0 turns it off to benchmark the detector without it.
    hbe: bool = field(default_factory=lambda: os.environ.get("AANKHEN_HBE", "1") != "0")

    @property
    def window_n(self) -> int:
        return int(round(self.window_s * self.rate_hz))

    @property
    def hop_n(self) -> int:
        return max(1, int(round(self.hop_s * self.rate_hz)))


def turbulence(amp: np.ndarray) -> float:
    m = float(amp.mean())
    return float(amp.std() / m) if m > 1e-12 else 0.0


def window_features(turb: np.ndarray) -> dict:
    """Features of one window of turbulence values (for logging and future ML)."""
    mean = float(turb.mean())
    q1, q3 = np.percentile(turb, [25, 75])
    d = turb - mean
    denom = float((d * d).sum())
    ac1 = float((d[:-1] * d[1:]).sum() / denom) if denom > 1e-18 else 0.0
    return {
        "mvs": float(turb.var()),
        "iqr_rel": float((q3 - q1) / abs(mean)) if abs(mean) > 1e-12 else 0.0,
        "ac1": ac1,
        "turb_mean": mean,
    }


# ------------------------------------------------- human-band energy (HBE)
# HUMAN-BAND ENERGY: a second motion statistic, more sensitive than MVS and blind to
# what is not a person. Three steps, each from the physics in rf.py:
#
# 1. KEEP EVERY SUBCARRIER'S SAY, BUT ONLY THE SMOOTH PART. A moving body adds a
#    path whose delay differs from the static ones by tens of ns at most, so what it
#    changes across the 51 subcarriers is a slow ripple (under ~2.5 cycles over the
#    16 MHz band). Receiver noise is independent per subcarrier. Projecting each
#    sample onto the first HBE_ORDER+1 Legendre polynomials keeps that ripple and
#    drops ~88 % of the noise. Turbulence (std / mean) keeps ONE direction of it:
#    a movement whose ripple is orthogonal to the room's static shape is invisible
#    to MVS.
# 2. LISTEN ONLY AT HUMAN SPEEDS. Each coefficient's 3 s window is detrended and its
#    power is summed over HBE_BAND_HZ. A movement of a few millimetres changes the
#    path by far less than a wavelength, so the CSI follows the movement itself:
#    a 1-2.5 s fidget lives at ~0.4-2 Hz. Below 0.4 Hz live breathing's fundamental
#    and drift; above 4 Hz live most of the white noise (gain-compensation error,
#    thermal) and a ceiling fan's blade-pass. Measured (tests/sensitivity.py, 2026-10-11):
#    1-8 Hz threw the small movements away (+3-10 points over MVS); 0.3-8 Hz saw the
#    most but called a still person at the desk "moving" in 83 % of windows (breathing
#    harmonics); 0.4-4 Hz over 3 s: 15 % there, ~2 % elsewhere.
# 3. NORMALISE BY THE NOISE OF THE SAME WINDOW. Each coefficient's white-noise level
#    is estimated from the first differences of consecutive REAL samples (filled
#    ones excluded), robustly (MAD). In-band power / that level is ~1 for an empty
#    room whatever the RSSI, the gain error or the packet rate, so the threshold
#    learned in calibration means the same thing tomorrow.
# A windowed coefficient with locked fan lines has them removed first (FanLines).
HBE_WINDOW_S = 3.0
HBE_ORDER = 5
HBE_BAND_HZ = (0.4, 4.0)
HBE_MIN_REAL = 0.8                  # skip windows with more than 20 % filled samples
HBE_STEP_SIGMA = 6.0                # a one-sample jump this many noise SDs is a step, not a body
# A 3 s window remembers a movement for 3 s after it ends. On the benchmark that kept
# "moving" on ~2 s too long whenever someone left (walk scenario: false "moving" beyond
# the 2 s grace 0 % -> 11 %). So HBE only counts while the last HBE_RECENT_S still
# carries human-band power above HBE_RECENT_GATE x the noise (noise alone: ~1).
HBE_RECENT_S = 1.0
HBE_RECENT_GATE = 1.6
# The gate alone did not shorten the tail much (walk: 11 % -> 9 %): to hear a 0.4 Hz
# movement takes ~2.5 s of data, so its memory cannot be shorter. So HBE may START
# motion at the gate above, but KEEPING motion on through HBE alone needs the last
# second to be clearly busy (HBE_HOLD_GATE); weaker than that, MVS and the level
# decide when it stops. A small movement is still caught; it just does not linger.
HBE_HOLD_GATE = 4.0


@functools.lru_cache(maxsize=4)
def _smooth_basis(n_sub: int, order: int = HBE_ORDER) -> np.ndarray:
    """Orthonormal (n_sub x order+1) basis of low-order Legendre polynomials."""
    x = np.linspace(-1.0, 1.0, n_sub)
    q, _ = np.linalg.qr(np.polynomial.legendre.legvander(x, order))
    return q


def _bridge_gaps(C: np.ndarray, real: np.ndarray, k: int = 5) -> np.ndarray:
    """Replace runs of filled samples with a line between the means of up to k real
    samples on each side.

    The resampler forward-fills a missing packet with the last real one. Across a
    0.23 s gap that repeats ONE noisy sample 23 times: a rectangular pulse which, on
    the simulator, held a 3.6-sigma noise sample long enough to look like a 3 cm
    movement (empty-room HBE up to 7.5x its median). Averaging k neighbours on each
    side shrinks what the bridge carries by sqrt(k)."""
    C = C.copy()
    n = len(real)
    i = 0
    while i < n:
        if real[i]:
            i += 1
            continue
        j = i
        while j < n and not real[j]:
            j += 1
        before = np.flatnonzero(real[:i])[-k:]
        after = j + np.flatnonzero(real[j:])[:k]
        if before.size and after.size:
            a, b = C[before].mean(axis=0), C[after].mean(axis=0)
            w = (np.arange(i, j) - (i - 1)) / (j - (i - 1))
            C[i:j] = a + np.outer(w, b - a)
        elif before.size:
            C[i:j] = C[before].mean(axis=0)
        elif after.size:
            C[i:j] = C[after].mean(axis=0)
        i = j
    return C


def human_band_energy(amps: np.ndarray, filled: Optional[np.ndarray] = None,
                      rate_hz: float = 100.0, band: tuple = HBE_BAND_HZ,
                      fan: Optional["FanLines"] = None, detail: bool = False,
                      order: Optional[int] = HBE_ORDER):
    """HBE of one window: in-band power / white-noise power, averaged over the
    smooth-subspace coefficients (~1 in an empty room). None if the window has too
    many filled samples to trust. detail=True returns (value, per-coefficient).
    order=None keeps every subcarrier (no projection), for comparison."""
    A = np.asarray(amps, float)
    n = A.shape[0]
    real = np.ones(n, bool) if filled is None else ~np.asarray(filled, bool)
    if n < 16 or real.mean() < HBE_MIN_REAL:
        return None
    C = A if order is None else A @ _smooth_basis(A.shape[1], order)
    if not real.all():
        C = _bridge_gaps(C, real)
    t = np.arange(n) - (n - 1) / 2.0
    C = C - C.mean(axis=0)
    C = C - np.outer(t, (t @ C) / (t @ t))
    if fan is not None and fan.locked and fan.lines:
        C = np.stack([fan.remove_lines(C[:, j]) for j in range(C.shape[1])], axis=1)
    pair = real[1:] & real[:-1]
    if pair.sum() < 8:
        return None
    D = np.diff(C, axis=0)
    d = D[pair]
    med = np.median(d, axis=0)
    dev = np.abs(d - med)
    sd = np.maximum(1.4826 * np.median(dev, axis=0), 1e-12)
    sigma2 = sd ** 2 / 2.0
    # STEPS ARE NOT PEOPLE. A body moves smoothly: at 100 samples a second even a
    # brisk fidget changes a coefficient by a fraction of the noise per sample. A gain
    # step the compensation missed, or a glitch the Hampel filter let through, jumps
    # in ONE sample, and a jump has energy at every frequency, the human band
    # included. On the simulator these steps put the empty-room HBE at up to 7x its
    # median. Differences beyond HBE_STEP_SIGMA noise deviations are zeroed and the
    # series re-integrated, which removes the step and keeps everything smooth.
    jump = np.abs(D - med) > HBE_STEP_SIGMA * sd
    if jump.any():
        D = np.where(jump, med, D)
        C = np.vstack([np.zeros((1, C.shape[1])), np.cumsum(D, axis=0)])
        C = C - C.mean(axis=0)
        C = C - np.outer(t, (t @ C) / (t @ t))
    w = np.hanning(n)
    X = np.fft.rfft(C * w[:, None], axis=0)
    f = np.fft.rfftfreq(n, 1.0 / rate_hz)
    sel = (f >= band[0]) & (f <= band[1])
    if not sel.any():
        return None
    p = (np.abs(X[sel]) ** 2).mean(axis=0) / (sigma2 * float(w @ w))
    value = float(p.mean())
    if not detail:
        return value
    # RECENT: the same band, but only the window's last HBE_RECENT_S. The full window
    # finds weak movement; this says whether it is still going on (see HBE_RECENT_GATE).
    Y = np.fft.rfft(C, axis=0)
    Y[~sel] = 0.0
    y = np.fft.irfft(Y, n=n, axis=0)
    k = max(2, int(round(HBE_RECENT_S * rate_hz)))
    frac = sel.sum() / len(f)                    # share of white-noise power in the band
    recent = float(((y[-k:] ** 2).mean(axis=0) / (sigma2 * frac)).mean())
    return value, p, recent


# -------------------------------------------------------------- baseline
@dataclass
class Baseline:
    """Empty-room statistics of the MVS feature for one link."""
    median: float
    q_hi: float                        # threshold_quantile of empty MVS
    n_windows: int
    created: float = field(default_factory=time.time)
    source: str = "calibrated"         # "calibrated" | "auto"
    note: str = ""
    # Median breathing statistic of the empty room (RespirationDetector), measured
    # by the same calibration. None in baselines saved before it existed: then the
    # breathing evidence stays off until the room is recalibrated.
    resp_floor: Optional[float] = None
    # Empty-room threshold_quantile of the level channel's variance (dB^2), and
    # whether that level came from the reported gain (fine) or from RSSI. None in
    # baselines saved before the channel existed: it stays off until recalibrated.
    level_q: Optional[float] = None
    level_fine: Optional[bool] = None
    # Empty-room threshold_quantile of the human-band energy (HBE, dimensionless,
    # ~1 for noise). None in baselines saved before it existed: off until recalibrated.
    hbe_q: Optional[float] = None
    # The empty room's channel shape, level and RSSI as the spatial model measures
    # them (learn.FeatureStream): its reference for "what changed". Without it the
    # reference is whatever the first seconds saw, and a stream that starts while the
    # family walks past the router reads an empty room as someone in bed.
    ref: Optional[dict] = None

    def threshold_ratio(self, scale: float) -> float:
        return scale * self.q_hi / self.median if self.median > 0 else float("inf")

    def save(self, path: str) -> None:
        os.makedirs(os.path.dirname(os.path.abspath(path)), exist_ok=True)
        with open(path, "w", encoding="utf-8") as f:
            json.dump(asdict(self), f, indent=2)

    @classmethod
    def load(cls, path: str) -> Optional["Baseline"]:
        if not os.path.exists(path):
            return None
        with open(path, encoding="utf-8") as f:
            return cls(**json.load(f))

    @classmethod
    def from_values(cls, mvs: list[float], quantile: float, source: str,
                    note: str = "", levels: Optional[list] = None,
                    level_fine: Optional[bool] = None,
                    hbes: Optional[list] = None) -> "Baseline":
        arr = np.asarray(mvs, dtype=float)
        lv = [v for v in (levels or []) if v is not None and np.isfinite(v)]
        level_q = float(np.quantile(lv, quantile)) if len(lv) >= max(4, len(arr) // 2) else None
        hb = [v for v in (hbes or []) if v is not None and np.isfinite(v)]
        hbe_q = float(np.quantile(hb, quantile)) if len(hb) >= max(4, len(arr) // 2) else None
        return cls(float(np.median(arr)), float(np.quantile(arr, quantile)),
                   len(arr), source=source, note=note, level_q=level_q,
                   level_fine=level_fine if level_q is not None else None, hbe_q=hbe_q)


class Calibrator:
    """Collects empty-room windows; refuses to finish before baseline_min_s."""

    def __init__(self, cfg: MotionConfig):
        self.cfg = cfg
        self.values: list[float] = []
        self.levels: list = []
        self.hbes: list = []
        self.level_fine: Optional[bool] = None

    @property
    def seconds(self) -> float:
        return len(self.values) * self.cfg.hop_s

    def add(self, mvs: float, level_var: Optional[float] = None,
            level_fine: Optional[bool] = None, hbe: Optional[float] = None) -> None:
        self.values.append(mvs)
        self.levels.append(level_var)
        self.hbes.append(hbe)
        if level_fine is not None:
            self.level_fine = level_fine

    def ready(self) -> bool:
        return self.seconds >= self.cfg.baseline_min_s

    def finish(self) -> Baseline:
        if not self.ready():
            raise RuntimeError(
                f"need {self.cfg.baseline_min_s:.0f} s of empty room, have {self.seconds:.0f} s")
        return Baseline.from_values(self.values, self.cfg.threshold_quantile, "calibrated",
                                    f"{self.seconds:.0f} s empty-room capture",
                                    levels=self.levels, level_fine=self.level_fine,
                                    hbes=self.hbes)


# -------------------------------------------------------------- detector
@dataclass
class MotionReading:
    t: float
    state: str
    score: Optional[float]             # x empty-room level
    threshold: Optional[float]         # same unit
    motion01: float                    # 0..1 for display only
    confidence: float
    reason: str
    features: dict
    baseline_source: str


class MotionDetector:
    """MVS motion detector with two baselines: fan off, and fan on.

    A ceiling fan changes what "an empty room" looks like, so it gets its own
    baseline (see FAN CONTEXT in MotionConfig). The engine tells the detector the
    fan relay's state with set_fan() and, after any relay switch, sets `settling`
    for 30 s.
    """

    FAN_OFF, FAN_ON = "fan off", "fan on"

    def __init__(self, cfg: Optional[MotionConfig] = None,
                 baseline: Optional[Baseline] = None,
                 fan_baseline: Optional[Baseline] = None):
        self.cfg = cfg or MotionConfig()
        # Private copies: adaptation edits a baseline in place, and the caller's
        # object is shared (one simulated calibration serves a whole benchmark).
        copy = lambda b: Baseline(**asdict(b)) if b is not None else None
        self._baselines = {self.FAN_OFF: copy(baseline), self.FAN_ON: copy(fan_baseline)}
        self._calibrated = {k: copy(v) for k, v in self._baselines.items()}
        self.context = self.FAN_OFF
        self._turb: deque = deque(maxlen=self.cfg.window_n)
        self._level: deque = deque(maxlen=self.cfg.window_n)
        hbe_n = int(round(HBE_WINDOW_S * self.cfg.rate_hz))
        self._amps: deque = deque(maxlen=hbe_n)
        self._filled: deque = deque(maxlen=hbe_n)
        self._level_fine = False
        self._since_eval = 0
        self._on_run = 0
        self._off_run = 0
        self._in_motion = False
        self._last_motion_t: Optional[float] = None
        self._quiet_since: Optional[float] = None
        self._auto: list[float] = []
        self._auto_level: list = []
        self._auto_hbe: list = []
        self.last: Optional[MotionReading] = None
        self.evaluations = 0
        # Set by the engine before each push: seconds the radar has been live and
        # empty (None = no radar, or it sees someone). Gates the adaptation below.
        self.radar_empty_s: Optional[float] = None
        # Set by the engine for 30 s after the fan relay switches: the fan is
        # spinning up or down and its signal sweeps through every frequency.
        self.settling = False
        self._radar_quiet: deque = deque(maxlen=int(round(self.cfg.radar_adapt_after_s / self.cfg.hop_s)))
        self._radar_quiet_hbe: deque = deque(maxlen=self._radar_quiet.maxlen)
        self._fan_learn: list[float] = []
        self._fan_learn_level: list = []
        self._fan_learn_hbe: list = []
        self.fan = FanLines()

    # -- baselines --------------------------------------------------------
    @property
    def baseline(self) -> Optional[Baseline]:
        return self._baselines[self.context]

    @baseline.setter
    def baseline(self, b: Optional[Baseline]) -> None:
        self._baselines[self.context] = b

    @property
    def fan_baseline(self) -> Optional[Baseline]:
        return self._baselines[self.FAN_ON]

    def over_calibrated(self, mvs: float) -> Optional[float]:
        """mvs as a multiple of the CALIBRATED threshold (not the adapted one), or
        None without a calibration. Adaptation may raise the baseline to swallow a
        neighbour's pacing; this asks whether it is big movement all the same."""
        cal = self._calibrated.get(self.context)
        if cal is None or cal.median <= 0:
            return None
        return (mvs / cal.median) / cal.threshold_ratio(self.cfg.threshold_scale)

    def restart(self) -> None:
        """Forget the signal history (the engine: the Wi-Fi channel changed). The
        baselines stay; radar-gated adaptation moves them to the new channel."""
        self._turb.clear()
        self._level.clear()
        self._amps.clear()
        self._filled.clear()
        self._since_eval = self._on_run = self._off_run = 0
        self._in_motion = False
        self._radar_quiet.clear()
        self._radar_quiet_hbe.clear()
        self._fan_learn.clear()
        self.fan = FanLines()

    def set_fan(self, on: bool) -> None:
        ctx = self.FAN_ON if on else self.FAN_OFF
        if ctx != self.context:
            self.context = ctx
            self._on_run = self._off_run = 0
            self._radar_quiet.clear()
            self._radar_quiet_hbe.clear()
            self._fan_learn.clear()
            self._fan_learn_level.clear()
            self._fan_learn_hbe.clear()

    # -- feed -------------------------------------------------------------
    def push(self, s: Sample) -> Optional[MotionReading]:
        """Feed one clean sample; returns a reading every hop, else None."""
        tb = turbulence(s.amp)
        self._turb.append(tb)
        if s.level_fine != self._level_fine:
            # RSSI (dBm) and the compensated level (dB of counts) are different
            # scales: never mix them in one window. The firmware switches once, after
            # recording its gain baseline (first 100 packets).
            self._level.clear()
        self._level.append(s.level_db if s.level_db is not None else float("nan"))
        self._level_fine = s.level_fine
        self._amps.append(s.amp)
        self._filled.append(s.filled)
        self.fan.push(tb)
        self._since_eval += 1
        if len(self._turb) < self.cfg.window_n or self._since_eval < self.cfg.hop_n:
            return None
        self._since_eval = 0
        return self._evaluate(s.t, np.fromiter(self._turb, float))

    # -- core -------------------------------------------------------------
    def _evaluate(self, t: float, turb: np.ndarray) -> MotionReading:
        self.evaluations += 1
        feats = window_features(turb)
        if self.fan.locked:
            # A fan's lines are in the turbulence: score what is left without them.
            feats["mvs_raw"] = feats["mvs"]
            feats["mvs"] = self.fan.residual_variance(turb)
        mvs = feats["mvs"]
        feats["level_var"] = self._level_var()
        feats["level_fine"] = self._level_fine
        feats["hbe"], feats["hbe_recent"] = self._hbe()

        if self.baseline is None and self.context == self.FAN_ON:
            return self._learn_fan_baseline(t, mvs, feats)
        if self.baseline is None:
            # Provisional baseline from the first auto_baseline_s. This ASSUMES the
            # room was empty at start-up, which is why it is labelled "auto" and
            # reported with reduced confidence. Run `calibrate` for a real one.
            self._auto.append(mvs)
            self._auto_level.append(feats["level_var"])
            self._auto_hbe.append(feats["hbe"])
            if len(self._auto) * self.cfg.hop_s >= self.cfg.auto_baseline_s:
                self.baseline = Baseline.from_values(
                    self._auto, self.cfg.threshold_quantile, "auto",
                    "assumes the room was empty during the first 30 s after start",
                    levels=self._auto_level, level_fine=self._level_fine, hbes=self._auto_hbe)
                self._calibrated[self.context] = Baseline(**asdict(self.baseline))
            reading = MotionReading(t, STATE_UNCALIBRATED, None, None, 0.0, 0.0,
                                    "collecting a baseline — no decisions yet", feats, "none")
            self.last = reading
            return reading

        b = self.baseline
        score = mvs / b.median if b.median > 0 else 0.0
        scale = self.cfg.fan_threshold_scale if self.context == self.FAN_ON else self.cfg.threshold_scale
        thr = b.threshold_ratio(scale)
        level_thr = self._level_threshold(b, scale)
        lv = feats["level_var"]
        level_over = level_thr is not None and lv is not None and lv > level_thr
        feats["level_threshold"] = level_thr
        hbe, hbe_thr = feats["hbe"], (scale * b.hbe_q if b.hbe_q is not None else None)
        gate = HBE_HOLD_GATE if self._in_motion else HBE_RECENT_GATE
        hbe_over = (hbe_thr is not None and hbe is not None and hbe > hbe_thr
                    and (feats["hbe_recent"] or 0.0) > gate)
        feats["hbe_threshold"] = hbe_thr
        above = score > thr or level_over or hbe_over
        if above:
            self._on_run += 1
            self._off_run = 0
        else:
            self._off_run += 1
            self._on_run = 0
        if not self._in_motion and self._on_run >= self.cfg.on_count:
            self._in_motion = True
        elif self._in_motion and self._off_run >= self.cfg.off_count:
            self._in_motion = False
        if self._in_motion:
            self._last_motion_t = t
            self._quiet_since = None
        elif self._quiet_since is None:
            self._quiet_since = t

        if self._in_motion:
            state = STATE_MOTION
            reason = f"motion {score:.1f}x the empty-room level (threshold {thr:.1f}x)"
            if level_over:
                reason += f"; signal level swinging {lv:.2f} dB^2 (threshold {level_thr:.2f})"
            if hbe_over:
                reason += f"; human-speed movement {hbe / hbe_thr:.1f}x its threshold"
        elif self._last_motion_t is not None and t - self._last_motion_t < self.cfg.hold_s:
            state = STATE_RECENT
            reason = f"moved {t - self._last_motion_t:.0f} s ago — probably still here"
        else:
            state = STATE_QUIET
            reason = "no motion near the Wi-Fi link (a still person also looks like this)"
        if self.context == self.FAN_ON:
            reason += " · fan on"

        # Confidence: how far past the threshold, discounted for an auto baseline.
        if state == STATE_MOTION:
            conf = min(1.0, 0.6 + 0.4 * math.tanh(math.log(max(score / thr, 1.0))))
        elif state == STATE_RECENT:
            conf = max(0.3, 1.0 - (t - self._last_motion_t) / self.cfg.hold_s)
        else:
            conf = 0.5
        if b.source == "auto":
            conf *= 0.7

        if not self.settling:
            self._maybe_adapt(t, mvs, state, hbe)
        motion01 = max(0.0, min(1.0, score / (3.0 * thr))) if thr > 0 else 0.0
        if hbe_thr and hbe is not None:
            motion01 = max(motion01, min(1.0, hbe / (3.0 * hbe_thr)))
        reading = MotionReading(t, state, round(score, 3), round(thr, 3), motion01,
                                round(conf, 3), reason, feats, b.source)
        self.last = reading
        return reading

    def _learn_fan_baseline(self, t: float, mvs: float, feats: dict) -> MotionReading:
        """With the fan on and no fan-on baseline (none from `calibrate --fan`),
        Wi-Fi makes no decisions until the radar has seen the room empty — with the
        fan running — long enough to measure one."""
        if (not self.settling and self.radar_empty_s is not None
                and self.radar_empty_s >= self.cfg.fan_learn_after_s):
            self._fan_learn.append(mvs)
            self._fan_learn_level.append(feats.get("level_var"))
            self._fan_learn_hbe.append(feats.get("hbe"))
        need = int(self.cfg.fan_learn_s / self.cfg.hop_s)
        if len(self._fan_learn) >= need:
            b = Baseline.from_values(self._fan_learn, self.cfg.threshold_quantile,
                                     "learned (fan on)",
                                     f"{self.cfg.fan_learn_s:.0f} s of radar-confirmed empty room, fan running",
                                     levels=self._fan_learn_level, level_fine=self._level_fine,
                                     hbes=self._fan_learn_hbe)
            self._baselines[self.FAN_ON] = b
            self._calibrated[self.FAN_ON] = Baseline(**asdict(b))
            self._fan_learn.clear()
            self._fan_learn_level.clear()
            self._fan_learn_hbe.clear()
        reading = MotionReading(t, STATE_UNCALIBRATED, None, None, 0.0, 0.0,
                                f"fan on: learning its baseline ({len(self._fan_learn) * self.cfg.hop_s:.0f}"
                                f" of {self.cfg.fan_learn_s:.0f} s with the radar seeing an empty room)",
                                feats, "none")
        self.last = reading
        return reading

    def _hbe(self) -> tuple[Optional[float], Optional[float]]:
        """(HBE of the full window, human-band power of its last second)."""
        if not self.cfg.hbe or len(self._amps) < self._amps.maxlen:
            return None, None
        r = human_band_energy(np.stack(self._amps), np.fromiter(self._filled, bool),
                              self.cfg.rate_hz, fan=self.fan if self.fan.locked else None,
                              detail=True)
        return (None, None) if r is None else (r[0], r[2])

    def _level_var(self) -> Optional[float]:
        """Variance of the window's level after removing its straight-line trend
        (breathing and drift are near-linear over 1 s; walking is not), in dB^2."""
        if len(self._level) < self.cfg.window_n:
            return None
        y = np.fromiter(self._level, float)
        if not np.all(np.isfinite(y)):
            return None
        n = y.size
        tt = np.arange(n) - (n - 1) / 2
        y = y - y.mean()
        y = y - tt * (tt @ y) / (tt @ tt)
        return float(y.var())

    def _level_threshold(self, b: Baseline, scale: float) -> Optional[float]:
        """None (channel off) without a level calibration, or when the calibration's
        kind of level (gain / RSSI) differs from what is flowing now."""
        if b.level_q is None or b.level_fine is None or b.level_fine != self._level_fine:
            return None
        # A precaution, not a measured fix: a spinning fan moves the total power
        # periodically, and 1 dB RSSI steps would turn that into jumps a fan-on
        # baseline learned in one minute may not cover. The fine, gain-based level
        # follows the fan smoothly and stays on. (The 11-13 % false "occupied" on 4 of
        # 10 no-gain fan runs that first suggested this comes from a radar blade
        # ghost: identical with this channel off, 2026-10-10.)
        if not b.level_fine and self.context == self.FAN_ON:
            return None
        floor = 0.0 if b.level_fine else self.cfg.level_floor_rssi_db2
        return max(scale * b.level_q, floor)

    def _maybe_adapt(self, t: float, mvs: float, state: str, hbe: Optional[float] = None) -> None:
        b = self.baseline
        if self.radar_empty_s is None:
            self._radar_quiet.clear()
            self._radar_quiet_hbe.clear()
        else:
            self._radar_quiet.append(mvs)
            self._radar_quiet_hbe.append(hbe)
            if (self.radar_empty_s >= self.cfg.radar_adapt_after_s
                    and self._calibrated.get(self.context) is not None):
                self._adapt_to_radar_quiet(b)
                return
        if state != STATE_QUIET or self._quiet_since is None:
            return
        if t - self._quiet_since < self.cfg.adapt_quiet_needed_s:
            return
        if self._last_motion_t is not None and \
                t - self._last_motion_t < self.cfg.freeze_after_motion_s:
            return
        a = self.cfg.hop_s / self.cfg.adapt_tau_s
        b.median = (1 - a) * b.median + a * mvs
        # Track the upper quantile only downward-slowly, upward-cautiously: a
        # quiet-room value above the current q_hi is mild evidence the room got
        # noisier, so it moves at a tenth of the rate.
        b.q_hi = (1 - a) * b.q_hi + a * max(mvs, b.q_hi) if mvs > b.q_hi else \
            (1 - a * 0.1) * b.q_hi + a * 0.1 * mvs
        if b.hbe_q is not None and hbe is not None:
            # Same rule for the human-band threshold. HBE is self-normalised by the
            # window's own noise, so it barely drifts; this only follows slow changes.
            b.hbe_q = (1 - a) * b.hbe_q + a * hbe if hbe > b.hbe_q else \
                (1 - a * 0.1) * b.hbe_q + a * 0.1 * hbe

    def _adapt_to_radar_quiet(self, b: Baseline) -> None:
        """Follow the last minute of radar-confirmed-empty readings (capped)."""
        vals = np.fromiter(self._radar_quiet, float)
        if len(vals) < self._radar_quiet.maxlen // 2:
            return
        cal, cap = self._calibrated[self.context], self.cfg.radar_adapt_cap
        a = self.cfg.hop_s / self.cfg.radar_adapt_tau_s
        med = (1 - a) * b.median + a * float(np.median(vals))
        hi = (1 - a) * b.q_hi + a * float(np.quantile(vals, self.cfg.threshold_quantile))
        b.median = min(max(med, cal.median / cap), cal.median * cap)
        b.q_hi = min(max(hi, cal.q_hi / cap), cal.q_hi * cap)
        hb = [v for v in self._radar_quiet_hbe if v is not None]
        if b.hbe_q is not None and cal.hbe_q is not None and len(hb) >= len(vals) // 2:
            hq = (1 - a) * b.hbe_q + a * float(np.quantile(hb, self.cfg.threshold_quantile))
            b.hbe_q = min(max(hq, cal.hbe_q / cap), cal.hbe_q * cap)
        if b.source == "calibrated":
            b.note = "following radar-confirmed empty room"


# -------------------------------------------------------------- breathing
@dataclass
class RespirationReading:
    present: bool                      # 2 of the last 3 windows found breathing
    bpm: Optional[float]
    ratio: Optional[float]             # last window's statistic / empty-room floor
    note: str


class RespirationDetector:
    """Breathing as PRESENCE evidence: is the person the radar lost still there?

    WHY
      The LD2450 forgets a person a few seconds after they stop moving, and the
      motion detector cannot see them either. On the sleep scenario (radar loses the
      sleeper 8 s after they lie down, sees them again only when they fidget) the
      room read "empty" 72-85 % of the time someone was asleep in it.

    WHAT IT IS ALLOWED TO DO (fusion.py)
      Hold a belief that is already "occupied": it switches the absence term off and
      adds a little. It can never make an empty room occupied, it is ignored for two
      minutes after someone walks out of the door, and it is off while a ceiling fan's
      lines are in the signal or a relay is settling.

    METHOD (the audit's prototype, 2026-10-09)
      - anti-aliased decimation 100 -> 10 Hz: the mean of each 10 samples (a boxcar
        with nulls at 10, 20, 30 Hz). The older BreathingEstimator took every 5th
        sample with no filter, which folds anything near 20 Hz into 0.1-0.5 Hz;
      - 25 s windows every 5 s, only when the motion detector has reported no
        movement for the whole window;
      - per subcarrier, power in 0.1-0.5 Hz (6-30 breaths/min) over power in
        0.8-3 Hz; keep the top_k subcarriers, z-score them, first principal component;
      - statistic = the PC's spectral peak in 0.1-0.5 Hz over its median level in
        0.8-3 Hz (peak over floor — the older estimator compared the band with
        itself, and a 60 s window smeared a rate that wanders by +-15 % into
        nothing: 1 % detection, where 25 s windows keep 72 %);
      - a window PASSES if the statistic is k_floor times the empty room's median
        (Baseline.resp_floor), and breathing is PRESENT when 2 of the last 3 windows
        pass with peaks within 3 breaths/min of each other.

    k_floor = 6. On the simulator's empty rooms (dev seeds 101-105, ~340 windows)
    the ratio never exceeded 2.9 and still/lying/seated-pair windows sat at a median
    of 17-75 (>= 6 in 94-100 % of them). But the simpler synthetic generator in the
    tests — white multiplicative noise, no conditioner — has a much heavier tail:
    single windows of 4-8x from noise alone. How heavy the real tail is is unknown
    until the real room is recorded, so the margin is set against the heavier one.
    Re-check it on `record --label empty` / `--label lying` files.
    """

    def __init__(self, floor: Optional[float] = None, in_rate_hz: float = 100.0,
                 decim: int = 10, window_s: float = 25.0, hop_s: float = 5.0,
                 top_k: int = 8, k_floor: float = 6.0, hold_s: float = 60.0):
        self.floor = floor
        self.decim = decim
        self.fs = in_rate_hz / decim
        self.window_s = window_s
        self.n = int(round(window_s * self.fs))
        self.hop = int(round(hop_s * self.fs))
        self.top_k = top_k
        self.k_floor = k_floor
        self.hold_s = hold_s
        self._present_t: Optional[float] = None
        self._present_bpm: Optional[float] = None
        self._acc: Optional[np.ndarray] = None
        self._acc_n = 0
        self._buf: deque = deque(maxlen=self.n)
        self._since = 0
        self._t = 0.0
        self._last_motion_t = float("-inf")
        self._votes: deque = deque(maxlen=3)
        nfft = 1024
        self._nfft = nfft
        self._freqs = np.fft.rfftfreq(nfft, 1.0 / self.fs)
        self._band = (self._freqs >= 0.1) & (self._freqs <= 0.5)
        self._ref = (self._freqs >= 0.8) & (self._freqs <= 3.0)
        self._win = np.hanning(self.n)
        self.stats: list[float] = []           # every statistic computed (calibration)
        self.last = RespirationReading(False, None, None, f"needs {window_s:.0f} s of stillness")

    def note_motion(self, t: float) -> None:
        self._last_motion_t = t
        self._present_t = None                 # moved: start again from the windows

    def push(self, s: Sample) -> None:
        if self._acc is None or self._acc.size != s.amp.size:
            self._acc, self._acc_n = np.zeros(s.amp.size), 0
        self._acc += s.amp
        self._acc_n += 1
        if self._acc_n < self.decim:
            return
        self._buf.append(self._acc / self._acc_n)
        self._acc[:] = 0.0
        self._acc_n = 0
        self._t = s.t
        self._since += 1
        if len(self._buf) == self.n and self._since >= self.hop:
            self._since = 0
            self._evaluate()

    def statistic(self, X: np.ndarray) -> tuple[float, float]:
        """(peak-over-floor statistic, peak rate in breaths/min) of one window."""
        Z = X - X.mean(axis=0)
        P = np.abs(np.fft.rfft(Z * self._win[:, None], self._nfft, axis=0)) ** 2
        ratio = P[self._band].mean(axis=0) / np.maximum(P[self._ref].mean(axis=0), 1e-18)
        # Tried 2026-10-10, kept out: choosing the subcarriers from a ~1 min average of
        # this ratio, scaling by noise and taking the band-only principal direction
        # (+0.4 dB), and whitening by the full noise covariance (-1.3 dB). Measured with
        # aankhen/tests/calibrate_physics.py: this window-local version detects half
        # the windows at 17.2 dB of physics.py's breathing SNR, 90 % at 19.4 dB,
        # which is what its own threshold predicts (6x a noise floor of ~12).
        top = np.argsort(ratio)[::-1][: self.top_k]
        Zt = Z[:, top] / np.maximum(Z[:, top].std(axis=0), 1e-12)
        Zt = Zt - Zt.mean(axis=0)
        _, _, vt = np.linalg.svd(Zt, full_matrices=False)
        pc = Zt @ vt[0]
        Pp = np.abs(np.fft.rfft(pc * self._win, self._nfft)) ** 2
        k = int(np.argmax(Pp[self._band]))
        stat = float(Pp[self._band][k] / max(np.median(Pp[self._ref]), 1e-18))
        return stat, float(self._freqs[self._band][k] * 60.0)

    def _evaluate(self) -> None:
        t = self._t
        if t - self._last_motion_t < self.window_s:
            self._votes.append((False, None))
            note = "movement in the last 25 s"
            ratio = None
        else:
            stat, bpm = self.statistic(np.stack(self._buf))
            self.stats.append(stat)
            ratio = stat / self.floor if self.floor else None
            passed = ratio is not None and ratio >= self.k_floor
            self._votes.append((passed, bpm if passed else None))
            note = ("not calibrated (run calibrate)" if self.floor is None else
                    f"{ratio:.1f}x the empty room" + (" — breathing" if passed else ""))
        rates = [b for ok, b in self._votes if ok]
        present = len(rates) >= 2 and max(rates) - min(rates) <= 3.0
        bpm = round(float(np.median(rates)), 1) if present else None
        if present:
            self._present_t, self._present_bpm = t, bpm
        elif self._present_t is not None and t - self._present_t <= self.hold_s:
            # A weak breather (a position where their reflection barely moves the
            # link) flickers between windows; without this hold a 60 s gap was enough
            # for the absence term to win, and hold-only evidence cannot win it back
            # (simulator: one sleep run in another room, 47 % false "empty").
            present, bpm = True, self._present_bpm
            note += " (holding)"
        self.last = RespirationReading(present, bpm, round(ratio, 2) if ratio is not None else None, note)


@dataclass
class BreathingReading:
    bpm: Optional[float]
    confidence: float
    snr: float
    note: str


class BreathingEstimator:
    """EXPERIMENTAL respiration estimate. Lab-grade only. Superseded in the engine by
    RespirationDetector (see there for why); kept for its tests and as a reference.

    Published ESP32 results need a still subject about 1 m from a line-of-sight
    link; this project's link is ~7 m through a wall, so expect no estimate most
    of the time. It is reported only when the spectral peak is strong, and never
    while the motion detector reports movement.

    Method (from the research): decimate to 20 Hz, Butterworth band-pass
    0.1-0.5 Hz (6-30 breaths/min, 4th order, SOS, zero-phase), rank subcarriers
    by in-band / total power, keep the top 8, take the first principal component,
    and read the dominant frequency from its spectrum over a 60 s window.
    """

    # min_snr: the statistic is (strongest of ~24 in-band bins) / (median bin).
    # For pure noise that ratio averages ~5.4 by chance (max of 24 exponentials
    # ~ ln 24 + 0.58 = 3.75, over a median of ln 2 = 0.69), so the first value of 4
    # sat BELOW the noise floor and "found" 10 breaths/min in pure noise
    # (test_breathing_refuses_without_a_clear_signal). The 99th percentile of that
    # max under noise is ~ln(2400)/ln 2 = 11.3, so 12 gives ~1 % false estimates.
    def __init__(self, in_rate_hz: float = 100.0, out_rate_hz: float = 20.0,
                 window_s: float = 60.0, top_k: int = 8, min_snr: float = 12.0):
        self.decim = max(1, int(round(in_rate_hz / out_rate_hz)))
        self.fs = in_rate_hz / self.decim
        self.n = int(window_s * self.fs)
        self.top_k = top_k
        self.min_snr = min_snr
        self._buf: deque = deque(maxlen=self.n)
        self._i = 0
        from scipy.signal import butter
        self._sos = butter(4, [0.1, 0.5], btype="band", fs=self.fs, output="sos")

    def push(self, s: Sample) -> None:
        self._i += 1
        if self._i % self.decim == 0:
            self._buf.append(s.amp)

    def estimate(self, motion_state: str) -> BreathingReading:
        if motion_state == STATE_MOTION:
            return BreathingReading(None, 0.0, 0.0, "not estimated while moving")
        if len(self._buf) < self.n:
            return BreathingReading(None, 0.0, 0.0,
                                    f"needs {self.n / self.fs:.0f} s of stillness")
        from scipy.signal import sosfiltfilt
        X = np.stack(self._buf)                         # (n, subcarriers)
        X = X - X.mean(axis=0)
        Y = sosfiltfilt(self._sos, X, axis=0)
        ratio = (Y ** 2).sum(axis=0) / np.maximum((X ** 2).sum(axis=0), 1e-12)
        top = np.argsort(ratio)[::-1][: self.top_k]
        Z = Y[:, top]
        Z = Z - Z.mean(axis=0)
        _, _, vt = np.linalg.svd(Z, full_matrices=False)
        pc1 = Z @ vt[0]
        spec = np.abs(np.fft.rfft(pc1 * np.hanning(len(pc1)))) ** 2
        freqs = np.fft.rfftfreq(len(pc1), 1.0 / self.fs)
        band = (freqs >= 0.1) & (freqs <= 0.5)
        if not band.any():
            return BreathingReading(None, 0.0, 0.0, "window too short")
        bspec, bfreq = spec[band], freqs[band]
        k = int(np.argmax(bspec))
        snr = float(bspec[k] / max(np.median(bspec), 1e-18))
        if snr < self.min_snr:
            return BreathingReading(None, 0.0, round(snr, 2), "no clear breathing signal")
        conf = float(min(1.0, (snr - self.min_snr) / (3 * self.min_snr)))
        return BreathingReading(round(float(bfreq[k] * 60.0), 1), round(conf, 2),
                                round(snr, 2), "experimental, lab-grade method")
