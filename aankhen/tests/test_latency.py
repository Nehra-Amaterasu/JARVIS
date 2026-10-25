"""Motion onset latency (2026-10-25): the hysteresis alone must hold an onset <= 0.4 s."""
from aankhen.motion import MotionConfig, STATE_MOTION
from aankhen.tools.latency import onset_latencies


def test_default_hysteresis_holds_onset_under_0_4_s():
    c = MotionConfig()
    # an onset waits at most one hop for the next evaluation, then on_count - 1 more hops
    assert c.hop_s * c.on_count <= 0.4
    # the release stays ~0.75 s, as before, so stop lag does not grow or shrink
    assert 0.7 <= c.hop_s * c.off_count <= 0.9


def test_onset_latencies_first_motion_inside_each_segment():
    states = [(0.0, "quiet"), (10.2, "quiet"), (10.5, STATE_MOTION), (30.0, STATE_MOTION)]
    segs = [{"start_host": 10.0, "end_host": 20.0}, {"start_host": 40.0, "end_host": 50.0}]
    assert [round(x, 2) for x in onset_latencies(states, segs)] == [0.5]
