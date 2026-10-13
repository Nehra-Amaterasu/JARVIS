"""Board control: the ESP32 behind the Limbs tab, its firmware, and flashing it.

What it answers and does (routes in routes_board_ctl.py):

    view()            the board as JARVIS sees it right now: over USB (the hub's live link
                      and the board's own STATUS frame) or over Wi-Fi (GET /status on the
                      board, firmware 3.4.0+), never the simulator's STATUS
    config_*()        the user-tunable #defines of aankhen/firmware/config.h, read and
                      written through a validated form (secrets.h is never opened)
    start_compile()   arduino-cli compile into a scratch output dir under data/ (the image
                      carries the Wi-Fi password, so it stays in the private data folder)
    plan_flash()      step 1 of 2: what a flash WOULD do, with a single-use plan id
    flash()           step 2 of 2: only with that plan id AND confirm=true. USB uploads
                      borrow the port from the Aankhen hub (hub.lend_port) and give it
                      back; Wi-Fi uploads go through the core's espota.py
    relay_test()      one relay toggled for 1 s and restored, through Limbs.apply (the
                      same path the switches use), with a receipt of what the board said

Every long job (compile, flash) runs on one background thread at a time and streams to
the event bus: milestones as "board" events the ticker keeps, percentages as ephemeral
"progress" events it does not.
"""
from __future__ import annotations

import glob
import hashlib
import ipaddress
import json
import os
import re
import secrets
import shutil
import subprocess
import sys
import threading
import time
from collections import deque
from pathlib import Path
from typing import Callable, Optional

import httpx

from .paths import DATA, REPO

FIRMWARE_DIR = Path(os.environ.get("AANKHEN_FIRMWARE_DIR") or (REPO / "aankhen" / "firmware"))
FQBN = "esp32:esp32:esp32s3:CDCOnBoot=cdc"   # README.md section 4: native USB, CDC on boot
OTA_PORT = 3232                               # ArduinoOTA's default UDP port
PLAN_TTL_S = 120.0                            # a confirm dialog left open longer plans again
COMPILE_TIMEOUT_S = 900.0                     # a cold core build took ~4 min on this laptop
UPLOAD_TIMEOUT_S = 240.0                      # USB at 921,600 baud: ~25 s for ~1 MB
WIFI_PROBE_TTL_S = 4.0                        # the panel polls every 2 s; the board is asked half as often
WIFI_PROBE_TIMEOUT_S = 1.5
TEST_HOLD_S = 1.0                             # a test click keeps the relay toggled this long
BOARD_CONFIRM_S = 0.8                         # the firmware confirms a relay in its next STATUS, at once
SOURCE_FILES = ("firmware.ino", "config.h")   # what the read-only viewer may show
IMAGE = "firmware.ino.bin"                    # the app image arduino-cli writes (OTA sends this)
OTA_MARKER = b"ota: listening on UDP 3232"    # firmware.ino startOta(): present only with OTA_PASS_VALUE
TOKEN_MARKER = b"no such relay"               # the /relay handler: present only with RELAY_TOKEN_VALUE

# The ESP32-S3 GPIOs a relay input may use, and why the others may not (ESP32-S3
# datasheet, "Strapping Pins" and "Pin Overview"; ESP32-S3-DevKitC-1 user guide).
SAFE_GPIOS = (1, 2, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 21, 39, 40, 41, 42, 47)
PIN_REASONS = {
    **{p: "a strapping pin: a relay input pulling it at reset can stop the board booting" for p in (0, 3, 45, 46)},
    **{p: "the USB data line JARVIS talks over" for p in (19, 20)},
    **{p: "wired to the SPI flash" for p in range(26, 33)},
    **{p: "used by the octal PSRAM on N8R8/N16R8 modules" for p in range(33, 38)},
    **{p: "the DevKitC-1's RGB LED" for p in (38, 48)},
    **{p: "UART0: the boot ROM prints on it at every reset, which would chatter the relay" for p in (43, 44)},
    **{p: "not a GPIO on the ESP32-S3" for p in (22, 23, 24, 25)},
}

# The #defines the form edits. Everything else in config.h is shown read-only.
CONFIG_FIELDS = [
    {"key": "RELAY_LIGHT_PIN", "label": "Light relay GPIO", "kind": "pin",
     "help": "The GPIO wired to the relay module's IN for the light. -1: no light relay."},
    {"key": "RELAY_FAN_PIN", "label": "Fan relay GPIO", "kind": "pin",
     "help": "The GPIO wired to the relay module's IN for the fan. -1: no fan relay."},
    {"key": "RELAY_ACTIVE_LOW", "label": "Relay module is active-low", "kind": "bool",
     "help": "Most optocoupler modules switch ON when IN is pulled LOW. If yours clicks on at boot, flip it."},
    {"key": "CSI_RATE_HZ", "label": "Router pings per second (link 1)", "kind": "choice",
     "options": [100, 125, 200, 250, 500],
     "help": "CSI captures per second. 500 keeps a ceiling fan's aliases out of the human band; ~15-25 % of the channel."},
    {"key": "BEACON_ENABLED", "label": "Phone link (link 2)", "kind": "bool",
     "help": "Serve http://<board>/beacon so a phone can become a second Wi-Fi link."},
    {"key": "BEACON_PING_HZ", "label": "Phone pings per second", "kind": "choice",
     "options": [20, 25, 50, 100, 125, 200, 250],
     "help": "Link 2's rate. Each ping is four frames over the air: 100 Hz is ~6-10 % of the channel."},
]
FIELD_KEYS = [f["key"] for f in CONFIG_FIELDS]
READONLY_KEYS = ("AK_GAIN_LIB", "RADAR_RX_PIN", "RADAR_TX_PIN", "RADAR_BAUD")
_DEFINE = re.compile(r"^(?P<head>[ \t]*#define[ \t]+(?P<key>[A-Z][A-Z0-9_]*)[ \t]+)(?P<val>-?\d+)(?P<tail>[^\r\n]*)(?=\r?$)",
                     re.M)   # \r?: the checkout stores config.h with CRLF line ends
