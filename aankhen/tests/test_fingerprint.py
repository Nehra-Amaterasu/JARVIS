"""The fingerprint pipeline: windowing, labelling by time, cleaning by the same day's
empty room, and the kNN and CNN judged on a held-out day. Synthetic signals only:
each zone bends a different band of subcarriers, each day adds its own drift."""
import numpy as np
import pytest

from aankhen import fingerprint as fp

ZONES = ("desk", "bed", "door")


def stream(seconds, t0=0.0, amp_fn=None, filled_every=None):
    for i in range(int(seconds * fp.RATE_HZ)):
        t = t0 + i / fp.RATE_HZ
        amp = amp_fn(t) if amp_fn else np.ones(fp.N_SUB)
        yield t, amp, bool(filled_every and i % filled_every == 0)


def test_one_window_every_half_second_after_two_seconds():
    w = list(fp.windows(stream(4.0)))
    ends = [t for t, _ in w]
    assert len(w) in (4, 5) and abs(ends[0] - 1.99) < 0.01
    assert np.allclose(np.diff(ends), 0.5, atol=0.03)
    assert w[0][1].shape == (fp.N_SUB, fp.WIN // fp.POOL)


def test_a_long_gap_restarts_the_window():
    s = list(stream(2.5)) + list(stream(2.6, t0=10.0))
    ends = [t for t, _ in fp.windows(s)]
    assert len(ends) == 4 and all(e < 2.6 or e > 11.9 for e in ends)   # nothing spans the 7.5 s gap


def test_a_short_gap_is_bridged():
    s = list(stream(1.5)) + list(stream(1.6, t0=1.8))                  # 0.3 s of silence
    assert len(list(fp.windows(s))) >= 1


def test_weak_link_half_filled_samples_still_count():
    # every other 10 ms sample filled in: each 40 ms step still holds 2 real packets
    assert len(list(fp.windows(stream(3.0, filled_every=2)))) >= 2


def test_windows_with_too_many_empty_steps_are_dropped():
    # whole 40 ms steps with no real packet, 1 in 2: 50 % empty steps
    s = [(t, a, f or (int(round(t * fp.RATE_HZ)) // fp.POOL) % 2 == 0) for t, a, f in stream(3.0)]
    assert list(fp.windows(s)) == []


def _block(zone, t0, t1, kind=None, fan=False):
    return {"zone": zone, "activity": "still", "fan": fan, "t_start": t0, "t_end": t1, "verdict": "ok", "kind": kind}


def test_labels_by_time_purge_and_empty_room_subtracted():
    wins = [(t, np.full((fp.N_SUB, 50), 2.0 if t < 20 else 5.0)) for t in np.arange(1, 40, 0.5)]
    labels = [_block("out_of_room", 0, 20, kind="empty"), _block("desk", 20, 40),
              {**_block("bed", 40, 60), "verdict": "redo"}]
    d = fp.label_windows(wins, labels)
    assert set(d["zone"].tolist()) == {"desk"}           # empty blocks are the reference, redo blocks are ignored
    assert d["t"].min() >= 25                            # 5 s settling purged
    assert np.allclose(d["X"], 3.0)                      # 5.0 minus the empty room's 2.0


def test_no_empty_block_means_no_clean_windows():
    wins = [(t, np.ones((fp.N_SUB, 50))) for t in np.arange(1, 30, 0.5)]
    assert len(fp.label_windows(wins, [_block("desk", 0, 30)])["zone"]) == 0


def synthetic_day(seed, n=60):
    """n windows per zone; each zone lifts its own subcarrier band; the day shifts every subcarrier."""
    rng = np.random.default_rng(seed)
    drift = rng.normal(0, 0.25, (fp.N_SUB, 1))
    X, Z = [], []
    for zi, z in enumerate(ZONES):
        band = slice(zi * 15, zi * 15 + 12)
        for _ in range(n):
            w = rng.normal(0, 0.35, (fp.N_SUB, 50)) + drift
            w[band] += 0.9 + 0.3 * np.sin(np.linspace(0, 6, 50) + rng.uniform(0, 6))
            X.append(w); Z.append(z)
    return {"X": np.asarray(X, np.float32), "zone": np.asarray(Z), "fan": np.zeros(len(Z), bool)}


@pytest.fixture(scope="module")
def days():
    return {f"2026-11-0{i}": [synthetic_day(i)] for i in range(1, 4)}


def test_the_cnn_is_small_enough_for_the_esp32(days):
    m = fp.CnnFingerprint(epochs=1).fit(fp._cat(days["2026-11-01"], "X"), fp._cat(days["2026-11-01"], "zone"))
    assert m.weights() < 25_000                          # int8 -> under 25 KB on the board
    p = m.proba(fp._cat(days["2026-11-02"], "X")[:4])
    assert p.shape == (4, 3) and np.allclose(p.sum(1), 1, atol=1e-5)


# ---------------------------------------------------------------- places, the evaluator, calibration
def session(seed, sid, day, plan, per_visit=50, pat_seed=7):
    """A session on its own clock: plan = [(zone, visits)], visits interleaved, 50 windows
    (25 s) each, 10 s apart. Every place has the same pattern in every session (pat_seed);
    each session adds its own drift, so held-out sessions are a real test."""
    pr = np.random.default_rng(pat_seed)
    pat = {z: pr.normal(0, 0.6, fp.N_SUB) for z in ("desk", "bed", "bed_lying", "bed_sitting", "door", "wardrobe")}
    pat["bed_lying"] = pat["bed_sitting"] = pat["bed"]           # one spot
    rng = np.random.default_rng(seed)
    drift = rng.normal(0, 0.1, fp.N_SUB)
    order = [z for k in range(max(n for _, n in plan)) for z, n in plan if k < n]
    X, Z, T, t = [], [], [], 1000.0 * seed
    for z in order:
        for _ in range(per_visit):
            X.append((pat[z] + drift)[:, None] + rng.normal(0, 0.4, (fp.N_SUB, 50))); Z.append(z); T.append(t); t += 0.5
        t += 10
    return {"X": np.asarray(X, np.float32), "zone": np.asarray(Z), "t": np.asarray(T),
            "fan": np.zeros(len(Z), bool), "activity": np.asarray(["still"] * len(Z)), "day": day, "session": sid}


def test_bed_postures_merge_and_one_visit_places_are_left_out():
    run = session(1, "s1", "d1", [("bed_lying", 2), ("bed_sitting", 1), ("desk", 2), ("wardrobe", 1)])
    before = run["zone"].copy()
    out, dropped = fp.scope_places({"d1": [run]})
    z = set(out["d1"][0]["zone"].tolist())
    assert z == {"bed", "desk"} and dropped == {"wardrobe": 1}
    assert len(out["d1"][0]["X"]) == len(out["d1"][0]["zone"]) == len(out["d1"][0]["t"])
    assert (run["zone"] == before).all()                              # the input is never edited
    raw, dropped_raw = fp.scope_places({"d1": [run]}, merge=False)
    assert "bed_lying" in set(raw["d1"][0]["zone"].tolist()) and "bed_sitting" in dropped_raw


def test_a_merged_place_spreads_back_over_its_zones():
    assert fp.expand_places({"bed": 0.7, "desk": 0.3}) == {"bed_lying": 0.7, "bed_sitting": 0.7, "desk": 0.3}


@pytest.fixture(scope="module")
def sessions3():
    plan = [("desk", 2), ("bed", 2), ("door", 2)]
    return {"d1": [session(1, "s1", "d1", plan), session(2, "s2", "d1", plan), session(3, "s3", "d1", plan)]}


def test_leave_one_session_out_scores_with_intervals_and_controls(sessions3):
    rep = fp.evaluate_held_out(sessions3, by="session", epochs=6, n_boot=300)
    assert rep["groups"] == ["s1", "s2", "s3"] and set(rep["scored_places"]) == {"bed", "desk", "door"}
    b, ci = rep["balanced"], rep["ci95"]
    for k in ("knn", "cnn"):
        assert b[k] > 0.8 and ci[k][0] <= b[k] <= ci[k][1], (k, b[k], ci[k])
        assert ci[k][0] > b["majority"]                               # it clears always-the-commonest
    assert b["majority"] == pytest.approx(1 / 3, abs=1e-3)       # one place right, two wrong
    # visit-shuffled labels: the place is gone, so the control can't learn it
    assert b["knn_shuffled"] < 0.6 and b["cnn_shuffled"] < 0.6
    assert rep["per_place"]["desk"]["visits"] == 6 and rep["per_place"]["desk"]["windows"] == 300
    cal = rep["cnn_calibration_held_out"]
    assert len(cal["temperature"]) == 3 and 0 <= cal["ece_after"] <= 1
    text = fp.format_held_out(rep)
    assert "95 % interval" in text and "shuffled labels" in text and "clears" in text


def test_places_with_few_windows_or_one_visit_are_listed_apart():
    plan = [("desk", 2), ("bed", 2)]
    runs = [session(1, "s1", "d1", plan), session(2, "s2", "d1", plan + [("door", 1)], per_visit=30)]
    rep = fp.evaluate_held_out({"d1": runs}, epochs=2, n_boot=50, control=False)
    # door: one session only, so whenever it is tested its fold never trained on it
    assert "door" not in rep["scored_places"] and rep["listed_apart"]["door"]["untested_windows"] == 30
    assert "s2" in rep["folds"] and "door" in rep["folds"]["s2"]["unknown_places"]


def test_one_session_cannot_be_held_out():
    rep = fp.evaluate_held_out({"d1": [session(1, "s1", "d1", [("desk", 2), ("bed", 2)])]}, epochs=1, n_boot=10)
    assert "error" in rep and "error" in rep["folds"]["s1"]


def test_leave_one_day_out_groups_by_day(sessions3):
    d = {"d1": sessions3["d1"][:2], "d2": [{**sessions3["d1"][2], "day": "d2"}]}
    rep = fp.evaluate_held_out(d, by="day", epochs=3, n_boot=50, control=False)
    assert rep["groups"] == ["d1", "d2"] and rep["folds"]["d2"]["test_windows"] == 300


def test_temperature_fixes_an_overconfident_model_and_keeps_its_answers():
    rng = np.random.default_rng(0)
    Z = rng.normal(0, 3, (4000, 3))
    true_p = fp._softmax(Z / 3.0)                       # the truth is 3x softer than the model says
    y = np.array([rng.choice(3, p=p) for p in true_p])
    m = fp.CnnFingerprint()
    m.classes = ["a", "b", "c"]
    m.logits = lambda X: X                              # the "network" returns these logits as given
    before = m.predict(Z)
    cal = m.calibrate(Z, np.asarray(m.classes)[y])
    assert cal["temperature"] == pytest.approx(3.0, rel=0.15)
    assert cal["ece_after"] < cal["ece_before"] / 2 and cal["nll_after"] < cal["nll_before"]
    assert (m.predict(Z) == before).all()               # a temperature never changes the argmax
    assert fp.ece(true_p, y) < 0.03                     # the true probabilities are calibrated


def test_the_temperature_is_saved_and_loaded(tmp_path, days):
    m = fp.CnnFingerprint(epochs=1).fit(fp._cat(days["2026-11-01"], "X"), fp._cat(days["2026-11-01"], "zone"))
    m.temperature = 2.5
    out = m.save(root=str(tmp_path), meta={"note": "test"})
    back = fp.CnnFingerprint.load(out)
    x = fp._cat(days["2026-11-02"], "X")[:5]
    assert back.temperature == 2.5 and np.allclose(back.proba(x), m.proba(x), atol=1e-6)
    import json, os
    man = json.load(open(os.path.join(out, "manifest.json"), encoding="utf-8"))
    assert man["place_map"] == fp.PLACE_MAP


def test_half_split_alternates_visits_and_never_leaks():
    # desk visited twice, bed once; windows every 0.5 s
    t = np.concatenate([np.arange(0, 30, 0.5), np.arange(60, 90, 0.5), np.arange(120, 160, 0.5)])
    z = np.array(["desk"] * 60 + ["bed"] * 60 + ["desk"] * 80)
    tr, te = fp.half_split(t, z)
    assert not (tr & te).any()
    # desk: first visit trains, second visit verifies
    assert tr[:60].all() and te[120:].all()
    # bed (one visit): cut at its middle with a 2 s guard on neither side
    bt, bte = t[60:120][tr[60:120]], t[60:120][te[60:120]]
    assert len(bt) and len(bte) and bte.min() - bt.max() >= fp.GUARD_S


def test_evaluate_half_records_the_training():
    rng = np.random.default_rng(0)
    pat = {z: rng.normal(0, 0.5, fp.N_SUB) for z in ("desk", "bed", "wardrobe")}
    X, Z, T = [], [], []
    t = 0.0
    for z in ("desk", "bed", "wardrobe", "desk", "bed", "wardrobe"):
        for _ in range(40):
            X.append(pat[z][:, None] + rng.normal(0, 0.3, (fp.N_SUB, 50))); Z.append(z); T.append(t); t += 0.5
        t += 10
    run = {"X": np.asarray(X, np.float32), "zone": np.asarray(Z), "t": np.asarray(T)}
    rep = fp.evaluate_half({"2026-10-26": [run]}, epochs=5)
    assert rep["windows"]["train"] == rep["windows"]["test"] == 120
    assert rep["knn"] > 0.9 and rep["cnn"] > 0.9
    assert len(rep["history"]) == 5 and set(rep["history"][0]["grad"]) == {"conv1", "conv2", "linear"}
    assert "upper bound" in rep["note"].lower()
    assert rep["calibration"]["temperature"] > 0


def test_jittery_chunk_arrival_still_gives_windows(tmp_path):
    """Regression (2026-10-26): with a weak link, chunks reach the host in bursts. Timing
    samples by chunk arrival made them jump and restarted every window (197,945 samples,
    0 windows). The board's clock must space them."""
    from aankhen.tests.test_links import _csi_pkt
    from aankhen.transport import Recorder
    rng = np.random.default_rng(0)
    rec = Recorder(str(tmp_path / "raw.akr"), {"label": "test"})
    host0 = 1_700_000_000.0
    pkts = [_csi_pkt(5.0 + i * 0.005, rng, seq=i) for i in range(6000)]      # 30 s at 200 Hz
    for k in range(0, len(pkts), 20):                                         # 100 ms chunks...
        chunk = b"".join(p.to_frame().encode() for p in pkts[k:k + 20])
        late = rng.uniform(0.0, 0.4)                                          # ...arriving up to 0.4 s late
        rec.write(chunk, host0 + pkts[k + 19].timestamp_us / 1e6 - 5.0 + 0.01 + late)
    rec.close()
    w = fp.session_windows(str(tmp_path))
    assert len(w) >= 50                                  # ~ (30 - 2) / 0.5 windows
    ts = np.array([t for t, _ in w])
    assert np.all(np.diff(ts) > 0) and ts[0] - host0 < 3.5   # on the host clock, in order
