"""The Uno relay transport (jarvis_app/uno.py) and limbs.py driving it, against a
fake serial port that speaks the firmware's protocol. No real port is ever opened."""
import json
import types

import pytest

from jarvis_app import uno
from jarvis_app.bus import EventBus
from jarvis_app.limbs import Limbs


@pytest.fixture(autouse=True)
def _short_waits(monkeypatch):
    """A deaf fake answers nothing at once; waiting the real 4 s banner and 1.5 s reply
    windows for that cost 7 s a run (10-23 audit). The logic is the same with 50 ms."""
    monkeypatch.setattr(uno, "BANNER_S", 0.05)
    monkeypatch.setattr(uno, "REPLY_S", 0.05)


@pytest.fixture(autouse=True)
def _no_claims_leak():
    from aankhen import transport
    transport.CLAIMED_PORTS.clear()
    yield
    transport.CLAIMED_PORTS.clear()


class FakeUno:
    """limbs/uno_relay/uno_relay.ino 1.0.0 as seen over serial."""

    def __init__(self, port="COM8", banner=True, deaf=False, broken=False):
        self.port, self.deaf, self.broken = port, deaf, broken
        self.state = {"light": False, "fan": False}
        self.out = []
        if banner:
            self.out.append(json.dumps({"board": "jarvis-uno-relay", "version": "1.0.0",
                                        "pins": {"light": 4, "fan": 5}}))
            self.out.append(json.dumps(self.state))
        self.written, self.closed, self.too_fast = [], False, 0

    def readline(self):
        if self.broken:
            raise OSError("device disconnected")
        return (self.out.pop(0) + "\n").encode() if self.out else b""

    def reset_input_buffer(self):
        self.out.clear()                     # as a real port drops what is waiting

    def write(self, data):
        if self.broken:
            raise OSError("device disconnected")
        cmd = data.decode().strip()
        self.written.append(cmd)
        if self.deaf:
            return
        if self.too_fast:
            self.too_fast -= 1
            self.out.append(json.dumps({"error": "too fast, wait a moment"}))
            return
        parts = cmd.split()
        if parts == ["status"]:
            pass
        elif parts == ["all", "off"]:
            self.state = {"light": False, "fan": False}
        elif len(parts) == 2 and parts[0] in self.state and parts[1] in ("on", "off"):
            self.state[parts[0]] = parts[1] == "on"
        else:
            self.out.append(json.dumps({"error": f"unknown command: {cmd}"}))
            return
        self.out.append(json.dumps(self.state))

    def close(self):
        self.closed = True


def ports(*vids):
    return lambda: [types.SimpleNamespace(device=f"COM{8 + i}", vid=v) for i, v in enumerate(vids)]


def relays(fake=None, comports=ports(0x2341), opener=None):
    fake = fake or FakeUno()
    r = uno.UnoRelays(None, opener=opener or (lambda port: fake), comports=comports, sleep=lambda s: None)
    return r, fake


def test_it_finds_the_uno_by_usb_id_and_waits_for_the_banner():
    r, fake = relays(comports=ports(0x303A, 0x2341))          # the ESP32 first, then the Uno
    assert r.connect() and r.port == "COM9" and r.version == "1.0.0"
    assert r.state == {"light": False, "fan": False}


def test_a_switch_counts_only_when_the_board_confirms_it():
    r, fake = relays()
    assert r.set("light", True) == (True, "")
    assert fake.written[-1] == "light on" and r.state["light"] is True
    deaf, _ = relays(FakeUno(deaf=True))
    deaf.connect()
    ok, why = deaf.set("fan", True)
    assert not ok and why


def test_too_fast_is_retried_once():
    r, fake = relays()
    r.connect()
    fake.too_fast = 1
    assert r.set("fan", True)[0] and fake.written[-2:] == ["fan on", "fan on"]


def test_access_denied_is_said_plainly():
    def opener(port):
        raise PermissionError("could not open port 'COM8': PermissionError(13, 'Access is denied.', None, 5)")
    r = uno.UnoRelays(None, opener=opener, comports=ports(0x2341))
    assert not r.connect() and "Serial Monitor" in r.error


def test_an_unplug_drops_the_link_and_frees_the_port_then_it_comes_back():
    from aankhen import transport
    r, fake = relays()
    r.connect()
    assert "COM8" in transport.CLAIMED_PORTS
    fake.broken = True
    ok, why = r.set("light", True)
    assert not ok and not r.connected and "COM8" not in transport.CLAIMED_PORTS
    r.opener = lambda port: FakeUno()
    assert r.set("light", True) == (True, "")                  # reconnects on the next use


def test_no_uno_means_no_link_not_a_crash():
    r = uno.UnoRelays(None, opener=lambda p: FakeUno(), comports=ports(0x303A))
    assert r.set("light", True) == (False, "No Arduino Uno on USB.")


