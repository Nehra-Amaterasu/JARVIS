"""Where am I in the room, learned from the raw Wi-Fi signal: a fingerprint matcher
(kNN) and a small 1D convolutional network (CNN), both scored on days they never saw.

    python -m aankhen fingerprint evaluate    # leave one session out (+ one day out at 2+ days)
    python -m aankhen fingerprint evaluate --split half   # same-session halves: an upper bound only
    python -m aankhen fingerprint train       # CNN on every drill day -> versioned model

THE IDEA (Aman's Shazam analogy, and where it holds)
  Shazam cleans a noisy clip, turns it into a fingerprint, and finds the closest one in
  a database of labelled songs. Here: clean the CSI, turn 2 s of it into a fingerprint,
  and find the closest labelled spot. The difference: a song never changes, a room does
  (furniture, doors, humidity, the fan), so the database must cover several DAYS and the
  score only counts on a day the model never saw.

THE INPUT, one window = 2 s of signal
  51 subcarriers x 200 samples (100 Hz, already decoded, gain-normalised, resampled and
  Hampel-filtered by csi.CsiConditioner), averaged 4:1 in time to 51 x 50. Cleaning:
  log amplitude, minus the SAME DAY's empty-room mean for the block's fan state (what the
  daily calibration gives live), so the window holds "what my body changed", not "what
  the room looks like today".

THE TWO MODELS
  kNN fingerprint: per subcarrier, the window's mean and spread (102 numbers),
      standardised; the 7 nearest labelled windows vote, nearer ones count more. No
      training at all: the "database" IS the model. Strong when days look alike.
  CNN: Conv1d over time with the 51 subcarriers as channels (32 then 64 filters, kernel
      5), global average pooling, one linear layer. ~19k weights: small enough for the
      ESP32-S3 later (int8, ESP-DL). Unlike the kNN it learns WHICH subcarriers and which
      time patterns matter, like a lane-detection net learns its own edge filters. It
      needs more days than the kNN before it wins; that is what evaluate measures.
      Training adds random per-subcarrier offsets and time shifts (domain augmentation)
      so it learns patterns that survive a day's drift.
"""
from __future__ import annotations

import copy
import struct
import json
import os
import time
from collections import deque
from typing import Iterable, Optional

import numpy as np

from . import DATA_DIR

RATE_HZ = 100
WIN = 200            # 2 s at 100 Hz
HOP = 50             # a window every 0.5 s
POOL = 4             # 200 -> 50 time steps
N_SUB = 51
MAX_FILLED = 0.2     # a window with more than 20 % forward-filled samples is dropped
PURGE_S = 5.0        # first seconds of a block are settling, not the pose
MODEL_ROOT = os.path.join(DATA_DIR, "models", "cnn")
OUT_ZONES = ("inside_bathroom", "balcony")   # out of the sensed room through another door


# ---------------------------------------------------------------- windows
NB = WIN // POOL               # 50 steps of 40 ms in a window
BIN_S = POOL / RATE_HZ         # 0.04 s
MAX_EMPTY_BINS = 0.2           # a window may have at most 20 % of its 40 ms steps with no real packet
MAX_GAP_S = 0.5                # a longer silence starts the window over


class WindowBuilder:
    """Push one 100 Hz sample at a time; get a 2 s window back every 0.5 s (or None).

    Judged per 40 ms step, the resolution the models see, not per 10 ms sample. The
    first version dropped a window when over 20 % of its 100 Hz samples were filled in.
    On the real link (2026-10-26: 40-100 packets/s at -90 dBm) that dropped nearly all of
    them, although a 40 ms step needs only one real packet to be measured. A step's value
    is the mean of its real samples (the filled-in ones only if it has none, the previous
    step's if it has nothing at all); a window counts if at least 80 % of its steps hold a
    real packet. Silences up to MAX_GAP_S are bridged as empty steps; a longer one starts
    over. Push-based so the live engine and the file readers share one implementation."""

    def __init__(self):
        self.done: deque = deque(maxlen=NB)    # finished steps: (value[51] or None, real?, last time)
        self.cur_k: Optional[int] = None
        self.real_sum = self.all_sum = None
        self.n_real = self.n_all = 0
        self.last_t: Optional[float] = None
        self.last_emit = -1e18

    def push(self, t: float, amp, was_filled: bool) -> Optional[tuple[float, np.ndarray]]:
        k = int(round(t * RATE_HZ)) // POOL
        a = np.log(np.maximum(np.asarray(amp, float), 1e-6))
        out = None
        if self.cur_k is not None and k != self.cur_k:
            out = self._close_step(k)
        self.cur_k, self.last_t = k, t
        self.all_sum = a if self.all_sum is None else self.all_sum + a
        self.n_all += 1
        if not was_filled:
            self.real_sum = a if self.real_sum is None else self.real_sum + a
            self.n_real += 1
        return out

    def _close_step(self, k: int) -> Optional[tuple[float, np.ndarray]]:
        done = self.done
        v = self.real_sum / self.n_real if self.n_real else (self.all_sum / self.n_all if self.n_all else None)
        done.append((v, self.n_real > 0, self.last_t))
        self.real_sum = self.all_sum = None
        self.n_real = self.n_all = 0
        gap = k - self.cur_k - 1
        if k < self.cur_k or gap * BIN_S > MAX_GAP_S:
            done.clear()
            self.last_emit = -1e18
            return None
        for _ in range(gap):
            done.append((None, False, self.last_t))
        # a window ends at every step boundary once full; one goes out every 0.5 s
        if len(done) < NB or done[-1][2] - self.last_emit < HOP / RATE_HZ - 0.03:
            return None
        if sum(1 for _, r, _ in done if not r) / NB > MAX_EMPTY_BINS:
            return None
        vals = [v for v, _, _ in done]
        prev = next((v for v in vals if v is not None), None)
        if prev is None:
            return None
        cols = []
        for v in vals:
            prev = v if v is not None else prev
            cols.append(prev)
        self.last_emit = done[-1][2]
        return done[-1][2], np.stack(cols, axis=1)                 # [51, 50]


def windows(samples: Iterable[tuple[float, np.ndarray, bool]]) -> Iterable[tuple[float, np.ndarray]]:
    """(time, amp[51], filled) at 100 Hz -> (end time, log-amp window [51, 50]). WindowBuilder over an iterable."""
    wb = WindowBuilder()
    for t, amp, was_filled in samples:
        w = wb.push(t, amp, was_filled)
        if w is not None:
            yield w


