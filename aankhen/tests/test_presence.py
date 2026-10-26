"""presence.PresenceDetector: body-band variance against the link's own empty room, and
the drift monitor that says when that empty room no longer describes the channel."""
import numpy as np
import pytest

from aankhen import presence as pr
from aankhen.presence import PresenceDetector

S = 51


def _quiet(seconds, rng, shape=None, t0=0.0):
    """An empty room: sensor noise around a static per-subcarrier shape."""
    n = int(seconds * 100)
    base = np.ones(S) if shape is None else shape
    x = base * (1.0 + 0.01 * rng.standard_normal((n, S)))
    return t0 + np.arange(n) / 100.0, x


def _moving(seconds, rng, depth=0.15, t0=0.0, shape=None):
    """Somebody moving: every subcarrier swings at body speeds (0.5-2 Hz)."""
    t, x = _quiet(seconds, rng, shape, t0)
    tt = t - t0
    f = rng.uniform(0.5, 2.0, S)
    ph = rng.uniform(0, 2 * np.pi, S)
    return t, x * np.exp(depth * np.sin(2 * np.pi * f * tt[:, None] + ph))


def _feed(det, t, x, empty=False, hour=None):
    det.empty = empty
    det.hour = hour
    out = []
    for ti, a in zip(t, x):
        r = det.push(ti, a)
        if r is not None:
            out.append(r)
    return out


def test_without_an_empty_room_it_never_claims_anything():
    rng = np.random.default_rng(1)
    det = PresenceDetector()
    det.set_fan("on")
    t, x = _moving(60, rng)
    rs = _feed(det, t, x)
    assert rs and all(r["present"] is None and r["p"] is None for r in rs)
    assert "no empty-room reference for fan on" in rs[-1]["why"]
    # and its own "nothing moves" never becomes the reference (no empty evidence)
    t, x = _quiet(120, rng, t0=60)
    _feed(det, t, x)
    assert det.ref is None


def test_movement_reads_present_and_the_reading_has_the_contract_keys():
    rng = np.random.default_rng(2)
    det = PresenceDetector()
    t, x = _quiet(60, rng)
    _feed(det, t, x, empty=True)
    assert det.ref.ready and det.ref.source == "empty"
    t, x = _moving(20, rng, t0=60)
    r = _feed(det, t, x)[-1]
    assert r["present"] is True and r["p"] > 0.9
    for k in ("present", "p", "why", "ref_age_s", "drift", "validated", "channel_changed"):
        assert k in r
    assert r["validated"] is pr.VALIDATED
    assert 15 <= r["ref_age_s"] <= 25


def test_a_slow_static_drift_is_not_presence():
    # variance ignores a slow static change of the channel by construction (the VRTI
    # logic): here the shape moves 0.3 rms over 2 minutes, the hour-scale drift's kind
    rng = np.random.default_rng(3)
    det = PresenceDetector()
    t, x = _quiet(60, rng)
    _feed(det, t, x, empty=True)
    d = 0.3 * rng.standard_normal(S)
    t, x = _quiet(120, rng, t0=60)
    ramp = np.linspace(0, 1, len(t))[:, None]
    rs = _feed(det, t, x * np.exp(ramp * d))
    assert not any(r["present"] is True for r in rs)


def test_presence_holds_after_movement_and_absence_waits_for_validation(monkeypatch):
    rng = np.random.default_rng(4)
    det = PresenceDetector()
    t, x = _quiet(60, rng)
    _feed(det, t, x, empty=True)
    t, x = _moving(10, rng, t0=60)
    _feed(det, t, x)
    t, x = _quiet(pr.HOLD_S + pr.ABSENT_AFTER_S + 30, rng, t0=70)
    rs = _feed(det, t, x)
    held = [r for r in rs if r["present"] is True]
    assert held and "probably still here" in held[-1]["why"]
    last = rs[-1]
    assert last["present"] is None and "absence is not claimed" in last["why"]   # VALIDATED is False
    monkeypatch.setattr(pr, "VALIDATED", True)
    r = _feed(det, *_quiet(5, rng, t0=t[-1] + 0.01))[-1]
    assert r["present"] is False and "lying still also looks like this" in r["why"]


def test_each_fan_state_has_its_own_empty_room():
    rng = np.random.default_rng(5)
    det = PresenceDetector()
    det.set_fan("on")
    _feed(det, *_quiet(60, rng), empty=True)
    det.set_fan("off")
    r = _feed(det, *_moving(10, rng, t0=60))[-1]
    assert r["present"] is None and "fan off" in r["why"]
    det.set_fan("on")
    assert _feed(det, *_moving(10, rng, t0=70))[-1]["present"] is True


