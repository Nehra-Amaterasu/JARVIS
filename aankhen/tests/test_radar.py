import pytest

from aankhen.radar import (
    FRAME_LEN, FrameError, build_frame, decode_bit15, encode_bit15, parse_frame, to_room,
)
from aankhen.room import Room, SensorPose

# The example report printed in the HLK-LD2450 datasheet.
DATASHEET = bytes.fromhex(
    "AAFF0300" "0E03B186" "10004001" + "00" * 16 + "55CC")


def test_datasheet_example_decodes_exactly():
    (t,) = parse_frame(DATASHEET)
    assert t.x_m == -0.782
    assert t.y_m == 1.713
    assert t.speed_mps == -0.16
    assert t.resolution_mm == 320


def test_bit15_is_sign_magnitude_not_twos_complement():
    assert decode_bit15(0x8000 | 100) == 100
    assert decode_bit15(100) == -100
    # Two's-complement decoding of 0x8064 would be -32668: wildly wrong.
    assert decode_bit15(0x8064) == 100


@pytest.mark.parametrize("v", [0, 1, -1, 782, -782, 1713, 32767, -32767])
def test_bit15_round_trip(v):
    assert decode_bit15(encode_bit15(v)) == v


def test_empty_slots_are_skipped():
    assert parse_frame(build_frame([])) == []
    assert len(parse_frame(build_frame([(0.5, 2.0, 0.0)]))) == 1


def test_three_targets_round_trip():
    targets = [(-0.5, 1.0, 0.2), (0.3, 2.5, -0.1), (1.2, 4.0, 0.0)]
    got = parse_frame(build_frame(targets))
    assert [(round(d.x_m, 3), round(d.y_m, 3), round(d.speed_mps, 2)) for d in got] == targets


@pytest.mark.parametrize("bad", [
    DATASHEET[:26],                              # truncated: old parser accepted this
    DATASHEET + b"\x00",                         # too long
    b"\x00" + DATASHEET[1:],                     # bad header
    DATASHEET[:-2] + b"\x00\x00",                # bad footer: old parser ignored it
])
def test_malformed_frames_are_rejected(bad):
    with pytest.raises(FrameError):
        parse_frame(bad)


def test_frame_length_constant():
    assert len(build_frame([(1, 1, 0)])) == FRAME_LEN == 30


def test_to_room_projects_and_flags_through_wall_ghosts():
    room = Room(width=4, depth=4, height=2.8)
    s = SensorPose("radar", "ld2450", 2.0, 0.0, 1.1, yaw_deg=90, pitch_deg=0, range_m=6)
    dets = parse_frame(build_frame([(0.0, 2.0, 0.0), (0.0, 5.5, 0.0)]))
    inside, ghost = to_room(room, s, dets)
    assert (round(inside.x, 3), round(inside.y, 3), inside.in_room) == (2.0, 2.0, True)
    assert ghost.in_room is False                # 5.5 m ahead is beyond the 4 m wall
