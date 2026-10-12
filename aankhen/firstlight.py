"""First light: does the real board see a real person? A two-minute, voice-guided test.

    python -m aankhen firstlight [--port COM9] [--no-voice]

The laptop SPEAKS each step (Windows' built-in voice, offline), so the person being
measured never has to look at a screen. While the board records, the stream goes
through the same conditioner and motion detector the engine uses, and every window
is tagged with the step it fell in:

    still   20 s   sit completely still at the desk, hands off the keyboard
    move    20 s   wave your arms, turn in the chair
    walk    20 s   stand up and walk around the room
    type    20 s   sit and type normally

No baseline is needed: human-band energy (HBE) is normalised by each window's own
noise, so "still" vs "move" is comparable on an uncalibrated board. Passing means
the moving steps sit clearly above the still one; the report says by how much.

The recording and its labels go to data/aankhen/recordings/firstlight-<time>.akr
(+ .labels.json), so the session also becomes real labelled data for the model.
"""
from __future__ import annotations

import json
import os
import subprocess
import threading
import time
from typing import Optional

import numpy as np

from . import DATA_DIR
from .csi import CsiConditioner
from .motion import MotionConfig, MotionDetector
from .protocol import CsiPacket

STEPS = [
    ("still", 20, "Step one. Sit completely still at your desk, hands off the keyboard, for twenty seconds. Starting now."),
    ("move", 20, "Step two. Move. Wave your arms and turn in your chair, for twenty seconds. Starting now."),
    ("walk", 20, "Step three. Stand up and walk around the room, for twenty seconds. Starting now."),
    ("type", 20, "Step four. Sit down and type normally, for twenty seconds. Starting now."),
]


def say(text: str, voice: bool = True) -> None:
    """Speak through Windows' built-in synthesiser (offline); print either way."""
    print(f"  JARVIS: {text}", flush=True)
    if not voice or os.name != "nt":
        return
    safe = text.replace("'", "''")
    subprocess.run(["powershell", "-NoProfile", "-Command",
                    "Add-Type -AssemblyName System.Speech; "
                    f"$s = New-Object System.Speech.Synthesis.SpeechSynthesizer; $s.Rate = 1; $s.Speak('{safe}')"],
                   capture_output=True, timeout=60)


def run(port: Optional[str] = None, voice: bool = True, out_dir: Optional[str] = None) -> dict:
    from .transport import SerialSource
    out_dir = out_dir or os.path.join(DATA_DIR, "recordings")
    os.makedirs(out_dir, exist_ok=True)
    path = os.path.join(out_dir, "firstlight-" + time.strftime("%Y%m%d-%H%M%S") + ".akr")
    src = SerialSource(port)
    src.record_to(path, {"label": "firstlight", "steps": [s[0] for s in STEPS]})
    src.start()
    if not src.connected.wait(timeout=10):
        src.stop()
        raise RuntimeError("no ESP32 answered within 10 s")
    # Opening the port can reboot the board, which then needs ~20-25 s to join Wi-Fi
    # before any CSI flows. Nothing is asked of the person until CSI really arrives.
    csi_seen, stop = threading.Event(), threading.Event()

    def consume():
        for pkt in src.iter_packets(timeout=0.2):
            if stop.is_set():
                return
            if isinstance(pkt, CsiPacket):
                csi_seen.set()

    threading.Thread(target=consume, daemon=True).start()
    segments = []
    try:
        if not csi_seen.wait(3):
            say("Waiting for the sensor to join the Wi-Fi.", voice)
            if not csi_seen.wait(60):
                raise RuntimeError("the board connected but sent no CSI for 60 s (Wi-Fi not joined?)")
        time.sleep(3)                                   # the detector's 3 s windows fill
        say("This is JARVIS. A two minute sensor test is starting. Stay at your desk.", voice)
        for step, seconds, text in STEPS:
            say(text, voice)
            t0 = time.time()
            segments.append({"label": step, "start_host": t0})
            while time.time() - t0 < seconds:
                time.sleep(0.25)
            segments[-1]["end_host"] = time.time()
        say("Done. Thank you. Analysing.", voice)
    finally:
        stop.set()
        src.stop()
    with open(path[:-4] + ".labels.json", "w", encoding="utf-8") as f:
        json.dump({"kind": "human-labels", "source": "firstlight", "clock": "host",
                   "segments": segments}, f, indent=2)
    rep, _, _ = analyse(path)
    return {"path": path, "report": rep}


