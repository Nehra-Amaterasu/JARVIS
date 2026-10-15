"""Daily automatic recalibration of the empty-room reference, keyed by firmware and fan.

WHY
  The place features (learn.FeatureStream shape_dev*, level_dev_db) are deviations from
  the EMPTY room. The only reference was captured on 10-12 on firmware 3.1.0; by 10-14
  the board ran 3.4.0 and live shape_dev1 sat at -57..-377 against a trained -19..-179
  (docs/research/2026-10-14-aankhen-data-protocol.md, cause 2). A new firmware or the
  fan switching gives the ESP32 a different "empty room".

WHAT
  - A reference is stored per (firmware, fan on/off) in data/aankhen/references/,
    one file per key, holding the newest capture and the date it was made.
  - Captures come only from windows the free teachers say are empty (phone away from
    home Wi-Fi AND laptop idle for 10+ minutes, teachers.py) or from the drill's
    empty-room blocks. At most one new capture per key per day.
  - The engine loads the reference matching the CURRENT firmware and fan. When none
    matches, it keeps what it has but marks the reference stale: the belief then never
    names a zone (honest: place cannot be read against the wrong empty room).
"""
from __future__ import annotations

import json
import os
import re
import time
from typing import Optional

from . import DATA_DIR

REF_DIR = os.path.join(DATA_DIR, "references")
MIN_WINDOWS = 240           # 2 minutes of 0.5 s windows
MAX_WINDOWS = 1200


def key_of(firmware: Optional[str], fan_on: Optional[bool]) -> str:
    fw = re.sub(r"[^0-9A-Za-z.\-]+", "_", str(firmware or "unknown"))
    return f"fw-{fw}__fan-{'on' if fan_on else 'off'}"


class ReferenceStore:
    def __init__(self, folder: str = REF_DIR):
        self.folder = folder

    def path(self, key: str) -> str:
        return os.path.join(self.folder, key + ".json")

    def load(self, firmware: Optional[str], fan_on: Optional[bool]) -> Optional[dict]:
        p = self.path(key_of(firmware, fan_on))
        if not os.path.exists(p):
            return None
        try:
            with open(p, encoding="utf-8") as f:
                d = json.load(f)
            return d if d.get("shape") else None
        except (OSError, ValueError):
            return None

    def save(self, firmware: Optional[str], fan_on: Optional[bool], ref: dict, source: str,
             day: Optional[str] = None) -> str:
        os.makedirs(self.folder, exist_ok=True)
        key = key_of(firmware, fan_on)
        d = {**ref, "firmware": firmware, "fan_on": bool(fan_on), "source": source,
             "day": day or time.strftime("%Y-%m-%d"), "saved": time.time()}
        p = self.path(key)
        tmp = p + ".tmp"
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(d, f)
        os.replace(tmp, p)
        return p

    def captured_today(self, firmware: Optional[str], fan_on: Optional[bool], day: Optional[str] = None) -> bool:
        d = self.load(firmware, fan_on)
        return bool(d and d.get("day") == (day or time.strftime("%Y-%m-%d")))

    def list(self) -> list[dict]:
        if not os.path.isdir(self.folder):
            return []
        out = []
        for name in sorted(os.listdir(self.folder)):
            if name.endswith(".json"):
                try:
                    with open(os.path.join(self.folder, name), encoding="utf-8") as f:
                        d = json.load(f)
                    out.append({"key": name[:-5], "day": d.get("day"), "source": d.get("source"),
                                "windows": d.get("windows")})
                except (OSError, ValueError):
                    continue
        return out


class Recalibrator:
    """Collects empty-room windows while `active` (set by the hub from the free teachers
    or by the drill), and turns them into the day's reference for the current key."""

    def __init__(self, store: Optional[ReferenceStore] = None, min_windows: int = MIN_WINDOWS):
        self.store = store or ReferenceStore()
        self.min_windows = min_windows
        self.active_source: Optional[str] = None       # "teachers" | "drill" | None
        self.key: Optional[tuple] = None
        self.windows: list = []
        self.last_saved: Optional[dict] = None

    def set_active(self, source: Optional[str], firmware: Optional[str], fan_on: Optional[bool]) -> None:
        key = (firmware, bool(fan_on))
        if source is None or key != self.key:
            self.windows = []
        self.active_source = source
        self.key = key

    def push(self, last: tuple, day: Optional[str] = None, force: bool = False) -> Optional[dict]:
        """One window's (shape, level, rssi). Returns the new reference when one is saved."""
        if self.active_source is None or self.key is None or last[0] is None:
            return None
        fw, fan = self.key
        if not force and self.active_source != "drill" and self.store.captured_today(fw, fan, day):
            return None
        self.windows.append(last)
        if len(self.windows) > MAX_WINDOWS:
            self.windows = self.windows[-MAX_WINDOWS:]
        if len(self.windows) < self.min_windows:
            return None
        from .learn import reference_from
        ref = reference_from(self.windows)
        self.windows = []
        if ref is None:
            return None
        self.store.save(fw, fan, ref, self.active_source, day)
        self.last_saved = {"firmware": fw, "fan_on": fan, "source": self.active_source,
                           "day": day or time.strftime("%Y-%m-%d"), "windows": ref["windows"]}
        if self.active_source == "drill":
            self.active_source = None                # one capture per drill empty block
        return ref
