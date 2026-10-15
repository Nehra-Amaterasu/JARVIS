"""The zone map, the zone belief and its honesty rules (zones.py, belief.py), and the
engine's honest output with the waving class gone."""
import json

import numpy as np
import pytest

from aankhen.belief import (ACTIVITY_FLOOR, BeliefTracker, OodGuard, ZoneBelief, coarse_likelihood,
                            feature_ranges, map_old_activity, motion01)
from aankhen.learn import FEATURES
from aankhen.room import Area, Furniture, House, Room, Zone, default_room
from aankhen.zones import ACTIVITIES, GRAPH, ZONE_IDS, ZoneMap, default_zones, load_zones


def his_kind_of_room() -> Room:
    """A made-up room shaped like the real one (desk on a wall, bed in the middle, a
    bathroom door and a balcony door), so the derivation has every anchor."""
    return Room(
        name="test", width=4.2, depth=3.15,
        zones=[Zone("desk", [[0.45, 1.35], [1.15, 1.35], [1.15, 2.55], [0.45, 2.55]], expect_stationary=True),
               Zone("bed", [[1.53, 0.0], [3.61, 0.0], [3.61, 2.1], [1.53, 2.1]]),
               Zone("door", [[0.14, 0.0], [0.98, 0.0], [0.98, 0.75], [0.14, 0.75]], is_exit=True),
               Zone("bathroom door", [[3.62, 1.95], [4.2, 1.95], [4.2, 2.7], [3.62, 2.7]], is_exit=True),
               Zone("balcony door", [[1.46, 2.8], [3.58, 2.8], [3.58, 3.15], [1.46, 3.15]], is_exit=True)],
        furniture=[Furniture("desk", 0.0, 1.25, 0.48, 1.43, 0.75), Furniture("bed", 1.53, 0.0, 2.08, 2.1, 0.5),
                   Furniture("wardrobe", 0.05, 2.75, 1.37, 0.4, 2.4)],
        house=House(areas=[Area("balcony", [[1.1, 3.25], [4.2, 3.25], [4.2, 4.35], [1.1, 4.35]], "balcony"),
                           Area("bath", [[4.35, 1.3], [5.95, 1.3], [5.95, 3.15], [4.35, 3.15]], "bath")]))


# ---------------------------------------------------------------- zones
def test_every_required_zone_is_derived_with_coordinates():
    zs = default_zones(his_kind_of_room())
    assert [z.id for z in zs] == list(ZONE_IDS)
    by = {z.id: z for z in zs}
    for z in zs:
        assert z.r > 0 and z.estimate
    # places land where they should
    assert by["bed_lying"].x == pytest.approx(2.57, abs=0.01)
    assert 1.15 <= by["beside_bed_desk_side"].x <= 1.53
    assert by["at_balcony_door"].y > 2.8 and by["balcony"].y > 3.15
    assert by["inside_bathroom"].x > 4.2 and not by["inside_bathroom"].in_room
    assert by["out_of_room"].y < 0 and not by["out_of_room"].in_room
    assert by["wardrobe"].y < 2.75                       # in front of it, not inside it
    assert {by[z].coarse for z in ("at_desk_chair", "desk_standing")} == {"desk"}
    assert {by[z].coarse for z in ("bed_lying", "bed_sitting", "standing_on_bed")} == {"bed"}


def test_default_room_still_gets_every_zone():
    assert [z.id for z in default_zones(default_room())] == list(ZONE_IDS)


def test_zone_graph_is_symmetric():
    for a, nbrs in GRAPH.items():
        for b in nbrs:
            assert a in GRAPH[b], (a, b)


def test_zone_file_round_trip_and_bad_file_falls_back(tmp_path):
    room = his_kind_of_room()
    zm = ZoneMap(default_zones(room))
    p = tmp_path / "zones.json"
    zm.save(str(p))
    d = json.loads(p.read_text())
    d["zones"][0]["x"] = 0.9
    d["zones"][0]["estimate"] = False
    p.write_text(json.dumps(d))
    z2 = load_zones(room, str(p))
    assert z2.source == "file" and z2.zones[0].x == 0.9 and not z2.zones[0].estimate
    p.write_text("{not json")
    assert load_zones(room, str(p)).source == "derived"


def test_activities_are_separate_from_zones_and_waving_is_gone():
    assert set(ACTIVITIES) == {"still", "typing", "moving", "lying", "none"}
    assert "waving" not in ACTIVITIES
    a = map_old_activity({"none": 0.0, "still": 0.2, "typing": 0.1, "waving": 0.6, "walking": 0.1})
    assert "waving" not in a and a["still"] == pytest.approx(0.5) and a["moving"] == pytest.approx(0.25)


# ---------------------------------------------------------------- belief
def zmap():
    return ZoneMap(default_zones(his_kind_of_room()))


def test_coarse_classes_spread_evenly_over_their_zones():
    zm = zmap()
    lik = coarse_likelihood(zm, {"desk": 0.7, "bed": 0.1, "room": 0.1, "empty": 0.05, "outside": 0.05})
    i = zm.index
    assert lik[i["at_desk_chair"]] == lik[i["desk_standing"]] == pytest.approx(0.7)
    assert lik[i["out_of_room"]] == lik[i["balcony"]] == pytest.approx(0.1)


