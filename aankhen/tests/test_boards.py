"""F3: the right board on the right port — identified by what it says, not its USB id.

Fake serial ports only (tests/fakeserial.py): an Arduino-Uno-like port that prints
text, an ESP32-like port that sends Aankhen STATUS frames, silent and busy ports.
"""
import random
import time

import pytest

from aankhen.boards import BoardFinder, probe_port
from aankhen.hub import AankhenHub
from aankhen.protocol import Frame, FrameType
from aankhen.transport import SerialSource, list_candidate_ports

from .fakeserial import FakeBoard, FakeUsb


def wait_for(cond, timeout=5.0, step=0.02):
    t0 = time.monotonic()
    while time.monotonic() - t0 < timeout:
        if cond():
            return True
        time.sleep(step)
    return cond()


def uno(device="COM5", **kw):
    return FakeBoard(device, "uno", vid=0x1A86, pid=0x7523, **kw)


def esp32(device="COM7", vid=0x1A86, **kw):
    return FakeBoard(device, "esp32", vid=vid, pid=0x7523, **kw)


# ---------------------------------------------------------------- the probe
def test_a_port_is_the_board_only_after_it_sends_a_valid_frame():
    u, e = uno(), esp32()
    usb = FakeUsb(u, e)
    res = {r.device: r for r in usb.finder(window_s=0.6).scan()}
    assert res["COM5"].verdict == "foreign" and res["COM5"].bytes_read > 0
    assert res["COM7"].verdict == "aankhen"
    assert res["COM7"].frame == "STATUS" and res["COM7"].fw == "aankhen-3.1.0"
    # Probing only listens: neither board was sent a single byte.
    assert bytes(u.written) == b"" and bytes(e.written) == b""


def test_the_vendor_id_only_orders_the_probes():
    # Before F3 the first CH340 won: the Uno on COM3 would have been "the ESP32".
    u = uno("COM3")
    e = esp32("COM8", vid=0x10C4)                     # a CP210x dev board, sorted after
    nano = FakeBoard("COM9", "esp32", vid=0x2341, pid=0x0070)   # Arduino Nano ESP32: Arduino's id
    usb = FakeUsb(u, e, nano)
    ports = list_candidate_ports(comports=usb.comports)
    assert [p.device for p in ports] == ["COM3", "COM8", "COM9"]   # CH340/CP210x rank, then Arduino
    finder = usb.finder(window_s=0.6)
    assert finder.find() == "COM8"
    verdicts = {r.device: r.verdict for r in finder.results()}
    assert verdicts == {"COM3": "foreign", "COM8": "aankhen", "COM9": "aankhen"}


def test_espressif_native_usb_is_probed_first():
    usb = FakeUsb(uno("COM3"), esp32("COM12", vid=0x303A))
    assert [p.device for p in list_candidate_ports(comports=usb.comports)] == ["COM12", "COM3"]


def test_ports_without_a_usb_id_are_never_opened():
    bt = FakeBoard("COM4", "esp32", vid=None, pid=None)        # a Bluetooth "serial port"
    usb = FakeUsb(bt)
    assert usb.finder(window_s=0.3).scan() == []
    assert bt.opens == 0


def test_text_and_noise_are_never_mistaken_for_a_frame():
    rng = random.Random(7)
    noise = bytes(rng.getrandbits(8) for _ in range(64_000))
    # A frame with one flipped payload bit: right shape, wrong CRC.
    bad = bytearray(Frame(FrameType.STATUS, 1, 0, b'{"fw":"aankhen-3.1.0"}').encode())
    bad[20] ^= 0x01

    class Stream:
        def __init__(self, data):
            self.data = data

        def read(self, n):
            chunk, self.data = self.data[:n], self.data[n:]
            if not chunk:
                time.sleep(0.01)
            return chunk

        def close(self):
            pass

    for data in (b"Hello from the Uno\r\n" * 500, noise, bytes(bad) * 20):
        r = probe_port("COMX", opener=lambda d, b, data=data: Stream(data), window_s=0.3)
        assert r.verdict == "foreign", r.detail


