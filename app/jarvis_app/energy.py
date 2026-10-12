"""Energy ledger: every switch of every circuit, turned into kWh and rupees.

SIH 2022 DR704 (AICTE, "Energy Conservation with modern technology") asks for daily,
weekly and monthly usage reports. This module keeps them:

    Limbs change / manual report ─▶ Ledger.record()  (append-only JSONL, one line per change)
                                      │
                    report("day" | "week" | "month") ─▶ on-time × rated watts ─▶ kWh ─▶ ₹ at the slab

EVERYTHING HERE IS AN ESTIMATE. Watts come from labels (circuits.json), not a meter,
and a circuit's state is what the app switched or what someone reported — with no
relay board connected, the app's switch is NOT the real light on the wall (the wall
switches are not sensed). Each change records its "link" so a report can say how much
of its kWh came from the virtual room. Nothing here is called measured until a meter
(e.g. a PZEM-004T) adds readings.

GAPS ARE NOT GUESSED. While the app is closed nobody sees the switches. A heartbeat
file records when the app was last alive; on the next start, any circuit the ledger
still had "on" is closed at that moment and the gap is listed in reports as not
counted, instead of billing the whole night to a light that may have been switched
off at the wall.

TARIFF. Indian domestic tariffs are slabs on the monthly units. Telescopic tariffs
charge each slab's units at that slab's rate; non-telescopic ones charge every unit
at the rate of the slab the month ends in. These circuits are only part of the
house, so `base_kwh_month` (the rest of the house's monthly units, from the bill)
puts their units in the slab they really fall in. Energy charge only: fixed charges,
duty and taxes are left out and the report says so. The committed slabs are an
EXAMPLE; the user's DISCOM tariff goes in data/app/circuits.json.
"""
from __future__ import annotations

import json
import threading
import time
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from pathlib import Path
from typing import Callable, Optional

HEARTBEAT_S = 30.0          # how often "the app is alive" is written (the most a crash can over-count)
PERIODS = ("day", "week", "month")


# ====================================================================== tariff
@dataclass
class Tariff:
    slabs: list = field(default_factory=list)          # [(upto_kwh or None, rate ₹/kWh)], ascending
    telescopic: bool = True
    base_kwh_month: float = 0.0
    name: str = "no tariff set"
    example: bool = True
    note: str = ""
    currency: str = "INR"

    @classmethod
    def from_config(cls, d: dict) -> "Tariff":
        slabs = []
        last = 0.0
        for s in (d or {}).get("slabs", []):
            upto = s.get("upto_kwh")
            rate = float(s["rate"])
            if rate < 0:
                raise ValueError("a slab rate cannot be negative")
            if upto is not None:
                upto = float(upto)
                if upto <= last:
                    raise ValueError("slabs must be in ascending order of upto_kwh")
                last = upto
            elif slabs and slabs[-1][0] is None:
                raise ValueError("only the last slab may be open-ended")
            slabs.append((upto, rate))
        if slabs and slabs[-1][0] is not None:
            slabs.append((None, slabs[-1][1]))          # beyond the last slab: its rate continues
        return cls(slabs=slabs, telescopic=bool((d or {}).get("telescopic", True)),
                   base_kwh_month=float((d or {}).get("base_kwh_month") or 0.0),
                   name=str((d or {}).get("name") or "no tariff set"),
                   example=bool((d or {}).get("example", not slabs)),
                   note=str((d or {}).get("note") or ""), currency=str((d or {}).get("currency") or "INR"))

    def rate_at(self, kwh: float) -> float:
        """The slab rate that applies to the unit at monthly position `kwh`."""
        for upto, rate in self.slabs:
            if upto is None or kwh < upto:
                return rate
        return 0.0

    def bill(self, kwh: float) -> float:
        """Energy charge for `kwh` units in one month."""
        kwh = max(0.0, kwh)
        if not self.slabs:
            return 0.0
        if not self.telescopic:
            return kwh * self.rate_at(kwh if kwh == 0 else kwh - 1e-9)
        total, lo = 0.0, 0.0
        for upto, rate in self.slabs:
            hi = kwh if upto is None else min(kwh, upto)
            if hi > lo:
                total += (hi - lo) * rate
            if upto is None or kwh <= upto:
                break
            lo = upto
        return total

    def price(self, kwh: float, month_position: float) -> float:
        """What `kwh` more units cost when this month already has `month_position`
        units from these circuits (on top of base_kwh_month from the rest of the house)."""
        at = self.base_kwh_month + month_position
        return self.bill(at + kwh) - self.bill(at)

    def to_dict(self, month_position: float = 0.0) -> dict:
        return {"name": self.name, "example": self.example, "telescopic": self.telescopic,
                "base_kwh_month": self.base_kwh_month, "currency": self.currency, "note": self.note,
                "slabs": [{"upto_kwh": u, "rate": r} for u, r in self.slabs],
                "marginal_rate": self.rate_at(self.base_kwh_month + month_position)}


