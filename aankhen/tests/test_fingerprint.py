"""The fingerprint pipeline: windowing, labelling by time, cleaning by the same day's
empty room, and the kNN and CNN judged on a held-out day. Synthetic signals only:
each zone bends a different band of subcarriers, each day adds its own drift."""
import numpy as np
import pytest

from aankhen import fingerprint as fp

ZONES = ("desk", "bed", "door")


def stream(seconds, t0=0.0, amp_fn=None, filled_every=None):
    for i in range(int(seconds * fp.RATE_HZ)):
        t = t0 + i / fp.RATE_HZ
        amp = amp_fn(t) if amp_fn else np.ones(fp.N_SUB)
        yield t, amp, bool(filled_every and i % filled_every == 0)


def test_one_window_every_half_second_after_two_seconds():
    w = list(fp.windows(stream(4.0)))
    assert len(w) == 5                                   # at 2.0, 2.5, 3.0, 3.5, 4.0 s (last sample 3.99)
    assert w[0][1].shape == (fp.N_SUB, fp.WIN // fp.POOL)


def test_a_gap_restarts_the_window():
    s = list(stream(2.5)) + list(stream(2.5, t0=10.0))
    ends = [round(t, 2) for t, _ in fp.windows(s)]
    assert ends == [1.99, 2.49, 11.99, 12.49]            # the second piece starts over: nothing spans the gap


def test_windows_with_too_many_filled_samples_are_dropped():
    assert list(fp.windows(stream(3.0, filled_every=2))) == []


def _block(zone, t0, t1, kind=None, fan=False):
    return {"zone": zone, "activity": "still", "fan": fan, "t_start": t0, "t_end": t1, "verdict": "ok", "kind": kind}


def test_labels_by_time_purge_and_empty_room_subtracted():
    wins = [(t, np.full((fp.N_SUB, 50), 2.0 if t < 20 else 5.0)) for t in np.arange(1, 40, 0.5)]
    labels = [_block("out_of_room", 0, 20, kind="empty"), _block("desk", 20, 40),
              {**_block("bed", 40, 60), "verdict": "redo"}]
    d = fp.label_windows(wins, labels)
    assert set(d["zone"].tolist()) == {"desk"}           # empty blocks are the reference, redo blocks are ignored
    assert d["t"].min() >= 25                            # 5 s settling purged
    assert np.allclose(d["X"], 3.0)                      # 5.0 minus the empty room's 2.0


def test_no_empty_block_means_no_clean_windows():
    wins = [(t, np.ones((fp.N_SUB, 50))) for t in np.arange(1, 30, 0.5)]
    assert len(fp.label_windows(wins, [_block("desk", 0, 30)])["zone"]) == 0


def synthetic_day(seed, n=60):
    """n windows per zone; each zone lifts its own subcarrier band; the day shifts every subcarrier."""
    rng = np.random.default_rng(seed)
    drift = rng.normal(0, 0.25, (fp.N_SUB, 1))
    X, Z = [], []
    for zi, z in enumerate(ZONES):
        band = slice(zi * 15, zi * 15 + 12)
        for _ in range(n):
            w = rng.normal(0, 0.35, (fp.N_SUB, 50)) + drift
            w[band] += 0.9 + 0.3 * np.sin(np.linspace(0, 6, 50) + rng.uniform(0, 6))
            X.append(w); Z.append(z)
    return {"X": np.asarray(X, np.float32), "zone": np.asarray(Z), "fan": np.zeros(len(Z), bool)}


@pytest.fixture(scope="module")
def days():
    return {f"2026-11-0{i}": [synthetic_day(i)] for i in range(1, 4)}


def test_knn_and_cnn_beat_chance_on_a_day_they_never_saw(days):
    rep = fp.leave_one_day_out(days, epochs=8)
    for d in rep["days"]:
        v = rep["per_day"][d]
        assert v["knn"] > 0.8 and v["cnn"] > 0.8, (d, v)
    assert rep["winner"] in ("knn", "cnn") and rep["note"] is None


def test_the_cnn_is_small_enough_for_the_esp32(days):
    m = fp.CnnFingerprint(epochs=1).fit(fp._cat(days["2026-11-01"], "X"), fp._cat(days["2026-11-01"], "zone"))
    assert m.weights() < 25_000                          # int8 -> under 25 KB on the board
    p = m.proba(fp._cat(days["2026-11-02"], "X")[:4])
    assert p.shape == (4, 3) and np.allclose(p.sum(1), 1, atol=1e-5)


def test_one_day_is_flagged_as_saying_little():
    rep = fp.leave_one_day_out({"2026-11-01": [synthetic_day(1)]}, epochs=1)
    assert rep["note"] and "error" in rep["per_day"]["2026-11-01"]
