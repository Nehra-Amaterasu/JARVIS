"""presence_on.py: after an app start (relays OFF), light and fan back on when he is
there, and never when a guard says no. Fakes only: no serial port, no real input clock."""
from datetime import datetime

import pytest

from jarvis_app.bus import EventBus
from jarvis_app.limbs import Limbs
from jarvis_app.presence_on import PresenceOn, check_settings, in_quiet_hours, last_input_idle_s


class FakeCore:
    def __init__(self, running=True):
        self.running = running
        self.room_listener = None
        self.spoken = []

    def info(self):
        return {"running": self.running}

    def room_command(self, device, action, value=None):
        pass

    def speak(self, text):
        self.spoken.append(text)


class FakeUno:
    connected = True

    def __init__(self):
        self.state = {"light": False, "fan": False}

    def set(self, device, on):
        self.state[device] = on
        return True, ""

    def view(self):
        return {"connected": True, "port": "COM8", "version": "1.0.0", "pins": {}, "channels": list(self.state),
                "state": dict(self.state), "error": None}


class Engine:
    def __init__(self, frame):
        self.frame = frame

    def latest_frame(self):
        return dict(self.frame)


class Hub:
    def __init__(self, frame=None):
        self.engine = Engine(frame) if frame is not None else None


class Clock:
    def __init__(self):
        self.t = 1000.0

    def __call__(self):
        return self.t


def rig(tmp_path, idle=None, frame=None, at=datetime(2026, 10, 15, 19, 0), core=None, **settings):
    bus = EventBus()
    core = core or FakeCore()
    limbs = Limbs(core, None, bus, path=tmp_path / "room.json", relays=FakeUno())
    clock = Clock()
    idle_box = {"v": idle}

    def sleep(s):
        clock.t += s
    p = PresenceOn(limbs, bus, hub=Hub(frame), core=core, path=tmp_path / "presence_on.json", clock=clock,
                   now=lambda: at, idle_s=lambda: idle_box["v"], sleep=sleep)
    if settings:
        p.set_settings(settings)
    return p, limbs, bus, core, clock, idle_box


def decisions(bus):
    return [e for e in bus.history() if e["kind"] == "presence_on"]


def test_he_is_at_the_desk_so_light_and_fan_come_on_and_jarvis_says_so(tmp_path):
    p, limbs, bus, core, *_ = rig(tmp_path, idle=12.0)
    out = p.run()
    assert limbs.state == {"light": {"on": True}, "fan": {"on": True}}
    assert out["line"] == "Welcome back, sir: light and fan on." and core.spoken == [out["line"]]
    assert decisions(bus)[-1]["decision"] == "acted" and "keyboard/mouse input 12 s ago" in decisions(bus)[-1]["text"]
    assert limbs.manual == []                                    # the rule is not a person


def test_the_last_chosen_mode_wins_over_plain_on(tmp_path):
    p, limbs, *_ = rig(tmp_path, idle=5.0)
    limbs.last_mode = "relaxation"                               # light off, fan on
    p.run()
    assert limbs.state == {"light": {"on": False}, "fan": {"on": True}}
    assert p.decision["mode"] == "relaxation" and "fan on" in p.decision["line"]


def test_a_last_mode_that_switches_nothing_on_falls_back_to_light_and_fan(tmp_path):
    p, limbs, *_ = rig(tmp_path, idle=5.0)
    limbs.last_mode = "all_off"
    p.run()
    assert limbs.state == {"light": {"on": True}, "fan": {"on": True}}


def test_quiet_hours_do_nothing(tmp_path):
    p, limbs, bus, core, *_ = rig(tmp_path, idle=1.0, at=datetime(2026, 10, 15, 2, 10))
    assert p.run() is None and limbs.state["light"]["on"] is False and core.spoken == []
    assert decisions(bus)[-1]["guard"] == "quiet"


def test_a_manual_command_since_start_wins(tmp_path):
    p, limbs, bus, *_ = rig(tmp_path, idle=1.0)
    limbs.apply("fan", "off", origin="app")
    assert p.run() is None and limbs.state["light"]["on"] is False
    assert decisions(bus)[-1]["guard"] == "manual"


