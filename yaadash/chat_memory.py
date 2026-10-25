"""What JARVIS learned from his own conversations with Aman: the read side, used per turn.

Until 2026-10-14 nothing from a conversation came back. Every turn was written to the
memories table as a `voice_interaction` row (156 of them by 10-14) and retrieval skips
that source on purpose, so a correction he gave, a song he loved or "call me sir" was
gone the moment the 6-exchange short-term buffer rolled over. "Remember that." did not
work either: it named nothing, so it fell through to the model, whose episodic recall
found nothing in the Instagram archive and said "I don't have a record of that".

learn_chats.py (the write side, run by the app's crew after a chat goes quiet) reads the
transcripts and keeps what matters in a SEPARATE store, data/yaadash/learned/:

    memories.json     facts, preferences, corrections, standing instructions, don'ts,
                      callbacks and style exemplars, each with its evidence (session#turn),
                      confidence, first/last seen and status (active / superseded / retracted)
    prefs_live.json   standing preferences he gave by voice, written at once by JARVIS's
                      own process ("call me sir, always")
    lancedb/          chat_turns: every turn, embedded, for "what did I tell you about ...?"
    reviews.json      his Keep / Wrong verdicts on recent memories, from the Yaadash tab;
                      a memory marked Wrong reads as "rejected" at once (memories())

Three writers, three files: the crew writes memories.json and the turn index, JARVIS's
process writes only prefs_live.json, the app server only reviews.json, so none can tear
another's file.

This module is what agent.py calls (three small hooks):
    handle_command(text, previous)  "remember that." / "note it" saves HIS previous
                                    statement; "call me sir, always" is kept
    adjust_persona(persona)         the address he asked for, standing instructions and
                                    don'ts, in the STATIC system message (it changes only
                                    when they do, so Ollama's cached prefix survives)
    context_block(query)            per turn, at most ~250 tokens: the learned memories
                                    relevant to this message, at most 2 style exemplars,
                                    and dated excerpts when he asks about an earlier chat

Everything degrades: no embedder (the agent tests stub yaadash_v2), no store, a corrupt
file — each gives an empty block, never a broken reply.
"""
from __future__ import annotations

import json
import os
import re
import threading
import time
from datetime import datetime, timedelta
from pathlib import Path
from typing import Callable, Iterable, Optional

try:
    import home
    _DEFAULT_DIR = home.YAADASH_DATA / "learned"
except Exception:                                    # imported outside the JARVIS layout
    _DEFAULT_DIR = Path(__file__).resolve().parents[1] / "data" / "yaadash" / "learned"


def learned_dir() -> Path:
    """data/yaadash/learned, or JARVIS_LEARNED_DIR (tests point it at a scratch folder)."""
    return Path(os.environ.get("JARVIS_LEARNED_DIR") or _DEFAULT_DIR)


MEMORIES_FILE = "memories.json"
PREFS_FILE = "prefs_live.json"
TURNS_TABLE = "chat_turns"

KINDS = ("fact", "preference", "correction", "instruction", "dont", "callback", "exemplar")
BLOCK_MAX_CHARS = 1000         # ~250 tokens at ~4 characters a token: the 4B model's prefill is his wait
# Characters bound English, not Devanagari or emoji, which cost about a token each
# (2026-10-23 audit: 1,000 characters of Hindi in the block were ~900 tokens). Both hold.
BLOCK_MAX_TOKENS = 250
PERSONA_MAX_CHARS = 700        # the static addition (address, instructions, don'ts)
MAX_RELEVANT = 4               # learned memories per turn
MAX_EXEMPLARS = 2
MAX_INSTRUCTIONS = 5
MAX_DONTS = 3
MAX_CHAT_EXCERPTS = 2
# bge-small cosine DISTANCE (lower = closer). Measured 2026-10-14 on the memories distilled
# from his first week of chats: a short learned memory sits 0.48-0.62 from the questions it
# answers AND from unrelated ones ("turn on the fan" 0.49 from a music preference; "which
# song did I love" 0.48 from the right one), so distance cannot gate on its own. A memory is
# relevant when it shares a content word with the message (counting the words of the line
# of his it came from) and is not far off; distance only orders the candidates.
RELEVANT_MAX_DISTANCE = 0.60
# One word of the memory, or two of the line it came from. Half that (one word of the line)
# let "explain setup and hold time" pull in a memory about the board (10-14 probe: off-topic
# hits 0/8 -> 1/8) and found nothing more.
MIN_SHARED_WORDS = 1.0
CHAT_MAX_DISTANCE = 0.36      # a whole turn of his vs a question about it: the recall gates' range
_lock = threading.Lock()


