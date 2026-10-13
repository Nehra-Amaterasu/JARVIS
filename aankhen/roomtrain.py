"""Train where-I-am and what-I-am-doing on my own room (learn-my-room sessions).

    python -m aankhen.roomtrain [--no-install] [RECORDING.akr ...]   (default: every teach-room-*.akr)

Honest scoring first, the way the models will meet tomorrow: LEAVE ONE SESSION OUT
(train on every other session, score on the one left out). With a single session,
the last 30 % of every step is held out instead. A training-free rule on human-band
energy is scored alongside, so it is visible whether learning adds anything.
Then both models are retrained on everything and installed (unless --no-install);
the replaced ones go to models/previous/.
Zones: empty / outside / room / desk / bed. Activities: still / typing / waving / walking.
"""
from __future__ import annotations

import glob
import os
import shutil
import sys
import time

import numpy as np

from . import DATA_DIR
from .learn import (ACTIVITIES, ACTIVITY_FILE, CLASSES, FEATURES, MODEL_DIR, MODEL_FILE, OCCUPIED,
                    TemporalFilter, load_runs, recording_run, train, train_activity)

REAL_WEIGHT = 5.0
HELD_OUT_SHARE = 0.3


def _subset(run: dict, mask: np.ndarray) -> dict:
    return {k: (v[mask] if isinstance(v, np.ndarray) and len(v) == len(mask) else v) for k, v in run.items()}


def _confusion(truth, said, labels) -> str:
    rows = [" " * 10 + "".join(f"{c[:7]:>8s}" for c in labels)]
    for t in labels:
        rows.append(f"{t[:9]:>9s} " + "".join(f"{int(((truth == t) & (said == c)).sum()):8d}" for c in labels))
    return "\n".join(rows)


def rule_activity(X: np.ndarray) -> np.ndarray:
    """No training: human-band energy against this session's own still level. Still
    under 2x, typing up to 4x, walking when the slow band (0.4-1 Hz, gait) dominates,
    waving otherwise. A baseline, not a product."""
    # features are log10 (learn.py): np.exp made the 2x/4x thresholds really 4.9x/20x
    hbe = 10.0 ** (X[:, FEATURES.index("log_hbe")])
    slow = 10.0 ** (X[:, FEATURES.index("log_band_0.4_1")])
    fast = 10.0 ** (X[:, FEATURES.index("log_band_1_2")]) + 10.0 ** (X[:, FEATURES.index("log_band_2_4")])
    floor = np.percentile(hbe, 10)
    r = hbe / max(floor, 1e-9)
    return np.where(r < 2.0, "still", np.where(r < 4.0, "typing", np.where(slow > fast, "walking", "waving")))


def score(zone_model, act_model, run: dict) -> dict:
    f = TemporalFilter(zone_model.priors)
    P = np.stack([f.step(p) for p in zone_model.proba(run["X"])])
    said = np.array([CLASSES[i] for i in P.argmax(1)])
    y = run["y"]
    occ_t, occ_s = np.isin(y, list(OCCUPIED)), np.isin(said, list(OCCUPIED))
    out = {"windows": int(len(y)), "occupancy": float((occ_t == occ_s).mean()),
           "zone": float((said[occ_t] == y[occ_t]).mean()) if occ_t.any() else None,
           "zone_confusion": _confusion(y, said, CLASSES)}
    inside = run["activity"] != "none"
    if act_model is not None and inside.any():
        A = act_model.proba(run["X"])
        sm, prev = [], None                       # same 2 s smoothing as the engine
        for a in A:
            prev = a if prev is None else 0.5 * prev + 0.5 * a
            sm.append(prev)
        said_a = np.array([ACTIVITIES[i] for i in np.argmax(sm, axis=1)])
        out["activity"] = float((said_a[inside] == run["activity"][inside]).mean())
        out["activity_confusion"] = _confusion(run["activity"][inside], said_a[inside], ACTIVITIES[1:])
        rule = rule_activity(run["X"])
        out["activity_rule"] = float((rule[inside] == run["activity"][inside]).mean())
    return out


