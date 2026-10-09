"""Ceiling-fan lines in the Wi-Fi turbulence: find them, follow them, remove them.

WHY
  A spinning fan is a set of moving reflectors on a circle. Each blade's path length
  swings by about a metre per revolution — several wavelengths — so the CSI
  amplitudes fluctuate fast and hard. On the simulator a fan whose blades reflect
  18 dB less than a person (blade_gain 0.015) put the empty-room motion score above
  threshold 94-98 % of the time: an empty room read "moving" whenever the fan ran.

  What distinguishes the fan from a person is that it is PERIODIC: the pattern
  repeats every blade-pass (3 blades x 4 rev/s = 12 Hz). At 100 samples a second its
  harmonics alias, but they alias onto a fixed comb of lines that stays put for as
  long as the speed does. A person is broadband and never holds a line for long.

HOW
  Every 0.5 s, the spectrum of the last 2.56 s of turbulence is searched for a
  harmonic comb: a fundamental f in [2, 25] Hz whose first HARMONICS multiples,
  folded into 0-50 Hz, sit on spectral peaks at least LINE_SNR times the median
  level. A comb that explains at least MIN_HITS lines, at the same f (+-1 %) for
  LOCK_ESTIMATES estimates in a row (2.5 s), is LOCKED; it is then followed within
  +-3 % per estimate, because a fan's speed wanders (mains voltage, regulator).

  While locked, the lines to remove are the spectral peaks that persist from one
  estimate to the next (they move with the fan's speed). residual_variance() fits a
  sinusoid at each of them (plus a constant) to a window of turbulence by least
  squares and returns the variance of what is left, scaled by n / (n - parameters)
  so white noise keeps its level. That is a notch that follows the fan, with no
  filter state to ring when it moves.

  The detector never decides a line belongs to a fan from a single window; and it
  removes only the locked lines, never "whatever is periodic right now".
"""
from __future__ import annotations

from collections import deque
from typing import Optional

import numpy as np

FS = 100.0
WINDOW = 256                 # 2.56 s
NFFT = 1024
HOP = 50                     # an estimate every 0.5 s
HARMONICS = 12
LINE_SNR = 6.0               # a line: >= 6x the median spectral level (white noise: ~1.6 % of bins)
MIN_HITS = 5                 # lines a comb must explain to lock (noise explains ~0.2 by chance)
KEEP_HITS = 3                # ... and to stay locked: a weak line or two must not drop the lock
LOCK_ESTIMATES = 5
UNLOCK_MISSES = 6
F_MIN, F_MAX = 2.0, 25.0
MIN_LINE_HZ = 1.0            # never notch below this: that is where people live
MAX_LINES = 16


def fold(f: np.ndarray) -> np.ndarray:
    """Alias a frequency onto 0..FS/2 as sampling at FS sees it."""
    r = np.mod(f, FS)
    return np.where(r > FS / 2, FS - r, r)


