"""Transcription guards (brain/stt.py) with a fake Whisper model."""
from types import SimpleNamespace as NS

from jarvis_app.paths import ensure_brain_importable

ensure_brain_importable()
import stt  # noqa: E402


def seg(text, no_speech=0.05, logprob=-0.2, ratio=1.3):
    return NS(text=text, no_speech_prob=no_speech, avg_logprob=logprob, compression_ratio=ratio)


class FakeModel:
    def __init__(self, by_language):
        self.by_language, self.calls = by_language, []

    def transcribe(self, audio, language=None, **kw):
        self.calls.append(language)
        lang, segs = self.by_language[language]
        return iter(segs), NS(language=lang, language_probability=0.9)


def test_hindi_and_english_pass_straight_through():
    m = FakeModel({None: ("hi", [seg("नमस्ते"), seg(" Jarvis")])})
    text, meta = stt.transcribe(m, "clip")
    assert text == "नमस्ते Jarvis" and meta["redecoded"] is False and m.calls == [None]


def test_a_wrong_language_guess_is_redecoded_as_hindi():
    """Detected as Urdu -> Arabic script nobody can read. Re-decode as Hindi."""
    m = FakeModel({None: ("ur", [seg("آج کیا ہے")]), "hi": ("hi", [seg("आज क्या है")])})
    text, meta = stt.transcribe(m, "clip")
    assert text == "आज क्या है" and meta["redecoded"] and m.calls == [None, "hi"]


def test_silence_and_loops_are_dropped():
    m = FakeModel({None: ("en", [seg("light on"), seg("hmm", no_speech=0.9, logprob=-1.5),
                                 seg("the the the the the the", ratio=3.1)])})
    text, meta = stt.transcribe(m, "clip")
    assert text == "light on" and meta["dropped"] == 2


def test_whisper_phantoms_on_near_silence_become_nothing():
    for phantom in ("Thanks for watching!", "Thank you.", "धन्यवाद", "Subscribe to my channel"):
        m = FakeModel({None: ("en", [seg(phantom)])})
        text, meta = stt.transcribe(m, "clip")
        assert text == "" and meta["phantom"]


def test_real_sentences_that_contain_thanks_survive():
    m = FakeModel({None: ("en", [seg("thank you for the help with Verilog")])})
    assert stt.transcribe(m, "clip")[0] == "thank you for the help with Verilog"
