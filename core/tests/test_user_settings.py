"""core/user_settings.py: the file the app writes and JARVIS reads live.

Pronunciations change only whole words (any case, Hindi included) and only what is
said; a broken settings file never takes the last good settings away; the brain comes
from JARVIS_BRAIN_MODEL with today's model as the default; switches end on time."""
import json
import os

import pytest

import user_settings as us


# ------------------------------------------------------------------ pronunciation
def test_a_word_is_said_the_way_he_wrote_it():
    t = {"Aankhen": "Aan-khen"}
    assert us.apply_pronunciations("Aankhen sees the room.", t) == "Aan-khen sees the room."
    assert us.apply_pronunciations("aankhen and AANKHEN", t) == "Aan-khen and Aan-khen"


def test_only_whole_words_change():
    t = {"Yaad": "Yaad-uh"}
    assert us.apply_pronunciations("Yaadash remembers, yaad rakhna", t) == "Yaadash remembers, Yaad-uh rakhna"
    assert us.apply_pronunciations("Yaad.", t) == "Yaad-uh."


def test_the_longer_entry_wins():
    t = {"Aankhen": "Aan-khen", "Aankhen hub": "the eyes hub"}
    assert us.apply_pronunciations("Ask the Aankhen hub.", t) == "Ask the the eyes hub."


def test_hindi_words_are_matched_whole_too():
    """Python's \\b is wrong for Devanagari: a vowel sign is not a word character."""
    t = {"आँख": "aankh"}
    assert us.apply_pronunciations("मेरी आँख", t) == "मेरी aankh"
    assert us.apply_pronunciations("आँखें", t) == "आँखें"          # a longer word is left alone


def test_no_table_no_change():
    assert us.apply_pronunciations("Hello.", {}) == "Hello."
    assert us.apply_pronunciations("", {"a": "b"}) == ""


@pytest.mark.parametrize("table, why", [
    ({"": "x"}, "both"),
    ({"x": "  "}, "both"),
    ({"[us]": "x"}, "square brackets"),
    ({"x" * 41: "y"}, "under"),
    ("not a table", "object"),
])
def test_bad_entries_are_refused_with_the_reason(table, why):
    with pytest.raises(ValueError, match=why):
        us.normalise_pronunciations(table)


def test_entries_are_trimmed():
    assert us.normalise_pronunciations({"  Aankhen ": " Aan-khen  "}) == {"Aankhen": "Aan-khen"}


# ------------------------------------------------------------------ the file
def test_settings_are_reread_only_when_the_file_changes(tmp_path):
    f = us.SettingsFile(tmp_path / "settings.json")
    assert f.read()["voice"] == {"id": None, "speed": 1.0}         # no file: defaults
    f.write({"voice": {"id": "edge:en-GB-ThomasNeural", "speed": 1.1}})
    assert f.read()["voice"]["id"] == "edge:en-GB-ThomasNeural"
    assert f.read()["brain"] == {"model": None}                    # untouched sections keep defaults


def test_a_broken_file_keeps_the_last_good_settings(tmp_path):
    p = tmp_path / "settings.json"
    f = us.SettingsFile(p)
    f.write({"pronunciations": {"Aankhen": "Aan-khen"}})
    assert f.read()["pronunciations"] == {"Aankhen": "Aan-khen"}
    p.write_text("{ not json", encoding="utf-8")
    os.utime(p, ns=(1, 1))                                         # a different mtime: it is re-read
    assert f.read()["pronunciations"] == {"Aankhen": "Aan-khen"}


def test_update_changes_one_thing_and_leaves_the_rest(tmp_path):
    f = us.SettingsFile(tmp_path / "s.json")
    f.write({"brain": {"model": "llama3.2:1b"}})
    f.update(lambda s: s["voice"].update(speed=1.2))
    on_disk = json.loads((tmp_path / "s.json").read_text(encoding="utf-8"))
    assert on_disk["brain"]["model"] == "llama3.2:1b" and on_disk["voice"]["speed"] == 1.2


def test_without_jarvis_settings_everything_is_default(monkeypatch):
    monkeypatch.delenv("JARVIS_SETTINGS", raising=False)
    assert us.current() == us._merged({})


def test_jarvis_reads_the_file_the_app_points_him_at(tmp_path, monkeypatch):
    p = tmp_path / "settings.json"
    us.SettingsFile(p).write({"voice": {"id": "kokoro:bm_lewis"}})
    monkeypatch.setenv("JARVIS_SETTINGS", str(p))
    assert us.current()["voice"]["id"] == "kokoro:bm_lewis"


# ------------------------------------------------------------------ brain, voice, switches
def test_the_brain_comes_from_the_app_with_todays_model_as_default():
    assert us.brain_model({}) == "qwen3:4b-instruct-2507-q4_K_M"
    assert us.brain_model({"JARVIS_BRAIN_MODEL": "  "}) == "qwen3:4b-instruct-2507-q4_K_M"
    assert us.brain_model({"JARVIS_BRAIN_MODEL": "llama3.1:latest"}) == "llama3.1:latest"


@pytest.mark.parametrize("vid, parsed", [
    ("edge:en-GB-RyanNeural", ("edge", "en-GB-RyanNeural")),
    ("kokoro:bm_george", ("kokoro", "bm_george")),
    ("cloud:x", None), ("edge:../../x", None), (None, None), ("", None),
])
def test_voice_ids(vid, parsed):
    assert us.parse_voice_id(vid) == parsed


def test_speed_is_clamped_and_becomes_an_edge_rate():
    assert us.clamp_speed(3) == 1.4 and us.clamp_speed(0.1) == 0.7 and us.clamp_speed("x") == 1.0
    assert us.clamp_speed(float("nan")) == 1.0
    assert us.edge_rate(1.1) == "+10%" and us.edge_rate(0.85) == "-15%" and us.edge_rate(1.0) == "+0%"


def test_switches_end_on_time():
    s = {"modules": {"deep_think": {"model": "llama3.1:latest", "thinking": False, "until": 1000.0},
                     "offline_voice": {"until": 1000.0}}}
    assert us.deep_think(s, now=999.0) == {"model": "llama3.1:latest", "thinking": False}
    assert us.offline_voice(s, now=999.0) is True
    assert us.deep_think(s, now=1000.0) is None and us.offline_voice(s, now=1001.0) is False
    assert us.deep_think({"modules": {"deep_think": {"until": 5000.0}}}, now=1.0) is None   # no model: off
    assert us.deep_think({"modules": {"deep_think": "garbage"}}, now=1.0) is None
