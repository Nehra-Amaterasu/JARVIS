"""10-25 P0: "Aankhen does not read the board". What the investigation found, as tests
(docs/research/2026-10-23-test-audit-aankhen.md, section P0):

  - a 3.5.0 board's USB bytes (LOG + STATUS frames, its STATUS fields) decode and
    identify the port, exactly as before;
  - a 3.5.0 board that cannot join the Wi-Fi blocks 20 s of every ~35 s in
    connectWifi() and says nothing: a port it was silent on (or that showed the ROM's
    text boot log) was never asked again after 30 s, so the hub ran the simulation
    beside a working board. Espressif's native USB port is now asked again;
  - one exception in the engine (threadpoolctl's OSError, seen in jarvis.log) ended the
    consumer thread for good: now it costs one packet and is reported;
  - the hub says WHY in one code and one sentence (hub.why), and the viewer shows it.
Fakes only: no serial port is opened, nothing goes to the LAN."""
import json
import queue
import threading
import time

import numpy as np
import pytest

from aankhen.boards import NATIVE_USB_VIDS, probe_port
from aankhen.hub import AankhenHub
from aankhen.netlink import fingerprint
from aankhen.protocol import Frame, FrameType, StreamDecoder

from .fakeserial import FakeBoard, FakeUsb

ESPRESSIF = dict(vid=0x303A, pid=0x1001)
# The STATUS a 3.5.0 board sends while it cannot join the Wi-Fi: the field set read off
# the real board on COM9 (10-25), values made up (no network name, no address).
STATUS_350_NO_WIFI = {
    "relay_pins": {"light": 4, "fan": 5, "light2": 6, "light3": 7, "light4": 8},
    "wifi": "connecting", "ip": "0.0.0.0", "mdns": None, "rssi": -91, "channel": 9, "csi_hz": 0,
    "csi_dropped": 0, "csi_rejected": 0, "radar_frames": 0, "radar_bad": 0, "mqtt": False, "http": False,
    "heap_free": 187108, "crc_ok": True, "gain": "recording", "ota": False, "reset": "power-on",
    "beacon_enabled": True, "beacon": {"ip": None, "mac_known": False, "pings_ok": 0, "rate_hz": 0, "rssi": None,
                                       "dropped": 0, "rejected": 0, "fallback": False},
    "net": {"key": "", "port": 47269, "peer": None, "dgrams": 0, "cmds": 0, "bad": 0, "replays": 0, "fail": 0}}
ROM_BOOT_TEXT = (b"ESP-ROM:esp32s3-20210327\r\nBuild:Mar 27 2021\r\nrst:0x1 (POWERON),boot:0x8 "
                 b"(SPI_FAST_FLASH_BOOT)\r\nSPIWP:0xee\r\nmode:DIO, clock div:1\r\nentry 0x403c98d0\r\n")


def wait_for(cond, timeout=6.0, step=0.02):
    t0 = time.monotonic()
    while time.monotonic() - t0 < timeout:
        if cond():
            return True
        time.sleep(step)
    return cond()


def _board_350(**kw):
    return FakeBoard("COM9", "esp32", fw="aankhen-3.5.0", status=STATUS_350_NO_WIFI, **{**ESPRESSIF, **kw})


# ---------------------------------------------------------------- the 3.5.0 wire format
def test_a_350_board_talking_while_it_joins_wifi_is_identified():
    usb = FakeUsb(_board_350(period_s=0.1))
    log = Frame(FrameType.LOG, 1, 1_000_000, b"joining home-wifi").encode()
    usb.boards["COM9"].preamble = ROM_BOOT_TEXT + log          # boot log, then the firmware's frames
    r = probe_port("COM9", usb.opener, window_s=1.0)
    assert r.verdict == "aankhen" and r.frame == "LOG"
    st = probe_port("COM9", FakeUsb(_board_350(period_s=0.1)).opener, window_s=1.0)
    assert st.verdict == "aankhen" and st.fw == "aankhen-3.5.0"
    # ... and its STATUS, as long as the real one, decodes whole
    body = json.dumps({"fw": "aankhen-3.5.0", "uptime_s": 160.4, "relays": {}, **STATUS_350_NO_WIFI}).encode()
    assert len(body) < 1000                                     # firmware STATUS_MAX
    frames = list(StreamDecoder().feed(Frame(FrameType.STATUS, 7, 160_400_000, body).encode()))
    assert json.loads(frames[0].payload)["net"]["port"] == 47269


# ---------------------------------------------------------------- the finder asks again
def test_a_silent_espressif_port_is_asked_again_after_the_boot_grace():
    """The board was inside connectWifi() (silent) at the first looks; it talks later.
    Boot grace 0 s: the old rule would never ask again."""
    board = _board_350(talks_at=time.monotonic() + 0.6, period_s=0.1)
    usb = FakeUsb(board)
    f = usb.finder(window_s=0.2, boot_grace_s=0.0, native_retry_s=0.3)
    assert f.find() is None and f.results()[0].verdict == "silent"
    assert wait_for(lambda: f.find() == "COM9", timeout=4)


def test_an_espressif_port_seen_booting_is_not_written_off():
    """A look during the boot reads the ROM's plain text: "foreign" no longer sticks."""
    board = _board_350(talks_at=time.monotonic() + 0.5, period_s=0.1)
    board.preamble = ROM_BOOT_TEXT
    usb = FakeUsb(board)
    f = usb.finder(window_s=0.2, native_retry_s=0.3)
    assert f.find() is None and f.results()[0].verdict == "foreign"
    board.preamble = b""
    assert wait_for(lambda: f.find() == "COM9", timeout=4)


