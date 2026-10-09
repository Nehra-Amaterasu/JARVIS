"""'Remember that ...' / '... yaad rakhna' — he tells JARVIS a fact to keep.

Until 2026-10-09 nothing he said by voice became a fact: turns were stored as
`voice_interaction` rows, which retrieval deliberately skips (JARVIS's own old
replies, mistakes included, must not feed back into new ones). So "remember that
my exam is on the 12th" was answered with "Noted", and forgotten.

This is parsed without the model, like room and mission commands: it is instant,
and a question ("do you remember ...?", "yaad hai ...?") can never be mistaken for
an instruction. The words are stored as he said them (yaadash_v2.remember_told),
and every stored fact is in JARVIS's system message from the next turn on.
"""
import re

_ADDRESS = re.compile(r"^\s*(?:(?:hey|ok(?:ay)?|oi|arre?)\s+)?jarvis\b[\s,.:!-]*", re.I)
_POLITE = re.compile(r"^\s*(?:please|plz|pls|bhai|sun(?:o)?|listen|and|aur)\b[\s,.:!-]*", re.I)

# English, instruction first: "remember that ...", "don't forget ...", "make a note that ..."
_EN_PREFIX = re.compile(
    r"^(?:please\s+)?(?:remember|don'?t\s+forget|do\s+not\s+forget|never\s+forget|keep\s+in\s+mind|"
    r"note\s+(?:down\s+)?that|make\s+a\s+note\s+(?:that|of)|save\s+(?:this|that)(?:\s+fact)?)"
    r"(?:\s+(?:that|this))?(?:\s*[,:-]\s*|\s+)(?P<w>.+)$", re.I)
# Hinglish, instruction first: "yaad rakhna ki ...", "yaad rakh lo ..."
_HI_PREFIX = re.compile(
    r"^(?:ye(?:h)?\s+|is(?:\s*ko|e)\s+)?yaad\s+rakh(?:na|o|iye|ie|lo|le|na\s+jarvis)?(?:\s+lo)?"
    r"(?:\s+(?:ki|ke|k))?(?:\s*[,:-]\s*|\s+)(?P<w>.+)$", re.I)
# Instruction last: "... , yaad rakhna", "..., remember that"
_SUFFIX = re.compile(
    r"^(?P<w>.+?)[\s,.;:-]*(?:(?:ye(?:h)?|is\s*ko|ise|isko)\s+)?(?:yaad\s+rakh(?:na|o|iye|ie|lo|le)?(?:\s+lo)?|"
    r"remember\s+(?:that|this)|note\s+(?:that|this)(?:\s+down)?|don'?t\s+forget\s+(?:that|this))"
    r"(?:\s+jarvis)?[\s.!]*$", re.I)

# What follows "remember" that is NOT a fact: a reminder or a question.
_NOT_A_FACT = re.compile(r"^(?:to|when|what|how|why|who|whom|where|whether|if|me|us|kya|kab|kaise|kaun)\b", re.I)
# Questions about memory, never instructions.
_QUESTION = re.compile(r"(?:\?\s*$|^(?:do|did|can|could|will|would)\s+you\s+remember\b|"
                       r"\byaad\s+(?:hai|h|he|tha|thi|hain)\b|\bkya\s+(?:tumhe|tujhe|aapko|apko)\b)", re.I)

MIN_WORDS = 2


def parse(text: str):
    """The words to remember, or None if this is not a 'remember' instruction."""
    t = " ".join((text or "").split())
    if not t or _QUESTION.search(t):
        return None
    t = _ADDRESS.sub("", t)
    for _ in range(2):
        t = _POLITE.sub("", t)
    for pat in (_EN_PREFIX, _HI_PREFIX, _SUFFIX):
        m = pat.match(t)
        if m:
            w = m.group("w").strip(" ,.;:!-\"'")
            w = _ADDRESS.sub("", w).strip(" ,.;:!-\"'")
            if _NOT_A_FACT.match(w) or len(w.split()) < MIN_WORDS:
                return None
            return w
    return None


# --- the spoken confirmation ----------------------------------------------------
# British English only (the persona's rule), so his words are echoed back only when
# they are English; Hinglish gets a plain "Noted".
_HINDI_WORDS = re.compile(r"\b(?:hai|hain|h|mera|meri|mere|mujhe|nahi|nhi|tha|thi|hoon|hu|ko|ka|ki|ke|se|"
                          r"kal|aaj|yeh|ye|woh|wo|wala|wali|karna|krna|bhi|abhi|bahut|bohot)\b", re.I)
_DEVANAGARI = re.compile(r"[ऀ-ॿ]")
_SWAP = {"i": "you", "i'm": "you're", "im": "you're", "i've": "you've", "i'll": "you'll", "i'd": "you'd",
         "me": "you", "my": "your", "mine": "yours", "myself": "yourself", "am": "are", "was": "were"}
_FIRST_PERSON = re.compile(r"\b(?:i'm|im|i've|i'll|i'd|i|me|my|mine|myself)\b|(?<=\bi )(?:am|was)\b", re.I)
MAX_ECHO_WORDS = 20


def _second_person(w: str) -> str:
    out = _FIRST_PERSON.sub(lambda m: _SWAP[m.group(0).lower()], w)
    first = w.split()[0].lower() if w.split() else ""
    # "My exam ..." -> "...that your exam ..."; a name stays capitalised.
    return out[:1].lower() + out[1:] if first in _SWAP else out


def reply(words: str, stored: bool) -> str:
    if not stored:
        return "I already have that noted."
    english = not (_DEVANAGARI.search(words) or _HINDI_WORDS.search(words))
    if (english and len(words.split()) <= MAX_ECHO_WORDS
            and not re.search(r"\b(?:you|your|yours|yourself)\b", words, re.I)):
        return f"Noted. I'll remember that {_second_person(words)}."
    return "Noted. I'll remember that."