# ====================================================================== time
def day_start(ts: float) -> float:
    d = datetime.fromtimestamp(ts)
    return datetime(d.year, d.month, d.day).timestamp()


def next_day(ts: float) -> float:
    d = datetime.fromtimestamp(ts)
    return (datetime(d.year, d.month, d.day) + timedelta(days=1)).timestamp()


def period_bounds(period: str, at: float) -> tuple[float, float]:
    """[start, end) of the calendar day / ISO week (Monday) / month containing `at`."""
    d = datetime.fromtimestamp(at)
    day = datetime(d.year, d.month, d.day)
    if period == "day":
        return day.timestamp(), (day + timedelta(days=1)).timestamp()
    if period == "week":
        start = day - timedelta(days=day.weekday())
        return start.timestamp(), (start + timedelta(days=7)).timestamp()
    if period == "month":
        start = datetime(d.year, d.month, 1)
        end = datetime(d.year + (d.month == 12), d.month % 12 + 1, 1)
        return start.timestamp(), end.timestamp()
    raise ValueError(f"period must be one of {PERIODS}")


def _month_key(ts: float) -> tuple[int, int]:
    d = datetime.fromtimestamp(ts)
    return d.year, d.month


def _split_days(t0: float, t1: float):
    while t0 < t1:
        b = min(t1, next_day(t0))
        yield t0, b
        t0 = b


# ====================================================================== ledger
class Ledger:
    """Append-only record of circuit states. One JSON line per change:
        {"ts", "c": circuit, "on", "lvl", "w": estimated watts, "o": origin, "link"}
    and {"ts", "gap": [t0, t1]} where the app was closed and nothing was counted."""

    def __init__(self, folder: Path, clock: Callable[[], float] = time.time):
        self.folder = Path(folder)
        self.folder.mkdir(parents=True, exist_ok=True)
        self.file = self.folder / "ledger.jsonl"
        self.alive_file = self.folder / "alive.json"
        self.clock = clock
        self._lock = threading.RLock()
        self.events: list[dict] = []
        self.gaps: list[tuple[float, float]] = []
        self._last: dict[str, dict] = {}
        self._last_beat = 0.0
        self._load()

    def _load(self) -> None:
        try:
            lines = self.file.read_text(encoding="utf-8").splitlines()
        except FileNotFoundError:
            return
        for line in lines:
            try:
                ev = json.loads(line)
            except ValueError:
                continue                                  # a torn last line after a crash
            if "gap" in ev:
                self.gaps.append((float(ev["gap"][0]), float(ev["gap"][1])))
            elif "c" in ev:
                self.events.append(ev)
                self._last[ev["c"]] = ev
        self.events.sort(key=lambda e: e["ts"])

    def _append(self, ev: dict) -> None:
        with self.file.open("a", encoding="utf-8") as f:
            f.write(json.dumps(ev, separators=(",", ":")) + "\n")

    # -------------------------------------------------------------- writing
    def last(self, cid: str) -> Optional[dict]:
        with self._lock:
            ev = self._last.get(cid)
            return dict(ev) if ev else None

    def record(self, cid: str, on: bool, level: int, watts: float, origin: str, link: str,
               ts: Optional[float] = None) -> Optional[dict]:
        """Record a change. A repeat of the circuit's current state is ignored."""
        with self._lock:
            ts = self.clock() if ts is None else ts
            prev = self._last.get(cid)
            if prev and prev["on"] == bool(on) and prev["lvl"] == int(level) and prev["w"] == round(float(watts), 2) \
                    and prev["link"] == link:
                return None
            ev = {"ts": round(float(ts), 3), "c": cid, "on": bool(on), "lvl": int(level),
                  "w": round(float(watts), 2), "o": origin, "link": link}
            self.events.append(ev)
            if self.events and len(self.events) > 1 and self.events[-2]["ts"] > ev["ts"]:
                self.events.sort(key=lambda e: e["ts"])
            self._last[cid] = ev
            self._append(ev)
            return ev

    def beat(self, now: Optional[float] = None, force: bool = False) -> None:
        """Record that the app is alive (at most every HEARTBEAT_S)."""
        now = self.clock() if now is None else now
        if not force and now - self._last_beat < HEARTBEAT_S:
            return
        self._last_beat = now
        tmp = self.alive_file.with_suffix(".tmp")
        tmp.write_text(json.dumps({"ts": now}), encoding="utf-8")
        tmp.replace(self.alive_file)

    def resume(self, now: Optional[float] = None) -> list[str]:
        """App start: close every circuit still "on" at the moment the app was last
        alive and list the gap as not counted. Returns the circuits closed."""
        with self._lock:
            now = self.clock() if now is None else now
            try:
                alive = float(json.loads(self.alive_file.read_text(encoding="utf-8"))["ts"])
            except (FileNotFoundError, ValueError, KeyError, TypeError):
                alive = None
            open_ = [ev for ev in self._last.values() if ev["on"]]
            if alive is None:
                alive = max((ev["ts"] for ev in open_), default=None)
            closed = []
            for ev in open_:
                t = max(ev["ts"], min(alive, now))
                self.record(ev["c"], False, ev["lvl"], 0.0, "app-stopped", ev["link"], ts=t)
                closed.append(ev["c"])
            if alive is not None and now - alive > HEARTBEAT_S:
                self.gaps.append((alive, now))
                self._append({"ts": round(now, 3), "gap": [round(alive, 3), round(now, 3)]})
            self.beat(now, force=True)
            return closed

    # -------------------------------------------------------------- reading
    def intervals(self, t0: float, t1: float, now: Optional[float] = None) -> list[dict]:
        """On-intervals clipped to [t0, t1]; one still on runs to `now`."""
        with self._lock:
            now = self.clock() if now is None else now
            t1 = min(t1, now)
            out: list[dict] = []
            current: dict[str, dict] = {}
            for ev in self.events:
                if ev["ts"] >= t1:
                    break
                prev = current.get(ev["c"])
                if prev is not None and prev["on"] and prev["w"] > 0:
                    a, b = max(prev["ts"], t0), min(ev["ts"], t1)
                    if b > a:
                        out.append({"c": ev["c"], "t0": a, "t1": b, "w": prev["w"], "link": prev["link"],
                                    "o": prev["o"]})
                current[ev["c"]] = ev
            for cid, prev in current.items():
                if prev["on"] and prev["w"] > 0:
                    a, b = max(prev["ts"], t0), t1
                    if b > a:
                        out.append({"c": cid, "t0": a, "t1": b, "w": prev["w"], "link": prev["link"],
                                    "o": prev["o"]})
            return out

    def on_since(self, cid: str) -> Optional[float]:
        """When the circuit's current on-period began (None if it is off)."""
        with self._lock:
            since = None
            for ev in self.events:
                if ev["c"] != cid:
                    continue
                if ev["on"] and since is None:
                    since = ev["ts"]
                elif not ev["on"]:
                    since = None
            return since


