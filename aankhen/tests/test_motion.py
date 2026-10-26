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


def _run_with_radar(det, samples, radar_empty_from=None):
    out = []
    for s in samples:
        det.radar_empty_s = None if radar_empty_from is None else s.t - radar_empty_from
        r = det.push(s)
        if r is not None:
            out.append(r)
    return out


def test_a_radar_confirmed_empty_room_unfreezes_the_baseline():
    """The room got noisier (here: 3x the noise — on the simulator, a channel
    drifting through a subcarrier null did 27x). Quiet-only adaptation deadlocks:
    the noise reads as motion and motion freezes it. With the radar live and empty
    for a minute, the baseline follows."""
    noisy = lambda secs, t0, seed: synthetic_csi(secs, t0=t0, seed=seed, noise=0.06)
    stuck = _calibrated()
    out = _run_with_radar(stuck, noisy(180, 100, 11))
    assert out[-1].state == STATE_MOTION                      # never adapts

    freed = _calibrated()
    out = _run_with_radar(freed, noisy(180, 100, 11), radar_empty_from=100.0)
    assert out[-1].state != STATE_MOTION
    assert freed.baseline.median <= freed._calibrated[freed.context].median * freed.cfg.radar_adapt_cap


def test_radar_gated_adaptation_is_capped():
    det = _calibrated()
    _run_with_radar(det, synthetic_csi(100, t0=100, seed=12, moving=True, body_mod=0.6),
                    radar_empty_from=100.0)
    cal = det._calibrated[det.context]
    assert det.baseline.median <= cal.median * det.cfg.radar_adapt_cap * (1 + 1e-9)
    assert det.baseline.q_hi <= cal.q_hi * det.cfg.radar_adapt_cap * (1 + 1e-9)


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


# ------------------------------------------------------------ respiration (presence)
def test_respiration_detector_finds_breathing_and_refuses_noise():
    from aankhen.motion import RespirationDetector
    cal = RespirationDetector()
    for s in synthetic_csi(70, noise=0.02, seed=31):
        cal.push(s)
    floor = float(np.median(cal.stats))
    still = RespirationDetector(floor=floor)
    for s in synthetic_csi(70, breathing_bpm=14, noise=0.02, seed=32):
        still.push(s)
    assert still.last.present and abs(still.last.bpm - 14) <= 2.5
    false = 0
    for seed in range(40, 46):
        empty = RespirationDetector(floor=floor)
        for s in synthetic_csi(70, noise=0.02, seed=seed):
            empty.push(s)
        false += empty.last.present
    assert false == 0


def test_respiration_waits_out_movement():
    from aankhen.motion import RespirationDetector
    d = RespirationDetector(floor=1.0)
    for s in synthetic_csi(40, breathing_bpm=14, noise=0.02, seed=33):
        d.note_motion(s.t)                         # someone was moving the whole time
        d.push(s)
    assert not d.last.present and d.stats == []


# ------------------------------------------------------------ ceiling fan lines
def test_fan_lines_lock_and_their_removal_leaves_the_noise():
    from aankhen.fan import FanLines
    rng = np.random.default_rng(7)
    t = np.arange(4000) / 100.0
    fan = sum(0.02 / k * np.sin(2 * np.pi * (11.3 * k) * t + k) for k in range(1, 5))
    x = 0.1 + fan + rng.normal(0, 0.003, t.size)
    fl = FanLines()
    for v in x:
        fl.push(v)
    assert fl.locked and abs(fl.f0 - 11.3) < 0.3
    w = x[-100:]
    assert fl.residual_variance(w) < 1.5 * 0.003 ** 2 < w.var()


def test_broadband_movement_is_not_a_fan():
    from aankhen.fan import FanLines
    rng = np.random.default_rng(8)
    x = 0.1 + np.cumsum(rng.normal(0, 0.002, 4000))   # wandering, aperiodic
    fl = FanLines()
    for v in x:
        fl.push(v)
    assert not fl.locked


