"""Spatial model learned from data: is someone in THIS room, and where?

WHY A LEARNED MODEL
  One Wi-Fi link measures one channel. Physics (rf.py, physics.py) says how much a
  person moves it, but not where they are: a walker by the router at the main door
  moves your link 2.5x more than you crossing your own room, and the hand-written
  detector cannot tell the two apart (house scenario: room "occupied" 100 % of the
  time while only the family moved about). What CAN tell them apart is pattern:
  how the change is spread over the smooth subcarrier patterns, at what speeds,
  for how long, what came before. A model trained on THIS home's data learns those
  patterns; nothing hand-written would.

WHAT IT PREDICTS (every 0.5 s)
  empty    nobody in the room and nobody moving near the link
  outside  the room is empty, but someone moves outside it (passage, living room)
  room     someone in the room, not at the desk or in bed (walking, standing)
  desk     someone at the desk
  bed      someone in bed
  A hidden Markov filter then applies what a person can physically do: nobody
  jumps from the desk into bed without crossing the room, and nobody appears in the
  room without coming in.

WHERE THE DATA COMES FROM
  - the simulator: random days in your room and house (simulator.scenario_life),
    with the exact truth. This only proves the method on the simulator's physics.
  - your real recordings: `python -m aankhen validate` sessions (empty, desk, bed,
    walk, hallway) and `python -m aankhen record --label ...` files. A model trained
    on these is the one to trust; `learn eval` reports it on recordings it never saw.
  Models and datasets live in aankhen/models/ (git-ignored): they describe your home.
"""
from __future__ import annotations

import json
import math
import os
import time
from collections import deque
from concurrent.futures import ProcessPoolExecutor
from dataclasses import dataclass
from typing import Iterable, Optional

import numpy as np

from . import DATA_DIR
from .csi import CsiConditioner, Sample
from .fan import FanLines
from .motion import HBE_BAND_HZ, _bridge_gaps, _smooth_basis, human_band_energy, turbulence
from .protocol import CsiPacket, StreamDecoder, decode_packet
from .room import Room

CLASSES = ["empty", "outside", "room", "desk", "bed"]
OCCUPIED = {"room", "desk", "bed"}
HOP_S = 0.5
MODEL_DIR = os.path.join(DATA_DIR, "models")      # data/aankhen/models, git-ignored
MODEL_FILE = os.path.join(MODEL_DIR, "spatial.joblib")

SUB_BANDS = [(0.4, 1.0), (1.0, 2.0), (2.0, 4.0), (4.0, 10.0)]
FEATURES = (["log_mvs", "log_level_var", "log_hbe", "log_hbe_recent"]
            + [f"log_p{j}" for j in range(6)]
            + [f"log_band_{lo:g}_{hi:g}" for lo, hi in SUB_BANDS]
            + [f"shape_dev{j}" for j in range(1, 6)]
            + ["level_dev_db", "rssi_dev",
               "ctx_max_hbe_5s", "ctx_mean_hbe_30s", "ctx_frac_active_30s", "ctx_since_strong_s",
               "ctx_active_run_s", "ctx_max_hbe_120s", "fan_on"])


def _log(v: Optional[float]) -> float:
    return math.log10(v + 1e-9) if v is not None and np.isfinite(v) else float("nan")


