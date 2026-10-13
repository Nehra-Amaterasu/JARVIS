"""Channel chart: a map of the room learned from one Wi-Fi link alone, with no labels.

WHY
  The zone model (learn.py) learns desk / bed / room from sessions in which I said where I
  was. Channel charting (Studer et al., 2018 onwards; the ESPARGOS group's charts in
  real-world coordinates) learns a map with no labels at all, from one physical fact:
  people move smoothly. Windows close in time were taken at nearby places, and windows far
  apart in time usually were not. A small network maps each window of the channel to a
  point on a 2-D chart, trained with a triplet loss on time adjacency: a window's
  neighbour within NEAR_S must land closer to it than a window more than FAR_S away, by a
  margin. Teacher and student are the same device: the only supervision is the clock.
  If the channel carries place, the chart comes out with the room's topology; two anchors
  (the desk and bed centres of the room layout) then pin it to metres with a similarity
  transform (scale, rotation, shift).

WHAT IT CAN AND CANNOT MEAN WITH ONE LINK
  One link measures one multipath fingerprint. Places with similar fingerprints land
  close, whatever their distance in the room, and one place gives different fingerprints
  for different postures and movements. So the chart is a TOPOLOGY of what the link can
  tell apart, not a measurement of position: after the two-anchor fit, the desk and bed
  land on their centres by construction; every other point in metres is a picture, not a
  coordinate. Two anchors cannot fix a mirror image (a reflection fits them equally well).

THE TIME CONFOUND (why held-out sessions)
  In a learn-my-room session each place is one contiguous stretch of time. A chart trained
  on that session can separate the steps by learning the clock (slow drift) instead of
  the room. So charts are scored on sessions they never trained on, and time_confound()
  compares how far apart the two halves of one step land with how far apart different
  steps land: a chart that encodes time puts the halves as far apart as the steps.

INPUT, PER learn.py WINDOW (3 s, a 0.5 s hop; the world model's replay and picture)
  change   log10 of the mean squared change picture per channel (what moves)
  static   the window's mean amplitude per subcarrier in dB, minus the recording's median
           shape; with phase, the window's circular-mean phase residual, minus the
           recording's. Where things ARE: a still body reshapes the static channel, and the
           change picture removes exactly that, by design.
"""
from __future__ import annotations

import json
import os
import struct
import zlib
from dataclasses import dataclass, field
from typing import Callable, Optional

import numpy as np
import torch
from torch import nn

from . import worldmodel as wm

HOP = 50                            # learn.py's 0.5 s hop at 100 Hz (learn.HOP_S)
SPAN = 300                          # and its 3 s window
NEAR_S = 1.5                        # a positive: at most 3 hops away, the same stretch of stream
FAR_S = 15.0                        # a negative: at least 15 s away (a step is 20-35 s; walking
                                    # between desk and bed takes a few seconds)
MARGIN = 1.0                        # chart units; the triplet loss sets the scale
ZONE_OF_STEP = {"desk_still": "desk", "desk_type": "desk", "desk_wave": "desk", "walk": "walk",
                "bed_still": "bed", "bed_wave": "bed", "away": "away"}
ZONES = ["desk", "bed", "walk", "away"]


# ======================================================================= windows
@dataclass
class Windows:
    """Chart inputs of one recording, one row per learn.py window."""
    source: str
    t: np.ndarray                   # window end, seconds from the stream's first sample
    seg: np.ndarray                 # unbroken stretch of the stream (no positive pair across a gap)
    X: np.ndarray                   # (n, d) features (see the module docstring)
    ok: np.ndarray                  # every input valid
    parts: tuple = ("change", "static")

    def __len__(self) -> int:
        return len(self.t)


def _window_means(x: np.ndarray, ends: np.ndarray, n: int) -> np.ndarray:
    """Mean of rows ends-n+1 .. ends of x, by cumulative sums."""
    c = np.vstack([np.zeros((1, x.shape[1])), np.cumsum(x, axis=0, dtype=float)])
    return (c[ends + 1] - c[ends + 1 - n]) / n


