"""Aankhen's eyes (eyes.py): the ripples and the rhythm a person watches.

Synthetic data throughout: a smooth, body-like change across subcarriers on top of
white receiver noise, as in test_hbe.py. These tests pin what the pictures MEAN (a
1.5 Hz wave peaks at 1.5 Hz, noise names no peak, a step lights the column and then
fades into the baseline), and that building them stays cheap under the engine lock.
"""
import asyncio
import json
import math
import time
import tracemalloc

import numpy as np
import pytest

from aankhen.csi import LLTF_KEEP, Sample, bin_of
from aankhen.engine import Engine
from aankhen.eyes import (CLIP_Z, PEAK_MIN_X, SPECTRUM_S, WARMUP_S, EyesBuffer, phase_residual)
from aankhen.motion import Baseline, _smooth_basis
from aankhen.protocol import CsiPacket
from aankhen.room import default_room
from aankhen.server import Streamer

SUB = 51
RATE = 100.0
SD = 0.03                       # receiver noise, normalised amplitude units


def pattern(seed=1):
    """A body-like change: smooth across the band (test_hbe.smooth_ripple)."""
    p = _smooth_basis(SUB) @ np.random.default_rng(seed).normal(0, 1, 6)
    return p / np.abs(p).max()


def stream(seconds, f_hz=None, amp=0.0, seed=0, t0=0.0):
    """(t, amplitudes) of `seconds` of 100 Hz stream: noise, plus a sine on a smooth pattern."""
    rng = np.random.default_rng(seed)
    n = int(round(seconds * RATE))
    t = t0 + np.arange(n) / RATE
    A = 1.0 + rng.normal(0, SD, (n, SUB))
    if f_hz is not None:
        A += amp * np.outer(np.sin(2 * np.pi * f_hz * t), pattern())
    return t, A


def feed(buf, t, A, filled=None):
    for i in range(len(t)):
        buf.push(Sample(float(t[i]), A[i], bool(filled[i]) if filled is not None else False))


# ------------------------------------------------------------------ rhythm
def test_a_one_and_a_half_hertz_wave_peaks_at_one_and_a_half_hertz():
    buf = EyesBuffer()
    feed(buf, *stream(8.0, f_hz=1.5, amp=0.03))
    s = buf.spectrum()
    assert s is not None and len(s["hz"]) == len(s["power"]) == 64
    assert s["hz"][0] == pytest.approx(0.156, abs=1e-3) and s["hz"][-1] == pytest.approx(10.0)
    assert s["peak_hz"] == pytest.approx(1.5, abs=0.1)
    assert max(s["bands"], key=s["bands"].get) == "body"
    assert s["bands"]["body"] > 20 * s["bands"]["above"]


def test_pure_noise_names_no_peak():
    for seed in range(6):
        buf = EyesBuffer()
        feed(buf, *stream(8.0, seed=seed))
        s = buf.spectrum()
        assert s["peak_hz"] is None, seed
        band = [p for f, p in zip(s["hz"], s["power"]) if 0.4 <= f <= 4.0]
        assert max(band) < math.log10(PEAK_MIN_X)
        assert all(0.4 < v < 2.0 for v in s["bands"].values())      # ~1 x the floor everywhere


def test_a_slower_rhythm_leaking_into_the_band_edge_is_not_named():
    """A strong rhythm just below body speed (0.31 Hz, a fast breath) leaks into the
    0.47 Hz bin at the band's lower edge through the window's main lobe: that bin is
    the band's strongest and far above the noise, but it is the shoulder of something
    slower, not a rhythm at body speed, so no peak is named."""
    buf = EyesBuffer()
    feed(buf, *stream(8.0, f_hz=0.3125, amp=0.05))
    s = buf.spectrum()
    hz, p = np.array(s["hz"]), np.array(s["power"])
    band = np.flatnonzero((hz >= 0.4) & (hz <= 4.0))
    edge = band[np.argmax(p[band])]
    assert hz[edge] == pytest.approx(0.469, abs=0.01) and p[edge] > np.log10(PEAK_MIN_X)
    assert p[edge - 1] > p[edge]                            # the real rhythm is below the band
    assert s["peak_hz"] is None


def test_one_over_f_drift_without_a_tone_names_no_peak():
    """The real channel's spectrum falls roughly as 1/f; against the white 6-10 Hz floor
    alone, 4x fired on drift in ~45 % of still and empty windows on the real board. A
    peak must also stand out of its own neighbourhood."""
    named = total = 0
    for seed in range(8):
        t, A = stream(40.0, seed=seed)
        rng = np.random.default_rng(100 + seed)
        drift = np.cumsum(rng.normal(0, 1, (len(t), 6)), axis=0)       # random walk: 1/f^2 power
        A += 0.0015 * drift @ _smooth_basis(SUB).T
        buf = EyesBuffer()
        for i in range(len(t)):
            buf.push(Sample(float(t[i]), A[i], False))
            if i >= 700 and i % 50 == 0:
                total += 1
                named += buf.spectrum()["peak_hz"] is not None
    assert named <= 0.05 * total, f"{named}/{total} windows named a peak in pure drift"


