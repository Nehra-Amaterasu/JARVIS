"""Aankhen command line.

    python -m aankhen doctor                       is everything plugged in and sane?
    python -m aankhen serve [--sim SCENARIO | --replay FILE | --port COM9] [--lan]
    python -m aankhen record --seconds 60 --label empty     labelled real recording
    python -m aankhen calibrate --seconds 70 [--fan]         empty-room Wi-Fi baseline (fan off / on)
    python -m aankhen bench [FILES...] [--sim --seeds 5]     score against ground truth
    python -m aankhen simulate --scenario evening --seconds 220 --out recordings/x.akr

Run from the JARVIS folder with the project venv (.venv). Layout, baselines,
recordings and models live in data/aankhen/.

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

from . import DATA_DIR  # noqa: E402

RECORDINGS = os.path.join(DATA_DIR, "recordings")      # data/aankhen/recordings, git-ignored


def cmd_doctor(a) -> int:
    from .boards import BoardFinder
    from .room import ROOM_FILE, layout_kind, load_room
    from .hub import BASELINE_FILE
    ok = True
    print("Aankhen doctor\n")
    # A board is what SAYS it is one: listen to every USB serial port for an Aankhen
    # frame (nothing is sent). A USB vendor id alone would call an Uno an ESP32.
    print("  Listening to each USB serial port for an Aankhen frame (2 s, nothing is sent)...")
    results = BoardFinder().scan(force=True)
    boards = [r for r in results if r.is_board]
    for r in results:
        tag = "ok" if r.is_board else "--"
        print(f"  [{tag}]  {r.port or r.device}: {r.detail}")
    if not boards:
        ok = False
        print("  [--]  no Aankhen board answered. Plug it in with a DATA cable (charge-only")
        print("        cables are common) and flash aankhen/firmware. Bluetooth COM ports are")
        print("        ignored on purpose.")
    room, measured = load_room()
    kind = layout_kind()
    print(f"  [{'ok' if measured else '--'}]  room layout: " + {
        "measured": ROOM_FILE,
        "estimated": f"{ROOM_FILE} is an estimate (measure it, then set \"measured\": true)",
        "default": "default 4x4 m (copy room.example.json -> room.json and measure)",
    }[kind])
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
    # A board plugged in later takes over from an automatic simulation; a chosen one
    # (--sim) stays, and the board is announced.
    hub.enable_hotplug(lambda kind, text, **_: print(f"  {text}"))
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
        print("No Aankhen board answered within 10 s (no valid frame on any port).")
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
        ingest = src._ingest

        def capture(data, t=None):          # keep the raw bytes, and still decode them:
            buf.append(data)                # the decoder is what sees the board's handshake
            ingest(data, t)
        src._ingest = capture
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
    from .bench import (ROOM_SCENARIO_SECONDS, SUITE_SECONDS, bench_recording, format_summary, format_table, run_suite,
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
        known = {**SUITE_SECONDS, **ROOM_SCENARIO_SECONDS}
        unknown = [s for s in scenarios if s not in known]
        if unknown:
            print(f"unknown scenario(s) {unknown}; one of {sorted(known)}")
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


def cmd_physics(a) -> int:
    """Predict, from the physics model, what the Wi-Fi link can sense at every spot."""
    from .physics import analyse, html_report, search_placement
    from .room import SensorPose, layout_kind, load_room
    room, measured = load_room(a.room)
    kind = layout_kind(a.room)
    if kind == "default":
        print("NOTE: no room.json yet, so this uses the default 4 x 4 m layout. Measure your room.")
    elif kind == "estimated":
        print("NOTE: the room layout is an estimate (\"measured\": false), so these predictions are too.")
    links = room.links or [[s.id for s in room.sensors_of("router")][:1] + [s.id for s in room.sensors_of("esp32")][:1]]
    tx, rx = room.sensor(links[0][0]), room.sensor(links[0][1])
    if a.tx:
        x, y, z = (float(v) for v in a.tx.split(","))
        tx = SensorPose("tx", "esp32", x, y, z)
    if a.rx:
        x, y, z = (float(v) for v in a.rx.split(","))
        rx = SensorPose("esp32", "esp32", x, y, z)
    print(f"link {tx.id} ({tx.x}, {tx.y}, {tx.z}) -> {rx.id} ({rx.x}, {rx.y}, {rx.z}); "
          f"{a.rooms} simulated rooms per pipeline, computing...")
    reps = {mode: analyse(room, tx, rx, step=a.step, chest_mm=a.chest_mm, mode=mode, rooms=a.rooms)
            for mode in ("gain", "normalised")}
    rep = reps["gain"]
    print(f"RSSI {rep.rssi_dbm} dBm, CSI SNR {rep.csi_snr_db} dB, {rep.walls_on_los} wall(s) on the line of sight")
    print(f"room wander sigma {rep.sigma_env} ({rep.sigma_env_source})")
    for mode, label in (("gain", "WITH the gain library"), ("normalised", "WITHOUT it (current firmware)")):
        print(f" {label}:")
        for n, z in reps[mode].zones.items():
            spread = z.get("likely_by_room")
            rng = f" (rooms: {min(spread):.0%}-{max(spread):.0%})" if spread else ""
            print(f"  {n:8} {z['posture']:7} breathing likely {z['likely']:.0%}{rng}, unlikely {z['unlikely']:.0%}; "
                  f"walking seen {z['walk_detect']:.0%}")
    if rep.outside_vs_inside_motion is not None:
        print(f"  walking just outside the room looks {rep.outside_vs_inside_motion}x as strong as inside")
    placements = None
    if a.place:
        print("searching ESP32 positions along the walls (a few minutes)...")
        placements = search_placement(room, tx)
        for s, p, r in placements[:5]:
            print(f"  ({p.x:.2f}, {p.y:.2f}, {p.z:.1f} m) score {s:.2f}: " +
                  ", ".join(f"{n} {z['likely']:.0%}" for n, z in r.zones.items()))
    out = a.out or os.path.join(RECORDINGS, "physics-report.html")
    os.makedirs(os.path.dirname(os.path.abspath(out)), exist_ok=True)
    with open(out, "w", encoding="utf-8") as f:
        f.write(html_report(room, rep, tx, rx, a.step, placements, compare=reps["normalised"]))
    print(f"report: {out}")
    return 0


def cmd_validate(a) -> int:
    """Guided ground-truth session in the real room (validate.py)."""
    from .room import layout_kind, load_room
    from .validate import analyse, print_report, run_session, save_calibration
    if a.analyse:
        with open(os.path.join(a.analyse, "session.json"), encoding="utf-8") as f:
            paths = json.load(f)["paths"]
    else:
        out = os.path.join(RECORDINGS, "validate-" + time.strftime("%Y%m%d-%H%M%S"))
        try:
            paths = run_session(a.port, out, hallway=not a.no_hallway)
        except RuntimeError as e:
            print(f"Stopped: {e}")
            return 1
    room, _ = load_room()
    kind = layout_kind()
    rep = analyse(paths, None if kind == "default" else room)
    print_report(rep)
    saved = save_calibration(rep)
    if saved:
        print(f"room wander saved -> {saved} (physics predictions now use it)")
    if kind == "default":
        print("No room.json: the model comparison was skipped.")
    elif kind == "estimated":
        print("The model comparison used an estimated room layout; measure it for a fair one.")
    return 0


def _learn_data(items: list[str]) -> list[dict]:
    from .learn import load_runs, recorded_dataset
    runs, real = [], []
    for it in items:
        if it.endswith(".npz"):
            runs += load_runs(it)
        else:
            real.append(it)
    return runs + (recorded_dataset(real) if real else [])


def _print_eval(rep: dict) -> None:
    pct = lambda v: "   -" if v is None else f"{v * 100:5.1f}%"
    print(f"windows: {rep['windows']}  " + "  ".join(f"{c} {n}" for c, n in rep["classes"].items()))
    rows = [("learned, raw", rep["classifier"]), ("learned + movement rules", rep["filtered"])]
    if "today_engine" in rep:
        rows.append(("today's engine", rep["today_engine"]))
    print(f"\n{'':26s} {'occupancy':>10s} {'false occ.':>11s} {'false occ.':>11s} {'missed':>8s}")
    print(f"{'':26s} {'accuracy':>10s} {'(outside)':>11s} {'(empty)':>11s} {'person':>8s}")
    for name, r in rows:
        print(f"{name:26s} {pct(r.get('occ_accuracy')):>10s} {pct(r.get('occ_false_occupied_when_outside')):>11s} "
              f"{pct(r.get('occ_false_occupied_when_empty')):>11s} {pct(r.get('occ_missed_when_occupied')):>8s}")
    f = rep["filtered"]
    print(f"\nfive-way accuracy: raw {pct(rep['classifier']['accuracy'])}, with movement rules {pct(f['accuracy'])}")
    if "zone_accuracy_when_occupied" in f:
        print(f"where (room / desk / bed) when someone is in: {pct(f['zone_accuracy_when_occupied'])}")
    print("\nconfusion (rows: truth, columns: said):")
    from .learn import CLASSES
    print(" " * 9 + "".join(f"{c:>9s}" for c in CLASSES))
    for t, row in rep["confusion_filtered"].items():
        print(f"{t:9s}" + "".join(f"{row[c]:9d}" for c in CLASSES))


def cmd_learn(a) -> int:
    """Spatial model: simulated or recorded data -> trained model -> evaluation."""
    from .learn import MODEL_DIR, MODEL_FILE, SpatialModel, evaluate, save_runs, simulate_dataset, train
    from .room import layout_kind, load_room
    if a.action == "simulate":
        room, _ = load_room()
        if layout_kind() == "default":
            print("NOTE: no room.json, so this simulates the default 4 x 4 m layout.")
        out = a.out or os.path.join(MODEL_DIR, f"sim-{a.seed}-{a.runs}x{int(a.seconds)}s.npz")
        t0 = time.time()
        runs = simulate_dataset(room, a.runs, a.seconds, a.seed, workers=a.workers)
        save_runs(runs, out)
        n = sum(len(r["y"]) for r in runs)
        print(f"{len(runs)} simulated days, {n} windows, {time.time() - t0:.0f} s -> {out}")
        print("SYNTHETIC: simulator physics, not your room's. Real data: validate sessions / record --label.")
        return 0
    if a.action == "train":
        runs = _learn_data(a.data)
        if not runs:
            print("No data. Give --data with a .npz from `learn simulate`, validate folders or labelled .akr files.")
            return 1
        model = train(runs, note="; ".join(a.data))
        model.save(a.out or MODEL_FILE)
        print(f"trained on {model.trained_on['windows']} windows from {len(runs)} runs -> {a.out or MODEL_FILE}")
        if a.test:
            _print_eval(evaluate(model, _learn_data(a.test)))
        return 0
    model = SpatialModel.load(a.out or MODEL_FILE)
    if model is None:
        print("No trained model yet: run `python -m aankhen learn train --data ...` first.")
        return 1
    runs = _learn_data(a.test or a.data)
    if not runs:
        print("No evaluation data: give --test (held out from training).")
        return 1
    _print_eval(evaluate(model, runs))
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

    ph = sub.add_parser("physics", help="predict what the Wi-Fi link can sense, spot by spot")
    ph.add_argument("--room", help="room layout JSON (default: aankhen/room.json)")
    ph.add_argument("--out", help="HTML report path (default: recordings/physics-report.html)")
    ph.add_argument("--step", type=float, default=0.2, help="grid cell size in metres")
    ph.add_argument("--chest-mm", type=float, default=3.0, help="peak chest displacement")
    ph.add_argument("--place", action="store_true", help="also search the best ESP32 position")
    ph.add_argument("--tx", metavar="X,Y,Z", help="override the transmitter position")
    ph.add_argument("--rx", metavar="X,Y,Z", help="override the ESP32 position")
    ph.add_argument("--rooms", type=int, default=3,
                    help="draws of the unlisted clutter to average over (the spread is reported)")

    v = sub.add_parser("validate", help="guided ground-truth session in the real room")
    v.add_argument("--port")
    v.add_argument("--analyse", metavar="DIR", help="re-analyse a previous session's recordings")
    v.add_argument("--no-hallway", action="store_true", help="skip the walk outside the door")

    fl = sub.add_parser("firstlight", help="2-minute voice-guided test: does the real board see you?")
    fl.add_argument("--port")
    fl.add_argument("--no-voice", action="store_true")

    lr = sub.add_parser("learnroom", help="~8-minute voice-guided session: where you are and what you are doing")
    lr.add_argument("--port")
    lr.add_argument("--rounds", type=int, default=1)
    lr.add_argument("--no-voice", action="store_true")

    ln = sub.add_parser("learn", help="spatial model trained on data: simulate, train, evaluate")
    ln.add_argument("action", choices=["simulate", "train", "eval"],
                    help="simulate: build a simulated dataset · train: fit the model · eval: score it")
    ln.add_argument("--data", nargs="*", default=[],
                    help="datasets (.npz from `learn simulate`), validate session folders, or labelled .akr files")
    ln.add_argument("--test", nargs="*", default=[], help="(train/eval) held-out data, same kinds as --data")
    ln.add_argument("--runs", type=int, default=32, help="(simulate) simulated days")
    ln.add_argument("--seconds", type=float, default=600.0, help="(simulate) length of each day")
    ln.add_argument("--seed", type=int, default=1000, help="(simulate) first seed")
    ln.add_argument("--out", help="(simulate) dataset path; (train) model path")
    ln.add_argument("--workers", type=int, default=max(1, (os.cpu_count() or 2) - 2))

    a = p.parse_args(argv)
    return {"doctor": cmd_doctor, "serve": cmd_serve, "record": cmd_record,
            "calibrate": cmd_calibrate, "bench": cmd_bench, "simulate": cmd_simulate,
            "physics": cmd_physics, "validate": cmd_validate, "learn": cmd_learn,
            "learnroom": lambda a: print(__import__("aankhen.firstlight", fromlist=["x"]).run_room_session(a.port, not a.no_voice, a.rounds)) or 0,
            "firstlight": lambda a: __import__("aankhen.firstlight", fromlist=["main"]).main(a.port, not a.no_voice)}[a.cmd](a)


if __name__ == "__main__":
    sys.exit(main())
