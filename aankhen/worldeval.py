"""Does the world model earn its place? Its surprise against human-band energy, and its
embedding against the hand-made features, on labelled data it never trained on.

    python -m aankhen worldmodel eval [RECORDING.akr ...] --out MODEL [--json REPORT]
    (default: every learn-my-room session, teach-room-*.akr, as roomtrain.py)

(a) SURPRISE. Every learn.py window (3 s, a 0.5 s hop) that lies wholly inside a labelled
    step gets the current detector's number (HBE, learn.FEATURES "log_hbe", in units of
    its own noise) and the world model's: the mean error of its six 0.5 s predictions over
    the same 3 s, with the no-network predictors alongside (the change energy itself, and
    a 1 s linear autoregression). AUC = the chance a window from the first group scores
    above one from the second (0.5: no better than a coin; below 0.5: the wrong way round).
    Neighbouring windows share 2.5 of their 3 s, so the 95 % intervals resample whole 3 s
    blocks, not windows.
(b) FEATURES. roomtrain.py's protocol, unchanged: leave one session out with two or more
    sessions; the last 30 % of every (zone, activity) stretch held out within a session.
    Zone and activity models trained on learn.FEATURES, FEATURES + the 16-number embedding,
    the embedding alone, and FEATURES + surprise; scored by roomtrain.score.
The world model must not have seen the scored sessions (its meta lists what it trained
on): a session in its training set is flagged, because its numbers would flatter it.
"""
from __future__ import annotations

import glob
import json
import os
from dataclasses import dataclass, field
from typing import Optional

import numpy as np

from . import DATA_DIR
from .csi import Sample
from .learn import ACTIVITIES, CLASSES, FEATURES, FeatureStream, recording_run, train, train_activity
from .roomtrain import _time_split, score
from . import worldmodel as wm

HBE_COL = FEATURES.index("log_hbe")             # log10 of human-band energy (learn._log)
SPAN_S = 3.0                                    # learn.py's window: the last 3 s
FIRSTLIGHT_ACTIVITY = {"still": "still", "move": "waving", "walk": "walking", "type": "typing"}
BLOCK = 6                                       # windows per independent 3 s block
CONTRASTS = [
    # name, first group (should score higher), second group; by step (learn-my-room) or activity
    ("still vs typing", ("activity", ["typing"]), ("activity", ["still"])),
    ("still vs waving", ("activity", ["waving"]), ("activity", ["still"])),
    ("still vs walking", ("activity", ["walking"]), ("activity", ["still"])),
    ("in-room vs away", ("in_room", [True]), ("step", ["away"])),
    ("desk_still vs away", ("step", ["desk_still"]), ("step", ["away"])),
    ("bed_still vs bed_wave", ("step", ["bed_wave"]), ("step", ["bed_still"])),
]


# ======================================================================= sessions
@dataclass
class Session:
    """The labelled windows of one session (one round of one recording), as learn.py sees
    them, with the world-model frame at each window's end."""
    name: str
    path: str
    X: np.ndarray                      # learn.FEATURES
    y: np.ndarray                      # zone class (learn.CLASSES); "" where none is defined
    activity: np.ndarray
    step: np.ndarray
    inside: np.ndarray                 # the window's whole 3 s lies inside its step
    t: np.ndarray                      # seconds from the first sample (learn.recording_run's t)
    frame: np.ndarray                  # picture frame at the window's end (causal: ends at or before it)
    out: dict = field(default_factory=dict)

    @property
    def hbe(self) -> np.ndarray:
        return 10.0 ** self.X[:, HBE_COL]

    @property
    def in_room(self) -> np.ndarray:
        return np.isin(self.step, ["away"], invert=True) & (self.step != "")

    def run(self, X: Optional[np.ndarray] = None) -> dict:
        """As roomtrain.py's run dicts (learn.recording_run, one round)."""
        return {"X": self.X if X is None else X, "y": self.y, "activity": self.activity, "t": self.t,
                "engine": np.array([]), "round": np.ones(len(self.y), int)}


def _frames_for(st: wm.Stream, pic: wm.Picture, rel: np.ndarray) -> np.ndarray:
    """The picture frame for windows ending `rel` seconds after the stream's first sample:
    the last frame whose samples all came before or at the window's last sample."""
    k = np.searchsorted(st.t - st.t[0], rel - 1e-6)
    k = np.minimum(k, len(st.t) - 1)
    if np.abs((st.t[k] - st.t[0]) - rel).max() > 1e-4:
        raise RuntimeError("learn.py's windows and this replay do not line up")
    return np.searchsorted(pic.sample, k, side="right") - 1


