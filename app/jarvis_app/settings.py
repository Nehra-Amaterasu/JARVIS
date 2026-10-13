"""JARVIS's settings, chosen in the Connect tab: his brain, his voice, how he says
words, and heavy modules switched on for a moment.

Everything is stored in DATA/settings.json through core/user_settings.py, the same
module JARVIS's process reads it with, so both sides agree on one format:
    brain   persisted here, handed to JARVIS as JARVIS_BRAIN_MODEL, applied on restart
    voice   read by core/voice.py before each sentence: applies at once
    words   the pronunciation table, applied by voice.py to what is said
    modules deep think and offline voice carry an `until`; JARVIS reads them per turn

Everything listed is measured: Ollama's own model list and capabilities, the Kokoro
voices inside its voices file, Microsoft's live voice list (a built-in copy, checked on
2026-10-13, when offline). A model that cannot do what JARVIS needs is listed with the
reason and cannot be chosen. Nothing here ever downloads anything.
"""
from __future__ import annotations

import asyncio
import threading
import time
from pathlib import Path
from typing import Callable, Optional

import httpx

from .paths import DATA, ensure_jarvis_importable

ensure_jarvis_importable()
import user_settings                     # noqa: E402  core/user_settings.py
from user_settings import DEFAULT_BRAIN  # noqa: E402

OLLAMA = "http://127.0.0.1:11434"
SETTINGS_PATH = DATA / "settings.json"
store = user_settings.SettingsFile(SETTINGS_PATH)

# ---------------------------------------------------------------- the brain
# The card is 6 GB (6144 MiB). Whisper large-v3-turbo holds ~1 GB of it while JARVIS
# listens, and Ollama needs more than the file: qwen3-4b-instruct is a 2.50 GB file and
# measured 3.31 GB in VRAM at num_ctx 8192 (/api/ps, 2026-10-13), +0.8 GB of context
# and buffers. A file over 4.5 GB therefore needs over ~5.3 GB loaded: with Whisper
# beside it, part of it runs on the CPU. On 2026-07-24 llama3.1:8b did exactly that:
# 22% on the CPU, 20 tok/s instead of 50.
VRAM_WARN_BYTES = 4.5e9
VRAM_OVERHEAD_BYTES = 0.8e9
GPU_BYTES = 6144 * 2**20
WHISPER_BYTES = 1.0e9

# What has been measured on this laptop (core/agent.py's history), shown with the model.
NOTES = {
    "qwen3:4b-instruct-2507": "JARVIS's brain since 2026-10-08: first token 0.6 s, fits on the GPU beside Whisper.",
    "qwen3:4b": "Reasons before every reply: first token 30 to 98 s measured on 2026-10-08. As deep think, its thinking stays silent.",
    "llama3.1": "8B: 22% spilled to the CPU at 20 tok/s on 2026-07-24 (the 4B runs at 50).",
}


def _note(name: str) -> Optional[str]:
    """A key with a tag ("qwen3:4b") matches names starting with it, longest first; a
    bare family ("llama3.1") matches any tag of that family."""
    for key in sorted(NOTES, key=len, reverse=True):
        if (":" in key and name.startswith(key)) or (":" not in key and name.split(":")[0] == key):
            return NOTES[key]
    return None


_caps_cache: dict[str, list] = {}       # digest -> capabilities (a digest never changes)


def _get_json(get: Callable, path: str, **kw):
    r = get(f"{OLLAMA}{path}", timeout=kw.pop("timeout", 2.0), **kw)
    r.raise_for_status()
    return r.json()


def ollama_models(get: Optional[Callable] = None, post: Optional[Callable] = None) -> Optional[list[dict]]:
    """Every installed Ollama model with its size and what it can do; None when Ollama
    is not answering. Capabilities come from /api/show (cached by digest)."""
    get = get or httpx.get
    post = post or httpx.post
    try:
        tags = _get_json(get, "/api/tags").get("models", [])
    except Exception:
        return None
    out = []
    for m in tags:
        name = m.get("name") or m.get("model")
        if not name:
            continue
        digest = m.get("digest") or name
        caps = _caps_cache.get(digest)
        if caps is None:
            try:
                r = post(f"{OLLAMA}/api/show", json={"model": name}, timeout=3.0)
                r.raise_for_status()
                caps = list(r.json().get("capabilities") or [])
                _caps_cache[digest] = caps
            except Exception:
                caps = []                        # unknown: shown as such, not cached
        d = m.get("details") or {}
        out.append({"name": name, "size": int(m.get("size") or 0), "params": d.get("parameter_size"),
                    "family": d.get("family"), "quant": d.get("quantization_level"), "capabilities": caps})
    return out


def ollama_loaded(get: Optional[Callable] = None) -> Optional[list[dict]]:
    """What Ollama holds in memory right now (name, bytes in VRAM), or None."""
    try:
        ps = _get_json(get or httpx.get, "/api/ps", timeout=1.0).get("models", [])
    except Exception:
        return None
    return [{"name": m.get("name"), "size": int(m.get("size") or 0), "vram": int(m.get("size_vram") or 0),
             "expires_at": m.get("expires_at")} for m in ps]


