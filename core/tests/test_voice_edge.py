"""The cloud voice's failure handling and streaming (core/voice.py, 10-25)."""
import pytest

import voice


class WSServerHandshakeError(Exception):
    """Same class name as aiohttp's: the engine recognises a refused handshake by name."""


def _engine(logs, **kw):
    return voice.VoiceEngine(play=lambda *a: None, log=logs.append, enabled=False, settings=lambda: {}, **kw)


@pytest.mark.parametrize("err, wait", [
    (WSServerHandshakeError("403, message='Invalid response status'"), voice.VoiceEngine.EDGE_REJECTED_COOLDOWN_S),
    (RuntimeError("401 Unauthorized"), voice.VoiceEngine.EDGE_REJECTED_COOLDOWN_S),
    (TimeoutError("connect timed out"), voice.VoiceEngine.EDGE_COOLDOWN_S),
    (RuntimeError("no audio"), voice.VoiceEngine.EDGE_COOLDOWN_S),
])
def test_a_refused_cloud_voice_waits_longer_than_a_network_blip(monkeypatch, err, wait):
    now = [1000.0]
    monkeypatch.setattr(voice.time, "monotonic", lambda: now[0])
    logs = []
    eng = _engine(logs)
    eng._edge_failed(err)
    assert eng._edge_down_until == pytest.approx(1000.0 + wait)
    assert ("edge-tts may need an update" in logs[-1]) == (wait == voice.VoiceEngine.EDGE_REJECTED_COOLDOWN_S)


def test_while_refused_the_cloud_is_not_tried_again(monkeypatch, tmp_path):
    calls = []

    async def refused(*a, **k):
        calls.append(1)
        raise WSServerHandshakeError("403")

    monkeypatch.setattr(voice, "_edge_synth", refused)
    eng = _engine([])
    monkeypatch.setattr(type(eng.kokoro), "available", property(lambda self: True))
    monkeypatch.setattr(eng.kokoro, "synth", lambda text, v, lang, speed=1.0: str(tmp_path / "k.wav"))
    for _ in range(3):
        assert eng._synth(voice.STYLES["uk"], "Hello.")[0].endswith("k.wav")
    assert len(calls) == 1
