"""World model: a small network that predicts the Wi-Fi change picture; its surprise and its
summary of the last 3 s.

THE IDEA (the owner's)
  A language model learns language by predicting the next word, with no labels. The same
  trick on the channel: watch the CHANGE PICTURE (51 subcarriers x time, each pixel how far
  that subcarrier is from where it has been lately, in units of its own noise) and predict
  the next 0.5 s from the last 3 s. It can learn from every hour the board streams.
    SURPRISE   the prediction error. A ceiling fan is periodic, so it can be learned and
               predicted; a person is not, so the error should flag people, not fans.
    EMBEDDING  the network's 16-number summary of the last 3 s, as extra features for the
               zone and activity models (learn.py).
  Research does this at scale (AM-FM, arXiv 2602.11200: 9.2 M unlabelled CSI samples,
  masked reconstruction + contrastive + autocorrelation objectives; WiFo and LatentWave:
  masked / latent prediction). Here the data is minutes, not millions: worldeval.py
  measures what that buys against the hand-made detector, and says so plainly.

THE PICTURE (change_picture), from the SAME conditioning as the product (csi.CsiConditioner)
  1. Gaps the resampler forward-filled are bridged with a line between the measured samples
     on each side: a held sample is a rectangular pulse, which motion.py found looks like a
     3 cm movement (_bridge_gaps).
  2. 100 Hz -> 20 Hz through an 8th-order Butterworth low-pass at 6 Hz, causal. People move
     the channel at 0.4-4 Hz (motion.HBE_BAND_HZ), so 20 Hz keeps all of it and cuts compute
     and storage five-fold (51 x 20 Hz x 86 400 s x 2 B = 176 MB a day in float16). The
     filter is not optional: the fan's 23.07 Hz blade-pass would fold to 3.07 Hz at 20 Hz,
     into the middle of the human band; the filter takes it down 107 dB (16 Hz, which would
     fold to 4 Hz: 73 dB; 4 Hz passes untouched, 6 Hz at -3 dB).
  3. Each subcarrier minus a slow baseline (EMA, 3 s), over its noise. Slow next to the
     human band (periods 0.25-2.5 s; the 3 s EMA passes breathing at 0.2 Hz at 97 %), but
     not 10 s like eyes.py: after a posture change the static channel jumps by ~20x the
     noise, and a 10 s baseline held that offset for ~20 s, pinned at the clip, hiding
     every fluctuation on top of it. On the sessions not scored, 3 s instead of 10 s cut
     the clipped pixels from 3.2-11.2 % to 1.8-7.9 %.
  4. The noise is the EMA (30 s) of |first difference| of MEASURED 100 Hz samples, each
     difference capped at 3x the current scale. A body moves the channel by a fraction of
     the noise per 10 ms (HBE's premise), so differences mostly measure the receiver. Slow
     and capped because eyes.py found a 5 s scale normalised typing away (1.4x the still
     energy instead of 4.3x). The 100 Hz noise is carried to 20 Hz by the filter's white-
     noise gain, so pure receiver noise reads ~1 in the picture, as HBE reads ~1.
  5. Clipped to +-10: a wave is tens of times the noise and must not own the training loss.
  Optional PHASE channels (phase_residuals): the same picture built from each packet's
  phase with the clocks' line removed, circularly (angles wrap).

THE MODELS (CPU only: the GPU belongs to the local LLM and Whisper)
  shared  (selected) one small causal network applied to every subcarrier with the same
          weights: its own last 3 s plus the mean and RMS of all subcarriers -> its next
          0.5 s, on top of the linear autoregression below. 5.9k parameters (6.1k with
          phase); embedding = its last hidden state averaged over subcarriers (16 numbers
          per channel kind).
  causal  dilated causal convolutions over all 51 channels at once (receptive field 63
          frames = 3.15 s) -> a 16-number bottleneck -> the next 10 frames, plus the
          linear autoregression. 32k parameters.
  masked  the same convolutions, two-sided, reconstructing hidden time and subcarrier
          blocks (half the time the last 0.5 s, i.e. the causal task); embedding = the mean
          of its hidden state over the window, reduced to 16 by PCA. 26k parameters.
  linear  a shared per-subcarrier autoregression (1 s of taps -> 0.5 s), fitted in closed
          form: 200 coefficients, the baseline any network has to beat.
  WHY "shared" (selection on data no model trained on, worldeval.py): every network tied
  or lost to the 200-coefficient linear predictor at predicting the next 0.5 s (held-out
  minutes, picture units^2: linear 4.98, shared 4.99, causal 5.00, causal without the
  linear path 5.41, masked 5.81), so prediction alone cannot pick one; the masked model is
  out because surprise IS forward-prediction error and it is 17 % worse at it. Between
  the two ties, the shared embedding transferred best across the three held-out first-
  light sessions (activity, leave one session out: 0.38 against 0.24 for the joint
  model's bottleneck and 0.21 for learn.FEATURES; chance 0.25). Sharing weights gives
  51x the training series for the same data, which is what minutes of data can support;
  the joint model has to squeeze 51 subcarriers' futures through 16 numbers. Hidden 32
  (not 64): on this laptop, sharing the CPU with the app, a 64-wide step took ~0.3 s, and
  64 did not predict better either (5.16 against linear 5.15 on the first trial).
"""
from __future__ import annotations

import json
import math
import os
import time
from dataclasses import dataclass, field
from typing import Callable, Optional

import numpy as np

from .csi import LLTF_BINS, LLTF_KEEP, CsiConditioner, HampelFilter, UniformResampler, bin_of
from .learn import MODEL_DIR

