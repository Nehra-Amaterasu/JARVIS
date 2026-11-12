"""JARVIS's output level (core/playback.py, JARVIS_OUT_LEVEL; spec 9.2 and tests P-1 to P-5).

Synthetic audio only: silence gives zeros, a sine lands in the band the spec's formula
names, the 20 Hz limiter, the underrun-safety checks (a consumer that raises or blocks
never delays push), no growth, and the flag off by default. The cost per frame is
measured at the bottom and printed (the number goes in docs/research/voice.md).
"""
import gc
import math
import threading
import time
import tracemalloc

import numpy as np
import pytest

import playback
from playback import OutLevelEmitter, analyse, band_edges


def _sine(freq, peak=0.1, sr=24000, n=2048):
    t = np.arange(n) / sr
    return (peak * np.sin(2 * np.pi * freq * t)).astype(np.float32)


class FakeClock:
    def __init__(self):
        self.t = 100.0

    def __call__(self):
        return self.t


def _band_of(f):
    return int(math.floor(24 * math.log(f / 100.0) / math.log(80.0)))


def _collect():
    got, ev = [], threading.Event()

    def emit(kind, **fields):
        got.append((kind, fields))
        ev.set()
    return got, emit, ev


def _wait(cond, timeout=2.0):
    end = time.time() + timeout
    while time.time() < end:
        if cond():
            return True
        time.sleep(0.005)
    return cond()


# ---------------------------------------------------------------- the analysis
def test_p5_band_edges_follow_the_spec():
    e = band_edges(24, 100, 8000)
    assert len(e) == 25
    for i, want in ((0, 100), (8, 431), (12, 894), (16, 1857), (20, 3854), (23, 6665), (24, 8000)):
        assert abs(e[i] - want) < 0.5 + want * 0.001


def test_p1_a_1700_hz_sine_reads_minus_20_in_band_15():
    rms, peak, bands = analyse(_sine(1700), 24000)
    assert abs(rms - -20.0) < 0.2
    assert abs(peak - -20.0) < 0.1
    assert int(np.argmax(bands)) == 15 == _band_of(1700)
    band_db = bands[15] / 255 * 60 - 60
    assert abs(band_db - -20.0) < 1.5
    _, _, b1k = analyse(_sine(1000), 24000)
    assert int(np.argmax(b1k)) == 12


def test_p2_silence_is_zeros_and_never_nan():
    rms, peak, bands = analyse(np.zeros(2048, dtype=np.float32), 24000)
    assert bands == [0] * 24
    assert rms <= -90 and peak <= -90
    assert all(math.isfinite(v) for v in (rms, peak))
    sq = np.where(np.arange(2048) % 48 < 24, 1.0, -1.0).astype(np.float32)
    rms, _, bands = analyse(sq, 24000)
    assert rms > -1 and max(bands) > 200 and all(0 <= b <= 255 for b in bands)


def test_p7_one_sine_per_octave_region_peaks_in_its_band():
    r = 80 ** (1 / 24)
    for i in (0, 4, 8, 12, 16, 20, 23):
        _, _, bands = analyse(_sine(100 * r ** (i + 0.5)), 24000)
        assert int(np.argmax(bands)) == i, i


def test_bands_above_nyquist_are_zero():
    # a 16 kHz stream has Nyquist 8 kHz, so band 23 (6665-8000 Hz) is the last that can read
    _, _, bands = analyse(_sine(1700, sr=16000, n=1024), 16000)
    assert int(np.argmax(bands)) == 15
    _, _, bands8 = analyse(_sine(1700, sr=8000, n=1024), 8000)      # Nyquist 4 kHz
    assert bands8[-1] == 0 and bands8[-2] == 0 and max(bands8) > 0


def test_a_quiet_sound_stays_quiet_there_is_no_automatic_gain():
    loud = analyse(_sine(1700, 0.5), 24000)[2]
    quiet = analyse(_sine(1700, 0.005), 24000)[2]        # 40 dB lower
    assert max(loud) - max(quiet) == pytest.approx(255 * 40 / 60, abs=6)


