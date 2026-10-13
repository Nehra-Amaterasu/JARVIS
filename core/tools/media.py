"""Spoken media commands, English and Hinglish, parsed without the model.

"play Blinding Lights by The Weeknd", "Jarvis play some Travis Scott on Spotify",
"Kesariya chalao", "pause the music", "gaana band karo", "next song", "agla gana",
"volume 30", "awaz badhao", "what's playing?". Like the room and Mission parsers it runs
before the model: instant, and a command can never be misheard into a claim. Speech
recognition romanises Hindi first (core/hinglish.py: गाना बंद करो -> "gana band karo"),
so the Hinglish here is written the way that module writes it, long vowels and short.

Deliberately narrow. A play command must START with the verb ("play ...", "put on ...")
or END with a Hinglish one ("... chalao", "... bajao"); "let's play chess" and "play
devil's advocate" are not songs, and "fan chalao" is the fan (the room parser's call).
Anything not matched goes to the model, which has the same tools.
"""
from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Callable, Optional


@dataclass
class MediaIntent:
    op: str                        # "play" | "control" | "state"
    query: str = ""                # what to play, as he would read it: "Blinding Lights by The Weeknd"
    source: str = "auto"           # auto | local | youtube | ytmusic | spotify
    action: str = ""               # control: play | pause | next | prev | volume
    value: Optional[str] = None    # volume: up | down | mute | "0".."100"


def _rx(p: str) -> re.Pattern:
    return re.compile(p, re.I)


_WAKE = _rx(r"^\W*(?:(?:hey|ok|okay|hi|yo)\s+)?(?:jarvis\b[\s,.:!-]*)?(?:(?:please|pls|bhai|yaar)\b[\s,]*)*")
_TAIL = _rx(r"(?:[\s,]+(?:please|pls|jarvis|bhai|yaar|sir|na|thanks|thank you))+[\s.!?]*$")
_SONG = r"(?:music|songs?|gaana|gana|gaane|gane|track|tunes?)"
_SONG_RX = _rx(r"\b" + _SONG + r"\b")

_STATE = _rx(
    r"^(?:what(?:'s| is)\s+(?:playing|this\s+song|this\s+track|the\s+song(?:\s+playing)?|on\s+spotify)"
    r"(?:\s+on\s+(?:spotify|youtube))?(?:\s+(?:now|right\s+now))?|"
    r"(?:what|which)\s+song\s+is\s+(?:this|playing|on)(?:\s+now)?|now\s+playing|"
    r"(?:ye\s+|yeh\s+)?(?:kaun\s*sa|kon\s*sa|konsa|kaunsa)\s+(?:gaana|gana|song)\s+"
    r"(?:hai|chal\s+raha\s+hai|baj\s+raha\s+hai)(?:\s+ye|\s+yeh)?)$")

_VOL_NUM = _rx(r"^(?:set\s+(?:the\s+)?|put\s+(?:the\s+)?)?(?:volume|sound|ava[zj]|awaa?[zj]|avaa[zj])\s+(?:to\s+|at\s+|on\s+)?"
               r"(\d{1,3})\s*(?:%|percent|per\s+cent)?(?:\s+(?:kar\s*do|karo|pe\s+karo|par\s+karo|rakho))?$")
