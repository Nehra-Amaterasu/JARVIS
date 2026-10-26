"""The drill runner (drill.py), free teachers (teachers.py), daily recalibration (recal.py)
and the day-level evaluator / trainer (dayeval.py). No serial port is ever opened: the
backends here are fakes, and the "board" is the simulator written to an .akr."""
import json
import os

import numpy as np
import pytest

from aankhen import drill as dr
from aankhen.recal import Recalibrator, ReferenceStore, key_of
from aankhen.teachers import FreeTeachers, phone_on_wifi
from aankhen.zones import ZONE_IDS


# ---------------------------------------------------------------- plans
def test_plan_has_two_empties_core_blocks_and_fits_the_budget():
    b = dr.plan_session(3, minutes=26)
    empties = [x for x in b if x.kind == "empty"]
    assert len(empties) == 2 and {e.fan for e in empties} == {True, False}
    for fan in (True, False):
        pairs = {(x.zone, x.activity) for x in b if x.fan == fan and x.kind == "zone"}
        assert set(dr.CORE) <= pairs
    assert 20 <= dr.session_minutes(b) <= 27
    assert all(x.zone in ZONE_IDS for x in b)
    # seeded: same seed same plan, another seed another order
    assert [x.to_dict() for x in dr.plan_session(3)] == [x.to_dict() for x in b]
    assert [(x.zone, x.fan) for x in dr.plan_session(4)] != [(x.zone, x.fan) for x in b]
    # the fan condition that goes first alternates with the seed
    assert dr.plan_session(3)[0].fan != dr.plan_session(4)[0].fan


def test_plan_options():
    b = dr.plan_session(1, minutes=10, zones=["at_desk_chair", "bed_lying"], fan="off")
    assert {x.fan for x in b} == {False}
    assert {x.zone for x in b if x.kind == "zone"} <= {"at_desk_chair", "bed_lying"}
    with pytest.raises(ValueError):
        dr.plan_session(1, zones=["kitchen"])
    with pytest.raises(ValueError):
        dr.plan_session(1, fan="sometimes")
    assert "lie on the bed" in dr.Block(0, "bed_lying", "lying", True).prompt()


def test_answers_he_can_give():
    assert dr.parse_answer("").verdict == "ok"
    assert dr.parse_answer("r").verdict == "redo"
    assert dr.parse_answer("bad").verdict == "bad"
    a = dr.parse_answer("w bed_sitting still")
    assert a.verdict == "ok" and a.zone == "bed_sitting" and a.activity == "still"
    assert dr.parse_answer("w kitchen").verdict == "bad"


# ---------------------------------------------------------------- the runner
class FakeBackend(dr.Backend):
    kind = "fake"

    def __init__(self, rate=250.0, fill=0.97, rssi=-60.0):
        self.rate, self.fill, self.rssi = rate, fill, rssi
        self.t = 0.0
        self.recording = None
        self.fans, self.recal = [], []

    def start_recording(self, path, meta):
        self.recording = path
        open(path, "wb").close()

    def stop_recording(self):
        self.recording = None

    def sample(self):
        return {"t": self.t, "csi_packets": int(self.t * self.rate), "fill": self.fill, "rssi": self.rssi,
                "hbe": 1.0, "firmware": "3.4.0"}

    def set_fan(self, on):
        self.fans.append(on)
        return True

    def recalibrate(self, source):
        self.recal.append(source)

    def firmware(self):
        return "3.4.0"


class ScriptConfirmer:
    def __init__(self, done_answers):
        self.done_answers = list(done_answers)

    def ready(self, block):
        return dr.Answer("ready")

    def done(self, block):
        return self.done_answers.pop(0) if self.done_answers else dr.Answer("ok")


class FakeInputs:
    """Counts the runner reads; typing blocks get key presses, others none."""
    def __init__(self):
        import threading
        self.lock = threading.Lock()
        self.counts = {"input_events": 0, "mouse_moves": 0, "keyish_events": 0}


def run_fake(tmp_path, blocks, answers=(), typing_ok=True, **backend):
    be = FakeBackend(**backend)
    clock = {"t": 1_760_000_000.0}
    inputs = FakeInputs()
    current = {"b": None}

    def sleep(s):
        clock["t"] += s
        be.t += s
        b = current["b"]
        if b is not None and b.activity == "typing" and typing_ok:
            with inputs.lock:
                inputs.counts["input_events"] += int(3 * s)
                inputs.counts["keyish_events"] += int(3 * s)

    r = dr.DrillRunner(be, ScriptConfirmer(answers), out_root=str(tmp_path), speak=lambda t: None,
                       sleep=sleep, clock=lambda: clock["t"], inputs=inputs)
    orig = r.confirmer.ready

    def ready(b):
        current["b"] = b
        return orig(b)
    r.confirmer.ready = ready
    return r.run(blocks, seed=7), be