# ---------------------------------------------------------------- the emitter
def test_p3_twenty_hz_with_consecutive_seq_and_one_final():
    clk = FakeClock()
    got, emit, _ = _collect()
    em = OutLevelEmitter(emit, clock=clk, latency_s=lambda: 0.09)
    frame = _sine(440, 0.2, n=576)                        # one 24 ms MP3 frame
    for _ in range(42):                                   # 1.008 s of 24 ms writes
        em.push(frame, 24000)
        clk.t += 0.024
    produced = em.seq                                     # frames made; the fake clock runs far faster than
    em.finish()                                           # the consumer thread, so some are dropped, by design
    em.finish()                                           # idempotent
    assert _wait(lambda: any(f["final"] for _, f in got))
    time.sleep(0.05)
    assert all(k == "out_level" for k, _ in got)
    live = [f for _, f in got if not f["final"]]
    assert 19 <= produced <= 21 and live
    seqs = [f["seq"] for _, f in got]
    assert seqs == sorted(seqs) and sum(1 for _, f in got if f["final"]) == 1
    f = live[-1]
    assert f["sr"] == 24000 and len(f["bands"]) == 24 and f["lat_ms"] == 90.0
    assert set(f) == {"sr", "rms_db", "peak_db", "bands", "lat_ms", "final", "seq"}
    assert got[-1][1]["final"] and got[-1][1]["bands"] == [0] * 24


def test_no_final_when_nothing_was_ever_sent():
    got, emit, _ = _collect()
    em = OutLevelEmitter(emit, clock=FakeClock())
    em.finish()
    time.sleep(0.05)
    assert got == []


def test_p4_a_consumer_that_raises_never_reaches_the_write_loop():
    clk = FakeClock()
    calls = []

    def emit(kind, **f):
        calls.append(f["seq"])
        raise BrokenPipeError("the app went away")
    em = OutLevelEmitter(emit, clock=clk)
    frame = _sine(440, 0.2, n=576)
    for _ in range(60):
        em.push(frame, 24000)                              # must not raise
        clk.t += 0.024
    em.finish()
    assert _wait(lambda: len(calls) >= 1)


def test_p4_a_consumer_that_blocks_does_not_delay_push_and_frames_are_dropped():
    clk = FakeClock()
    gate = threading.Event()
    got = []

    def emit(kind, **f):
        got.append(f["seq"])
        gate.wait(5.0)                                     # a stuck stdout pipe
    em = OutLevelEmitter(emit, clock=clk)
    em.warm(24000)                                         # what play_pipe does when a sentence starts
    time.sleep(0.3)
    frame = _sine(440, 0.2, n=576)
    worst = 0.0
    for _ in range(100):                                   # 2.4 s of speech
        t0 = time.perf_counter()
        em.push(frame, 24000)
        worst = max(worst, time.perf_counter() - t0)
        clk.t += 0.024
    # a push that waited on the stuck consumer would take its 5 s; the write loop's whole budget is
    # 24 ms a frame, and 50 ms is the margin for a loaded test machine (typical push: tens of us)
    assert worst < 0.05, f"push took {worst * 1000:.1f} ms with the consumer blocked"
    assert em.dropped > 40
    assert len(got) == 1                                   # the one the worker is stuck on
    gate.set()
    em.finish()
    assert _wait(lambda: len(got) >= 2)


def test_memory_does_not_grow_over_a_long_speech():
    clk = FakeClock()
    em = OutLevelEmitter(lambda kind, **f: None, clock=clk)
    frame = _sine(440, 0.2, n=576)
    for _ in range(500):                                   # warm up: the plan, the thread, the first frames
        em.push(frame, 24000)
        clk.t += 0.024
    gc.collect()
    tracemalloc.start()
    base, _ = tracemalloc.get_traced_memory()
    for _ in range(5000):                                  # 2 minutes of speech
        em.push(frame, 24000)
        clk.t += 0.024
    gc.collect()
    now, _ = tracemalloc.get_traced_memory()
    tracemalloc.stop()
    assert now - base < 64 * 1024, f"grew {now - base} bytes over 5000 frames"
    assert len(playback._PLANS) <= 8


def test_a_sample_rate_change_resizes_the_window():
    clk = FakeClock()
    got, emit, _ = _collect()
    em = OutLevelEmitter(emit, clock=clk)
    for rate in (24000, 16000):
        for _ in range(10):
            em.push(_sine(1000, 0.2, rate, 384), rate)
            clk.t += 0.024
    assert _wait(lambda: any(f["sr"] == 16000 for _, f in got))
    assert len(em._ring) == 1024                           # 16 kHz -> 1024; 24 kHz -> 2048


