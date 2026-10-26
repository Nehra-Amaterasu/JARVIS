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

import copy
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
            p = decode_packet(fr)
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
    """One session's raw.akr as (host end time, window) pairs, unlabelled."""
    return list(windows(akr_stream(os.path.join(folder, "raw.akr"))))


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


def evaluate_half(days: dict, epochs: int = 30) -> dict:
    """Every labelled window there is, 50 % to train and 50 % to verify (half_split per
    day, so each day's own drift is on both sides). kNN and CNN, per-zone accuracy, a
    confusion table, and the CNN's epoch-by-epoch training record."""
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
    fit_idx = cap_per_place(np.flatnonzero(tr), y, t)
    # the CNN's early-stopping check is carved from the TRAINING half (by visits again),
    # so the verify half never decides anything
    inner_a, inner_b = half_split(t[fit_idx], y[fit_idx])
    use_stop = len(set(y[fit_idx][inner_b].tolist())) >= 2
    fit_cnn = fit_idx[inner_a] if use_stop else fit_idx
    stop_idx = fit_idx[inner_b] if use_stop else np.array([], int)
    knn = KnnFingerprint().fit(X[fit_idx], y[fit_idx])
    cnn = CnnFingerprint(epochs=epochs).fit(X[fit_cnn], y[fit_cnn], X[te], y[te],
                                            X[stop_idx] if use_stop else None, y[stop_idx] if use_stop else None)
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
            "trained_on": {"windows": int(len(fit_idx)), "capped_from": int(tr.sum()),
                           "cnn_best_epoch": cnn.best_epoch, "early_stop_windows": int(len(stop_idx))},
            "note": ("one session: the test half is the same day, so this is an upper bound; "
                     "only held-out DAYS say how it does tomorrow") if len(days) < 2 else None}


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
