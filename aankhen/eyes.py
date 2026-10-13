"""Aankhen's eyes: what the Wi-Fi channel itself looks like, for a person to watch.

Everything else in Aankhen turns the channel into decisions (moving or not, which
zone, which activity). This module decides nothing. It only draws the channel, so I
can watch my own movements show up in the radio signal and judge the decisions
myself. Three pictures:

  RIPPLE (column)        one waterfall column every ~100 ms. Per subcarrier: how far
                         its amplitude (over the sample's median: the channel's
                         shape, see push) is from where it has been lately (a ~10 s
                         baseline), in units of that subcarrier's own noise, clipped
                         to +-6. In simulation a still room is a calm field near zero
                         and movement near the link lights it. On the real board
                         (one session, fan on) it moves only a little: mean |z| 1.20
                         sitting still at the desk, 1.39 waving, 1.61 walking. What
                         it shows is the measurement, not a promise of streaks.
  PHASE RIPPLE           the same column, built from the phase of each packet after
  (phase_column)         removing what the two unsynchronised clocks scramble
                         (sanitise() explains exactly what that removes).
  RHYTHM (spectrum)      how fast the channel is changing, 0.1-10 Hz, over the last
                         6.4 s, in units of its own noise floor. The strongest
                         rhythm is named only when it is a clear local peak; the
                         real channel's spectrum falls like 1/f, so slow drift is
                         the normal case and gets no name.

COST. push() runs for every conditioned sample (100 Hz) and push_raw() for every
packet (~250-290 Hz on the real board), both under the engine lock: fixed work over
51 subcarriers, no growing state. push() writes into preallocated arrays only
(~10-20 us); push_raw() queues the packet and sanitises PHASE_BATCH at a time
(~15-20 us a packet). Columns and spectrum() are built when a viewer asks (10 Hz)
and only then: ~0.6-0.9 ms for the spectrum alone, ~3 ms for a whole message inside
the running engine with the simulator and the owner's app competing for the CPU.
Measured 2026-10-13 on the owner's laptop. Nobody watching: none of the 10 Hz work.
"""
from __future__ import annotations

import math
from typing import Optional

import numpy as np

from .csi import LLTF_KEEP, LLTF_BINS, Sample, bin_of
from .motion import HBE_ORDER, HBE_STEP_SIGMA, _bridge_gaps, _smooth_basis

RATE_HZ = 100.0                 # the conditioned stream (csi.UniformResampler)
# 30 s of amplitudes: the 6.4 s spectrum needs a fifth of it. The rest is room for a
# 25.6 s spectrum from the same buffer, the window breathing needs (0.04 Hz bins;
# RespirationDetector uses 25 s), without a second copy of the stream.
KEEP_S = 30.0

# ---- columns
BASELINE_TAU_S = 10.0           # "lately": a person who sits down fades into it in ~10 s
# The noise scale is the EMA of |first difference|. A body changes the channel by a
# fraction of the noise from one 10 ms sample to the next (HBE's premise), so the
# differences mostly measure the receiver, not me. Mostly: on the real board
# (learn-my-room session, 2026-10-12) a scale that followed the last 5 s rose while I
# moved and normalised the movement away: typing at the desk read 1.4x the still
# phase energy against 4.3x on one fixed scale, walking 1.1x the still amplitude
# energy against 1.4x. So it follows slowly (30 s) and robustly: once warm, a
# difference counts at most NOISE_CLAMP x the current scale, so a burst of movement
# or flicker cannot talk it up in a few seconds. A fan switched on is still followed,
# within a minute or two.
NOISE_TAU_S = 30.0
NOISE_CLAMP = 3.0
MEAN_ABS_DIFF = 2.0 / math.sqrt(math.pi)    # E|x1 - x2| = 1.128 sigma for Gaussian noise
# Floors for the noise scale. int8 I/Q quantisation alone gives ~1 % amplitude noise
# and ~0.012 rad of phase noise at a typical 25-count subcarrier (0.29 count / 25), so
# a real subcarrier never gets near these; they only stop a dead subcarrier, or a
# replay of perfectly repeated packets, from dividing by ~0.
AMP_NOISE_FLOOR = 0.002         # normalised amplitude units (the packet's median is 1)
PHASE_NOISE_FLOOR = 0.002       # radians
CLIP_Z = 6.0
WARMUP_S = 2.0                  # columns are None until the baseline and noise have this much
MIN_DIFFS = 50                  # ... and the noise scale at least this many differences
# Differences are taken between MEASURED values up to this far apart, skipping the
# forward-filled ones in between: a body moves the channel by a fraction of the noise
# per 10 ms (HBE's premise), and five slots later still well under it.
DIFF_MAX_GAP_S = 0.05
# A column averages what arrived since the last call. Nobody may ask for a while (no
# viewer subscribed), so the average is restarted when it gets older than this: the
# first column a new viewer sees is the last half second, not the last ten minutes.
COLUMN_MAX_S = 0.5