def label_windows(wins: list[tuple[float, np.ndarray]], labels: list[dict], purge_s: float = PURGE_S,
                  fallback_refs: Optional[dict] = None) -> dict:
    """Attach drill labels by TIME: a window counts for a block only if it ends inside
    the block, after the settling seconds. Empty-room blocks give the day's reference
    per fan state; every window has it subtracted. A session with no empty block of its
    own (a narrated evening he never left) uses fallback_refs, the same day's from
    another session. Pure."""
    good = sorted([l for l in labels if l.get("verdict") == "ok"], key=lambda l: l["t_start"])

    def block_at(t: float) -> Optional[dict]:
        for l in good:
            if l["t_start"] + purge_s <= t < l["t_end"]:
                return l
        return None

    tagged = [(t, w, block_at(t)) for t, w in wins]
    refs = {}
    for fan in (False, True):
        e = [w for _, w, l in tagged if l and l.get("kind") == "empty" and bool(l.get("fan")) == fan]
        if e:
            refs[fan] = np.mean(e, axis=(0, 2))                         # [51]: the empty room's level
    own = dict(refs)
    for fan, r in (fallback_refs or {}).items():
        refs.setdefault(fan, r)
    X, Z, A, F, T = [], [], [], [], []
    for t, w, l in tagged:
        if l is None or l.get("kind") == "empty":
            continue
        ref = refs.get(bool(l.get("fan")), refs.get(not bool(l.get("fan"))))
        if ref is None:
            continue                                                    # no empty block that day: can't clean
        X.append(w - ref[:, None]); Z.append(l["zone"]); A.append(l.get("activity")); F.append(bool(l.get("fan"))); T.append(t)
    return {"X": np.asarray(X, np.float32).reshape(-1, N_SUB, WIN // POOL), "zone": np.asarray(Z),
            "activity": np.asarray(A), "fan": np.asarray(F, bool), "t": np.asarray(T), "refs": own}


def akr_stream(path: str) -> Iterable[tuple[float, np.ndarray, bool]]:
    """(host time, amplitude[51], filled) at 100 Hz from a raw recording.

    The board's clock spaces the samples; ONE offset per stretch puts them on the host's
    clock. The offset is the smallest (host arrival - board time) seen so far, because
    USB/HTTP delay only ever adds. Stamping each sample with its chunk's arrival time
    instead (the first version) made consecutive samples jump by the arrival jitter, and
    on the first real narrated session (2026-10-26, a weak link, chunks arriving in
    bursts) every jump restarted the 2 s window: 197,945 good samples, 0 windows. A jump
    of more than 1 s in the offset means the board restarted: a new stretch."""
    from .transport import iter_recording
    return csi_stream(iter_recording(path))


def csi_stream(records: Iterable[tuple[float, bytes]]) -> Iterable[tuple[float, np.ndarray, bool]]:
    """akr_stream on any (host time, bytes) records: a finished file or one still growing."""
    from .csi import CsiConditioner
    from .protocol import CsiPacket, StreamDecoder, decode_packet
    cond, dec = CsiConditioner(), StreamDecoder()
    off: Optional[float] = None
    for host_t, chunk in records:
        for fr in dec.feed(chunk):
            try:
                p = decode_packet(fr)
            except (ValueError, struct.error):
                # a frame with a valid CRC but a malformed payload: skip it, never lose
                # the session (council 2026-10-26: one truncated packet aborted a whole run)
                continue
            if not isinstance(p, CsiPacket):
                continue
            o = host_t - p.timestamp_us / 1e6
            if off is None or abs(o - off) > 1.0:
                off = o
            else:
                off = min(off, o)
            for s in cond.push(p.timestamp_us / 1e6, p.raw, p.rssi, gain_comp_db=p.gain_comp_db):
                yield s.t + off, s.amp, s.filled


def session_windows(folder: str) -> list[tuple[float, np.ndarray]]:
    """One session's raw.akr as (host end time, window) pairs, unlabelled. float32: a
    log-amplitude needs no more than 7 digits, and the 2 h sleep session alone is about
    14,000 windows, 290 MB as float64, on a laptop with under 1 GB free (2026-10-26)."""
    return [(t, w.astype(np.float32)) for t, w in windows(akr_stream(os.path.join(folder, "raw.akr")))]


def session_tensors(folder: str, labels: list[dict], fallback_refs: Optional[dict] = None) -> dict:
    """One session's labelled, cleaned windows, read from its raw.akr."""
    return label_windows(session_windows(folder), labels, fallback_refs=fallback_refs)


def load_days(root: Optional[str] = None, narrate_root: Optional[str] = None) -> dict:
    """{day: [session tensors]} for every drill AND narrated session on disk. Sessions
    without an empty-room stretch borrow the reference of another session that day."""
    from . import narrate
    from .drill import DRILL_DIR, sessions
    found = sessions(root or DRILL_DIR) + (narrate.sessions(narrate_root or narrate.NARRATE_DIR)
                                           if root is None or narrate_root else [])
    by_day: dict = {}
    for s in found:
        by_day.setdefault(s["day"], []).append((s, session_windows(s["folder"])))
    out: dict = {}
    for day, runs in by_day.items():
        day_refs: dict = {}
        first = []
        for s, wins in runs:
            d = label_windows(wins, s["labels"])
            for fan, r in d["refs"].items():
                day_refs.setdefault(fan, r)
            first.append((s, wins, d))
        if not day_refs:
            # No "leaving the room" stretch. Next best: time he spent OUT of the sensed room
            # through another door, the bathroom or the balcony (Aman, 2026-10-26: "when I
            # was in the bathroom I left the room"); those zones lie off the router-board line.
            outside = []
            for s, wins in runs:
                spans = [(l["t_start"] + PURGE_S, l["t_end"]) for l in s["labels"]
                         if l.get("verdict") == "ok" and l.get("zone") in OUT_ZONES]
                outside += [w for t, w in wins if any(a <= t < b for a, b in spans)]
            if len(outside) >= 20:
                m = np.mean(outside, axis=(0, 2))
                day_refs = {False: m, True: m}
                print(f"  {day}: no empty-room stretch; using {len(outside)} windows from the bathroom/balcony as the reference")
        if not day_refs:
            # Nobody left the room all day (the first narrated session, 2026-10-26: he fell
            # asleep): no empty reference exists. The day's own average level stands in.
            # It removes the same constant per subcarrier from every window, so places stay
            # comparable within the day; across days it is weaker than a true empty room.
            allw = [w for _, wins in runs for _, w in wins]
            if allw:
                m = np.mean(allw, axis=(0, 2))
                day_refs = {False: m, True: m}
                print(f"  {day}: no empty-room stretch; using the day's average level as the reference")
        for s, wins, d in first:
            if len(d["zone"]) == 0 or not d["refs"]:
                d = label_windows(wins, s["labels"], fallback_refs=day_refs)
            if len(d["zone"]):
                d["day"], d["session"] = day, s.get("session", s["folder"])   # the evaluator holds out by these
                out.setdefault(day, []).append(d)
    return out


def _cat(runs: list[dict], key: str) -> np.ndarray:
    return np.concatenate([r[key] for r in runs]) if runs else np.asarray([])


# ---------------------------------------------------------------- what counts as a place
# Raw narrated labels -> the places the models learn. One explicit table, applied at load
# for training and evaluation alike; the labels on disk keep the raw names.
# bed_lying and bed_sitting are the same spot. On 2026-10-26 lying lived in the 2 h sleep
# session and sitting in the evening ones, so the pair mostly taught WHICH SESSION, not
# where (council 2026-10-26, 1.8.1: the 7 % fold was the model trained on lying asked to
# name sitting). Posture can return as a second head once one session holds both.
PLACE_MAP = {"bed_lying": "bed", "bed_sitting": "bed"}
MIN_VISITS = 2           # a place seen once can't be learned on one visit and tested on another
MIN_TEST_WINDOWS = 40    # ~20 s; at ~25 windows one place's recall is +-10 points of noise (council)


def place_of(zone: np.ndarray, merge: bool = True) -> np.ndarray:
    """Raw zone labels -> places, through PLACE_MAP."""
    zone = np.asarray(zone)
    if not merge or not len(zone):
        return zone
    return np.asarray([PLACE_MAP.get(z, z) for z in zone.tolist()])


def expand_places(p: dict) -> dict:
    """A model's {place: p} back over the raw zone ids the belief and the floor plan know:
    each member of a merged place gets the merged place's probability (the evidence can't
    tell them apart, so as a likelihood it is the same for both)."""
    out = {}
    for c, v in p.items():
        for z in [z for z, m in PLACE_MAP.items() if m == c] or [c]:
            out[z] = v
    return out


def visit_counts(runs: list[dict]) -> dict:
    """{place: visits} over all runs, each run's visits on its own clock."""
    n: dict = {}
    for r in runs:
        vid = visits(r["t"], r["zone"])
        for z in set(r["zone"].tolist()):
            n[z] = n.get(z, 0) + len(set(vid[r["zone"] == z].tolist()))
    return n


def scope_places(days: dict, merge: bool = True, min_visits: int = MIN_VISITS) -> tuple[dict, dict]:
    """(days with zones mapped to places and thin places removed, {removed place: visits}).
    Pure: the runs are copied, never edited in place."""
    mapped = {d: [{**r, "zone": place_of(r["zone"], merge)} for r in runs] for d, runs in days.items()}
    n = visit_counts([r for runs in mapped.values() for r in runs])
    drop = {z: v for z, v in sorted(n.items()) if v < min_visits}
    out: dict = {}
    for d, runs in mapped.items():
        for r in runs:
            keep = ~np.isin(r["zone"], list(drop))
            if keep.any():
                out.setdefault(d, []).append({**r, **{k: np.asarray(r[k])[keep] for k in
                                                      ("X", "zone", "activity", "fan", "t") if k in r}})
    return out, drop


# ---------------------------------------------------------------- the fingerprint matcher
def summary(X: np.ndarray) -> np.ndarray:
    """[n, 51, 50] -> [n, 102]: per-subcarrier mean and spread over the window."""
    return np.concatenate([X.mean(axis=2), X.std(axis=2)], axis=1)


class KnnFingerprint:
    def __init__(self, k: int = 7):
        self.k = k

    def fit(self, X: np.ndarray, y: np.ndarray) -> "KnnFingerprint":
        from sklearn.neighbors import KNeighborsClassifier
        S = summary(X)
        self.mu, self.sd = S.mean(0), S.std(0) + 1e-6
        self.clf = KNeighborsClassifier(n_neighbors=min(self.k, len(y)), weights="distance").fit((S - self.mu) / self.sd, y)
        self.classes = list(self.clf.classes_)
        return self

    def predict(self, X: np.ndarray) -> np.ndarray:
        return self.clf.predict((summary(X) - self.mu) / self.sd)


# ---------------------------------------------------------------- the CNN
def _net(n_classes: int):
    import torch.nn as nn
    return nn.Sequential(
        nn.Conv1d(N_SUB, 32, 5, padding=2), nn.BatchNorm1d(32), nn.ReLU(), nn.MaxPool1d(2),
        nn.Conv1d(32, 64, 5, padding=2), nn.BatchNorm1d(64), nn.ReLU(),
        nn.AdaptiveAvgPool1d(1), nn.Flatten(), nn.Dropout(0.3), nn.Linear(64, n_classes))


def _softmax(Z: np.ndarray) -> np.ndarray:
    e = np.exp(Z - Z.max(axis=1, keepdims=True))
    return e / e.sum(axis=1, keepdims=True)


def _nll(P: np.ndarray, yi: np.ndarray) -> float:
    return float(-np.mean(np.log(np.maximum(P[np.arange(len(yi)), yi], 1e-12))))


def ece(P: np.ndarray, yi: np.ndarray, bins: int = 15) -> float:
    """Expected calibration error, top label, 15 equal-width bins (Guo et al. 2017): the
    window-weighted gap between how sure the model said it was and how often it was right."""
    return _pooled_ece([(P, yi)], bins) if len(yi) else float("nan")


class CnnFingerprint:
    def __init__(self, epochs: int = 30, seed: int = 0, augment: bool = True):
        self.epochs, self.seed, self.augment = epochs, seed, augment
        self.temperature = 1.0

    def fit(self, X: np.ndarray, y: np.ndarray, X_val: Optional[np.ndarray] = None,
            y_val: Optional[np.ndarray] = None, X_stop: Optional[np.ndarray] = None,
            y_stop: Optional[np.ndarray] = None) -> "CnnFingerprint":
        """Train. With a validation set, self.history records every epoch: the loss, the
        accuracy on the training and the validation windows, and how hard backpropagation
        pushed each layer (the gradient's size per layer, averaged over the epoch's steps).
        With an early-stopping set (carved from the TRAINING data), the weights of the epoch
        with the best balanced accuracy on it are kept."""
        import torch
        # Tiny tensors: 8 threads spent more time coordinating than computing (one fit:
        # 11.2 s on 8 threads, 0.6 s on 2, 2026-10-26). Same lesson as the sklearn lag fix.
        threads = torch.get_num_threads()
        torch.set_num_threads(min(2, threads))
        try:
            return self._fit(X, y, X_val, y_val, X_stop, y_stop)
        finally:
            torch.set_num_threads(threads)

    def _accuracy(self, X: np.ndarray, y: np.ndarray) -> float:
        was = self.net.training
        self.net.eval()
        acc = float((self.predict(X) == y).mean()) if len(y) else float("nan")
        self.net.train(was)
        return acc

    def _fit(self, X: np.ndarray, y: np.ndarray, X_val=None, y_val=None, X_stop=None, y_stop=None) -> "CnnFingerprint":
        import torch
        torch.manual_seed(self.seed)
        rng = np.random.default_rng(self.seed)
        self.classes = sorted(set(y.tolist()))
        idx = {c: i for i, c in enumerate(self.classes)}
        yi = np.array([idx[c] for c in y])
        self.mu, self.sd = float(X.mean()), float(X.std() + 1e-6)
        Xn = ((X - self.mu) / self.sd).astype(np.float32)
        counts = np.bincount(yi, minlength=len(self.classes))
        w = torch.tensor(len(yi) / (len(self.classes) * np.maximum(counts, 1)), dtype=torch.float32)  # balanced classes
        self.net = _net(len(self.classes))
        opt = torch.optim.Adam(self.net.parameters(), lr=1e-3, weight_decay=1e-4)
        loss_fn = torch.nn.CrossEntropyLoss(weight=w)
        # the layers that learn, by name, for the gradient record
        layers = {name: m for name, m in (("conv1", self.net[0]), ("conv2", self.net[4]), ("linear", self.net[-1]))}
        self.history: list[dict] = []
        self.best_epoch = None
        best = None
        self.net.train()
        for epoch in range(self.epochs):
            order = rng.permutation(len(yi))
            losses, grads = [], {k: [] for k in layers}
            for s in range(0, len(order), 64):
                b = order[s:s + 64]
                xb = Xn[b].copy()
                if self.augment:
                    # a day's drift is mostly a per-subcarrier level change and timing: teach the net to ignore both
                    xb += rng.normal(0, 0.3, (len(b), N_SUB, 1)).astype(np.float32)
                    xb = np.roll(xb, int(rng.integers(-5, 6)), axis=2)
                opt.zero_grad()
                loss = loss_fn(self.net(torch.from_numpy(xb)), torch.from_numpy(yi[b]))   # how wrong, on this batch
                loss.backward()                                                            # backpropagation: d(loss)/d(every weight)
                for k, m in layers.items():
                    grads[k].append(float(m.weight.grad.norm()))
                opt.step()                                                                 # move every weight a step downhill
                losses.append(float(loss))
            stop = self._balanced(X_stop, y_stop) if X_stop is not None and len(y_stop) else None
            if stop is not None and (best is None or stop > best[0]):
                best = (stop, epoch + 1, copy.deepcopy(self.net.state_dict()))
            if X_val is not None:
                self.history.append({"epoch": epoch + 1, "loss": round(float(np.mean(losses)), 4),
                                     "train_acc": round(self._accuracy(X, y), 4),
                                     "val_acc": round(self._accuracy(X_val, y_val), 4),
                                     **({"stop_bal": round(stop, 4)} if stop is not None else {}),
                                     "grad": {k: round(float(np.mean(v)), 4) for k, v in grads.items()}})
        if best is not None:
            # early stopping: keep the epoch the INNER check liked best, never the verify half
            self.net.load_state_dict(best[2])
            self.best_epoch = best[1]
        self.net.eval()
        return self

    def _balanced(self, X: np.ndarray, y: np.ndarray) -> float:
        was = self.net.training
        self.net.eval()
        p = self.predict(X)
        self.net.train(was)
        return float(np.mean([(p[y == z] == z).mean() for z in set(y.tolist())]))

    def logits(self, X: np.ndarray) -> np.ndarray:
        import torch
        with torch.no_grad():
            return self.net(torch.from_numpy(((X - self.mu) / self.sd).astype(np.float32))).numpy().astype(float)

    def proba(self, X: np.ndarray) -> np.ndarray:
        """Softmax of logits / temperature. A model loaded from an older manifest has no
        temperature and keeps 1.0, its raw softmax."""
        return _softmax(self.logits(X) / getattr(self, "temperature", 1.0))

    def calibrate(self, X: np.ndarray, y: np.ndarray) -> Optional[dict]:
        """Fit ONE temperature on held-back training windows (Guo et al. 2017, arXiv
        1706.04599: ECE 16.5 -> 1.3 % on CIFAR-100 at unchanged accuracy). It only rescales
        the logits, so the argmax, and every accuracy, stays exactly the same. The
        class-weighted loss pushes mass towards rare places and the 0.5 "unsure" line sat on
        those raw numbers (council 2026-10-26, 1.5). None when no window's place is known."""
        known = np.isin(y, self.classes)
        if not known.any():
            return None
        from scipy.optimize import minimize_scalar
        Z = self.logits(X[known])
        yi = np.array([self.classes.index(c) for c in y[known]])
        nll = lambda logT: _nll(_softmax(Z / np.exp(logT)), yi)
        # log T in [-3, 3]: T from 0.05 to 20, far wider than any sane fit
        logT = float(minimize_scalar(nll, bounds=(-3.0, 3.0), method="bounded").x)
        before = _softmax(Z)
        self.temperature = float(np.exp(logT))
        after = _softmax(Z / self.temperature)
        return {"temperature": round(self.temperature, 4), "windows": int(known.sum()),
                "nll_before": round(_nll(before, yi), 4), "nll_after": round(_nll(after, yi), 4),
                "ece_before": round(ece(before, yi), 4), "ece_after": round(ece(after, yi), 4)}

    def predict(self, X: np.ndarray) -> np.ndarray:
        return np.asarray(self.classes)[self.proba(X).argmax(1)]

    def weights(self) -> int:
        return sum(p.numel() for p in self.net.parameters())

    def save(self, root: str = MODEL_ROOT, meta: Optional[dict] = None) -> str:
        import torch
        version = time.strftime("%Y%m%d-%H%M%S")
        out = os.path.join(root, version)
        os.makedirs(out, exist_ok=True)
        torch.save(self.net.state_dict(), os.path.join(out, "model.pt"))
        with open(os.path.join(out, "manifest.json"), "w", encoding="utf-8") as f:
            json.dump({"classes": self.classes, "mu": self.mu, "sd": self.sd, "weights": self.weights(),
                       "temperature": getattr(self, "temperature", 1.0), "place_map": PLACE_MAP,
                       "input": [N_SUB, WIN // POOL], "window_s": WIN / RATE_HZ, **(meta or {})}, f, indent=2)
        with open(os.path.join(root, "current.json"), "w", encoding="utf-8") as f:
            json.dump({"version": version}, f)
        return out

    @classmethod
    def load(cls, folder: str) -> "CnnFingerprint":
        """A saved model with its temperature (1.0 for a manifest written before it existed)."""
        import torch
        with open(os.path.join(folder, "manifest.json"), encoding="utf-8") as f:
            man = json.load(f)
        m = cls()
        m.classes, m.mu, m.sd = man["classes"], man["mu"], man["sd"]
        m.temperature = float(man.get("temperature", 1.0))
        m.net = _net(len(m.classes))
        m.net.load_state_dict(torch.load(os.path.join(folder, "model.pt"), weights_only=True))
        m.net.eval()
        return m


# ---------------------------------------------------------------- splits
GUARD_S = WIN / RATE_HZ      # windows are 2 s long: keep 2 s between a train and a test window


def visits(t: np.ndarray, zone: np.ndarray, max_gap_s: float = 3.0) -> np.ndarray:
    """Visit id per window: consecutive windows (in time) of the same zone, no gap over
    max_gap_s. A visit is one time he was at that place."""
    order = np.argsort(t)
    vid = np.empty(len(t), int)
    cur = -1
    for k, i in enumerate(order):
        if k == 0 or zone[i] != zone[order[k - 1]] or t[i] - t[order[k - 1]] > max_gap_s:
            cur += 1
        vid[i] = cur
    return vid


def half_split(t: np.ndarray, zone: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """(train mask, test mask), about half each, with no leakage between them.

    Neighbouring windows overlap by 1.5 s, so a random 50/50 split would test on near-copies
    of training windows and report accuracy the room never gives. Instead: a place visited
    two or more times gives alternate visits to train and test (a new visit is the honest
    test); a place visited once is cut at the middle of its time, and windows within
    GUARD_S of the cut belong to neither side."""
    vid = visits(t, zone)
    train = np.zeros(len(t), bool)
    test = np.zeros(len(t), bool)
    for z in sorted(set(zone.tolist())):
        zv = sorted(set(vid[zone == z].tolist()), key=lambda v: t[vid == v].min())
        if len(zv) >= 2:
            for k, v in enumerate(zv):
                (train if k % 2 == 0 else test)[vid == v] = True
        else:
            m = zone == z
            mid = np.median(t[m])
            train |= m & (t < mid - GUARD_S / 2)
            test |= m & (t >= mid + GUARD_S / 2)
    return train, test


CAP_X_MEDIAN = 4     # no place may bring more than 4x the median place's windows to training


def cap_per_place(idx: np.ndarray, y: np.ndarray, t: np.ndarray, cap_x: float = CAP_X_MEDIAN) -> np.ndarray:
    """Indices with each place capped at cap_x times the median place's count, kept evenly
    spaced in time. The first real day was 110 min asleep on the bed and minutes of
    everything else; uncapped, the cheapest way to be right is to say "bed"."""
    counts = {z: int((y[idx] == z).sum()) for z in set(y[idx].tolist())}
    cap = max(1, int(cap_x * float(np.median(list(counts.values())))))
    keep = []
    for z, n in counts.items():
        zi = idx[y[idx] == z]
        zi = zi[np.argsort(t[zi])]
        keep.append(zi if n <= cap else zi[np.linspace(0, n - 1, cap).round().astype(int)])
    return np.sort(np.concatenate(keep))


def fit_models(X: np.ndarray, y: np.ndarray, t: np.ndarray, idx: np.ndarray, epochs: int = 30, seed: int = 0,
               X_val: Optional[np.ndarray] = None, y_val: Optional[np.ndarray] = None) -> dict:
    """Both models on the windows idx, the way they ship: the per-place cap; the CNN's
    early-stopping set carved from those training windows by visits (so no held-out
    window ever decides anything); one temperature fitted on that same set."""
    fit_idx = cap_per_place(idx, y, t)
    inner_a, inner_b = half_split(t[fit_idx], y[fit_idx])
    use_stop = len(set(y[fit_idx][inner_b].tolist())) >= 2
    fit_cnn = fit_idx[inner_a] if use_stop else fit_idx
    stop_idx = fit_idx[inner_b] if use_stop else np.array([], int)
    knn = KnnFingerprint().fit(X[fit_idx], y[fit_idx])
    cnn = CnnFingerprint(epochs=epochs, seed=seed).fit(
        X[fit_cnn], y[fit_cnn], X_val, y_val,
        X[stop_idx] if use_stop else None, y[stop_idx] if use_stop else None)
    cal = cnn.calibrate(X[stop_idx], y[stop_idx]) if use_stop else None
    return {"knn": knn, "cnn": cnn, "fit_idx": fit_idx, "stop_idx": stop_idx, "calibration": cal}


def evaluate_half(days: dict, epochs: int = 30) -> dict:
    """Every labelled window there is, 50 % to train and 50 % to verify (half_split per
    day, so each day's own drift is on both sides). kNN and CNN, per-zone accuracy, a
    confusion table, and the CNN's epoch-by-epoch training record. Same day on both
    sides: always an UPPER BOUND, never the score to choose a model by."""
    runs = [r for d in sorted(days) for r in days[d]]
    X, y, t = _cat(runs, "X"), _cat(runs, "zone"), _cat(runs, "t")
    if len(set(y.tolist())) < 2:
        return {"error": "need at least two different places labelled"}
    tr, te = np.zeros(len(y), bool), np.zeros(len(y), bool)
    off = 0
    for r in runs:                                   # split each session on its own clock
        n = len(r["zone"])
        a, b = half_split(r["t"], r["zone"])
        tr[off:off + n], te[off:off + n] = a, b
        off += n
    zones_test = sorted(set(y[te].tolist()))
    missing = sorted(set(y.tolist()) - set(y[tr].tolist()))
    m = fit_models(X, y, t, np.flatnonzero(tr), epochs, X_val=X[te], y_val=y[te])
    knn, cnn, fit_idx, stop_idx = m["knn"], m["cnn"], m["fit_idx"], m["stop_idx"]
    pk, pc = knn.predict(X[te]), cnn.predict(X[te])
    labels = sorted(set(y.tolist()))
    conf = {a: {b: int(((y[te] == a) & (pc == b)).sum()) for b in labels} for a in zones_test}
    # Plain accuracy flatters a lopsided session: the first real one was 98 % asleep on the
    # bed, where "always say bed" scores 97.8 % and a 95 % kNN is worse than guessing.
    # So: the always-the-commonest-place score, and balanced accuracy (mean per-place recall).
    common = max(set(y[tr].tolist()), key=lambda z: int((y[tr] == z).sum()))
    bal = lambda p: round(float(np.mean([(p[y[te] == z] == z).mean() for z in zones_test])), 4)
    return {"split": "half", "days": sorted(days), "windows": {"train": int(tr.sum()), "test": int(te.sum())},
            "chance": round(1 / len(labels), 4),
            "majority": {"place": common, "acc": round(float((y[te] == common).mean()), 4)},
            "balanced": {"knn": bal(pk), "cnn": bal(pc)},
            "knn": round(float((pk == y[te]).mean()), 4), "cnn": round(float((pc == y[te]).mean()), 4),
            "per_zone": {z: {"windows": int((y[te] == z).sum()),
                             "knn": round(float((pk[y[te] == z] == z).mean()), 4),
                             "cnn": round(float((pc[y[te] == z] == z).mean()), 4)} for z in zones_test},
            "cnn_confusion": conf, "history": cnn.history, "not_in_training": missing,
            "calibration": m["calibration"],
            "trained_on": {"windows": int(len(fit_idx)), "capped_from": int(tr.sum()),
                           "cnn_best_epoch": cnn.best_epoch, "early_stop_windows": int(len(stop_idx))},
            # Alternate visits of the SAME session sit on both sides: the link's state, the
            # reference and the posture are shared, and temporal rules see fake teleports
            # (council 2026-10-26, 1.4). Only held-out sessions and days are honest.
            "note": "UPPER BOUND: the verify half is the same session(s) as the training half; "
                    "choose models by the held-out-session/day score"}


# ---------------------------------------------------------------- the honest evaluator
N_BOOT = 2000


def _shuffle_visits(y: np.ndarray, vid: np.ndarray, idx: np.ndarray, rng) -> np.ndarray:
    """The labels with the training visits' places dealt out again at random, whole
    visits at a time. Shuffling single windows would also break the 1.5 s overlap between
    neighbours, a weaker control: whole visits keep every time structure except place."""
    y2 = y.copy()
    vs = np.array(sorted(set(vid[idx].tolist())))
    lab = np.array([y[idx][vid[idx] == v][0] for v in vs])
    for v, z in zip(vs, rng.permutation(lab)):
        y2[idx[vid[idx] == v]] = z
    return y2


def _visit_boot(right: dict, vid: np.ndarray, y: np.ndarray, mask: np.ndarray, places: list, n_boot: int,
                rng) -> dict:
    """Balanced accuracy's 95 % interval by resampling VISITS within each place, the same
    resample for every model so their difference is paired. Windows of one visit are
    near-copies (1.5 s overlap, one posture), so resampling windows would claim far more
    certainty than the handful of visits gives."""
    draws = {k: np.zeros((n_boot, len(places))) for k in right}
    for j, z in enumerate(places):
        m = mask & (y == z)
        vs = np.array(sorted(set(vid[m].tolist())))
        n = np.array([int((m & (vid == v)).sum()) for v in vs], float)
        c = {k: np.array([int((m & (vid == v) & r).sum()) for v in vs], float) for k, r in right.items()}
        pick = rng.integers(0, len(vs), (n_boot, len(vs)))
        for k in right:
            draws[k][:, j] = c[k][pick].sum(1) / n[pick].sum(1)
    bal = {k: d.mean(1) for k, d in draws.items()}
    ci = lambda a: [round(float(np.percentile(a, 2.5)), 4), round(float(np.percentile(a, 97.5)), 4)]
    out = {k: ci(b) for k, b in bal.items()}
    if "cnn" in bal and "knn" in bal:
        out["cnn_minus_knn"] = ci(bal["cnn"] - bal["knn"])
    return out


def evaluate_held_out(days: dict, by: str = "session", epochs: int = 30, seed: int = 0, n_boot: int = N_BOOT,
                      control: bool = True, min_windows: int = MIN_TEST_WINDOWS, min_visits: int = MIN_VISITS) -> dict:
    """Leave one SESSION (or one DAY) out: train on the rest, predict every window of the
    held-out one, pool the predictions, then score.

    Scored places: at least min_windows test windows and min_visits visits, counting only
    folds whose training had the place (a place absent from training can't be named; it is
    listed apart, not scored as a model's 0 %). Per model: balanced accuracy with a 95 %
    visit-bootstrap interval, plain accuracy, recall per place. Beside them the
    always-the-commonest-place baseline and the shuffled-label control (the same models
    trained on visit-shuffled places): a model is learning place only if it clears both by
    more than the interval. For the CNN, ECE before and after its temperature."""
    runs = [r for d in sorted(days) for r in days[d]]
    if by == "day":
        group = [r.get("day") for d in sorted(days) for r in days[d]]
    else:
        group = [r.get("session") or f"{r.get('day')}#{k}" for k, r in enumerate(runs)]
    X, y, t = _cat(runs, "X"), _cat(runs, "zone"), _cat(runs, "t")
    g = np.concatenate([[gr] * len(r["zone"]) for gr, r in zip(group, runs)]) if runs else np.asarray([])
    vid, off = np.empty(len(y), int), 0
    for r in runs:                                    # visits on each session's own clock, ids global
        v = visits(r["t"], r["zone"])
        vid[off:off + len(v)] = v + (vid[:off].max() + 1 if off else 0)
        off += len(v)
    names = list(dict.fromkeys(group))
    rng = np.random.default_rng(seed)
    kinds = ["knn", "cnn", "majority"] + (["knn_shuffled", "cnn_shuffled"] if control else [])
    pred = {k: np.full(len(y), None, object) for k in kinds}
    tested = np.zeros(len(y), bool)                   # held out in a fold that could name its place
    conf_raw, conf_cal, right_cal = [], [], []
    folds, temps = {}, []
    for G in names:
        te, tr = g == G, g != G
        known = set(y[tr].tolist())
        if len(known) < 2:
            folds[G] = {"error": "the other folds hold fewer than two places"}
            continue
        m = fit_models(X, y, t, np.flatnonzero(tr), epochs, seed)
        pred["knn"][te] = m["knn"].predict(X[te])
        pred["cnn"][te] = m["cnn"].predict(X[te])
        common = max(known, key=lambda z: int((y[tr] == z).sum()))
        pred["majority"][te] = common
        if control:
            ys = _shuffle_visits(y, vid, np.flatnonzero(tr), rng)
            ms = fit_models(X, ys, t, np.flatnonzero(tr), epochs, seed)
            pred["knn_shuffled"][te] = ms["knn"].predict(X[te])
            pred["cnn_shuffled"][te] = ms["cnn"].predict(X[te])
        ok = te & np.isin(y, list(known))
        tested |= ok
        cnn = m["cnn"]
        if ok.any():
            yi = np.array([cnn.classes.index(c) for c in y[ok]])
            Z = cnn.logits(X[ok])
            P0, P1 = _softmax(Z), _softmax(Z / cnn.temperature)
            conf_raw.append((P0, yi)); conf_cal.append((P1, yi))
        temps.append(cnn.temperature)
        folds[G] = {"test_windows": int(te.sum()), "trained_on": int(len(m["fit_idx"])),
                    "unknown_places": sorted(set(y[te].tolist()) - known),
                    "majority": common, "cnn_best_epoch": cnn.best_epoch,
                    "calibration": m["calibration"],
                    "knn": round(float((pred["knn"][te] == y[te]).mean()), 4),
                    "cnn": round(float((pred["cnn"][te] == y[te]).mean()), 4)}
    places_all = sorted(set(y.tolist()))
    count = {z: (int((tested & (y == z)).sum()), len(set(vid[tested & (y == z)].tolist()))) for z in places_all}
    scored = [z for z in places_all if count[z][0] >= min_windows and count[z][1] >= min_visits]
    apart = {z: {"windows": count[z][0], "visits": count[z][1],
                 "untested_windows": int(((y == z) & ~tested).sum())} for z in places_all if z not in scored}
    mask = tested & np.isin(y, scored)
    right = {k: (pred[k] == y) for k in kinds}
    rep = {"split": by, "folds": folds, "groups": names, "scored_places": scored, "listed_apart": apart,
           "rule": {"min_windows": min_windows, "min_visits": min_visits}, "chance": None,
           "windows": {"scored": int(mask.sum()), "all": int(len(y))}}
    if not scored:
        rep["error"] = (f"no place has {min_windows}+ test windows and {min_visits}+ visits in folds that "
                        "trained on it: nothing can be scored honestly yet")
        return rep
    recall = {k: {z: round(float(right[k][mask & (y == z)].mean()), 4) for z in scored} for k in kinds}
    rep.update({
        "chance": round(1 / len(scored), 4),
        "balanced": {k: round(float(np.mean(list(recall[k].values()))), 4) for k in kinds},
        "accuracy": {k: round(float(right[k][mask].mean()), 4) for k in kinds},
        "ci95": _visit_boot(right, vid, y, mask, scored, n_boot, np.random.default_rng(seed + 1)),
        "per_place": {z: {"windows": count[z][0], "visits": count[z][1],
                          **{k: recall[k][z] for k in kinds}} for z in scored},
    })
    if conf_raw:
        # pooled over folds whose class lists differ: ECE and NLL need only each window's
        # top probability and its true class's, so each fold is scored on its own rows
        n = sum(len(q) for _, q in conf_raw)
        nll = lambda parts: round(sum(_nll(p, q) * len(q) for p, q in parts) / n, 4)
        rep["cnn_calibration_held_out"] = {
            "temperature": [round(float(x), 3) for x in temps], "windows": int(n),
            "ece_before": round(_pooled_ece(conf_raw), 4), "ece_after": round(_pooled_ece(conf_cal), 4),
            "nll_before": nll(conf_raw), "nll_after": nll(conf_cal)}
    if len(names) < 2 or (by == "day" and len(names) < 3):
        rep["note"] = f"only {len(names)} {by}s: one fold's luck moves the mean; the intervals say how much"
    return rep


def _pooled_ece(parts: list, bins: int = 15) -> float:
    """ECE over several (probabilities, true index) blocks, one bin set for all."""
    conf = np.concatenate([p.max(1) for p, _ in parts])
    right = np.concatenate([(p.argmax(1) == q).astype(float) for p, q in parts])
    k = np.minimum((conf * bins).astype(int), bins - 1)
    return float(sum(abs(conf[k == b].mean() - right[k == b].mean()) * (k == b).mean()
                     for b in range(bins) if (k == b).any()))


def format_held_out(rep: dict) -> str:
    by = rep.get("split", "session")
    lines = [f"  leave one {by} out: {len(rep.get('groups', []))} {by}s, each predicted by models that never saw it"]
    for G, f in rep.get("folds", {}).items():
        if "error" in f:
            lines.append(f"    {G}: {f['error']}")
        else:
            un = f"; not in its training: {', '.join(f['unknown_places'])}" if f["unknown_places"] else ""
            lines.append(f"    {G}: {f['test_windows']} windows, trained on {f['trained_on']}  "
                         f"kNN {f['knn']:.0%}  CNN {f['cnn']:.0%}{un}")
    if "error" in rep:
        return "\n".join(lines + ["  " + rep["error"]])
    ci, b = rep["ci95"], rep["balanced"]
    r = rep["rule"]
    lines += ["", f"  scored: {len(rep['scored_places'])} places with {r['min_windows']}+ test windows and "
                  f"{r['min_visits']}+ visits ({rep['windows']['scored']} windows; chance {rep['chance']:.0%})",
              "  balanced accuracy (each place counts the same), 95 % interval from resampling visits:"]
    names = {"knn": "kNN", "cnn": "CNN", "majority": "always the commonest place",
             "knn_shuffled": "kNN, shuffled labels (control)", "cnn_shuffled": "CNN, shuffled labels (control)"}
    for k in b:
        iv = f"[{ci[k][0]:.0%}, {ci[k][1]:.0%}]" if k in ci else ""
        lines.append(f"    {names[k]:<32} {b[k]:>4.0%}  {iv:<12}  plain {rep['accuracy'][k]:.0%}")
    if "cnn_minus_knn" in ci:
        lines.append(f"    CNN minus kNN: [{ci['cnn_minus_knn'][0]:+.0%}, {ci['cnn_minus_knn'][1]:+.0%}]"
                     + ("  (includes 0: no winner)" if ci["cnn_minus_knn"][0] <= 0 <= ci["cnn_minus_knn"][1] else ""))
    ctrl = max(ci.get("knn_shuffled", [0, 0])[1], ci.get("cnn_shuffled", [0, 0])[1], b["majority"])
    for k in ("knn", "cnn"):
        if k in ci:
            verdict = "clears" if ci[k][0] > ctrl else "does NOT clear"
            lines.append(f"    {names[k]} {verdict} the baseline and the control")
    lines += ["", "  place                              windows visits   kNN    CNN   control(CNN)"]
    for z, v in rep["per_place"].items():
        lines.append(f"  {z:<34} {v['windows']:>7} {v['visits']:>6}  {v['knn']:>4.0%}  {v['cnn']:>5.0%}"
                     f"  {v.get('cnn_shuffled', float('nan')):>6.0%}")
    if rep["listed_apart"]:
        lines.append("  not scored (too few testable windows or visits): " + ", ".join(
            f"{z} ({v['windows']} w, {v['visits']} v)" for z, v in rep["listed_apart"].items()))
    cal = rep.get("cnn_calibration_held_out")
    if cal:
        lines.append(f"  CNN calibration on the held-out {by}s: temperature {', '.join(map(str, cal['temperature']))}; "
                     f"ECE {cal['ece_before']:.1%} -> {cal['ece_after']:.1%}, NLL {cal['nll_before']:.2f} -> "
                     f"{cal['nll_after']:.2f} (argmax, so accuracy, unchanged)")
    if rep.get("note"):
        lines.append("  " + rep["note"])
    return "\n".join(lines)


def format_half(rep: dict) -> str:
    if "error" in rep:
        return "  " + rep["error"]
    w = rep["windows"]
    to = rep.get("trained_on", {})
    lines = [f"  50/50 split: {w['train']} windows to train, {w['test']} to verify  (chance {rep['chance']:.0%})",
             f"  trained on {to.get('windows')} after the per-place cap; CNN kept epoch {to.get('cnn_best_epoch')}"
             f" (chosen on {to.get('early_stop_windows')} windows held back from training)",
             f"  kNN {rep['knn']:.0%}   CNN {rep['cnn']:.0%}    (always saying '{rep['majority']['place']}': "
             f"{rep['majority']['acc']:.0%}; a model must beat that)",
             f"  balanced (each place counts the same): kNN {rep['balanced']['knn']:.0%}   CNN {rep['balanced']['cnn']:.0%}", "",
             "  place                          windows   kNN    CNN"]
    for z, v in rep["per_zone"].items():
        lines.append(f"  {z:<30} {v['windows']:>7}  {v['knn']:>4.0%}  {v['cnn']:>5.0%}")
    if rep["history"]:
        h = rep["history"]
        lines += ["", "  CNN training (epoch: loss, train acc, verify acc)"]
        for e in h[::max(1, len(h) // 6)] + ([h[-1]] if len(h) % 6 else []):
            lines.append(f"    {e['epoch']:>3}: {e['loss']:.3f}  {e['train_acc']:.0%}  {e['val_acc']:.0%}")
    if rep.get("not_in_training"):
        lines.append(f"  never in the training half (can't be learned yet): {rep['not_in_training']}")
    cal = rep.get("calibration")
    if cal:
        lines.append(f"  CNN temperature {cal['temperature']} (on the early-stopping windows): "
                     f"ECE {cal['ece_before']:.1%} -> {cal['ece_after']:.1%}")
    if rep.get("note"):
        lines.append("  " + rep["note"])
    return "\n".join(lines)


def plot_history(rep: dict, out: str) -> str:
    """The training record as a picture: loss, train vs verify accuracy, gradient size per layer."""
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    h = rep["history"]
    ep = [e["epoch"] for e in h]
    fig, ax = plt.subplots(1, 3, figsize=(14, 4))
    ax[0].plot(ep, [e["loss"] for e in h], color="black")
    ax[0].set_title("loss (how wrong, on training batches)", fontsize=10)
    ax[1].plot(ep, [e["train_acc"] for e in h], label="train half")
    ax[1].plot(ep, [e["val_acc"] for e in h], label="verify half")
    ax[1].axhline(rep["chance"], color="grey", ls="--", lw=1, label="chance")
    ax[1].set_ylim(0, 1.02)
    ax[1].legend(fontsize=8)
    ax[1].set_title("accuracy: a widening gap = memorising, not learning", fontsize=10)
    for k in h[0]["grad"]:
        ax[2].plot(ep, [e["grad"][k] for e in h], label=k)
    ax[2].set_yscale("log")
    ax[2].legend(fontsize=8)
    ax[2].set_title("gradient size per layer (how hard backprop pushed it)", fontsize=10)
    for a in ax:
        a.set_xlabel("epoch")
    fig.tight_layout()
    fig.savefig(out, dpi=100)
    plt.close(fig)
    return out
