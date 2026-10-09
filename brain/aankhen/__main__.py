"""Aankhen command line.

    python -m aankhen doctor                       is everything plugged in and sane?
    python -m aankhen serve [--sim SCENARIO | --replay FILE | --port COM9] [--lan]
    python -m aankhen record --seconds 60 --label empty     labelled real recording
    python -m aankhen calibrate --seconds 70 [--fan]         empty-room Wi-Fi baseline (fan off / on)
    python -m aankhen bench [FILES...] [--sim --seeds 5]     score against ground truth
    python -m aankhen simulate --scenario evening --seconds 220 --out recordings/x.akr

Run from the brain/ folder with the project venv.

THE REAL-ROOM PROTOCOL (what `record` + `bench` are for)
  1. calibrate     70 s, room EMPTY, door closed, you outside.
  2. record        one file per situation, each 60 s, labelled:
                     --label empty      nobody in the room
                     --label walking    walk around normally the whole time
                     --label sitting    sit at the desk, normal small movements
                     --label lying      lie on the bed
                   A file holds one situation, so the label is exact without a
                   stopwatch. Write the start/end down if you leave mid-way.
  3. bench         replays every labelled recording through the full pipeline
                   and prints recall, false alarms and latency. Re-run after
                   any change: the recordings become regression tests.
"""
from __future__ import annotations

import argparse
import glob
import json
import os
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
RECORDINGS = os.path.join(HERE, "recordings")          # gitignored


def cmd_doctor(a) -> int:
    from .transport import list_candidate_ports
    from .room import ROOM_FILE, load_room
    from .hub import BASELINE_FILE
    ok = True
    print("Aankhen doctor\n")
    ports = list_candidate_ports()
    if ports:
        print("  [ok]  ESP32-like serial ports:")
        for p in ports:
            print(f"          {p}")
    else:
        ok = False
        print("  [--]  no ESP32 serial port. Plug the board in with a DATA cable (charge-only")
        print("        cables are common). Bluetooth COM ports are ignored on purpose.")
    room, measured = load_room()
    print(f"  [{'ok' if measured else '--'}]  room layout: "
          + (f"{ROOM_FILE}" if measured else "default 4x4 m (copy room.example.json -> room.json and measure)"))
    try:
        room.validate()
    except ValueError as e:
        ok = False
        print(f"  [!!]  {e}")
    print(f"  [{'ok' if os.path.exists(BASELINE_FILE) else '--'}]  Wi-Fi empty-room baseline: "
          + ("calibrated" if os.path.exists(BASELINE_FILE) else "none (run: python -m aankhen calibrate)"))
    recs = glob.glob(os.path.join(RECORDINGS, "*.akr"))
    labelled = [r for r in recs if os.path.exists(r[:-4] + ".labels.json")]
    print(f"  [{'ok' if labelled else '--'}]  labelled recordings: {len(labelled)} of {len(recs)}")
    for mod in ("serial", "fastapi", "uvicorn", "scipy"):
        try:
            __import__(mod)
        except ImportError:
            ok = False
            print(f"  [!!]  python package missing: {mod}")
    print("\n" + ("Ready." if ok else "Some items need attention (see above)."))
    return 0 if ok else 1


def cmd_serve(a) -> int:
    import uvicorn
    from .hub import AankhenHub
    from .server import create_standalone_app
    hub = AankhenHub()
    if a.replay:
        info = hub.start("replay", path=a.replay, speed=a.speed, loop=True)
    elif a.sim:
        info = hub.start("simulation", scenario=a.sim, speed=a.speed)
    elif a.port:
        info = hub.start("hardware", port=a.port)
    else:
        info = hub.start("auto")
    host = "0.0.0.0" if a.lan else "127.0.0.1"
    print(f"Aankhen: source={info['kind']} mode={info['mode']} "
          f"{'scenario=' + info['scenario'] if info['scenario'] else ''}")
    print(f"Open http://localhost:{a.http_port}/")
    if a.lan:
        print("LAN mode: anyone on this network can open the viewer. Home presence data is "
              "personal — use it on a network you trust.")
    try:
        uvicorn.run(create_standalone_app(hub), host=host, port=a.http_port, log_level="warning")
    finally:
        hub.stop()
    return 0


