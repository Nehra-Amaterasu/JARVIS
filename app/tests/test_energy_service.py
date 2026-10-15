"""The energy feature wired to Limbs and the API: every switch lands in the ledger,
an auto-off goes through the same path as a button, and the HTTP API refuses unsafe
relays with the reason."""
import json
from datetime import datetime

import pytest
from starlette.testclient import TestClient

from jarvis_app.bus import EventBus
from jarvis_app.circuits import EXAMPLE_FILE, parse_config
from jarvis_app.energy_service import EnergyService, read_presence
from jarvis_app.limbs import Limbs
from jarvis_app.security import Guard
from jarvis_app.server import create_app

from test_limbs import FakeCore, FakeHub

T0 = datetime(2026, 10, 12, 18, 0).timestamp()


class Clock:
    def __init__(self, t):
        self.t = t

    def __call__(self):
        return self.t


class SpeakingCore(FakeCore):
    def __init__(self, running=True):
        super().__init__(running)
        self.spoken = []

    def speak(self, text):
        self.spoken.append(text)
        return {"text": text}


def _service(tmp_path, presence, core=None, hub=None, auto_off=False):
    raw = json.loads(EXAMPLE_FILE.read_text(encoding="utf-8"))
    raw["waste"]["auto_off"]["enabled"] = auto_off
    cs = parse_config(raw, "example")
    bus = EventBus()
    clock = Clock(T0)
    core = core or SpeakingCore()
    hub = hub if hub is not None else FakeHub()
    limbs = Limbs(core, hub, bus, path=tmp_path / "room.json", circuits=cs)
    svc = EnergyService(limbs, bus, core=core, hub=hub, circuits=cs, folder=tmp_path / "energy",
                        clock=clock, presence=lambda: presence)
    return svc, limbs, bus, clock, core, hub


def _advance(svc, clock, minutes, step_s=5.0):
    acts = []
    end = clock.t + minutes * 60
    while clock.t < end:
        clock.t += step_s
        acts += svc.tick()
    return acts


def test_every_switch_lands_in_the_ledger_whoever_made_it(tmp_path):
    svc, limbs, bus, clock, core, hub = _service(tmp_path, {"state": "moving", "source": "hardware"})
    limbs.apply("light", "on")                              # a button
    clock.t += 60
    core.room_listener("fan", {"on": True})                 # "Hey Jarvis, fan on" (voice)
    clock.t += 60
    limbs.scene("sleep")                                    # light off, fan on
    events = [(e["c"], e["on"], e["w"], e["o"], e["link"]) for e in svc.ledger.events]
    assert ("L1", True, 20.0, "app", "usb") in events
    assert ("F1", True, 75.0, "voice", "usb") in events     # on/off: the fan's rated watts
    assert ("L1", False, 0.0, "app", "usb") in events
    assert all(e["lvl"] in (0, 100) for e in svc.ledger.events)   # no fake levels in the ledger


def test_with_no_relay_board_the_ledger_says_virtual(tmp_path):
    svc, limbs, *_ = _service(tmp_path, {}, hub=FakeHub(connected=False))
    limbs.apply("light", "on")
    assert svc.ledger.last("L1")["link"] == "virtual"


def test_auto_off_goes_through_limbs_and_is_spoken(tmp_path):
    svc, limbs, bus, clock, core, hub = _service(tmp_path, {"state": "empty", "source": "hardware"},
                                                 auto_off=True)
    limbs.apply("light", "on")
    limbs.apply("fan", "set", 60)
    hub.commands.clear()
    acts = _advance(svc, clock, 50)
    assert [a["type"] for a in acts] == ["nudge", "auto_off"]
    assert limbs.state["light"]["on"] is False and limbs.state["fan"]["on"] is False
    assert {"relay": "light", "on": False} in hub.commands and {"relay": "fan", "on": False} in hub.commands
    assert core.spoken[0].startswith("The bedroom has been empty for 20 minutes")
    assert core.spoken[1].startswith("I've switched")
    assert svc.ledger.last("L1")["o"] == "energy"
    kinds = [e["kind"] for e in bus.history() if e["source"] == "energy"]
    assert kinds == ["nudge", "auto_off"]
    # Waste is in today's report: 45 min empty minus the 5 min grace, with the light and fan on.
    w = svc.report("day")["waste"]
    assert w["minutes"] == pytest.approx(40.0, abs=0.2) and w["sim_minutes"] == 0


def test_simulated_presence_never_switches_anything(tmp_path):
    svc, limbs, bus, clock, core, hub = _service(tmp_path, {"state": "empty", "source": "simulation"},
                                                 auto_off=True)
    limbs.apply("light", "on")
    acts = _advance(svc, clock, 120)
    assert [a["type"] for a in acts] == ["nudge"]
    assert limbs.state["light"]["on"] is True and core.spoken == []
    ev = next(e for e in bus.history() if e["source"] == "energy")
    assert ev["sim"] is True and ev["text"].startswith("[simulated presence]")


