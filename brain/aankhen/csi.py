"""Wi-Fi CSI signal conditioning: raw ESP32 buffer -> clean amplitude stream.

Implements the pipeline the research converged on (ESPectre, Espressif esp-csi,
and the studies cited in docs/DECISIONS.md). Each stage exists because skipping
it produces a specific, known failure:

1. DECODE      The ESP32 CSI buffer is interleaved signed bytes, IMAGINARY FIRST
               then real, per FFT bin. Reversing the pair is a classic silent bug:
               amplitudes stay plausible, so nothing looks wrong.
2. SELECT      Buffer index k maps to subcarrier s = k (k < 32) or k - 64. For the
               legacy LTF keep s in [-26, -1] U [+2, +26] = 51 bins: drop DC (s=0),
               the guard bands (+-27..32, always ~0), and s=+1, which the S3 marks
               invalid (first_word_invalid covers the first 4 bytes).
3. AMPLITUDE   |CSI|, not phase. Between two unsynchronised radios the raw phase is
               dominated by per-packet carrier and timing offsets.
4. NORMALISE   Divide each packet by its own median amplitude, so automatic gain
               steps in the router or the ESP32 don't masquerade as motion.
5. RESAMPLE    Put packets on a uniform 100 Hz grid: at most one packet per 10 ms
               slot, short gaps forward-filled, long gaps (> 0.25 s) break the
               stream. The real arrival rate is MEASURED, never assumed — one
               well-known project assumed 10 Hz while packets arrived at 13-19 Hz.
6. HAMPEL      Per-subcarrier outlier removal, window 7, threshold 5 x MAD.
"""
from __future__ import annotations

from collections import deque
from dataclasses import dataclass
from typing import Optional

import numpy as np

# 51 usable legacy-LTF subcarriers, in ascending frequency order.
LLTF_KEEP = [s for s in range(-26, 27) if s not in (0, 1)]
LLTF_BINS = 64                    # an LLTF-only capture is 64 bins = 128 bytes


def subcarrier_of(k: int) -> int:
    """FFT buffer index -> signed subcarrier number."""
    return k if k < 32 else k - 64


def bin_of(s: int) -> int:
    """Signed subcarrier number -> FFT buffer index."""
    return s if s >= 0 else s + 64


_KEEP_BINS = np.array([bin_of(s) for s in LLTF_KEEP])


def amplitudes(raw: bytes) -> Optional[np.ndarray]:
    """Raw CSI buffer -> amplitudes of the 51 usable subcarriers (float64).

    Captures longer than 64 bins (HT-LTF appended) use only the leading LLTF
    block, so every packet yields the same 51-element vector regardless of which
    PHY format the router replied with. Returns None for unusable buffers.
    """
    if len(raw) < LLTF_BINS * 2:
        return None
    iq = np.frombuffer(raw[: LLTF_BINS * 2], dtype=np.int8).astype(np.float64)
    imag, real = iq[0::2], iq[1::2]            # imaginary FIRST
    amp = np.hypot(real, imag)[_KEEP_BINS]
    return amp


