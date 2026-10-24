"""Teach -> train -> score, end to end, on simulated recordings dressed as real ones.

The two 75 s recordings are simulated once for the module (they were made twice before:
~30 % of this file's time) and copied per test."""
import json
import shutil
import struct
from pathlib import Path

import pytest

from aankhen.room import default_room
from aankhen.simulator import SCENARIOS, Simulator
from aankhen.teach import Teacher
from aankhen.transport import RECORD_MAGIC, iter_recording, read_recording_meta

SECONDS = 75.0


class _Hub:
    def __init__(self, d):
        self.recordings_dir = Path(d)
        self.engine = self.source = None
        self.mode = "replay"


def _record(folder: Path, name, scenario, label, seed):
    sim = Simulator(default_room(), SCENARIOS[scenario](), seed=seed)
    path = str(folder / f"{name}.akr")
    sim.write_recording(path, SECONDS)
    # What the viewer writes: the whole stretch carries one label.
    with open(path[:-4] + ".labels.json", "w", encoding="utf-8") as f:
        json.dump({"kind": "human-labels", "source": "teach", "simulated": False,
                   "segments": [{"label": label, "start": 0.0, "end": SECONDS}]}, f)
    return path


def _as_board_recording(src: str, dst: str) -> None:
    """The same bytes under the header a real board's recording carries ("source":
    "hardware"): the stand-in for a recording of the real room."""
    meta = {**read_recording_meta(src), "source": "hardware"}
    head = json.dumps(meta).encode("utf-8")
    with open(dst, "wb") as f:
        f.write(RECORD_MAGIC + struct.pack("<I", len(head)) + head)
        for t, data in iter_recording(src):
            f.write(struct.pack("<dI", t, len(data)) + data)


@pytest.fixture(scope="module")
def recordings(tmp_path_factory):
    d = tmp_path_factory.mktemp("teach-src")
    return {"desk": _record(d, "desk", "still", "desk", 1), "empty": _record(d, "empty", "empty", "empty", 2)}


def _place(recordings, folder: Path, names: dict, board: bool) -> None:
    for which, name in names.items():
        src = recordings[which]
        dst = str(folder / f"teach-{name}.akr")
        if board:
            _as_board_recording(src, dst)
        else:
            shutil.copy(src, dst)
        shutil.copy(src[:-4] + ".labels.json", dst[:-4] + ".labels.json")


@pytest.mark.slow
def test_training_on_labelled_recordings_scores_on_held_out_time(recordings, tmp_path):
    _place(recordings, tmp_path, {"desk": "desk", "empty": "empty"}, board=True)
    t = Teacher(_Hub(tmp_path), model_path=str(tmp_path / "model.joblib"))
    assert t.totals()["desk"] == SECONDS and t.totals()["empty"] == SECONDS
    t._train(include_sim=False)
    tr = t.training
    assert tr["state"] == "done", tr
    assert tr["held_out_windows"] > 50
    assert tr["occupancy_accuracy"] > 0.8
    assert (tmp_path / "model.joblib").exists()


def test_simulated_teach_recordings_are_never_trained_on(recordings, tmp_path):
    """Named teach-sim-* (the hub's name while it runs the simulator) or not, a recording
    whose header says it came from the simulation never counts and never trains."""
    _place(recordings, tmp_path, {"desk": "sim-desk", "empty": "sim-empty"}, board=False)
    _place(recordings, tmp_path, {"desk": "renamed-desk", "empty": "renamed-empty"}, board=False)
    t = Teacher(_Hub(tmp_path), model_path=str(tmp_path / "model.joblib"))
    assert sum(t.totals().values()) == 0
    t._train(include_sim=False)
    assert t.training["state"] == "error" and "Label at least two" in t.training["error"]
    assert not (tmp_path / "model.joblib").exists()
