"""The room owner: on/off only, commands match core/room.py exactly, modes are
editable on/off sets, devices come from devices.json, and the buttons work whether or
not JARVIS is awake. No serial port is ever opened (fakes only)."""
import importlib
import json
import sys

import pytest

from jarvis_app.bus import EventBus
from jarvis_app.limbs import DEFAULT_STATE, Limbs, apply_command
from jarvis_app.paths import CORE


class FakeCore:
    def __init__(self, running=False):
        self.running = running
        self.sent = []
        self.room_listener = None

    def info(self):
        return {"running": self.running}

    def room_command(self, device, action, value=None):
        self.sent.append((device, action, value))


class FakeHub:
    """An ESP32 with relays (devices on board "esp32", or every device when the Uno
    transport is switched off)."""

    def __init__(self, connected=True):
        self.connected = connected
        self.commands = []
        self.relays = {}

    @property
    def can_command(self):
        return self.connected

    def command(self, payload):
        if not self.connected:
            return False
        self.commands.append(payload)
        self.relays[payload["relay"]] = payload["on"]
        return True

    def device_status(self):
        return {"relays": dict(self.relays)} if self.connected else {}


class FakeUno:
    """uno.UnoRelays as limbs.py sees it: a board that confirms what it has."""

    def __init__(self, channels=("light", "fan"), connected=True):
        self.connected = connected
        self.state = {c: False for c in channels}
        self.calls = []

    def set(self, device, on):
        self.calls.append((device, on))
        if device not in self.state:
            return False, f"the board has no {device} channel"
        self.state[device] = on
        return True, ""

    def view(self):
        return {"connected": self.connected, "port": "COM8", "version": "1.1.0", "pins": {}, "channels": list(self.state),
                "state": dict(self.state), "error": None}


def _limbs(tmp_path, core=None, hub=None, relays=None):
    return Limbs(core or FakeCore(), hub if hub is not None else FakeHub(), EventBus(), path=tmp_path / "room.json",
                 relays=relays, sleep=lambda s: None)


def _room_py():
    sys.path.insert(0, str(CORE))
    room = importlib.import_module("room")
    for d in list(room.state):
        room.state[d] = {"on": False}
    return room


# ------------------------------------------------------------------ on/off, and the mirror
@pytest.mark.parametrize("seq", [
    [("light", "on", None), ("light", "dim", None), ("fan", "set", 40)],
    [("all", "on", None), ("fan", "brighten", None), ("light", "off", None)],
    [("environment", "focus", "focus"), ("light", "off", None)],
    [("environment", "sleep", "sleep"), ("fan", "off", None)],
    [("environment", "relaxation", "relaxation"), ("all", "off", None)],
    [("all", "on", None), ("environment", "all_off", "all_off")],
])
def test_semantics_match_room_py(seq):
    """JARVIS's voice path (room.py) and the app must agree on every command."""
    room = _room_py()
    state = {k: dict(v) for k, v in DEFAULT_STATE.items()}
    for device, action, value in seq:
        room.apply(device, action, value)
        apply_command(state, device, action, value)
    assert state == room.state


def test_there_are_no_levels_anywhere(tmp_path):
    l = _limbs(tmp_path)
    r = l.apply("light", "set", 55)                       # an old caller asking for 55 %
    assert r["state"]["light"] == {"on": True}
    assert "level" not in json.dumps(l.view()["devices"]) and "%" not in json.dumps(l.view()["modes"])


def test_buttons_work_while_jarvis_sleeps_and_drive_the_relay(tmp_path):
    hub = FakeHub()
    l = _limbs(tmp_path, FakeCore(running=False), hub)
    r = l.apply("light", "on")
    assert r["changed"] == ["light"] and r["delivered"] == {"light": True}
    assert hub.commands == [{"relay": "light", "on": True}]


def test_relay_is_not_resent_when_nothing_changes(tmp_path):
    hub = FakeHub()
    l = _limbs(tmp_path, hub=hub)
    l.apply("fan", "on")
    l.apply("fan", "set", 80)            # still just "on": nothing to send
    assert hub.commands == [{"relay": "fan", "on": True}]


def test_jarvis_is_kept_in_sync_when_awake_with_plain_on_off(tmp_path):
    core = FakeCore(running=True)
    l = _limbs(tmp_path, core)
    l.apply("light", "dim", 40)
    l.scene("sleep")
    # One on/off per device, never a level and never a scene JARVIS would re-interpret.
    assert core.sent == [("light", "on", None), ("light", "off", None), ("fan", "on", None)]


