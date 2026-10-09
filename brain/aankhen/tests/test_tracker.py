"""Tracker tests with known ground truth: we generate the true paths, add realistic
radar noise, and check the tracker recovers them."""
import math

import numpy as np

from aankhen.tracker import MultiTargetTracker, TrackerConfig

HZ = 10.0           # LD2450 reports at roughly 10 Hz


def _walk(start, vel, n, t0=0.0):
    return [(t0 + i / HZ, start[0] + vel[0] * i / HZ, start[1] + vel[1] * i / HZ)
            for i in range(n)]


def test_single_person_is_tracked_and_smoothed():
    rng = np.random.default_rng(0)
    tr = MultiTargetTracker()
    truth = _walk((0.5, 0.5), (0.6, 0.3), 60)
    raw_err, trk_err = [], []
    for t, x, y in truth:
        zx, zy = x + rng.normal(0, 0.15), y + rng.normal(0, 0.15)
        tracks = tr.step([(zx, zy)], t)
        if t > 1.0 and tracks:
            px, py = tracks[0].position
            trk_err.append(math.hypot(px - x, py - y))
            raw_err.append(math.hypot(zx - x, zy - y))
    assert len(tr.confirmed()) == 1
    # The filter must beat the raw radar readings it was given.
    assert np.mean(trk_err) < 0.8 * np.mean(raw_err)


def test_velocity_is_unbiased_and_noise_is_bounded():
    """Check bias and noise separately, across many seeds.

    The first version of this test asserted on ONE velocity reading and failed on
    a 2-sigma outlier. Measured over 30 seeds the estimate is unbiased (about
    -0.005 m/s) with ~0.16 m/s per-reading noise at the default accel_std, so the
    right test is: the mean is close to truth, and the spread stays bounded.
    """
    biases, spreads = [], []
    for seed in range(20):
        rng = np.random.default_rng(seed)
        tr = MultiTargetTracker()
        vx_samples = []
        for i in range(80):
            t = i / HZ
            x, y = 0.5 + 0.6 * t, 0.5 + 0.3 * t
            tracks = tr.step([(x + rng.normal(0, 0.15), y + rng.normal(0, 0.15))], t)
            if t > 2.0 and tracks:
                vx_samples.append(tracks[0].velocity[0])
        biases.append(np.mean(vx_samples) - 0.6)
        spreads.append(np.std(vx_samples))
    assert abs(np.mean(biases)) < 0.05          # unbiased
    assert np.mean(spreads) < 0.25              # bounded per-reading noise


def test_single_frame_ghost_is_never_confirmed():
    tr = MultiTargetTracker()
    shown = []
    for i in range(20):
        dets = [(1.0, 1.0)]
        if i == 7:
            dets.append((3.5, 3.5))              # one-frame multipath ghost
        shown.append(len(tr.step(dets, i / HZ)))
    assert max(shown) == 1


def test_needs_m_of_n_hits_to_confirm():
    tr = MultiTargetTracker(TrackerConfig(confirm_hits=3, confirm_window=5))
    assert tr.step([(1, 1)], 0.0) == []
    assert tr.step([(1, 1)], 0.1) == []
    assert len(tr.step([(1, 1)], 0.2)) == 1     # third hit confirms


def test_two_people_crossing_keep_their_ids():
    tr = MultiTargetTracker()
    a = _walk((0.5, 2.0), (1.0, 0.0), 40)       # left -> right
    b = _walk((3.5, 2.2), (-1.0, 0.0), 40)      # right -> left, 20 cm apart
    ids_at_start = ids_at_end = None
    for (t, ax, ay), (_, bx, by) in zip(a, b):
        tracks = tr.step([(ax, ay), (bx, by)], t)
        if len(tracks) == 2:
            by_x = sorted(tracks, key=lambda k: k.position[0])
            if ids_at_start is None and t > 0.5:
                ids_at_start = (by_x[0].id, by_x[1].id)      # (left one, right one)
            ids_at_end = (by_x[0].id, by_x[1].id)
    # They swapped sides, so the left-most id at the end must be the one that
    # started on the right.
    assert ids_at_start is not None and ids_at_end == ids_at_start[::-1]


