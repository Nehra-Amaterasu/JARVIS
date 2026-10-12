"""F2: the Connect page says only what a real check showed.

The ESP32 is connected only after its handshake (a valid Aankhen frame), the LD2450
only on radar frames from the last 5 s, the voice only when the online voice is
reachable or the offline one installed. Fake serial ports, a fake voice probe and
synthetic logs; no hardware, no network.
"""
import sys
import time
import types

import pytest
from starlette.testclient import TestClient

from jarvis_app import connect, routes_boards
from jarvis_app.security import Guard
from jarvis_app.server import create_app

from aankhen.tests.fakeserial import FakeBoard, FakeUsb   # noqa: E402  (after jarvis_app: path set)

TOKEN = "test-token-boards-1"


def by_id(items):
    return {i["id"]: i for i in items}


def scan(*boards, window_s=0.4):
    return FakeUsb(*boards).finder(window_s=window_s).scan()


# ---------------------------------------------------------------- the ESP32
def test_a_ch340_is_not_an_esp32_until_it_speaks():
    """Before F2 any CH340/CP210x was 'ESP32-S3 sensor board · connected'."""
    items = by_id(connect.board_items(scan(FakeBoard("COM5", "uno"), FakeBoard("COM6", "silent")),
                                      {"running": True, "mode": "simulation", "kind": "simulation"}))
    assert items["esp32"]["status"] == "missing"
    assert "2 unidentified USB serial device(s)" in items["esp32"]["detail"]
    assert items["usb-COM5"]["name"] == "USB serial device · not Aankhen"
    assert "never writes to it" in items["usb-COM5"]["detail"] and "1A86:7523" in items["usb-COM5"]["detail"]
    assert items["usb-COM6"]["name"] == "USB serial device · unidentified"
    assert all(i["status"] != "connected" for i in items.values())


def test_a_board_that_answered_while_the_simulation_runs_is_available():
    info = {"running": True, "mode": "simulation", "kind": "simulation", "scenario": "still",
            "requested_mode": "simulation", "board": {"source": "simulation"}}
    items = by_id(connect.board_items(scan(FakeBoard("COM7", "esp32")), info))
    assert items["esp32"]["status"] == "available"
    assert "COM7" in items["esp32"]["detail"] and "aankhen-3.1.0" in items["esp32"]["detail"]
    assert "still simulation (you chose)" in items["esp32"]["detail"]
    assert "usb-COM7" not in items


def test_the_esp32_is_connected_only_with_a_handshake():
    now = time.time()
    live = {"running": True, "mode": "hardware", "kind": "hardware",
            "board": {"source": "hardware", "port": "COM7", "handshake": True, "handshake_at": now - 12,
                      "fw": "aankhen-3.1.0"}}
    items = by_id(connect.board_items([], live, now=now))
    assert items["esp32"]["status"] == "connected"
    assert "COM7" in items["esp32"]["detail"] and "handshake 12 s ago" in items["esp32"]["detail"]
    # Hardware mode alone, no frame yet: not connected.
    waiting = {"running": True, "mode": "hardware", "kind": "hardware",
               "board": {"source": "hardware", "port": None, "handshake": False,
                         "note": "waiting for ESP32: no Aankhen board answered on USB"}}
    items = by_id(connect.board_items([], waiting, now=now))
    assert items["esp32"]["status"] == "missing" and "no board is talking" in items["esp32"]["detail"]


def test_nothing_plugged_in():
    items = by_id(connect.board_items([], {"running": False}))
    assert items["esp32"]["status"] == "missing"
    assert [i for i in items if i.startswith("usb-")] == []


# ---------------------------------------------------------------- the radar
def test_the_radar_is_connected_only_on_recent_real_frames():
    hw = {"kind": "hardware", "board": {"handshake": True, "radar": {"frames": 400, "last_s": 0.4, "hz": 10.0}}}
    assert connect.radar_item(hw)["status"] == "connected"
    stale = {"kind": "hardware", "board": {"handshake": True, "radar": {"frames": 400, "last_s": 12.0, "hz": 0}}}
    r = connect.radar_item(stale)
    assert r["status"] == "missing" and "12 s ago" in r["detail"]
    never = {"kind": "hardware", "board": {"handshake": True, "radar": {"frames": 0, "last_s": None, "hz": 0}}}
    r = connect.radar_item(never)
    assert r["status"] == "missing" and "no radar frame yet" in r["detail"]
    # Simulated radar frames are not this sensor, however fresh.
    sim = {"kind": "simulation", "board": {"radar": {"frames": 900, "last_s": 0.1, "hz": 10.0}}}
    r = connect.radar_item(sim)
    assert r["status"] == "missing" and "simulat" in r["detail"]
    assert connect.radar_item(None)["status"] == "missing"


