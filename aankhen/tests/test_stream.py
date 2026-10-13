"""The rolling raw-stream recorder (stream.py) and the lock-free frame (engine.publish_frame).

Everything here writes to pytest's tmp_path: never the real data/aankhen/stream.
"""
import asyncio
import threading
import time
from datetime import datetime
from pathlib import Path

import numpy as np
import pytest

from aankhen import hub as hub_mod
from aankhen import learn
from aankhen import stream as st
from aankhen.engine import Engine, run_engine
from aankhen.hub import AankhenHub
from aankhen.motion import Baseline
from aankhen.protocol import CsiPacket, StatusPacket
from aankhen.room import default_room

from .fakeserial import FakeBoard, FakeUsb

T0 = datetime(2026, 10, 13, 14, 30, 0).timestamp()      # host clock for the tests: 14:30


class Clock:
    def __init__(self, t):
        self.t = t

    def __call__(self):
        return self.t


def _csi(t, channel=6, seed=0):
    rng = np.random.default_rng(seed)
    raw = rng.integers(-30, 30, 128).astype(np.int8).tobytes()
    return CsiPacket(int(t * 1e6), 0, -50, -92, channel, 0, 1, 0, 0, 1, b"\x02\0\0\0\0\x01", raw)


def _status(t, fan):
    return StatusPacket(int(t * 1e6), 0, {"fw": "test", "relays": {"light": False, "fan": fan}})


def _engine():
    eng = Engine(default_room(), "hardware", baseline=Baseline(1e-5, 2e-5, 240))
    eng.clock = lambda: eng.device_t or 0.0
    return eng


def _wait(cond, timeout=10.0):
    end = time.monotonic() + timeout
    while time.monotonic() < end:
        if cond():
            return True
        time.sleep(0.02)
    return cond()


def _feed(eng, seconds, start=10.0, hz=100):
    for k in range(int(seconds * hz)):
        eng.process(_csi(start + k / hz, seed=k))


# ------------------------------------------------------------------ chunks
def test_synthetic_packets_become_an_hour_chunk_with_rows_at_20_hz(tmp_path):
    clock = Clock(T0)
    rec = st.StreamRecorder(tmp_path, clock=clock).start()
    eng = _engine()
    eng.tap = rec
    eng.process(_status(9.5, True))
    _feed(eng, 10.0)
    rec.stop()
    parts = sorted((tmp_path / "2026-10-13").glob("14.part-*.npz"))
    assert len(parts) == 1                               # stopping writes one small part
    h = st.load_hour(tmp_path, "2026-10-13", 14)
    n = len(h["t"])
    assert 190 <= n <= 201                               # 10 s at 20 Hz (Hampel warm-up eats a few)
    assert np.allclose(np.diff(h["t"]), 0.05)
    assert h["amp"].shape == (n, 51) and h["amp"].dtype == np.float16
    assert h["phase"].shape == (n, 51) and h["phase"].dtype == np.float16
    assert np.isfinite(h["phase"].astype(float)).mean() > 0.9
    assert np.all(np.abs(h["phase"][np.isfinite(h["phase"])]) <= np.pi + 1e-2)
    assert set(np.unique(h["real"])) <= {0, 1, 2, 3, 4, 5} and h["real"].max() == 5
    # 1 Hz weak labels: timestamps, channel, fan relay, the learned estimate (none here)
    assert 9 <= len(h["meta_t"]) <= 11
    assert np.all(h["channel"] == 6) and np.all(h["fan"] == 1)
    assert np.all(h["zone"] == -1) and np.all(h["activity"] == -1)
    assert np.allclose(h["meta_ts"], T0)
    assert str(h["source"]) == "hardware" and int(h["rate_hz"]) == 20
    assert list(h["zones"]) == learn.CLASSES and list(h["activities"]) == learn.ACTIVITIES
    assert rec.info()["rows"] == n and rec.info()["drops"] == 0


