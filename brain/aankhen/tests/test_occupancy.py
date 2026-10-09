import math

import numpy as np

from aankhen.occupancy import DecayingGrid, GridSpec, OccupancyMap
from aankhen.room import default_room


def test_deposits_are_conserved_even_at_walls():
    g = DecayingGrid(GridSpec(4, 4, 0.1), half_life_s=1e9)
    g.deposit(2.0, 2.0, 1.0)
    g.deposit(0.01, 0.01, 1.0)                  # corner: stamp gets clipped
    assert math.isclose(g.total(), 2.0, rel_tol=1e-9)


def test_exponential_decay_is_exact():
    g = DecayingGrid(GridSpec(4, 4, 0.1), half_life_s=10.0)
    g.decay_to(0.0)
    g.deposit(2, 2, 8.0)
    g.decay_to(10.0)
    assert math.isclose(g.total(), 4.0, rel_tol=1e-9)
    g.decay_to(30.0)
    assert math.isclose(g.total(), 1.0, rel_tol=1e-9)


def test_out_of_room_positions_are_ignored():
    g = DecayingGrid(GridSpec(4, 4, 0.1), half_life_s=1e9)
    g.deposit(-1, 2, 1.0)
    g.deposit(2, 9, 1.0)
    assert g.total() == 0


def test_dwell_seconds_accumulate_per_zone():
    m = OccupancyMap(default_room())
    for i in range(101):                         # 10 s sitting at the desk
        m.update(i * 0.1, [(0.8, 0.6, 1.0)])
    assert math.isclose(m.zone_seconds["desk"], 10.0, rel_tol=1e-6)
    assert m.zone_seconds["bed"] == 0


def test_low_confidence_contributes_less():
    m = OccupancyMap(default_room())
    for i in range(101):
        m.update(i * 0.1, [(0.8, 0.6, 0.5)])
    assert math.isclose(m.zone_seconds["desk"], 5.0, rel_tol=1e-6)


def test_hotspots_find_where_time_is_spent():
    m = OccupancyMap(default_room())
    rng = np.random.default_rng(0)
    t = 0.0
    for _ in range(600):                         # mostly at the desk ...
        t += 0.1
        m.update(t, [(0.8 + rng.normal(0, .05), 0.6 + rng.normal(0, .05), 1.0)])
    for _ in range(200):                         # ... some time on the bed
        t += 0.1
        m.update(t, [(3.1 + rng.normal(0, .05), 3.0 + rng.normal(0, .05), 1.0)])
    hs = m.hotspots(k=2)
    assert [h.zone for h in hs] == ["desk", "bed"]
    assert hs[0].person_seconds > hs[1].person_seconds


def test_learned_map_survives_restart(tmp_path):
    room = default_room()
    m = OccupancyMap(room)
    for i in range(50):
        m.update(i * 0.1, [(1.0, 1.0, 1.0)])
    p = str(tmp_path / "occ.npz")
    m.save(p)
    m2 = OccupancyMap(room)
    assert m2.load(p)
    assert np.allclose(m2.learned.grid, m.learned.grid)


def test_map_from_a_different_room_is_refused(tmp_path):
    m = OccupancyMap(default_room())
    m.update(0, [(1, 1, 1)]); m.update(1, [(1, 1, 1)])
    p = str(tmp_path / "occ.npz")
    m.save(p)
    other = default_room()
    other.width = 6.0
    assert OccupancyMap(other).load(p) is False
