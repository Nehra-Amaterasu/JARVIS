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

Only people INSIDE the room count as occupants. Someone pacing in the hallway next
to the router is part of the world the sensors see, not part of the answer.

METRICS (all computed only where the truth is known)
  presence_accuracy     decided (non-"uncertain") presence states that were right
  presence_undecided    fraction of time the fusion said "uncertain"
  false_empty_rate      time someone WAS there but the system said "empty" — the
                        error that turns the lights off on a person; the one to minimise
  false_occupied_rate   time the room was empty but the system said occupied
  motion_recall         time someone was moving that the system called "moving"
  motion_false_alarm    time nobody moved but the system said "moving"
  motion_fa_steady      the same, excluding the STOP_LAG_S after a movement ended or
                        someone left. The audit found the evening false alarms were
                        ALL stop-lag (0.0 % beyond 2 s): one number hid two problems.
  stop_lag_s            median delay from a movement ending to "moving" clearing
  motion_latency_s      median delay from a movement starting to "moving" being shown
  wifi_*                recall / false alarms of the Wi-Fi detector ALONE (before fusion)
  count_accuracy        time the number of shown tracks equalled the true head count
  position_error_m      median / p90 distance from a track to its matched true person
  id_switches           times a true person's matched track id changed

ONE SEED IS AN ANECDOTE
  The first suite ran every scenario once, on seed 1, and reported 98.5 % presence
  accuracy for the evening. Seed 3 of the same scenario scored 80.9 % — a duplicate
  track kept an empty room "occupied" for 51 s. run_suite() runs several noise seeds
  (and optionally several rooms — channel seeds) and summarise() reports the median
  AND the worst run, per scenario.
