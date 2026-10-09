"""Aankhen wire protocol — the binary framing between the ESP32-S3 and the host.

WHY BINARY, NOT JSON
The first firmware printed JSON lines at 115,200 baud. Raw Wi-Fi CSI at 100 Hz is
~128-384 bytes of samples per packet plus metadata, i.e. 17-42 KB/s. A 115,200-baud
UART carries ~11.5 KB/s. The link physically could not carry the data, so the old
firmware sent derived numbers instead of the measurements — and once you only send
derived numbers, nothing downstream can check them.

This protocol carries the raw CSI buffer, compactly, with three guarantees:
  1. SYNC bytes   -> the host can join a stream mid-frame and resynchronise.
  2. SEQ numbers  -> dropped frames are COUNTED, never silently absorbed.
  3. CRC-16       -> a corrupted frame is rejected, instead of being decoded into
                     garbage that looks exactly like motion.

FRAME LAYOUT (all little-endian)

  offset size field
  0      2    SYNC        0xAA 0x55
  2      1    VERSION     PROTOCOL_VERSION
  3      1    TYPE        FrameType
  4      2    LENGTH      payload length in bytes (<= MAX_PAYLOAD)
  6      2    SEQ         per-type sequence number, wraps at 65536
  8      8    TIMESTAMP   device microseconds since boot (esp_timer_get_time)
  16     N    PAYLOAD
  16+N   2    CRC16       CRC-16/CCITT-FALSE over bytes [2 .. 16+N) — everything
                          after SYNC and before the CRC itself

The C side of this contract lives in aankhen_esp32_firmware/aankhen_protocol.h.
Both sides MUST change together; bump PROTOCOL_VERSION when they do.
"""
from __future__ import annotations

import enum
import json
import struct
from dataclasses import dataclass, field
from typing import Iterator, Optional

PROTOCOL_VERSION = 1
SYNC = b"\xAA\x55"
HEADER_FMT = "<2sBBHHQ"            # sync, version, type, length, seq, timestamp_us
HEADER_SIZE = struct.calcsize(HEADER_FMT)   # 16
CRC_SIZE = 2
MAX_PAYLOAD = 2048                 # largest legitimate frame is ~400 B; anything
                                   # bigger is a corrupted LENGTH field, not data


class FrameType(enum.IntEnum):
    CSI = 0x01           # one Wi-Fi CSI capture
    RADAR = 0x02         # one raw HLK-LD2450 frame, forwarded byte-for-byte
    STATUS = 0x03        # 1 Hz device health, JSON text payload
    LOG = 0x04           # free-text log line from the firmware
    RSSI = 0x05          # RSSI-only sample (fallback when CSI is unavailable)
    COMMAND = 0x06       # host -> device, JSON: {"relay": "light", "on": true}


# Largest legitimate payload per frame type. Validating LENGTH against the TYPE —
# not just a global cap — means a corrupted LENGTH is caught at the header instead
# of making the decoder wait for bytes that never come. Found by the test
# test_corrupted_length_field_does_not_swallow_following_frames: with only a
# global 2048-byte cap, a LENGTH corrupted to 1500 stalled the whole stream.
#   CSI: 16 B metadata + at most 612 B of CSI (ESP32-S3, HT40, all LTFs enabled).
#   RADAR: an LD2450 report is always exactly 30 bytes.
MAX_PAYLOAD_BY_TYPE = {
    0x01: 16 + 640,
    0x02: 64,
    0x03: 1024,
    0x04: 512,
    0x05: 32,
    0x06: 256,
}


# ---------------------------------------------------------------- CRC-16/CCITT
def _make_crc_table() -> list[int]:
    table = []
    for i in range(256):
        crc = i << 8
        for _ in range(8):
            crc = ((crc << 1) ^ 0x1021) if crc & 0x8000 else (crc << 1)
        table.append(crc & 0xFFFF)
    return table


_CRC_TABLE = _make_crc_table()


def crc16_ccitt(data: bytes, crc: int = 0xFFFF) -> int:
    """CRC-16/CCITT-FALSE: poly 0x1021, init 0xFFFF, no reflection, no xorout.

    Check value for b"123456789" is 0x29B1 (asserted in the tests), which is the
    standard reference vector — so the C implementation can be verified against
    exactly the same number.
    """
    for b in data:
        crc = ((crc << 8) & 0xFFFF) ^ _CRC_TABLE[((crc >> 8) ^ b) & 0xFF]
    return crc


