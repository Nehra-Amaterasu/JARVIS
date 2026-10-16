"""The hub and the Wi-Fi link: which link it picks, relays switched with the board's
confirmation, a clear word when the board is offline, and the watcher following the
board between USB and Wi-Fi. Fakes only: FakeNetBoard on 127.0.0.1 and fakeserial's
FakeUsb; no serial port is opened and nothing is sent to the LAN."""
import time

import pytest

from aankhen import hub as hub_mod
from aankhen.bench import simulated_baseline
from aankhen.hub import AankhenHub
from aankhen.journal import ActivityJournal
from aankhen.netlink import NetConfig
from aankhen.room import load_room
from aankhen.transport import NetSource, SerialSource, probe_board

from .fakenet import FakeNetBoard
from .fakeserial import FakeBoard, FakeUsb

KEY = bytes(range(1, 33))


def wait_for(cond, timeout=6.0, step=0.02):
    t0 = time.monotonic()
    while time.monotonic() - t0 < timeout:
        if cond():
            return True
        time.sleep(step)
    return cond()


@pytest.fixture(scope="module")
def sim_baseline():
    room, _ = load_room()
    return simulated_baseline(room)


@pytest.fixture
def rig(sim_baseline, tmp_path, monkeypatch):
    """make(board=..., usb=..., prefer=...) -> hub wired to the fake board."""
    monkeypatch.setenv("AANKHEN_TEACHERS", "0")
    made = []

    def make(board=None, usb=None, prefer="auto", key=KEY, addresses=None):
        usb = usb or FakeUsb()
        hub = AankhenHub(boards=usb.finder(window_s=0.3))
        hub._sim_baseline = sim_baseline
        hub.journal = ActivityJournal(folder=str(tmp_path / "activity"))   # never the real day log
        port = board.port if board is not None else 9
        cfg = NetConfig(key=key, addresses=["127.0.0.1"] if addresses is None else addresses,
                        prefer=prefer, board_port=port, host_port=0)
        hub.net_config = lambda: cfg
        hub.net_prober = lambda c: probe_board(c.key, c.addresses, c.board_port, 0, 0.3)
        peers = []
        hub.on_net_peer = peers.append
        hub.peers = peers
        made.append(hub)
        return hub
    yield make
    for h in made:
        h.stop()


@pytest.fixture
def board():
    b = FakeNetBoard(KEY).start()
    yield b
    b.stop()


def _net_source(hub, **kw):
    """The hub's own NetSource with test timings (the real ones are seconds)."""
    src = hub.source
    for k, v in kw.items():
        setattr(src, k, v)
    return src


# ------------------------------------------------------------------ which link
def test_auto_without_usb_finds_the_board_on_wifi(rig, board):
    hub = rig(board)
    info = hub.start("auto")
    assert info["mode"] == "hardware" and info["link"] == "wifi" and info["kind"] == "hardware"
    assert isinstance(hub.source, NetSource) and info["port"] is None
    assert wait_for(lambda: hub.can_command)
    b = hub.info()["board"]
    assert b["link"] == "wifi" and b["address"] == "127.0.0.1" and b["handshake"] and b["fw"] == "aankhen-3.5.0"
    assert b["rssi"] == -58 and b["net"]["handshakes"] == 1
    assert "127.0.0.1" in hub.peers                                # the app remembers where it answered


def test_auto_prefers_usb_when_a_board_is_on_usb(rig, board):
    usb = FakeUsb(FakeBoard("COM7", "esp32"))
    hub = rig(board, usb)
    info = hub.start("auto")
    assert info["link"] == "usb" and isinstance(hub.source, SerialSource) and info["port"] == "COM7"
    assert board.counts["hello"] == 0                              # USB found: Wi-Fi never asked


