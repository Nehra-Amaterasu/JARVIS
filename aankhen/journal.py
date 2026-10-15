"""What I did, where, and for how long: Aankhen's memory of the day.

Every second the hub hands the journal what the live board HONESTLY says right now
(engine "honest", belief.py): the zone when one is sure enough, else "in_room" /
"empty" / "unsure"; the activity (still / typing / moving / lying) when sure, else none;
and whether Wi-Fi saw motion. "Waving" is no longer an activity.
The journal keeps one open SEGMENT (the same zone and activity) and closes it when either
changes for longer than a short hold, so a one-second flicker never splits the day.
Closed segments go to data/aankhen/activity/<date>.jsonl (git-ignored: this is a
record of my life). Only the real board is journaled, never a simulation.

summary() is what JARVIS reads: where I am and since when, and today's totals.
"""
from __future__ import annotations

import json
import os
import threading
import time
from typing import Optional

from . import DATA_DIR

HOLD_S = 6.0                     # a change must last this long to start a new segment


class ActivityJournal:
    def __init__(self, folder: Optional[str] = None, clock=time.time):
        self.folder = folder or os.path.join(DATA_DIR, "activity")
        self.clock = clock
        self.lock = threading.Lock()
        self.current: Optional[dict] = None      # {zone, activity, start, last, motion_s}
        self._pending: Optional[tuple] = None    # (zone, activity, since)
        self._today_cache: tuple = ("", [])

    # ------------------------------------------------------------ feeding
    def update(self, zone: Optional[str], activity: Optional[str], motion: bool) -> None:
        now = self.clock()
        key = (zone or "unknown", activity or "none")
        with self.lock:
            c = self.current
            if c is None:
                self.current = {"zone": key[0], "activity": key[1], "start": now, "last": now, "motion_s": 0.0}
                return
            dt = max(0.0, min(5.0, now - c["last"]))
            c["last"] = now
            if motion:
                c["motion_s"] += dt
            if key == (c["zone"], c["activity"]):
                self._pending = None
                return
            if self._pending is None or self._pending[:2] != key:
                self._pending = (*key, now)
                return
            if now - self._pending[2] >= HOLD_S:
                self._close(self._pending[2])
                self.current = {"zone": key[0], "activity": key[1], "start": self._pending[2],
                                "last": now, "motion_s": 0.0}
                self._pending = None

    def _close(self, end: float) -> None:
        c = self.current
        if c is None or end - c["start"] < 1.0:
            return
        seg = {"zone": c["zone"], "activity": c["activity"], "start": round(c["start"], 1),
               "end": round(end, 1), "seconds": round(end - c["start"], 1),
               "moving_share": round(min(1.0, c["motion_s"] / max(1e-6, end - c["start"])), 2)}
        os.makedirs(self.folder, exist_ok=True)
        day = time.strftime("%Y-%m-%d", time.localtime(c["start"]))
        with open(os.path.join(self.folder, f"{day}.jsonl"), "a", encoding="utf-8") as f:
            f.write(json.dumps(seg) + "\n")

    def close(self) -> None:
        with self.lock:
            if self.current:
                self._close(self.current["last"])
            self.current, self._pending = None, None

    # ------------------------------------------------------------ reading
    def segments(self, day: Optional[str] = None) -> list[dict]:
        day = day or time.strftime("%Y-%m-%d")
        path = os.path.join(self.folder, f"{day}.jsonl")
        if not os.path.exists(path):
            return []
        with open(path, encoding="utf-8") as f:
            return [json.loads(line) for line in f if line.strip()]

    def summary(self) -> dict:
        segs = self.segments()
        with self.lock:
            c = dict(self.current) if self.current else None
        if c:
            segs = segs + [{"zone": c["zone"], "activity": c["activity"], "start": c["start"],
                            "end": c["last"], "seconds": c["last"] - c["start"]}]
        by_zone, by_act = {}, {}
        for g in segs:
            by_zone[g["zone"]] = by_zone.get(g["zone"], 0.0) + g["seconds"]
            if g["activity"] != "none":
                by_act[g["activity"]] = by_act.get(g["activity"], 0.0) + g["seconds"]
        return {"now": None if c is None else {"zone": c["zone"], "activity": c["activity"],
                                               "since": round(c["start"], 1),
                                               "seconds": round(c["last"] - c["start"], 1)},
                "today": {"zones": {k: round(v) for k, v in by_zone.items()},
                          "activities": {k: round(v) for k, v in by_act.items()},
                          "segments": len(segs)}}
