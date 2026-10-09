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
from .fan import FanLines

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
    # Median breathing statistic of the empty room (RespirationDetector), measured
    # by the same calibration. None in baselines saved before it existed: then the
    # breathing evidence stays off until the room is recalibrated.
    resp_floor: Optional[float] = None

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
        self._since_eval = 0
        self._on_run = 0
        self._off_run = 0
        self._in_motion = False
        self._last_motion_t: Optional[float] = None
        self._quiet_since: Optional[float] = None
        self._auto: list[float] = []
        self.last: Optional[MotionReading] = None
        self.evaluations = 0
        # Set by the engine before each push: seconds the radar has been live and
        # empty (None = no radar, or it sees someone). Gates the adaptation below.
        self.radar_empty_s: Optional[float] = None
        # Set by the engine for 30 s after the fan relay switches: the fan is
        # spinning up or down and its signal sweeps through every frequency.
        self.settling = False
        self._radar_quiet: deque = deque(maxlen=int(round(self.cfg.radar_adapt_after_s / self.cfg.hop_s)))
        self._fan_learn: list[float] = []
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
        self._since_eval = self._on_run = self._off_run = 0
        self._in_motion = False
        self._radar_quiet.clear()
        self._fan_learn.clear()
        self.fan = FanLines()

    def set_fan(self, on: bool) -> None:
        ctx = self.FAN_ON if on else self.FAN_OFF
        if ctx != self.context:
            self.context = ctx
            self._on_run = self._off_run = 0
            self._radar_quiet.clear()
            self._fan_learn.clear()

    # -- feed -------------------------------------------------------------
    def push(self, s: Sample) -> Optional[MotionReading]:
        """Feed one clean sample; returns a reading every hop, else None."""
        tb = turbulence(s.amp)
        self._turb.append(tb)
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

        if self.baseline is None and self.context == self.FAN_ON:
            return self._learn_fan_baseline(t, mvs, feats)
        if self.baseline is None:
            # Provisional baseline from the first auto_baseline_s. This ASSUMES the
            # room was empty at start-up, which is why it is labelled "auto" and
            # reported with reduced confidence. Run `calibrate` for a real one.
            self._auto.append(mvs)
            if len(self._auto) * self.cfg.hop_s >= self.cfg.auto_baseline_s:
                self.baseline = Baseline.from_values(
                    self._auto, self.cfg.threshold_quantile, "auto",
                    "assumes the room was empty during the first 30 s after start")
                self._calibrated[self.context] = Baseline(**asdict(self.baseline))
            reading = MotionReading(t, STATE_UNCALIBRATED, None, None, 0.0, 0.0,
                                    "collecting a baseline — no decisions yet", feats, "none")
            self.last = reading
            return reading

        b = self.baseline
        score = mvs / b.median if b.median > 0 else 0.0
        scale = self.cfg.fan_threshold_scale if self.context == self.FAN_ON else self.cfg.threshold_scale
        thr = b.threshold_ratio(scale)
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
            self._maybe_adapt(t, mvs, state)
        motion01 = max(0.0, min(1.0, score / (3.0 * thr))) if thr > 0 else 0.0
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
        need = int(self.cfg.fan_learn_s / self.cfg.hop_s)
        if len(self._fan_learn) >= need:
            b = Baseline.from_values(self._fan_learn, self.cfg.threshold_quantile,
                                     "learned (fan on)",
                                     f"{self.cfg.fan_learn_s:.0f} s of radar-confirmed empty room, fan running")
            self._baselines[self.FAN_ON] = b
            self._calibrated[self.FAN_ON] = Baseline(**asdict(b))
            self._fan_learn.clear()
        reading = MotionReading(t, STATE_UNCALIBRATED, None, None, 0.0, 0.0,
                                f"fan on: learning its baseline ({len(self._fan_learn) * self.cfg.hop_s:.0f}"
                                f" of {self.cfg.fan_learn_s:.0f} s with the radar seeing an empty room)",
                                feats, "none")
        self.last = reading
        return reading

    def _maybe_adapt(self, t: float, mvs: float, state: str) -> None:
        b = self.baseline
        if self.radar_empty_s is None:
            self._radar_quiet.clear()
        else:
            self._radar_quiet.append(mvs)
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