_FW_VERSION = re.compile(r'^\s*#define\s+FW_VERSION\s+"([^"]+)"', re.M)
_SIZE = re.compile(r"Sketch uses (\d+) bytes \((\d+)%\) of program storage space\. Maximum is (\d+) bytes")
_RAM = re.compile(r"Global variables use (\d+) bytes \((\d+)%\) of dynamic memory.*Maximum is (\d+) bytes")
_PCT = re.compile(r"(\d{1,3}(?:\.\d+)?)\s?%")

# espota.py takes the password as "-a <password>" on its command line, where every
# process on the machine can read it. This launcher hands it over in the environment
# instead, removes it from there, and runs espota.py unchanged in the same interpreter.
ESPOTA_LAUNCHER = ("import os,runpy,sys;"
                   "p=sys.argv[1];a=os.environ.pop('AANKHEN_OTA_AUTH','');"
                   "sys.argv=[p]+sys.argv[2:]+(['-a',a] if a else []);"
                   "runpy.run_path(p,run_name='__main__')")


class BoardError(Exception):
    status = 400


class Refused(BoardError):
    status = 400


class Conflict(BoardError):
    status = 409


class NotFound(BoardError):
    status = 404


# ---------------------------------------------------------------------- config.h
def parse_defines(text: str) -> dict[str, int]:
    """Every `#define NAME <integer>` line. A name defined twice is an error: the form
    would not know which line the firmware uses."""
    out: dict[str, int] = {}
    for m in _DEFINE.finditer(text):
        k = m.group("key")
        if k in out:
            raise ValueError(f"{k} is defined twice in config.h")
        out[k] = int(m.group("val"))
    return out


def validate_config(current: dict[str, int], changes: dict) -> dict[str, int]:
    """The changed values, checked; raises Refused with every problem at once."""
    problems, clean = [], {}
    unknown = sorted(set(changes) - set(FIELD_KEYS))
    if unknown:
        problems.append(f"not editable here: {', '.join(unknown)}")
    fields = {f["key"]: f for f in CONFIG_FIELDS}
    for key, raw in changes.items():
        f = fields.get(key)
        if f is None:
            continue
        if key not in current:
            problems.append(f"{key} is missing from config.h; add the #define line first")
            continue
        if isinstance(raw, bool):
            val = int(raw)
        elif isinstance(raw, int):
            val = raw
        elif isinstance(raw, str) and re.fullmatch(r"-?\d+", raw.strip()):
            val = int(raw.strip())
        else:
            problems.append(f"{key}: {raw!r} is not a whole number")
            continue
        if f["kind"] == "bool" and val not in (0, 1):
            problems.append(f"{key} must be 0 or 1")
        elif f["kind"] == "choice" and val not in f["options"]:
            problems.append(f"{key} must be one of {', '.join(map(str, f['options']))}")
        elif f["kind"] == "pin":
            why = pin_problem(val, current)
            if why:
                problems.append(f"{key} = GPIO {val}: {why}")
        clean[key] = val
    merged = {**current, **clean}
    light, fan = merged.get("RELAY_LIGHT_PIN", -1), merged.get("RELAY_FAN_PIN", -1)
    if light >= 0 and light == fan:
        problems.append(f"the light and the fan cannot share GPIO {light}")
    if problems:
        raise Refused("; ".join(problems))
    return clean


def pin_problem(pin: int, current: dict[str, int]) -> Optional[str]:
    if pin == -1 or pin in SAFE_GPIOS and pin not in (current.get("RADAR_RX_PIN"), current.get("RADAR_TX_PIN")):
        return None
    if pin in (current.get("RADAR_RX_PIN"), current.get("RADAR_TX_PIN")):
        return "the radar's UART (RADAR_RX_PIN / RADAR_TX_PIN)"
    if pin in PIN_REASONS:
        return PIN_REASONS[pin]
    if pin < -1 or pin > 48:
        return "no such GPIO on the ESP32-S3"
    return "not on the list of pins safe for a relay input"


def write_defines(text: str, values: dict[str, int]) -> str:
    """config.h with each key's number replaced, its comment and spacing kept."""
    seen = set()

    def sub(m: re.Match) -> str:
        k = m.group("key")
        if k not in values:
            return m.group(0)
        seen.add(k)
        return f"{m.group('head')}{values[k]}{m.group('tail')}"
    out = _DEFINE.sub(sub, text)
    missing = set(values) - seen
    if missing:
        raise Refused(f"config.h has no #define line for {', '.join(sorted(missing))}")
    return out


