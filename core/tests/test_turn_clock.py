"""The turn clock (core/turn_clock.py) and the voice engine's latency marks (10-25).

The audit had one number (question -> first audio, median 4.12 s) and no way to say which
stage the time went to. These tests pin the chain: every stage is the first of its kind
in a turn, the links add up to the whole, and the voice engine marks the first audio
for both engines without ever failing a sentence because of timing.
"""
import asyncio

import pytest

import turn_clock
import voice


class FakeTime:
    def __init__(self, t=1000.0):
        self.t = t

    def __call__(self):
        return self.t


def test_a_spoken_turn_adds_up_from_his_last_word_to_the_speaker():
    now = FakeTime(100.0)
    c = turn_clock.TurnClock(clock=now)
    # Recording closed at 99.0 after 1.3 s of silence; Whisper's text was ready at 100.0.
    c.start(recorded_at=99.0, endpoint_s=1.3, t=100.0)
    now.t = 100.6; assert c.mark("first_token")
    now.t = 100.9; assert c.mark("first_sentence")
    now.t = 101.4; assert c.mark("tts_first_byte", engine="edge")
    now.t = 101.9; assert c.mark("tts_ready")
    now.t = 101.5; assert c.mark("playback_start")
    rep = c.finish()
    assert rep["endpoint"] == pytest.approx(1.3)
    assert rep["stt_wait"] == pytest.approx(1.0)
    assert rep["llm_first_token"] == pytest.approx(0.6)
    assert rep["first_sentence_wait"] == pytest.approx(0.3)
    assert rep["tts_first_byte"] == pytest.approx(0.5)
    assert rep["play_start"] == pytest.approx(0.1)
    assert rep["tts_full"] == pytest.approx(1.0)
    assert rep["turn_to_audio"] == pytest.approx(1.5)
    assert rep["speech_to_audio"] == pytest.approx(3.8)
    assert rep["engine"] == "edge"
    assert sum(rep[k] for k in turn_clock.CHAIN) == pytest.approx(rep["speech_to_audio"])


def test_only_the_first_mark_of_a_stage_counts():
    now = FakeTime(10.0)
    c = turn_clock.TurnClock(clock=now)
    c.start(t=10.0)
    now.t = 11.0; assert c.mark("first_sentence")
    now.t = 15.0; assert not c.mark("first_sentence")             # the third sentence of the reply
    now.t = 11.5; c.mark("tts_first_byte", engine="kokoro")
    now.t = 12.0; c.mark("tts_first_byte", engine="edge")         # a later piece's engine is not the turn's
    assert c.snapshot()["tts_first_byte"] == pytest.approx(0.5)
    assert c.snapshot()["engine"] == "kokoro"


def test_marks_outside_a_turn_are_ignored_and_a_closed_turn_takes_no_more():
    c = turn_clock.TurnClock(clock=FakeTime())
    assert not c.mark("first_sentence")            # "Systems online" at boot: no turn open
    c.start()
    c.mark("playback_start")
    assert c.finish() is not None
    assert not c.mark("tts_ready")                 # the rest of the reply still playing
    assert c.finish() is None


def test_a_typed_turn_has_no_speech_end_but_still_times_the_reply():
    now = FakeTime(5.0)
    c = turn_clock.TurnClock(clock=now)
    c.start(t=5.0)
    now.t = 7.0; c.mark("playback_start")
    rep = c.finish()
    assert "speech_to_audio" not in rep and "endpoint" not in rep
    assert rep["turn_to_audio"] == pytest.approx(2.0)


def test_unknown_stage_is_a_programming_error():
    with pytest.raises(ValueError):
        turn_clock.TurnClock().mark("first_audio")


def test_median_and_p90_over_the_kept_turns():
    now = FakeTime(0.0)
    c = turn_clock.TurnClock(clock=now, history=5)
    for i, total in enumerate([2.0, 3.0, 4.0, 5.0, 6.0, 9.0]):     # six turns, five kept
        base = 100.0 * i
        c.start(recorded_at=base, endpoint_s=1.0, t=base)
        c.mark("playback_start", t=base + total - 1.0)
        c.finish()
    s = c.summary()
    assert s == {"median": 5.0, "p90": 6.0, "n": 5}
    assert turn_clock.TurnClock().summary() is None


