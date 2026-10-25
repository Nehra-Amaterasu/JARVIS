"""Lesson 1: look at your own Wi-Fi signal before any model touches it.

    python -m aankhen lesson1 <session folder | recording.akr> [--out picture.png]

Draws one PNG with matplotlib and prints its path and a table. Works on a drill or narrate session folder (raw.akr + labels.jsonl) and on the
12-Oct recordings (x.akr + x.labels.json).

WHAT THE THREE PICTURES TEACH
  A. The heatmap. Each row is one of the 51 subcarriers (51 slightly different radio
     frequencies the router sends at once); each column is a moment; colour is how
     strong that frequency arrived, on a log scale. Your body absorbs and reflects 2.4 GHz
     waves, so where you stand changes which rows are bright: that pattern is the
     "fingerprint". Moving makes the rows flicker; sitting still makes them flat.
  B. Motion energy: per second, how much the rows changed (spread over time, averaged
     over rows). It is what the motion detector thresholds. Walking towers over sitting.
  C. One fingerprint per label: each label's average row levels minus the empty room's.
     If two labels' lines lie on top of each other, no model can tell those places apart
     from this board position; if they differ, a kNN can. This is the honest check to do
     BEFORE training: models find patterns, they cannot invent ones the signal lacks.
"""
from __future__ import annotations

import json
import os
from typing import Iterable, Optional

import numpy as np

from . import DATA_DIR

OUT_DIR = os.path.join(DATA_DIR, "lessons")
PALETTE = ["#4e79a7", "#f28e2b", "#59a14f", "#e15759", "#b07aa1", "#76b7b2", "#edc948", "#9c755f",
           "#ff9da7", "#bab0ac"]


def akr_samples(path: str) -> Iterable[tuple[float, np.ndarray]]:
    """(host time, amplitude[51]) at 100 Hz from a raw recording, through the same
    conditioner the live engine uses (decode, gain undo, resample, Hampel)."""
    from .csi import CsiConditioner
    from .protocol import CsiPacket, StreamDecoder, decode_packet
    from .transport import iter_recording
    cond, dec = CsiConditioner(), StreamDecoder()
    for host_t, chunk in iter_recording(path):
        for fr in dec.feed(chunk):
            p = decode_packet(fr)
            if isinstance(p, CsiPacket):
                for s in cond.push(p.timestamp_us / 1e6, p.raw, p.rssi, gain_comp_db=p.gain_comp_db):
                    yield host_t + (s.t - p.timestamp_us / 1e6), np.asarray(s.amp, float)


def load_labels(path: str, t_first: float) -> list[dict]:
    """[{t0, t1, label}] in host time, from labels.jsonl (drill / narrate) or the older
    x.labels.json (segments with start_host/end_host, or start/end seconds from the start)."""
    out = []
    if path.endswith(".jsonl"):
        with open(path, encoding="utf-8") as f:
            for ln in f:
                if ln.strip():
                    l = json.loads(ln)
                    if l.get("verdict", "ok") == "ok":
                        out.append({"t0": l["t_start"], "t1": l["t_end"],
                                    "label": "empty room" if l.get("kind") == "empty" else l["zone"] + (
                                        f" ({l['activity']})" if l.get("activity") not in (None, "none") else "")})
    elif os.path.exists(path):
        with open(path, encoding="utf-8") as f:
            for s in json.load(f).get("segments", []):
                t0 = s.get("start_host", t_first + s.get("start", 0))
                t1 = s.get("end_host", t_first + s.get("end", 0))
                name = s.get("label") or (f"{s['zone']} ({s['activity']})" if s.get("zone") else s.get("step", "?"))
                out.append({"t0": t0, "t1": t1, "label": name})
    return out


def _paths(target: str) -> tuple[str, str]:
    if os.path.isdir(target):
        return os.path.join(target, "raw.akr"), os.path.join(target, "labels.jsonl")
    return target, target[:-4] + ".labels.json" if target.endswith(".akr") else target + ".labels.json"


