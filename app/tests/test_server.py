"""The HTTP API end to end (in-process, no JARVIS child, no Ollama, no network)."""
from datetime import datetime, timedelta

import pytest
from starlette.testclient import TestClient

from jarvis_app import germoney
from jarvis_app.security import Guard
from jarvis_app.server import create_app

TOKEN = "test-token-123456"


@pytest.fixture(scope="module")
def client():
    guard = Guard(8777, TOKEN, extra_hosts=["testserver"])
    app = create_app(guard, autostart_aankhen="off")
    with TestClient(app) as c:
        c.headers.update({"X-Jarvis-Token": TOKEN})
        yield c


def test_health_is_open_but_the_api_is_not(client):
    assert client.get("/api/health", headers={"X-Jarvis-Token": ""}).status_code == 200
    assert client.get("/api/core", headers={"X-Jarvis-Token": "wrong"}).status_code == 401
    assert client.get("/api/core", headers={"Host": "evil.example"}).status_code == 403
    assert client.get("/api/core").status_code == 200


def test_kv_round_trip(client):
    assert client.put("/api/kv/@silicon_test", json={"value": "{\"a\":1}"}).json() == {"ok": True}
    assert client.get("/api/kv/@silicon_test").json() == {"value": "{\"a\":1}"}
    assert "@silicon_test" in client.get("/api/kv").json()["keys"]
    client.delete("/api/kv/@silicon_test")
    assert client.get("/api/kv/@silicon_test").json() == {"value": None}
    # A traversal key never reaches storage: Starlette normalises the path before
    # routing (405 from the static mount), or the key check refuses it (400).
    assert client.put("/api/kv/..%2Fescape", json={"value": "x"}).status_code in (400, 404, 405)
    assert client.put("/api/kv/a%5Cb", json={"value": "x"}).status_code == 400


def test_limbs_work_without_jarvis_running(client):
    r = client.post("/api/limbs/light", json={"action": "set", "value": 55})
    assert r.status_code == 200 and r.json()["state"]["light"] == {"on": True, "level": 55}
    assert client.post("/api/limbs/scene/sleep").json()["state"]["light"]["on"] is False
    assert client.post("/api/limbs/toaster", json={"action": "on"}).status_code == 400
    v = client.get("/api/limbs").json()
    assert v["usb"] is False and v["devices"][0]["link"] == "virtual"


def test_transcript_flag_and_export(client):
    svc = client.app.state.svc
    svc.core.transcripts.record_turn("api", {"id": 1, "role": "you", "text": "hi", "t": 0}, "text", {})
    assert client.post("/api/transcripts/flag", json={"session": "api", "id": 1, "verdict": "misheard"}).status_code == 200
    assert client.post("/api/transcripts/flag", json={"session": "api", "id": 1, "verdict": "meh"}).status_code == 400
    r = client.post("/api/transcripts/export", json={"days": 1}).json()
    assert r["name"].startswith("review-") and r["name"].endswith(".md")


def test_open_only_known_folders(client):
    assert client.post("/api/open", json={"which": "C:/Windows"}).status_code == 404


def test_ai_unavailable_is_a_503_the_ui_can_fall_back_from(client, monkeypatch):
    def down(*_a, **_k):
        raise RuntimeError("no model")
    monkeypatch.setattr(germoney, "generate", down)
    assert client.post("/api/germoney/ai/quests", json={"level": 0}).status_code == 503


def test_calendar_block_and_ics(client):
    start = (datetime.now() + timedelta(hours=2)).isoformat(timespec="minutes")
    b = client.post("/api/germoney/calendar/block", json={"title": "Verilog", "start": start, "minutes": 60}).json()
    ics = client.get(f"/api/germoney/calendar/block/{b['id']}.ics")
    assert ics.status_code == 200 and "SUMMARY:Verilog" in ics.text
    assert client.get("/api/germoney/calendar/block/nope.ics").status_code == 404


def test_core_say_refuses_when_jarvis_is_asleep(client):
    assert client.post("/api/core/say", json={"text": "hello"}).status_code == 409


def test_export_import_backup(client):
    client.put("/api/kv/@silicon_logs_v1", json={"value": "[]"})
    dump = client.get("/api/germoney/export").json()
    assert dump["@silicon_logs_v1"] == "[]"
    assert client.post("/api/germoney/import", json=dump).json()["imported"] >= 1


def test_teaching_a_correction(client, monkeypatch):
    from jarvis_app import memory
    taught = []
    monkeypatch.setattr(memory, "teach", lambda q, a: taught.append((q, a)) or len(taught) == 1)
    r = client.post("/api/memory/teach", json={"question": "what is my genre?", "answer": "Synthwave."})
    assert r.status_code == 200 and r.json() == {"ok": True, "added": True}
    assert taught == [("what is my genre?", "Synthwave.")]
    assert client.post("/api/memory/teach", json={"answer": "Synthwave."}).json()["added"] is False


def test_teaching_needs_an_answer(client):
    assert client.post("/api/memory/teach", json={"question": "q", "answer": "  "}).status_code == 400
    assert client.post("/api/memory/teach", json={"question": "q"}).status_code == 422


def test_teach_from_the_app_records_labels_and_refuses_when_aankhen_is_off(client, tmp_path):
    hub = client.app.state.svc.hub
    hub.stop()
    assert client.post("/api/aankhen/teach/start").status_code == 400      # nothing to record yet
    hub.recordings_dir = tmp_path                                          # never the real recordings
    assert client.post("/api/aankhen/start", json={"mode": "simulation", "scenario": "still"}).status_code == 200
    try:
        import time
        deadline = time.time() + 20
        while hub.engine is None or hub.engine.device_t is None:
            assert time.time() < deadline
            time.sleep(0.2)
        s = client.post("/api/aankhen/teach/label", json={"label": "desk"}).json()
        assert s["recording"] and s["simulated"] and s["current"]["label"] == "desk"
        assert client.post("/api/aankhen/teach/label", json={"label": "sofa"}).status_code == 400
        s = client.post("/api/aankhen/teach/stop").json()
        assert not s["recording"]
        # A simulator session is practice: it is named teach-sim-* and counts nowhere.
        assert [p.name for p in tmp_path.glob("teach-*.akr")][0].startswith("teach-sim-")
        assert s["totals"]["desk"] == 0
        assert client.get("/api/aankhen/teach").json()["training"]["state"] == "idle"
    finally:
        hub.stop()