def test_a_command_frame_is_not_a_greeting():
    """COMMAND frames go host -> board; a port that 'says' one is not the board."""
    cmd = Frame(FrameType.COMMAND, 1, 0, b'{"relay":"light","on":true}').encode()

    class Echo:
        def read(self, n):
            time.sleep(0.01)
            return cmd

        def close(self):
            pass

    assert probe_port("COMX", opener=lambda d, b: Echo(), window_s=0.2).verdict == "foreign"


def test_silent_and_busy_ports_say_so():
    usb = FakeUsb(FakeBoard("COM5", "silent"), FakeBoard("COM6", "busy"))
    res = {r.device: r for r in usb.finder(window_s=0.3).scan()}
    assert res["COM5"].verdict == "silent" and res["COM5"].bytes_read == 0
    assert res["COM6"].verdict == "busy" and "another program" in res["COM6"].detail


def test_ports_are_probed_in_parallel():
    usb = FakeUsb(*(FakeBoard(f"COM{i}", "silent") for i in range(3, 7)))
    t0 = time.monotonic()
    usb.finder(window_s=0.5).scan()
    assert time.monotonic() - t0 < 1.5                  # four silent windows, not 4 x 0.5 s in a row


# ------------------------------------------------------- how often we look
def test_a_foreign_port_is_left_alone_until_asked_or_replugged():
    u = uno()
    usb = FakeUsb(u)
    f = usb.finder(window_s=0.2, force_fresh_s=0.0)
    for _ in range(4):
        f.scan()
    assert u.opens == 1                                 # opening can reset an Uno: once is enough
    f.scan(force=True)                                  # a person asked for a fresh look
    assert u.opens == 2
    usb.unplug("COM5")
    f.scan()                                            # gone: forgotten
    usb.plug(u)
    f.scan()
    assert u.opens == 3                                 # plugged in again: looked at again


def test_a_silent_port_is_asked_again_only_while_it_may_be_booting():
    board = esp32(talks_at=time.monotonic() + 0.6)      # silent at first, like a board joining Wi-Fi
    usb = FakeUsb(board)
    f = usb.finder(window_s=0.2, boot_grace_s=2.5, silent_retry_s=0.0)
    assert f.scan()[0].verdict == "silent"
    assert wait_for(lambda: f.scan()[0].verdict == "aankhen", timeout=2.0)

    quiet = FakeBoard("COM9", "silent")
    usb2 = FakeUsb(quiet)
    g = usb2.finder(window_s=0.1, boot_grace_s=0.5, silent_retry_s=0.0, force_fresh_s=0.0)
    g.scan()
    g.scan()
    assert quiet.opens == 2                             # inside the grace period: asked again
    time.sleep(0.6)
    g.scan()
    g.scan()
    assert quiet.opens == 2                             # after it: left alone (an idle Uno stays un-reset)
    g.scan(force=True)
    assert quiet.opens == 3                             # unless a person asks


def test_a_busy_port_is_tried_again_later():
    b = FakeBoard("COM6", "busy")
    usb = FakeUsb(b)
    f = usb.finder(window_s=0.1, busy_retry_s=0.3)
    f.scan()
    f.scan()
    assert f.probes == 1
    time.sleep(0.35)
    f.scan()
    assert f.probes == 2


# ------------------------------------------------- the handshake gates writes
def test_serial_source_never_writes_to_a_port_that_has_not_identified_itself():
    u = uno()
    usb = FakeUsb(u)
    src = SerialSource("COM5", opener=usb.opener, finder=usb.finder(), reconnect_s=0.1).start()
    try:
        assert wait_for(lambda: u.opens >= 1)
        time.sleep(0.4)                                 # plenty of text, no frame
        assert not src.connected.is_set()
        assert src.write(Frame(FrameType.COMMAND, 1, 0, b'{"relay":"light","on":true}').encode()) is False
    finally:
        src.stop()
    assert bytes(u.written) == b""


