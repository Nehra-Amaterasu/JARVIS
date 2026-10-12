"""Human-band energy: the motion statistic that sees small movements and nothing
that is not a person (motion.py, HBE)."""
import numpy as np
import pytest

from aankhen.motion import (HBE_RECENT_GATE, _bridge_gaps, _smooth_basis, human_band_energy)

N, SUB = 300, 51


def noise(seed=0, sd=0.03):
    rng = np.random.default_rng(seed)
    return 1.0 + rng.normal(0, sd, (N, SUB))


def smooth_ripple(amp, f_hz=1.0, seed=1):
    """A body-like change: smooth across subcarriers, slow in time."""
    rng = np.random.default_rng(seed)
    pattern = _smooth_basis(SUB) @ rng.normal(0, 1, 6)
    pattern /= np.abs(pattern).max()
    t = np.arange(N) / 100.0
    return amp * np.outer(np.sin(2 * np.pi * f_hz * t), pattern)


def test_white_noise_reads_about_one_whatever_its_level():
    for sd in (0.005, 0.03, 0.1):
        v = [human_band_energy(noise(s, sd)) for s in range(8)]
        assert 0.7 < np.median(v) < 1.6


def test_a_small_slow_smooth_movement_stands_out():
    base = [human_band_energy(noise(s)) for s in range(8)]
    moved = [human_band_energy(noise(s) + smooth_ripple(0.02)) for s in range(8)]
    assert min(moved) > 3 * max(base)


def test_breathing_speed_and_fan_speed_are_outside_the_band():
    """0.2 Hz (breathing) and 15 Hz (a fan's blade-pass) barely register."""
    base = np.median([human_band_energy(noise(s)) for s in range(8)])
    slow = np.median([human_band_energy(noise(s) + smooth_ripple(0.04, 0.2)) for s in range(8)])
    fast = np.median([human_band_energy(noise(s) + smooth_ripple(0.04, 15.0)) for s in range(8)])
    inband = np.median([human_band_energy(noise(s) + smooth_ripple(0.04, 1.0)) for s in range(8)])
    assert slow < 0.2 * inband and fast < 0.2 * inband
    assert fast < 2.5 * base


def test_a_one_sample_step_is_not_a_movement():
    """An uncompensated gain step jumps in one sample; a body cannot."""
    A = noise(3)
    A[150:] += 0.08
    assert human_band_energy(A) < 2.0


def test_a_long_forward_filled_gap_is_bridged_not_held():
    """The resampler repeats the last packet across a gap: one noisy sample held for
    23 slots looked like a 3 cm movement before the bridge."""
    A = noise(4)
    filled = np.zeros(N, bool)
    A[100:123] = A[99] + 0.1            # held, and the held sample was an outlier
    filled[100:123] = True
    assert human_band_energy(A, filled) < 2.0
    C = _bridge_gaps(A @ _smooth_basis(SUB), ~filled)
    assert np.abs(C[100:123] - C[95:99].mean(0)).max() < np.abs(A[100:123] @ _smooth_basis(SUB)
                                                               - C[95:99].mean(0)).max()


def test_mostly_filled_windows_are_refused():
    filled = np.zeros(N, bool)
    filled[::3] = True
    filled[1::3] = True
    assert human_band_energy(noise(5), filled) is None


def test_recent_part_says_whether_the_movement_is_still_going():
    t = np.arange(N) / 100.0
    early = noise(6) + smooth_ripple(0.02) * (t < 1.5)[:, None]
    late = noise(6) + smooth_ripple(0.02) * (t > 1.8)[:, None]
    _, _, rec_early = human_band_energy(early, detail=True)
    _, _, rec_late = human_band_energy(late, detail=True)
    assert rec_late > 3 * HBE_RECENT_GATE and rec_early < HBE_RECENT_GATE


def test_detector_switch_turns_hbe_off(monkeypatch):
    from aankhen.motion import MotionConfig, MotionDetector
    from aankhen.csi import Sample
    monkeypatch.setenv("AANKHEN_HBE", "0")
    det = MotionDetector(MotionConfig())
    r = None
    for k in range(400):
        r = det.push(Sample(k / 100.0, noise(7)[k % N], False)) or r
    assert r.features["hbe"] is None
