"""Where am I in the room, learned from the raw Wi-Fi signal: a fingerprint matcher
(kNN) and a small 1D convolutional network (CNN), both scored on days they never saw.

    python -m aankhen fingerprint evaluate    # leave-one-day-out: kNN vs CNN, per day
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


# ---------------------------------------------------------------- windows
def windows(samples: Iterable[tuple[float, np.ndarray, bool]]) -> Iterable[tuple[float, np.ndarray]]:
    """(time, amp[51], filled) at 100 Hz -> (end time, log-amp window [51, 50]). Pure.

    A gap in time (the conditioner restarted its grid) starts a new window, so a
    window never spans two pieces of the stream."""
    buf: deque = deque(maxlen=WIN)
    filled: deque = deque(maxlen=WIN)
    last_t, since = None, 0
    for t, amp, was_filled in samples:
        if last_t is not None and t - last_t > 1.5 / RATE_HZ:
            buf.clear(); filled.clear(); since = 0
        last_t = t
        buf.append(np.log(np.maximum(np.asarray(amp, float), 1e-6)))
        filled.append(bool(was_filled))
        since += 1
        if len(buf) == WIN and since >= HOP:
            since = 0
            if sum(filled) / WIN > MAX_FILLED:
                continue
            w = np.stack(buf, axis=1)                                  # [51, 200]
            yield t, w.reshape(N_SUB, WIN // POOL, POOL).mean(axis=2)  # [51, 50]


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


def session_windows(folder: str) -> list[tuple[float, np.ndarray]]:
    """One session's raw.akr as (host end time, window) pairs, unlabelled."""
    from .csi import CsiConditioner
    from .protocol import CsiPacket, StreamDecoder, decode_packet
    from .transport import iter_recording

    def stream():
        cond, dec = CsiConditioner(), StreamDecoder()
        for host_t, chunk in iter_recording(os.path.join(folder, "raw.akr")):
            for fr in dec.feed(chunk):
                p = decode_packet(fr)
                if isinstance(p, CsiPacket):
                    for s in cond.push(p.timestamp_us / 1e6, p.raw, p.rssi, gain_comp_db=p.gain_comp_db):
                        # host time keeps the labels' clock; the board's clock spaces the samples
                        yield host_t + (s.t - p.timestamp_us / 1e6), s.amp, s.filled
    return list(windows(stream()))


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
        for s, wins, d in first:
            if len(d["zone"]) == 0 or not d["refs"]:
                d = label_windows(wins, s["labels"], fallback_refs=day_refs)
            if len(d["zone"]):
                out.setdefault(day, []).append(d)
    return out


def _cat(runs: list[dict], key: str) -> np.ndarray:
    return np.concatenate([r[key] for r in runs]) if runs else np.asarray([])


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


class CnnFingerprint:
    def __init__(self, epochs: int = 30, seed: int = 0, augment: bool = True):
        self.epochs, self.seed, self.augment = epochs, seed, augment

    def fit(self, X: np.ndarray, y: np.ndarray) -> "CnnFingerprint":
        import torch
        # Tiny tensors: 8 threads spent more time coordinating than computing (one fit:
        # 11.2 s on 8 threads, 0.6 s on 2, 2026-10-26). Same lesson as the sklearn lag fix.
        threads = torch.get_num_threads()
        torch.set_num_threads(min(2, threads))
        try:
            return self._fit(X, y)
        finally:
            torch.set_num_threads(threads)

    def _fit(self, X: np.ndarray, y: np.ndarray) -> "CnnFingerprint":
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
        self.net.train()
        for _ in range(self.epochs):
            order = rng.permutation(len(yi))
            for s in range(0, len(order), 64):
                b = order[s:s + 64]
                xb = Xn[b].copy()
                if self.augment:
                    # a day's drift is mostly a per-subcarrier level change and timing: teach the net to ignore both
                    xb += rng.normal(0, 0.3, (len(b), N_SUB, 1)).astype(np.float32)
                    xb = np.roll(xb, int(rng.integers(-5, 6)), axis=2)
                opt.zero_grad()
                loss = loss_fn(self.net(torch.from_numpy(xb)), torch.from_numpy(yi[b]))
                loss.backward()
                opt.step()
        self.net.eval()
        return self

    def proba(self, X: np.ndarray) -> np.ndarray:
        import torch
        with torch.no_grad():
            z = self.net(torch.from_numpy(((X - self.mu) / self.sd).astype(np.float32)))
            return torch.softmax(z, dim=1).numpy()

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
                       "input": [N_SUB, WIN // POOL], "window_s": WIN / RATE_HZ, **(meta or {})}, f, indent=2)
        with open(os.path.join(root, "current.json"), "w", encoding="utf-8") as f:
            json.dump({"version": version}, f)
        return out


# ---------------------------------------------------------------- judged by days
def leave_one_day_out(days: dict, epochs: int = 30) -> dict:
    """For each day: train both models on the OTHER days, score zone accuracy on this one."""
    names = sorted(days)
    per_day = {}
    for d in names:
        train = [r for k in names if k != d for r in days[k]]
        X, y = _cat(train, "X"), _cat(train, "zone")
        Xt, yt = _cat(days[d], "X"), _cat(days[d], "zone")
        if len(set(y.tolist())) < 2 or not len(yt):
            per_day[d] = {"error": "need at least two zones in the other days"}
            continue
        knn = KnnFingerprint().fit(X, y)
        cnn = CnnFingerprint(epochs=epochs).fit(X, y)
        per_day[d] = {"windows": int(len(yt)),
                      "knn": round(float((knn.predict(Xt) == yt).mean()), 4),
                      "cnn": round(float((cnn.predict(Xt) == yt).mean()), 4),
                      "chance": round(1 / len(set(y.tolist())), 4)}
    ok = [v for v in per_day.values() if "knn" in v]
    mean = {m: round(float(np.mean([v[m] for v in ok])), 4) for m in ("knn", "cnn")} if ok else {}
    return {"days": names, "per_day": per_day, "mean": mean,
            "winner": max(mean, key=mean.get) if mean else None,
            "note": None if len(names) >= 3 else "fewer than 3 days: these numbers say little; keep drilling"}


def format_report(rep: dict) -> str:
    lines = ["held-out day      windows   kNN     CNN     chance"]
    for d in rep["days"]:
        v = rep["per_day"].get(d, {})
        if "error" in v:
            lines.append(f"{d:<16}  {v['error']}")
        elif v:
            lines.append(f"{d:<16}  {v['windows']:>7}   {v['knn']:.0%}   {v['cnn']:.0%}   {v['chance']:.0%}")
    if rep["mean"]:
        lines.append(f"mean              kNN {rep['mean']['knn']:.0%}   CNN {rep['mean']['cnn']:.0%}   winner: {rep['winner']}")
    if rep.get("note"):
        lines.append(rep["note"])
    return "\n".join(lines)
