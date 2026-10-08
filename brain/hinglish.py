"""Romanize Devanagari into readable Hinglish, leaving English words untouched.

WHY: Whisper large-v3-turbo transcribes Amreesh's code-switched speech accurately,
but writes the Hindi parts in Devanagari and the English parts in Latin:

    भाई जार्विस मुझे बताओ की मेरा नाम क्या है और मेरी music choices क्या है

He has said he cannot read Devanagari comfortably, and a mixed-script line is hard
for anyone to scan. This module rewrites only the Devanagari runs into Latin, so the
whole line ends up in one script:

    bhai jarvis mujhe batao ki mera nam kya hai aur meri music choices kya hai

English words are never touched, which matters: the room-control keyword matching in
agent.py looks for literal English phrases like "turn off light", and transliterating
those would break the lights.

Two fixes on top of raw ITRANS output:
  1. Long vowels are collapsed (aa->a, ii->i, uu->u) because Hinglish is conventionally
     written short: "bhai", not "bhaaii".
  2. The inherent schwa is stripped. ITRANS renders every bare consonant with a
     trailing "a", giving "jarvisa" / "nama" / "aura". We drop that final "a" only
     when the ORIGINAL Devanagari word ended in a consonant — so "jarvisa"->"jarvis"
     but "mera" and "kya" (which really do end in a vowel sign) are left alone.
"""
import re

from indic_transliteration import sanscript
from indic_transliteration.sanscript import transliterate

# Devanagari block, and the consonant range within it (ka..ha).
_DEVA_RUN = re.compile(r"[ऀ-ॿ]+")
_CONSONANT = re.compile(r"[क-हक़-य़]")
# ITRANS control characters we never want surfacing in readable text.
_NOISE = re.compile(r"[~^.\\$Ñ]")


def _romanize_word(word: str) -> str:
    out = transliterate(word, sanscript.DEVANAGARI, sanscript.ITRANS)
    # ITRANS marks the anusvara with a capital M, distinguishing it from a real
    # म. Nasal anusvara reads as "n" in Hinglish ("maine", not "maimne"), while a
    # real म must stay "m" ("kaam" must not become "kaan"). Handle before casefold.
    out = out.replace("M", "n")
    out = _NOISE.sub("", out).lower()
    out = out.replace("ph", "f")     # फ is pronounced f in modern Hindi: kafi, not kaphi
    out = re.sub(r"([aiu])\1+", r"\1", out)          # aa->a, ii->i, uu->u
    # Strip the inherent schwa only if the source really ended in a consonant
    # (ignoring a trailing virama/nukta/anusvara).
    tail = word.rstrip("़्ंँ")
    if tail and _CONSONANT.match(tail[-1]) and out.endswith("a"):
        out = out[:-1]
    return out


def romanize(text: str) -> str:
    """Rewrite Devanagari runs in `text` as Latin Hinglish; leave the rest as-is."""
    if not text:
        return text
    return _DEVA_RUN.sub(lambda m: _romanize_word(m.group(0)), text)


if __name__ == "__main__":
    import sys
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    samples = [
        "भाई जार्विस मुझे बताओ की मेरा नाम क्या है और मेरी music choices क्या है",
        "और वाई क्यान ने?",
        "मैंने पिछला जो मैसेज तुमें दिया था, उस में काफी कुछ था",
        "turn off the lights",                      # pure English must survive intact
        "Jarvis, मुझे dikhra hai ki काफी dikkatein hain",
    ]
    for s in samples:
        print(f"IN : {s}\nOUT: {romanize(s)}\n")