# ---------------------------------------------------------------------------- text
# Latin words and Devanagari words (with their vowel signs): until 2026-10-23 a Hindi
# line in Devanagari had no "content words" at all, so "isko yaad rakhna" after it
# answered "Remember what?" and the ingest marked it noise.
_TOKEN = re.compile(r"[a-z0-9]+|[ऀ-ॿ]+")
STOP = set("""a an the and or but if then so to of in on at for with from by as is are was were be been being
it its this that these those i me my mine you your yours he him his she her we us our they them their what which
who whom when where why how do does did done doing have has had can could will would shall should may might must
not no yes yeah ok okay just also very really actually like bro man jarvis sir aman please hey hi hello there here
about into than too now then again some any all more most much many one two get got go going want wanted know
tell told say said ask asked hai hain h ka ki ke ko se me mein main mai tha thi the bhai yaar kya kyun toh to bhi
""".split())


def _stem(w: str) -> str:
    """Symmetric light stemming: "loved", "love" and "loves" all -> "lov" (an asymmetric
    stemmer is how yaadash_recall once missed "completed" for "complete")."""
    for suf in ("ing", "ed", "es", "s"):
        if len(w) > 4 and w.endswith(suf) and not w.endswith("ss"):
            w = w[: -len(suf)]
            break
    return w[:-1] if len(w) > 3 and w.endswith("e") else w


def content_words(text: str) -> set:
    return {_stem(w) for w in _TOKEN.findall((text or "").lower().replace("’", "'"))
            if len(w) >= 3 and w not in STOP}


def lexical_overlap(a: str, b: str) -> int:
    return len(content_words(a) & content_words(b))


def approx_tokens(text: str) -> int:
    """A tokenizer-free upper-ish estimate: ~4 ASCII characters a token, one token for
    every other character (Devanagari, emoji)."""
    text = text or ""
    ascii_chars = sum(1 for c in text if ord(c) < 128)
    return (ascii_chars + 3) // 4 + (len(text) - ascii_chars)


_WORDS = re.compile(r"[a-z']+|[ऀ-ॿ]+")


def garbled(text: str) -> bool:
    """A few words, or one word over and over: speech recognition noise, not a statement."""
    words = _WORDS.findall((text or "").lower())
    if len(words) < 3:
        return True
    return len(words) >= 4 and len(set(words)) / len(words) < 0.5


def clip(text: str, limit: int) -> str:
    text = " ".join((text or "").split())
    if len(text) <= limit:
        return text
    head = text[: limit - 1]
    head = head[: head.rfind(" ")] if " " in head else head
    return head.rstrip(" ,;:") + "…"


# ---------------------------------------------------------------------- embeddings
def _embedder() -> Optional[Callable]:
    """yaadash_v2.embed when the real module is loaded (JARVIS's process has it warm);
    None in the agent tests, which stub yaadash_v2 without one."""
    try:
        import yaadash_v2
        fn = getattr(yaadash_v2, "embed", None)
        return fn if callable(fn) else None
    except Exception:
        return None


_vec_cache: dict = {}


def _vectors(texts: list) -> Optional[list]:
    emb = _embedder()
    if emb is None or not texts:
        return None
    missing = [t for t in texts if t not in _vec_cache]
    try:
        if missing:
            for t, v in zip(missing, emb(missing)):
                _vec_cache[t] = [float(x) for x in v]
        if len(_vec_cache) > 5000:                 # a bound, not a policy: memories are few
            _vec_cache.clear()
            return _vectors(texts)
        return [_vec_cache[t] for t in texts]
    except Exception:
        return None


def _query_vec(query: str) -> Optional[list]:
    emb = _embedder()
    if emb is None:
        return None
    try:
        return [float(x) for x in emb(query, is_query=True)[0]]
    except Exception:
        return None


def _distance(a: list, b: list) -> float:
    return 1.0 - sum(x * y for x, y in zip(a, b))       # both L2-normalised


