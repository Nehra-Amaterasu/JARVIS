"""JARVIS's voice engine (core/voice.py) and spoken room commands (core/room.py).

No network and no audio device: synthesis is replaced by fakes, so these test the
routing, the fallbacks and the guarantees — not Microsoft's servers."""
import time

import pytest

from jarvis_app.paths import ensure_jarvis_importable

ensure_jarvis_importable()
import room  # noqa: E402
import voice  # noqa: E402


# ------------------------------------------------------------------ accents and scripts
def test_plain_text_is_british():
    assert voice.Segmenter().feed("Good evening, Aman.") == [("uk", "Good evening, Aman.")]


def test_tags_switch_accent_and_never_reach_the_voice():
    segs = voice.Segmenter().feed("Certainly. [us]Good morning, Aman![/us] Shall we begin?")
    assert segs == [("uk", "Certainly."), ("us", "Good morning, Aman!"), ("uk", "Shall we begin?")]
    assert all("[" not in t for _, t in segs)


def test_a_tag_stays_open_across_streamed_sentences():
    s = voice.Segmenter()
    assert s.feed("[us]Yo.") == [("us", "Yo.")]
    assert s.feed("What is up.[/us] Right then.") == [("us", "What is up."), ("uk", "Right then.")]


def test_devanagari_is_always_spoken_by_the_hindi_voice():
    segs = voice.Segmenter().feed("In Hindi that is तुम्हारा स्वागत है. Rather lovely.")
    assert ("hi", "तुम्हारा स्वागत है.") in segs
    assert segs[0] == ("uk", "In Hindi that is")


def test_aliases_and_hindi_tags():
    assert voice.Segmenter().feed("[american]Hey![/american]") == [("us", "Hey!")]
    assert voice.Segmenter().feed("[hi]मैं जार्विस हूँ।[/hi]") == [("hi", "मैं जार्विस हूँ।")]


def test_punctuation_alone_is_never_sent_to_a_voice():
    """A bare "..." made edge-tts raise NoAudioReceived and abort the rest of the reply."""
    assert voice.Segmenter().feed("...") == []
    assert voice.Segmenter().feed("**") == []


def test_markdown_and_emoji_are_not_read_aloud():
    assert voice.Segmenter().feed("**Done** 😎") == [("uk", "Done")]


def test_the_screen_never_shows_tags():
    assert voice.strip_tags("Sure. [us]Hello![/us] [hi]नमस्ते[/hi]") == "Sure. Hello! नमस्ते"


@pytest.mark.parametrize("text, style", [
    ("say good morning in an American accent", "us"),
    ("British accent mein bolo", "uk"),
    ("do it in a british accent", "uk"),
    ("Hindi mein bolo ki tum mera assistant ho", "hi"),
    ("say that in Hindi", "hi"),
    ("Indian accent please", "in"),
    ("what is setup time", None),
    ("I watched an American film", None),
])
def test_explicit_accent_requests(text, style):
    assert voice.requested_style(text) == style


def test_the_turn_instruction_asks_for_devanagari_when_hindi_is_wanted():
    assert "Devanagari" in voice.turn_instruction("hi")
    assert "[us]" in voice.turn_instruction("us")
    assert voice.turn_instruction(None) == ""


# ------------------------------------------------------------------ streaming sentences
@pytest.mark.parametrize("buf, first, ready, rest", [
    ("Hello there. How are", False, "Hello there.", " How are"),
    ("Version 3.5 is out", False, "", "Version 3.5 is out"),          # a decimal is not a sentence end
    ("Version 3.5 is out. Next", False, "Version 3.5 is out.", " Next"),
    ("यह ठीक है। अगला", False, "यह ठीक है।", " अगला"),                 # the danda ends Hindi sentences
    ("Well, I suppose that is the most sensible approach, given", True, "Well, I suppose that is the most sensible approach,", " given"),
    ("Short, one", True, "", "Short, one"),
])
def test_split_ready(buf, first, ready, rest):
    assert voice.split_ready(buf, first) == (ready, rest)


