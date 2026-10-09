"""Room model: the coordinate system every other Aankhen component works in.

CONVENTIONS (one frame for everything — mixing frames is the classic tracker bug)
  - Units: metres.
  - Origin: a floor corner of the room. +x along one wall, +y along the adjacent
    wall, +z up from the floor. The floor is z = 0.
  - Yaw: degrees, counter-clockwise from +x when viewed from above.
  - Each sensor has a pose (position + yaw + pitch). Sensor-local measurements are
    converted into room coordinates here, and nowhere else.

The room file is the user's own home layout, so the real one (room.json) is
gitignored; room.example.json documents the format.
"""
from __future__ import annotations

import json
import math
import os
from dataclasses import asdict, dataclass, field
from typing import Optional

WIFI_24GHZ_WAVELENGTH_M = 0.1249     # c / 2.401 GHz (channel 1 low edge ~ channel 6)


@dataclass
class Zone:
    """A named floor region, e.g. "desk", "bed". Any simple polygon."""
    name: str
    polygon: list[list[float]]           # [[x, y], ...] in metres, room frame
    color: str = "#4FC3F7"
    # Dwelling in some zones means something (sitting at the desk vs passing by);
    # the fusion layer uses this to decide when "still" is still presence.
    expect_stationary: bool = False

    def contains(self, x: float, y: float) -> bool:
        return point_in_polygon(x, y, self.polygon)

    def centroid(self) -> tuple[float, float]:
        xs, ys = zip(*self.polygon)
        return sum(xs) / len(xs), sum(ys) / len(ys)


@dataclass
class Furniture:
    """An axis-aligned box. Rendered in the 3D view; also explains radar shadows."""
    name: str
    x: float
    y: float
    w: float      # extent along x
    d: float      # extent along y
    h: float      # height
    color: str = "#8D6E63"


@dataclass
class SensorPose:
    """Where a sensor sits and which way it points.

    kind: "esp32" (Wi-Fi CSI receiver), "router" (Wi-Fi transmitter),
          "ld2450" (mmWave radar), "ble" (BLE scanner).
    """
    id: str
    kind: str
    x: float
    y: float
    z: float
    yaw_deg: float = 0.0          # boresight direction in the floor plane
    pitch_deg: float = 0.0        # downward tilt (radar mounted high, angled down)
    fov_deg: float = 120.0        # horizontal field of view
    range_m: float = 6.0          # useful range


@dataclass
class Room:
    name: str = "room"
    width: float = 4.0            # along x
    depth: float = 4.0            # along y
    height: float = 2.8
    zones: list[Zone] = field(default_factory=list)
    furniture: list[Furniture] = field(default_factory=list)
    sensors: list[SensorPose] = field(default_factory=list)
    # Wi-Fi links: (transmitter id, receiver id). Each link senses motion inside
    # its Fresnel zone; it carries no position information along its length.
    links: list[list[str]] = field(default_factory=list)

    # ---- lookup --------------------------------------------------------
    def sensor(self, sid: str) -> Optional[SensorPose]:
        return next((s for s in self.sensors if s.id == sid), None)

    def sensors_of(self, kind: str) -> list[SensorPose]:
        return [s for s in self.sensors if s.kind == kind]

    def zone_at(self, x: float, y: float) -> Optional[Zone]:
        for z in self.zones:
            if z.contains(x, y):
                return z
        return None

    def inside(self, x: float, y: float, margin: float = 0.0) -> bool:
        return -margin <= x <= self.width + margin and -margin <= y <= self.depth + margin

    # ---- geometry ------------------------------------------------------
    def radar_to_room(self, sensor: SensorPose, sx: float, sy: float,
                      body_height_m: float = 1.1) -> tuple[float, float]:
        """Convert a radar's own (x lateral, y forward) reading to room x, y.

        The LD2450 has one transmitter and two receivers on a single horizontal
        line, so it measures range and azimuth but NO elevation. It reports
        x = r*sin(theta) and y = r*cos(theta), where r is the 3D distance to the
        reflecting body part. With no roll, x is the true sideways offset, and
        x^2 + y^2 = r^2 = x^2 + d^2 + dh^2, so the horizontal forward distance is

            d = sqrt(max(y^2 - dh^2, 0)),   dh = sensor height - body height.

        Tilting the sensor changes what it can SEE (coverage), not this formula.
        An earlier version used y*cos(pitch), which assumes the person sits on the
        tilted boresight; with a 1.8 m sensor and a standing person that is ~0.3 m
        wrong at 1 m. body_height_m ~1.1 m for a standing torso, ~0.7 m seated.
        """
        dh = sensor.z - body_height_m
        forward = math.sqrt(max(sy * sy - dh * dh, 0.0))
        lateral = sx
        yaw = math.radians(sensor.yaw_deg)
        # Forward axis = (cos yaw, sin yaw); right-hand lateral = (sin yaw, -cos yaw).
        rx = sensor.x + forward * math.cos(yaw) + lateral * math.sin(yaw)
        ry = sensor.y + forward * math.sin(yaw) - lateral * math.cos(yaw)
        return rx, ry

    def in_fov(self, sensor: SensorPose, x: float, y: float) -> bool:
        dx, dy = x - sensor.x, y - sensor.y
        dist = math.hypot(dx, dy)
        if dist > sensor.range_m or dist < 1e-6:
            return False
        bearing = math.degrees(math.atan2(dy, dx))
        off = (bearing - sensor.yaw_deg + 180) % 360 - 180
        return abs(off) <= sensor.fov_deg / 2

    def fresnel_radius(self, tx: SensorPose, rx: SensorPose, t: float = 0.5) -> float:
        """First-Fresnel-zone radius at fraction t along the link.

        r = sqrt(lambda * d1 * d2 / (d1 + d2)). This is the region where a body
        actually perturbs the signal; outside it, a Wi-Fi link barely notices you.
        It is why one link gives room-level motion, never a position.
        """
        d = math.dist((tx.x, tx.y, tx.z), (rx.x, rx.y, rx.z))
        d1, d2 = d * t, d * (1 - t)
        return math.sqrt(WIFI_24GHZ_WAVELENGTH_M * d1 * d2 / d) if d else 0.0

    def link_distance_to(self, tx: SensorPose, rx: SensorPose, x: float, y: float) -> tuple[float, float]:
        """(perpendicular distance to the link line, fraction along it) in 2D."""
        ax, ay, bx, by = tx.x, tx.y, rx.x, rx.y
        vx, vy = bx - ax, by - ay
        L2 = vx * vx + vy * vy
        if L2 == 0:
            return math.hypot(x - ax, y - ay), 0.0
        t = max(0.0, min(1.0, ((x - ax) * vx + (y - ay) * vy) / L2))
        px, py = ax + t * vx, ay + t * vy
        return math.hypot(x - px, y - py), t

    # ---- persistence ---------------------------------------------------
    def to_dict(self) -> dict:
        return asdict(self)

    @classmethod
    def from_dict(cls, d: dict) -> "Room":
        r = cls(**{k: d[k] for k in ("name", "width", "depth", "height") if k in d})
        r.zones = [Zone(**z) for z in d.get("zones", [])]
        r.furniture = [Furniture(**f) for f in d.get("furniture", [])]
        r.sensors = [SensorPose(**s) for s in d.get("sensors", [])]
        r.links = [list(l) for l in d.get("links", [])]
        r.validate()
        return r

    @classmethod
    def load(cls, path: str) -> "Room":
        with open(path, encoding="utf-8") as f:
            return cls.from_dict(json.load(f))

    def save(self, path: str) -> None:
        with open(path, "w", encoding="utf-8") as f:
            json.dump(self.to_dict(), f, indent=2)

    def validate(self) -> None:
        """Fail loudly on a bad layout — a silent wrong layout corrupts every track."""
        problems = []
        if min(self.width, self.depth, self.height) <= 0:
            problems.append("room dimensions must be positive")
        ids = [s.id for s in self.sensors]
        if len(ids) != len(set(ids)):
            problems.append("sensor ids must be unique")
        for s in self.sensors:
            if not self.inside(s.x, s.y, margin=8.0):
                problems.append(f"sensor {s.id} is implausibly far outside the room")
        for tx, rx in self.links:
            if tx not in ids or rx not in ids:
                problems.append(f"link {tx}->{rx} references an unknown sensor")
        for z in self.zones:
            if len(z.polygon) < 3:
                problems.append(f"zone {z.name} needs at least 3 points")
        if problems:
            raise ValueError("invalid room layout: " + "; ".join(problems))


