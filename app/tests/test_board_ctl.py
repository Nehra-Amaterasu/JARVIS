"""The Limbs tab's board control (board_ctl.py, routes_board_ctl.py), with arduino-cli and
espota mocked: no test compiles, uploads, opens a serial port or touches the network.

What must hold:
  - compile and upload commands are built exactly (fqbn, libraries, output dir, port);
  - nothing uploads without a plan AND confirm=true, and a plan is used once;
  - a USB flash frees the hub's port before the upload and gives it back after, even
    when the upload fails;
  - a Wi-Fi flash never puts the OTA password on a command line;
  - config.h edits are validated (strapping/USB/flash pins refused) and keep the file's
    comments; secrets.h is never served;
  - a relay test click goes through Limbs, toggles for 1 s, restores, and says what the
    board reported.
"""
import json
import shutil
import threading
import types
from pathlib import Path

import pytest
from starlette.testclient import TestClient

from jarvis_app import board_ctl
from jarvis_app.board_ctl import (ESPOTA_LAUNCHER, FQBN, IMAGE, BoardControl, Conflict, NotFound, Refused,
                                  Tools, check_ip, compile_cmd, parse_defines, usb_upload_cmd, validate_config,
                                  wifi_upload_cmd, write_defines)
from jarvis_app.bus import EventBus
from jarvis_app.limbs import Limbs
from jarvis_app.paths import REPO
from jarvis_app.security import Guard
from jarvis_app.server import create_app

REAL_FIRMWARE = REPO / "aankhen" / "firmware"
TOOLS = Tools(cli=r"C:\ide\arduino-cli.exe", cli_config=r"C:\Users\me\.arduinoIDE\arduino-cli.yaml",
              espota=r"C:\esp32\3.3.12\tools\espota.py", python=r"C:\venv\python.exe")
COMPILE_OK = (b"Sketch uses 1003512 bytes (76%) of program storage space. Maximum is 1310720 bytes.\n"
              b"Global variables use 48120 bytes (14%) of dynamic memory, leaving 279560 bytes for local "
              b"variables. Maximum is 327680 bytes.\n")


# ---------------------------------------------------------------------- fakes
class FakeProc:
    def __init__(self, out: bytes, rc: int):
        self.stdout = types.SimpleNamespace(read=self._read)
        self._out, self._rc = out, rc

    def _read(self, n):
        chunk, self._out = self._out[:n], self._out[n:]
        return chunk

    def wait(self):
        return self._rc

    def kill(self):
        pass


class FakePopen:
    """Records every command; plays a script per tool. on_start(cmd) runs as the tool
    starts, which is where a test checks what is true DURING an upload."""

    def __init__(self, out_dir: Path, image: bytes = b"\x00" * 64 + b"ota: listening on UDP 3232\x00"):
        self.calls: list[dict] = []
        self.out_dir, self.image = out_dir, image
        self.rc = {"compile": 0, "upload": 0, "espota": 0}
        self.out = {"compile": COMPILE_OK,
                    "upload": b"Writing at 0x00010000 [=>   ]  10.0% 100/1000 bytes...\r"
                              b"Writing at 0x00090000 [====>]  100.0% 1000/1000 bytes...\nHard resetting via RTS pin...\n",
                    "espota": b"Uploading: [=====     ] 50% \rUploading: [==========] 100% Done...\r\n"}
        self.on_start = None

    def __call__(self, cmd, **kw):
        tool = "espota" if ESPOTA_LAUNCHER in cmd else cmd[cmd.index("--fqbn") - 1]
        self.calls.append({"tool": tool, "cmd": list(cmd), "env": kw.get("env")})
        if self.on_start:
            self.on_start(tool, cmd)
        if tool == "compile" and self.rc["compile"] == 0:
            self.out_dir.mkdir(parents=True, exist_ok=True)
            (self.out_dir / IMAGE).write_bytes(self.image)
        return FakeProc(self.out[tool], self.rc[tool])


