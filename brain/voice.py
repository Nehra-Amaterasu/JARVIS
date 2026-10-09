"""JARVIS's voice engine: one speaker, several accents, never fatal, never blocking.

WHY THIS EXISTS (2026-10-09). He spoke through an Indian-English voice
(en-IN-PrabhatNeural) reading romanised Hinglish ("tera naam Aman hai"): an English
voice guessing Hindi words spelled in Latin letters. Measured round-trip (synthesise ->
Whisper -> compare), that is far less intelligible than a native Hindi voice reading
Devanagari. And the speech path could kill a turn: a stray "..." made edge-tts raise
NoAudioReceived and abort the rest of the reply; with no network the voice loop died.

What it does:
  - Default voice: British English (Aman's choice), en-GB.
  - Accents per line. The model wraps performed words in tags the engine reads and the
    screen never shows:  [us]…[/us] American · [uk]…[/uk] British · [hi]…[/hi] Hindi ·
    [in]…[/in] Indian English. An explicit request ("in an American accent", "Hindi
    mein bolo") sets the default for the whole reply.
  - Script routing: any Devanagari run is spoken by the Hindi voice, whatever the tag —
    Hindi is always pronounced by a Hindi speaker.
  - Online: Microsoft neural voices (edge-tts). Offline or failing: Kokoro-82M on the
    CPU (no VRAM — the GPU belongs to the LLM and Whisper). A failing cloud is retried
    after 60 s, not on every sentence.
  - Non-blocking: say() queues text and returns. One worker thread with one persistent
    event loop synthesises in order while the previous sentence plays, so the model
    keeps streaming instead of waiting on audio.
  - Never fatal: text with no letters or digits is skipped; any synthesis error drops
    that sentence and logs it; the conversation goes on.
"""
from __future__ import annotations

import asyncio
import os
import queue
import re
import tempfile
import threading
import time
import uuid
from dataclasses import dataclass
from typing import Callable, Optional


@dataclass(frozen=True)
class Style:
    key: str
    label: str
    edge: str                       # Microsoft neural voice (online)
    kokoro: Optional[tuple]         # (voice, espeak language) for the offline engine
    rate: str = "+0%"
    # Playback gain (0-1) that levels this voice with the British one. Measured speech
    # RMS 2026-10-09: Ryan -19.2 dBFS, Andrew -18.0, Madhur -15.0, Prabhat -14.9;
    # Kokoro bm_george -19.6, am_michael -22.4, hm_psi -15.4. Without it a reply that
    # switches into Hindi jumps ~4 dB louder. Playback can only attenuate.
    edge_gain: float = 1.0
    kokoro_gain: float = 1.0


# Chosen by the round-trip test in docs/DECISIONS.md (2026-10-09 voice entry).
STYLES: dict[str, Style] = {
    "uk": Style("uk", "British", "en-GB-RyanNeural", ("bm_george", "en-gb")),
    "us": Style("us", "American", "en-US-AndrewNeural", ("am_michael", "en-us"), edge_gain=0.87),
    "hi": Style("hi", "Hindi", "hi-IN-MadhurNeural", ("hm_psi", "hi"), edge_gain=0.62, kokoro_gain=0.64),
    "in": Style("in", "Indian English", "en-IN-PrabhatNeural", None, edge_gain=0.61),
}
DEFAULT_STYLE = "uk"

_ALIASES = {"uk": "uk", "british": "uk", "gb": "uk", "us": "us", "american": "us", "usa": "us",
            "hi": "hi", "hindi": "hi", "in": "in", "indian": "in"}
_TAG = re.compile(r"\[(/?)(uk|british|gb|us|american|usa|hi|hindi|in|indian)\]", re.I)
_DEVANAGARI_RUN = re.compile(r"[ऀ-ॿ][ऀ-ॿ\s,.!?।॥'\"\-]*")
_HAS_WORD = re.compile(r"[^\W_]", re.UNICODE)