# ---------------------------------------------------------------------- frames
@dataclass
class Frame:
    type: FrameType
    seq: int
    timestamp_us: int
    payload: bytes
    version: int = PROTOCOL_VERSION

    def encode(self) -> bytes:
        if len(self.payload) > MAX_PAYLOAD:
            raise ValueError(f"payload {len(self.payload)} B exceeds {MAX_PAYLOAD}")
        header = struct.pack(HEADER_FMT, SYNC, self.version, int(self.type),
                             len(self.payload), self.seq & 0xFFFF,
                             self.timestamp_us & 0xFFFFFFFFFFFFFFFF)
        body = header[2:] + self.payload
        return header[:2] + body + struct.pack("<H", crc16_ccitt(body))


# CSI payload: fixed metadata, transmitter MAC, then the raw int8 CSI buffer.
#   rssi i8 | noise_floor i8 | channel u8 | secondary_channel u8 | sig_mode u8 |
#   cwb u8 | stbc u8 | first_word_invalid u8 | mac 6s | csi_len u16 | csi int8[len]
CSI_META_FMT = "<bbBBBBBB6sH"
CSI_META_SIZE = struct.calcsize(CSI_META_FMT)     # 16


@dataclass
class CsiPacket:
    """One CSI capture as delivered by esp_wifi_set_csi_rx_cb.

    `raw` is the ESP-IDF CSI buffer: interleaved signed bytes (imag, real) per
    subcarrier, in the order the hardware reports them. Turning that into
    amplitudes, and deciding which subcarriers are usable, is the host's job
    (see csi.py) — the firmware deliberately does no processing, so a recording
    can be re-analysed with any future algorithm.
    """
    timestamp_us: int
    seq: int
    rssi: int
    noise_floor: int
    channel: int
    secondary_channel: int
    sig_mode: int            # 0 = non-HT (11b/g), 1 = HT (11n)
    cwb: int                 # channel width: 0 = 20 MHz, 1 = 40 MHz
    stbc: int
    first_word_invalid: int  # ESP-IDF flag: first 4 bytes of buf are garbage
    mac: bytes
    raw: bytes

    @property
    def n_subcarriers(self) -> int:
        return len(self.raw) // 2

    @classmethod
    def from_frame(cls, f: Frame) -> "CsiPacket":
        if len(f.payload) < CSI_META_SIZE:
            raise ValueError("CSI payload shorter than its metadata block")
        (rssi, nf, ch, ch2, sig, cwb, stbc, fwi, mac, n) = struct.unpack_from(
            CSI_META_FMT, f.payload)
        raw = f.payload[CSI_META_SIZE:CSI_META_SIZE + n]
        if len(raw) != n:
            raise ValueError(f"CSI buffer truncated: header says {n}, got {len(raw)}")
        return cls(f.timestamp_us, f.seq, rssi, nf, ch, ch2, sig, cwb, stbc, fwi,
                   mac, raw)

    def to_frame(self) -> Frame:
        meta = struct.pack(CSI_META_FMT, self.rssi, self.noise_floor, self.channel,
                           self.secondary_channel, self.sig_mode, self.cwb, self.stbc,
                           self.first_word_invalid, self.mac, len(self.raw))
        return Frame(FrameType.CSI, self.seq, self.timestamp_us, meta + self.raw)


@dataclass
class RadarPacket:
    """One raw HLK-LD2450 report (30 bytes: AA FF 03 00 ... 55 CC), unmodified."""
    timestamp_us: int
    seq: int
    raw: bytes

    @classmethod
    def from_frame(cls, f: Frame) -> "RadarPacket":
        return cls(f.timestamp_us, f.seq, f.payload)


@dataclass
class StatusPacket:
    timestamp_us: int
    seq: int
    fields: dict

    @classmethod
    def from_frame(cls, f: Frame) -> "StatusPacket":
        try:
            data = json.loads(f.payload.decode("utf-8", "replace"))
        except json.JSONDecodeError:
            data = {"unparsed": f.payload.decode("utf-8", "replace")}
        return cls(f.timestamp_us, f.seq, data)


