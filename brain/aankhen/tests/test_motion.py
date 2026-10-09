"""Motion detector tests — SYNTHETIC DATA. Read this before trusting a pass.

Every signal here comes from a simple model I wrote (synthetic_csi below): a fixed
per-subcarrier multipath profile, small Gaussian noise for an empty room, and
time-varying modulation for a moving body. Passing proves the DETECTOR LOGIC does
what it was designed to do — calibration, threshold, hysteresis, hold, adaptation.

It does NOT prove the detector works on real CSI. Real captures contain things this
model lacks: automatic-gain jumps, router rate changes, interference, neighbours'
traffic. Real-world accuracy is only established by the benchmark on labelled
recordings from the actual room (`python -m aankhen bench`), and those recordings
are meant to become regression tests alongside these.
"""
import numpy as np
import pytest

from aankhen.csi import Sample
from aankhen.motion import (
    STATE_MOTION, STATE_QUIET, STATE_RECENT, STATE_UNCALIBRATED, Baseline,
    BreathingEstimator, Calibrator, MotionConfig, MotionDetector, turbulence,
)

HZ = 100.0


def synthetic_csi(seconds, moving=False, seed=0, t0=0.0, breathing_bpm=None,
                  noise=0.02, body_mod=0.25, body_hz=1.2):
    """Generate normalised 51-subcarrier amplitudes (SYNTHETIC MODEL)."""
    rng = np.random.default_rng(seed)
    base = 1.0 + 0.3 * np.sin(np.linspace(0, 3 * np.pi, 51))       # multipath profile
    phases = rng.uniform(0, 2 * np.pi, 51)
    for i in range(int(seconds * HZ)):
        t = t0 + i / HZ
        amp = base * (1 + rng.normal(0, noise, 51))
        if moving:
            amp = amp * (1 + body_mod * np.sin(2 * np.pi * body_hz * t + phases)
                         * rng.uniform(0.5, 1.0))
        if breathing_bpm:
            amp = amp * (1 + 0.03 * np.sin(2 * np.pi * breathing_bpm / 60 * t + phases))
        yield Sample(t, amp / np.median(amp), False)


def _run(det, samples):
    return [r for s in samples for r in [det.push(s)] if r is not None]


def _calibrated(seed=0):
    cfg = MotionConfig()
    cal, det = Calibrator(cfg), MotionDetector(cfg)
    for r in _run(det, synthetic_csi(65, seed=seed)):
        cal.add(r.features["mvs"])
    return MotionDetector(cfg, cal.finish())


# ------------------------------------------------------------ calibration
def test_calibration_refuses_short_capture():
    cfg = MotionConfig()
    cal, det = Calibrator(cfg), MotionDetector(cfg)
    for r in _run(det, synthetic_csi(20)):
        cal.add(r.features["mvs"])
    with pytest.raises(RuntimeError):
        cal.finish()


def test_uncalibrated_detector_makes_no_decisions():
    det = MotionDetector(MotionConfig())
    out = _run(det, synthetic_csi(10, moving=True))
    assert out and all(r.state == STATE_UNCALIBRATED for r in out)
    assert all(r.score is None for r in out)


def test_auto_baseline_is_labelled_and_confidence_reduced():
    det = MotionDetector(MotionConfig())
    out = _run(det, list(synthetic_csi(31)) + list(synthetic_csi(10, moving=True, t0=31)))
    decided = [r for r in out if r.state != STATE_UNCALIBRATED]
    assert decided and all(r.baseline_source == "auto" for r in decided)
    assert max(r.confidence for r in decided) <= 0.7


def test_baseline_round_trip(tmp_path):
    b = Baseline(1e-4, 3e-4, 240)
    b.save(str(tmp_path / "b.json"))
    assert Baseline.load(str(tmp_path / "b.json")).q_hi == 3e-4


# ------------------------------------------------------------ detection
def test_empty_room_produces_no_false_alarms_over_5_minutes():
    det = _calibrated()
    out = _run(det, synthetic_csi(300, seed=42, t0=100))
    assert not any(r.state == STATE_MOTION for r in out)