def test_a_session_writes_labels_session_and_index(tmp_path):
    blocks = dr.plan_session(5, minutes=8)
    res, be = run_fake(tmp_path, blocks)
    assert res["state"] == "done" and res["failed"] == 0 and res["passed"] == len(blocks)
    labels = dr.read_labels(res["folder"])
    assert len(labels) == len(blocks)
    for l in labels:
        for k in ("t_start", "t_end", "zone", "activity", "fan", "confirmed", "notes", "firmware",
                  "packet_rate", "verdict", "retry_of"):
            assert k in l
        assert l["t_end"] - l["t_start"] == pytest.approx(next(b.seconds for b in blocks if b.idx == l["block"]), abs=1.1)
        assert l["firmware"] == "3.4.0" and l["packet_rate"] == pytest.approx(250, rel=0.05)
    assert os.path.exists(os.path.join(res["folder"], "session.json"))
    idx = [json.loads(x) for x in open(tmp_path / "index.jsonl")]
    assert idx[-1]["session"] == res["session"] and idx[-1]["passed"] == len(blocks)
    # the empty blocks capture the day's reference; the fan was switched by the backend
    assert be.recal.count("drill") == 2 and set(be.fans) == {True, False}
    assert res["folder"].startswith(str(tmp_path))


def test_his_answer_is_the_label_and_a_bad_block_is_redone_once(tmp_path):
    blocks = [dr.Block(0, "bed_lying", "lying", False), dr.Block(1, "at_desk_chair", "still", False)]
    answers = [dr.Answer("ok", zone="bed_sitting"), dr.Answer("bad"), dr.Answer("bad")]
    res, _ = run_fake(tmp_path, blocks, answers)
    labels = dr.read_labels(res["folder"])
    assert labels[0]["zone"] == "bed_sitting" and labels[0]["asked_zone"] == "bed_lying"
    assert labels[0]["verdict"] == "ok"
    assert labels[1]["verdict"] == "bad"
    assert labels[2]["retry_of"] == 1 and labels[2]["verdict"] == "bad"
    assert len(labels) == 3                  # repeated once, never twice


def test_quality_checks_fail_slow_links_and_typing_without_keys(tmp_path):
    res, _ = run_fake(tmp_path, [dr.Block(0, "at_desk_chair", "typing", True)], typing_ok=False)
    labels = dr.read_labels(res["folder"])
    assert labels[0]["verdict"] == "qc_fail" and not labels[0]["qc"]["checks"]["typing"]
    assert labels[1]["retry_of"] == 0
    res2, _ = run_fake(tmp_path / "b", [dr.Block(0, "bed_lying", "lying", True)], rate=90.0)
    l2 = dr.read_labels(res2["folder"])
    assert not l2[0]["qc"]["checks"]["packet_rate"]


def test_quality_rssi_against_the_days_empty_block():
    b = dr.Block(0, "bed_lying", "lying", True)
    samples = [{"t": float(t), "csi_packets": 250 * t, "fill": 0.98, "rssi": -70.0, "hbe": 1.0} for t in range(50)]
    assert not dr.quality(b, samples, {}, empty_rssi=-60.0)["checks"]["rssi"]
    assert dr.quality(b, samples, {}, empty_rssi=-66.0)["checks"]["rssi"]


# ---------------------------------------------------------------- teachers
def test_teachers_count_inputs_without_content_and_spot_typing(tmp_path):
    now = [1000.0]
    seq = iter([(5.0, (10, 10)), (0.1, (10, 10)), (0.05, (10, 10)), (0.1, (50, 60)), (8.0, (50, 60))])
    t = FreeTeachers(str(tmp_path), config={}, clock=lambda: now[0], probe=lambda: next(seq),
                     phone=lambda ip, mac: None)
    for _ in range(5):
        t.poll()
        now[0] += 0.2
    assert t.counts["input_events"] == 3          # the last-input moment moved three times
    assert t.counts["mouse_moves"] == 1 and t.counts["keyish_events"] == 2
    assert t.hint()["typing"]
    path = t.write_line()
    line = json.loads(open(path).read().splitlines()[-1])
    assert line["input_events"] == 3 and "hour" in line and line["phone_home"] is None
    assert set(line) >= {"t", "idle_s", "mouse_moves", "keyish_events", "voice_turns", "relay_changes"}
    assert not any(isinstance(v, str) and len(v) > 40 for v in line.values())   # counts, no content