def normalise(amp: np.ndarray) -> Optional[np.ndarray]:
    n = amp.size
    if n % 2:                                   # 51 bins: the middle of a partition is
        med = float(np.partition(amp, n // 2)[n // 2])   # the median, without np.median's overhead
    else:
        med = float(np.median(amp))
    if med <= 1e-9:
        return None                             # dead packet (all-zero buffer)
    return amp / med


# ---------------------------------------------------------------- resampling
@dataclass
class Sample:
    t: float                 # slot time, seconds (device clock)
    amp: np.ndarray          # normalised amplitudes (51,)
    filled: bool             # True if forward-filled, not a real packet


class UniformResampler:
    """Snap irregular packets onto a fixed-rate grid.

    Features computed over "1 second" only mean something if a second is always
    100 samples. Pings get dropped and delayed, so arrival times jitter; this
    makes the downstream windows rate-stable and reports how much was invented
    (filled) versus measured.
    """

    # Slots are INTEGERS counted from a fixed origin. The first version kept a
    # float "next slot time" and added dt each step; the rounding drift made a
    # perfectly regular 100 Hz stream occasionally look one slot late, so it
    # invented a filled sample and then dropped the real packet. Caught by
    # test_resampler_regular_input_passes_through.
    #
    # Slots are CENTRED on the nominal packet times (round, not floor). With floor,
    # the slot edges sat exactly where a regular 100 Hz stream lands, so +-0.4 ms of
    # timing jitter flipped packets into the neighbouring slot: one was dropped as a
    # duplicate and an empty slot was forward-filled. On the simulator that invented
    # ~20 % of all samples. Centred slots tolerate up to +-5 ms of jitter.
    _EPS = 1e-6

    def __init__(self, rate_hz: float = 100.0, max_gap_s: float = 0.25):
        self.dt = 1.0 / rate_hz
        self.max_gap_s = max_gap_s
        self._t0: Optional[float] = None        # origin of slot 0
        self._next_slot = 0                     # first slot not yet emitted
        self._last: Optional[np.ndarray] = None
        self.gaps = 0
        self.filled = 0
        self.dropped_same_slot = 0
        self.emitted = 0

    def _slot(self, t: float) -> int:
        return int(np.floor((t - self._t0) / self.dt + 0.5))

    def push(self, t: float, amp: np.ndarray) -> list[Sample]:
        out: list[Sample] = []
        if self._t0 is None:
            self._t0 = t
        slot = self._slot(t)
        if slot < self._next_slot:              # second packet in a slot, or late
            self.dropped_same_slot += 1
            return out
        missing = slot - self._next_slot
        if missing * self.dt > self.max_gap_s:
            self.gaps += 1                      # too long to bridge honestly
            self._t0, slot, missing = t, 0, 0
            self._next_slot = 0
            self._last = None
        for k in range(self._next_slot, self._next_slot + missing):
            if self._last is not None:
                out.append(Sample(self._t0 + k * self.dt, self._last, True))
                self.filled += 1
        out.append(Sample(self._t0 + slot * self.dt, amp, False))
        self._last = amp
        self._next_slot = slot + 1
        self.emitted += len(out)
        return out

    def fill_ratio(self) -> float:
        return self.filled / self.emitted if self.emitted else 0.0


class HampelFilter:
    """Streaming per-subcarrier Hampel filter (centred window -> half-window lag).

    A sample whose distance from the window median exceeds `k` scaled MADs is
    replaced by the median. 1.4826 scales the MAD to a Gaussian sigma.
    """

    def __init__(self, window: int = 7, k: float = 5.0):
        if window % 2 == 0:
            raise ValueError("Hampel window must be odd")
        self.window = window
        self.k = k
        self._buf: deque = deque(maxlen=window)
        self._arr: Optional[np.ndarray] = None     # ring buffer of the amplitudes
        self._i = 0
        self.replaced = 0
        self.seen = 0

    def push(self, s: Sample) -> Optional[Sample]:
        # The window is odd, so the median is the middle row of a column sort —
        # identical to np.median, and ~4x cheaper at 100 calls a second.
        if self._arr is None or self._arr.shape[1] != s.amp.size:
            self._arr, self._i = np.empty((self.window, s.amp.size)), 0
            self._buf.clear()
        self._buf.append(s)
        self._arr[self._i % self.window] = s.amp
        self._i += 1
        if len(self._buf) < self.window:
            return None
        mid = self.window // 2
        med = np.sort(self._arr, axis=0)[mid]
        mad = 1.4826 * np.sort(np.abs(self._arr - med), axis=0)[mid]
        centre = self._buf[mid]
        bad = np.abs(centre.amp - med) > self.k * np.maximum(mad, 1e-9)
        self.seen += centre.amp.size
        if bad.any():
            self.replaced += int(bad.sum())
            amp = np.where(bad, med, centre.amp)
            return Sample(centre.t, amp, centre.filled)
        return centre


class RateMeter:
    """Measured packet rate (EMA over inter-arrival times)."""

    def __init__(self, alpha: float = 0.05):
        self.alpha = alpha
        self._last: Optional[float] = None
        self._ema_dt: Optional[float] = None

    def tick(self, t: float) -> None:
        if self._last is not None and t > self._last:
            dt = t - self._last
            self._ema_dt = dt if self._ema_dt is None else \
                (1 - self.alpha) * self._ema_dt + self.alpha * dt
        self._last = t

    @property
    def hz(self) -> float:
        return 1.0 / self._ema_dt if self._ema_dt else 0.0


class CsiConditioner:
    """Full chain: raw packet -> list of clean, uniformly-spaced samples."""

    def __init__(self, rate_hz: float = 100.0):
        self.rate = RateMeter()
        self.resampler = UniformResampler(rate_hz)
        self.hampel = HampelFilter()
        self.rejected = 0
        self.last_rssi: Optional[int] = None
        self.last_raw_amp: Optional[np.ndarray] = None

    def push(self, t: float, raw: bytes, rssi: Optional[int] = None,
             rx_ok: bool = True) -> list[Sample]:
        if not rx_ok:
            self.rejected += 1
            return []
        amp = amplitudes(raw)
        if amp is None:
            self.rejected += 1
            return []
        norm = normalise(amp)
        if norm is None:
            self.rejected += 1
            return []
        self.rate.tick(t)
        self.last_rssi = rssi
        self.last_raw_amp = amp
        out = []
        for s in self.resampler.push(t, norm):
            clean = self.hampel.push(s)
            if clean is not None:
                out.append(clean)
        return out
