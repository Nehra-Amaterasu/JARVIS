"""Link 2 (the phone) on the host: conditioning, isolation from link 1, recordings.

No hardware: packets are synthetic, and the live path runs a real SerialSource over the
fake USB board of fakeserial.py, extended to send CSI_LINK frames as firmware 3.3.0 does.
"""
import time

import numpy as np
import pytest

from aankhen.links import LinkBank
from aankhen.motion import Baseline
from aankhen.protocol import (
    FrameType, LINK_PHONE, CsiLinkPacket, CsiPacket, Frame, StreamDecoder,
)
from aankhen.room import default_room
from aankhen.transport import ReplaySource, Recorder, SerialSource, iter_recording

from .fakeserial import FakeBoard, FakeUsb

PHONE = b"\x02\x00\x00\x00\x00\x02"        # locally administered: a private address
OTHER_PHONE = b"\x06\x00\x00\x00\x00\x07"
ROUTER = b"\x02\x00\x00\x00\x00\x01"
_SUB = np.array([k if k < 32 else k - 64 for k in range(64)], float)   # subcarrier of each FFT bin


def _raw(t, rng, move=0.0, base=40.0):
    """An LLTF buffer (imaginary first). `move` tilts the channel across the band at
    1 Hz, the kind of smooth change a body makes; noise is 1 count per subcarrier."""
    amp = base + move * np.sin(2 * np.pi * 1.0 * t) * (_SUB / 26.0) + rng.normal(0.0, 1.0, 64)
    iq = np.zeros(128, np.int8)
    iq[1::2] = np.clip(np.round(amp), -127, 127).astype(np.int8)
    return iq.tobytes()


def _link_pkt(t, rng, link=LINK_PHONE, mac=PHONE, channel=6, move=0.0, seq=0):
    return CsiLinkPacket(link, int(round(t * 1e6)), seq, -68, -95, channel, 0, 1, 0, 0, 1,
                         mac, _raw(t, rng, move), 0, 0, None)


def _csi_pkt(t, rng, channel=6, seq=0):
    return CsiPacket(int(round(t * 1e6)), seq, -50, -92, channel, 0, 1, 0, 0, 1, ROUTER, _raw(t, rng))


def _phone_stream(seconds, rate_hz, rng, t0=10.0, jitter_s=0.002, **kw):
    n = int(seconds * rate_hz)
    ts = t0 + np.arange(n) / rate_hz + rng.uniform(-jitter_s, jitter_s, n)
    return [_link_pkt(t, rng, seq=i, **kw) for i, t in enumerate(ts)]


# ------------------------------------------------------------------ the bank
@pytest.mark.parametrize("rate_in", [100, 200])
def test_link_bank_turns_link2_packets_into_a_100hz_stream(rate_in):
    """Packets as a phone delivers them (100 Hz, or 200 Hz at the firmware's cap), with
    +-2 ms of jitter: out comes a uniform 100 Hz grid, nothing invented."""
    rng = np.random.default_rng(1)
    bank = LinkBank()
    samples = []
    for p in _phone_stream(5.0, rate_in, rng):
        samples += bank.push(p)
    t = np.array([s.t for s in samples])
    assert len(samples) >= 490                      # 500 slots less the grid's and the Hampel's lag
    assert np.allclose(np.diff(t), 0.01, atol=1e-9)
    assert not any(s.filled for s in samples)
    st = bank.get(LINK_PHONE)
    assert abs(st.cond.rate.hz - rate_in) < 0.1 * rate_in
    assert st.hbe is not None and st.hbe_t is not None
    s = bank.summary()["phone"]
    assert s["fill_ratio"] == 0.0 and s["samples"] == len(samples) and s["restarts"] == 0
    assert s["private_mac"] is True and "mac" not in s


def test_human_band_energy_sees_movement_on_link2():
    """HBE is ~1 for noise alone, uncalibrated; a 1 Hz movement lifts it far above."""
    def hbe(move):
        rng = np.random.default_rng(2)
        bank = LinkBank()
        for p in _phone_stream(6.0, 100, rng, move=move):
            bank.push(p)
        return bank.get(LINK_PHONE).hbe
    still, moving = hbe(0.0), hbe(6.0)
    assert still < 3.0
    assert moving > 10 * still