def test_aankhen_never_probes_an_uno_or_a_claimed_port():
    from aankhen import transport
    listed = lambda: [types.SimpleNamespace(device="COM8", vid=0x2341, pid=0x43, description="Arduino Uno"),
                      types.SimpleNamespace(device="COM9", vid=0x303A, pid=0x1001, description="ESP32-S3"),
                      types.SimpleNamespace(device="COM5", vid=0x1A86, pid=0x7523, description="CH340")]
    transport.CLAIMED_PORTS.add("COM5")
    try:
        assert [c.device for c in transport.list_candidate_ports(comports=listed)] == ["COM9"]
    finally:
        transport.CLAIMED_PORTS.discard("COM5")


# ------------------------------------------------------------------ limbs.py on the Uno
class FakeCore:
    running = False
    room_listener = None

    def info(self):
        return {"running": False, "mqtt": False}


class EspHub:
    """An ESP32 that would 'confirm' relays nothing is wired to: must never be used."""
    can_command = True

    def __init__(self):
        self.sent = []

    def command(self, payload):
        self.sent.append(payload)
        return True

    def device_status(self):
        return {"relays": {"light": True, "fan": True}}


@pytest.fixture
def room(tmp_path):
    r, fake = relays()
    r.connect()
    hub = EspHub()
    limbs = Limbs(FakeCore(), hub, EventBus(), path=tmp_path / "room.json", circuits=None, relays=r)
    return types.SimpleNamespace(limbs=limbs, fake=fake, relays=r, hub=hub)


def test_the_app_buttons_drive_the_uno_and_never_the_esp32(room):
    out = room.limbs.apply("light", "on", origin="app")
    assert out["delivered"] == {"light": True} and room.fake.state["light"] is True
    out = room.limbs.apply("all", "off", origin="voice")
    assert room.fake.state == {"light": False, "fan": False}
    assert room.hub.sent == []
    v = room.limbs.view()
    light = next(d for d in v["devices"] if d["id"] == "light")
    assert v["usb"] and light["hardware_on"] is False and light["confirmed"]
    assert "Arduino Uno" in v["hardware"]


def test_a_board_that_does_not_confirm_is_reported_not_claimed(room):
    room.fake.deaf = True
    out = room.limbs.apply("fan", "on", origin="voice")
    assert out["delivered"] == {"fan": False}
    fan = next(d for d in room.limbs.view()["devices"] if d["id"] == "fan")
    assert fan["state"]["on"] is False and fan["hardware_on"] is False   # the tile shows the board, not the wish


def test_on_reconnect_the_room_adopts_the_board_not_yesterdays_file(room, tmp_path):
    room.limbs.apply("light", "on")
    room.relays.state = {"light": False, "fan": False}          # the Uno was reset: relays boot OFF
    assert room.limbs.adopt_board() == ["light"]
    assert room.limbs.state["light"]["on"] is False
    assert room.limbs.resync_hardware() == {}                   # never pushes the file onto the Uno


# ------------------------------------------------------------------ N channels (firmware 1.1.0), same protocol
class FakeUno11(FakeUno):
    """uno_relay.ino 1.1.0: a third channel in the pin table, the same protocol."""

    def __init__(self, **kw):
        super().__init__(banner=False, **kw)
        self.state = {"light": False, "fan": False, "lamp": False}
        self.out = [json.dumps({"board": "jarvis-uno-relay", "version": "1.1.0",
                                "pins": {"light": 4, "fan": 5, "lamp": 6}}), json.dumps(self.state)]


def test_firmware_1_1_channels_come_from_the_board():
    r, fake = relays(FakeUno11())
    assert r.connect() and r.version == "1.1.0" and r.pins == {"light": 4, "fan": 5, "lamp": 6}
    assert r.set("lamp", True) == (True, "") and fake.written[-1] == "lamp on"
    assert r.view()["channels"] == ["light", "fan", "lamp"]


def test_firmware_1_0_replies_still_read_and_a_missing_channel_is_said():
    r, fake = relays()                                      # 1.0.0: light and fan only
    assert r.connect() and r.state == {"light": False, "fan": False}
    ok, why = r.set("lamp", True)
    assert not ok and "no lamp channel" in why and "1.1.0" in why
    assert "lamp on" not in fake.written                     # never sent to a board without it


def test_only_whole_state_lines_count_as_state():
    assert uno.is_state({"light": True, "fan": False})
    assert not uno.is_state({"board": "jarvis-uno-relay", "version": "1.1.0", "pins": {"light": 4}})
    assert not uno.is_state({"error": "unknown device"}) and not uno.is_state({"scan_pin": 6})
    assert not uno.is_state({})