def test_a_ch340_port_is_still_left_alone_once_it_said_not_aankhen():
    """The Uno rule is unchanged: opening a CH340 can pulse an Uno's reset line."""
    uno = FakeBoard("COM5", "uno")
    usb = FakeUsb(uno)
    f = usb.finder(window_s=0.2, native_retry_s=0.05)
    assert 0x1A86 not in NATIVE_USB_VIDS
    f.find()
    opens = uno.opens
    for _ in range(5):
        time.sleep(0.06)
        f.find()
    assert uno.opens == opens == 1


# ---------------------------------------------------------------- the consumer survives
class _Src:
    def __init__(self):
        self.packets = queue.Queue()


def test_one_failing_packet_does_not_end_the_engine_thread():
    from aankhen.engine import Engine, run_engine
    from aankhen.protocol import StatusPacket
    from aankhen.room import default_room
    eng = Engine(default_room(), "hardware")
    real = eng.process
    calls = []

    def flaky(pkt):
        calls.append(pkt)
        if len(calls) == 1:
            raise OSError("GetModuleFileNameEx failed")         # what threadpoolctl raised on 10-24
        real(pkt)
    eng.process = flaky
    src, stop = _Src(), threading.Event()
    th = threading.Thread(target=run_engine, args=(src, eng, stop), daemon=True)
    th.start()
    try:
        for k in range(3):
            src.packets.put(StatusPacket(int((k + 1) * 1e6), k, {"fw": "aankhen-3.5.0"}))
        assert wait_for(lambda: len(calls) == 3)
        assert th.is_alive() and eng.firmware() == "aankhen-3.5.0"
        st = eng.status_message()
        assert st["engine_errors"] == 1 and "GetModuleFileNameEx" in st["engine_last_error"]["error"]
    finally:
        stop.set()
        th.join(2)


def test_a_failing_thread_limit_still_answers(monkeypatch):
    from aankhen import learn

    class Clf:
        def predict_proba(self, X):
            return np.tile([0.25, 0.75], (len(X), 1))

    class BadCtl:
        def limit(self, **kw):
            raise OSError("GetModuleFileNameEx failed")

    monkeypatch.setattr(learn, "_openmp_controller", lambda: BadCtl())
    assert np.allclose(learn._proba_one_thread(Clf(), np.zeros((1, 3))), [[0.25, 0.75]])
    monkeypatch.setattr(learn, "_openmp_controller", lambda: None)
    assert np.allclose(learn._proba_one_thread(Clf(), np.zeros((2, 3))), [[0.25, 0.75]] * 2)


# ---------------------------------------------------------------- the hub says why
@pytest.fixture
def hub_with(sim_baseline, tmp_path, monkeypatch):
    monkeypatch.setenv("AANKHEN_TEACHERS", "0")
    hubs = []

    def make(usb, cfg=None):
        h = AankhenHub(boards=usb.finder(window_s=0.3, native_retry_s=0.3))
        h._sim_baseline = sim_baseline
        if cfg is not None:
            h.net_config = lambda: cfg
            h.net_prober = lambda c: None                       # the board does not answer on Wi-Fi
        hubs.append(h)
        return h
    yield make
    for h in hubs:
        h.stop()


def test_why_a_board_on_usb_without_wifi_gives_no_sensing(hub_with):
    hub = hub_with(FakeUsb(_board_350(period_s=0.1)))
    assert hub.start("auto")["mode"] == "hardware"
    assert wait_for(lambda: hub.why()["code"] == "board_no_wifi")
    w = hub.why()
    assert "not on the Wi-Fi" in w["text"] and "-91 dBm" in w["text"]
    assert hub.info()["why"]["code"] == "board_no_wifi" and hub.status()["hub"]["why"]["code"] == "board_no_wifi"


def test_why_the_port_is_busy_and_the_simulation_runs(hub_with):
    hub = hub_with(FakeUsb(FakeBoard("COM9", "busy", **ESPRESSIF)))
    assert hub.start("auto")["mode"] == "simulation"
    w = hub.why()
    assert w["code"] == "usb_busy" and "COM9" in w["text"] and w["text"].startswith("Simulation running")


def test_why_wifi_key_mismatch_and_firewall(hub_with):
    from aankhen.netlink import NetConfig
    key = bytes(range(32))
    cfg = NetConfig(key=key, addresses=["192.0.2.10"], prefer="auto")
    hub = hub_with(FakeUsb(), cfg)
    hub.start("auto")
    hub._probe_net(cfg)                                          # no WELCOME
    hub._last_board_status = {"wifi": "connected", "net": {"key": "deadbeef"}}
    w = hub.why()
    assert w["wifi"]["code"] == "wifi_key_mismatch" and fingerprint(key) in w["text"]
    hub._last_board_status = {"wifi": "connected", "net": {"key": fingerprint(key)}}
    w = hub.why()
    assert w["wifi"]["code"] == "wifi_no_answer" and "Firewall" in w["text"] and "47270" in w["text"]
    hub._last_board_status = {"wifi": "connected", "net": None}
    assert hub.why()["wifi"]["code"] == "wifi_link_off"