def test_belief_is_a_distribution_and_moves_only_along_the_graph():
    zm = zmap()
    b = ZoneBelief(zm)
    b.p = np.zeros(len(zm)); b.p[zm.index["at_desk_chair"]] = 1.0
    b.predict(0.0, 1.0)
    for k in range(1, 40):
        b.predict(k * 0.5, 1.0)
    assert b.p.sum() == pytest.approx(1.0)
    # in 20 s of full motion, mass reached the neighbour but never jumped to the balcony
    assert b.p[zm.index["desk_standing"]] > 0.001
    assert b.p[zm.index["balcony"]] < 1e-6


def test_object_permanence_a_still_sleeper_stays_on_the_bed_for_hours():
    zm = zmap()
    b = ZoneBelief(zm)
    b.p = np.full(len(zm), 1e-6); b.p[zm.index["bed_lying"]] = 1.0; b.p /= b.p.sum()
    b.age[:] = 600.0
    t = 0.0
    b.predict(t, 0.0)
    while t < 3 * 3600:                       # three hours, no evidence, nothing moving
        t += 5.0
        b.predict(t, 0.0)
    bed = sum(b.p[zm.index[z]] for z in ("bed_lying", "bed_sitting", "standing_on_bed"))
    assert bed > 0.8


def test_state_is_unsure_until_evidence_and_floors_hold():
    zm = zmap()
    bt = BeliefTracker(zm, clock=lambda: 100.0)
    c = bt.contract()
    assert c["state"] == "unsure" and len(c["zones"]) == len(zm)
    assert set(c) == {"state", "confidence", "zones", "motion", "activity", "updated"}
    assert set(c["zones"][0]) == {"id", "name", "p", "x", "y", "r"}
    for k in range(60):                       # 30 s of the coarse model saying "desk"
        bt.step(k * 0.5, motion=0.05, coarse_p={"desk": 0.9, "bed": 0.04, "room": 0.04, "empty": 0.01,
                                                 "outside": 0.01},
                activity_p={"none": 0.0, "still": 0.9, "typing": 0.05, "waving": 0.05, "walking": 0.0})
    st, conf = bt.state()
    assert st == "in_room" and conf >= 0.8
    h = bt.honest()
    assert set(h) >= {"state", "zone", "activity", "confidence"}
    assert h["zone"] in (None, "at_desk_chair", "desk_standing")
    act = bt.contract()["activity"]
    assert act is None or (act["state"] in ACTIVITIES and act["p"] >= ACTIVITY_FLOOR)


def test_out_of_distribution_evidence_is_ignored_and_says_unsure():
    zm = zmap()
    bt = BeliefTracker(zm, clock=lambda: 0.0)
    for k in range(40):
        bt.step(k * 0.5, 0.0, coarse_p={"bed": 0.95, "desk": 0.01, "room": 0.02, "empty": 0.01, "outside": 0.01},
                ood="shape_dev1 -377 outside the trained range")
    assert bt.state()[0] == "unsure"
    # the belief did not swallow the "bed" it was fed
    bed = sum(bt.belief.p[zm.index[z]] for z in ("bed_lying", "bed_sitting", "standing_on_bed"))
    assert bed < 0.5
    assert bt.honest()["why"].startswith("shape_dev1")


def test_stale_reference_never_names_a_zone():
    zm = zmap()
    bt = BeliefTracker(zm, clock=lambda: 0.0)
    bt.reference_ok = False
    for k in range(80):
        bt.step(k * 0.5, 0.0, zone_p={"bed_lying": 0.97, "at_desk_chair": 0.03})
    # against another firmware's empty room the CSI models are not evidence at all
    h = bt.honest()
    assert h["state"] == "unsure" and h["zone"] is None and "reference" in h["why"]
    assert max(z["p"] for z in bt.contract()["zones"]) < 0.2
    bt.reference_ok = True
    for k in range(80, 160):
        bt.step(k * 0.5, 0.0, zone_p={"bed_lying": 0.97, "at_desk_chair": 0.03})
    assert bt.honest()["zone"] == "bed_lying"


def test_keyboard_teacher_puts_him_at_the_desk_typing():
    zm = zmap()
    now = [1000.0]
    bt = BeliefTracker(zm, clock=lambda: now[0])
    for k in range(10):
        bt.step(k * 0.5, 0.2, teacher={"at": now[0], "typing": True, "away": False})
    c = bt.contract()
    top = max(c["zones"], key=lambda z: z["p"])
    assert top["id"] == "at_desk_chair" and c["state"] == "in_room"
    assert c["activity"]["state"] == "typing"
    # a stale hint is ignored
    bt2 = BeliefTracker(zm, clock=lambda: now[0])
    bt2.step(0.0, 0.2, teacher={"at": now[0] - 60, "typing": True})
    assert bt2.state()[0] == "unsure"


