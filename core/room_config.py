"""The room's switchable devices and its modes: one definition for the app and JARVIS.

Both sides read the same two files in the app's data folder (JARVIS_DATA_DIR, else
data/app), so a mode made in the Limbs tab is a mode JARVIS can be asked for by voice:

    devices.json  what is wired: [{id, name, kind light|fan, board uno|esp32, channel}]
    modes.json    {"modes": [{id, name, set: {device: on/off, "*": on/off}}], "last": id}

The relays only SWITCH (an Arduino relay board, contacts in parallel with the wall
switches): a mode is an on/off set, never a brightness or a fan speed. "*" in a set
means every device ("All off"), so a light wired later is covered without editing it.

No file means today's room: the light on D4 and the fan on D5 of the Uno, and the four
default modes. A file that does not parse is reported (problems) and the defaults are
used; nothing here ever switches anything.
"""
from __future__ import annotations

import json
import os
import re
import threading
from pathlib import Path
from typing import Optional

KINDS = ("light", "fan")
BOARDS = ("uno", "esp32")
UNO_PINS = range(2, 14)          # D0/D1 are the Uno's USB serial link
ID_RX = re.compile(r"^[a-z][a-z0-9_]{0,11}$")   # also the firmware's command word (line buffer: 48 chars)

DEFAULT_DEVICES = [
    {"id": "light", "name": "Room light", "kind": "light", "board": "uno", "channel": 4},
    {"id": "fan", "name": "Ceiling fan", "kind": "fan", "board": "uno", "channel": 5},
]
# Aman's brief, 2026-10-15: on/off sets only. Wind down and Sleep are the same set today
# (no dimmer, so "a little light" does not exist); each is editable.
DEFAULT_MODES = [
    {"id": "focus", "name": "Deep focus", "set": {"light": True, "fan": True}},
    {"id": "relaxation", "name": "Wind down", "set": {"light": False, "fan": True}},
    {"id": "sleep", "name": "Sleep", "set": {"light": False, "fan": True}},
    {"id": "all_off", "name": "All off", "set": {"*": False}},
]
BUILTIN_MODE_IDS = tuple(m["id"] for m in DEFAULT_MODES)
# Other words for the built-in ids (what the old scene names and the voice parser use).
MODE_ALIASES = {"deep_focus": "focus", "deep focus": "focus", "study": "focus", "wind down": "relaxation",
                "wind_down": "relaxation", "relax": "relaxation", "chill": "relaxation", "good night": "sleep",
                "goodnight": "sleep", "all off": "all_off", "everything off": "all_off"}
MAX_MODES = 24
MAX_DEVICES = 12

_lock = threading.RLock()


def data_dir() -> Path:
    env = os.environ.get("JARVIS_DATA_DIR")
    if env:
        return Path(env)
    try:
        import home                                    # core/home.py
        return Path(home.APP_DATA)
    except Exception:
        return Path(__file__).resolve().parents[1] / "data" / "app"


def _read(path: Path):
    return json.loads(path.read_text(encoding="utf-8"))


def _write(path: Path, obj) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(json.dumps(obj, indent=2), encoding="utf-8")
    tmp.replace(path)


def slug(name: str) -> str:
    s = re.sub(r"[^a-z0-9]+", "_", str(name).strip().lower()).strip("_")
    if not s or not s[0].isalpha():
        s = "m_" + s
    return s[:24]


def norm(text: str) -> str:
    """'Deep  Focus!' -> 'deep focus': how names are compared."""
    return re.sub(r"\s+", " ", re.sub(r"[^a-z0-9 ]+", " ", str(text).lower().replace("_", " "))).strip()


# ---------------------------------------------------------------- devices
def check_device(d: dict, seen: set) -> Optional[str]:
    """Why this device entry cannot be used, or None."""
    if not isinstance(d, dict):
        return "a device must be an object"
    did = d.get("id")
    if not isinstance(did, str) or not ID_RX.match(did):
        return f"device id {did!r}: lowercase letters, digits and _ (max 12), starting with a letter"
    if did in seen or did in ("all", "environment", "scene"):
        return f"device id {did!r} is used twice or reserved"
    if d.get("kind") not in KINDS:
        return f"{did}: kind must be one of {', '.join(KINDS)} (relays only switch)"
    if d.get("board") not in BOARDS:
        return f"{did}: board must be one of {', '.join(BOARDS)}"
    ch = d.get("channel")
    if not isinstance(ch, int) or isinstance(ch, bool):
        return f"{did}: channel must be a pin number"
    if d["board"] == "uno" and ch not in UNO_PINS:
        return f"{did}: an Uno relay goes on D2..D13 (D0/D1 are its USB link)"
    return None