# ---------------------------------------------------------------------- tools
class Tools:
    """arduino-cli (the Arduino IDE's own copy), its config, and the core's espota.py.
    Environment variables override each: ARDUINO_CLI, ARDUINO_CLI_CONFIG, ESPOTA."""

    def __init__(self, cli: Optional[str], cli_config: Optional[str], espota: Optional[str],
                 python: str = sys.executable):
        self.cli, self.cli_config, self.espota, self.python = cli, cli_config, espota, python

    @classmethod
    def discover(cls) -> "Tools":
        local = Path(os.environ.get("LOCALAPPDATA") or Path.home() / "AppData" / "Local")
        ide_cli = local / "Programs" / "Arduino IDE" / "resources" / "app" / "lib" / "backend" / "resources" / "arduino-cli.exe"
        cli = os.environ.get("ARDUINO_CLI") or (str(ide_cli) if ide_cli.exists() else shutil.which("arduino-cli"))
        ide_cfg = Path.home() / ".arduinoIDE" / "arduino-cli.yaml"
        cfg = os.environ.get("ARDUINO_CLI_CONFIG") or (str(ide_cfg) if ide_cfg.exists() else None)
        espota = os.environ.get("ESPOTA") or newest_espota(local / "Arduino15" / "packages" / "esp32" / "hardware" / "esp32")
        return cls(cli, cfg, espota)

    def view(self) -> dict:
        return {"arduino_cli": bool(self.cli), "espota": bool(self.espota),
                "cli": self.cli, "espota_path": self.espota}


def newest_espota(core_root: Path) -> Optional[str]:
    """tools/espota.py of the newest installed esp32 core (3.3.12 beats 3.3.9)."""
    def ver(p: str) -> tuple:
        return tuple(int(x) if x.isdigit() else 0 for x in re.split(r"[.\-]", Path(p).parents[1].name))
    found = glob.glob(str(core_root / "*" / "tools" / "espota.py"))
    return max(found, key=ver) if found else None


def compile_cmd(tools: Tools, sketch: Path, out: Path) -> list[str]:
    return [tools.cli, *(["--config-file", tools.cli_config] if tools.cli_config else []),
            "compile", "--fqbn", FQBN, "--libraries", str(sketch / "libraries"),
            "--output-dir", str(out), str(sketch)]


def usb_upload_cmd(tools: Tools, sketch: Path, out: Path, port: str) -> list[str]:
    return [tools.cli, *(["--config-file", tools.cli_config] if tools.cli_config else []),
            "upload", "--fqbn", FQBN, "-p", port, "--input-dir", str(out), str(sketch)]


def wifi_upload_cmd(tools: Tools, image: Path, ip: str) -> list[str]:
    """espota.py, its password passed in the environment (AANKHEN_OTA_AUTH, see the
    launcher), -r for a progress bar, -t 15 s for the board to answer the invitation."""
    return [tools.python, "-I", "-c", ESPOTA_LAUNCHER, str(tools.espota), "-i", ip, "-p", str(OTA_PORT),
            "-f", str(image), "-r", "-t", "15"]


def check_ip(ip: str) -> str:
    """A LAN IPv4 address, or Refused. The app sends firmware and requests only to the
    home network, never to an address on the internet."""
    try:
        a = ipaddress.IPv4Address(str(ip).strip())
    except ValueError:
        raise Refused(f"{ip!r} is not an IPv4 address")
    if not a.is_private or a.is_loopback or a.is_unspecified or a.is_multicast:
        raise Refused(f"{a} is not an address on the home network")
    return str(a)


def fw_version(sketch: Path) -> Optional[str]:
    try:
        m = _FW_VERSION.search((sketch / "firmware.ino").read_text(encoding="utf-8"))
    except OSError:
        return None
    return m.group(1) if m else None


def fingerprint(sketch: Path) -> str:
    """Name, size and modification time of every source file. stat() only: secrets.h
    counts (a new Wi-Fi password needs a new build) but is never opened."""
    parts = []
    for p in sorted(sketch.rglob("*")):
        if p.is_file() and p.suffix.lower() in (".ino", ".h", ".c", ".cpp", ".a"):
            st = p.stat()
            parts.append(f"{p.relative_to(sketch).as_posix()}:{st.st_size}:{st.st_mtime_ns}")
    return hashlib.sha1("|".join(parts).encode("utf-8")).hexdigest()[:12] + f"-{len(parts)}"


def parse_sizes(text: str) -> dict:
    out: dict = {}
    m = _SIZE.search(text)
    if m:
        out.update(flash_bytes=int(m.group(1)), flash_pct=int(m.group(2)), flash_max=int(m.group(3)))
    m = _RAM.search(text)
    if m:
        out.update(ram_bytes=int(m.group(1)), ram_pct=int(m.group(2)), ram_max=int(m.group(3)))
    return out


# ---------------------------------------------------------------------- jobs
class Job:
    def __init__(self, kind: str, detail: str):
        self.id = secrets.token_hex(4)
        self.kind = kind                    # compile | flash
        self.detail = detail                # "over USB on COM9", ...
        self.state = "running"              # running | ok | failed
        self.phase = "starting"
        self.pct: Optional[float] = None
        self.lines: deque = deque(maxlen=400)
        self.started_at = time.time()
        self.finished_at: Optional[float] = None
        self.result: dict = {}
        self.cmd: list[str] = []
        self.thread: Optional[threading.Thread] = None

    def view(self) -> dict:
        return {"id": self.id, "kind": self.kind, "detail": self.detail, "state": self.state,
                "phase": self.phase, "pct": self.pct, "lines": list(self.lines)[-60:],
                "started_at": self.started_at, "finished_at": self.finished_at,
                "seconds": round((self.finished_at or time.time()) - self.started_at, 1),
                "result": self.result, "cmd": redact(self.cmd)}