def test_a_slow_phone_gives_no_reading_rather_than_a_wrong_one():
    """At 40 packets a second most 10 ms slots are forward-filled: HBE declines."""
    rng = np.random.default_rng(3)
    bank = LinkBank()
    for p in _phone_stream(6.0, 40, rng, jitter_s=0.0):
        bank.push(p)
    st = bank.get(LINK_PHONE)
    assert st.hbe is None and st.cond.resampler.fill_ratio() > 0.5


def test_links_are_kept_apart():
    rng = np.random.default_rng(4)
    bank = LinkBank()
    a = _phone_stream(2.0, 100, rng)
    b = _phone_stream(2.0, 100, rng, link=3, mac=OTHER_PHONE, move=6.0)
    for p, q in zip(a, b):
        bank.push(p)
        bank.push(q)
    assert bank.links == [2, 3]
    assert bank.get(2).packets == bank.get(3).packets == 200
    assert bank.get(2).restarts == bank.get(3).restarts == 0
    assert set(bank.summary()) == {"phone", "link 3"}


def test_a_new_transmitter_or_channel_restarts_the_link():
    rng = np.random.default_rng(5)
    bank = LinkBank()
    for p in _phone_stream(1.0, 100, rng):
        bank.push(p)
    st = bank.get(LINK_PHONE)
    cond = st.cond
    bank.push(_link_pkt(11.5, rng, mac=OTHER_PHONE))        # a new private address
    assert st.restarts == 1 and st.cond is not cond and st.restart_reason == "a different transmitter"
    bank.push(_link_pkt(11.51, rng, mac=OTHER_PHONE, channel=11))
    assert st.restarts == 2 and st.restart_reason == "channel 6 -> 11"


def test_bank_ignores_everything_but_link_packets():
    rng = np.random.default_rng(6)
    bank = LinkBank()
    assert bank.process(_csi_pkt(1.0, rng)) == []
    assert bank.links == []
    with pytest.raises(TypeError):
        bank.push(_csi_pkt(1.0, rng))


# ------------------------------------------------------- link 1 untouched
def _link1_state(eng):
    c, m = eng.cond, eng.motion
    return {
        "counters": dict(eng.counters), "last_host": dict(eng.last_host), "device_t": eng.device_t,
        "csi_channel": eng.csi_channel, "settle": eng._csi_settle_until,
        "events": [e.to_dict() for e in eng.events],
        "cond": id(c), "rate": c.rate.hz, "emitted": c.resampler.emitted, "filled": c.resampler.filled,
        "t0": c.resampler._t0, "rejected": c.rejected, "gain_packets": c.gain_packets,
        "last_rssi": c.last_rssi, "last_amp": None if c.last_raw_amp is None else c.last_raw_amp.tolist(),
        "motion_last": id(m.last), "evaluations": m.evaluations, "turb": list(m._turb),
        "resp": id(eng.resp), "eyes": id(eng.eyes),
    }


def test_engine_ignores_link2_packets():
    """The engine dispatches on isinstance(pkt, CsiPacket). A CsiLinkPacket is not one, so
    until link 2 is integrated nothing of link 1 moves: not its counters, clock, channel
    (link 2 arrives on ANOTHER channel here: mistaken for link 1 it would reset
    everything), conditioner, detector or events."""
    from aankhen.engine import Engine
    eng = Engine(default_room(), "simulation", baseline=Baseline(1e-5, 2e-5, 240))
    eng.clock = lambda: eng.device_t or 0.0
    rng = np.random.default_rng(7)
    for i in range(300):                                    # 3 s of link 1: state worth disturbing
        eng.process(_csi_pkt(1.0 + i * 0.01, rng, seq=i))
    before = _link1_state(eng)
    for p in _phone_stream(3.0, 100, rng, t0=5.0, channel=11, move=6.0):
        assert not isinstance(p, CsiPacket)
        eng.process(p)
    assert _link1_state(eng) == before


