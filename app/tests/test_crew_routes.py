"""/api/crew end to end, in-process: the crew starts and stops with the app, its agents
read this app's own sources (the scratch JARVIS_DATA_DIR, never data/app), notable events
reach the bus, and nothing here probes the real Ollama or opens a serial port."""
import time
import types

import pytest
from starlette.testclient import TestClient

from jarvis_app import routes_crew
from jarvis_app.bus import EventBus
from jarvis_app.paths import DATA
from jarvis_app.security import Guard
from jarvis_app.server import create_app

TOKEN = "test-token-crew"
HEADER = "YOUR STAFF (live agents; estimates, not certainties):"


@pytest.fixture
def ollama(monkeypatch):
    """The steward's Ollama probe, faked: up until a test says otherwise."""
    state = {"up": True}
    monkeypatch.setattr(routes_crew, "ollama_answers", lambda: state["up"])
    return state


@pytest.fixture
def client(ollama):
    app = create_app(Guard(8779, TOKEN, extra_hosts=["testserver"]), autostart_aankhen="off")
    with TestClient(app) as c:
        c.headers.update({"X-Jarvis-Token": TOKEN})
        yield c


def crew_events(client, kind):
    return [e for e in client.app.state.svc.bus.history(300) if e["source"] == "crew" and e["kind"] == kind]


def test_the_crew_needs_the_token(client):
    assert client.get("/api/crew", headers={"X-Jarvis-Token": "nope"}).status_code == 401
    assert client.get("/api/crew/context", headers={"X-Jarvis-Token": ""}).status_code == 401
    assert client.post("/api/crew/ledger/run", headers={"X-Jarvis-Token": "nope"}).status_code == 401


def test_three_agents_with_their_health(client):
    for agent_id in ("movement", "ledger", "steward"):
        assert client.post(f"/api/crew/{agent_id}/run").status_code == 200
    s = client.get("/api/crew").json()
    a = {x["id"]: x for x in s["agents"]}
    assert list(a) == ["movement", "ledger", "steward"]
    assert (a["movement"]["name"], a["movement"]["role"]) == ("Movement watcher",
                                                              "watches how you move through Aankhen's Wi-Fi")
    assert a["ledger"]["name"] == "Task ledger" and a["steward"]["name"] == "Steward"
    assert [a[i]["health"]["cadence_s"] for i in a] == [0.5, 600.0, 10.0]
    for x in s["agents"]:
        assert set(x["health"]) == {"runs", "errors", "last_error", "avg_ms", "last_tick", "cadence_s"}
        assert x["health"]["runs"] >= 1 and x["health"]["errors"] == 0 and x["state"] in ("running", "idle")
    assert a["movement"]["state"] == "idle" and a["movement"]["summary"].startswith("Aankhen is off")
    assert a["movement"]["data"]["cannot_see"].startswith("fingers, elbow or knee angles")
    assert isinstance(s["events"], list) and len(s["events"]) <= 40
    assert client.post("/api/crew/nobody/run").status_code == 404


def test_the_block_for_jarvis_with_aankhen_off(client):
    client.post("/api/crew/movement/run")
    client.post("/api/crew/steward/run")
    ctx = client.get("/api/crew/context").json()
    assert set(ctx) == {"text", "lines", "live"} and set(ctx["lines"]) == {"movement", "ledger", "steward"}
    assert ctx["lines"]["movement"] == "Movement: Aankhen is off, so you cannot see the room."
    assert "Ollama ok" in ctx["lines"]["steward"] and "Aankhen off" in ctx["lines"]["steward"]
    assert ctx["text"].startswith(HEADER + "\n") and ctx["lines"]["movement"] in ctx["text"]
    assert len(ctx["text"]) <= 600 and ctx["live"] == []          # nothing in it is a live sensor reading


def test_the_ledger_counts_this_apps_transcripts_and_keeps_no_text(client, data_dir):
    store = client.app.state.svc.core.transcripts
    now = time.time()
    asked = ["batti band karo", "turn off the light please", "pankha chalu karo"]
    for i, text in enumerate(asked):
        store.record_turn("crew-test", {"id": 2 * i + 1, "role": "you", "text": text, "t": now - 30 + i}, "voice", {})
        store.record_turn("crew-test", {"id": 2 * i + 2, "role": "jarvis", "text": "Done.", "t": now - 29 + i,
                                        "seconds": 0.8}, "voice", {"reply": 0.8})
    entry = client.post("/api/crew/ledger/run").json()
    room = next(f for f in entry["data"]["families"] if f["id"] == "room")
    assert room["count"] >= 3 and room["candidate"] is True and room["median_s"] == 0.8
    assert DATA == data_dir and routes_crew.CREW_DATA == data_dir / "crew"     # the scratch folder, not data/app
    saved = (data_dir / "crew" / "ledger.json").read_text(encoding="utf-8").lower()
    shown = client.get("/api/crew").text.lower() + client.get("/api/crew/context").text.lower()
    for text in asked:
        assert text not in saved and text not in shown
    ev = [e for e in crew_events(client, "candidate") if e["family"] == "room"]
    assert ev and ev[-1]["agent"] == "ledger" and ev[-1]["sim"] is False and ev[-1]["exists"] is False