def chart_windows(st: "wm.Stream", pic: "wm.Picture", parts: tuple = ("change", "static")) -> Windows:
    """learn.py's windows (they end at stream samples 299, 349, ...: FeatureStream emits once
    300 samples are in, every 50) with the chart's inputs. A window is ok when its 60
    picture frames are valid and unbroken and its 300 samples have no gap."""
    ks = np.arange(SPAN - 1, len(st.t), HOP)
    nfr = SPAN // wm.DECIM
    f = np.searchsorted(pic.sample, ks, side="right") - 1
    ok = np.isin(f, wm.window_ends(pic, nfr)) & (st.t[ks] - st.t[np.maximum(ks - SPAN + 1, 0)] < (SPAN + 1) / wm.RATE_HZ)
    fs = np.clip(f, nfr - 1, None)
    feats = []
    if "change" in parts:
        feats.append(np.log10(_window_means(pic.z.astype(float) ** 2, fs, nfr) + 0.1))
    if "static" in parts:
        db = 20 * np.log10(np.maximum(_window_means(st.amp.astype(float), ks, SPAN), 1e-6))
        feats.append(db - np.median(db[ok], axis=0) if ok.any() else db)
        if pic.phase and st.phase is not None:
            u = _window_means(np.exp(1j * st.phase.astype(float)), ks, SPAN)
            ref = np.exp(1j * np.angle(u[ok].mean(axis=0))) if ok.any() else 1.0
            feats.append(np.angle(u * np.conj(ref)))
    X = np.concatenate(feats, axis=1)
    return Windows(os.path.basename(st.path), st.t[ks] - st.t[0], pic.seg[np.clip(f, 0, None)],
                   X.astype(np.float32), ok & np.isfinite(X).all(axis=1), tuple(parts))


# ======================================================================= model
class ChartNet(nn.Module):
    """Window features -> a point on the 2-D chart. Small on purpose: a few thousand windows."""

    def __init__(self, d: int, hidden: int = 64):
        super().__init__()
        self.f = nn.Sequential(nn.Linear(d, hidden), nn.GELU(), nn.Linear(hidden, hidden), nn.GELU(),
                               nn.Linear(hidden, 2))

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        return self.f(x)


@dataclass
class Chart:
    net: ChartNet
    mu: np.ndarray
    sd: np.ndarray
    meta: dict = field(default_factory=dict)

    def apply(self, X: np.ndarray) -> np.ndarray:
        self.net.eval()
        with torch.no_grad():
            return self.net(torch.from_numpy(((X - self.mu) / self.sd).astype(np.float32))).numpy()

    def save(self, path: str) -> None:
        os.makedirs(os.path.dirname(os.path.abspath(path)), exist_ok=True)
        torch.save({"state": self.net.state_dict(), "mu": torch.as_tensor(self.mu), "sd": torch.as_tensor(self.sd),
                    "meta": json.dumps(self.meta)}, path)

    @staticmethod
    def load(path: str) -> "Chart":
        d = torch.load(path, map_location="cpu", weights_only=True)
        net = ChartNet(int(d["mu"].numel()))
        net.load_state_dict(d["state"])
        return Chart(net, d["mu"].numpy(), d["sd"].numpy(), json.loads(d["meta"]))


def triplets(t: np.ndarray, group: np.ndarray, stretch: np.ndarray, rng: np.random.Generator,
             n: int) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """n (anchor, positive, negative) index triples over windows sorted by (group, t):
    the positive within NEAR_S in the same unbroken stretch, the negative at least FAR_S
    away in the same recording (group). Anchors without either are dropped."""
    N = len(t)
    a = rng.integers(0, N, n)
    off = rng.choice(np.array([-3, -2, -1, 1, 2, 3]), n)
    p = np.clip(a + off, 0, N - 1)
    okp = (p != a) & (group[p] == group[a]) & (stretch[p] == stretch[a]) & (np.abs(t[p] - t[a]) <= NEAR_S + 1e-6)
    lo = np.searchsorted(group, group, side="left")
    hi = np.searchsorted(group, group, side="right")
    neg = np.full(n, -1)
    for _ in range(10):                         # rejection sampling within the recording
        todo = neg < 0
        if not todo.any():
            break
        cand = lo[a[todo]] + (rng.random(int(todo.sum())) * (hi[a[todo]] - lo[a[todo]])).astype(int)
        good = np.abs(t[cand] - t[a[todo]]) >= FAR_S
        neg[np.flatnonzero(todo)[good]] = cand[good]
    keep = okp & (neg >= 0)
    return a[keep], p[keep], neg[keep]


