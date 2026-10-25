"""Edge audio played while it downloads (core/playback.py + voice.VoiceEngine, 10-25).

The clip here is a real mp3 (PyAV's LAME encoder, 24 kHz mono, the same format Edge
sends), fed to the pipe in small pieces from another thread, so the tests show the
first samples reach the speaker before the last bytes arrive.
"""
import io
import threading
import time

import numpy as np
import pytest

import playback
import voice

av = pytest.importorskip("av")


def _mp3(seconds=1.0, rate=24000) -> bytes:
    buf = io.BytesIO()
    out = av.open(buf, mode="w", format="mp3")
    st = out.add_stream("libmp3lame", rate=rate)
    st.layout = "mono"
    st.bit_rate = 48000
    t = np.arange(int(seconds * rate)) / rate
    pcm = (0.3 * np.sin(2 * np.pi * 440 * t)).astype(np.float32)
    frame_size = st.codec_context.frame_size or 1152
    for i in range(0, len(pcm), frame_size):
        chunk = pcm[i:i + frame_size]
        fr = av.AudioFrame.from_ndarray(chunk.reshape(1, -1), format="flt", layout="mono")
        fr.rate = rate
        for pkt in st.encode(fr):
            out.mux(pkt)
    for pkt in st.encode(None):
        out.mux(pkt)
    out.close()
    return buf.getvalue()


CLIP = None


@pytest.fixture(scope="module")
def clip():
    global CLIP
    if CLIP is None:
        CLIP = _mp3()
    return CLIP


class FakeOut:
    def __init__(self, rate, log):
        self.rate, self.log = rate, log
        self.samples = 0
        log.append(("open", rate))

    def start(self):
        self.log.append(("start",))

    def write(self, a):
        assert a.dtype == np.float32 and a.ndim == 2 and a.shape[1] == 1
        self.samples += len(a)
        self.log.append(("write", len(a), time.monotonic()))

    def stop(self):
        self.log.append(("stop",))

    def abort(self):
        self.log.append(("abort",))

    def close(self):
        self.log.append(("close",))


def spk(open_stream):
    return playback.Speaker(open_stream, idle_close_s=None)


def _feed(pipe, data, piece=720, delay=0.01, close=True):
    def run():
        for i in range(0, len(data), piece):
            pipe.feed(data[i:i + piece])
            time.sleep(delay)
        pipe.fed_all_at = time.monotonic()
        if close:
            pipe.close()
    th = threading.Thread(target=run, daemon=True)
    th.start()
    return th


def test_playback_starts_before_the_clip_has_finished_arriving(clip):
    pipe = playback.AudioPipe("hi", gain=0.5)
    log, started = [], []
    outs = []
    th = _feed(pipe, clip)
    speaker = spk(lambda r: outs.append(FakeOut(r, log)) or outs[-1])
    res = playback.play_pipe(pipe, speaker, on_start=lambda: started.append(time.monotonic()), log=lambda m: None)
    th.join()
    assert res == playback.PLAYED
    assert outs[0].rate == 24000
    assert started and started[0] < pipe.fed_all_at          # sound before the last byte
    assert abs(outs[0].samples - 24000) < 2400                 # about one second of audio
    assert pipe.played_s == pytest.approx(outs[0].samples / 24000)
    assert speaker.is_open and ("abort",) not in log           # kept warm for the next sentence


def test_the_next_sentence_reuses_the_warm_stream(clip):
    log, outs = [], []
    speaker = spk(lambda r: outs.append(FakeOut(r, log)) or outs[-1])
    for _ in range(3):
        pipe = playback.AudioPipe()
        pipe.feed(clip)
        pipe.close()
        assert playback.play_pipe(pipe, speaker, log=lambda m: None) == playback.PLAYED
    assert speaker.opened == 1 and len(outs) == 1
    speaker.close()
    assert not speaker.is_open and log[-1] == ("close",)


def test_an_idle_speaker_closes_itself(clip):
    log = []
    speaker = playback.Speaker(lambda r: FakeOut(r, log), idle_close_s=0.05)
    pipe = playback.AudioPipe()
    pipe.feed(clip)
    pipe.close()
    playback.play_pipe(pipe, speaker, log=lambda m: None)
    deadline = time.monotonic() + 2.0
    while speaker.is_open and time.monotonic() < deadline:
        time.sleep(0.01)
    assert not speaker.is_open and ("close",) in log


