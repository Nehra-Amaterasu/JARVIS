"""Romanize Devanagari into readable Hinglish, leaving English words untouched.

WHY: Whisper large-v3-turbo transcribes my code-switched speech accurately,
but writes the Hindi parts in Devanagari and the English parts in Latin:

    भाई जार्विस मुझे बताओ की मेरा नाम क्या है और मेरी music choices क्या है

I don't read Devanagari comfortably, and a mixed-script line is hard
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
import unicodedata

from indic_transliteration import sanscript
from indic_transliteration.sanscript import transliterate

# Devanagari block, and the consonant range within it (ka..ha).
_DEVA_RUN = re.compile(r"[ऀ-ॿ]+")
# Gurmukhi (Punjabi). Friends' display names arrive in it, e.g. a name that must
# be searchable by their Latin spelling. Same ITRANS route, different source script.
_GURU_RUN = re.compile(r"[਀-੿]+")
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


def _romanize_gurmukhi(word: str) -> str:
    out = transliterate(word, sanscript.GURMUKHI, sanscript.ITRANS)
    out = _NOISE.sub("", out.replace("M", "n")).lower()
    out = re.sub(r"([aiu])+", r"", out)
    # Strip the inherent schwa only when the source really ends in a consonant
    # (ka..ha), as for Devanagari — "ਸਤੀਜਾ" ends in a vowel sign and keeps its "a".
    tail = word.rstrip("਼੍ੰੱਂ")
    if tail and "ਕ" <= tail[-1] <= "ਹ" and out.endswith("a"):
        out = out[:-1]
    return out


def romanize(text: str) -> str:
    """Rewrite Devanagari and Gurmukhi runs as Latin; leave everything else as-is."""
    if not text:
        return text
    text = _DEVA_RUN.sub(lambda m: _romanize_word(m.group(0)), text)
    return _GURU_RUN.sub(lambda m: _romanize_gurmukhi(m.group(0)), text)


_SYMBOLS = re.compile(r"[^\w\s.'-]", re.UNICODE)

# Unicode "small capital" letters (ᴊᴀʀᴠɪꜱ) are a separate block that NFKC does
# NOT fold, so they need an explicit map. Common in styled Instagram names.
_SMALL_CAPS = str.maketrans(
    "ᴀʙᴄᴅᴇꜰɢʜɪᴊᴋʟᴍɴᴏᴘꞯʀꜱᴛᴜᴠᴡʏᴢ",
    "abcdefghijklmnopqrstuvwyz")


def normalize_name(name: str) -> str:
    """Make a display name searchable and speakable.

    Instagram display names are often "styled" with Unicode Mathematical
    Alphanumeric Symbols — 𝙑𝙖𝙣𝙨𝙝 𝘾𝙝𝙖𝙪𝙙𝙝𝙖𝙧𝙮 is not the letters V-a-n-s-h, it is a
    run of math glyphs, so no search for the plain name can ever match it and TTS cannot
    read it. NFKC compatibility normalisation folds those glyphs back to plain
    letters. Indic scripts are then romanised, and emoji/decoration dropped.
    """
    if not name:
        return ""
    n = unicodedata.normalize("NFKC", name).translate(_SMALL_CAPS)
    n = romanize(n)
    n = _SYMBOLS.sub(" ", n)
    return " ".join(n.split()).strip()


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
    for nm in ["ᴊᴀʀᴠɪꜱ ꜱᴛᴀʀᴋ", "𝙏𝙤𝙣𝙮 𝙎𝙩𝙖𝙧𝙠", "𝓟𝓮𝓹𝓹𝓮𝓻 𝓟𝓸𝓽𝓽𝓼", "ਹਰਪ੍ਰੀਤ ਸਿੰਘ", "test user🖤"]:
        print(f"NAME: {nm!r:40} -> {normalize_name(nm)!r}")
    for s in samples:
        print(f"IN : {s}\nOUT: {romanize(s)}\n")
