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
"""
from __future__ import annotations

import threading
import time
from typing import Callable, Optional

import numpy as np

PLAYED, STOPPED, FAILED = "played", "stopped", "failed"
PROBE_BYTES = 2048           # enough for the mp3 demuxer to find the first frame header
READ_TIMEOUT_S = 15.0


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


def play_pipe(pipe: AudioPipe, speaker: Speaker, stop: Optional[threading.Event] = None,
              on_start: Optional[Callable[[], None]] = None, log: Callable[[str], None] = print) -> str:
    """Decode `pipe` (mp3) and play it on `speaker` as it arrives. Returns PLAYED, STOPPED,
    or FAILED (nothing was heard: the caller plays the whole clip the old way)."""
    stop = stop or threading.Event()
    started = False
    container = None
    try:
        import av
        container = av.open(pipe, mode="r", format="mp3",
                            options={"probesize": str(PROBE_BYTES), "analyzeduration": "0"})
        for pcm, rate in _frames(container):
            if stop.is_set() or pipe.cancelled:
                if started:
                    speaker.abort()
                return STOPPED
            speaker.write(pcm * float(pipe.gain), rate)
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
        if container is not None:
            try:
                container.close()
            except Exception:
                pass