# ---------------------------------------------------------------- the numbers
def analyse(target: str, max_cols: int = 600) -> dict:
    akr, lab = _paths(target)
    ts, amps = [], []
    for t, a in akr_samples(akr):
        ts.append(t)
        amps.append(np.log(np.maximum(a, 1e-6)))
    if not ts:
        raise ValueError(f"no CSI decoded from {akr}")
    T, A = np.asarray(ts), np.asarray(amps)                       # [n], [n, 51]
    labels = load_labels(lab, T[0])
    # A: down-sample in time to at most max_cols columns (column mean)
    step = max(1, len(T) // max_cols)
    n = len(T) // step
    heat = A[:n * step].reshape(n, step, -1).mean(axis=1)          # [cols, 51]
    heat_t = T[:n * step:step]
    # B: motion energy per second = spread over time within the second, mean over subcarriers
    sec = np.floor(T - T[0]).astype(int)
    energy = np.array([A[sec == s].std(axis=0).mean() if (sec == s).sum() > 10 else np.nan for s in range(sec.max() + 1)])
    # C: fingerprint per label = its mean level per subcarrier minus the empty room's
    fp = {}
    for l in labels:
        m = (T >= l["t0"]) & (T < l["t1"])
        if m.sum() > 50:
            fp.setdefault(l["label"], []).append(A[m])
    prof = {k: np.concatenate(v).mean(axis=0) for k, v in fp.items()}
    empty_key = next((k for k in prof if "empty" in k), None)
    ref = prof[empty_key] if empty_key else A.mean(axis=0)
    rel = {k: v - ref for k, v in prof.items()}
    # how separable: each label's distance from its nearest other label, in units of
    # the typical within-label wobble (std over time, averaged over subcarriers)
    spread = {k: float(np.concatenate(v).std(axis=0).mean()) for k, v in fp.items()}
    sep = {}
    for k in prof:
        others = [float(np.linalg.norm(prof[k] - prof[o]) / np.sqrt(len(prof[k]))) for o in prof if o != k]
        if others:
            sep[k] = round(min(others) / max(spread[k], 1e-6), 2)
    return {"target": target, "t0": float(T[0]), "seconds": float(T[-1] - T[0]), "samples": len(T),
            "heat": heat, "heat_t": heat_t, "energy": energy, "labels": labels, "fingerprint": rel,
            "ref_label": empty_key, "separation": sep}


# ---------------------------------------------------------------- the picture
def render(r: dict, out: str) -> str:
    """Three panels in one PNG (matplotlib, owner's OK 2026-10-26)."""
    import matplotlib
    matplotlib.use("Agg")                     # no window: the app and the CLI run headless
    import matplotlib.pyplot as plt
    from matplotlib.patches import Patch

    names = []
    for l in r["labels"]:
        if l["label"] not in names:
            names.append(l["label"])
    cmap = {n: PALETTE[i % len(PALETTE)] for i, n in enumerate(names)}
    t0, dur = r["t0"], r["seconds"]
    fig, ax = plt.subplots(3, 1, figsize=(12, 11), gridspec_kw={"height_ratios": [3, 1.6, 2]})
    fig.suptitle(f"Aankhen lesson 1: {os.path.basename(os.path.normpath(r['target']))}   "
                 f"({dur / 60:.1f} min, {r['samples']:,} samples at 100 Hz, real board)", fontsize=12)

    def shade(a, alpha):
        for l in r["labels"]:
            a.axvspan(l["t0"] - t0, l["t1"] - t0, color=cmap[l["label"]], alpha=alpha, lw=0)

    # A. heatmap: rows = subcarriers, columns = time, colour = log amplitude
    heat = r["heat"].T
    lo, hi = np.percentile(heat, 2), np.percentile(heat, 98)
    ax[0].imshow(heat, aspect="auto", origin="lower", cmap="viridis", vmin=lo, vmax=hi,
                 extent=[0, dur, 0, heat.shape[0]], interpolation="nearest")
    for l in r["labels"]:
        ax[0].axvspan(l["t0"] - t0, l["t1"] - t0, ymin=1.0, ymax=1.04, color=cmap[l["label"]], clip_on=False)
    ax[0].set_ylabel("subcarrier (frequency)")
    ax[0].set_title("A. 51 frequencies over time: your body changes which rows are bright", loc="left", fontsize=10)

    # B. motion energy per second
    e = r["energy"]
    shade(ax[1], 0.25)
    ax[1].plot(np.arange(len(e)) + 0.5, e, color="black", lw=1.2)
    ax[1].set_xlim(0, dur)
    ax[1].set_ylabel("wobble / s")
    ax[1].set_xlabel("seconds from the start")
    ax[1].set_title("B. Motion energy: how much the rows changed each second", loc="left", fontsize=10)

    # C. a fingerprint per label, minus the empty room (or the average)
    for k, v in r["fingerprint"].items():
        sep = r["separation"].get(k)
        ax[2].plot(np.arange(len(v)), v, color=cmap.get(k, "grey"), lw=2,
                   label=f"{k}" + (f"  (separation {sep}x)" if sep is not None else ""))
    ax[2].axhline(0, color="grey", ls="--", lw=1)
    ref = r["ref_label"] or "the recording's average"
    ax[2].set_title(f"C. One fingerprint per label, minus {ref}: separate lines = places a model can learn",
                    loc="left", fontsize=10)
    ax[2].set_xlabel("subcarrier")
    ax[2].set_ylabel("log level difference")
    if r["fingerprint"]:
        ax[2].legend(fontsize=8, ncol=2, loc="best")
    fig.legend(handles=[Patch(color=cmap[n], label=n) for n in names], loc="lower center",
               ncol=min(len(names), 5), fontsize=8, frameon=False)
    fig.tight_layout(rect=(0, 0.04, 1, 0.97))
    fig.savefig(out, dpi=110)
    plt.close(fig)
    return out


def summary(r: dict) -> str:
    lines = [f"  {r['seconds'] / 60:.1f} min, {r['samples']:,} samples, {len(r['labels'])} labelled stretches",
             "  separation = distance to the nearest other label, in units of its own wobble",
             "  (under ~1x: hard to tell apart from this board position; over ~2x: a kNN should manage)"]
    e, t0 = r["energy"], r["t0"]
    for k, v in sorted(r["separation"].items(), key=lambda kv: -kv[1]):
        secs = [s for l in r["labels"] if l["label"] == k for s in range(int(l["t0"] - t0), int(l["t1"] - t0))]
        en = float(np.nanmean(e[[s for s in secs if 0 <= s < len(e)]])) if secs else float("nan")
        lines.append(f"  {k:<28} separation {v:5.2f}x   motion energy {en:.3f}")
    return "\n".join(lines)


def write(target: str, out: Optional[str] = None) -> str:
    r = analyse(target)
    os.makedirs(OUT_DIR, exist_ok=True)
    name = os.path.basename(os.path.normpath(target)).replace(".akr", "")
    out = render(r, out or os.path.join(OUT_DIR, f"lesson1-{name}.png"))
    print(summary(r))
    return out