def test_the_learned_estimate_and_phase_off(tmp_path):
    rec = st.StreamRecorder(tmp_path, clock=Clock(T0), phase=False).start()
    for k in range(300):                                 # 3 s, straight into the recorder
        t = 20.0 + k / 100
        rec.raw(t, _csi(t, seed=k).raw, 11, False)
        rec.sample(t, np.full(51, 1.0 + k % 5), filled=False)
        if k % 50 == 0:
            rec.learned(t, "desk", 0.9, "typing")
    rec.stop()
    h = st.load_hour(tmp_path, "2026-10-13", 14)
    assert "phase" not in h
    assert np.allclose(h["amp"][:-1], 3.0)               # 1..5 averaged: the boxcar
    assert set(h["zone"]) == {learn.CLASSES.index("desk")}
    assert set(h["activity"]) == {learn.ACTIVITIES.index("typing")}
    assert np.all(h["channel"] == 11) and np.all(h["fan"] == 0)
    assert np.allclose(h["occupied_p"].astype(float), 0.9, atol=1e-3)


def test_an_hour_that_ends_is_merged_into_hh_npz(tmp_path):
    clock = Clock(datetime(2026, 10, 13, 14, 59, 58).timestamp())
    rec = st.StreamRecorder(tmp_path, clock=clock, phase=False).start()
    t = 100.0
    for k in range(200):                                 # 2 s in hour 14
        rec.raw(t, b"", 6, None)
        rec.sample(t, np.ones(51), False)
        t += 0.01
    assert _wait(lambda: not rec._q)
    clock.t += 4                                         # 15:00:02
    for k in range(200):
        rec.raw(t, b"", 6, None)
        rec.sample(t, np.ones(51), False)
        t += 0.01
    rec.stop()
    day = tmp_path / "2026-10-13"
    assert (day / "14.npz").exists() and not list(day.glob("14.part-*"))
    assert list(day.glob("15.part-*.npz"))               # the current hour waits for its end
    a, b = st.load_hour(tmp_path, "2026-10-13", 14), st.load_hour(tmp_path, "2026-10-13", 15)
    assert len(a["t"]) == 40 and len(b["t"]) == 40          # 2 s each side of 15:00, at 20 Hz
    # a new session merges what an earlier one left of any hour, the current one too
    st.StreamRecorder(tmp_path, clock=clock).start().stop()
    assert (day / "15.npz").exists() and not list(day.glob("15.part-*"))
    assert len(st.load_hour(tmp_path, "2026-10-13", 15)["t"]) == len(b["t"])
    # an interrupted merge (HH.npz written, a part not yet deleted) is not counted twice
    part = day / "15.part-1.npz"
    st._save(part, st._read(day / "15.npz"))
    x = st._read(day / "15.npz")
    x["parts"] = np.array(sorted(set(x["parts"].tolist()) | {part.name}))
    st._save(day / "15.npz", x)
    assert len(st.load_hour(tmp_path, "2026-10-13", 15)["t"]) == len(b["t"])
    st.merge_hour(day, 15)
    assert not part.exists() and len(st.load_hour(tmp_path, "2026-10-13", 15)["t"]) == len(b["t"])