class FakeCore:
    running = False
    room_listener = None

    def info(self):
        return {"running": False, "mqtt": None}


class FakeHub:
    """A hub with a board on COM7: relays echo back in STATUS, the port can be lent."""

    def __init__(self, connected=True, kind="hardware", log=None):
        self.connected, self.kind = connected, kind
        self.relays = {"light": False, "fan": False}
        self.log = log if log is not None else []
        self.port_free = False
        self.hold = None
        self.status = {"fw": "aankhen-3.3.0", "uptime_s": 12.5, "ip": "192.168.1.50", "wifi": "connected",
                       "rssi": -51, "csi_hz": 498, "ota": False}

    @property
    def can_command(self):
        return self.connected

    def command(self, payload):
        if not self.connected:
            return False
        self.relays[payload["relay"]] = payload["on"]
        return True

    def device_status(self):
        return {**self.status, "relays": dict(self.relays)} if self.connected else {}

    def info(self):
        return {"running": True, "mode": self.kind, "kind": self.kind, "port": "COM7" if self.kind == "hardware" else None,
                "hold": self.hold, "board": {"port": "COM7", "handshake": self.connected, "fw": "aankhen-3.3.0"}}

    def link(self):
        return {"frames_ok": 100, "crc_errors": 0}

    def boards_seen(self):
        board = types.SimpleNamespace(device="COM7", is_board=True, in_use=True, verdict="aankhen", detail="live")
        uno = types.SimpleNamespace(device="COM5", is_board=False, in_use=False, verdict="foreign", detail="text")
        return [board, uno]

    def lend_port(self, port, reason):
        self.log.append(("lend", port))
        self.port_free, self.hold = True, reason
        return {"port": port, "stopped": True}

    def return_port(self, loan):
        self.log.append(("return", loan["port"]))
        self.port_free, self.hold = False, None
        return {"mode": "hardware", "port": loan["port"]}


@pytest.fixture
def fw(tmp_path):
    """A copy of the real firmware sources (secrets.h a stand-in): tests write config.h
    here, never in the repo."""
    d = tmp_path / "firmware"
    d.mkdir()
    for name in ("firmware.ino", "config.h", "secrets.example.h"):
        shutil.copy(REAL_FIRMWARE / name, d / name)
    (d / "secrets.h").write_text("// test stand-in\n", encoding="utf-8")
    (d / "libraries").mkdir()
    return d


@pytest.fixture
def rig(tmp_path, fw):
    bus = EventBus()
    log = []
    hub = FakeHub(log=log)
    limbs = Limbs(FakeCore(), hub, bus, path=tmp_path / "room.json", circuits=None)
    out = tmp_path / "data" / "firmware" / "build"
    popen = FakePopen(out)
    ctl = BoardControl(hub, limbs, bus, data_dir=tmp_path / "data", firmware_dir=fw, tools=TOOLS,
                       popen=popen, http_get=lambda url, headers, timeout: (_ for _ in ()).throw(OSError("offline")),
                       sleep=lambda s: None)
    return types.SimpleNamespace(ctl=ctl, hub=hub, bus=bus, popen=popen, log=log, fw=fw, out=out, limbs=limbs)


def compiled(rig):
    rig.ctl.start_compile()
    job = rig.ctl.wait()
    assert job["state"] == "ok", job
    return job


