"""When has Aman finished speaking? A streaming end-pointer on Silero VAD.

WHY (2026-10-12, ROADMAP A1). Until now the voice loop ended an utterance with an
energy rule: `np.linalg.norm(block) * 10 > 0.04` meant "speech", and 62.5 quiet
callbacks meant "done" (the comments called it 4 s). What was wrong with it:
  - It counted neither RMS nor seconds. A norm grows with the block size, and the
    stream never asked for one (sounddevice's default lets the host API pick; here
    that is MME on the Intel Smart Sound array), so both the threshold and the "4 s"
    hung on a number nobody chose. At 1024-sample blocks the gate sits at -75 dBFS:
    a fan or room hiss is "speech", and the rule only ever ended on the near-digital
    silence a noise-suppressing mic DSP leaves between phrases.
  - Every reply waited the whole tail: 4 s of silence before Whisper even started.
  - On 2026-10-10 it still cut me off mid-sentence ("I was still speaking").

What this module does instead:
  - Silero VAD v6, which ships inside faster-whisper (no download), scores every
    32 ms frame as it arrives. Its LSTM state is carried between calls, so the
    streamed scores equal faster-whisper's own batch scores exactly (tested).
  - Hysteresis, as Silero's own segmenter does it: speech starts at p >= 0.5 and
    holds while p >= 0.35; an utterance only opens after 192 ms of speech, so clicks,
    fans and the hum of the room do not open one.
  - Time is counted in samples, never in callbacks.
  - A 0.5 s pre-roll: the utterance starts half a second before the first speech
    frame, so the first syllable reaches Whisper.
  - The silence tail depends on what was said. A fixed tail cannot do both things
    asked of it: I pause 2-3 s mid-thought (DECISIONS 2026-10-08), and a request
    should be answered ~1 s after it ends. So at a pause of 0.3 s a judge (the Whisper
    model that is already loaded) transcribes the audio so far, and the words choose
    the tail: a request or question 0.8 s, a finished statement 1.3 s, words that
    cannot end a sentence ("and", "because", "ki", "aur", a trailing comma) 3.5 s.
    While the judge is still working, the end-pointer waits rather than guess. With
    no judge (tests, the bench) the tail is a fixed 1.2 s.
  - The judge's transcript is handed on, so a turn that ends on it is not transcribed
    twice: the speculative pass IS the transcription.
  - A 45 s cap (a 30 s paragraph must fit, TESTING.md A4) and an optional start
    timeout (the follow-up window), which does not run while JARVIS is talking.

Measured 2026-10-12 on Kokoro speech over pink noise and fan hum (offline, no mic):
Whisper takes ~0.8-1.0 s a pause on the RTX 4050, so in practice the judge's answer,
not the tail, sets the cut: 1.06-1.36 s after the last word, transcript in hand. The
old rule took 4.1 s at 1024-sample blocks plus a second of Whisper, never ended at
all over a -45 dBFS noise floor, and at 256-sample blocks cut every 1.5-2.5 s
mid-sentence pause. The judge only knows what Whisper wrote: Kokoro's "मुझे बताओ कि"
came back as "mujhe batao kiye" and that pause was cut (DECISIONS 2026-10-12).

The old rule is kept, untouched, in jarvis.py behind JARVIS_ENDPOINTER=energy, and
modelled here (EnergyEndPointer) so the two can be compared on the same clips:
    python core/endpoint.py some_recording.wav [--whisper]
JARVIS_ENDPOINT_JUDGE=0 keeps Silero but drops the judge (fixed 1.2 s tail).
"""
from __future__ import annotations

import os
import re
import threading
from collections import deque
from dataclasses import dataclass, field
from typing import Callable, Optional

import numpy as np

SAMPLE_RATE = 16000
FRAME = 512                       # Silero v6's window at 16 kHz
FRAME_S = FRAME / SAMPLE_RATE     # 0.032 s
CONTEXT = 64                      # samples of the previous window Silero v6 sees


