"""Connect: everything that can be plugged into JARVIS, each with live detection.

Statuses mean exactly one thing each:
    connected   detected and working right now
    available   present on this machine, not wired in yet (a next step exists)
    missing     not found; `next` says how to get it
    planned     designed but not built — honest about it, no fake toggle

Detection is real (ports, files, sockets, HTTP). Nothing is assumed from config.
Since ROADMAP F2 that includes the three that used to be assumed:
    ESP32    connected only when the board has SAID so: a CRC-valid Aankhen frame on
             the link (aankhen/boards.py). A CH340 or CP210x is not an ESP32; a USB
             serial device that has not identified itself is listed as unidentified.
    LD2450   connected only when a real radar frame arrived in the last RADAR_FRESH_S
             (the hub being in hardware mode says nothing about the radar's wiring).
    voice    connected when the online voice is reachable, or the offline one is
             installed — taken from the voice engine's own log first (it says when the
             online voice fails), and otherwise from one small cached TCP connect.
"""
from __future__ import annotations

import glob
import importlib.util
import re
import socket
import threading
import time
from pathlib import Path
from typing import Callable, Optional

import httpx

from .paths import DOWNLOADS, HOME, VENV, YAADASH_DATA, ensure_jarvis_importable

RADAR_FRESH_S = 5.0          # "radar frames seen in the last 5 s" (ROADMAP F2)
VOICE_HOST = ("speech.platform.bing.com", 443)   # where edge-tts synthesises
VOICE_PROBE_TTL_S = 120.0    # one TCP connect per two minutes at most
EDGE_COOLDOWN_S = 60.0       # core/voice.py: a failed online voice is skipped this long
KOKORO_FILES = ("kokoro-v1.0.int8.onnx", "voices-v1.0.bin")    # core/voice.py _Kokoro

# Set by routes_boards.register: the running JARVIS process, whose log carries the
# voice engine's own word on the online voice, and the Aankhen hub, whose board finder
# knows what every serial port said. Unset (a bare detect()): the log is skipped and
# the process-wide finder is used.
_core = None
_hub = None


def bind(core=None, hub=None) -> None:
    global _core, _hub
    _core, _hub = core, hub


def _port_open(port: int, host: str = "127.0.0.1") -> bool:
    try:
        with socket.create_connection((host, port), timeout=0.3):
            return True
    except OSError:
        return False


def _item(id, group, name, status, detail, next=None, glyph=None):
    return {"id": id, "group": group, "name": name, "status": status, "detail": detail,
            "next": next, "glyph": glyph or id}


# ---------------------------------------------------------------- the board
def _ago(t: Optional[float], now: float) -> str:
    return f"{max(0.0, now - t):.0f} s ago" if t else "just now"


def _hub_doing(aankhen_info: dict) -> str:
    mode, scen = aankhen_info.get("mode"), aankhen_info.get("scenario")
    if not aankhen_info.get("running"):
        return "Aankhen is stopped"
    if mode == "simulation":
        how = "you chose" if aankhen_info.get("requested_mode") == "simulation" else "running"
        return f"Aankhen is on the {scen or ''} simulation ({how})".replace("  ", " ")
    if mode == "replay":
        return "Aankhen is replaying a recording"
    return f"Aankhen is in {mode} mode"


