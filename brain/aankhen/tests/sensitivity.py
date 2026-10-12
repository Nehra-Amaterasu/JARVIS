"""How small a human movement can each motion statistic see, and does it stay quiet
for everything that is not a person? (a measuring tool, not a test)

HUMAN RUNS, per spot (desk, bed, floor of the room file):
  - fidgets: a seated or lying person moves every ~4 s by a random displacement
    with spread S (simulator Actor.fidget_m), for S from 3 mm to 8 cm;
  - still: the same person breathing, no fidgets.
NOT-HUMAN RUNS, per simulated room: an empty room (an independent seed), an empty
room whose multipath drifts through a subcarrier null, and an empty room with the
ceiling fan on.

Each statistic gets its threshold the way the detector does: 1.2 x the 99.5th
percentile over a SEPARATE empty calibration run (a fan-on calibration for the fan
run). A window is "seen" above it. Windows are labelled with each statistic's own
length: moving if the person moved inside the window, still if not within it plus
0.5 s; anything in between is left out.

    python -m aankhen.tests.sensitivity --quick     (from brain/, ~10 min)
    python -m aankhen.tests.sensitivity             (two rooms, all spreads)
"""
from __future__ import annotations

import argparse
import json
from typing import Optional

import numpy as np

from aankhen.csi import CsiConditioner
from aankhen.fan import FanLines
from aankhen.motion import (HBE_BAND_HZ, HBE_ORDER, HBE_RECENT_GATE, HBE_WINDOW_S, MotionConfig,
                            human_band_energy, turbulence)
from aankhen.protocol import CsiPacket, StreamDecoder, decode_packet
from aankhen.room import default_room, load_room
from aankhen.simulator import Actor, Drift, Fan, Scenario, Simulator, Step

SPREADS_M = [0.003, 0.006, 0.01, 0.02, 0.03, 0.05, 0.08]
RATE = 100.0
HOP = 25
# name -> (window s, band Hz, Legendre order or None for all 51 subcarriers)
ALL_VARIANTS = {
    "hbe 2s 1-8Hz": (2.0, (1.0, 8.0), 5),
    "hbe 2s 0.5-4Hz": (2.0, (0.5, 4.0), 5),
    "hbe 3s 0.4-4Hz": (3.0, (0.4, 4.0), 5),
    "hbe 3s 0.3-8Hz": (3.0, (0.3, 8.0), 5),
    "hbe 3s 0.4-4Hz all51": (3.0, (0.4, 4.0), None),
}
# Default: the detector's own setting only (motion.py HBE_*). --all-variants for the
# comparison that chose it (2026-10-11).
HBE_VARIANTS = {"hbe": (HBE_WINDOW_S, HBE_BAND_HZ, HBE_ORDER)}
if __import__("sys").argv[1:] and "--all-variants" in __import__("sys").argv:
    HBE_VARIANTS = ALL_VARIANTS
STAT_WINDOW = {"mvs": 1.0, "level": 1.0, **{k: v[0] for k, v in HBE_VARIANTS.items()}}
MAXW = int(max(STAT_WINDOW.values()) * RATE)


def _samples(sim: Simulator, seconds: float):
    dec, cond = StreamDecoder(), CsiConditioner()
    for ch in sim.chunks(seconds):
        for fr in dec.feed(ch):
            p = decode_packet(fr)
            if isinstance(p, CsiPacket):
                yield from cond.push(p.timestamp_us / 1e6, p.raw, p.rssi, gain_comp_db=p.gain_comp_db)


def window_stats(sim: Simulator, seconds: float, skip_s: float = 6.0) -> list[dict]:
    n1 = MotionConfig().window_n
    amps, turb, lev, fill = [], [], [], []
    fan = FanLines()
    out = []
    for k, s in enumerate(_samples(sim, seconds)):
        tb = turbulence(s.amp)
        fan.push(tb)
        amps.append(s.amp); turb.append(tb); fill.append(s.filled)
        lev.append(s.level_db if s.level_db is not None else np.nan)
        if len(amps) > MAXW:
            amps.pop(0); turb.pop(0); lev.pop(0); fill.pop(0)
        if len(amps) < MAXW or k % HOP or s.t < skip_s:
            continue
        row = {"t": s.t}
        tb_w = np.asarray(turb[-n1:])
        row["mvs"] = fan.residual_variance(tb_w) if fan.locked else float(tb_w.var())
        y = np.asarray(lev[-n1:], float)
        row["level"] = None
        if np.all(np.isfinite(y)):
            tt = np.arange(n1) - (n1 - 1) / 2
            y = y - y.mean()
            y = y - tt * (tt @ y) / (tt @ tt)
            row["level"] = float(y.var())
        A, F = np.stack(amps), np.asarray(fill)
        for name, (w, band, order) in HBE_VARIANTS.items():
            n = int(w * RATE)
            r = human_band_energy(A[-n:], F[-n:], band=band, order=order,
                                  fan=fan if fan.locked else None, detail=True)
            row[name], row[name + "#recent"] = (None, None) if r is None else (r[0], r[2])
        # Motion history for labels: moved at all in the last w (+0.5) seconds?
        # Truth on the SIMULATION clock: sample times are device time, which the
        # simulated ESP32 starts boot_us after the simulation.
        ts = s.t - sim.boot_us / 1e6
        last_move = None
        for d in np.arange(0.0, max(STAT_WINDOW.values()) + 0.6, 0.1):
            if any(p.moving for p in sim.occupants_at(ts - d)):
                last_move = d
                break
        row["since_move"] = last_move
        row["person"] = bool(sim.occupants_at(ts))
        out.append(row)
    return out


