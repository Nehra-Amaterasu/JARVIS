"""Train on drill days, and judge by days the model never saw.

    python -m aankhen evaluate --leave-one-day-out [--json report.json]
    python -m aankhen train                       # all drill data -> a new versioned model

WHY DAYS
  Neighbouring half-seconds are near copies, and so are two sessions 30 minutes apart
  on one evening (zone looked like 56-73 % that way). What deployment needs is a model
  trained on earlier days working on a new one, so every score here holds out a WHOLE
  DAY. (docs/research/2026-10-14-aankhen-data-protocol.md, evaluation protocol.)

WHAT IS PRINTED, per held-out day
  in-room accuracy (balanced: in vs not), zone top-1 and top-3 on in-room windows,
  activity accuracy, each split by fan on / off, and a zone confusion matrix; then
  THE GATES, as PASS / FAIL:
    - in-room >= 95 % on EVERY held-out day;
    - zone top-1 > 73 % by day 7 (the kill rule; fewer than 7 days -> NOT YET).

FEATURES
  learn.FeatureStream, run continuously over the session's raw.akr. The empty-room
  reference is the SAME DAY's empty block for the block's fan state (the "same-day
  empty recalibration" condition), which is what the daily recalibration gives live.
  Windows in the first PURGE_S of a block are dropped (settling).

MODELS  data/aankhen/models/drill/<version>/model.joblib + manifest.json; current.json
  names the one in use. Old versions are kept.
"""
from __future__ import annotations

import json
import os
import time
from dataclasses import dataclass
from typing import Optional

import numpy as np

from . import DATA_DIR
from .zones import ACTIVITIES, ZoneMap, load_zones

MODEL_ROOT = os.path.join(DATA_DIR, "models", "drill")
PURGE_S = 5.0
GATE_IN_ROOM = 0.95
GATE_ZONE = 0.73
GATE_ZONE_DAYS = 7


# ---------------------------------------------------------------- features from a session
def session_windows(folder: str, labels: list[dict], purge_s: float = PURGE_S) -> dict:
    """Feature windows of one drill session with their labels.
    Returns {X, zone, activity, fan, t} (only windows inside a passed block)."""
    from .csi import CsiConditioner
    from .learn import FeatureStream, reference_from
    from .transport import iter_recording
    good = sorted([l for l in labels if l.get("verdict") == "ok"], key=lambda l: l["t_start"])
    raw = os.path.join(folder, "raw.akr")

    def block_at(t):
        for l in good:
            if l["t_start"] <= t < l["t_end"]:
                return l
        return None

    def stream():
        """(host time, sample, rssi) for every conditioned sample, in order."""
        from .protocol import CsiPacket, StreamDecoder, decode_packet
        cond, dec = CsiConditioner(), StreamDecoder()     # one decoder: frames span chunks
        for host_t, chunk in iter_recording(raw):
            for fr in dec.feed(chunk):
                p = decode_packet(fr)
                if not isinstance(p, CsiPacket):
                    continue
                for s in cond.push(p.timestamp_us / 1e6, p.raw, p.rssi, gain_comp_db=p.gain_comp_db):
                    yield host_t, s, p.rssi

    # pass 1: the day's empty reference per fan state, from the empty blocks
    refs: dict = {}
    empties = [l for l in good if l.get("kind") == "empty"]
    if empties:
        fs = FeatureStream()
        wins: dict = {False: [], True: []}
        for host_t, s, rssi in stream():
            if fs.push(s, rssi) is None:
                continue
            l = block_at(host_t)
            if l is not None and l.get("kind") == "empty" and host_t - l["t_start"] >= purge_s:
                wins[bool(l["fan"])].append(fs.last)
        for fan, w in wins.items():
            r = reference_from(w)
            if r is not None:
                refs[fan] = r
    # pass 2: features, the reference swapped to the block's fan state
    fs = FeatureStream(ref=refs.get(False) or refs.get(True))
    cur_fan = None
    X, Z, A, F, T = [], [], [], [], []
    for host_t, s, rssi in stream():
        l = block_at(host_t)
        fan = bool(l["fan"]) if l is not None else cur_fan
        if fan is not None and fan != cur_fan and refs.get(fan) is not None:
            r = refs[fan]
            fs.ref_shape = np.asarray(r["shape"], float)
            fs.ref_level, fs.ref_rssi = r.get("level"), r.get("rssi")
        cur_fan = fan if fan is not None else cur_fan
        v = fs.push(s, rssi, bool(fan))
        if v is None or l is None or host_t - l["t_start"] < purge_s:
            continue
        X.append(v); Z.append(l["zone"]); A.append(l["activity"]); F.append(bool(l["fan"])); T.append(host_t)
    from .learn import FEATURES
    return {"X": np.asarray(X).reshape(-1, len(FEATURES)), "zone": np.asarray(Z), "activity": np.asarray(A),
            "fan": np.asarray(F, bool), "t": np.asarray(T)}