def train_chart(wins: list[Windows], seed: int = 0, steps: int = 3000, batch: int = 256,
                threads: int = 3, log: Optional[Callable[[str], None]] = None) -> Chart:
    """The triplet chart on the ok windows of several recordings (no labels anywhere)."""
    torch.manual_seed(seed)
    torch.set_num_threads(max(1, threads))
    rng = np.random.default_rng(seed)
    X = np.concatenate([w.X[w.ok] for w in wins])
    t = np.concatenate([w.t[w.ok] for w in wins])
    group = np.concatenate([np.full(int(w.ok.sum()), i) for i, w in enumerate(wins)])
    stretch = np.concatenate([w.seg[w.ok] for w in wins])
    mu, sd = X.mean(0), X.std(0) + 1e-6
    Xs = torch.from_numpy(((X - mu) / sd).astype(np.float32))
    net = ChartNet(X.shape[1])
    opt = torch.optim.Adam(net.parameters(), lr=3e-3, weight_decay=1e-4)
    for step in range(1, steps + 1):
        a, p, n = triplets(t, group, stretch, rng, batch)
        if not len(a):
            continue
        za, zp, zn = net(Xs[a]), net(Xs[p]), net(Xs[n])
        loss = torch.relu((za - zp).norm(dim=1) - (za - zn).norm(dim=1) + MARGIN).mean()
        opt.zero_grad()
        loss.backward()
        opt.step()
        if log and step % 500 == 0:
            log(f"  chart step {step}: triplet loss {float(loss):.3f}")
    return Chart(net, mu, sd, {"seed": seed, "steps": steps, "windows": int(len(X)), "dims": int(X.shape[1]),
                               "recordings": [w.source for w in wins], "parts": list(wins[0].parts)})


def baseline_chart(wins: list[Windows], kind: str = "pca", seed: int = 0) -> Chart:
    """The charts a learned one has to beat, on the same standardised windows: the top two
    principal components ("pca"), or a random 2-D projection ("random"). Same Chart object,
    so every score treats them alike."""
    X = np.concatenate([w.X[w.ok] for w in wins])
    mu, sd = X.mean(0), X.std(0) + 1e-6
    Xs = (X - mu) / sd
    if kind == "pca":
        W = np.linalg.svd(Xs - Xs.mean(0), full_matrices=False)[2][:2].T
    elif kind == "random":
        W = np.random.default_rng(seed).normal(size=(X.shape[1], 2)) / np.sqrt(X.shape[1])
    else:
        raise ValueError("kind is 'pca' or 'random'")
    net = ChartNet(X.shape[1])
    lin = nn.Linear(X.shape[1], 2)
    with torch.no_grad():
        lin.weight.copy_(torch.from_numpy(W.T.astype(np.float32)))
        lin.bias.zero_()
    net.f = lin
    return Chart(net, mu, sd, {"baseline": kind, "windows": int(len(X)), "recordings": [w.source for w in wins]})


# ======================================================================= scoring (labels only here)
def knn_labels(train_pts: np.ndarray, train_lab: np.ndarray, test_pts: np.ndarray, k: int = 7,
               exclude: Optional[np.ndarray] = None) -> np.ndarray:
    """Majority label of the k nearest chart points. exclude (n_test, n_train) bool: pairs
    that may not vote (a window's own time-neighbours, which the chart was trained to keep
    close and would make this trivially right)."""
    D = np.linalg.norm(test_pts[:, None, :] - train_pts[None, :, :], axis=2)
    if exclude is not None:
        D = np.where(exclude, np.inf, D)
    idx = np.argsort(D, axis=1)[:, :k]
    labs = np.unique(train_lab)
    votes = np.stack([(train_lab[idx] == c).sum(1) for c in labs], axis=1)
    return labs[np.argmax(votes, axis=1)]


def kmeans_purity(pts: np.ndarray, lab: np.ndarray, k: int, seed: int = 0) -> float:
    """Share of points carrying the majority label of their k-means cluster."""
    from sklearn.cluster import KMeans
    c = KMeans(k, n_init=10, random_state=seed).fit_predict(pts)
    return float(sum(np.unique(lab[c == j], return_counts=True)[1].max() for j in np.unique(c)) / len(lab))