def _steps(segs: list, rel: np.ndarray, start_key: str = "start", end_key: str = "end",
           name_key: str = "step") -> tuple[np.ndarray, np.ndarray]:
    """Step of each window (by its end) and whether its whole 3 s is inside the step."""
    step = np.full(len(rel), "", dtype=object)
    inside = np.zeros(len(rel), bool)
    for g in segs:
        m = (rel >= g[start_key]) & (rel < g[end_key])
        step[m] = g.get(name_key) or g.get("label")
        inside |= m & (rel - SPAN_S >= g[start_key])
    return step.astype(str), inside


def learn_my_room_sessions(path: str, st: wm.Stream, pic: wm.Picture) -> list[Session]:
    """learn.recording_run's windows and labels (exactly roomtrain's), split by round."""
    rr = recording_run(path)
    segs = json.load(open(path[:-4] + ".labels.json", encoding="utf-8"))["segments"]
    step, inside = _steps(segs, rr["t"])
    frame = _frames_for(st, pic, rr["t"])
    out = []
    for rnd in sorted(set(rr["round"].tolist())):
        m = rr["round"] == rnd
        out.append(Session(f"{os.path.basename(path)[11:-4]} r{rnd}", path, rr["X"][m], rr["y"][m],
                           rr["activity"][m], step[m], inside[m], rr["t"][m], frame[m]))
    return out


def feature_windows(st: wm.Stream) -> tuple[np.ndarray, np.ndarray]:
    """learn.FeatureStream over a replayed stream, fed as recording_run feeds it (the
    room's calibration as reference, each sample with its packet's RSSI): (X, sample index
    of each window's end)."""
    from .motion import Baseline
    base = Baseline.load(os.path.join(DATA_DIR, "baseline.json"))
    fs = FeatureStream(ref=base.ref if base else None)
    X, ks = [], []
    for i in range(len(st.t)):
        lv = None if st.level is None or not np.isfinite(st.level[i]) else float(st.level[i])
        v = fs.push(Sample(float(st.t[i]), st.amp[i].astype(float), bool(st.filled[i]), lv), st.rssi[i])
        if v is not None:
            X.append(v)
            ks.append(i)
    return np.asarray(X).reshape(-1, len(FEATURES)), np.asarray(ks, int)


def firstlight_session(path: str, st: wm.Stream, pic: wm.Picture) -> Session:
    """A first-light test (firstlight.py): steps by HOST time, as firstlight.analyse tags
    them (a window counts once its 3 s span is inside the step). still / move / walk /
    type at the desk become the activities still / waving / walking / typing."""
    segs = json.load(open(path[:-4] + ".labels.json", encoding="utf-8"))["segments"]
    X, ks = feature_windows(st)
    host = st.t[ks] - st.host_offset
    step, inside = _steps(segs, host, "start_host", "end_host", "label")
    keep = step != ""
    act = np.array([FIRSTLIGHT_ACTIVITY.get(s, "none") for s in step])
    zone = np.where(step == "walk", "room", "desk")
    frame = np.searchsorted(pic.sample, ks, side="right") - 1
    rel = st.t[ks] - st.t[0]
    return Session("firstlight " + os.path.basename(path)[11:-4], path, X[keep], zone[keep], act[keep],
                   step[keep], inside[keep], rel[keep], frame[keep])


def load_sessions(paths: list[str], phase: bool) -> tuple[list[Session], dict]:
    """Labelled sessions of each recording, and its picture (path -> Picture)."""
    sessions, pics = [], {}
    for p in paths:
        st = wm.replay(p, phase=phase)
        pic = wm.change_picture(st, phase=phase)
        pics[p] = pic
        src = json.load(open(p[:-4] + ".labels.json", encoding="utf-8")).get("source")
        sessions += learn_my_room_sessions(p, st, pic) if src == "learn-my-room" else (
            [firstlight_session(p, st, pic)] if src == "firstlight" else [])
    return sessions, pics