def load_devices(directory: Optional[Path] = None) -> tuple[list[dict], list[str]]:
    """(devices, problems). Defaults when devices.json is missing or unusable."""
    path = Path(directory or data_dir()) / "devices.json"
    try:
        raw = _read(path)
    except FileNotFoundError:
        return [dict(d) for d in DEFAULT_DEVICES], []
    except (OSError, ValueError) as e:
        return [dict(d) for d in DEFAULT_DEVICES], [f"devices.json unreadable ({e}); using light D4 + fan D5"]
    items = raw.get("devices") if isinstance(raw, dict) else raw
    if not isinstance(items, list) or not items:
        return [dict(d) for d in DEFAULT_DEVICES], ["devices.json lists no devices; using light D4 + fan D5"]
    out, problems, seen, pins = [], [], set(), set()
    for d in items[:MAX_DEVICES]:
        why = check_device(d, seen)
        if why is None and (d["board"], d["channel"]) in pins:
            why = f"{d['id']}: {d['board']} pin {d['channel']} is already used"
        if why:
            problems.append(why)
            continue
        seen.add(d["id"])
        pins.add((d["board"], d["channel"]))
        out.append({"id": d["id"], "name": str(d.get("name") or d["id"])[:40], "kind": d["kind"],
                    "board": d["board"], "channel": d["channel"]})
    if not out:
        return [dict(d) for d in DEFAULT_DEVICES], problems + ["no usable device; using light D4 + fan D5"]
    return out, problems


# ---------------------------------------------------------------- modes
def check_mode(m: dict, device_ids: list[str]) -> Optional[str]:
    if not isinstance(m, dict):
        return "a mode must be an object"
    name = str(m.get("name") or "").strip()
    if not name or len(name) > 32:
        return "a mode needs a name of 1 to 32 characters"
    st = m.get("set")
    if not isinstance(st, dict) or not st:
        return f"{name}: say which devices it switches on or off"
    for k, v in st.items():
        if k != "*" and k not in device_ids:
            return f"{name}: no device called {k!r}"
        if not isinstance(v, bool):
            return f"{name}: {k} must be on (true) or off (false); there are no levels"
    return None


def load_modes(directory: Optional[Path] = None) -> dict:
    """{"modes": [...], "last": id | None, "problems": [...]} (defaults if no file)."""
    path = Path(directory or data_dir()) / "modes.json"
    try:
        raw = _read(path)
    except FileNotFoundError:
        return {"modes": [json.loads(json.dumps(m)) for m in DEFAULT_MODES], "last": None, "problems": []}
    except (OSError, ValueError) as e:
        return {"modes": [json.loads(json.dumps(m)) for m in DEFAULT_MODES], "last": None,
                "problems": [f"modes.json unreadable ({e}); using the default modes"]}
    modes, problems, ids = [], [], set()
    for m in (raw.get("modes") if isinstance(raw, dict) else None) or []:
        if not isinstance(m, dict) or not isinstance(m.get("set"), dict) or not m.get("name"):
            problems.append(f"skipped a mode: {str(m)[:60]}")
            continue
        mid = str(m.get("id") or slug(m["name"]))
        if mid in ids:
            continue
        ids.add(mid)
        modes.append({"id": mid, "name": str(m["name"])[:32],
                      "set": {str(k): bool(v) for k, v in m["set"].items()}})
    last = raw.get("last") if isinstance(raw, dict) else None
    return {"modes": modes[:MAX_MODES], "last": last if last in ids else None, "problems": problems}


def save_modes(modes: list[dict], last: Optional[str], directory: Optional[Path] = None) -> None:
    with _lock:
        _write(Path(directory or data_dir()) / "modes.json", {"modes": modes, "last": last})


def find_mode(modes: list[dict], name: str) -> Optional[dict]:
    """A mode by id, by name, or by a built-in alias ('deep focus', 'wind down')."""
    if not name:
        return None
    key = str(name).strip()
    for m in modes:
        if m["id"] == key:
            return m
    n = norm(key)
    alias = MODE_ALIASES.get(n) or MODE_ALIASES.get(key.lower())
    for m in modes:
        if norm(m["name"]) == n or norm(m["id"]) == n or (alias and m["id"] == alias):
            return m
    return None


def resolve(mode: dict, device_ids: list[str]) -> dict[str, bool]:
    """The on/off each device takes in this mode ("*" first, named devices win)."""
    out = {}
    if "*" in mode["set"]:
        out = {d: bool(mode["set"]["*"]) for d in device_ids}
    for d, v in mode["set"].items():
        if d != "*" and d in device_ids:
            out[d] = bool(v)
    return out


def describe_mode(mode: dict, devices: list[dict]) -> str:
    """'light on · fan on' (or 'everything off')."""
    names = {d["id"]: d["name"] for d in devices}
    st = mode["set"]
    if set(st) == {"*"}:
        return "everything " + ("on" if st["*"] else "off")
    parts = [f"{names.get(d, d).lower()} {'on' if v else 'off'}" for d, v in st.items() if d != "*"]
    if "*" in st:
        parts.append(f"the rest {'on' if st['*'] else 'off'}")
    return " · ".join(parts)