def params_b(p: Optional[str]) -> float:
    """"8.0B" -> 8.0, "137M" -> 0.137; unknown -> 0."""
    if not p:
        return 0.0
    try:
        n = float(p[:-1])
    except ValueError:
        return 0.0
    return n if p[-1].upper() == "B" else n / 1000 if p[-1].upper() == "M" else 0.0


def why_not_brain(m: dict) -> Optional[str]:
    """None when JARVIS can think with this model, else the reason he cannot."""
    caps = m.get("capabilities") or []
    if "embedding" in caps and "completion" not in caps:
        return "An embedding model: it turns text into vectors and cannot talk."
    if caps and "tools" not in caps:
        return "No tool calling: the clock, the room, reminders and memory search would fail."
    if not caps:
        return "Ollama did not say what this model can do."
    return None


def vram_warning(m: dict) -> Optional[str]:
    size = m.get("size") or 0
    if size <= VRAM_WARN_BYTES:
        return None
    need = (size + VRAM_OVERHEAD_BYTES) / 1e9
    return (f"{size / 1e9:.1f} GB file, about {need:.1f} GB loaded. With Whisper's ~1 GB beside it on the "
            f"6 GB card, part of it runs on the CPU: slower replies.")


def brain_view(settings: dict, models: Optional[list[dict]], loaded: Optional[list[dict]],
               running: Optional[str], core_running: bool) -> dict:
    chosen = (settings.get("brain") or {}).get("model") or DEFAULT_BRAIN
    in_vram = {m["name"]: m for m in (loaded or [])}
    rows = []
    for m in sorted(models or [], key=lambda m: (why_not_brain(m) is not None, -m["size"])):
        rows.append({**m, "gb": round(m["size"] / 1e9, 2), "why_not": why_not_brain(m), "warn": vram_warning(m),
                     "note": _note(m["name"]), "chosen": m["name"] == chosen,
                     "running": core_running and m["name"] == running,
                     "loaded_gb": round(in_vram[m["name"]]["vram"] / 1e9, 2) if m["name"] in in_vram else None})
    return {
        "ollama": models is not None,
        "models": rows,
        "chosen": chosen,
        "running": running if core_running else None,
        "default": DEFAULT_BRAIN,
        "pending_restart": bool(core_running and running and running != chosen),
        "core_running": core_running,
    }


def choose_brain(model: str, models: Optional[list[dict]]) -> dict:
    if models is None:
        raise ValueError("Ollama is not answering, so the installed models cannot be checked.")
    m = next((x for x in models if x["name"] == model), None)
    if m is None:
        raise ValueError(f"{model} is not installed in Ollama.")
    reason = why_not_brain(m)
    if reason:
        raise ValueError(reason)
    store.update(lambda s: s["brain"].update(model=model))
    return m


def chosen_brain() -> str:
    return (store.read().get("brain") or {}).get("model") or DEFAULT_BRAIN


# ---------------------------------------------------------------- voices
EDGE_LOCALES = {"en-GB": "British", "en-US": "American", "en-IN": "Indian English"}
# Microsoft's list for these locales on 2026-10-13 (edge_tts.list_voices(), 0.97 s);
# used when the live list cannot be fetched.
BUILTIN_EDGE = [
    ("en-GB-RyanNeural", "Male"), ("en-GB-ThomasNeural", "Male"), ("en-GB-SoniaNeural", "Female"),
    ("en-GB-LibbyNeural", "Female"), ("en-GB-MaisieNeural", "Female"),
    ("en-US-AndrewNeural", "Male"), ("en-US-BrianNeural", "Male"), ("en-US-ChristopherNeural", "Male"),
    ("en-US-EricNeural", "Male"), ("en-US-GuyNeural", "Male"), ("en-US-RogerNeural", "Male"),
    ("en-US-SteffanNeural", "Male"), ("en-US-AndrewMultilingualNeural", "Male"),
    ("en-US-BrianMultilingualNeural", "Male"), ("en-US-AvaNeural", "Female"), ("en-US-EmmaNeural", "Female"),
    ("en-US-AriaNeural", "Female"), ("en-US-JennyNeural", "Female"), ("en-US-MichelleNeural", "Female"),
    ("en-US-AnaNeural", "Female"), ("en-US-AvaMultilingualNeural", "Female"),
    ("en-US-EmmaMultilingualNeural", "Female"),
    ("en-IN-PrabhatNeural", "Male"), ("en-IN-NeerjaNeural", "Female"), ("en-IN-NeerjaExpressiveNeural", "Female"),
]
EDGE_TTL_S = 24 * 3600
_edge_cache: dict = {"t": 0.0, "voices": None}
_edge_lock = threading.Lock()
KOKORO_ACCENT = {"b": ("British", "en-gb"), "a": ("American", "en-us")}
_kokoro_cache: dict = {}