def test_a_quarter_hertz_breath_lands_in_the_breathing_band():
    buf = EyesBuffer()
    feed(buf, *stream(8.0, f_hz=0.25, amp=0.02))
    b = buf.spectrum()["bands"]
    assert max(b, key=b.get) == "breathing"
    assert b["breathing"] > 10 * max(b["fast"], b["above"])


def test_the_spectrum_waits_for_its_window_and_a_reset():
    buf = EyesBuffer()
    t, A = stream(SPECTRUM_S - 0.2)
    feed(buf, t, A)
    assert buf.spectrum() is None
    feed(buf, *stream(0.5, seed=1, t0=t[-1] + 0.01))
    assert buf.spectrum() is not None
    buf.reset()
    assert buf.spectrum() is None and buf.column() is None and buf.seconds == 0


def test_a_mostly_invented_window_is_refused():
    buf = EyesBuffer()
    t, A = stream(8.0)
    filled = np.zeros(len(t), bool)
    filled[::3] = filled[1::3] = True
    feed(buf, t, A, filled)
    assert buf.spectrum() is None


# ------------------------------------------------------------------ ripple
def test_columns_are_bounded_and_answer_a_step_then_fade_into_the_baseline():
    buf = EyesBuffer()
    t, A = stream(5.0)
    feed(buf, t, A)
    buf.column()                                       # drain the warm-up
    feed(buf, *stream(0.1, seed=2, t0=t[-1] + 0.01))
    quiet = buf.column()
    assert len(quiet) == SUB and max(abs(v) for v in quiet) < 2.0
    assert all(round(v, 2) == v for v in quiet)

    step = np.zeros(SUB)
    step[:10] = 8 * SD                                  # 8 noise SDs on the lowest ten subcarriers
    t2, A2 = stream(0.1, seed=3, t0=t[-1] + 0.11)
    feed(buf, t2, A2 + step)
    hit = np.array(buf.column())
    assert np.all(np.abs(hit) <= CLIP_Z)
    assert hit[:10].min() >= 5.0 and np.abs(hit[10:]).max() < 2.5

    t3, A3 = stream(40.0, seed=4, t0=t2[-1] + 0.01)    # the step stays: "lately" catches up
    feed(buf, t3, A3 + step)
    buf.column()
    feed(buf, *(lambda tt, aa: (tt, aa + step))(*stream(0.1, seed=5, t0=t3[-1] + 0.01)))
    assert np.abs(np.array(buf.column())[:10]).max() < 1.5


def test_the_ripple_shows_the_channels_shape_not_its_level():
    """With gain reports the stream keeps the overall level, which the simulator swings
    +-3 dB every ~10 s with nobody moving; per subcarrier, in noise units, that read as
    a saturated room. The ripple divides each sample by its own median: a level change
    stays dark, a change of shape lights it, and the rhythm still has the level."""
    buf = EyesBuffer()
    t, A = stream(5.0)
    feed(buf, t, A)
    buf.column()
    t2, A2 = stream(0.3, seed=6, t0=t[-1] + 0.01)
    feed(buf, t2, A2 * 1.4)                               # +2.9 dB on every subcarrier
    assert np.median(np.abs(buf.column())) < 1.0
    shape = np.ones(SUB)
    shape[:12] = 1.0 + 8 * SD
    t3, A3 = stream(0.3, seed=7, t0=t2[-1] + 0.01)
    feed(buf, t3, A3 * 1.4 * shape)                       # the band bends: a body
    lit = np.abs(np.array(buf.column()))
    assert lit[:12].min() >= 4.0 and np.median(lit[12:]) < 1.5
    assert buf._amp[(buf._count - 1) % buf._cap].mean() > 1.3     # the ring (rhythm) keeps the level


def test_columns_wait_for_warm_up_and_say_none_when_nothing_arrived():
    buf = EyesBuffer()
    t, A = stream(WARMUP_S - 0.3)
    feed(buf, t, A)
    assert buf.column() is None
    feed(buf, *stream(0.5, seed=1, t0=t[-1] + 0.01))
    assert buf.column() is not None
    assert buf.column() is None                         # nothing new since