def cmd_record(a) -> int:
    from .transport import SerialSource
    os.makedirs(RECORDINGS, exist_ok=True)
    stamp = time.strftime("%Y%m%d-%H%M%S")
    path = a.out or os.path.join(RECORDINGS, f"{stamp}-{a.label}.akr")
    src = SerialSource(a.port, on_status=lambda m: print(f"  {m}"))
    src.record_to(path, {"label": a.label, "seconds": a.seconds, "people": a.people})
    print(f"Recording {a.seconds:.0f} s labelled '{a.label}' -> {path}")
    src.start()
    if not src.connected.wait(timeout=10):
        print("No ESP32 connected within 10 s.")
        src.stop()
        return 1
    t0 = time.time()
    try:
        while time.time() - t0 < a.seconds:
            time.sleep(1)
            st = src.decoder.stats
            print(f"\r  {time.time() - t0:5.0f} s  frames {st.frames_ok}  crc errors {st.crc_errors}"
                  f"  loss {st.loss_ratio():.1%}", end="")
    finally:
        src.stop()
    print()
    labels = path[:-4] + ".labels.json"
    seg = {"start": 0, "end": a.seconds, "label": a.label}
    if a.label != "empty":
        seg["people"] = a.people
    with open(labels, "w", encoding="utf-8") as f:
        json.dump({"kind": "human-labels", "segments": [seg]}, f, indent=2)
    print(f"Labels -> {labels}")
    return 0


def cmd_calibrate(a) -> int:
    from .bench import calibrate_from_bytes
    from .hub import BASELINE_FAN_FILE, BASELINE_FILE
    from .transport import SerialSource, iter_recording
    if a.recording:
        chunks = (d for _, d in iter_recording(a.recording))
    else:
        print(f"Calibrating: keep the room EMPTY for {a.seconds:.0f} s"
              + (", with the ceiling fan RUNNING at its usual speed." if a.fan else ", fan off."))
        src = SerialSource(a.port)
        buf = []
        src._ingest = lambda data, t=None: buf.append(data)      # capture raw bytes
        src.start()
        time.sleep(a.seconds)
        src.stop()
        chunks = iter(buf)
    try:
        b = calibrate_from_bytes(chunks, fan=a.fan)
    except RuntimeError as e:
        print(f"Calibration failed: {e}")
        return 1
    b.source = "calibrated (fan on)" if a.fan else "calibrated"
    path = BASELINE_FAN_FILE if a.fan else BASELINE_FILE
    b.save(path)
    print(f"Baseline saved -> {path}\n  median MVS {b.median:.3g}, "
          f"99.5th pct {b.q_hi:.3g}, {b.n_windows} windows")
    return 0


def cmd_bench(a) -> int:
    from .bench import (SUITE_SECONDS, bench_recording, format_summary, format_table, run_suite,
                        simulated_baseline, summarise)
    from .hub import BASELINE_FILE
    from .motion import Baseline
    results = []
    files = a.files or sorted(glob.glob(os.path.join(RECORDINGS, "*.akr")))
    files = [f for f in files if os.path.exists(f[:-4] + ".labels.json")]
    real_baseline = Baseline.load(BASELINE_FILE)
    for f in files:
        try:
            from .transport import read_recording_meta
            sim = read_recording_meta(f).get("source") == "simulation"
            results.append(bench_recording(f, baseline=simulated_baseline() if sim else real_baseline))
        except Exception as e:
            print(f"  skipped {f}: {e}")
    if results:
        print(format_table(results))
    sim_results = []
    if a.sim or not files:
        if not files:
            print("No labelled real recordings yet — running the simulated suite.\n")
        scenarios = a.scenarios.split(",") if a.scenarios else list(SUITE_SECONDS)
        unknown = [s for s in scenarios if s not in SUITE_SECONDS]
        if unknown:
            print(f"unknown scenario(s) {unknown}; one of {sorted(SUITE_SECONDS)}")
            return 2
        seeds = list(range(a.seed_base, a.seed_base + a.seeds))
        rooms = list(range(a.channel_seeds))
        t0 = time.time()
        sim_results = run_suite(scenarios, seeds, rooms, workers=a.workers)
        if a.runs:
            print(format_table(sim_results) + "\n")
        print(f"{len(sim_results)} runs: seeds {seeds[0]}..{seeds[-1]}, "
              f"{len(rooms)} room(s), {time.time() - t0:.0f} s wall\n")
        print(format_summary(summarise(sim_results)))
        print("\nSYNTHETIC: these rows check the pipeline against the simulator's physics, "
              "not the real room. 'worst' is the worst run for EACH column separately.")
    if a.json:
        with open(a.json, "w", encoding="utf-8") as fh:
            json.dump([r.to_dict() for r in results + sim_results], fh, indent=2)
    return 0


