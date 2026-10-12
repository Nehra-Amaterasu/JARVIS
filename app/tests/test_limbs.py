"""The room owner: commands match core/room.py exactly, relays get driven, and the
buttons work whether or not JARVIS is awake."""
import importlib
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
        self.mqtt = None

    def info(self):
        return {"running": self.running, "mqtt": self.mqtt}

    def room_command(self, device, action, value=None):
        self.sent.append((device, action, value))


class FakeHub:
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


def _limbs(tmp_path, core=None, hub=None):
    return Limbs(core or FakeCore(), hub if hub is not None else FakeHub(), EventBus(), path=tmp_path / "room.json")


def _room_py():
    sys.path.insert(0, str(CORE))
    room = importlib.import_module("room")
    room.state.update({"light": {"on": False, "level": 100}, "fan": {"on": False, "level": 60}})
    return room


@pytest.mark.parametrize("seq", [
    [("light", "on", None), ("light", "dim", None), ("light", "dim", None), ("fan", "set", 40)],
    [("all", "on", None), ("fan", "brighten", None), ("light", "off", None)],
    [("environment", "focus", "focus"), ("light", "brighten", 95)],
    [("environment", "sleep", "sleep"), ("fan", "dim", None)],
    [("environment", "relaxation", "relaxation"), ("all", "off", None)],
])
def test_semantics_match_room_py(seq):
    """JARVIS's voice path (room.py) and the app must agree on every command."""
    room = _room_py()
    state = {k: dict(v) for k, v in DEFAULT_STATE.items()}
    for device, action, value in seq:
        room.apply(device, action, value)
        apply_command(state, device, action, value)
    assert state == room.state


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
    l.apply("fan", "set", 80)            # level change only: the relay is already on
    assert hub.commands == [{"relay": "fan", "on": True}]


def test_jarvis_is_kept_in_sync_when_awake(tmp_path):
    core = FakeCore(running=True)
    l = _limbs(tmp_path, core)
    l.apply("light", "dim", 40)
    assert core.sent == [("light", "dim", 40)]


def test_a_voice_command_flips_the_real_relay(tmp_path):
    core, hub = FakeCore(running=True), FakeHub()
    l = _limbs(tmp_path, core, hub)
    core.room_listener("fan", {"on": True, "level": 60})    # what jarvis.py reports
    assert l.state["fan"]["on"] is True
    assert hub.commands == [{"relay": "fan", "on": True}]
    assert core.sent == []                                  # no echo back to JARVIS


def test_state_survives_a_restart(tmp_path):
    l = _limbs(tmp_path)
    l.apply("light", "set", 35)
    again = _limbs(tmp_path)
    assert again.state["light"] == {"on": True, "level": 35}


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


def test_resync_pushes_everything_after_a_replug(tmp_path):
    hub = FakeHub()
    l = _limbs(tmp_path, hub=hub)
    l.apply("light", "on")
    hub.commands.clear()
    assert l.resync_hardware() == {"light": True, "fan": True}
    assert {c["relay"] for c in hub.commands} == {"light", "fan"}


def test_bad_input_is_rejected(tmp_path):
    l = _limbs(tmp_path)
    for args in [("toaster", "on"), ("light", "explode")]:
        with pytest.raises(ValueError):
            l.apply(*args)
    with pytest.raises(ValueError):
        l.scene("party")


@pytest.mark.parametrize("scene", ["focus", "relaxation", "sleep"])
def test_every_scene_button_works(tmp_path, scene):
    """Scenes pass their name as the value; that once crashed int() in apply()."""
    l = _limbs(tmp_path)
    r = l.scene(scene)
    assert set(r["changed"]) <= {"light", "fan"} and r["state"]
