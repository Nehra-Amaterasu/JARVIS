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
        self._design_key: Optional[tuple] = None
        self._design_AP: tuple = ()

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
    def _design(self, n: int) -> tuple[np.ndarray, np.ndarray]:
        """(A, pinv(A)) for an n-sample window and the current lines, cached.

        HBE removes the lines from the 6 coefficient series of one 300-sample window,
        and FeatureStream asks for 5 bands of that window every 0.5 s; the lines change
        at most once per estimate (0.5 s). Rebuilding A and solving one least-squares
        problem per column cost 0.56 ms a window; one cached pseudo-inverse applied to
        the whole matrix costs 0.03 ms (19x, council review 2026-10-26) and agrees with
        lstsq to ~1e-16. The cutoff is lstsq's own (eps x max(n, columns)), so a
        rank-deficient A (two lines closer than the window resolves) is cut the same way."""
        key = (n, tuple(self.lines))
        if self._design_key != key:
            t = np.arange(n) / FS
            cols = [np.ones(n)]
            for f in self.lines:
                if MIN_LINE_HZ <= f < FS / 2 - 0.5:
                    w = 2 * np.pi * f * t
                    cols += [np.cos(w), np.sin(w)]
            A = np.stack(cols, axis=1)
            P = np.linalg.pinv(A, rcond=np.finfo(float).eps * max(A.shape))
            self._design_key, self._design_AP = key, (A, P)
        return self._design_AP

    def remove_lines(self, x: np.ndarray) -> np.ndarray:
        """x (100 Hz samples: one series, or a matrix with one series per column) with
        the locked lines fitted and subtracted (the same least-squares notch as
        residual_variance, keeping the series)."""
        x = np.asarray(x, float)
        if not self.locked or not self.lines:
            return x
        A, P = self._design(x.shape[0])
        return x - A @ (P @ x)

    def residual_variance(self, x: np.ndarray) -> float:
        """Variance of x (100 Hz samples) after removing the locked lines."""
        x = np.asarray(x, float)
        if not self.locked or not self.lines:
            return float(x.var())
        n = x.size
        A, _ = self._design(n)
        coef, _, rank, _ = np.linalg.lstsq(A, x, rcond=None)
        r = x - A @ coef
        dof = max(n - rank, 1)
        return float((r @ r) / dof * (n - 1) / n)

    def summary(self) -> dict:
        return {"locked": self.locked, "f0_hz": round(self.f0, 2) if self.f0 else None,
                "lines": len(self.lines)}


# ====================================================================== fan on / off
# FanDetector: is the ceiling fan running? Decided from the CSI alone.
#
# WHY. The fan's state picks the motion baseline and the empty-room reference, and until
# 2026-10-27 it came only from a relay report or a hand-set flag: the Uno relay never
# reported (teachers' logs 10-16..10-27: fan null in 9,692 of 9,717 lines), so with the
# fan on the motion detector had no matching baseline and said "unknown" 100 % of the
# time (council hearing 2, 2026-10-26).
#
# WHAT IT LOOKS FOR. A spinning fan is the only thing in this room that holds a NARROW
# line for many seconds (FanLines' docstring). On every real recording there is one:
# 8.4-9.1 Hz in the 10-26 sessions (median prominence 20-43x its +-4 Hz surroundings),
# 15.3-15.5 Hz (with 30.6) on 10-12 and 10-27, the 5th harmonic of the 23.07 Hz the
# 10-12 notes describe, folded at 100 Hz. A person is broadband and slow; a steady
# walker's 3rd step harmonic (3 x ~2 Hz) is why lines below LINE_MIN_HZ never count.
#
# TWO INPUTS, either is evidence: (1) the mean over subcarriers of each log-amplitude's
# spectrum, (2) FanLines' comb lock on the turbulence. Without (2) the 10-26 noon
# session read "off" 2.1 % of the time (3 switches); with it, 0 %.
#
# WEAK LINES. A line only 4-8x its surroundings is half the evidence: enough to hold
# "on", never to reach it from "off". The 10-12 full-speed fan (wall switch, known on)
# showed only such lines (prominence 5-6x): with strong lines alone it read "off" 65 %
# of that session, with weak ones counted it read "on" 87 % (the rest is warm-up).
#
# MEASURED (data/notes/research/aankhen-presence-fan.md): on the 4 recordings with the
# fan known on (10,333 estimates) it read "on" 97.1 % of the time, the rest being the
# first 40-75 s before any decision; "off" 0 %, one switch per recording (unknown ->
# on). The false-on rate is NOT measured: no recording has the fan known off. Every
# recording of unknown state read "on" or "unknown", never "off".
#
# HYSTERESIS. The per-estimate evidence (1 / 0.5 / 0) is averaged with a 30 s time
# constant; "on" at >= ON_AT, "off" at <= OFF_AT. From a steady "on" (1.0) an absent fan
# reads "off" after ~57 s; a fan switched on reads "on" after ~28 s. Nothing in between
# flips it, so a minute of someone walking under the fan cannot flap the baseline.
# "unknown" until 10 s of line history and WARM_S of evidence exist (after start).
LINE_PROM = 8.0              # a strong line: >= 8x the median of the spectrum within +-4 Hz
WEAK_PROM = 4.0              # a weak one: half the evidence, enough to hold "on", never to reach it
LINE_MIN_HZ = 6.5            # above a walker's 3rd step harmonic (3 x ~2 Hz); fan lines seen: 7.7-31 Hz
PERSIST_N = 20               # estimates (10 s) a line is followed over
PERSIST_AT = 0.6             # ... and the fraction of them it must be in
BLOCK_HZ = 8.0               # the line's surroundings (+-4 Hz) for its prominence
TAU_S = 30.0
ON_AT, OFF_AT = 0.6, 0.15
WARM_S = 30.0


