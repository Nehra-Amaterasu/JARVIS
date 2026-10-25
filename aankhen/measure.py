"""Measure my room: the guided form's numbers -> data/aankhen/room.json, "measured": true.

THE FORM (metres, from ONE floor corner: x along the first wall, y along the second;
"south" is the y = 0 wall, "north" y = depth, "west" x = 0, "east" x = width)
    {"width", "depth", "height",
     "bed" | "desk" | "wardrobe": {"x", "y", "w", "d"}        furniture footprints
     "door" | "balcony_door":     {"wall", "offset", "width"} offset along that wall
     "board" | "router":          {"x", "y", "z"}             z = height above the floor}
balcony_door and wardrobe are optional; the router may be outside the room.

Only what the form measures is replaced: walls, the bed / desk / wardrobe furniture,
the desk / bed / door / balcony door zones, and the esp32 / router poses. Everything
else (the house map, other furniture and zones) is kept. The old file is copied to
room.json.bak-<time> first.
"""
from __future__ import annotations

import json
import os
import shutil
import time
from typing import Optional

from .room import Room

WALLS = ("south", "north", "west", "east")
RECTS = ("bed", "desk", "wardrobe")
DOORS = ("door", "balcony_door")
POINTS = ("board", "router")
REQUIRED = ("bed", "desk", "door", "board", "router")
TOL = 0.05                      # 5 cm slack against the walls
CHAIR_M = 0.7                   # the desk zone includes the chair in front of the desk
DOOR_DEPTH_M = 0.8              # the door zone: this deep inside the doorway


def _num(v) -> Optional[float]:
    try:
        f = float(v)
    except (TypeError, ValueError):
        return None
    return f if f == f and abs(f) != float("inf") else None


def validate(form: dict) -> list[dict]:
    """[{"field": "bed.w", "error": "..."}]; empty when the form can be saved."""
    errs: list[dict] = []
    bad = lambda f, e: errs.append({"field": f, "error": e})
    W, D, H = (_num(form.get(k)) for k in ("width", "depth", "height"))
    for k, v, lo, hi in (("width", W, 1.5, 12.0), ("depth", D, 1.5, 12.0), ("height", H, 2.0, 5.0)):
        if v is None:
            bad(k, "a number in metres is needed")
        elif not lo <= v <= hi:
            bad(k, f"between {lo} and {hi} m (centimetres? divide by 100)")
    if errs:
        return errs
    for k in REQUIRED:
        if not isinstance(form.get(k), dict):
            bad(k, "needed")
    rects = {}
    for k in RECTS:
        r = form.get(k)
        if not isinstance(r, dict):
            continue
        x, y, w, d = (_num(r.get(a)) for a in ("x", "y", "w", "d"))
        for a, v in zip("xywd", (x, y, w, d)):
            if v is None:
                bad(f"{k}.{a}", "a number in metres is needed")
        if None in (x, y, w, d):
            continue
        if w <= 0.1 or d <= 0.1:
            bad(f"{k}.w", "width and depth must be more than 10 cm")
            continue
        if x < -TOL or y < -TOL or x + w > W + TOL or y + d > D + TOL:
            bad(f"{k}.x", f"{k} goes outside the walls ({W} x {D} m)")
            continue
        rects[k] = (x, y, w, d)
    for a, b in (("bed", "desk"), ("bed", "wardrobe"), ("desk", "wardrobe")):
        if a in rects and b in rects:
            (ax, ay, aw, ad), (bx, by, bw, bd) = rects[a], rects[b]
            ov = max(0.0, min(ax + aw, bx + bw) - max(ax, bx)) * max(0.0, min(ay + ad, by + bd) - max(ay, by))
            if ov > 0.1:
                bad(f"{b}.x", f"{a} and {b} overlap by {ov:.2f} m²")
    for k in DOORS:
        dr = form.get(k)
        if not isinstance(dr, dict):
            continue
        wall, off, wd = dr.get("wall"), _num(dr.get("offset")), _num(dr.get("width"))
        if wall not in WALLS:
            bad(f"{k}.wall", "pick the wall it is in")
            continue
        if off is None or wd is None:
            bad(f"{k}.offset", "offset and width in metres are needed")
            continue
        length = W if wall in ("south", "north") else D
        if not 0.5 <= wd <= 2.5:
            bad(f"{k}.width", "a door is 0.5 to 2.5 m wide")
        elif off < -TOL or off + wd > length + TOL:
            bad(f"{k}.offset", f"the door runs past the end of the {wall} wall ({length} m)")
    for k in POINTS:
        p = form.get(k)
        if not isinstance(p, dict):
            continue
        x, y, z = (_num(p.get(a)) for a in ("x", "y", "z"))
        if None in (x, y, z):
            bad(f"{k}.x", "x, y and height in metres are needed")
            continue
        if not 0.0 <= z <= H:
            bad(f"{k}.z", f"height must be between the floor and the ceiling ({H} m)")
        if k == "board" and (x < -TOL or y < -TOL or x > W + TOL or y > D + TOL):
            bad("board.x", "the board must be inside the room")
        if k == "router" and (abs(x) > 30 or abs(y) > 30):
            bad("router.x", "more than 30 m away: check the units")
    b, r = form.get("board"), form.get("router")
    if isinstance(b, dict) and isinstance(r, dict) and not any(e["field"].startswith(("board", "router")) for e in errs):
        dist = sum((float(b[a]) - float(r[a])) ** 2 for a in "xyz") ** 0.5
        if dist < 0.3:
            bad("router.x", "the router and the board are less than 30 cm apart")
    return errs


