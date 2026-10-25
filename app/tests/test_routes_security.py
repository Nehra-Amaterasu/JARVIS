"""Away mode over HTTP (jarvis_app/routes_security.py), in-process, on a fake LAN.

Every app here has its security folder in a temp dir and its network commands
replaced before any phone is listed, so no test pings anything real."""
import time
import types

import pytest
from starlette.testclient import TestClient

from jarvis_app import routes_security
from jarvis_app.away import Sample
from jarvis_app.routes_security import AppActions
from jarvis_app.security import Guard
from jarvis_app.server import create_app

TOKEN = "test-token-security"
PAPA_MAC = "3a-11-22-33-44-55"


class FakeRun:
    def __init__(self, home=()):
        self.home, self.calls = set(home), []

    def __call__(self, cmd):
        self.calls.append(tuple(cmd))
        if cmd[0] == "arp":
            return ("\r\nInterface: 192.168.1.5 --- 0x3\r\n  Internet Address      Physical Address      Type\r\n"
                    f"  192.168.1.23          {PAPA_MAC}     dynamic   \r\n"
                    "  192.168.1.1           a0-b1-c2-d3-e4-f5     dynamic   \r\n"
                    "  192.168.1.255         ff-ff-ff-ff-ff-ff     static    \r\n")
        if cmd[0] == "netsh":
            return ""
        if cmd[0] == "ping":
            return f"Reply from {cmd[-1]}: bytes=32 time=3ms TTL=64" if cmd[-1] in self.home else "Request timed out."
        raise AssertionError(cmd)


@pytest.fixture
def app_and_net(tmp_path, monkeypatch):
    monkeypatch.setattr(routes_security, "ROOT", tmp_path / "security")
    app = create_app(Guard(8778, TOKEN, extra_hosts=["testserver"]), autostart_aankhen="off", features=['security'])
    sec = app.state.security
    net = FakeRun()
    sec.checker.run = sec.run_cmd = net
    return app, net


@pytest.fixture
def client(app_and_net):
    app, _ = app_and_net
    with TestClient(app) as c:
        c.headers.update({"X-Jarvis-Token": TOKEN})
        yield c


def test_routes_need_the_token(client):
    assert client.get("/api/security", headers={"X-Jarvis-Token": "nope"}).status_code == 401


def test_status_with_nothing_set_up(client):
    st = client.get("/api/security").json()
    assert st["phase"] == "disarmed" and st["phones"] == []
    assert st["auto_arm"]["reason"] == "no family phones are listed"
    assert st["aankhen"] == {"running": False, "mode": None}
    assert any("standing" in x for x in st["limits"]) and any("identity" in x.lower() for x in st["limits"])


def test_phones_are_validated_added_and_removed(client, tmp_path):
    assert client.post("/api/security/phones", json={"name": "Papa", "mac": "not-a-mac"}).status_code == 400
    assert client.post("/api/security/phones", json={"name": "Papa", "ip": "8.8.8.8"}).status_code == 400
    assert client.post("/api/security/phones", json={"name": "", "ip": "192.168.1.23"}).status_code == 400
    r = client.post("/api/security/phones", json={"name": "Papa", "mac": "3A:11:22:33:44:55"})
    assert r.status_code == 200 and r.json()["phones"] == [{"name": "Papa", "mac": PAPA_MAC, "ip": None}]
    assert client.post("/api/security/phones", json={"name": "Again", "mac": PAPA_MAC}).status_code == 400
    assert (tmp_path / "security" / "config.json").exists()
    assert client.delete("/api/security/phones/aa-aa-aa-aa-aa-aa").status_code == 404
    assert client.delete(f"/api/security/phones/{PAPA_MAC.upper()}").json()["phones"] == []


def test_arm_and_disarm_from_the_app_and_voice(client):
    assert client.post("/api/security/arm", json={"by": "auto"}).status_code == 400
    st = client.post("/api/security/arm", json={"by": "voice"}).json()
    assert st["armed"] and st["armed_by"] == "voice" and st["phase"] == "arming" and 55 <= st["exit_left_s"] <= 60
    st = client.post("/api/security/disarm").json()
    assert not st["armed"] and st["phase"] == "disarmed"
    kinds = [e["kind"] for e in client.app.state.svc.bus.history() if e["source"] == "security"]
    assert kinds[-2:] == ["armed", "disarmed"]