# ------------------------------------------------------------------ the VAD
class SileroStream:
    """Silero VAD v6 (faster-whisper's ONNX export), fed frame by frame.

    faster_whisper.vad.SileroVADModel scores a whole clip in one call and starts from
    a fresh LSTM state each time, which is right for files and wrong for a live mic.
    This keeps the LSTM state (h, c) and the 64-sample context between calls; the
    model's batch axis is time, so any split of the stream gives the same scores.
    """

    def __init__(self, model_path: Optional[str] = None):
        import onnxruntime
        if model_path is None:
            from faster_whisper.utils import get_assets_path
            model_path = os.path.join(get_assets_path(), "silero_vad_v6.onnx")
        opts = onnxruntime.SessionOptions()
        opts.inter_op_num_threads = 1      # 0.17 ms a frame on one thread; leave the
        opts.intra_op_num_threads = 1      # rest of the CPU to Kokoro and the app
        opts.enable_cpu_mem_arena = False
        opts.log_severity_level = 4
        self.session = onnxruntime.InferenceSession(model_path, providers=["CPUExecutionProvider"],
                                                    sess_options=opts)
        self.reset()

    def reset(self) -> None:
        self._h = np.zeros((1, 1, 128), dtype=np.float32)
        self._c = np.zeros((1, 1, 128), dtype=np.float32)
        self._ctx = np.zeros(CONTEXT, dtype=np.float32)

    def __call__(self, frames: np.ndarray) -> np.ndarray:
        """Speech probability for each whole 512-sample frame in `frames`."""
        x = np.asarray(frames, dtype=np.float32).reshape(-1, FRAME)
        if len(x) == 0:
            return np.zeros(0, dtype=np.float32)
        ctx = np.concatenate([self._ctx[None, :], x[:-1, -CONTEXT:]], axis=0)
        out, self._h, self._c = self.session.run(
            None, {"input": np.concatenate([ctx, x], axis=1), "h": self._h, "c": self._c})
        self._ctx = x[-1, -CONTEXT:].copy()
        return np.asarray(out, dtype=np.float32).reshape(-1)


# ------------------------------------------------------------------ how the words end
REQUEST, STATEMENT, INCOMPLETE, UNKNOWN = "request", "statement", "incomplete", "unknown"

# Words a sentence (almost) never ends on: conjunctions, articles, prepositions,
# possessives, fillers; English, romanised Hindi (hinglish.romanize output) and
# Devanagari, because the judge may hand over either script. Left out on purpose,
# because requests and short answers end on them: on, in, off, up ("turn the light
# on"), that ("I didn't know that"), so, then, more, also, maybe, not, really, while,
# though, her, who, like.
_CONTINUERS = set("""
and or but because cause cuz coz since which whose whom the a an to of for with about if when
than um umm uh uhh uhm er erm hmm my your his our their its is are was were am be been at from
into onto as just very some any these those whether although unless until till
aur ya ki ke ka ko se toh lekin par magar kyunki kyonki kyuki kyoki matlab jo jab agar phir
fir taki mera meri mere tera teri tere tumhara tumhari uska uski unka unki hamara apna apni
ek yaani yani balki
और या कि के का को से तो लेकिन पर मगर क्योंकि मतलब जो जब अगर फिर ताकि मेरा मेरी मेरे तेरा
तेरी तुम्हारा उसका उसकी एक यानी बल्कि
""".split())

# "that" alone ends plenty of sentences ("I didn't know that"), but after these it
# opens a clause: Whisper wrote "So what I wanted to say is that." for a fragment.
_THAT_OPENERS = set("""is was think thought said say says saying mean means meant feel felt believe hope
realised realized so such except given guess sure""".split())

