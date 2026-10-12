"""Away mode by voice (core/away_mode.py): what arms, what never does, and replies
built only from the app's answer."""
import pytest

from jarvis_app import paths  # noqa: F401  (puts this checkout's core/ first on sys.path)
import away_mode  # noqa: E402  (core/away_mode.py)


@pytest.mark.parametrize("text", [
    "Jarvis, arm the house", "arm the home please", "I'm leaving, arm the house", "turn on away mode",
    "activate home security", "switch on the security system", "ghar arm kar do", "security on kar do",
    "away mode on", "away mode chalu karo", "arm the alarm",
])
def test_arm_phrases(text):
    assert away_mode.parse(text) == "arm"


@pytest.mark.parametrize("text", [
    "disarm the house", "turn off away mode", "away mode off", "security band kar do", "disable home security",
    "how do I disarm it?",
])
def test_disarm_phrases_are_recognised(text):
    assert away_mode.parse(text) == "disarm"


@pytest.mark.parametrize("text", ["is the house armed?", "is away mode on", "security status", "ghar armed hai?"])
def test_status_phrases(text):
    assert away_mode.parse(text) == "status"


@pytest.mark.parametrize("text", [
    "turn on the house lights", "start the house music", "set an alarm for 7 am", "turn off the alarm",
    "my arm hurts", "what is away mode?", "light band kar do", "start the fan", "alarm laga do subah 6 baje",
    "how do I arm the house?",
])
def test_everyday_sentences_are_not_security_commands(text):
    assert away_mode.parse(text) is None


class _Resp:
    def __init__(self, code, body):
        self.status_code, self._body = code, body

    def json(self):
        return self._body


@pytest.fixture
def api(monkeypatch):
    monkeypatch.setenv("JARVIS_API_URL", "http://127.0.0.1:1")
    monkeypatch.setenv("JARVIS_API_TOKEN", "t")
    state = {"armed": False, "posted": []}

    def status():
        return {"armed": state["armed"], "phase": "arming" if state["armed"] else "disarmed",
                "exit_left_s": 59.6 if state["armed"] else None,
                "config": {"phones": [{"name": "Papa"}]}, "aankhen": {"running": True, "mode": "hardware"},
                "auto_arm": {"enabled": True, "arms_in_s": None}}

    def post(path, payload, timeout=4.0):
        state["posted"].append((path, payload))
        state["armed"] = True
        return _Resp(200, status())
    monkeypatch.setattr(away_mode, "_post", post)
    monkeypatch.setattr(away_mode, "_get", lambda path, timeout=2.0: _Resp(200, status()))
    return state


def test_arming_by_voice_reports_what_the_app_did(api):
    reply = away_mode.handle("Jarvis, arm the house")
    assert api["posted"] == [("/api/security/arm", {"by": "voice"})]
    assert reply.startswith("Away mode is armed. I'll start watching in 60 seconds")
    assert "disarms itself when a family phone joins the Wi-Fi" in reply
    assert away_mode.handle("arm the house") == "Away mode was already armed."


def test_voice_never_disarms(api):
    api["armed"] = True
    assert away_mode.handle("disarm the house") == away_mode.DISARM_REFUSAL
    assert api["posted"] == []


def test_simulated_sensors_are_mentioned():
    st = {"armed": True, "exit_left_s": 60, "config": {"phones": []}, "aankhen": {"running": True, "mode": "simulation"}}
    reply = away_mode.arm_reply(st, was_armed=False)
    assert "real house is not being watched" in reply and "disarm it from the app" in reply


def test_an_unreachable_app_is_never_reported_as_armed(monkeypatch):
    monkeypatch.setenv("JARVIS_API_URL", "http://127.0.0.1:1")
    monkeypatch.setenv("JARVIS_API_TOKEN", "t")

    def down(*a, **k):
        raise ConnectionError("refused")
    monkeypatch.setattr(away_mode, "_get", down)
    monkeypatch.setattr(away_mode, "_post", down)
    assert away_mode.handle("arm the house") == "I couldn't reach the app, so the house is not armed."
    monkeypatch.setattr(away_mode, "_get", lambda *a, **k: _Resp(200, {"armed": False}))
    monkeypatch.setattr(away_mode, "_post", lambda *a, **k: _Resp(500, {}))
    assert "not armed" in away_mode.handle("arm the house")


def test_outside_the_app_it_does_nothing(monkeypatch):
    monkeypatch.delenv("JARVIS_API_URL", raising=False)
    assert away_mode.handle("arm the house") is None


def test_status_reply_by_phase():
    assert away_mode.status_reply({"phase": "disarmed", "auto_arm": {"enabled": True, "arms_in_s": 600}}) == \
        "The house is not armed. It will arm itself in about 10 minutes if nobody's phone is seen."
    assert "watching" in away_mode.status_reply({"phase": "armed", "aankhen": {"running": True, "mode": "hardware"}})
    assert "alarm" in away_mode.status_reply({"phase": "alarm"})