def test_a_manual_command_during_the_watch_wins(tmp_path):
    p, limbs, bus, core, clock, idle = rig(tmp_path, idle=None)
    calls = {"n": 0}
    real = p.evidence

    def evidence():
        calls["n"] += 1
        if calls["n"] == 2:
            limbs.apply("light", "off", origin="voice")          # he spoke first
            idle["v"] = 3.0
        return real()
    p.evidence = evidence
    assert p.run() is None and limbs.state["fan"]["on"] is False
    assert decisions(bus)[-1]["guard"] == "manual"


def test_disabled_does_nothing(tmp_path):
    p, limbs, bus, *_ = rig(tmp_path, idle=1.0, enabled=False)
    assert p.run() is None and decisions(bus)[-1]["guard"] == "off"


def test_no_evidence_in_the_window_leaves_the_room_off(tmp_path):
    p, limbs, bus, core, clock, _ = rig(tmp_path, idle=900.0, window_min=2)
    assert p.run() is None and limbs.state["light"]["on"] is False
    assert decisions(bus)[-1]["guard"] == "no_evidence" and clock.t - 1000.0 >= 120


def test_aankhen_counts_only_on_the_real_board_and_only_when_sustained(tmp_path):
    real = {"source": "hardware", "learned": {"occupied_p": 0.93, "state": "desk"}}
    p, limbs, bus, core, clock, _ = rig(tmp_path, idle=None, frame=real)
    p.run()
    assert limbs.state["light"]["on"] is True
    assert clock.t - 1000.0 >= 20                                # held 20 s before acting
    assert "Aankhen (real board) occupied p=0.93" in p.decision["evidence"]


@pytest.mark.parametrize("frame", [
    {"source": "simulation", "learned": {"occupied_p": 0.99}},   # never the simulator
    {"source": "replay", "learned": {"occupied_p": 0.99}},
    {"source": "hardware", "learned": {"occupied_p": 0.6}},      # below 0.8
    {"source": "hardware", "learned": None},
])
def test_aankhen_that_is_not_real_or_not_sure_is_not_evidence(tmp_path, frame):
    p, limbs, *_ = rig(tmp_path, idle=None, frame=frame, window_min=1)
    assert p.run() is None and limbs.state["light"]["on"] is False


def test_it_runs_once_per_app_start(tmp_path):
    p, limbs, *_ = rig(tmp_path, idle=None, window_min=1)
    p.stop()                                                     # the thread exits at once
    assert p.start() is True
    assert p.start() is False                                    # a later Uno reconnect: no second try


def test_settings_are_validated_and_persisted(tmp_path):
    p, *_ = rig(tmp_path)
    p.set_settings({"quiet_start": "23:00", "quiet_end": "06:30", "window_min": 5})
    again = PresenceOn(None, EventBus(), path=tmp_path / "presence_on.json")
    assert again.settings["quiet_start"] == "23:00" and again.settings["window_min"] == 5
    for bad in ({"quiet_start": "25:00"}, {"window_min": 0}, {"occupied_p": 0.2}, {"input_s": "lots"}):
        with pytest.raises(ValueError):
            check_settings(bad)


def test_quiet_hours_over_midnight():
    assert in_quiet_hours(datetime(2026, 1, 1, 0, 45), "00:30", "07:00")
    assert not in_quiet_hours(datetime(2026, 1, 1, 7, 0), "00:30", "07:00")
    assert not in_quiet_hours(datetime(2026, 1, 1, 0, 10), "00:30", "07:00")
    assert in_quiet_hours(datetime(2026, 1, 1, 23, 30), "23:00", "07:00")
    assert in_quiet_hours(datetime(2026, 1, 1, 3, 0), "23:00", "07:00")
    assert not in_quiet_hours(datetime(2026, 1, 1, 12, 0), "23:00", "07:00")


def test_the_windows_idle_clock_reads_or_says_none():
    v = last_input_idle_s()
    assert v is None or v >= 0.0


def test_jarvis_asleep_means_the_line_is_logged_not_spoken(tmp_path):
    core = FakeCore(running=False)
    p, limbs, bus, *_ = rig(tmp_path, idle=3.0, core=core)
    out = p.run()
    assert out["spoken"] is False and core.spoken == [] and decisions(bus)[-1]["line"] == out["line"]
