"""The zone map: many small named places in the room frame, separate from activities.

WHY
  The first learned model knew five classes (empty, outside, room, desk, bed). Aman
  wants to know much more: on the chair or standing at the desk, beside the bed on the
  desk side, by the bathroom wall, at the balcony door, gone through it. A zone here
  is a circle (centre x, y and radius r, metres, room frame) with an id, a name, the
  coarse class the old models already predict (so their output can be spread over the
  new zones until zone models are trained on drill data), and whether it is inside
  the sensed room at all.

  ZONES ARE PLACES, ACTIVITIES ARE WHAT HE DOES THERE. "Lying" is an activity, not a
  zone; bed_lying is the place where lying happens. ACTIVITIES lists the five that the
  drill labels and the belief may show: still, typing, moving, lying, none. "Waving" is
  gone: nobody waves for half an evening (docs/research/2026-10-14-aankhen-data-protocol.md).

WHERE THE NUMBERS COME FROM
  The real zone file is data/aankhen/zones.json (git-ignored, his home). It is EDITABLE:
  every zone carries "estimate": true until he measures it and sets it false. When the
  file does not exist, default_zones(room) derives the zones from room.json: the desk
  and bed furniture boxes, the door, bathroom-door and balcony-door zones, the wardrobe,
  and the house areas of kind "bath" and "balcony". `python -m aankhen zones --write`
  saves that derivation for editing. zones.example.json shows the format on the
  example room.
"""
from __future__ import annotations

import json
import math
import os
from dataclasses import asdict, dataclass, field
from typing import Optional

from . import DATA_DIR
from .room import Room

ZONES_FILE = os.path.join(DATA_DIR, "zones.json")

# The coarse classes of learn.CLASSES, and the zones each one is spread over.
COARSE = ("empty", "outside", "room", "desk", "bed")
# What he does. "none" means he is not in the room.
ACTIVITIES = ("still", "typing", "moving", "lying", "none")
# The old activity model's classes (learn.ACTIVITIES) in the new vocabulary. waving -> None:
# it is not evidence of anything (the class was a dumping ground) and is never shown.
OLD_ACTIVITY = {"none": "none", "still": "still", "typing": "typing", "walking": "moving", "waving": None}

# The required zone ids, in display order. out_of_room is the catch-all for "gone".
ZONE_IDS = ("at_desk_chair", "desk_standing", "beside_bed_desk_side", "bed_lying", "bed_sitting",
            "standing_on_bed", "beside_bed_bathroom_wall", "outside_bathroom", "inside_bathroom",
            "between_bed_and_balcony_door", "at_balcony_door", "balcony", "room_door", "wardrobe",
            "out_of_room")


@dataclass
class ZoneSpec:
    id: str
    name: str
    x: float
    y: float
    r: float
    coarse: str                       # which learn.CLASSES class this zone belongs to
    in_room: bool = True              # inside the sensed room (False: bathroom, balcony, gone)
    posture: Optional[str] = None     # seated | standing | lying | None
    # How long he usually stays once here (seconds): the belief filter's dwell prior.
    dwell_s: float = 60.0
    estimate: bool = True             # derived, not measured: he can edit it
    neighbours: list[str] = field(default_factory=list)   # zones one step away (filled in)

    def to_dict(self) -> dict:
        return asdict(self)