def redact(cmd: list[str]) -> list[str]:
    """The command as shown in the UI: the launcher's code collapsed, no password (the
    password is never on the command line anyway)."""
    return ["<espota launcher>" if c == ESPOTA_LAUNCHER else c for c in cmd]


class BoardControl:
    def __init__(self, hub, limbs, bus, data_dir: Path = DATA, firmware_dir: Path = FIRMWARE_DIR,
                 tools: Optional[Tools] = None, popen: Optional[Callable] = None,
                 http_get: Optional[Callable] = None, sleep: Callable[[float], None] = time.sleep):
        self.hub, self.limbs, self.bus = hub, limbs, bus
        self.data_dir = Path(data_dir)
        self.firmware_dir = Path(firmware_dir)
        self.out_dir = self.data_dir / "firmware" / "build"
        self.state_file = self.data_dir / "board.json"
        self.tools = tools if tools is not None else Tools.discover()
        self.popen = popen or subprocess.Popen
        self.http_get = http_get or _http_get
        self.sleep = sleep
        self.job: Optional[Job] = None
        self._job_lock = threading.Lock()
        self._test_lock = threading.Lock()
        self._plans: dict[str, dict] = {}
        self._wifi: dict = {}                # ip -> (checked_at monotonic, result)
        self._state = self._load_state()

    # ------------------------------------------------------------ persistence
    def _load_state(self) -> dict:
        try:
            return json.loads(self.state_file.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            return {}

    def _save_state(self) -> None:
        self.state_file.parent.mkdir(parents=True, exist_ok=True)
        tmp = self.state_file.with_suffix(".tmp")
        tmp.write_text(json.dumps(self._state, indent=1), encoding="utf-8")
        tmp.replace(self.state_file)

    # ------------------------------------------------------------ the board
    def _usb_status(self) -> tuple[dict, Optional[float]]:
        """The real board's last STATUS and its age in seconds; ({}, None) for the
        simulator or a replay, whose STATUS frames are not this board."""
        info = self.hub.info()
        if info.get("kind") != "hardware":
            return {}, None
        status = self.hub.device_status() or {}
        age = None
        eng = getattr(self.hub, "engine", None)
        if eng is not None and hasattr(eng, "last_host"):
            with eng.lock:
                t = eng.last_host.get("status")
                age = round(eng.clock() - t, 1) if t is not None else None
        return status, age

    def remembered_ip(self) -> Optional[str]:
        return self._state.get("ip")

    def set_ip(self, ip: str, source: str = "typed") -> dict:
        ip = check_ip(ip)
        if self._state.get("ip") != ip or self._state.get("ip_source") != source:
            self._state.update(ip=ip, ip_source=source, ip_at=time.time())
            self._save_state()
        self._wifi.pop(ip, None)
        return {"ip": ip, "source": source}

    def wifi_probe(self, ip: Optional[str], force: bool = False) -> Optional[dict]:
        """GET http://<ip>/status, cached for WIFI_PROBE_TTL_S. With AANKHEN_RELAY_TOKEN
        set (the board's RELAY_TOKEN_VALUE) the board answers in full, relays included."""
        if not ip:
            return None
        now = time.monotonic()
        hit = self._wifi.get(ip)
        if hit and not force and now - hit[0] < WIFI_PROBE_TTL_S:
            return hit[1]
        token = os.environ.get("AANKHEN_RELAY_TOKEN", "")
        t0 = time.monotonic()
        try:
            code, body = self.http_get(f"http://{ip}/status",
                                       {"X-Aankhen-Token": token} if token else {}, WIFI_PROBE_TIMEOUT_S)
            ms = round((time.monotonic() - t0) * 1000)
            if code == 200:
                st = json.loads(body)
                res = {"ip": ip, "reachable": True, "status": st, "full": st.get("full") is not False,
                       "latency_ms": ms, "note": None}
            elif code == 404:
                res = {"ip": ip, "reachable": True, "status": None, "full": False, "latency_ms": ms,
                       "note": "answers, but has no /status: firmware older than 3.4.0. Flash it once over USB."}
            else:
                res = {"ip": ip, "reachable": True, "status": None, "full": False, "latency_ms": ms,
                       "note": f"answered HTTP {code}"}
        except Exception as e:                   # timeout, refused, not JSON
            res = {"ip": ip, "reachable": False, "status": None, "full": False, "latency_ms": None,
                   "note": f"no answer from {ip}:80 in {WIFI_PROBE_TIMEOUT_S:g} s ({type(e).__name__})"}
        res["checked_at"] = time.time()
        self._wifi[ip] = (now, res)
        return res

    def view(self) -> dict:
        info = self.hub.info()
        board = info.get("board") or {}
        status, age = self._usb_status()
        usb_live = bool(self.hub.can_command)
        if usb_live and status.get("ip") and status.get("wifi") == "connected" and status["ip"] != "0.0.0.0":
            try:
                if self._state.get("ip") != status["ip"]:
                    self.set_ip(status["ip"], source="usb")
            except Refused:
                pass
        ip = self.remembered_ip()
        wifi = self.wifi_probe(ip)
        wifi_status = (wifi or {}).get("status") or {}
        if usb_live:
            link = "usb"
        elif wifi and wifi.get("reachable"):
            link = "wifi"
        else:
            link = "none"
        running = status.get("fw") if usb_live else wifi_status.get("fw")
        repo_fw = fw_version(self.firmware_dir)
        build = self._state.get("build")
        if build:
            build = {**build, "fresh": build.get("fingerprint") == self._fingerprint()}
        return {
            "link": link,
            "usb": {"port": info.get("port") or board.get("port"), "handshake": bool(board.get("handshake")),
                    "fw": board.get("fw"), "last_byte_s": board.get("last_byte_s"), "note": board.get("note"),
                    } if info.get("kind") == "hardware" else None,
            "status": {**status, "age_s": age} if status else None,
            "wifi": wifi,
            "ip": ip, "ip_source": self._state.get("ip_source"),
            "firmware": {"repo": repo_fw, "running": running,
                         "differs": bool(running and repo_fw and running != repo_fw),
                         "ota": (status.get("ota") if usb_live else wifi_status.get("ota"))},
            "link_stats": self.hub.link() if usb_live else {},
            "hub": {k: info.get(k) for k in ("running", "mode", "kind", "port", "hold")},
            "build": build,
            "job": self.job.view() if self.job else None,
            "tools": self.tools.view(),
        }

    # ------------------------------------------------------------ firmware source
    def _config_path(self) -> Path:
        return self.firmware_dir / "config.h"

    def config_view(self) -> dict:
        text = self._config_path().read_text(encoding="utf-8")
        values = parse_defines(text)
        return {"path": "aankhen/firmware/config.h", "values": {k: values.get(k) for k in FIELD_KEYS},
                "readonly": {k: values[k] for k in READONLY_KEYS if k in values},
                "fields": CONFIG_FIELDS, "safe_pins": list(SAFE_GPIOS),
                "pin_reasons": {str(k): v for k, v in sorted(PIN_REASONS.items())}}

    def update_config(self, changes: dict) -> dict:
        if not isinstance(changes, dict) or not changes:
            raise Refused("nothing to change")
        if self.job and self.job.state == "running" and self.job.kind == "compile":
            raise Conflict("a compile is reading config.h right now; wait for it")
        path = self._config_path()
        with open(path, encoding="utf-8", newline="") as f:     # keep the file's own line endings
            text = f.read()
        current = parse_defines(text)
        clean = validate_config(current, changes)
        diff = {k: [current[k], v] for k, v in clean.items() if current[k] != v}
        if diff:
            tmp = path.with_name(path.name + ".tmp")
            with open(tmp, "w", encoding="utf-8", newline="") as f:
                f.write(write_defines(text, clean))
            os.replace(tmp, path)
            self.bus.publish("board", "config", "config.h: " + ", ".join(f"{k} {a} -> {b}" for k, (a, b) in diff.items())
                             + ". Compile and flash to put it on the board.", changed=list(diff))
        return {**self.config_view(), "changed": diff}

    def source(self, name: str) -> dict:
        if name not in SOURCE_FILES:
            raise NotFound(f"only {', '.join(SOURCE_FILES)} can be viewed here")
        text = (self.firmware_dir / name).read_text(encoding="utf-8")
        return {"name": name, "text": text, "lines": text.count("\n") + 1, "bytes": len(text.encode("utf-8")),
                "version": fw_version(self.firmware_dir)}

    def _fingerprint(self) -> str:
        return fingerprint(self.firmware_dir)

    # ------------------------------------------------------------ jobs
    def _start_job(self, kind: str, detail: str, work: Callable[[Job], dict]) -> dict:
        with self._job_lock:
            if self.job and self.job.state == "running":
                raise Conflict(f"busy: {self.job.kind} {self.job.detail} is still running")
            job = Job(kind, detail)
            self.job = job

        def run():
            try:
                job.result = work(job) or {}
                job.state = "ok" if job.result.get("ok") else "failed"
            except Exception as e:                       # the job says what broke; the app goes on
                job.result = {"ok": False, "error": f"{type(e).__name__}: {e}"}
                job.state = "failed"
            finally:
                job.finished_at = time.time()
                job.phase = "done" if job.state == "ok" else "failed"
                text = job.result.get("summary") or job.result.get("error") or f"{kind} {job.state}"
                self.bus.publish("board", kind, text, job=job.id, ok=job.state == "ok",
                                 **({"error": True} if job.state != "ok" else {}))
        job.thread = threading.Thread(target=run, name=f"board-{kind}", daemon=True)
        job.thread.start()
        return job.view()

    def wait(self, timeout: float = 30.0) -> Optional[dict]:
        """Block until the current job ends (tests, scripts)."""
        job = self.job
        if job and job.thread:
            job.thread.join(timeout)
        return job.view() if job else None

    def job_view(self) -> Optional[dict]:
        return self.job.view() if self.job else None

    def _run(self, job: Job, cmd: list[str], timeout: float, env: Optional[dict] = None) -> int:
        """Run one tool; every output line into the job, percentages to the bus (ephemeral).
        Progress bars redraw with \\r, so \\r ends a line as well as \\n."""
        job.cmd = cmd
        kw = {"creationflags": subprocess.CREATE_NO_WINDOW} if sys.platform == "win32" else {}
        proc = self.popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, stdin=subprocess.DEVNULL,
                          env=env, **kw)
        killed = threading.Event()

        def kill():
            killed.set()
            try:
                proc.kill()
            except Exception:
                pass
        timer = threading.Timer(timeout, kill)
        timer.daemon = True
        timer.start()
        last_pub = 0.0
        buf = b""
        try:
            while True:
                chunk = proc.stdout.read1(4096) if hasattr(proc.stdout, "read1") else proc.stdout.read(4096)
                if not chunk:
                    break
                buf += chunk
                parts = re.split(rb"[\r\n]", buf)
                buf = parts.pop()
                for raw in parts:
                    line = raw.decode("utf-8", "replace").rstrip()
                    if not line:
                        continue
                    m = _PCT.search(line)
                    if m and ("Writing" in line or "Uploading" in line or "%" in line[:12]):
                        job.pct = min(100.0, float(m.group(1)))
                        if job.lines and _PCT.search(job.lines[-1] or "") and job.lines[-1][:10] == line[:10]:
                            job.lines[-1] = line            # a redrawn bar replaces itself
                        else:
                            job.lines.append(line)
                    else:
                        job.lines.append(line)
                    now = time.monotonic()
                    if now - last_pub >= 0.25:
                        last_pub = now
                        self.bus.publish("board", "progress", ephemeral=True, job=job.id, phase=job.phase,
                                         pct=job.pct, line=line[-160:])
            if buf.strip():
                job.lines.append(buf.decode("utf-8", "replace").rstrip())
            rc = proc.wait()
        finally:
            timer.cancel()
        if killed.is_set():
            job.lines.append(f"stopped after {timeout:.0f} s: took too long")
            return -9
        return rc

    # ------------------------------------------------------------ compile
    def start_compile(self) -> dict:
        if not self.tools.cli:
            raise Conflict("arduino-cli not found: install the Arduino IDE 2, or set ARDUINO_CLI")
        if not (self.firmware_dir / "secrets.h").exists():
            raise Conflict("aankhen/firmware/secrets.h is missing: copy secrets.example.h to secrets.h and fill it in")
        version = fw_version(self.firmware_dir) or "firmware"
        return self._start_job("compile", version, self._compile)

    def _compile(self, job: Job) -> dict:
        fp = self._fingerprint()                         # before: an edit during the build makes it stale
        out = self.out_dir
        if out.exists():
            shutil.rmtree(out)                           # never flash a leftover image
        out.mkdir(parents=True)
        version = fw_version(self.firmware_dir)
        job.phase = "compiling"
        self.bus.publish("board", "compile", f"Compiling {version} (arduino-cli, {FQBN.split(':')[2]})", job=job.id)
        t0 = time.time()
        rc = self._run(job, compile_cmd(self.tools, self.firmware_dir, out), COMPILE_TIMEOUT_S)
        secs = round(time.time() - t0, 1)
        text = "\n".join(job.lines)
        sizes = parse_sizes(text)
        image = out / IMAGE
        if rc != 0 or not image.exists():
            errors = [l for l in job.lines if "error" in l.lower()][:12]
            return {"ok": False, "rc": rc, "seconds": secs, "errors": errors, **sizes,
                    "summary": f"Compile failed after {secs:g} s" + (f": {errors[0][-200:]}" if errors else "")}
        blob = image.read_bytes()
        build = {"version": version, "at": time.time(), "fingerprint": fp, "seconds": secs,
                 "image_bytes": len(blob), "ota_in_build": OTA_MARKER in blob,
                 "relay_token_in_build": TOKEN_MARKER in blob, **sizes}
        self._state["build"] = build
        self._save_state()
        pct = f" ({sizes['flash_pct']} % of the {sizes['flash_max']:,}-byte app slot)" if sizes else ""
        ota = "OTA on" if build["ota_in_build"] else "OTA off: no OTA_PASS_VALUE in secrets.h"
        return {"ok": True, "rc": 0, **build,
                "summary": f"Compiled {version}: {sizes.get('flash_bytes', len(blob)):,} bytes{pct}, {ota}, in {secs:g} s"}

    def _fresh_build(self) -> dict:
        build = self._state.get("build")
        if not build or not (self.out_dir / IMAGE).exists():
            raise Conflict("nothing compiled yet: press Compile first")
        if build.get("fingerprint") != self._fingerprint():
            raise Conflict("the firmware sources changed since the last compile: compile again")
        return build

    # ------------------------------------------------------------ flash: plan, then confirm
    def plan_flash(self, target: str, port: Optional[str] = None, ip: Optional[str] = None) -> dict:
        if self.job and self.job.state == "running":
            raise Conflict(f"busy: {self.job.kind} {self.job.detail} is still running")
        build = self._fresh_build()
        version = build.get("version") or "firmware"
        size = f"{build.get('image_bytes', 0) / 1024:,.0f} KB"
        warnings: list[str] = []
        if target == "usb":
            if not self.tools.cli:
                raise Conflict("arduino-cli not found")
            seen = {r.device: r for r in self.hub.boards_seen()}
            port = (port or self.hub.info().get("port") or "").strip()
            if not port or port not in seen:
                raise Refused(f"{port or 'no port'} is not a USB serial port on this machine right now"
                              + (f" (seen: {', '.join(sorted(seen))})" if seen else ""))
            r = seen[port]
            if not (r.is_board or r.in_use):
                warnings.append(f"{port} has not identified itself as the Aankhen board ({r.verdict}: {r.detail}).")
            holds = self.hub.info().get("kind") == "hardware"
            steps = ([f"Stop Aankhen's serial link{(' on ' + port) if holds else ''}: it holds the port."] if holds else []) + [
                f"Write {IMAGE} ({version}, {size}) to {port} with arduino-cli upload (esptool).",
                "The board restarts into it: the relays drop to off, and JARVIS pushes the room's state again when it reconnects.",
            ] + ([f"Start Aankhen again on {port}."] if holds else [])
            plan = {"target": "usb", "port": port, "needs_password": False}
        elif target == "wifi":
            if not self.tools.espota:
                raise Conflict("espota.py not found: install the esp32 core in the Arduino IDE, or set ESPOTA")
            ip = check_ip(ip or self.remembered_ip() or "")
            wifi = self.wifi_probe(ip)
            st = (wifi or {}).get("status") or {}
            if not (wifi or {}).get("reachable"):
                warnings.append(f"{ip} did not answer on port 80 just now. Is the board powered and on the Wi-Fi?")
            elif st.get("ota") is False:
                warnings.append("The firmware running there says OTA is off (built without OTA_PASS_VALUE): "
                                "flash once over USB with the password in secrets.h.")
            elif not st:
                warnings.append("It runs firmware older than 3.4.0, which has no OTA: flash once over USB first.")
            if not build.get("ota_in_build"):
                warnings.append("This build has OTA off (no OTA_PASS_VALUE in secrets.h): after it, the board "
                                "takes firmware over USB only.")
            steps = [
                f"Send {IMAGE} ({version}, {size}) to {ip}:{OTA_PORT} with the core's espota.py. "
                "The password is asked now and never stored.",
                "The board pauses sensing for the upload (~20 s), checks the image, and restarts into it "
                "with the relays as they were.",
                "Windows may ask whether Python may use the network: allow it on private networks "
                "(the board connects back to this laptop for the data).",
            ]
            plan = {"target": "wifi", "ip": ip, "needs_password": True}
        else:
            raise Refused("target must be usb or wifi")
        now = time.time()
        self._plans = {k: v for k, v in self._plans.items() if v["expires_at"] > now}
        plan.update(id=secrets.token_urlsafe(12), version=version, image_bytes=build.get("image_bytes"),
                    fingerprint=build.get("fingerprint"), steps=steps, warnings=warnings,
                    created_at=now, expires_at=now + PLAN_TTL_S)
        self._plans[plan["id"]] = plan
        return {k: v for k, v in plan.items() if k != "fingerprint"}

    def flash(self, plan_id: str, confirm, password: Optional[str] = None) -> dict:
        """Step 2: refuses without the plan from step 1 AND confirm=true (exactly true,
        not "yes", not 1). A plan is used once."""
        if confirm is not True:
            raise Refused("not flashed: a flash needs confirm=true, sent by the confirm button")
        plan = self._plans.get(plan_id or "")
        if plan is None:
            raise NotFound("no such flash plan (already used, or never made): plan again")
        if plan["expires_at"] < time.time():
            self._plans.pop(plan_id, None)
            raise Conflict("that confirmation expired: plan the flash again")
        if plan["target"] == "wifi":
            password = password or os.environ.get("AANKHEN_OTA_PASSWORD") or ""
            if not password:
                raise Refused("the board's OTA password (OTA_PASS_VALUE in secrets.h) is needed for a Wi-Fi flash")
        build = self._fresh_build()
        if build.get("fingerprint") != plan["fingerprint"]:
            self._plans.pop(plan_id, None)
            raise Conflict("the image changed after this plan was made: plan again")
        self._plans.pop(plan_id, None)
        if plan["target"] == "usb":
            return self._start_job("flash", f"over USB on {plan['port']}", lambda job: self._flash_usb(job, plan))
        return self._start_job("flash", f"over Wi-Fi to {plan['ip']}", lambda job: self._flash_wifi(job, plan, password))

    def _flash_usb(self, job: Job, plan: dict) -> dict:
        port = plan["port"]
        job.phase = "freeing the port"
        loan = self.hub.lend_port(port, f"flashing firmware over {port}")
        if loan["stopped"]:
            self.bus.publish("aankhen", "source", f"Aankhen paused: flashing firmware over {port}", job=job.id)
        rc, restarted = None, None
        try:
            job.phase = "uploading"
            self.bus.publish("board", "flash", f"Flashing {plan['version']} over USB on {port}", job=job.id)
            t0 = time.time()
            rc = self._run(job, usb_upload_cmd(self.tools, self.firmware_dir, self.out_dir, port), UPLOAD_TIMEOUT_S)
            secs = round(time.time() - t0, 1)
        finally:
            job.phase = "restarting Aankhen"
            try:
                info = self.hub.return_port(loan)
                if info is not None:
                    restarted = info.get("port")
                    self.bus.publish("aankhen", "source", f"Aankhen restarted on {port}; waiting for the board",
                                     info=info, job=job.id)
            except Exception as e:                      # never leave the hub paused without saying so
                self.bus.publish("aankhen", "error", f"Aankhen did not restart after the flash: {e}", job=job.id)
        ok = rc == 0
        last = next((l for l in reversed(job.lines) if l.strip()), "")
        return {"ok": ok, "rc": rc, "target": "usb", "port": port, "seconds": secs, "aankhen_restarted": restarted,
                "summary": (f"Flashed {plan['version']} over USB on {port} in {secs:g} s; the board is restarting"
                            if ok else f"USB flash failed on {port}: {last[-200:]}")}

    def _flash_wifi(self, job: Job, plan: dict, password: str) -> dict:
        ip = plan["ip"]
        job.phase = "uploading"
        self.bus.publish("board", "flash", f"Flashing {plan['version']} over Wi-Fi to {ip}", job=job.id)
        env = {**os.environ, "AANKHEN_OTA_AUTH": password}
        t0 = time.time()
        rc = self._run(job, wifi_upload_cmd(self.tools, self.out_dir / IMAGE, ip), UPLOAD_TIMEOUT_S, env=env)
        secs = round(time.time() - t0, 1)
        self._wifi.pop(ip, None)                           # look again: it is restarting
        ok = rc == 0
        last = next((l for l in reversed(job.lines) if l.strip()), "")
        hint = ""
        if not ok and "Authentication Failed" in "\n".join(job.lines):
            hint = " (wrong OTA password)"
        elif not ok and "No response from device" in "\n".join(job.lines):
            hint = " (the board never connected back: is OTA on, and may Python use the network?)"
        return {"ok": ok, "rc": rc, "target": "wifi", "ip": ip, "seconds": secs,
                "summary": (f"Flashed {plan['version']} over Wi-Fi to {ip} in {secs:g} s; the board is restarting"
                            if ok else f"Wi-Fi flash to {ip} failed{hint}: {last[-200:]}")}

    # ------------------------------------------------------------ relay test click
    def relay_test(self, device: str, hold_s: float = TEST_HOLD_S) -> dict:
        """Toggle one relay for `hold_s` and put it back, through Limbs.apply: the same
        path, safety gate (circuits.json) and receipts as the switches. The receipt says
        what was sent, whether the board took it, and what the board itself then reported."""
        if device not in ("light", "fan"):
            raise NotFound(f"no relay called {device!r}")
        if not self.hub.can_command:
            raise Conflict("no board on USB: a test click needs the ESP32 plugged in to switch the relay")
        if not self._test_lock.acquire(blocking=False):
            raise Conflict("a test click is already running")
        try:
            cfg = parse_defines(self._config_path().read_text(encoding="utf-8"))
            key = "RELAY_LIGHT_PIN" if device == "light" else "RELAY_FAN_PIN"
            before = dict(self.limbs.state[device])
            first = "off" if before["on"] else "on"
            back = "on" if before["on"] else "off"
            t0 = time.monotonic()
            steps = [self._test_step(device, first, t0)]
            self.sleep(hold_s)
            steps.append(self._test_step(device, back, t0))
            after = dict(self.limbs.state[device])
            delivered = all(s["delivered"] for s in steps)
            confirmed = all(s["board_says"] == (s["action"] == "on") for s in steps)
            pin = cfg.get(key)
            receipt = {"device": device, "pin": pin, "active_low": bool(cfg.get("RELAY_ACTIVE_LOW", 1)),
                       "steps": steps, "held_s": round(steps[1]["t_ms"] / 1000 - steps[0]["t_ms"] / 1000, 2),
                       "restored": after == before, "delivered": delivered, "confirmed": confirmed,
                       "ok": delivered and confirmed and after == before, "at": time.time()}
            if receipt["ok"]:
                text = (f"Test click: {device} relay (GPIO {pin}) {first} for {receipt['held_s']:g} s and back "
                        f"{back}; the board confirmed both")
            elif not delivered:
                text = f"Test click: the board did not take the {device} command; nothing switched"
            else:
                text = f"Test click: {device} sent, but the board's report did not match (relay not wired, or pin -1?)"
            receipt["text"] = text
            self.bus.publish("limbs", "test", text, device=device, receipt=receipt)
            return receipt
        finally:
            self._test_lock.release()

    def _test_step(self, device: str, action: str, t0: float) -> dict:
        t = time.monotonic()
        r = self.limbs.apply(device, action, origin="test")
        delivered = r.get("delivered", {}).get(device)
        if delivered is None:                            # nothing changed, so nothing was sent
            delivered = bool(self.hub.can_command)
        want = action == "on"
        says, waited = None, None
        deadline = time.monotonic() + BOARD_CONFIRM_S
        while True:
            relays = (self.hub.device_status() or {}).get("relays") or {}
            says = relays.get(device) if isinstance(relays, dict) else None
            if says == want or time.monotonic() >= deadline:
                waited = round((time.monotonic() - t) * 1000)
                break
            self.sleep(0.03)
        return {"action": action, "t_ms": round((t - t0) * 1000), "delivered": bool(delivered),
                "board_says": says, "confirm_ms": waited}


def _http_get(url: str, headers: dict, timeout: float) -> tuple[int, str]:
    r = httpx.get(url, headers=headers, timeout=timeout)
    return r.status_code, r.text
