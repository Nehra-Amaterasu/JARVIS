"""Make an unbacked claim true instead of only correcting it (honesty.Guard's rescuer).

10-14: asked five times to play a song, the model said "I've located <song> in your
Spotify library — playing now" without ever calling play_media; the guard could only
say what had NOT happened, so he heard corrections and no music. And asked about the
fan, "I haven't checked the light and fan" when a read-only tool could simply look.

A rescue runs a tool, at most once per group per reply (honesty.RESCUE_GROUP):
  * switch_state -> room_state (T0, read only): the reading replaces the sentence;
  * media / web  -> play_media, only when HE asked for something to be played and a
    title is known: quoted in the model's own sentence, or the last one JARVIS named
    in this conversation. The registry's `asked=` check still applies (his words must
    be about music), and the receipt's own sentence is what he hears ("Opened Spotify
    on a search ... needs one click" is said as exactly that).
"""
from __future__ import annotations

from typing import Callable, Optional

from . import media as media_words
from .registry import Receipt, Registry


def make(registry: Registry, ctx, user_input: str, replies: list[str]) -> Callable[[str, str], Optional[Receipt]]:
    def rescue(kind: str, sentence: str) -> Optional[Receipt]:
        if kind == "switch_state":
            if registry.get("room_state") is None:
                return None
            return registry.call("room_state", {}, ctx)
        if kind in ("media", "web"):
            if registry.get("play_media") is None or not media_words.asks_to_play(user_input):
                return None
            mine = media_words.titles_in(sentence)
            title = mine[-1] if mine else media_words.last_title(list(replies or [])[-3:])
            if not title:
                return None
            return registry.call("play_media", {"query": title, "source": media_words.source_in(user_input)}, ctx,
                                 asked=user_input)
        return None
    return rescue
