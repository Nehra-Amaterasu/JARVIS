"""Teach Aankhen from the viewer: label what you are doing, then train on it.

THE LOOP
  1. In the viewer, tap where you are ("At my desk", "In bed", "Moving around",
     "Outside my door", "Room empty"). The hub records the raw stream to
     recordings/teach-*.akr and the labels, with times, to the matching
     .labels.json. Tap another label when you move; "Pause" stops labelling,
     "Stop" closes the recording.
  2. "Train on my labels" fits the spatial model (learn.py) on every teach recording,
     plus the simulated days if they exist, with your real windows weighted
     REAL_WEIGHT times more. It is scored on the LAST 30 % of each labelled
     stretch, which training never sees, and the score is shown before anything
     else happens. The new model then replaces the running one (still advisory).

Recordings made while the hub runs the SIMULATOR are named teach-sim-* and never
used for training: they label simulated people, not you.
"""
from __future__ import annotations

import glob
import json
import os
import threading
import time
from typing import Optional

import numpy as np

LABELS = {"desk": "At my desk", "bed": "In bed", "walk": "Moving around",
          "hallway": "Outside my door", "empty": "Room empty"}
REAL_WEIGHT = 5.0
HOLDOUT = 0.3
MIN_LABEL_S = 30.0


class Teacher:
    def __init__(self, hub, model_path: Optional[str] = None):
        self.hub = hub
        self.model_path = model_path            # None: learn.MODEL_FILE
        self.lock = threading.RLock()
        self.session: Optional[dict] = None
        self.training: dict = {"state": "idle"}

    # ------------------------------------------------------------ recording
    def _now(self) -> Optional[float]:
        eng = self.hub.engine
        return eng.device_t if eng is not None else None

    def _labels_path(self) -> str:
        return self.session["path"][:-4] + ".labels.json"

    def _write_labels(self) -> None:
        s = self.session
        segs = list(s["segments"])
        if s["current"]:
            segs.append({**s["current"], "end": None})
        with open(self._labels_path(), "w", encoding="utf-8") as f:
            json.dump({"kind": "human-labels", "source": "teach", "simulated": s["simulated"],
                       "segments": [x for x in segs if x["end"] is not None]}, f, indent=2)

    def start(self) -> dict:
        with self.lock:
            if self.session is not None:
                return self.status()
            src, now = self.hub.source, self._now()
            if src is None or now is None:
                raise RuntimeError("Aankhen is not receiving data yet: start it first.")
            sim = self.hub.mode == "simulation"
            stamp = time.strftime("%Y%m%d-%H%M%S")
            path = str(self.hub.recordings_dir / f"teach-{'sim-' if sim else ''}{stamp}.akr")
            src.record_to(path, {"label": "teach", "simulated": sim})
            self.session = {"path": path, "t0": now, "segments": [], "current": None,
                            "simulated": sim, "started": time.time()}
            self._write_labels()
            return self.status()

    def label(self, label: Optional[str]) -> dict:
        if label is not None and label not in LABELS:
            raise ValueError(f"unknown label {label!r}; one of {sorted(LABELS)}")
        with self.lock:
            if self.session is None:
                self.start()
            s, now = self.session, self._now()
            rel = round(now - s["t0"], 2)
            if s["current"]:
                s["segments"].append({**s["current"], "end": rel})
            s["current"] = {"label": label, "start": rel} if label else None
            self._write_labels()
            return self.status()

    def stop(self) -> dict:
        with self.lock:
            if self.session is None:
                return self.status()
            self.label(None)
            src = self.hub.source
            if src is not None:
                src.stop_recording()
            self.session = None
            return self.status()

    def status(self) -> dict:
        with self.lock:
            s, now = self.session, self._now()
            cur = None
            if s and s["current"] and now is not None:
                cur = {"label": s["current"]["label"], "name": LABELS[s["current"]["label"]],
                       "seconds": round(now - s["t0"] - s["current"]["start"], 1)}
            return {"recording": s is not None, "simulated": bool(s and s["simulated"]),
                    "current": cur, "labels": LABELS, "totals": self.totals(),
                    "training": dict(self.training)}

    def totals(self) -> dict:
        """Seconds labelled per label across all real (non-simulated) teach recordings."""
        out = {k: 0.0 for k in LABELS}
        for lp in glob.glob(str(self.hub.recordings_dir / "teach-*.labels.json")):
            if os.path.basename(lp).startswith("teach-sim-"):
                continue
            try:
                segs = json.load(open(lp, encoding="utf-8")).get("segments", [])
            except (OSError, ValueError):
                continue
            for g in segs:
                if g.get("label") in out and g.get("end") is not None:
                    out[g["label"]] += max(0.0, g["end"] - g["start"])
        if self.session and not self.session["simulated"]:
            s, now = self.session, self._now()
            if s["current"] and now is not None:
                out[s["current"]["label"]] += max(0.0, now - s["t0"] - s["current"]["start"])
        return {k: round(v, 1) for k, v in out.items()}

    # ------------------------------------------------------------ training
    def train_async(self, include_sim: bool = True) -> dict:
        with self.lock:
            if self.training.get("state") == "running":
                return dict(self.training)
            self.training = {"state": "running", "started": time.time(), "step": "reading your recordings"}
        threading.Thread(target=self._train, args=(include_sim,), name="aankhen-train", daemon=True).start()
        return dict(self.training)

    def _train(self, include_sim: bool) -> None:
        from .learn import MODEL_DIR, FeatureStream, SpatialModel, TemporalFilter, evaluate, load_runs, \
            recording_run, train
        try:
            real = []
            for akr in sorted(glob.glob(str(self.hub.recordings_dir / "teach-*.akr"))):
                if os.path.basename(akr).startswith("teach-sim-"):
                    continue
                if self.session and os.path.abspath(akr) == os.path.abspath(self.session["path"]):
                    continue                     # still being written
                r = recording_run(akr)
                if len(r["y"]):
                    real.append(r)
            labelled = {c for r in real for c in set(r["y"].tolist())}
            n = sum(len(r["y"]) for r in real)
            if n * 0.5 < 2 * MIN_LABEL_S or len(labelled) < 2:
                raise RuntimeError("Label at least two different things (e.g. desk and room empty), "
                                   f"{MIN_LABEL_S:.0f} s or more each, and stop the recording first.")
            train_runs, test_runs = [], []
            for r in real:
                # Hold out the END of each labelled stretch, never random windows:
                # neighbouring half-seconds are nearly identical and would leak.
                cut = np.zeros(len(r["y"]), bool)
                for c in set(r["y"].tolist()):
                    idx = np.flatnonzero(r["y"] == c)
                    cut[idx[int(len(idx) * (1 - HOLDOUT)):]] = True
                pick = lambda m: {k: (v[m] if isinstance(v, np.ndarray) and len(v) == len(r["y"]) else v)
                                  for k, v in r.items()}
                train_runs.append(pick(~cut))
                test_runs.append(pick(cut))
            weights = [REAL_WEIGHT] * len(train_runs)
            sim_path = os.path.join(MODEL_DIR, "sim-train.npz")
            if include_sim and os.path.exists(sim_path):
                self.training["step"] = "adding the simulated days"
                sim = load_runs(sim_path)
                train_runs += sim
                weights += [1.0] * len(sim)
            self.training["step"] = f"training on {sum(len(r['y']) for r in train_runs)} windows"
            model = train(train_runs, note="teach recordings (.akr)" + (" + sim" if include_sim else ""),
                          weights=weights)
            rep = evaluate(model, test_runs)
            model.save(self.model_path) if self.model_path else model.save()
            eng = self.hub.engine
            if eng is not None:
                with eng.lock:
                    eng.spatial = model
                    eng._spatial_fs = eng.new_feature_stream()
                    eng._spatial_filter = TemporalFilter(model.priors)
            f = rep["filtered"]
            self.training = {"state": "done", "finished": time.time(),
                             "held_out_windows": rep["windows"],
                             "occupancy_accuracy": round(f["occ_accuracy"], 3),
                             "five_way_accuracy": round(f["accuracy"], 3),
                             "zone_accuracy": round(f.get("zone_accuracy_when_occupied") or 0.0, 3),
                             "classes": rep["classes"]}
        except Exception as e:                   # shown in the viewer, never swallowed
            self.training = {"state": "error", "error": str(e)}
