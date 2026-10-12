"""The simulator's scenarios run in the room they are given, not in the default one.

Found in the app: on a real 4.2 x 3.15 m room the "sleep" scenario walked to the
default room's bed spot (3.0, 3.0), which in that room is the balcony door. Each
scenario now finds its spots from the room's zones; without a room it keeps the
default room's spots, which the benchmarks are measured on."""
import numpy as np

from aankhen.bench import calibrate_from_bytes
from aankhen.learn import FeatureStream
from aankhen.room import Area, Fixture, House, Room
from aankhen.simulator import SCENARIOS, Simulator, places

ROOM = Room.from_dict({
    "name": "test bedroom", "width": 4.2, "depth": 3.15, "height": 2.85, "measured": False,
    "zones": [
        {"name": "desk", "polygon": [[0.45, 1.35], [1.15, 1.35], [1.15, 2.55], [0.45, 2.55]], "posture": "seated"},
        {"name": "bed", "polygon": [[1.53, 0.0], [3.61, 0.0], [3.61, 2.1], [1.53, 2.1]], "posture": "lying"},
        {"name": "door", "polygon": [[0.14, 0.0], [0.98, 0.0], [0.98, 0.75], [0.14, 0.75]], "is_exit": True},
        {"name": "balcony door", "polygon": [[1.46, 2.8], [3.58, 2.8], [3.58, 3.15], [1.46, 3.15]], "is_exit": True},
        {"name": "floor", "polygon": [[0, 0.75], [1.53, 0.75], [1.53, 2.1], [4.2, 2.1], [4.2, 3.15], [0, 3.15]]},
    ],
    "furniture": [{"name": "wardrobe", "x": 0.05, "y": 2.75, "w": 1.37, "d": 0.4, "h": 2.0}],
    "sensors": [
        {"id": "router", "kind": "router", "x": -5.8, "y": -3.5, "z": 1.0},
        {"id": "esp32", "kind": "esp32", "x": 0.3, "y": 1.9, "z": 0.85},
    ],
    "links": [["router", "esp32"]],
    "house": {"areas": [{"name": "passage", "kind": "passage",
                         "polygon": [[-1.0, -1.2], [6.0, -1.2], [6.0, -0.2], [-1.0, -0.2]]}],
              "fixtures": [{"name": "ceiling fan", "kind": "fan", "x": 2.1, "y": 1.6, "z": 2.7}]},
})
ZONES = {z.name: z for z in ROOM.zones}


def stays(scn):
    """(actor, posture, (x, y)) for every stay in a scenario's scripts."""
    out = []
    for a in scn.actors:
        pos = a.start
        for st in a.steps:
            if st.kind == "walk" and st.to is not None:
                pos = st.to
            elif st.kind == "stay":
                out.append((a.name, st.posture, pos))
    return out


def test_lying_happens_on_the_bed_and_sitting_at_the_desk():
    for name in ("sleep", "evening"):
        lying = [p for _, post, p in stays(SCENARIOS[name](ROOM)) if post == "lying"]
        assert lying and all(ZONES["bed"].contains(*p) for p in lying), name
        assert not ZONES["balcony door"].contains(*lying[0])
    for name in ("still", "evening", "fan"):
        seated = [p for _, post, p in stays(SCENARIOS[name](ROOM)) if post == "seated"]
        assert seated and ZONES["desk"].contains(*seated[0]), name


def test_the_pair_sits_on_the_bed_edge_closer_than_the_radar_can_split():
    pts = [p for _, post, p in stays(SCENARIOS["pair"](ROOM)) if post == "seated"]
    assert len(pts) == 2 and all(ZONES["bed"].contains(*p) for p in pts)
    assert abs(np.hypot(pts[0][0] - pts[1][0], pts[0][1] - pts[1][1]) - 0.45) < 1e-6


def test_people_enter_through_the_door_and_the_hallway_is_outside_the_room():
    for name in ("evening", "sleep", "walk", "pair", "fan", "drift"):
        for a in SCENARIOS[name](ROOM).actors:
            assert ZONES["door"].contains(*a.start), (name, a.name, a.start)
    a = SCENARIOS["hallway"](ROOM).actors[0]
    for x, y in (a.start, a.steps[0].to):
        assert not (0 <= x <= ROOM.width and 0 <= y <= ROOM.depth)
    fan = SCENARIOS["fan"](ROOM).fan
    assert (fan.x, fan.y) == (2.1, 1.6)


def test_without_a_room_the_default_spots_are_unchanged():
    p = places()
    assert p.bed == (3.0, 3.0) and p.chair == (0.8, 0.95) and p.door == (0.4, 3.6)
    lying = [pos for _, post, pos in stays(SCENARIOS["sleep"]()) if post == "lying"]
    assert lying == [(3.0, 3.0)]


def test_calibration_records_the_empty_room_reference_and_streams_start_from_it():
    sim = Simulator(ROOM, SCENARIOS["empty"](ROOM), seed=3)
    b = calibrate_from_bytes(sim.chunks(66.0), sim.boot_us / 1e6)
    assert b.ref is not None and len(b.ref["shape"]) == 6 and b.ref["windows"] >= 10
    fs = FeatureStream(ref=b.ref)
    assert fs.seeded and np.allclose(fs.ref_shape, b.ref["shape"])
    assert not FeatureStream().seeded