def test_a_voice_command_flips_the_real_relay(tmp_path):
    core, hub = FakeCore(running=True), FakeHub()
    l = _limbs(tmp_path, core, hub)
    core.room_listener("fan", {"on": True, "level": 60})    # an older jarvis.py may still send a level
    assert l.state["fan"] == {"on": True}
    assert hub.commands == [{"relay": "fan", "on": True}]
    assert core.sent == []                                  # no echo back to JARVIS


def test_state_survives_a_restart_and_an_old_file_loses_its_levels(tmp_path):
    (tmp_path / "room.json").write_text(json.dumps({"light": {"on": True, "level": 35}, "fan": {"on": False, "level": 60}}))
    l = _limbs(tmp_path)
    assert l.state == {"light": {"on": True}, "fan": {"on": False}}
    l.apply("fan", "on")
    assert _limbs(tmp_path).state["fan"] == {"on": True}


def test_board_unplugged_is_reported_not_hidden(tmp_path):
    l = _limbs(tmp_path, hub=FakeHub(connected=False))
    r = l.apply("light", "on")
    assert r["delivered"] == {"light": False}
    v = l.view()
    assert v["usb"] is False and v["devices"][0]["link"] == "virtual"


def test_confirmed_only_when_the_board_agrees(tmp_path):
    hub = FakeHub()
    l = _limbs(tmp_path, hub=hub)
    l.apply("light", "on")
    assert next(d for d in l.view()["devices"] if d["id"] == "light")["confirmed"] is True
    hub.relays["light"] = False                              # board says otherwise
    assert next(d for d in l.view()["devices"] if d["id"] == "light")["confirmed"] is False


def test_a_reconnected_esp32_is_adopted_never_pushed(tmp_path):
    """3.4.0 pushed the app's state to the board on every (re)connect. On the wall, after
    a power cut at 3 am, that would switch mains loads on: the board's word wins now."""
    hub = FakeHub()
    l = _limbs(tmp_path, hub=hub)
    l.apply("light", "on")
    hub.commands.clear()
    hub.relays = {"light": False, "fan": True}                # rebooted, and someone's fan on
    hooks = []
    l.on_board_connect.append(lambda: hooks.append("presence"))
    assert l.resync_hardware() == {"light": False, "fan": True}
    assert hub.commands == [] and l.state == {"light": {"on": False}, "fan": {"on": True}}
    assert hooks == ["presence"]
    assert l.resync_hardware() == {}                          # nothing differs the second time


class ConfirmHub(FakeHub):
    """hub.set_relay as AankhenHub has it: the board's STATUS is the receipt."""

    def __init__(self, refuse=(), **kw):
        super().__init__(**kw)
        self.refuse = set(refuse)
        self.calls = []

    def set_relay(self, device, on):
        self.calls.append((device, on))
        if not self.connected:
            return False, self.offline_reason()
        if device in self.refuse:
            return False, f"the ESP32 reports {device} {'on' if self.relays.get(device) else 'off'}"
        self.relays[device] = on
        return True, ""

    def offline_reason(self):
        return "the ESP32 is not answering over Wi-Fi (192.168.1.50): no session yet"

    def board_info(self):
        return {"link": "wifi", "address": "192.168.1.50", "rssi": -61, "fw": "aankhen-3.5.0"}


def test_an_esp32_switch_counts_only_when_the_board_confirms_it(tmp_path):
    bus_events = []
    hub = ConfirmHub(refuse={"fan"})
    hub.relays = {"light": False, "fan": False}
    l = _limbs(tmp_path, hub=hub)
    l.bus.publish = lambda *a, **k: bus_events.append((a, k))
    assert l.apply("light", "on")["delivered"] == {"light": True}
    r = l.apply("fan", "on")
    assert r["delivered"] == {"fan": False}
    assert l.state["fan"] == {"on": False}                    # the room is what the board says
    failed = [k for a, k in bus_events if a[1] == "relay_failed"]
    assert failed and "reports fan off" in failed[-1]["reason"]


