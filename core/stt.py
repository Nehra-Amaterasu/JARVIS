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


def transcribe(model, audio) -> tuple[str, dict]:
    """(raw text in Whisper's script, meta). '' when nothing usable was said."""
    segments, info = _decode(model, audio)
    meta = {"language": info.language, "language_probability": round(float(info.language_probability or 0), 3),
            "redecoded": False}
    if info.language not in KNOWN_LANGS:
        segments, info2 = _decode(model, audio, language="hi")
        meta["redecoded"] = True
    kept = [s for s in segments if keep_segment(s)]
    meta["segments"] = len(segments)
    meta["dropped"] = len(segments) - len(kept)
    text = " ".join(s.text.strip() for s in kept).strip()
    if _PHANTOMS.match(text):
        meta["phantom"] = text
        text = ""
    if kept:
        meta["avg_logprob"] = round(sum(s.avg_logprob for s in kept) / len(kept), 3)
    return text, meta