def board_items(results: list, aankhen_info: Optional[dict], now: Optional[float] = None) -> list[dict]:
    """The ESP32 item, then one item per USB serial device that is not an Aankhen
    board. `results` are aankhen.boards.ProbeResult (or their to_dict())."""
    now = time.time() if now is None else now
    info = aankhen_info or {}
    rs = [r.to_dict() if hasattr(r, "to_dict") else dict(r) for r in results]
    board = info.get("board") or {}
    items = []
    live = next((r for r in rs if r["verdict"] == "aankhen" and r.get("in_use")), None)
    waiting = next((r for r in rs if r["verdict"] == "claimed"), None)
    found = next((r for r in rs if r["verdict"] == "aankhen" and not r.get("in_use")), None)
    if live is not None or (board.get("handshake") and board.get("port")):
        port = (live or {}).get("device") or board.get("port")
        fw = board.get("fw") or (live or {}).get("fw")
        items.append(_item("esp32", "Hardware", "ESP32-S3 sensor board", "connected",
                           f"{port} · handshake {_ago(board.get('handshake_at'), now)}"
                           + (f" · {fw}" if fw else "") + " · CRC-checked frames"))
    elif waiting is not None:
        items.append(_item("esp32", "Hardware", "ESP32-S3 sensor board", "missing",
                           f"Aankhen has {waiting['device']} open, but the board has not sent a valid frame yet.",
                           "The firmware sends a STATUS frame every second: check it is flashed and running."))
    elif info.get("kind") == "hardware":
        note = board.get("note")
        items.append(_item("esp32", "Hardware", "ESP32-S3 sensor board", "missing",
                           "Aankhen is set to the ESP32, but no board is talking" + (f" ({note})." if note else "."),
                           "Plug it in with a DATA cable; Aankhen picks it up by itself when it answers."))
    elif found is not None:
        items.append(_item("esp32", "Hardware", "ESP32-S3 sensor board", "available",
                           f"Answered on {found['device']} ({found['detail']}). {_hub_doing(info)}.",
                           "Press ESP32 on the Aankhen tab to use it."))
    else:
        unknown = [r for r in rs if r["verdict"] not in ("aankhen", "claimed")]
        detail = "No USB serial port has sent an Aankhen frame."
        if unknown:
            detail += f" {len(unknown)} unidentified USB serial device(s) listed below."
        detail += " (Bluetooth COM ports are ignored on purpose.)"
        items.append(_item("esp32", "Hardware", "ESP32-S3 sensor board", "missing", detail,
                           "Plug it in with a DATA cable, then flash aankhen/firmware."))
    for r in rs:
        if r["verdict"] in ("aankhen", "claimed"):
            continue
        ids = f"[{r['vid']}:{r['pid']}]" if r.get("vid") else "[no USB id]"
        chip = r.get("chip") or r.get("description") or "USB serial"
        what = {
            "foreign": ("USB serial device · not Aankhen",
                        f"{r['device']} {ids} {chip}: {r['detail']}. Something else (an Arduino Uno?); "
                        "JARVIS never writes to it."),
            "silent": ("USB serial device · unidentified",
                       f"{r['device']} {ids} {chip}: {r['detail']}. An ESP32 without the Aankhen firmware, "
                       "a board still starting up, or an idle Arduino."),
            "busy": ("USB serial device · in use",
                     f"{r['device']} {ids} {chip}: {r['detail']} (Arduino IDE, a serial monitor?)."),
        }.get(r["verdict"], ("USB serial device · unreadable", f"{r['device']} {ids} {chip}: {r['detail']}."))
        items.append(_item(f"usb-{r['device']}", "Hardware", what[0], "available", what[1],
                           "Scan again after flashing or replugging it." if r["verdict"] in ("silent", "foreign")
                           else None, glyph="usb"))
    return items


def radar_item(aankhen_info: Optional[dict]) -> dict:
    """Connected only on real radar frames seen in the last RADAR_FRESH_S."""
    info = aankhen_info or {}
    board = info.get("board") or {}
    radar = board.get("radar") or {}
    last = radar.get("last_s")
    name = "HLK-LD2450 mmWave radar"
    if info.get("kind") == "hardware" and last is not None and last <= RADAR_FRESH_S:
        hz = radar.get("hz")
        return _item("ld2450", "Hardware", name, "connected",
                     f"Radar frames through the ESP32: {hz:.0f} Hz, last {last:.1f} s ago."
                     if hz else f"Radar frames through the ESP32, last {last:.1f} s ago.")
    if info.get("kind") == "hardware" and board.get("handshake"):
        detail = ("The ESP32 is talking but has sent no radar frame yet."
                  if last is None else f"The ESP32 is talking but its last radar frame was {last:.0f} s ago.")
        return _item("ld2450", "Hardware", name, "missing", detail,
                     "Check the LD2450's wiring to the ESP32 UART (its TX to the board's RX, 5 V).")
    if info.get("kind") == "simulation":
        return _item("ld2450", "Hardware", name, "missing",
                     "No real radar frames: Aankhen is on the simulator, whose radar is simulated.",
                     "Connect the ESP32 first: the radar talks through it.")
    return _item("ld2450", "Hardware", name, "missing",
                 "No radar frames: the radar reaches JARVIS through the ESP32, which is not connected.",
                 "Wire to the ESP32's UART (RX/TX, 5 V), see the firmware README.")


# ---------------------------------------------------------------- the voice
_VOICE_FAIL = re.compile(r"\[voice\] online voice failed \((.*)\)")
_OFFLINE_FAIL = re.compile(r"\[voice\] offline voice failed: (.*)")
_probe_cache: dict = {}
_probe_lock = threading.Lock()