def test_prefer_wifi_uses_wifi_even_with_a_usb_board(rig, board):
    usb = FakeUsb(FakeBoard("COM7", "esp32"))
    hub = rig(board, usb, prefer="wifi")
    assert hub.start("hardware")["link"] == "wifi"
    assert wait_for(lambda: hub.can_command)
    assert usb.boards["COM7"].opens == 0                           # the USB port was never opened


def test_prefer_usb_without_a_usb_board_says_so(rig, board):
    hub = rig(board, prefer="usb")
    with pytest.raises(FileNotFoundError, match="No ESP32 found on USB"):
        hub.start("hardware")
    assert board.counts["hello"] == 0


def test_auto_with_the_board_silent_runs_the_simulation(rig, board):
    board.silent = True
    hub = rig(board)
    assert hub.start("auto")["mode"] == "simulation"
    assert hub.info()["net"]["last_probe"]["ok"] is False


def test_wifi_without_a_key_or_an_address_is_refused_with_the_next_step(rig, board):
    hub = rig(board, key=None, prefer="wifi")
    with pytest.raises(FileNotFoundError, match="no key yet"):
        hub.start("hardware")
    hub = rig(board, addresses=[], prefer="wifi")
    with pytest.raises(FileNotFoundError, match="no address"):
        hub.start("hardware")


# ------------------------------------------------------------------ relays over Wi-Fi
def test_set_relay_counts_only_when_the_board_reports_it(rig, board):
    hub = rig(board)
    hub.start("hardware", link="wifi")
    assert wait_for(lambda: hub.can_command)
    assert hub.set_relay("light3", True) == (True, "")
    assert board.relays["light3"] is True
    assert hub.set_relay("light3", False) == (True, "")
    ok, why = hub.set_relay("porch", True)
    assert not ok and "has no porch relay" in why and "light4" in why
    assert hub.board_relays() == board.relays


def test_a_relay_on_pin_minus_one_is_said_to_be_unwired():
    b = FakeNetBoard(KEY, unwired=("light4",)).start()
    try:
        hub = AankhenHub(boards=FakeUsb().finder(window_s=0.3))
        hub.net_config = lambda: NetConfig(KEY, ["127.0.0.1"], "wifi", b.port, 0)
        hub.start("hardware")
        assert wait_for(lambda: hub.can_command)
        ok, why = hub.set_relay("light4", True)
        assert not ok and "not wired" in why
    finally:
        hub.stop()
        b.stop()


def test_a_lost_command_is_sent_again_once(rig, board):
    hub = rig(board)
    hub.start("hardware", link="wifi")
    assert wait_for(lambda: hub.can_command)
    board.drop_cmds = 1                                            # the first CMD datagram vanishes
    t0 = time.monotonic()
    assert hub.set_relay("fan", True, timeout_s=0.4) == (True, "")
    assert board.relays["fan"] is True and time.monotonic() - t0 < 1.5


def test_an_offline_board_is_a_clear_error_not_a_hang(rig, board):
    hub = rig(board)
    hub.start("hardware", link="wifi")
    assert wait_for(lambda: hub.can_command)
    _net_source(hub, timeout_s=0.5)
    board.silent = True
    assert wait_for(lambda: not hub.can_command, timeout=4)
    t0 = time.monotonic()
    ok, why = hub.set_relay("light", True)
    assert not ok and time.monotonic() - t0 < 0.1
    assert "not answering over Wi-Fi (127.0.0.1)" in why
    assert board.relays["light"] is False


def test_the_relays_keep_their_state_when_the_laptop_goes(rig, board):
    hub = rig(board)
    hub.start("hardware", link="wifi")
    assert wait_for(lambda: hub.can_command)
    assert hub.set_relay("light", True)[0]
    hub.stop()                                                     # the app closes: BYE
    assert wait_for(lambda: board.live is None)
    assert board.relays["light"] is True                           # the board did not touch it