RATE_HZ = 100.0                    # the conditioned stream (csi.UniformResampler)
DECIM = 5
FRAME_HZ = RATE_HZ / DECIM         # 20 Hz pictures
CONTEXT = 60                       # 3 s of past ...
HORIZON = 10                       # ... predict the next 0.5 s
WINDOW = CONTEXT + HORIZON
N_SUB = len(LLTF_KEEP)             # 51
LOWPASS_HZ, LOWPASS_ORDER = 6.0, 8
BASELINE_TAU_S = 3.0
NOISE_TAU_S = 30.0
NOISE_CLAMP = 3.0
MEAN_ABS_DIFF = 2.0 / math.sqrt(math.pi)    # E|x1 - x2| = 1.128 sigma for Gaussian noise
MIN_DIFFS = 50                     # differences before the noise scale is trusted (and capped)
CLIP_Z = 10.0
WARMUP_S = 5.0                     # baseline and noise settle; frames before are not used
SETTLE_FRAMES = 20                 # 1 s for the low-pass after every gap in the stream
AR_TAPS = 20                       # the linear predictor looks back 1 s
MODEL_FILE = os.path.join(MODEL_DIR, "worldmodel.pt")


# ======================================================================= phase
_S = np.array(LLTF_KEEP, dtype=float)
_SC = _S - _S.mean()
_SC2 = float(_SC @ _SC)
_KEEP = np.array([bin_of(s) for s in LLTF_KEEP])
_UNIT = np.diff(_S) == 1                    # neighbour pairs one spacing apart (not the DC gap)


def phase_residuals(raws: list) -> np.ndarray:
    """Phase of the 51 subcarriers minus its least-squares line in the subcarrier number s,
    one row per packet (radians); NaN rows for short or all-zero buffers.

    The ESP32 and the router run on separate clocks, so every packet's phase carries a
    random rotation (carrier offset) and a random slope in s (packet-detection delay). Both
    are a straight line in s, so: unwrap across subcarriers in frequency order, fit
    a*s + b, subtract. Unwrapping only works if neighbours differ by less than pi, and a
    steep delay slope breaks that, so each packet is first de-rotated by its average step
    per subcarrier (the angle of sum H[k+1] conj(H[k]) over neighbours one spacing apart,
    which weights strong subcarriers by construction). That rotation is itself a line in
    s, so the fit removes it again. What is left is the multipath-shaped bend of the phase
    across the band, which a moving body changes and the clocks cannot imitate. (It also
    removes the true time of flight: two unsynchronised radios cannot keep it.)

    Same byte layout as csi.amplitudes(): int8 pairs, imaginary first, then real; buffer
    index k is subcarrier k (k < 32) or k - 64. Self-contained on purpose: eyes.py carries
    the same sanitisation, and the two are to be merged.
    """
    w = LLTF_BINS * 2
    out = np.full((len(raws), N_SUB), np.nan)
    ok = np.array([len(r) >= w for r in raws], bool)
    if not ok.any():
        return out
    iq = np.frombuffer(b"".join(r[:w] for r, k in zip(raws, ok) if k), dtype=np.int8)
    iq = iq.reshape(-1, w).astype(np.float64)
    H = iq[:, 2 * _KEEP + 1] + 1j * iq[:, 2 * _KEEP]          # real + j imag
    live = np.abs(H).sum(axis=1) > 0
    step = np.angle((H[:, 1:] * np.conj(H[:, :-1]))[:, _UNIT].sum(axis=1))
    ph = np.unwrap(np.angle(H * np.exp(-1j * np.outer(step, _S))), axis=1)
    ph -= ph.mean(axis=1, keepdims=True)
    ph -= np.outer(ph @ _SC / _SC2, _SC)
    ph[~live] = np.nan
    out[ok] = ph
    return out


# ======================================================================= replay
@dataclass
class Stream:
    """A recording replayed through the product's conditioning (csi.CsiConditioner)."""
    path: str
    t: np.ndarray                       # (N,) device seconds of each 100 Hz sample
    amp: np.ndarray                     # (N, 51) normalised amplitudes, float32
    filled: np.ndarray                  # (N,) forward-filled by the resampler
    rssi: np.ndarray                    # (N,) RSSI of the packet that released the sample
    level: Optional[np.ndarray] = None  # (N,) Sample.level_db (NaN when None), for learn.py's features
    phase: Optional[np.ndarray] = None  # (N, 51) phase residual (radians), float32
    host_offset: float = 0.0            # median(device - host clock), seconds
    host0: float = 0.0                  # host time of the first chunk
    packets: int = 0

    @property
    def seconds(self) -> float:
        return float(len(self.t) / RATE_HZ)


def _read_packets(path: str) -> tuple[list, np.ndarray, float]:
    """CSI packets of an .akr with the host time their chunk arrived."""
    from .protocol import CsiPacket, StreamDecoder, decode_packet
    from .transport import iter_recording
    dec, pk, host = StreamDecoder(), [], []
    h0, t_host = None, 0.0

    def take(frames, t):
        for fr in frames:
            try:
                p = decode_packet(fr)
            except ValueError:                  # a malformed CSI payload: skipped, as live
                continue
            if isinstance(p, CsiPacket):
                pk.append(p)
                host.append(t)

    for t_host, data in iter_recording(path):
        h0 = t_host if h0 is None else h0
        take(dec.feed(data), t_host)
    take(dec.flush(), t_host)
    return pk, np.asarray(host, float), (h0 or 0.0)