class FanLines:
    def __init__(self):
        self._buf: deque = deque(maxlen=WINDOW)
        self._n = 0
        self._win = np.hanning(WINDOW)
        self._freqs = np.fft.rfftfreq(NFFT, 1.0 / FS)
        self._cand = np.arange(F_MIN, F_MAX, 0.02)
        k = np.arange(1, HARMONICS + 1)
        self._cand_bins = np.rint(fold(np.outer(self._cand, k)) / (FS / NFFT)).astype(int)
        self._run = 0                         # consecutive matching estimates
        self._miss = 0
        self._last_f: Optional[float] = None
        self._last_lines: set = set()
        self._last_peaks: list[float] = []
        self.locked = False
        self.f0: Optional[float] = None
        self.lines: list[float] = []          # locked line frequencies (Hz, folded)
        self.hits = 0
        self.estimates = 0

    def push(self, turb: float) -> None:
        self._buf.append(turb)
        self._n += 1
        if len(self._buf) == WINDOW and self._n % HOP == 0:
            self._estimate()

    # ------------------------------------------------------------ estimation
    def _spectrum(self) -> tuple[np.ndarray, float]:
        x = np.fromiter(self._buf, float)
        P = np.abs(np.fft.rfft((x - x.mean()) * self._win, NFFT)) ** 2
        floor = float(np.median(P[self._freqs >= MIN_LINE_HZ]))
        return P, max(floor, 1e-30)

    def _persistent_peaks(self, P: np.ndarray, floor: float) -> list[float]:
        """The lines to remove: spectral peaks at least LINE_SNR / 2 above the
        median level, refined to a fraction of a bin, that were also there (within
        0.25 Hz) half a second ago — at most MAX_LINES of the strongest.

        The comb only decides THAT a fan is running. Taking the lines from its
        fundamental failed twice: notching only the harmonics that cleared LINE_SNR
        left the empty-room residual at 1.2-1.4x the no-fan level, and predicting all
        of them from f0 put the 4th harmonic 0.8 Hz off whenever f0 was 0.2 Hz off —
        aliasing makes neighbouring fundamentals explain the same folded lines."""
        k = np.arange(2, P.size - 1)
        peak = (P[k] > P[k - 1]) & (P[k] >= P[k + 1]) & (P[k] >= 0.5 * LINE_SNR * floor)             & (self._freqs[k] >= MIN_LINE_HZ)
        idx = k[peak][np.argsort(P[k[peak]])[::-1][:MAX_LINES]]
        now = sorted(self._line_at(P, float(self._freqs[i])) for i in idx)
        keep = [f for f in now if any(abs(f - g) <= 0.25 for g in self._last_peaks)]
        self._last_peaks = now
        return [round(f, 3) for f in keep]

    def _line_at(self, P: np.ndarray, f: float) -> float:
        """Parabolic peak of P within +-1 bin of f."""
        df = FS / NFFT
        b = int(round(f / df))
        lo, hi = max(b - 1, 1), min(b + 2, P.size - 1)
        k = lo + int(np.argmax(P[lo:hi]))
        a, c, d = np.log(P[k - 1] + 1e-30), np.log(P[k] + 1e-30), np.log(P[k + 1] + 1e-30)
        den = a - 2 * c + d
        off = 0.5 * (a - d) / den if abs(den) > 1e-12 else 0.0
        return float((k + max(-0.5, min(0.5, off))) * df)

    def _estimate(self) -> None:
        self.estimates += 1
        P, floor = self._spectrum()
        # Local peak power around each candidate harmonic (+-2 bins absorbs the
        # zero-padding and a little speed change within the window).
        Pmax = np.maximum.reduce([np.roll(P, s) for s in (-2, -1, 0, 1, 2)])
        snr = Pmax[np.clip(self._cand_bins, 0, P.size - 1)] / floor
        ok = (snr >= LINE_SNR) & (fold(np.outer(self._cand, np.arange(1, HARMONICS + 1))) >= MIN_LINE_HZ)
        hits = ok.sum(axis=1)
        if self.locked and self.f0 is not None:
            near = np.abs(self._cand - self.f0) <= 0.03 * self.f0
            hits = np.where(near, hits, 0)
        best = int(np.argmax(hits + 1e-3 * np.log(snr + 1).sum(axis=1)))
        f, n = float(self._cand[best]), int(hits[best])
        self.hits = n
        if n >= (KEEP_HITS if self.locked else MIN_HITS):
            # "The same comb as last time" is judged on the LINES, not on f: a comb
            # and its second harmonic explain the same lines, and the search can
            # flip between them (a 2.5 rev/s fan locked only 23 % of the time).
            lines_now = set(np.rint(fold(np.arange(1, HARMONICS + 1)[ok[best]] * f) * 2).astype(int))
            same = bool(self._last_lines) and                 len(lines_now & self._last_lines) >= 0.6 * min(len(lines_now), len(self._last_lines))
            self._run = self._run + 1 if (same or self.locked) else 1
            self._last_f, self._last_lines = f, lines_now
            self._miss = 0
            if self._run >= LOCK_ESTIMATES:
                self.locked = True
            if self.locked:
                self.f0 = f if self.f0 is None else 0.7 * self.f0 + 0.3 * f
                self.lines = self._persistent_peaks(P, floor)
        else:
            self._miss += 1
            self._run = 0
            self._last_f, self._last_lines = None, set()
            if self._miss >= UNLOCK_MISSES:
                self.locked, self.f0, self.lines = False, None, []

    # ------------------------------------------------------------ cancellation
    def residual_variance(self, x: np.ndarray) -> float:
        """Variance of x (100 Hz samples) after removing the locked lines."""
        x = np.asarray(x, float)
        if not self.locked or not self.lines:
            return float(x.var())
        n = x.size
        t = np.arange(n) / FS
        cols = [np.ones(n)]
        for f in self.lines:
            if MIN_LINE_HZ <= f < FS / 2 - 0.5:
                w = 2 * np.pi * f * t
                cols += [np.cos(w), np.sin(w)]
        A = np.stack(cols, axis=1)
        coef, _, rank, _ = np.linalg.lstsq(A, x, rcond=None)
        r = x - A @ coef
        dof = max(n - rank, 1)
        return float((r @ r) / dof * (n - 1) / n)

    def summary(self) -> dict:
        return {"locked": self.locked, "f0_hz": round(self.f0, 2) if self.f0 else None,
                "lines": len(self.lines)}
