"""Channel chart (chart.py) on synthetic data only: triplets respect time, the chart
recovers a smooth walk's layout from its features, scores and the anchor fit behave, and
the hand-written PNG is a valid PNG."""
import struct
import zlib

import numpy as np
import pytest

pytest.importorskip("torch")

from aankhen import chart as ch


def walk(n: int = 900, seed: int = 0) -> tuple[np.ndarray, np.ndarray]:
    """A person wandering a 4 x 4 m room, one window every 0.5 s: positions (n, 2), times."""
    rng = np.random.default_rng(seed)
    pos = np.zeros((n, 2))
    pos[0] = (2.0, 2.0)
    v = np.zeros(2)
    for i in range(1, n):
        v = 0.85 * v + rng.normal(0, 0.05, 2)
        pos[i] = np.clip(pos[i - 1] + v, 0.0, 4.0)
    return pos, np.arange(n) * 0.5


def features(pos: np.ndarray, seed: int = 1, noise: float = 0.05) -> np.ndarray:
    """A smooth, nonlinear fingerprint of position (multipath-like: cosines of
    projections), plus noise: what a link would measure if place were all it saw."""
    rng = np.random.default_rng(seed)
    K = rng.normal(0, 1.2, (2, 24))
    ph = rng.uniform(0, 2 * np.pi, 24)
    return np.cos(pos @ K + ph) + rng.normal(0, noise, (len(pos), 24))


def test_triplets_respect_time_and_recordings():
    t = np.concatenate([np.arange(100) * 0.5, np.arange(100) * 0.5])
    group = np.repeat([0, 1], 100)
    stretch = np.zeros(200, int)
    a, p, n = ch.triplets(t, group, stretch, np.random.default_rng(0), 500)
    assert len(a) > 400
    assert np.all(np.abs(t[a] - t[p]) <= ch.NEAR_S) and np.all(a != p)
    assert np.all(np.abs(t[a] - t[n]) >= ch.FAR_S)
    assert np.all(group[a] == group[p]) and np.all(group[a] == group[n])


def test_the_chart_recovers_a_walks_layout_and_beats_a_random_projection():
    pos, t = walk()
    w = ch.Windows("synthetic", t, np.zeros(len(t), int), features(pos).astype(np.float32), np.ones(len(t), bool))
    chart = ch.train_chart([w], steps=600, threads=1)
    tw, ct = ch.trust_continuity(pos, chart.apply(w.X), k=10)
    rtw, _ = ch.trust_continuity(pos, ch.baseline_chart([w], "random").apply(w.X), k=10)
    assert tw > 0.85 and ct > 0.85
    assert tw > rtw + 0.05


def test_trust_continuity_bounds():
    rng = np.random.default_rng(0)
    X = rng.normal(size=(200, 3))
    assert ch.trust_continuity(X, X[:, :2] * 3 + 1, k=5)[0] > 0.75     # dropping 1 of 3 dims keeps most
    assert ch.trust_continuity(X, X * 2.0, k=5) == pytest.approx((1.0, 1.0))
    tw, ct = ch.trust_continuity(X, rng.normal(size=(200, 2)), k=5)
    assert 0.35 < tw < 0.65 and 0.35 < ct < 0.65                        # random ~0.5


def test_two_anchors_fix_scale_rotation_and_shift_exactly():
    rng = np.random.default_rng(0)
    P = rng.normal(size=(10, 2))
    s, th, sh = 2.5, 0.7, np.array([1.0, -3.0])
    Q = ch.to_metres(P, s, th, sh)
    s2, th2, sh2 = ch.similarity_from_anchors(P[:2], Q[:2])
    assert s2 == pytest.approx(s) and th2 == pytest.approx(th) and np.allclose(sh2, sh)
    assert np.allclose(ch.to_metres(P, s2, th2, sh2), Q)
    with pytest.raises(ValueError):
        ch.similarity_from_anchors(np.zeros((2, 2)), Q[:2])


def test_scores_on_clean_clusters():
    rng = np.random.default_rng(0)
    centres = {"desk": (0, 0), "bed": (5, 0), "walk": (0, 5), "away": (5, 5)}
    lab = np.repeat(list(centres), 30)
    pts = np.array([centres[z] for z in lab], float) + rng.normal(0, 0.3, (120, 2))
    assert ch.kmeans_purity(pts, lab, 4) == 1.0
    assert (ch.knn_labels(pts, lab, pts + 0.01, 5) == lab).all()
    t = np.tile(np.arange(30) * 0.5, 4)
    tc = ch.time_confound(pts, lab, t)
    assert tc["ratio"] < 0.1                       # halves of a step sit together


def test_png_is_valid_and_holds_the_pixels(tmp_path):
    img = np.zeros((7, 5, 3), np.uint8)
    img[2, 3] = (255, 10, 20)
    p = tmp_path / "x.png"
    ch.write_png(str(p), img)
    data = p.read_bytes()
    assert data[:8] == b"\x89PNG\r\n\x1a\n"
    n, tag = struct.unpack(">I4s", data[8:16])
    w, h = struct.unpack(">II", data[16:24])
    assert tag == b"IHDR" and (w, h) == (5, 7)
    assert struct.unpack(">I", data[16 + n:20 + n])[0] == zlib.crc32(data[12:16 + n]) & 0xFFFFFFFF
    i = data.index(b"IDAT")
    ln = struct.unpack(">I", data[i - 4:i])[0]
    raw = np.frombuffer(zlib.decompress(data[i + 4:i + 4 + ln]), np.uint8).reshape(7, 1 + 5 * 3)
    assert (raw[:, 0] == 0).all()
    assert np.array_equal(raw[:, 1:].reshape(7, 5, 3), img)


def test_scatter_writes_a_figure(tmp_path):
    rng = np.random.default_rng(0)
    p = tmp_path / "chart.png"
    ch.scatter_png(str(p), [("held out", rng.normal(size=(40, 2)), np.array(ch.ZONES * 10))], size=120)
    assert p.read_bytes()[:4] == b"\x89PNG"
