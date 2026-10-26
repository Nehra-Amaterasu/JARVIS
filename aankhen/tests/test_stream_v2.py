"""stream.py v2: the level, RSSI and gain per row, immutable hourly .npy with SHA-256 in
the day's manifest, crash behaviour, and v1 hours still readable. All in tmp_path."""
from datetime import datetime

import numpy as np

from aankhen import stream as st
from aankhen.csi import CsiConditioner
from aankhen.protocol import CsiPacket

T0 = datetime(2026, 10, 27, 14, 59, 50).timestamp()


class Clock:
    def __init__(self, t):
        self.t = t

    def __call__(self):
        return self.t


def _pkt(t, rng, gain):
    amp = 40 + rng.normal(0, 2, 64)
    iq = np.zeros(128, np.int8)
    iq[1::2] = np.clip(np.round(amp), -127, 127).astype(np.int8)
    return CsiPacket(int(round(t * 1e6)), 0, -57, -92, 6, 0, 1, 0, 0, 1, b"\x02\0\0\0\0\x01", iq.tobytes(),
                     gain_comp_db=gain)


def test_the_level_rssi_and_gain_are_kept_and_match_the_conditioner(tmp_path):
    rng = np.random.default_rng(0)
    clock = Clock(datetime(2026, 10, 27, 14, 30).timestamp())
    rec = st.StreamRecorder(tmp_path, clock=clock).start()
    cond = CsiConditioner()
    levels = {}
    for k in range(400):                                  # 4 s at 100 Hz, the gain stepping up
        t = 10.0 + k / 100
        p = _pkt(t, rng, 2.0 + (k // 100))
        rec.raw(t, p.raw, p.channel, True, rssi=p.rssi, gain_comp_db=p.gain_comp_db)
        for s in cond.push(t, p.raw, p.rssi, gain_comp_db=p.gain_comp_db):
            rec.sample(s.t, s.amp, s.filled, s.level_db)
            levels.setdefault(st._bin(s.t), []).append(s.level_db)
    rec.stop()
    h = st.load_hour(tmp_path, "2026-10-27", 14)
    assert int(h["version"]) == 2 and h["level_db"].dtype == np.float32
    want = np.array([np.mean(levels[st._bin(t)]) for t in h["t"]])
    assert np.abs(h["level_db"] - want).max() < 1e-3      # the conditioner's level, to 1e-3 dB
    assert set(h["rssi"].tolist()) == {-57}
    assert set(np.round(h["gain_comp_db"], 3).tolist()) <= {2.0, 3.0, 4.0, 5.0}
    assert np.all(np.isfinite(h["ts"]))


def test_without_the_extras_they_are_unknown_not_invented(tmp_path):
    rec = st.StreamRecorder(tmp_path, clock=Clock(T0 - 600), phase=False).start()
    for k in range(200):
        t = 20.0 + k / 100
        rec.raw(t, b"", 6, None)
        rec.sample(t, np.ones(51), False)
    rec.stop()
    h = st.load_hour(tmp_path, "2026-10-27", 14)
    assert np.all(np.isnan(h["level_db"])) and np.all(h["rssi"] == st.RSSI_UNKNOWN)
    assert np.all(np.isnan(h["gain_comp_db"]))


def test_a_crash_mid_hour_claims_only_finished_hours(tmp_path):
    clock = Clock(T0)                                     # 14:59:50
    rec = st.StreamRecorder(tmp_path, clock=clock, phase=False, flush_s=1e9).start()
    t = 100.0
    for sec in range(20):                                 # 10 s in hour 14, 10 s in hour 15
        clock.t = T0 + sec
        for k in range(100):
            rec.raw(t, b"", 6, None)
            rec.sample(t, np.ones(51), False)
            t += 0.01
    rec.stop()
    day = tmp_path / "2026-10-27"
    # killed during hour 15: its rows sit in a part file, and a write died as a .tmp
    (day / "15.part-999.npy.tmp").write_bytes(b"\x93NUMPY half a file")
    man = st.read_manifest(day)
    assert set(man) == {"14.npy"}                         # only the finished hour is claimed
    assert st.verify_day(tmp_path, "2026-10-27") == {"14.npy": True}
    assert len(st.load_hour(tmp_path, "2026-10-27", 15)["t"]) > 150   # the part is still read
    # a corrupted claimed hour is caught by its hash
    raw = bytearray((day / "14.npy").read_bytes())
    raw[-1] ^= 0xFF
    (day / "14.npy").write_bytes(bytes(raw))
    assert st.verify_day(tmp_path, "2026-10-27") == {"14.npy": False}


def test_an_hour_is_memory_mapped_and_a_window_is_a_slice(tmp_path):
    clock = Clock(T0 - 3600)
    rec = st.StreamRecorder(tmp_path, clock=clock, phase=False).start()
    for k in range(1000):
        t = 5.0 + k / 100
        rec.raw(t, b"", 6, None)
        rec.sample(t, np.full(51, float(k % 7)), False)
    rec.stop()
    st.merge_hour(tmp_path / "2026-10-27", 13)
    rows = st.hour_rows(tmp_path, "2026-10-27", 13)
    assert isinstance(rows, np.memmap) and rows["amp"][40:80].shape == (40, 51)


def test_v1_hours_are_still_read(tmp_path):
    day = tmp_path / "2026-10-20"
    day.mkdir()
    n = 60
    st._save(day / "09.npz", {"t": np.arange(n) / 20.0, "amp": np.ones((n, 51), np.float16),
                              "real": np.full(n, 5, np.uint8), "n_raw": np.zeros(n, np.uint8),
                              "meta_t": np.arange(3.0), "meta_ts": np.full(3, 1.0), "channel": np.full(3, 6, np.int16),
                              "fan": np.zeros(3, np.int8), "zone": np.full(3, -1, np.int8),
                              "occupied_p": np.zeros(3, np.float16), "activity": np.full(3, -1, np.int8),
                              "version": np.array(1)})
    h = st.load_hour(tmp_path, "2026-10-20", 9)
    assert len(h["t"]) == n and int(h["version"]) == 1 and "level_db" not in h
    assert st.usage(tmp_path, datetime(2026, 10, 20).date())["days"] == 1
