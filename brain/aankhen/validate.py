"""Ground truth in the real room: does Aankhen see what the physics says it should?

    python -m aankhen validate                 guided session (ESP32 plugged in)
    python -m aankhen validate --analyse DIR   re-analyse a session's recordings

THE SESSION (one recording per step, recordings/validate-<time>/)
  1. empty    90 s   room empty, door closed
  2. desk    120 s   seated at the desk, BREATHING WITH THE BEEPS (12 per minute)
  3. bed     120 s   lying on your back on the bed, breathing with the beeps
  4. walk     45 s   walking around the room normally
  5. hallway  45 s   walking just outside the door (skip with --no-hallway)

  The metronome is what makes this ground truth without any extra sensor: breathing
  paced to 12 per minute is a 0.2 Hz signal the detector must find. If it reports
  12 breaths/min at the desk, it is seeing you; if it reports nothing or another
  rate, it is not, whatever any model predicted.

WHAT IT MEASURES
  sigma_env   the room's own slow wander: per subcarrier, the power of the empty
              recording in 0.1-0.5 Hz above its white floor (1-3 Hz), as the
              equivalent per-sample spread physics.py eq. 8 uses. The one number no
              formula gives; saved to aankhen/rf_calibration.json, so `physics`
              predictions use it from then on.
  breathing   per 25 s window: passed or not, and the rate found vs 12/min.
  walking     share of windows the motion detector flags.
  hallway     share flagged while you were outside (a single link cannot tell
              them apart; this says how much it matters in your home).
  model       where room.json is measured, physics.py's prediction for the desk
              and bed zones next to what was measured.
"""
from __future__ import annotations

import json
import math
import os
import threading
import time
from dataclasses import dataclass, field
from typing import Optional

import numpy as np

from .bench import calibrate_from_bytes
from .csi import CsiConditioner
from .motion import STATE_MOTION, MotionConfig, MotionDetector, RespirationDetector
from .protocol import CsiPacket, StreamDecoder, decode_packet
from .transport import iter_recording

PACED_BPM = 12.0
STEPS = [
    ("empty", 90, "Leave the room EMPTY and close the door."),
    ("desk", 120, "Sit at the desk, keep still, and BREATHE WITH THE BEEPS: in on the high beep, out on the low."),
    ("bed", 120, "Lie on your back on the bed, keep still, and breathe with the beeps."),
    ("walk", 45, "Walk around the room normally until it stops."),
    ("hallway", 45, "Go OUT of the room and walk around just outside the door."),
]


# ---------------------------------------------------------------- metronome
class Metronome:
    """Paces breathing: a high beep to breathe in, a low one to breathe out."""

    def __init__(self, bpm: float = PACED_BPM):
        self.period = 60.0 / bpm
        self._stop = threading.Event()
        self._thread: Optional[threading.Thread] = None

    def _beep(self, hz: int, ms: int, label: str) -> None:
        try:
            import winsound
            winsound.Beep(hz, ms)
        except Exception:
            print(f"   {label}", flush=True)

    def _run(self) -> None:
        while not self._stop.is_set():
            t0 = time.monotonic()
            self._beep(880, 150, "IN")
            self._stop.wait(max(0.0, 0.4 * self.period - (time.monotonic() - t0)))
            if self._stop.is_set():
                break
            self._beep(440, 150, "out")
            self._stop.wait(max(0.0, self.period - (time.monotonic() - t0)))

    def __enter__(self):
        self._thread = threading.Thread(target=self._run, daemon=True)
        self._thread.start()
        return self

    def __exit__(self, *exc):
        self._stop.set()
        if self._thread:
            self._thread.join(timeout=2)


# ---------------------------------------------------------------- analysis
def _samples(path: str):
    """(samples, compensated?) from one recording, through the real conditioner."""
    dec, cond = StreamDecoder(), CsiConditioner()
    out = []
    for _, data in iter_recording(path):
        for fr in dec.feed(data):
            p = decode_packet(fr)
            if isinstance(p, CsiPacket):
                out += cond.push(p.timestamp_us / 1e6, p.raw, p.rssi, gain_comp_db=p.gain_comp_db)
    return out, cond.compensated


