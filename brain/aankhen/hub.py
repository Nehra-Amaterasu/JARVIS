"""Aankhen hub: one source + one engine, shared by every viewer.

The desktop app's Aankhen tab and the standalone `python -m aankhen serve` (phone /
AR viewer) both sit on this. It owns the lifecycle — pick a source, calibrate,
start the consumer thread, stop cleanly — and builds the messages viewers receive.

Source selection ("auto"): the ESP32 if one is plugged in, otherwise the simulator.
The simulator is never silent about itself: every message carries source=
"simulation", and in that mode the hub also sends the simulator's ground truth and
live tracking error, so the twin can draw where people REALLY are next to where the
pipeline thinks they are.
"""
from __future__ import annotations

import math
import os
import threading
import time
from typing import Optional

import numpy as np
from scipy.optimize import linear_sum_assignment

from .engine import Engine, run_engine
from .motion import Baseline
from .room import Room, load_room
from .simulator import SCENARIOS, Simulator, SimulatorSource
from .transport import ReplaySource, SerialSource, find_esp32_port

HERE = os.path.dirname(os.path.abspath(__file__))
BASELINE_FILE = os.path.join(HERE, "baseline.json")     # gitignored: room-specific


class AankhenHub:
    def __init__(self, room: Optional[Room] = None, room_measured: Optional[bool] = None):
        if room is None:
            room, measured = load_room()
            room_measured = measured if room_measured is None else room_measured
        self.room = room
        self.room_measured = bool(room_measured)
        self.source = None
        self.engine: Optional[Engine] = None
        self.sim: Optional[Simulator] = None
        self.mode: Optional[str] = None
        self.scenario: Optional[str] = None
        self.started_at: Optional[float] = None
        self.error: Optional[str] = None
        self._stop = threading.Event()
        self._thread: Optional[threading.Thread] = None
        self._lock = threading.RLock()
        self._sim_baseline: Optional[Baseline] = None

    # ------------------------------------------------------------ lifecycle
    def start(self, mode: str = "auto", scenario: str = "evening", port: Optional[str] = None,
              path: Optional[str] = None, speed: float = 1.0, loop: bool = True) -> dict:
        with self._lock:
            self.stop()
            self.error = None
            if mode == "auto":
                mode = "hardware" if (port or find_esp32_port()) else "simulation"
            if mode == "hardware":
                source = SerialSource(port)
                baseline = Baseline.load(BASELINE_FILE)
            elif mode == "replay":
                if not path or not os.path.exists(path):
                    raise FileNotFoundError(f"recording not found: {path}")
                source = ReplaySource(path, speed=speed, loop=loop)
                baseline = Baseline.load(BASELINE_FILE)
            elif mode == "simulation":
                if scenario not in SCENARIOS:
                    raise ValueError(f"unknown scenario {scenario!r}; one of {sorted(SCENARIOS)}")
                if self._sim_baseline is None:
                    from .bench import simulated_baseline
                    self._sim_baseline = simulated_baseline(self.room)
                baseline = self._sim_baseline
                self.sim = Simulator(self.room, SCENARIOS[scenario](), seed=int(time.time()) % 10_000)
                source = SimulatorSource(self.sim, speed=speed)
            else:
                raise ValueError(f"unknown mode {mode!r}")
            if mode != "simulation":
                self.sim = None
            self.engine = Engine(self.room, source.kind, self.room_measured, baseline)
            self.source = source
            self.mode, self.scenario = mode, scenario if mode == "simulation" else None
            self._stop = threading.Event()
            source.start()
            self._thread = threading.Thread(target=run_engine, args=(source, self.engine, self._stop),
                                            name="aankhen-engine", daemon=True)
            self._thread.start()
            self.started_at = time.time()
            return self.info()

    def stop(self) -> None:
        with self._lock:
            self._stop.set()
            if self.source is not None:
                try:
                    self.source.stop()
                except Exception:
                    pass
            if self._thread is not None:
                self._thread.join(timeout=2)
            self.source, self._thread = None, None

    @property
    def running(self) -> bool:
        return self.source is not None

    def info(self) -> dict:
        src = self.source
        return {
            "running": self.running,
            "mode": self.mode,
            "kind": getattr(src, "kind", None),
            "scenario": self.scenario,
            "scenarios": sorted(SCENARIOS),
            "port": getattr(src, "port", None),
            "room": self.room.name,
            "room_measured": self.room_measured,
            "started_at": self.started_at,
            "baseline": (self.engine.motion.baseline.source
                         if self.engine and self.engine.motion.baseline else "none"),
            "error": self.error,
        }

    # ------------------------------------------------------------ messages
    def link(self) -> dict:
        src = self.source
        if src is None:
            return {}
        st = src.decoder.stats
        return {"frames_ok": st.frames_ok, "crc_errors": st.crc_errors,
                "loss_ratio": round(st.loss_ratio(), 4), "bytes_skipped": st.bytes_skipped,
                "queue_overflows": src.queue_overflows, "port": getattr(src, "port", None)}

    def frame(self) -> Optional[dict]:
        eng = self.engine
        if eng is None:
            return None
        msg = eng.frame_message()
        if self.sim is not None and eng.device_t is not None:
            t = eng.device_t - self.sim.boot_us / 1e6
            truth = [s.to_dict() for s in self.sim.truth_at(t)]
            msg["truth"] = truth
            msg["metrics"] = _match(truth, msg["tracks"])
            msg["scenario"] = {"name": self.scenario, "t": round(t, 1),
                               "period_s": self.sim.scenario.period_s}
        return msg

    def heatmap(self, layer: str = "live") -> Optional[dict]:
        return self.engine.heatmap_message(layer) if self.engine else None

    def status(self) -> Optional[dict]:
        if self.engine is None:
            return {"type": "status", "source": "unknown", "sensors": {}, "link": {},
                    "room_measured": self.room_measured, "hub": self.info()}
        msg = self.engine.status_message(self.link())
        msg["hub"] = self.info()
        return msg

    def room_message(self) -> dict:
        if self.engine is not None:
            return self.engine.room_message()
        return {"type": "room", "source": "unknown", "room": self.room.to_dict(),
                "room_measured": self.room_measured}

    def snapshot(self) -> dict:
        """Compact presence summary for JARVIS's brain."""
        return self.engine.snapshot() if self.engine else {"source": None, "presence": None}


def _match(truth: list[dict], tracks: list[dict], gate: float = 1.0) -> dict:
    """Pair simulated people with tracks: the live tracking error the twin draws."""
    pairs = []
    if truth and tracks:
        cost = np.array([[math.hypot(a["x"] - b["x"], a["y"] - b["y"]) for b in tracks] for a in truth])
        for i, j in zip(*linear_sum_assignment(cost)):
            if cost[i, j] <= gate:
                pairs.append({"truth": truth[i]["name"], "track": tracks[j]["id"],
                              "error_m": round(float(cost[i, j]), 3)})
    errs = [p["error_m"] for p in pairs]
    return {"pairs": pairs, "truth_n": len(truth), "tracked_n": len(tracks),
            "mean_error_m": round(float(np.mean(errs)), 3) if errs else None}