def load_days(root: Optional[str] = None) -> dict:
    """{day: [session windows, ...]} for every drill session on disk."""
    from .drill import DRILL_DIR, sessions
    out: dict = {}
    for s in sessions(root or DRILL_DIR):
        w = session_windows(s["folder"], s["labels"])
        if len(w["zone"]):
            w["session"] = s["session"]
            w["firmware"] = next((l.get("firmware") for l in s["labels"] if l.get("firmware")), None)
            out.setdefault(s["day"], []).append(w)
    return out


def _cat(runs: list[dict], key: str) -> np.ndarray:
    return np.concatenate([r[key] for r in runs]) if runs else np.asarray([])


# ---------------------------------------------------------------- the model
def _proba_one_thread(clf, X):
    from .learn import _proba_one_thread as p
    return p(clf, X)


@dataclass
class ZoneModel:
    """A zone classifier and an activity classifier, trained on drill blocks."""
    zone_clf: object
    act_clf: Optional[object]
    features: list
    trained_on: dict

    def zone_proba(self, v: np.ndarray) -> dict:
        p = _proba_one_thread(self.zone_clf, np.asarray(v, float)[None, :])[0]
        return {str(c): float(x) for c, x in zip(self.zone_clf.classes_, p)}

    def activity_proba(self, v: np.ndarray) -> Optional[dict]:
        if self.act_clf is None:
            return None
        p = _proba_one_thread(self.act_clf, np.asarray(v, float)[None, :])[0]
        out = {a: 0.0 for a in ACTIVITIES}
        for c, x in zip(self.act_clf.classes_, p):
            out[str(c)] = float(x)
        return out

    def zone_proba_many(self, X: np.ndarray) -> tuple[list, np.ndarray]:
        return [str(c) for c in self.zone_clf.classes_], _proba_one_thread(self.zone_clf, X)

    def activity_predict(self, X: np.ndarray) -> np.ndarray:
        if self.act_clf is None:
            return np.full(len(X), "none")
        return np.asarray(self.act_clf.classes_)[_proba_one_thread(self.act_clf, X).argmax(1)]

    # ------------------------------------------------------------ files
    def save(self, root: str = MODEL_ROOT, version: Optional[str] = None) -> str:
        import joblib
        version = version or time.strftime("%Y%m%d-%H%M%S")
        folder = os.path.join(root, version)
        os.makedirs(folder, exist_ok=True)
        joblib.dump(self, os.path.join(folder, "model.joblib"))
        with open(os.path.join(folder, "manifest.json"), "w", encoding="utf-8") as f:
            json.dump({"version": version, **self.trained_on}, f, indent=1)
        with open(os.path.join(root, "current.json"), "w", encoding="utf-8") as f:
            json.dump({"version": version}, f)
        return folder

    @staticmethod
    def load_current(root: str = MODEL_ROOT) -> Optional["ZoneModel"]:
        # joblib unpickles: only models this program trained and saved here, never a download.
        try:
            with open(os.path.join(root, "current.json"), encoding="utf-8") as f:
                v = json.load(f)["version"]
            import joblib
            return joblib.load(os.path.join(root, v, "model.joblib"))
        except (OSError, ValueError, KeyError):
            return None
        except Exception:
            return None