def analyse(path: str) -> tuple[dict, float, float]:
    """Re-run the recording through the detector and tag each window by the HOST time
    its packets arrived, so labels never depend on how fast the analysis runs (live,
    a slow consumer tagged windows with whatever step was current when it caught up).
    A window counts for a step only once its 3 s span lies inside that step.
    Returns (report, seconds of data, seconds of processing)."""
    from .protocol import StreamDecoder, decode_packet
    from .transport import iter_recording
    segs = json.load(open(path[:-4] + ".labels.json", encoding="utf-8"))["segments"]
    dec, cond, det = StreamDecoder(), CsiConditioner(), MotionDetector(MotionConfig())
    rows, t_first, t_last = [], None, None
    w0 = time.perf_counter()
    for t_host, data in iter_recording(path):
        t_first = t_host if t_first is None else t_first
        t_last = t_host
        step = next((g["label"] for g in segs if g["start_host"] + 3.0 <= t_host < g["end_host"]), None)
        for fr in dec.feed(data):
            p = decode_packet(fr)
            if not isinstance(p, CsiPacket):
                continue
            for s in cond.push(p.timestamp_us / 1e6, p.raw, p.rssi, gain_comp_db=p.gain_comp_db):
                r = det.push(s)
                if r is not None and step:
                    f = r.features
                    rows.append((step, f.get("mvs"), f.get("hbe"), f.get("hbe_recent"), f.get("level_var")))
    return report(rows), (t_last or 0) - (t_first or 0), time.perf_counter() - w0


def report(rows: list) -> dict:
    out = {}
    for step, *_ in STEPS:
        r = [x for x in rows if x[0] == step]
        if not r:
            continue
        mvs = np.array([x[1] for x in r if x[1] is not None], float)
        hbe = np.array([x[2] for x in r if x[2] is not None], float)
        out[step] = {"windows": len(r),
                     "hbe_median": float(np.median(hbe)) if hbe.size else None,
                     "hbe_p90": float(np.quantile(hbe, 0.9)) if hbe.size else None,
                     "mvs_median": float(np.median(mvs)) if mvs.size else None}
    still = out.get("still", {}).get("hbe_median")
    for step, v in out.items():
        if still and v.get("hbe_median"):
            v["hbe_vs_still"] = v["hbe_median"] / still
    return out


def main(port: Optional[str] = None, voice: bool = True) -> int:
    res = run(port, voice)
    print(f"\nrecording: {res['path']}")
    print(f"{'step':6s} {'windows':>7s} {'HBE median':>11s} {'HBE p90':>8s} {'x still':>8s} {'MVS median':>11s}")
    for step, v in res["report"].items():
        print(f"{step:6s} {v['windows']:7d} {v['hbe_median'] or 0:11.2f} {v['hbe_p90'] or 0:8.2f} "
              f"{v.get('hbe_vs_still', 0):8.1f} {v['mvs_median'] or 0:11.2e}")
    still = res["report"].get("still", {}).get("hbe_median")
    moving = [res["report"].get(s, {}).get("hbe_median") for s in ("move", "walk")]
    if still and all(moving):
        seen = min(moving) / still
        print(f"\nverdict: moving steps are {seen:.1f}x the still step "
              f"({'clearly seen' if seen >= 3 else 'weakly seen' if seen >= 1.5 else 'NOT separated'})")
    return 0


