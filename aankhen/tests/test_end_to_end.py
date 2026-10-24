"""End-to-end regression — SYNTHETIC DATA. Read this before trusting a pass.

Simulated wire bytes go through the real decoder, conditioner, detector, tracker,
occupancy map and fusion, and the result is scored against the simulator's ground
truth by bench.py. Every assertion is on the WORST of several seeds: the first
version of this file pinned seed 1 alone, and seed 3 of the same scenario read an
empty room as occupied 53 % of the time (a duplicate track; see tracker.py).

The bounds sit just inside what the pipeline measured on these seeds when they
were written, so a change that makes things worse fails here. Runs go in
parallel processes (one pool) to keep this file near the length of its longest run.

Passing proves the pipeline is internally consistent with the simulator's physics.
It does NOT prove real-world accuracy; that comes from `python -m aankhen bench` on
labelled recordings of the real room, which are meant to join these tests.
"""
import os
from concurrent.futures import ProcessPoolExecutor

import pytest


# scenario: (seconds, seeds). Shorter than the CLI suite, long enough for each case.
JOBS = {
    "evening": (120, (1, 2, 3)),     # seed 3: the duplicate-track failure
    "still": (60, (1, 2)),
    "empty": (60, (1, 2)),
    "hallway": (60, (1, 2)),         # empty room, someone pacing by the router
    "fan": (150, (1, 2)),            # fan on from 3 s, a visitor sits at the desk at 100 s
}


def _job(args):
    """One bench run in a worker process, with gain compensation set for THIS job.
    engine.GAIN_COMP is read on every packet, so setting it here is enough; a module
    function so the process pool can pickle it."""
    gain, job = args
    from aankhen import engine
    from aankhen.bench import _suite_job
    engine.GAIN_COMP = gain
    return _suite_job(job)


@pytest.fixture(scope="module")
def runs():
    # The sleeper is held by breathing, and breathing survives only on gain-compensated
    # CSI (the simulator's board reports its gain). Compensation is off by default
    # since 10-13 (engine.GAIN_COMP: on the real board it broke stillness under models
    # trained without it), so the sleep runs switch it on for themselves. Off, the
    # worst seed reads 22 % false "empty": the real board can lose a still sleeper until
    # a compensated session is calibrated
    # (docs/research/2026-10-14-spatial-intelligence-brainstorm.md).
    #
    # SPEED: every run goes into ONE pool, longest first. The sleep runs used to wait
    # for a second pool after all the others had finished (an environment switch read
    # at import), so the file took the longest normal run PLUS the longest sleep run.
    # Workers are capped at 6: each is a full numpy/scipy process, and on a laptop
    # with little free memory more of them page instead of running.
    jobs = [(False, (s, secs, seed, 0)) for s, (secs, seeds) in JOBS.items() for seed in seeds]
    jobs += [(True, ("sleep", 200, seed, 0)) for seed in (1, 2)]
    jobs.sort(key=lambda j: -j[1][1])
    workers = min(len(jobs), 6, max(1, (os.cpu_count() or 2) - 1))
    with ProcessPoolExecutor(max_workers=workers) as ex:
        results = list(ex.map(_job, jobs))
    out = {}
    for r in results:
        out.setdefault(r.scenario, []).append(r)
    assert sorted(len(v) for v in out.values()) == sorted([len(v[1]) for v in JOBS.values()] + [2])
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
    """Breathing holds the room (it was 72-85 % false 'empty' before it did).

    On the physics radio (rf.py) with gain-compensated CSI: 3.6 % worst, the time
    between the radar losing the sleeper and the breathing windows building up. The
    first bound, 2 %, was set on the old textbook-lite radio, which made breathing
    far easier than it is. Without the gain report this same run fails (the common
    part of the chest's effect is divided away), and in simulated room 1 this exact
    pose is below the detector's line: docs/design/aankhen-physics.md, section 5."""
    rs = runs["sleep"]
    assert worst(rs, "false_empty_rate") <= 0.05
    # Count (from radar tracks) is weaker than presence: when the first breathing
    # window fails before the still track's 30 s hold runs out, the track is gone and
    # the count reads 0 though the room stays occupied (76 % worst, 2026-10-10; 90 %+
    # on the old radio). Open: extend the hold on weaker breathing evidence without
    # holding ghosts after an exit through the radar's blind corner.
    assert worst(rs, "count_accuracy", True) >= 0.75


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