def cmd_simulate(a) -> int:
    from .simulator import SCENARIOS, Simulator
    out = a.out or os.path.join(RECORDINGS, f"sim-{a.scenario}-{a.seconds:.0f}s.akr")
    res = Simulator(scenario=SCENARIOS[a.scenario](), seed=a.seed).write_recording(out, a.seconds)
    print(json.dumps(res, indent=2))
    return 0


def main(argv=None) -> int:
    p = argparse.ArgumentParser(prog="python -m aankhen", description=__doc__.split("\n")[0])
    sub = p.add_subparsers(dest="cmd", required=True)

    sub.add_parser("doctor", help="check ports, layout, baseline, recordings")

    s = sub.add_parser("serve", help="run the hub + phone/AR viewer")
    s.add_argument("--sim", metavar="SCENARIO", help="simulate: evening | walk | still | empty")
    s.add_argument("--replay", metavar="FILE")
    s.add_argument("--port", help="serial port, e.g. COM9 (default: auto-detect)")
    s.add_argument("--speed", type=float, default=1.0)
    s.add_argument("--http-port", type=int, default=8770)
    s.add_argument("--lan", action="store_true", help="listen on all interfaces (phone / AR)")

    r = sub.add_parser("record", help="record a labelled real session")
    r.add_argument("--seconds", type=float, default=60)
    r.add_argument("--label", required=True, choices=["empty", "walking", "standing", "sitting", "lying"])
    r.add_argument("--people", type=int, default=1)
    r.add_argument("--port")
    r.add_argument("--out")

    c = sub.add_parser("calibrate", help="measure the empty-room Wi-Fi baseline")
    c.add_argument("--seconds", type=float, default=70)
    c.add_argument("--port")
    c.add_argument("--recording", help="calibrate from an existing empty-room recording")
    c.add_argument("--fan", action="store_true",
                   help="the fan-on baseline: room empty, ceiling fan running")

    b = sub.add_parser("bench", help="score recordings (and/or the simulator) against truth")
    b.add_argument("files", nargs="*")
    b.add_argument("--sim", action="store_true", help="also run the simulated suite")
    b.add_argument("--scenarios", help="comma-separated subset of the simulated suite")
    b.add_argument("--seeds", type=int, default=3, help="noise seeds per scenario (default 3)")
    b.add_argument("--seed-base", type=int, default=1,
                   help="first seed; tune on one range, report on another")
    b.add_argument("--channel-seeds", type=int, default=1,
                   help="simulated rooms (static multipath), each with its own calibration")
    b.add_argument("--workers", type=int, default=max(1, (os.cpu_count() or 2) - 2),
                   help="parallel processes")
    b.add_argument("--runs", action="store_true", help="also print every individual run")
    b.add_argument("--json", help="write results as JSON")

    m = sub.add_parser("simulate", help="write a simulated recording + answer key")
    m.add_argument("--scenario", default="evening")
    m.add_argument("--seconds", type=float, default=220)
    m.add_argument("--seed", type=int, default=1)
    m.add_argument("--out")

    a = p.parse_args(argv)
    return {"doctor": cmd_doctor, "serve": cmd_serve, "record": cmd_record,
            "calibrate": cmd_calibrate, "bench": cmd_bench, "simulate": cmd_simulate}[a.cmd](a)


if __name__ == "__main__":
    sys.exit(main())