def online_voice_reachable(connect: Optional[Callable] = None, now: Optional[float] = None) -> dict:
    """One TCP connect to the online voice's host, cached VOICE_PROBE_TTL_S. Says
    whether the service can be reached — not that it would speak; the engine's own
    log is the stronger evidence and is preferred (tts_item)."""
    now = time.time() if now is None else now
    with _probe_lock:
        hit = _probe_cache.get("result")
        if hit is not None and now - hit["at"] < VOICE_PROBE_TTL_S:
            return hit
        connect = connect or socket.create_connection
        t0 = time.perf_counter()
        try:
            with connect(VOICE_HOST, timeout=1.5):
                pass
            res = {"ok": True, "ms": round((time.perf_counter() - t0) * 1000), "at": now}
        except OSError as e:
            res = {"ok": False, "error": type(e).__name__, "at": now}
        _probe_cache["result"] = res
        return res


def kokoro_ready(model_dir: Optional[Path] = None) -> tuple[bool, str]:
    """The offline voice: both model files on disk and its packages importable."""
    if model_dir is None:
        import home                                # core/home.py
        model_dir = home.MODELS / "kokoro"
    missing = [f for f in KOKORO_FILES if not (Path(model_dir) / f).exists()]
    if missing:
        return False, "Kokoro model files missing (" + ", ".join(missing) + ")"
    pkgs = [m for m in ("kokoro_onnx", "soundfile") if importlib.util.find_spec(m) is None]
    if pkgs:
        return False, "Kokoro packages missing (" + ", ".join(pkgs) + ")"
    return True, "Kokoro-82M on the CPU"


def voice_log_evidence(logs: list, now: Optional[float] = None) -> dict:
    """What the voice engine itself said recently (core/voice.py logs each failure)."""
    now = time.time() if now is None else now
    out: dict = {"online_failed": None, "offline_failed": None}
    for entry in logs or []:
        t, line = entry.get("t", 0.0), entry.get("line", "")
        if now - t > EDGE_COOLDOWN_S:
            continue
        m = _VOICE_FAIL.search(line)
        if m:
            out["online_failed"] = {"t": t, "why": m.group(1)[:120]}
        m = _OFFLINE_FAIL.search(line)
        if m:
            out["offline_failed"] = {"t": t, "why": m.group(1)[:120]}
    return out


def tts_item(logs: Optional[list] = None, online: Optional[dict] = None,
             kokoro: Optional[tuple[bool, str]] = None, now: Optional[float] = None,
             probe: Optional[Callable[[], dict]] = None) -> dict:
    now = time.time() if now is None else now
    ev = voice_log_evidence(logs or [], now)
    k_ok, k_detail = kokoro if kokoro is not None else kokoro_ready()
    if ev["offline_failed"]:
        k_ok, k_detail = False, f"Kokoro failed {_ago(ev['offline_failed']['t'], now)}: {ev['offline_failed']['why']}"
    name = "Voice · Edge TTS en-GB-RyanNeural, Kokoro offline"
    if ev["online_failed"]:
        # The engine measured it: online voice failing, skipped for EDGE_COOLDOWN_S.
        online_txt = f"online voice failed {_ago(ev['online_failed']['t'], now)} ({ev['online_failed']['why']})"
        online_ok = False
    else:
        res = online if online is not None else (probe or online_voice_reachable)()
        online_ok = bool(res.get("ok"))
        online_txt = (f"online voice reachable ({VOICE_HOST[0]} answered in {res.get('ms', '?')} ms)" if online_ok
                      else f"online voice unreachable ({res.get('error', 'no connection')})")
    offline_txt = f"offline fallback: {k_detail}" if k_ok else f"no offline fallback: {k_detail}"
    if online_ok:
        return _item("tts", "Brain", name, "connected", f"{online_txt[0].upper()}{online_txt[1:]}; {offline_txt}.")
    if k_ok:
        # "Speaking" only when the engine itself switched; otherwise it is a readiness.
        lead = "Speaking offline" if ev["online_failed"] else "Offline voice ready"
        return _item("tts", "Brain", name, "connected", f"{lead} ({k_detail}); {online_txt}.")
    return _item("tts", "Brain", name, "missing",
                 f"JARVIS cannot speak right now: {online_txt}, and {offline_txt}.",
                 "Check the internet connection. The offline voice (Kokoro model files into "
                 "data/models/kokoro) is a download that needs your OK.")