# --------------------------------------------------------------------- the files
class _Cached:
    """A JSON file re-read only when its mtime changes."""

    def __init__(self, name: str, default):
        self.name, self.default = name, default
        self._sig, self._data = None, default

    def path(self) -> Path:
        return learned_dir() / self.name

    def read(self):
        p = self.path()
        try:
            st = p.stat()
        except OSError:
            self._sig, self._data = None, self.default
            return self.default
        sig = (str(p), st.st_mtime_ns, st.st_size)
        if sig != self._sig:
            try:
                self._data = json.loads(p.read_text(encoding="utf-8"))
                self._sig = sig
            except Exception:
                pass                                   # keep the last good copy
        return self._data


_memories = _Cached(MEMORIES_FILE, [])
_prefs = _Cached(PREFS_FILE, {})
# His Keep / Wrong verdicts from the Yaadash tab: {memory id: {"verdict", "ts"}}. A third
# file with a third writer (the app server), so the crew's memories.json and JARVIS's
# prefs_live.json are never written by two processes.
REVIEWS_FILE = "reviews.json"
_reviews = _Cached(REVIEWS_FILE, {})
_reviews_lock = threading.Lock()
REVIEW_KINDS = ("fact", "preference", "correction", "instruction", "dont", "callback")   # not style exemplars
REVIEW_DAYS = 14


def reviews() -> dict:
    r = _reviews.read()
    return r if isinstance(r, dict) else {}


def review_queue(n: int = 8, days: float = REVIEW_DAYS, now: Optional[float] = None) -> dict:
    """What JARVIS learned lately and he has not judged yet, newest first.
    {"items": [...], "pending": how many in all, "kept": n, "wrong": n}."""
    now = time.time() if now is None else now
    done = reviews()
    since = now - days * 86400
    todo = [m for m in memories() if m.get("kind") in REVIEW_KINDS and m.get("id") not in done
            and float(m.get("last_seen") or m.get("first_seen") or 0) >= since]
    todo.sort(key=lambda m: float(m.get("first_seen") or 0), reverse=True)
    keep = ("id", "kind", "text", "confidence", "support", "first_seen", "last_seen", "by")
    items = [{**{k: m.get(k) for k in keep}, "evidence": len(m.get("evidence") or [])} for m in todo[:max(0, n)]]
    verdicts = [v.get("verdict") for v in done.values()]
    return {"items": items, "pending": len(todo), "kept": verdicts.count("keep"), "wrong": verdicts.count("wrong")}


def review(memory_id: str, verdict: str, now: Optional[float] = None) -> bool:
    """Keep (it stays, and leaves the queue) or Wrong (JARVIS stops using it now).
    False for an id that is not a learned memory; ValueError for any other verdict."""
    if verdict not in ("keep", "wrong"):
        raise ValueError("verdict must be keep | wrong")
    if not any(m.get("id") == memory_id for m in memories(active_only=False)):
        return False
    with _reviews_lock:
        cur = dict(reviews())
        cur[memory_id] = {"verdict": verdict, "ts": time.time() if now is None else now}
        write_json(learned_dir() / REVIEWS_FILE, cur)
    return True


def write_json(path: Path, obj) -> None:
    """Atomic: a reader in another process sees the old file or the new one, never half."""
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + f".{os.getpid()}.tmp")
    tmp.write_text(json.dumps(obj, ensure_ascii=False, indent=1), encoding="utf-8")
    os.replace(tmp, path)


def memories(active_only: bool = True) -> list:
    """The learned memories. One he marked Wrong in the app (reviews.json) reads as
    status "rejected" from the moment he says so: it is never in a reply again, even
    though memories.json, which only the crew writes, still calls it active."""
    rows = _memories.read()
    if not isinstance(rows, list):
        return []
    wrong = {k for k, v in reviews().items() if v.get("verdict") == "wrong"}
    out = []
    for m in rows:
        if not isinstance(m, dict):
            continue
        if m.get("id") in wrong and m.get("status", "active") == "active":
            m = {**m, "status": "rejected"}
        if not active_only or m.get("status", "active") == "active":
            out.append(m)
    return out


def live_prefs() -> dict:
    p = _prefs.read()
    return p if isinstance(p, dict) else {}