# ======================================================================= model outputs
def score_model(model: wm.WorldModel, sessions: list[Session], pics: dict) -> None:
    """Per window: surprise over the 3 s span ("*_3s") and of the last 0.5 s ("net_05"),
    for the network and the no-network predictors, and the 16-number embedding."""
    cache = {}
    for s in sessions:
        if s.path not in cache:
            cache[s.path] = wm.surprise(model, pics[s.path])
        sp = cache[s.path]
        for key in [k for k in sp if k != "ends"]:
            s.out[key.replace("_amp", "") + "_3s"] = wm.window_surprise(sp, s.frame, key)
        s.out["net_05"] = wm.window_surprise(sp, s.frame, "net_amp", blocks=1)
        s.out["emb"] = wm.embed(model, pics[s.path], s.frame)


# ======================================================================= (a) surprise
def auc(pos: np.ndarray, neg: np.ndarray) -> float:
    """P(pos > neg) + P(tie) / 2, by ranks."""
    from scipy.stats import rankdata
    r = rankdata(np.concatenate([pos, neg]))
    n1, n0 = len(pos), len(neg)
    return float((r[:n1].sum() - n1 * (n1 + 1) / 2) / (n1 * n0))


def _blocks(idx: np.ndarray) -> list[np.ndarray]:
    """Consecutive windows cut into BLOCK-long runs: overlapping windows share data, whole
    blocks do not (much)."""
    out, run = [], [idx[0]] if len(idx) else []
    for a, b in zip(idx[:-1], idx[1:]):
        if b == a + 1 and len(run) < BLOCK:
            run.append(b)
        else:
            out.append(np.array(run))
            run = [b]
    if run:
        out.append(np.array(run))
    return out


def auc_ci(score_: np.ndarray, pos: np.ndarray, neg: np.ndarray, reps: int = 2000,
           seed: int = 0) -> tuple[float, float, float]:
    """AUC and a 95 % block-bootstrap interval (blocks resampled within each group)."""
    pi, ni = np.flatnonzero(pos), np.flatnonzero(neg)
    a = auc(score_[pi], score_[ni])
    bp, bn = _blocks(pi), _blocks(ni)
    rng = np.random.default_rng(seed)
    boots = []
    for _ in range(reps):
        p = np.concatenate([bp[i] for i in rng.integers(0, len(bp), len(bp))])
        n = np.concatenate([bn[i] for i in rng.integers(0, len(bn), len(bn))])
        boots.append(auc(score_[p], score_[n]))
    lo, hi = np.percentile(boots, [2.5, 97.5])
    return a, float(lo), float(hi)


def _group(s: Session, spec: tuple) -> np.ndarray:
    key, vals = spec
    col = {"activity": s.activity, "step": s.step, "in_room": s.in_room}[key]
    return np.isin(col, vals)


def detectors(s: Session) -> dict:
    """Every per-window score compared: HBE and the surprise family (3 s spans)."""
    d = {"HBE": s.hbe}
    for k in ("net_3s", "net_05", "linear_3s", "zero_3s", "net_phase_3s", "linear_phase_3s"):
        if k in s.out:
            d[k] = s.out[k]
    return d


def contrast_table(sessions: list[Session], reps: int = 2000) -> list[dict]:
    """AUC per contrast and detector, on the same windows for every detector (a window
    missing any score is dropped for all), per session."""
    rows = []
    for s in sessions:
        dets = detectors(s)
        ok = s.inside & np.all([np.isfinite(v) for v in dets.values()], axis=0)
        for name, hi, lo in CONTRASTS:
            pos, neg = _group(s, hi) & ok, _group(s, lo) & ok
            if pos.sum() < 4 or neg.sum() < 4:
                continue
            row = {"session": s.name, "contrast": name, "n_high": int(pos.sum()), "n_low": int(neg.sum())}
            for d, v in dets.items():
                a, l, h = auc_ci(v, pos, neg, reps)
                row[d] = {"auc": round(a, 3), "ci": [round(l, 3), round(h, 3)]}
            rows.append(row)
    return rows


