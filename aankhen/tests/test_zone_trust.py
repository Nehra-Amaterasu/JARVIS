"""Zones are named only with a measured layout and a calibrated floor (2026-10-25)."""
import json

import numpy as np

from aankhen import readiness
from aankhen.belief import NOT_CALIBRATED, NOT_MEASURED, NOT_SURE_WHERE, BeliefTracker
from aankhen.engine import UNTRAINED_CAP, honest_learned
from aankhen.room import default_room
from aankhen.zones import ZoneMap, default_zones

ZM = ZoneMap(default_zones(default_room()))


def _sure_at(bt: BeliefTracker, zid: str) -> None:
    p = np.full(len(ZM), 1e-4)
    p[ZM.index[zid]] = 1.0
    bt.belief.p = p / p.sum()
    bt.unsure_reason = None


def _desk():
    return next(z.id for z in ZM.zones if z.in_room)


def test_trusted_names_the_zone():
    bt = BeliefTracker(ZM)
    _sure_at(bt, _desk())
    assert bt.honest()["zone"] == _desk()
    assert bt.contract()["zones_trusted"] is True


def test_estimated_layout_never_names_a_zone():
    bt = BeliefTracker(ZM)
    bt.layout_measured = False
    _sure_at(bt, _desk())
    h = bt.honest()
    assert h["zone"] is None and h["state"] == "in_room"
    assert h["why"] == NOT_MEASURED and h["why"].startswith(NOT_SURE_WHERE)
    assert bt.contract()["zones_trusted"] is False


def test_uncalibrated_floor_never_names_a_zone():
    bt = BeliefTracker(ZM)
    bt.zone_floor = None
    _sure_at(bt, _desk())
    assert bt.honest()["zone"] is None and bt.honest()["why"] == NOT_CALIBRATED


def test_honest_learned_collapses_zones_and_caps():
    l = {"state": "desk", "p": {"desk": 1.0, "bed": 0.0, "room": 0.0, "empty": 0.0, "outside": 0.0},
         "occupied_p": 1.0, "activity": None}
    h = honest_learned(l, zones_trusted=False)
    assert h["state"] == "room" and max(h["p"].values()) <= UNTRAINED_CAP and h["occupied_p"] <= UNTRAINED_CAP
    assert "desk" not in h["p"] and "bed" not in h["p"]
    assert honest_learned(l, zones_trusted=True) is l
    e = honest_learned({"state": "empty", "p": {"empty": 1.0, "desk": 0.0}, "occupied_p": 0.0}, False)
    assert e["state"] == "empty" and e["p"] == {"empty": UNTRAINED_CAP}


def test_readiness_lists_what_is_missing(tmp_path):
    (tmp_path / "room.json").write_text(json.dumps({"measured": False}))
    r = readiness.check(str(tmp_path))
    assert not r["ready"] and r["zone_floor"] is None
    ids = {i["id"] for i in r["items"] if not i["ok"]}
    assert ids == {"layout", "baseline_fan_off", "baseline_fan_on", "drill_days", "zone_gate"}


def test_readiness_ready_only_when_everything_holds(tmp_path):
    (tmp_path / "room.json").write_text(json.dumps({"measured": True}))
    (tmp_path / "baseline.json").write_text(json.dumps({"source": "calibrated", "note": "x"}))
    (tmp_path / "baseline_fan.json").write_text(json.dumps({"source": "calibrated"}))
    (tmp_path / "drill").mkdir()
    lines = [json.dumps({"day": f"2026-10-{d:02d}", "passed": 5}) for d in range(1, 7)]
    lines.append(json.dumps({"day": "2026-10-07", "passed": 0}))          # a failed day does not count
    (tmp_path / "drill" / "index.jsonl").write_text("\n".join(lines))
    assert readiness.check(str(tmp_path))["drill_days"] == 6
    with open(tmp_path / "drill" / "index.jsonl", "a") as f:
        f.write("\n" + json.dumps({"day": "2026-10-08", "passed": 3}))
    (tmp_path / "models" / "drill").mkdir(parents=True)
    lodo = tmp_path / "models" / "drill" / "lodo.json"
    lodo.write_text(json.dumps({"gates": {"zone": {"verdict": "FAIL"}}}))
    assert not readiness.check(str(tmp_path))["ready"]
    lodo.write_text(json.dumps({"gates": {"zone": {"verdict": "PASS"}}}))
    r = readiness.check(str(tmp_path))
    assert r["ready"] and r["zone_floor"] == readiness.ZONE_FLOOR_CALIBRATED and r["missing"] == []