def test_steward_events_reach_the_bus_and_the_board(client, ollama):
    client.post("/api/crew/steward/run")
    ollama["up"] = False
    entry = client.post("/api/crew/steward/run").json()
    assert entry["data"]["checks"]["ollama"]["ok"] is False and entry["state"] == "running"
    assert entry["summary"].startswith("Ollama isn't answering")
    ev = crew_events(client, "ollama_down")
    assert len(ev) == 1 and ev[0]["agent"] == "steward" and ev[0]["check"] == "ollama" and ev[0]["sim"] is False
    assert ev[0]["text"] == "Ollama stopped answering: replies will fail until it is back"
    ctx = client.get("/api/crew/context").json()
    assert ctx["text"].split("\n")[1].startswith("Systems: PROBLEM: Ollama not answering")   # problems first
    board = client.get("/api/crew/events", params={"since": 0}).json()["events"]
    mine = [e for e in board if e["agent"] == "steward"]
    assert mine[-1]["kind"] == "ollama_down" and mine[-1]["data"]["check"] == "ollama"
    newer = client.get("/api/crew/events", params={"since": mine[-1]["id"]}).json()["events"]
    assert all(e["id"] > mine[-1]["id"] for e in newer) and not [e for e in newer if e["agent"] == "steward"]


def test_errors_in_the_transcripts_reach_the_steward(client):
    client.app.state.svc.core.transcripts.record_error("crew-test", "synthetic failure for the crew test")
    entry = client.post("/api/crew/steward/run").json()
    assert entry["data"]["checks"]["errors"]["count"] >= 1
    assert crew_events(client, "errors")                          # a first-look problem, or a change: news either way


def test_the_crew_starts_and_stops_with_the_app(ollama):
    app = create_app(Guard(8779, TOKEN, extra_hosts=["testserver"]), autostart_aankhen="off")
    crew = app.state.svc.crew
    assert not crew.running
    with TestClient(app):
        assert crew.running
    assert not crew.running and {a.state for a in crew.agents} == {"off"}


class FakeHub:
    def __init__(self):
        self.running, self.mode, self.source, self.csi = False, None, None, None
        self.frames = 0

    def frame(self):
        self.frames += 1
        return {"source": self.source, "t": float(self.frames), "csi": {"rate_hz": 262.4, "rssi": -67}}

    def status(self):
        return {"sensors": {"Wi-Fi CSI": {"state": self.csi}}}


def test_the_crew_reads_the_hub_only_while_it_runs(ollama, tmp_path):
    hub = FakeHub()
    core = types.SimpleNamespace(transcripts=types.SimpleNamespace(root=tmp_path / "transcripts"),
                                 info=lambda: {"running": False, "state": "offline", "exit_code": None})
    crew = routes_crew.build_crew(types.SimpleNamespace(hub=hub, core=core), EventBus())
    move, steward = crew.agent("movement"), crew.agent("steward")
    move.run()
    steward.run()
    assert hub.frames == 0                                        # a stopped hub's last frame is never read
    assert move.source is None and steward.data["checks"]["aankhen"]["text"] == "Aankhen off"
    assert steward.data["checks"]["core"]["text"] == "JARVIS offline"
    assert crew.agent("ledger").transcripts == tmp_path / "transcripts"     # the core's own transcript folder
    hub.running, hub.mode, hub.source, hub.csi = True, "simulation", "simulation", "simulated"
    move.run()
    steward.run()
    assert move.source == "simulation" and "simulation" in move.context_line()
    assert steward.data["checks"]["aankhen"]["text"] == "Aankhen in simulation (no real room data)"
    hub.mode, hub.source, hub.csi = "hardware", "hardware", "live"
    steward.run()
    assert steward.context_line() == "Systems: Ollama ok; Aankhen live, 262 packets/s."
    hub.csi = "silent"                                            # the rate is a stale average; liveness says silent
    steward.run()
    assert steward.data["checks"]["aankhen"]["ok"] is False


def test_the_bus_gets_plain_tags_only():
    bus = EventBus()
    routes_crew.bus_sink(bus)({"id": 1, "ts": 0.0, "agent": "movement", "kind": "waved", "text": "Waved at the desk",
                               "data": {"zone": "desk", "p": 0.82, "energy": [1.0, 2.0], "kind": "spoof",
                                        "agent": "spoof"}})
    ev = bus.history(1)[0]
    assert (ev["source"], ev["kind"], ev["text"], ev["agent"], ev["sim"]) == ("crew", "waved", "Waved at the desk",
                                                                               "movement", False)
    assert ev["zone"] == "desk" and ev["p"] == 0.82 and "energy" not in ev