# ---------------------------------------------------------------------- commands
def test_compile_and_upload_commands_are_exact(tmp_path):
    sketch, out = Path(r"C:\JARVIS\aankhen\firmware"), Path(r"C:\JARVIS\data\app\firmware\build")
    assert compile_cmd(TOOLS, sketch, out) == [
        TOOLS.cli, "--config-file", TOOLS.cli_config, "compile", "--fqbn", "esp32:esp32:esp32s3:CDCOnBoot=cdc",
        "--libraries", str(sketch / "libraries"), "--output-dir", str(out), str(sketch)]
    assert usb_upload_cmd(TOOLS, sketch, out, "COM9") == [
        TOOLS.cli, "--config-file", TOOLS.cli_config, "upload", "--fqbn", FQBN, "-p", "COM9",
        "--input-dir", str(out), str(sketch)]
    cmd = wifi_upload_cmd(TOOLS, out / IMAGE, "192.168.1.50")
    assert cmd[:4] == [TOOLS.python, "-I", "-c", ESPOTA_LAUNCHER]
    assert cmd[4:] == [TOOLS.espota, "-i", "192.168.1.50", "-p", "3232", "-f", str(out / IMAGE), "-r", "-t", "15"]
    no_cfg = Tools(cli="arduino-cli", cli_config=None, espota=None)
    assert compile_cmd(no_cfg, sketch, out)[:2] == ["arduino-cli", "compile"]


def test_compile_job_records_size_ota_and_streams_to_the_bus(rig):
    job = compiled(rig)
    call = rig.popen.calls[0]
    assert call["cmd"] == compile_cmd(TOOLS, rig.fw, rig.out)
    assert str(rig.out).startswith(str(rig.ctl.data_dir))          # the image stays in the private data dir
    r = job["result"]
    assert (r["flash_bytes"], r["flash_max"], r["flash_pct"], r["ram_bytes"]) == (1003512, 1310720, 76, 48120)
    assert r["ota_in_build"] is True and r["relay_token_in_build"] is False
    assert r["version"] == board_ctl.fw_version(rig.fw) and r["version"].startswith("aankhen-")
    texts = [e["text"] for e in rig.bus.history() if e["source"] == "board"]
    assert texts[0].startswith("Compiling aankhen-") and texts[-1].startswith("Compiled aankhen-")
    assert "76 % of the 1,310,720-byte app slot" in texts[-1] and "OTA on" in texts[-1]
    assert rig.ctl.view()["build"]["fresh"] is True


def test_a_failed_compile_says_why_and_leaves_nothing_to_flash(rig):
    rig.popen.rc["compile"] = 1
    rig.popen.out["compile"] = b"firmware.ino:12:3: error: 'Relay' does not name a type\n"
    rig.ctl.start_compile()
    job = rig.ctl.wait()
    assert job["state"] == "failed" and "does not name a type" in job["result"]["summary"]
    with pytest.raises(Conflict, match="nothing compiled"):
        rig.ctl.plan_flash("usb", port="COM7")


def test_compile_needs_secrets_h(rig):
    (rig.fw / "secrets.h").unlink()
    with pytest.raises(Conflict, match="secrets.h is missing"):
        rig.ctl.start_compile()
    assert rig.popen.calls == []


# ---------------------------------------------------------------------- the confirm gate
def test_nothing_uploads_without_a_plan_and_confirm_true(rig):
    compiled(rig)
    plan = rig.ctl.plan_flash("usb", port="COM7")
    assert plan["port"] == "COM7" and plan["steps"][0].startswith("Stop Aankhen's serial link")
    for bad in (None, False, "yes", "true", 1):
        with pytest.raises(Refused, match="confirm=true"):
            rig.ctl.flash(plan["id"], bad)
    with pytest.raises(NotFound):
        rig.ctl.flash("made-up-plan", True)
    assert [c["tool"] for c in rig.popen.calls] == ["compile"]     # not one upload so far
    rig.ctl.flash(plan["id"], True)
    assert rig.ctl.wait()["state"] == "ok"
    assert [c["tool"] for c in rig.popen.calls] == ["compile", "upload"]
    with pytest.raises(NotFound):                                  # a plan is used once
        rig.ctl.flash(plan["id"], True)