# A turn that opens like a question or an order. Hindi is verb-final, so its orders
# and questions are also recognised by how they end (_REQUEST_END).
_REQUEST_START = set("""
what whats what's when where who whos who's why how which can could would will shall should
do does did is are am please tell turn switch set play pause stop remind open close show call
start give read explain find search add put make let check help
kya kaun kaunsa kaunsi kab kahan kaise kitna kitne kitni kyun kyon kyu batao bata bolo sunao
chalao kholo
क्या कौन कब कहाँ कहां कैसे कितना कितने कितनी क्यों बताओ बोलो सुनाओ चलाओ
""".split())
_REQUEST_END = re.compile(
    r"(\b(karo|kar do|kardo|kar dena|karna|batao|bata do|bata|bolo|bol do|sunao|suna do|chalao|"
    r"chala do|lagao|laga do|bajao|baja do|dikhao|dikha do|rakho|rakh do|kholo|khol do|likho|"
    r"padho|samjhao|samjha do|do|de do|dena|bhejo|bhej do|please|kya|na|batana)|"
    r"(करो|कर दो|बताओ|बता दो|बोलो|सुनाओ|चलाओ|लगाओ|बजाओ|दिखाओ|रखो|खोलो|दो|दे दो|भेजो|क्या|ना))$")
_SKIP_OPENERS = {"hey", "jarvis", "ok", "okay", "so", "bhai", "yaar", "acha", "accha", "achha",
                 "um", "uh", "well", "and", "अच्छा", "भाई", "यार"}
_TRAILING_OFF = re.compile(r"(,|\.\.\.|…|-|–|—|:|;)\s*$")
# Devanagari vowel signs are not \w in Python, so the block is listed explicitly
# (minus the dandas, which are punctuation).
_WORD = re.compile(r"[\w\u0900-\u0963\u0966-\u097F]+(?:'\w+)?", re.UNICODE)


def text_finality(text: str) -> str:
    """How a (partial) transcript ends: REQUEST, STATEMENT, INCOMPLETE or UNKNOWN.

    Deliberately simple and lexical. Pitch and loudness at the pause were measured
    first and rejected: on Kokoro speech the falls at mid-sentence commas and at
    sentence ends overlapped completely (DECISIONS 2026-10-12)."""
    t = (text or "").strip()
    words = [w.lower() for w in _WORD.findall(t)]
    if not words:
        return UNKNOWN
    if t.endswith(("?", "？")):
        return REQUEST
    if _TRAILING_OFF.search(t) or words[-1] in _CONTINUERS:
        return INCOMPLETE
    if words[-1] == "that" and len(words) > 1 and words[-2] in _THAT_OPENERS:
        return INCOMPLETE
    core = t.rstrip(" .!।॥|\"'").lower()       # | is the danda after hinglish.romanize
    if _REQUEST_END.search(core):
        return REQUEST
    first = next((w for w in words if w not in _SKIP_OPENERS), words[0])
    if first in _REQUEST_START:
        return REQUEST
    return STATEMENT


# ------------------------------------------------------------------ settings
@dataclass
class EndpointConfig:
    start_threshold: float = 0.5      # Silero's own default
    stop_threshold: float = 0.35      # Silero's neg_threshold (threshold - 0.15)
    min_speech_s: float = 0.192       # 6 frames of speech before an utterance opens
    onset_gap_s: float = 0.16         # a would-be onset dies after this much non-speech
    resume_frames: int = 2            # frames >= start_threshold that end a pause (one is a click)
    pre_roll_s: float = 0.5
    tail_pad_s: float = 0.4           # audio kept after the last speech frame (Silero's speech_pad)
    hang_default_s: float = 1.2       # no judge, or the judge heard no words
    hang_request_s: float = 0.8
    hang_statement_s: float = 1.3
    hang_incomplete_s: float = 3.5    # also the longest wait for a slow judge
    judge_after_s: float = 0.3        # pause length that triggers a speculative transcript
    max_utterance_s: float = 45.0
    start_timeout_s: Optional[float] = None

    def hangover(self, verdict: Optional[str], judged: bool) -> float:
        if not judged:
            return self.hang_default_s
        return {REQUEST: self.hang_request_s, STATEMENT: self.hang_statement_s,
                INCOMPLETE: self.hang_incomplete_s}.get(verdict, self.hang_default_s)


# ------------------------------------------------------------------ the judge
@dataclass
class Judgement:
    upto: int                 # stream sample the judged audio ended at
    text: str
    verdict: str
    payload: object = None    # whatever fn returned beside the text (raw text, STT meta)
    seconds: float = 0.0      # how long fn took


