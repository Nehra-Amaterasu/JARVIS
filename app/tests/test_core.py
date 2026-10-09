"""The JARVIS process bridge: events become turns, per-turn timings, room changes,
and a bad event can never freeze JARVIS (the reader thread must survive it)."""
import io
import json

from jarvis_app.bus import EventBus
from jarvis_app.core import SENTINEL, CoreProcess
from jarvis_app.transcripts import TranscriptStore


def _core(tmp_path):
    c = CoreProcess(EventBus(), transcripts=TranscriptStore(tmp_path / "t", tmp_path / "r"))
    c.session = "test"
    c.mode = "voice"
    return c


def test_a_spoken_turn_is_assembled_with_its_own_timings(tmp_path):
    c = _core(tmp_path)
    c._on_event({"kind": "timing", "stage": "stt", "seconds": 2.7})
    c._on_event({"kind": "heard", "text": "kya time hua?"})
    c._on_event({"kind": "timing", "stage": "first_token", "seconds": 0.6})
    for chunk in ["Abhi ", "saat ", "baje hain."]:
        c._on_event({"kind": "reply_chunk", "text": chunk})
    c._on_event({"kind": "reply_end", "text": "Abhi saat baje hain.", "seconds": 1.9})
    you, jarvis = c.transcript()[-2:]
    assert (you["role"], you["text"]) == ("you", "kya time hua?")
    assert (jarvis["text"], jarvis["done"], jarvis["seconds"]) == ("Abhi saat baje hain.", True, 1.9)
    saved = [e for e in c.transcripts.entries(1) if e["role"] == "jarvis"][-1]
    assert saved["timings"] == {"stt": 2.7, "first_token": 0.6, "reply": 1.9}


def test_a_typed_turn_does_not_inherit_the_last_spoken_hearing_time(tmp_path):
    c = _core(tmp_path)
    c._on_event({"kind": "timing", "stage": "stt", "seconds": 2.7})
    c._on_event({"kind": "heard", "text": "spoken"})
    c._on_event({"kind": "reply_end", "text": "ok", "seconds": 1.0})
    c._on_event({"kind": "heard", "text": "typed"})          # no stt timing before it
    c._on_event({"kind": "reply_end", "text": "ok 2", "seconds": 1.0})
    replies = [e for e in c.transcripts.entries(1) if e["role"] == "jarvis"]
    assert "stt" in replies[0]["timings"] and "stt" not in replies[1]["timings"]


def test_room_events_reach_the_room_owner(tmp_path):
    c = _core(tmp_path)
    seen, booted = [], []
    c.room_listener = lambda d, s: seen.append((d, s))
    c.room_boot_listener = lambda: booted.append(True)
    c._on_event({"kind": "room_state", "state": {"light": {"on": False, "level": 100}}, "mqtt": False})
    c._on_event({"kind": "room", "device": "light", "state": {"on": True, "level": 80}})
    assert booted == [True] and seen == [("light", {"on": True, "level": 80})]


def test_errors_are_recorded_and_kept(tmp_path):
    c = _core(tmp_path)
    c._on_event({"kind": "error", "message": "ollama timed out"})
    assert c.last_error == "ollama timed out"
    assert any(e.get("kind") == "error" for e in c.transcripts.entries(1))


class _FakeProc:
    def __init__(self, lines):
        self.stdout = io.BytesIO(b"".join(l.encode("utf-8") + b"\n" for l in lines))

    def wait(self):
        return 0


def test_the_reader_survives_a_bad_event(tmp_path):
    """A handler bug used to kill the reader; the pipe then filled and JARVIS hung."""
    c = _core(tmp_path)

    def explode(*_):
        raise KeyError("boom")
    c.room_listener = explode
    lines = [
        "plain log line",
        SENTINEL + json.dumps({"kind": "room", "device": "fan", "state": {"on": True, "level": 50}}),
        SENTINEL + "{not json",
        SENTINEL + json.dumps({"kind": "heard", "text": "still alive?"}),
    ]
    c.proc = _FakeProc(lines)
    c._read(c.proc)                                        # must return normally
    assert c.transcript()[-1]["text"] == "still alive?"
    logged = [l["line"] for l in c.log_tail()]
    assert "plain log line" in logged and any("could not handle event" in l for l in logged)