def test_a_plan_expires_and_a_rebuild_voids_it(rig, monkeypatch):
    compiled(rig)
    plan = rig.ctl.plan_flash("usb", port="COM7")
    rig.ctl._plans[plan["id"]]["expires_at"] = 0
    with pytest.raises(Conflict, match="expired"):
        rig.ctl.flash(plan["id"], True)
    plan = rig.ctl.plan_flash("usb", port="COM7")
    (rig.fw / "config.h").write_text((rig.fw / "config.h").read_text(encoding="utf-8") + "\n", encoding="utf-8")
    with pytest.raises(Conflict, match="changed since the last compile"):
        rig.ctl.flash(plan["id"], True)
    assert [c["tool"] for c in rig.popen.calls] == ["compile"]


def test_usb_plan_refuses_a_port_that_is_not_there(rig):
    compiled(rig)
    with pytest.raises(Refused, match="COM99 is not a USB serial port"):
        rig.ctl.plan_flash("usb", port="COM99")
    with pytest.raises(Refused, match="usb or wifi"):
        rig.ctl.plan_flash("bluetooth")
    warn = rig.ctl.plan_flash("usb", port="COM5")["warnings"]           # the Uno: allowed, but said
    assert warn and "has not identified itself" in warn[0]


# ---------------------------------------------------------------------- USB: port freed, then restored
def test_usb_flash_frees_the_port_for_the_upload_and_restores_it(rig):
    compiled(rig)
    during = {}

    def on_start(tool, cmd):
        if tool == "upload":
            rig.log.append(("upload", cmd[cmd.index("-p") + 1]))
            during.update(port_free=rig.hub.port_free, hold=rig.hub.hold)
    rig.popen.on_start = on_start
    plan = rig.ctl.plan_flash("usb", port="COM7")
    rig.ctl.flash(plan["id"], True)
    job = rig.ctl.wait()
    assert rig.log == [("lend", "COM7"), ("upload", "COM7"), ("return", "COM7")]
    assert during == {"port_free": True, "hold": "flashing firmware over COM7"}
    assert rig.hub.port_free is False and rig.hub.hold is None
    assert job["state"] == "ok" and job["result"]["aankhen_restarted"] == "COM7" and job["pct"] == 100.0
    assert rig.popen.calls[-1]["cmd"] == usb_upload_cmd(TOOLS, rig.fw, rig.out, "COM7")
    texts = [e["text"] for e in rig.bus.history()]
    assert "Aankhen paused: flashing firmware over COM7" in texts
    assert any(t.startswith("Aankhen restarted on COM7") for t in texts)


def test_a_failed_upload_still_gives_the_port_back(rig):
    compiled(rig)
    rig.popen.rc["upload"] = 2
    rig.popen.out["upload"] = b"A fatal error occurred: Failed to connect to ESP32-S3: No serial data received.\n"
    rig.ctl.flash(rig.ctl.plan_flash("usb", port="COM7")["id"], True)
    job = rig.ctl.wait()
    assert job["state"] == "failed" and "Failed to connect" in job["result"]["summary"]
    assert rig.log == [("lend", "COM7"), ("return", "COM7")] and rig.hub.hold is None


def test_one_job_at_a_time(rig):
    compiled(rig)
    gate = threading.Event()
    rig.popen.on_start = lambda tool, cmd: gate.wait(5)
    rig.ctl.flash(rig.ctl.plan_flash("usb", port="COM7")["id"], True)
    with pytest.raises(Conflict, match="busy"):
        rig.ctl.start_compile()
    with pytest.raises(Conflict, match="busy"):
        rig.ctl.plan_flash("usb", port="COM7")
    gate.set()
    assert rig.ctl.wait()["state"] == "ok"


