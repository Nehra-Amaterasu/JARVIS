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


def test_radar_straight_ahead_no_tilt():
    r = Room()
    s = SensorPose("r", "ld2450", 1.0, 0.0, 1.0, yaw_deg=90, pitch_deg=0)
    x, y = r.radar_to_room(s, 0.0, 2.0)                      # 2 m straight ahead
    assert math.isclose(x, 1.0, abs_tol=1e-9) and math.isclose(y, 2.0, abs_tol=1e-9)


def test_radar_lateral_is_to_the_right_of_boresight():
    r = Room()
    s = SensorPose("r", "ld2450", 1.0, 0.0, 1.0, yaw_deg=90)   # facing +y
    x, y = r.radar_to_room(s, 0.5, 2.0)                      # +x = sensor's right
    assert math.isclose(x, 1.5, abs_tol=1e-9)                 # right of +y is +x
    assert math.isclose(y, 2.0, abs_tol=1e-9)


def test_radar_tilt_shortens_ground_distance():
    r = Room()
    s = SensorPose("r", "ld2450", 0.0, 0.0, 2.0, yaw_deg=0, pitch_deg=30)
    x, _ = r.radar_to_room(s, 0.0, 2.0)
    assert math.isclose(x, 2.0 * math.cos(math.radians(30)), rel_tol=1e-9)


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