# ---------------------------------------------------------------- the flag and play_pipe
def test_the_flag_is_off_by_default(monkeypatch):
    monkeypatch.delenv("JARVIS_OUT_LEVEL", raising=False)
    assert not playback.out_level_enabled()
    assert playback._default_level_emitter(playback.Speaker(lambda r: None)) is None
    for v in ("1", "true", "YES", "on"):
        monkeypatch.setenv("JARVIS_OUT_LEVEL", v)
        assert playback.out_level_enabled()
    monkeypatch.setenv("JARVIS_OUT_LEVEL", "0")
    assert not playback.out_level_enabled()


def test_play_pipe_reports_levels_and_a_final_frame_through_the_real_decoder():
    from test_playback import _mp3, FakeOut     # the same real 24 kHz mp3 the playback tests use
    got, emit, _ = _collect()
    log = []
    speaker = playback.Speaker(lambda rate: FakeOut(rate, log), idle_close_s=None)
    pipe = playback.AudioPipe("x", gain=0.5)
    pipe.feed(_mp3(1.0))
    pipe.close()
    ticks = iter(np.arange(100.0, 200.0, 0.024))           # the decoder runs far faster than real time, so
    em = OutLevelEmitter(emit, clock=lambda: next(ticks))  # each push is one 24 ms step of a pretend clock
    assert playback.play_pipe(pipe, speaker, level=em) == playback.PLAYED
    assert _wait(lambda: any(f["final"] for _, f in got))
    live = [f for _, f in got if not f["final"]]
    assert live, "a one second sentence decoded in well under a second still reports once or more"
    # a 440 Hz sine at 0.3 peak, gain 0.5: -16.5 dB, in band floor(24 ln(4.4)/ln 80) = 8
    mid = live[len(live) // 2]
    assert abs(mid["rms_db"] - 20 * math.log10(0.15)) < 1.5
    assert int(np.argmax(mid["bands"])) == _band_of(440)


def test_play_pipe_without_the_flag_emits_nothing_and_builds_no_thread(monkeypatch):
    from test_playback import _mp3, FakeOut
    monkeypatch.delenv("JARVIS_OUT_LEVEL", raising=False)
    before = {t.name for t in threading.enumerate()}
    speaker = playback.Speaker(lambda rate: FakeOut(rate, []), idle_close_s=None)
    pipe = playback.AudioPipe("x")
    pipe.feed(_mp3(0.5))
    pipe.close()
    assert playback.play_pipe(pipe, speaker) == playback.PLAYED
    assert "out-level" not in {t.name for t in threading.enumerate()} - before


# ---------------------------------------------------------------- the cost
def test_cost_per_frame_is_far_inside_a_24_ms_frame(capsys):
    clk = FakeClock()
    em = OutLevelEmitter(lambda kind, **f: None, clock=clk)
    frame = _sine(440, 0.2, n=576)
    for _ in range(200):
        em.push(frame, 24000)
        clk.t += 0.024
    costs = []
    for _ in range(2000):
        t0 = time.perf_counter()
        em.push(frame, 24000)
        costs.append(time.perf_counter() - t0)
        clk.t += 0.024
    us = np.array(costs) * 1e6
    w = _sine(1700, 0.1, n=2048)
    an = []
    for _ in range(500):
        t0 = time.perf_counter()
        analyse(w, 24000)
        an.append(time.perf_counter() - t0)
    an_us = np.array(an) * 1e6
    with capsys.disabled():
        print(f"\n[out_level cost] push per 24 ms frame: mean {us.mean():.1f} us, median {np.median(us):.1f} us, "
              f"p99 {np.percentile(us, 99):.1f} us; analyse (2048 samples): median {np.median(an_us):.1f} us, "
              f"p99 {np.percentile(an_us, 99):.1f} us")
    # Median only: the mean and p99 are printed, not asserted, because on a shared box the scheduler
    # (other builds running) adds milliseconds to a few percent of calls. 1 ms is 4 % of a frame.
    assert np.median(us) < 1000