# -------------------------------------------------------------- standing preferences
def address() -> tuple[Optional[str], list]:
    """(what to call him, names he asked not to be called). The newest of his live
    command (prefs_live.json) and a learned instruction wins."""
    best = (0.0, None, [])
    p = live_prefs()
    if p.get("address"):
        best = (float(p.get("set") or 0), p["address"], list(p.get("avoid") or []))
    for m in memories():
        meta = m.get("meta") or {}
        if m.get("kind") == "instruction" and meta.get("address"):
            t = float(m.get("last_seen") or 0)
            if t > best[0]:
                best = (t, meta["address"], list(meta.get("avoid") or []))
    return best[1], best[2]


_HONORIFICS = {"sir", "boss", "chief", "captain", "master", "maestro", "bhai", "bro", "dude", "king", "legend",
               "commander", "doc", "professor", "sahab", "saab", "sahib"}
_NOT_A_NAME = {"anymore", "again", "back", "later", "now", "tomorrow", "today", "tonight", "when", "if", "at", "on",
               "in", "after", "before", "please", "that", "this", "it", "by", "every", "every", "always", "never",
               "only", "once", "you", "a", "an", "the", "up", "out", "and", "or", "but", "so", "not"}
_CALL_ME = re.compile(r"\b(?:call|address|refer\s+to)\s+me\s+(?:as\s+)?[\"'“]?([A-Za-z]+)", re.I)
_NEGATED = re.compile(r"(?:\bnot|n't|\bnever|\bstop|\bno\s+longer|\bno\s+more|\bquit)\s+(?:to\s+)?(?:\w+\s+){0,2}$", re.I)


def parse_address(text: str) -> Optional[dict]:
    """"Don't call me Aman, call me sir, always" -> {"address": "sir", "avoid": ["Aman"]}.
    None when he asked for nothing of the sort ("call me at 9" is not a name)."""
    want, avoid = None, []
    for m in _CALL_ME.finditer(text or ""):
        word = m.group(1)
        low = word.lower()
        if low in _NOT_A_NAME:
            continue
        if not (low in _HONORIFICS or word[:1].isupper()):
            continue
        if _NEGATED.search(text[max(0, m.start() - 30): m.start()]):
            if word not in avoid:
                avoid.append(word if word[:1].isupper() else word.capitalize())
        else:
            want = low if low in _HONORIFICS else word
    if not want:
        return None
    return {"address": want, "avoid": [a for a in avoid if a.lower() != want.lower()]}


def save_address(pref: dict, evidence: str = "live") -> None:
    with _lock:
        cur = dict(live_prefs())
        cur.update(address=pref["address"], avoid=pref.get("avoid") or [], set=time.time(), evidence=evidence)
        write_json(learned_dir() / PREFS_FILE, cur)


# ------------------------------------------------------- "remember that." (anaphora)
_FILLER = re.compile(
    r"^(?:\s*(?:hey|hi|ok(?:ay)?|oi|arre?|so|and|yeah|yes|yep|haan|ha|no|actually|listen|look|well|right|"
    r"jarvis|bro|man|bhai|sir|please|i\s+(?:would\s+)?like\s+to\s+correct\s+you(?:\s+factually)?|"
    r"let\s+me\s+(?:correct\s+you|tell\s+you)|you\s+know|i\s+mean)\b[\s,.:;!-]*)+", re.I)
# A memory verb aimed at "it / that / this" (or Hinglish "isko / ye ... yaad rakh").
_ANAPHORIC = [
    r"(?:i\s+(?:want|need)\s+you\s+to|you\s+(?:have|need)\s+to|you\s+should|can\s+you|could\s+you|will\s+you|"
    r"would\s+you|please|just|so)?\s*(?:remember|note|save|store|memori[sz]e|keep|log|record|write)\s+"
    r"(?:it|that|this|that\s+one|this\s+one|what\s+i\s+(?:just\s+)?said)(?:\s+(?:down|in\s+mind|for\s+me|please|"
    r"jarvis|now|then|too))*",
    r"(?:make|take)\s+a\s+note\s+(?:of\s+)?(?:it|that|this)",
    r"(?:ye(?:h)?|isko|ise|is\s+ko|isey)?\s*(?:yaad|yad)\s+rakh(?:na|o|iye|ie|lo|le|na\s+hai)?(?:\s+lo)?",
    r"(?:ye(?:h)?|isko|ise)\s+note\s+kar(?:\s*lo|\s*le|o|na)?",
    r"(?:remember|note|save)\s*$",
]
_ANAPHORIC_RX = re.compile("|".join(f"(?:{p})" for p in _ANAPHORIC), re.I)
# What he wraps such a command in: it carries no fact of its own.
_WRAPPER = re.compile(
    r"\b(?:that'?s\s+why\s+i\s+(?:am|'m)\s+(?:saying|telling\s+you)\s+it(?:\s+again)*(?:\s+and\s+again)?|"
    r"that'?s\s+all|that\s+is\s+all|also|okay|ok|yeah|yes|alright|right|got\s+it|understood|again|jarvis|sir|bro|"
    r"man|please|now|i\s+said|i\s+told\s+you|i\s+am\s+telling\s+you|for\s+me|thank\s+you|thanks)\b", re.I)


