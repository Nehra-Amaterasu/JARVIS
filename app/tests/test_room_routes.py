"""Measure my room + readiness routes (aankhen/server.py attach_room_routes) inside the
real app: they need the per-launch token like every /api/ route, and a save flips the
layout to measured. Files go to a tmp folder, never data/aankhen."""
import json

import pytest
from starlette.testclient import TestClient

import aankhen
import aankhen.room
from jarvis_app.security import Guard
from jarvis_app.server import create_app

TOKEN = "test-token-room"
FORM = {"width": 4.2, "depth": 3.15, "height": 2.85,
        "bed": {"x": 1.53, "y": 0.0, "w": 2.08, "d": 2.1},
        "desk": {"x": 0.0, "y": 1.25, "w": 0.48, "d": 1.43},
        "door": {"wall": "north", "offset": 3.0, "width": 0.9},
        "board": {"x": 0.3, "y": 1.9, "z": 0.85},
        "router": {"x": -5.8, "y": -3.5, "z": 1.0}}


@pytest.fixture
def client(tmp_path, monkeypatch):
    room = tmp_path / "room.json"
    room.write_text(json.dumps({"name": "est", "measured": False, "width": 4, "depth": 3, "height": 2.8}))
    monkeypatch.setattr(aankhen.room, "ROOM_FILE", str(room))
    monkeypatch.setattr(aankhen, "DATA_DIR", str(tmp_path))
    app = create_app(Guard(8783, TOKEN, extra_hosts=["testserver"]), autostart_aankhen="off", features=[])
    with TestClient(app) as c:
        yield c, room


def test_room_routes_need_the_token(client):
    c, room = client
    for bad in ({}, {"X-Jarvis-Token": "nope"}):
        assert c.get("/api/aankhen/readiness", headers=bad).status_code == 401
        assert c.get("/api/aankhen/room-measure", headers=bad).status_code == 401
        assert c.post("/api/aankhen/room-measure", json=FORM, headers=bad).status_code == 401
    assert json.loads(room.read_text())["measured"] is False      # nothing written


def test_save_flips_the_layout_to_measured(client):
    c, room = client
    h = {"X-Jarvis-Token": TOKEN}
    g = c.get("/api/aankhen/room-measure", headers=h).json()
    assert g["form"]["measured"] is False and not g["readiness"]["ready"]
    bad = c.post("/api/aankhen/room-measure", json={**FORM, "width": 420}, headers=h)
    assert bad.status_code == 422 and bad.json()["detail"]["errors"][0]["field"] == "width"
    r = c.post("/api/aankhen/room-measure", json=FORM, headers=h)
    assert r.status_code == 200 and r.json()["layout"] == "measured"
    assert json.loads(room.read_text())["measured"] is True
    rd = c.get("/api/aankhen/readiness", headers=h).json()
    assert next(i for i in rd["items"] if i["id"] == "layout")["ok"]
    assert c.get("/api/aankhen", headers=h).json()["layout"] == "measured"
