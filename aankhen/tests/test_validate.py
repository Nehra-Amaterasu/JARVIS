"""validate.py on simulated sessions: the metronome idea end to end. A person
breathing at exactly 12/min where the physics says breathing is visible must come
back as ~12/min; walking must be flagged; the room's wander must be measured."""
import math
import os

import numpy as np
import pytest

from aankhen.room import default_room
from aankhen.simulator import Actor, Scenario, Simulator, Step
from aankhen.validate import PACED_BPM, Metronome, analyse, sigma_env_of, _samples



def _record(tmp, name, actors, seconds, heading=None, gain=True):
    room = default_room()
    sim = Simulator(room, Scenario(name, actors), seed=3, channel_seed=0, gain_report=gain)
    if heading is not None:
        sim.csi._heading["p"] = heading
    path = os.path.join(tmp, f"{name}.akr")
    sim.write_recording(path, seconds)
    return path


@pytest.fixture(scope="module")
def session(tmp_path_factory):
    tmp = str(tmp_path_factory.mktemp("validate"))
    paths = {
        "empty": _record(tmp, "empty", [], 75),
        # Desk, facing the wall (the zone's facing): a pose physics.py rates well
        # above the detector's 90 % line in this room.
        "desk": _record(tmp, "desk", [Actor("p", (0.8, 0.6), [Step("stay", seconds=80, posture="seated")],
                                            breathing_bpm=PACED_BPM)], 80, heading=math.radians(-90)),
        # ~3 m legs at 0.9 m/s: nine of them keep walking for the whole 30 s.
        "walk": _record(tmp, "walk", [Actor("p", (0.5, 3.0), [Step("walk", to=(3.0, 1.0)),
                                                               Step("walk", to=(0.8, 3.2))] * 5)], 30),
    }
    return analyse(paths)


@pytest.mark.slow
def test_the_room_wander_is_measured(session):
    assert session.compensated
    assert session.sigma_env is not None and 0 <= session.sigma_env < 0.05


@pytest.mark.slow
def test_the_gain_compensation_error_is_measured(session):
    """The simulated receiver's compensation error is 0.25 dB per packet; the common
    part of the thermal noise adds a little on top."""
    assert session.comp_err_db is not None and 0.2 <= session.comp_err_db <= 0.45


@pytest.mark.slow
def test_paced_breathing_is_found_at_the_paced_rate(session):
    desk = next(s for s in session.steps if s.step == "desk")
    assert desk.passed is not None and desk.passed >= 0.5
    assert desk.rate_bpm is not None and abs(desk.rate_bpm - PACED_BPM) <= 1.5


@pytest.mark.slow
def test_walking_is_flagged(session):
    walk = next(s for s in session.steps if s.step == "walk")
    assert walk.passed is not None and walk.passed >= 0.7


@pytest.mark.slow
def test_the_verdicts_read_plainly(session):
    lines = session.verdicts()
    assert any(l.startswith("desk") and "SEEN" in l for l in lines)


def test_sigma_env_rises_with_slow_wander():
    """A slow 0.3 Hz wobble on top of white noise must show up; white noise alone not."""
    from aankhen.csi import Sample
    rng = np.random.default_rng(0)
    t = np.arange(6000) / 100.0

    def series(wobble):
        amp = 1 + rng.normal(0, 0.02, (6000, 51)) + wobble * np.sin(2 * np.pi * 0.3 * t)[:, None]
        return [Sample(float(tt), a, False) for tt, a in zip(t, amp)]

    quiet, wobbly = sigma_env_of(series(0.0)), sigma_env_of(series(0.01))
    assert quiet < 0.002 < wobbly


def test_metronome_runs_and_stops_without_sound():
    with Metronome(bpm=600) as m:          # fast, so the test is short
        pass
    assert not m._thread.is_alive()