def test_forward_filled_samples_do_not_talk_the_noise_down():
    """The resampler repeats the last packet across a gap; its zero difference is not
    a quiet receiver."""
    t, A = stream(10.0)
    filled = np.zeros(len(t), bool)
    filled[1::2] = True
    A[1::2] = A[0::2][: len(A[1::2])]                   # every other sample a repeat
    buf = EyesBuffer()
    feed(buf, t, A, filled)
    sigma = buf.amp.noise / (2 / math.sqrt(math.pi))
    assert np.median(sigma) == pytest.approx(SD, rel=0.15)


def test_a_viewer_who_arrives_late_sees_the_last_half_second_not_the_last_minute():
    buf = EyesBuffer()
    t, A = stream(60.0)
    A[: 3000] += 10 * SD                                 # long ago: very different
    feed(buf, t, A)
    assert buf.amp.acc_n <= 51                           # the average restarted, bounded


# ------------------------------------------------------------------ phase
S = np.array(LLTF_KEEP, float)


def raw_from(H):
    """51 complex values -> the ESP32's 128-byte LLTF buffer (int8, imaginary FIRST)."""
    buf = np.zeros(128, np.int8)
    for s, h in zip(LLTF_KEEP, H):
        k = bin_of(s)
        buf[2 * k] = np.clip(round(h.imag), -127, 127)
        buf[2 * k + 1] = np.clip(round(h.real), -127, 127)
    return buf.tobytes()


def multipath(delays_ns=(0.0, 35.0, 80.0), gains=(30.0, 14.0, 8.0), phases=(0.0, 1.0, 2.5)):
    """A static channel: a few paths, each a phase ramp across 312.5 kHz subcarriers."""
    f = S * 312.5e3
    return sum(g * np.exp(1j * (p - 2 * np.pi * f * d * 1e-9)) for d, g, p in zip(delays_ns, gains, phases))


def scramble(H, rng, steep=False):
    """What the clocks do: a random common phase and a random slope, per packet."""
    a = rng.uniform(-1.4, 1.4) if steep else rng.normal(0, 0.05)
    return H * np.exp(1j * (rng.uniform(-np.pi, np.pi) + a * S))


def test_phase_residual_removes_what_the_clocks_scramble_even_when_steep():
    rng = np.random.default_rng(0)
    H = multipath()
    ref = phase_residual(raw_from(H))
    for _ in range(50):
        r = phase_residual(raw_from(scramble(H, rng, steep=True)))
        d = np.angle(np.exp(1j * (r - ref)))
        assert np.abs(d).max() < 0.15                    # int8 rounding only


def test_phase_residual_keeps_the_multipath_bend_and_reads_imaginary_first():
    H = multipath()
    truth = np.unwrap(np.angle(H))
    truth -= np.polyval(np.polyfit(S, truth, 1), S)
    assert np.abs(phase_residual(raw_from(H)) - truth).max() < 0.08
    swapped = raw_from(H.imag + 1j * H.real)            # I and Q the wrong way round
    assert np.abs(phase_residual(swapped) - truth).max() > 0.3
    assert phase_residual(b"\0" * 128) is None and phase_residual(b"\1" * 40) is None


def test_the_phase_column_is_calm_under_clock_noise_and_lights_when_the_bend_changes():
    rng = np.random.default_rng(1)
    buf = EyesBuffer()
    H0 = multipath()
    for i in range(400):                                 # 4 s at 100 packets/s
        buf.push_raw(i / RATE, raw_from(scramble(H0, rng) + rng.normal(0, 0.7, SUB) * (1 + 1j)))
    buf.phase_column()
    for i in range(400, 410):
        buf.push_raw(i / RATE, raw_from(scramble(H0, rng) + rng.normal(0, 0.7, SUB) * (1 + 1j)))
    calm = np.abs(buf.phase_column())
    H1 = multipath(gains=(30.0, 14.0, 16.0))              # the third path got stronger: a body
    for i in range(410, 420):
        buf.push_raw(i / RATE, raw_from(scramble(H1, rng) + rng.normal(0, 0.7, SUB) * (1 + 1j)))
    lit = np.abs(buf.phase_column())
    assert np.median(calm) < 1.0
    assert np.median(lit) > 3 * np.median(calm) and lit.max() >= 5.0