# ---------------------------------------------------------------------- Wi-Fi
def test_wifi_flash_keeps_the_password_off_the_command_line(rig):
    compiled(rig)
    plan = rig.ctl.plan_flash("wifi", ip="192.168.1.50")
    assert plan["needs_password"] and plan["ip"] == "192.168.1.50"
    assert any("did not answer" in w for w in plan["warnings"])        # http_get is offline here
    with pytest.raises(Refused, match="OTA password"):
        rig.ctl.flash(plan["id"], True)
    rig.ctl.flash(plan["id"], True, password="correct-horse-battery")
    job = rig.ctl.wait()
    call = rig.popen.calls[-1]
    assert job["state"] == "ok" and job["pct"] == 100.0
    assert call["cmd"] == wifi_upload_cmd(TOOLS, rig.out / IMAGE, "192.168.1.50")
    assert not any("correct-horse" in c for c in call["cmd"])
    assert call["env"]["AANKHEN_OTA_AUTH"] == "correct-horse-battery"
    assert "correct-horse" not in json.dumps(job) and rig.log == []    # the USB port was never touched


def test_the_launcher_hands_espota_the_password_from_the_environment(tmp_path):
    """Run the real launcher against a stand-in espota.py that prints its argv."""
    import subprocess
    import sys
    fake = tmp_path / "espota.py"
    fake.write_text("import sys, os, json; print(json.dumps([sys.argv, 'AANKHEN_OTA_AUTH' in os.environ]))",
                    encoding="utf-8")
    env = {**__import__("os").environ, "AANKHEN_OTA_AUTH": "s3cret-pass-123"}
    out = subprocess.run([sys.executable, "-I", "-c", ESPOTA_LAUNCHER, str(fake), "-i", "192.168.1.5"],
                         capture_output=True, text=True, env=env, timeout=30)
    argv, still_in_env = json.loads(out.stdout)
    assert argv == [str(fake), "-i", "192.168.1.5", "-a", "s3cret-pass-123"] and still_in_env is False


@pytest.mark.parametrize("ip", ["8.8.8.8", "127.0.0.1", "0.0.0.0", "not-an-ip", "224.0.0.1"])
def test_only_home_network_addresses(ip):
    with pytest.raises(Refused):
        check_ip(ip)
    assert check_ip(" 10.0.0.7 ") == "10.0.0.7"


def test_the_board_over_wifi(rig):
    rig.hub.connected = False
    rig.ctl.set_ip("192.168.1.50")
    rig.ctl.http_get = lambda url, headers, timeout: (200, json.dumps(
        {"fw": "aankhen-3.4.0", "uptime_s": 33.0, "rssi": -60, "csi_hz": 500, "ota": True, "full": False}))
    v = rig.ctl.view()
    assert v["link"] == "wifi" and v["wifi"]["status"]["fw"] == "aankhen-3.4.0" and v["wifi"]["full"] is False
    assert v["firmware"] == {"repo": board_ctl.fw_version(rig.fw), "running": "aankhen-3.4.0",
                             "differs": board_ctl.fw_version(rig.fw) != "aankhen-3.4.0", "ota": True}
    rig.ctl.http_get = lambda url, headers, timeout: (404, "not found")
    assert rig.ctl.wifi_probe("192.168.1.50", force=True)["note"].startswith("answers, but has no /status")


# ---------------------------------------------------------------------- the panel
def test_the_simulators_status_is_never_shown_as_the_board(rig):
    rig.hub.kind, rig.hub.connected = "simulation", False
    v = rig.ctl.view()
    assert v["status"] is None and v["usb"] is None and v["link"] == "none"


def test_usb_status_is_shown_and_its_ip_remembered(rig):
    v = rig.ctl.view()
    assert v["link"] == "usb" and v["status"]["csi_hz"] == 498 and v["usb"]["port"] == "COM7"
    assert v["ip"] == "192.168.1.50" and v["ip_source"] == "usb"
    assert json.loads((rig.ctl.data_dir / "board.json").read_text())["ip"] == "192.168.1.50"


# ---------------------------------------------------------------------- config.h
def test_config_form_reads_the_real_config_h():
    values = parse_defines((REAL_FIRMWARE / "config.h").read_text(encoding="utf-8"))
    for key in board_ctl.FIELD_KEYS:
        assert key in values, f"{key} missing from config.h"