class FeatureStream:
    """CSI samples in, one feature vector every HOP_S out (see FEATURES).

    Window features come from the last 1 s (MVS, level) and 3 s (human-band energy
    per smooth pattern, sub-band powers). Shape and level deviations are measured
    against a slow reference (tau 30 min) that only follows quiet windows. Context
    features summarise the last 5-120 s: a passer-by is a short burst with nothing
    after it; someone who came in keeps producing small movements.
    """

    def __init__(self, rate_hz: float = 100.0):
        self.rate = rate_hz
        self.n1, self.n3 = int(rate_hz), int(3 * rate_hz)
        self.hop = int(HOP_S * rate_hz)
        self.amps: deque = deque(maxlen=self.n3)
        self.filled: deque = deque(maxlen=self.n3)
        self.turb: deque = deque(maxlen=self.n1)
        self.level: deque = deque(maxlen=self.n1)
        self.fan = FanLines()
        self.ref_shape: Optional[np.ndarray] = None
        self.ref_level: Optional[float] = None
        self.ref_rssi: Optional[float] = None
        self.hist: deque = deque(maxlen=int(120 / HOP_S))
        self.k = 0
        self.t = 0.0
        self.last_strong: Optional[float] = None
        self.active_since: Optional[float] = None

    def push(self, s: Sample, rssi: Optional[float] = None, fan_on: bool = False) -> Optional[np.ndarray]:
        tb = turbulence(s.amp)
        self.fan.push(tb)
        self.amps.append(s.amp)
        self.filled.append(s.filled)
        self.turb.append(tb)
        self.level.append(s.level_db if s.level_db is not None else np.nan)
        self.k += 1
        self.t = s.t
        if len(self.amps) < self.n3 or self.k % self.hop:
            return None
        return self._features(rssi, fan_on)

    def _features(self, rssi: Optional[float], fan_on: bool) -> np.ndarray:
        A = np.stack(self.amps)
        F = np.fromiter(self.filled, bool)
        tb = np.fromiter(self.turb, float)
        mvs = self.fan.residual_variance(tb) if self.fan.locked else float(tb.var())
        y = np.fromiter(self.level, float)
        lv = None
        if np.all(np.isfinite(y)):
            tt = np.arange(y.size) - (y.size - 1) / 2
            yy = y - y.mean()
            yy = yy - tt * (tt @ yy) / (tt @ tt)
            lv = float(yy.var())
        r = human_band_energy(A, F, self.rate, fan=self.fan if self.fan.locked else None, detail=True)
        hbe, per, recent = (None, np.full(6, np.nan), None) if r is None else r
        bands = self._sub_bands(A, F)
        C = A[-self.n1:] @ _smooth_basis(A.shape[1])
        shape = C.mean(axis=0)
        level = float(np.nanmean(y)) if np.isfinite(y).any() else None
        quiet = hbe is not None and hbe < 1.6 and (lv is None or lv < 0.05)
        a = HOP_S / 1800.0
        if self.ref_shape is None:
            self.ref_shape, self.ref_level, self.ref_rssi = shape.copy(), level, rssi
        elif quiet:
            self.ref_shape = (1 - a) * self.ref_shape + a * shape
            if level is not None and self.ref_level is not None:
                self.ref_level = (1 - a) * self.ref_level + a * level
            if rssi is not None and self.ref_rssi is not None:
                self.ref_rssi = (1 - a) * self.ref_rssi + a * rssi
        dev = (shape - self.ref_shape)[1:]
        level_dev = (level - self.ref_level) if level is not None and self.ref_level is not None else np.nan
        rssi_dev = (rssi - self.ref_rssi) if rssi is not None and self.ref_rssi is not None else np.nan

        hv = hbe if hbe is not None else np.nan
        if np.isfinite(hv) and hv > 6.0:
            self.last_strong = self.t
        if np.isfinite(hv) and hv > 2.0:
            self.active_since = self.active_since if self.active_since is not None else self.t
        else:
            self.active_since = None
        self.hist.append(hv)
        H = np.asarray(self.hist, float)
        last = lambda n: H[-n:][np.isfinite(H[-n:])]
        h5, h30, h120 = last(10), last(60), last(240)
        f = [_log(mvs), _log(lv), _log(hbe), _log(recent)]
        f += [_log(v) for v in per]
        f += [_log(b) for b in bands]
        f += list(dev * 100.0)
        f += [level_dev, rssi_dev,
              _log(h5.max()) if h5.size else np.nan,
              _log(h30.mean()) if h30.size else np.nan,
              float((h30 > 2.0).mean()) if h30.size else np.nan,
              min(self.t - self.last_strong, 600.0) if self.last_strong is not None else 600.0,
              (self.t - self.active_since) if self.active_since is not None else 0.0,
              _log(h120.max()) if h120.size else np.nan,
              1.0 if fan_on else 0.0]
        return np.asarray(f, float)

    def _sub_bands(self, A: np.ndarray, F: np.ndarray) -> list[float]:
        """Human-band-style power of the smooth patterns in each SUB_BANDS range."""
        out = []
        for band in SUB_BANDS:
            v = human_band_energy(A, F, self.rate, band=band, fan=self.fan if self.fan.locked else None)
            out.append(v if v is not None else np.nan)
        return out