def is_bare_memory_command(text: str) -> bool:
    """"Remember that." / "note it" / "I want you to remember it" / "isko yaad rakhna":
    a memory command that names nothing, so it means what he said just before."""
    t = " ".join((text or "").split())
    if not t or len(t.split()) > 40 or not _ANAPHORIC_RX.search(t):
        return False
    if re.search(r"\b(?:do|did|can|could|will|would)\s+you\s+remember\b.*\?|\byaad\s+(?:hai|h|tha|thi)\b", t, re.I):
        return False                                  # "do you remember that?" is a question
    rest = _WRAPPER.sub(" ", _ANAPHORIC_RX.sub(" ", t))
    return len(content_words(rest)) <= 1


_QUESTION_START = re.compile(r"^\s*(?:(?:so\s+)?you\s+mean|what|which|who|whom|when|where|why|how|is|are|do|does|did|"
                             r"can|could|will|"
                             r"would|should|kya|kab|kaun|kahan|kaise|kyun)\b", re.I)
_GARBLED_REPLY = re.compile(r"\b(?:didn'?t|did\s+not|couldn'?t)\s+catch\b|\bgot\s+lost\b|\bonce\s+more\b|"
                            r"\bsay\s+(?:it|that)\s+again\b|\bplease\s+repeat\b", re.I)
MIN_STATEMENT_WORDS = 4
MAX_SAVED_WORDS = 70


def clean_statement(text: str) -> str:
    t = " ".join((text or "").split())
    t = _FILLER.sub("", t).strip(" ,.;:-")
    words = t.split()
    if len(words) > MAX_SAVED_WORDS:
        t = " ".join(words[:MAX_SAVED_WORDS]).rstrip(" ,;:") + "…"
    return t[:1].upper() + t[1:] if t else t


def previous_statement(previous: Iterable) -> Optional[str]:
    """His last substantive statement before the command: not another memory command,
    not a question, not a few garbled words, and not a line JARVIS answered with "I
    didn't catch that" (it was misheard). Items are his lines, or (his line, JARVIS's
    reply) pairs; JARVIS's own words are never a candidate."""
    import remember as _rem
    for item in reversed(list(previous or [])):
        said, reply = (item[0], item[1]) if isinstance(item, (tuple, list)) else (item, "")
        s = " ".join((said or "").split())
        if not s or is_bare_memory_command(s):
            continue
        if _GARBLED_REPLY.search(reply or "") or garbled(s):
            continue                                   # misheard: never a fact (2026-10-23 audit)
        try:
            if _rem.parse(s):
                continue                               # an explicit "remember that X" is saved already
        except Exception:
            pass
        c = clean_statement(s)
        if len(c.split()) < MIN_STATEMENT_WORDS or len(content_words(c)) < 2:
            continue
        if c.rstrip().endswith("?") and _QUESTION_START.match(c):
            continue
        return c
    return None


def gist(statement: str, max_words: int = 18) -> str:
    """The first clause or two of what he said, for a one-sentence confirmation."""
    words = statement.split()
    if len(words) <= max_words:
        return statement.rstrip(" .!,;:…")
    head = " ".join(words[:max_words])
    cut = max(head.rfind(","), head.rfind(";"), head.rfind("."))
    if cut > len(head) // 2:
        head = head[:cut]
    return head.rstrip(" .!,;:…") + "…"


