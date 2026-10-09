"""End-to-end regression — SYNTHETIC DATA. Read this before trusting a pass.

Simulated wire bytes go through the real decoder, conditioner, detector, tracker,
occupancy map and fusion, and the result is scored against the simulator's ground
truth by bench.py. Every assertion is on the WORST of several seeds: the first
version of this file pinned seed 1 alone, and seed 3 of the same scenario read an
empty room as occupied 53 % of the time (a duplicate track; see tracker.py).

The bounds sit just inside what the pipeline measured on these seeds when they
were written, so a change that makes things worse fails here. Runs go in
parallel processes to keep this file well under a minute.

Passing proves the pipeline is internally consistent with the simulator's physics.
It does NOT prove real-world accuracy; that comes from `python -m aankhen bench` on
labelled recordings of the real room, which are meant to join these tests.
"""
import os

import pytest

from aankhen.bench import run_jobs

# scenario: (seconds, seeds). Shorter than the CLI suite, long enough for each case.
JOBS = {
    "evening": (120, (1, 2, 3)),     # seed 3: the duplicate-track failure
    "still": (60, (1, 2)),
    "empty": (60, (1, 2)),
    "sleep": (200, (1, 2)),          # the radar loses the sleeper after 8 s
    "hallway": (60, (1, 2)),         # empty room, someone pacing by the router
    "fan": (150, (1, 2)),            # fan on from 3 s, a visitor sits at the desk at 100 s
}


@pytest.fixture(scope="module")
def runs():
    jobs = [(s, secs, seed, 0) for s, (secs, seeds) in JOBS.items() for seed in seeds]
    results = run_jobs(jobs, workers=min(len(jobs), max(1, (os.cpu_count() or 2) - 1)))
    out = {}
    for r in results:
        out.setdefault(r.scenario, []).append(r)
    return out


def worst(rs, key, higher_is_better=False):
    vals = [getattr(r, key) for r in rs]
    return min(vals) if higher_is_better else max(vals)


def test_evening_presence_and_tracking(runs):
    rs = runs["evening"]
    assert worst(rs, "presence_accuracy", True) >= 0.97
    assert worst(rs, "false_empty_rate") <= 0.01          # never turn the lights off on someone
    assert worst(rs, "false_occupied_rate") <= 0.05
    assert worst(rs, "position_error_m") <= 0.10
    assert worst(rs, "position_error_p90_m") <= 0.30
    assert worst(rs, "id_switches") <= 4
    assert worst(rs, "motion_latency_s") <= 1.0
    assert worst(rs, "motion_fa_steady") <= 0.07


def test_still_person_is_neither_lost_nor_called_moving(runs):
    rs = runs["still"]
    assert worst(rs, "false_empty_rate") == 0.0
    assert worst(rs, "motion_false_alarm") <= 0.02
    assert worst(rs, "id_switches") == 0
    assert worst(rs, "position_error_m") <= 0.10          # posture-aware projection at the desk


def test_empty_room_never_reports_anyone(runs):
    rs = runs["empty"]
    assert worst(rs, "false_occupied_rate") == 0.0
    assert worst(rs, "wifi_motion_false_alarm") == 0.0


def test_a_sleeper_the_radar_has_lost_is_not_called_empty(runs):
    """Breathing holds the room (it was 72-85 % false 'empty' before it did)."""
    rs = runs["sleep"]
    assert worst(rs, "false_empty_rate") <= 0.02
    assert worst(rs, "count_accuracy", True) >= 0.9


def test_motion_outside_the_room_does_not_occupy_it(runs):
    """Wi-Fi sees the hallway; the radar does not. 100 % false occupied before."""
    rs = runs["hallway"]
    assert worst(rs, "false_occupied_rate") <= 0.01


def test_a_running_fan_neither_occupies_the_room_nor_moves_the_sitter(runs):
    """98 % false occupied and 94 % false 'moving' before the fan defence."""
    rs = runs["fan"]
    assert worst(rs, "false_occupied_rate") <= 0.02
    assert worst(rs, "motion_fa_steady") <= 0.02
    assert worst(rs, "count_accuracy", True) >= 0.95
    assert worst(rs, "false_empty_rate") <= 0.02