# ====================================================================== reports
def build_report(ledger: Ledger, circuits, tariff: Tariff, period: str = "day",
                 at: Optional[float] = None, now: Optional[float] = None,
                 waste_days: Optional[dict] = None) -> dict:
    """kWh and ₹ per circuit for the day / week / month containing `at` (default now).

    Units are priced in time order within each billing month, so a unit that pushes
    the month over a slab boundary is charged at the higher slab."""
    if period not in PERIODS:
        raise ValueError(f"period must be one of {PERIODS}")
    now = ledger.clock() if now is None else now
    at = now if at is None else at
    start, end = period_bounds(period, at)
    stop = min(end, now)

    # Price from the start of the first billing month the period touches.
    priced_from = period_bounds("month", start)[0]
    pieces = []
    for iv in ledger.intervals(priced_from, stop, now):
        for a, b in _split_days(iv["t0"], iv["t1"]):
            pieces.append({**iv, "t0": a, "t1": b})
    pieces.sort(key=lambda p: p["t0"])
    mtd: dict[tuple[int, int], float] = {}
    for p in pieces:
        key = _month_key(p["t0"])
        p["kwh"] = p["w"] * (p["t1"] - p["t0"]) / 3.6e6
        p["rs"] = tariff.price(p["kwh"], mtd.get(key, 0.0))
        mtd[key] = mtd.get(key, 0.0) + p["kwh"]
    inside = [p for p in pieces if p["t1"] > start and p["t0"] < stop]

    # Per circuit
    rows: dict[str, dict] = {}
    for c in circuits.circuits:
        rows[c.id] = {"id": c.id, "name": c.name, "room": c.room, "kind": c.kind, "rated_w": c.rated_w,
                      "relay": c.relay, "switchable": c.switchable, "refused": c.refused,
                      "on_s": 0.0, "kwh": 0.0, "rupees": 0.0, "virtual_kwh": 0.0, "manual_kwh": 0.0}
    for p in inside:
        r = rows.get(p["c"]) or rows.setdefault(p["c"], {"id": p["c"], "name": p["c"], "room": "?", "kind": "other",
                                                         "rated_w": None, "relay": None, "switchable": False,
                                                         "refused": None, "on_s": 0.0, "kwh": 0.0, "rupees": 0.0,
                                                         "virtual_kwh": 0.0, "manual_kwh": 0.0})
        r["on_s"] += p["t1"] - p["t0"]
        r["kwh"] += p["kwh"]
        r["rupees"] += p["rs"]
        if p["link"] == "virtual":
            r["virtual_kwh"] += p["kwh"]
        elif p["link"] == "manual":
            r["manual_kwh"] += p["kwh"]

    # Series: hours for a day, days for a week or month.
    series = []
    step_edges = []
    if period == "day":
        t = start
        while t < end:
            step_edges.append((t, t + 3600.0, datetime.fromtimestamp(t).strftime("%H")))
            t += 3600.0
    else:
        t = start
        while t < end:
            n = next_day(t)
            step_edges.append((t, n, datetime.fromtimestamp(t).strftime("%a" if period == "week" else "%d")))
            t = n
    for a, b, label in step_edges:
        kwh = rs = 0.0
        for p in inside:
            ov = min(b, p["t1"]) - max(a, p["t0"])
            if ov > 0:
                frac = ov / (p["t1"] - p["t0"])
                kwh += p["kwh"] * frac
                rs += p["rs"] * frac
        series.append({"t": a, "label": label, "kwh": round(kwh, 4), "rupees": round(rs, 2), "future": a >= now})

    total_kwh = sum(r["kwh"] for r in rows.values())
    month_pos = mtd.get(_month_key(stop - 1e-6), 0.0) if stop > start else 0.0
    waste = _waste_totals(waste_days or {}, start, stop, tariff, month_pos)
    gaps = [{"t0": a, "t1": b} for a, b in ledger.gaps if b > start and a < stop]
    out_rows = []
    for r in rows.values():
        out_rows.append({**r, "on_s": round(r["on_s"], 1), "kwh": round(r["kwh"], 4),
                         "rupees": round(r["rupees"], 2), "virtual_kwh": round(r["virtual_kwh"], 4),
                         "manual_kwh": round(r["manual_kwh"], 4)})
    out_rows.sort(key=lambda r: (-r["kwh"], r["id"]))
    virtual = sum(r["virtual_kwh"] for r in rows.values())
    manual = sum(r["manual_kwh"] for r in rows.values())
    return {
        "period": period, "start": start, "end": end, "now": now,
        "estimate": True,
        "basis": "estimated: rated watts from circuits.json x the time each circuit was on; not a meter reading",
        "kwh": round(total_kwh, 4),
        "rupees": round(sum(r["rupees"] for r in rows.values()), 2),
        "virtual_kwh": round(virtual, 4), "manual_kwh": round(manual, 4),
        "virtual_share": round(virtual / total_kwh, 3) if total_kwh > 0 else 0.0,
        "circuits": out_rows,
        "series": series,
        "waste": waste,
        "gaps": gaps,
        "month_kwh_to_date": round(month_pos, 4),
        "tariff": tariff.to_dict(month_pos),
        "excludes": "fixed charges, electricity duty and taxes",
    }