def test_serial_source_writes_after_the_handshake():
    e = esp32()
    usb = FakeUsb(e)
    finder = usb.finder(window_s=0.5)
    src = SerialSource(None, opener=usb.opener, finder=finder, reconnect_s=0.1).start()
    try:
        assert wait_for(src.connected.is_set, timeout=3)
        assert src.port == "COM7" and src.fw == "aankhen-3.1.0" and src.handshake_at
        # Our own open port is "in use", never probed (it would read as busy).
        r = finder.scan()[0]
        assert r.verdict == "aankhen" and r.in_use
        assert src.write(b"\xAA\x55hello") is True
    finally:
        src.stop()
    assert bytes(e.written) == b"\xAA\x55hello"


def test_a_port_swapped_after_the_probe_is_let_go_unwritten():
    """The ESP32 answered on COM7; before Aankhen opened it, an Uno took COM7 (same
    CH340 ids, same COM number). The open connection never shows a frame, so nothing
    is written, and after the handshake timeout the port is looked at again."""
    e = esp32()
    usb = FakeUsb(e)
    finder = usb.finder(window_s=0.3)
    assert finder.find() == "COM7"
    u = uno("COM7")
    usb.boards["COM7"] = u                              # swapped between two looks
    src = SerialSource(None, opener=usb.opener, finder=finder, reconnect_s=0.1,
                       handshake_timeout_s=0.4).start()
    try:
        assert wait_for(lambda: u.opens >= 1)
        assert src.write(b"\xAA\x55relay") is False
        assert wait_for(lambda: any(r.device == "COM7" and r.verdict == "foreign"
                                    for r in finder.results()), timeout=3)
        assert not src.connected.is_set()
    finally:
        src.stop()
    assert bytes(u.written) == b""


# ------------------------------------------------------------- the hub
@pytest.fixture
def hub_on():
    hubs = []

    def make(usb, **kw):
        h = AankhenHub(boards=usb.finder(window_s=kw.pop("window_s", 0.5), **kw))
        hubs.append(h)
        return h
    yield make
    for h in hubs:
        h.stop()


def test_auto_start_with_only_an_uno_runs_the_simulator(hub_on):
    u = uno()
    hub = hub_on(FakeUsb(u))
    info = hub.start("auto")
    assert info["mode"] == "simulation" and info["requested_mode"] == "auto"
    assert hub.command({"relay": "light", "on": True}) is False
    assert bytes(u.written) == b""


def test_pressing_esp32_with_only_an_uno_says_what_the_uno_is(hub_on):
    u = uno()
    hub = hub_on(FakeUsb(u))
    with pytest.raises(FileNotFoundError, match="No ESP32") as e:
        hub.start("hardware")
    assert "COM5" in str(e.value) and "Aankhen frame" in str(e.value)
    assert bytes(u.written) == b""


def test_auto_start_picks_the_port_that_answers_and_only_it_gets_commands(hub_on):
    u, e = uno("COM3"), esp32("COM7")
    hub = hub_on(FakeUsb(u, e))
    info = hub.start("auto")
    assert info["mode"] == "hardware"
    assert wait_for(lambda: hub.can_command, timeout=3)
    b = hub.info()["board"]
    assert b["port"] == "COM7" and b["handshake"] and b["fw"] == "aankhen-3.1.0"
    assert hub.command({"relay": "light", "on": True}) is True
    assert bytes(e.written).startswith(b"\xAA\x55") and bytes(u.written) == b""


def test_board_info_reports_radar_frames_only_when_they_arrive(hub_on):
    e = esp32(radar=True, period_s=0.1)
    hub = hub_on(FakeUsb(e))
    hub.start("auto")
    assert wait_for(lambda: (hub.board_info().get("radar") or {}).get("frames", 0) > 2, timeout=3)
    r = hub.board_info()["radar"]
    assert r["last_s"] is not None and r["last_s"] < 1.0
    hub.stop()
    quiet = esp32("COM8", radar=False)
    hub2 = hub_on(FakeUsb(quiet))
    hub2.start("auto")
    assert wait_for(lambda: hub2.can_command, timeout=3)
    assert hub2.board_info()["radar"]["last_s"] is None
