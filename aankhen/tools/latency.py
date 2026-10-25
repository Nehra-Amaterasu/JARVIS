"""Motion-onset latency and empty-room false motion, measured on real recordings.

    .venv\\Scripts\\python.exe -m aankhen.tools.latency [--recordings DIR]

For each detector setting (window / hop / on_count):
  1. calibrate on the FIRST half of the labelled empty-room recording, with that setting
     (a baseline only means something for the window it was measured with);
  2. false motion = share of evaluations in "motion" on the SECOND half (never seen);
  3. onset latency = host time of the first "motion" after each labelled move/walk
     segment starts, minus the segment's start (first-light recordings, host clock).
     This includes the person's reaction to the prompt, the same for every setting,
     so it compares settings; the intrinsic delay is measured separately on synthetic
     steps (intrinsic_delay) where the true onset is known.
Read-only: recordings are only read.
"""
from __future__ import annotations

import argparse
import glob
import json
import os
from typing import Optional

import numpy as np

from ..bench import calibrate_from_bytes
from ..csi import CsiConditioner
from ..motion import MotionConfig, MotionDetector, STATE_MOTION
from ..protocol import CsiPacket, StreamDecoder, decode_packet
from ..transport import iter_recording

SETTINGS = {
    "before 1.0s/0.25s/4": dict(window_s=1.0, hop_s=0.25, on_count=4),
    "1.0s/0.1s/3": dict(window_s=1.0, hop_s=0.1, on_count=3),
    "1.0s/0.1s/2": dict(window_s=1.0, hop_s=0.1, on_count=2),
    "0.5s/0.1s/2": dict(window_s=0.5, hop_s=0.1, on_count=2),
    "0.5s/0.1s/3": dict(window_s=0.5, hop_s=0.1, on_count=3),
}


def _chunks(path: str, t0: Optional[float] = None, t1: Optional[float] = None):
    first = None
    for t, data in iter_recording(path):
        first = t if first is None else first
        rel = t - first
        if (t0 is None or rel >= t0) and (t1 is None or rel < t1):
            yield t, data


def replay(chunks, cfg: MotionConfig, baseline) -> list[tuple[float, str]]:
    """[(host time, state)] per detector evaluation."""
    dec, cond, det = StreamDecoder(), CsiConditioner(), MotionDetector(cfg, baseline)
    out = []
    for th, data in chunks:
        for fr in dec.feed(data):
            p = decode_packet(fr)
            if isinstance(p, CsiPacket):
                for s in cond.push(p.timestamp_us / 1e6, p.raw, p.rssi, gain_comp_db=p.gain_comp_db):
                    r = det.push(s)
                    if r is not None:
                        out.append((th, r.state))
    return out


def onset_latencies(states, segments) -> list[float]:
    out = []
    for seg in segments:
        a, b = seg["start_host"], seg["end_host"]
        hit = next((t for t, s in states if a <= t <= b and s == STATE_MOTION), None)
        if hit is not None:
            out.append(hit - a)
    return out


def measure(rec_dir: str, settings: Optional[dict] = None) -> dict:
    empty = os.path.join(rec_dir, "20261012-201420-empty.akr")
    fls = sorted(glob.glob(os.path.join(rec_dir, "firstlight-*.akr")))
    res = {}
    for name, kw in (settings or SETTINGS).items():
        cfg = MotionConfig(**kw)
        b = calibrate_from_bytes((d for _, d in _chunks(empty, 0, 75)), cfg=cfg)
        st = replay(_chunks(empty, 75), cfg, b)
        st = st[int(5 / cfg.hop_s):]                       # the first 5 s fill the windows
        fa = float(np.mean([s == STATE_MOTION for _, s in st])) if st else float("nan")
        lats, missed = [], 0
        for f in fls:
            with open(f[:-4] + ".labels.json", encoding="utf-8") as fh:
                labels = json.load(fh)
            segs = [s for s in labels["segments"] if s["label"] in ("move", "walk")]
            got = onset_latencies(replay(_chunks(f), cfg, b), segs)
            missed += len(segs) - len(got)
            lats += got
        res[name] = {"false_motion": fa, "onset_median_s": float(np.median(lats)) if lats else None,
                     "onsets": [round(x, 2) for x in lats], "missed": missed}
    return res


def main(argv=None) -> None:
    from .. import DATA_DIR
    ap = argparse.ArgumentParser()
    ap.add_argument("--recordings", default=os.path.join(DATA_DIR, "recordings"))
    a = ap.parse_args(argv)
    for k, v in measure(a.recordings).items():
        print(f"{k:22s} FA {v['false_motion']:.2%}  onset median {v['onset_median_s']}  "
              f"onsets {v['onsets']}  missed {v['missed']}", flush=True)


if __name__ == "__main__":
    main()
