"""Firmware 3.6.0's link-quality block in STATUS ("lq"): parsing, size, and the smoke report.

The block exists so the ping-stall fix (3.5.1) and the weak-signal budget can be read off
the board instead of inferred: these tests pin that old firmware stays readable (no "lq"
means None, never zeros), that the longest STATUS still fits the 1000-byte buffer an OLD
host accepts, and that smoke_board turns the numbers into a verdict with the council's
bounds (USB gap < 50 ms, any gap < 250 ms, frame loss <= 5 %).
"""
import json
import re
from pathlib import Path

from aankhen.protocol import (
    MAX_PAYLOAD_BY_TYPE, Frame, FrameType, LinkQuality, StatusPacket, StreamDecoder,
    decode_packet, disconnect_reason, phy_rate_mbps, ping_loss,
)
from aankhen.protocol import CsiPacket
from aankhen.tools import smoke_board as sb
from aankhen.transport import CallbackSource

FW_DIR = Path(__file__).resolve().parents[1] / "firmware"
U32 = 4294967295


def _status(fields: dict) -> StatusPacket:
    f = Frame(FrameType.STATUS, 1, 5, json.dumps(fields).encode())
    return decode_packet(next(StreamDecoder().feed(f.encode())))


LQ = {"ping_ok": 1000, "ping_lost": 20, "gap_ms": 18, "rate": 0x0B, "reconn": 2, "disc": 200,
      "ap": "0a:0b:0c"}


def test_status_without_lq_reads_as_none_not_zeros():
    assert _status({"fw": "aankhen-3.5.1", "csi_hz": 480}).link_quality is None
    assert _status({"lq": None}).link_quality is None
    assert StatusPacket(0, 0, {"unparsed": "{trunc"}).link_quality is None


def test_status_lq_parses_every_field():
    lq = _status({"fw": "aankhen-3.6.0", "lq": LQ}).link_quality
    assert lq == LinkQuality(1000, 20, 18, 0x0B, 2, 200, "0a:0b:0c")
    assert lq.rate_mbps == 6.0 and lq.disconnect_name.startswith("beacon timeout")


def test_lq_nulls_and_wrong_types_become_none():
    lq = _status({"lq": {"ping_ok": True, "ping_lost": "3", "gap_ms": 7, "rate": None,
                         "reconn": 0, "disc": None, "ap": None}}).link_quality
    assert lq.ping_ok is None and lq.ping_lost is None and lq.gap_ms == 7
    assert lq.rate is None and lq.rate_mbps is None and lq.disconnect_name is None and lq.ap is None


def test_phy_rate_codes():
    assert phy_rate_mbps(0x00) == 1.0 and phy_rate_mbps(0x0C) == 54.0
    assert phy_rate_mbps(128) == 6.5 and phy_rate_mbps(128 + 7) == 65.0
    assert phy_rate_mbps(128 + 15) is None          # two streams: not on a one-antenna S3
    assert phy_rate_mbps(0x1F) is None and phy_rate_mbps(None) is None
    assert disconnect_reason(201) == "no AP found" and disconnect_reason(99) == "reason 99"


def test_ping_loss_is_the_difference_over_the_window():
    a = LinkQuality(1000, 10, 0, None, 0, None, None)
    b = LinkQuality(1950, 60, 0, None, 0, None, None)
    assert abs(ping_loss(a, b) - 50 / 1000) < 1e-9
    assert ping_loss(b, a) is None                  # counters fell: the board rebooted between
    assert ping_loss(a, a) is None and ping_loss(None, b) is None


# ------------------------------------------------------------- STATUS size
def _lq_format() -> str:
    ino = (FW_DIR / "firmware.ino").read_text(encoding="utf-8")
    m = re.search(r'"(\{\\"ping_ok\\".*?\})"', ino)
    assert m, "the lq format string in buildStatus()"
    return m.group(1).replace('\\"', '"')


def test_lq_keys_in_the_firmware_match_the_parser():
    fmt = _lq_format()
    assert re.findall(r'"(\w+)":', fmt) == ["ping_ok", "ping_lost", "gap_ms", "rate", "reconn", "disc", "ap"]


def relay_names() -> list[str]:
    """RELAY_TABLE's names, in table order, from config.h."""
    cfg = (FW_DIR / "config.h").read_text(encoding="utf-8")
    table = re.search(r"#define RELAY_TABLE \\\n((?:.*\\\n)*.*)", cfg).group(1)
    return re.findall(r'\{"(\w+)",', table)


def _main_format() -> str:
    """buildStatus()'s main format string: the C literals after `int n = snprintf(js, jsLen,`."""
    ino = (FW_DIR / "firmware.ino").read_text(encoding="utf-8")
    body = ino[ino.index("int n = snprintf(js, jsLen,"):]
    lits = []
    for line in body.splitlines()[1:]:
        s = line.strip()
        if not s.startswith('"'):
            break
        lits += re.findall(r'"((?:[^"\\]|\\.)*)"', s)
    return "".join(lits).replace('\\"', '"')


