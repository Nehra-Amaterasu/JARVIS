"""The hub's command path (laptop -> ESP32 relays) and source selection."""
import json
import struct

import pytest

from aankhen import hub as hub_mod
from aankhen.hub import AankhenHub
from aankhen.protocol import HEADER_FMT, Frame, FrameType, StreamDecoder, crc16_ccitt
from aankhen.transport import SerialSource


def test_command_frames_round_trip_through_the_decoder():
    body = json.dumps({"relay": "light", "on": True}).encode()
    raw = Frame(FrameType.COMMAND, 7, 123, body).encode()
    frames = list(StreamDecoder().feed(raw))
    assert len(frames) == 1 and frames[0].type == FrameType.COMMAND
    assert json.loads(frames[0].payload) == {"relay": "light", "on": True}


def test_a_corrupted_command_is_rejected():
    raw = bytearray(Frame(FrameType.COMMAND, 1, 0, b'{"relay":"fan","on":true}').encode())
    raw[20] ^= 0x01                                   # flip one payload bit
    dec = StreamDecoder()
    assert list(dec.feed(bytes(raw))) == [] and dec.stats.crc_errors == 1


def test_the_firmware_parses_the_same_bytes():
    """What aankhen_protocol.h / pumpCommands() expect: header 16 B, type 0x06,
    CRC over [2, 16+N). Re-derive it independently of Frame.encode()."""
    body = b'{"relay":"all","on":false}'
    raw = Frame(FrameType.COMMAND, 9, 42, body).encode()
    sync, ver, ftype, length, seq, ts = struct.unpack_from(HEADER_FMT, raw)
    assert (sync, ftype, length, seq) == (b"\xAA\x55", 0x06, len(body), 9)
    (crc,) = struct.unpack_from("<H", raw, 16 + length)
    assert crc == crc16_ccitt(raw[2:16 + length])
    assert length <= 256                             # firmware's cmdBuf limit


def test_no_board_means_not_delivered():
    h = AankhenHub()
    assert h.command({"relay": "light", "on": True}) is False
    assert h.can_command is False


def test_serial_write_without_a_port_is_refused():
    assert SerialSource("COM_DOES_NOT_EXIST").write(b"x") is False


def test_asking_for_the_board_when_none_is_plugged_in_says_so(monkeypatch):
    monkeypatch.setattr(hub_mod, "find_esp32_port", lambda force=False: None)
    with pytest.raises(FileNotFoundError, match="No ESP32"):
        AankhenHub().start("hardware")


def test_tick_errors_are_counted_shown_and_logged_once_each(caplog):
    """Regression (council review 2026-10-26): the once-a-second teacher / recalibration
    tick swallowed every exception, so a broken recalibration never surfaced."""
    import logging
    h = AankhenHub()
    assert h.info()["tick_errors"] == {"count": 0, "last": None}
    with caplog.at_level(logging.ERROR, logger="aankhen.hub"):
        for _ in range(5):                                   # the same error, 5 ticks running
            try:
                raise KeyError("recal")
            except KeyError as e:
                h._note_tick_error(e)
        try:
            raise ValueError("other")
        except ValueError as e:
            h._note_tick_error(e)
    logged = [r for r in caplog.records if "tick failed" in r.getMessage()]
    assert len(logged) == 2 and logged[0].exc_info is not None
    assert h.info()["tick_errors"] == {"count": 6, "last": "ValueError: other"}
