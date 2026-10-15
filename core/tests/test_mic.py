"""core/mic.py: the mic is pinned by name (a headset that becomes the Windows default does
not move him), and the watchdog reopens a stream that stops delivering audio."""
import mic

DEVICES = [
    {"name": "Microsoft Sound Mapper - Input", "hostapi": 0, "max_input_channels": 2},
    {"name": "Microphone Array (Intel Smart ", "hostapi": 0, "max_input_channels": 4},
    {"name": "Speakers", "hostapi": 0, "max_input_channels": 0},
    {"name": "Microphone Array (Intel Smart Sound Technology)", "hostapi": 3, "max_input_channels": 2},
    {"name": "Headset (Hands-Free (OnePlus Nord Buds 3))", "hostapi": 0, "max_input_channels": 1},
]


def test_pick_by_name_on_the_default_host_api():
    assert mic.pick_device(DEVICES, "Microphone Array (Intel Smart Sound Technology)", 1) == \
        (1, "Microphone Array (Intel Smart ")          # MME cuts names at 31 chars: still matched, MME kept
    assert mic.pick_device(DEVICES, "nord buds", 1)[0] == 4
    assert mic.pick_device(DEVICES, None, 1) == (1, "Microphone Array (Intel Smart ")
    assert mic.pick_device(DEVICES, "no such mic", 1)[0] == 1                 # unknown name: the default
    assert mic.pick_device(DEVICES, None, 2)[0] == 0                          # default has no input: first input
    assert mic.pick_device([{"name": "Speakers", "max_input_channels": 0}], None, 0) == (None, "")


class FakeSD:
    def __init__(self, devices, default):
        self.devices, self.default_idx, self.calls = list(devices), default, []

    class _Default:
        pass

    @property
    def default(self):
        d = self._Default()
        d.device = [self.default_idx, 3]
        return d

    def query_devices(self, kind=None):
        if kind == "input":
            return {**self.devices[self.default_idx], "index": self.default_idx}
        return self.devices

    def _terminate(self):
        self.calls.append("terminate")

    def _initialize(self):
        self.calls.append("initialize")


def test_the_mic_at_start_stays_pinned_when_a_headset_becomes_default():
    sd = FakeSD(DEVICES, 1)
    m = mic.Mic(sd, log=lambda s: None)
    assert m.resolve() == (1, "Microphone Array (Intel Smart ")
    sd.default_idx = 4                                     # the Bluetooth headset connected
    assert m.resolve(refresh=True) == (1, "Microphone Array (Intel Smart ")
    assert sd.calls == ["terminate", "initialize"]
    m2 = mic.Mic(FakeSD(DEVICES, 1), wanted=lambda: "nord buds", log=lambda s: None)
    assert m2.device() == 4                                # the settings' choice wins


def test_a_mic_that_returns_under_a_new_index_is_found_again():
    sd = FakeSD(DEVICES, 1)
    m = mic.Mic(sd, log=lambda s: None)
    m.resolve()
    sd.devices = [DEVICES[0], DEVICES[2], DEVICES[1]]      # re-enumerated after a driver reset
    sd.default_idx = 0
    assert m.resolve(refresh=True) == (2, "Microphone Array (Intel Smart ")


class Clock:
    def __init__(self):
        self.t = 100.0

    def __call__(self):
        return self.t


def test_watchdog_reports_a_stall_and_a_heartbeat():
    c = Clock()
    w = mic.MicWatchdog(stall_s=5, heartbeat_s=60, clock=c)
    assert not w.stalled()                                 # not opened yet
    w.opened()
    c.t += 4.9
    assert not w.stalled()
    c.t += 0.2
    assert w.stalled()                                     # never a block since the open
    w.block(0.02)
    assert not w.stalled()
    c.t += 3
    w.block(0.3)
    c.t += 6
    assert w.stalled()
    w.reopened("stalled")
    assert w.heartbeat() is None                           # 14.1 s since the open
    c.t += 60
    beat = w.heartbeat()
    assert beat["alive"] is False and beat["reopens"] == 1 and beat["peak"] == 0.3 and beat["blocks"] == 2
    w.opened()
    w.block(0.01)
    c.t += 61
    w.block(0.01)
    assert w.heartbeat()["peak"] == 0.01                   # the peak resets per heartbeat