def test_away_needs_phone_gone_and_laptop_idle_for_ten_minutes(tmp_path):
    now = [0.0]
    t = FreeTeachers(str(tmp_path), config={"phone_ip": "192.0.2.5"}, clock=lambda: now[0],
                     probe=lambda: (now[0] + 700.0, (0, 0)), phone=lambda ip, mac: False)
    t.poll(); t.poll_phone()
    assert not t.hint()["away"]
    now[0] = 650.0
    t.poll(); t.poll_phone()
    assert t.hint()["away"]
    t.note_relay("fan", True); t.note_relay("fan", False); t.note_voice_turn()
    assert t.counts["relay_changes"] == 1 and t.counts["voice_turns"] == 1


def test_phone_probe_without_config_is_unknown():
    assert phone_on_wifi(None, None) is None

    class R:
        returncode = 0
        stdout = "Reply from 192.0.2.5"
    assert phone_on_wifi("192.0.2.5", None, run=lambda *a, **k: R()) is True


# ---------------------------------------------------------------- recalibration
def test_reference_store_is_keyed_by_firmware_and_fan_once_a_day(tmp_path):
    rc = Recalibrator(ReferenceStore(str(tmp_path)), min_windows=20)
    shape = np.zeros(6)
    rc.set_active("teachers", "3.4.0", True)
    out = [rc.push((shape + k * 1e-3, 1.0, -60.0), day="2026-10-15") for k in range(20)]
    assert out[-1] is not None and all(o is None for o in out[:-1])
    assert os.path.exists(os.path.join(str(tmp_path), key_of("3.4.0", True) + ".json"))
    assert rc.store.load("3.4.0", False) is None and rc.store.load("3.3.1", True) is None
    # teachers capture at most once a day per key; a drill block always may
    assert all(rc.push((shape, 1.0, -60.0), day="2026-10-15") is None for _ in range(25))
    rc.set_active("drill", "3.4.0", True)
    assert [rc.push((shape, 1.0, -60.0), day="2026-10-15") for _ in range(20)][-1] is not None
    assert rc.active_source is None


# ---------------------------------------------------------------- evaluator / trainer
def write_sim_session(root, day: str, seed: int, seconds: float = 50.0):
    """A drill session made by the simulator: raw.akr with host times + labels.jsonl.
    50 s, four blocks of ~11 s: the test checks the plumbing (windows labelled by
    block, leave-one-day-out, versioned saving), not accuracy, so 80 s bought nothing
    but simulation time (it was the slowest test of the suite)."""
    from aankhen.room import default_room
    from aankhen.simulator import Simulator, scenario_evening
    from aankhen.transport import Recorder
    room = default_room()
    sim = Simulator(room, scenario_evening(room), seed=seed)
    folder = os.path.join(root, day, f"120000-s{seed}")
    os.makedirs(folder, exist_ok=True)
    base = 1_760_000_000.0 + seed * 86400
    rec = Recorder(os.path.join(folder, "raw.akr"), {"label": "drill"})
    for ch in sim.chunks(seconds):
        rec.write(ch, base + sim.t)
    rec.close()
    t0 = base + sim.boot_us / 1e6
    blocks = [("out_of_room", "none", "empty", 4, 15), ("at_desk_chair", "still", "zone", 15, 26),
              ("bed_lying", "lying", "zone", 26, 37), ("beside_bed_desk_side", "moving", "zone", 37, 49)]
    with open(os.path.join(folder, "labels.jsonl"), "w") as f:
        for i, (z, a, kind, s, e) in enumerate(blocks):
            f.write(json.dumps({"block": i, "kind": kind, "zone": z, "activity": a, "fan": False,
                                "t_start": t0 + s, "t_end": t0 + e, "verdict": "ok", "firmware": "sim"}) + "\n")
    return folder


