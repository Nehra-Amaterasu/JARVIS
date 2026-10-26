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

The C side of this contract lives in aankhen/firmware/aankhen_protocol.h.
Both sides MUST change together. Bump PROTOCOL_VERSION when an EXISTING layout
changes: the decoder rejects every frame of another version, so a bump also makes
every .akr recorded before it unreadable. A NEW frame type is additive and keeps the
version (CSI_GAIN 0x07, CSI_LINK 0x08), but it must reach the host BEFORE any firmware
sends it: an unknown TYPE has no entry in MAX_PAYLOAD_BY_TYPE, so the decoder reads it
as a corrupted header (bad_headers, bytes_skipped) and resynchronises past it.
"""
from __future__ import annotations

import binascii
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
    CSI_GAIN = 0x07      # a CSI capture plus the receiver gain it was taken with
    CSI_LINK = 0x08      # a CSI capture from ANOTHER transmitter (link 2: a phone)


# Largest legitimate payload per frame type. Validating LENGTH against the TYPE —
# not just a global cap — means a corrupted LENGTH is caught at the header instead
# of making the decoder wait for bytes that never come. Found by the test
# test_corrupted_length_field_does_not_swallow_following_frames: with only a
# global 2048-byte cap, a LENGTH corrupted to 1500 stalled the whole stream.
#   CSI: 16 B metadata + at most 612 B of CSI (ESP32-S3, HT40, all LTFs enabled).
#   RADAR: an LD2450 report is always exactly 30 bytes.
#   CSI_LINK: link id + metadata + gain block (21 B) + the same CSI buffer.
# This table is also the decoder's list of KNOWN types: a type missing here is read as
# corruption, so a new type is registered here before any firmware sends it.
MAX_PAYLOAD_BY_TYPE = {
    0x01: 16 + 640,
    0x02: 64,
    0x03: 1024,
    0x04: 512,
    0x05: 32,
    0x06: 256,
    0x07: 16 + 4 + 640,
    0x08: 1 + 16 + 4 + 640,
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


def crc16_ccitt_reference(data: bytes, crc: int = 0xFFFF) -> int:
    """Table-driven CRC-16/CCITT-FALSE, written out: the C side is a port of this."""
    for b in data:
        crc = ((crc << 8) & 0xFFFF) ^ _CRC_TABLE[((crc >> 8) ^ b) & 0xFF]
    return crc


def crc16_ccitt(data: bytes, crc: int = 0xFFFF) -> int:
    """CRC-16/CCITT-FALSE: poly 0x1021, init 0xFFFF, no reflection, no xorout.

    Check value for b"123456789" is 0x29B1 (asserted in the tests), which is the
    standard reference vector — so the C implementation can be verified against
    exactly the same number.

    binascii.crc_hqx is the same polynomial and register in C. The Python loop
    above cost 1.6 s of every 60 s simulated (12,700 frames): a fifth of a
    benchmark run went to checksums. Equality with the reference is tested.
    """
    return binascii.crc_hqx(data, crc)


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
# CSI_GAIN frames insert a gain block between the metadata and the buffer:
#   agc_gain u8 | fft_gain i8 | comp_cdb i16
# agc_gain and fft_gain are what Espressif's esp_csi_gain_ctrl reads from reserved
# bits of the ESP32-S3's rx_ctrl. comp_cdb is the compensation the firmware computed
# with esp_csi_gain_ctrl_get_gain_compensation, in hundredths of a dB: multiplying
# the amplitudes by 10^(comp_cdb / 2000) undoes the packet's automatic gain.
# GAIN_UNKNOWN means the firmware could not compute it.
CSI_GAIN_FMT = "<Bbh"
CSI_GAIN_SIZE = struct.calcsize(CSI_GAIN_FMT)     # 4
GAIN_UNKNOWN = -32768


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
    agc_gain: Optional[int] = None       # CSI_GAIN frames only
    fft_gain: Optional[int] = None
    gain_comp_db: Optional[float] = None # dB to add to undo the automatic gain

    @property
    def has_gain(self) -> bool:
        return self.gain_comp_db is not None

    @property
    def n_subcarriers(self) -> int:
        return len(self.raw) // 2

    @classmethod
    def from_frame(cls, f: Frame) -> "CsiPacket":
        gain = f.type == FrameType.CSI_GAIN
        head = CSI_META_SIZE + (CSI_GAIN_SIZE if gain else 0)
        if len(f.payload) < head:
            raise ValueError("CSI payload shorter than its metadata block")
        (rssi, nf, ch, ch2, sig, cwb, stbc, fwi, mac, n) = struct.unpack_from(
            CSI_META_FMT, f.payload)
        agc = fft = comp = None
        if gain:
            agc, fft, cdb = struct.unpack_from(CSI_GAIN_FMT, f.payload, CSI_META_SIZE)
            comp = None if cdb == GAIN_UNKNOWN else cdb / 100.0
        raw = f.payload[head:head + n]
        if len(raw) != n:
            raise ValueError(f"CSI buffer truncated: header says {n}, got {len(raw)}")
        return cls(f.timestamp_us, f.seq, rssi, nf, ch, ch2, sig, cwb, stbc, fwi,
                   mac, raw, agc, fft, comp)

    def to_frame(self) -> Frame:
        meta = struct.pack(CSI_META_FMT, self.rssi, self.noise_floor, self.channel,
                           self.secondary_channel, self.sig_mode, self.cwb, self.stbc,
                           self.first_word_invalid, self.mac, len(self.raw))
        if self.agc_gain is None and self.gain_comp_db is None:
            return Frame(FrameType.CSI, self.seq, self.timestamp_us, meta + self.raw)
        cdb = GAIN_UNKNOWN if self.gain_comp_db is None else             max(-32767, min(32767, int(round(self.gain_comp_db * 100))))
        gain = struct.pack(CSI_GAIN_FMT, self.agc_gain or 0, self.fft_gain or 0, cdb)
        return Frame(FrameType.CSI_GAIN, self.seq, self.timestamp_us, meta + gain + self.raw)


# CSI_LINK payload: which link, then exactly a CSI_GAIN payload:
#   link u8 | CSI_META_FMT (16) | CSI_GAIN_FMT (4) | csi int8[len]
# The gain block is always present (agc 0, fft 0, GAIN_UNKNOWN when the firmware has no
# esp_csi_gain_ctrl), so every link is gain-compensated exactly like link 1. Mirrors
# ak_csi_link_head_t in aankhen_protocol.h.
CSI_LINK_FMT = "<B"
CSI_LINK_HEAD_SIZE = struct.calcsize(CSI_LINK_FMT) + CSI_META_SIZE + CSI_GAIN_SIZE   # 21
LINK_ROUTER = 1      # router -> board. Travels as CSI / CSI_GAIN, never as CSI_LINK.
LINK_PHONE = 2       # the owner's phone -> board: the phone that opened the board's /beacon
LINK_NAMES = {LINK_ROUTER: "router", LINK_PHONE: "phone"}


@dataclass
class CsiLinkPacket:
    """One CSI capture from a transmitter other than the router: link 2, a phone.

    The board overhears the phone's replies to its pings on their way to the router
    (firmware, LINK 2), so this is the phone -> board path: the same physics as a
    CsiPacket, seen from another place in the room.

    Deliberately NOT a CsiPacket subclass. Everything built for link 1 (Engine.process,
    learn._packets, bench, validate, firstlight) selects packets with
    isinstance(p, CsiPacket), so link-2 data cannot leak into the router link's
    conditioner, baselines or models until someone integrates it on purpose (links.py).
    """
    link: int
    timestamp_us: int
    seq: int
    rssi: int
    noise_floor: int
    channel: int
    secondary_channel: int
    sig_mode: int
    cwb: int
    stbc: int
    first_word_invalid: int
    mac: bytes               # the transmitter as heard on the air (the phone's current MAC)
    raw: bytes
    agc_gain: Optional[int] = None
    fft_gain: Optional[int] = None
    gain_comp_db: Optional[float] = None

    @property
    def has_gain(self) -> bool:
        return self.gain_comp_db is not None

    @property
    def n_subcarriers(self) -> int:
        return len(self.raw) // 2

    @classmethod
    def from_frame(cls, f: Frame) -> "CsiLinkPacket":
        # ValueError, never struct.error: Source._emit counts a ValueError as a bad
        # frame and carries on; anything else would end the reader thread.
        if f.type != FrameType.CSI_LINK:
            raise ValueError(f"not a CSI_LINK frame: {f.type!r}")
        if len(f.payload) < CSI_LINK_HEAD_SIZE:
            raise ValueError("CSI_LINK payload shorter than its head block")
        (link,) = struct.unpack_from(CSI_LINK_FMT, f.payload)
        off = struct.calcsize(CSI_LINK_FMT)
        (rssi, nf, ch, ch2, sig, cwb, stbc, fwi, mac, n) = struct.unpack_from(
            CSI_META_FMT, f.payload, off)
        agc, fft, cdb = struct.unpack_from(CSI_GAIN_FMT, f.payload, off + CSI_META_SIZE)
        raw = f.payload[CSI_LINK_HEAD_SIZE:CSI_LINK_HEAD_SIZE + n]
        if len(raw) != n:
            raise ValueError(f"CSI buffer truncated: header says {n}, got {len(raw)}")
        comp = None if cdb == GAIN_UNKNOWN else cdb / 100.0
        return cls(link, f.timestamp_us, f.seq, rssi, nf, ch, ch2, sig, cwb, stbc, fwi,
                   mac, raw, agc, fft, comp)

    def to_frame(self) -> Frame:
        head = struct.pack(CSI_LINK_FMT, self.link)
        meta = struct.pack(CSI_META_FMT, self.rssi, self.noise_floor, self.channel,
                           self.secondary_channel, self.sig_mode, self.cwb, self.stbc,
                           self.first_word_invalid, self.mac, len(self.raw))
        cdb = GAIN_UNKNOWN if self.gain_comp_db is None else \
            max(-32767, min(32767, int(round(self.gain_comp_db * 100))))
        gain = struct.pack(CSI_GAIN_FMT, self.agc_gain or 0, self.fft_gain or 0, cdb)
        return Frame(FrameType.CSI_LINK, self.seq, self.timestamp_us, head + meta + gain + self.raw)


@dataclass
class RadarPacket:
    """One raw HLK-LD2450 report (30 bytes: AA FF 03 00 ... 55 CC), unmodified."""
    timestamp_us: int
    seq: int
    raw: bytes

    @classmethod
    def from_frame(cls, f: Frame) -> "RadarPacket":
        return cls(f.timestamp_us, f.seq, f.payload)


# ------------------------------------------------------------ link quality (3.6.0)
# Firmware 3.6.0 adds an "lq" object to STATUS, so a weak or stalling router link can be
# read from the board itself (council 2026-10-26: the ping stall and the -88 dBm airtime
# budget were inferred from code and a model; these counters measure them):
#   "lq": {"ping_ok": u32, "ping_lost": u32, "gap_ms": u16, "rate": u8|null,
#          "reconn": u16, "disc": u8|null, "ap": "xx:xx:xx"|null}
# ping_ok / ping_lost  link-1 router pings answered / timed out since boot. A "lost" ping
#                      is one whose reply missed CSI_PING_TIMEOUT_MS (10 ms); a late reply
#                      is still captured as CSI, so this counts timeouts, not lost CSI.
# gap_ms               the longest stretch between two link-1 CSI captures since the last
#                      periodic STATUS (about 1 s), including the stretch still open now:
#                      a dead link shows a growing gap instead of a quiet 0. Capped 65535,
#                      which is also what it reads before the first capture since boot.
# rate                 the PHY rate code of the latest router reply: 0-31 = the legacy
#                      (11b/g) code ESP-IDF calls wifi_phy_rate_t, 128 + n = HT MCS n.
# reconn / disc        rejoins since boot; the last disconnect's ESP-IDF reason code.
# ap                   the last 3 bytes of the access point's BSSID: the board pins it.
# Old firmware has no "lq"; StatusPacket.link_quality is then None, never zeros.

# wifi_phy_rate_t's legacy codes (esp_wifi_types_generic.h), in Mbit/s. The ESP32-S3's
# rx_ctrl.rate is documented as "PHY rate encoding" for non-HT packets; that it uses
# this same table is an assumption until a capture at a known rate confirms it.
LEGACY_RATE_MBPS = {0x00: 1.0, 0x01: 2.0, 0x02: 5.5, 0x03: 11.0, 0x05: 2.0, 0x06: 5.5,
                    0x07: 11.0, 0x08: 48.0, 0x09: 24.0, 0x0A: 12.0, 0x0B: 6.0, 0x0C: 54.0,
                    0x0D: 36.0, 0x0E: 18.0, 0x0F: 9.0}
# 802.11n, one spatial stream, 20 MHz, long guard interval: MCS 0-7.
HT20_MCS_MBPS = (6.5, 13.0, 19.5, 26.0, 39.0, 52.0, 58.5, 65.0)
RATE_HT = 128

# The disconnect reasons worth a word (esp_wifi_types_generic.h wifi_err_reason_t).
DISCONNECT_REASONS = {
    1: "unspecified", 2: "auth expired", 3: "auth left", 4: "assoc expired",
    8: "left on purpose", 15: "4-way handshake timeout", 200: "beacon timeout (AP lost)",
    201: "no AP found", 202: "auth failed (password?)", 203: "assoc failed",
    204: "handshake timeout", 205: "connection failed",
}


def phy_rate_mbps(code: Optional[int]) -> Optional[float]:
    """Mbit/s for a STATUS lq "rate" code; None when unknown. HT assumes 20 MHz, long GI."""
    if code is None:
        return None
    if code >= RATE_HT:
        mcs = code - RATE_HT
        return HT20_MCS_MBPS[mcs] if mcs < len(HT20_MCS_MBPS) else None
    return LEGACY_RATE_MBPS.get(code)


def disconnect_reason(code: Optional[int]) -> Optional[str]:
    if code is None:
        return None
    return DISCONNECT_REASONS.get(code, f"reason {code}")


def _int(v) -> Optional[int]:
    # bool is an int in Python; a true/false here is a malformed field, not 1/0.
    return int(v) if isinstance(v, (int, float)) and not isinstance(v, bool) else None


@dataclass(frozen=True)
class LinkQuality:
    ping_ok: Optional[int]
    ping_lost: Optional[int]
    gap_ms: Optional[int]
    rate: Optional[int]
    reconnects: Optional[int]
    disconnect: Optional[int]
    ap: Optional[str]

    @classmethod
    def from_fields(cls, fields: dict) -> Optional["LinkQuality"]:
        lq = fields.get("lq") if isinstance(fields, dict) else None
        if not isinstance(lq, dict):
            return None
        ap = lq.get("ap")
        return cls(_int(lq.get("ping_ok")), _int(lq.get("ping_lost")), _int(lq.get("gap_ms")),
                   _int(lq.get("rate")), _int(lq.get("reconn")), _int(lq.get("disc")),
                   ap if isinstance(ap, str) else None)

    @property
    def rate_mbps(self) -> Optional[float]:
        return phy_rate_mbps(self.rate)

    @property
    def disconnect_name(self) -> Optional[str]:
        return disconnect_reason(self.disconnect)


def ping_loss(first: Optional[LinkQuality], last: Optional[LinkQuality]) -> Optional[float]:
    """Fraction of link-1 pings that timed out between two STATUS reports; None if unknown.

    Counters are since boot, so the difference spans the window. A board that rebooted in
    between (counters went down) gives None rather than a negative rate."""
    if not first or not last or None in (first.ping_ok, first.ping_lost, last.ping_ok, last.ping_lost):
        return None
    ok, lost = last.ping_ok - first.ping_ok, last.ping_lost - first.ping_lost
    if ok < 0 or lost < 0 or ok + lost == 0:
        return None
    return lost / (ok + lost)


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

    @property
    def link_quality(self) -> Optional[LinkQuality]:
        """The 3.6.0 "lq" block, or None from older firmware."""
        return LinkQuality.from_fields(self.fields)


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
    """Typed view of a frame: CsiPacket (link 1), CsiLinkPacket (link 2 and on),
    RadarPacket, StatusPacket, or the frame itself."""
    if frame.type in (FrameType.CSI, FrameType.CSI_GAIN):
        return CsiPacket.from_frame(frame)
    if frame.type == FrameType.CSI_LINK:
        return CsiLinkPacket.from_frame(frame)
    if frame.type == FrameType.RADAR:
        return RadarPacket.from_frame(frame)
    if frame.type == FrameType.STATUS:
        return StatusPacket.from_frame(frame)
    return frame
