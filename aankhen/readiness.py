"""Can zones be trusted yet? What is missing before they can.

A zone ("at the desk", "on the bed") is shown or spoken only when ALL of these hold:
  1. the layout is MEASURED (room.json "measured": true, from the Measure-my-room form);
  2. an empty-room baseline exists with the fan OFF, and one with the fan ON;
  3. at least GATE_ZONE_DAYS drill days are recorded;
  4. the day-7 leave-one-day-out report (python -m aankhen evaluate --json
     data/aankhen/models/drill/lodo.json) PASSES the zone gate. Its pass is what
     calibrates the floor: before it, no zone model has earned a probability, so the
     floor is None and nothing is named ("in the room, not sure where").
"""
from __future__ import annotations

import json
import os
from typing import Optional

from . import DATA_DIR

ZONE_FLOOR_CALIBRATED = 0.6     # used only once the zone gate has passed
GATE_DAYS = 7


def _paths(root: str) -> dict:
    return {"room": os.path.join(root, "room.json"), "base": os.path.join(root, "baseline.json"),
            "fan": os.path.join(root, "baseline_fan.json"),
            "index": os.path.join(root, "drill", "index.jsonl"),
            "lodo": os.path.join(root, "models", "drill", "lodo.json")}


def _json(path: str) -> Optional[dict]:
    try:
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    except (OSError, ValueError):
        return None


def drill_days(index_path: str) -> int:
    days = set()
    try:
        with open(index_path, encoding="utf-8") as f:
            for line in f:
                try:
                    d = json.loads(line)
                except ValueError:
                    continue
                if d.get("day") and (d.get("passed") or 0) > 0:
                    days.add(d["day"])
    except OSError:
        pass
    return len(days)


def zone_floor(root: str = DATA_DIR) -> Optional[float]:
    """The calibrated floor, or None while no zone model has passed the day-7 gate."""
    rep = _json(_paths(root)["lodo"]) or {}
    z = (rep.get("gates") or {}).get("zone") or {}
    return ZONE_FLOOR_CALIBRATED if z.get("verdict") == "PASS" else None


def check(root: str = DATA_DIR) -> dict:
    p = _paths(root)
    room = _json(p["room"])
    measured = bool(room and room.get("measured") is True)
    base, fan = _json(p["base"]), _json(p["fan"])
    days = drill_days(p["index"])
    floor = zone_floor(root)
    items = [
        {"id": "layout", "ok": measured, "label": "Room measured with a tape",
         "detail": "measured" if measured else ("estimated from a sketch" if room else "no room.json"),
         "how": "Open Measure my room and enter the walls, furniture, board and router."},
        {"id": "baseline_fan_off", "ok": bool(base and str(base.get("source", "")).startswith("calibrated")),
         "label": "Empty-room baseline, fan off",
         "detail": (base or {}).get("note", "none"),
         "how": "Leave the room empty, fan off: python -m aankhen calibrate --seconds 120"},
        {"id": "baseline_fan_on", "ok": fan is not None, "label": "Empty-room baseline, fan on",
         "detail": (fan or {}).get("note", "none"),
         "how": "Leave the room empty, fan on: python -m aankhen calibrate --seconds 120 --fan"},
        {"id": "drill_days", "ok": days >= GATE_DAYS, "label": f"Drill days ({days} of {GATE_DAYS})",
         "detail": f"{days} day{'s' if days != 1 else ''} with passed blocks",
         "how": "Do the 26-minute drill once a day: python -m aankhen drill"},
        {"id": "zone_gate", "ok": floor is not None, "label": "Zone model passed the day-7 test",
         "detail": "PASS" if floor is not None else "not yet",
         "how": "After day 7: python -m aankhen evaluate --json data/aankhen/models/drill/lodo.json"},
    ]
    ready = all(i["ok"] for i in items)
    return {"ready": ready, "zones_trusted": ready, "zone_floor": floor if ready else None,
            "layout_measured": measured, "drill_days": days, "items": items,
            "missing": [i["label"] for i in items if not i["ok"]]}