def test_circuits_jarvis_cannot_switch_are_recorded_and_said_so(tmp_path):
    svc, limbs, bus, clock, core, hub = _service(tmp_path, {"state": "moving", "source": "hardware"})
    r = svc.set_state("G1", True)
    assert r["switched"] is False and "did not switch it" in r["note"] and "never be on a relay" in r["note"]
    assert svc.ledger.last("G1")["link"] == "manual" and svc.ledger.last("G1")["w"] == 2000
    assert hub.commands == []
    r = svc.set_state("L1", True)                         # the light IS switchable: through Limbs
    assert r["switched"] is True and limbs.state["light"]["on"] is True
    acts = _advance(svc, clock, 26)
    assert [a["type"] for a in acts] == ["remind"]         # the geyser, at 25 minutes
    assert core.spoken[-1].startswith("The bathroom geyser (15 L) has been on for 25 minutes")


def test_the_view_is_labelled_an_estimate(tmp_path):
    svc, limbs, *_ = _service(tmp_path, {"state": "moving", "source": "hardware"})
    assert svc.view()["presence"]["sim"] is True            # before any reading: not "real"
    svc.tick()
    v = svc.view()
    assert v["estimate"] is True and v["meter"] is None
    assert v["report"]["tariff"]["example"] is True and v["circuits"]["example"] is True
    assert v["presence"]["sim"] is False
    assert {c["id"] for c in v["circuits"]["circuits"]} >= {"L1", "L8", "F1", "AC1", "G1"}


def test_presence_from_a_stopped_hub_is_no_data():
    class Hub:
        running = False
        engine = object()
    assert read_presence(Hub())["state"] is None
    assert read_presence(None)["state"] is None


def test_presence_from_silent_sensors_is_no_data_not_a_stale_empty():
    class Engine:
        def frame_message(self):
            return {"source": "hardware", "presence": {"state": "empty"}, "learned": {"state": "bed"}}

        def status_message(self):
            return {"sensors": {"Wi-Fi CSI": {"state": "silent"}, "LD2450 radar": {"state": "silent"},
                                "ESP32": {"state": "live"}}}

    class Hub:
        running = True
        engine = Engine()
    p = read_presence(Hub())
    assert p["state"] == "no data" and p["learned"] == "bed" and p["live"] is False


# ------------------------------------------------------------------ the HTTP API
TOKEN = "energy-token-123456"


@pytest.fixture(scope="module")
def client():
    guard = Guard(8778, TOKEN, extra_hosts=["testserver"])
    app = create_app(guard, autostart_aankhen="off")
    with TestClient(app) as c:
        c.headers.update({"X-Jarvis-Token": TOKEN})
        yield c


def test_api_energy_view_and_reports(client):
    v = client.get("/api/energy").json()
    assert v["estimate"] is True and v["report"]["period"] == "day"
    assert client.get("/api/energy?period=week").json()["report"]["period"] == "week"
    assert client.get("/api/energy/report?period=month").json()["period"] == "month"
    assert client.get("/api/energy?period=year").status_code == 400
    assert client.get("/api/energy", headers={"X-Jarvis-Token": "wrong"}).status_code == 401


def test_api_refuses_a_geyser_on_a_relay_with_the_reason(client):
    r = client.post("/api/energy/circuits/G1/relay", json={"channel": 10})
    assert r.status_code == 400 and "never goes on a relay" in r.json()["detail"]
    assert client.post("/api/energy/circuits/NOPE/relay", json={"channel": 10}).status_code == 404
    c = {x["id"]: x for x in client.get("/api/energy/circuits").json()["circuits"]}
    assert c["G1"]["relay"] is None and c["G1"]["never_on_relay"] is True


def test_api_light_switch_lands_in_the_ledger_and_records_the_rest(client):
    assert client.post("/api/limbs/light", json={"action": "on"}).status_code == 200
    v = client.get("/api/energy").json()
    assert v["states"]["L1"]["on"] is True
    r = client.post("/api/energy/circuits/AC1/state", json={"on": True}).json()
    assert r["switched"] is False and r["recorded"] is True
    assert client.get("/api/energy").json()["states"]["AC1"]["on"] is True
    client.post("/api/energy/circuits/AC1/state", json={"on": False})


def test_api_auto_off_setting_and_unknown_nudges(client):
    assert client.post("/api/energy/auto-off", json={"enabled": True}).json()["auto_off_enabled"] is True
    assert client.get("/api/energy").json()["auto_off"] is True
    client.post("/api/energy/auto-off", json={"enabled": False})
    assert client.post("/api/energy/nudges/n999/keep").status_code == 404