# ------------------------------------------------- shared HBE cleaning (2026-10-26)
def _hbe_before_sharing(amps, filled=None, rate_hz=100.0, band=(0.4, 4.0), fan=None, detail=False):
    """human_band_energy exactly as it was before the cleaning was shared between bands
    (council review 2026-10-26), fan lines removed one column at a time with lstsq."""
    from aankhen.fan import FS, MIN_LINE_HZ
    from aankhen.motion import (HBE_MIN_REAL, HBE_RECENT_S, HBE_STEP_SIGMA, _bridge_gaps,
                                _smooth_basis)
    A = np.asarray(amps, float)
    n = A.shape[0]
    real = np.ones(n, bool) if filled is None else ~np.asarray(filled, bool)
    if n < 16 or real.mean() < HBE_MIN_REAL:
        return None
    C = A @ _smooth_basis(A.shape[1])
    if not real.all():
        C = _bridge_gaps(C, real)
    t = np.arange(n) - (n - 1) / 2.0
    C = C - C.mean(axis=0)
    C = C - np.outer(t, (t @ C) / (t @ t))
    if fan is not None and fan.locked and fan.lines:
        tt = np.arange(n) / FS
        cols = [np.ones(n)]
        for f in fan.lines:
            if MIN_LINE_HZ <= f < FS / 2 - 0.5:
                w = 2 * np.pi * f * tt
                cols += [np.cos(w), np.sin(w)]
        M = np.stack(cols, axis=1)
        C = np.stack([C[:, j] - M @ np.linalg.lstsq(M, C[:, j], rcond=None)[0]
                      for j in range(C.shape[1])], axis=1)
    pair = real[1:] & real[:-1]
    if pair.sum() < 8:
        return None
    D = np.diff(C, axis=0)
    d = D[pair]
    med = np.median(d, axis=0)
    sd = np.maximum(1.4826 * np.median(np.abs(d - med), axis=0), 1e-12)
    sigma2 = sd ** 2 / 2.0
    jump = np.abs(D - med) > HBE_STEP_SIGMA * sd
    if jump.any():
        D = np.where(jump, med, D)
        C = np.vstack([np.zeros((1, C.shape[1])), np.cumsum(D, axis=0)])
        C = C - C.mean(axis=0)
        C = C - np.outer(t, (t @ C) / (t @ t))
    w = np.hanning(n)
    X = np.fft.rfft(C * w[:, None], axis=0)
    f = np.fft.rfftfreq(n, 1.0 / rate_hz)
    sel = (f >= band[0]) & (f <= band[1])
    if not sel.any():
        return None
    p = (np.abs(X[sel]) ** 2).mean(axis=0) / (sigma2 * float(w @ w))
    if not detail:
        return float(p.mean())
    Y = np.fft.rfft(C, axis=0)
    Y[~sel] = 0.0
    y = np.fft.irfft(Y, n=n, axis=0)
    k = max(2, int(round(HBE_RECENT_S * rate_hz)))
    frac = sel.sum() / len(f)
    recent = float(((y[-k:] ** 2).mean(axis=0) / (sigma2 * frac)).mean())
    return float(p.mean()), p, recent


def _awkward_window(seed=7):
    """3 s of moving CSI with a 12-sample gap, two lone filled samples and a gain step."""
    A = np.stack([s.amp for s in synthetic_csi(3.0, moving=True, seed=seed)])
    A[150:] *= 1.04
    filled = np.zeros(len(A), bool)
    filled[40:52] = True
    filled[[200, 260]] = True
    idx = np.flatnonzero(filled)
    for i in idx:
        A[i] = A[i - 1]                                 # the resampler forward-fills
    return A, filled


@pytest.mark.parametrize("fan_lines", [None, [3.1, 7.7, 11.9, 23.0]])
def test_shared_hbe_window_equals_one_call_per_band(fan_lines):
    from aankhen.fan import FanLines
    from aankhen.learn import SUB_BANDS
    from aankhen.motion import HBE_BAND_HZ, hbe_window, human_band_energy
    A, filled = _awkward_window()
    fan = None
    if fan_lines:
        fan = FanLines()
        fan.locked, fan.lines = True, list(fan_lines)
    tol = 0.0 if fan is None else 1e-12          # pinv vs lstsq differ by rounding only
    hw = hbe_window(A, filled, fan=fan)
    v, p, rec = hw.energy(HBE_BAND_HZ, detail=True)
    v0, p0, rec0 = _hbe_before_sharing(A, filled, fan=fan, detail=True)
    assert np.allclose([v, rec], [v0, rec0], rtol=tol, atol=0)
    assert np.allclose(p, p0, rtol=tol, atol=0)
    for band in SUB_BANDS:
        new = hw.energy(band)
        assert np.isclose(new, _hbe_before_sharing(A, filled, band=band, fan=fan), rtol=tol, atol=0)
        assert human_band_energy(A, filled, band=band, fan=fan) == new
    assert hw.energy((60.0, 70.0)) is None                  # no bin in the band
    many = np.zeros(len(A), bool)
    many[:100] = True                                       # a third filled: no window, as before
    assert hbe_window(A, many) is None and _hbe_before_sharing(A, many) is None
