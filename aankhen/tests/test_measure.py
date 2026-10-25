"""Measure my room: validation and the room.json merge (measure.py)."""
import json
import os

import pytest

from aankhen import measure
from aankhen.room import Room


def good_form(**over):
    f = {"width": 4.2, "depth": 3.15, "height": 2.85,
         "bed": {"x": 1.53, "y": 0.0, "w": 2.08, "d": 2.1},
         "desk": {"x": 0.0, "y": 1.25, "w": 0.48, "d": 1.43},
         "wardrobe": {"x": 0.05, "y": 2.75, "w": 1.37, "d": 0.4},
         "door": {"wall": "north", "offset": 3.0, "width": 0.9},
         "balcony_door": {"wall": "east", "offset": 0.5, "width": 1.0},
         "board": {"x": 0.3, "y": 1.9, "z": 0.85},
         "router": {"x": -5.8, "y": -3.5, "z": 1.0}}
    f.update(over)
    return f


def fields(form):
    return {e["field"] for e in measure.validate(form)}


def test_good_form_validates():
    assert measure.validate(good_form()) == []


@pytest.mark.parametrize("over,field", [
    ({"width": "abc"}, "width"),
    ({"width": 420}, "width"),                                    # centimetres
    ({"height": 1.0}, "height"),
    ({"bed": {"x": 3.0, "y": 0.0, "w": 2.08, "d": 2.1}}, "bed.x"),  # past the east wall
    ({"desk": {"x": 0.0, "y": 1.25, "w": 0.05, "d": 1.43}}, "desk.w"),
    ({"desk": {"x": 1.6, "y": 0.2, "w": 1.0, "d": 1.0}}, "desk.x"),  # overlaps the bed
    ({"door": {"wall": "up", "offset": 1, "width": 0.9}}, "door.wall"),
    ({"door": {"wall": "north", "offset": 3.8, "width": 0.9}}, "door.offset"),
    ({"door": {"wall": "north", "offset": 1.0, "width": 3.0}}, "door.width"),
    ({"board": {"x": 0.3, "y": 1.9, "z": 3.5}}, "board.z"),
    ({"board": {"x": 6.0, "y": 1.9, "z": 0.8}}, "board.x"),
    ({"router": {"x": 0.35, "y": 1.95, "z": 0.85}}, "router.x"),   # 7 cm from the board
    ({"router": {"x": 500, "y": 0, "z": 1}}, "router.x"),
])
def test_each_bad_field_is_named(over, field):
    assert field in fields(good_form(**over))


def test_missing_required_items():
    f = good_form()
    del f["bed"], f["board"]
    assert {"bed", "board"} <= fields(f)


def test_apply_keeps_the_rest_and_marks_measured():
    old = {"name": "bedroom", "measured": False, "width": 4.0, "depth": 3.0, "height": 2.8,
           "zones": [{"name": "floor", "polygon": [[0, 0], [1, 0], [1, 1]]},
                     {"name": "desk", "polygon": [[0, 0], [1, 0], [1, 1]], "facing_deg": 180.0}],
           "furniture": [{"name": "drawers", "x": 3.6, "y": 2.7, "w": 0.5, "d": 0.4, "h": 0.75}],
           "sensors": [{"id": "esp32", "kind": "esp32", "x": 1, "y": 1, "z": 1}],
           "links": [["router", "esp32"]], "house": {"areas": [], "fixtures": [], "note": "kept"}}
    d = measure.apply(good_form(), old)
    assert d["measured"] is True and d["width"] == 4.2 and d["house"]["note"] == "kept"
    names = {z["name"] for z in d["zones"]}
    assert {"floor", "desk", "bed", "door", "balcony door"} <= names
    desk = next(z for z in d["zones"] if z["name"] == "desk")
    assert desk["facing_deg"] == 180.0                       # old attributes survive
    xs = [p[0] for p in desk["polygon"]]
    assert max(xs) == pytest.approx(0.48 + measure.CHAIR_M)  # chair space away from the west wall
    door = next(z for z in d["zones"] if z["name"] == "door")
    assert door["is_exit"] and min(p[1] for p in door["polygon"]) == pytest.approx(3.15 - measure.DOOR_DEPTH_M)
    assert {f["name"] for f in d["furniture"]} == {"drawers", "bed", "desk", "wardrobe"}
    s = {x["id"]: x for x in d["sensors"]}
    assert s["esp32"]["z"] == 0.85 and s["router"]["x"] == -5.8
    Room.from_dict(d)


def test_apply_refuses_an_invalid_form():
    with pytest.raises(ValueError):
        measure.apply(good_form(width=0))


def test_save_backs_up_and_writes(tmp_path):
    p = tmp_path / "room.json"
    p.write_text(json.dumps({"name": "x", "measured": False, "width": 4, "depth": 3, "height": 2.8}))
    measure.save(good_form(), str(p))
    assert json.loads(p.read_text())["measured"] is True
    assert any(n.startswith("room.json.bak-") for n in os.listdir(tmp_path))


def test_form_from_room_prefills():
    d = measure.apply(good_form())
    f = measure.form_from_room(d)
    assert f["width"] == 4.2 and f["bed"]["w"] == 2.08 and f["board"]["z"] == 0.85 and f["measured"]