def step_table(sessions: list[Session]) -> list[dict]:
    """Mean and median of every detector per labelled step (inside windows), and each as a
    multiple of the session's still level (desk_still, or firstlight's still step)."""
    rows = []
    for s in sessions:
        dets = detectors(s)
        ok = s.inside & np.all([np.isfinite(v) for v in dets.values()], axis=0)
        ref_step = "desk_still" if (s.step == "desk_still").any() else "still"
        ref = {d: np.median(v[ok & (s.step == ref_step)]) if (ok & (s.step == ref_step)).any() else np.nan
               for d, v in dets.items()}
        for st in dict.fromkeys(s.step[ok].tolist()):
            m = ok & (s.step == st)
            row = {"session": s.name, "step": st, "windows": int(m.sum())}
            for d, v in dets.items():
                row[d] = {"mean": round(float(v[m].mean()), 3), "median": round(float(np.median(v[m])), 3),
                          "x_still": round(float(np.median(v[m]) / ref[d]), 2) if np.isfinite(ref[d]) else None}
            rows.append(row)
    return rows


# ======================================================================= (b) features
def variants(s: Session) -> dict:
    """The feature sets compared. Surprise enters as log10 (it spans decades)."""
    F, E = s.X, s.out["emb"]
    S = np.log10(np.c_[s.out["net_3s"], s.out["net_05"]] + 1e-9)
    return {"FEATURES": F, "FEATURES+emb": np.c_[F, E], "emb": E, "FEATURES+surprise": np.c_[F, S]}


def _scored(train_s: list[Session], test: Session, name: str, train_X: list, test_X: np.ndarray) -> dict:
    zm = train([s.run(X) for s, X in zip(train_s, train_X)], note=f"worldeval {name}")
    am = train_activity([s.run(X) for s, X in zip(train_s, train_X)], note=f"worldeval {name}")
    sc = score(zm, am, test.run(test_X))
    inside = test.activity != "none"
    said = _activity_said(am, test_X)
    sc["activity_matrix"] = {t: {p: int(((test.activity == t) & (said == p) & inside).sum()) for p in ACTIVITIES[1:]}
                             for t in ACTIVITIES[1:]}
    return {k: v for k, v in sc.items() if k not in ("zone_confusion", "activity_confusion")}


def _activity_said(am, X: np.ndarray) -> np.ndarray:
    """roomtrain.score's activity decision: probabilities smoothed 0.5 / 0.5 over steps."""
    sm, prev = [], None
    for a in am.proba(X):
        prev = a if prev is None else 0.5 * prev + 0.5 * a
        sm.append(prev)
    return np.array([ACTIVITIES[i] for i in np.argmax(sm, axis=1)])


PURGE = 6          # 3 s of 0.5 s hops: a test window this close to the cut shares samples with training


def _held_tail(run: dict, purge: int) -> dict:
    """roomtrain._time_split's held-out part (the last HELD_OUT_SHARE of every (zone,
    activity) stretch), minus its first `purge` windows per stretch. Windows are 3 s long and
    hop 0.5 s, so without the purge the first ~5 held-out windows of every stretch share
    0.5-2.5 s of samples with the last training ones."""
    from .roomtrain import HELD_OUT_SHARE, _subset
    test = np.zeros(len(run["y"]), bool)
    keys = np.char.add(run["y"].astype(str), run["activity"].astype(str))
    for k in np.unique(keys):
        idx = np.flatnonzero(keys == k)
        test[idx[int(len(idx) * (1 - HELD_OUT_SHARE)) + purge:]] = True
    return _subset(run, test)


def feature_comparison(sessions: list[Session]) -> dict:
    """roomtrain's protocol for every feature set: leave one session out (two or more
    learn-my-room sessions) and, within each session, the last 30 % of every stretch."""
    rooms = [s for s in sessions if (s.y != "").all() and "firstlight" not in s.name]
    out: dict = {"leave_one_session_out": [], "time_split": []}
    for name in variants(rooms[0]) if rooms else []:
        if len(rooms) >= 2:
            for i, held in enumerate(rooms):
                tr = [s for j, s in enumerate(rooms) if j != i]
                sc = _scored(tr, held, name, [variants(s)[name] for s in tr], variants(held)[name])
                out["leave_one_session_out"].append({"features": name, "test": held.name, **sc})
        for s in rooms:
            full = s.run(variants(s)[name])
            full["name"] = s.name
            tr, _ = _time_split(full)
            zm = train([tr], note=f"worldeval {name}")
            am = train_activity([tr], note=f"worldeval {name}")
            for proto, te in (("time_split", _held_tail(full, 0)), ("time_split_purged", _held_tail(full, PURGE))):
                sc = score(zm, am, te)
                said = _activity_said(am, te["X"])
                inside = te["activity"] != "none"
                sc["activity_matrix"] = {t: {p: int(((te["activity"] == t) & (said == p) & inside).sum())
                                             for p in ACTIVITIES[1:]} for t in ACTIVITIES[1:]}
                sc["blocks_3s"] = int(np.ceil(len(te["y"]) / BLOCK))
                out.setdefault(proto, []).append({"features": name, "test": s.name,
                                                  **{k: v for k, v in sc.items() if k not in ("zone_confusion", "activity_confusion")}})
    return out