def strip_tags(text: str) -> str:
    """The text without voice tags — for screens, transcripts and memory."""
    return re.sub(r"[ \t]{2,}", " ", _TAG.sub("", text or "")).strip()


# ------------------------------------------------------------------ what he asked for
_REQUESTS = [
    ("us", re.compile(r"\b(american|us|yankee|new york|nyc|atlanta|la|west coast|east coast) (accent|style)\b|\bin (an |the )?american\b|\blike (an|a) american\b|\bamerican mein\b", re.I)),
    ("uk", re.compile(r"\b(british|english|london|uk|posh) (accent|style)\b|\bin (a |the )?british\b|\blike a (brit|londoner)\b|\bbritish mein\b", re.I)),
    ("hi", re.compile(r"\bin hindi\b|\bhindi (mein|me|main|men)\b|\bhindi (bolo|bol|boliye|batao|sunao)\b|\bspeak hindi\b|\bdevanagari\b", re.I)),
    ("in", re.compile(r"\bindian (accent|english|style)\b|\bdesi accent\b", re.I)),
]


def requested_style(user_text: str) -> Optional[str]:
    """An accent or language Aman explicitly asked for in this message, if any."""
    for key, rx in _REQUESTS:
        if rx.search(user_text or ""):
            return key
    return None


def turn_instruction(style: Optional[str]) -> str:
    """One line for the model's turn when an accent was asked for (where attention is strongest)."""
    if style == "hi":
        return "[VOICE: he wants Hindi. Write the Hindi in Devanagari script, inside [hi]…[/hi]. Never romanise it.]"
    if style in ("us", "uk", "in"):
        return f"[VOICE: he wants a {STYLES[style].label} accent. Put the words performed in it inside [{style}]…[/{style}].]"
    return ""


# ------------------------------------------------------------------ text -> (style, text) segments
_EMOJI = re.compile("[\U0001F300-\U0001FAFF\U00002600-\U000027BF\U0001F000-\U0001F2FF\U0000FE0F\U0000200D]+")


def clean_for_speech(text: str) -> str:
    """Strip markup the model writes for screens but a voice cannot say.

    2026-10-08: Qwen3 emits Markdown (**bold**, *italic*, numbered lists) despite the
    prompt forbidding it, and edge-tts read every marker literally. Prompt rules alone
    are not a reliable guard on model output, so the voice path sanitises unconditionally.
    """
    if not text:
        return text
    t = re.sub(r"`{1,3}[^`]*`{1,3}", "", text)
    t = re.sub(r"\*{1,3}|_{2,}|~~|#{1,6}\s*", "", t)
    t = re.sub(r"^\s*[-*•]\s+", "", t, flags=re.M)
    t = re.sub(r"^\s*\d+[.)]\s+", "", t, flags=re.M)
    t = re.sub(r"\[([^\]]+)\]\([^)]+\)", r"\1", t)
    t = _EMOJI.sub("", t)
    t = re.sub(r"[—–]", ", ", t)
    return re.sub(r"\s+", " ", t).strip()


