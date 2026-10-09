"""End-to-end regression — SYNTHETIC DATA. Read this before trusting a pass.

Simulated wire bytes go through the real decoder, conditioner, detector, tracker,
occupancy map and fusion, and the result is scored against the simulator's ground
truth by bench.py. The thresholds sit just inside what the pipeline measured when
these tests were written (see docs/DECISIONS.md), so a change that makes things
worse fails here.

Passing proves the pipeline is internally consistent with the simulator's physics.
It does NOT prove real-world accuracy; that comes from `python -m aankhen bench` on
labelled recordings of the real room, which are meant to join these tests.
"""
import pytest

from aankhen.bench import bench_simulation, simulated_baseline


@pytest.fixture(scope="module")
def baseline():
    return simulated_baseline()


def test_evening_presence_and_tracking(baseline):
    r = bench_simulation("evening", seconds=120, seed=1, baseline=baseline)
    assert r.presence_accuracy >= 0.95
    assert r.false_empty_rate <= 0.02          # never turn the lights off on someone
    assert r.false_occupied_rate <= 0.08
    assert r.position_error_m <= 0.10
    assert r.position_error_p90_m <= 0.30
    assert r.id_switches <= 3
    assert r.motion_latency_s <= 1.0


def test_still_person_is_neither_lost_nor_called_moving(baseline):
    r = bench_simulation("still", seconds=60, seed=2, baseline=baseline)
    assert r.false_empty_rate == 0.0
    assert r.motion_false_alarm <= 0.02
    assert r.id_switches == 0
    assert r.position_error_m <= 0.10          # posture-aware projection at the desk


def test_empty_room_never_reports_anyone(baseline):
    r = bench_simulation("empty", seconds=90, seed=3, baseline=baseline)
    assert r.false_occupied_rate == 0.0
    assert r.wifi_motion_false_alarm == 0.0