STATS = ["mvs", "level"] + list(HBE_VARIANTS)


def thresholds(cal: list[dict], scale: float = 1.2, q: float = 0.995) -> dict:
    thr = {}
    for key in STATS:
        v = [w[key] for w in cal if w.get(key) is not None]
        thr[key] = scale * float(np.quantile(v, q)) if len(v) > 20 else None
    return thr


DETECTORS = {"old: mvs|level": ("mvs", "level"), **{f"new: mvs|level|{k}": ("mvs", "level", k) for k in HBE_VARIANTS}}


def _win(keys) -> float:
    return max(STAT_WINDOW[k] for k in keys)


def seen(w: dict, thr: dict, keys) -> bool:
    """Above its threshold; an HBE also needs its last second over the gate, as in
    the detector (motion.py HBE_RECENT_GATE)."""
    def one(k):
        if thr[k] is None or w.get(k) is None or w[k] <= thr[k]:
            return False
        rec = w.get(k + "#recent")
        return rec is None or rec > HBE_RECENT_GATE if k.startswith("hbe") else True
    return any(one(k) for k in keys)


def rates(ws: list[dict], thr: dict) -> dict:
    """Per detector: share of moving windows seen, share of still-person windows
    flagged, share of no-person windows flagged."""
    out = {}
    for name, keys in DETECTORS.items():
        W = _win(keys)
        mov = [w for w in ws if w["person"] and w["since_move"] is not None and w["since_move"] < W]
        still = [w for w in ws if w["person"] and w["since_move"] is None]
        empty = [w for w in ws if not w["person"]]
        f = lambda xs: float(np.mean([seen(w, thr, keys) for w in xs])) if xs else None
        out[name] = {"moving": f(mov), "still": f(still), "empty": f(empty)}
    return out


def main(argv=None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--quick", action="store_true")
    ap.add_argument("--all-variants", action="store_true", help="compare the band/window variants")
    ap.add_argument("--room", choices=["default", "mine"], default="mine")
    ap.add_argument("--out", default=None)
    a = ap.parse_args(argv)
    room = load_room()[0] if a.room == "mine" else default_room()
    spreads = [0.003, 0.01, 0.03] if a.quick else SPREADS_M
    seconds = 60.0 if a.quick else 120.0
    rooms = (0,) if a.quick else (0, 1)
    spots = {z.name: (z.centroid(), z.posture or "seated") for z in room.zones
             if z.posture in ("seated", "lying") or z.name == "floor"}
    report = {"rooms": {}}
    for cs in rooms:
        print(f"room {cs}: calibrating", flush=True)
        cal = window_stats(Simulator(room, Scenario("empty", []), seed=901, channel_seed=cs), 120.0)
        thr = thresholds(cal)
        fan_s = Scenario("fan", [], fan=Fan(x=room.width / 2, y=room.depth / 2, radar_p=0.0, on=[(1.0, 1e9)]))
        fan_cal = window_stats(Simulator(room, fan_s, seed=902, channel_seed=cs), 120.0, skip_s=12.0)
        thr_fan = thresholds(fan_cal)
        r = {"not_human": {}, "spots": {}}
        r["not_human"]["empty"] = rates(window_stats(Simulator(room, Scenario("empty", []), seed=903, channel_seed=cs), 120.0), thr)
        drift = Scenario("drift", [], drift=Drift(phase_rad=1.0, ramp_s=150.0))
        r["not_human"]["drift"] = rates(window_stats(Simulator(room, drift, seed=904, channel_seed=cs), 180.0), thr)
        r["not_human"]["fan"] = rates(window_stats(Simulator(room, fan_s, seed=905, channel_seed=cs), 120.0, skip_s=12.0), thr_fan)
        for spot, (pos, posture) in spots.items():
            print(f"  {spot}: {posture} at ({pos[0]:.2f}, {pos[1]:.2f})", flush=True)
            still_a = Actor("A", pos, steps=[Step("stay", seconds=10_000, posture=posture)])
            d = {"still": rates(window_stats(Simulator(room, Scenario("still", [still_a]), seed=21, channel_seed=cs), seconds), thr),
                 "fidget": {}}
            for m in spreads:
                act = Actor("A", pos, steps=[Step("stay", seconds=10_000, posture=posture)],
                            fidget_every_s=4.0, fidget_m=m)
                d["fidget"][m] = rates(window_stats(Simulator(room, Scenario("fidget", [act]), seed=11, channel_seed=cs), seconds), thr)
            r["spots"][spot] = d
        report["rooms"][cs] = r

    pct = lambda v: "   -" if v is None else f"{v * 100:4.0f}"
    for cs, r in report["rooms"].items():
        print(f"\n=== room {cs} ===")
        print("NOT HUMAN (share of windows called motion):")
        print(f"  {'detector':34s} empty drift   fan")
        for name in DETECTORS:
            print(f"  {name:34s} " + "  ".join(pct(r['not_human'][k][name]['empty']) for k in ('empty', 'drift', 'fan')))
        for spot, d in r["spots"].items():
            print(f"{spot.upper()}: moving windows seen by fidget spread (cm) | still person flagged")
            print(f"  {'detector':34s}" + "".join(f"{m * 100:6.1f}" for m in spreads) + "   still")
            for name in DETECTORS:
                print(f"  {name:34s}" + "".join(f"  {pct(d['fidget'][m][name]['moving'])}" for m in spreads)
                      + f"   {pct(d['still'][name]['still'])}")
    if a.out:
        with open(a.out, "w", encoding="utf-8") as f:
            json.dump(report, f, indent=2, default=str)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
