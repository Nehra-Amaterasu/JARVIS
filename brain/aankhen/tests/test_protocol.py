"""Protocol tests — the foundation everything else trusts.

If framing is wrong, every number downstream is wrong in a way that still looks
plausible. These tests pin the exact behaviour the firmware must match.
"""
import os
import random
import struct

import pytest

from aankhen.protocol import (
    CRC_SIZE, HEADER_SIZE, MAX_PAYLOAD, SYNC, CsiPacket, Frame, FrameType,
    StreamDecoder, crc16_ccitt, crc16_ccitt_reference, decode_packet,
)


def _csi(seq=0, n=64, ts=1_000_000):
    raw = bytes((i * 7 + seq) & 0xFF for i in range(n * 2))
    return CsiPacket(ts, seq, rssi=-52, noise_floor=-92, channel=6,
                     secondary_channel=0, sig_mode=1, cwb=0, stbc=0,
                     first_word_invalid=0, mac=b"\x11\x22\x33\x44\x55\x66", raw=raw)


# ------------------------------------------------------------------ CRC
def test_crc_matches_standard_check_value():
    # The published check value for CRC-16/CCITT-FALSE. The C firmware is tested
    # against the same constant, which is what keeps both sides in agreement.
    assert crc16_ccitt(b"123456789") == 0x29B1


def test_crc_empty_is_init_value():
    assert crc16_ccitt(b"") == 0xFFFF


def test_fast_crc_equals_the_reference_the_firmware_ports():
    rnd = random.Random(4)
    for _ in range(500):
        data = bytes(rnd.randrange(256) for _ in range(rnd.randrange(0, 300)))
        init = rnd.randrange(0x10000)
        assert crc16_ccitt(data, init) == crc16_ccitt_reference(data, init)


def test_header_size_is_16():
    assert HEADER_SIZE == 16


# ------------------------------------------------------------- round trip
def test_csi_packet_round_trip():
    p = _csi(seq=42)
    frames = list(StreamDecoder().feed(p.to_frame().encode()))
    assert len(frames) == 1
    q = decode_packet(frames[0])
    assert isinstance(q, CsiPacket)
    assert (q.seq, q.rssi, q.channel, q.mac, q.raw) == (42, -52, 6, p.mac, p.raw)
    assert q.n_subcarriers == 64


def test_signed_rssi_survives_encoding():
    p = _csi()
    p.rssi = -127
    q = decode_packet(next(StreamDecoder().feed(p.to_frame().encode())))
    assert q.rssi == -127


def test_oversized_payload_is_refused_on_encode():
    with pytest.raises(ValueError):
        Frame(FrameType.LOG, 0, 0, b"x" * (MAX_PAYLOAD + 1)).encode()


# ---------------------------------------------- real serial behaviour
def test_frames_split_across_arbitrary_reads():
    """Serial reads cut frames anywhere. Byte-at-a-time is the worst case."""
    stream = b"".join(_csi(seq=i).to_frame().encode() for i in range(20))
    dec = StreamDecoder()
    got = []
    for b in stream:
        got.extend(dec.feed(bytes([b])))
    assert [decode_packet(f).seq for f in got] == list(range(20))
    assert dec.stats.crc_errors == 0


def test_joining_mid_frame_resynchronises():
    """Opening the port while the board is mid-transmission must not lose sync."""
    stream = b"".join(_csi(seq=i).to_frame().encode() for i in range(10))
    cut = 37                                   # somewhere inside frame 0
    dec = StreamDecoder()
    got = list(dec.feed(stream[cut:]))
    assert [decode_packet(f).seq for f in got] == list(range(1, 10))


def test_corrupted_byte_drops_only_that_frame():
    frames = [_csi(seq=i).to_frame().encode() for i in range(5)]
    bad = bytearray(frames[2])
    bad[HEADER_SIZE + 10] ^= 0xFF               # flip bits inside the payload
    frames[2] = bytes(bad)
    dec = StreamDecoder()
    got = list(dec.feed(b"".join(frames)))
    assert [decode_packet(f).seq for f in got] == [0, 1, 3, 4]
    assert dec.stats.crc_errors >= 1


