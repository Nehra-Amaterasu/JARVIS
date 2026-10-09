"""Aankhen benchmark: score the whole pipeline against ground truth.

"The detector works" is not a claim anyone should accept without numbers. This
module replays a byte stream through the real decoder and Engine and compares what
it concluded with what was actually happening, every 100 ms of device time.

Ground truth comes from one of two places:
  - the simulator, which knows exactly where everyone is (`*.labels.json` written
    beside a simulated recording, or computed on the fly), or
  - a human-labelled real recording: a `.labels.json` with time segments, e.g.
        {"segments": [{"start": 0, "end": 60, "label": "empty"},
                      {"start": 60, "end": 120, "label": "walking", "people": 1},
                      {"start": 120, "end": 180, "label": "sitting", "people": 1}]}
    labels: empty | walking | standing | sitting | lying.

METRICS (all computed only where the truth is known)
  presence_accuracy     decided (non-"uncertain") presence states that were right
  presence_undecided    fraction of time the fusion said "uncertain"
  false_empty_rate      time someone WAS there but the system said "empty" — the
                        error that turns the lights off on a person; the one to minimise
  false_occupied_rate   time the room was empty but the system said occupied
  motion_recall         time someone was moving that the system called "moving"
  motion_false_alarm    time nobody moved but the system said "moving"
  motion_latency_s      median delay from a movement starting to "moving" being shown
  wifi_*                the same two for the Wi-Fi detector ALONE (before fusion)
  position_error_m      median / p90 distance from a track to its matched true person
  id_switches           times a true person's matched track id changed
"""
from __future__ import annotations

import json
import math
import os
from dataclasses import asdict, dataclass, field
from typing import Optional

import numpy as np
from scipy.optimize import linear_sum_assignment

from .engine import Engine
from .motion import Baseline, Calibrator, MotionConfig, MotionDetector, STATE_MOTION
from .protocol import StreamDecoder, decode_packet, CsiPacket
from .csi import CsiConditioner
from .room import Room, default_room
from .simulator import SCENARIOS, Simulator
from .transport import iter_recording, read_recording_meta

MATCH_GATE_M = 1.0
SAMPLE_DT = 0.1


@dataclass
class BenchResult:
    name: str
    seconds: float
    samples: int = 0
    presence_accuracy: float = float("nan")
    presence_undecided: float = float("nan")
    false_empty_rate: float = float("nan")
    false_occupied_rate: float = float("nan")
    motion_recall: float = float("nan")
    motion_false_alarm: float = float("nan")
    motion_latency_s: float = float("nan")
    wifi_motion_recall: float = float("nan")
    wifi_motion_false_alarm: float = float("nan")
    position_error_m: float = float("nan")
    position_error_p90_m: float = float("nan")
    id_switches: int = 0
    crc_errors: int = 0
    loss_ratio: float = 0.0
    notes: list = field(default_factory=list)

    def to_dict(self) -> dict:
        d = asdict(self)
        return {k: (round(v, 4) if isinstance(v, float) and not math.isnan(v) else v)
                for k, v in d.items()}


# ------------------------------------------------------------------ truth
class _SimTruth:
    def __init__(self, sim: Simulator):
        self.sim = sim

    def at(self, t: float) -> Optional[list[dict]]:
        return [s.to_dict() for s in self.sim.truth_at(t)]


class _LabelTruth:
    """Truth from a labels file: per-sample people lists or human segments."""

    MOVING = {"walking"}

    def __init__(self, path: str):
        with open(path, encoding="utf-8") as f:
            self.doc = json.load(f)
        self.labels = self.doc.get("labels")
        self.segments = self.doc.get("segments")
        self.boot_us = self.doc.get("boot_us", 0)
        if self.labels:
            self._t = np.array([l["t"] for l in self.labels])

    def at(self, t: float) -> Optional[list[dict]]:
        if self.labels:
            i = int(np.searchsorted(self._t, t, side="right")) - 1
            return self.labels[i]["people"] if i >= 0 else None
        for s in self.segments or []:
            if s["start"] <= t < s["end"]:
                if s["label"] == "empty":
                    return []
                n = int(s.get("people", 1))
                moving = s["label"] in self.MOVING
                # Human labels carry no positions: x/y None skips position scoring.
                return [{"name": f"H{i}", "x": None, "y": None, "moving": moving,
                         "posture": s["label"]} for i in range(n)]
        return None