# The names Aman sees, and the dwell prior per zone (seconds he usually stays once there).
# TRANSIT ZONES (beside the bed on either side, between the bed and the balcony door, the
# room door) are places he walks through: 3-4 s, not 20 s (council 2026-10-26). At about
# 1 m/s a 0.6-0.7 m zone circle takes under a second to cross; the rest is a turn or a
# pause. The 10-26 narrations do not measure a pass: he stopped to say each place, so
# their visits there ran 4.0-36 s (median 15 s), and the shortest, 4.0-4.8 s with the
# speech in them, bound the stop from above. Doorways where the drills show him
# standing (outside the bathroom, median 18.7 s; the balcony door, 14.6 s) keep 15 s.
NAMES = {
    "at_desk_chair": ("Sitting at the desk", 1800.0),
    "desk_standing": ("Standing at the desk", 60.0),
    "beside_bed_desk_side": ("Beside the bed, desk side", 4.0),
    "bed_lying": ("Lying on the bed", 3600.0),
    "bed_sitting": ("Sitting on the bed", 600.0),
    "standing_on_bed": ("Standing on the bed", 30.0),
    "beside_bed_bathroom_wall": ("Beside the bed, bathroom wall", 4.0),
    "outside_bathroom": ("Outside the bathroom", 15.0),
    "inside_bathroom": ("In the bathroom", 600.0),
    "between_bed_and_balcony_door": ("Between the bed and the balcony door", 4.0),
    "at_balcony_door": ("At the balcony door", 15.0),
    "balcony": ("On the balcony", 600.0),
    "room_door": ("At the room door", 3.0),
    "wardrobe": ("At the wardrobe", 60.0),
    "out_of_room": ("Out of the room", 1800.0),
}
COARSE_OF = {
    "at_desk_chair": "desk", "desk_standing": "desk",
    "bed_lying": "bed", "bed_sitting": "bed", "standing_on_bed": "bed",
    "beside_bed_desk_side": "room", "beside_bed_bathroom_wall": "room", "outside_bathroom": "room",
    "between_bed_and_balcony_door": "room", "at_balcony_door": "room", "room_door": "room",
    "wardrobe": "room",
    "inside_bathroom": "empty", "balcony": "empty", "out_of_room": "empty",
}
POSTURE = {"at_desk_chair": "seated", "bed_lying": "lying", "bed_sitting": "seated",
           "standing_on_bed": "standing", "desk_standing": "standing"}
# Places he can step to from each place without passing anywhere else. The belief filter
# only moves probability along these edges; everything else must go through a neighbour.
GRAPH = {
    "at_desk_chair": ["desk_standing"],
    "desk_standing": ["at_desk_chair", "beside_bed_desk_side", "wardrobe", "room_door"],
    "beside_bed_desk_side": ["desk_standing", "bed_sitting", "room_door", "between_bed_and_balcony_door",
                             "wardrobe"],
    "bed_sitting": ["beside_bed_desk_side", "bed_lying", "standing_on_bed", "beside_bed_bathroom_wall"],
    "bed_lying": ["bed_sitting", "standing_on_bed"],
    "standing_on_bed": ["bed_sitting", "bed_lying"],
    "beside_bed_bathroom_wall": ["bed_sitting", "outside_bathroom"],
    "outside_bathroom": ["beside_bed_bathroom_wall", "inside_bathroom", "between_bed_and_balcony_door"],
    "inside_bathroom": ["outside_bathroom"],
    "between_bed_and_balcony_door": ["beside_bed_desk_side", "outside_bathroom", "at_balcony_door",
                                     "wardrobe"],
    "at_balcony_door": ["between_bed_and_balcony_door", "balcony"],
    "balcony": ["at_balcony_door"],
    "room_door": ["desk_standing", "beside_bed_desk_side", "out_of_room"],
    "wardrobe": ["desk_standing", "beside_bed_desk_side", "between_bed_and_balcony_door"],
    "out_of_room": ["room_door"],
}


# ---------------------------------------------------------------- geometry helpers
def _box(room: Room, name: str):
    f = next((f for f in room.furniture if f.name.lower() == name), None)
    return None if f is None else (f.x, f.y, f.x + f.w, f.y + f.d)


def _zone_centroid(room: Room, *names: str):
    for n in names:
        z = next((z for z in room.zones if z.name.lower() == n), None)
        if z is not None:
            return z.centroid(), z
    return None, None


def _area(room: Room, kind: str, near: tuple[float, float]):
    if room.house is None:
        return None
    cands = [a for a in room.house.areas if a.kind == kind]
    if not cands:
        return None

    def c(a):
        xs, ys = zip(*a.polygon)
        return (sum(xs) / len(xs), sum(ys) / len(ys), (max(xs) - min(xs)), (max(ys) - min(ys)))
    return min((c(a) for a in cands), key=lambda q: math.dist(q[:2], near))


def _edge_toward(box, target):
    """The midpoint of the box edge facing `target`, and the outward unit normal."""
    x0, y0, x1, y1 = box
    edges = [((x0, (y0 + y1) / 2), (-1, 0)), ((x1, (y0 + y1) / 2), (1, 0)),
             (((x0 + x1) / 2, y0), (0, -1)), (((x0 + x1) / 2, y1), (0, 1))]
    return min(edges, key=lambda e: math.dist(e[0], target))


