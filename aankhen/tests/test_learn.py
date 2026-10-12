"""The learned spatial model (learn.py) and the house layout it trains on."""
import numpy as np
import pytest

from aankhen.learn import (CLASSES, FEATURES, FeatureStream, TemporalFilter, evaluate, train,
                           transition_matrix)
from aankhen.csi import Sample
from aankhen.room import Area, Fixture, House, Room, default_room


def test_transitions_are_probabilities_and_forbid_teleporting():
    T = transition_matrix()
    assert np.allclose(T.sum(axis=1), 1.0)
    i = {c: k for k, c in enumerate(CLASSES)}
    assert T[i["desk"], i["bed"]] == 0 and T[i["bed"], i["desk"]] == 0
    assert T[i["empty"], i["desk"]] == 0 and T[i["desk"], i["empty"]] == 0


def test_filter_goes_through_the_room_on_the_way_to_bed():
    f = TemporalFilter(np.full(5, 0.2))
    desk = np.array([0.01, 0.01, 0.02, 0.95, 0.01])
    bed = np.array([0.01, 0.01, 0.02, 0.01, 0.95])
    for _ in range(40):
        f.step(desk)
    path = [CLASSES[int(np.argmax(f.step(bed)))] for _ in range(60)]
    assert path[-1] == "bed"
    # The belief has to flow desk -> room -> bed, so even a confident "bed" from the
    # classifier takes several steps to win; without the rule it would win at once.
    assert path.index("bed") >= 2


def test_feature_stream_emits_every_feature_twice_a_second():
    rng = np.random.default_rng(0)
    fs = FeatureStream()
    out = []
    for k in range(600):
        v = fs.push(Sample(k / 100.0, 1 + rng.normal(0, 0.03, 51), False, -50.0, True), rssi=-50.0)
        if v is not None:
            out.append(v)
    # first vector once 3 s are buffered, then every 0.5 s: at 3.0, 3.5, ... 6.0 s
    assert len(out) == 7 and all(len(v) == len(FEATURES) for v in out)


def _toy_runs(seed):
    """Separable fake data: one informative feature per class."""
    rng = np.random.default_rng(seed)
    runs = []
    for _ in range(4):
        y = np.repeat(CLASSES, 40)
        X = rng.normal(0, 0.3, (len(y), len(FEATURES)))
        for k, c in enumerate(CLASSES):
            X[y == c, k] += 3.0
        runs.append({"X": X, "y": y, "t": np.arange(len(y)) * 0.5, "engine": np.array([])})
    return runs


def test_train_and_evaluate_on_held_out_runs():
    model = train(_toy_runs(0))
    rep = evaluate(model, _toy_runs(1))
    assert rep["classifier"]["accuracy"] > 0.9
    assert set(rep["confusion_filtered"]) == set(CLASSES)


def test_house_layout_round_trips_and_validates(tmp_path):
    r = default_room()
    r.house = House([Area("passage", [[-1, -1.2], [5, -1.2], [5, -0.1], [-1, -0.1]], "passage")],
                    [Fixture("main door", "door", -5.0, -4.0, 1.0)])
    p = tmp_path / "room.json"
    r.save(str(p))
    again = Room.load(str(p))
    assert again.house.area("passage").kind == "passage"
    assert again.house.fixtures[0].name == "main door"
    bad = r.to_dict()
    bad["house"]["areas"][0]["polygon"] = [[0, 0], [1, 1]]
    with pytest.raises(ValueError):
        Room.from_dict(bad)


def test_house_scenarios_need_a_house():
    from aankhen.simulator import scenario_house, scenario_life
    with pytest.raises(ValueError):
        scenario_house(default_room())
    r = default_room()
    r.house = House([Area("passage", [[-1, -1.2], [5, -1.2], [5, -0.1], [-1, -0.1]], "passage"),
                     Area("living room", [[-6, -5], [-2, -5], [-2, -1.3], [-6, -1.3]])],
                    [Fixture("your door", "door", 0.5, 0.0), Fixture("main door", "door", -4.0, -5.0),
                     Fixture("console + router", "console", -3.0, -3.0)])
    names = [a.name for a in scenario_house(r).actors]
    assert {"family 1", "family 2", "you"} <= set(names)
    life = scenario_life(r, np.random.default_rng(3), 300.0)
    assert life.actors[0].name == "you" and life.actors[0].steps


def test_a_taught_away_window_is_outside_when_someone_moves_and_empty_when_quiet():
    from aankhen.learn import _zone_class
    v = np.zeros(len(FEATURES))
    v[FEATURES.index("log_hbe")] = np.log(8.0)
    assert _zone_class("away", v) == "outside"
    v[FEATURES.index("log_hbe")] = np.log(1.2)
    assert _zone_class("away", v) == "empty"
    assert _zone_class("desk", v) == "desk"


def test_the_activity_model_learns_separable_rhythms():
    from aankhen.learn import ACTIVITIES, train_activity
    rng = np.random.default_rng(0)
    X, a = [], []
    for k, act in enumerate(["still", "typing", "waving", "walking"]):
        x = rng.normal(0, 0.3, (80, len(FEATURES)))
        x[:, FEATURES.index("log_hbe")] += k * 1.5
        X.append(x); a += [act] * 80
    m = train_activity([{"X": np.concatenate(X), "activity": np.array(a)}])
    pred = np.array(ACTIVITIES)[m.proba(np.concatenate(X)).argmax(1)]
    assert (pred == np.array(a)).mean() > 0.9