def point_in_polygon(x: float, y: float, poly: list[list[float]]) -> bool:
    """Even-odd ray casting. Points exactly on an edge may go either way."""
    inside = False
    n = len(poly)
    j = n - 1
    for i in range(n):
        xi, yi = poly[i]
        xj, yj = poly[j]
        if (yi > y) != (yj > y):
            x_cross = (xj - xi) * (y - yi) / (yj - yi) + xi
            if x < x_cross:
                inside = not inside
        j = i
    return inside


def default_room() -> Room:
    """A sensible 4 x 4 m bedroom-study used until a real layout is measured.

    Router outside the room (through a wall, ~7 m away as in the real setup),
    ESP32 on the far side so the Wi-Fi link crosses the room, radar on the wall
    above the desk tilted down 15 degrees.
    """
    return Room(
        name="study (default layout - measure yours)",
        width=4.0, depth=4.0, height=2.8,
        zones=[
            Zone("desk", [[0.0, 0.0], [1.6, 0.0], [1.6, 1.2], [0.0, 1.2]], "#4FC3F7", True),
            Zone("bed", [[2.2, 2.0], [4.0, 2.0], [4.0, 4.0], [2.2, 4.0]], "#BA68C8", True),
            Zone("floor", [[1.6, 0.0], [4.0, 0.0], [4.0, 2.0], [1.6, 2.0]], "#81C784"),
            Zone("door", [[0.0, 3.0], [0.8, 3.0], [0.8, 4.0], [0.0, 4.0]], "#FFB74D"),
        ],
        furniture=[
            Furniture("desk", 0.0, 0.0, 1.6, 0.7, 0.75),
            Furniture("bed", 2.2, 2.0, 1.8, 2.0, 0.5, "#5D4037"),
            Furniture("wardrobe", 3.4, 0.0, 0.6, 1.0, 2.1, "#6D4C41"),
        ],
        sensors=[
            SensorPose("router", "router", -3.0, 2.0, 1.0, 0, 0, 360, 15),
            SensorPose("esp32", "esp32", 3.9, 2.0, 1.0, 180, 0, 360, 8),
            SensorPose("radar", "ld2450", 0.8, 0.05, 1.8, 90, 15, 120, 6),
        ],
        links=[["router", "esp32"]],
    )


ROOM_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "room.json")


def load_room(path: Optional[str] = None) -> tuple[Room, bool]:
    """(room, is_measured). Falls back to the default layout, and says so."""
    path = path or ROOM_FILE
    if os.path.exists(path):
        return Room.load(path), True
    return default_room(), False
