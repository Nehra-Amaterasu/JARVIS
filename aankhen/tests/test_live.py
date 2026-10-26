"""Live prediction: a recording read while it grows gives the same records as a finished
one, and a prediction carries the CNN's place, probability and runner-up."""
import threading
import time

import numpy as np

from aankhen import fingerprint as fp
from aankhen import live as lv
from aankhen.transport import Recorder, iter_recording


def test_follow_reads_a_growing_file_like_a_finished_one(tmp_path):
    path = str(tmp_path / "x.akr")
    rec = Recorder(path, {"label": "t"})
    chunks = [bytes([i % 256]) * (50 + i) for i in range(40)]

    def writer():
        for i, c in enumerate(chunks):
            rec.write(c, 1000.0 + i)
            rec._f.flush()                     # what the OS buffer does on its own, sooner or later
            time.sleep(0.005)
        rec.close()

    th = threading.Thread(target=writer)
    th.start()
    got = []
    t_end = time.time() + 5
    for r in lv.follow(path, stop=lambda: len(got) >= len(chunks) or time.time() > t_end, idle_s=0.002):
        got.append(r)
    th.join()
    assert got == list(iter_recording(path))


class _Fake:
    classes = ["bed", "desk"]

    def proba(self, x):
        return np.array([[0.2, 0.8]]) if x.mean() > 0 else np.array([[0.9, 0.1]])


def test_predict_stream_smooths_and_says_unsure():
    ref = np.zeros(fp.N_SUB)
    up, down = np.ones((fp.N_SUB, 50)), -np.ones((fp.N_SUB, 50))
    out = list(lv.predict_stream([(1.0, up), (1.5, up), (2.0, down)], _Fake(), None, ref, smooth=3))
    assert out[0]["cnn"] == "desk" and abs(out[0]["p"] - 0.8) < 1e-9
    # after one "bed" window the 3-window average is 0.5 desk / 0.5 bed... still not over the floor for bed
    assert out[2]["cnn_top"] in ("desk", "bed") and out[2]["p"] < 0.6


def test_fingerprint_zones_names_every_class_once_per_window():
    """The engine's live evidence: one window's probabilities per CNN class every 0.5 s,
    cleaned with the saved empty room of the fan state."""
    seen = []

    class Cnn(_Fake):
        def proba(self, x):
            seen.append(float(x.mean()))
            return np.array([[0.3, 0.7]])

    fz = lv.FingerprintZones(Cnn(), {"fan_on": np.zeros(fp.N_SUB), "fan_off": np.full(fp.N_SUB, 5.0)})
    out = []
    for i in range(400):                     # 4 s at 100 Hz
        r = fz.push(i / 100.0, np.ones(fp.N_SUB), False, True)
        if r is not None:
            out.append((i / 100.0, r))
    # "bed" is the merged place (lying + sitting): both zone ids the belief knows get its p
    assert out and all(r == {"bed_lying": 0.3, "bed_sitting": 0.3, "desk": 0.7} for _, r in out)
    assert 1.9 <= out[0][0] <= 2.2 and all(abs(b[0] - a[0] - 0.5) < 0.05 for a, b in zip(out, out[1:]))
    assert all(abs(m) < 1e-6 for m in seen)  # log(1) minus the fan-on reference (0), not fan-off's 5