_VOL = [
    ("up", _rx(r"^(?:turn\s+up\s+(?:the\s+)?(?:volume|music|sound)|turn\s+(?:the\s+)?(?:volume|music|sound|it)\s+up|"
               r"(?:volume|sound)\s+up|(?:raise|increase)\s+(?:the\s+)?volume|louder|make\s+it\s+louder|"
               r"(?:thoda\s+)?(?:volume|sound|ava[zj]|awaa?[zj]|avaa[zj])\s+(?:aur\s+)?(?:badhao|badha\s*do|tez\s+karo|"
               r"tez\s+kar\s*do|zyada\s+karo|zyada\s+kar\s*do|upar\s+karo))$")),
    ("down", _rx(r"^(?:turn\s+down\s+(?:the\s+)?(?:volume|music|sound)|turn\s+(?:the\s+)?(?:volume|music|sound|it)\s+down|"
                 r"(?:volume|sound)\s+down|(?:lower|decrease|reduce)\s+(?:the\s+)?volume|quieter|softer|"
                 r"make\s+it\s+quieter|(?:thoda\s+)?(?:volume|sound|ava[zj]|awaa?[zj]|avaa[zj])\s+(?:aur\s+)?"
                 r"(?:kam\s+karo|kam\s+kar\s*do|dheema\s+karo|dheemi\s+karo|dhima\s+karo|neeche\s+karo|kam))$")),
    ("mute", _rx(r"^(?:mute|unmute)(?:\s+(?:the\s+)?(?:music|sound|volume|audio|it))?$")),
]
_CONTROL = [
    ("pause", _rx(r"^(?:pause|stop|halt|kill)(?:\s+(?:the|this|my))?\s+(?:music|songs?|track|gaana|gana|playback|"
                  r"spotify|youtube|video)$|^pause(?:\s+it)?$|"
                  r"^(?:the\s+)?(?:music|song|gaana|gana|gaane|gane)\s+(?:band|bandh|stop|pause|roko|rok|mat\s+bajao)"
                  r"(?:\s+(?:karo|kar\s*do|kardo|do|de))?$|"
                  r"^(?:band|bandh|stop|pause)\s+(?:karo|kar\s*do|kardo)\s+(?:the\s+)?(?:music|gaana|gana|song)$")),
    ("play", _rx(r"^(?:resume|unpause|continue)(?:\s+(?:the|my))?(?:\s+(?:music|songs?|track|playback|gaana|gana|it))?$|"
                 r"^(?:play|start)\s+(?:the\s+|my\s+|some\s+)?(?:music|songs?|gaana|gana|it)(?:\s+again)?$|^play$|"
                 r"^(?:music|gaana|gana|gane|gaane|koi\s+(?:gaana|gana|song))\s+(?:(?:phir\s+se|wapas)\s+)?"
                 r"(?:chalao|chala\s*do|bajao|baja\s*do|lagao|laga\s*do|sunao|play\s+karo|start\s+karo|shuru\s+karo)$")),
    ("next", _rx(r"^(?:play\s+(?:the\s+)?)?next\s+(?:song|track|one|gaana|gana|video)$|"
                 r"^skip(?:\s+(?:this|the|it))?(?:\s+(?:song|track|one|gaana|gana|video))?$|"
                 r"^(?:agla|agala|agle|next)\s+(?:gaana|gana|song|track)(?:\s+(?:chalao|lagao|bajao|play\s+karo|"
                 r"pe\s+jao|par\s+jao))?$|^(?:gaana|gana|song)\s+(?:badlo|badal\s*do|change\s+karo|change\s+kar\s*do|"
                 r"skip\s+karo|skip\s+kar\s*do)$|^skip\s+(?:karo|kar\s*do|kardo)$|^change\s+(?:the\s+)?(?:song|track)$")),
    ("prev", _rx(r"^(?:play\s+(?:the\s+)?)?(?:previous|prev|last)\s+(?:song|track|one|gaana|gana|video)(?:\s+again)?$|"
                 r"^(?:go\s+)?back\s+(?:a|one)\s+(?:song|track)$|"
                 r"^(?:pichla|pichala|pichhla|pichhala|pehle\s+wala|peeche\s+wala)\s+(?:gaana|gana|song|track)"
                 r"(?:\s+(?:chalao|lagao|bajao|play\s+karo))?$")),
]

_PLAY = _rx(r"^(?:(?:can|could|would|will)\s+you\s+)?(?:please\s+)?(?P<verb>play|put\s+on|queue\s+up|queue|"
            r"start\s+playing|blast)\s+(?P<q>.+?)\W*$")
_LISTEN = _rx(r"^(?:i\s+(?:want|wanna|would\s+like|'d\s+like)\s+to\s+|let\s+me\s+|let'?s\s+)(?:listen\s+to|hear)\s+"
              r"(?P<q>.+?)\W*$")
_HING = _rx(r"^(?P<q>.+?)\s+(?:(?:wala|vala|waala)\s+)?(?:(?:gaana|gana|gaane|gane|song)\s+)?"
            r"(?:chalao|chala\s*do|chala\s*de|chalaao|bajao|baja\s*do|baja\s*de|bajaao|lagao|laga\s*do|laga\s*de|"
            r"sunao|suna\s*do|play\s+(?:karo|kar\s*do|kardo))$")
_SUNNA = _rx(r"^(?:mujhe\s+)?(?P<q>.+?)\s+sunna\s+hai$")

_SRC = _rx(r"\s+(?:(?:on|in|from|using|via|through|with)\s+(?:my\s+|the\s+)?"
           r"(?P<a>spotify|youtube\s+music|yt\s+music|youtube|you\s+tube|yt|music\s+folder|folder|library|collection|"
           r"files|my\s+music|local\s+(?:music|songs|files)|downloaded\s+(?:music|songs)|computer|laptop|pc)|"
           r"(?P<b>spotify|youtube\s+music|yt\s+music|youtube|you\s+tube)\s+(?:pe|par|se|mein|me))$")
_LEAD = _rx(r"^(?:me\s+|us\s+)?(?:(?:some|a\s+bit\s+of|a\s+little|something\s+(?:by|from)|anything\s+(?:by|from)|"
            r"songs?\s+(?:by|from)|music\s+(?:by|from)|a\s+song\s+(?:by|from|called)|the\s+song|the\s+track|"
            r"track|song)\s+)+")
