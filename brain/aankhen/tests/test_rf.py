"""rf.py against the textbook: every formula checked on a case with a known answer."""
import math

import numpy as np
import pytest

from aankhen import rf
from aankhen.room import Furniture, Room, SensorPose


def test_channel_frequencies():
    assert rf.channel_center_hz(1) == 2.412e9
    assert rf.channel_center_hz(6) == 2.437e9
    assert rf.channel_center_hz(13) == 2.472e9
    assert rf.channel_center_hz(14) == 2.484e9
    with pytest.raises(ValueError):
        rf.channel_center_hz(36)


def test_knife_edge_matches_itu_p526():
    assert rf.knife_edge_loss_db(-1.0) == 0.0                 # well clear: no loss
    assert 5.9 < rf.knife_edge_loss_db(0.0) < 6.1             # grazing edge: ~6 dB
    assert 20.0 < rf.knife_edge_loss_db(2.4) < 21.0           # deep shadow
    vs = np.linspace(-0.7, 3, 40)
    assert all(np.diff([rf.knife_edge_loss_db(v) for v in vs]) > 0)


def test_bistatic_over_friis_is_the_radar_equation_ratio():
    lam, rcs, d1, d2, d = 0.123, 0.5, 2.0, 3.0, 4.5
    ratio = rf.bistatic_amplitude(d1, d2, lam, rcs) / rf.friis_amplitude(d, lam)
    assert ratio == pytest.approx(math.sqrt(rcs / (4 * math.pi)) * d / (d1 * d2))


def test_fresnel_radius():
    # 2.437 GHz, 6 m link, middle: sqrt(lam * 3 * 3 / 6)
    lam = rf.C / 2.437e9
    assert rf.fresnel_radius(3, 3, lam) == pytest.approx(math.sqrt(lam * 1.5))


@pytest.mark.parametrize("h", [0.0, 0.3, 1.0, 3.0])
def test_bounce_path_stretches_by_2cos_half_bistatic_angle(h):
    a = 2.0
    tx, rx = np.array([-a, 0, 1.0]), np.array([a, 0, 1.0])
    p = np.array([0.0, h, 1.0])                              # on the perpendicular bisector
    beta = 2 * math.atan2(a, h) if h else math.pi
    assert np.linalg.norm(rf.path_gradient(p, tx, rx)) == pytest.approx(2 * math.cos(beta / 2), abs=1e-9)


def test_breathing_on_the_link_line_does_not_change_the_path():
    """A chest exactly between the radios, moving sideways: first order zero, the
    physical reason the line of sight itself is a breathing blind spot."""
    tx, rx = np.array([-2.0, 0, 1.0]), np.array([2.0, 0, 1.0])
    g = rf.path_gradient(np.array([0.5, 0.0, 1.0]), tx, rx)
    assert abs(g @ np.array([0, 1.0, 0])) < 1e-12


def _box_room(w=4.0, d=4.0, h=2.8):
    return Room("box", w, d, h)


def test_image_method_floor_bounce_length():
    geo = rf.RoomGeometry(_box_room())
    L, q = geo.reflection(np.array([0.5, 1.0, 1.0]), np.array([3.5, 1.0, 1.0]), 2, 0.0, False)
    assert L == pytest.approx(math.hypot(3.0, 2.0))
    assert q[2] == pytest.approx(0.0) and q[0] == pytest.approx(2.0)


def test_no_reflection_off_a_wall_between_the_ends():
    geo = rf.RoomGeometry(_box_room())
    assert geo.reflection(np.array([-3.0, 2.0, 1.0]), np.array([3.5, 2.0, 1.0]), 0, 0.0, True) is None


def test_wall_crossings():
    geo = rf.RoomGeometry(_box_room())
    inside, outside = np.array([1.0, 1.0, 1.0]), np.array([-3.0, 2.0, 1.0])
    assert geo.wall_crossings(inside, np.array([3.0, 3.0, 1.0])) == 0
    assert geo.wall_crossings(outside, inside) == 1
    assert geo.wall_crossings(outside, np.array([7.0, 2.0, 1.0])) == 2      # straight through
    assert geo.wall_crossings(outside, np.array([-3.0, 6.0, 1.0])) == 0     # alongside


def _link(room=None, tx=(-3.0, 2.0, 1.0), rx=(3.9, 2.0, 1.0), **params):
    room = room or _box_room()
    return rf.Channel(room, SensorPose("router", "router", *tx), SensorPose("esp32", "esp32", *rx),
                      rf.RFParams(n_clutter=0, **params), np.random.default_rng(0))


def test_line_of_sight_through_one_wall_loses_the_wall_loss():
    open_ = _link(wall_loss_db=0.0, wall_gamma=0.0, floor_gamma=0.0, ceiling_gamma=0.0)
    walled = _link(wall_loss_db=10.0, wall_gamma=0.0, floor_gamma=0.0, ceiling_gamma=0.0)
    a0, a1 = np.abs(open_.response([])).mean(), np.abs(walled.response([])).mean()
    assert 20 * math.log10(a0 / a1) == pytest.approx(10.0, abs=1e-6)