class Segmenter:
    """Turns streamed sentences into (style, text) segments. Stateful within a turn:
    a tag opened in one sentence stays open into the next until it is closed."""

    def __init__(self, default: str = DEFAULT_STYLE):
        self.default = default
        self.stack: list[str] = []

    def reset(self, default: Optional[str] = None) -> None:
        self.default = default or DEFAULT_STYLE
        self.stack = []

    @property
    def current(self) -> str:
        return self.stack[-1] if self.stack else self.default

    def feed(self, text: str) -> list[tuple[str, str]]:
        out: list[tuple[str, str]] = []
        pos = 0
        for m in _TAG.finditer(text):
            out += self._route(self.current, text[pos:m.start()])
            key = _ALIASES[m.group(2).lower()]
            if m.group(1):                      # closing tag: pop back to the matching one
                if key in self.stack:
                    while self.stack and self.stack.pop() != key:
                        pass
            else:
                self.stack.append(key)
            pos = m.end()
        out += self._route(self.current, text[pos:])
        # Merge neighbours with the same voice; drop pieces with nothing to say.
        merged: list[tuple[str, str]] = []
        for style, chunk in out:
            chunk = clean_for_speech(chunk)
            if not chunk or not _HAS_WORD.search(chunk):
                continue
            if merged and merged[-1][0] == style:
                merged[-1] = (style, f"{merged[-1][1]} {chunk}")
            else:
                merged.append((style, chunk))
        return merged

    @staticmethod
    def _route(style: str, text: str) -> list[tuple[str, str]]:
        """Devanagari always goes to the Hindi voice; the rest keeps the current style."""
        if not text or style == "hi":
            return [(style, text)] if text else []
        parts: list[tuple[str, str]] = []
        pos = 0
        for m in _DEVANAGARI_RUN.finditer(text):
            if m.start() > pos:
                parts.append((style, text[pos:m.start()]))
            parts.append(("hi", m.group(0)))
            pos = m.end()
        if pos < len(text):
            parts.append((style, text[pos:]))
        return parts


# ------------------------------------------------------------------ streaming: when is a sentence ready?
# A sentence ends at . ? ! । or … followed by a space or the end — never inside "3.5".
# Until 2026-10-09 the reply was cut whenever a CHUNK contained one of .?!, so a decimal
# split a sentence, and a chunk of "..." alone reached the voice and crashed it.
_SENTENCE_END = re.compile(r"(?<!\d)[.?!।…]+[\"')\]]*(?=\s|$)")
EARLY_FLUSH_WORDS = 8           # first sentence only: speak at a comma once it has 8+ words


def split_ready(buffer: str, first: bool) -> tuple[str, str]:
    """(ready_text, rest): everything up to the last complete sentence end in `buffer`.
    For the first sentence of a reply, a long clause ending in a comma also counts,
    so the voice starts sooner."""
    last = None
    for m in _SENTENCE_END.finditer(buffer):
        last = m
    if last is not None:
        return buffer[:last.end()], buffer[last.end():]
    if first:
        comma = buffer.rfind(",")
        if comma > 0 and len(buffer[:comma].split()) >= EARLY_FLUSH_WORDS:
            return buffer[:comma + 1], buffer[comma + 1:]
    return "", buffer


# ------------------------------------------------------------------ synthesis engines
class _Kokoro:
    """Offline Kokoro-82M (ONNX, CPU). Loaded lazily: it costs ~1 s and ~300 MB RAM."""

    def __init__(self, model_dir: str):
        self.dir = model_dir
        self._k = None
        self._lock = threading.Lock()

    @property
    def available(self) -> bool:
        return all(os.path.exists(os.path.join(self.dir, f)) for f in ("kokoro-v1.0.int8.onnx", "voices-v1.0.bin"))

    def synth(self, text: str, voice: str, lang: str) -> str:
        with self._lock:
            if self._k is None:
                from kokoro_onnx import Kokoro
                self._k = Kokoro(os.path.join(self.dir, "kokoro-v1.0.int8.onnx"), os.path.join(self.dir, "voices-v1.0.bin"))
            samples, sr = self._k.create(text, voice=voice, speed=1.0, lang=lang)
        import soundfile as sf
        path = os.path.join(tempfile.gettempdir(), f"jarvis_{uuid.uuid4().hex[:8]}.wav")
        sf.write(path, samples, sr)
        return path


async def _edge_synth(text: str, voice: str, rate: str) -> str:
    import edge_tts
    path = os.path.join(tempfile.gettempdir(), f"jarvis_{uuid.uuid4().hex[:8]}.mp3")
    comm = edge_tts.Communicate(text, voice, rate=rate, connect_timeout=4, receive_timeout=12)
    got = 0
    with open(path, "wb") as f:
        async for chunk in comm.stream():
            if chunk["type"] == "audio":
                f.write(chunk["data"])
                got += len(chunk["data"])
    if got < 200:
        raise RuntimeError("no audio")
    return path


