"""JARVIS's settings as Aman chooses them in the app (Connect tab), read here live.

The app writes data/app/settings.json (git-ignored) and hands its path to JARVIS as
JARVIS_SETTINGS. The voice reads it before each sentence it synthesises and the agent
before each turn. That costs one stat() (microseconds); the file is parsed again only
when its mtime changes. So a new voice, a new pronunciation, or "deep think for 15
minutes" applies to the next sentence, with no restart.

The brain's own model is the exception. It reaches JARVIS as JARVIS_BRAIN_MODEL and
changes on a restart, because its ChatOllama objects are built at import and the boot
warm-up loads exactly that model into VRAM before the first question.

With JARVIS_SETTINGS unset (JARVIS run from a terminal), every reader gets the
defaults, and nothing behaves differently from before this file existed.

    {
      "brain": {"model": "qwen3:4b-instruct-2507-q4_K_M"},
      "voice": {"id": "edge:en-GB-RyanNeural", "speed": 1.0},
      "pronunciations": {"Aankhen": "Aan-khen"},
      "modules": {"deep_think": {"model": "llama3.1:latest", "thinking": false, "until": 1760000000.0},
                  "offline_voice": {"until": 1760000000.0}}
    }
"""
from __future__ import annotations

import copy
import json
import os
import re
import threading
import time
from pathlib import Path
from typing import Callable, Optional

# The brain since 2026-10-08 (agent.py has the A/B that chose it).
DEFAULT_BRAIN = "qwen3:4b-instruct-2507-q4_K_M"
SPEED_MIN, SPEED_MAX = 0.7, 1.4      # past these, edge-tts and Kokoro both slur
PRON_MAX = 200                       # entries; each one is a regex pass per sentence
PRON_WORD_MAX, PRON_SAY_MAX = 40, 80

DEFAULTS: dict = {
    "brain": {"model": None},
    "voice": {"id": None, "speed": 1.0},
    "pronunciations": {},
    "modules": {},
}


def brain_model(environ=None) -> str:
    """The model JARVIS thinks with: JARVIS_BRAIN_MODEL from the app, else the default."""
    environ = os.environ if environ is None else environ
    return (environ.get("JARVIS_BRAIN_MODEL") or "").strip() or DEFAULT_BRAIN


def _merged(raw: dict) -> dict:
    out = copy.deepcopy(DEFAULTS)
    if not isinstance(raw, dict):
        return out
    for key, default in DEFAULTS.items():
        val = raw.get(key)
        if isinstance(default, dict) and isinstance(val, dict):
            out[key].update(val)
    return out


class SettingsFile:
    """One JSON file, re-read only when it changes, written atomically.

    A reader that catches a half-written file (it cannot here: writes go to a temp
    file and are swapped in) or a hand-edited file with a typo keeps the last good
    settings instead of falling back to defaults mid-conversation.
    """

    def __init__(self, path: Path | str):
        self.path = Path(path)
        self._lock = threading.Lock()
        self._sig: Optional[tuple] = None
        self._data: dict = _merged({})

    def read(self) -> dict:
        try:
            st = self.path.stat()
            sig = (st.st_mtime_ns, st.st_size)
        except OSError:
            with self._lock:
                self._sig, self._data = None, _merged({})
                return copy.deepcopy(self._data)
        with self._lock:
            if sig != self._sig:
                try:
                    self._data = _merged(json.loads(self.path.read_text(encoding="utf-8")))
                    self._sig = sig
                except (OSError, ValueError):
                    pass                                  # keep the last good copy
            return copy.deepcopy(self._data)

    def write(self, data: dict) -> dict:
        data = _merged(data)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        tmp = self.path.with_suffix(f".{os.getpid()}.tmp")
        tmp.write_text(json.dumps(data, ensure_ascii=False, indent=1), encoding="utf-8")
        # On Windows os.replace fails while another process holds the target open; JARVIS
        # only opens it to read for a millisecond, so a few short retries always get in.
        for attempt in range(20):
            try:
                os.replace(tmp, self.path)
                break
            except PermissionError:
                if attempt == 19:
                    raise
                time.sleep(0.02)
        with self._lock:
            self._sig = None                              # the next read parses it again
        return data

    def update(self, change: Callable[[dict], None]) -> dict:
        """Read, let `change` edit the dict in place, write. One writer at a time."""
        with _write_lock:
            data = self.read()
            change(data)
            return self.write(data)


_write_lock = threading.Lock()
_files: dict[str, SettingsFile] = {}


def path_from_env() -> Optional[Path]:
    p = (os.environ.get("JARVIS_SETTINGS") or "").strip()
    return Path(p) if p else None


