import math

import pytest

from aankhen.room import (
    Room, SensorPose, Zone, default_room, point_in_polygon,
)

SQUARE = [[0, 0], [2, 0], [2, 2], [0, 2]]


def test_point_in_polygon_basic():
    assert point_in_polygon(1, 1, SQUARE)
    assert not point_in_polygon(3, 1, SQUARE)
    assert not point_in_polygon(-0.1, 1, SQUARE)


def test_point_in_concave_polygon():
    L = [[0, 0], [3, 0], [3, 1], [1, 1], [1, 3], [0, 3]]      # L-shape
    assert point_in_polygon(0.5, 2.5, L)
    assert not point_in_polygon(2, 2, L)                      # the notch


def test_radar_straight_ahead_body_at_sensor_height():
    r = Room()
    s = SensorPose("r", "ld2450", 1.0, 0.0, 1.1, yaw_deg=90, pitch_deg=0)
    x, y = r.radar_to_room(s, 0.0, 2.0, body_height_m=1.1)   # dh = 0: slant == floor
    assert math.isclose(x, 1.0, abs_tol=1e-9) and math.isclose(y, 2.0, abs_tol=1e-9)


def test_radar_lateral_is_to_the_right_of_boresight():
    r = Room()
    s = SensorPose("r", "ld2450", 1.0, 0.0, 1.1, yaw_deg=90)   # facing +y
    x, y = r.radar_to_room(s, 0.5, 2.0, body_height_m=1.1)   # +x = sensor's right
    assert math.isclose(x, 1.5, abs_tol=1e-9)                 # right of +y is +x
    assert math.isclose(y, 2.0, abs_tol=1e-9)


def test_slant_range_converts_to_floor_distance():
    # Sensor at 1.8 m, standing torso at 1.1 m: dh = 0.7. A reported y of 1.0 m
    # is slant range, so the person is sqrt(1 - 0.49) = 0.714 m away on the floor.
    r = Room()
    s = SensorPose("r", "ld2450", 0.0, 0.0, 1.8, yaw_deg=0, pitch_deg=15)
    x, _ = r.radar_to_room(s, 0.0, 1.0, body_height_m=1.1)
    assert math.isclose(x, math.sqrt(1.0 - 0.49), rel_tol=1e-9)


def test_tilt_does_not_change_the_conversion():
    r = Room()
    a = SensorPose("r", "ld2450", 0.0, 0.0, 1.8, yaw_deg=0, pitch_deg=0)
    b = SensorPose("r", "ld2450", 0.0, 0.0, 1.8, yaw_deg=0, pitch_deg=30)
    assert r.radar_to_room(a, 0.3, 2.5) == r.radar_to_room(b, 0.3, 2.5)


def test_reading_inside_height_offset_clamps_to_zero():
    r = Room()
    s = SensorPose("r", "ld2450", 0.0, 0.0, 1.8, yaw_deg=0)
    x, _ = r.radar_to_room(s, 0.0, 0.5, body_height_m=1.1)   # 0.5 < dh = 0.7
    assert x == 0.0


def test_fov_check():
    r = Room()
    s = SensorPose("r", "ld2450", 0, 0, 1, yaw_deg=0, fov_deg=120, range_m=6)
    assert r.in_fov(s, 3, 0)
    assert r.in_fov(s, 3, 3)                 # 45 deg off boresight, inside 60
    assert not r.in_fov(s, -1, 0)            # behind
    assert not r.in_fov(s, 7, 0)             # beyond range


def test_fresnel_radius_matches_formula():
    r = Room()
    tx = SensorPose("tx", "router", 0, 0, 1)
    rx = SensorPose("rx", "esp32", 8, 0, 1)
    # midpoint of an 8 m link at 2.4 GHz: sqrt(0.1249 * 4 * 4 / 8) ~ 0.50 m
    assert math.isclose(r.fresnel_radius(tx, rx), math.sqrt(0.1249 * 2), rel_tol=1e-6)


def test_default_room_is_valid_and_round_trips(tmp_path):
    room = default_room()
    room.validate()
    p = tmp_path / "room.json"
    room.save(str(p))
    again = Room.load(str(p))
    assert again.width == room.width and len(again.zones) == len(room.zones)
    assert again.zone_at(0.5, 0.5).name == "desk"


def test_invalid_layout_fails_loudly():
    with pytest.raises(ValueError):
        Room.from_dict({"width": 4, "depth": 4, "height": 2.8,
                        "sensors": [{"id": "a", "kind": "esp32", "x": 0, "y": 0, "z": 1}],
                        "links": [["a", "ghost"]]})


@pytest.mark.parametrize("yaw", [0, 37, 90, 180, 251])
def test_room_to_radar_inverts_radar_to_room(yaw):
    """The simulator projects bodies INTO the radar frame with room_to_radar; the
    pipeline projects them back with radar_to_room. If the two disagree, every
    simulated test would be measuring my own geometry bug, not the tracker."""
    r = default_room()
    s = SensorPose("r", "ld2450", 0.8, 0.05, 1.8, yaw_deg=yaw, pitch_deg=15)
    yr = math.radians(yaw)
    for fwd, lat, h in [(1.0, 0.0, 1.1), (2.5, -0.8, 0.7), (0.9, 0.4, 0.45)]:
        x = s.x + fwd * math.cos(yr) + lat * math.sin(yr)
        y = s.y + fwd * math.sin(yr) - lat * math.cos(yr)
        bx, by = r.room_to_radar(s, x, y, body_height_m=h)
        rx, ry = r.radar_to_room(s, bx, by, body_height_m=h)
        assert math.isclose(rx, x, abs_tol=1e-9) and math.isclose(ry, y, abs_tol=1e-9)


def test_default_room_marks_the_door_as_an_exit():
    exits = [z.name for z in default_room().zones if z.is_exit]
    assert exits == ["door"]