# ---------------------------------------------------------------- labels
def zone_label(room: Room, x: float, y: float) -> str:
    z = room.zone_at(x, y)
    if z is not None and z.name in ("desk", "bed"):
        return z.name
    return "room"


def sim_label(sim, t_sim: float) -> str:
    """The answer key at simulation time t."""
    occ = sim.occupants_at(t_sim)
    if occ:
        # The most specific place anyone is in wins: bed, then desk, then elsewhere.
        labels = {zone_label(sim.room, p.x, p.y) for p in occ}
        for c in ("bed", "desk", "room"):
            if c in labels:
                return c
    others = [p for p in sim.truth_at(t_sim) if p.moving]
    return "outside" if others else "empty"


# ---------------------------------------------------------------- datasets
def _packets(chunks: Iterable[bytes]):
    dec = StreamDecoder()
    for ch in chunks:
        for fr in dec.feed(ch):
            p = decode_packet(fr)
            if isinstance(p, CsiPacket):
                yield p
    for fr in dec.flush():
        p = decode_packet(fr)
        if isinstance(p, CsiPacket):
            yield p


def simulate_run(room: Room, seed: int, seconds: float = 600.0, channel_seed: int = 0,
                 family: bool = True, fan: bool = False, with_engine: bool = True) -> dict:
    """One simulated day: features, labels and (for comparison) what today's engine said."""
    from .simulator import Simulator, scenario_life
    rng = np.random.default_rng(seed)
    scn = scenario_life(room, rng, seconds, family=family, fan=fan)
    sim = Simulator(room, scn, seed=seed, channel_seed=channel_seed)
    boot = sim.boot_us / 1e6
    fs, cond = FeatureStream(), CsiConditioner()
    eng = None
    if with_engine:
        from .bench import _offline_engine, simulated_baseline
        eng = _offline_engine(room, "simulation", simulated_baseline(room, channel_seed=channel_seed))
    X, y, base, ts = [], [], [], []
    for p in _packets(sim.chunks(seconds)):
        if eng is not None:
            eng.process(p)
        for s in cond.push(p.timestamp_us / 1e6, p.raw, p.rssi, gain_comp_db=p.gain_comp_db):
            fan_on = bool(scn.fan and scn.fan.relay_on(s.t - boot))
            v = fs.push(s, p.rssi, fan_on)
            if v is None or s.t - boot < 5.0:
                continue
            X.append(v)
            y.append(sim_label(sim, s.t - boot))
            ts.append(s.t - boot)
            if eng is not None:
                st = (eng.frame_message().get("presence") or {}).get("state")
                base.append(st)
    return {"X": np.asarray(X), "y": np.asarray(y), "t": np.asarray(ts), "engine": np.asarray(base),
            "seed": seed, "channel_seed": channel_seed, "fan": fan, "family": family}


def _sim_job(args):
    room_dict, seed, seconds, cs, family, fan = args
    return simulate_run(Room.from_dict(room_dict), seed, seconds, cs, family, fan)


def simulate_dataset(room: Room, runs: int = 24, seconds: float = 600.0, seed0: int = 1000,
                     channel_seeds=(0, 1), workers: int = 1) -> list[dict]:
    rng = np.random.default_rng(seed0)
    jobs = []
    for i in range(runs):
        cs = channel_seeds[i % len(channel_seeds)]
        jobs.append((room.to_dict(), seed0 + i, seconds, cs, bool(rng.random() < 0.8), bool(rng.random() < 0.25)))
    if workers > 1:
        with ProcessPoolExecutor(workers) as ex:
            return list(ex.map(_sim_job, jobs))
    return [_sim_job(j) for j in jobs]


# Recorded sessions: labels from `validate` step names or `record --label`.
STEP_LABEL = {"empty": "empty", "desk": "desk", "bed": "bed", "walk": "room", "hallway": "outside",
              "walking": "room", "standing": "room", "sitting": "desk", "lying": "bed"}


