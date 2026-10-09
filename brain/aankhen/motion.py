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
  hysteresis    = 4 consecutive windows above to switch on, 3 below to switch off
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

import json
import math
import os
import time
from collections import deque
from dataclasses import asdict, dataclass, field
from typing import Optional

import numpy as np

from .csi import Sample

STATE_UNCALIBRATED = "uncalibrated"
STATE_MOTION = "motion"
STATE_RECENT = "recent"
STATE_QUIET = "quiet"


@dataclass
class MotionConfig:
    rate_hz: float = 100.0
    window_s: float = 1.0
    hop_s: float = 0.25
    on_count: int = 4
    off_count: int = 3
    hold_s: float = 90.0                 # "recent" lasts this long after motion
    baseline_min_s: float = 60.0         # minimum empty-room calibration
    threshold_quantile: float = 0.995
    threshold_scale: float = 1.2
    auto_baseline_s: float = 30.0        # provisional baseline if never calibrated
    adapt_tau_s: float = 1200.0
    adapt_quiet_needed_s: float = 300.0
    freeze_after_motion_s: float = 300.0

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
                    note: str = "") -> "Baseline":
        arr = np.asarray(mvs, dtype=float)
        return cls(float(np.median(arr)), float(np.quantile(arr, quantile)),
                   len(arr), source=source, note=note)


class Calibrator:
    """Collects empty-room windows; refuses to finish before baseline_min_s."""

    def __init__(self, cfg: MotionConfig):
        self.cfg = cfg
        self.values: list[float] = []

    @property
    def seconds(self) -> float:
        return len(self.values) * self.cfg.hop_s

    def add(self, mvs: float) -> None:
        self.values.append(mvs)

    def ready(self) -> bool:
        return self.seconds >= self.cfg.baseline_min_s

    def finish(self) -> Baseline:
        if not self.ready():
            raise RuntimeError(
                f"need {self.cfg.baseline_min_s:.0f} s of empty room, have {self.seconds:.0f} s")
        return Baseline.from_values(self.values, self.cfg.threshold_quantile, "calibrated",
                                    f"{self.seconds:.0f} s empty-room capture")


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
    def __init__(self, cfg: Optional[MotionConfig] = None,
                 baseline: Optional[Baseline] = None):
        self.cfg = cfg or MotionConfig()
        self.baseline = baseline
        self._turb: deque = deque(maxlen=self.cfg.window_n)
        self._since_eval = 0
        self._on_run = 0
        self._off_run = 0
        self._in_motion = False
        self._last_motion_t: Optional[float] = None
        self._quiet_since: Optional[float] = None
        self._auto: list[float] = []
        self.last: Optional[MotionReading] = None
        self.evaluations = 0

    # -- feed -------------------------------------------------------------
    def push(self, s: Sample) -> Optional[MotionReading]:
        """Feed one clean sample; returns a reading every hop, else None."""
        self._turb.append(turbulence(s.amp))
        self._since_eval += 1
        if len(self._turb) < self.cfg.window_n or self._since_eval < self.cfg.hop_n:
            return None
        self._since_eval = 0
        return self._evaluate(s.t, np.fromiter(self._turb, float))

    # -- core -------------------------------------------------------------
    def _evaluate(self, t: float, turb: np.ndarray) -> MotionReading:
        self.evaluations += 1
        feats = window_features(turb)
        mvs = feats["mvs"]

        if self.baseline is None:
            # Provisional baseline from the first auto_baseline_s. This ASSUMES the
            # room was empty at start-up, which is why it is labelled "auto" and
            # reported with reduced confidence. Run `calibrate` for a real one.
            self._auto.append(mvs)
            if len(self._auto) * self.cfg.hop_s >= self.cfg.auto_baseline_s:
                self.baseline = Baseline.from_values(
                    self._auto, self.cfg.threshold_quantile, "auto",
                    "assumes the room was empty during the first 30 s after start")
            reading = MotionReading(t, STATE_UNCALIBRATED, None, None, 0.0, 0.0,
                                    "collecting a baseline — no decisions yet", feats, "none")
            self.last = reading
            return reading

        b = self.baseline
        score = mvs / b.median if b.median > 0 else 0.0
        thr = b.threshold_ratio(self.cfg.threshold_scale)
        above = score > thr
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
        elif self._last_motion_t is not None and t - self._last_motion_t < self.cfg.hold_s:
            state = STATE_RECENT
            reason = f"moved {t - self._last_motion_t:.0f} s ago — probably still here"
        else:
            state = STATE_QUIET
            reason = "no motion near the Wi-Fi link (a still person also looks like this)"

        # Confidence: how far past the threshold, discounted for an auto baseline.
        if state == STATE_MOTION:
            conf = min(1.0, 0.6 + 0.4 * math.tanh(math.log(max(score / thr, 1.0))))
        elif state == STATE_RECENT:
            conf = max(0.3, 1.0 - (t - self._last_motion_t) / self.cfg.hold_s)
        else:
            conf = 0.5
        if b.source == "auto":
            conf *= 0.7

        self._maybe_adapt(t, mvs, state)
        motion01 = max(0.0, min(1.0, score / (3.0 * thr))) if thr > 0 else 0.0
        reading = MotionReading(t, state, round(score, 3), round(thr, 3), motion01,
                                round(conf, 3), reason, feats, b.source)
        self.last = reading
        return reading

    def _maybe_adapt(self, t: float, mvs: float, state: str) -> None:
        b = self.baseline
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


# -------------------------------------------------------------- breathing
@dataclass
class BreathingReading:
    bpm: Optional[float]
    confidence: float
    snr: float
    note: str


class BreathingEstimator:
    """EXPERIMENTAL respiration estimate. Lab-grade only.

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