def test_a_channel_change_is_flagged_and_recaptured_at_the_next_empty_stretch():
    rng = np.random.default_rng(6)
    det = PresenceDetector()
    _feed(det, *_quiet(60, rng), empty=True)
    # the static shape moves 0.4 rms (05:23 against noon was 0.66): quiet, nobody there
    shape = np.exp(0.4 * rng.standard_normal(S))
    rs = _feed(det, *_quiet(pr.DRIFT_HOLD_S + 150, rng, shape=shape, t0=60))
    assert rs[-1]["channel_changed"] is True and rs[-1]["drift"] > pr.DRIFT_AT
    assert rs[-1]["present"] is None and "channel changed" in rs[-1]["why"]
    flagged_at = next(i for i, r in enumerate(rs) if r["channel_changed"]) * 0.5
    assert flagged_at >= pr.DRIFT_HOLD_S                   # one moment of drift is not enough
    # the next empty stretch replaces the reference
    t0 = 60 + pr.DRIFT_HOLD_S + 150
    rs = _feed(det, *_quiet(60, rng, shape=shape, t0=t0), empty=True)
    assert rs[-1]["channel_changed"] is False and rs[-1]["ref_source"] == "empty"
    r = _feed(det, *_quiet(30, rng, shape=shape, t0=t0 + 60))[-1]
    assert r["drift"] < 0.1


def test_the_same_channel_with_noise_never_flags():
    rng = np.random.default_rng(7)
    det = PresenceDetector()
    _feed(det, *_quiet(60, rng), empty=True)
    rs = _feed(det, *_quiet(300, rng, t0=60))
    assert not any(r["channel_changed"] for r in rs)
    assert max(r["drift"] for r in rs if r["drift"] is not None) < 0.05


def _drifted(det, rng, shape):
    _feed(det, *_quiet(60, rng), empty=True)
    rs = _feed(det, *_quiet(pr.DRIFT_HOLD_S + 150, rng, shape=shape, t0=60))
    assert rs[-1]["channel_changed"] is True
    return 60 + pr.DRIFT_HOLD_S + 150


def test_after_a_drift_a_quiet_night_recaptures_but_a_quiet_afternoon_does_not(monkeypatch):
    monkeypatch.setattr(pr, "SLEEP_MIN_S", 120.0)
    rng = np.random.default_rng(8)
    shape = np.exp(0.4 * rng.standard_normal(S))
    day = PresenceDetector()
    t0 = _drifted(day, rng, shape)
    _feed(day, *_quiet(200, rng, shape=shape, t0=t0), hour=15)
    assert day.ref.stale and day.ref.source == "empty"     # never from awake time
    night = PresenceDetector()
    t0 = _drifted(night, rng, shape)
    rs = _feed(night, *_quiet(200, rng, shape=shape, t0=t0), hour=2)
    assert not night.ref.stale and night.ref.source == "sleep"
    assert rs[-1]["ref_source"] == "sleep" and rs[-1]["channel_changed"] is False


def test_movement_during_the_night_restarts_the_sleep_capture(monkeypatch):
    monkeypatch.setattr(pr, "SLEEP_MIN_S", 120.0)
    rng = np.random.default_rng(9)
    shape = np.exp(0.4 * rng.standard_normal(S))
    det = PresenceDetector()
    t0 = _drifted(det, rng, shape)
    _feed(det, *_quiet(90, rng, shape=shape, t0=t0), hour=3)
    _feed(det, *_moving(5, rng, depth=0.5, t0=t0 + 90, shape=shape), hour=3)  # turning over
    _feed(det, *_quiet(60, rng, shape=shape, t0=t0 + 95), hour=3)
    assert det.ref.stale                                   # 90 + 60 s, never 120 unbroken


def test_restart_keeps_the_references():
    rng = np.random.default_rng(10)
    det = PresenceDetector()
    _feed(det, *_quiet(60, rng), empty=True)
    det.restart()
    assert det.ref is not None and det.ref.ready
    assert det.summary()["present"] is None or det.summary()["p"] is not None


def test_reference_round_trips_through_a_dict():
    rng = np.random.default_rng(11)
    det = PresenceDetector()
    _feed(det, *_quiet(40, rng), empty=True)
    d = det.ref.to_dict()
    r = pr.Reference.from_dict(d)
    assert np.allclose(r.mean, det.ref.mean) and r.seconds == det.ref.seconds and r.source == "empty"


def test_wrong_length_samples_are_ignored():
    det = PresenceDetector()
    assert det.push(0.0, np.ones(7)) is None
    assert det.summary()["why"].startswith("warming up")


@pytest.mark.parametrize("fan", [None, "auto", "on"])
def test_set_fan_maps_anything_unknown_to_unknown(fan):
    det = PresenceDetector()
    det.set_fan(fan)
    assert det.fan == ("on" if fan == "on" else "unknown")