# ------------------------------------------------------------- stream decoding
@dataclass
class DecoderStats:
    frames_ok: int = 0
    crc_errors: int = 0
    bad_headers: int = 0          # wrong version, or LENGTH out of range
    bytes_skipped: int = 0        # bytes discarded while resynchronising
    seq_gaps: dict = field(default_factory=dict)   # FrameType -> frames lost

    @property
    def frames_lost(self) -> int:
        return sum(self.seq_gaps.values())

    def loss_ratio(self) -> float:
        total = self.frames_ok + self.frames_lost
        return self.frames_lost / total if total else 0.0


class StreamDecoder:
    """Incremental decoder: feed arbitrary byte chunks, iterate complete frames.

    Serial reads return whatever bytes happen to be buffered — half a frame, three
    frames, a frame split across two reads. This class owns that problem so the
    rest of the system only ever sees whole, CRC-verified frames.

    Resynchronisation: on a bad header or CRC failure we discard exactly ONE byte
    and search for the next SYNC. Skipping the whole claimed frame length would be
    wrong — if the LENGTH field itself is corrupt, that could throw away several
    good frames that follow.
    """

    def __init__(self) -> None:
        self._buf = bytearray()
        self._last_seq: dict[int, int] = {}
        self.stats = DecoderStats()

    def feed(self, data: bytes) -> Iterator[Frame]:
        self._buf.extend(data)
        while True:
            frame = self._next_frame()
            if frame is None:
                return
            yield frame

    def flush(self) -> Iterator[Frame]:
        """End of stream: recover any complete frames stuck behind a bad header.

        Live, a corrupted-but-in-range LENGTH resolves itself — more bytes arrive,
        the CRC fails, and the decoder resynchronises. A finite recording has no
        "more bytes", so without this the frames after the corruption would be
        silently lost at end-of-file.
        """
        while len(self._buf) > len(SYNC):
            frame = self._next_frame()
            if frame is not None:
                yield frame
                continue
            if len(self._buf) <= len(SYNC):
                break
            self.stats.bytes_skipped += 1
            del self._buf[:1]

    def _next_frame(self) -> Optional[Frame]:
        buf = self._buf
        while True:
            start = buf.find(SYNC)
            if start < 0:
                # Keep a trailing 0xAA: it may be the first half of a SYNC.
                keep = 1 if buf.endswith(SYNC[:1]) else 0
                self.stats.bytes_skipped += len(buf) - keep
                del buf[: len(buf) - keep]
                return None
            if start:
                self.stats.bytes_skipped += start
                del buf[:start]
            if len(buf) < HEADER_SIZE:
                return None
            _, ver, ftype, length, seq, ts = struct.unpack_from(HEADER_FMT, buf)
            limit = MAX_PAYLOAD_BY_TYPE.get(ftype)
            if ver != PROTOCOL_VERSION or limit is None or length > limit:
                self.stats.bad_headers += 1
                self.stats.bytes_skipped += 1
                del buf[:1]
                continue
            total = HEADER_SIZE + length + CRC_SIZE
            if len(buf) < total:
                return None
            body = bytes(buf[2:HEADER_SIZE + length])
            (crc,) = struct.unpack_from("<H", buf, HEADER_SIZE + length)
            if crc16_ccitt(body) != crc:
                self.stats.crc_errors += 1
                self.stats.bytes_skipped += 1
                del buf[:1]
                continue
            payload = bytes(buf[HEADER_SIZE:HEADER_SIZE + length])
            del buf[:total]
            try:
                ftype_e = FrameType(ftype)
            except ValueError:
                self.stats.bad_headers += 1
                continue
            self._track_seq(ftype_e, seq)
            self.stats.frames_ok += 1
            return Frame(ftype_e, seq, ts, payload, ver)

    def _track_seq(self, ftype: FrameType, seq: int) -> None:
        last = self._last_seq.get(ftype)
        if last is not None:
            gap = (seq - last - 1) & 0xFFFF
            # A huge "gap" is a device reboot (seq restarted near 0), not 60k lost
            # frames; count it as a restart, not as loss.
            if 0 < gap < 0x8000:
                self.stats.seq_gaps[ftype] = self.stats.seq_gaps.get(ftype, 0) + gap
        self._last_seq[ftype] = seq


def decode_packet(frame: Frame):
    """Typed view of a frame: CsiPacket, RadarPacket, StatusPacket, or the frame."""
    if frame.type == FrameType.CSI:
        return CsiPacket.from_frame(frame)
    if frame.type == FrameType.RADAR:
        return RadarPacket.from_frame(frame)
    if frame.type == FrameType.STATUS:
        return StatusPacket.from_frame(frame)
    return frame