def test_config_changes_are_validated_and_saved(client, tmp_path):
    r = client.put("/api/security/config", json={"away_after_min": 20, "auto_arm": False})
    assert r.status_code == 200 and r.json()["away_after_min"] == 20 and r.json()["auto_arm"] is False
    assert client.put("/api/security/config", json={"confirm_k": 12, "confirm_n": 8}).status_code == 400
    assert client.get("/api/security/config").json()["away_after_min"] == 20
    assert '"away_after_min": 20' in (tmp_path / "security" / "config.json").read_text(encoding="utf-8")


def test_incidents_are_listed_and_readable_but_ids_are_checked(client):
    away = client.app.state.security.away
    away.arm("auto")
    t = time.time()
    for i in range(6):
        away.on_sample(Sample(t + i, "simulation", "motion", 4.0, 1.8), t + i)
    lst = client.get("/api/security/incidents").json()
    assert len(lst) == 1 and lst[0]["label"] == "SIMULATED" and "trace" not in lst[0] and lst[0]["trace_n"] >= 4
    one = client.get(f"/api/security/incidents/{lst[0]['id']}").json()
    assert len(one["trace"]) == lst[0]["trace_n"]
    assert client.get("/api/security/incidents/..%2Fstate").status_code == 404
    assert client.get("/api/security/incidents/20260101-000000").status_code == 404
    away.disarm("app")


def test_check_now_and_neighbors_use_the_lan(app_and_net):
    app, net = app_and_net
    with TestClient(app) as c:
        c.headers.update({"X-Jarvis-Token": TOKEN})
        assert c.post("/api/security/check").status_code == 400      # nothing listed
        net.home.add("192.168.1.23")
        c.post("/api/security/phones", json={"name": "Papa", "mac": PAPA_MAC})
        r = c.post("/api/security/check").json()
        assert r["ok"] and r["seen"] == 1
        phones = c.get("/api/security").json()["phones"]
        assert phones[0]["home"] and phones[0]["evidence"] == "ping" and phones[0]["ip_now"] == "192.168.1.23"
        nb = c.get("/api/security/neighbors").json()
        assert [(n["ip"], n["listed"]) for n in nb] == [("192.168.1.23", True), ("192.168.1.1", False)]
        assert nb[0]["randomised_mac"] is True


def test_the_loop_runs_with_the_app_and_never_touches_the_network_without_phones(app_and_net):
    app, net = app_and_net
    app.state.security.TICK_S = 0.05                     # the loop's 1 s tick, shortened: same checks, 3 s less
    with TestClient(app) as c:
        c.headers.update({"X-Jarvis-Token": TOKEN})
        time.sleep(0.3)                                  # several ticks
        assert net.calls == []                           # nothing listed: nothing run
        net.home.add("192.168.1.23")
        c.post("/api/security/phones", json={"name": "Papa", "mac": PAPA_MAC})
        deadline = time.time() + 5
        while app.state.security.checker.last is None and time.time() < deadline:
            time.sleep(0.1)
        assert app.state.security.checker.last is not None   # the background loop checked
    n = len(net.calls)
    time.sleep(0.3)
    assert len(net.calls) == n                           # and stopped with the app


# ------------------------------------------------------------------ receipts
def _svc(changed=("light",), delivered=True, usb=False, running=False, mode="voice"):
    said = []
    limbs = types.SimpleNamespace(apply=lambda *a, **k: {"changed": list(changed),
                                                          "delivered": {"light": delivered} if changed else {}})
    hub = types.SimpleNamespace(can_command=usb)
    core = types.SimpleNamespace(running=running, mode=mode, speak=lambda text: said.append(text))
    return types.SimpleNamespace(limbs=limbs, hub=hub, core=core), said


def test_light_receipts_say_what_happened():
    bus = types.SimpleNamespace(publish=lambda *a, **k: None)
    assert AppActions(_svc(delivered=True)[0], bus).lights_on()["done"] is True
    r = AppActions(_svc(delivered=False)[0], bus).lights_on()
    assert r["done"] is False and "app only" in r["detail"]
    assert AppActions(_svc(changed=(), usb=False)[0], bus).lights_on()["done"] is False


def test_speech_receipts_need_jarvis_running_in_voice_mode():
    bus = types.SimpleNamespace(publish=lambda *a, **k: None)
    svc, said = _svc(running=False)
    assert AppActions(svc, bus).speak("hi")["done"] is False and said == []
    svc, said = _svc(running=True, mode="text")
    assert AppActions(svc, bus).speak("hi")["done"] is False and said == []
    svc, said = _svc(running=True, mode="voice")
    assert AppActions(svc, bus).speak("hi")["done"] is True and said == ["hi"]