class FanDetector:
    """{fan: "on"|"off"|"unknown", confidence, line_hz} from the conditioned 100 Hz CSI.

    push(amp) per sample is O(subcarriers); every HOP samples one estimate costs an FFT
    of the WINDOW x subcarriers buffer, O(window x subcarriers x log): measured 62 us a
    sample amortised, 0.6 % of one core at 100 samples/s. Memory O(window x subcarriers
    + PERSIST_N x bins)."""

    def __init__(self, n_sub: int = 51):
        self.n_sub = n_sub
        self._buf = np.zeros((WINDOW, n_sub))
        self._i = 0
        self._filled = 0
        self._n = 0
        self._win = np.hanning(WINDOW)[:, None]
        self._freqs = np.fft.rfftfreq(NFFT, 1.0 / FS)
        self._band = np.nonzero(self._freqs >= LINE_MIN_HZ)[0]
        self._lo = int(np.argmax(self._freqs >= MIN_LINE_HZ))
        nb = int(round(BLOCK_HZ / (FS / NFFT)))
        self._block = max(nb, 3)
        self._hist = np.zeros((PERSIST_N, 2, self._band.size), bool)     # strong, weak
        self._hist_sum = np.zeros((2, self._band.size), int)
        self._hi = 0
        self._hist_n = 0
        self._estimates = 0
        self.score: Optional[float] = None     # the 30 s average of the evidence
        self.state = "unknown"
        self.line_hz: Optional[float] = None
        self.line_persist = 0.0
        self.last_evidence = 0.0
        self.changes = 0

    def restart(self) -> None:
        """A Wi-Fi channel change: the window and the line history are dropped (another
        channel, other multipath), the decision and its 30 s average are kept. A channel
        change does not stop the fan, and forgetting the state would hand the baseline
        back to the relay report for WARM_S."""
        state, score, changes = self.state, self.score, self.changes
        self.__init__(self.n_sub)
        self.state, self.score, self.changes = state, score, changes
        self._estimates = int(WARM_S * FS / HOP) if state != "unknown" else 0

    def push(self, amp: np.ndarray, comb_locked: bool = False) -> Optional[dict]:
        """One conditioned sample (amplitudes over their median). Returns the new
        reading every HOP samples once the window is full, else None."""
        a = np.asarray(amp, float)
        if a.shape[0] != self.n_sub:
            return None
        self._buf[self._i] = np.log(np.maximum(a, 1e-3))
        self._i = (self._i + 1) % WINDOW
        self._filled = min(self._filled + 1, WINDOW)
        self._n += 1
        if self._filled < WINDOW or self._n % HOP:
            return None
        return self._estimate(comb_locked)

    def _line(self) -> tuple[Optional[float], Optional[float], float]:
        """(evidence 1 / 0.5 / 0, the line's frequency, its persistence) for this estimate:
        1 for a STRONG line (>= LINE_PROM) held PERSIST_AT of the last PERSIST_N estimates,
        0.5 for only a WEAK one (>= WEAK_PROM), 0 for none."""
        x = np.roll(self._buf, -self._i, axis=0)
        x = x - x.mean(axis=0)
        P = (np.abs(np.fft.rfft(x * self._win, NFFT, axis=0)) ** 2).mean(axis=1)
        # prominence against a running median over +-BLOCK_HZ/2, taken from 1 Hz up so it
        # follows the slope of a moving body's spectrum (block medians did not: a walker's
        # falling 3rd harmonic stood 8x above the median of the block it started)
        h = self._block // 2
        Q = P[self._lo:]
        pad = np.concatenate([np.full(h, Q[0]), Q, np.full(h, Q[-1])])
        # every 4th bin's median, interpolated between: 8x cheaper than every bin's
        # (7 -> ~1 ms an estimate) and the baseline is smooth over 81 bins anyway
        win = np.lib.stride_tricks.sliding_window_view(pad, 2 * h + 1)[::4]
        centres = np.arange(0, Q.size, 4)
        base = np.interp(np.arange(Q.size), centres, np.partition(win, h, axis=1)[:, h])
        R = (Q / np.maximum(base, 1e-30))[self._band - self._lo]
        hit = np.stack([R >= LINE_PROM, R >= WEAK_PROM])
        near = hit.copy()                          # +-2 bins: the line wanders with speed
        for s in (1, 2):
            near[:, s:] |= hit[:, :-s]
            near[:, :-s] |= hit[:, s:]
        self._hist_sum += near.astype(int) - self._hist[self._hi]
        self._hist[self._hi] = near
        self._hi = (self._hi + 1) % PERSIST_N
        self._hist_n = min(self._hist_n + 1, PERSIST_N)
        n = self._hist_n
        if n < PERSIST_N:
            return None, None, 0.0          # not 10 s of history yet: no evidence either way
        for level, ev in ((0, 1.0), (1, 0.5)):
            held = self._hist_sum[level] >= PERSIST_AT * n
            if held.any():
                # the line's frequency: the held bin standing highest right now (the
                # widened history ties over several bins around a line)
                k = int(np.argmax(np.where(held, R, -1.0)))
                return ev, float(self._freqs[self._band[k]]), float(self._hist_sum[level, k] / n)
        return 0.0, None, float(self._hist_sum[1].max() / n)

    def _estimate(self, comb_locked: bool) -> dict:
        ev, f, persist = self._line()
        if comb_locked:
            ev = 1.0
        if ev is None:
            return self.reading()
        self._estimates += 1
        self.last_evidence, self.line_persist = ev, persist
        self.line_hz = f
        a = (HOP / FS) / TAU_S
        self.score = ev if self.score is None else (1 - a) * self.score + a * ev
        if self._estimates * HOP / FS >= WARM_S:
            new = self.state
            if self.state != "on" and self.score >= ON_AT:
                new = "on"
            elif self.state != "off" and self.score <= OFF_AT:
                new = "off"
            if new != self.state:
                self.changes += 1
                self.state = new
        return self.reading()

    @property
    def on(self) -> Optional[bool]:
        return None if self.state == "unknown" else self.state == "on"

    def reading(self) -> dict:
        s = self.score
        if self.state == "on":
            conf = min(1.0, s / ON_AT) * 0.5 + 0.5 * min(1.0, max(0.0, (s - OFF_AT) / (1 - OFF_AT)))
        elif self.state == "off":
            conf = 0.5 + 0.5 * min(1.0, max(0.0, (ON_AT - s) / ON_AT))
        else:
            conf = 0.0
        return {"fan": self.state, "confidence": round(float(conf), 3),
                "line_hz": None if self.line_hz is None else round(self.line_hz, 2),
                "evidence": None if s is None else round(s, 3)}