# ------------------------------------------------------------------ retention
def test_retention_deletes_hours_older_than_7_days(tmp_path):
    def touch(day, name):
        (tmp_path / day).mkdir(exist_ok=True)
        (tmp_path / day / name).write_bytes(b"x" * 1000)
    touch("2026-10-01", "05.npz")                         # long gone
    touch("2026-10-06", "10.npz")                         # ended 11:00, 7 days + 1 h ago
    touch("2026-10-06", "11.part-1.npz")                  # ended 12:00: older than the cutoff
    touch("2026-10-06", "12.npz")                         # ends 13:00: still inside the week
    touch("2026-10-06", "notes.txt")                      # not ours: never touched
    touch("2026-10-13", "09.npz")
    (tmp_path / "unrelated").mkdir()
    now = datetime(2026, 10, 13, 12, 30).timestamp()
    assert st.prune(tmp_path, now) == 3
    assert not (tmp_path / "2026-10-01").exists()
    assert sorted(p.name for p in (tmp_path / "2026-10-06").iterdir()) == ["12.npz", "notes.txt"]
    assert (tmp_path / "2026-10-13" / "09.npz").exists() and (tmp_path / "unrelated").exists()
    u = st.usage(tmp_path, datetime(2026, 10, 13).date())
    assert u["days"] == 2 and u["today_mb"] == 0.0 and u["total_mb"] == 0.0   # 2 kB rounds to 0.0 MB
    # the recorder prunes when it starts
    touch("2026-10-02", "07.npz")
    rec = st.StreamRecorder(tmp_path, clock=Clock(now)).start()
    rec.stop()
    assert not (tmp_path / "2026-10-02").exists()
    assert rec.info()["days_kept"] == 2


# ------------------------------------------------------------------ only the real board
def test_only_the_real_board_is_recorded():
    for kind in ("simulation", "replay", "unknown"):
        with pytest.raises(ValueError):
            st.StreamRecorder("unused", source_kind=kind)


@pytest.fixture
def scratch_hub(tmp_path, monkeypatch):
    """A hub whose data folder is tmp_path: no layout, baseline or model of the real room."""
    monkeypatch.setattr(hub_mod, "DATA_DIR", str(tmp_path))
    monkeypatch.setattr(hub_mod, "BASELINE_FILE", str(tmp_path / "baseline.json"))
    monkeypatch.setattr(hub_mod, "BASELINE_FAN_FILE", str(tmp_path / "baseline_fan.json"))
    monkeypatch.setattr(learn.SpatialModel, "load", staticmethod(lambda *a, **k: None))
    monkeypatch.setattr(learn.ActivityModel, "load", staticmethod(lambda *a, **k: None))
    hubs = []

    def make(**kw):
        h = AankhenHub(room=default_room(), **kw)
        hubs.append(h)
        return h
    yield make
    for h in hubs:
        h.stop()


def test_a_simulation_is_never_recorded(scratch_hub, tmp_path, monkeypatch):
    monkeypatch.setenv("AANKHEN_STREAM", "1")            # on, and still nothing is written
    hub = scratch_hub()
    hub._sim_baseline = Baseline(1e-5, 2e-5, 240)     # skip the 4 s simulated calibration
    hub.start("simulation", scenario="evening")
    assert _wait(lambda: hub.engine.counters["csi_packets"] > 50)
    assert hub.stream is None and hub.engine.tap is None
    info = hub.info()["stream"]
    assert info["on"] is False and "simulation is never recorded" in info["note"]
    hub.stop()
    assert not (tmp_path / "stream").exists() or not any((tmp_path / "stream").rglob("*.npz"))


def test_the_real_board_is_recorded_unless_switched_off(scratch_hub, tmp_path, monkeypatch):
    monkeypatch.setenv("AANKHEN_STREAM", "1")            # conftest turns it off for every other test
    usb = FakeUsb(FakeBoard("COM7", "esp32", talks_at=time.monotonic(), period_s=0.2))
    hub = scratch_hub(boards=usb.finder(window_s=0.5))
    hub.start("hardware")
    assert hub.stream is not None and hub.engine.tap is hub.stream
    info = hub.info()["stream"]
    assert info["on"] is True and info["enabled"] is True
    assert {"today_mb", "days_kept", "drops"} <= set(info)
    hub.stop()
    assert hub.stream is None
    monkeypatch.setenv("AANKHEN_STREAM", "0")
    hub.start("hardware")
    assert hub.stream is None and hub.engine.tap is None
    assert hub.info()["stream"]["note"] == "off (AANKHEN_STREAM=0)"


