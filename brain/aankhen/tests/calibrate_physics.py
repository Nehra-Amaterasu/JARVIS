"""Calibrate physics.py's breathing verdicts against the real detector.

physics.py predicts a breathing SNR from the channel model alone; whether the
pipeline's RespirationDetector actually passes a window depends on its statistic
and its threshold (k_floor x the empty room's median). This runs still people at
random poses (bed: lying, desk: seated) in several simulated rooms, through the
full byte -> conditioner -> detector chain, and records (predicted SNR, share of
windows that pass). The SNR where half the windows pass is the honest "likely"
line for the report.

    python -m aankhen.tests.calibrate_physics [--runs 40] [--gain 1]
Not a unit test (minutes, not seconds): run it after changing the detector or rf.py.
"""
from __future__ import annotations

import argparse
import json
import math
import os

import numpy as np

from ..bench import simulated_baseline
from ..csi import CsiConditioner
from ..motion import RespirationDetector
from ..physics import breathing_snr_db
from ..protocol import CsiPacket, StreamDecoder, decode_packet
from ..room import default_room
from ..simulator import Actor, Scenario, Simulator, Step


def one_run(room_seed: int, seed: int, posture: str, rng: np.random.Generator, gain: bool,
            seconds: float = 130.0) -> tuple[float, float, tuple]:
    room = default_room()
    zone = next(z for z in room.zones if z.name == ("bed" if posture == "lying" else "desk"))
    xs, ys = zip(*zone.polygon)
    x = float(rng.uniform(min(xs) + 0.25, max(xs) - 0.25))
    y = float(rng.uniform(min(ys) + 0.25, max(ys) - 0.25))
    heading = math.radians(zone.facing_deg + rng.uniform(-25, 25)) if zone.facing_deg is not None \
        else float(rng.uniform(0, 2 * math.pi))
    actor = Actor("p", (x, y), [Step("stay", seconds=seconds, posture=posture)], breathing_bpm=14.0)
    sim = Simulator(room, Scenario(f"still-{posture}", [actor]), seed=seed, channel_seed=room_seed,
                    gain_report=gain)
    sim.csi._heading["p"] = heading
    base = simulated_baseline(room, channel_seed=room_seed)
    dec, cond = StreamDecoder(), CsiConditioner()
    resp = RespirationDetector(floor=base.resp_floor)
    for chunk in sim.chunks(seconds):
        for fr in dec.feed(chunk):
            p = decode_packet(fr)
            if isinstance(p, CsiPacket):
                for s in cond.push(p.timestamp_us / 1e6, p.raw, p.rssi, gain_comp_db=p.gain_comp_db):
                    resp.push(s)
    ratios = np.array(resp.stats[2:]) / base.resp_floor        # skip the first windows
    passed = float(np.mean(ratios >= resp.k_floor)) if ratios.size else 0.0
    # The simulator has no slow room wander of its own (sigma_env 0) and its
    # receiver's compensation error is Esp32Receiver.comp_err_db: predict with those.
    predicted = breathing_snr_db(sim.csi.ch, x, y, posture, heading, 3.0, 0.0,
                                 "gain" if gain else "normalised",
                                 comp_err_db=sim.csi.receiver.comp_err_db)
    return predicted, passed, (x, y, heading)


def main(argv=None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--runs", type=int, default=40)
    ap.add_argument("--gain", type=int, default=1)
    ap.add_argument("--out")
    a = ap.parse_args(argv)
    rng = np.random.default_rng(2026)
    rows = []
    for i in range(a.runs):
        posture = "lying" if i % 2 == 0 else "seated"
        pred, passed, pose = one_run(i % 4, 100 + i, posture, rng, bool(a.gain))
        rows.append((pred, passed, posture, i % 4, pose))
        print(f"run {i + 1:2}/{a.runs} room {i % 4} {posture:6} predicted {pred:5.1f} dB -> {passed:.0%} of windows pass",
              flush=True)
    pred = np.array([r[0] for r in rows])
    ok = np.array([r[1] for r in rows])
    for lo, hi in ((-99, 10), (10, 15), (15, 20), (20, 25), (25, 30), (30, 99)):
        sel = (pred >= lo) & (pred < hi)
        if sel.any():
            print(f"  predicted {lo:>3}-{hi:<3} dB: {sel.sum():2} runs, windows passing median {np.median(ok[sel]):.0%}")
    # The SNR where half the windows pass: logistic fit by least squares on a grid.
    best = None
    for x50 in np.arange(5, 40, 0.25):
        for w in (1.0, 2.0, 3.0, 4.0, 6.0):
            f = 1 / (1 + np.exp(-(pred - x50) / w))
            err = float(np.sum((f - ok) ** 2))
            if best is None or err < best[0]:
                best = (err, x50, w)
    _, x50, w = best
    x90 = x50 + w * math.log(9)
    print(f"half the windows pass at {x50:.1f} dB, 90 % at {x90:.1f} dB")
    if a.out:
        with open(a.out, "w", encoding="utf-8") as f:
            json.dump({"x50_db": x50, "x90_db": x90, "rows": rows}, f, indent=1)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
