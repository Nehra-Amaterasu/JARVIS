"""Aankhen command line.

    python -m aankhen doctor                       is everything plugged in and sane?
    python -m aankhen serve [--sim SCENARIO | --replay FILE | --port COM9] [--lan]
    python -m aankhen record --seconds 60 --label empty     labelled real recording
    python -m aankhen calibrate --seconds 70 [--fan]         empty-room Wi-Fi baseline (fan off / on)
    python -m aankhen bench [FILES...] [--sim --seeds 5]     score against ground truth
    python -m aankhen simulate --scenario evening --seconds 220 --out recordings/x.akr
    python -m aankhen worldmodel train|eval [RECORDINGS...] --out MODEL  self-supervised world model
    python -m aankhen drill [--minutes 26] [--zones a,b] [--fan both|on|off]   the daily labelled drill
    python -m aankhen evaluate --leave-one-day-out    judge drill-trained models by days they never saw
    python -m aankhen train                           train zones + activities on every drill day
    python -m aankhen zones [--write]                 the zone map (write data/aankhen/zones.json to edit)
    python -m aankhen narrate record|label|list       label a real routine by narrating into the phone
    python -m aankhen lesson1 <session | .akr>        see your own signal before any model (PNG)

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


def cmd_worldmodel(a) -> int:
    """Self-supervised world model of the Wi-Fi change picture (worldmodel.py), and how it
    scores against human-band energy and the hand-made features (worldeval.py)."""
    # CPU only: the GPU belongs to the local LLM and Whisper. Set before torch loads.
    os.environ.setdefault("CUDA_VISIBLE_DEVICES", "")
    from . import worldmodel as wm
    out = a.out or wm.MODEL_FILE
    if a.action == "train":
        # recordings/*.akr only: recordings/discarded/ (mislabelled sessions) is never read
        paths = a.recordings or sorted(glob.glob(os.path.join(RECORDINGS, "*.akr")))
        paths = [p for p in paths if not any(x in os.path.basename(p) for x in a.exclude)]
        if not paths:
            print("No recordings to learn from.")
            return 1
        print(f"pictures from {len(paths)} recordings ({'amplitude + phase' if a.phase else 'amplitude'})...")
        pics = [wm.change_picture(wm.replay(p, phase=a.phase), phase=a.phase) for p in paths]
        m = wm.train(pics, kind=a.kind, seed=a.seed, minutes=a.minutes, threads=a.threads,
                     **({"max_steps": a.steps} if a.steps else {}))
        m.save(out)
        v = m.meta
        print(f"{v['kind']} model, {v['parameters']} parameters, {v['minutes_of_data']} min of pictures, "
              f"{v['steps']} steps in {v['seconds']:.0f} s -> {out}")
        b = v["validation_baselines"]
        print(f"held-out minutes, error of the next 0.5 s (noise units^2): network {v['validation_error']}, "
              f"linear {b['linear']}, last frame held {b['persist']}, zero {b['zero']}")
        return 0
    from . import worldeval as we
    m = wm.WorldModel.load(out)
    if m is None:
        print(f"No world model at {out}: run `python -m aankhen worldmodel train` first.")
        return 1
    rep = we.evaluate(m, a.recordings or we.default_paths(), features=not a.no_features)
    we.print_report(rep)
    if a.json:
        with open(a.json, "w", encoding="utf-8") as fh:
            json.dump(rep, fh, indent=1, default=float)
    return 0


def _app_api() -> tuple:
    """(base, token) of the running JARVIS app, or (None, why). The app writes its port and
    this launch's token to <data>/app/runtime/aankhen-api.json (routes_aankhen_drill.py)."""
    import urllib.request
    data = os.environ.get("JARVIS_DATA_DIR") or os.path.join(os.path.dirname(DATA_DIR), "app")
    try:
        with open(os.path.join(data, "runtime", "aankhen-api.json"), encoding="utf-8") as f:
            rt = json.load(f)
    except (OSError, ValueError):
        return None, "no app runtime file"
    try:
        req = urllib.request.Request(rt["base"] + "/api/aankhen", headers={"x-jarvis-token": rt["token"]})
        # 6 s, not 2: on 2026-10-26 the busy app (0.5 GB RAM free) took over 2 s, so the CLI
        # decided "not running" and tried to open COM9, which the app holds
        with urllib.request.urlopen(req, timeout=6) as r:
            info = json.loads(r.read().decode())
        return (rt["base"], rt["token"], info), None
    except Exception as e:
        return None, f"app not answering ({type(e).__name__})"