def recording_run(path: str, labels: Optional[list[dict]] = None, label: Optional[str] = None) -> dict:
    """Features of one real recording (.akr) with its labels: either one label for
    the whole file (a validate step) or time segments from a .labels.json."""
    from .transport import iter_recording, read_recording_meta
    if labels is None and label is None:
        lp = path[:-4] + ".labels.json"
        if os.path.exists(lp):
            labels = json.load(open(lp, encoding="utf-8")).get("segments")
        else:
            label = (read_recording_meta(path) or {}).get("label")
    fs, cond = FeatureStream(), CsiConditioner()
    X, y, ts = [], [], []
    t0 = None
    for p in _packets(d for _, d in iter_recording(path)):
        for s in cond.push(p.timestamp_us / 1e6, p.raw, p.rssi, gain_comp_db=p.gain_comp_db):
            t0 = s.t if t0 is None else t0
            v = fs.push(s, p.rssi)
            if v is None:
                continue
            rel = s.t - t0
            lab = None
            if labels:
                for seg in labels:
                    if seg["start"] <= rel < seg["end"]:
                        lab = STEP_LABEL.get(seg["label"])
            elif label:
                lab = STEP_LABEL.get(label)
            if lab is None:
                continue
            X.append(v); y.append(lab); ts.append(rel)
    return {"X": np.asarray(X), "y": np.asarray(y), "t": np.asarray(ts), "engine": np.asarray([]),
            "path": path}


def recorded_dataset(paths: list[str]) -> list[dict]:
    """Validate session folders (session.json) and/or .akr files with labels."""
    runs = []
    for p in paths:
        if os.path.isdir(p) and os.path.exists(os.path.join(p, "session.json")):
            sess = json.load(open(os.path.join(p, "session.json"), encoding="utf-8"))
            for step, f in sess["paths"].items():
                runs.append(recording_run(f, label=step))
        elif p.endswith(".akr"):
            runs.append(recording_run(p))
    return [r for r in runs if len(r["y"])]


# ---------------------------------------------------------------- temporal filter
def transition_matrix() -> np.ndarray:
    """Per 0.5 s step. Rows: from, columns: to, in CLASSES order. What a person can
    do in half a second: stay; come in from outside or from nowhere into the room;
    sit down or lie down only via the room; leave only via the room."""
    i = {c: k for k, c in enumerate(CLASSES)}
    T = np.zeros((5, 5))
    allowed = {"empty": {"outside": 0.006, "room": 0.004},
               "outside": {"empty": 0.006, "room": 0.004},
               "room": {"desk": 0.004, "bed": 0.003, "empty": 0.002, "outside": 0.002},
               "desk": {"room": 0.006},
               "bed": {"room": 0.004}}
    for a, outs in allowed.items():
        for b, p in outs.items():
            T[i[a], i[b]] = p
        T[i[a], i[a]] = 1.0 - sum(outs.values())
    return T


class TemporalFilter:
    """Forward filter of a hidden Markov model over CLASSES. Emissions are the
    classifier's probabilities divided by the training priors (scaled likelihoods)."""

    def __init__(self, priors: np.ndarray):
        self.T = transition_matrix()
        self.priors = np.maximum(priors, 1e-6)
        self.belief = np.full(len(CLASSES), 1.0 / len(CLASSES))

    def step(self, proba: np.ndarray) -> np.ndarray:
        pred = self.belief @ self.T
        lik = np.maximum(proba, 1e-6) / self.priors
        b = pred * lik
        self.belief = b / b.sum()
        return self.belief


# ---------------------------------------------------------------- model
@dataclass
class SpatialModel:
    clf: object
    priors: np.ndarray
    features: list
    trained_on: dict

    def proba(self, X: np.ndarray) -> np.ndarray:
        P = np.zeros((len(X), len(CLASSES)))
        P[:, [CLASSES.index(c) for c in self.clf.classes_]] = self.clf.predict_proba(X)
        return P

    def filtered(self, X: np.ndarray) -> np.ndarray:
        f = TemporalFilter(self.priors)
        return np.stack([f.step(p) for p in self.proba(X)])

    def save(self, path: str = MODEL_FILE) -> None:
        import joblib
        os.makedirs(os.path.dirname(path), exist_ok=True)
        joblib.dump(self, path)

    @staticmethod
    def load(path: str = MODEL_FILE) -> Optional["SpatialModel"]:
        # joblib unpickles, which can run code: load only models this program trained
        # and saved itself on this machine (aankhen/models/), never a downloaded file.
        import joblib
        return joblib.load(path) if os.path.exists(path) else None


