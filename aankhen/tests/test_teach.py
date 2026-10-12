"""Teach -> train -> score, end to end, on simulated recordings named like real ones."""
import json
from pathlib import Path

from aankhen.room import default_room
from aankhen.simulator import SCENARIOS, Simulator
from aankhen.teach import Teacher


class _Hub:
    def __init__(self, d):
        self.recordings_dir = Path(d)
        self.engine = self.source = None
        self.mode = "replay"


def _record(tmp_path, name, scenario, label, seconds=75.0, seed=1):
    sim = Simulator(default_room(), SCENARIOS[scenario](), seed=seed)
    path = str(tmp_path / f"teach-{name}.akr")
    sim.write_recording(path, seconds)
    # What the viewer writes: the whole stretch carries one label.
    with open(path[:-4] + ".labels.json", "w", encoding="utf-8") as f:
        json.dump({"kind": "human-labels", "source": "teach", "simulated": False,
                   "segments": [{"label": label, "start": 0.0, "end": seconds}]}, f)


def test_training_on_labelled_recordings_scores_on_held_out_time(tmp_path):
    _record(tmp_path, "desk", "still", "desk")
    _record(tmp_path, "empty", "empty", "empty", seed=2)
    t = Teacher(_Hub(tmp_path), model_path=str(tmp_path / "model.joblib"))
    assert t.totals()["desk"] == 75.0 and t.totals()["empty"] == 75.0
    t._train(include_sim=False)
    tr = t.training
    assert tr["state"] == "done", tr
    assert tr["held_out_windows"] > 50
    assert tr["occupancy_accuracy"] > 0.8
    assert (tmp_path / "model.joblib").exists()


def test_simulated_teach_recordings_are_never_trained_on(tmp_path):
    _record(tmp_path, "sim-desk", "still", "desk")
    _record(tmp_path, "sim-empty", "empty", "empty", seed=2)
    t = Teacher(_Hub(tmp_path), model_path=str(tmp_path / "model.joblib"))
    assert sum(t.totals().values()) == 0
    t._train(include_sim=False)
    assert t.training["state"] == "error"
    assert not (tmp_path / "model.joblib").exists()