def test_an_offline_esp32_is_a_clear_error_and_nothing_is_sent(tmp_path):
    bus_events = []
    hub = ConfirmHub(connected=False)
    l = _limbs(tmp_path, hub=hub)
    l.bus.publish = lambda *a, **k: bus_events.append((a, k))
    assert l.apply("light", "on")["delivered"] == {"light": False}
    assert hub.calls == []
    failed = [k for a, k in bus_events if a[1] == "relay_failed"]
    assert "not answering over Wi-Fi (192.168.1.50)" in failed[-1]["reason"]
    v = l.view()
    assert v["esp32"]["connected"] is False and "not answering over Wi-Fi" in v["hardware"]


def test_the_view_names_the_esp32_link(tmp_path):
    hub = ConfirmHub()
    hub.relays = {"light": True, "fan": False}
    l = _limbs(tmp_path, hub=hub)
    v = l.view()
    assert v["esp32"]["how"] == "Wi-Fi (192.168.1.50, -61 dBm)"
    assert "over Wi-Fi (192.168.1.50, -61 dBm), firmware aankhen-3.5.0" in v["hardware"]
    assert {d["id"]: d["link"] for d in v["devices"]} == {"light": "wifi", "fan": "wifi"}
    assert v["links"] == ["wifi"]


def test_the_wall_box_example_devices_file_is_valid(tmp_path):
    import shutil
    from jarvis_app.paths import APP
    shutil.copy(APP / "jarvis_app" / "devices.esp32-box.example.json", tmp_path / "devices.json")
    hub = ConfirmHub()
    hub.relays = {"light": False, "fan": False, "light2": False, "light3": False, "light4": None}
    l = _limbs(tmp_path, hub=hub, relays=FakeUno())           # the Uno transport on, owning nothing
    assert [(d["id"], d["board"], d["channel"]) for d in l.devices] == [
        ("light", "esp32", 4), ("fan", "esp32", 5), ("light2", "esp32", 6), ("light3", "esp32", 7),
        ("light4", "esp32", 8)]
    assert l.device_problems == []
    l.scene("focus")
    assert hub.calls == [("light", True), ("fan", True)] and l.relays.calls == []
    v = l.view()
    assert v["esp32"]["missing_channels"] == ["light4"] and "light4" in v["hardware"]
    assert "Arduino Uno" not in v["hardware"]                 # nothing is on the Uno any more


def test_an_esp32_device_on_an_unsafe_pin_is_refused(tmp_path):
    _devices(tmp_path, [{"id": "lamp", "name": "Lamp", "kind": "light", "board": "esp32", "channel": 0}])
    l = _limbs(tmp_path)
    assert "lamp" not in l.state and any("GPIO 0" in p for p in l.view()["problems"])


def test_bad_input_is_rejected(tmp_path):
    l = _limbs(tmp_path)
    for args in [("toaster", "on"), ("light", "explode")]:
        with pytest.raises(ValueError):
            l.apply(*args)
    with pytest.raises(ValueError):
        l.scene("party")


# ------------------------------------------------------------------ modes
def test_default_modes_are_the_on_off_sets_aman_asked_for(tmp_path):
    l = _limbs(tmp_path)
    modes = {m["id"]: m for m in l.view()["modes"]}
    assert [m["name"] for m in l.view()["modes"]] == ["Deep focus", "Wind down", "Sleep", "All off"]
    assert modes["focus"]["resolved"] == {"light": True, "fan": True}
    assert modes["relaxation"]["resolved"] == {"light": False, "fan": True}
    assert modes["sleep"]["resolved"] == {"light": False, "fan": True}
    assert modes["all_off"]["resolved"] == {"light": False, "fan": False}
    assert modes["focus"]["detail"] == "room light on · ceiling fan on"


@pytest.mark.parametrize("name, light, fan", [("focus", True, True), ("Deep focus", True, True),
                                              ("wind down", False, True), ("sleep", False, True),
                                              ("all_off", False, False)])
def test_every_mode_works_by_id_or_name(tmp_path, name, light, fan):
    l = _limbs(tmp_path)
    l.apply("all", "on")
    r = l.scene(name)
    assert r["state"] == {"light": {"on": light}, "fan": {"on": fan}}


def test_modes_are_created_renamed_deleted_and_persisted(tmp_path):
    l = _limbs(tmp_path)
    m = l.create_mode("Reading", {"light": "on", "fan": False})
    assert m["id"] == "reading" and m["resolved"] == {"light": True, "fan": False}
    l.update_mode("reading", name="Reading time")
    l.scene("reading time")
    assert l.last_mode == "reading"
    again = _limbs(tmp_path)                                  # a restart reads modes.json
    assert again.last_mode == "reading" and any(x["name"] == "Reading time" for x in again.modes)
    again.delete_mode("sleep")                                # built-ins are editable too
    assert all(x["id"] != "sleep" for x in _limbs(tmp_path).modes)
    with pytest.raises(KeyError):
        again.delete_mode("sleep")