# ---- spectrum
SPECTRUM_S = 6.4                # 640 samples: bins 0.156 Hz apart, 1..64 cover 0.16-10 Hz
SPECTRUM_MAX_HZ = 10.0
NOISE_BAND_HZ = (6.0, 10.0)     # above body speeds: receiver noise (and fan leftovers)
# Where a peak may be named. Not from 0.4 Hz (HBE's body band): in a 6.4 s window the
# bins below ~0.8 Hz sit on the slow-drift continuum, and on the real board the named
# "peaks" there were drift in every step (median 0.47-0.78 Hz, still and empty alike).
PEAK_BAND_HZ = (0.8, 4.0)
# A peak is named only when it stands this far above the noise floor. Pure noise:
# each bin is the mean of 6 exponentials (Gamma(6)/6), so 4x the floor has a ~3e-6
# chance per bin, ~1e-4 over the 23 bins of the peak band. A real 1.5 Hz wave is
# 100-1000x.
PEAK_MIN_X = 4.0
PEAK_LOCAL_HZ = 0.6             # the neighbourhood a peak is compared with (see spectrum)
# 5x, from a sweep over the real learn-my-room windows (3x / 5x / 8x; band from 0.4
# or 0.8 Hz): with 0.8 Hz and 5x, 0 % of windows sitting still or with nobody home
# name a peak (3x from 0.4 Hz: 22 % and 33 %), while 13-15 % of waving windows and 5 %
# of walking do. Tuned on that ONE recording: recheck on the next session.
PEAK_OVER_LOCAL = 5.0
# "breathing" (0.1-0.5 Hz) in a 6.4 s window is 3 bins that slow drift leaks into
# through the Hann window: on the real board it read 15x the floor at desk_still and
# 25x with nobody home. It is slow change, drift or breathing; this window cannot
# tell them apart (breathing needs ~25 s: RespirationDetector).
BANDS_HZ ={"breathing": (0.1, 0.5), "body": (0.5, 2.0), "fast": (2.0, 4.0), "above": (4.0, 10.0)}
SPECTRUM_MIN_REAL = 0.5         # refuse windows that are more invented (filled) than measured


# ======================================================================= phase
_S = np.array(LLTF_KEEP, dtype=float)                   # subcarrier numbers, ascending
_DS = np.diff(_S)                                       # 1, except 3 across the DC gap
_SC = _S - _S.mean()
_SC2 = float(_SC @ _SC)
_KEEP_BINS = np.array([bin_of(s) for s in LLTF_KEEP])
_IM_IDX, _RE_IDX = 2 * _KEEP_BINS, 2 * _KEEP_BINS + 1   # imaginary byte FIRST, then real
_GAP = LLTF_KEEP.index(2)                               # -1 -> +2: three spacings apart
TWO_PI = 2 * math.pi
# Packets are sanitised this many at a time. Per packet the work is ~25 numpy calls
# on 51 numbers, so the cost is the calls (~1 us each here), not the arithmetic:
# one packet at a time measured ~60 us, x 290 packets/s under the engine lock.
# Batched, the calls are shared. A column flushes the batch first, so it adds no lag.
PHASE_BATCH = 32