def _ranks(D: np.ndarray, rng: np.random.Generator) -> np.ndarray:
    """Rank of j among i's neighbours (1 = nearest), ties broken at random."""
    n = len(D)
    jitter = rng.random(D.shape) * 1e-9 * (np.abs(D).max() + 1.0)
    order = np.argsort(D + jitter, axis=1)
    R = np.empty_like(order)
    R[np.arange(n)[:, None], order] = np.arange(n)[None, :]
    return R                                  # self has rank 0


def trust_continuity(ref: np.ndarray, emb: np.ndarray, k: int = 10, seed: int = 0) -> tuple[float, float]:
    """Trustworthiness (chart neighbours that are neighbours in the reference) and continuity
    (reference neighbours kept as chart neighbours), Venna & Kaski, as channel-charting
    papers report them; 1 is perfect, ~0.5 is a random chart. ref: reference points or
    features (n, d); ties broken at random."""
    rng = np.random.default_rng(seed)
    n = len(emb)
    Dr = np.linalg.norm(ref[:, None, :] - ref[None, :, :], axis=2)
    De = np.linalg.norm(emb[:, None, :] - emb[None, :, :], axis=2)
    Rr, Re = _ranks(Dr, rng), _ranks(De, rng)
    norm = 2.0 / (n * k * (2 * n - 3 * k - 1))
    tw = 1 - norm * np.sum(np.where((Re <= k) & (Re > 0) & (Rr > k), Rr - k, 0))
    ct = 1 - norm * np.sum(np.where((Rr <= k) & (Rr > 0) & (Re > k), Re - k, 0))
    return float(tw), float(ct)


def time_confound(pts: np.ndarray, step: np.ndarray, t: np.ndarray) -> dict:
    """Mean distance between the centroids of the two halves (in time) of each step, and
    between the centroids of different steps. A chart that maps place puts the halves of a
    still step together; one that maps the clock spreads them like different steps."""
    halves, cents = [], {}
    for s in np.unique(step):
        m = np.flatnonzero(step == s)
        if len(m) < 4:
            continue
        m = m[np.argsort(t[m])]
        a, b = pts[m[: len(m) // 2]].mean(0), pts[m[len(m) // 2:]].mean(0)
        halves.append(float(np.linalg.norm(a - b)))
        cents[s] = pts[m].mean(0)
    keys = list(cents)
    between = [float(np.linalg.norm(cents[a] - cents[b])) for i, a in enumerate(keys) for b in keys[i + 1:]]
    w, bt = float(np.mean(halves)) if halves else float("nan"), float(np.mean(between)) if between else float("nan")
    return {"within_step_halves": w, "between_steps": bt, "ratio": w / bt if bt else float("nan")}


def similarity_from_anchors(src: np.ndarray, dst: np.ndarray) -> tuple[float, float, np.ndarray]:
    """The similarity transform (scale s, rotation by theta radians, shift) taking two chart
    points onto two room points exactly: dst = s R src + shift. Two points fix scale,
    rotation and shift but not a reflection: the mirror image fits as well."""
    a, b = complex(*src[0]), complex(*src[1])
    A, B = complex(*dst[0]), complex(*dst[1])
    if abs(b - a) < 1e-12:
        raise ValueError("the two anchors land on the same chart point: no scale can be fitted")
    m = (B - A) / (b - a)                      # s * exp(i theta)
    shift = A - m * a
    return abs(m), float(np.angle(m)), np.array([shift.real, shift.imag])


def to_metres(pts: np.ndarray, scale: float, theta: float, shift: np.ndarray) -> np.ndarray:
    c, s = np.cos(theta), np.sin(theta)
    return scale * pts @ np.array([[c, s], [-s, c]]) + shift


# ======================================================================= figure (no plotting library)
COLOURS = {"desk": (31, 119, 180), "bed": (255, 127, 14), "walk": (44, 160, 44), "away": (120, 120, 120)}
# 3x5 glyphs, one row of 3 bits per string: enough for legends and titles.
_FONT = {
    "A": "010101111101101", "B": "110101110101110", "C": "011100100100011", "D": "110101101101110",
    "E": "111100110100111", "F": "111100110100100", "G": "011100101101011", "H": "101101111101101",
    "I": "111010010010111", "J": "001001001101010", "K": "101101110101101", "L": "100100100100111",
    "M": "101111111101101", "N": "110101101101101", "O": "010101101101010", "P": "110101110100100",
    "Q": "010101101110011", "R": "110101110101101", "S": "011100010001110", "T": "111010010010010",
    "U": "101101101101111", "V": "101101101101010", "W": "101101111111101", "X": "101101010101101",
    "Y": "101101010010010", "Z": "111001010100111", "0": "111101101101111", "1": "010110010010111",
    "2": "110001010100111", "3": "110001010001110", "4": "101101111001001", "5": "111100110001110",
    "6": "011100111101111", "7": "111001010010010", "8": "111101111101111", "9": "111101111001110",
    " ": "000000000000000", "-": "000000111000000", ".": "000000000000010", "+": "000010111010000",
    "/": "001001010100100", "%": "101001010100101", "(": "010100100100010", ")": "010001001001010",
    "=": "000111000111000", ",": "000000000010100", ":": "000010000010000",
}


def _text(img: np.ndarray, x: int, y: int, s: str, colour=(20, 20, 20), scale: int = 3) -> None:
    for ch in s.upper():
        g = _FONT.get(ch, _FONT[" "])
        for r in range(5):
            for c in range(3):
                if g[3 * r + c] == "1":
                    img[y + r * scale:y + (r + 1) * scale, x + c * scale:x + (c + 1) * scale] = colour
        x += 4 * scale


def write_png(path: str, img: np.ndarray) -> None:
    """An RGB uint8 image (H, W, 3) as a PNG, by hand: signature, IHDR, one zlib IDAT
    (each row with filter byte 0), IEND; every chunk with its CRC-32."""
    img = np.ascontiguousarray(img, np.uint8)
    h, w = img.shape[:2]

    def chunk(tag: bytes, data: bytes) -> bytes:
        return struct.pack(">I", len(data)) + tag + data + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)

    raw = b"".join(b"\x00" + img[r].tobytes() for r in range(h))
    data = (b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 2, 0, 0, 0))
            + chunk(b"IDAT", zlib.compress(raw, 9)) + chunk(b"IEND", b""))
    os.makedirs(os.path.dirname(os.path.abspath(path)), exist_ok=True)
    with open(path, "wb") as f:
        f.write(data)