def _run_judge_fn(fn, audio) -> tuple[str, object]:
    out = fn(audio)
    if isinstance(out, tuple):
        return str(out[0] or ""), (out[1] if len(out) > 1 else None)
    return str(out or ""), None


class ThreadJudge:
    """Runs fn(audio) -> text | (text, payload) on one worker thread.

    One job at a time (Whisper on one GPU); a newer request replaces a queued one,
    so a stale pause is never transcribed after speech has moved on."""

    def __init__(self, fn: Callable[[np.ndarray], object]):
        self.fn = fn
        self._cv = threading.Condition()
        self._gen = 0
        self._queued: Optional[tuple] = None
        self._running: Optional[tuple] = None
        self._done: list[Judgement] = []
        self.errors = 0
        threading.Thread(target=self._worker, name="endpoint-judge", daemon=True).start()

    def reset(self) -> None:
        with self._cv:
            self._gen += 1
            self._queued, self._done = None, []

    def submit(self, audio: np.ndarray, upto: int, now: int) -> None:
        with self._cv:
            self._queued = (self._gen, upto, np.array(audio, dtype=np.float32, copy=True))
            self._cv.notify_all()

    def poll(self, now: int) -> Optional[Judgement]:
        """The newest finished judgement, once (older ones are stale by definition)."""
        with self._cv:
            got = self._done[-1] if self._done else None
            self._done = []
            return got

    def pending(self) -> bool:
        with self._cv:
            return self._queued is not None or self._running is not None

    def wait_for(self, upto_min: int, timeout: float) -> Optional[Judgement]:
        """Block until a result covering at least `upto_min` arrives (or none can)."""
        import time
        end = time.monotonic() + timeout
        with self._cv:
            while True:
                hit = next((j for j in reversed(self._done) if j.upto >= upto_min), None)
                if hit is not None:
                    self._done.remove(hit)
                    return hit
                busy = [j for j in (self._queued, self._running) if j is not None and j[1] >= upto_min
                        and j[0] == self._gen]
                left = end - time.monotonic()
                if not busy or left <= 0:
                    return None
                self._cv.wait(left)

    def _worker(self) -> None:
        import time
        while True:
            with self._cv:
                while self._queued is None:
                    self._cv.wait()
                job, self._queued = self._queued, None
                self._running = job
            gen, upto, audio = job
            t0 = time.monotonic()
            try:
                text, payload = _run_judge_fn(self.fn, audio)
                verdict = text_finality(text)
            except Exception as e:           # a failed judge must never end the turn
                self.errors += 1
                text, payload, verdict = "", {"error": repr(e)}, UNKNOWN
            with self._cv:
                self._running = None
                if gen == self._gen:
                    self._done.append(Judgement(upto, text, verdict, payload, time.monotonic() - t0))
                self._cv.notify_all()


class ClockedJudge:
    """ThreadJudge's offline twin for tests and the bench: fn runs at once, and its
    answer arrives `latency_s` of stream time later (None: as long as fn really
    took), one job at a time."""

    def __init__(self, fn: Callable[[np.ndarray], object], latency_s: Optional[float] = 0.5):
        self.fn = fn
        self.latency = None if latency_s is None else int(round(latency_s * SAMPLE_RATE))
        self.calls: list[int] = []
        self.reset()

    def reset(self) -> None:
        self._busy_until = -1
        self._jobs: deque = deque()

    def submit(self, audio: np.ndarray, upto: int, now: int) -> None:
        import time
        start = max(now, self._busy_until)
        t0 = time.perf_counter()
        text, payload = _run_judge_fn(self.fn, np.asarray(audio, dtype=np.float32))
        took = self.latency if self.latency is not None else int((time.perf_counter() - t0) * SAMPLE_RATE)
        self.calls.append(upto)
        self._busy_until = start + took
        self._jobs.append((self._busy_until, Judgement(upto, text, text_finality(text), payload,
                                                       took / SAMPLE_RATE)))

    def poll(self, now: int) -> Optional[Judgement]:
        ready = None
        while self._jobs and self._jobs[0][0] <= now:
            ready = self._jobs.popleft()[1]
        return ready

    def pending(self) -> bool:
        return bool(self._jobs)