# ---------------------------------------------------------------- inside the app
class Guided:
    """The same sessions, run on the hub's live board (the app owns the port), with
    progress a UI can poll. One session at a time; never while Teach is recording.

        test       the four steps above, scored offline by capture time
        calibrate  the person leaves; 70 s of the empty room become the motion
                   baseline AND the spatial model's reference (Baseline.ref), saved
                   to data/aankhen/baseline.json and loaded straight away
    """

    LEAVE_S = 15            # time to walk out and shut the door
    CALIBRATE_S = 70        # MotionConfig.baseline_min_s is 60

    def __init__(self, hub, voice: bool = True):
        self.hub, self.voice = hub, voice
        self.lock = threading.Lock()
        self.state: dict = {"state": "idle"}

    def status(self) -> dict:
        with self.lock:
            return dict(self.state)

    def _set(self, **kw) -> None:
        with self.lock:
            self.state.update(kw)

    def start(self, kind: str) -> dict:
        if kind not in ("test", "calibrate"):
            raise ValueError("kind must be 'test' or 'calibrate'")
        with self.lock:
            if self.state.get("state") == "running":
                return dict(self.state)
            hub = self.hub
            if hub.mode != "hardware" or hub.source is None:
                raise RuntimeError("Aankhen is not live on the ESP32: plug it in and press ESP32 first.")
            if getattr(hub, "teacher", None) and hub.teacher.status().get("recording"):
                raise RuntimeError("A Teach session is recording; end it first.")
            self.state = {"state": "running", "kind": kind, "step": "starting", "left": None,
                          "started": time.time()}
        threading.Thread(target=self._run, args=(kind,), name=f"aankhen-{kind}", daemon=True).start()
        return self.status()

    def _countdown(self, step: str, seconds: float, total: int, index: int) -> None:
        t0 = time.time()
        while (left := seconds - (time.time() - t0)) > 0:
            self._set(step=step, left=round(left, 1), seconds=seconds, index=index, total=total)
            time.sleep(0.25)

    def _run(self, kind: str) -> None:
        src = self.hub.source
        out = os.path.join(DATA_DIR, "recordings")
        os.makedirs(out, exist_ok=True)
        stamp = time.strftime("%Y%m%d-%H%M%S")
        try:
            if kind == "test":
                path = os.path.join(out, f"firstlight-{stamp}.akr")
                say("This is JARVIS. A two minute sensor test is starting. Stay at your desk.", self.voice)
                src.record_to(path, {"label": "firstlight", "steps": [s[0] for s in STEPS]})
                segments = []
                for i, (step, seconds, text) in enumerate(STEPS):
                    self._set(step=step, left=None, index=i, total=len(STEPS), instruction=text)
                    say(text, self.voice)
                    segments.append({"label": step, "start_host": time.time()})
                    self._countdown(step, seconds, len(STEPS), i)
                    segments[-1]["end_host"] = time.time()
                src.stop_recording()
                with open(path[:-4] + ".labels.json", "w", encoding="utf-8") as f:
                    json.dump({"kind": "human-labels", "source": "firstlight", "clock": "host",
                               "segments": segments}, f, indent=2)
                self._set(step="analysing", left=None)
                say("Done. Thank you. Analysing.", self.voice)
                rep, _, _ = analyse(path)
                still = rep.get("still", {}).get("hbe_median")
                moving = [rep.get(s, {}).get("hbe_median") for s in ("move", "walk")]
                seen = min(moving) / still if still and all(moving) else None
                verdict = None if seen is None else ("clearly seen" if seen >= 3 else
                                                     "weakly seen" if seen >= 1.5 else "not separated")
                self._set(state="done", step=None, left=None, report=rep, seen=seen, verdict=verdict,
                          recording=os.path.basename(path), finished=time.time())
                if verdict:
                    say(f"Result: you were {verdict}. Moving was {seen:.0f} times the still level.", self.voice)
            else:
                self._calibrate(src, os.path.join(out, f"calibration-{stamp}.akr"))
        except Exception as e:                       # shown in the app, never swallowed
            try:
                src.stop_recording()
            except Exception:
                pass
            self._set(state="error", error=f"{type(e).__name__}: {e}", step=None, left=None)

    def _calibrate(self, src, path: str) -> None:
        from .bench import calibrate_from_bytes
        from .hub import BASELINE_FILE
        from .transport import iter_recording
        self._set(instruction="Leave the room and close the door. Calibration needs it empty.")
        say("Calibration. Please leave the room now and close the door. "
            "Stay out until I call you back, in about a minute and a half.", self.voice)
        self._countdown("leave", self.LEAVE_S, 2, 0)
        src.record_to(path, {"label": "empty", "purpose": "calibration"})
        self._set(instruction="Measuring the empty room. Stay outside.")
        self._countdown("empty", self.CALIBRATE_S, 2, 1)
        src.stop_recording()
        say("Calibration recorded. You can come back in now.", self.voice)
        self._set(step="analysing", left=None)
        b = calibrate_from_bytes([data for _, data in iter_recording(path)])
        b.note = (b.note + "; " if b.note else "") + f"guided calibration {time.strftime('%Y-%m-%d %H:%M')}"
        b.save(BASELINE_FILE)
        # Reload the board with the new baseline (the port is reopened without a reset).
        self.hub.start("hardware")
        self._set(state="done", step=None, left=None, recording=os.path.basename(path),
                  baseline={"windows": b.n_windows, "mvs_q": b.q_hi, "hbe_q": b.hbe_q,
                            "reference": bool(b.ref)}, finished=time.time())
