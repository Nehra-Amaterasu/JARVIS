"""Spoken media commands (tools/media.py): what is a song request, what is a control,
and, just as important, what is NOT music ("fan chalao", "let's play chess").

The Hinglish is written as core/hinglish.py romanises Whisper's Devanagari
(गाना बंद करो -> "gana band karo"), and as he types it ("gaana band karo")."""
import pytest

import room
from tools import media


def parse(text):
    return media.parse(text, room_parse=room.parse)


@pytest.mark.parametrize("said, query, source", [
    ("play Blinding Lights by The Weeknd", "Blinding Lights by The Weeknd", "auto"),
    ("Jarvis, play some Travis Scott", "Travis Scott", "auto"),
    ("hey jarvis play Kesariya on Spotify please", "Kesariya", "spotify"),
    ("Jarvis play Sicko Mode by Travis Scott on YouTube", "Sicko Mode by Travis Scott", "youtube"),
    ("play lo-fi beats on yt music", "lo-fi beats", "ytmusic"),
    ("play Blinding Lights from my music folder", "Blinding Lights", "local"),
    ("can you play Blinding Lights?", "Blinding Lights", "auto"),
    ("put on some lo-fi", "lo-fi", "auto"),
    ("play Sicko Mode song", "Sicko Mode", "auto"),
    ("play Turn On The Lights by Future", "Turn On The Lights by Future", "auto"),   # a song, not the light
    ("I want to listen to Sicko Mode", "Sicko Mode", "auto"),
    ("Kesariya chalao", "Kesariya", "auto"),
    ("tum hi ho chalao", "tum hi ho", "auto"),
    ("Kesariya gana bajao", "Kesariya", "auto"),
    ("Kesariya spotify pe chalao", "Kesariya", "spotify"),
    ("arijit singh ke gaane chalao", "arijit singh", "auto"),
    ("mujhe Kesariya sunna hai", "Kesariya", "auto"),
])
def test_song_requests(said, query, source):
    got = parse(said)
    assert got is not None and got.op == "play", said
    assert (got.query, got.source) == (query, source)


@pytest.mark.parametrize("said, action, value", [
    ("pause the music", "pause", None),
    ("pause", "pause", None),
    ("stop the music", "pause", None),
    ("gana band karo", "pause", None),               # गाना बंद करो, romanised
    ("gaana band karo", "pause", None),
    ("music band kar do", "pause", None),
    ("resume", "play", None),
    ("play music", "play", None),                    # no song named: carry on with what was playing
    ("gaana chalao", "play", None),
    ("koi accha gana chalao", "play", None),
    ("next song", "next", None),
    ("skip", "next", None),
    ("play the next song", "next", None),
    ("agla gana", "next", None),
    ("agala gana lagao", "next", None),              # अगला गाना लगाओ
    ("previous song", "prev", None),
    ("pichala gana", "prev", None),                  # पिछला गाना
    ("volume 30", "volume", "30"),
    ("set the volume to 30 percent", "volume", "30"),
    ("turn it up", "volume", "up"),
    ("louder", "volume", "up"),
    ("awaz badhao", "volume", "up"),
    ("avaz badhao", "volume", "up"),                 # आवाज़ बढ़ाओ
    ("avaj kam karo", "volume", "down"),             # आवाज कम करो
    ("mute", "volume", "mute"),
])
def test_controls(said, action, value):
    got = parse(said)
    assert got is not None and got.op == "control", said
    assert (got.action, got.value) == (action, value)


@pytest.mark.parametrize("said", ["what's playing?", "what song is this", "kaun sa gana chal raha hai",
                                  "what's playing on spotify"])
def test_what_is_playing(said):
    got = parse(said)
    assert got is not None and got.op == "state"


@pytest.mark.parametrize("said", [
    "fan chalao",                     # the room's, not a song
    "pankha chalao",
    "sab chalao",                     # everything on
    "AC chalao",                      # nothing JARVIS reaches, and still no song
    "sleep mode chalao",
    "put on the fan",                 # Indian English for switching it on
    "turn on the light",
    "let's play chess",
    "play devil's advocate",
    "play it safe",
    "play a game with me",
    "I played football today",
    "put on a 10 minute timer",       # the reminder parser's
    "can you play music?",            # a question about what he can do: the model answers
    "stop",                           # too bare to be sure it is the music
    "what is setup time",
    "",
])
def test_not_music(said):
    assert parse(said) is None


def test_the_room_parser_is_consulted_for_hinglish():
    calls = []
    assert media.parse("disco chalao", room_parse=lambda t: calls.append(t) or [("light", "on", None)]) is None
    assert calls == ["disco chalao"]
    assert media.parse("disco gana chalao", room_parse=lambda t: [("light", "on", None)]).op == "play"
