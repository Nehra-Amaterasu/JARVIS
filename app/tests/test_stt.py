"""Transcription guards (core/stt.py) with a fake Whisper model."""
from types import SimpleNamespace as NS

from jarvis_app.paths import ensure_jarvis_importable

ensure_jarvis_importable()
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


def test_a_short_unsure_line_is_dropped_not_answered():
    """Noise right after JARVIS spoke came back as a few nonsense words (10-14 review)."""
    for s in (seg("Okay. Sit, Bruno.", logprob=-0.95), seg("parallel and both", no_speech=0.55, logprob=-0.4)):
        m = FakeModel({None: ("en", [s])})
        text, meta = stt.transcribe(m, "clip")
        assert text == "" and meta["low_confidence"] and meta["dropped_text"] == s.text


def test_a_short_clear_command_survives():
    m = FakeModel({None: ("en", [seg("lights off", logprob=-0.3)])})
    assert stt.transcribe(m, "clip")[0] == "lights off"


def test_a_long_sentence_is_not_held_to_the_short_bar():
    m = FakeModel({None: ("en", [seg("I was thinking we could revise the adder chapter tonight", logprob=-0.9)])})
    assert stt.transcribe(m, "clip")[0].startswith("I was thinking")


def test_hindi_keeps_whispers_bar_and_his_name_is_never_dropped():
    m = FakeModel({None: ("hi", [seg("पंखा बंद करो", logprob=-0.9)])})
    assert stt.transcribe(m, "clip")[0] == "पंखा बंद करो"                 # -0.9 passes Hindi's -1.0
    m = FakeModel({None: ("en", [seg("Jarvis?", logprob=-1.2)])})
    assert stt.transcribe(m, "clip")[0] == "Jarvis?"


def test_the_short_bar_is_stricter_than_whispers_own():
    assert stt.SHORT_MIN_LOGPROB > -1.0 and stt.SHORT_MAX_NO_SPEECH < 0.6 and stt.SHORT_MIN_LOGPROB_HI == -1.0


def test_real_sentences_that_contain_thanks_survive():
    m = FakeModel({None: ("en", [seg("thank you for the help with Verilog")])})
    assert stt.transcribe(m, "clip")[0] == "thank you for the help with Verilog"