def cmd_drill(a) -> int:
    from . import drill as dr
    from .teachers import FreeTeachers
    seed = a.seed if a.seed is not None else int(time.time() // 86400)
    zones = [z.strip() for z in a.zones.split(",")] if a.zones else None
    try:
        blocks = dr.plan_session(seed, a.minutes, zones, a.fan, a.block_seconds)
    except ValueError as e:
        print(f"  {e}")
        return 2
    print(dr.describe_plan(blocks))
    if a.plan:
        return 0
    app, why = _app_api()
    if app is not None:
        base, token, info = app
        if info.get("mode") != "hardware":
            print(f"  The JARVIS app is running but Aankhen is on {info.get('mode')!r}, not the board."
                  " Press ESP32 on the Aankhen tab, then run the drill again.")
            return 1
        print(f"  Recording through the running app ({base}); the drill does not open the port itself.")
        backend = dr.HttpBackend(base, token)
    else:
        print(f"  The JARVIS app is not running ({why}): opening the board directly.")
        try:
            backend = dr.DirectBackend(a.port)
        except RuntimeError as e:
            print(f"  {e}")
            return 1
    inputs = FreeTeachers(write_lines=False).start()
    speak = dr.speak_default if not a.no_voice else (lambda t: print(f"  JARVIS: {t}\a", flush=True))
    runner = dr.DrillRunner(backend, dr.KeyboardConfirmer(), speak=speak, inputs=inputs,
                            min_rate=a.min_rate)
    print("\n  Keys: Enter = ready / done as asked;  r = redo;  b = bad;  w <zone> = I was really there;"
          "  q = stop.\n")
    try:
        res = runner.run(blocks, seed, note=a.note or "")
    except KeyboardInterrupt:
        runner.stop()
        print("\n  Stopped.")
        return 1
    finally:
        inputs.stop()
        backend.close()
    print(f"\n  Session {res['session']}: {res['state']}, {res['passed']} passed, {res['failed']} failed.")
    print(f"  Saved in {res['folder']}")
    print(json.dumps(res["summary"], indent=1))
    return 0


def cmd_evaluate(a) -> int:
    from .dayeval import format_report, leave_one_day_out, load_days
    days = load_days(a.root)
    rep = leave_one_day_out(days)
    print(format_report(rep))
    if a.json:
        with open(a.json, "w", encoding="utf-8") as fh:
            json.dump(rep, fh, indent=1, default=float)
    return 0


def cmd_fingerprint(a) -> int:
    """kNN fingerprint vs CNN on the raw signal: evaluate (50/50 or leave-one-day-out) or train."""
    from .fingerprint import (MODEL_ROOT, CnnFingerprint, _cat, evaluate_half, format_half, format_report,
                              leave_one_day_out, load_days, plot_history)
    days = load_days(a.root)
    if not days:
        print("No drill or narrated sessions yet. Record one with: python -m aankhen narrate record")
        return 1
    if a.action == "evaluate":
        split = a.split or ("day" if len(days) >= 3 else "half")
        if split == "half":
            rep = evaluate_half(days, epochs=a.epochs)
            print(format_half(rep))
            if rep.get("history"):
                os.makedirs(os.path.join(MODEL_ROOT, "reports"), exist_ok=True)
                stamp = time.strftime("%Y%m%d-%H%M%S")
                png = plot_history(rep, os.path.join(MODEL_ROOT, "reports", f"half-{stamp}.png"))
                with open(os.path.join(MODEL_ROOT, "reports", f"half-{stamp}.json"), "w", encoding="utf-8") as fh:
                    json.dump(rep, fh, indent=1, default=float)
                print(f"  training record: {png} (+ .json)")
        else:
            rep = leave_one_day_out(days, epochs=a.epochs)
            print(format_report(rep))
        if a.json:
            with open(a.json, "w", encoding="utf-8") as fh:
                json.dump(rep, fh, indent=1, default=float)
        return 0
    runs = [r for d in sorted(days) for r in days[d]]
    import numpy as np
    from .fingerprint import cap_per_place
    X, y, t = _cat(runs, "X"), _cat(runs, "zone"), _cat(runs, "t")
    keep = cap_per_place(np.arange(len(y)), y, t)          # same per-place cap as evaluate
    m = CnnFingerprint(epochs=a.epochs).fit(X[keep], y[keep])
    counts = {z: int((y[keep] == z).sum()) for z in sorted(set(y[keep].tolist()))}
    out = m.save(meta={"days": sorted(days), "windows": int(len(keep)), "windows_before_cap": int(len(y)),
                       "per_place": counts})
    print(f"CNN ({m.weights()} weights) on {len(days)} day(s), {len(keep)} windows after the cap -> {out}")
    print("  per place: " + ", ".join(f"{z} {n}" for z, n in counts.items()))
    return 0


def _recording_backend(port):
    """Through the running app if it is on the board, else the board directly. (backend, why-not)."""
    from . import drill as dr
    app, why = _app_api()
    if app is not None:
        base, token, info = app
        if info.get("mode") != "hardware":
            return None, (f"The JARVIS app is running but Aankhen is on {info.get('mode')!r}, not the board."
                          " Press ESP32 on the Aankhen tab, then try again.")
        print(f"  Recording through the running app ({base}).")
        return dr.HttpBackend(base, token), None
    print(f"  The JARVIS app is not running ({why}): opening the board directly.")
    try:
        return dr.DirectBackend(port), None
    except RuntimeError as e:
        return None, str(e)


def cmd_narrate(a) -> int:
    """Record a real routine with sync chirps, then turn the phone's narration into labels."""
    import threading
    from . import narrate as nr
    if a.action == "check":
        # a live meter for placing the board: move it, watch the rate and RSSI settle
        backend, why = _recording_backend(a.port)
        if backend is None:
            print(f"  {why}")
            return 1
        print("  Move the board slowly; each line is 2 s. Good enough to record: >= 150 CSI/s and RSSI >= -80 dBm."
              " Ctrl+C to stop.")
        try:
            prev = backend.sample()
            while True:
                time.sleep(2.0)
                cur = backend.sample()
                rate = (cur.get("csi_packets", 0) - prev.get("csi_packets", 0)) / max(cur.get("t", 0) - prev.get("t", 0), 1e-3)
                rssi = cur.get("rssi")
                ok = rate >= 150 and rssi is not None and rssi >= -80
                bar = "#" * int(min(rate, 400) / 20)
                print(f"  {time.strftime('%H:%M:%S')}  {rate:5.0f} CSI/s  RSSI {rssi} dBm  {bar:<20}  {'GOOD' if ok else 'too weak'}",
                      flush=True)
                prev = cur
        except KeyboardInterrupt:
            pass
        finally:
            backend.close()
        return 0
    if a.action == "list":
        for s in nr.sessions():
            mins = sum(l["t_end"] - l["t_start"] for l in s["labels"]) / 60
            print(f"  {s['day']}  {s['session']}  {len(s['labels'])} stretches, {mins:.1f} min labelled")
        unlabelled = [f for f in [nr.latest()] if f and not os.path.exists(os.path.join(f, "labels.jsonl"))]
        for f in unlabelled:
            print(f"  not labelled yet: {f}")
        return 0
    if a.action == "label":
        if not a.folder:
            print("  usage: python -m aankhen narrate label <session folder | latest> [audio file]"
                  "  (no audio: label again from the saved transcript)")
            return 2
        folder = nr.latest() if a.folder == "latest" else a.folder
        if not folder:
            print("  No narration session found.")
            return 1
        try:
            if a.audio:
                rep = nr.label_session(folder, a.audio, language=None if a.language == "auto" else a.language, dry_run=a.dry_run)
            else:
                rep = nr.relabel(folder, dry_run=a.dry_run)
        except ValueError as e:
            print(f"  {e}")
            return 1
        info = nr.load_session(folder)
        print(f"  sync sounds found at {[s['audio_s'] for s in rep['syncs']]} s of the audio")
        print(nr.format_labels(rep, info.host_start_sync))
        print("  (dry run: nothing written)" if a.dry_run else
              f"\n  Wrote {os.path.join(folder, 'labels.jsonl')}: fix any wrong line by hand, then run"
              " python -m aankhen fingerprint evaluate")
        return 0
    # record
    backend, why = _recording_backend(a.port)
    if backend is None:
        print(f"  {why}")
        return 1
    info = nr.new_session(fan=(a.fan == "on"), note=a.note or "")
    info.backend = backend.kind
    try:
        info.firmware = backend.firmware()
    except Exception:
        pass
    raw = os.path.join(info.folder, "raw.akr")
    backend.start_recording(raw, {"label": "narrate", "session": info.session})
    nr.save_session(info)
    try:
        s0 = backend.sample()
        time.sleep(2.0)
        s1 = backend.sample()
        rate = (s1.get("csi_packets", 0) - s0.get("csi_packets", 0)) / max(s1.get("t", 1) - s0.get("t", 0), 1e-3)
        print(f"  Board: {rate:.0f} CSI packets/s, RSSI {s1.get('rssi')} dBm.")
        if rate < 50:
            print("  Warning: almost no CSI is arriving. Check the board before you go on.")
        spk, spk_name = nr.pick_speaker(a.speaker)
        print(f"  Chirps play on: {spk_name}" + ("   <- headphones? the phone will not hear it: unplug them or use --speaker"
                                                if any(w in spk_name.lower() for w in ("headphone", "headset", "bt-", "buds")) else ""))
        input("  1) Start the phone's voice recorder NOW, hold it near the laptop, then press Enter here.")
        info.host_start_sync = nr.play_sync(a.volume, spk)
        nr.save_session(info)
        print("  Chirp played. Keep the phone recording, put it in your pocket and go about your routine.\n"
              "  Say where you are as you move: 'desk chair', 'wardrobe', 'bathroom', 'on the bed', 'leaving the room'...\n"
              "  When you are back at the laptop, press Enter here (the end chirp fixes the phone's clock drift).\n"
              f"  If you never press it, recording stops by itself after {a.max_minutes:.0f} min (no end chirp).")
        done = threading.Event()
        threading.Thread(target=lambda: (input(), done.set()), daemon=True).start()
        pressed = done.wait(timeout=a.max_minutes * 60)
        if pressed:
            info.host_end_sync = nr.play_sync(a.volume, spk)
            print("  End chirp played. You can stop the phone recording now.")
    except KeyboardInterrupt:
        print("\n  Stopped (no end chirp).")
    finally:
        backend.stop_recording()
        info.stopped = time.time()
        nr.save_session(info)
        backend.close()
    print(f"\n  Saved {info.folder}\n  Next: copy the phone's audio file to the laptop and run\n"
          "    .venv\\Scripts\\python.exe -m aankhen narrate label latest <path to the audio file>")
    return 0


def cmd_train(a) -> int:
    from .dayeval import MODEL_ROOT, load_days, train_all
    days = load_days(a.root)
    try:
        m, folder = train_all(days, a.out or MODEL_ROOT)
    except ValueError as e:
        print(f"  {e}")
        return 1
    print(f"  Trained on {m.trained_on['windows']} windows from {len(days)} day(s); saved {folder}")
    print("  The app uses it from its next Aankhen start. Older versions are kept beside it.")
    return 0


def cmd_zones(a) -> int:
    from .room import load_room
    from .zones import ZONES_FILE, ZoneMap, default_zones, load_zones
    room, _ = load_room()
    zm = load_zones(room)
    print(f"  zones from: {zm.source}" + (f" ({ZONES_FILE})" if zm.source == "file" else " (room.json)"))
    for z in zm.zones:
        print(f"  {z.id:30s} x {z.x:5.2f}  y {z.y:5.2f}  r {z.r:4.2f}  {'in room ' if z.in_room else 'outside '}"
              f"{'estimate' if z.estimate else 'measured'}  {z.name}")
    if a.write:
        if os.path.exists(ZONES_FILE) and not a.force:
            print(f"  {ZONES_FILE} exists; --force overwrites it with the derivation from room.json.")
            return 1
        path = ZoneMap(default_zones(room)).save(ZONES_FILE)
        print(f"  Wrote {path}. Edit x, y, r there; set \"estimate\": false when measured.")
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

    wm = sub.add_parser("worldmodel", help="self-supervised world model of the change picture: train, eval")
    wm.add_argument("action", choices=["train", "eval"],
                    help="train: learn to predict the next 0.5 s · eval: surprise vs HBE, embedding vs features")
    wm.add_argument("recordings", nargs="*",
                    help="(train) .akr files, default every recording; (eval) labelled ones, default teach-room-*")
    wm.add_argument("--out", help="model file (default data/aankhen/models/worldmodel.pt)")
    wm.add_argument("--exclude", nargs="*", default=[],
                    help="(train) leave out recordings whose name contains any of these (the sessions you score)")
    wm.add_argument("--kind", choices=["causal", "shared", "masked"], default="shared")
    wm.add_argument("--phase", action="store_true", help="(train) add the phase-residual channels")
    wm.add_argument("--minutes", type=float, default=10.0, help="(train) CPU time budget")
    wm.add_argument("--steps", type=int, help="(train) stop after this many steps (reproducible, unlike a time budget)")
    wm.add_argument("--seed", type=int, default=0)
    wm.add_argument("--threads", type=int, default=3, help="(train) CPU threads for torch")
    wm.add_argument("--json", help="(eval) also write the report as JSON")
    wm.add_argument("--no-features", action="store_true", help="(eval) skip the zone / activity comparison")

    dl = sub.add_parser("drill", help="the daily labelled drill (~26 min): blocks of zone + activity + fan")
    dl.add_argument("--minutes", type=float, default=26.0, help="time budget (default 26)")
    dl.add_argument("--zones", help="comma-separated zone ids to drill (default: all)")
    dl.add_argument("--fan", choices=["both", "on", "off"], default="both")
    dl.add_argument("--seed", type=int, help="block order seed (default: today's date)")
    dl.add_argument("--block-seconds", type=float, default=50.0)
    dl.add_argument("--min-rate", type=float, default=150.0, help="QC: minimum CSI packets/s")
    dl.add_argument("--port", help="serial port when the app is not running")
    dl.add_argument("--plan", action="store_true", help="only print the plan")
    dl.add_argument("--no-voice", action="store_true", help="print prompts and beep instead of speaking")
    dl.add_argument("--note", help="free text saved with the session (no names)")

    ev = sub.add_parser("evaluate", help="score drill-trained models on held-out days")
    ev.add_argument("--leave-one-day-out", action="store_true", default=True,
                    help="hold out each day in turn (the only mode)")
    ev.add_argument("--root", help="drill folder (default data/aankhen/drill)")
    ev.add_argument("--json", help="also write the report as JSON")

    tr = sub.add_parser("train", help="train zone + activity models on every drill day (versioned)")
    tr.add_argument("--root", help="drill folder (default data/aankhen/drill)")
    tr.add_argument("--out", help="model folder (default data/aankhen/models/drill)")

    fp = sub.add_parser("fingerprint", help="kNN fingerprint vs CNN on the raw signal, judged on held-out days")
    fp.add_argument("action", choices=["evaluate", "train"])
    fp.add_argument("--root", help="drill folder (default data/aankhen/drill)")
    fp.add_argument("--epochs", type=int, default=30)
    fp.add_argument("--split", choices=["half", "day"],
                    help="evaluate: half = 50 %% train / 50 %% verify by visits; day = leave one day out "
                         "(default: day once there are 3+ days, else half)")
    fp.add_argument("--json", help="evaluate: also write the report as JSON")

    l1 = sub.add_parser("lesson1", help="see your own signal: heatmap, motion energy, a fingerprint per label (PNG)")
    l1.add_argument("target", help="a session folder (raw.akr + labels.jsonl) or a recording .akr")
    l1.add_argument("--out", help="PNG path (default data/aankhen/lessons/lesson1-<name>.png)")

    nar = sub.add_parser("narrate", help="label a real routine: board recording + phone narration + sync chirps")
    nar.add_argument("action", choices=["check", "record", "label", "list"])
    nar.add_argument("folder", nargs="?", help="(label) session folder, or 'latest'")
    nar.add_argument("audio", nargs="?", help="(label) the phone's recording (m4a, mp3, wav, opus)")
    nar.add_argument("--fan", choices=["on", "off"], default="off", help="(record) fan state at the start")
    nar.add_argument("--max-minutes", type=float, default=120.0, help="(record) stop by itself after this")
    nar.add_argument("--volume", type=float, default=0.8, help="(record) chirp volume 0-1")
    nar.add_argument("--port", help="(record) serial port when the app is not running")
    nar.add_argument("--speaker", default="speaker", help="(record) part of the output device's name for the chirps")
    nar.add_argument("--note", help="(record) free text saved with the session (no names)")
    nar.add_argument("--language", default="en", help="(label) Whisper language; 'auto' to detect")
    nar.add_argument("--dry-run", action="store_true", help="(label) print the labels, write nothing")

    zn = sub.add_parser("zones", help="show the zone map; --write saves it for editing")
    zn.add_argument("--write", action="store_true")
    zn.add_argument("--force", action="store_true")

    a = p.parse_args(argv)
    return {"doctor": cmd_doctor, "serve": cmd_serve, "record": cmd_record,
            "calibrate": cmd_calibrate, "bench": cmd_bench, "simulate": cmd_simulate,
            "physics": cmd_physics, "validate": cmd_validate, "learn": cmd_learn, "worldmodel": cmd_worldmodel,
            "drill": cmd_drill, "evaluate": cmd_evaluate, "train": cmd_train, "zones": cmd_zones,
            "fingerprint": cmd_fingerprint, "narrate": cmd_narrate,
            "lesson1": lambda a: print(__import__("aankhen.lesson1", fromlist=["write"]).write(a.target, a.out)) or 0,
            "learnroom": lambda a: print(__import__("aankhen.firstlight", fromlist=["x"]).run_room_session(a.port, not a.no_voice, a.rounds)) or 0,
            "firstlight": lambda a: __import__("aankhen.firstlight", fromlist=["main"]).main(a.port, not a.no_voice)}[a.cmd](a)


if __name__ == "__main__":
    sys.exit(main())
