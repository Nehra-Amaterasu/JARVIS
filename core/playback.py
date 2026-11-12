"""Play Edge TTS audio while it is still arriving (2026-10-25).

Until now voice._edge_synth wrote every mp3 chunk of a sentence to a file and only then
handed the file to the player, so the first sentence waited for its whole synthesis
(the network round-trip plus the full clip) before a sound came out. Here a sentence's
audio is an AudioPipe: the voice worker feeds it the bytes as they come off the network,
and the player decodes the mp3 (PyAV, already installed for faster-whisper) and writes
the samples to the speaker (sounddevice) as soon as the first frame decodes.

Never fatal, and the old path stays:
  - If decoding or the output device fails before anything was heard, play_pipe returns
    FAILED and the caller waits for the whole clip and plays it the old way (pygame).
  - stop (an Event) or cancel() ends playback within one frame (~24 ms) and drops what
    the speaker had buffered (barge-in).
  - JARVIS_EDGE_STREAM=0 turns streaming off; Kokoro is never streamed (one clip per
    sentence on the CPU) and keeps its file path.
  - JARVIS_OUT_LEVEL=1 (default off) reports how loud JARVIS is speaking: an `out_level`
    event at ~20 Hz with the RMS and a 24-band spectrum of the samples just written to
    the speaker (spec 9.2 of docs/design/jarvis-product-overhaul.md). See OutLevelEmitter.
"""
from __future__ import annotations

import math
import os
import threading
import time
from typing import Callable, Optional

import numpy as np

PLAYED, STOPPED, FAILED = "played", "stopped", "failed"
PROBE_BYTES = 2048           # enough for the mp3 demuxer to find the first frame header
READ_TIMEOUT_S = 15.0

# --- output level (spec 9.2) -------------------------------------------------------
N_BANDS, F_LO, F_HI = 24, 100.0, 8000.0   # log-spaced, ~6.3 octaves: where speech lives
FRAME_S = 0.05                            # 20 Hz
WINDOW_S = 0.085                          # 2048 samples at 24 kHz; N is derived from the rate
FLOOR_DB = -90.0                          # what silence reads, instead of -inf
BAND_DB_LO, BAND_DB_SPAN = -60.0, 60.0    # output mapping window: -60 dB -> 0, 0 dB -> 255


def out_level_enabled() -> bool:
    """Read on every call, not at import: the flag is the owner's switch and a test flips it."""
    return os.environ.get("JARVIS_OUT_LEVEL", "").strip().lower() in ("1", "true", "yes", "on")


def band_edges(n_bands: int = N_BANDS, f_lo: float = F_LO, f_hi: float = F_HI) -> np.ndarray:
    """n_bands + 1 edges, f_i = f_lo * r**i with r = (f_hi / f_lo) ** (1 / n_bands)."""
    return f_lo * (f_hi / f_lo) ** (np.arange(n_bands + 1) / n_bands)


_PLANS: dict = {}