def _edge_live() -> list[tuple[str, str]]:
    import edge_tts

    async def fetch():
        return await asyncio.wait_for(edge_tts.list_voices(), timeout=5)
    return [(v["ShortName"], v.get("Gender", "")) for v in asyncio.run(fetch())]


def edge_voices(fetch: Optional[Callable[[], list]] = None, now: Optional[float] = None) -> tuple[list[dict], str]:
    """(voices, "live" | "built-in"): Microsoft's list, fetched at most once a day."""
    now = time.time() if now is None else now
    with _edge_lock:
        if _edge_cache["voices"] is not None and now - _edge_cache["t"] < EDGE_TTL_S and fetch is None:
            pairs, source = _edge_cache["voices"], "live"
        else:
            try:
                pairs = [(n, g) for n, g in (fetch or _edge_live)()
                         if "-".join(n.split("-")[:2]) in EDGE_LOCALES]
                if not pairs:
                    raise ValueError("no English voices in the list")
                source = "live"
                if fetch is None:
                    _edge_cache.update(t=now, voices=pairs)
            except Exception:
                pairs, source = BUILTIN_EDGE, "built-in"
    out = []
    for name, gender in pairs:
        locale = "-".join(name.split("-")[:2])
        short = name.split("-", 2)[2].replace("Neural", "")
        out.append({"id": f"edge:{name}", "engine": "edge", "name": short, "accent": EDGE_LOCALES[locale],
                    "gender": gender, "online": True})
    out.sort(key=lambda v: (list(EDGE_LOCALES.values()).index(v["accent"]), v["gender"] != "Male", v["name"]))
    return out, source


def kokoro_dir() -> Path:
    import home                                    # core/home.py
    return home.MODELS / "kokoro"


def kokoro_voices(model_dir: Optional[Path] = None) -> tuple[list[dict], Optional[str]]:
    """The English voices inside Kokoro's voices file (an .npz: names read in ~40 ms),
    or ([], why) when the offline voice is not installed."""
    from . import connect
    model_dir = model_dir or kokoro_dir()
    ok, detail = connect.kokoro_ready(model_dir)
    if not ok:
        return [], detail
    path = Path(model_dir) / "voices-v1.0.bin"
    sig = (str(path), path.stat().st_mtime_ns)
    if sig not in _kokoro_cache:
        import numpy as np
        with np.load(str(path)) as z:
            _kokoro_cache.clear()
            _kokoro_cache[sig] = sorted(z.files)
    out = []
    for n in _kokoro_cache[sig]:
        acc = KOKORO_ACCENT.get(n[:1])
        if acc and len(n) > 3 and n[1] in "fm" and n[2] == "_":
            out.append({"id": f"kokoro:{n}", "engine": "kokoro", "name": n[3:].capitalize(), "accent": acc[0],
                        "gender": "Male" if n[1] == "m" else "Female", "online": False})
    out.sort(key=lambda v: (v["accent"] != "British", v["gender"] != "Male", v["name"]))
    return out, None


DEFAULT_VOICE = "edge:en-GB-RyanNeural"


def voice_view(settings: dict, edge: tuple[list, str], kokoro: tuple[list, Optional[str]]) -> dict:
    v = settings.get("voice") or {}
    return {
        "chosen": v.get("id") or DEFAULT_VOICE,
        "speed": user_settings.clamp_speed(v.get("speed", 1.0)),
        "speed_range": [user_settings.SPEED_MIN, user_settings.SPEED_MAX],
        "edge": edge[0], "edge_source": edge[1],
        "kokoro": kokoro[0], "kokoro_missing": kokoro[1],
        "default": DEFAULT_VOICE,
    }


def choose_voice(vid: Optional[str], speed, catalogue: list[dict]) -> dict:
    if vid is not None and vid not in {v["id"] for v in catalogue}:
        raise ValueError("That voice is not in the list (an offline voice needs Kokoro installed).")
    spd = user_settings.clamp_speed(speed) if speed is not None else None

    def change(s):
        if vid is not None:
            s["voice"]["id"] = vid
        if spd is not None:
            s["voice"]["speed"] = spd
    return store.update(change)["voice"]


# ---------------------------------------------------------------- pronunciation
def set_pronunciation(word: str, say: str) -> dict:
    def change(s):
        table = dict(s.get("pronunciations") or {})
        # A word already in the table keeps one entry whatever case it is typed in.
        for k in [k for k in table if k.lower() == (word or "").strip().lower()]:
            table.pop(k)
        table[word] = say
        s["pronunciations"] = user_settings.normalise_pronunciations(table)
    return store.update(change)["pronunciations"]


def remove_pronunciation(word: str) -> dict:
    def change(s):
        table = dict(s.get("pronunciations") or {})
        for k in [k for k in table if k.lower() == word.strip().lower()]:
            table.pop(k)
        s["pronunciations"] = table
    return store.update(change)["pronunciations"]


def speak_sample(voice_name: str) -> str:
    return (f"Good evening, Aman. This is {voice_name}. "
            "Aankhen sees the room, Yaadash remembers, and I answer.")
