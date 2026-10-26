"""The labelled-span catalog, the app's spans contract, and the balanced training set.

Synthetic recordings only, in tmp_path: each place bends its own band of subcarriers,
so a balanced set built from them can be checked window by window. Never data/aankhen."""
import json
import os

import numpy as np
import pytest

from aankhen import dataset as ds
from aankhen import fingerprint as fp
from aankhen.protocol import CsiPacket
from aankhen.transport import Recorder

ROUTER = b"\x02\x00\x00\x00\x00\x01"
SUB = np.array([k if k < 32 else k - 64 for k in range(64)], float)
HOST0 = fp.time.mktime((2026, 10, 26, 8, 0, 0, 0, 0, -1))   # 08:00 local: +8 h stays on the same day
DAY = fp.time.strftime("%Y-%m-%d", fp.time.localtime(HOST0))
PAT = {z: np.random.default_rng(k).uniform(-1, 1, 64) for k, z in
       enumerate(("at_desk_chair", "bed_lying", "bed_sitting", "wardrobe", "between_bed_and_balcony_door",
                  "out_of_room", "bookshelf"))}
PAT["bed_sitting"] = PAT["bed_lying"]         # one spot on the floor


def write_akr(path, plan, host0=HOST0, rate=100, seed=0):
    """plan = [(seconds, place)]; packets at `rate` Hz, 100 ms chunks, on the board clock
    from 5 s; host time = host0 + board time - 5. Returns [(t0, t1, place)] in host time."""
    rng = np.random.default_rng(seed)
    rec = Recorder(str(path), {"label": "test"})
    t, spans, seq, chunk = 5.0, [], 0, []
    for secs, place in plan:
        a = t
        for _ in range(int(secs * rate)):
            amp = 40 + 18 * PAT[place] + rng.normal(0, 1.0, 64)
            iq = np.zeros(128, np.int8)
            iq[1::2] = np.clip(np.round(amp), -127, 127).astype(np.int8)
            chunk.append(CsiPacket(int(round(t * 1e6)), seq, -50, -92, 6, 0, 1, 0, 0, 1, ROUTER, iq.tobytes()))
            seq += 1
            t += 1.0 / rate
            if len(chunk) >= rate // 10:
                rec.write(b"".join(p.to_frame().encode() for p in chunk), host0 + t - 5.0 + 0.01)
                chunk = []
        spans.append((host0 + a - 5.0, host0 + t - 5.0, place))
    if chunk:
        rec.write(b"".join(p.to_frame().encode() for p in chunk), host0 + t - 5.0 + 0.01)
    rec.close()
    return spans


def narrate_session(root, day, sid, plan, host0, labels=None, seed=0):
    folder = os.path.join(root, day, sid)
    os.makedirs(folder)
    spans = write_akr(os.path.join(folder, "raw.akr"), plan, host0, seed=seed)
    with open(os.path.join(folder, "labels.jsonl"), "w", encoding="utf-8") as f:
        for a, b, z in spans:
            if labels is not None and z not in labels:
                continue
            f.write(json.dumps({"t_start": a, "t_end": b, "zone": z, "activity": "still", "fan": False,
                                "kind": "empty" if z == "out_of_room" else "zone", "verdict": "ok",
                                "source": "narration"}) + "\n")
    return folder, spans


@pytest.fixture
def roots(tmp_path):
    r = {"drill_root": str(tmp_path / "drill"), "narrate_root": str(tmp_path / "drill" / "narrate"),
         "recordings_dir": str(tmp_path / "recordings"), "spans_path": str(tmp_path / "labels" / "spans.jsonl")}
    os.makedirs(r["narrate_root"])
    os.makedirs(r["recordings_dir"])
    return r


# ---------------------------------------------------------------- label text -> zone ids
@pytest.mark.parametrize("text,zone,kind", [
    ("at_desk_chair", "at_desk_chair", "place"),
    ("desk", "at_desk_chair", "place"),                       # Teach mode's button
    ("sitting on the bed", "bed_sitting", "place"),           # narrate's phrases
    ("bed", "bed", "place"),                                  # the merged place itself
    ("between the bed and the desk", "beside_bed_desk_side", "transit"),
    ("between desk and bed", "beside_bed_desk_side", "transit"),           # either order
    ("between bookshelf and bed", "between_bed_and_bookshelf", "transit"),  # a new transit
    ("Bookshelf", "bookshelf", "place"),                      # a place no list knows yet
    ("leaving the room", "out_of_room", "empty"),
    ("empty", "out_of_room", "empty"),
    ("walk", "moving", "activity"),
    ("ignore this", None, "drop"),
])
def test_every_label_text_maps_to_a_zone(text, zone, kind):
    m = ds.map_label(text)
    assert (m["zone"], m["kind"]) == (zone, kind)