# ------------------------------------------------------------------ cost
def test_push_is_cheap_and_allocates_nothing_that_stays():
    buf = EyesBuffer()
    t, A = stream(40.0)
    feed(buf, t[:200], A[:200])
    samples = [Sample(float(t[i]), A[i], False) for i in range(200, 3200)]
    # Best of five batches of 300: the cost itself. One timed batch of 1500 also timed
    # the scheduler, and failed twice in the 10-23 audit with the laptop at 99 % CPU
    # (169 us against 100), the same way the spectrum test below once did.
    per = float("inf")
    for b in range(5):
        t0 = time.perf_counter()
        for s in samples[300 * b:300 * (b + 1)]:
            buf.push(s)
        per = min(per, (time.perf_counter() - t0) / 300)
    tracemalloc.start()                                   # timed apart: tracing slows every call
    before = tracemalloc.take_snapshot()
    for s in samples[1500:]:
        buf.push(s)
    after = tracemalloc.take_snapshot()
    tracemalloc.stop()
    grown = sum(d.size_diff for d in after.compare_to(before, "filename"))
    assert per < 100e-6                                   # ~10-20 us measured; 100 Hz of it is ~0.2 % CPU
    assert grown < 16_000                                 # the ring is preallocated: nothing accumulates


def test_the_spectrum_costs_well_under_two_milliseconds():
    buf = EyesBuffer()
    feed(buf, *stream(10.0, f_hz=1.2, amp=0.02))
    times = []
    for _ in range(30):
        t0 = time.perf_counter()
        buf.spectrum()
        times.append(time.perf_counter() - t0)
    # The best of 30: the cost itself. The median also counts the scheduler, and on this
    # laptop with the owner's app pinning the CPU at 100 % it read 4 ms against 1.0 ms idle.
    assert min(times) < 2e-3


# ------------------------------------------------------------------ engine + server
def _csi(t, channel=6, seed=0):
    rng = np.random.default_rng(seed)
    raw = rng.integers(-30, 30, 128).astype(np.int8).tobytes()
    return CsiPacket(int(t * 1e6), 0, -50, -92, channel, 0, 1, 0, 0, 1, b"\x02\0\0\0\0\x01", raw)


def test_the_engine_builds_the_eyes_message_and_a_channel_change_restarts_it():
    eng = Engine(default_room(), "simulation", baseline=Baseline(1e-5, 2e-5, 240))
    eng.clock = lambda: eng.device_t or 0.0
    assert eng.eyes_message()["column"] is None
    for i in range(800):
        eng.process(_csi(1.0 + i * 0.01, seed=i))
    m = eng.eyes_message()
    assert m["type"] == "eyes" and m["source"] == "simulation"
    assert len(m["column"]) == 51 and len(m["phase_column"]) == 51
    assert m["spectrum"] is not None and len(m["spectrum"]["power"]) == 64
    assert m["seconds"] > 7.0
    json.dumps(m)                                         # it goes over the wire as is
    eng.process(_csi(9.5, channel=11))
    m = eng.eyes_message()
    assert m["column"] is None and m["spectrum"] is None and m["seconds"] < 0.1


class _Hub:
    def __init__(self):
        self.eyes_calls = 0

    def frame(self):
        return {"type": "frame"}

    def status(self):
        return {"type": "status"}

    def heatmap(self, layer="live"):
        return {"type": "heatmap", "layer": layer}

    def room_message(self):
        return {"type": "room"}

    def eyes(self):
        self.eyes_calls += 1
        return {"type": "eyes", "column": [0.0] * 51}


class _Ws:
    def __init__(self):
        self.sent, self.inbox = [], asyncio.Queue()

    async def accept(self):
        pass

    async def receive_text(self):
        msg = await self.inbox.get()
        if msg is None:
            raise RuntimeError("closed")
        return msg

    async def send_text(self, s):
        self.sent.append(json.loads(s)["type"])


def test_only_clients_that_ask_for_eyes_get_them_and_nobody_pays_until_someone_asks():
    async def run():
        hub, streamer = _Hub(), None
        streamer = Streamer(hub)
        a, b = _Ws(), _Ws()
        tasks = [asyncio.create_task(streamer.serve(a)), asyncio.create_task(streamer.serve(b))]
        await asyncio.sleep(0.35)
        assert hub.eyes_calls == 0                         # no viewer asked: never built
        await a.inbox.put(json.dumps({"type": "hello", "want": ["snapshot", "eyes"]}))
        await asyncio.sleep(0.45)
        got_a, got_b = a.sent.count("eyes"), b.sent.count("eyes")
        await a.inbox.put(json.dumps({"type": "hello", "drop": "eyes"}))
        await asyncio.sleep(0.15)
        n = a.sent.count("eyes")
        await asyncio.sleep(0.35)
        after_drop = a.sent.count("eyes") - n
        for ws in (a, b):
            await ws.inbox.put(None)
        await asyncio.gather(*tasks)
        streamer._task.cancel()
        return got_a, got_b, after_drop, b.sent

    got_a, got_b, after_drop, b_sent = asyncio.run(run())
    assert got_a >= 3 and got_b == 0 and after_drop == 0
    assert "frame" in b_sent and "room" in b_sent          # the old protocol, untouched
