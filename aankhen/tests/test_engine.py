"""Engine wiring: what the board's STATUS frames and CSI metadata switch on."""
import numpy as np

from aankhen.engine import Engine
from aankhen.motion import Baseline, MotionDetector
from aankhen.protocol import CsiPacket, StatusPacket
from aankhen.room import default_room


def _engine():
    eng = Engine(default_room(), "simulation", baseline=Baseline(1e-5, 2e-5, 240))
    eng.clock = lambda: eng.device_t or 0.0
    return eng


def _status(t, fan):
    return StatusPacket(int(t * 1e6), 0, {"fw": "test", "relays": {"light": False, "fan": fan}})


def _csi(t, channel=6, seed=0):
    rng = np.random.default_rng(seed)
    raw = rng.integers(-30, 30, 128).astype(np.int8).tobytes()
    return CsiPacket(int(t * 1e6), 0, -50, -92, channel, 0, 1, 0, 0, 1, b"\x02\0\0\0\0\x01", raw)


def test_fan_relay_selects_the_fan_baseline_and_settles_wifi_after_a_switch():
    eng = _engine()
    eng.process(_status(1.0, False))
    assert eng.fan_relay is False and eng.motion.context == MotionDetector.FAN_OFF
    assert not eng._csi_settling(2.0)                  # the first report is not a switch
    eng.process(_status(5.0, True))
    assert eng.motion.context == MotionDetector.FAN_ON
    assert eng._csi_settling(20.0) and not eng._csi_settling(36.0)
    assert any(e.kind == "fan" for e in eng.events)


def test_status_without_relays_changes_nothing():
    eng = _engine()
    eng.process(StatusPacket(1_000_000, 0, {"fw": "old"}))
    assert eng.fan_relay is None and eng.motion.context == MotionDetector.FAN_OFF


def test_a_wifi_channel_change_resets_the_signal_history_and_settles():
    eng = _engine()
    for i in range(300):
        eng.process(_csi(1.0 + i * 0.01, channel=6, seed=i))
    assert eng.csi_channel == 6 and not eng._csi_settling(4.0)
    eng.process(_csi(4.0, channel=11))
    assert eng.csi_channel == 11
    assert eng._csi_settling(10.0) and not eng._csi_settling(14.5)
    assert any(e.kind == "channel" for e in eng.events)
    assert len(eng.motion._turb) <= 1                  # the old channel's windows are gone


class _FakeFingerprint:
    """Stands in for live.FingerprintZones: a zone answer for every sample."""

    def push(self, t, amp, filled, fan_on):
        return {"at_desk_chair": 0.7, "bed_lying": 0.3}


def test_the_fingerprint_path_hands_the_belief_the_measured_motion():
    eng = _engine()
    eng.fingerprint = _FakeFingerprint()
    eng.belief.experimental = "test"
    seen = []
    step = eng.belief.step

    def spy(t, motion=None, **kw):
        seen.append((motion, kw.get("zone_p"), eng._belief_motion(t)))
        step(t, motion, **kw)
    eng.belief.step = spy
    for i in range(400):
        eng.process(_csi(1.0 + i * 0.01, seed=i))
    fp = [(m, want) for m, zp, want in seen if zp]
    assert fp, "the CNN's windows never reached the belief"
    # every CNN step carries what the motion detector measured at that moment...
    assert all(m == want for m, want in fp)
    # ...and once the detector has readings that is a number, not "unknown"
    assert any(m is not None for m, _ in fp)


def test_belief_motion_is_unknown_without_a_baseline_or_when_stale():
    from aankhen.motion import STATE_QUIET, STATE_UNCALIBRATED, MotionReading
    eng = _engine()
    feats = {"hbe": 2.0, "hbe_threshold": None}
    eng.motion.last = MotionReading(10.0, STATE_UNCALIBRATED, None, None, 0.0, 0.0, "collecting", feats, "none")
    # the fan on with no fan-on baseline: raw HBE on no scale used to read as "still"
    assert eng._belief_motion(10.0) is None
    eng.motion.last = MotionReading(10.0, STATE_QUIET, 0.5, 2.0, 0.1, 0.5, "quiet",
                                    {"hbe": 2.0, "hbe_threshold": 4.0}, "calibrated")
    assert eng._belief_motion(10.5) == 0.125          # belief.motion01: (2 / 4) / 4
    assert eng._belief_motion(13.0) is None            # 3 s old: not "now"
    eng.motion.last = MotionReading(10.0, STATE_QUIET, 0.5, 2.0, 0.1, 0.5, "quiet",
                                    {"hbe": None, "hbe_threshold": None}, "calibrated")
    assert eng._belief_motion(10.2) == 0.1             # no HBE calibration: the score's own 0..1