def test_an_empty_label_is_refused():
    with pytest.raises(ValueError):
        ds.map_label("  ")


# ---------------------------------------------------------------- the spans contract
def test_add_span_validates_appends_and_lists(tmp_path):
    akr = tmp_path / "rec" / "x.akr"
    akr.parent.mkdir()
    write_akr(akr, [(1.0, "at_desk_chair")])
    p = str(tmp_path / "spans.jsonl")
    s = ds.add_span(str(akr), HOST0 + 10, HOST0 + 20, "no, I'm at the desk", "correction", path=p)
    assert s["zone"] == "at_desk_chair" and s["kind"] == "place" and s["source"] == "correction"
    assert s["t0"] == HOST0 + 10 and s["day"] == fp.time.strftime("%Y-%m-%d", fp.time.localtime(HOST0 + 10))
    ds.add_span("stream", HOST0 + 30, HOST0 + 40, "bookshelf", "tap", path=p)
    got = ds.list_spans(path=p)
    assert [g["zone"] for g in got] == ["at_desk_chair", "bookshelf"]
    assert [g["zone"] for g in ds.list_spans("stream", path=p)] == ["bookshelf"]
    assert not any(f.endswith(".tmp") for f in os.listdir(tmp_path))      # the temporary file was renamed
    for bad in [dict(recording=str(tmp_path / "missing.akr")), dict(t0=HOST0 + 5, t1=HOST0 + 5),
                dict(t1=HOST0 + 9), dict(zone=""), dict(source="guess"), dict(t0="soon"),
                dict(t0=5.0, t1=9.0), dict(t1=HOST0 + 10 + 7 * 3600), dict(recording="")]:
        kw = dict(recording=str(akr), t0=HOST0 + 10, t1=HOST0 + 20, zone="desk", source="tap") | bad
        with pytest.raises(ValueError):
            ds.add_span(**kw, path=p)
    assert len(ds.list_spans(path=p)) == 2                    # nothing bad was written


def test_a_torn_last_line_is_skipped_and_never_glued(tmp_path):
    p = tmp_path / "spans.jsonl"
    p.write_text('{"recording": "stream", "t0": 1792000010, "t1": 1792000020, "kind": "pla', encoding="utf-8")
    ds.add_span("stream", HOST0 + 1, HOST0 + 2, "desk", "tap", path=str(p))
    assert [s["zone"] for s in ds.list_spans(path=str(p))] == ["at_desk_chair"]


# ---------------------------------------------------------------- the catalog
def test_catalog_reads_narration_teach_and_spans_and_corrections_win(roots):
    day = DAY
    folder, spans = narrate_session(roots["narrate_root"], day, "120000-narrate",
                                    [(6, "out_of_room"), (20, "at_desk_chair"), (30, "bed_lying")], HOST0)
    # Teach mode: times from the recording's first chunk
    tp = os.path.join(roots["recordings_dir"], "teach-20261026-130000.akr")
    tspans = write_akr(tp, [(8, "at_desk_chair"), (8, "bed_sitting")], HOST0 + 3600, seed=1)
    with open(tp[:-4] + ".labels.json", "w", encoding="utf-8") as f:
        json.dump({"kind": "human-labels", "source": "teach", "simulated": False,
                   "segments": [{"label": "desk", "start": 0.0, "end": 8.0}, {"label": "bed", "start": 8.0, "end": 16.0}]}, f)
    # a simulated teach recording never counts
    sp = os.path.join(roots["recordings_dir"], "teach-sim-20261026-140000.akr")
    write_akr(sp, [(2, "at_desk_chair")])
    with open(sp[:-4] + ".labels.json", "w", encoding="utf-8") as f:
        json.dump({"simulated": True, "segments": [{"label": "desk", "start": 0, "end": 2}]}, f)
    # a live correction: the last 10 s of the bed was really the wardrobe
    b0, b1 = spans[2][0], spans[2][1]
    ds.add_span(os.path.join(folder, "raw.akr"), b1 - 10, b1, "wardrobe", "correction", path=roots["spans_path"])
    cat = ds.catalog(**roots)
    sec = cat["seconds"][day]
    assert sec["bed_lying"] == pytest.approx(20, abs=0.1) and sec["wardrobe"] == pytest.approx(10, abs=0.1)
    assert sec["at_desk_chair"] == pytest.approx(28, abs=0.2)       # 20 narrated + 8 taught
    assert sec["out_of_room"] == pytest.approx(6, abs=0.1) and cat["kinds"]["out_of_room"] == "empty"
    assert "bed" in sec                                              # Teach's "In bed" is the merged place
    assert any("simulated" in n for n in cat["notes"])
    assert cat["by_session"]["teach-20261026-130000"]["at_desk_chair"] == pytest.approx(8, abs=0.1)
    assert cat["labels"]["desk"] == "at_desk_chair" and cat["sources"]["correction"] == pytest.approx(10, abs=0.1)
    teach_desk = [s for s in cat["spans"] if s["session"].startswith("teach-") and s["zone"] == "at_desk_chair"][0]
    assert abs(teach_desk["t0"] - tspans[0][0]) < 0.2               # first chunk ~ the board's start
    assert "teach-sim" not in json.dumps(cat["by_session"])


