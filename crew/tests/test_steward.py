"""The steward with injected checks: events only when a check's health changes, problems
named first, a broken check never stops the others. Plus its two real probes: transcript
errors in the last hour, and an HTTP check against a throwaway local server."""
import json
import threading
from datetime import datetime
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import pytest

from crew.agents.steward import RecentErrors, Steward, ollama_answers

NOW = datetime(2026, 10, 12, 12, 0).timestamp()          # local noon: the last hour is all in one day file


class Checks:
    def __init__(self):
        self.ollama = True
        self.aankhen = {"mode": "hardware", "rate_hz": 262.4, "rssi": -67, "csi": "live"}
        self.errors = (0, None)
        self.core = {"running": True, "state": "sleeping", "mode": "voice", "exit_code": None}


@pytest.fixture
def checks():
    return Checks()


@pytest.fixture
def steward(checks):
    return Steward(ollama=lambda: checks.ollama, aankhen=lambda: checks.aankhen,
                   errors=lambda now: checks.errors, core=lambda: checks.core, clock=lambda: NOW)


def events(s):
    return [(e["kind"], e["text"]) for e in s.board.since(0)]


def test_all_fine_at_the_first_look_is_not_news(steward):
    assert steward.run(NOW)
    assert events(steward) == []
    assert steward.summary == "All systems normal."
    assert steward.context_line() == "Systems: Ollama ok; Aankhen live, 262 packets/s."
    assert steward.urgent is False
    d = steward.data
    assert d["problems"] == [] and d["checks"]["aankhen"]["rssi"] == -67 and d["checks"]["core"]["ok"] is True


def test_ollama_going_down_and_back_posts_once_each_way(steward, checks):
    steward.run(NOW)
    checks.ollama = False
    steward.run(NOW + 10)
    steward.run(NOW + 20)                                # still down: nothing new
    assert events(steward) == [("ollama_down", "Ollama stopped answering: replies will fail until it is back")]
    assert steward.summary == "Ollama isn't answering: replies will fail until it is back."
    assert steward.context_line() == ("Systems: PROBLEM: Ollama not answering. Fine: Aankhen live, 262 packets/s.")
    assert steward.urgent is True
    assert steward.data["checks"]["ollama"]["since"] == NOW + 10
    checks.ollama = True
    steward.run(NOW + 30)
    assert events(steward)[-1] == ("ollama_up", "Ollama is answering again")
    assert len(events(steward)) == 2 and steward.summary == "All systems normal."


def test_a_problem_at_the_first_look_is_news(steward, checks):
    checks.errors = (3, "[WinError 10061] No connection could be made")
    steward.run(NOW)
    assert events(steward) == [("errors", "3 errors in the last hour; most often: [WinError 10061] No connection "
                                          "could be made")]
    assert steward.context_line().startswith("Systems: PROBLEM: 3 errors in the last hour (most often: [WinError")
    checks.errors = (0, None)
    steward.run(NOW + 10)
    assert events(steward)[-1] == ("errors_cleared", "No errors in the last hour any more")


def test_aankhen_silent_is_a_problem_but_a_mode_change_is_not(steward, checks):
    steward.run(NOW)
    checks.aankhen = {"mode": "simulation"}
    steward.run(NOW + 10)
    checks.aankhen = None                                # the hub stopped
    steward.run(NOW + 20)
    assert events(steward) == [] and steward.context_line() == "Systems: Ollama ok; Aankhen off."
    checks.aankhen = {"mode": "hardware", "rate_hz": 262.4, "rssi": -67, "csi": "silent"}   # the rate is stale
    steward.run(NOW + 30)
    assert events(steward)[-1][0] == "aankhen_silent"
    assert "sending no Wi-Fi data" in steward.summary
    checks.aankhen = {"mode": "hardware", "rate_hz": 255.0, "rssi": -70, "csi": "live"}
    steward.run(NOW + 40)
    assert events(steward)[-1] == ("aankhen_back", "Back to normal: Aankhen live, 255 packets/s")