def test_todays_learned_models_see_the_same_link1_data():
    """learn._packets feeds training: with link-2 frames in the stream it must yield
    exactly the link-1 packets it yields without them."""
    from aankhen.learn import _packets
    rng = np.random.default_rng(8)
    link1 = [_csi_pkt(1.0 + i * 0.01, rng, seq=i) for i in range(100)]
    link2 = _phone_stream(1.0, 100, rng, t0=1.0)
    plain = b"".join(p.to_frame().encode() for p in link1)
    mixed = b"".join(a.to_frame().encode() + b.to_frame().encode() for a, b in zip(link1, link2))
    key = lambda ps: [(p.timestamp_us, p.seq, p.raw) for p in ps]
    assert key(_packets([mixed])) == key(_packets([plain])) == key(link1)


# ------------------------------------------------------------ recordings
def _drain(src, want, timeout=5.0):
    got, t0 = [], time.time()
    while time.time() - t0 < timeout and sum(isinstance(p, CsiLinkPacket) for p in got) < want:
        try:
            got.append(src.packets.get(timeout=0.1))
        except Exception:
            pass
    return got


def test_replay_of_a_recording_yields_link2_packets(tmp_path):
    rng = np.random.default_rng(9)
    frames = []
    for i in range(30):
        frames.append(_csi_pkt(1.0 + i * 0.01, rng, seq=i).to_frame())
        frames.append(_link_pkt(1.0 + i * 0.01 + 0.003, rng, seq=i).to_frame())
        if i % 10 == 0:
            frames.append(Frame(FrameType.STATUS, i // 10, i, b'{"beacon": {"ip": null}}'))
    stream = b"".join(f.encode() for f in frames)
    path = str(tmp_path / "teach-x.akr")
    rec = Recorder(path, {"label": "teach"})
    for i in range(0, len(stream), 37):                     # awkward chunks, as a port delivers them
        rec.write(stream[i:i + 37], 1000.0 + i * 1e-5)
    rec.close()
    src = ReplaySource(path, speed=0).start()
    got = _drain(src, 30)
    src.stop()
    links = [p for p in got if isinstance(p, CsiLinkPacket)]
    assert [p.seq for p in links] == list(range(30))
    assert all(p.link == LINK_PHONE and p.mac == PHONE for p in links)
    assert [p.seq for p in got if isinstance(p, CsiPacket)] == list(range(30))
    st = src.decoder.stats
    assert (st.crc_errors, st.bad_headers, st.bytes_skipped, st.frames_lost) == (0, 0, 0, 0)


class _LinkBoard(FakeBoard):
    """The fake ESP32, sending link 1 and link 2 beside its STATUS frames (firmware 3.3.0)."""

    def __init__(self, *a, **kw):
        super().__init__(*a, fw="aankhen-3.3.0", **kw)
        self._rng = np.random.default_rng(10)

    def frames(self) -> bytes:
        out = super().frames()
        t = time.monotonic()
        return (out + _csi_pkt(t, self._rng, seq=self._seq).to_frame().encode()
                + _link_pkt(t + 0.001, self._rng, seq=self._seq).to_frame().encode())


def test_live_recording_keeps_link2_frames(tmp_path):
    """The path every session records through (teach, learn-my-room, firstlight,
    calibrate, record): Source.record_to on a live SerialSource writes the raw bytes
    before decoding, so the CSI_LINK frames are in the .akr and replay as CsiLinkPacket."""
    usb = FakeUsb(_LinkBoard("COM_FAKE", period_s=0.01))
    src = SerialSource("COM_FAKE", opener=usb.opener, finder=usb.finder(), reconnect_s=0.05)
    path = str(tmp_path / "teach-room-x.akr")
    src.record_to(path, {"label": "learn-my-room"})
    src.start()
    live = _drain(src, 10)
    src.stop()
    assert sum(isinstance(p, CsiLinkPacket) for p in live) >= 10
    dec, types = StreamDecoder(), []
    for _, data in iter_recording(path):
        types += [f.type for f in dec.feed(data)]
    assert types.count(FrameType.CSI_LINK) >= 10 and dec.stats.bad_headers == 0
    rep = ReplaySource(path, speed=0).start()
    replayed = _drain(rep, 10)
    rep.stop()
    assert sum(isinstance(p, CsiLinkPacket) for p in replayed) >= 10
    assert rep.decoder.stats.bad_headers == 0