def test_a_turn_that_never_played_is_not_counted():
    c = turn_clock.TurnClock(clock=FakeTime())
    c.start()
    c.finish()                                      # the reply failed before any sound
    assert c.summary("turn_to_audio") is None


def test_log_line_names_every_link_and_the_engine():
    rep = {"endpoint": 1.31, "stt_wait": 0.02, "llm_first_token": 0.58, "first_sentence_wait": 0.2,
           "tts_first_byte": 0.25, "play_start": 0.05, "speech_to_audio": 2.41, "engine": "edge-stream"}
    s = turn_clock.line(rep, {"median": 2.6, "p90": 4.1, "n": 12})
    assert s.startswith("[latency] speech->audio 2.41 s = endpoint 1.31 + stt 0.02 + llm 0.58")
    assert "tts 0.25 (edge-stream)" in s and "median 2.6 p90 4.1 (n=12)" in s
    assert "?" in turn_clock.line({"turn_to_audio": 1.0})       # missing links are shown, not hidden


# ------------------------------------------------------------------ the voice engine's marks
def _engine(marks, **kw):
    return voice.VoiceEngine(play=lambda *a: None, log=lambda m: None, enabled=False,
                             settings=lambda: {}, on_mark=lambda stage, **info: marks.append((stage, info)), **kw)


def test_edge_marks_its_first_bytes_then_the_whole_file(monkeypatch, tmp_path):
    marks = []

    async def fake_edge(text, name, rate, on_first=None):
        on_first()
        marks.append(("bytes", {}))
        p = tmp_path / "x.mp3"
        p.write_bytes(b"\xff" * 400)
        return str(p)

    monkeypatch.setattr(voice, "_edge_synth", fake_edge)
    eng = _engine(marks)
    path, gain = eng._synth(voice.STYLES["uk"], "The light is off.")
    assert path.endswith("x.mp3")
    assert [m[0] for m in marks] == ["tts_first_byte", "bytes", "tts_ready"]
    assert marks[0][1] == {"engine": "edge"}


def test_kokoro_marks_both_at_once_when_edge_is_down(monkeypatch, tmp_path):
    marks = []

    async def failing_edge(*a, **k):
        raise RuntimeError("no audio")

    monkeypatch.setattr(voice, "_edge_synth", failing_edge)
    eng = _engine(marks)
    monkeypatch.setattr(type(eng.kokoro), "available", property(lambda self: True))
    monkeypatch.setattr(eng.kokoro, "synth", lambda text, v, lang, speed=1.0: str(tmp_path / "k.wav"))
    path, _ = eng._synth(voice.STYLES["uk"], "Hello.")
    assert path.endswith("k.wav")
    assert marks == [("tts_first_byte", {"engine": "kokoro"}), ("tts_ready", {})]


def test_a_broken_mark_never_costs_the_sentence(monkeypatch, tmp_path):
    async def fake_edge(text, name, rate, on_first=None):
        on_first()
        return str(tmp_path / "y.mp3")

    def boom(stage, **info):
        raise RuntimeError("clock broke")

    logs = []
    monkeypatch.setattr(voice, "_edge_synth", fake_edge)
    eng = voice.VoiceEngine(play=lambda *a: None, log=logs.append, enabled=False, settings=lambda: {}, on_mark=boom)
    assert eng._synth(voice.STYLES["uk"], "Still said.")[0].endswith("y.mp3")
    assert any("latency mark failed" in m for m in logs)


def test_edge_synth_calls_on_first_once_at_the_first_audio_chunk(monkeypatch, tmp_path):
    import types
    import sys
    calls = []

    class FakeComm:
        def __init__(self, *a, **k):
            pass

        async def stream(self):
            yield {"type": "WordBoundary"}
            calls.append("before-audio")
            yield {"type": "audio", "data": b"a" * 300}
            yield {"type": "audio", "data": b"b" * 300}

    monkeypatch.setitem(sys.modules, "edge_tts", types.SimpleNamespace(Communicate=FakeComm))
    monkeypatch.setattr(voice.tempfile, "gettempdir", lambda: str(tmp_path))
    path = asyncio.run(voice._edge_synth("hi", "v", "+0%", on_first=lambda: calls.append("first")))
    assert calls == ["before-audio", "first"]
    assert open(path, "rb").read() == b"a" * 300 + b"b" * 300
