"""fan.FanLines.remove_lines: the whole matrix through one cached pseudo-inverse must
give what the per-column least-squares fit gave (council review 2026-10-26)."""
import numpy as np

from aankhen.fan import FS, MIN_LINE_HZ, FanLines


def _per_column_lstsq(lines, x):
    """The notch as it was before 2026-10-26: A rebuilt and one lstsq per series."""
    n = x.size
    t = np.arange(n) / FS
    cols = [np.ones(n)]
    for f in lines:
        if MIN_LINE_HZ <= f < FS / 2 - 0.5:
            w = 2 * np.pi * f * t
            cols += [np.cos(w), np.sin(w)]
    A = np.stack(cols, axis=1)
    coef, *_ = np.linalg.lstsq(A, x, rcond=None)
    return x - A @ coef


def _locked(lines):
    fl = FanLines()
    fl.locked, fl.lines = True, list(lines)
    return fl


def test_matrix_equals_per_column_fit():
    rng = np.random.default_rng(3)
    t = np.arange(300) / FS
    lines = [3.1, 7.7, 11.9, 23.0, 0.5, 49.8]          # the last two are skipped (outside the band)
    C = rng.standard_normal((300, 6)) + 0.4 * np.sin(2 * np.pi * 7.7 * t)[:, None]
    fl = _locked(lines)
    ref = np.stack([_per_column_lstsq(lines, C[:, j]) for j in range(6)], axis=1)
    got = fl.remove_lines(C)
    assert got.shape == C.shape
    assert np.max(np.abs(got - ref)) < 1e-12
    # one series still works, and agrees too
    assert np.max(np.abs(fl.remove_lines(C[:, 2]) - ref[:, 2])) < 1e-12


def test_rank_deficient_lines_are_cut_like_lstsq():
    # two lines a hundredth of a bin apart: A is numerically rank-deficient
    rng = np.random.default_rng(4)
    lines = [5.0, 5.0, 12.25]
    C = rng.standard_normal((256, 3))
    fl = _locked(lines)
    ref = np.stack([_per_column_lstsq(lines, C[:, j]) for j in range(3)], axis=1)
    assert np.max(np.abs(fl.remove_lines(C) - ref)) < 1e-12


def test_cache_follows_the_lines_and_the_length():
    rng = np.random.default_rng(5)
    fl = _locked([4.0, 9.0])
    a = rng.standard_normal((300, 2))
    fl.remove_lines(a)
    fl.lines = [6.0]                                    # a new estimate moved the lines
    assert np.max(np.abs(fl.remove_lines(a) - np.stack(
        [_per_column_lstsq([6.0], a[:, j]) for j in range(2)], axis=1))) < 1e-12
    b = rng.standard_normal(128)                        # a shorter window
    assert np.max(np.abs(fl.remove_lines(b) - _per_column_lstsq([6.0], b))) < 1e-12


def test_unlocked_passes_through():
    x = np.arange(10.0)
    assert np.array_equal(FanLines().remove_lines(x), x)


# ---------------------------------------------------------------- FanDetector (fan on/off)
from aankhen.fan import FanDetector  # noqa: E402

S = 51


def _room(seconds, rng, fan_hz=None, fan_depth=0.08, body=None, walk_hz=None):
    """Synthetic conditioned amplitudes (n, 51) around 1: sensor noise, optionally a fan
    (a blade-pass line and its 2nd harmonic, a different phase and depth per subcarrier,
    speed wandering +-0.5 %), a broadband body (smoothed random motion, below ~3 Hz) or
    a walker (cadence near walk_hz with two harmonics, the cadence wandering)."""
    n = int(seconds * 100)
    t = np.arange(n) / 100.0
    x = 1.0 + 0.01 * rng.standard_normal((n, S))
    if fan_hz is not None:
        f = fan_hz * (1 + 0.005 * np.sin(2 * np.pi * t / 37.0))
        ph = np.cumsum(2 * np.pi * f / 100.0)
        g = fan_depth * rng.uniform(0.3, 1.0, S)
        p1, p2 = rng.uniform(0, 2 * np.pi, S), rng.uniform(0, 2 * np.pi, S)
        x += g * np.sin(ph[:, None] + p1) + 0.5 * g * np.sin(2 * ph[:, None] + p2)
    if body is not None:
        w = rng.standard_normal((n, S)).cumsum(axis=0)
        w = np.apply_along_axis(lambda c: np.convolve(c, np.ones(30) / 30, "same"), 0, w)
        w -= np.apply_along_axis(lambda c: np.convolve(c, np.ones(500) / 500, "same"), 0, w)
        x *= np.exp(body * w / (np.abs(w).max() + 1e-9))
    if walk_hz is not None:
        f = walk_hz + 0.15 * np.sin(2 * np.pi * t / 7.0)
        ph = np.cumsum(2 * np.pi * f / 100.0)
        g = rng.uniform(0.05, 0.2, S)
        x += sum(g / k * np.sin(k * ph[:, None] + k) for k in (1, 2, 3))
    return np.maximum(x, 1e-3)