@pytest.mark.parametrize("name, st", [("", {"light": True}), ("Dim", {"light": 40}), ("Ghost", {"lamp": True}),
                                      ("Empty", {}), ("Deep focus", {"light": True})])
def test_a_bad_mode_is_refused_with_a_reason(tmp_path, name, st):
    with pytest.raises(ValueError):
        _limbs(tmp_path).create_mode(name, st)


# ------------------------------------------------------------------ data-driven devices
def _devices(tmp_path, extra):
    (tmp_path / "devices.json").write_text(json.dumps({"devices": [
        {"id": "light", "name": "Room light", "kind": "light", "board": "uno", "channel": 4},
        {"id": "fan", "name": "Ceiling fan", "kind": "fan", "board": "uno", "channel": 5}] + extra}))


def test_a_light_added_on_d6_is_one_line_of_config(tmp_path):
    _devices(tmp_path, [{"id": "lamp", "name": "Desk lamp", "kind": "light", "board": "uno", "channel": 6}])
    uno = FakeUno(channels=("light", "fan", "lamp"))
    l = _limbs(tmp_path, relays=uno)
    assert [d["id"] for d in l.view()["devices"]] == ["light", "fan", "lamp"]
    assert l.apply("lamp", "on")["delivered"] == {"lamp": True} and uno.state["lamp"] is True
    l.scene("all_off")                                        # "*" covers the new lamp too
    assert uno.state == {"light": False, "fan": False, "lamp": False}


def test_a_channel_the_flashed_firmware_lacks_is_said_not_faked(tmp_path):
    _devices(tmp_path, [{"id": "lamp", "name": "Desk lamp", "kind": "light", "board": "uno", "channel": 6}])
    l = _limbs(tmp_path, relays=FakeUno(channels=("light", "fan")))     # 1.0.0: light and fan only
    assert l.apply("lamp", "on")["delivered"] == {"lamp": False}
    v = l.view()
    assert v["relay_board"]["missing_channels"] == ["lamp"] and "1.1.0" in v["hardware"]


def test_uno_and_esp32_devices_each_go_to_their_own_board(tmp_path):
    _devices(tmp_path, [{"id": "porch", "name": "Porch light", "kind": "light", "board": "esp32", "channel": 21}])
    uno, hub = FakeUno(), FakeHub()
    l = _limbs(tmp_path, hub=hub, relays=uno)
    l.apply("all", "on")
    assert uno.calls == [("light", True), ("fan", True)]
    assert hub.commands == [{"relay": "porch", "on": True}]                # never the Uno's devices


def test_a_broken_devices_file_falls_back_to_today_s_room(tmp_path):
    (tmp_path / "devices.json").write_text(json.dumps({"devices": [{"id": "Heater!", "kind": "heater"}]}))
    l = _limbs(tmp_path)
    assert list(l.state) == ["light", "fan"] and l.view()["problems"]


# ------------------------------------------------------------------ the Uno, manual commands, test click
def test_the_uno_is_the_only_writer_when_present(tmp_path):
    uno, hub = FakeUno(), FakeHub()
    l = _limbs(tmp_path, hub=hub, relays=uno)
    l.apply("light", "on")
    assert uno.calls == [("light", True)] and hub.commands == []
    assert l.resync_hardware() == {}                          # the Uno adopts, it is never pushed


def test_manual_commands_are_counted_but_presence_and_the_board_are_not(tmp_path):
    l = _limbs(tmp_path, relays=FakeUno())
    l.apply("light", "on", origin="presence")
    l.relays.state["fan"] = True
    l.adopt_board()
    assert l.manual == []
    l.apply("fan", "off", origin="app")
    assert [o for o, _ in l.manual] == ["app"]


def test_a_test_click_flips_and_restores_with_the_board_as_receipt(tmp_path):
    uno = FakeUno()
    l = _limbs(tmp_path, relays=uno)
    r = l.test_click("fan")
    assert r["ok"] and r["restored"] and [s["action"] for s in r["steps"]] == ["on", "off"]
    assert [s["board_says"] for s in r["steps"]] == [True, False] and uno.state["fan"] is False
    uno.connected = False
    with pytest.raises(RuntimeError):
        l.test_click("fan")
