"""Simulator tests: the answer key must itself be right before it grades anything."""
import math

import numpy as np

from aankhen.protocol import CsiPacket, RadarPacket, StatusPacket, StreamDecoder, decode_packet
from aankhen.radar import parse_frame, to_room
from aankhen.room import default_room
from aankhen.simulator import SCENARIOS, POSTURE_HEIGHT, RadarModel, Simulator, TruthState


def _decode_all(sim, seconds):
    dec, pkts = StreamDecoder(), []
    for ch in sim.chunks(seconds):
        pkts += [decode_packet(f) for f in dec.feed(ch)]
    pkts += [decode_packet(f) for f in dec.flush()]
    return dec, pkts


def test_output_is_valid_wire_format_and_corruption_is_caught():
    sim = Simulator(scenario=SCENARIOS["walk"](), seed=3, corrupt=0.01)
    dec, pkts = _decode_all(sim, 10)
    csi = [p for p in pkts if isinstance(p, CsiPacket)]
    radar = [p for p in pkts if isinstance(p, RadarPacket)]
    status = [p for p in pkts if isinstance(p, StatusPacket)]
    assert 850 < len(csi) < 1000                      # ~100 Hz minus ~3 % loss
    assert 90 <= len(radar) <= 101 and len(status) >= 9
    assert all(len(p.raw) == 128 and p.first_word_invalid == 1 for p in csi)
    assert dec.stats.crc_errors >= 1                    # corrupted frames rejected...
    assert dec.stats.crc_errors <= sim.stats.corrupted  # ...and only those
    for p in radar:
        parse_frame(p.raw)                              # every radar payload is a valid LD2450 frame


def test_same_seed_same_bytes():
    a = b"".join(Simulator(seed=5).chunks(3))
    b = b"".join(Simulator(seed=5).chunks(3))
    assert a == b


def test_evening_script_truth():
    sim = Simulator(scenario=SCENARIOS["evening"]())
    assert sim.truth_at(1.0) == []                      # empty before A enters
    at_desk = sim.truth_at(20.0)
    assert len(at_desk) == 1 and at_desk[0].posture == "seated" and not at_desk[0].moving
    assert math.dist((at_desk[0].x, at_desk[0].y), (0.8, 0.95)) < 1e-9
    assert sim.truth_at(100.0) == []                    # both have left
    assert len(sim.truth_at(100.0 + 110.0 - 90.0)) == 1  # the script loops every 110 s


def test_radar_model_projects_to_the_true_position():
    """A standing, moving person straight ahead of the radar must decode back to
    where they are, through room_to_radar -> LD2450 bytes -> to_room."""
    room = default_room()
    s = room.sensor("radar")
    rng = np.random.default_rng(0)
    model = RadarModel(room, s, rng, sigma_lateral=0.0, sigma_forward=0.0, ghost_p=0, mirror_p=0)
    truth = TruthState("A", 0.8, 2.0, 0.5, 0.0, "standing", True, 14.0)
    errs = []
    for _ in range(50):
        from aankhen.radar import build_frame
        dets = parse_frame(build_frame(model.observe([truth])))
        for d in to_room(room, s, dets):
            errs.append(math.dist((d.x, d.y), (truth.x, truth.y)))
    assert errs and np.median(errs) < 0.08              # only the body-wander term remains


def test_still_people_are_detected_less_often():
    room = default_room()
    model = RadarModel(room, room.sensor("radar"), np.random.default_rng(1), ghost_p=0, mirror_p=0)
    walking = TruthState("A", 0.8, 2.0, 0.6, 0.0, "standing", True, 14.0)
    lying = TruthState("A", 0.8, 2.0, 0.0, 0.0, "lying", False, 14.0)
    hits = lambda p: sum(bool(model.observe([p])) for _ in range(400)) / 400
    assert hits(walking) > 0.9 and hits(lying) < 0.35


def test_posture_heights_are_shared_with_the_pipeline():
    from aankhen.room import TORSO_HEIGHT_M
    assert POSTURE_HEIGHT is TORSO_HEIGHT_M
