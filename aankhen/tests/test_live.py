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