def replay(path: str, phase: bool = False) -> Stream:
    """Replay an .akr through CsiConditioner (amplitudes, exactly as the engine sees them)
    and, with phase=True, the same resampler and Hampel filter on each packet's phase
    residual, so the phase samples land on the same 100 Hz slots as the amplitudes.

    Phases are averaged within a slot as unit phasors (an angle average breaks at +-pi)."""
    pk, host, h0 = _read_packets(path)
    cond = CsiConditioner()
    res = phase_residuals([p.raw for p in pk]) if phase else None
    p_res, p_ham = UniformResampler(RATE_HZ), HampelFilter()
    T, A, F, R, L, P = [], [], [], [], [], []
    for i, p in enumerate(pk):
        t = p.timestamp_us / 1e6
        before = cond.rejected
        for s in cond.push(t, p.raw, p.rssi, gain_comp_db=p.gain_comp_db):
            T.append(s.t), A.append(s.amp), F.append(s.filled), R.append(p.rssi)
            L.append(np.nan if s.level_db is None else s.level_db)
        if res is None or cond.rejected != before:
            continue
        r = np.nan_to_num(res[i])
        for s in p_res.push(t, np.concatenate([np.cos(r), np.sin(r)])):
            c = p_ham.push(s)
            if c is not None:
                P.append(np.arctan2(c.amp[N_SUB:], c.amp[:N_SUB]))
    st = Stream(path, np.asarray(T, float), np.asarray(A, np.float32).reshape(-1, N_SUB),
                np.asarray(F, bool), np.asarray(R, float), np.asarray(L, float), packets=len(pk), host0=h0,
                host_offset=float(np.median([p.timestamp_us / 1e6 for p in pk] - host)) if pk else 0.0)
    if res is not None:
        if len(P) != len(T):                    # same slots in, same samples out
            raise RuntimeError(f"phase and amplitude streams diverged ({len(P)} vs {len(T)})")
        st.phase = np.asarray(P, np.float32).reshape(-1, N_SUB)
    return st


# ======================================================================= picture
@dataclass
class Picture:
    """The change picture at 20 Hz: z[k] is frame k, valid[k] whether it may be used,
    seg[k] which unbroken stretch of the stream it belongs to (a window never spans two)."""
    t: np.ndarray                       # (M,) device time of each frame's last sample
    z: np.ndarray                       # (M, C) float32: 51 amplitude [+ 51 phase] channels
    valid: np.ndarray                   # (M,)
    seg: np.ndarray                     # (M,)
    sample: np.ndarray                  # (M,) index into the Stream of each frame's last sample
    phase: bool = False
    source: str = ""

    @property
    def channels(self) -> int:
        return int(self.z.shape[1])


def _lowpass():
    from scipy.signal import butter, sosfilt
    sos = butter(LOWPASS_ORDER, LOWPASS_HZ, fs=RATE_HZ, output="sos")
    imp = np.zeros(4000)
    imp[0] = 1.0
    gain = float(np.sqrt((sosfilt(sos, imp) ** 2).sum()))
    return sos, gain


_SOS, _GAIN = _lowpass()


