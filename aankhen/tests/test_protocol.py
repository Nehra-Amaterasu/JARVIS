"""Protocol tests — the foundation everything else trusts.

If framing is wrong, every number downstream is wrong in a way that still looks
plausible. These tests pin the exact behaviour the firmware must match.
"""
import os
import random
import re
import struct

import pytest

from aankhen.protocol import (
    CRC_SIZE, CSI_LINK_HEAD_SIZE, HEADER_SIZE, LINK_PHONE, MAX_PAYLOAD, MAX_PAYLOAD_BY_TYPE,
    SYNC, CsiLinkPacket, CsiPacket, Frame, FrameType, StreamDecoder, crc16_ccitt,
    crc16_ccitt_reference, decode_packet,
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


# ------------------------------------------------------ CSI_LINK (0x08)
PHONE_MAC = b"\x02\x00\x00\x00\x00\x02"         # locally administered, like a private address


def _link(seq=0, n=64, ts=2_000_000, link=LINK_PHONE, comp=-3.5):
    raw = bytes((i * 11 + seq) & 0xFF for i in range(n * 2))
    return CsiLinkPacket(link, ts, seq, rssi=-71, noise_floor=-95, channel=6,
                         secondary_channel=0, sig_mode=1, cwb=0, stbc=0,
                         first_word_invalid=0, mac=PHONE_MAC, raw=raw,
                         agc_gain=30, fft_gain=-4, gain_comp_db=comp)


def test_csi_link_round_trip():
    p = _link(seq=7)
    f = p.to_frame()
    assert f.type == FrameType.CSI_LINK == 0x08
    assert len(f.payload) == CSI_LINK_HEAD_SIZE + 128 == 149
    q = decode_packet(next(StreamDecoder().feed(f.encode())))
    assert isinstance(q, CsiLinkPacket) and not isinstance(q, CsiPacket)
    assert q == p                                  # every field, the link id and signed values included
    assert q.has_gain and q.n_subcarriers == 64


def test_csi_link_without_the_gain_library_carries_an_unknown_gain():
    p = _link(comp=None)
    p.agc_gain = p.fft_gain = None
    q = decode_packet(next(StreamDecoder().feed(p.to_frame().encode())))
    assert q.gain_comp_db is None and not q.has_gain
    assert (q.agc_gain, q.fft_gain) == (0, 0)      # the block is always there, zeroed


def test_csi_link_limits_match_the_firmware_layout():
    assert CSI_LINK_HEAD_SIZE == 21                # sizeof(ak_csi_link_head_t)
    assert MAX_PAYLOAD_BY_TYPE[0x08] == 21 + 640   # + AK_MAX_CSI_BYTES


def test_firmware_header_agrees_with_frame_types():
    """aankhen_protocol.h and this module are one contract: every AK_ type there must
    be the same number here, and the CSI_LINK head the same size."""
    h = open(os.path.join(os.path.dirname(__file__), "..", "firmware", "aankhen_protocol.h"),
             encoding="utf-8").read()
    enum = h[h.index("typedef enum"):h.index("} ak_type_t;")]
    c_types = {m.group(1): int(m.group(2), 16) for m in re.finditer(r"AK_(\w+)\s*=\s*0x([0-9A-Fa-f]+)", enum)}
    assert c_types["CSI_LINK"] == 0x08
    for name, value in c_types.items():
        assert FrameType[name] == value, name
    assert "sizeof(ak_csi_link_head_t) == 21" in h
    max_csi = int(re.search(r"#define AK_MAX_CSI_BYTES (\d+)", h).group(1))
    assert MAX_PAYLOAD_BY_TYPE[0x08] == CSI_LINK_HEAD_SIZE + max_csi
    assert re.search(r"#define AK_LINK_PHONE (\d+)", h).group(1) == str(LINK_PHONE)


def _mixed_stream(n=40):
    """Every frame type the board sends, interleaved, each with its own sequence."""
    rng = random.Random(3)
    out, expect = [], []
    for i in range(n):
        frames = [_csi(seq=i).to_frame(), _link(seq=i).to_frame(),
                  Frame(FrameType.RADAR, i, i, bytes(30))]
        g = _csi(seq=i)
        g.agc_gain, g.gain_comp_db = 20, 1.25
        frames.append(g.to_frame())
        if i % 5 == 0:
            frames.append(Frame(FrameType.STATUS, i // 5, i, b'{"beacon": {"ip": null}}'))
            frames.append(Frame(FrameType.LOG, i // 5, i, b"link 2: phone found"))
        if i % 7 == 0:
            frames.append(_link(seq=i, link=3).to_frame())
        rng.shuffle(frames)
        out += frames
    return out


def test_decoder_stays_in_sync_across_mixed_frame_types():
    frames = _mixed_stream()
    stream = b"".join(f.encode() for f in frames)
    for chunking in ("bytes", "random"):
        dec, got = StreamDecoder(), []
        if chunking == "bytes":
            for b in stream:
                got.extend(dec.feed(bytes([b])))
        else:
            rng, i = random.Random(9), 0
            while i < len(stream):
                k = rng.randrange(1, 300)
                got.extend(dec.feed(stream[i:i + k]))
                i += k
        assert [(f.type, f.seq, f.payload) for f in got] == [(f.type, f.seq, f.payload) for f in frames]
        s = dec.stats
        assert (s.crc_errors, s.bad_headers, s.bytes_skipped) == (0, 0, 0)
    links = [decode_packet(f) for f in got if f.type == FrameType.CSI_LINK]
    assert all(isinstance(p, CsiLinkPacket) for p in links)
    assert {p.link for p in links} == {2, 3}


def test_a_host_without_csi_link_reads_it_as_corruption(monkeypatch):
    """Why the host must be updated BEFORE firmware 3.3.0 is flashed: a decoder that
    does not know 0x08 counts every link-2 frame as a corrupted header and skips it
    byte by byte. It keeps link 1 (resync works), but the link panel fills with junk."""
    import aankhen.protocol as proto
    old = {k: v for k, v in proto.MAX_PAYLOAD_BY_TYPE.items() if k != 0x08}
    monkeypatch.setattr(proto, "MAX_PAYLOAD_BY_TYPE", old)
    frames = _mixed_stream(10)
    dec = StreamDecoder()
    got = list(dec.feed(b"".join(f.encode() for f in frames))) + list(dec.flush())
    assert [f.seq for f in got if f.type == FrameType.CSI] == list(range(10))
    assert not any(f.type == FrameType.CSI_LINK for f in got)
    assert dec.stats.bad_headers > 0 and dec.stats.bytes_skipped > 0


def test_truncated_csi_link_is_a_bad_frame_not_a_crash():
    p = _link()
    f = p.to_frame()
    short = Frame(FrameType.CSI_LINK, 0, 0, f.payload[:CSI_LINK_HEAD_SIZE - 1])
    with pytest.raises(ValueError):
        decode_packet(short)
    cut = Frame(FrameType.CSI_LINK, 0, 0, f.payload[:-10])   # head says 128, 118 follow
    with pytest.raises(ValueError):
        decode_packet(cut)


def test_frame_size_overhead():
    # Budget check behind the protocol choice: 64-subcarrier CSI at 100 Hz must
    # fit comfortably inside 921,600 baud (~92 KB/s).
    size = len(_csi(n=64).to_frame().encode())
    assert size == HEADER_SIZE + 16 + 128 + CRC_SIZE
    assert size * 100 < 92_000 * 0.5