@pytest.mark.parametrize("changes, why", [
    ({"RELAY_LIGHT_PIN": 0}, "strapping pin"),
    ({"RELAY_FAN_PIN": 19}, "USB data line"),
    ({"RELAY_FAN_PIN": 30}, "SPI flash"),
    ({"RELAY_FAN_PIN": 43}, "UART0"),
    ({"RELAY_FAN_PIN": 18}, "radar's UART"),
    ({"RELAY_FAN_PIN": 4}, "cannot share GPIO 4"),
    ({"RELAY_ACTIVE_LOW": 2}, "0 or 1"),
    ({"CSI_RATE_HZ": 300}, "must be one of"),
    ({"RELAY_FAN_PIN": "five"}, "not a whole number"),
    ({"WIFI_PASS_VALUE": 1}, "not editable"),
])
def test_bad_values_are_refused(changes, why):
    current = parse_defines((REAL_FIRMWARE / "config.h").read_text(encoding="utf-8"))
    with pytest.raises(Refused, match=why):
        validate_config(current, changes)


def test_a_valid_edit_rewrites_only_the_number(rig):
    before = (rig.fw / "config.h").read_text(encoding="utf-8")
    r = rig.ctl.update_config({"RELAY_FAN_PIN": 6, "BEACON_ENABLED": False, "CSI_RATE_HZ": 500})
    after = (rig.fw / "config.h").read_text(encoding="utf-8")
    assert r["changed"] == {"RELAY_FAN_PIN": [5, 6], "BEACON_ENABLED": [1, 0]}
    assert r["values"]["RELAY_FAN_PIN"] == 6 and r["values"]["BEACON_ENABLED"] == 0
    assert after == before.replace("#define RELAY_FAN_PIN 5", "#define RELAY_FAN_PIN 6").replace(
        "#define BEACON_ENABLED 1", "#define BEACON_ENABLED 0")
    assert any(e["source"] == "board" and e["kind"] == "config" for e in rig.bus.history())
    assert (rig.fw / "secrets.h").read_text(encoding="utf-8") == "// test stand-in\n"


def test_write_defines_keeps_trailing_comments():
    text = "#define A 1   // why: one\n#define B -1\n"
    assert write_defines(text, {"A": 2, "B": 7}) == "#define A 2   // why: one\n#define B 7\n"
    with pytest.raises(Refused):
        write_defines(text, {"C": 1})


def test_source_viewer_never_serves_secrets(rig):
    assert rig.ctl.source("firmware.ino")["text"].startswith("// Aankhen ESP32-S3 firmware")
    for name in ("secrets.h", "../secrets.h", "secrets.example.h", "C:/Windows/win.ini"):
        with pytest.raises(NotFound):
            rig.ctl.source(name)


# ---------------------------------------------------------------------- relay test click
def test_a_test_click_toggles_for_a_second_and_restores_with_a_receipt(rig):
    slept = []
    rig.ctl.sleep = slept.append
    r = rig.ctl.relay_test("fan")
    assert [s["action"] for s in r["steps"]] == ["on", "off"]
    assert [s["board_says"] for s in r["steps"]] == [True, False]
    assert r["ok"] and r["restored"] and r["confirmed"] and r["pin"] == 5 and r["active_low"] is True
    assert 1.0 in slept and rig.limbs.state["fan"]["on"] is False
    ev = [e for e in rig.bus.history() if e["source"] == "limbs" and e["kind"] == "test"]
    assert ev and "GPIO 5" in ev[-1]["text"] and "confirmed both" in ev[-1]["text"]
    rig.limbs.apply("light", "on")
    r = rig.ctl.relay_test("light")
    assert [s["action"] for s in r["steps"]] == ["off", "on"] and rig.limbs.state["light"]["on"] is True