@pytest.mark.slow
def test_leave_one_day_out_and_versioned_training(tmp_path):
    from aankhen import dayeval
    root = str(tmp_path / "drill")
    for i, day in enumerate(("2026-10-15", "2026-10-16")):
        write_sim_session(root, day, seed=11 + i)
    days = dayeval.load_days(root)
    assert sorted(days) == ["2026-10-15", "2026-10-16"]
    w = days["2026-10-15"][0]
    assert w["X"].shape[1] == len(__import__("aankhen.learn", fromlist=["FEATURES"]).FEATURES)
    assert set(w["zone"].tolist()) >= {"out_of_room", "at_desk_chair"}
    rep = dayeval.leave_one_day_out(days)
    for d, r in rep["per_day"].items():
        assert 0.0 <= r["in_room"] <= 1.0 and "zone_top1" in r and "zone_top3" in r and "confusion" in r
        assert r["zone_top3"] >= r["zone_top1"]
    assert rep["gates"]["zone"]["verdict"] == "NOT YET"           # 2 days < 7
    assert rep["gates"]["in_room"]["verdict"] in ("PASS", "FAIL")
    text = dayeval.format_report(rep)
    assert "GATES" in text and "held out 2026-10-15" in text
    models = str(tmp_path / "models")
    m, folder = dayeval.train_all(days, models)
    man = json.load(open(os.path.join(folder, "manifest.json")))
    assert man["days"] == ["2026-10-15", "2026-10-16"] and man["firmware"] == ["sim"]
    assert man["fan_source"] == "uno" and man["feature_ranges"]
    loaded = dayeval.ZoneModel.load_current(models)
    p = loaded.zone_proba(w["X"][0])
    assert abs(sum(p.values()) - 1) < 1e-6 and set(p) <= set(ZONE_IDS)
    # a second save (a later training) keeps the first and becomes current; saving is
    # what versions a model, so the second fit (and the 1.1 s wait for a new
    # timestamp) is not needed to check it
    m.save(models, version="99991231-235959")
    assert len([d for d in os.listdir(models) if os.path.isdir(os.path.join(models, d))]) == 2
    assert os.path.exists(os.path.join(folder, "model.joblib"))
    assert json.load(open(os.path.join(models, "current.json")))["version"] == "99991231-235959"


def test_gates_logic():
    from aankhen.dayeval import gates
    per = {f"d{i}": {"in_room": 0.97, "zone_top1": 0.8} for i in range(7)}
    g = gates(per, 7)
    assert g["in_room"]["verdict"] == "PASS" and g["zone"]["verdict"] == "PASS"
    per["d0"]["in_room"] = 0.9
    per["d1"]["zone_top1"] = 0.1
    g = gates(per, 7)
    assert g["in_room"]["verdict"] == "FAIL" and g["zone"]["verdict"] == "FAIL"


def test_dayeval_stamps_windows_by_the_board_clock_not_chunk_arrival(tmp_path):
    """Regression (2026-10-26): dayeval stamped every sample with its chunk's ARRIVAL
    time, the bug fingerprint.akr_stream had fixed. On a weak link chunks come in
    bursts up to ~1 s late, so windows jittered and could take the next block's label."""
    from aankhen import dayeval
    from aankhen.tests.test_links import _csi_pkt
    from aankhen.transport import Recorder
    rng = np.random.default_rng(0)
    folder = tmp_path / "s1"
    folder.mkdir()
    rec = Recorder(str(folder / "raw.akr"), {"label": "test"})
    host0 = 1_700_000_000.0
    pkts = [_csi_pkt(5.0 + i * 0.005, rng, seq=i) for i in range(6000)]       # 30 s at 200 Hz
    for k in range(0, len(pkts), 20):                                          # 100 ms chunks...
        late = 0.0 if k == 0 else rng.uniform(0.0, 0.8)                        # ...up to 0.8 s late
        chunk = b"".join(p.to_frame().encode() for p in pkts[k:k + 20])
        rec.write(chunk, host0 + pkts[k + 19].timestamp_us / 1e6 - 5.0 + 0.01 + late)
    rec.close()
    labels = [{"block": i, "kind": "zone", "zone": z, "activity": "still", "fan": False,
               "t_start": host0 + s, "t_end": host0 + e, "verdict": "ok"}
              for i, (z, s, e) in enumerate([("at_desk_chair", 0.0, 15.0), ("bed_lying", 15.0, 30.0)])]
    w = dayeval.session_windows(str(folder), labels)
    t = w["t"]
    assert len(t) >= 30
    # The first chunk was on time, so the offset is host0 - 4.99 from then on: each window
    # sits at its board time, exactly one 0.5 s hop after the previous one in its block.
    board = t - (host0 - 4.99)
    assert np.allclose(board, np.round(board / 0.01) * 0.01, atol=1e-5)
    d = np.diff(t)
    assert np.allclose(d[d < 1.0], 0.5, atol=1e-5)
    assert all((z == "at_desk_chair") == (x < host0 + 15.0) for z, x in zip(w["zone"], t))