def _front(box, target):
    """Furniture is used from one of its LONG sides: the long edge facing `target`."""
    x0, y0, x1, y1 = box
    if (x1 - x0) >= (y1 - y0):
        edges = [(((x0 + x1) / 2, y0), (0, -1)), (((x0 + x1) / 2, y1), (0, 1))]
    else:
        edges = [((x0, (y0 + y1) / 2), (-1, 0)), ((x1, (y0 + y1) / 2), (1, 0))]
    return min(edges, key=lambda e: math.dist(e[0], target))


def _clamp(v, lo, hi):
    return max(lo, min(hi, v))


def default_zones(room: Room) -> list[ZoneSpec]:
    """Every zone in ZONE_IDS, placed from the room's own geometry. Rough by design:
    the file it saves says "estimate": true on each, for him to correct."""
    W, D = room.width, room.depth
    centre = (W / 2, D / 2)
    pos: dict[str, tuple[float, float, float]] = {}

    desk = _box(room, "desk")
    chair, _ = _zone_centroid(room, "desk")
    if chair is None:
        if desk is not None:
            (mx, my), (nx, ny) = _front(desk, centre)
            chair = (mx + 0.35 * nx, my + 0.35 * ny)
        else:
            chair = (0.2 * W, 0.2 * D)
    pos["at_desk_chair"] = (*chair, 0.35)
    # standing at the desk: the same spot, a step further from it
    if desk is not None:
        (mx, my), (nx, ny) = _front(desk, centre)
        pos["desk_standing"] = (mx + 0.6 * nx, my + 0.6 * ny, 0.35)
    else:
        pos["desk_standing"] = (chair[0] + 0.25, chair[1], 0.35)

    bed = _box(room, "bed")
    if bed is None:
        bed = (0.55 * W, 0.0, 0.95 * W, 0.55 * D)
    bx0, by0, bx1, by1 = bed
    bc = ((bx0 + bx1) / 2, (by0 + by1) / 2)
    pos["bed_lying"] = (*bc, round(0.4 * min(bx1 - bx0, by1 - by0), 2))
    pos["standing_on_bed"] = (bc[0], bc[1], round(0.3 * min(bx1 - bx0, by1 - by0), 2))
    (ex, ey), (nx, ny) = _edge_toward(bed, chair)
    pos["bed_sitting"] = (ex - 0.3 * nx, ey - 0.3 * ny, 0.35)
    # beside the bed on the desk side: halfway across the gap between the bed and the desk
    gap = abs((ex - chair[0]) * nx + (ey - chair[1]) * ny) - 0.35
    g = _clamp(gap / 2, 0.15, 0.45)
    pos["beside_bed_desk_side"] = (ex + g * nx, ey + g * ny, 0.3)

    door_c, _ = _zone_centroid(room, "door", "room door")
    door_c = door_c or (0.1 * W, 0.0)
    pos["room_door"] = (*door_c, 0.35)
    # gone: a step beyond the door, out of the room through the nearest wall
    dists = {(-1, 0): door_c[0], (1, 0): W - door_c[0], (0, -1): door_c[1], (0, 1): D - door_c[1]}
    out_n = min(dists, key=dists.get)
    pos["out_of_room"] = (door_c[0] + out_n[0] * (dists[out_n] + 0.5),
                          door_c[1] + out_n[1] * (dists[out_n] + 0.5), 0.4)

    bath_c, _ = _zone_centroid(room, "bathroom door", "bath door", "bathroom")
    bath_c = bath_c or (W - 0.2, 0.75 * D)
    pos["outside_bathroom"] = (_clamp(bath_c[0], 0.2, W - 0.2), _clamp(bath_c[1], 0.2, D - 0.2), 0.35)
    ba = _area(room, "bath", bath_c)
    pos["inside_bathroom"] = (ba[0], ba[1], round(0.4 * min(ba[2], ba[3]), 2)) if ba else \
        (bath_c[0] + 0.9, bath_c[1], 0.6)
    (sx, sy), (snx, sny) = _edge_toward(bed, bath_c)
    room_gap = (W - sx) if snx > 0 else sx if snx < 0 else (D - sy) if sny > 0 else sy
    g = _clamp(room_gap / 2, 0.15, 0.45)
    pos["beside_bed_bathroom_wall"] = (sx + g * snx, sy + g * sny, 0.3)

    bal_c, _ = _zone_centroid(room, "balcony door")
    bal_c = bal_c or (0.6 * W, D - 0.15)
    pos["at_balcony_door"] = (*bal_c, 0.3)
    bl = _area(room, "balcony", bal_c)
    pos["balcony"] = (bl[0], bl[1], round(0.4 * min(bl[2], bl[3]), 2)) if bl else (bal_c[0], bal_c[1] + 0.8, 0.6)
    (tx, ty), (tnx, tny) = _edge_toward(bed, bal_c)
    mid = ((tx + bal_c[0]) / 2, (ty + bal_c[1]) / 2)
    pos["between_bed_and_balcony_door"] = (mid[0] if tnx else bal_c[0], mid[1] if tny else bal_c[1], 0.35)

    wd = _box(room, "wardrobe")
    if wd is not None:
        (mx, my), (nx, ny) = _front(wd, centre)
        pos["wardrobe"] = (mx + 0.3 * nx, my + 0.3 * ny, 0.3)
    else:
        pos["wardrobe"] = (0.15 * W, 0.85 * D, 0.3)

    out = []
    for zid in ZONE_IDS:
        x, y, r = pos[zid]
        name, dwell = NAMES[zid]
        out.append(ZoneSpec(zid, name, round(x, 2), round(y, 2), round(r, 2), COARSE_OF[zid],
                            in_room=COARSE_OF[zid] not in ("empty", "outside"),
                            posture=POSTURE.get(zid), dwell_s=dwell, estimate=True,
                            neighbours=list(GRAPH[zid])))
    return out