class Command:
    def __init__(self, kind: str, reply: str, ok: bool = True, saved: Optional[str] = None):
        self.kind, self.reply, self.ok, self.saved = kind, reply, ok, saved


def _call() -> str:
    addr, _ = address()
    return addr or "sir"


def _confirm(statement: str) -> str:
    import remember as _rem
    g = gist(statement)
    english = not (_rem._DEVANAGARI.search(g) or _rem._HINDI_WORDS.search(g))
    return _rem._second_person(g) if english else ""


def handle_command(text: str, previous: Iterable, save: Callable[[str], bool]) -> Optional[Command]:
    """A memory command about the conversation itself, answered without the model, or None.

    previous: this conversation so far, oldest first: his messages, or (his message,
    JARVIS's reply) pairs so a misheard line can be told apart. save: stores his
    words as a told fact (yaadash_v2.remember_told) and says whether they were new."""
    t = " ".join((text or "").split())
    if not t:
        return None
    pref = parse_address(t)
    if pref:
        save_address(pref)
        if len(t.split()) <= 70:
            avoid = f", not {pref['avoid'][0]}" if pref.get("avoid") else ""
            return Command("address", f"Very good, {pref['address']}. \"{pref['address'].capitalize()}\" it is"
                                      f"{avoid}, from now on.")
        return None                                   # saved; the model answers the rest of it
    if not is_bare_memory_command(t):
        return None
    who = _call()
    stmt = previous_statement(previous)
    if not stmt:
        return Command("remember", f"Remember what, {who}? Say it once more and I'll keep it.", ok=False)
    new = bool(save(stmt))
    said = _confirm(stmt)
    if new:
        reply = f"Saved, {who}: {said}." if said else f"Saved, {who}: what you just told me."
    else:
        reply = f"I already have that, {who}: {said}." if said else f"I already have that saved, {who}."
    return Command("remember", reply, ok=True, saved=stmt)


# ------------------------------------------------------------------ the persona
_SIR_LINE = re.compile(r"Call him \"sir\" now and then, Aman otherwise\.")
MEMORY_NOTE = ("YOUR MEMORY OF YOUR CHATS: every conversation with him is saved on this laptop. While the app runs, "
               "after a chat has been quiet for ten minutes (and when the app starts) you read it over and keep what "
               "matters: facts he tells you, his corrections, standing instructions, and what he enjoyed. LEARNED "
               "FROM YOUR CHATS in CONTEXT is that memory. If he asks, say so plainly: \"remember that\" saves "
               "something at once; the rest you learn after the chat, not mid-sentence.")


def persona_addition() -> str:
    """The static lines: standing instructions and don'ts (newest first, capped)."""
    act = memories()
    instr = sorted((m for m in act if m.get("kind") == "instruction" and not (m.get("meta") or {}).get("address")),
                   key=lambda m: -(m.get("last_seen") or 0))[:MAX_INSTRUCTIONS]
    donts = sorted((m for m in act if m.get("kind") == "dont"),
                   key=lambda m: (-(m.get("support") or 1), -(m.get("last_seen") or 0)))[:MAX_DONTS]
    out = [MEMORY_NOTE]
    if instr:
        out.append("HIS STANDING INSTRUCTIONS (from your chats; follow them): "
                   + " ".join(clip(m["text"], 140).rstrip(".") + "." for m in instr))
    if donts:
        out.append("HE DISLIKED (never do these again): " + " ".join(clip(m["text"], 140).rstrip(".") + "." for m in donts))
    text = "\n".join(out)
    return clip(text, PERSONA_MAX_CHARS + len(MEMORY_NOTE))


def adjust_persona(base: str) -> str:
    """The persona with what he asked for: his preferred address and the learned lines,
    placed before LENGTH (the rule that must stay last). Deterministic for the same
    files, so the system message stays byte-identical turn to turn."""
    try:
        addr, avoid = address()
        if addr:
            rule = f'Address him as "{addr}", always: his standing instruction'
            rule += f' (never "{avoid[0]}").' if avoid else "."
            if _SIR_LINE.search(base):
                base = _SIR_LINE.sub(rule, base)
            else:
                base = base.replace("LENGTH:", rule + "\n\nLENGTH:", 1)
            for name in avoid:
                # the invented style examples greet him by name; they follow the rule too
                base = re.sub(rf"(You:[^\n]*?)\b{re.escape(name)}\b", rf"\g<1>{addr}", base)
        add = persona_addition()
        if add:
            head, sep, tail = base.rpartition("LENGTH:")
            base = f"{head}{add}\n\n{sep}{tail}" if sep else f"{base}\n\n{add}"
    except Exception as e:                            # memory never breaks the persona
        print(f"\n[Chat memory persona error: {e}]")
    return base