def test_a_test_click_needs_the_board_and_a_real_relay_name(rig):
    with pytest.raises(NotFound):
        rig.ctl.relay_test("geyser")
    rig.hub.connected = False
    with pytest.raises(Conflict, match="no board on USB"):
        rig.ctl.relay_test("light")


def test_a_board_that_does_not_confirm_is_reported(rig):
    rig.hub.device_status = lambda: {"relays": {"light": None, "fan": None}}   # pin -1 on the board
    r = rig.ctl.relay_test("light")
    assert r["delivered"] and not r["confirmed"] and not r["ok"] and "did not match" in r["text"]


# ---------------------------------------------------------------------- the routes
TOKEN = "test-token-board"


@pytest.fixture
def client(tmp_path, fw):
    app = create_app(Guard(8781, TOKEN, extra_hosts=["testserver"]), autostart_aankhen="off")
    with TestClient(app) as c:
        c.headers.update({"X-Jarvis-Token": TOKEN})
        ctl = c.app.state.board_ctl
        ctl.firmware_dir, ctl.tools = fw, TOOLS
        ctl.out_dir = tmp_path / "build"
        ctl.state_file = tmp_path / "board.json"
        ctl._state = {}
        ctl.popen = FakePopen(ctl.out_dir)
        ctl.http_get = lambda url, headers, timeout: (_ for _ in ()).throw(OSError("offline"))
        yield c


def test_routes_need_the_token(client):
    assert client.get("/api/board", headers={"X-Jarvis-Token": "nope"}).status_code == 401
    assert client.post("/api/board/flash", json={"plan_id": "x", "confirm": True},
                       headers={"X-Jarvis-Token": ""}).status_code == 401


def test_routes_compile_then_refuse_a_flash_without_confirm(client):
    v = client.get("/api/board").json()
    assert v["link"] == "none" and v["status"] is None and v["tools"]["arduino_cli"]
    assert client.post("/api/board/compile").status_code == 200
    job = client.app.state.board_ctl.wait()
    assert job["state"] == "ok"
    assert client.get("/api/board/job").json()["job"]["result"]["flash_bytes"] == 1003512
    plan = client.post("/api/board/flash/plan", json={"target": "wifi", "ip": "192.168.1.50"}).json()
    r = client.post("/api/board/flash", json={"plan_id": plan["id"], "password": "abcdefghijkl"})
    assert r.status_code == 400 and "confirm=true" in r.json()["detail"]
    r = client.post("/api/board/flash", json={"plan_id": plan["id"], "confirm": "yes", "password": "abcdefghijkl"})
    assert r.status_code == 400
    assert [c["tool"] for c in client.app.state.board_ctl.popen.calls] == ["compile"]
    assert client.post("/api/board/flash/plan", json={"target": "wifi", "ip": "8.8.8.8"}).status_code == 400


def test_routes_config_and_source(client, fw):
    cfg = client.get("/api/board/config").json()
    assert cfg["values"]["RELAY_LIGHT_PIN"] == 4 and cfg["readonly"]["AK_GAIN_LIB"] in (0, 1)
    r = client.post("/api/board/config", json={"changes": {"RELAY_LIGHT_PIN": 46}})
    assert r.status_code == 400 and "strapping pin" in r.json()["detail"]
    r = client.post("/api/board/config", json={"changes": {"RELAY_LIGHT_PIN": 7}})
    assert r.status_code == 200 and "#define RELAY_LIGHT_PIN 7" in (fw / "config.h").read_text(encoding="utf-8")
    assert client.get("/api/board/source", params={"name": "secrets.h"}).status_code == 404
    assert client.get("/api/board/source", params={"name": "config.h"}).json()["text"].count("RELAY_LIGHT_PIN 7") == 1


def test_routes_relay_test_refuses_without_a_board(client):
    r = client.post("/api/board/relay-test/light")
    assert r.status_code == 409 and "no board on USB" in r.json()["detail"]