# ---------------------------------------------------------------- the balanced set
@pytest.fixture
def two_sessions(roots):
    day = DAY
    # session A: 2 min asleep on the bed, then a little of everything; session B: no empty room
    narrate_session(roots["narrate_root"], day, "050000-narrate",
                    [(8, "out_of_room"), (6, "at_desk_chair"), (120, "bed_lying"), (8, "wardrobe"),
                     (6, "at_desk_chair"), (3, "between_bed_and_balcony_door")], HOST0, seed=1)
    narrate_session(roots["narrate_root"], day, "120000-narrate",
                    [(12, "bed_sitting"), (10, "at_desk_chair"), (10, "bed_sitting"), (6, "wardrobe")],
                    HOST0 + 7 * 3600, seed=2)
    return roots


def test_build_caps_each_place_per_day_over_its_stays(two_sessions, tmp_path):
    notes = []
    d = ds.build(per_place_s=12, min_place_s=4, cache_dir=str(tmp_path / "cache"), log=notes.append,
                 **two_sessions)
    s = ds.summary(d)
    # the 2 min sleep can't dominate: bed brings 12 s like everyone else
    assert s["per_class"]["bed"]["used_s"] == pytest.approx(12, abs=0.6)
    desk = s["per_class"]["at_desk_chair"]["days"][DAY]
    assert desk["used_s"] == pytest.approx(min(12, desk["available_s"]), abs=0.6) and desk["stays"] == 3
    bed = {k: v for k, v in d["stays"].items() if v["class"] == "bed"}
    assert len(bed) == 3 and all(v["used"] >= 4 for v in bed.values())   # spread over all 3 bed stays
    # the transit had 3 s, minus the trims and the window: dropped with a note
    assert "between_bed_and_balcony_door" in s["dropped"] and any("dropped" in n for n in notes)
    # session B had no empty room: it borrowed A's, and that is flagged
    assert d["refs"]["120000-narrate"]["source"] == "borrowed:050000-narrate"
    assert d["refs"]["050000-narrate"]["source"] == "own"
    assert d["dominant"]["050000-narrate"] == "bed"
    # every window lies inside its span's trimmed edges, never in unlabelled time
    cat = ds.catalog(**two_sessions)
    for t, z in zip(d["t"], d["zone"]):
        assert any(sp["zone"] == z and sp["t0"] + 1.0 - 1e-6 <= t - 2.0 and t <= sp["t1"] - 1.0 + 1e-6
                   for sp in cat["spans"])
    # cleaned by the empty room: windows are log-amp minus the reference, near 0 on average
    assert d["X"].shape[1:] == (fp.N_SUB, fp.NB) and abs(float(d["X"].mean())) < 0.5


def test_build_is_deterministic_and_the_seed_moves_the_draw(two_sessions, tmp_path):
    kw = dict(per_place_s=6, min_place_s=4, cache_dir=str(tmp_path / "cache"), log=lambda *_: None, **two_sessions)
    a, b, c = ds.build(seed=0, **kw), ds.build(seed=0, **kw), ds.build(seed=5, **kw)
    assert np.array_equal(a["t"], b["t"]) and np.array_equal(a["X"], b["X"])
    assert not np.array_equal(a["t"], c["t"])
    assert len(a["y"]) == len(c["y"])


