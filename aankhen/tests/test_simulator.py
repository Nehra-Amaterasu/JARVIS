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


def test_the_original_scenarios_are_unchanged_by_the_world_effects():
    """The opt-in effects must not touch the original scenarios' byte streams — their
    benchmark numbers are the reference every later change is compared with."""
    for name in ("evening", "walk", "still", "empty"):
        sim = Simulator(scenario=SCENARIOS[name](), seed=5)
        assert sim.fan is None and sim.csi.drift is None
        assert sim.radar.still_loss_s is None and sim.radar.merge_m is None
        assert all(not tl.fidgets and not tl.sighs for tl in sim.timelines)
        assert b"relays" not in b"".join(sim.chunks(2))


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


# ------------------------------------------------------------ world effects
def test_nobody_outside_the_room_is_an_occupant_or_a_radar_target():
    sim = Simulator(scenario=SCENARIOS["hallway"](), seed=1)
    assert len(sim.truth_at(30.0)) == 1 and sim.occupants_at(30.0) == []
    room = default_room()
    model = RadarModel(room, room.sensor("radar"), np.random.default_rng(0), ghost_p=0, mirror_p=0)
    outside = TruthState("N", -1.0, 2.0, 0.8, 0.0, "standing", True, 14.0)   # behind the wall
    assert all(model.observe([outside]) == [] for _ in range(50))


def test_radar_forgets_a_still_body_after_still_loss_s():
    room = default_room()
    model = RadarModel(room, room.sensor("radar"), np.random.default_rng(2), ghost_p=0, mirror_p=0,
                       still_loss_s=8.0)
    still = TruthState("A", 0.8, 2.0, 0.0, 0.0, "seated", False, 14.0)
    early = sum(bool(model.observe([still], 0.1 * i)) for i in range(70))        # 0-7 s
    late = sum(bool(model.observe([still], 10.0 + 0.1 * i)) for i in range(300))  # 10-40 s
    assert early > 20 and late == 0
    fidget = TruthState("A", 0.8, 2.0, 0.05, 0.0, "seated", True, 14.0)
    assert sum(bool(model.observe([fidget], 41.0 + 0.1 * i)) for i in range(10)) >= 8


def test_bodies_closer_than_the_resolution_merge_into_one_target():
    room = default_room()
    model = RadarModel(room, room.sensor("radar"), np.random.default_rng(3), ghost_p=0, mirror_p=0,
                       merge_m=0.6)
    a = TruthState("A", 2.6, 2.4, 0.3, 0.0, "standing", True, 14.0)
    b = TruthState("B", 3.05, 2.4, 0.3, 0.0, "standing", True, 14.0)
    assert max(len(model.observe([a, b])) for _ in range(50)) == 1


def test_fan_relay_is_reported_and_the_fan_spins_up():
    sim = Simulator(scenario=SCENARIOS["fan"](), seed=1)
    dec, pkts = _decode_all(sim, 12)
    relays = [(p.timestamp_us, p.fields.get("relays")) for p in pkts if isinstance(p, StatusPacket)]
    assert relays[0][1] == {"light": False, "fan": False}           # 0.5 s: still off
    assert relays[-1][1] == {"light": False, "fan": True}           # on at 3 s
    assert sim.fan.spinning and sim.fan.rps > 3.0


def test_fidgets_are_movement_in_the_answer_key():
    sim = Simulator(scenario=SCENARIOS["sleep"](), seed=1)
    tl = sim.timelines[0]
    assert tl.fidgets, "the sleep script should contain fidgets"
    fg = tl.fidgets[0]
    during = sim.truth_at(fg.t0 + fg.dur / 2)[0]
    before = sim.truth_at(fg.t0 - 1.0)[0]
    assert during.moving and not before.moving and before.posture == "lying"
    assert before.chest_m is not None and abs(before.chest_m) <= 0.0045 * 2.5
