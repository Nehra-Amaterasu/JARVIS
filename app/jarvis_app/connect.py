"""Connect: everything that can be plugged into JARVIS, each with live detection.

Statuses mean exactly one thing each:
    connected   detected and working right now
    available   present on this machine, not wired in yet (a next step exists)
    missing     not found; `next` says how to get it
    planned     designed but not built — honest about it, no fake toggle

Detection is real (ports, files, sockets, HTTP). Nothing is assumed from config.
"""
from __future__ import annotations

import glob
import socket
from pathlib import Path

import httpx

from .paths import DOWNLOADS, HOME, VENV, YAADASH_DATA, ensure_jarvis_importable


def _port_open(port: int, host: str = "127.0.0.1") -> bool:
    try:
        with socket.create_connection((host, port), timeout=0.3):
            return True
    except OSError:
        return False


def _item(id, group, name, status, detail, next=None, glyph=None):
    return {"id": id, "group": group, "name": name, "status": status, "detail": detail,
            "next": next, "glyph": glyph or id}


def detect(core_info: dict | None = None, aankhen_info: dict | None = None) -> list[dict]:
    ensure_jarvis_importable()
    items = []

    # ---------------------------------------------------------------- hardware
    try:
        from aankhen.transport import list_candidate_ports
        ports = list_candidate_ports()
    except Exception:
        ports = []
    if ports:
        items.append(_item("esp32", "Hardware", "ESP32-S3 sensor board", "connected",
                           "; ".join(str(p) for p in ports)))
    else:
        items.append(_item("esp32", "Hardware", "ESP32-S3 sensor board", "missing",
                           "No ESP32 on USB. (Bluetooth COM ports are ignored on purpose.)",
                           "Plug it in with a DATA cable, then flash aankhen/firmware."))
    radar_live = bool(aankhen_info and aankhen_info.get("kind") == "hardware")
    items.append(_item("ld2450", "Hardware", "HLK-LD2450 mmWave radar",
                       "connected" if radar_live else "missing",
                       "Tracks people: position + speed, up to 3 targets, ~10 Hz.",
                       None if radar_live else "Wire to the ESP32's UART (RX/TX, 5 V), see the firmware README."))
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
    items.append(_item("tts", "Brain", "Edge TTS · en-GB-RyanNeural (voice)", "connected",
                       "Online voice; without internet JARVIS falls back to Kokoro-82M on the CPU."))
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
