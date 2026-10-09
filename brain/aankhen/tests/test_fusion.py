"""Presence fusion: each rule here exists because the benchmark caught its absence."""
from aankhen.fusion import Evidence, FusionConfig, PresenceFusion
from aankhen.motion import STATE_MOTION, STATE_QUIET, STATE_RECENT


def _run(f, ev, t0, seconds, dt=0.1):
    t = t0
    while t < t0 + seconds - 1e-9:
        t += dt
        f.update(t, ev)
    return t


def test_no_sensor_means_no_data_not_empty():
    f = PresenceFusion()
    _run(f, Evidence(), 0, 5)
    assert f.state() == "no data"


def test_moving_radar_track_is_occupied_within_a_second():
    f = PresenceFusion()
    _run(f, Evidence(radar_live=True, n_moving=1), 0, 1.0)
    assert f.state() == "moving" and f.p > 0.9


def test_still_person_is_not_dropped_quickly():
    """Radar holds a still track; belief must stay occupied for a long time."""
    f = PresenceFusion()
    t = _run(f, Evidence(radar_live=True, n_moving=1), 0, 3)
    t = _run(f, Evidence(radar_live=True, n_still=1, csi_live=True, csi_state=STATE_QUIET), t, 120)
    assert f.state() == "still"


def test_absence_alone_is_slow():
    """Radar empty + Wi-Fi quiet must take tens of seconds, not seconds, to say empty."""
    f = PresenceFusion()
    t = _run(f, Evidence(radar_live=True, n_moving=1), 0, 5)
    quiet = Evidence(radar_live=True, csi_live=True, csi_state=STATE_QUIET)
    t2 = _run(f, quiet, t, 30)
    assert f.state() != "empty"
    _run(f, quiet, t2, 60)
    assert f.state() == "empty"


def test_exit_through_the_door_empties_the_room_at_once():
    f = PresenceFusion()
    t = _run(f, Evidence(radar_live=True, n_moving=1), 0, 10)       # saturated
    f.exit_observed(t, tracks_remaining=0)
    f.update(t + 0.1, Evidence(radar_live=True, csi_live=True, csi_state=STATE_RECENT))
    assert f.state() == "empty"


def test_exit_with_someone_still_tracked_changes_nothing():
    f = PresenceFusion()
    t = _run(f, Evidence(radar_live=True, n_moving=2), 0, 10)
    before = f.L
    f.exit_observed(t, tracks_remaining=1)
    assert f.L == before


def test_recent_wifi_motion_does_not_hold_the_belief_up():
    """The 90 s 'recent' window is memory, not evidence (98.7 % false occupied before)."""
    f = PresenceFusion()
    t = _run(f, Evidence(radar_live=True, n_moving=1, csi_live=True, csi_state=STATE_MOTION), 0, 5)
    _run(f, Evidence(radar_live=True, csi_live=True, csi_state=STATE_RECENT), t, 90)
    assert f.state() == "empty"


def test_auto_baseline_wifi_counts_for_less():
    a, b = PresenceFusion(), PresenceFusion()
    _run(a, Evidence(csi_live=True, csi_state=STATE_MOTION), 0, 1)
    _run(b, Evidence(csi_live=True, csi_state=STATE_MOTION, csi_auto_baseline=True), 0, 1)
    assert a.L > b.L > 0


def test_belief_is_clamped():
    f = PresenceFusion(FusionConfig(clamp=8.0))
    _run(f, Evidence(radar_live=True, n_moving=3), 0, 60)
    assert f.L <= 8.0