def test_gain_scales_the_samples(clip):
    peaks = {}
    for gain in (1.0, 0.25):
        pipe = playback.AudioPipe(gain=gain)
        pipe.feed(clip)
        pipe.close()
        got = []

        class Out(FakeOut):
            def write(self, a):
                got.append(float(np.abs(a).max()))

        playback.play_pipe(pipe, spk(lambda r: Out(r, [])), log=lambda m: None)
        peaks[gain] = max(got)
    assert peaks[0.25] == pytest.approx(peaks[1.0] * 0.25, rel=0.02)


def test_a_barge_in_stops_within_a_frame_and_drops_the_buffer(clip):
    pipe = playback.AudioPipe()
    stop = threading.Event()
    log = []
    th = _feed(pipe, clip, delay=0.02)

    def on_start():
        stop.set()                                  # he said "stop Jarvis" as it began

    speaker = spk(lambda r: FakeOut(r, log))
    res = playback.play_pipe(pipe, speaker, stop=stop, on_start=on_start, log=lambda m: None)
    pipe.cancel()
    th.join()
    assert res == playback.STOPPED
    assert ("abort",) in log and not speaker.is_open
    assert sum(1 for e in log if e[0] == "write") <= 2


def test_a_stop_while_the_buffer_plays_out_drops_it(clip):
    class Slow(FakeOut):
        latency = 5.0                                # a long buffer: finish() would wait 5 s

    log = []
    stop = threading.Event()
    pipe = playback.AudioPipe()
    pipe.feed(clip)
    pipe.close()
    threading.Timer(0.1, stop.set).start()
    t0 = time.monotonic()
    res = playback.play_pipe(pipe, spk(lambda r: Slow(r, log)), stop=stop, log=lambda m: None)
    assert res == playback.STOPPED and time.monotonic() - t0 < 2.0 and ("abort",) in log


def test_cancel_unblocks_a_reader_waiting_for_bytes():
    pipe = playback.AudioPipe()
    out = []
    th = threading.Thread(target=lambda: out.append(pipe.read(100)), daemon=True)
    th.start()
    time.sleep(0.05)
    pipe.cancel()
    th.join(timeout=2)
    assert out == [b""]


def test_bytes_that_are_not_audio_fail_so_the_caller_can_use_the_old_path():
    pipe = playback.AudioPipe()
    pipe.feed(b"this is not an mp3 at all " * 200)
    pipe.close()
    logs = []
    res = playback.play_pipe(pipe, spk(lambda r: FakeOut(r, [])), log=logs.append)
    assert res == playback.FAILED
    assert any("playing the whole clip" in m for m in logs)


def test_a_broken_speaker_before_any_sound_is_a_failure_not_a_crash(clip):
    pipe = playback.AudioPipe()
    pipe.feed(clip)
    pipe.close()

    def no_device(rate):
        raise OSError("no output device")

    assert playback.play_pipe(pipe, spk(no_device), log=lambda m: None) == playback.FAILED