# --------------------------------------------------------------- per-turn context
_CHAT_EPISODIC = re.compile(
    r"\b(?:i\s+(?:told|said\s+to|asked|mentioned\s+to|showed)\s+you|did\s+i\s+(?:tell|say|ask|mention)|what\s+did\s+i\s+"
    r"(?:say|tell|ask|suggest|want)|did\s+i\s+(?:suggest|propose|want|love|like|ask\s+for)|"
    r"we\s+(?:talked|spoke|discussed|chatted)|our\s+(?:last\s+)?(?:chat|talk|conversation)|"
    r"you\s+(?:said|told\s+me|suggested|played)|last\s+(?:time|night|chat)|yesterday|earlier\s+today|the\s+other\s+"
    r"day|kal\s+(?:raat\s+)?(?:maine|tune|humne)|maine\s+(?:tujhe|tumhe|aapko)\s+(?:bola|kaha|bataya)|"
    r"remember\s+when\s+i)\b", re.I)


def is_chat_episodic(query: str) -> bool:
    return bool(_CHAT_EPISODIC.search(query or ""))


def relevant(query: str, k: int = MAX_RELEVANT) -> list:
    """Active learned memories (not exemplars, not instructions/don'ts: those are in the
    persona) relevant to this message: embeddings when available, word overlap always."""
    pool = [m for m in memories() if m.get("kind") in ("fact", "preference", "correction", "callback")]
    if not pool or not (query or "").strip():
        return []
    qv = _query_vec(query)
    vecs = _vectors([m["text"] for m in pool]) if qv is not None else None
    q = content_words(query)
    scored = []
    for i, m in enumerate(pool):
        lex = len(q & content_words(m["text"]))
        # the words of the line of his it came from count at half weight: the model's write-up
        # often drops them ("light and fan" -> "physical control of devices")
        lex_src = len(q & content_words(m.get("src") or "")) / 2
        words = lex + lex_src
        d = _distance(qv, vecs[i]) if vecs is not None else 0.5
        if words >= MIN_SHARED_WORDS and d <= RELEVANT_MAX_DISTANCE:
            # corrections first among equals: they are why this store exists
            scored.append((-words - (0.5 if m.get("kind") == "correction" else 0.0), d, m))
    scored.sort(key=lambda x: (x[0], x[1]))
    return [m for _, _, m in scored[:k]]


def exemplars(query: str, k: int = MAX_EXEMPLARS) -> list:
    """Replies he enjoyed, most related to this message first; a "he" line that was mostly
    misheard is no example of anything."""
    pool = [m for m in memories() if m.get("kind") == "exemplar" and (m.get("meta") or {}).get("you")]
    if not pool:
        return []
    def overlap(m):
        meta = m.get("meta") or {}
        return lexical_overlap(query, meta.get("he", "") + " " + meta.get("you", ""))
    chatty = not ((query or "").rstrip().endswith("?") or _QUESTION_START.match(query or ""))
    # a factual question gets an example only when one is about the same thing; small talk
    # (where tone is the whole answer) gets the best ones
    pool = [m for m in pool if chatty or overlap(m) >= 1]
    ranked = sorted(pool, key=lambda m: (-overlap(m), -(m.get("support") or 1), -(m.get("last_seen") or 0)))
    return ranked[:k]


def _when(ts) -> str:
    try:
        return datetime.fromtimestamp(float(ts)).strftime("%d %b")
    except Exception:
        return ""


def table_names(db) -> list:
    """LanceDB renamed table_names() to list_tables() (which returns a response object)."""
    try:
        r = db.list_tables()
        return list(getattr(r, "tables", r))
    except AttributeError:
        return list(db.table_names())