"""
from __future__ import annotations

import functools
import json
import math
import os
from concurrent.futures import ProcessPoolExecutor
from dataclasses import asdict, dataclass, field
from typing import Optional

import numpy as np
from scipy.optimize import linear_sum_assignment

from .engine import Engine
from .motion import Baseline, Calibrator, MotionConfig, MotionDetector, RespirationDetector, STATE_MOTION
from .protocol import StreamDecoder, decode_packet, CsiPacket
from .csi import CsiConditioner
from .room import Room, default_room, load_room
from .simulator import ROOM_SCENARIOS, SCENARIOS, Simulator
from .transport import iter_recording, read_recording_meta

MATCH_GATE_M = 1.0
SAMPLE_DT = 0.1
STOP_LAG_S = 2.0

# Default length of each simulated scenario, seconds: long enough to contain every
# phase of its script (the sleep scenario's sleeper leaves at ~549 s).
SUITE_SECONDS = {"evening": 220, "walk": 64, "still": 90, "empty": 120, "sleep": 600,
                 "hallway": 150, "fan": 260, "pair": 150, "drift": 400}

# Scenarios built from your room.json's house: not in the default suite (they need
# that file); run them with --scenarios house.
ROOM_SCENARIO_SECONDS = {"house": 240}

# For "worst": these are better when HIGHER; every other metric is better lower.
HIGHER_IS_BETTER = {"presence_accuracy", "motion_recall", "wifi_motion_recall", "count_accuracy"}


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
    motion_fa_steady: float = float("nan")
    stop_lag_s: float = float("nan")
    motion_latency_s: float = float("nan")
    wifi_motion_recall: float = float("nan")
    wifi_motion_false_alarm: float = float("nan")
    wifi_fa_steady: float = float("nan")
    count_accuracy: float = float("nan")
    position_error_m: float = float("nan")
    position_error_p90_m: float = float("nan")
    id_switches: int = 0
    crc_errors: int = 0
    loss_ratio: float = 0.0
    scenario: Optional[str] = None
    seed: Optional[int] = None
    channel_seed: Optional[int] = None
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
        return [s.to_dict() for s in self.sim.occupants_at(t)]


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
        self.steady_n = self.steady_fa = self.wifi_steady_fa = 0
        self.count_n = self.count_ok = 0
        self.errors: list[float] = []
        self.latencies: list[float] = []
        self.stop_lags: list[float] = []
        self._moving_since: Optional[float] = None
        self._latency_open = False
        self._last_active: Optional[float] = None    # truth last moving, or someone left
        self._stopped_at: Optional[float] = None     # a movement just ended; lag clock running
        self._prev_moving = False
        self._prev_n = 0
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
        left = len(truth) < self._prev_n
        if truly_moving or left:
            self._last_active = t
        if truly_moving:
            self.mov_n += 1
            self.mov_hit += says_moving
            self.wifi_mov_hit += wifi_moving
            if self._moving_since is None:
                self._moving_since, self._latency_open = t, True
            if self._latency_open and says_moving:
                self.latencies.append(t - self._moving_since)
                self._latency_open = False
            self._stopped_at = None
        else:
            self._moving_since, self._latency_open = None, False
            self.still_n += 1
            self.mov_fa += says_moving
            self.wifi_fa += wifi_moving
            if self._last_active is None or t - self._last_active > STOP_LAG_S:
                self.steady_n += 1
                self.steady_fa += says_moving
                self.wifi_steady_fa += wifi_moving
            if (self._prev_moving or left) and self._stopped_at is None:
                self._stopped_at = t
            if self._stopped_at is not None and not says_moving:
                self.stop_lags.append(t - self._stopped_at)
                self._stopped_at = None
        self._prev_moving, self._prev_n = truly_moving, len(truth)

        # Head count: what the twin shows (confirmed tracks) against the truth. Only
        # meaningful while a radar is feeding the tracker.
        if frame["presence"].get("count") is not None:
            self.count_n += 1
            self.count_ok += len(frame["tracks"]) == len(truth)

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
        r.motion_fa_steady = f(self.steady_fa, self.steady_n)
        r.wifi_motion_recall = f(self.wifi_mov_hit, self.mov_n)
        r.wifi_motion_false_alarm = f(self.wifi_fa, self.still_n)
        r.wifi_fa_steady = f(self.wifi_steady_fa, self.steady_n)
        r.count_accuracy = f(self.count_ok, self.count_n)
        if self.latencies:
            r.motion_latency_s = float(np.median(self.latencies))
        if self.stop_lags:
            r.stop_lag_s = float(np.median(self.stop_lags))
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


def calibrate_from_bytes(chunks, device_offset_s: float = 0.0, skip_s: float = 0.0,
                         fan: bool = False) -> Baseline:
    """Empty-room baseline from a byte stream (simulated or recorded).

    fan=True calibrates the FAN-ON baseline: the fan must be running, the first
    skip_s (default 10 s) are discarded while the detector locks onto its lines,
    and it refuses if no fan lines were found.
    """
    dec, cond = StreamDecoder(), CsiConditioner()
    cfg = MotionConfig()
    det, cal = MotionDetector(cfg), Calibrator(cfg)
    resp = RespirationDetector()                 # its empty-room floor, from the same capture
    skip_s = skip_s or (10.0 if fan else 0.0)
    t_first = None
    for ch in chunks:
        for fr in dec.feed(ch):
            p = decode_packet(fr)
            if isinstance(p, CsiPacket):
                for s in cond.push(p.timestamp_us / 1e6, p.raw, p.rssi, gain_comp_db=p.gain_comp_db):
                    t_first = s.t if t_first is None else t_first
                    resp.push(s)
                    r = det.push(s)
                    if r is not None and s.t - t_first >= skip_s:
                        cal.add(r.features["mvs"], r.features.get("level_var"),
                                r.features.get("level_fine"), r.features.get("hbe"))
    if fan and not det.fan.locked:
        raise RuntimeError("no fan lines found in the capture — is the ceiling fan running?")
    b = cal.finish()
    if not fan and len(resp.stats) >= 3:
        b.resp_floor = float(np.median(resp.stats))
    if fan:
        b.note = f"fan on ({det.fan.summary()['f0_hz']} Hz comb); " + b.note
    return b


def simulated_baseline(room: Optional[Room] = None, seconds: float = 65.0,
                       seed: int = 999, channel_seed: int = 0) -> Baseline:
    sim = Simulator(room, SCENARIOS["empty"](), seed=seed, channel_seed=channel_seed)
    b = calibrate_from_bytes(sim.chunks(seconds))
    b.source = "calibrated (simulated empty room)"
    return b


@functools.lru_cache(maxsize=8)
def _cached_baseline(channel_seed: int) -> Baseline:
    """One calibration per simulated room per process (calibration seed 999 is never
    a test seed)."""
    return simulated_baseline(channel_seed=channel_seed)


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


def bench_simulation(scenario: str = "evening", seconds: Optional[float] = None, seed: int = 1,
                     room: Optional[Room] = None, baseline: Optional[Baseline] = None,
                     warmup_s: float = 3.0, channel_seed: int = 0) -> BenchResult:
    if scenario in ROOM_SCENARIOS:
        # Built from a house layout: your room.json, unless a room is given.
        room = room or load_room()[0]
        scn = ROOM_SCENARIOS[scenario](room)
    else:
        room = room or default_room()
        scn = SCENARIOS[scenario]()
    seconds = seconds or SUITE_SECONDS.get(scenario, ROOM_SCENARIO_SECONDS.get(scenario, 120))
    if baseline is None:
        baseline = simulated_baseline(room, channel_seed=channel_seed)
    sim = Simulator(room, scn, seed=seed, channel_seed=channel_seed)
    tag = f"sim:{scenario}:seed{seed}" + (f":room{channel_seed}" if channel_seed else "")
    r = _run(tag, sim.chunks(seconds), _SimTruth(sim), room,
             "simulation", baseline, sim.boot_us / 1e6, seconds, warmup_s)
    r.scenario, r.seed, r.channel_seed = scenario, seed, channel_seed
    r.notes.append("SYNTHETIC: simulator ground truth; not evidence of real-world accuracy")
    return r


def _suite_job(job: tuple) -> BenchResult:
    scenario, seconds, seed, channel_seed = job
    return bench_simulation(scenario, seconds, seed=seed, channel_seed=channel_seed,
                            baseline=_cached_baseline(channel_seed))


def run_jobs(jobs: list[tuple], workers: int = 1) -> list[BenchResult]:
    """Run (scenario, seconds, seed, channel_seed) jobs, in parallel processes when
    workers > 1 (each process calibrates each simulated room once)."""
    if workers <= 1 or len(jobs) == 1:
        return [_suite_job(j) for j in jobs]
    # Longest first, so the slowest run does not start last.
    order = sorted(range(len(jobs)), key=lambda i: -jobs[i][1])
    with ProcessPoolExecutor(max_workers=min(workers, len(jobs))) as ex:
        done = list(ex.map(_suite_job, [jobs[i] for i in order]))
    out: list = [None] * len(jobs)
    for i, r in zip(order, done):
        out[i] = r
    return out


def run_suite(scenarios: Optional[list[str]] = None, seeds=(1, 2, 3), channel_seeds=(0,),
              seconds: Optional[dict] = None, workers: int = 1) -> list[BenchResult]:
    """Every scenario x seed x room. `workers` > 1 runs them in parallel processes."""
    scenarios = scenarios or list(SUITE_SECONDS)
    seconds = {**SUITE_SECONDS, **ROOM_SCENARIO_SECONDS, **(seconds or {})}
    jobs = [(s, seconds.get(s, 120), seed, cs) for s in scenarios for cs in channel_seeds
            for seed in seeds]
    return run_jobs(jobs, workers)


def _worst(key: str, values: np.ndarray) -> float:
    return float(np.nanmin(values) if key in HIGHER_IS_BETTER else np.nanmax(values))


def summarise(results: list[BenchResult]) -> dict:
    """{scenario: {"median": BenchResult, "worst": BenchResult, "runs": n}}."""
    out = {}
    keys = [k for k, v in BenchResult.__dataclass_fields__.items()
            if v.type in ("float", "int") and k not in ("seconds", "samples", "crc_errors", "loss_ratio")]
    by = {}
    for r in results:
        by.setdefault(r.scenario or r.name, []).append(r)
    for scn, rs in by.items():
        med, worst = BenchResult(f"{scn} median", rs[0].seconds), BenchResult(f"{scn} worst", rs[0].seconds)
        for k in keys:
            vals = np.array([getattr(r, k) for r in rs], dtype=float)
            if np.all(np.isnan(vals)):
                continue
            m, w = float(np.nanmedian(vals)), _worst(k, vals)
            if k == "id_switches":
                m, w = int(round(m)), int(w)
            setattr(med, k, m)
            setattr(worst, k, w)
        med.scenario = worst.scenario = scn
        out[scn] = {"median": med, "worst": worst, "runs": len(rs)}
    return out


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


TABLE_COLUMNS = [
    ("presence acc", "presence_accuracy", "{:.1%}"), ("undecided", "presence_undecided", "{:.1%}"),
    ("false EMPTY", "false_empty_rate", "{:.2%}"), ("false occ", "false_occupied_rate", "{:.2%}"),
    ("motion recall", "motion_recall", "{:.1%}"), ("motion FA", "motion_false_alarm", "{:.2%}"),
    ("FA steady", "motion_fa_steady", "{:.2%}"), ("stop lag s", "stop_lag_s", "{:.2f}"),
    ("latency s", "motion_latency_s", "{:.2f}"), ("wifi recall", "wifi_motion_recall", "{:.1%}"),
    ("wifi FA", "wifi_motion_false_alarm", "{:.2%}"), ("wifi FA steady", "wifi_fa_steady", "{:.2%}"),
    ("count acc", "count_accuracy", "{:.1%}"), ("pos err m", "position_error_m", "{:.2f}"),
    ("p90 m", "position_error_p90_m", "{:.2f}"), ("id sw", "id_switches", "{}")]


def format_table(results: list[BenchResult]) -> str:
    cols = TABLE_COLUMNS
    lines = ["| run | " + " | ".join(c[0] for c in cols) + " |",
             "|---|" + "---|" * len(cols)]
    for r in results:
        cells = []
        for _, key, fmt in cols:
            v = getattr(r, key)
            cells.append("—" if isinstance(v, float) and math.isnan(v) else fmt.format(v))
        lines.append(f"| {r.name} | " + " | ".join(cells) + " |")
    return "\n".join(lines)


def format_summary(summary: dict) -> str:
    rows = []
    for scn, s in summary.items():
        s["median"].name = f"{scn} median ({s['runs']} runs)"
        s["worst"].name = f"{scn} worst"
        rows += [s["median"], s["worst"]]
    return format_table(rows)
