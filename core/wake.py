"""Wake on his name: "Jarvis", alone or at the start of a sentence.

Until 2026-10-13 the only wake word was openWakeWord's pretrained "hey_jarvis_v0.1",
trained on synthetic (mostly American) voices saying exactly "hey jarvis". It knows
no "Jarvis" on its own, it scores an Indian accent low, and with a fixed 0.35 bar he
had to stretch the word to be heard; he reported saying it six times in a row with
no answer. JARVIS already has better ears loaded: Whisper large-v3-turbo on the GPU
and Silero VAD on the CPU. So while asleep:

    mic 512-sample frames -> Silero speech probability -> a burst of speech
    (0.25-4 s, 0.3 s of pre-roll) -> Whisper, greedy, no timestamps -> "jarvis"?

A burst that names him wakes him, and anything said after the name in the same
breath ("Jarvis, turn off the light") is the request itself: no chime-then-repeat.
openWakeWord keeps running beside this as a second way in (jarvis.py).

Cost: Silero ~0.17 ms a frame on one CPU thread; Whisper only on speech bursts.
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Callable, Optional

import numpy as np

SAMPLE_RATE = 16000
FRAME = 512                         # Silero v6's window at 16 kHz
START_P = 0.5                       # a frame this likely to be speech starts a burst
STOP_P = 0.35                       # ... and this many quiet frames in a row end it
STOP_QUIET_S = 0.45
PREROLL_S = 0.3                     # the start of "Jar-" comes before Silero is sure
MIN_BURST_S = 0.25                  # shorter is a click or a cough
MAX_BURST_S = 4.0                   # longer is conversation in the room; judged anyway, then cut

# His name as Whisper writes it, in either script, and the slips heard most often.
NAME = re.compile(
    r"\b(?:hey\s+|hi\s+|ok(?:ay)?\s+|oye\s+|o\s+)?"
    r"(j[ae]{1,2}r+[vw]?[iey]{1,2}s{0,2}|jarvi|jarvis|jaarvis|jarwis|javis|jervis|jarvees|charvis|"
    r"जार्विस|जारविस|जरविस|जार्वेस)\b[\s,.!?:;-]*",
    re.I)
WAKE_PROMPT = "Jarvis."             # nudges Whisper towards spelling the name


@dataclass
class Heard:
    """A burst that named him: the whole transcript and what followed the name."""
    text: str
    rest: str                        # "" when he only said the name


def find_name(text: str) -> Optional[Heard]:
    """The name in a transcript (anywhere: "okay Jarvis", "bhai Jarvis sun"), and the
    request after it when it is at least two words long."""
    m = NAME.search(text or "")
    if not m:
        return None
    rest = text[m.end():].strip(" ,.!?:;-")
    return Heard(text=text.strip(), rest=rest if len(rest.split()) >= 2 else "")


@dataclass
class NameSpotter:
    """Feed it mic audio (int16 or float, mono 16 kHz) as it arrives; it returns a
    Heard when a burst of speech names him. vad(frames) -> speech probabilities for
    whole 512-sample frames; transcribe(float32 audio) -> text."""
    vad: Callable[[np.ndarray], np.ndarray]
    transcribe: Callable[[np.ndarray], str]
    hold: Callable[[], bool] = lambda: False        # True while JARVIS himself is talking
    _buf: np.ndarray = field(default_factory=lambda: np.zeros(0, np.float32))
    _pre: list = field(default_factory=list)
    _burst: list = field(default_factory=list)
    _quiet: int = 0
    _voiced: int = 0                                # speech frames in the burst (not pre-roll or tail)
    bursts: int = 0
    judged: int = 0

    def reset(self) -> None:
        self._buf = np.zeros(0, np.float32)
        self._pre, self._burst, self._quiet, self._voiced = [], [], 0, 0

    def feed(self, chunk: np.ndarray) -> Optional[Heard]:
        x = np.asarray(chunk).reshape(-1)
        if x.dtype == np.int16:
            x = x.astype(np.float32) / 32768.0
        self._buf = np.concatenate([self._buf, x.astype(np.float32)])
        n = len(self._buf) // FRAME
        if n == 0:
            return None
        frames = self._buf[:n * FRAME].reshape(n, FRAME)
        self._buf = self._buf[n * FRAME:]
        probs = self.vad(frames)
        for frame, p in zip(frames, probs):
            heard = self._step(frame, float(p))
            if heard is not None:
                return heard
        return None

    def _step(self, frame: np.ndarray, p: float) -> Optional[Heard]:
        if not self._burst:
            self._pre.append(frame)
            del self._pre[:-max(1, int(PREROLL_S * SAMPLE_RATE / FRAME))]
            if p >= START_P and not self.hold():
                self._burst, self._quiet, self._voiced = list(self._pre), 0, 1
            return None
        self._burst.append(frame)
        self._quiet = self._quiet + 1 if p < STOP_P else 0
        self._voiced += p >= STOP_P
        long = len(self._burst) * FRAME >= MAX_BURST_S * SAMPLE_RATE
        if self._quiet * FRAME < STOP_QUIET_S * SAMPLE_RATE and not long:
            return None
        audio, voiced = np.concatenate(self._burst), self._voiced
        self._burst, self._pre, self._quiet, self._voiced = [], [], 0, 0
        if voiced * FRAME < MIN_BURST_S * SAMPLE_RATE:
            return None
        self.bursts += 1
        if self.hold():
            return None
        self.judged += 1
        return find_name(self.transcribe(audio))


def whisper_transcriber(model) -> Callable[[np.ndarray], str]:
    """Fast Whisper for a short burst: greedy, no timestamps, the name in the prompt.
    The full transcription (stt.transcribe: beam 5, temperature fallbacks) is for the
    request itself; here only "is the name in it" matters."""
    def run(audio: np.ndarray) -> str:
        segments, _ = model.transcribe(audio, beam_size=1, best_of=1, temperature=0.0,
                                       initial_prompt=WAKE_PROMPT, condition_on_previous_text=False,
                                       vad_filter=False, without_timestamps=True)
        return " ".join(s.text.strip() for s in segments).strip()
    return run