def test_a_stream_cut_mid_sentence_plays_what_arrived(clip):
    pipe = playback.AudioPipe()
    pipe.feed(clip[: len(clip) // 2])
    pipe.close(error=TimeoutError("receive timed out"))
    logs, outs = [], []
    res = playback.play_pipe(pipe, spk(lambda r: outs.append(FakeOut(r, [])) or outs[-1]), log=logs.append)
    assert res == playback.PLAYED
    assert 6000 < outs[0].samples < 18000
    assert any("mid-sentence" in m for m in logs)


def test_a_writer_that_never_closes_does_not_hang_the_player(monkeypatch):
    monkeypatch.setattr(playback, "READ_TIMEOUT_S", 0.1)
    pipe = playback.AudioPipe()
    t0 = time.monotonic()
    assert pipe.read(10) == b""
    assert time.monotonic() - t0 < 1.0 and pipe.closed and isinstance(pipe.error, TimeoutError)


# ------------------------------------------------------------------ the voice engine side
def _engine(handed, marks=None, **kw):
    return voice.VoiceEngine(play=lambda *a: handed.append(("file",) + a), log=lambda m: None, enabled=False,
                             settings=lambda: {}, play_stream=lambda t, p, g: handed.append(("stream", t, p, g)),
                             on_mark=(lambda s, **i: marks.append((s, i))) if marks is not None else None, **kw)


def test_an_edge_sentence_goes_to_the_player_at_its_first_bytes(monkeypatch):
    seen_at_hand_off = []
    handed, marks = [], []

    async def fake_stream(text, name, rate, on_chunk):
        on_chunk(b"a" * 300)
        seen_at_hand_off.append(len(handed))       # handed over before the second chunk exists
        on_chunk(b"b" * 300)
        return 600

    monkeypatch.setattr(voice, "_edge_stream", fake_stream)
    monkeypatch.setattr(voice, "EDGE_STREAM", True)
    eng = _engine(handed, marks)
    assert eng._synth(voice.STYLES["hi"], "नमस्ते", eng._epoch) is voice.STREAMED
    assert seen_at_hand_off == [1]
    kind, text, pipe, gain = handed[0]
    assert kind == "stream" and text == "नमस्ते" and gain == voice.STYLES["hi"].edge_gain
    assert pipe.data() == b"a" * 300 + b"b" * 300 and pipe.closed and pipe.error is None
    assert marks == [("tts_first_byte", {"engine": "edge-stream"}), ("tts_ready", {})]


def test_nothing_from_edge_means_kokoro_says_it(monkeypatch, tmp_path):
    handed = []

    async def refused(text, name, rate, on_chunk):
        raise ConnectionError("403")

    monkeypatch.setattr(voice, "_edge_stream", refused)
    monkeypatch.setattr(voice, "EDGE_STREAM", True)
    eng = _engine(handed)
    monkeypatch.setattr(type(eng.kokoro), "available", property(lambda self: True))
    monkeypatch.setattr(eng.kokoro, "synth", lambda text, v, lang, speed=1.0: str(tmp_path / "k.wav"))
    path, _ = eng._synth(voice.STYLES["uk"], "Hello.", eng._epoch)
    assert path.endswith("k.wav") and handed == []
    assert eng._edge_down_until > 0


def test_edge_breaking_after_the_hand_off_keeps_what_arrived(monkeypatch):
    handed = []

    async def breaks(text, name, rate, on_chunk):
        on_chunk(b"a" * 400)
        raise TimeoutError("receive timed out")

    monkeypatch.setattr(voice, "_edge_stream", breaks)
    monkeypatch.setattr(voice, "EDGE_STREAM", True)
    eng = _engine(handed)
    assert eng._synth(voice.STYLES["uk"], "Hello.", eng._epoch) is voice.STREAMED
    pipe = handed[0][2]
    assert pipe.closed and isinstance(pipe.error, TimeoutError) and not pipe.cancelled
    assert eng._edge_down_until == 0.0                     # a blip mid-sentence is not an outage


def test_a_barge_in_stops_the_download(monkeypatch):
    handed = []
    eng = _engine(handed)

    async def long_stream(text, name, rate, on_chunk):
        on_chunk(b"a" * 300)
        eng.clear()                                         # "stop Jarvis" while it downloads
        on_chunk(b"b" * 300)
        raise AssertionError("kept downloading after clear()")

    monkeypatch.setattr(voice, "_edge_stream", long_stream)
    monkeypatch.setattr(voice, "EDGE_STREAM", True)
    assert eng._synth(voice.STYLES["uk"], "Hello.", eng._epoch) is voice.STREAMED
    assert handed[0][2].cancelled


def test_streaming_off_keeps_whole_files(monkeypatch, tmp_path):
    handed = []

    async def fake_edge(text, name, rate, on_first=None):
        return str(tmp_path / "x.mp3")

    monkeypatch.setattr(voice, "_edge_synth", fake_edge)
    monkeypatch.setattr(voice, "EDGE_STREAM", False)
    eng = _engine(handed)
    path, _ = eng._synth(voice.STYLES["uk"], "Hello.", eng._epoch)
    assert path.endswith("x.mp3")


def test_the_worker_does_not_hand_a_streamed_sentence_over_twice(monkeypatch):
    handed = []

    async def fake_stream(text, name, rate, on_chunk):
        on_chunk(b"a" * 300)
        return 300

    monkeypatch.setattr(voice, "_edge_stream", fake_stream)
    monkeypatch.setattr(voice, "EDGE_STREAM", True)
    eng = _engine(handed)
    eng.enabled = True                                      # say() queues; no thread was started
    eng.say("Hello there.")
    eng.close()
    eng._worker()                                           # runs the queue on this thread, then returns
    assert [h[0] for h in handed] == ["stream"]