def test_phone_away_teacher_empties_the_room():
    zm = zmap()
    bt = BeliefTracker(zm, clock=lambda: 5.0)
    for k in range(10):
        bt.step(k * 0.5, 0.0, teacher={"at": 5.0, "typing": False, "away": True})
    assert bt.contract()["state"] == "empty"
    assert bt.contract()["activity"] == {"state": "none", "p": pytest.approx(bt.contract()["confidence"], abs=1e-3)}


def test_ood_guard_range_and_gaps():
    X = np.zeros((200, len(FEATURES)))
    j = FEATURES.index("shape_dev1")
    X[:, j] = np.linspace(-179, -19, 200)
    X[:, FEATURES.index("log_hbe")] = 0.3
    g = OodGuard(FEATURES, feature_ranges(X, FEATURES))
    v = X[100].copy()
    assert g.check(v) is None
    v[j] = -377.0
    assert "shape_dev1" in g.check(v)
    g2 = OodGuard(FEATURES, {})
    w = X[0].copy()
    w[FEATURES.index("log_hbe")] = np.nan
    reasons = [g2.check(w) for _ in range(10)]
    assert reasons[-1] is not None and "gaps" in reasons[-1]


def test_motion01_scale():
    assert motion01(None, 2.0) is None
    assert motion01(0.0, 2.0) == 0.0
    assert motion01(8.0, 2.0) == 1.0
    assert 0 < motion01(3.0, 2.0) < 1


# ---------------------------------------------------------------- the engine
def test_engine_frames_carry_the_belief_contract_and_honest_output():
    from aankhen.engine import Engine
    from aankhen.simulator import Simulator, scenario_still
    from aankhen.learn import _packets
    room = default_room()
    sim = Simulator(room, scenario_still(room), seed=3)
    eng = Engine(room, "simulation")
    for p in _packets(sim.chunks(12.0)):
        eng.process(p)
    f = eng.frame_message()
    b = f["belief"]
    assert set(b) == {"state", "confidence", "zones", "motion", "activity", "updated"}
    assert b["state"] in ("in_room", "empty", "unsure")
    assert abs(sum(z["p"] for z in b["zones"]) - 1.0) < 1e-2
    assert {z["id"] for z in b["zones"]} == set(ZONE_IDS)
    assert set(f["honest"]) >= {"state", "zone", "activity", "confidence"}
    assert eng.snapshot()["belief"]["zones"]


def test_engine_never_shows_waving_and_says_unsure_out_of_range():
    """A stand-in activity model that always says "waving", and a spatial model whose
    trained range the live window is far outside of."""
    from aankhen.engine import Engine
    from aankhen.learn import ACTIVITIES as OLD, CLASSES

    class Clf:
        def __init__(self, classes, p):
            self.classes_ = np.array(classes)
            self.p = np.asarray(p, float)

        def predict_proba(self, X):
            return np.tile(self.p, (len(X), 1))

    class Spatial:
        clf = Clf(CLASSES, [0.02, 0.02, 0.02, 0.04, 0.9])
        priors = np.full(5, 0.2)
        features = list(FEATURES)
        trained_on = {"note": "test", "feature_ranges": {"shape_dev1": [-179.0, -19.0]}}

        def proba(self, X):
            return self.clf.predict_proba(X)

    class Activity:
        clf = Clf(OLD, [0.0, 0.1, 0.05, 0.8, 0.05])
        trained_on = {}

        def proba(self, X):
            return self.clf.predict_proba(X)

    eng = Engine(default_room(), "replay", spatial_model=Spatial(), activity_model=Activity())
    v = np.zeros(len(FEATURES))
    v[FEATURES.index("log_hbe")] = 0.2
    v[FEATURES.index("shape_dev1")] = -100.0
    for k in range(10):
        eng._learned_step(k * 0.5, v)
    assert eng.learned["activity"]["state"] != "waving"
    assert "waving" not in eng.learned["activity"]["p"]
    assert eng.learned["state"] == "bed"
    v[FEATURES.index("shape_dev1")] = -377.0
    eng._learned_step(6.0, v)
    assert eng.learned["state"] == "unsure" and "shape_dev1" in eng.learned["unsure"]
    assert eng.learned["activity"]["state"] is None
    assert eng.belief.honest()["state"] == "unsure"


def test_external_fan_starts_a_settle_and_picks_its_reference(tmp_path):
    from aankhen.engine import Engine
    from aankhen.recal import ReferenceStore
    store = ReferenceStore(str(tmp_path))
    store.save(None, True, {"shape": [0.0] * 6, "level": 1.0, "rssi": -60.0, "windows": 300}, "drill", "2026-10-15")
    eng = Engine(default_room(), "hardware", references=str(tmp_path))
    eng.device_t = 100.0
    eng.set_fan_external(False)
    assert not eng.reference["matched"]
    eng.set_fan_external(True)
    assert eng._csi_settling(110.0) and not eng._csi_settling(131.0)
    assert eng.reference["matched"] and eng.belief.reference_ok
    assert any(e.kind == "fan" for e in eng.events)