_TRAIL = _rx(r"(?:\s+(?:(?:wala|vala|waala)\s+)?(?:gaana|gana|gaane|gane|song|songs|track|music)|\s+(?:ke|ka|ki))+$")
# A request that names no song: "play some music", "koi accha gana chalao".
_GENERIC_WORDS = {"some", "a", "an", "my", "the", "any", "koi", "kuch", "something", "anything", "good", "nice",
                  "accha", "achha", "acha", "badhiya", "music", "song", "songs", "gaana", "gana", "gaane", "gane",
                  "tunes", "tune", "it", "track", "tracks", "beats", "few", "random", "bhi", "sa"}
# Not songs: games and idioms ("play chess", "play devil's advocate", "play it safe"),
# and "put on a timer", which is the reminder parser's.
_NOT_MUSIC = _rx(r"^(?:a\s+|the\s+|some\s+)?(?:games?|chess|ludo|cards?|quiz|cricket|football|pubg|bgmi|valorant|"
                 r"minecraft|role|part|devil'?s\s+advocate|along|dumb|dead|fair|it\s+(?:cool|safe|by\s+ear)|"
                 r"with\s+(?:me|it|fire)|hard\s+to\s+get|a\s+(?:trick|prank|joke|role|part|game|match|round))\b|"
                 r"\b(?:role|timer|alarm|reminder)\b")
# Things "chalao" switches on that are not songs. The room parser owns the light and fan.
_DEVICE = _rx(r"\b(?:ac|a\.c\.|tv|television|geyser|heater|cooler|motor|pump|fan|pankha|pankhe|lights?|batti|bulb|"
              r"lamp|machine|washing|laptop|computer|pc|bike|car|gaadi|mode|scene|timer|alarm|reminder|focus|session|"
              r"crucible|class|lecture|call|meeting)\b")
_SRC_NAME = {"spotify": "spotify", "youtube music": "ytmusic", "yt music": "ytmusic", "youtube": "youtube",
             "you tube": "youtube", "yt": "youtube"}


def _clean(text: str) -> str:
    t = _WAKE.sub("", (text or "").replace("’", "'").replace("‘", "'").strip())
    t = _TAIL.sub("", t)
    return re.sub(r"\s+", " ", t).strip().rstrip(".!,")


def _generic(q: str) -> bool:
    return all(w in _GENERIC_WORDS for w in re.findall(r"[\w'-]+", q.lower()))


def _source(q: str) -> tuple[str, str]:
    m = _SRC.search(q)
    if not m:
        return q, "auto"
    name = re.sub(r"\s+", " ", (m.group("a") or m.group("b") or "").lower())
    return q[:m.start()].strip(), _SRC_NAME.get(name, "local")


def _what(q: str) -> str:
    """The song as he would read it: fillers off, "X by Y" kept."""
    q = _TRAIL.sub("", _LEAD.sub("", q.strip())).strip(" ,.-")
    return re.sub(r"\s+", " ", q)


def parse(text: str, room_parse: Optional[Callable[[str], list]] = None) -> Optional[MediaIntent]:
    """A media command, or None when the sentence is not one."""
    raw = (text or "").strip()
    t = _clean(raw)
    if not t:
        return None
    asked = raw.rstrip().endswith("?")
    body = t.rstrip("?").strip()
    if _STATE.match(body):
        return MediaIntent("state")
    m = _VOL_NUM.match(body)
    if m and 0 <= int(m.group(1)) <= 100:
        return MediaIntent("control", action="volume", value=m.group(1))
    for value, rx in _VOL:
        if rx.match(body):
            return MediaIntent("control", action="volume", value=value)
    for action, rx in _CONTROL:
        if rx.match(body):
            return MediaIntent("control", action=action)

    m = _PLAY.match(body) or _LISTEN.match(body)
    # You "play" a song but "put on" a light as well ("put on the fan" is Indian English
    # for switching it on), and "chalao" runs a fan as readily as a song.
    switchy = m is None or (m.groupdict().get("verb") or "").lower().startswith("put")
    if m is None:
        m = _HING.match(body) or _SUNNA.match(body)
    if m is None:
        return None
    q, source = _source(m.group("q").strip())
    if _NOT_MUSIC.search(q):
        return None
    if switchy and not _SONG_RX.search(body):
        # "fan chalao" is the fan, "AC chalao" is nothing JARVIS can reach: never a song
        # (unless he said it is one: "disco gana chalao").
        if _DEVICE.search(q) or (room_parse is not None and room_parse(raw)):
            return None
    what = _what(q)
    if _generic(what) or _generic(q):
        # "play some music", "gaana chalao": no song named. A question ("can you play
        # music?") is about what he can do: the model answers it.
        return None if asked else MediaIntent("control", action="play")
    if len(what.split()) > 12:
        return None                                  # a sentence, not a title
    return MediaIntent("play", query=what, source=source)