def current() -> dict:
    """The settings JARVIS was pointed at, or the defaults when he was not."""
    p = path_from_env()
    if p is None:
        return _merged({})
    f = _files.get(str(p))
    if f is None:
        f = _files.setdefault(str(p), SettingsFile(p))
    return f.read()


# ------------------------------------------------------------------ the voice
def parse_voice_id(vid: Optional[str]) -> Optional[tuple[str, str]]:
    """"edge:en-GB-RyanNeural" -> ("edge", "en-GB-RyanNeural"); anything else -> None."""
    if not vid or not isinstance(vid, str) or ":" not in vid:
        return None
    engine, name = vid.split(":", 1)
    if engine not in ("edge", "kokoro") or not re.fullmatch(r"[A-Za-z0-9_\-]{2,60}", name):
        return None
    return engine, name


def clamp_speed(speed) -> float:
    try:
        s = float(speed)
    except (TypeError, ValueError):
        return 1.0
    if s != s:                                            # NaN
        return 1.0
    return round(min(SPEED_MAX, max(SPEED_MIN, s)), 2)


def edge_rate(speed: float) -> str:
    """1.1 -> "+10%": edge-tts takes speed as a signed percentage."""
    return f"{round((clamp_speed(speed) - 1.0) * 100):+d}%"


# ------------------------------------------------------------------ pronunciation
# A word's edges: no letter, digit, underscore or Devanagari sign on either side.
# Python's \b is wrong for Hindi: vowel signs (ा, ि) are not \w, so "\bआँख\b" would
# match inside a longer word.
_EDGE = r"\wऀ-ॿ"


def normalise_pronunciations(table) -> dict[str, str]:
    """Only entries that can be applied safely: trimmed, non-empty, bounded, at most
    PRON_MAX. Raises ValueError with the reason for a table that cannot be kept."""
    if not isinstance(table, dict):
        raise ValueError("pronunciations must be an object of word -> how to say it")
    out: dict[str, str] = {}
    for word, say in table.items():
        w = re.sub(r"\s+", " ", str(word or "")).strip()
        s = re.sub(r"\s+", " ", str(say or "")).strip()
        if not w or not s:
            raise ValueError("a pronunciation needs both the word and how to say it")
        if len(w) > PRON_WORD_MAX or len(s) > PRON_SAY_MAX:
            raise ValueError(f"keep the word under {PRON_WORD_MAX} and the saying under {PRON_SAY_MAX} characters")
        if any(c in w + s for c in "[]"):
            raise ValueError("square brackets are the voice's accent tags; leave them out")
        out[w] = s
    if len(out) > PRON_MAX:
        raise ValueError(f"at most {PRON_MAX} pronunciations")
    return out


_compiled: dict[tuple, Optional[re.Pattern]] = {}


def _pattern(table: dict[str, str]) -> Optional[re.Pattern]:
    key = tuple(sorted(table.items()))
    if key not in _compiled:
        if len(_compiled) > 32:
            _compiled.clear()
        words = sorted(table, key=len, reverse=True)       # "Aankhen hub" before "Aankhen"
        _compiled[key] = (re.compile(f"(?<![{_EDGE}])(" + "|".join(re.escape(w) for w in words)
                                     + f")(?![{_EDGE}])", re.IGNORECASE) if words else None)
    return _compiled[key]


def apply_pronunciations(text: str, table: Optional[dict]) -> str:
    """Whole words only, any case: "aankhen" and "AANKHEN" both become "Aan-khen".
    Applied to what the voice says, never to what the screen shows."""
    if not text or not table:
        return text
    rx = _pattern(table)
    if rx is None:
        return text
    lower = {k.lower(): v for k, v in table.items()}
    return rx.sub(lambda m: lower.get(m.group(1).lower(), m.group(1)), text)


# ------------------------------------------------------------------ modules switched on "for a moment"
def module_active(settings: dict, module_id: str, now: Optional[float] = None) -> Optional[dict]:
    """The module's entry while it is on (its `until` is still ahead), else None."""
    entry = (settings.get("modules") or {}).get(module_id)
    if not isinstance(entry, dict):
        return None
    now = time.time() if now is None else now
    try:
        until = float(entry.get("until") or 0)
    except (TypeError, ValueError):
        return None
    return entry if until > now else None


def deep_think(settings: dict, now: Optional[float] = None) -> Optional[dict]:
    """{"model", "thinking"} while deep think is on, else None."""
    e = module_active(settings, "deep_think", now)
    if not e or not isinstance(e.get("model"), str) or not e["model"].strip():
        return None
    return {"model": e["model"].strip(), "thinking": bool(e.get("thinking"))}


def offline_voice(settings: dict, now: Optional[float] = None) -> bool:
    return module_active(settings, "offline_voice", now) is not None