def train(runs: list[dict], note: str = "", weights: Optional[list[float]] = None) -> SpatialModel:
    """weights: one per run (your real recordings count more than simulated days)."""
    from sklearn.ensemble import HistGradientBoostingClassifier
    X = np.concatenate([r["X"] for r in runs])
    y = np.concatenate([r["y"] for r in runs])
    w = None if weights is None else np.concatenate([np.full(len(r["y"]), wt) for r, wt in zip(runs, weights)])
    clf = HistGradientBoostingClassifier(max_iter=400, learning_rate=0.06, max_leaf_nodes=31,
                                         l2_regularization=1.0, class_weight="balanced", random_state=0)
    clf.fit(X, y, sample_weight=w)
    counts = np.array([(y == c).sum() for c in CLASSES], float)
    priors = (counts + 1) / (counts.sum() + len(CLASSES))
    # class_weight="balanced" already equalises the classes, so the classifier's own
    # outputs behave like flat-prior posteriors: divide by a flat prior, not the data's.
    flat = np.full(len(CLASSES), 1.0 / len(CLASSES))
    return SpatialModel(clf, flat, list(FEATURES),
                        {"windows": int(len(y)), "runs": len(runs),
                         "classes": {c: int(n) for c, n in zip(CLASSES, counts)},
                         "data_priors": [round(float(v), 4) for v in priors],
                         "when": time.strftime("%Y-%m-%d %H:%M"), "note": note})


def evaluate(model: SpatialModel, runs: list[dict]) -> dict:
    """Window-level results on runs the model never saw: raw classifier, filtered,
    and (simulator runs) today's engine for comparison."""
    y = np.concatenate([r["y"] for r in runs])
    raw = np.concatenate([np.array(CLASSES)[model.proba(r["X"]).argmax(1)] for r in runs])
    filt = np.concatenate([np.array(CLASSES)[model.filtered(r["X"]).argmax(1)] for r in runs])
    eng = np.concatenate([r["engine"] for r in runs]) if all(len(r["engine"]) == len(r["y"]) for r in runs) else None

    def occ_metrics(pred_occ: np.ndarray) -> dict:
        true_occ = np.isin(y, list(OCCUPIED))
        tp = float((pred_occ & true_occ).sum())
        return {"accuracy": float((pred_occ == true_occ).mean()),
                "false_occupied_when_outside": float(pred_occ[y == "outside"].mean()) if (y == "outside").any() else None,
                "false_occupied_when_empty": float(pred_occ[y == "empty"].mean()) if (y == "empty").any() else None,
                "missed_when_occupied": float((~pred_occ[true_occ]).mean()) if true_occ.any() else None,
                "precision": tp / max(pred_occ.sum(), 1), "recall": tp / max(true_occ.sum(), 1)}

    out = {"windows": int(len(y)), "classes": {c: int((y == c).sum()) for c in CLASSES},
           "classifier": {"accuracy": float((raw == y).mean()), **{"occ_" + k: v for k, v in occ_metrics(np.isin(raw, list(OCCUPIED))).items()}},
           "filtered": {"accuracy": float((filt == y).mean()), **{"occ_" + k: v for k, v in occ_metrics(np.isin(filt, list(OCCUPIED))).items()}}}
    occ = np.isin(y, list(OCCUPIED))
    if occ.any():
        out["filtered"]["zone_accuracy_when_occupied"] = float((filt[occ] == y[occ]).mean())
    out["confusion_filtered"] = {t: {p: int(((y == t) & (filt == p)).sum()) for p in CLASSES} for t in CLASSES}
    if eng is not None and len(eng):
        e_occ = np.isin(eng, ["moving", "still"])
        out["today_engine"] = {"occ_" + k: v for k, v in occ_metrics(e_occ).items()}
    return out


def save_runs(runs: list[dict], path: str) -> None:
    os.makedirs(os.path.dirname(os.path.abspath(path)), exist_ok=True)
    np.savez_compressed(path, n=len(runs), **{f"{k}_{i}": r[k] for i, r in enumerate(runs)
                                               for k in ("X", "y", "t", "engine")})


def load_runs(path: str) -> list[dict]:
    d = np.load(path, allow_pickle=False)
    return [{k: d[f"{k}_{i}"] for k in ("X", "y", "t", "engine")} for i in range(int(d["n"]))]