def comp_err_of(samples) -> Optional[float]:
    """Error of the firmware's gain compensation, dB per packet: with the gain undone,
    an empty room's level should be still from one packet to the next; what jitters is
    the compensation (plus the common part of the thermal noise, which makes this a
    slight overestimate). Real packets only (forward-filled ones repeat the level)."""
    lv = np.array([s.level_db for s in samples if s.level_fine and not s.filled and s.level_db is not None])
    if lv.size < 200:
        return None
    return float(np.std(np.diff(lv)) / math.sqrt(2))


def sigma_env_of(samples, decim: int = 10, fs_in: float = 100.0) -> Optional[float]:
    """The room's slow amplitude wander as physics.py uses it (eq. 8): per subcarrier,
    breathing-band power density above the white floor, times the Nyquist band."""
    if len(samples) < decim * 200:
        return None
    A = np.stack([s.amp for s in samples])
    n = (len(A) // decim) * decim
    X = A[:n].reshape(-1, decim, A.shape[1]).mean(axis=1)          # 10 Hz, as the detector
    fs = fs_in / decim
    X = X - X.mean(axis=0)
    seg = 250
    if len(X) < seg:
        return None
    win = np.hanning(seg)
    psd = []
    for i in range(0, len(X) - seg + 1, seg // 2):                  # Welch, 50 % overlap
        F = np.fft.rfft(X[i:i + seg] * win[:, None], axis=0)
        psd.append(np.abs(F) ** 2 / (fs * (win ** 2).sum()))
    P = np.mean(psd, axis=0)
    f = np.fft.rfftfreq(seg, 1 / fs)
    band = P[(f >= 0.1) & (f <= 0.5)].mean(axis=0)
    floor = P[(f >= 1.0) & (f <= 3.0)].mean(axis=0)
    excess = np.maximum(band - floor, 0.0) * (fs / 2)               # equivalent per-sample variance
    return float(math.sqrt(np.median(excess)))


@dataclass
class StepResult:
    step: str
    seconds: float
    windows: int = 0
    passed: Optional[float] = None          # breathing windows passing / motion windows flagged
    rate_bpm: Optional[float] = None
    rate_error_bpm: Optional[float] = None
    note: str = ""


@dataclass
class ValidationReport:
    compensated: bool
    sigma_env: Optional[float]
    comp_err_db: Optional[float] = None
    steps: list = field(default_factory=list)
    model: dict = field(default_factory=dict)

    def verdicts(self) -> list[str]:
        out = []
        for r in self.steps:
            if r.step in ("desk", "bed"):
                ok = (r.passed or 0) >= 0.5 and r.rate_error_bpm is not None and r.rate_error_bpm <= 1.5
                out.append(f"{r.step:8} breathing {'SEEN' if ok else 'NOT reliably seen'}: "
                           f"{(r.passed or 0):.0%} of {r.windows} windows passed"
                           + (f", rate {r.rate_bpm} /min (paced {PACED_BPM:g})" if r.rate_bpm else ""))
            elif r.step == "walk":
                out.append(f"walk     motion flagged in {(r.passed or 0):.0%} of windows")
            elif r.step == "hallway":
                out.append(f"hallway  flagged in {(r.passed or 0):.0%} of windows while you were OUTSIDE"
                           " (a single link cannot tell; the radar or a second link must)")
        return out


def analyse(paths: dict, room=None) -> ValidationReport:
    """paths: step -> recording. 'empty' is required (it is the baseline)."""
    empty, comp = _samples(paths["empty"])
    base = calibrate_from_bytes((d for _, d in iter_recording(paths["empty"])))
    rep = ValidationReport(comp, sigma_env_of(empty), comp_err_of(empty) if comp else None)
    for step in ("desk", "bed"):
        if step not in paths:
            continue
        samples, _ = _samples(paths[step])
        resp = RespirationDetector(floor=base.resp_floor)
        rates = []
        for s in samples:
            n = len(resp.stats)
            resp.push(s)
            if len(resp.stats) > n and resp.last.bpm:
                rates.append(resp.last.bpm)
        stats = np.array(resp.stats[1:]) / base.resp_floor if base.resp_floor else np.array([])
        r = StepResult(step, len(samples) / 100.0, int(stats.size),
                       float(np.mean(stats >= resp.k_floor)) if stats.size else None)
        if rates:
            r.rate_bpm = round(float(np.median(rates)), 1)
            r.rate_error_bpm = round(abs(r.rate_bpm - PACED_BPM), 1)
        rep.steps.append(r)
    for step in ("walk", "hallway"):
        if step not in paths:
            continue
        samples, _ = _samples(paths[step])
        det = MotionDetector(MotionConfig(), base)
        flags = [rd.state == STATE_MOTION for s in samples if (rd := det.push(s)) is not None]
        rep.steps.append(StepResult(step, len(samples) / 100.0, len(flags),
                                    float(np.mean(flags)) if flags else None))
    if room is not None:
        rep.model = _model_prediction(room, rep)
    return rep


def _model_prediction(room, rep: ValidationReport) -> dict:
    """physics.py's prediction for the zones, with the sigma_env just measured."""
    from .physics import Calibration, analyse as physics_analyse
    links = room.links or []
    if not links:
        return {}
    tx, rx = room.sensor(links[0][0]), room.sensor(links[0][1])
    cal = Calibration(sigma_env=rep.sigma_env, source="validate", comp_err_db=rep.comp_err_db)
    pr = physics_analyse(room, tx, rx, cal=cal, zones_only=True, rooms=3,
                         mode="gain" if rep.compensated else "normalised")
    return {name: {"predicted_likely": z["likely"], "range": z.get("likely_by_room")}
            for name, z in pr.zones.items() if name in ("desk", "bed")}


def save_calibration(rep: ValidationReport) -> Optional[str]:
    from .physics import RF_CAL_FILE, Calibration
    if rep.sigma_env is None:
        return None
    cal = Calibration.load()
    mode = "gain" if rep.compensated else "normalised"
    cal.sigma_env = rep.sigma_env
    if rep.comp_err_db is not None:
        cal.comp_err_db = rep.comp_err_db
    cal.params = dict(cal.params)
    cal.source = f"validate {time.strftime('%Y-%m-%d %H:%M')} ({mode} pipeline)"
    cal.save()
    return RF_CAL_FILE


# ---------------------------------------------------------------- the session
def run_session(port: Optional[str], out_dir: str, hallway: bool = True) -> dict:
    from .transport import SerialSource
    os.makedirs(out_dir, exist_ok=True)
    paths = {}
    for step, seconds, instruction in STEPS:
        if step == "hallway" and not hallway:
            continue
        print(f"\n[{step}] {instruction}")
        input("    Press Enter when ready (you have 10 s to get into place)...")
        for k in range(10, 0, -1):
            print(f"\r    starting in {k:2d} s ", end="", flush=True)
            time.sleep(1)
        print()
        path = os.path.join(out_dir, f"{step}.akr")
        src = SerialSource(port)
        src.record_to(path, {"label": step, "seconds": seconds, "paced_bpm": PACED_BPM})
        src.start()
        if not src.connected.wait(timeout=10):
            src.stop()
            raise RuntimeError("no ESP32 connected within 10 s")
        paced = step in ("desk", "bed")
        ctx = Metronome() if paced else None
        if ctx:
            ctx.__enter__()
        try:
            t0 = time.time()
            while time.time() - t0 < seconds:
                time.sleep(1)
                print(f"\r    recording {time.time() - t0:4.0f}/{seconds} s", end="", flush=True)
        finally:
            if ctx:
                ctx.__exit__()
            src.stop()
        print()
        paths[step] = path
    with open(os.path.join(out_dir, "session.json"), "w", encoding="utf-8") as f:
        json.dump({"paths": paths, "paced_bpm": PACED_BPM}, f, indent=2)
    return paths


def print_report(rep: ValidationReport) -> None:
    print(f"\npipeline: {'gain-compensated (CSI_GAIN firmware)' if rep.compensated else 'normalised (no gain info)'}")
    print(f"room wander sigma_env: {rep.sigma_env if rep.sigma_env is None else round(rep.sigma_env, 5)}")
    if rep.comp_err_db is not None:
        print(f"gain compensation error: {rep.comp_err_db:.2f} dB per packet "
              "(the model assumed 0.25; below ~0.1 the common-mode signal is nearly all kept)")
    for line in rep.verdicts():
        print("  " + line)
    for zone, m in rep.model.items():
        got = next((s.passed for s in rep.steps if s.step == zone), None)
        print(f"  model vs measured, {zone}: predicted {m['predicted_likely']:.0%} of positions likely; "
              f"measured {got if got is None else f'{got:.0%}'} of windows passed")