def test_jarvis_exiting_with_an_error_code_is_a_problem_but_a_normal_stop_is_not(steward, checks):
    steward.run(NOW)
    checks.core = {"running": False, "state": "offline", "exit_code": 1}            # stop() in voice mode
    steward.run(NOW + 10)
    assert events(steward) == []
    checks.core = {"running": False, "state": "offline", "exit_code": 3}
    steward.run(NOW + 20)
    assert events(steward) == [("core_crashed", "JARVIS exited with code 3: he is down until he is started again")]
    assert steward.context_line().startswith("Systems: PROBLEM: JARVIS exited with code 3.")
    checks.core = {"running": True, "state": "booting", "mode": "voice"}
    steward.run(NOW + 30)
    assert events(steward)[-1] == ("core_back", "Back to normal: JARVIS booting (voice)")


def test_a_check_that_raises_is_unknown_and_the_others_still_run(checks):
    def broken():
        raise ConnectionError("probe exploded")
    s = Steward(ollama=broken, aankhen=lambda: checks.aankhen, errors=lambda now: (2, "TTS failed"),
                core=None, clock=lambda: NOW)
    assert s.run(NOW)                                    # the tick itself did not fail
    assert s.data["checks"]["ollama"] == {"ok": None, "text": "ollama unknown (the check failed: ConnectionError)",
                                          "since": None}
    assert "core" not in s.data["checks"]                # no JARVIS process to watch here
    assert events(s) == [("errors", "2 errors in the last hour; most often: TTS failed")]
    ok = Steward(ollama=broken, aankhen=lambda: checks.aankhen, errors=lambda now: (0, None), clock=lambda: NOW)
    ok.run(NOW)
    assert ok.summary == "No problems seen, but I could not check ollama."


def test_recent_errors_counts_the_last_hour_and_names_the_commonest(tmp_path):
    day = tmp_path / f"{datetime.fromtimestamp(NOW):%Y-%m-%d}.jsonl"
    long = "Ollama request failed: " + "x" * 200
    rows = [{"kind": "error", "session": "s", "ts": NOW - 600, "message": long},
            {"kind": "error", "session": "s", "ts": NOW - 300, "message": long},
            {"kind": "error", "session": "s", "ts": NOW - 1800, "message": "mic   disconnected"},
            {"kind": "error", "session": "s", "ts": NOW - 7200, "message": "an old one"},
            {"kind": "turn", "session": "s", "id": 1, "role": "you", "ts": NOW - 60, "text": "\"error\" error"}]
    day.write_text("\n".join(json.dumps(r) for r in rows) + "\n{torn", encoding="utf-8")
    errors = RecentErrors(tmp_path)
    assert errors(NOW) == (3, long[:80])
    with open(day, "a", encoding="utf-8") as f:          # the file changed: it is read again
        f.write("\n" + "\n".join(json.dumps({"kind": "error", "session": "s", "ts": NOW - 5, "message": m})
                                 for m in ["mic disconnected"] * 3) + "\n")
    assert errors(NOW) == (6, "mic disconnected")
    assert RecentErrors(tmp_path / "nothing")(NOW) == (0, None)


class _Version(BaseHTTPRequestHandler):
    def do_GET(self):
        body = b'{"version":"0.0.0-test"}'
        self.send_response(200 if self.path == "/api/version" else 404)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *args):
        pass


def test_the_http_probe_against_a_throwaway_server():
    server = ThreadingHTTPServer(("127.0.0.1", 0), _Version)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    port = server.server_address[1]
    try:
        assert ollama_answers(f"http://127.0.0.1:{port}/api/version") is True
        assert ollama_answers(f"http://127.0.0.1:{port}/elsewhere") is False
    finally:
        server.shutdown()
        server.server_close()
    assert ollama_answers(f"http://127.0.0.1:{port}/api/version") is False       # nobody listening now