def sanitise(raws: list) -> np.ndarray:
    """Phase of the 51 LLTF subcarriers with its best straight line removed (radians),
    one row per packet; NaN rows for buffers that are too short or silent.

    The ESP32 and the router run on separate clocks, so every packet's raw phase
    carries a random common offset (carrier frequency offset, the receiver's random
    initial phase) and a random slope across subcarriers (packet-detection delay,
    sampling-clock offset). Both are straight lines in the subcarrier number, so each
    packet is
      1. unwrapped across subcarriers in frequency order. The DC gap (-1 -> +2 is
         three spacings) could make unwrap take the wrong turn when the slope is
         steep, so each step is first de-rotated by the packet's average neighbour-
         to-neighbour step (the angle of sum H[k+1] conj(H[k]) over neighbours, which
         weights strong subcarriers by construction). That is itself a line, and goes
         with the fit below;
      2. fitted with phi(s) = a*s + b by least squares, and the fit subtracted.
    PLAINLY: this also removes the true time-of-flight slope. The delay of the
    channel is exactly the information the two unsynchronised clocks destroy, and no
    single-receiver trick gets it back. What remains is the nonlinear, multipath-
    shaped part of the phase: how the reflections bend it across the band. A moving
    body changes that bend; the clocks cannot imitate it.

    WHAT IT SHOWED ON THE REAL BOARD (one learn-my-room session, 2026-10-12, fan on;
    ONE contiguous ~25 s episode per label, so class is confounded with time — not yet
    evidence for a learned feature; a repeated A-B-A-B session must come first): at
    the desk, typing vs sitting still read column energy 4.9x, AUC 0.99 on phase
    against 1.35x and 0.68 on amplitude; on the bed the order inverted (waving 0.53x
    still, AUC 0.18), and pooled still-vs-waving was 0.50. Its packet-to-packet flicker rose ~5x lying on
    the bed and with nobody in the room (27 % of subcarrier steps over 1 rad, against
    ~1 % at the desk), with no change in packet type (98 % HT/STBC throughout) and no
    deep fades to blame. So the flicker belongs to the channel state, not to movement:
    in the phase ripple it shows as a brighter texture, not as streaks.

    Same byte layout as csi.amplitudes(): int8 pairs, imaginary first, then real.
    """
    n, w = len(raws), LLTF_BINS * 2
    ok = np.array([len(r) >= w for r in raws], bool)
    out = np.full((n, len(LLTF_KEEP)), np.nan)
    if not ok.any():
        return out
    iq = np.frombuffer(b"".join(r[:w] for r, k in zip(raws, ok) if k), dtype=np.int8)
    iq = iq.reshape(-1, w).astype(np.float64)
    re, im = iq[:, _RE_IDX], iq[:, _IM_IDX]
    live = re.any(axis=1) | im.any(axis=1)
    g = _GAP
    # sum over neighbours of H[k+1] conj(H[k]), minus the pair across the gap
    sr = (re[:, 1:] * re[:, :-1] + im[:, 1:] * im[:, :-1]).sum(axis=1) \
        - (re[:, g] * re[:, g - 1] + im[:, g] * im[:, g - 1])
    si = (im[:, 1:] * re[:, :-1] - re[:, 1:] * im[:, :-1]).sum(axis=1) \
        - (im[:, g] * re[:, g - 1] - re[:, g] * im[:, g - 1])
    a0 = np.arctan2(si, sr)
    d = np.diff(np.arctan2(im, re), axis=1) - a0[:, None] * _DS       # de-rotated steps
    d -= TWO_PI * np.rint(d / TWO_PI)                                  # each into [-pi, pi]
    ph = np.zeros((len(d), len(LLTF_KEEP)))
    np.cumsum(d, axis=1, out=ph[:, 1:])                                # unwrapped
    ph -= ph.mean(axis=1, keepdims=True)                               # b
    ph -= np.outer(ph @ _SC / _SC2, _SC)                               # a: least squares
    ph[~live] = np.nan
    out[ok] = ph
    return out


def phase_residual(raw: bytes) -> Optional[np.ndarray]:
    """sanitise() for one packet; None if it carries nothing usable."""
    r = sanitise([raw])[0]
    return None if np.isnan(r[0]) else r


