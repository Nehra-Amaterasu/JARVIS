"""HLK-LD2450 24 GHz mmWave radar: strict frame decoding and room conversion.

The LD2450 tracks up to three targets and reports, per target, lateral x and
forward y (mm), radial speed (cm/s) and a distance-resolution value, about ten
times a second over UART at 256,000 baud.

FRAME (always exactly 30 bytes)
  AA FF 03 00 | target1 (8) | target2 (8) | target3 (8) | 55 CC
  target: x int16 | y int16 | speed int16 | resolution uint16   (little-endian)

SIGNED VALUES USE A NON-STANDARD ENCODING. Bit 15 is a SIGN FLAG where
1 = positive and 0 = negative, and the low 15 bits are the magnitude. It is not
two's complement — decoding it as int16 gives wildly wrong positions. Verified
against the datasheet example frame (target 1: x = -782 mm, y = 1713 mm,
speed = -16 cm/s, resolution = 320), which is reproduced in the tests.

An unused target slot is all zeros and is skipped.

This replaces the earlier parser, which accepted any frame of 26+ bytes and never
checked the footer — so truncated or misaligned data decoded as "success".
"""
from __future__ import annotations

import struct
from dataclasses import dataclass
from typing import Callable, Optional

from .room import Room, SensorPose

HEADER = b"\xAA\xFF\x03\x00"
FOOTER = b"\x55\xCC"
FRAME_LEN = 30
_TARGET = struct.Struct("<HHHH")


def decode_bit15(raw: int) -> int:
    """LD2450 sign-magnitude: bit 15 set = positive."""
    mag = raw & 0x7FFF
    return mag if raw & 0x8000 else -mag


def encode_bit15(value: int) -> int:
    """Inverse of decode_bit15 (for tests and the simulator)."""
    mag = min(abs(int(value)), 0x7FFF)
    return (0x8000 | mag) if value >= 0 else mag


@dataclass
class RadarDetection:
    """One target in the RADAR's own frame (metres, metres/second)."""
    slot: int
    x_m: float            # lateral: + is to the sensor's right
    y_m: float            # forward along boresight (slant range if tilted)
    speed_mps: float      # radial speed; sign as reported (+ = receding)
    resolution_mm: int

    @property
    def range_m(self) -> float:
        return (self.x_m ** 2 + self.y_m ** 2) ** 0.5


class FrameError(ValueError):
    pass


def parse_frame(frame: bytes) -> list[RadarDetection]:
    """Decode one LD2450 report. Raises FrameError on anything malformed."""
    if len(frame) != FRAME_LEN:
        raise FrameError(f"LD2450 frame must be {FRAME_LEN} bytes, got {len(frame)}")
    if frame[:4] != HEADER:
        raise FrameError(f"bad header {frame[:4].hex()}")
    if frame[-2:] != FOOTER:
        raise FrameError(f"bad footer {frame[-2:].hex()}")
    out = []
    for slot in range(3):
        rx, ry, rs, res = _TARGET.unpack_from(frame, 4 + slot * 8)
        if rx == 0 and ry == 0 and rs == 0 and res == 0:
            continue                                  # empty slot
        out.append(RadarDetection(
            slot=slot,
            x_m=decode_bit15(rx) / 1000.0,
            y_m=decode_bit15(ry) / 1000.0,
            speed_mps=decode_bit15(rs) / 100.0,
            resolution_mm=res,
        ))
    return out


def build_frame(targets: list[tuple[float, float, float]]) -> bytes:
    """Encode up to three (x_m, y_m, speed_mps) targets into a valid frame."""
    body = b""
    for i in range(3):
        if i < len(targets):
            x, y, s = targets[i]
            body += _TARGET.pack(encode_bit15(round(x * 1000)), encode_bit15(round(y * 1000)),
                                 encode_bit15(round(s * 100)), 320)
        else:
            body += bytes(8)
    return HEADER + body + FOOTER


@dataclass
class RoomDetection:
    """A radar detection converted into room coordinates."""
    sensor_id: str
    x: float
    y: float
    speed_mps: float
    in_room: bool


def to_room(room: Room, sensor: SensorPose, dets: list[RadarDetection],
            max_range_m: Optional[float] = None,
            refine: Optional[Callable[["RadarDetection", float, float], tuple[float, float]]] = None,
            ) -> list[RoomDetection]:
    """Project detections into the room frame, dropping ones outside the walls.

    Points outside the room are almost always reflections through a wall or off
    glass — the LD2450's best-known ghost source — so they are flagged rather than
    tracked.
    """
    out = []
    limit = max_range_m or sensor.range_m
    for d in dets:
        if d.range_m > limit or d.y_m <= 0:
            continue
        x, y = room.radar_to_room(sensor, d.x_m, d.y_m)
        if refine is not None:
            # Second pass: the caller may re-project with a posture-aware torso
            # height (see room.TORSO_HEIGHT_M and Engine._refine).
            x, y = refine(d, x, y)
        out.append(RoomDetection(sensor.id, x, y, d.speed_mps,
                                 room.inside(x, y, margin=0.15)))
    return out
