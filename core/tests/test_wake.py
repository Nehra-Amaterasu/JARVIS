"""Waking on "Jarvis" (core/wake.py): the name in a transcript, and the burst logic
with a scripted VAD and transcriber (no mic, no GPU)."""
import numpy as np
import pytest

import wake


@pytest.mark.parametrize("said, rest", [
    ("Jarvis.", ""),
    ("Jarvis?", ""),
    ("Hey Jarvis!", ""),
    ("Okay Jarvis, turn off the light.", "turn off the light"),
    ("Jarvis play some Seedhe Maut", "play some Seedhe Maut"),
    ("Jaarvis, what's the time?", "what's the time"),
    ("Javis are you there", "are you there"),
    ("bhai Jarvis sun na", "sun na"),
    ("जार्विस लाइट बंद करो", "लाइट बंद करो"),
    ("Jarvis, um", ""),                          # one word after the name is not a request
])
def test_the_name_wakes_him_and_the_rest_is_the_request(said, rest):
    h = wake.find_name(said)
    assert h is not None and h.rest == rest


@pytest.mark.parametrize("said", ["", "Thanks for watching.", "Turn off the light.", "the service was jarring",
                                  "Travis Scott is playing", "harvest moon"])
def test_other_speech_does_not_wake_him(said):
    assert wake.find_name(said) is None


def _spotter(probs, text, hold=lambda: False):
    """A spotter whose VAD plays back `probs` (one per frame) and whose Whisper says `text`."""
    it = iter(probs)
    calls = []

    def vad(frames):
        return np.array([next(it, 0.0) for _ in range(len(frames))], dtype=np.float32)

    def transcribe(audio):
        calls.append(len(audio))
        return text
    s = wake.NameSpotter(vad=vad, transcribe=transcribe, hold=hold)
    s.calls = calls
    return s


def _feed(spotter, frames):
    out = None
    for _ in range(frames):
        out = spotter.feed(np.zeros(wake.FRAME, np.int16)) or out
    return out


def test_a_burst_of_speech_naming_him_wakes_him():
    speech = 30                                  # ~1 s of speech, then 0.6 s of quiet
    s = _spotter([0.0] * 20 + [0.9] * speech + [0.0] * 20, "Jarvis, lights off please")
    heard = _feed(s, 70)
    assert heard is not None and heard.rest == "lights off please"
    assert s.calls and s.calls[0] >= speech * wake.FRAME          # the whole burst, pre-roll included


def test_a_click_is_too_short_to_judge():
    s = _spotter([0.9] * 3 + [0.0] * 30, "Jarvis")
    assert _feed(s, 40) is None and s.calls == []


def test_nothing_is_judged_while_jarvis_is_talking():
    s = _spotter([0.9] * 30 + [0.0] * 20, "Jarvis", hold=lambda: True)
    assert _feed(s, 60) is None and s.calls == []


def test_long_conversation_is_cut_and_judged():
    s = _spotter([0.9] * 400, "and then he said the exam was easy")
    assert _feed(s, 400) is None
    assert s.calls and max(s.calls) <= (wake.MAX_BURST_S * wake.SAMPLE_RATE + wake.FRAME * 12)


@pytest.mark.parametrize("said", ["Stop Jarvis.", "stop, Jarvis, I am saying something", "Jarvis stop", "bas Jarvis",
                                  "ruko Jarvis", "Wait Jarvis!", "Jarvis, stop it"])
def test_stop_jarvis_cuts_him_off(said):
    assert wake.is_stop(said)


@pytest.mark.parametrize("said", ["", "pravadi aur English donon", "stop the music", "Jarvis turn on the light",
                                  "bus stop near the gate", "Okay. Set, Bruce."])
def test_noise_and_other_speech_do_not(said):
    assert not wake.is_stop(said)