def _waste_totals(days: dict, start: float, stop: float, tariff: Tariff, month_pos: float) -> dict:
    """Waste from the detector's day book: minutes are wall-clock time with anything
    left on in the empty sensed room; kWh add up every load that was on then."""
    s = wh = sim_s = sim_wh = 0.0
    per: dict[str, float] = {}
    t = day_start(start)
    while t < stop:
        key = datetime.fromtimestamp(t).strftime("%Y-%m-%d")
        for cid, v in (days.get(key) or {}).items():
            if cid == "_room":
                s += v.get("s", 0.0)
                sim_s += v.get("sim_s", 0.0)
                continue
            wh += v.get("wh", 0.0)
            sim_wh += v.get("sim_wh", 0.0)
            if v.get("s"):
                per[cid] = per.get(cid, 0.0) + v.get("s", 0.0)
        t = next_day(t)
    rate = tariff.rate_at(tariff.base_kwh_month + month_pos)
    return {"minutes": round(s / 60, 1), "kwh": round(wh / 1000, 4), "rupees": round(wh / 1000 * rate, 2),
            "sim_minutes": round(sim_s / 60, 1), "sim_kwh": round(sim_wh / 1000, 4),
            "by_circuit_min": {k: round(v / 60, 1) for k, v in per.items()}}
