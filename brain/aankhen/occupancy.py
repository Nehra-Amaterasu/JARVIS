"""Occupancy mapping: where people are now, and where they spend time.

Two grids over the room floor, both fed by tracked positions:

  live      short memory (half-life ~1 min) -> "where is activity right now",
            rendered as a glow on the 3D floor
  learned   long memory (half-life ~7 days) -> where time is actually spent.
            Hotspots emerge on their own (desk chair, bed, the path to the door)
            without anyone drawing zones.

Each update deposits a Gaussian "footprint" scaled by track confidence and the
time elapsed, so a confident 0.1 s observation adds 0.1 person-seconds of
evidence spread over roughly a body's width — not a single hard cell. Decay is
applied lazily per update (exact exponential, independent of update rate).

Units: cell values are person-seconds (decayed). They mean something physical,
which is what lets the dwell numbers be trusted.
"""
from __future__ import annotations

import json
import math
import os
from dataclasses import dataclass, field
from typing import Optional

import numpy as np

from .room import Room


@dataclass
class GridSpec:
    width: float
    depth: float
    cell: float = 0.1                 # 10 cm cells

    @property
    def shape(self) -> tuple[int, int]:      # (rows = y, cols = x)
        return (max(1, math.ceil(self.depth / self.cell)),
                max(1, math.ceil(self.width / self.cell)))

    def to_index(self, x: float, y: float) -> Optional[tuple[int, int]]:
        r, c = int(y / self.cell), int(x / self.cell)
        rows, cols = self.shape
        if 0 <= r < rows and 0 <= c < cols:
            return r, c
        return None

    def cell_center(self, r: int, c: int) -> tuple[float, float]:
        return (c + 0.5) * self.cell, (r + 0.5) * self.cell


class DecayingGrid:
    def __init__(self, spec: GridSpec, half_life_s: float, sigma_m: float = 0.22):
        self.spec = spec
        self.half_life_s = half_life_s
        self.sigma_m = sigma_m
        self.grid = np.zeros(spec.shape, dtype=np.float64)
        self.last_t: Optional[float] = None
        # Precompute a Gaussian stamp ~3 sigma wide.
        rad = max(1, int(math.ceil(3 * sigma_m / spec.cell)))
        ax = np.arange(-rad, rad + 1) * spec.cell
        xx, yy = np.meshgrid(ax, ax)
        k = np.exp(-(xx ** 2 + yy ** 2) / (2 * sigma_m ** 2))
        self._stamp = k / k.sum()                 # sums to 1: deposits are exact
        self._rad = rad

    def decay_to(self, t: float) -> None:
        if self.last_t is not None and t > self.last_t:
            self.grid *= 0.5 ** ((t - self.last_t) / self.half_life_s)
        self.last_t = t if self.last_t is None else max(self.last_t, t)

    def deposit(self, x: float, y: float, amount: float) -> None:
        idx = self.spec.to_index(x, y)
        if idx is None or amount <= 0:
            return
        r, c = idx
        rows, cols = self.grid.shape
        rad = self._rad
        r0, r1 = max(0, r - rad), min(rows, r + rad + 1)
        c0, c1 = max(0, c - rad), min(cols, c + rad + 1)
        s = self._stamp[(r0 - r + rad):(r1 - r + rad), (c0 - c + rad):(c1 - c + rad)]
        # Renormalise the clipped stamp so deposits near walls aren't lost.
        self.grid[r0:r1, c0:c1] += amount * s / s.sum()

    def total(self) -> float:
        return float(self.grid.sum())

    def normalized(self) -> np.ndarray:
        """0..1 for display (relative to the current maximum)."""
        m = self.grid.max()
        return self.grid / m if m > 0 else self.grid.copy()


@dataclass
class Hotspot:
    x: float
    y: float
    person_seconds: float
    zone: Optional[str]


class OccupancyMap:
    def __init__(self, room: Room, cell: float = 0.1,
                 live_half_life_s: float = 60.0,
                 learned_half_life_s: float = 7 * 24 * 3600.0):
        self.room = room
        self.spec = GridSpec(room.width, room.depth, cell)
        self.live = DecayingGrid(self.spec, live_half_life_s)
        self.learned = DecayingGrid(self.spec, learned_half_life_s)
        self.zone_seconds: dict[str, float] = {z.name: 0.0 for z in room.zones}
        self._last_t: Optional[float] = None

    def update(self, t: float, positions: list[tuple[float, float, float]]) -> None:
        """positions: [(x, y, confidence 0..1), ...] at time t (seconds)."""
        dt = 0.0 if self._last_t is None else max(0.0, min(t - self._last_t, 2.0))
        self._last_t = t
        self.live.decay_to(t)
        self.learned.decay_to(t)
        if dt == 0.0:
            return
        for x, y, conf in positions:
            amount = dt * max(0.0, min(1.0, conf))
            self.live.deposit(x, y, amount)
            self.learned.deposit(x, y, amount)
            z = self.room.zone_at(x, y)
            if z is not None:
                self.zone_seconds[z.name] = self.zone_seconds.get(z.name, 0.0) + amount

    def hotspots(self, k: int = 5, min_separation_m: float = 0.6) -> list[Hotspot]:
        """Top-k local maxima of the learned map, spaced apart (greedy NMS)."""
        g = self.learned.grid
        if g.max() <= 0:
            return []
        order = np.argsort(g, axis=None)[::-1]
        picked: list[Hotspot] = []
        for flat in order:
            if len(picked) >= k:
                break
            r, c = divmod(int(flat), g.shape[1])
            if g[r, c] <= 0:
                break
            x, y = self.spec.cell_center(r, c)
            if any(math.hypot(x - h.x, y - h.y) < min_separation_m for h in picked):
                continue
            # Integrate the neighbourhood: a hotspot is "time spent around here".
            rad = max(1, int(0.3 / self.spec.cell))
            mass = float(g[max(0, r - rad):r + rad + 1, max(0, c - rad):c + rad + 1].sum())
            z = self.room.zone_at(x, y)
            picked.append(Hotspot(round(x, 2), round(y, 2), round(mass, 1),
                                  z.name if z else None))
        return picked

    # ---- persistence: the learned map should survive restarts --------------
    def save(self, path: str) -> None:
        os.makedirs(os.path.dirname(os.path.abspath(path)), exist_ok=True)
        np.savez_compressed(path, learned=self.learned.grid,
                            meta=json.dumps({"cell": self.spec.cell,
                                             "width": self.spec.width,
                                             "depth": self.spec.depth,
                                             "last_t": self.learned.last_t,
                                             "zone_seconds": self.zone_seconds}))

    def load(self, path: str) -> bool:
        if not os.path.exists(path):
            return False
        data = np.load(path, allow_pickle=False)
        meta = json.loads(str(data["meta"]))
        if (meta["cell"], meta["width"], meta["depth"]) != \
                (self.spec.cell, self.spec.width, self.spec.depth):
            return False                 # room changed: the old map no longer fits
        self.learned.grid = data["learned"]
        self.learned.last_t = meta["last_t"]
        self.zone_seconds.update(meta.get("zone_seconds", {}))
        return True