# ------------------------------------------------------------------ the end-pointer
@dataclass
class Utterance:
    audio: np.ndarray                      # 16 kHz float32, pre-roll included; empty if nothing said
    reason: str                            # silence | cap | timeout | closed
    speech_start_s: Optional[float] = None # stream time of the first speech frame
    speech_end_s: Optional[float] = None   # stream time the last speech frame ended
    cut_s: float = 0.0                     # stream time the utterance was closed
    verdict: Optional[str] = None          # how the words ended, if a judge saw them
    judgement: Optional[Judgement] = None  # a transcript covering all of the speech, if one exists
    judge_upto: Optional[int] = None       # a submitted (maybe unfinished) judgement covering it all
    events: list = field(default_factory=list)

    @property
    def has_speech(self) -> bool:
        return self.speech_start_s is not None and self.audio.size > 0

    @property
    def endpoint_s(self) -> Optional[float]:
        """Silence waited after the last speech frame before the utterance was closed."""
        return None if self.speech_end_s is None else round(self.cut_s - self.speech_end_s, 3)


class EndPointer:
    """Feed it audio as it arrives; it says when the utterance is over.

        ep = EndPointer(judge=ThreadJudge(transcribe_fn))
        for block in mic:            # any block size; it frames internally
            ep.feed(block)
            if ep.done: break
        utt = ep.result()
    """

    def __init__(self, config: Optional[EndpointConfig] = None, vad=None, judge=None,
                 hold: Optional[Callable[[], bool]] = None):
        self.cfg = config or EndpointConfig()
        self.vad = vad if vad is not None else SileroStream()
        self.judge = judge
        self.hold = hold          # () -> True while JARVIS is talking: the start timeout waits
        self.reset()

    # -------------------------------------------------------------- state
    def reset(self) -> None:
        if hasattr(self.vad, "reset"):
            self.vad.reset()
        if self.judge is not None:
            self.judge.reset()
        c = self.cfg
        self._f = lambda s: max(1, int(round(s / FRAME_S)))
        self._pre_frames = int(round(c.pre_roll_s * SAMPLE_RATE / FRAME))
        self._rest = np.zeros(0, dtype=np.float32)
        self.clock = 0                     # samples processed
        self.state = "waiting"             # waiting | onset | speech | done
        self.reason: Optional[str] = None
        self.events: list[tuple] = []
        self.last_prob = 0.0
        self._ring: deque = deque(maxlen=self._pre_frames + 64)   # (index, frame) before the start
        self._frames: list[np.ndarray] = []
        self._start_index = 0              # first sample of the utterance's audio (pre-roll included)
        self._cand = 0                     # frame index of the would-be onset
        self._voiced = 0
        self._quiet = 0
        self._idle = 0                     # samples of start-timeout clock used
        self.speech_start: Optional[int] = None
        self.last_speech_end = 0           # sample after the last speech frame
        self._in_pause = False
        self._resume_run = 0
        self._submitted: Optional[int] = None
        self.judgement: Optional[Judgement] = None

    @property
    def done(self) -> bool:
        return self.state == "done"

    @property
    def started(self) -> bool:
        return self.speech_start is not None

    @property
    def audio_start(self) -> int:
        """Stream sample where the utterance's audio (pre-roll included) begins."""
        return self._start_index

    # -------------------------------------------------------------- input
    def feed(self, samples: np.ndarray) -> list[tuple]:
        """Push any number of samples; returns the events they caused."""
        if self.done:
            return []
        x = np.asarray(samples, dtype=np.float32).reshape(-1)
        if self._rest.size:
            x = np.concatenate([self._rest, x])
        n = (x.size // FRAME) * FRAME
        self._rest = x[n:].copy()
        if n == 0:
            return []
        frames = x[:n].reshape(-1, FRAME)
        probs = self.vad(x[:n])
        before = len(self.events)
        for frame, p in zip(frames, probs):
            self._step(frame, float(p))
            if self.done:
                break
        return self.events[before:]

    def close(self) -> None:
        """The stream ended (mic closed): finish whatever was in progress."""
        if not self.done:
            self._finish("closed")

    # -------------------------------------------------------------- one frame
    def _emit(self, kind: str, **info) -> None:
        self.events.append((kind, round(self.clock / SAMPLE_RATE, 3), info))

    def _step(self, frame: np.ndarray, p: float) -> None:
        c = self.cfg
        i = self.clock // FRAME
        self.last_prob = p
        if self.state in ("waiting", "onset"):
            self._ring.append((i, frame))
        else:
            self._frames.append(frame)
        self.clock += FRAME

        if self.state == "waiting":
            if p >= c.start_threshold:
                self.state, self._cand, self._voiced, self._quiet = "onset", i, 1, 0
            elif c.start_timeout_s is not None and not (self.hold and self.hold()):
                self._idle += FRAME
                if self._idle >= c.start_timeout_s * SAMPLE_RATE:
                    self._finish("timeout")
            if self.state != "onset":
                return
        elif self.state == "onset":
            if p >= c.start_threshold:
                self._voiced += 1
                self._quiet = 0
            elif p < c.stop_threshold:
                self._quiet += 1
                if self._quiet >= self._f(c.onset_gap_s):
                    self.state = "waiting"          # a click or a breath, not speech
                    return
        if self.state == "onset":
            if self._voiced >= self._f(c.min_speech_s):
                self._open()
            return

        # ---- inside an utterance
        if self._in_pause:
            if p >= c.start_threshold:
                self._resume_run += 1
                if self._resume_run >= c.resume_frames:
                    self._in_pause, self._submitted = False, None
                    self.last_speech_end = self.clock
                    self._emit("resume")
            else:
                self._resume_run = 0
        elif p >= c.stop_threshold:
            self.last_speech_end = self.clock
        else:
            self._in_pause, self._resume_run = True, 0
            self._emit("pause", speech_end=round(self.last_speech_end / SAMPLE_RATE, 3))

        if self.clock - self._start_index >= c.max_utterance_s * SAMPLE_RATE:
            self._finish("cap")
            return
        if not self._in_pause:
            return
        silence = self.clock - self.last_speech_end
        if self.judge is not None:
            if self._submitted is None and silence >= c.judge_after_s * SAMPLE_RATE:
                self._submitted = self.clock
                self.judge.submit(self._audio(), self.clock, self.clock)
                self._emit("judge_submitted")
            got = self.judge.poll(self.clock)
            if got is not None and got.upto >= self.last_speech_end:
                self.judgement = got
                self._emit("judged", verdict=got.verdict, text=got.text)
        fresh = self.judgement is not None and self.judgement.upto >= self.last_speech_end
        if self.judge is None:
            hang = c.hang_default_s
        elif fresh:
            hang = c.hangover(self.judgement.verdict, judged=True)
        else:
            hang = c.hang_incomplete_s      # the judge is still listening: wait, do not guess
        if silence >= hang * SAMPLE_RATE:
            self._finish("silence")

    def _open(self) -> None:
        first = max(0, self._cand - self._pre_frames)
        kept = [(j, f) for (j, f) in self._ring if j >= first]   # never empty: holds this frame
        self._frames = [f for _, f in kept]
        self._start_index = kept[0][0] * FRAME
        self._ring.clear()
        self.speech_start = self._cand * FRAME
        self.last_speech_end = self.clock
        self.state = "speech"
        self._emit("start", speech_start=round(self.speech_start / SAMPLE_RATE, 3))

    def _audio(self) -> np.ndarray:
        return np.concatenate(self._frames) if self._frames else np.zeros(0, dtype=np.float32)

    def _finish(self, reason: str) -> None:
        self.state, self.reason = "done", reason
        self._emit("end", reason=reason)

    # -------------------------------------------------------------- output
    def result(self) -> Utterance:
        if not self.done:
            self.close()
        if self.speech_start is None:
            return Utterance(np.zeros(0, dtype=np.float32), self.reason or "closed", cut_s=self.clock / SAMPLE_RATE,
                             events=list(self.events))
        audio = self._audio()
        keep = self.last_speech_end + int(self.cfg.tail_pad_s * SAMPLE_RATE) - self._start_index
        audio = audio[:max(0, keep)]
        j = self.judgement if (self.judgement is not None and self.judgement.upto >= self.last_speech_end) else None
        upto = self._submitted if (self._submitted is not None and self._in_pause) else None
        return Utterance(audio=audio, reason=self.reason or "closed",
                         speech_start_s=self.speech_start / SAMPLE_RATE,
                         speech_end_s=self.last_speech_end / SAMPLE_RATE,
                         cut_s=self.clock / SAMPLE_RATE,
                         verdict=j.verdict if j else None, judgement=j, judge_upto=upto,
                         events=list(self.events))


# ------------------------------------------------------------------ the old rule, modelled
class EnergyEndPointer:
    """The rule jarvis.py used until 2026-10-12, modelled faithfully for comparison.

    Per callback block: level = norm(block) * 10; above 0.04 it is speech and resets
    the count; once speech has been heard, each block at or below 0.04 adds one to the
    count; the polling loop (every 100 ms) stops when the count passes 16000/1024*4.0
    = 62.5 BLOCKS. The live code is kept verbatim in jarvis.py; this is only a model.
    """

    def __init__(self, block: int = 1024, threshold: float = 0.04, silence_s: float = 4.0, poll_s: float = 0.1):
        self.block, self.threshold = block, threshold
        self.limit = (SAMPLE_RATE / 1024) * silence_s
        self.poll = int(poll_s * SAMPLE_RATE)
        self.clock = 0
        self.speaking = False
        self.silence_blocks = 0
        self.speech_end: Optional[int] = None
        self.cut: Optional[int] = None
        self._next_poll = self.poll

    @property
    def done(self) -> bool:
        return self.cut is not None

    def feed(self, samples: np.ndarray) -> None:
        x = np.asarray(samples, dtype=np.float32).reshape(-1)
        for k in range(0, x.size - self.block + 1, self.block):
            end = self.clock + self.block
            # The 100 ms polls that happen before this block is delivered see the old count.
            while self._next_poll < end:
                if self.speaking and self.silence_blocks > self.limit:
                    self.cut = self._next_poll
                    return
                self._next_poll += self.poll
            level = float(np.linalg.norm(x[k:k + self.block]) * 10)
            self.clock = end
            if level > self.threshold:
                self.speaking, self.silence_blocks = True, 0
                self.speech_end = self.clock
            elif self.speaking:
                self.silence_blocks += 1


# ------------------------------------------------------------------ driving it live
def listen(ep: EndPointer, next_block: Callable[[float], Optional[np.ndarray]],
           on_event: Optional[Callable[[str, float, dict], None]] = None,
           on_block: Optional[Callable[[np.ndarray], None]] = None,
           poll_s: float = 0.25, starve_s: float = 3.0) -> Utterance:
    """Run `ep` on a live source until the utterance is over.

    next_block(timeout) returns the next block of samples, or None if none came in
    time. A source that delivers nothing for `starve_s` (a microphone unplugged or
    grabbed by another app) closes the utterance instead of hanging the voice loop —
    the old recorder waited forever in that case."""
    starved = 0.0
    while not ep.done:
        block = next_block(poll_s)
        if block is None:
            starved += poll_s
            if starved >= starve_s:
                ep.close()
            continue
        starved = 0.0
        for kind, t, info in ep.feed(block):
            if on_event is not None:
                on_event(kind, t, info)
        if on_block is not None:
            on_block(block)
    return ep.result()


# ------------------------------------------------------------------ helpers
def run_clip(audio: np.ndarray, ep: EndPointer, chunk: int = FRAME, until_done: bool = True) -> Utterance:
    """Feed a whole clip in `chunk`-sized pieces, as a mic would deliver it."""
    x = np.asarray(audio, dtype=np.float32).reshape(-1)
    for k in range(0, x.size, chunk):
        ep.feed(x[k:k + chunk])
        if ep.done and until_done:
            break
    return ep.result()


def segment_all(audio: np.ndarray, config: Optional[EndpointConfig] = None, vad=None,
                judge_fn=None, judge_latency_s: Optional[float] = 0.5) -> list[Utterance]:
    """Every utterance in a clip, one after another (for tests and the bench).
    judge_latency_s=None replays the judge's real compute time as stream time."""
    x = np.asarray(audio, dtype=np.float32).reshape(-1)
    vad = vad if vad is not None else SileroStream()
    out, pos = [], 0
    while pos + FRAME <= x.size:
        judge = ClockedJudge(judge_fn, judge_latency_s) if judge_fn else None
        ep = EndPointer(config, vad=vad, judge=judge)
        ep.clock = pos                     # keep stream time absolute across utterances
        for k in range(pos, x.size, FRAME):
            ep.feed(x[k:k + FRAME])
            if ep.done:
                break
        utt = ep.result()
        if not utt.has_speech:
            break
        out.append(utt)
        pos = ep.clock
    return out


def mode_from(argv: list[str], env: dict) -> str:
    """'silero' (default) or 'energy' (the pre-2026-10-12 rule, for comparison)."""
    for a in argv:
        if a.startswith("--endpointer="):
            return "energy" if a.split("=", 1)[1].strip().lower() == "energy" else "silero"
    return "energy" if str(env.get("JARVIS_ENDPOINTER", "")).strip().lower() == "energy" else "silero"


def load_wav_16k(path: str) -> np.ndarray:
    import soundfile as sf
    from math import gcd
    from scipy.signal import resample_poly
    x, sr = sf.read(path, dtype="float32", always_2d=True)
    x = x.mean(axis=1)
    if sr != SAMPLE_RATE:
        g = gcd(SAMPLE_RATE, int(sr))
        x = resample_poly(x, SAMPLE_RATE // g, int(sr) // g).astype(np.float32)
    return x


def _bench(argv: list[str]) -> None:
    """python core/endpoint.py clip.wav [--whisper] — old rule vs new on a recording."""
    import argparse
    import time
    ap = argparse.ArgumentParser(description=_bench.__doc__)
    ap.add_argument("wav")
    ap.add_argument("--whisper", action="store_true",
                    help="judge pauses with the local large-v3-turbo (cache only, never downloads)")
    a = ap.parse_args(argv)
    x = load_wav_16k(a.wav)
    judge_fn = None
    if a.whisper:
        from faster_whisper import WhisperModel
        import hinglish
        import stt
        model = WhisperModel("large-v3-turbo", device="cuda", compute_type="int8_float16", local_files_only=True)
        times = []

        def judge_fn(audio):
            t0 = time.perf_counter()
            raw, meta = stt.transcribe(model, audio)
            times.append(time.perf_counter() - t0)
            return hinglish.romanize(raw), (raw, meta)
        list(model.transcribe(x[:SAMPLE_RATE], beam_size=5, vad_filter=False)[0])   # warm-up, as jarvis.py
    # The judge's real compute time is replayed as stream time, as the live thread would see it.
    utts = segment_all(x, judge_fn=judge_fn, judge_latency_s=None)
    print(f"{a.wav}: {x.size / SAMPLE_RATE:.2f} s")
    for u in utts:
        said = f" '{u.judgement.text}'" if u.judgement else ""
        print(f"  new: speech {u.speech_start_s:.2f}-{u.speech_end_s:.2f} s, cut {u.cut_s:.2f} s "
              f"(+{u.endpoint_s:.2f} s, {u.reason}, {u.verdict or 'no judge'}){said}")
    if a.whisper and times:
        print(f"  Whisper per pause: median {np.median(times):.2f} s, max {max(times):.2f} s ({len(times)} pauses)")
    for blk in (256, 512, 1024):
        old = EnergyEndPointer(block=blk)
        old.feed(x)
        cut = f"cut {old.cut / SAMPLE_RATE:.2f} s" if old.done else "never ended (clip over)"
        print(f"  old rule, {blk}-sample blocks: {cut}")


if __name__ == "__main__":
    import sys
    _bench(sys.argv[1:])
