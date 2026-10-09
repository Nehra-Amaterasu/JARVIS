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


def test_wifi_motion_cannot_create_occupancy_against_an_empty_radar():
    """Someone pacing by the router, outside the room: the radar sees nobody, so the
    Wi-Fi motion must not make the room 'occupied' (100 % false occupied before)."""
    f = PresenceFusion()
    hallway = Evidence(radar_live=True, csi_live=True, csi_state=STATE_MOTION)
    _run(f, hallway, 0, 30)
    assert f.state() == "empty"


def test_wifi_motion_holds_an_occupied_room_for_a_while_then_lets_go():
    """Someone walks into a corner the radar cannot see and keeps moving: Wi-Fi holds
    the belief for csi_sustain_s, then the slow absence term runs again."""
    f = PresenceFusion(FusionConfig(csi_sustain_s=60.0))
    t = _run(f, Evidence(radar_live=True, n_moving=1), 0, 5)
    corner = Evidence(radar_live=True, csi_live=True, csi_state=STATE_MOTION)
    t = _run(f, corner, t, 55)
    assert f.state() == "moving"
    _run(f, corner, t, 90)
    assert f.state() == "empty"


def test_wifi_keeps_full_weight_without_a_radar():
    f = PresenceFusion()
    _run(f, Evidence(csi_live=True, csi_state=STATE_MOTION), 0, 3)
    assert f.state() == "moving"


def test_a_long_empty_spell_does_not_make_the_next_entry_slow():
    f = PresenceFusion()
    t = _run(f, Evidence(radar_live=True, csi_live=True, csi_state=STATE_QUIET), 0, 600)
    assert f.L >= -f.cfg.clamp_empty
    _run(f, Evidence(radar_live=True, n_moving=1), t, 1.3)
    assert f.state() != "empty"


def test_someone_walking_in_through_the_door_is_at_once_not_empty():
    f = PresenceFusion()
    t = _run(f, Evidence(radar_live=True, csi_live=True, csi_state=STATE_QUIET), 0, 300)
    assert f.state() == "empty"
    f.entry_observed(t)
    f.update(t + 0.1, Evidence(radar_live=True, n_moving=1))
    assert f.state() != "empty"


def test_breathing_holds_an_occupied_room_but_never_creates_one():
    held = PresenceFusion()
    t = _run(held, Evidence(radar_live=True, n_still=1), 0, 10)
    sleeper = Evidence(radar_live=True, csi_live=True, csi_state=STATE_QUIET, breathing=True)
    _run(held, sleeper, t, 600)                    # the radar lost them; they keep breathing
    assert held.state() == "still"

    empty = PresenceFusion()
    _run(empty, sleeper, 0, 600)                   # 'breathing' in a room nobody entered
    assert empty.state() == "empty"


def test_breathing_is_ignored_after_a_walk_out():
    f = PresenceFusion()
    t = _run(f, Evidence(radar_live=True, n_moving=1), 0, 10)
    f.exit_observed(t, tracks_remaining=0)
    _run(f, Evidence(radar_live=True, csi_live=True, csi_state=STATE_QUIET, breathing=True), t, 100)
    assert f.state() == "empty"