def status_worst_case() -> bytes:
    """buildStatus() at its longest with this config.h: every relay row, a phone, a session,
    every counter at its widest, safe mode with its reason. Built from the firmware's own
    format string, specifier by specifier, so a new field cannot slip past the size test."""
    names = relay_names()
    relays = "{" + ",".join(f'"{n}":false' for n in names) + "}"
    pins = "{" + ",".join(f'"{n}":48' for n in names) + "}"      # GPIO 48: the widest pin, as wide as -1
    beacon = (f'{{"ip":"255.255.255.255","mac_known":false,"pings_ok":{U32},"rate_hz":{U32},"rssi":-100,'
              f'"dropped":{U32},"rejected":{U32},"fallback":false}}')
    net = (f'{{"key":"abcdef01","port":47269,"peer":"255.255.255.255:65535","dgrams":{U32},"cmds":{U32},'
           f'"bad":{U32},"replays":{U32},"fail":{U32}}}')
    lq = (_lq_format().replace("%lu", str(U32), 2).replace("%u", "65535", 1)
          .replace("%s", "null", 2).replace("%u", "65535", 1).replace("%s", '"ff:ff:ff"', 1))
    values = ["aankhen-3.9.0", "4294967.3", relays, relays, pins, "restoring",
              '"repeat brownout"', "65535", "65535", str(U32),
              "connecting", "255.255.255.255", '"aankhen.local"', "-100", "13",
              str(U32), str(U32), str(U32), "false", "false", str(U32), "false",
              "unavailable", "false", "reset-pin", "false", beacon, net, lq]
    specs = re.findall(r"%(?:\.1f|lu|u|d|s)", _main_format())
    assert len(specs) == len(values), "buildStatus() changed: list its new fields here"
    it = iter(values)
    return re.sub(r"%(?:\.1f|lu|u|d|s)", lambda m: next(it), _main_format()).encode()


def test_the_longest_status_fits_the_buffer_and_the_host_limit():
    js = status_worst_case()
    fields = json.loads(js)
    assert len(relay_names()) == 8 and set(fields["relays_target"]) == set(relay_names())
    assert fields["power"] == "restoring" and fields["brownouts"] == 65535
    assert LinkQuality.from_fields(fields).ap == "ff:ff:ff"
    status_max = int(re.search(r"#define STATUS_MAX (\d+)", (FW_DIR / "firmware.ino").read_text()).group(1))
    ak_max = int(re.search(r"#define AK_MAX_PAYLOAD (\d+)",
                           (FW_DIR / "aankhen_protocol.h").read_text()).group(1))
    # 3.8.0 raised firmware and host together: an app older than 3.8.0 drops this STATUS.
    assert len(js) < status_max == ak_max == MAX_PAYLOAD_BY_TYPE[FrameType.STATUS] == 1280


def test_firmware_version_is_390():
    ino = (FW_DIR / "firmware.ino").read_text(encoding="utf-8")
    assert '#define FW_VERSION "aankhen-3.9.0"' in ino


# ------------------------------------------------------------- smoke report
def _csi(seq, ts_us):
    return CsiPacket(ts_us, seq, -60, -95, 6, 0, 1, 0, 0, 0, b"\x01" * 6, bytes(128)).to_frame().encode()


def _status_frame(fields, seq):
    return Frame(FrameType.STATUS, seq, 0, json.dumps(fields).encode()).encode()


class Clock:
    def __init__(self):
        self.t = 0.0

    def __call__(self):
        self.t += 0.001
        return self.t


def _collect(chunks, link="usb"):
    src = CallbackSource(lambda: iter(chunks)).start()
    return sb.collect(src, 5.0, sb.Report(link=link, where="x"), clock=Clock())


def test_collect_measures_the_longest_gap_on_the_board_clock():
    ts = [i * 2_000 for i in range(400)]              # 500 Hz: 2 ms apart
    ts[150:] = [t + 60_000 for t in ts[150:]]          # one 62 ms hole
    chunks = [_csi(i, t) for i, t in enumerate(ts)]
    chunks.insert(10, _status_frame({"lq": dict(LQ, ping_ok=100, ping_lost=0, gap_ms=5)}, 0))
    chunks.append(_status_frame({"lq": dict(LQ, ping_ok=1100, ping_lost=50, gap_ms=61)}, 1))
    r = _collect(chunks, "usb")
    assert r.csi == 400 and abs(r.gap_ms - 62.0) < 1e-6
    assert r.board_gap_ms == 61 and abs(r.ping_loss - 50 / 1050) < 1e-9
    assert r.frames_ok == 402 and r.loss == 0
    ok, why = sb.verdict(r)
    assert not ok and "62 ms" in why[0] and "50 ms on usb" in why[0]
    r.link = "wifi"                                   # the same gap over Wi-Fi is "usable"
    assert sb.verdict(r)[0]
    text = "\n".join(sb.render(r))
    assert "62 ms  usable" in text and "6 Mbit/s (11b/g)" in text and "beacon timeout" in text
    assert "ping timeouts 4.8 %" in text and "AP ..:0a:0b:0c" in text


def test_a_gap_past_250_ms_fails_wifi_too():
    r = sb.Report(link="wifi", seconds=10, csi=3000, subcarriers={64: 3000}, hmac_ok=400, hmac_bad=0,
                  gap_ms=300.0)
    ok, why = sb.verdict(r)
    assert not ok and "breaks the stream" in why[0]


def test_frame_loss_over_five_percent_fails():
    r = sb.Report(link="wifi", seconds=10, csi=3000, subcarriers={64: 3000}, frames_ok=3000, frames_lost=200,
                  gap_ms=20.0)
    ok, why = sb.verdict(r)
    assert not ok and "6.2 % of frames lost" in why[0]
    r.frames_lost = 20
    assert sb.verdict(r)[0]


def test_old_firmware_still_renders_and_passes():
    chunks = [_csi(i, i * 2_000) for i in range(300)] + [_status_frame({"fw": "aankhen-3.5.1"}, 0)]
    r = _collect(chunks)
    assert r.lq_last is None and r.gap_ms == 2.0
    assert sb.verdict(r)[0]
    assert "firmware before 3.6.0" in "\n".join(sb.render(r))