# ------------------------------------------------------------------ scoring
class _Scorer:
    def __init__(self):
        self.n = 0
        self.pres_dec = self.pres_ok = self.pres_undecided = 0
        self.occ_n = self.false_empty = 0
        self.empty_n = self.false_occ = 0
        self.mov_n = self.mov_hit = self.wifi_mov_hit = 0
        self.still_n = self.mov_fa = self.wifi_fa = 0
        self.errors: list[float] = []
        self.latencies: list[float] = []
        self._moving_since: Optional[float] = None
        self._latency_open = False
        self.id_switches = 0
        self._last_match: dict[str, str] = {}

    def add(self, t: float, truth: list[dict], frame: dict) -> None:
        self.n += 1
        occupied = len(truth) > 0
        st = frame["presence"]["state"]
        decided = st in ("moving", "still", "empty")
        if decided:
            self.pres_dec += 1
            self.pres_ok += (st != "empty") == occupied
        else:
            self.pres_undecided += 1
        if occupied:
            self.occ_n += 1
            self.false_empty += st == "empty"
        else:
            self.empty_n += 1
            self.false_occ += st in ("moving", "still")

        truly_moving = any(p.get("moving") for p in truth)
        says_moving = st == "moving"
        wifi_moving = frame["motion_detail"]["state"] == STATE_MOTION
        if truly_moving:
            self.mov_n += 1
            self.mov_hit += says_moving
            self.wifi_mov_hit += wifi_moving
            if self._moving_since is None:
                self._moving_since, self._latency_open = t, True
            if self._latency_open and says_moving:
                self.latencies.append(t - self._moving_since)
                self._latency_open = False
        else:
            self._moving_since, self._latency_open = None, False
            self.still_n += 1
            self.mov_fa += says_moving
            self.wifi_fa += wifi_moving

        # Positions: Hungarian match of tracks to true people (where positions exist).
        # Someone who LEFT and came back is a new person to any tracker, so their
        # previous match is forgotten: re-entry is not an identity switch.
        present = {p["name"] for p in truth}
        for name in list(self._last_match):
            if name not in present:
                del self._last_match[name]
        tp = [p for p in truth if p.get("x") is not None]
        tr = frame["tracks"]
        if tp and tr:
            cost = np.array([[math.hypot(a["x"] - b["x"], a["y"] - b["y"]) for b in tr] for a in tp])
            rows, cols = linear_sum_assignment(cost)
            for i, j in zip(rows, cols):
                if cost[i, j] <= MATCH_GATE_M:
                    self.errors.append(float(cost[i, j]))
                    name, tid = tp[i]["name"], tr[j]["id"]
                    if name in self._last_match and self._last_match[name] != tid:
                        self.id_switches += 1
                    self._last_match[name] = tid

    def result(self, name: str, seconds: float) -> BenchResult:
        f = lambda a, b: a / b if b else float("nan")
        r = BenchResult(name, seconds, self.n)
        r.presence_accuracy = f(self.pres_ok, self.pres_dec)
        r.presence_undecided = f(self.pres_undecided, self.n)
        r.false_empty_rate = f(self.false_empty, self.occ_n)
        r.false_occupied_rate = f(self.false_occ, self.empty_n)
        r.motion_recall = f(self.mov_hit, self.mov_n)
        r.motion_false_alarm = f(self.mov_fa, self.still_n)
        r.wifi_motion_recall = f(self.wifi_mov_hit, self.mov_n)
        r.wifi_motion_false_alarm = f(self.wifi_fa, self.still_n)
        if self.latencies:
            r.motion_latency_s = float(np.median(self.latencies))
        if self.errors:
            r.position_error_m = float(np.median(self.errors))
            r.position_error_p90_m = float(np.percentile(self.errors, 90))
        r.id_switches = self.id_switches
        return r


# ------------------------------------------------------------------ runner
def _offline_engine(room: Room, kind: str, baseline: Optional[Baseline]) -> Engine:
    eng = Engine(room, kind, baseline=baseline)
    eng.clock = lambda: eng.device_t or 0.0      # liveness on the device clock offline
    return eng


def calibrate_from_bytes(chunks, device_offset_s: float = 0.0) -> Baseline:
    """Empty-room baseline from a byte stream (simulated or recorded)."""
    dec, cond = StreamDecoder(), CsiConditioner()
    cfg = MotionConfig()
    det, cal = MotionDetector(cfg), Calibrator(cfg)
    for ch in chunks:
        for fr in dec.feed(ch):
            p = decode_packet(fr)
            if isinstance(p, CsiPacket):
                for s in cond.push(p.timestamp_us / 1e6, p.raw, p.rssi):
                    r = det.push(s)
                    if r is not None:
                        cal.add(r.features["mvs"])
    return cal.finish()