def _run(det, amps):
    states = []
    for a in amps:
        r = det.push(a)
        if r is not None:
            states.append(r["fan"])
    return states


def test_a_running_fan_reads_on_and_never_flaps():
    rng = np.random.default_rng(11)
    det = FanDetector()
    states = _run(det, _room(150, rng, fan_hz=9.08))
    assert states[0] == "unknown"                          # no decision before the evidence exists
    assert states[-1] == "on" and det.on is True
    assert det.changes == 1                                # unknown -> on, nothing after
    assert states.index("on") * 0.5 <= 60.0                # 10 s of history + ~30 s of average
    r = det.reading()
    assert set(r) == {"fan", "confidence", "line_hz", "evidence"}
    assert min(abs(r["line_hz"] - 9.08), abs(r["line_hz"] - 18.16)) < 0.5
    assert r["confidence"] > 0.8


def test_a_quiet_room_and_a_moving_body_never_read_on():
    rng = np.random.default_rng(12)
    for amps in (_room(150, rng), _room(150, rng, body=0.3)):
        det = FanDetector()
        states = _run(det, amps)
        assert "on" not in states
        assert states[-1] == "off"


def test_walking_cadence_and_its_harmonics_are_not_a_fan():
    # a walker's ~2 Hz steps put harmonics at 4 and 6 Hz; a real cadence wanders, and
    # nothing below LINE_MIN_HZ is ever counted
    rng = np.random.default_rng(13)
    assert "on" not in _run(FanDetector(), _room(150, rng, walk_hz=1.9))


def test_hysteresis_switches_once_each_way_with_the_designed_delays():
    rng = np.random.default_rng(14)
    det = FanDetector()
    assert _run(det, _room(120, rng, fan_hz=15.4))[-1] == "on"
    off = _run(det, _room(150, rng))
    assert off[-1] == "off"
    assert det.changes == 2                                # unknown -> on -> off
    assert 40.0 <= off.index("off") * 0.5 <= 90.0          # a switched-off fan takes ~1 min, never a blink


def test_a_minute_of_walking_under_the_fan_does_not_drop_it():
    rng = np.random.default_rng(15)
    det = FanDetector()
    _run(det, _room(120, rng, fan_hz=9.08))
    assert set(_run(det, _room(60, rng, fan_hz=9.08, body=0.5))) == {"on"}


def test_a_channel_change_keeps_the_decision():
    rng = np.random.default_rng(16)
    det = FanDetector()
    _run(det, _room(120, rng, fan_hz=9.08))
    det.restart()
    assert det.state == "on"
    assert set(_run(det, _room(30, rng, fan_hz=9.08))) == {"on"}


def test_the_comb_lock_counts_as_evidence():
    # FanLines' comb lock (how the 10-12 full-speed fan showed best) is enough on its own
    rng = np.random.default_rng(17)
    det = FanDetector()
    for a in _room(80, rng):
        det.push(a, comb_locked=True)
    assert det.state == "on"


def test_wrong_length_samples_are_ignored():
    det = FanDetector()
    assert det.push(np.ones(10)) is None
    assert det.state == "unknown" and det.reading()["evidence"] is None