def test_motion_is_detected_within_1_5_seconds():
    det = _calibrated()
    _run(det, synthetic_csi(5, t0=100, seed=3))
    out = _run(det, synthetic_csi(5, moving=True, t0=105, seed=4))
    first = next(r.t for r in out if r.state == STATE_MOTION)
    assert first - 105 <= 1.5


def test_score_is_in_units_of_the_empty_room_level():
    det = _calibrated()
    out = _run(det, synthetic_csi(5, moving=True, t0=100, seed=5))
    moving = [r for r in out if r.state == STATE_MOTION]
    assert moving and moving[-1].score > moving[-1].threshold > 1.0


def test_glitch_rejected_by_hampel_not_hysteresis():
    """One corrupted packet must not read as motion.

    The first version of this test assumed hysteresis did that job. It can't:
    windows overlap, so a single bad sample appears in four consecutive windows.
    The protection is the Hampel stage, so the test runs the real chain.
    """
    from aankhen.csi import HampelFilter
    seq = list(synthetic_csi(4, t0=100, seed=6))
    spiked = seq[200].amp.copy()
    spiked[::3] *= 4.0                          # one corrupted packet
    seq[200] = Sample(seq[200].t, spiked, False)

    raw_det = _calibrated()                     # without Hampel: it DOES trigger
    assert any(r.state == STATE_MOTION for r in _run(raw_det, seq))

    det, hampel = _calibrated(), HampelFilter(7, 5.0)
    cleaned = [c for s in seq for c in [hampel.push(s)] if c is not None]
    assert not any(r.state == STATE_MOTION for r in _run(det, cleaned))


def test_brief_real_movement_is_reported():
    det = _calibrated()
    seq = list(synthetic_csi(3, t0=100, seed=6)) + \
        list(synthetic_csi(0.3, moving=True, t0=103, seed=7)) + \
        list(synthetic_csi(3, t0=103.3, seed=8))
    assert any(r.state == STATE_MOTION for r in _run(det, seq))


def test_motion_then_recent_then_quiet_never_empty():
    cfg = MotionConfig(hold_s=10.0)
    base = _calibrated().baseline
    det = MotionDetector(cfg, base)
    _run(det, synthetic_csi(4, moving=True, t0=100, seed=9))
    out = _run(det, synthetic_csi(20, t0=104, seed=10))
    states = [r.state for r in out]
    assert STATE_RECENT in states and states[-1] == STATE_QUIET
    # The detector never claims the room is empty — a still person looks quiet.
    assert all(s in (STATE_MOTION, STATE_RECENT, STATE_QUIET) for s in states)
    assert "still person" in out[-1].reason


def test_turbulence_is_gain_invariant():
    a = np.linspace(0.5, 1.5, 51)
    assert turbulence(a) == pytest.approx(turbulence(a * 4.2))


# ------------------------------------------------------------ breathing
def test_breathing_is_estimated_when_signal_is_strong():
    est = BreathingEstimator()
    for s in synthetic_csi(62, breathing_bpm=15, noise=0.005, seed=11):
        est.push(s)
    r = est.estimate(STATE_QUIET)
    assert r.bpm is not None and abs(r.bpm - 15) <= 1.5


def test_breathing_refuses_without_a_clear_signal():
    """Pure noise must not produce a breathing rate — checked across 10 seeds.

    The first threshold (SNR 4) was below the noise floor and reported 10
    breaths/min from noise alone. One seed is not evidence; ten is a start.
    """
    false_estimates = 0
    for seed in range(10):
        est = BreathingEstimator()
        for s in synthetic_csi(62, noise=0.02, seed=100 + seed):
            est.push(s)
        false_estimates += est.estimate(STATE_QUIET).bpm is not None
    assert false_estimates == 0


def test_breathing_never_estimated_while_moving():
    est = BreathingEstimator()
    for s in synthetic_csi(62, breathing_bpm=15, noise=0.005, seed=13):
        est.push(s)
    assert est.estimate(STATE_MOTION).bpm is None
