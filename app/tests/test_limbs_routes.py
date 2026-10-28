"""/api/limbs modes, the test click and the presence rule over HTTP (in-process; the Uno
transport is off in tests, JARVIS_UNO=0, so nothing touches a serial port)."""
import pytest
from starlette.testclient import TestClient

from jarvis_app.security import Guard
from jarvis_app.server import create_app

TOKEN = "test-token-limbs-123456"


@pytest.fixture(scope="module")
def client():
    app = create_app(Guard(8777, TOKEN, extra_hosts=["testserver"]), autostart_aankhen="off")
    with TestClient(app) as c:
        c.headers.update({"X-Jarvis-Token": TOKEN})
        yield c


def test_modes_round_trip_over_http(client):
    made = client.post("/api/limbs/modes/new", json={"name": "Night reading", "set": {"light": True, "fan": False}})
    assert made.status_code == 200 and made.json()["id"] == "night_reading"
    try:
        assert client.put("/api/limbs/modes/night_reading", json={"set": {"light": "on", "fan": "on"}}).json()[
            "resolved"] == {"light": True, "fan": True}
        assert client.post("/api/limbs/modes/new", json={"name": "Dim", "set": {"light": 30}}).status_code == 400
        names = [m["name"] for m in client.get("/api/limbs").json()["modes"]]
        assert "Night reading" in names and "Deep focus" in names
        assert client.post("/api/limbs/scene/Night reading").json()["mode"]["id"] == "night_reading"
    finally:
        assert client.delete("/api/limbs/modes/night_reading").status_code == 200
    assert client.delete("/api/limbs/modes/night_reading").status_code == 404


def test_a_test_click_needs_a_connected_board(client):
    assert client.post("/api/limbs/fan/test").status_code == 409      # no board in tests
    assert client.post("/api/limbs/toaster/test").status_code == 404


def test_the_presence_rule_is_visible_and_settable(client):
    v = client.get("/api/limbs/presence-on").json()
    assert v["settings"]["quiet_start"] == "00:30" and v["settings"]["quiet_end"] == "07:00"
    assert v["started"] is False                    # no Uno adopted in tests: it never ran
    r = client.post("/api/limbs/presence-on/settings", json={"enabled": False})
    assert r.status_code == 200 and r.json()["settings"]["enabled"] is False
    assert client.post("/api/limbs/presence-on/settings", json={"quiet_end": "7pm"}).status_code == 400
    client.post("/api/limbs/presence-on/settings", json={"enabled": True})


def test_connect_lists_the_relay_board_not_a_planned_dimmer(client):
    items = {i["id"]: i for i in client.get("/api/connect").json()}
    assert items["relay"]["name"] == "Relay board · ESP32-S3 wall box" and items["relay"]["status"] != "planned"
    assert "ld2450" not in items