def fit(runs: list[dict], note: str = "", days: Optional[list[str]] = None) -> ZoneModel:
    from sklearn.ensemble import HistGradientBoostingClassifier
    from .belief import feature_ranges
    from .learn import FEATURES
    X, z, a = _cat(runs, "X"), _cat(runs, "zone"), _cat(runs, "activity")
    if len(set(z.tolist())) < 2:
        raise ValueError("need at least two different zones in the drill data")
    zc = HistGradientBoostingClassifier(max_iter=300, learning_rate=0.06, max_leaf_nodes=31,
                                        l2_regularization=1.0, class_weight="balanced", random_state=0)
    zc.fit(X, z)
    ac = None
    if len(set(a.tolist())) >= 2:
        ac = HistGradientBoostingClassifier(max_iter=200, learning_rate=0.06, max_leaf_nodes=15,
                                            l2_regularization=1.0, class_weight="balanced", random_state=0)
        ac.fit(X, a)
    fws = sorted({str(r.get("firmware")) for r in runs if r.get("firmware")})
    return ZoneModel(zc, ac, list(FEATURES), {
        "kind": "drill", "windows": int(len(z)), "sessions": [r.get("session") for r in runs],
        "days": sorted(set(days or [])), "firmware": fws, "note": note,
        "zones": {c: int((z == c).sum()) for c in sorted(set(z.tolist()))},
        "activities": {c: int((a == c).sum()) for c in sorted(set(a.tolist()))},
        "fan_source": "uno", "feature_ranges": feature_ranges(X, list(FEATURES)),
        "when": time.strftime("%Y-%m-%d %H:%M")})


# ---------------------------------------------------------------- scoring
def score(model: ZoneModel, runs: list[dict], zmap: ZoneMap) -> dict:
    X, z, a, fan = _cat(runs, "X"), _cat(runs, "zone"), _cat(runs, "activity"), _cat(runs, "fan").astype(bool)
    classes, P = model.zone_proba_many(X)
    classes = np.asarray(classes)
    order = np.argsort(-P, axis=1)
    top1 = classes[order[:, 0]]
    top3 = classes[order[:, :3]]
    in_true = np.array([zmap.get(c).in_room if zmap.get(c) else True for c in z])
    in_pred = np.array([zmap.get(c).in_room if zmap.get(c) else True for c in top1])
    act_pred = model.activity_predict(X)

    def part(m: np.ndarray) -> dict:
        if not m.any():
            return {"windows": 0}
        it, ip = in_true[m], in_pred[m]
        accs = [float((ip[it == v] == v).mean()) for v in (True, False) if (it == v).any()]
        inr = m & in_true
        out = {"windows": int(m.sum()), "in_room": round(float(np.mean(accs)), 4),
               "activity": round(float((act_pred[m] == a[m]).mean()), 4)}
        if inr.any():
            out["zone_top1"] = round(float((top1[inr] == z[inr]).mean()), 4)
            out["zone_top3"] = round(float(np.mean([z[i] in top3[i] for i in np.flatnonzero(inr)])), 4)
        return out

    allm = np.ones(len(z), bool)
    labels = sorted(set(z.tolist()) | set(top1.tolist()))
    conf = {t: {p: int(((z == t) & (top1 == p)).sum()) for p in labels if ((z == t) & (top1 == p)).any()}
            for t in sorted(set(z.tolist()))}
    return {**part(allm), "fan_on": part(fan), "fan_off": part(~fan), "confusion": conf}