# ======================================================================= columns
class ColumnBuilder:
    """Per-subcarrier deviation from a slow baseline, in units of the noise, averaged
    over whatever arrived since the last column: the engine of both ripples.

    circular=True treats values as angles: deviations and the baseline are wrapped
    into [-pi, pi), so a residual that crosses the branch cut is a small change, not
    a 2 pi jump.
    """

    def __init__(self, n: int, floor: float, circular: bool = False):
        self.n = n
        self.floor = floor
        self.circular = circular
        self.base = np.zeros(n)
        self.noise = np.zeros(n)                     # EMA of |first difference|
        self.prev = np.zeros(n)                      # the last MEASURED value
        self.acc = np.zeros(n)                       # sum of deviations for the next column
        self._tmp = np.zeros(n)
        self._cap = np.zeros(n)
        self._d = np.zeros(n)
        self.reset()

    def reset(self) -> None:
        self.updates = 0
        self.diffs = 0
        self.t0: Optional[float] = None
        self.t_last: Optional[float] = None
        self.t_prev: Optional[float] = None          # when self.prev was measured
        self.acc_n = 0
        self.acc_t0 = 0.0
        self.acc.fill(0.0)

    def _wrap(self, x: np.ndarray) -> None:
        x += math.pi
        np.mod(x, 2 * math.pi, out=x)
        x -= math.pi

    @property
    def warm(self) -> bool:
        return (self.t0 is not None and self.t_last - self.t0 >= WARMUP_S
                and self.diffs >= MIN_DIFFS)

    @property
    def seconds(self) -> float:
        return 0.0 if self.t0 is None else self.t_last - self.t0

    def push(self, t: float, x: np.ndarray, real: bool = True) -> None:
        dt = 0.0 if self.t_last is None else min(max(t - self.t_last, 0.0), 1.0)
        if self.t0 is None:
            self.t0 = t
        near = real and self.t_prev is not None and t - self.t_prev <= DIFF_MAX_GAP_S
        if near:
            np.subtract(x, self.prev, out=self._d)
            if self.circular:
                self._wrap(self._d)
        tmp = self._tmp
        np.subtract(x, self.base, out=tmp)           # deviation from "lately"
        if self.circular:
            self._wrap(tmp)
        if self.updates == 0:
            tmp.fill(0.0)
        if self.acc_n and t - self.acc_t0 > COLUMN_MAX_S:
            self.acc.fill(0.0)
            self.acc_n = 0
        if self.acc_n == 0:
            self.acc_t0 = t
        self.acc += tmp
        self.acc_n += 1
        # Baseline: an EMA that starts as a running mean (alpha = 1/n), so the first
        # seconds are averaged instead of pinned to the very first sample.
        self.updates += 1
        a = max(1.0 / self.updates, dt / BASELINE_TAU_S)
        if self.updates == 1:
            np.copyto(self.base, x)
        else:
            tmp *= a
            self.base += tmp
            if self.circular:
                self._wrap(self.base)
        # Noise: differences between MEASURED values only. A forward-filled sample
        # repeats the last one exactly, and its zero difference would talk the noise
        # down; it is skipped, and the next measured one is compared with the last.
        if near:
            np.abs(self._d, out=tmp)
            if self.diffs >= MIN_DIFFS:
                np.multiply(self.noise, NOISE_CLAMP, out=self._cap)
                np.minimum(tmp, self._cap, out=tmp)
            self.diffs += 1
            b = max(1.0 / self.diffs, (t - self.t_prev) / NOISE_TAU_S)
            self.noise *= 1.0 - b
            tmp *= b
            self.noise += tmp
        if real:
            np.copyto(self.prev, x)
            self.t_prev = t
        self.t_last = t

    def push_many(self, ts: np.ndarray, X: np.ndarray) -> None:
        """A batch of measured values (rows of X at times ts), as push() would take
        them one by one, with the baseline and noise updated once for the batch. The
        baseline moves by ~n x dt / 10 s per batch (~0.1 % for 32 packets), so
        deviations against the batch's starting baseline are the same to that."""
        if len(ts) == 0:
            return
        t_first, t_end = float(ts[0]), float(ts[-1])
        if self.t0 is None:
            self.t0 = t_first
            np.copyto(self.base, X[0])
        D = X - self.base
        if self.circular:
            D = np.mod(D + math.pi, TWO_PI) - math.pi
        if self.updates == 0:
            D[0] = 0.0
        if self.acc_n and t_end - self.acc_t0 > COLUMN_MAX_S:
            self.acc.fill(0.0)
            self.acc_n = 0
        if self.acc_n == 0:
            self.acc_t0 = t_first
        self.acc += D.sum(axis=0)
        self.acc_n += len(ts)
        # Baseline: the running mean while young, then an EMA (as push()).
        n, u = len(ts), self.updates
        span = max(t_end - (self.t_last if self.t_last is not None else t_first), 0.0)
        a = max(n / (u + n), 1.0 - (1.0 - min(span / max(n, 1), 1.0) / BASELINE_TAU_S) ** n)
        self.base += a * D.mean(axis=0)
        if self.circular:
            self._wrap(self.base)
        self.updates = u + n
        # Noise: neighbours in time no further apart than DIFF_MAX_GAP_S, the first one
        # against the last value of the previous batch.
        prev_t = np.concatenate(([self.t_prev if self.t_prev is not None else -np.inf], ts[:-1]))
        P = np.vstack([self.prev[None, :], X[:-1]])
        pair = (ts - prev_t) <= DIFF_MAX_GAP_S
        if pair.any():
            dX = X[pair] - P[pair]
            if self.circular:
                dX = np.mod(dX + math.pi, TWO_PI) - math.pi
            m, k = int(pair.sum()), self.diffs
            gap = float(np.mean((ts - prev_t)[pair]))
            b = max(m / (k + m), 1.0 - (1.0 - gap / NOISE_TAU_S) ** m)
            dX = np.abs(dX)
            if k >= MIN_DIFFS:
                dX = np.minimum(dX, NOISE_CLAMP * self.noise)
            self.noise += b * (dX.mean(axis=0) - self.noise)
            self.diffs = k + m
        np.copyto(self.prev, X[-1])
        self.t_prev = self.t_last = t_end

    def column(self) -> Optional[list]:
        """The deviation since the last call, in noise units, clipped to +-6 and
        rounded to 2 dp; None while warming up or when nothing new arrived."""
        n, self.acc_n = self.acc_n, 0
        if n == 0 or not self.warm:
            self.acc.fill(0.0)
            return None
        sigma = np.maximum(self.noise / MEAN_ABS_DIFF, self.floor)
        z = np.clip(self.acc / (n * sigma), -CLIP_Z, CLIP_Z)
        self.acc.fill(0.0)
        return np.round(z, 2).tolist()