def _rect_poly(x, y, w, d):
    return [[round(x, 3), round(y, 3)], [round(x + w, 3), round(y, 3)],
            [round(x + w, 3), round(y + d, 3)], [round(x, 3), round(y + d, 3)]]


def _desk_zone(x, y, w, d, W, D):
    """The desk plus the chair: extend away from the nearest wall."""
    gaps = {"west": x, "east": W - (x + w), "south": y, "north": D - (y + d)}
    near = min(gaps, key=gaps.get)
    if near == "west":
        w = min(w + CHAIR_M, W - x)
    elif near == "east":
        nx = max(0.0, x - CHAIR_M); w, x = w + (x - nx), nx
    elif near == "south":
        d = min(d + CHAIR_M, D - y)
    else:
        ny = max(0.0, y - CHAIR_M); d, y = d + (y - ny), ny
    return _rect_poly(x, y, w, d)


def _door_zone(wall, off, wd, W, D):
    k = DOOR_DEPTH_M
    if wall == "south":
        return _rect_poly(off, 0.0, wd, min(k, D))
    if wall == "north":
        return _rect_poly(off, D - min(k, D), wd, min(k, D))
    if wall == "west":
        return _rect_poly(0.0, off, min(k, W), wd)
    return _rect_poly(W - min(k, W), off, min(k, W), wd)


ZONE_STYLE = {"desk": dict(color="#4FC3F7", expect_stationary=True, posture="seated"),
              "bed": dict(color="#BA68C8", expect_stationary=True, posture="lying"),
              "door": dict(color="#FFB74D", is_exit=True),
              "balcony door": dict(color="#FFB74D", is_exit=True)}


def apply(form: dict, room: Optional[dict] = None) -> dict:
    """The new room.json dict. Raises ValueError with the problems if the form is invalid."""
    errs = validate(form)
    if errs:
        raise ValueError("; ".join(f"{e['field']}: {e['error']}" for e in errs))
    d = json.loads(json.dumps(room or {}))
    W, D, H = float(form["width"]), float(form["depth"]), float(form["height"])
    d.update(width=W, depth=D, height=H, measured=True,
             measured_at=time.strftime("%Y-%m-%d"), measured_by="Measure my room form")
    furn = [f for f in d.get("furniture", []) if f.get("name") not in RECTS]
    for k in RECTS:
        r = form.get(k)
        if isinstance(r, dict):
            furn.append({"name": k, "x": float(r["x"]), "y": float(r["y"]), "w": float(r["w"]),
                         "d": float(r["d"]), "h": {"bed": 0.5, "desk": 0.75, "wardrobe": 2.1}[k],
                         "color": "#5D4037" if k == "bed" else "#8D6E63"})
    d["furniture"] = furn
    new_zones = {}
    b = form["bed"]
    new_zones["bed"] = _rect_poly(float(b["x"]), float(b["y"]), float(b["w"]), float(b["d"]))
    k = form["desk"]
    new_zones["desk"] = _desk_zone(float(k["x"]), float(k["y"]), float(k["w"]), float(k["d"]), W, D)
    for fk, name in (("door", "door"), ("balcony_door", "balcony door")):
        dr = form.get(fk)
        if isinstance(dr, dict):
            new_zones[name] = _door_zone(dr["wall"], float(dr["offset"]), float(dr["width"]), W, D)
    old = {z.get("name"): z for z in d.get("zones", [])}
    zones = [z for z in d.get("zones", []) if z.get("name") not in new_zones]
    for name, poly in new_zones.items():
        z = dict(old.get(name) or {"name": name, **ZONE_STYLE.get(name, {})})
        z["polygon"] = poly
        zones.append(z)
    d["zones"] = zones
    sensors = [s for s in d.get("sensors", []) if s.get("id") not in ("esp32", "router")]
    for sid, kind, fk in (("router", "router", "router"), ("esp32", "esp32", "board")):
        p = form[fk]
        sensors.append({"id": sid, "kind": kind, "x": float(p["x"]), "y": float(p["y"]), "z": float(p["z"]),
                        "yaw_deg": 0, "pitch_deg": 0, "fov_deg": 360, "range_m": 15 if sid == "router" else 8})
    d["sensors"] = sensors
    d.setdefault("links", [["router", "esp32"]])
    if ["router", "esp32"] not in d["links"]:
        d["links"].append(["router", "esp32"])
    d.setdefault("name", "my room (measured)")
    Room.from_dict(d)                         # the room's own validation must pass too
    return d


def form_from_room(d: Optional[dict]) -> dict:
    """Prefill the form from the current room.json (estimated values to correct)."""
    d = d or {}
    out: dict = {k: d.get(k) for k in ("width", "depth", "height")}
    for f in d.get("furniture", []):
        if f.get("name") in RECTS:
            out[f["name"]] = {a: f.get(a) for a in ("x", "y", "w", "d")}
    for s in d.get("sensors", []):
        if s.get("id") in ("esp32", "router"):
            out["board" if s["id"] == "esp32" else "router"] = {a: s.get(a) for a in ("x", "y", "z")}
    out["measured"] = bool(d.get("measured"))
    return out


def save(form: dict, path: str) -> dict:
    room = None
    if os.path.exists(path):
        with open(path, encoding="utf-8") as f:
            room = json.load(f)
    new = apply(form, room)
    if room is not None:
        shutil.copyfile(path, f"{path}.bak-{time.strftime('%Y%m%d-%H%M%S')}")
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(new, f, indent=2)
    os.replace(tmp, path)
    return new
