"""JARVIS <-> the Mission game: the voice parser (core/mission.py) and the server
bridge (/api/game/*). The game itself is tested in the UI (vitest)."""
import asyncio
import json
import threading
import time

import pytest
from starlette.testclient import TestClient

from jarvis_app.paths import ensure_jarvis_importable
from jarvis_app.security import Guard
from jarvis_app.server import create_app

ensure_jarvis_importable()
import mission  # noqa: E402  (core/mission.py)

TOKEN = "test-token-game"


@pytest.mark.parametrize("text, action, args", [
    ("log 2 hours of German", "log", {"track": "deutsch", "minutes": 120}),
    ("maine 45 minute verilog kiya", "log", {"track": "silicon", "minutes": 45}),
    ("aaj dedh ghanta german padha", "log", {"track": "deutsch", "minutes": 90}),
    ("studied vlsi for half an hour", "log", {"track": "silicon", "minutes": 30}),
    ("2h verilog done", "log", {"track": "silicon", "minutes": 120}),
    ("gym ho gaya", "log", {"track": "body", "minutes": 45}),
    ("german done", "log", {"track": "deutsch", "minutes": 15}),
    ("Jarvis, brief me", "brief", {}),
    ("aaj kya karna hai", "brief", {}),
    ("how many marks do I have", "marks", {}),
    ("what's my streak", "streak", {}),
    ("redeem an anime episode", "buy", {"query": "anime episode"}),
    ("start a 50 minute focus on German", "focus", {"minutes": 50, "track": "deutsch"}),
])
def test_commands_parse(text, action, args):
    got = mission.parse(text)
    assert got is not None and got["action"] == action
    for k, v in args.items():
        assert got["args"][k] == v


@pytest.mark.parametrize("text", [
    "did I log German today?",           # a question, not an action
    "what is setup time?",
    "ah I did german today",             # "ah" is not a + h = one hour
    "I did german at 7 am",              # "am" is not a + m = one minute
    "buy me some time to think",         # not the Armory
    "tell me about my friend",
    "",
])
def test_non_commands_are_left_to_the_model(text):
    assert mission.parse(text) is None


def test_contract_completion_extracts_the_task_words():
    got = mission.parse("contract done: ripple carry adder")
    assert got["action"] == "complete" and got["args"]["query"] == "ripple carry adder"
    assert got["via"] == "plan" and got["intent"] == "finish"          # the server finishes it: no window needed


@pytest.mark.parametrize("text, intent, args", [
    ("what's today's contract", "today", {}),
    ("Jarvis, what is my contract for today?", "today", {}),
    ("brief me", "today", {}),
    ("explain this contract", "explain", {}),
    ("how do I start this", "explain", {}),
    ("I finished it", "finish", {"query": ""}),
    ("Jarvis, I've just completed that one", "finish", {"query": ""}),
    ("ho gaya", "finish", {"query": ""}),
    ("what's next on the tree?", "next_node", {}),
    ("what should I learn next", "next_node", {}),
    ("exam mode for DSP", "exam_mode", {"subject": "DSP"}),
    ("exam mode on for signals and systems", "exam_mode", {"subject": "signals and systems"}),
    ("exam mode off", "exam_mode", {"subject": None}),
    ("how many days to EMT?", "days_to", {"subject": "EMT"}),
    ("how many days are left until my NAS exam", "days_to", {"subject": "NAS"}),
    ("how many days to exams", "days_to", {"subject": ""}),
    ("kitne din bache IoT exam mein", "days_to", {"subject": "IoT"}),
    ("park an idea: build a GPU in a weekend", "park", {"text": "build a GPU in a weekend"}),
    ("what internship deadlines are coming up", "deadlines", {}),
    ("any application deadlines this month?", "deadlines", {}),
    ("Jarvis, weekly review", "weekly_review", {}),
    ("how did my week go?", "weekly_review", {}),
    ("hafte ka review do", "weekly_review", {}),
    ("what's my next career step?", "career_next", {}),
    ("Jarvis, log: watched a lecture on systolic arrays, 40 min", "learning", {"text": "watched a lecture on systolic arrays", "minutes": 40}),
    ("log: read the Cummings FIFO paper", "learning", {"text": "read the Cummings FIFO paper", "minutes": 0}),
])
def test_plan_intents_parse(text, intent, args):
    got = mission.parse(text)
    assert got is not None and got.get("via") == "plan" and got["intent"] == intent, got
    for k, v in args.items():
        assert got["args"][k] == v


@pytest.mark.parametrize("text, action, via", [
    ("german ho gaya", "log", "plan"),         # a rep's worth of German, not "I finished it"
    ("gym ho gaya", "log", "plan"),
    ("log 2 hours of German", "log", "plan"),  # the one log is the server's: no window needed
    ("what is setup time?", None, None),       # a question for the model
    ("how many marks do I have", "marks", None),
    ("start a 50 minute focus on German", "focus", None),   # the Crucible still runs in the window
])
def test_plan_intents_do_not_steal_other_commands(text, action, via):
    got = mission.parse(text) or {}
    assert got.get("action") == action and got.get("via") == via