# ------------------------------------------------------------------ never in the engine's way
def test_a_stalled_writer_never_blocks_the_engine(tmp_path):
    rec = st.StreamRecorder(tmp_path, clock=Clock(T0), queue_max=500)
    release = threading.Event()
    handle = rec._handle
    rec._handle = lambda item: (release.wait(), handle(item))   # a disk that hangs
    rec.start()
    eng = _engine()
    eng.tap = rec
    worst, t0 = 0.0, time.perf_counter()
    for k in range(3000):                                # 30 s of packets at 100 Hz
        s = time.perf_counter()
        eng.process(_csi(10.0 + k / 100, seed=k))
        worst = max(worst, time.perf_counter() - s)
    total = time.perf_counter() - t0
    assert len(rec._q) <= 500                            # bounded memory
    assert rec.info()["drops"] > 3000                    # dropped and counted, not waited for
    assert rec.dropped["raw"] > 2000 and rec.dropped["sample"] > 0
    # with the recorder stalled the engine runs as fast as without one
    eng2 = _engine()
    t1 = time.perf_counter()
    for k in range(3000):
        eng2.process(_csi(10.0 + k / 100, seed=k))
    alone = time.perf_counter() - t1
    assert total < 2.0 * alone + 0.5, (total, alone)
    assert worst < 0.5, worst
    release.set()
    rec.stop()
    assert not rec.running


# ------------------------------------------------------------------ the published frame
def test_viewers_read_the_published_frame_without_the_engine_lock():
    eng = _engine()
    assert eng.latest_frame()["type"] == "frame"         # nothing published: built fresh
    _feed(eng, 1.0)
    eng.publish_frame(force=True)
    seq = eng._frame["seq"]
    held, done = threading.Event(), threading.Event()

    def hold():
        with eng.lock:
            held.set()
            done.wait(5)
    th = threading.Thread(target=hold)
    th.start()
    held.wait(5)
    s = time.perf_counter()
    f = eng.latest_frame()                               # the lock is held by someone else
    took = time.perf_counter() - s
    done.set()
    th.join()
    assert took < 0.05 and f["seq"] == seq
    f["truth"] = []                                      # a caller's key stays its own
    assert "truth" not in eng._frame
    eng.publish_frame()                                  # within FRAME_EVERY_S: not rebuilt
    assert eng._frame["seq"] == seq


def test_the_consumer_publishes_frames_at_20_hz():
    import queue

    class Src:
        packets = queue.Queue()
    eng = Engine(default_room(), "hardware", baseline=Baseline(1e-5, 2e-5, 240))
    stop = threading.Event()
    th = threading.Thread(target=run_engine, args=(Src, eng, stop), daemon=True)
    th.start()
    t = 10.0
    t_end = time.monotonic() + 1.0
    while time.monotonic() < t_end:
        Src.packets.put(_csi(t))
        t += 0.01
        time.sleep(0.005)
    stop.set()
    th.join(2)
    assert 12 <= eng.seq <= 24                           # ~20 builds in 1 s, not one per packet
    assert eng._frame is not None and eng._frame["t"] > 10.0


def test_the_streamer_keeps_10_hz_when_a_tick_takes_time():
    from aankhen.server import Streamer

    class SlowHub:
        def frame(self):
            time.sleep(0.03)                             # 30 ms of work every tick
            return {"type": "frame"}

        def status(self):
            return None

        def heatmap(self, layer):
            return None

    class Client:
        layer, wants = "live", set()

        def __init__(self):
            self.n = 0

        def offer(self, msg):
            self.n += msg is not None

    async def run():
        s = Streamer(SlowHub())
        c = Client()
        s.clients.add(c)
        s.ensure_running()
        await asyncio.sleep(2.0)
        s._task.cancel()
        return c.n
    n = asyncio.run(run())
    assert n >= 18, n                                    # sleep-after-work gave 1/0.13 s = 7.7 Hz