# ---------------------------------------------------------------- the voice
def test_voice_online_reachable():
    t = connect.tts_item([], online={"ok": True, "ms": 42}, kokoro=(False, "Kokoro model files missing"))
    assert t["status"] == "connected" and "42 ms" in t["detail"] and "no offline fallback" in t["detail"]


def test_voice_engine_log_beats_the_network_probe():
    now = time.time()
    logs = [{"t": now - 20, "line": "[voice] online voice failed (ClientConnectorError: Cannot connect); "
                                    "offline voice for 60 s"}]
    called = []
    t = connect.tts_item(logs, kokoro=(True, "Kokoro-82M on the CPU"), now=now,
                         probe=lambda: called.append(1) or {"ok": True, "ms": 1})
    assert called == []                                  # the engine already said: no network call
    assert t["status"] == "connected" and t["detail"].startswith("Speaking offline")
    assert "online voice failed 20 s ago (ClientConnectorError" in t["detail"]
    t = connect.tts_item(logs, kokoro=(False, "Kokoro model files missing"), now=now)
    assert t["status"] == "missing" and "cannot speak" in t["detail"]
    # A failure older than the engine's 60 s cool-down is history: ask the network.
    old = [{"t": now - 300, "line": logs[0]["line"]}]
    t = connect.tts_item(old, kokoro=(False, "x"), now=now, probe=lambda: {"ok": True, "ms": 9})
    assert t["status"] == "connected" and "9 ms" in t["detail"]


def test_offline_only_is_a_readiness_unless_the_engine_switched():
    t = connect.tts_item([], online={"ok": False, "error": "gaierror"}, kokoro=(True, "Kokoro-82M on the CPU"))
    assert t["status"] == "connected"
    assert t["detail"].startswith("Offline voice ready") and "unreachable (gaierror)" in t["detail"]


def test_an_offline_voice_failure_counts():
    now = time.time()
    logs = [{"t": now - 5, "line": "[voice] offline voice failed: RuntimeError: espeak missing"}]
    t = connect.tts_item(logs, online={"ok": False, "error": "gaierror"}, kokoro=(True, "ok"), now=now)
    assert t["status"] == "missing" and "Kokoro failed 5 s ago" in t["detail"]


def test_the_voice_probe_is_one_small_cached_connect(monkeypatch):
    monkeypatch.setattr(connect, "_probe_cache", {})
    calls = []

    class Conn:
        def __enter__(self):
            return self

        def __exit__(self, *a):
            return False

    def fake_connect(addr, timeout):
        calls.append((addr, timeout))
        return Conn()
    a = connect.online_voice_reachable(fake_connect, now=1000.0)
    b = connect.online_voice_reachable(fake_connect, now=1000.0 + connect.VOICE_PROBE_TTL_S - 1)
    assert a["ok"] and b is a and len(calls) == 1
    assert calls[0][0] == connect.VOICE_HOST and calls[0][1] <= 2
    connect.online_voice_reachable(fake_connect, now=1000.0 + connect.VOICE_PROBE_TTL_S + 1)
    assert len(calls) == 2

    def refused(addr, timeout):
        raise ConnectionRefusedError()
    monkeypatch.setattr(connect, "_probe_cache", {})
    r = connect.online_voice_reachable(refused, now=5.0)
    assert r == {"ok": False, "error": "ConnectionRefusedError", "at": 5.0}


def test_kokoro_needs_its_files(tmp_path):
    ok, why = connect.kokoro_ready(tmp_path)
    assert not ok and "kokoro-v1.0.int8.onnx" in why
    for f in connect.KOKORO_FILES:
        (tmp_path / f).write_bytes(b"x")
    ok, why = connect.kokoro_ready(tmp_path)
    assert ok                                            # kokoro_onnx and soundfile are installed