def test_plan_intents_go_to_the_server_not_the_window(monkeypatch):
    monkeypatch.setenv("JARVIS_API_URL", "http://x")
    monkeypatch.setenv("JARVIS_API_TOKEN", "t")
    sent = {}
    monkeypatch.setattr(mission, "_post", lambda path, payload, timeout=8.0: sent.update(path=path, payload=payload) or _Resp(200, {"say": "First: HDLBits."}))
    assert mission.handle("what's today's contract") == "First: HDLBits."
    assert sent == {"path": "/api/mission/voice", "payload": {"intent": "today", "args": {}}}
    monkeypatch.setattr(mission, "_post", lambda *a, **k: _Resp(500, {}))
    assert "couldn't" in mission.handle("explain this contract")


def test_outside_the_app_nothing_happens(monkeypatch):
    monkeypatch.delenv("JARVIS_API_URL", raising=False)
    assert mission.handle("log 2 hours of German") is None
    assert mission.context("what should I study today?") == ""


class _Resp:
    def __init__(self, code, body):
        self.status_code, self._b = code, body

    def json(self):
        return self._b


def test_handle_speaks_the_games_answer(monkeypatch):
    monkeypatch.setenv("JARVIS_API_URL", "http://x")
    monkeypatch.setenv("JARVIS_API_TOKEN", "t")
    sent = {}
    monkeypatch.setattr(mission, "_post", lambda path, payload, timeout=8.0: sent.update(path=path, payload=payload) or _Resp(200, {"say": "412 Marks."}))
    assert mission.handle("how many marks do I have") == "412 Marks."
    assert sent["path"] == "/api/game/action" and sent["payload"]["action"] == "marks"
    monkeypatch.setattr(mission, "_post", lambda *a, **k: _Resp(503, {}))
    assert "isn't open" in mission.handle("how many marks do I have")
    assert mission.handle("what is a flip flop") is None        # not a command: the model answers


def test_mission_context_only_when_relevant(monkeypatch):
    monkeypatch.setenv("JARVIS_API_URL", "http://x")
    monkeypatch.setenv("JARVIS_API_TOKEN", "t")
    brief = {"text": "Day 3. Streak 2.", "data": {"boss": {"deliverable": "A 4-bit RCA"}, "contracts": [{"title": "Counters", "done": False}]}}
    monkeypatch.setattr(mission, "_get", lambda path, timeout=0.6: _Resp(200, brief))
    ctx = mission.context("should I study German or Verilog now?")
    assert "MISSION STATE" in ctx and "A 4-bit RCA" in ctx and "Counters" in ctx
    assert mission.context("tell me a joke") == ""


# ------------------------------------------------------------------ the server bridge
@pytest.fixture()
def client():
    app = create_app(Guard(8777, TOKEN, extra_hosts=["testserver"]), autostart_aankhen="off")
    with TestClient(app) as c:
        c.headers.update({"X-Jarvis-Token": TOKEN})
        yield c


def test_no_window_open_means_503(client):
    r = client.post("/api/game/action", json={"action": "brief", "args": {}})
    assert r.status_code == 503


def test_bad_actions_are_refused(client):
    assert client.post("/api/game/action", json={"action": "rm -rf"}).status_code == 400
    assert client.post("/api/game/action", json={"action": "log", "args": [1]}).status_code == 400
    assert client.post("/api/game/result", json={"id": "nope", "ok": True}).status_code == 404


def test_action_round_trip_through_the_ui(client):
    """The server publishes the action; 'the UI' answers; the request returns the line."""
    svc = client.app.state.svc
    svc.bus._subscribers.add(asyncio.Queue())             # a window is open
    published = []
    real = svc.bus.publish
    svc.bus.publish = lambda *a, **k: (published.append(k), real(*a, **k))[1]
    out = {}
    t = threading.Thread(target=lambda: out.update(r=client.post("/api/game/action", json={"action": "log", "args": {"track": "deutsch", "minutes": 30}})))
    t.start()
    for _ in range(100):
        if any("action_id" in p for p in published):
            break
        time.sleep(0.02)
    ev = next(p for p in published if "action_id" in p)
    assert ev["action"] == "log" and ev["args"] == {"track": "deutsch", "minutes": 30}
    assert client.post("/api/game/result", json={"id": ev["action_id"], "ok": True, "say": "Logged 30 minutes of German."}).status_code == 200
    t.join(5)
    assert out["r"].status_code == 200 and out["r"].json()["say"] == "Logged 30 minutes of German."


def test_brief_comes_from_the_store(client):
    assert client.get("/api/game/brief").status_code == 404
    client.put("/api/kv/@silicon_game_brief", json={"value": json.dumps({"text": "Day 1.", "data": {}})})
    assert client.get("/api/game/brief").json()["text"] == "Day 1."


def test_speak_needs_jarvis_awake(client):
    assert client.post("/api/core/speak", json={"text": "Floor not secured."}).status_code == 409


@pytest.mark.parametrize("text, expected", [
    ("bhai aaj bahut thak gaya hoon, kya karu?", False),   # one generic word is not the mission
    ("I have a job interview", False),
    ("tell me a joke", False),
    ("how is my streak", True),                              # a game word is enough
    ("should I study German or Verilog now?", True),          # two topic words are
    ("aaj exam hai", True),
])
def test_mission_context_is_pulled_in_only_when_relevant(text, expected):
    assert mission.is_about_mission(text) is expected