def detect(core_info: dict | None = None, aankhen_info: dict | None = None, *,
           boards: Optional[list] = None, core_logs: Optional[list] = None,
           voice: Optional[dict] = None) -> list[dict]:
    """Everything that can plug in, each with a live status. `boards` (probe results),
    `core_logs` and `voice` (an online_voice_reachable() result) replace the live
    checks in tests; by default the board finder and the bound JARVIS process are used."""
    ensure_jarvis_importable()
    items: list[dict] = []

    # ---------------------------------------------------------------- hardware
    if boards is None:
        try:
            if _hub is not None:
                boards = _hub.boards_scan()         # probes only ports that are due
            else:
                from aankhen.boards import default_finder
                boards = default_finder().scan()
        except Exception:
            boards = []
    items.extend(board_items(boards, aankhen_info))
    items.append(radar_item(aankhen_info))
    items.append(_item("relay", "Hardware", "Relay / dimmer board", "planned",
                       "Switches the room light and fan (mains).",
                       "Firmware v3 adds token-authenticated relay control; wire by an electrician-grade standard."))
    try:
        import sounddevice as sd
        dev = sd.query_devices(kind="input")
        items.append(_item("mic", "Hardware", "Microphone", "connected", dev["name"]))
    except Exception as e:
        items.append(_item("mic", "Hardware", "Microphone", "missing", f"No input device ({e})"))

    # ---------------------------------------------------------------- brain
    try:
        tags = httpx.get("http://127.0.0.1:11434/api/tags", timeout=1.0).json().get("models", [])
        names = [m["name"] for m in tags]
        has = any(n.startswith("qwen3:4b-instruct-2507") for n in names)
        items.append(_item("ollama", "Brain", "Ollama + Qwen3-4B", "connected" if has else "available",
                           f"{len(names)} model(s): " + ", ".join(names[:4]),
                           None if has else "ollama pull qwen3:4b-instruct-2507-q4_K_M"))
    except Exception:
        items.append(_item("ollama", "Brain", "Ollama + Qwen3-4B", "missing",
                           "Ollama is not running on :11434.", "Start the Ollama app."))
    hub = HOME / ".cache" / "huggingface" / "hub"
    turbo = hub / "models--mobiuslabsgmbh--faster-whisper-large-v3-turbo"
    items.append(_item("whisper", "Brain", "Whisper large-v3-turbo (ears)",
                       "connected" if turbo.exists() else "missing",
                       "Speech to text on CUDA, int8_float16, ~2.7 s per utterance.",
                       None if turbo.exists() else "Downloads automatically on the first voice start."))
    if core_logs is None and _core is not None:
        core_logs = list(getattr(_core, "logs", []) or [])
    items.append(tts_item(core_logs, voice))
    oww = glob.glob(str(VENV / "Lib" / "site-packages" / "openwakeword" / "resources" / "models" / "hey_jarvis*"))
    items.append(_item("wake", "Brain", "Wake word · \"Hey Jarvis\"", "connected" if oww else "missing",
                       "openWakeWord, ONNX, runs on CPU." if oww else "Model file not found.",
                       None if oww else "pip install openwakeword, then download its models."))
    mqtt = _port_open(1883)
    items.append(_item("mqtt", "Brain", "MQTT broker (room bus)", "connected" if mqtt else "missing",
                       "Room changes go out on jarvis/room/<device>." if mqtt
                       else "Without it the room is virtual: the app and voice share state, hardware can't listen.",
                       None if mqtt else "winget install EclipseFoundation.Mosquitto"))

    # ---------------------------------------------------------------- memory sources
    insta = sorted(DOWNLOADS.glob("instagram-*.zip"))
    items.append(_item("instagram", "Memory", "Instagram exports",
                       "connected" if (YAADASH_DATA / "archive_msgs.parquet").exists() else ("available" if insta else "missing"),
                       f"{len(insta)} export(s) in Downloads; archive built." if insta else "No export found.",
                       None if insta else "Instagram → Your activity → Download your information (JSON)."))
    chatgpt = list(DOWNLOADS.glob("*chatgpt*.zip")) + list(DOWNLOADS.glob("*/conversations.json"))[:1]
    items.append(_item("chatgpt", "Memory", "ChatGPT export", "available" if chatgpt else "missing",
                       "Export found — not ingested yet." if chatgpt else "Requested from OpenAI; not arrived.",
                       "ChatGPT → Settings → Data controls → Export." if not chatgpt else "Ingest with the Yaadash importer."))
    claude_hist = HOME / ".claude" / "projects"
    items.append(_item("claude", "Memory", "Claude Code history",
                       "connected" if claude_hist.exists() else "missing",
                       "Dev-session transcripts (your own turns only)."))
    gem = HOME / ".gemini"
    items.append(_item("gemini", "Memory", "Gemini / Antigravity history",
                       "available" if gem.exists() else "missing",
                       "Found on disk — not ingested yet." if gem.exists() else "Not found.",
                       "Next memory step: ingest your own turns from ~/.gemini." if gem.exists() else None))
    items.append(_item("spotify", "Memory", "Spotify listening history", "planned",
                       "Taste from what you actually play.",
                       "Spotify → Privacy → Download your data (Extended streaming history)."))
    items.append(_item("ytmusic", "Memory", "YouTube Music history", "planned",
                       "Through Google Takeout.", "takeout.google.com → YouTube and YouTube Music → history."))
    return items