def test_as_days_carries_stays_dominance_and_references(two_sessions, tmp_path):
    d = ds.build(per_place_s=12, min_place_s=4, cache_dir=str(tmp_path / "cache"), log=lambda *_: None,
                 **two_sessions)
    days = ds.as_days(d)
    runs = days[DAY]
    assert [r["session"] for r in runs] == ["050000-narrate", "120000-narrate"]
    assert runs[1]["ref_source"].startswith("borrowed") and runs[0]["dominant"] == "bed"
    assert all(len(r["stay"]) == len(r["zone"]) == len(r["X"]) for r in runs)
    # stays never cross sessions
    assert not set(runs[0]["stay"].tolist()) & set(runs[1]["stay"].tolist())


def test_the_step_cache_gives_the_same_windows_as_decoding(tmp_path):
    p = tmp_path / "raw.akr"
    write_akr(p, [(6, "at_desk_chair"), (6, "bed_lying")])
    direct = fp.session_windows(str(tmp_path))
    first = fp.recording_steps(str(p), cache_dir=str(tmp_path / "c"))
    again = fp.recording_steps(str(p), cache_dir=str(tmp_path / "c"))
    assert not first["cached"] and again["cached"] and first["sha256"] == again["sha256"]
    cached = fp.windows_from_steps(again)
    assert len(cached) == len(direct) > 10
    assert all(a[0] == b[0] and np.array_equal(a[1], b[1]) for a, b in zip(direct, cached))
    # a changed recording is decoded again, never served stale steps
    write_akr(p, [(6, "wardrobe")])
    assert not fp.recording_steps(str(p), cache_dir=str(tmp_path / "c"))["cached"]


def test_spans_on_the_rolling_store_are_trainable(roots, tmp_path):
    """The app's live corrections land on "stream" (no mini drill open): build reads the
    windows back from stream.py's hourly rows."""
    from aankhen import stream as st

    class Clock:
        t = HOST0

        def __call__(self):
            return self.t
    clock = Clock()
    rec = st.StreamRecorder(tmp_path / "stream", clock=clock, phase=False).start()
    plan = [(10, "out_of_room"), (15, "at_desk_chair"), (15, "bed_lying")]
    bt, spans = 50.0, []
    rng = np.random.default_rng(0)
    for secs, z in plan:
        a = HOST0 + bt - 50.0
        for _ in range(int(secs * 100)):
            clock.t = HOST0 + bt - 50.0
            amp = np.exp(0.3 * PAT[z][:51]) + rng.normal(0, 0.01, 51)
            rec.raw(bt, b"", 6, False, rssi=-60, gain_comp_db=3.0)
            rec.sample(bt, amp, False, level_db=-41.5)
            bt += 0.01
        spans.append((a, HOST0 + bt - 50.0, z))
    rec.stop()
    for a, b, z in spans:
        ds.add_span("stream", a, b, z, "correction", path=roots["spans_path"])
    h = st.load_hour(tmp_path / "stream", DAY, fp.time.localtime(HOST0).tm_hour)
    assert np.allclose(h["level_db"], -41.5) and set(h["rssi"].tolist()) == {-60}
    d = ds.build(per_place_s=6, min_place_s=2, stream_root=str(tmp_path / "stream"), log=lambda *_: None, **roots)
    assert set(d["y"].tolist()) == {"at_desk_chair", "bed"}
    assert set(d["session"].tolist()) == {f"stream-{DAY}"} and d["refs"][f"stream-{DAY}"]["source"] == "own"
    for c in ("at_desk_chair", "bed"):
        assert d["per_class"][c]["used_s"] == pytest.approx(6, abs=0.6)
    # the two places stay apart after cleaning by the store's own empty room
    m = {c: d["X"][d["y"] == c].mean(axis=(0, 2)) for c in ("at_desk_chair", "bed")}
    assert np.abs(m["at_desk_chair"] - m["bed"]).max() > 0.2


def test_minidrill_and_confirmed_are_sources(tmp_path):
    akr = tmp_path / "drill" / "minidrill" / DAY / "101500-mini" / "raw.akr"
    akr.parent.mkdir(parents=True)
    write_akr(akr, [(2, "at_desk_chair")])
    p = str(tmp_path / "spans.jsonl")
    for src in ("minidrill", "confirmed", "correction"):
        assert ds.add_span(str(akr), HOST0, HOST0 + 2, "desk", src, path=p)["session"] == "101500-mini"
