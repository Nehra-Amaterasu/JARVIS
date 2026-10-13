"""Speech -> text for JARVIS: Hindi, English and Hinglish, with guards.

Pulled out of jarvis.py (2026-10-09) so it can be tested on recorded clips without
booting the voice loop. What changed and why (from the conversation-loop audit):
  - Language guard. Detection is automatic (he mixes Hindi and English), but nothing
    checked the result: when Whisper decided a Hindi sentence was Urdu, the text came
    back in Arabic script and the romaniser passed it through unreadable. Anything
    detected outside {hi, en} is now re-decoded as Hindi.
  - Vocabulary. The prompt now carries the names and terms he actually says
    (Aankhen, Yaadash, Germoney, Verilog, RWTH, dMAT…), which Whisper otherwise
    mangles into common words.
  - Garbage filter. Segments that are probably silence (high no-speech probability with
    low confidence), repetition loops (compression ratio), and Whisper's known phantom
    phrases on near-silence ("thanks for watching") are dropped instead of answered.
  - Bounded retries. The default temperature fallback can decode up to six times; two
    fallbacks bound the worst case (one real turn took 9 s for a short sentence).
"""
from __future__ import annotations

import re

VOCAB_PROMPT = ("नमस्ते, मैं हिन्दी और English दोनों में बात कर रहा हूँ। Hey Jarvis, kya haal hai? "
                "Aankhen, Yaadash, Mission Germoney, Crucible, Verilog, SystemVerilog, VLSI, HDLBits, "
                "RWTH, TUM, APS, dMAT, IELTS, Goethe, ESP32.")

_PHANTOMS = re.compile(r"^\W*(thanks? (you )?for watching|thank you\.?|subscribe( to (my|the) channel)?|"
                       r"please subscribe|bye\.?|you|धन्यवाद|शुक्रिया|सब्सक्राइब करें?)\W*$", re.I)

KNOWN_LANGS = ("hi", "en")


def _decode(model, audio, language=None):
    segments, info = model.transcribe(
        audio,
        language=language,
        initial_prompt=VOCAB_PROMPT,
        condition_on_previous_text=False,
        vad_filter=True,
        vad_parameters=dict(min_silence_duration_ms=1500, threshold=0.3, speech_pad_ms=400),
        beam_size=5,
        temperature=(0.0, 0.2, 0.4),
    )
    return list(segments), info


def keep_segment(seg) -> bool:
    """False for a segment that is probably not speech or is a decoding loop."""
    if getattr(seg, "no_speech_prob", 0.0) > 0.6 and getattr(seg, "avg_logprob", 0.0) < -1.0:
        return False
    if getattr(seg, "compression_ratio", 0.0) > 2.4:
        return False
    return True


# ------------------------------------------------------------------ short and unsure (2026-10-14)
# With noise suppression off, room noise right after JARVIS spoke came back as short
# nonsense lines (3-4 words, flagged "misheard" twice in one session) and was answered.
# Per-segment filtering (keep_segment) uses Whisper's own defaults (openai/whisper
# transcribe(): no_speech_threshold 0.6, logprob_threshold -1.0, compression 2.4), which
# were tuned on 30-second windows. A 1-4 word clip has a handful of tokens, so one bad
# token moves its mean a lot, and a wrong short line costs a whole wrong turn, while a
# real short command said to JARVIS ("lights off") is clear speech. So a SHORT transcript
# must clear a stricter bar: each threshold tightened by one step (0.1 and 0.2) — a
# starting point, logged in stt_meta ("low_confidence") so it can be tuned on real turns.
# Hindi decodes less confidently than English on this model, so its logprob bar stays at
# Whisper's -1.0. A transcript that names him is never dropped: he is talking to JARVIS.
SHORT_WORDS = 4                      # both misheard lines in the 10-14 review were 3-4 words
SHORT_MAX_NO_SPEECH = 0.5            # Whisper: 0.6
SHORT_MIN_LOGPROB = -0.8             # Whisper: -1.0 (English)
SHORT_MIN_LOGPROB_HI = -1.0          # Hindi / Hinglish keep Whisper's bar
_NAMED = re.compile(r"\b(?:jarvis|jarvi|javis|jervis|जार्विस)\b", re.I)


def unsure_short(text: str, kept: list, language: str = "en") -> str:
    """Why a short transcript is too unsure to answer ('' when it is fine)."""
    if not text or len(text.split()) > SHORT_WORDS or _NAMED.search(text) or not kept:
        return ""
    no_speech = max(float(getattr(s, "no_speech_prob", 0.0) or 0.0) for s in kept)
    logprob = sum(float(getattr(s, "avg_logprob", 0.0) or 0.0) for s in kept) / len(kept)
    bar = SHORT_MIN_LOGPROB_HI if language == "hi" else SHORT_MIN_LOGPROB
    if no_speech > SHORT_MAX_NO_SPEECH:
        return f"no_speech_prob {no_speech:.2f} > {SHORT_MAX_NO_SPEECH}"
    if logprob < bar:
        return f"avg_logprob {logprob:.2f} < {bar}"
    return ""


def transcribe(model, audio) -> tuple[str, dict]:
    """(raw text in Whisper's script, meta). '' when nothing usable was said."""
    segments, info = _decode(model, audio)
    meta = {"language": info.language, "language_probability": round(float(info.language_probability or 0), 3),
            "redecoded": False}
    language = info.language
    if info.language not in KNOWN_LANGS:
        segments, info2 = _decode(model, audio, language="hi")
        meta["redecoded"] = True
        language = "hi"
    kept = [s for s in segments if keep_segment(s)]
    meta["segments"] = len(segments)
    meta["dropped"] = len(segments) - len(kept)
    text = " ".join(s.text.strip() for s in kept).strip()
    if _PHANTOMS.match(text):
        meta["phantom"] = text
        text = ""
    if kept:
        meta["avg_logprob"] = round(sum(s.avg_logprob for s in kept) / len(kept), 3)
        meta["no_speech_prob"] = round(max(float(getattr(s, "no_speech_prob", 0.0) or 0.0) for s in kept), 3)
    why = unsure_short(text, kept, language)
    if why:
        meta["low_confidence"] = why
        meta["dropped_text"] = text
        text = ""
    return text, meta