def scatter_png(path: str, panels: list[tuple[str, np.ndarray, np.ndarray]], size: int = 420) -> None:
    """Side-by-side scatter panels (title, points (n, 2), zone labels), coloured by zone,
    with a legend. Each panel is scaled to its own points: chart units are arbitrary."""
    pad, top, leg = 24, 40, 40
    W = len(panels) * (size + pad) + pad
    H = top + size + leg + pad
    img = np.full((H, W, 3), 255, np.uint8)
    for i, (title, pts, lab) in enumerate(panels):
        x0 = pad + i * (size + pad)
        img[top - 1:top + size + 1, x0 - 1:x0 + size + 1] = (200, 200, 200)
        img[top:top + size, x0:x0 + size] = 255
        _text(img, x0, 10, title[:34], scale=2 if len(title) > 26 else 3)
        if not len(pts):
            continue
        lo, hi = pts.min(0), pts.max(0)
        span = float(max(hi - lo)) or 1.0
        mid = (lo + hi) / 2
        px = ((pts - mid) / span * 0.9 + 0.5) * (size - 1)
        order = np.argsort([ZONES.index(z) if z in ZONES else 99 for z in lab])[::-1]
        for j in order:
            cx, cy = int(round(x0 + px[j, 0])), int(round(top + size - 1 - px[j, 1]))
            yy, xx = np.ogrid[-3:4, -3:4]
            disc = xx ** 2 + yy ** 2 <= 9
            ys, xs = np.nonzero(disc)
            ys, xs = ys + cy - 3, xs + cx - 3
            keep = (ys >= top) & (ys < top + size) & (xs >= x0) & (xs < x0 + size)
            img[ys[keep], xs[keep]] = COLOURS.get(lab[j], (0, 0, 0))
    x = pad
    for z in ZONES:
        img[top + size + 14:top + size + 26, x:x + 12] = COLOURS[z]
        _text(img, x + 18, top + size + 13, z)
        x += 18 + 4 * 3 * len(z) + 30
    write_png(path, img)