def test_track_coasts_through_short_dropout_then_dies():
    cfg = TrackerConfig(max_coast_s=1.0)
    tr = MultiTargetTracker(cfg)
    for i in range(10):
        tr.step([(1.0 + 0.05 * i, 1.0)], i / HZ)
    tid = tr.confirmed()[0].id
    for i in range(10, 15):                      # 0.5 s with no detection
        assert [t.id for t in tr.step([], i / HZ)] == [tid]
    for i in range(15, 30):
        out = tr.step([], i / HZ)
    assert out == []


def test_confidence_decays_while_coasting():
    cfg = TrackerConfig(max_coast_s=1.0)
    tr = MultiTargetTracker(cfg)
    for i in range(5):
        tr.step([(1.0, 1.0)], i / HZ)
    t = tr.confirmed()[0]
    c_fresh = t.confidence(0.4, cfg)
    tr.step([], 0.9)
    assert t.confidence(0.9, cfg) < c_fresh


def test_absurd_speed_is_clamped():
    tr = MultiTargetTracker(TrackerConfig(max_speed=3.0, gate_chi2=1e9, gate_euclid_m=1e9))
    for i in range(5):
        tr.step([(1.0, 1.0)], i / HZ)
    tr.step([(9.0, 1.0)], 0.5)                   # teleport 8 m in 0.1 s
    assert tr.confirmed()[0].speed <= 3.0 + 1e-9


def test_covariance_stays_symmetric_positive_definite():
    rng = np.random.default_rng(1)
    tr = MultiTargetTracker()
    for i in range(200):
        tr.step([(2 + rng.normal(0, 0.15), 2 + rng.normal(0, 0.15))], i / HZ)
    P = tr.confirmed()[0].P
    assert np.allclose(P, P.T, atol=1e-9)
    assert np.all(np.linalg.eigvalsh(P) > 0)


# ------------------------------------------------------------------ still mode
def _settle(tr, x, y, seconds, t0=0.0):
    """Feed a stationary person for `seconds`; returns the end time."""
    n = int(seconds * HZ)
    for i in range(n):
        tr.step([(x, y)], t0 + i / HZ)
    return t0 + n / HZ


def test_seated_person_survives_radar_dropout():
    """The LD2450 loses still people. A seated track must not vanish after 1 s."""
    tr = MultiTargetTracker()
    t = _settle(tr, 1.0, 1.0, 3.0)                 # 3 s still -> still mode
    assert tr.confirmed()[0].still
    for i in range(1, 100):                        # 10 s of radar silence
        out = tr.step([], t + i / HZ)
    assert len(out) == 1


def test_still_track_reattaches_instead_of_new_identity():
    tr = MultiTargetTracker()
    t = _settle(tr, 1.0, 1.0, 3.0)
    tid = tr.confirmed()[0].id
    for i in range(1, 50):
        tr.step([], t + i / HZ)
    t += 5.0
    for i in range(6):                             # reappears 0.6 m away
        out = tr.step([(1.6, 1.0)], t + i / HZ)
    assert [k.id for k in out] == [tid]


def test_still_track_eventually_expires():
    tr = MultiTargetTracker(TrackerConfig(still_hold_s=5.0))
    t = _settle(tr, 1.0, 1.0, 3.0)
    for i in range(1, 70):
        out = tr.step([], t + i / HZ)
    assert out == []


def test_euclidean_cap_blocks_far_association():
    tr = MultiTargetTracker()
    _settle(tr, 1.0, 1.0, 1.0)
    tid = tr.confirmed()[0].id
    tr.step([(3.0, 1.0)], 1.0)                     # 2 m jump: beyond the 1.2 m cap
    assert tr.confirmed()[0].id == tid
    assert tr.confirmed()[0].position[0] < 1.5     # the far detection did not pull it