# ---------------------------------------------------------------- end to end
@pytest.fixture
def client(monkeypatch):
    # The other live checks in detect() — never reached for in a test.
    monkeypatch.setattr(connect.httpx, "get", lambda *a, **k: (_ for _ in ()).throw(OSError("no ollama")))
    monkeypatch.setattr(connect, "_port_open", lambda *a, **k: False)
    monkeypatch.setitem(sys.modules, "sounddevice", types.SimpleNamespace(
        query_devices=lambda kind=None: (_ for _ in ()).throw(OSError("no audio"))))
    monkeypatch.setattr(connect, "kokoro_ready", lambda model_dir=None: (True, "Kokoro-82M on the CPU"))
    monkeypatch.setattr(connect, "online_voice_reachable", lambda connect=None, now=None: {"ok": False, "error": "gaierror"})
    guard = Guard(8779, TOKEN, extra_hosts=["testserver"])
    app = create_app(guard, autostart_aankhen="off")
    with TestClient(app) as c:
        c.headers.update({"X-Jarvis-Token": TOKEN})
        yield c
        c.app.state.svc.hub.stop()


def test_connect_endpoint_end_to_end(client):
    svc = client.app.state.svc
    uno, board = FakeBoard("COM5", "uno"), FakeBoard("COM7", "esp32", radar=True, period_s=0.1)
    svc.hub.boards = FakeUsb(uno, board).finder(window_s=0.4)
    svc.core.logs.append({"t": time.time() - 3, "line": "[voice] online voice failed (TimeoutError: ); offline voice for 60 s"})
    items = by_id(client.get("/api/connect").json())
    assert items["esp32"]["status"] == "available"           # answered, but Aankhen is stopped
    assert items["usb-COM5"]["name"] == "USB serial device · not Aankhen"
    assert items["ld2450"]["status"] == "missing"
    assert items["tts"]["status"] == "connected" and items["tts"]["detail"].startswith("Speaking offline")

    assert client.post("/api/aankhen/start", json={"mode": "auto"}).json()["mode"] == "hardware"
    deadline = time.time() + 5
    while time.time() < deadline:
        items = by_id(client.get("/api/connect").json())
        if items["esp32"]["status"] == "connected" and items["ld2450"]["status"] == "connected":
            break
        time.sleep(0.1)
    assert items["esp32"]["status"] == "connected" and "COM7" in items["esp32"]["detail"]
    assert items["ld2450"]["status"] == "connected"
    assert bytes(uno.written) == b""


def test_boards_routes(client):
    svc = client.app.state.svc
    usb = FakeUsb(FakeBoard("COM5", "uno"), FakeBoard("COM7", "esp32"))
    svc.hub.boards = usb.finder(window_s=0.4, force_fresh_s=0.0)
    v = client.get("/api/boards").json()
    assert {p["device"]: p["verdict"] for p in v["ports"]} == {"COM5": "foreign", "COM7": "aankhen"}
    assert v["hotplug"]["enabled"] is False                  # AANKHEN_HOTPLUG=0 in the test suite
    assert usb.boards["COM5"].opens == 1
    v = client.post("/api/boards/scan").json()               # a person asked: look again
    assert usb.boards["COM5"].opens == 2
    ev = [e for e in svc.bus.history(20) if e["source"] == "aankhen" and e["kind"] == "scan"]
    assert ev and ev[-1]["text"] == "USB scan: Aankhen board on COM7; 1 other device(s)"


def test_hotplug_is_wired_to_the_bus_unless_switched_off(monkeypatch):
    monkeypatch.setenv("AANKHEN_HOTPLUG", "1")
    assert routes_boards.hotplug_wanted()
    app = create_app(Guard(8780, TOKEN, extra_hosts=["testserver"]), autostart_aankhen="off")
    svc = app.state.svc
    try:
        assert svc.hub.hotplug_info()["enabled"] and not svc.hub.hotplug_info()["watching"]
        svc.hub._emit_hotplug("source", "ESP32 found on COM7: switched", port="COM7")
        ev = svc.bus.history(5)[-1]
        assert (ev["source"], ev["kind"], ev["text"], ev["port"]) == ("aankhen", "source",
                                                                     "ESP32 found on COM7: switched", "COM7")
    finally:
        svc.hub.stop()
    for off in ("0", "off", "false", "no"):
        monkeypatch.setenv("AANKHEN_HOTPLUG", off)
        assert not routes_boards.hotplug_wanted()
