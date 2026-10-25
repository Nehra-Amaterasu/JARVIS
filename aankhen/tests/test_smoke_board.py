"""The hardware smoke script: counting, verdicts, and that it never prints the key."""
import json

from aankhen import netlink as nl
from aankhen.protocol import CsiPacket, Frame, FrameType
from aankhen.tools import smoke_board as sb
from aankhen.transport import CallbackSource


def _csi(seq, rssi=-50, n=64):
    return CsiPacket(seq * 10_000, seq, rssi, -95, 6, 0, 1, 0, 0, 0, b"\x01" * 6, bytes(2 * n)).to_frame().encode()


def _status(fields, seq=0):
    return Frame(FrameType.STATUS, seq, 0, json.dumps(fields).encode()).encode()


class Clock:
    def __init__(self):
        self.t = 0.0

    def __call__(self):
        self.t += 0.001
        return self.t


def test_collect_counts_csi_rssi_and_subcarriers():
    chunks = [_csi(i, rssi=-40 - i % 5) for i in range(300)] + [_status({"wifi": "connected", "csi_hz": 50})]
    src = CallbackSource(lambda: iter(chunks)).start()
    r = sb.collect(src, 3.0, sb.Report(link="usb", where="COM9"), clock=Clock())
    assert r.csi == 300 and r.main_subcarriers == 64
    assert min(r.rssi) == -44 and max(r.rssi) == -40
    assert r.last_status["csi_hz"] == 50
    ok, why = sb.verdict(r)
    assert ok, why


def test_verdict_names_the_wifi_join_failure():
    r = sb.Report(link="usb", where="COM9", seconds=20, status=20,
                  last_status={"wifi": "connecting", "rssi": -91})
    ok, why = sb.verdict(r)
    assert not ok and "connecting" in why[0] and "-91" in why[0]


def test_verdict_fails_slow_rate_bad_hmac_and_no_board():
    slow = sb.Report(link="wifi", seconds=20, csi=40, subcarriers={64: 40}, hmac_ok=40, hmac_bad=0)
    assert not sb.verdict(slow)[0]
    bad = sb.Report(link="wifi", seconds=10, csi=500, subcarriers={64: 500}, hmac_ok=60, hmac_bad=3)
    ok, why = sb.verdict(bad)
    assert not ok and "HMAC" in why[0]
    assert sb.verdict(sb.Report())[0] is False


def test_render_shows_fingerprint_never_the_key(tmp_path, monkeypatch):
    key = nl.new_key()
    f = tmp_path / "esp32_link.json"
    f.write_text(json.dumps({"key": key.hex(), "last_ip": "192.168.1.40"}), encoding="utf-8")
    k, addrs = sb.load_link(f)
    assert k == key and addrs[0] == "192.168.1.40"
    r = sb.Report(link="wifi", where="192.168.1.40", seconds=10, csi=300, subcarriers={64: 300},
                  hmac_ok=40, hmac_bad=0, last_status={"wifi": "connected", "net": {"key": nl.fingerprint(key)}})
    text = "\n".join(sb.render(r, nl.fingerprint(key)))
    assert key.hex() not in text and nl.fingerprint(key) in text and "key matches" in text


def test_main_without_a_board_says_fail(tmp_path, monkeypatch, capsys):
    monkeypatch.setattr(sb, "list_candidate_ports", lambda: [])
    monkeypatch.setenv("JARVIS_DATA_DIR", str(tmp_path))          # no link file: Wi-Fi is skipped
    assert sb.main(["--seconds", "0.1"]) == 1
    out = capsys.readouterr().out
    assert "FAIL" in out and "no board" in out
