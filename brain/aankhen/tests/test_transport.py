"""Transport tests: recording, replay, and the source contract — no hardware."""
import time

from aankhen.protocol import CsiPacket, FrameType
from aankhen.transport import (
    CallbackSource, ReplaySource, Recorder, iter_recording, list_candidate_ports,
    read_recording_meta,
)


def _frames(n):
    for i in range(n):
        yield CsiPacket(i * 10_000, i, -50, -92, 6, 0, 1, 0, 0, 0, b"\x01" * 6,
                        bytes(128)).to_frame().encode()


def _drain(src, expect, timeout=5.0):
    got, t0 = [], time.time()
    while len(got) < expect and time.time() - t0 < timeout:
        try:
            got.append(src.packets.get(timeout=0.2))
        except Exception:
            pass
    return got


def test_recording_round_trip(tmp_path):
    path = str(tmp_path / "r.akr")
    rec = Recorder(path, {"note": "unit test"})
    blobs = list(_frames(25))
    for i, b in enumerate(blobs):
        rec.write(b, 1000.0 + i * 0.01)
    rec.close()
    assert read_recording_meta(path)["note"] == "unit test"
    chunks = list(iter_recording(path))
    assert len(chunks) == 25 and chunks[0][0] == 1000.0
    assert b"".join(d for _, d in chunks) == b"".join(blobs)


def test_replay_source_delivers_every_frame_in_order(tmp_path):
    path = str(tmp_path / "r.akr")
    rec = Recorder(path, {})
    stream = b"".join(_frames(50))
    # Write in awkward chunk sizes, as a real serial port would deliver them.
    for i in range(0, len(stream), 37):
        rec.write(stream[i:i + 37], 1000.0 + i * 1e-4)
    rec.close()
    src = ReplaySource(path, speed=0).start()
    got = _drain(src, 50)
    src.stop()
    assert [p.seq for p in got] == list(range(50))
    assert src.kind == "replay"
    assert src.decoder.stats.frames_lost == 0


def test_truncated_recording_does_not_crash(tmp_path):
    path = str(tmp_path / "r.akr")
    rec = Recorder(path, {})
    for b in _frames(10):
        rec.write(b, 1.0)
    rec.close()
    with open(path, "r+b") as f:
        f.seek(0, 2)
        f.truncate(f.tell() - 50)               # cut mid-chunk, like a crash
    src = ReplaySource(path, speed=0).start()
    got = _drain(src, 9)
    src.stop()
    assert len(got) == 9


def test_callback_source_tags_kind():
    src = CallbackSource(lambda: iter(list(_frames(5))), kind="simulation").start()
    got = _drain(src, 5)
    src.stop()
    assert len(got) == 5 and src.kind == "simulation"


def test_recording_while_streaming(tmp_path):
    path = str(tmp_path / "live.akr")
    src = CallbackSource(lambda: iter(list(_frames(20))))
    src.record_to(path, {"room": "test"})
    src.start()
    _drain(src, 20)
    src.stop()
    assert len(list(iter_recording(path))) == 20


def test_port_listing_does_not_crash_without_hardware():
    # On a machine with only Bluetooth serial ports this must return [] quickly.
    assert isinstance(list_candidate_ports(), list)
