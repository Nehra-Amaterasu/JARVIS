"""F4: a board plugged in after the app started is used — unless a person chose otherwise.

Fake serial ports only (tests/fakeserial.py). The F4 bar: the hub switches from the
simulation to hardware within 5 s of the board's handshake (its first frame).
"""
import time

import pytest

from aankhen.bench import simulated_baseline
from aankhen.hub import HOTPLUG_INTERVAL_S, AankhenHub
from aankhen.room import load_room

from .fakeserial import FakeBoard, FakeUsb


def wait_for(cond, timeout=8.0, step=0.02):
    t0 = time.monotonic()
    while time.monotonic() - t0 < timeout:
        if cond():
            return True
        time.sleep(step)
    return cond()


@pytest.fixture(scope="module")
def sim_baseline():
    room, _ = load_room()
    return simulated_baseline(room)                  # ~4 s; once for the whole module


@pytest.fixture
def make_hub(sim_baseline):
    hubs = []

    def make(usb, interval_s=0.3, **finder_kw):
        hub = AankhenHub(boards=usb.finder(**{"window_s": 0.5, **finder_kw}))
        hub._sim_baseline = sim_baseline
        events = []
        hub.enable_hotplug(lambda kind, text, **data: events.append((kind, text, data)), interval_s=interval_s)
        hubs.append(hub)
        return hub, events
    yield make
    for h in hubs:
        h.stop()


def test_a_board_plugged_in_after_start_takes_over_within_5_s(make_hub):
    """Production timing: the watcher's default interval and the default probe window."""
    uno = FakeBoard("COM5", "uno")
    usb = FakeUsb(uno)
    hub, events = make_hub(usb, interval_s=HOTPLUG_INTERVAL_S, window_s=2.0)
    assert hub.start("auto")["mode"] == "simulation"
    sim_engine = hub.engine
    sim_engine._event_id = 41                         # as if the simulation had said 41 things
    # Plugged in now; silent for 1.3 s (booting), then the firmware's 1 Hz STATUS.
    board = usb.plug(FakeBoard("COM7", "esp32", talks_at=time.monotonic() + 1.3, period_s=1.0))
    assert wait_for(lambda: hub.mode == "hardware" and hub.can_command, timeout=10)
    took = time.monotonic() - board.talks_at
    assert took < 5.0, f"switched {took:.1f} s after the board's first frame"
    # The hardware engine numbers its events on from the simulation's, so the app's
    # "relay events newer than the last one" keeps relaying them.
    assert hub.engine is not sim_engine and hub.engine._event_id >= 41
    kinds = [k for k, _, _ in events]
    assert kinds == ["source"]
    assert "COM7" in events[0][1] and "switched" in events[0][1]
    assert hub.info()["requested_mode"] == "auto" and hub.info()["port"] == "COM7"
    assert bytes(uno.written) == b""                 # the Uno was never sent a byte


def test_a_chosen_simulation_is_kept_and_the_board_announced_once(make_hub):
    usb = FakeUsb()
    hub, events = make_hub(usb)
    hub.start("simulation", scenario="still")
    usb.plug(FakeBoard("COM7", "esp32"))
    assert wait_for(lambda: any(k == "board" for k, _, _ in events))
    time.sleep(1.0)                                   # several more looks
    assert hub.mode == "simulation" and hub.scenario == "still"
    announced = [t for k, t, _ in events if k == "board"]
    assert len(announced) == 1
    assert "COM7" in announced[0] and "still simulation" in announced[0] and "Press ESP32" in announced[0]
    assert not any(k == "source" for k, _, _ in events)
    # Unplugged and plugged back in: worth saying again.
    usb.unplug("COM7")
    assert wait_for(lambda: hub.hotplug_info()["announced"] == [])
    usb.plug(usb.boards["COM7"])
    assert wait_for(lambda: len([k for k, _, _ in events if k == "board"]) == 2)


def test_an_uno_plugged_in_changes_nothing(make_hub):
    usb = FakeUsb()
    hub, events = make_hub(usb)
    hub.start("auto")
    uno = usb.plug(FakeBoard("COM5", "uno"))
    assert wait_for(lambda: uno.opens >= 1)
    time.sleep(1.0)
    assert hub.mode == "simulation" and events == []
    assert uno.opens == 1 and bytes(uno.written) == b""   # looked at once, never written


def test_a_stopped_hub_stops_watching(make_hub):
    usb = FakeUsb()
    hub, events = make_hub(usb)
    hub.start("auto")
    assert hub.hotplug_info()["watching"]
    hub.stop()
    assert not hub.hotplug_info()["watching"]
    board = usb.plug(FakeBoard("COM7", "esp32"))
    time.sleep(1.0)
    assert not hub.running and events == [] and board.opens == 0


def test_hardware_and_replay_are_left_alone(make_hub):
    usb = FakeUsb(FakeBoard("COM7", "esp32"))
    hub, events = make_hub(usb)
    hub.start("hardware")
    assert wait_for(lambda: hub.can_command)
    usb.plug(FakeBoard("COM8", "esp32"))
    assert hub.hotplug_tick() is None                 # already on hardware: nothing to switch
    assert hub.info()["port"] == "COM7" and events == []


def test_the_watcher_is_off_until_enabled(sim_baseline):
    board = FakeBoard("COM7", "esp32", talks_at=time.monotonic() + 0.8)
    usb = FakeUsb(board)
    hub = AankhenHub(boards=usb.finder(window_s=0.3))
    hub._sim_baseline = sim_baseline
    try:
        assert hub.start("auto")["mode"] == "simulation"   # silent during the first look
        assert not hub.hotplug_info()["enabled"] and not hub.hotplug_info()["watching"]
        time.sleep(1.2)
        assert hub.mode == "simulation"                    # nobody watching: standalone default
        assert hub.hotplug_tick() == "switched"            # the same look, by hand
        assert wait_for(lambda: hub.can_command, timeout=3)
    finally:
        hub.stop()