def simulated_baseline(room: Optional[Room] = None, seconds: float = 65.0,
                       seed: int = 999, channel_seed: int = 0) -> Baseline:
    sim = Simulator(room, SCENARIOS["empty"](), seed=seed, channel_seed=channel_seed)
    b = calibrate_from_bytes(sim.chunks(seconds))
    b.source = "calibrated (simulated empty room)"
    return b


def _run(name: str, chunks, truth, room: Room, kind: str, baseline: Optional[Baseline],
         t_offset: float, seconds: float, warmup_s: float) -> BenchResult:
    eng = _offline_engine(room, kind, baseline)
    dec = StreamDecoder()
    scorer = _Scorer()
    next_sample = warmup_s
    for ch in chunks:
        for fr in dec.feed(ch):
            eng.process(decode_packet(fr))
        if eng.device_t is None:
            continue
        t_dev = eng.device_t - t_offset
        while next_sample <= t_dev:
            gt = truth.at(next_sample)
            if gt is not None:
                scorer.add(next_sample, gt, eng.frame_message())
            next_sample += SAMPLE_DT
    for fr in dec.flush():
        eng.process(decode_packet(fr))
    r = scorer.result(name, seconds)
    r.crc_errors = dec.stats.crc_errors
    r.loss_ratio = round(dec.stats.loss_ratio(), 4)
    return r


def bench_simulation(scenario: str = "evening", seconds: float = 220.0, seed: int = 1,
                     room: Optional[Room] = None, baseline: Optional[Baseline] = None,
                     warmup_s: float = 3.0) -> BenchResult:
    room = room or default_room()
    baseline = baseline or simulated_baseline(room)
    sim = Simulator(room, SCENARIOS[scenario](), seed=seed)
    r = _run(f"sim:{scenario}:seed{seed}", sim.chunks(seconds), _SimTruth(sim), room,
             "simulation", baseline, sim.boot_us / 1e6, seconds, warmup_s)
    r.notes.append("SYNTHETIC: simulator ground truth; not evidence of real-world accuracy")
    return r


def bench_recording(path: str, labels_path: Optional[str] = None, room: Optional[Room] = None,
                    baseline: Optional[Baseline] = None, warmup_s: float = 3.0) -> BenchResult:
    """Score a recording against its labels (`<name>.labels.json` by default)."""
    labels_path = labels_path or path.rsplit(".", 1)[0] + ".labels.json"
    if not os.path.exists(labels_path):
        raise FileNotFoundError(f"no labels for {path}: expected {labels_path}")
    meta = read_recording_meta(path)
    truth = _LabelTruth(labels_path)
    room = room or default_room()
    first_ts = None
    for _, data in iter_recording(path):
        dec = StreamDecoder()
        for fr in dec.feed(data):
            first_ts = fr.timestamp_us
            break
        if first_ts is not None:
            break
    # Simulated recordings carry their boot offset; human-labelled ones are timed
    # from the first packet.
    t_offset = truth.boot_us / 1e6 if truth.boot_us else (first_ts or 0) / 1e6
    chunks = (data for _, data in iter_recording(path))
    seconds = meta.get("seconds", float("nan"))
    r = _run(os.path.basename(path), chunks, truth, room, meta.get("source", "replay"),
             baseline, t_offset, seconds, warmup_s)
    if meta.get("source") == "simulation":
        r.notes.append("SYNTHETIC recording")
    return r


def format_table(results: list[BenchResult]) -> str:
    cols = [("presence acc", "presence_accuracy", "{:.1%}"), ("undecided", "presence_undecided", "{:.1%}"),
            ("false EMPTY", "false_empty_rate", "{:.2%}"), ("false occ", "false_occupied_rate", "{:.2%}"),
            ("motion recall", "motion_recall", "{:.1%}"), ("motion FA", "motion_false_alarm", "{:.2%}"),
            ("latency s", "motion_latency_s", "{:.2f}"), ("wifi recall", "wifi_motion_recall", "{:.1%}"),
            ("wifi FA", "wifi_motion_false_alarm", "{:.2%}"), ("pos err m", "position_error_m", "{:.2f}"),
            ("p90 m", "position_error_p90_m", "{:.2f}"), ("id sw", "id_switches", "{}")]
    lines = ["| run | " + " | ".join(c[0] for c in cols) + " |",
             "|---|" + "---|" * len(cols)]
    for r in results:
        cells = []
        for _, key, fmt in cols:
            v = getattr(r, key)
            cells.append("—" if isinstance(v, float) and math.isnan(v) else fmt.format(v))
        lines.append(f"| {r.name} | " + " | ".join(cells) + " |")
    return "\n".join(lines)
