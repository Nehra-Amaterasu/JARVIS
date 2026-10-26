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


# ------------------------------------------------------- the fan from the CSI, presence
def _fan_csi(t, rng, fan_hz=9.08, phases=None, depth=0.25):
    """A packet whose 64 bins swing at a fan's blade-pass, each bin with its own phase
    (so the per-packet median stays put and the line survives normalisation)."""
    ph = phases if phases is not None else np.zeros(64)
    swing = depth * np.sin(2 * np.pi * fan_hz * t + ph) if fan_hz else 0.0
    amp = 40.0 * (1.0 + swing) + rng.normal(0, 0.6, 64)
    iq = np.zeros(128, np.int8)
    iq[1::2] = np.clip(np.rint(amp), -127, 127).astype(np.int8)     # real; imaginary (first) left 0
    return CsiPacket(int(t * 1e6), 0, -50, -92, 6, 0, 1, 0, 0, 1, b"\x02\0\0\0\0\x01", iq.tobytes())


def _feed_csi(eng, t0, seconds, rng, **kw):
    ph = np.random.default_rng(99).uniform(0, 2 * np.pi, 64)
    n = int(seconds * 100)
    for i in range(n):
        eng.process(_fan_csi(t0 + i * 0.01, rng, phases=ph, **kw))
    return t0 + n * 0.01


def test_the_fan_is_read_from_the_csi_and_picks_the_fan_on_baseline():
    rng = np.random.default_rng(1)
    eng = _engine()
    assert eng.fan_on is None and eng.fan_source is None
    _feed_csi(eng, 1.0, 60, rng)
    assert eng.fan_auto.state == "on"
    assert eng.fan_on is True and eng.fan_source == "auto"
    assert eng.motion.context == MotionDetector.FAN_ON
    assert eng.presence_wifi.fan == "on"
    assert any(e.kind == "fan" and "from the Wi-Fi itself" in e.text for e in eng.events)
    f = eng.frame_message()
    assert f["fan_auto"]["fan"] == "on" and f["fan_on"] is True and f["fan_source"] == "auto"
    assert f["motion_detail"]["fan"]["auto"] == "on" and f["motion_detail"]["fan"]["source"] == "auto"
    snap = eng.snapshot()
    for k in ("fan_auto", "fan_on", "fan_source", "presence_wifi"):
        assert k in snap
    assert set(snap["presence_wifi"]) >= {"present", "p", "why", "ref_age_s", "drift"}
    # the owner's own word overrides the CSI, and None hands it back
    eng.set_fan_manual(False)
    assert eng.fan_on is False and eng.fan_source == "manual"
    assert eng.motion.context == MotionDetector.FAN_OFF and eng.presence_wifi.fan == "off"
    eng.set_fan_manual(None)
    assert eng.fan_on is True and eng.fan_source == "auto"
    assert eng.motion.context == MotionDetector.FAN_ON


def test_the_csi_saying_off_never_overrules_a_relay_saying_on():
    # fan-off was never recorded with a known state, so an "off" from the CSI is the
    # weaker word: a switch that reports "on" wins, and the CSI's "off" counts only alone
    rng = np.random.default_rng(2)
    eng = _engine()
    _feed_csi(eng, 1.0, 60, rng, fan_hz=None)
    assert eng.fan_auto.state == "off"
    assert eng.fan_on is False and eng.fan_source == "auto"
    eng.process(_status(62.0, True))
    assert eng.fan_on is True and eng.fan_source == "esp32 relay"
    assert eng.motion.context == MotionDetector.FAN_ON


def test_empty_evidence_learns_the_fan_on_baseline_and_presences_reference():
    # no radar in this room: the drill's empty block (the recalibrator running) is the
    # independent "empty" that ends the fan-on "unknown"
    rng = np.random.default_rng(3)
    eng = _engine()
    t = _feed_csi(eng, 1.0, 50, rng)
    assert eng.motion.context == MotionDetector.FAN_ON and eng.motion.fan_baseline is None
    assert eng.motion.last.state == "uncalibrated"
    assert eng.presence_wifi.summary()["present"] is None
    eng.recal.active_source = "drill"
    t = _feed_csi(eng, t, 90, rng)
    assert eng.motion.empty_s is not None and eng.motion.empty_s > 80
    assert eng.motion.fan_baseline is not None and eng.motion.fan_baseline.source == "learned (fan on)"
    assert eng.motion.last.state != "uncalibrated"
    assert eng.presence_wifi.ref is not None and eng.presence_wifi.ref.ready
    assert eng.presence_wifi.ref.source == "empty"
    eng.recal.active_source = None
    _feed_csi(eng, t, 5, rng)
    assert eng.motion.empty_s is None and eng.presence_wifi.empty is False
    p = eng.snapshot()["presence_wifi"]
    assert p["p"] is not None and p["validated"] is False


def test_a_channel_change_keeps_the_fan_and_restarts_presence():
    rng = np.random.default_rng(4)
    eng = _engine()
    t = _feed_csi(eng, 1.0, 60, rng)
    assert eng.fan_on is True
    eng.process(_csi(t, channel=11))
    assert eng.fan_auto.state == "on" and eng.fan_on is True
    assert eng.presence_wifi._x_lo is None              # the filters start again on the new channel