def test_rssi_follows_friis():
    ch = _link(tx=(0.5, 2.0, 1.0), wall_loss_db=0.0, wall_gamma=0.0, floor_gamma=0.0, ceiling_gamma=0.0)
    d = 3.4
    fspl = 20 * math.log10(4 * math.pi * d / ch.lam)
    assert ch.rx_power_dbm(ch.response([])) == pytest.approx(20.0 + 2.0 - fspl, abs=0.05)


def test_a_body_on_the_line_of_sight_shadows_it_and_one_far_away_does_not():
    ch = _link(tx=(0.3, 2.0, 1.0), wall_loss_db=0.0)
    los = ch.paths[0]
    on = rf.Body("p", 2.1, 2.0, 0.0, "standing")
    off = rf.Body("p", 2.1, 0.4, 0.0, "standing")
    lying = rf.Body("p", 2.1, 2.0, 0.0, "lying")
    assert 5.0 < ch.shadow_db(los, on) < 20.0
    assert ch.shadow_db(los, off) == 0.0
    assert ch.shadow_db(los, lying) == 0.0                   # below the 1 m link


def test_breathing_modulates_amplitude_off_the_line_and_not_on_it():
    ch = _link(tx=(0.3, 2.0, 1.0), wall_loss_db=0.0)

    def mod(x, y, heading):
        up = np.abs(ch.response([rf.Body("p", x, y, heading, "seated", chest_m=0.003)]))
        dn = np.abs(ch.response([rf.Body("p", x, y, heading, "seated", chest_m=-0.003)]))
        return float(np.max(np.abs(up - dn)) / np.abs(ch.response([])).mean())

    beside = mod(2.0, 1.0, -math.pi / 2)         # 1 m off the link, chest toward the bisector
    on_line = mod(2.0, 2.0, math.pi / 2)         # on the link, chest sideways
    assert beside > 5 * on_line


def _captures(rx, H, n=400):
    caps, comps = [], []
    for _ in range(n):
        caps.append(rx.capture(H)[0])
        comps.append(rx.last_comp_db)
    return np.stack(caps), np.array(comps)


def test_reported_gain_undoes_the_agc_and_leaves_only_noise():
    ch = _link()
    rx = rf.Esp32Receiver(ch, np.random.default_rng(1), comp_err_db=0.0)
    H = ch.response([])
    caps, comps = _captures(rx, H)
    raw = np.abs(caps)
    fixed = raw * 10 ** (comps[:, None] / 20)
    noise = 1 / math.sqrt(2 * 10 ** (ch.csi_snr_db(H) / 10))
    # Same channel every packet: once the gain is undone, the scatter is the noise.
    assert fixed.std(axis=0).mean() / fixed.mean() == pytest.approx(noise, rel=0.5)
    # Without it, the near-random per-packet gain dominates (ESP32-S3 behaviour).
    assert raw.std(axis=0).mean() / raw.mean() > 2 * noise
    assert np.abs(caps).max() <= 127 * math.sqrt(2)


def test_agc_tracks_the_level_in_steps():
    ch = _link()
    rx = rf.Esp32Receiver(ch, np.random.default_rng(1))
    level = ch.rx_power_dbm(ch.response([]))
    assert len({round(rx._agc(level), 3) for _ in range(5)}) == 1
    assert abs(level + rx._agc(level)) <= ch.p.agc_step_db


def test_phase_is_scrambled_per_packet_but_amplitude_is_not():
    ch = _link()
    rx = rf.Esp32Receiver(ch, np.random.default_rng(2), comp_err_db=0.0)
    H = ch.response([])
    caps, comps = _captures(rx, H, 200)
    dphase = np.angle(caps[1:, 20] / caps[:-1, 20])
    assert np.std(dphase) > 1.0                                  # phase: random per packet
    noise = 1 / math.sqrt(2 * 10 ** (ch.csi_snr_db(H) / 10))
    amp = np.abs(caps) * 10 ** (comps[:, None] / 20)
    damp = np.abs(amp[1:] - amp[:-1]).mean() / amp.mean()
    assert damp < 3 * noise                                      # amplitude: noise only


def test_furniture_is_a_static_scatterer():
    room = _box_room()
    room.furniture = [Furniture("wardrobe", 3.0, 0.0, 0.6, 1.0, 2.1)]
    ch = _link(room)
    assert any(p.kind == "furniture" for p in ch.paths)


def test_simulator_sends_gain_frames_the_decoder_reads_back():
    """The gain block must travel in CSI_GAIN frames: wrapped in a plain CSI header,
    its 4 bytes were read as CSI and shifted every subcarrier by two (2026-10-10)."""
    from aankhen.protocol import CsiPacket, FrameType, StreamDecoder, decode_packet
    from aankhen.simulator import SCENARIOS, Simulator
    for report in (True, False):
        sim = Simulator(scenario=SCENARIOS["empty"](), seed=1, gain_report=report)
        frames = [f for c in sim.chunks(1.0) for f in StreamDecoder().feed(c)]
        csi = [f for f in frames if f.type in (FrameType.CSI, FrameType.CSI_GAIN)]
        assert csi and all(f.type == (FrameType.CSI_GAIN if report else FrameType.CSI) for f in csi)
        pkts = [decode_packet(f) for f in csi]
        assert all(isinstance(p, CsiPacket) and len(p.raw) == 128 for p in pkts)
        assert all((p.gain_comp_db is not None) == report for p in pkts)
