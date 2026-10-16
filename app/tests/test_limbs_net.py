"""Limbs over the ESP32's Wi-Fi link, end to end: the real AankhenHub and NetSource
against aankhen's FakeNetBoard on 127.0.0.1 (nothing on the LAN, no serial port), with
the wall box's devices.json. A switch counts only with the board's confirmation, an
offline board is a clear error, modes and the presence rule drive ESP32 devices, and a
reconnect adopts the board's state."""
import json
import shutil
import time

import pytest

from aankhen.hub import AankhenHub
from aankhen.journal import ActivityJournal
from aankhen.netlink import NetConfig
from aankhen.tests.fakenet import FakeNetBoard
from aankhen.tests.fakeserial import FakeUsb
from jarvis_app.bus import EventBus
from jarvis_app.limbs import Limbs
from jarvis_app.paths import APP
from jarvis_app.presence_on import PresenceOn

KEY = bytes(range(100, 132))


class FakeCore:
    running = False
    room_listener = None

    def info(self):
        return {"running": False}

    def room_command(self, *a):
        pass


def wait_for(cond, timeout=6.0, step=0.02):
    t0 = time.monotonic()
    while time.monotonic() - t0 < timeout:
        if cond():
            return True
        time.sleep(step)
    return cond()


@pytest.fixture
def rig(tmp_path, monkeypatch):
    monkeypatch.setenv("AANKHEN_TEACHERS", "0")
    shutil.copy(APP / "jarvis_app" / "devices.esp32-box.example.json", tmp_path / "devices.json")
    board = FakeNetBoard(KEY).start()
    hub = AankhenHub(boards=FakeUsb().finder(window_s=0.3))
    hub.journal = ActivityJournal(folder=str(tmp_path / "activity"))
    hub.net_config = lambda: NetConfig(KEY, ["127.0.0.1"], "wifi", board.port, 0)
    bus = EventBus()
    events = []
    real = bus.publish
    bus.publish = lambda *a, **k: (events.append((a, k)), real(*a, **k))[1]
    limbs = Limbs(FakeCore(), hub, bus, path=tmp_path / "room.json", sleep=lambda s: None)
    hub.start("hardware")
    assert wait_for(lambda: hub.can_command)
    yield board, hub, limbs, events
    hub.stop()
    board.stop()


def test_switches_go_over_wifi_and_count_only_when_the_board_confirms(rig):
    board, hub, limbs, events = rig
    r = limbs.apply("light2", "on")
    assert r["delivered"] == {"light2": True} and board.relays["light2"] is True
    assert board.commands[-1] == {"relay": "light2", "on": True}
    v = limbs.view()
    d = next(x for x in v["devices"] if x["id"] == "light2")
    assert d["link"] == "wifi" and d["hardware_on"] is True and d["confirmed"] is True
    assert v["esp32"]["how"] == "Wi-Fi (127.0.0.1, -58 dBm)"
    assert v["esp32"]["pin_mismatch"] == []                    # devices.json and RELAY_TABLE agree


def test_a_mode_switches_every_esp32_relay(rig):
    board, hub, limbs, events = rig
    limbs.apply("all", "on")
    assert all(board.relays.values())
    limbs.scene("all_off")
    assert not any(board.relays.values())
    limbs.scene("focus")
    assert board.relays["light"] and board.relays["fan"] and not board.relays["light2"]


def test_an_offline_board_is_a_clear_error_and_the_switch_does_not_count(rig):
    board, hub, limbs, events = rig
    hub.source.timeout_s = 0.4
    board.silent = True
    assert wait_for(lambda: not hub.can_command)
    r = limbs.apply("light", "on")
    assert r["delivered"] == {"light": False}
    failed = [k for a, k in events if a[:2] == ("limbs", "relay_failed")]
    assert failed and "not answering over Wi-Fi (127.0.0.1)" in failed[-1]["reason"]
    assert board.relays["light"] is False
    assert next(d for d in limbs.view()["devices"] if d["id"] == "light")["link"] == "virtual"


def test_a_reconnect_adopts_the_board_state(rig):
    board, hub, limbs, events = rig
    limbs.apply("fan", "on")
    board.restart()                                            # a power cut: the board's relays OFF
    hub.source.timeout_s = 0.4
    assert wait_for(lambda: hub.source.net.handshakes >= 2 and hub.can_command, timeout=6)
    assert limbs.resync_hardware() == {"fan": False}           # what server.aankhen_watch calls
    assert limbs.state["fan"] == {"on": False} and board.commands[-1] == {"relay": "fan", "on": True}


def test_the_presence_rule_drives_esp32_devices(rig, tmp_path):
    board, hub, limbs, events = rig
    pres = PresenceOn(limbs, limbs.bus, hub=hub, path=tmp_path / "presence_on.json", idle_s=lambda: 5.0,
                      sleep=lambda s: None)
    pres.settings["quiet_start"] = pres.settings["quiet_end"] = "00:00"   # no quiet hours in a test
    out = pres.run()
    assert out is not None and board.relays["light"] and board.relays["fan"]


def test_a_relay_that_is_not_wired_on_the_board_is_said(tmp_path, monkeypatch):
    monkeypatch.setenv("AANKHEN_TEACHERS", "0")
    shutil.copy(APP / "jarvis_app" / "devices.esp32-box.example.json", tmp_path / "devices.json")
    board = FakeNetBoard(KEY, unwired=("light4",)).start()
    hub = AankhenHub(boards=FakeUsb().finder(window_s=0.3))
    hub.journal = ActivityJournal(folder=str(tmp_path / "activity"))
    hub.net_config = lambda: NetConfig(KEY, ["127.0.0.1"], "wifi", board.port, 0)
    try:
        limbs = Limbs(FakeCore(), hub, EventBus(), path=tmp_path / "room.json", sleep=lambda s: None)
        hub.start("hardware")
        assert wait_for(lambda: hub.can_command)
        assert limbs.apply("light4", "on")["delivered"] == {"light4": False}
        assert limbs.view()["esp32"]["missing_channels"] == ["light4"]
        assert json.loads((tmp_path / "room.json").read_text())["light4"] == {"on": False}
    finally:
        hub.stop()
        board.stop()
