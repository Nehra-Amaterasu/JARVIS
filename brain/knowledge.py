"""Verified notes for JARVIS's answers, from the Mission Germoney drill decks.

WHY (2026-10-09): asked "explain setup time in simple words", the 4B model said it is
"how long a circuit takes to prepare itself before it can respond to a new input" —
wrong, and in his core subject. The drill decks already hold short, checked answers to
exactly these questions (VLSI interview + Germany operations). When a question matches
cards, the best ones go into the prompt as VERIFIED NOTES the model must not contradict.

Single source of truth: the cards are read straight from the UI's decks.ts, so a fix
to a card fixes both the game and JARVIS.
"""
from __future__ import annotations

import os
import re
from functools import lru_cache

DECKS_TS = os.path.join(os.path.dirname(os.path.abspath(__file__)), os.pardir,
                        "app", "ui", "src", "germoney", "game", "decks.ts")
_CARD = re.compile(r"""\b([vo])\((\d+),\s*'((?:[^'\\]|\\.)*)',\s*'((?:[^'\\]|\\.)*)'\)""")
_STOP = set("""a an the is are was were be to of in on for and or with by at as it its this that what which how why
when does do did can could would should vs versus your you me my i we he she they them about explain tell simple
words meaning mean means define definition difference between""".split())


_EVERYDAY = {_w[:6] for _w in """time day work good best use make first new way long need right left start end
world life thing year week today tomorrow night morning money cost late early fast slow
german germany india english hindi language""".split()}
# Questions about HIM ("mera CGPA kya hai?") must never receive the Germany cards: their
# worked examples and fees read like facts about him. Concept cards (VLSI) are still fine.
_PERSONAL = re.compile(r"\b(mera|meri|mere|mujhe|maine|main|my|mine|i|i'm|am i|do i|did i|should i)\b", re.I)
_NUMBERS = {"one": "1", "two": "2", "three": "3", "four": "4"}


def _stem(w: str) -> str:
    """Crude but enough for card matching: "flops"/"flop", "synchronise"/"synchroniser"."""
    w = _NUMBERS.get(w, w)
    if len(w) > 3 and w.endswith("s") and not w.endswith("ss"):
        w = w[:-1]
    return w[:6] if len(w) > 6 else w


def _words(s: str) -> list[str]:
    return [_stem(w) for w in re.findall(r"[a-z0-9]+", s.lower()) if w not in _STOP and len(w) > 1]


@lru_cache(maxsize=1)
def cards() -> list[tuple[str, str, str, set]]:
    """(deck, front, back, vocabulary) — deck "v" is VLSI, "o" is Germany ops."""
    try:
        src = open(DECKS_TS, encoding="utf-8").read()
    except OSError:
        return []
    out = []
    for m in _CARD.finditer(src):
        front = m.group(3).replace("\\'", "'")
        back = m.group(4).replace("\\'", "'")
        out.append((m.group(1), front, back, set(_words(front)) | {w for w in _words(back) if len(w) > 3}))
    return out


def notes(question: str, k: int = 2) -> str:
    """Up to k matching cards as a prompt block, or "" when nothing fits well."""
    q = set(_words(question))
    if len(q) < 1:
        return ""
    personal = bool(_PERSONAL.search(question))
    scored = []
    for deck, front, back, vocab in cards():
        if personal and deck == "o":
            continue
        front_words = set(_words(front))
        hit_front = len(q & front_words)
        hit_all = len(q & vocab)
        # A card qualifies only if the question shares a word with its FRONT (its topic):
        # matching an answer's incidental words pulled in unrelated cards.
        if hit_front == 0:
            continue
        # One shared everyday word is not a topic match: "what time is it" is not about
        # setup time. Two topic words, or one technical word, are.
        if hit_front == 1 and (q & front_words) <= _EVERYDAY:
            continue
        score = 2 * hit_front + hit_all
        scored.append((score / (1 + 0.1 * len(front_words)), front, back))
    scored.sort(reverse=True)
    picked = [s for s in scored if s[0] >= 1.5][:k]
    if not picked:
        return ""
    lines = [f"- {front}: {back}" for _, front, back in picked]
    return "VERIFIED NOTES (checked facts; do not contradict them):\n" + "\n".join(lines)