def _sessions(paths: list[str]) -> list[dict]:
    out = []
    for p in paths:
        r = recording_run(p)
        for rnd in sorted(set(r["round"].tolist())):
            s = _subset(r, r["round"] == rnd)
            if len(s["y"]):
                s["name"] = f"{os.path.basename(p)[11:-4]} r{rnd}"
                out.append(s)
    return out


def _time_split(s: dict) -> tuple[dict, dict]:
    """Last HELD_OUT_SHARE of every (zone, activity) stretch held out."""
    test = np.zeros(len(s["y"]), bool)
    keys = np.char.add(s["y"].astype(str), s["activity"].astype(str))
    for k in np.unique(keys):
        idx = np.flatnonzero(keys == k)
        test[idx[int(len(idx) * (1 - HELD_OUT_SHARE)):]] = True
    return _subset(s, ~test), _subset(s, test)


def _report(name: str, sc: dict) -> None:
    print(f"\n{name}: {sc['windows']} windows")
    print(f"  in-room vs not {sc['occupancy']:.1%}" + (f" | zone when in {sc['zone']:.1%}" if sc.get("zone") is not None else ""))
    if "activity" in sc:
        print(f"  activity when in: learned {sc['activity']:.1%} | no-training rule {sc['activity_rule']:.1%}")
        print("  activity confusion (rows: truth):\n" + sc["activity_confusion"])
    print("  zone confusion (rows: truth):\n" + sc["zone_confusion"])


def main(argv: list[str]) -> int:
    install = "--no-install" not in argv
    paths = [a for a in argv if not a.startswith("--")]
    rec = os.path.join(DATA_DIR, "recordings")
    paths = paths or sorted(glob.glob(os.path.join(rec, "teach-room-*.akr")))
    if not paths:
        print("No learn-my-room recordings yet: run python -m aankhen learnroom")
        return 1
    sessions = _sessions(paths)
    sim = load_runs(os.path.join(MODEL_DIR, "sim-train.npz"))
    for s in sessions:
        print(f"{s['name']}: {len(s['y'])} windows; zones { {c: int((s['y'] == c).sum()) for c in CLASSES if (s['y'] == c).any()} }; "
              f"activities { {a: int((s['activity'] == a).sum()) for a in ACTIVITIES if (s['activity'] == a).any()} }")

    def fit(train_runs, variant):
        zm = (train(sim + train_runs, note="sim + learn-my-room (.akr)", weights=[1.0] * len(sim) + [REAL_WEIGHT] * len(train_runs))
              if variant == "sim+real" else train(train_runs, note="learn-my-room only (.akr)"))
        am = train_activity(train_runs, note="learn-my-room")
        return zm, am

    results = {}
    for variant in ("real only", "sim+real"):
        if len(sessions) >= 2:
            scs = []
            for i, held in enumerate(sessions):
                zm, am = fit([s for j, s in enumerate(sessions) if j != i], variant)
                sc = score(zm, am, held)
                _report(f"[{variant}] trained without {held['name']}, scored on it", sc)
                scs.append(sc)
        else:
            tr, te = _time_split(sessions[0])
            zm, am = fit([tr], variant)
            sc = score(zm, am, te)
            _report(f"[{variant}] last {HELD_OUT_SHARE:.0%} of each step held out", sc)
            scs = [sc]
        results[variant] = scs
    best = max(results, key=lambda v: np.mean([s["occupancy"] + (s["zone"] or 0) for s in results[v]]))
    print(f"\nbetter zone model on held-out data: {best}")
    if not install:
        return 0
    prev = os.path.join(MODEL_DIR, "previous")
    os.makedirs(prev, exist_ok=True)
    stamp = time.strftime("%Y%m%d-%H%M%S")
    for f in (MODEL_FILE, ACTIVITY_FILE):
        if os.path.exists(f):
            shutil.copyfile(f, os.path.join(prev, f"{os.path.basename(f)[:-7]}-{stamp}.joblib"))
    zm, am = fit(sessions, best)
    zm.save(MODEL_FILE)
    am.save(ACTIVITY_FILE)
    print(f"installed: {MODEL_FILE}\n           {ACTIVITY_FILE}")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