def leave_one_day_out(days: dict, zmap: Optional[ZoneMap] = None) -> dict:
    zmap = zmap or load_zones()
    names = sorted(days)
    per_day = {}
    for d in names:
        train_runs = [r for k in names if k != d for r in days[k]]
        if not train_runs:
            continue
        try:
            m = fit(train_runs, note=f"held out {d}", days=[k for k in names if k != d])
        except ValueError as e:
            per_day[d] = {"error": str(e)}
            continue
        per_day[d] = score(m, days[d], zmap)
    return {"days": names, "per_day": per_day, "gates": gates(per_day, len(names))}


def gates(per_day: dict, n_days: int) -> dict:
    scored = {d: r for d, r in per_day.items() if "in_room" in r}
    inr = [r["in_room"] for r in scored.values()]
    zones = [r["zone_top1"] for r in scored.values() if "zone_top1" in r]
    g_in = {"rule": f"in-room >= {GATE_IN_ROOM:.0%} on every held-out day",
            "worst": min(inr) if inr else None,
            "verdict": ("PASS" if inr and min(inr) >= GATE_IN_ROOM else "FAIL") if inr else "NOT YET"}
    mean_zone = float(np.mean(zones)) if zones else None
    if n_days < GATE_ZONE_DAYS:
        zv = "NOT YET"
    else:
        zv = "PASS" if mean_zone is not None and mean_zone > GATE_ZONE else "FAIL"
    g_zone = {"rule": f"zone top-1 > {GATE_ZONE:.0%} by day {GATE_ZONE_DAYS} (kill rule)",
              "mean": None if mean_zone is None else round(mean_zone, 4), "days": n_days, "verdict": zv}
    return {"in_room": g_in, "zone": g_zone}


def format_report(rep: dict) -> str:
    lines = [f"Leave-one-day-out over {len(rep['days'])} drill day(s): {', '.join(rep['days']) or 'none'}"]
    if len(rep["days"]) < 2:
        lines.append("  Need at least 2 days of drills to hold one out. Run `python -m aankhen drill` on another day.")
    for d, r in rep["per_day"].items():
        if "error" in r:
            lines.append(f"\n  {d}: {r['error']}")
            continue
        lines.append(f"\n  held out {d}  ({r['windows']} windows)")
        for name, part in (("all", r), ("fan on", r["fan_on"]), ("fan off", r["fan_off"])):
            if not part.get("windows"):
                continue
            z1 = f"{part['zone_top1']:.1%}" if "zone_top1" in part else "-"
            z3 = f"{part['zone_top3']:.1%}" if "zone_top3" in part else "-"
            lines.append(f"    {name:7s} in-room {part['in_room']:.1%}  zone top-1 {z1}  top-3 {z3}"
                         f"  activity {part['activity']:.1%}  ({part['windows']} windows)")
        lines.append("    confusion (true -> predicted windows):")
        for t, row in r["confusion"].items():
            lines.append(f"      {t:30s} " + ", ".join(f"{p} {n}" for p, n in sorted(row.items(), key=lambda x: -x[1])))
    g = rep["gates"]
    lines.append("\n  GATES")
    worst = g["in_room"]["worst"]
    lines.append(f"    [{g['in_room']['verdict']}] {g['in_room']['rule']}"
                 + (f" (worst day {worst:.1%})" if worst is not None else ""))
    mz = g["zone"]["mean"]
    lines.append(f"    [{g['zone']['verdict']}] {g['zone']['rule']}"
                 + (f" (mean {mz:.1%} over {g['zone']['days']} days)" if mz is not None else ""))
    return "\n".join(lines)


def train_all(days: dict, root: str = MODEL_ROOT) -> tuple[ZoneModel, str]:
    runs = [r for d in sorted(days) for r in days[d]]
    if not runs:
        raise ValueError("no drill data yet: run `python -m aankhen drill` first")
    m = fit(runs, note="all drill days", days=sorted(days))
    return m, m.save(root)