def _turns_table():
    try:
        import lancedb
        p = learned_dir() / "lancedb"
        if not p.exists():
            return None
        db = lancedb.connect(str(p), read_consistency_interval=timedelta(seconds=5))
        return db.open_table(TURNS_TABLE) if TURNS_TABLE in table_names(db) else None
    except Exception:
        return None


def recall_chats(query: str, k: int = MAX_CHAT_EXCERPTS) -> list:
    """Dated excerpts of earlier chats with JARVIS: his line and the reply, best first."""
    tbl = _turns_table()
    qv = _query_vec(query)
    if tbl is None or qv is None:
        return []
    try:
        rows = (tbl.search(qv).metric("cosine").where("role = 'you' AND noise = false", prefilter=True)
                .limit(25).to_list())
    except Exception:
        return []
    # A line whose only memory was later corrected is not quoted back as if it stood
    # (2026-10-23 audit: "the ESP32 drives the relays" came back as a dated excerpt
    # after the correction superseded it).
    every = memories(active_only=False)
    live = {e for m in every if m.get("status", "active") == "active" for e in m.get("evidence") or []}
    stale = {e for m in every if m.get("status") in ("superseded", "retracted", "rejected")
             for e in m.get("evidence") or []} - live
    scored = []
    for r in rows:
        if r.get("id") in stale:
            continue
        lex = lexical_overlap(query, r["text"])
        if r["_distance"] <= CHAT_MAX_DISTANCE or lex >= 2:
            scored.append((r["_distance"] - 0.04 * lex, r))
    scored.sort(key=lambda x: x[0])
    out = []
    for _, r in scored[:k]:
        reply = ""
        try:
            nxt = (tbl.search().where(f"session = '{r['session']}' AND turn = {int(r['turn']) + 1} AND role = 'jarvis'")
                   .limit(1).to_list())
            reply = nxt[0]["text"] if nxt else ""
        except Exception:
            pass
        if reply and _GARBLED_REPLY.search(reply):
            continue
        line = f"[{_when(r['ts'])}] He: {clip(r['text'], 220)}"
        if reply:
            line += f" / You: {clip(reply, 140)}"
        out.append(line)
    return out


def context_block(query: str) -> tuple[str, bool]:
    """(the per-turn block, whether it holds something from his chats with JARVIS: an
    excerpt or a learned memory). agent.py adds "the archive has NO record of this" only
    when this is False, so a learned memory must count: until 2026-10-23 a question
    answered by one ("what did I tell you about the ESP32 on COM9?") also got that
    verdict. At most BLOCK_MAX_CHARS and BLOCK_MAX_TOKENS; empty when nothing is relevant."""
    try:
        sections = []                                  # (header, lines), in priority order
        chats = recall_chats(query) if is_chat_episodic(query) else []
        rel = relevant(query)
        learned = ("LEARNED FROM YOUR CHATS WITH HIM (his corrections override older facts):",
                   [f"- [{m['kind']}] {clip(m['text'], 200)} ({_when(m.get('last_seen'))})" for m in rel])
        if rel and any(m.get("kind") == "correction" for m in rel):
            sections.append(learned)                   # a correction first: an excerpt must not crowd it out
        if chats:                                      # he asked about an earlier chat: the record next
            sections.append(("EARLIER CHATS WITH HIM (real, dated; answer from these if they fit):",
                             [f"- {c}" for c in chats]))
        if rel and learned not in sections:
            sections.append(learned)
        ex = exemplars(query, MAX_EXEMPLARS if not sections else 1)
        if ex:
            sections.append(("REPLIES HE ENJOYED (match the tone, never reuse the words):",
                             [f"- He: {clip(m['meta']['he'], 90)} / You: {clip(m['meta']['you'], 150)}" for m in ex]))
        out, used_chats = "", False
        for header, lines in sections:                 # whole lines only, until the budget is spent
            kept = []
            for line in lines:
                trial = (out + "\n\n" if out else "") + header + "\n" + "\n".join(kept + [line])
                if len(trial) > BLOCK_MAX_CHARS or approx_tokens(trial) > BLOCK_MAX_TOKENS:
                    break
                kept.append(line)
            if not kept:
                break
            out = (out + "\n\n" if out else "") + header + "\n" + "\n".join(kept)
            used_chats |= not header.startswith("REPLIES")
        return out, used_chats
    except Exception as e:
        print(f"\n[Chat memory context error: {e}]")
        return "", False