# ======================================================================= report
def evaluate(model: wm.WorldModel, paths: list[str], reps: int = 2000, features: bool = True) -> dict:
    """The whole report for one world model on labelled recordings. OpenMP is held to one
    thread: on the owner's laptop, with the app using ~5 of 12 threads, a gradient-boosted
    fit took 139 s with 3 OpenMP threads (spinning on each other) and 9.7 s with one."""
    from threadpoolctl import threadpool_limits
    with threadpool_limits(limits=1):
        return _evaluate(model, paths, reps, features)


def _evaluate(model: wm.WorldModel, paths: list[str], reps: int, features: bool) -> dict:
    sessions, pics = load_sessions(paths, model.phase)
    score_model(model, sessions, pics)
    seen = set(model.meta.get("recordings", []))
    rep = {"model": {k: v for k, v in model.meta.items() if k != "history"},
           "scored": [s.name for s in sessions],
           "seen_in_training": sorted({os.path.basename(s.path) for s in sessions} & seen),
           "windows": {s.name: {"labelled": int(len(s.y)), "inside_steps": int(s.inside.sum())} for s in sessions},
           "steps": step_table(sessions), "contrasts": contrast_table(sessions, reps)}
    if features:
        rep["features"] = feature_comparison(sessions)
    return rep


def default_paths() -> list[str]:
    return sorted(glob.glob(os.path.join(DATA_DIR, "recordings", "teach-room-*.akr")))


def print_report(rep: dict) -> None:
    m = rep["model"]
    print(f"world model: {m.get('kind')} {'amplitude+phase' if m.get('phase') else 'amplitude'}, "
          f"{m.get('parameters')} parameters, {m.get('minutes_of_data')} min of pictures from "
          f"{len(m.get('recordings', []))} recordings")
    if rep["seen_in_training"]:
        print(f"  WARNING: trained on scored recordings {rep['seen_in_training']}: these numbers flatter it")
    print("\n(a) per step, inside windows: median (x the still step)")
    dets = [d for d in ("HBE", "net_3s", "linear_3s", "zero_3s", "net_phase_3s") if rep["steps"] and d in rep["steps"][0]]
    print(f"{'session':22s} {'step':11s} {'win':>4s} " + " ".join(f"{d:>17s}" for d in dets))
    for r in rep["steps"]:
        print(f"{r['session'][:22]:22s} {r['step']:11s} {r['windows']:4d} " +
              " ".join(f"{r[d]['median']:9.2f} ({r[d]['x_still'] or 0:4.1f}x)" for d in dets))
    print("\n    AUC [95 % block-bootstrap interval]")
    dets = [d for d in ("HBE", "net_3s", "net_05", "linear_3s", "zero_3s", "net_phase_3s") if rep["contrasts"] and d in rep["contrasts"][0]]
    print(f"{'session':22s} {'contrast':22s} " + " ".join(f"{d:>19s}" for d in dets))
    for r in rep["contrasts"]:
        print(f"{r['session'][:22]:22s} {r['contrast']:22s} " +
              " ".join(f"{r[d]['auc']:5.2f} [{r[d]['ci'][0]:.2f}-{r[d]['ci'][1]:.2f}]" for d in dets))
    if "features" not in rep:
        return
    pct = lambda v: "    -" if v is None else f"{100 * v:5.1f}"
    for proto, rows in rep["features"].items():
        if not rows:
            continue
        print(f"\n(b) {proto.replace('_', ' ')}: in-room vs not / zone when in / activity when in (%)")
        for r in rows:
            print(f"  {r['features']:18s} test {r['test'][:20]:20s} {pct(r['occupancy'])} {pct(r.get('zone'))} "
                  f"{pct(r.get('activity'))}   (rule {pct(r.get('activity_rule'))})")