def _segments(t: np.ndarray) -> list[tuple[int, int]]:
    """Unbroken stretches: the resampler restarts its grid after a gap > 0.25 s."""
    if len(t) == 0:
        return []
    cut = np.flatnonzero(np.abs(np.diff(t) - 1.0 / RATE_HZ) > 0.25 / RATE_HZ) + 1
    edges = np.concatenate(([0], cut, [len(t)]))
    return [(int(a), int(b)) for a, b in zip(edges[:-1], edges[1:]) if b - a >= DECIM * WINDOW // 2]


def _bridge(x: np.ndarray, real: np.ndarray) -> np.ndarray:
    """Forward-filled runs replaced by a straight line between the measured samples on each
    side (np.interp per channel); runs at the edges keep the nearest measured sample."""
    if real.all() or not real.any():
        return x
    idx = np.arange(len(x))
    good = np.flatnonzero(real)
    out = x.copy()
    for c in range(x.shape[1]):
        out[~real, c] = np.interp(idx[~real], good, x[good, c])
    return out


def _filter_decimate(x: np.ndarray) -> np.ndarray:
    """Causal low-pass, started at the first sample's value (no switch-on transient from
    zero), then every DECIM-th sample: frame k ends at sample DECIM*k + DECIM - 1."""
    from scipy.signal import sosfilt, sosfilt_zi
    zi = sosfilt_zi(_SOS)[:, :, None] * x[0][None, None, :]
    y, _ = sosfilt(_SOS, x, axis=0, zi=zi)
    return y[DECIM - 1::DECIM]


class _Normaliser:
    """Slow baseline and capped noise scale per channel (see the module docstring), carried
    across gaps in the stream: the room does not change in a quarter of a second."""

    def __init__(self, n: int, circular: bool, tau_s: float = None):
        self.circular = circular
        self.tau_s = BASELINE_TAU_S if tau_s is None else tau_s
        self.base = np.zeros(n, complex if circular else float)
        self.noise = np.zeros(n)
        self.frames = 0
        self.diffs = 0

    def _diff_update(self, d: np.ndarray) -> None:
        """d: |first differences| of measured 100 Hz samples in this frame (rows)."""
        if not len(d):
            return
        if self.diffs >= MIN_DIFFS:
            d = np.minimum(d, NOISE_CLAMP * self.noise)
        m = len(d)
        b = max(m / (self.diffs + m), 1.0 - (1.0 - 1.0 / (RATE_HZ * NOISE_TAU_S)) ** m)
        self.noise += b * (d.mean(axis=0) - self.noise)
        self.diffs += m

    def push(self, y: np.ndarray, d: np.ndarray) -> np.ndarray:
        """One 20 Hz frame y (and its measured differences d) -> its deviation over noise."""
        self._diff_update(d)
        self.frames += 1
        a = max(1.0 / self.frames, 1.0 - math.exp(-1.0 / (FRAME_HZ * self.tau_s)))
        if self.circular:
            u = np.exp(1j * y)
            dev = np.angle(u * np.conj(self.base / np.maximum(np.abs(self.base), 1e-12))) \
                if self.frames > 1 else np.zeros(len(y))
            self.base += a * (u - self.base)
        else:
            dev = y - self.base if self.frames > 1 else np.zeros(len(y))
            self.base += a * (y - self.base)
        sigma = np.maximum(self.noise / MEAN_ABS_DIFF * _GAIN, 1e-6)
        return dev / sigma


def _frame_diffs(x: np.ndarray, real: np.ndarray, circular: bool) -> list[np.ndarray]:
    """|first differences| between consecutive measured samples, grouped by the frame whose
    span (DECIM samples) contains the later sample."""
    d = np.diff(x, axis=0)
    if circular:
        d = (d + np.pi) % (2 * np.pi) - np.pi
    d = np.abs(d)
    pair = real[1:] & real[:-1]
    out = []
    for k in range(len(x) // DECIM):          # sample i (i >= 1) belongs to frame i // DECIM
        lo, hi = max(DECIM * k - 1, 0), DECIM * k + DECIM - 1
        out.append(d[lo:hi][pair[lo:hi]])
    return out


def change_picture(st: Stream, phase: bool = False, tau_s: Optional[float] = None) -> Picture:
    """The stream as a 20 Hz change picture (module docstring, THE PICTURE). Causal except
    for the gap bridge, which looks at most 0.25 s ahead (a longer gap breaks the stream)."""
    if phase and st.phase is None:
        raise ValueError("this stream was replayed without phase (replay(path, phase=True))")
    amp_n, ph_n = _Normaliser(N_SUB, False, tau_s), _Normaliser(N_SUB, True, tau_s)
    Ts, Zs, Vs, Ss, Ks = [], [], [], [], []
    t_start = st.t[0] if len(st.t) else 0.0
    for si, (a, b) in enumerate(_segments(st.t)):
        real = ~st.filled[a:b]
        x = _bridge(st.amp[a:b].astype(float), real)
        y = _filter_decimate(x)
        dd = _frame_diffs(x, real, False)
        chans = [(y, dd, amp_n)]
        if phase:
            u = _bridge(np.concatenate([np.cos(st.phase[a:b]), np.sin(st.phase[a:b])], axis=1), real)
            yu = _filter_decimate(u)
            chans.append((np.arctan2(yu[:, N_SUB:], yu[:, :N_SUB]), _frame_diffs(st.phase[a:b].astype(float), real, True), ph_n))
        m = len(y)
        z = np.zeros((m, N_SUB * len(chans)), np.float32)
        trusted = np.zeros(m, bool)
        for k in range(m):
            z[k] = np.concatenate([n.push(yy[k], dk[k]) for yy, dk, n in chans])
            trusted[k] = amp_n.diffs >= MIN_DIFFS
        last = a + DECIM * np.arange(m) + DECIM - 1
        Ts.append(st.t[last]), Zs.append(np.clip(z, -CLIP_Z, CLIP_Z)), Ks.append(last)
        Ss.append(np.full(m, si))
        Vs.append((np.arange(m) >= SETTLE_FRAMES) & (st.t[last] - t_start >= WARMUP_S) & trusted)
    if not Ts:
        return Picture(np.zeros(0), np.zeros((0, N_SUB * (2 if phase else 1)), np.float32),
                       np.zeros(0, bool), np.zeros(0, int), np.zeros(0, int), phase, st.path)
    return Picture(np.concatenate(Ts), np.concatenate(Zs), np.concatenate(Vs), np.concatenate(Ss),
                   np.concatenate(Ks), phase, st.path)


def window_ends(pic: Picture, length: int = WINDOW) -> np.ndarray:
    """Frames f whose window [f - length + 1, f] is valid and unbroken."""
    ok = pic.valid.astype(int)
    run = np.zeros(len(ok), int)
    for k in range(len(ok)):
        same = k > 0 and pic.seg[k] == pic.seg[k - 1]
        run[k] = (run[k - 1] + 1 if same else 1) if ok[k] else 0
    return np.flatnonzero(run >= length)


# ======================================================================= models
import torch                                            # noqa: E402  (CPU only, see below)
from torch import nn                                    # noqa: E402
from torch.nn import functional as F                    # noqa: E402

DILATIONS = (1, 2, 4, 8, 16)       # kernel 3: receptive field 1 + 2 * 31 = 63 frames (3.15 s)
EMB_DIMS = 16
HIDDEN = 32


class _ChanNorm(nn.Module):
    """LayerNorm over channels at each time step: normalising over time would let the
    future leak into a causal model."""

    def __init__(self, ch: int):
        super().__init__()
        self.ln = nn.LayerNorm(ch)

    def forward(self, h: torch.Tensor) -> torch.Tensor:
        return self.ln(h.transpose(1, 2)).transpose(1, 2)


class _Block(nn.Module):
    """Pre-norm residual block: dilated convolution (kernel 3) then a pointwise mix.
    causal=True pads only the past, so frame t never sees t + 1."""

    def __init__(self, ch: int, dilation: int, causal: bool, dropout: float):
        super().__init__()
        self.pad = (2 * dilation, 0) if causal else (dilation, dilation)
        self.norm = _ChanNorm(ch)
        self.conv = nn.Conv1d(ch, ch, 3, dilation=dilation)
        self.mix = nn.Conv1d(ch, ch, 1)
        self.drop = nn.Dropout(dropout)

    def forward(self, h: torch.Tensor) -> torch.Tensor:
        y = F.gelu(self.conv(F.pad(self.norm(h), self.pad)))
        return h + self.drop(self.mix(y))


class _Encoder(nn.Module):
    def __init__(self, n_in: int, hidden: int, causal: bool, dropout: float):
        super().__init__()
        self.inp = nn.Conv1d(n_in, hidden, 1)
        self.blocks = nn.ModuleList([_Block(hidden, d, causal, dropout) for d in DILATIONS])
        self.norm = _ChanNorm(hidden)

    def forward(self, x: torch.Tensor) -> torch.Tensor:          # (B, C, T) -> (B, H, T)
        h = self.inp(x)
        for b in self.blocks:
            h = b(h)
        return self.norm(h)


def _ar_apply(x: torch.Tensor, ar: torch.Tensor) -> torch.Tensor:
    """Shared linear autoregression: each channel's next HORIZON frames from its own last
    AR_TAPS, one coefficient set per channel type (amplitude, phase). x (B, C, >= AR_TAPS),
    ar (types, AR_TAPS, HORIZON) -> (B, C, HORIZON)."""
    types = ar.shape[0]
    xs = x[:, :, -AR_TAPS:].reshape(x.shape[0], types, -1, AR_TAPS)
    return torch.einsum("bkcp,kph->bkch", xs, ar).reshape(x.shape[0], -1, HORIZON)


class CausalPredictor(nn.Module):
    """The last CONTEXT frames -> the next HORIZON frames: linear autoregression plus what
    the network adds through a 16-number bottleneck (the embedding)."""

    def __init__(self, n_ch: int, hidden: int = HIDDEN, emb: int = EMB_DIMS, dropout: float = 0.1,
                 linear_path: bool = True):
        super().__init__()
        self.n_ch = n_ch
        self.linear_path = linear_path
        self.enc = _Encoder(n_ch, hidden, True, dropout)
        self.bottleneck = nn.Linear(hidden, emb)
        self.head = nn.Sequential(nn.GELU(), nn.Linear(emb, HORIZON * n_ch))
        self.ar = nn.Parameter(torch.zeros(n_ch // N_SUB, AR_TAPS, HORIZON), requires_grad=linear_path)

    def embed(self, x: torch.Tensor) -> torch.Tensor:              # (B, C, T) -> (B, emb)
        return self.bottleneck(self.enc(x)[:, :, -1])

    def forward(self, x: torch.Tensor) -> torch.Tensor:            # (B, C, CONTEXT) -> (B, C, HORIZON)
        y = self.head(self.embed(x)).view(-1, self.n_ch, HORIZON)
        return y + _ar_apply(x, self.ar) if self.linear_path else y


class SharedPredictor(nn.Module):
    """The causal task one subcarrier at a time, with the SAME weights for all of them: each
    subcarrier's next HORIZON frames from its own last CONTEXT frames, plus two numbers per
    frame that all subcarriers of its kind share (their mean and RMS), plus the shared
    linear autoregression. The nonlinear version of that linear predictor, with 51x the
    training series; the usual remedy when a time-series dataset is minutes long. Its
    embedding: the hidden state at the last frame, averaged over the subcarriers of each
    kind (hidden numbers per kind)."""

    def __init__(self, n_ch: int, hidden: int = 16, dropout: float = 0.1):
        super().__init__()
        self.n_ch, self.types = n_ch, n_ch // N_SUB
        self.linear_path = True
        self.enc = _Encoder(3 + self.types, hidden, True, dropout)
        self.head = nn.Linear(hidden, HORIZON)
        self.ar = nn.Parameter(torch.zeros(self.types, AR_TAPS, HORIZON))

    def _series(self, x: torch.Tensor) -> torch.Tensor:           # (B, C, T) -> (B*C, 3 + types, T)
        b, _, t = x.shape
        xt = x.reshape(b, self.types, N_SUB, 1, t)
        mean = xt.mean(2, keepdim=True).expand(-1, -1, N_SUB, -1, -1)
        rms = xt.pow(2).mean(2, keepdim=True).add(1e-6).sqrt().expand(-1, -1, N_SUB, -1, -1)
        kind = torch.eye(self.types).view(1, self.types, 1, self.types, 1).expand(b, -1, N_SUB, -1, t)
        return torch.cat([xt, mean, rms, kind], 3).reshape(b * self.n_ch, 3 + self.types, t)

    def _last(self, x: torch.Tensor) -> torch.Tensor:              # (B, C, T) -> (B, types, N_SUB, hidden)
        h = self.enc(self._series(x))[:, :, -1]
        return h.reshape(x.shape[0], self.types, N_SUB, -1)

    def embed(self, x: torch.Tensor) -> torch.Tensor:              # (B, C, T) -> (B, types * hidden)
        return self._last(x).mean(2).reshape(x.shape[0], -1)

    def forward(self, x: torch.Tensor) -> torch.Tensor:            # (B, C, CONTEXT) -> (B, C, HORIZON)
        return self.head(self._last(x)).reshape(x.shape[0], self.n_ch, HORIZON) + _ar_apply(x, self.ar)


class MaskedModel(nn.Module):
    """Reconstruct hidden pixels of a WINDOW-frame picture from the rest. Input: the picture
    with hidden pixels zeroed, and the mask itself (1 = hidden), so a zero means nothing."""

    def __init__(self, n_ch: int, hidden: int = HIDDEN, dropout: float = 0.1):
        super().__init__()
        self.n_ch = n_ch
        self.enc = _Encoder(2 * n_ch, hidden, False, dropout)
        self.out = nn.Conv1d(hidden, n_ch, 1)

    def forward(self, x: torch.Tensor, m: torch.Tensor) -> torch.Tensor:
        return self.out(self.enc(torch.cat([x * (1 - m), m], 1)))

    def pooled(self, x: torch.Tensor) -> torch.Tensor:             # (B, C, T) -> (B, hidden)
        return self.enc(torch.cat([x, torch.zeros_like(x)], 1)).mean(-1)


KINDS = ("causal", "shared", "masked")


def _make_net(kind: str, n_ch: int, hidden: int, linear_path: bool = True) -> nn.Module:
    if kind == "causal":
        return CausalPredictor(n_ch, hidden, linear_path=linear_path)
    if kind == "shared":
        return SharedPredictor(n_ch, hidden)
    return MaskedModel(n_ch, hidden)


def forward_mask(n: int, n_ch: int) -> torch.Tensor:
    """The causal task as a mask: the last HORIZON frames of every channel hidden."""
    m = torch.zeros(n, n_ch, WINDOW)
    m[:, :, -HORIZON:] = 1.0
    return m


def random_masks(n: int, n_ch: int, rng: np.random.Generator) -> torch.Tensor:
    """Training masks: half the windows hide the last 0.5 s (the causal task, so the
    masked model answers the same question it is judged on); the rest hide 1-3 time
    blocks of 0.2-0.6 s and, half the time, a block of 6-16 subcarriers over the whole
    window (the same subcarriers in amplitude and phase): ~15-45 % of the pixels."""
    m = np.zeros((n, N_SUB, WINDOW), np.float32)
    for i in range(n):
        if rng.random() < 0.5:
            m[i, :, -HORIZON:] = 1.0
            continue
        for _ in range(int(rng.integers(1, 4))):
            w = int(rng.integers(4, 13))
            s = int(rng.integers(0, WINDOW - w + 1))
            m[i, :, s:s + w] = 1.0
        if rng.random() < 0.5:
            w = int(rng.integers(6, 17))
            s = int(rng.integers(0, N_SUB - w + 1))
            m[i, s:s + w, :] = 1.0
    return torch.from_numpy(np.tile(m, (1, n_ch // N_SUB, 1)))


def fit_linear(Z: np.ndarray, ends: np.ndarray, types: int, ridge: float = 1.0) -> np.ndarray:
    """Closed-form ridge fit of the shared autoregression (types, AR_TAPS, HORIZON): the
    classical world model, and the starting point of the network's linear path."""
    out = np.zeros((types, AR_TAPS, HORIZON))
    lag = np.arange(-HORIZON - AR_TAPS + 1, -HORIZON + 1)
    ahead = np.arange(-HORIZON + 1, 1)
    for k in range(types):
        cols = slice(k * N_SUB, (k + 1) * N_SUB)
        X = Z[ends[:, None] + lag[None, :], cols].transpose(0, 2, 1).reshape(-1, AR_TAPS).astype(float)
        Y = Z[ends[:, None] + ahead[None, :], cols].transpose(0, 2, 1).reshape(-1, HORIZON).astype(float)
        out[k] = np.linalg.solve(X.T @ X + ridge * np.eye(AR_TAPS), X.T @ Y)
    return out


# ======================================================================= the model, saved
@dataclass
class WorldModel:
    """A trained network plus what it needs to be used: its kind ("causal" / "masked"),
    the channels it reads, the closed-form linear predictor fitted on the same frames, the
    masked model's PCA, and a record of what it was trained on (meta)."""
    kind: str
    phase: bool
    net: nn.Module
    linear: np.ndarray                                  # (types, AR_TAPS, HORIZON)
    pca_mean: Optional[np.ndarray] = None
    pca_comp: Optional[np.ndarray] = None
    meta: dict = field(default_factory=dict)

    @property
    def n_ch(self) -> int:
        return N_SUB * (2 if self.phase else 1)

    def save(self, path: str = MODEL_FILE) -> None:
        os.makedirs(os.path.dirname(os.path.abspath(path)), exist_ok=True)
        t = lambda a: None if a is None else torch.as_tensor(np.asarray(a, np.float32))
        torch.save({"kind": self.kind, "phase": self.phase, "state": self.net.state_dict(),
                    "linear": t(self.linear), "pca_mean": t(self.pca_mean), "pca_comp": t(self.pca_comp),
                    "hidden": int(self.meta.get("hidden", HIDDEN)),
                    "linear_path": bool(getattr(self.net, "linear_path", False)),
                    "meta": json.dumps(self.meta)}, path)

    @staticmethod
    def load(path: str = MODEL_FILE) -> Optional["WorldModel"]:
        """weights_only=True: a model file is tensors and strings, never pickled code."""
        if not os.path.exists(path):
            return None
        d = torch.load(path, map_location="cpu", weights_only=True)
        n_ch = N_SUB * (2 if d["phase"] else 1)
        net = _make_net(d["kind"], n_ch, d["hidden"], d["linear_path"])
        net.load_state_dict(d["state"])
        net.eval()
        a = lambda k: None if d[k] is None else d[k].numpy().astype(float)
        return WorldModel(d["kind"], bool(d["phase"]), net, a("linear"), a("pca_mean"), a("pca_comp"),
                          json.loads(d["meta"]))


# ======================================================================= training
def _windows(Z: np.ndarray, ends: np.ndarray, length: int = WINDOW) -> np.ndarray:
    """(n, C, length) float32 windows ending at the given frames."""
    return np.ascontiguousarray(Z[ends[:, None] + np.arange(-length + 1, 1)[None, :]].transpose(0, 2, 1))


def _augment(x: np.ndarray, rng: np.random.Generator) -> np.ndarray:
    """Physically harmless variations for a tiny dataset: the sign of every change flipped
    (a body raises some subcarriers and lowers others), and the subcarrier order reversed."""
    x = x * rng.choice(np.array([-1.0, 1.0], np.float32), size=(len(x), 1, 1))
    flip = rng.random(len(x)) < 0.5
    if flip.any():
        types = x.shape[1] // N_SUB
        r = x[flip].reshape(int(flip.sum()), types, N_SUB, -1)[:, :, ::-1]
        x[flip] = r.reshape(int(flip.sum()), types * N_SUB, -1)
    return np.ascontiguousarray(x, np.float32)


def _forward_errors(model: "WorldModel", W: np.ndarray, batch: int = 512) -> np.ndarray:
    """Per window, per channel: mean squared error of the network's prediction of the last
    HORIZON frames from the CONTEXT before them. W (n, C, WINDOW) -> (n, C)."""
    out = []
    model.net.eval()
    with torch.no_grad():
        for i in range(0, len(W), batch):
            x = torch.from_numpy(np.ascontiguousarray(W[i:i + batch]))
            if model.kind == "masked":
                pred = model.net(x, forward_mask(len(x), x.shape[1]))[:, :, -HORIZON:]
            else:
                pred = model.net(x[:, :, :CONTEXT])
            out.append(((pred - x[:, :, -HORIZON:]) ** 2).mean(-1).numpy())
    return np.concatenate(out) if out else np.zeros((0, model.n_ch))


def baseline_errors(W: np.ndarray, linear: np.ndarray) -> dict:
    """The no-network predictors on the same windows, per window and channel:
    zero (the change energy itself), persistence (the last frame held), linear (ridge AR)."""
    tgt = W[:, :, -HORIZON:]
    lin = _ar_apply(torch.from_numpy(np.ascontiguousarray(W[:, :, :CONTEXT])),
                    torch.from_numpy(linear.astype(np.float32))).numpy()
    return {"zero": (tgt ** 2).mean(-1),
            "persist": ((tgt - W[:, :, CONTEXT - 1:CONTEXT]) ** 2).mean(-1),
            "linear": ((tgt - lin) ** 2).mean(-1)}


def _split_ends(pics: list[Picture], val_share: float) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """All pictures stacked, and window ends split in time: the last val_share of every
    recording validates (no window straddles the cut)."""
    Z, tr, va, off = [], [], [], 0
    for p in pics:
        e = window_ends(p)
        cut = int(len(p.t) * (1 - val_share))
        tr.append(off + e[e < cut])
        va.append(off + e[e - WINDOW + 1 >= cut])
        Z.append(p.z)
        off += len(p.t)
    return np.concatenate(Z), np.concatenate(tr), np.concatenate(va)


def train(pics: list[Picture], kind: str = "causal", seed: int = 0, minutes: float = 10.0,
          threads: int = 3, hidden: Optional[int] = None, batch: Optional[int] = None, max_steps: int = 20000,
          val_share: float = 0.15, eval_every: int = 200, linear_path: bool = True, val_windows: int = 3000,
          log: Callable[[str], None] = print) -> WorldModel:
    """Self-supervised training on change pictures, CPU only, within `minutes`.

    Early stopping on the validation windows' forward-prediction error (the same number
    for both kinds, so they can be compared): evaluated every `eval_every` steps, learning
    rate halved after 3 evaluations without improvement, stop after 8; best weights kept."""
    if kind not in KINDS:
        raise ValueError(f"kind is one of {KINDS}")
    phase = bool(pics[0].phase)
    if any(bool(p.phase) != phase for p in pics):
        raise ValueError("all pictures need the same channels (all with phase, or none)")
    hidden = hidden if hidden is not None else (16 if kind == "shared" else HIDDEN)
    batch = batch if batch is not None else (16 if kind == "shared" else 128)
    torch.manual_seed(seed)
    torch.set_num_threads(max(1, threads))
    rng = np.random.default_rng(seed)
    Z, tr, va = _split_ends(pics, val_share)
    if len(tr) < batch or len(va) < 8:
        raise ValueError(f"too little data: {len(tr)} training and {len(va)} validation windows")
    n_ch, types = Z.shape[1], Z.shape[1] // N_SUB
    linear = fit_linear(Z, tr[rng.permutation(len(tr))[:20000]], types)
    net = _make_net(kind, n_ch, hidden, linear_path)
    if getattr(net, "linear_path", False):
        net.ar.data = torch.from_numpy(linear.astype(np.float32))
    model = WorldModel(kind, phase, net, linear)
    Wv = _windows(Z, va[np.linspace(0, len(va) - 1, min(len(va), val_windows)).astype(int)])
    base_v = {k: float(v[:, :N_SUB].mean()) for k, v in baseline_errors(Wv, linear).items()}
    opt = torch.optim.AdamW(net.parameters(), lr=2e-3, weight_decay=1e-2)
    best, best_state, bad, step, t0 = np.inf, None, 0, 0, time.time()
    history = []
    while step < max_steps and time.time() - t0 < 60.0 * minutes:
        net.train()
        x = torch.from_numpy(_augment(_windows(Z, tr[rng.integers(0, len(tr), batch)]), rng))
        if kind == "masked":
            m = random_masks(batch, n_ch, rng)
            loss = (((net(x, m) - x) ** 2) * m).sum() / m.sum()
        else:
            loss = F.mse_loss(net(x[:, :, :CONTEXT]), x[:, :, -HORIZON:])
        opt.zero_grad()
        loss.backward()
        nn.utils.clip_grad_norm_(net.parameters(), 1.0)
        opt.step()
        step += 1
        if step % eval_every == 0:
            v = float(_forward_errors(model, Wv)[:, :N_SUB].mean())
            history.append((step, round(float(loss), 4), round(v, 4)))
            if v < best - 1e-4:
                best, bad = v, 0
                best_state = {k: t.detach().clone() for k, t in net.state_dict().items()}
            else:
                bad += 1
                if bad % 3 == 0:
                    for g in opt.param_groups:
                        g["lr"] *= 0.5
            log(f"  step {step:5d}  train {float(loss):.3f}  validation {v:.3f}  "
                f"(linear {base_v['linear']:.3f}, persistence {base_v['persist']:.3f}, zero {base_v['zero']:.3f})"
                f"  {time.time() - t0:5.0f} s")
            if bad >= 8:
                break
    if best_state is not None:
        net.load_state_dict(best_state)
    net.eval()
    if kind == "masked":
        model.pca_mean, model.pca_comp = _fit_pca(model, Z, tr, rng)
    model.meta = {"kind": kind, "phase": phase, "seed": seed, "hidden": hidden, "steps": step,
                  "linear_path": bool(getattr(net, "linear_path", False)), "batch": batch,
                  "seconds": round(time.time() - t0, 1), "threads": threads,
                  "parameters": int(sum(p.numel() for p in net.parameters())),
                  "frames": int(len(Z)), "minutes_of_data": round(len(Z) / FRAME_HZ / 60.0, 2),
                  "train_windows": int(len(tr)), "validation_windows": int(len(va)),
                  "validation_error": round(float(best), 4) if np.isfinite(best) else None,
                  "validation_baselines": {k: round(v, 4) for k, v in base_v.items()},
                  "history": history, "recordings": [os.path.basename(p.source) for p in pics],
                  "when": time.strftime("%Y-%m-%d %H:%M")}
    return model


def _fit_pca(model: WorldModel, Z: np.ndarray, ends: np.ndarray, rng: np.random.Generator,
             dims: int = EMB_DIMS) -> tuple[np.ndarray, np.ndarray]:
    """The masked model's embedding: PCA of its time-averaged hidden state, fitted on
    training windows only (no labels anywhere)."""
    H = _pooled(model, _windows(Z, ends[rng.permutation(len(ends))[:4000]], CONTEXT))
    mu = H.mean(0)
    _, _, vt = np.linalg.svd(H - mu, full_matrices=False)
    return mu, vt[:dims]


def _pooled(model: WorldModel, W: np.ndarray, batch: int = 512) -> np.ndarray:
    out = []
    model.net.eval()
    with torch.no_grad():
        for i in range(0, len(W), batch):
            out.append(model.net.pooled(torch.from_numpy(np.ascontiguousarray(W[i:i + batch]))).numpy())
    return np.concatenate(out)


# ======================================================================= surprise, embedding
def surprise(model: WorldModel, pic: Picture) -> dict:
    """Per frame f with a valid window ending there: how badly the last 0.5 s (frames
    f-9..f) was predicted from the 3 s before it, averaged over the amplitude channels
    ("net_amp") and, with phase, the phase channels ("net_phase"). In picture units
    squared: a predictor that gets everything but the receiver's white noise right scores
    ~1 on pure noise. The no-network predictors come along on the same windows:
    "zero_*" (the change energy itself), "persist_*", "linear_*". {"ends": frames, ...}."""
    ends = window_ends(pic)
    if not len(ends):
        return {"ends": ends}
    W = _windows(pic.z, ends)
    nnerr = _forward_errors(model, W)
    base = baseline_errors(W, model.linear)
    out = {"ends": ends, "net_amp": nnerr[:, :N_SUB].mean(1)}
    for k, v in base.items():
        out[f"{k}_amp"] = v[:, :N_SUB].mean(1)
    if model.phase:
        out["net_phase"] = nnerr[:, N_SUB:].mean(1)
        for k, v in base.items():
            out[f"{k}_phase"] = v[:, N_SUB:].mean(1)
    return out


def embed(model: WorldModel, pic: Picture, frames: np.ndarray) -> np.ndarray:
    """The 16-number summary of the CONTEXT frames ending at each requested frame; NaN rows
    where that window is not valid (stream start, a gap)."""
    frames = np.asarray(frames, int)
    ok = np.isin(frames, window_ends(pic, CONTEXT))
    W = _windows(pic.z, frames[ok], CONTEXT)
    if model.kind == "masked":
        E = (_pooled(model, W) - model.pca_mean) @ model.pca_comp.T if len(W) else np.zeros((0, EMB_DIMS))
    else:
        model.net.eval()
        with torch.no_grad():
            E = np.concatenate([model.net.embed(torch.from_numpy(W[i:i + 256])).numpy()
                                for i in range(0, len(W), 256)] or [np.zeros((0, emb_width(model)))])
    out = np.full((len(frames), E.shape[1] if len(E) else emb_width(model)), np.nan)
    out[ok] = E
    return out


def emb_width(model: WorldModel) -> int:
    """How many numbers the model's embedding has."""
    if model.kind == "shared":
        return model.net.types * model.net.head.in_features
    return EMB_DIMS


def window_surprise(s: dict, frames: np.ndarray, key: str = "net_amp", blocks: int = 6) -> np.ndarray:
    """Surprise of the 3 s ending at each requested frame: the mean of `blocks` consecutive
    0.5 s predictions (ending at f, f-10, ... f-50), the span HBE integrates over. NaN where
    any of them is missing."""
    vals = s.get(key)
    out = np.full(len(frames), np.nan)
    if vals is None or not len(s["ends"]):
        return out
    pos = np.full(int(s["ends"].max()) + 1, -1)
    pos[s["ends"]] = np.arange(len(s["ends"]))
    for j, f in enumerate(np.asarray(frames, int)):
        idx = [int(f) - HORIZON * b for b in range(blocks)]
        if min(idx) < 0 or max(idx) >= len(pos):
            continue
        k = pos[idx]
        if (k >= 0).all():
            out[j] = float(np.mean(vals[k]))
    return out