# ------------------------------------------------------------------ downstream, unchanged
def test_the_engine_runs_on_wifi_frames_exactly_as_on_usb(rig, board):
    board.csi_hz = 200
    hub = rig(board)
    hub.start("hardware", link="wifi")
    assert wait_for(lambda: hub.engine is not None and hub.engine.device_status.get("fw") == "aankhen-3.5.0")
    assert wait_for(lambda: hub.engine.counters.get("csi_packets", 0) > 50
                    or hub.link()["frames_ok"] > 100, timeout=6)
    assert hub.engine.source_kind == "hardware" and hub.link()["crc_errors"] == 0
    st = hub.status()
    assert st["source"] == "hardware" and st["hub"]["link"] == "wifi"


def test_a_recording_on_wifi_holds_the_board_frames(rig, board, tmp_path):
    from aankhen.transport import ReplaySource
    board.csi_hz = 100
    hub = rig(board)
    hub.start("hardware", link="wifi")
    assert wait_for(lambda: hub.can_command)
    path = tmp_path / "drill.akr"
    hub.source.record_to(str(path), {"note": "test"})
    time.sleep(0.6)
    hub.source.stop_recording()
    rep = ReplaySource(str(path), speed=0).start()
    got = list(rep.iter_packets(timeout=0.2))
    assert sum(1 for p in got if type(p).__name__ == "CsiPacket") >= 30
    assert rep.decoder.stats.crc_errors == 0 and rep.meta["source"] == "hardware"


# ------------------------------------------------------------------ the watcher
def test_the_watcher_switches_from_the_simulation_when_the_board_answers(rig, board):
    board.silent = True
    hub = rig(board)
    events = []
    hub.enable_hotplug(lambda kind, text, **data: events.append((kind, text)), interval_s=60)
    assert hub.start("auto")["mode"] == "simulation"
    board.silent = False
    hub.net_probe_interval_s = 0.0
    assert hub.hotplug_tick() == "switched"
    assert hub.mode == "hardware" and hub.info()["link"] == "wifi"
    assert events and "over Wi-Fi at 127.0.0.1" in events[-1][1]


def test_usb_takes_over_from_wifi_and_wifi_takes_over_when_usb_goes(rig, board):
    usb = FakeUsb()
    hub = rig(board, usb)
    hub.enable_hotplug(lambda *a, **k: None, interval_s=60)
    assert hub.start("auto")["link"] == "wifi"
    usb.plug(FakeBoard("COM7", "esp32"))
    assert hub.hotplug_tick() == "switched"
    assert hub.info()["link"] == "usb" and wait_for(lambda: hub.can_command)
    usb.unplug("COM7")                                             # the board goes into the box
    hub.usb_gone_s, hub.net_probe_interval_s = 0.3, 0.0
    assert wait_for(lambda: not hub.can_command)
    assert wait_for(lambda: hub.hotplug_tick() == "switched", timeout=4)
    assert hub.info()["link"] == "wifi" and wait_for(lambda: hub.can_command)


def test_a_chosen_link_is_not_moved_by_the_watcher(rig, board):
    usb = FakeUsb()
    hub = rig(board, usb, prefer="wifi")
    hub.start("auto")
    usb.plug(FakeBoard("COM7", "esp32"))
    assert hub.hotplug_tick() is None and hub.info()["link"] == "wifi"


def test_hub_info_without_the_app_settings_is_unchanged(sim_baseline):
    hub = AankhenHub(boards=FakeUsb().finder(window_s=0.3))
    hub._sim_baseline = sim_baseline
    try:
        info = hub.start("auto")
        assert info["mode"] == "simulation" and info["link"] is None
        assert info["net"]["configured"] is False
        assert hub.set_relay("light", True) == (False, hub.offline_reason())
        assert "simulation" in hub.offline_reason()
    finally:
        hub.stop()


def test_constants_are_what_the_docs_say():
    assert hub_mod.NET_PROBE_WAIT_S <= 1.0 and hub_mod.RELAY_TRIES == 2