# ------------------------------------------------------------------ the engine: order, fallback, never fatal
# The REAL VoiceEngine and its real _synth; only the network call and Kokoro are faked.
@pytest.fixture()
def engine(monkeypatch):
    calls = {"edge": [], "kokoro": []}
    state = {"edge_ok": True, "kokoro_ok": True}

    async def fake_edge(text, voice_name, rate):
        calls["edge"].append(voice_name)
        if not state["edge_ok"]:
            raise RuntimeError("no network")
        return f"edge:{voice_name}:{text}"

    class FakeKokoro:
        available = True

        def synth(self, text, v, lang):
            calls["kokoro"].append(v)
            if not state["kokoro_ok"]:
                raise RuntimeError("broken model")
            return f"kokoro:{v}:{text}"

    monkeypatch.setattr(voice, "_edge_synth", fake_edge)
    played, logs = [], []
    gains = []
    e = voice.VoiceEngine(play=lambda t, p, g: (played.append(p), gains.append(g)), log=logs.append, model_dir="nowhere")
    e.gains = gains
    e.kokoro = FakeKokoro()
    e.calls, e.state, e.played_paths, e.logs = calls, state, played, logs
    yield e
    e.close()


def _drain(e, n, timeout=3.0):
    t0 = time.time()
    while len(e.played_paths) < n and time.time() - t0 < timeout:
        time.sleep(0.01)
    time.sleep(0.05)


def test_sentences_play_in_order_with_their_voices(engine):
    engine.begin_turn()
    engine.say("Right. [us]Wassup![/us]")
    engine.say("नमस्ते अमन।")
    _drain(engine, 3)
    assert [p.split(":")[1] for p in engine.played_paths] == ["en-GB-RyanNeural", "en-US-AndrewNeural", "hi-IN-MadhurNeural"]


def test_a_failing_cloud_falls_back_offline_and_is_not_retried_every_sentence(engine):
    engine.state["edge_ok"] = False
    engine.say("One.")
    engine.say("Two.")
    _drain(engine, 2)
    assert engine.played_paths == ["kokoro:bm_george:One.", "kokoro:bm_george:Two."]
    assert len(engine.calls["edge"]) == 1             # the second sentence skipped the dead cloud
    assert any("offline voice" in line for line in engine.logs)


def test_hindi_falls_back_to_the_offline_hindi_voice(engine):
    engine.state["edge_ok"] = False
    engine.say("[hi]नमस्ते[/hi]")
    _drain(engine, 1)
    assert engine.played_paths == ["kokoro:hm_psi:नमस्ते"]


def test_nothing_playable_never_raises(engine):
    engine.state["edge_ok"] = engine.state["kokoro_ok"] = False
    assert engine.say("This will not be heard.") == 1
    time.sleep(0.2)
    assert engine.played_paths == [] and engine.stats["failed"] == 1


def test_an_explicit_request_sets_the_whole_reply(engine):
    engine.begin_turn("us")
    engine.say("Good morning, Aman.")
    _drain(engine, 1)
    assert "en-US-AndrewNeural" in engine.played_paths[0]


def test_clear_drops_unsynthesised_speech(engine):
    engine.clear()
    assert engine.pending() == 0


# ------------------------------------------------------------------ spoken room commands
@pytest.mark.parametrize("text, expected", [
    ("light band kar do", [("light", "off", None)]),
    ("turn on the fan", [("fan", "on", None)]),
    ("fan 40 percent", [("fan", "set", 40)]),
    ("batti thodi kam karo", [("light", "dim", None)]),
    ("pankha tez karo", [("fan", "brighten", None)]),
    ("sab band kar do", [("all", "off", None)]),
    ("study mode on karo", [("environment", "focus", "focus")]),
    ("lights on please", [("light", "on", None)]),
])
def test_room_commands(text, expected):
    assert room.parse(text) == expected


@pytest.mark.parametrize("text", ["is the light on?", "kya fan chal raha hai", "I love this light song", "what is a fan-out", ""])
def test_room_questions_and_chatter_switch_nothing(text):
    assert room.parse(text) == []


def test_room_describes_only_what_is_true():
    room.state["light"] = {"on": False, "level": 100}
    assert room.describe("light") == "The light is off."


def test_louder_voices_are_levelled_with_the_british_one(engine):
    """Madhur (Hindi) measured ~4 dB louder than Ryan: a switch into Hindi must not jump."""
    engine.say("Right. [hi]नमस्ते[/hi]")
    _drain(engine, 2)
    assert engine.gains[0] == 1.0 and engine.gains[1] < 0.7