def _plan(n: int, sr: int):
    """Per (window length, rate): the Hann window, its energy, and a (bands x bins) 0/1 matrix.
    Built once and then reused, so a frame is one rfft plus one small matmul. A band takes
    the bins whose centre lies in it; one with no bin takes the nearest bin so none is
    structurally empty (the lowest band is 1.7 bins wide at 24 kHz). A band whose lower
    edge is at or above Nyquist stays all zero."""
    key = (n, sr)
    plan = _PLANS.get(key)
    if plan is None:
        w = np.hanning(n + 1)[:-1].astype(np.float32)            # periodic Hann
        freqs = np.arange(n // 2 + 1) * (sr / n)
        edges = band_edges()
        m = np.zeros((N_BANDS, len(freqs)), dtype=np.float32)
        nyq = sr / 2.0
        for i in range(N_BANDS):
            if edges[i] >= nyq:
                continue
            sel = np.nonzero((freqs >= edges[i]) & (freqs < edges[i + 1]))[0]
            if len(sel) == 0:
                sel = [int(np.argmin(np.abs(freqs - math.sqrt(edges[i] * edges[i + 1]))))]
            m[i, sel] = 1.0
        plan = (w, float(np.sum(w.astype(np.float64) ** 2)), m)
        if len(_PLANS) < 8:                                       # a stray rate cannot grow this
            _PLANS[key] = plan
    return plan


def analyse(window: np.ndarray, sr: int):
    """(rms_db, peak_db, bands) of one window of mono float samples. dB are relative to a
    full-scale sine (a sine of peak 0.1 reads -20.0); bands are 24 ints, 0 to 255, linear in
    dB over -60..0. Absolute, with no automatic gain, so a whisper stays small."""
    n = len(window)
    w, w2, m = _plan(n, int(sr))
    x = np.asarray(window, dtype=np.float32)
    ms = float(np.dot(x, x)) / n
    peak = float(np.max(np.abs(x)))
    rms_db = 10.0 * math.log10(2.0 * ms) if ms > 1e-12 else FLOOR_DB
    peak_db = 20.0 * math.log10(peak) if peak > 1e-9 else FLOOR_DB
    spec = np.fft.rfft(x * w)
    power = spec.real * spec.real + spec.imag * spec.imag
    ms_band = (2.0 / (n * w2)) * (m @ power)                      # mean square per band
    db = 10.0 * np.log10(np.maximum(2.0 * ms_band, 1e-30))
    bands = np.rint(255.0 * np.clip((db - BAND_DB_LO) / BAND_DB_SPAN, 0.0, 1.0)).astype(np.int32)
    return rms_db, peak_db, [int(b) for b in bands]


class OutLevelEmitter:
    """Reports the output level without ever being able to slow the speaker's write loop.

    push(pcm, rate) is called right AFTER speaker.write, so the samples are already in the
    device buffer when the analysis runs. Underrun safety, with the numbers:
      - budget: one 24 ms MP3 frame (576 samples at 24 kHz) must be decoded and written
        before the device buffer (Speaker.latency, 0.09 s and up on this laptop: about four
        frames) drains. Analysis runs on one frame in about two (20 Hz of 41.7 frames/s)
        and costs tens of microseconds (measured, docs/research/voice.md), well under 1 %
        of a frame; the ring copy on the other frames costs a few microseconds.
      - the emit (a locked write to stdout, which can block if the app stops reading) is
        NOT on the write thread: push() hands the finished frame to a daemon thread through
        a one-slot mailbox. A slow consumer overwrites the waiting frame (the `seq` gap
        shows the drop); it never makes push() wait, and an emit that raises is swallowed.
      - memory is fixed: one ring of N float32 (8 KB at 24 kHz), one mailbox slot.
    `emit(kind, **fields)` is appio.emit; `clock` is monotonic seconds (a test injects one)."""

    def __init__(self, emit: Callable[..., None], clock: Callable[[], float] = time.monotonic,
                 latency_s: Callable[[], float] = lambda: 0.0):
        self._emit_fn, self._clock, self._latency = emit, clock, latency_s
        self._ring: Optional[np.ndarray] = None
        self._rate = 0
        self._w = 0                       # next write index into the ring
        self._due: Optional[float] = None
        self.seq = 0                      # frames produced (dropped ones included)
        self.dropped = 0                  # frames overwritten before the consumer took them
        self._slot: Optional[dict] = None
        self._cv = threading.Condition()
        self._thread: Optional[threading.Thread] = None
        self._finished = False

    def warm(self, rate: int) -> None:
        """Build the window, the band matrix and the FFT's first-call state off the write
        thread. Measured: the first analyse() costs 7 ms warm and 28 ms cold, longer than
        a 24 ms frame; later ones 0.1 ms. Called when a sentence starts, before its first
        mp3 frame has even decoded, so the first real frame finds everything ready."""
        def run():
            try:
                n = 1 << max(8, int(round(math.log2(rate * WINDOW_S))))
                analyse(np.zeros(n, dtype=np.float32), rate)
            except Exception:
                pass
        threading.Thread(target=run, name="out-level-warm", daemon=True).start()

    def push(self, pcm: np.ndarray, rate: int) -> None:
        try:
            if self._finished:
                return
            rate = int(rate)
            if self._ring is None or rate != self._rate:
                n = 1 << max(8, int(round(math.log2(rate * WINDOW_S))))
                self._ring, self._rate, self._w = np.zeros(n, dtype=np.float32), rate, 0   # unfilled part reads as silence
            ring, n = self._ring, len(self._ring)
            x = pcm.reshape(-1)[-n:]
            k = len(x)
            first = min(k, n - self._w)
            ring[self._w:self._w + first] = x[:first]
            if first < k:
                ring[:k - first] = x[first:]
            self._w = (self._w + k) % n
            now = self._clock()
            if self._due is None:
                self._due = now
            if now < self._due:
                return
            # A schedule, not "now - last >= 50 ms": with 24 ms writes that rule would give
            # one frame per 72 ms (13.9 Hz), the schedule gives one per ~48 ms (20.8 Hz).
            self._due += FRAME_S
            if self._due <= now:
                self._due = now + FRAME_S
            window = np.concatenate((ring[self._w:], ring[:self._w]))      # oldest first
            rms_db, peak_db, bands = analyse(window, rate)
            lat = float(self._latency() or 0.0)
            self._post({"sr": rate, "rms_db": round(rms_db, 1), "peak_db": round(peak_db, 1), "bands": bands,
                        "lat_ms": round(lat * 1000.0, 1) if lat > 0 else None, "final": False})
        except Exception:
            pass                           # a level reading must never reach the speaker's loop

    def finish(self) -> None:
        """The stream is over (played, stopped or failed): one last frame, `final`, so the UI
        drops to the floor at once. Nothing is sent if no frame was ever sent."""
        if self._finished:
            return
        self._finished = True
        if self.seq:
            self._post({"sr": self._rate, "rms_db": FLOOR_DB, "peak_db": FLOOR_DB, "bands": [0] * N_BANDS,
                        "lat_ms": None, "final": True})

    def _post(self, fields: dict) -> None:
        self.seq += 1
        fields["seq"] = self.seq
        with self._cv:
            if self._slot is not None and not self._slot["final"]:
                self.dropped += 1
            self._slot = fields
            if self._thread is None:
                self._thread = threading.Thread(target=self._run, name="out-level", daemon=True)
                self._thread.start()
            self._cv.notify()

    def _run(self) -> None:
        while True:
            with self._cv:
                if not self._cv.wait_for(lambda: self._slot is not None, timeout=30.0):
                    self._thread = None    # idle: the thread ends, the next frame starts a new one
                    return
                fields, self._slot = self._slot, None
            try:
                self._emit_fn("out_level", **fields)
            except Exception:
                pass
            if fields["final"]:
                with self._cv:
                    if self._slot is None:
                        self._thread = None
                        return


class AudioPipe:
    """One sentence's audio bytes, growing. feed() from the voice worker; read() (blocking,
    file-like, for the decoder) from the player."""

    def __init__(self, text: str = "", gain: float = 1.0, engine: str = "edge-stream"):
        self.text, self.gain, self.engine = text, gain, engine
        self._buf = bytearray()
        self._pos = 0
        self._cv = threading.Condition()
        self.closed = False
        self.cancelled = False
        self.error: Optional[BaseException] = None
        self.first_byte_at: Optional[float] = None
        self.played_s = 0.0                 # seconds of audio written to the speaker so far

    # -------------------------------------------------------------- the writer's side
    def feed(self, data: bytes) -> None:
        if not data:
            return
        with self._cv:
            if self.closed:
                return
            if self.first_byte_at is None:
                self.first_byte_at = time.time()
            self._buf += data
            self._cv.notify_all()

    def close(self, error: Optional[BaseException] = None) -> None:
        """No more bytes are coming (`error`: why the stream ended early)."""
        with self._cv:
            self.closed = True
            self.error = self.error or error
            self._cv.notify_all()

    def cancel(self) -> None:
        """Barge-in: the reader stops at once and the rest is dropped."""
        with self._cv:
            self.cancelled = True
            self.closed = True
            self._cv.notify_all()

    # -------------------------------------------------------------- the reader's side
    def read(self, n: int = -1) -> bytes:
        with self._cv:
            # A writer that never closes (it should: Edge times out after 12 s) must not
            # hang the player: after READ_TIMEOUT_S of nothing the clip counts as ended.
            if not self._cv.wait_for(lambda: self._pos < len(self._buf) or self.closed, timeout=READ_TIMEOUT_S):
                self.closed = True
                self.error = self.error or TimeoutError("no audio for %.0f s" % READ_TIMEOUT_S)
            if self.cancelled:
                return b""
            end = len(self._buf) if n is None or n < 0 else min(len(self._buf), self._pos + n)
            out = bytes(self._buf[self._pos:end])
            self._pos = end
            return out

    def wait_closed(self, timeout: Optional[float] = None) -> bool:
        with self._cv:
            return self._cv.wait_for(lambda: self.closed, timeout=timeout)

    def data(self) -> bytes:
        with self._cv:
            return bytes(self._buf)

    def __len__(self) -> int:
        return len(self._buf)


def _frames(container):
    """Decoded audio as mono float32 numpy blocks, with their sample rate."""
    import av
    stream = container.streams.audio[0]
    resampler = av.AudioResampler(format="flt", layout="mono", rate=stream.rate or 24000)
    for frame in container.decode(stream):
        for f in resampler.resample(frame):
            yield f.to_ndarray().reshape(-1).astype(np.float32, copy=False), int(f.rate)


class Speaker:
    """One output stream kept open across sentences. Measured 10-25 on this laptop (MME,
    Realtek): opening and starting a stream took 0.12-0.22 s and its first write blocked
    another 0.12 s, while a write to a warm stream took 0.2 ms. So the stream stays open
    while he is being answered and closes after IDLE_CLOSE_S of silence.
    `open_stream(rate)` returns an unstarted stream with start/write/abort/close and a
    `latency` in seconds (sounddevice.OutputStream, mono float32)."""

    IDLE_CLOSE_S = 30.0

    def __init__(self, open_stream: Callable[[int], object], idle_close_s: Optional[float] = IDLE_CLOSE_S):
        self._open = open_stream
        self.idle_close_s = idle_close_s
        self._s = None
        self._rate = None
        self._lock = threading.Lock()
        self._timer: Optional[threading.Timer] = None
        self.opened = 0                       # how many streams were opened (tests, the log)

    def write(self, pcm: np.ndarray, rate: int) -> None:
        with self._lock:
            if self._timer is not None:
                self._timer.cancel()
                self._timer = None
            if self._s is None or rate != self._rate:
                self._close_locked()
                s = self._open(rate)
                s.start()
                self._s, self._rate = s, rate
                self.opened += 1
            s = self._s
        s.write(pcm.reshape(-1, 1))

    def warm(self, rate: int = 24000) -> None:
        """Open the stream before the first sentence needs it (a turn has started): the
        first sound then comes ~25 ms after the first bytes instead of ~0.2 s (measured
        10-25). It closes again after IDLE_CLOSE_S if nothing is said."""
        with self._lock:
            if self._s is not None and self._rate == rate:
                return
            self._close_locked()
            s = self._open(rate)
            s.start()
            self._s, self._rate = s, rate
            self.opened += 1
            self._arm_idle_locked()

    def _arm_idle_locked(self) -> None:
        if self._timer is not None:
            self._timer.cancel()
            self._timer = None
        if self._s is not None and self.idle_close_s is not None:
            self._timer = threading.Timer(self.idle_close_s, self.close)
            self._timer.daemon = True
            self._timer.start()

    def finish(self, stop: Optional[threading.Event] = None) -> bool:
        """Wait for what is buffered to play out (the stream stays open). True if `stop`
        was set meanwhile, in which case the buffer is dropped."""
        with self._lock:
            lat = float(getattr(self._s, "latency", 0.0) or 0.0) if self._s is not None else 0.0
        if stop is not None:
            stopped = stop.wait(lat)
        else:
            time.sleep(lat)
            stopped = False
        if stopped:
            self.abort()
            return True
        with self._lock:
            self._arm_idle_locked()
        return False

    def abort(self) -> None:
        """Drop the buffered samples now (barge-in). The next write opens a fresh stream."""
        with self._lock:
            if self._s is not None:
                try:
                    self._s.abort()
                except Exception:
                    pass
            self._close_locked()

    def close(self) -> None:
        with self._lock:
            self._close_locked()

    def _close_locked(self) -> None:
        if self._timer is not None:
            self._timer.cancel()
            self._timer = None
        if self._s is not None:
            try:
                self._s.close()
            except Exception:
                pass
        self._s, self._rate = None, None

    @property
    def is_open(self) -> bool:
        return self._s is not None

    def latency_s(self) -> float:
        """The open stream's reported device latency, seconds; 0.0 if closed or unknown."""
        s = self._s
        try:
            return float(getattr(s, "latency", 0.0) or 0.0) if s is not None else 0.0
        except Exception:
            return 0.0


def _default_level_emitter(speaker: Speaker) -> Optional[OutLevelEmitter]:
    """The emitter for this sentence, or None: the flag is off (the default, so the live voice
    process is unchanged) or there is no app to listen (appio.emit would be a no-op)."""
    if not out_level_enabled():
        return None
    try:
        import appio
        if not appio.ENABLED:
            return None
        em = OutLevelEmitter(appio.emit, latency_s=speaker.latency_s)
        em.warm(24000)                    # Edge TTS is 24 kHz mono; the analysis reads the real rate anyway
        return em
    except Exception:
        return None


def play_pipe(pipe: AudioPipe, speaker: Speaker, stop: Optional[threading.Event] = None,
              on_start: Optional[Callable[[], None]] = None, log: Callable[[str], None] = print,
              level: Optional[OutLevelEmitter] = None) -> str:
    """Decode `pipe` (mp3) and play it on `speaker` as it arrives. Returns PLAYED, STOPPED,
    or FAILED (nothing was heard: the caller plays the whole clip the old way).
    `level` (default: built from JARVIS_OUT_LEVEL, normally None) is told what was written."""
    stop = stop or threading.Event()
    started = False
    container = None
    if level is None:
        level = _default_level_emitter(speaker)
    try:
        import av
        container = av.open(pipe, mode="r", format="mp3",
                            options={"probesize": str(PROBE_BYTES), "analyzeduration": "0"})
        for pcm, rate in _frames(container):
            if stop.is_set() or pipe.cancelled:
                if started:
                    speaker.abort()
                return STOPPED
            out = pcm * float(pipe.gain)
            speaker.write(out, rate)
            if level is not None:
                level.push(out, rate)           # after the write: the device already has it
            pipe.played_s += len(pcm) / float(rate)
            if not started:
                started = True
                if on_start is not None:
                    on_start()
        if stop.is_set() or pipe.cancelled:
            if started:
                speaker.abort()
            return STOPPED
        if started and speaker.finish(stop):
            return STOPPED
        if pipe.error is not None:
            log(f"[voice] the online voice stopped mid-sentence: {pipe.error}")
        return PLAYED if started else FAILED
    except Exception as e:
        speaker.abort()
        if started:
            log(f"[voice] streamed playback broke off: {type(e).__name__}: {e}")
            return PLAYED
        log(f"[voice] streamed playback unavailable ({type(e).__name__}: {e}); playing the whole clip")
        return FAILED
    finally:
        if level is not None:
            level.finish()
        if container is not None:
            try:
                container.close()
            except Exception:
                pass