def test_corrupted_length_field_does_not_swallow_following_frames():
    """A garbage LENGTH must not make the decoder skip valid frames after it."""
    frames = [_csi(seq=i).to_frame().encode() for i in range(5)]
    bad = bytearray(frames[1])
    struct.pack_into("<H", bad, 4, 1500)       # plausible-looking but wrong length
    dec = StreamDecoder()
    got = list(dec.feed(b"".join(frames[:1] + [bytes(bad)] + frames[2:])))
    assert [decode_packet(f).seq for f in got] == [0, 2, 3, 4]


def test_in_range_corrupted_length_recovers_on_flush():
    """LENGTH corrupted to a value still legal for CSI (400 B): the decoder can't
    know it's wrong until the CRC fails. At end of a recording, flush() must still
    recover the frames that follow."""
    frames = [_csi(seq=i).to_frame().encode() for i in range(5)]
    bad = bytearray(frames[1])
    struct.pack_into("<H", bad, 4, 400)
    dec = StreamDecoder()
    got = list(dec.feed(b"".join(frames[:1] + [bytes(bad)] + frames[2:])))
    got += list(dec.flush())
    assert [decode_packet(f).seq for f in got] == [0, 2, 3, 4]


def test_radar_length_must_be_exactly_small():
    # An LD2450 frame is 30 bytes; a RADAR header claiming 500 is corruption.
    f = Frame(FrameType.RADAR, 0, 0, b"\x00" * 30).encode()
    bad = bytearray(f)
    struct.pack_into("<H", bad, 4, 500)
    dec = StreamDecoder()
    list(dec.feed(bytes(bad)))
    assert dec.stats.bad_headers >= 1


def test_random_noise_between_frames():
    rng = random.Random(7)
    parts = []
    for i in range(30):
        parts.append(bytes(rng.randrange(256) for _ in range(rng.randrange(0, 40))))
        parts.append(_csi(seq=i).to_frame().encode())
    dec = StreamDecoder()
    got = list(dec.feed(b"".join(parts)))
    assert [decode_packet(f).seq for f in got] == list(range(30))


def test_noise_containing_fake_sync_bytes_is_rejected():
    junk = SYNC + bytes([1, 1, 10, 0, 0, 0]) + os.urandom(30)
    dec = StreamDecoder()
    got = list(dec.feed(junk + _csi(seq=9).to_frame().encode()))
    assert [decode_packet(f).seq for f in got] == [9]


# ------------------------------------------------------- loss accounting
def test_sequence_gaps_are_counted_as_loss():
    dec = StreamDecoder()
    for s in [0, 1, 2, 6, 7]:                    # 3, 4, 5 never arrive
        list(dec.feed(_csi(seq=s).to_frame().encode()))
    assert dec.stats.seq_gaps[FrameType.CSI] == 3
    assert dec.stats.frames_lost == 3
    assert abs(dec.stats.loss_ratio() - 3 / 8) < 1e-9


def test_sequence_wraparound_is_not_loss():
    dec = StreamDecoder()
    for s in [65534, 65535, 0, 1]:
        list(dec.feed(_csi(seq=s).to_frame().encode()))
    assert dec.stats.frames_lost == 0


def test_device_reboot_is_not_counted_as_huge_loss():
    dec = StreamDecoder()
    for s in [5000, 5001, 0, 1]:                 # board restarted
        list(dec.feed(_csi(seq=s).to_frame().encode()))
    assert dec.stats.frames_lost == 0


def test_status_frame_parses_json():
    f = Frame(FrameType.STATUS, 1, 5, b'{"wifi": true, "csi_hz": 98.5}')
    p = decode_packet(next(StreamDecoder().feed(f.encode())))
    assert p.fields == {"wifi": True, "csi_hz": 98.5}


def test_frame_size_overhead():
    # Budget check behind the protocol choice: 64-subcarrier CSI at 100 Hz must
    # fit comfortably inside 921,600 baud (~92 KB/s).
    size = len(_csi(n=64).to_frame().encode())
    assert size == HEADER_SIZE + 16 + 128 + CRC_SIZE
    assert size * 100 < 92_000 * 0.5