# ---------------------------------------------------------------- the file
class ZoneMap:
    """The zones in use: from data/aankhen/zones.json when it exists, else derived."""

    def __init__(self, zones: list[ZoneSpec], source: str = "derived"):
        self.zones = zones
        self.source = source                # file | derived
        self.ids = [z.id for z in zones]
        self.index = {z.id: i for i, z in enumerate(zones)}

    def __len__(self) -> int:
        return len(self.zones)

    def get(self, zid: str) -> Optional[ZoneSpec]:
        i = self.index.get(zid)
        return None if i is None else self.zones[i]

    def in_room_mask(self):
        import numpy as np
        return np.array([z.in_room for z in self.zones], bool)

    def to_dict(self) -> dict:
        return {"version": 1,
                "note": ("Zones in the room frame (metres, same origin as room.json). Edit x, y, r freely; "
                         "set \"estimate\": false on a zone once you have measured it. in_room false means "
                         "outside the sensed room (bathroom, balcony, gone). neighbours: where you can "
                         "step to directly."),
                "zones": [z.to_dict() for z in self.zones]}

    def save(self, path: str = ZONES_FILE) -> str:
        os.makedirs(os.path.dirname(os.path.abspath(path)), exist_ok=True)
        tmp = path + ".tmp"
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(self.to_dict(), f, indent=2)
        os.replace(tmp, path)
        return path

    @staticmethod
    def from_dict(d: dict, source: str = "file") -> "ZoneMap":
        zs = []
        for z in d.get("zones", []):
            zid = z["id"]
            zs.append(ZoneSpec(zid, z.get("name") or NAMES.get(zid, (zid, 60.0))[0],
                               float(z["x"]), float(z["y"]), float(z.get("r", 0.35)),
                               z.get("coarse") or COARSE_OF.get(zid, "room"),
                               in_room=bool(z.get("in_room", True)), posture=z.get("posture"),
                               dwell_s=float(z.get("dwell_s", NAMES.get(zid, ("", 60.0))[1])),
                               estimate=bool(z.get("estimate", True)),
                               neighbours=list(z.get("neighbours") or GRAPH.get(zid, []))))
        if not zs:
            raise ValueError("zone file has no zones")
        if len({z.id for z in zs}) != len(zs):
            raise ValueError("zone ids must be unique")
        for z in zs:
            if z.coarse not in COARSE:
                raise ValueError(f"zone {z.id}: coarse must be one of {COARSE}")
        return ZoneMap(zs, source)


def load_zones(room: Optional[Room] = None, path: str = ZONES_FILE) -> ZoneMap:
    """The editable file when there is one (a broken file falls back to the derivation,
    never to nothing), else the zones derived from the room."""
    if os.path.exists(path):
        try:
            with open(path, encoding="utf-8") as f:
                return ZoneMap.from_dict(json.load(f), "file")
        except (OSError, ValueError, KeyError, TypeError):
            pass
    if room is None:
        from .room import load_room
        room, _ = load_room()
    return ZoneMap(default_zones(room), "derived")
