"""Aankhen drill / belief / zones routes (routes_aankhen_drill.py), on a bare app with a
simulated hub. Nothing here opens a serial port or talks to the running app."""
import json
import os
import time
import types

from fastapi import FastAPI
from fastapi.testclient import TestClient

from jarvis_app import routes_aankhen_drill


def make(hub, relays=None, limbs=None):
    app = FastAPI()
    app.state.guard = types.SimpleNamespace(port=65000, token="test-token")
    svc = types.SimpleNamespace(hub=hub, relays=relays, limbs=limbs, core=types.SimpleNamespace(turns=[]))
    published = []
    bus = types.SimpleNamespace(publish=lambda *a, **k: published.append(a))
    routes_aankhen_drill.register(app, svc, bus)
    return TestClient(app), svc, published


def sim_hub():
    from aankhen.hub import AankhenHub
    from aankhen.room import default_room
    return AankhenHub(room=default_room(), room_measured=False)


def test_belief_zones_and_plan_routes(data_dir):
    hub = sim_hub()
    c, svc, _ = make(hub)
    assert c.get("/api/aankhen/belief").status_code == 404           # not running yet
    z = c.get("/api/aankhen/zones").json()
    assert z["source"] in ("file", "derived") and len(z["zones"]) == 15
    hub.start("simulation", scenario="still")
    try:
        deadline = time.time() + 10
        b = None
        while time.time() < deadline:
            b = c.get("/api/aankhen/belief").json()
            if b.get("zones"):
                break
            time.sleep(0.2)
        assert set(b) == {"state", "confidence", "zones", "motion", "activity", "updated"}
        assert set(b["zones"][0]) == {"id", "name", "p", "x", "y", "r"}
        st = hub.status()
        assert "belief" in st and "honest" in st
        assert "belief" in hub.frame()
    finally:
        hub.stop()
    plan = c.post("/api/aankhen/drill/plan", json={"seed": 3, "minutes": 26}).json()
    assert len(plan["blocks"]) == 20 and plan["blocks"][0]["prompt"]
    assert c.post("/api/aankhen/drill/plan", json={"zones": ["kitchen"]}).status_code == 400
    # the CLI's runtime file: this launch's port and token, in the app's data folder
    rt = json.load(open(os.path.join(str(data_dir), "runtime", "aankhen-api.json")))
    assert rt["base"].endswith(":65000") and rt["token"] == "test-token"


def test_drills_refuse_without_the_real_board_and_confirm_needs_a_drill():
    hub = sim_hub()
    c, _, _ = make(hub)
    assert c.post("/api/aankhen/drill/start", json={}).status_code == 400
    assert c.post("/api/aankhen/drill/confirm", json={"answer": "ok"}).status_code == 400
    assert c.post("/api/aankhen/drill/record", json={"action": "start", "path": "x.akr"}).status_code == 400
    assert c.get("/api/aankhen/drill").json()["state"] == "idle"


def test_fan_reader_and_drill_fan_switch_through_limbs():
    hub = sim_hub()
    relays = types.SimpleNamespace(connected=True, state={"fan": True})
    calls = []

    class Limbs:
        def apply(self, device, action, value=None, origin="app"):
            calls.append((device, action, origin))
            return {"delivered": {"fan": True}, "state": {"fan": {"on": action == "on"}}}
    c, svc, _ = make(hub, relays=relays, limbs=Limbs())
    assert hub.fan_reader() is True
    relays.connected = False
    assert hub.fan_reader() is None
    assert c.post("/api/aankhen/drill/fan", json={"on": False}).json()["ok"] is True
    assert calls == [("fan", "off", "aankhen-drill")]
    svc.core.turns.extend([{"id": 3, "role": "you"}, {"id": 4, "role": "jarvis"}])
    assert hub.voice_reader() == 3


def test_record_paths_stay_inside_the_drill_folder(monkeypatch):
    hub = types.SimpleNamespace(source=types.SimpleNamespace(record_to=lambda p, m: None, stop_recording=lambda: None),
                                mode="hardware", engine=None, room=None, fan_reader=None, voice_reader=None,
                                belief=lambda: None)
    c, _, _ = make(hub)
    r = c.post("/api/aankhen/drill/record", json={"action": "start", "path": "C:/Windows/evil.akr"})
    assert r.status_code == 400
    from aankhen.drill import DRILL_DIR
    ok = c.post("/api/aankhen/drill/record", json={"action": "start",
                                                   "path": os.path.join(DRILL_DIR, "2026-10-15", "s", "raw.akr")})
    assert ok.status_code == 200
    assert c.post("/api/aankhen/drill/record", json={"action": "stop"}).json() == {"recording": None}
