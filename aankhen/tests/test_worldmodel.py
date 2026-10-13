"""The world model (worldmodel.py) on synthetic data only: the picture's scale, phase
sanitisation, and that a periodic signal is learned while a novel burst is a surprise."""
import os

import numpy as np
import pytest

torch = pytest.importorskip("torch")

from aankhen import worldmodel as wm
from aankhen.csi import LLTF_KEEP, amplitudes, bin_of
from aankhen.motion import _smooth_basis

SUB = wm.N_SUB


def stream(seconds: float, signal=None, seed: int = 0, noise: float = 0.01) -> wm.Stream:
    """A 100 Hz conditioned stream: amplitudes ~1 with white receiver noise, plus signal(t)
    (n, 51) if given; no gaps, nothing forward-filled."""
    rng = np.random.default_rng(seed)
    n = int(seconds * wm.RATE_HZ)
    t = np.arange(n) / wm.RATE_HZ
    amp = 1.0 + rng.normal(0, noise, (n, SUB))
    if signal is not None:
        amp += signal(t)
    return wm.Stream("synthetic", t, amp.astype(np.float32), np.zeros(n, bool), np.full(n, -60.0),
                     np.full(n, -60.0))


def ripple(f_hz: float, size: float, seed: int = 1):
    """A body-like change: smooth across subcarriers (low Legendre orders), periodic in time."""
    pattern = _smooth_basis(SUB) @ np.random.default_rng(seed).normal(0, 1, 6)
    pattern /= np.abs(pattern).max()
    return lambda t: size * np.outer(np.sin(2 * np.pi * f_hz * t), pattern)


def burst(start: float, stop: float, size: float, seed: int = 2):
    """A novel movement: smooth across subcarriers, a random broadband wiggle in time."""
    rng = np.random.default_rng(seed)

    def f(t):
        k = (t >= start) & (t < stop)
        wig = np.convolve(rng.normal(0, 1, len(t)), np.ones(15) / 15, mode="same") * k
        pattern = _smooth_basis(SUB) @ rng.normal(0, 1, 6)
        return size * np.outer(wig / (np.abs(wig).max() + 1e-12), pattern / np.abs(pattern).max())
    return f


def test_white_noise_reads_about_one_in_the_picture():
    pic = wm.change_picture(stream(40.0))
    z = pic.z[pic.valid]
    assert pic.z.shape[1] == SUB and abs(len(pic.t) - 40 * wm.FRAME_HZ) <= 2
    assert 0.7 < z.std() < 1.4                      # the noise scale carries through the filter
    assert np.allclose(np.diff(pic.t), 1 / wm.FRAME_HZ)


def test_a_gap_breaks_the_stream_and_no_window_spans_it():
    st = stream(30.0)
    st.t[1500:] += 1.0                              # a 1 s hole: the resampler restarts
    pic = wm.change_picture(st)
    ends = wm.window_ends(pic)
    assert len(set(pic.seg.tolist())) == 2
    assert all(pic.seg[e] == pic.seg[e - wm.WINDOW + 1] for e in ends)


def _packet(H: np.ndarray) -> bytes:
    """int8 CSI buffer from 51 complex values: imaginary byte first, then real."""
    buf = np.zeros(128, np.int8)
    for s, h in zip(LLTF_KEEP, H):
        k = bin_of(s)
        buf[2 * k], buf[2 * k + 1] = int(round(h.imag)), int(round(h.real))
    return buf.tobytes()


def test_phase_sanitisation_removes_the_clock_line_and_keeps_the_bend():
    s = np.array(LLTF_KEEP, float)
    bend = 0.6 * np.cos(np.pi * (s + 26) / 26)       # multipath-shaped, not a line
    rng = np.random.default_rng(0)
    out = []
    for _ in range(20):                              # random clock offsets every packet
        a, b = rng.uniform(-0.25, 0.25), rng.uniform(-np.pi, np.pi)
        H = 60 * np.exp(1j * (a * s + b + bend))
        raw = _packet(H)
        assert np.allclose(amplitudes(raw), np.abs(H), atol=1.0)    # same byte layout
        out.append(wm.phase_residuals([raw])[0])
    sc = s - s.mean()
    expect = bend - bend.mean() - sc * (bend @ sc) / (sc @ sc)
    assert np.abs(np.array(out) - expect).max() < 0.05
    assert np.isnan(wm.phase_residuals([b"\x00" * 128, b"\x01"])).all()


def test_phase_channels_double_the_picture():
    st = stream(20.0)
    st.phase = np.zeros_like(st.amp)
    pic = wm.change_picture(st, phase=True)
    assert pic.z.shape[1] == 2 * SUB and pic.phase


def _small_train(pics, seed=0):
    return wm.train(pics, kind="shared", seed=seed, threads=1, hidden=8, batch=8, max_steps=60,
                    eval_every=30, minutes=2.0, val_windows=200, log=lambda s: None)


def test_periodic_signal_is_predictable_and_a_novel_burst_is_a_surprise():
    train_pic = wm.change_picture(stream(90.0, ripple(1.3, 0.05), seed=3))
    model = _small_train([train_pic])
    sig = ripple(1.3, 0.05)
    test = stream(40.0, lambda t: sig(t) + burst(25.0, 31.0, 0.08)(t), seed=4)
    pic = wm.change_picture(test)
    s = wm.surprise(model, pic)
    rel = pic.t[s["ends"]]
    calm = s["net_amp"][(rel > 10) & (rel < 22)]
    hit = s["net_amp"][(rel > 26) & (rel < 31)]
    assert np.median(calm) < 3.0                    # the periodic ripple is (mostly) predicted
    assert np.median(hit) > 3 * np.median(calm)     # what it never saw is not
    assert np.median(calm) < 0.5 * np.median(s["zero_amp"][(rel > 10) & (rel < 22)])


def test_shapes_seeding_and_saving(tmp_path):
    pics = [wm.change_picture(stream(60.0, ripple(0.8, 0.03), seed=5))]
    a, b = _small_train(pics, seed=7), _small_train(pics, seed=7)
    sa, sb = wm.surprise(a, pics[0]), wm.surprise(b, pics[0])
    assert np.array_equal(sa["net_amp"], sb["net_amp"])           # same seed, same model
    frames = np.array([5, 300, 900])
    E = wm.embed(a, pics[0], frames)
    assert E.shape == (3, wm.emb_width(a)) and np.isnan(E[0]).all() and np.isfinite(E[1:]).all()
    w = wm.window_surprise(sa, frames)
    assert np.isnan(w[0]) and np.isfinite(w[1:]).all()
    p = os.path.join(tmp_path, "wm.pt")
    a.save(p)
    c = wm.WorldModel.load(p)
    assert np.allclose(wm.surprise(c, pics[0])["net_amp"], sa["net_amp"], atol=1e-5)
    assert c.meta["recordings"] == ["synthetic"]