# ======================================================================= buffer
class EyesBuffer:
    """The last ~30 s of the conditioned stream, and the pictures drawn from it."""

    def __init__(self, n_sub: int = len(LLTF_KEEP), rate_hz: float = RATE_HZ, keep_s: float = KEEP_S):
        self.rate_hz = rate_hz
        self._cap = int(round(keep_s * rate_hz))
        self._alloc(n_sub)
        self.phase = ColumnBuilder(len(LLTF_KEEP), PHASE_NOISE_FLOOR, circular=True)
        self._raw_t: list[float] = []                # packets waiting to be sanitised
        self._raw: list[bytes] = []
        self._win: dict[int, np.ndarray] = {}        # Hann windows by length

    def _alloc(self, n_sub: int) -> None:
        self.n_sub = n_sub
        self._amp = np.zeros((self._cap, n_sub))
        self._real = np.zeros(self._cap, bool)
        self._count = 0                               # samples since reset
        self._sort = np.zeros(n_sub)                  # scratch for the median
        self._shape = np.zeros(n_sub)
        self.amp = ColumnBuilder(n_sub, AMP_NOISE_FLOOR)

    def reset(self) -> None:
        """Forget the stream (the engine: the Wi-Fi channel changed, and with it the
        whole multipath). Nothing is reallocated."""
        self._count = 0
        self.amp.reset()
        self.phase.reset()
        self._raw_t.clear()
        self._raw.clear()

    @property
    def seconds(self) -> float:
        """Seconds of stream since start or the last reset."""
        return self._count / self.rate_hz

    # ------------------------------------------------------------ input
    def push(self, s: Sample) -> None:
        """One conditioned 100 Hz sample: O(51), into preallocated arrays only.

        The ripple is drawn from the sample's SHAPE: each subcarrier over the sample's
        own median. Without gain reports (the real board today) the conditioner has
        already done exactly that, so this changes nothing there. With them it keeps
        the overall level, and the simulator's level swings +-3 dB every ~10 s even
        with nobody moving: against a 10 s baseline, in units of the per-sample noise,
        that saturated 64 % of a still room's columns. The level is one number per
        sample and says nothing per subcarrier; the shape is what the ripple can add.
        The rhythm (spectrum) keeps the level, as HBE does."""
        if s.amp.size != self.n_sub:                  # never for LLTF (always 51)
            self._alloc(s.amp.size)
        k = self._count % self._cap
        self._amp[k] = s.amp
        self._real[k] = not s.filled
        self._count += 1
        np.copyto(self._sort, s.amp)
        self._sort.partition(self.n_sub // 2)         # in place: the median, no copy
        med = float(self._sort[self.n_sub // 2])
        if med <= 1e-9:
            return                                    # a dead sample says nothing about shape
        np.divide(s.amp, med, out=self._shape)
        self.amp.push(s.t, self._shape, real=not s.filled)

    def push_raw(self, t: float, raw: bytes) -> None:
        """One packet's raw buffer (device seconds), for the phase ripple. Queued, and
        sanitised PHASE_BATCH at a time (or when a column is asked for)."""
        self._raw_t.append(t)
        self._raw.append(raw)
        if len(self._raw) >= PHASE_BATCH:
            self._flush_phase()

    def _flush_phase(self) -> None:
        if not self._raw:
            return
        R = sanitise(self._raw)
        ts = np.asarray(self._raw_t)
        self._raw_t.clear()
        self._raw.clear()
        ok = ~np.isnan(R[:, 0])
        if ok.any():
            self.phase.push_many(ts[ok], R[ok])

    # ------------------------------------------------------------ pictures
    def column(self) -> Optional[list]:
        """The amplitude ripple's column for the samples since the last call."""
        return self.amp.column()

    def phase_column(self) -> Optional[list]:
        """The phase ripple's column for the packets since the last call."""
        self._flush_phase()
        return self.phase.column()

    def spectrum(self, window_s: float = SPECTRUM_S) -> Optional[dict]:
        """How fast the channel changes, 0.16-10 Hz, over the last window_s seconds.

        PROJECTION. Each sample is projected on the same smooth subcarrier patterns HBE
        uses (motion._smooth_basis: the first HBE_ORDER+1 Legendre polynomials across
        the band) and the power is averaged over them, rather than taking the top
        principal component:
          - it is the space a moving body actually changes (a body's extra path bends
            the channel smoothly across 16 MHz), and it drops ~88 % of the per-
            subcarrier receiver noise;
          - it is fixed. The top PC is whatever varies most in the window: noise in a
            still room, the fan's pattern when the fan runs, and it can swap for the
            second one from one call to the next, so the picture would jump while
            nothing in the room changed;
          - it is what the motion detector listens to, so the rhythm I see is the
            rhythm it judges.
        Then, as HBE: forward-filled gaps bridged, mean and trend removed, one-sample
        steps (gain jumps, glitches) cut out, Hann window, rFFT.

        Returns {"hz", "power": log10(power / noise floor) (0 = noise, 1 = 10x,
        2 = 100x), "peak_hz": the strongest bin in 0.8-4 Hz, parabola-refined, or None
        when it is not PEAK_MIN_X over the floor, "bands": mean power over the floor
        (linear, x noise) per band}, or None until window_s of stream is in.
        """
        n = int(round(window_s * self.rate_hz))
        if self._count < n or n > self._cap:
            return None
        idx = (self._count - n + np.arange(n)) % self._cap
        real = self._real[idx]
        if real.mean() < SPECTRUM_MIN_REAL:
            return None
        C = self._amp[idx] @ _smooth_basis(self.n_sub, HBE_ORDER)
        if not real.all():
            C = _bridge_gaps(C, real)
        C = _detrend(C)
        C = _cut_steps(C, real)
        w = self._win.get(n)
        if w is None:
            w = self._win[n] = np.hanning(n)
        X = np.fft.rfft(C * w[:, None], axis=0)
        P = (X.real ** 2 + X.imag ** 2).mean(axis=1)
        f = np.fft.rfftfreq(n, 1.0 / self.rate_hz)
        sel = (f > 0) & (f <= SPECTRUM_MAX_HZ + 1e-9)
        nb = (f >= NOISE_BAND_HZ[0]) & (f <= NOISE_BAND_HZ[1] + 1e-9)
        floor = max(float(np.median(P[nb])), 1e-30)
        ratio = P / floor
        hz, x = f[sel], ratio[sel]
        peak = None
        pb = np.flatnonzero((f >= PEAK_BAND_HZ[0]) & (f <= PEAK_BAND_HZ[1]))
        k = int(pb[np.argmax(ratio[pb])])
        # A peak is a local maximum. The strongest bin of the band can be its EDGE,
        # catching the leakage of something slower or faster outside it (on the
        # simulator, a slow level wander put a "0.47 Hz peak" on the lower edge, where
        # the spectrum was still rising towards 0.1 Hz). That is no rhythm at body speed.
        # And it must stand PEAK_OVER_LOCAL x above its own neighbourhood. The floor
        # above is white noise at 6-10 Hz, but the real channel's spectrum falls
        # roughly as 1/f: on the real board 4x that floor fired on slow drift in
        # 44 % of desk_still windows and 45 % of windows with nobody home (median
        # "peak" ~0.5 Hz in every step). The neighbourhood (bins within +-0.6 Hz,
        # leaving out +-1 bin of the peak's own Hann main lobe) is that continuum.
        df = f[1] - f[0]
        reach = max(2, int(round(PEAK_LOCAL_HZ / df)))
        near = [j for j in range(k - reach, k + reach + 1) if abs(j - k) > 1 and 1 <= j < len(ratio)]
        local = float(np.median(ratio[near])) if near else 0.0
        if (ratio[k] >= PEAK_MIN_X and ratio[k] >= ratio[k - 1] and ratio[k] >= ratio[k + 1]
                and ratio[k] >= PEAK_OVER_LOCAL * local):
            # Parabola through the log power of the peak bin and its neighbours: the
            # bins are 0.16 Hz apart, the peak need not sit on one.
            y0, y1, y2 = (math.log(max(v, 1e-30)) for v in ratio[k - 1:k + 2])
            den = y0 - 2 * y1 + y2
            d = 0.5 * (y0 - y2) / den if den < 0 else 0.0
            peak = round(float(f[k] + max(-0.5, min(0.5, d)) * (f[1] - f[0])), 2)
        bands = {}
        for name, (lo, hi) in BANDS_HZ.items():
            m = (hz >= lo) & ((hz < hi) if hi < SPECTRUM_MAX_HZ else (hz <= hi + 1e-9))
            bands[name] = round(float(x[m].mean()), 2) if m.any() else None
        return {"hz": np.round(hz, 3).tolist(),
                "power": np.round(np.log10(np.maximum(x, 1e-3)), 2).tolist(),
                "peak_hz": peak, "bands": bands, "window_s": window_s}


def _detrend(C: np.ndarray) -> np.ndarray:
    n = C.shape[0]
    t = np.arange(n) - (n - 1) / 2.0
    C = C - C.mean(axis=0)
    return C - np.outer(t, (t @ C) / (t @ t))


def _cut_steps(C: np.ndarray, real: np.ndarray) -> np.ndarray:
    """One-sample jumps beyond HBE_STEP_SIGMA noise deviations are not bodies (motion.py,
    STEPS ARE NOT PEOPLE): zero them and re-integrate, as HBE does."""
    D = np.diff(C, axis=0)
    pair = real[1:] & real[:-1]
    if pair.sum() < 8:
        return C
    d = D[pair]
    med = np.median(d, axis=0)
    sd = np.maximum(1.4826 * np.median(np.abs(d - med), axis=0), 1e-12)
    jump = np.abs(D - med) > HBE_STEP_SIGMA * sd
    if not jump.any():
        return C
    D = np.where(jump, med, D)
    return _detrend(np.vstack([np.zeros((1, C.shape[1])), np.cumsum(D, axis=0)]))
