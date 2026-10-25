"""Where the wait goes in a spoken turn, stage by stage (2026-10-25).

The 10-25 voice note measured a median of 4.12 s from the question to his voice, but the
end-pointer and the model's first token explain only about 2 s of it. This clock times
every stage of one live turn so the rest can be found instead of guessed:

    speech_end        his last word (recording closed minus the silence waited)
    recording_closed  the end-pointer decided he had finished
    stt_done          Whisper's text is ready and the turn starts (respond())
    first_token       the model's first text
    first_sentence    the first piece of text handed to the voice
    tts_first_byte    the first audio of that piece exists (Edge: the first bytes off
                      the network; Kokoro: the whole clip, which is not streamed)
    tts_ready         that piece is fully synthesised
    playback_start    the speaker actually starts

Only the first mark of each stage counts in a turn, because the first sentence is what
he waits for. Marks come from three threads (the turn, the voice worker, the player), so
they are taken under a lock. A turn closes when playback starts, and its report goes into
a short history for the median and p90. There are no audio imports here, so the tests
can drive it.
"""
from __future__ import annotations

import statistics
import threading
import time
from collections import deque
from typing import Optional

STAGES = ("speech_end", "recording_closed", "stt_done", "first_token", "first_sentence",
          "tts_first_byte", "tts_ready", "playback_start")

# Reported durations: name -> (from stage, to stage). The first six are the links of one
# chain: endpoint + stt_wait + llm_first_token + first_sentence_wait + tts_first_byte +
# play_start = speech_to_audio, when every mark exists.
SPANS = {
    "endpoint": ("speech_end", "recording_closed"),          # the silence the end-pointer waited
    "stt_wait": ("recording_closed", "stt_done"),            # Whisper (~0 when the judge's text is reused)
    "llm_first_token": ("stt_done", "first_token"),
    "first_sentence_wait": ("first_token", "first_sentence"),
    "tts_first_byte": ("first_sentence", "tts_first_byte"),
    "play_start": ("tts_first_byte", "playback_start"),      # queue + decoder + opening the speaker
    "tts_full": ("first_sentence", "tts_ready"),
    "turn_to_audio": ("stt_done", "playback_start"),         # the old "first_audio" number
    "speech_to_audio": ("speech_end", "playback_start"),     # what he actually waits
}
CHAIN = ("endpoint", "stt_wait", "llm_first_token", "first_sentence_wait", "tts_first_byte", "play_start")
HISTORY = 50                     # turns kept for the median and p90


def _pct(vals: list, q: float) -> float:
    s = sorted(vals)
    return s[int(q * (len(s) - 1))]


class TurnClock:
    def __init__(self, clock=time.time, history: int = HISTORY):
        self._clock = clock
        self._lock = threading.Lock()
        self._marks: dict[str, float] = {}
        self._info: dict = {}
        self._active = False
        self._turn = 0
        self.history: deque = deque(maxlen=history)

    # ------------------------------------------------------------------ marking
    def start(self, recorded_at: Optional[float] = None, endpoint_s: Optional[float] = None,
              t: Optional[float] = None) -> int:
        """A new turn begins (its text is ready). `recorded_at` is when the recording
        closed (None for a typed turn); `endpoint_s` the silence waited before that, so
        his last word was at recorded_at - endpoint_s. Returns the turn number."""
        with self._lock:
            now = self._clock() if t is None else t
            self._turn += 1
            self._marks = {"stt_done": now}
            if recorded_at is not None:
                closed = min(recorded_at, now)
                self._marks["recording_closed"] = closed
                self._marks["speech_end"] = closed - max(0.0, float(endpoint_s or 0.0))
            self._info = {}
            self._active = True
            return self._turn

    def mark(self, stage: str, t: Optional[float] = None, **info) -> bool:
        """Record `stage` now (or at `t`) if it is the first of its kind this turn.
        Extra keywords (engine="edge") are kept for the report. True when recorded."""
        if stage not in STAGES:
            raise ValueError(f"unknown stage {stage!r}")
        with self._lock:
            if not self._active or stage in self._marks:
                return False
            self._marks[stage] = self._clock() if t is None else t
            for k, v in info.items():
                self._info.setdefault(k, v)
            return True

    @property
    def active(self) -> bool:
        return self._active

    @property
    def turn(self) -> int:
        return self._turn

    def has(self, stage: str) -> bool:
        with self._lock:
            return stage in self._marks

    # ------------------------------------------------------------------ reporting
    def _report(self) -> dict:
        m = self._marks
        out: dict = {}
        for name, (a, b) in SPANS.items():
            if a in m and b in m:
                out[name] = round(max(0.0, m[b] - m[a]), 3)
        out.update(self._info)
        return out

    def snapshot(self) -> dict:
        """The current turn's durations so far (nothing is closed)."""
        with self._lock:
            return self._report()

    def finish(self) -> Optional[dict]:
        """Close the turn (playback started, or it ended without a sound) and keep its
        report. None when no turn was open."""
        with self._lock:
            if not self._active:
                return None
            self._active = False
            rep = self._report()
            if "turn_to_audio" in rep:
                self.history.append(rep)
            return rep

    def summary(self, key: str = "speech_to_audio") -> Optional[dict]:
        """{"median", "p90", "n"} of `key` over the kept turns, or None."""
        with self._lock:
            vals = [r[key] for r in self.history if isinstance(r.get(key), (int, float))]
        if not vals:
            return None
        return {"median": round(statistics.median(vals), 2), "p90": round(_pct(vals, 0.9), 2), "n": len(vals)}


def line(rep: dict, summary: Optional[dict] = None) -> str:
    """One log line: '[latency] speech->audio 2.41 s = endpoint 1.31 + stt 0.02 + ...'."""
    def f(k):
        v = rep.get(k)
        return f"{v:.2f}" if isinstance(v, (int, float)) else "?"
    head = (f"speech->audio {f('speech_to_audio')} s" if "speech_to_audio" in rep
            else f"turn->audio {f('turn_to_audio')} s")
    parts = []
    if "endpoint" in rep:
        parts += [f"endpoint {f('endpoint')}", f"stt {f('stt_wait')}"]
    parts += [f"llm {f('llm_first_token')}", f"sentence {f('first_sentence_wait')}",
              f"tts {f('tts_first_byte')}" + (f" ({rep['engine']})" if rep.get("engine") else ""),
              f"play {f('play_start')}"]
    tail = f" | median {summary['median']} p90 {summary['p90']} (n={summary['n']})" if summary else ""
    return f"[latency] {head} = " + " + ".join(parts) + tail