class VoiceEngine:
    """say() queues; one worker synthesises in order and hands files to `play`."""

    EDGE_COOLDOWN_S = 60.0

    def __init__(self, play: Callable[[str, str, float], None], log: Callable[[str], None] = print,
                 model_dir: Optional[str] = None, enabled: bool = True):
        self.play = play                         # play(text, audio_path, gain) — the app's playback queue
        self.log = log
        self.enabled = enabled
        self.segmenter = Segmenter()
        self.kokoro = _Kokoro(model_dir or os.path.join(os.path.dirname(os.path.abspath(__file__)), "models", "kokoro"))
        self._edge_down_until = 0.0
        self._q: "queue.Queue[Optional[tuple[str, str, int]]]" = queue.Queue()
        self._epoch = 0                          # bumped by clear(): stale work is dropped
        self.stats = {"edge": 0, "kokoro": 0, "failed": 0, "skipped": 0}
        self._loop = asyncio.new_event_loop()
        self._thread = threading.Thread(target=self._worker, name="voice", daemon=True)
        if enabled:
            self._thread.start()

    # -------------------------------------------------------------- public
    def begin_turn(self, style: Optional[str] = None) -> None:
        """A new reply: close any open accent and set the reply's default voice."""
        self.segmenter.reset(style)

    def say(self, text: str) -> int:
        """Queue a sentence (tags allowed). Returns how many segments were queued."""
        if not self.enabled:
            return 0
        segs = self.segmenter.feed(text or "")
        if not segs:
            self.stats["skipped"] += 1
        for style, chunk in segs:
            self._q.put((style, chunk, self._epoch))
        return len(segs)

    def clear(self) -> None:
        """Barge-in: forget everything not yet synthesised."""
        self._epoch += 1
        try:
            while True:
                self._q.get_nowait()
        except queue.Empty:
            pass

    def pending(self) -> int:
        return self._q.qsize()

    def close(self) -> None:
        self._q.put(None)

    # -------------------------------------------------------------- worker
    def _worker(self) -> None:
        asyncio.set_event_loop(self._loop)
        while True:
            item = self._q.get()
            if item is None:
                return
            style_key, text, epoch = item
            if epoch != self._epoch:
                continue
            result = self._synth(STYLES.get(style_key, STYLES[DEFAULT_STYLE]), text)
            if result and epoch == self._epoch:
                path, gain = result
                try:
                    self.play(text, path, gain)
                except Exception as e:      # playback is the app's business; never kill the worker
                    self.log(f"[voice] playback hand-off failed: {e}")

    def _synth(self, style: Style, text: str) -> Optional[tuple[str, float]]:
        """(audio path, playback gain), or None when no engine could say it."""
        if time.monotonic() >= self._edge_down_until:
            try:
                path = self._loop.run_until_complete(_edge_synth(text, style.edge, style.rate))
                self.stats["edge"] += 1
                return path, style.edge_gain
            except Exception as e:
                self._edge_down_until = time.monotonic() + self.EDGE_COOLDOWN_S
                self.log(f"[voice] online voice failed ({type(e).__name__}: {e}); offline voice for {self.EDGE_COOLDOWN_S:.0f} s")
        # No offline voice for this accent (Indian English): the default one says it.
        offline = style if style.kokoro else STYLES[DEFAULT_STYLE]
        if self.kokoro.available:
            try:
                path = self.kokoro.synth(text, *offline.kokoro)
                self.stats["kokoro"] += 1
                return path, offline.kokoro_gain
            except Exception as e:
                self.log(f"[voice] offline voice failed: {type(e).__name__}: {e}")
        self.stats["failed"] += 1
        return None
