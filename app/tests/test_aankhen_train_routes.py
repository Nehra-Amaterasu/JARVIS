"""Teach / train / correct routes (routes_aankhen_train.py) and their adapter
(aankhen_training.py), on a bare app. aankhen.dataset and fingerprint.train_job /
model_status are agent A's: here they are fakes, so these tests pin the app's side of the
contract and the "not in this checkout" path. Nothing opens a serial port."""
import json
import os
import sys
import time
import types

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from jarvis_app import aankhen_training as at
from jarvis_app import routes_aankhen_train as rt


class FakeSource:
    def __init__(self):
        self._recorder = None
        self.recorded = []

    def record_to(self, path, meta=None):
        self._recorder = object()
        self.recorded.append((path, meta))

    def stop_recording(self):
        self._recorder = None


def hw_hub(stream=True):
    from aankhen.room import default_room
    return types.SimpleNamespace(mode="hardware", source=FakeSource(), engine=None, room=default_room(),
                                 stream=types.SimpleNamespace(running=lambda: True) if stream else None)


def make(hub):
    app = FastAPI()
    published = []
    bus = types.SimpleNamespace(publish=lambda *a, **k: published.append(a))
    rt.register(app, types.SimpleNamespace(hub=hub), bus)
    return TestClient(app), app, published


@pytest.fixture
def dataset(monkeypatch):
    """A fake aankhen.dataset that keeps spans in a list."""
    spans = []
    mod = types.ModuleType("aankhen.dataset")

    def add_span(recording, t0, t1, zone, source):
        if t1 <= t0:
            raise ValueError("t1 must be after t0")
        s = {"recording": recording, "t0": t0, "t1": t1, "zone": zone, "source": source}
        spans.append(s)
        return s
    mod.add_span = add_span
    mod.list_spans = lambda: list(spans)
    mod.catalog = lambda: {"2026-10-27": {}}
    monkeypatch.setitem(sys.modules, "aankhen.dataset", mod)
    return spans


@pytest.fixture
def dirs(tmp_path, monkeypatch):
    monkeypatch.setattr(rt, "_drill_dir", lambda: str(tmp_path / "drill"))
    monkeypatch.setattr(rt, "_narrate_dir", lambda: str(tmp_path / "drill" / "narrate"))
    monkeypatch.setenv("AANKHEN_AUDIO_DIRS", str(tmp_path / "audio"))
    return tmp_path


def wait(job, s=5.0):
    job.join(s)
    assert not job.running()


# ------------------------------------------------------------------ adapter
def test_adapter_says_what_is_missing_instead_of_crashing(monkeypatch):
    monkeypatch.setitem(sys.modules, "aankhen.dataset", None)        # import fails
    import aankhen.fingerprint as fp
    monkeypatch.delattr(fp, "train_job", raising=False)
    monkeypatch.delattr(fp, "model_status", raising=False)
    av = at.available()
    assert av["add_span"] is False and av["train_job"] is False
    assert "aankhen.fingerprint.train_job" in av["missing"]
    with pytest.raises(at.TrainingUnavailable):
        at.add_span("x", 0, 1, "bed_lying", "minidrill")
    st = at.status_or_reason()
    assert st["status"] == "predicting" and "model_status" in st["unavailable"]
    with pytest.raises(ValueError):
        at.add_span("x", 0, 1, "bed_lying", "made-up source")


def test_status_word_is_only_ever_the_two_words(monkeypatch):
    import aankhen.fingerprint as fp
    monkeypatch.setattr(fp, "model_status", lambda: {"status": "great!"}, raising=False)
    assert at.model_status()["status"] == "predicting"
    monkeypatch.setattr(fp, "model_status", lambda: {"status": "answering", "days": 5}, raising=False)
    assert at.model_status()["status"] == "answering"


def test_plain_report_from_the_held_out_shape():
    rep = {"balanced": {"cnn": 0.42, "knn": 0.30, "majority": 0.25}, "ci95": {"cnn": [0.31, 0.55]},
           "per_place": {"at_desk_chair": {"cnn": 0.8, "knn": 0.5}, "bed_lying": {"cnn": 0.1}}}
    st = {"status": "predicting", "days": 2, "seconds_per_place": {"at_desk_chair": 12, "bed_lying": 45}}
    p = at.plain_report(rep, st, 30, {"at_desk_chair": "Sitting at the desk"})
    assert p["model"] == "cnn" and p["balanced"] == 0.42 and p["baseline"] == 0.25
    assert p["interval"] == [0.31, 0.55] and p["clears_baseline"] is True
    assert {"place": "at_desk_chair", "name": "Sitting at the desk", "recall": 0.8} in p["recall"]
    desk = p["seconds"][0]
    assert desk["place"] == "at_desk_chair" and desk["missing"] == 18
    text = " ".join(p["lines"])
    assert "42 %" in text and "25 %" in text and "Sitting at the desk 12 s of 30 s" in text
    assert "predicting" in text and "days so far: 2" in text


def test_plain_report_flat_shape_and_a_failed_interval():
    p = at.plain_report({"balanced_accuracy": 0.3, "baseline": 0.28, "interval": [0.2, 0.4],
                         "recall": {"bed_lying": 0.5}, "status": "answering"}, {})
    assert p["clears_baseline"] is False and p["status"] == "answering"
    assert any("not yet better" in line for line in p["lines"])
    empty = at.plain_report(None, None)
    assert empty["status"] == "predicting" and empty["balanced"] is None


def test_job_reports_progress_then_result_and_errors():
    j = at.Job("t")
    seen = []

    def work(progress):
        progress("half", 0.5)
        seen.append(j.view()["fraction"])
        return {"ok": 1}
    assert j.start(work)
    wait(j)
    assert seen == [0.5] and j.state == "done" and j.result == {"ok": 1} and j.view()["fraction"] == 1.0
    j2 = at.Job("t2")
    j2.start(lambda p: (_ for _ in ()).throw(ValueError("no spans yet")))
    wait(j2)
    assert j2.state == "error" and j2.error == "no spans yet"


# ------------------------------------------------------------------ train2
def test_train2_runs_in_the_background_and_reports_in_plain_words(monkeypatch, dataset, dirs):
    import aankhen.fingerprint as fp
    calls = []

    def train_job(per_place_s=30, progress=None, adabn=False):
        calls.append((per_place_s, adabn))
        progress("windows", 0.3)
        progress("held-out day", 0.8)
        return {"balanced": {"cnn": 0.5, "majority": 0.25}, "ci95": {"cnn": [0.4, 0.6]},
                "per_place": {"bed_lying": {"cnn": 0.7}}}
    monkeypatch.setattr(fp, "train_job", train_job, raising=False)
    monkeypatch.setattr(fp, "model_status", lambda: {"status": "predicting", "days": 1, "sessions": 2,
                                                     "seconds_per_place": {"bed_lying": 40, "wardrobe": 5},
                                                     "last_trained": None, "report_path": None}, raising=False)
    c, app, pub = make(hw_hub())
    v = c.get("/api/aankhen/train2").json()
    assert v["status"] == "predicting" and v["job"]["state"] == "idle"
    assert v["report"]["seconds"][0]["place"] == "wardrobe"          # most missing first
    assert c.post("/api/aankhen/train2", json={"per_place_s": 1}).status_code == 400
    r = c.post("/api/aankhen/train2", json={"per_place_s": 30})
    assert r.status_code == 200
    wait(app.state.aankhen_train_jobs["train"])
    v = c.get("/api/aankhen/train2").json()
    assert calls == [(30, False)] and v["job"]["state"] == "done"
    assert v["report"]["balanced"] == 0.5 and v["report"]["clears_baseline"] is True
    assert any("Wardrobe" in line or "wardrobe" in line.lower() for line in v["report"]["lines"])
    assert any(a[1] == "train" for a in pub)


def test_train2_says_so_when_the_training_code_is_missing(monkeypatch, dirs):
    import aankhen.fingerprint as fp
    monkeypatch.delattr(fp, "train_job", raising=False)
    monkeypatch.delattr(fp, "model_status", raising=False)
    c, _, _ = make(hw_hub())
    v = c.get("/api/aankhen/train2").json()
    assert v["status"] == "predicting" and v["model"]["unavailable"]
    r = c.post("/api/aankhen/train2", json={})
    assert r.status_code == 503 and "not in this" in r.json()["detail"]


def test_train2_reads_the_last_report_from_disk(monkeypatch, dirs, tmp_path):
    import aankhen.fingerprint as fp
    p = tmp_path / "report.json"
    p.write_text(json.dumps({"balanced_accuracy": 0.6, "baseline": 0.3}), encoding="utf-8")
    monkeypatch.setattr(fp, "model_status", lambda: {"status": "answering", "report_path": str(p)}, raising=False)
    c, _, _ = make(hw_hub())
    v = c.get("/api/aankhen/train2").json()
    assert v["status"] == "answering" and v["report"]["balanced"] == 0.6


# ------------------------------------------------------------------ mini drill
def test_minidrill_taps_close_and_open_spans_on_the_host_clock(dataset, dirs, monkeypatch):
    hub = hw_hub()
    c, _, pub = make(hub)
    assert c.post("/api/aankhen/minidrill/tap", json={"zone": "bed_lying"}).status_code == 400   # not started
    v = c.post("/api/aankhen/minidrill/start", json={"fan": False}).json()
    rec = v["recording"]
    assert rec.endswith("raw.akr") and str(dirs) in rec and hub.source.recorded[0][1]["label"] == "minidrill"
    assert c.post("/api/aankhen/minidrill/start", json={}).status_code == 409
    assert c.post("/api/aankhen/minidrill/tap", json={"zone": "kitchen"}).status_code == 400
    clock = [1000.0]
    monkeypatch.setattr(rt.time, "time", lambda: clock[0])
    c.post("/api/aankhen/minidrill/tap", json={"zone": "at_desk_chair"})
    clock[0] = 1012.0
    v = c.post("/api/aankhen/minidrill/tap", json={"zone": "beside_bed_desk_side"}).json()
    assert v["closed"]["zone"] == "at_desk_chair" and v["open"]["zone"] == "beside_bed_desk_side"
    clock[0] = 1012.4                                     # a double tap: dropped, not a span
    c.post("/api/aankhen/minidrill/tap", json={"zone": "bed_lying"})
    clock[0] = 1040.0
    c.post("/api/aankhen/minidrill/tap", json={"zone": None})      # pause: closes, opens nothing
    clock[0] = 1050.0
    v = c.post("/api/aankhen/minidrill/stop").json()
    assert v["recording"] is None and hub.source._recorder is None
    assert [(s["zone"], s["t0"], s["t1"], s["source"]) for s in dataset] == [
        ("at_desk_chair", 1000.0, 1012.0, "minidrill"), ("bed_lying", 1012.4, 1040.0, "minidrill")]
    assert all(s["recording"] == rec for s in dataset)
    assert v["dropped"][0]["zone"] == "beside_bed_desk_side"
    assert v["seconds"] == {"at_desk_chair": 12.0, "bed_lying": 27.6}


def test_minidrill_refuses_without_the_board_or_while_something_records(dataset, dirs):
    from aankhen.room import default_room
    sim = types.SimpleNamespace(mode="simulation", source=FakeSource(), engine=None, room=default_room(), stream=None)
    c, _, _ = make(sim)
    assert c.post("/api/aankhen/minidrill/start", json={}).status_code == 400
    busy = hw_hub()
    busy.source._recorder = object()
    c, _, _ = make(busy)
    assert c.post("/api/aankhen/minidrill/start", json={}).status_code == 409


# ------------------------------------------------------------------ correct
def test_correct_and_confirm_label_the_last_seconds(dataset, dirs, monkeypatch):
    c, _, _ = make(hw_hub())
    clock = [2000.0]
    monkeypatch.setattr(rt.time, "time", lambda: clock[0])
    r = c.post("/api/aankhen/correct", json={"zone": "wardrobe"}).json()
    assert r["source"] == "correction" and r["recording"] == "stream" and (r["t0"], r["t1"]) == (1990.0, 2000.0)
    clock[0] = 2004.0                                         # 4 s later: only the new 4 s
    r = c.post("/api/aankhen/correct", json={"zone": "wardrobe", "confirmed": True}).json()
    assert r["source"] == "confirmed" and r["t0"] == 2000.0 and r["seconds"] == 4.0
    assert c.post("/api/aankhen/correct", json={"zone": "wardrobe"}).status_code == 409   # nothing new
    assert c.post("/api/aankhen/correct", json={"zone": "nowhere"}).status_code == 400
    assert c.post("/api/aankhen/correct", json={"zone": "wardrobe", "seconds": 999}).status_code == 400
    assert [s["source"] for s in dataset] == ["correction", "confirmed"]


def test_correct_needs_something_recording_and_the_dataset(dirs, monkeypatch):
    c, _, _ = make(hw_hub(stream=False))
    r = c.post("/api/aankhen/correct", json={"zone": "wardrobe"})
    assert r.status_code == 400 and "nothing is recording" in r.json()["detail"]
    monkeypatch.setitem(sys.modules, "aankhen.dataset", None)
    c, _, _ = make(hw_hub())
    assert c.post("/api/aankhen/correct", json={"zone": "wardrobe"}).status_code == 503


# ------------------------------------------------------------------ narrate
def _session(root, day="2026-10-27", sid="101500-narrate", start=1000.0):
    f = os.path.join(root, day, sid)
    os.makedirs(f, exist_ok=True)
    with open(os.path.join(f, "session.json"), "w", encoding="utf-8") as fh:
        json.dump({"session": sid, "day": day, "folder": f, "host_start_sync": start, "host_end_sync": None,
                   "fan": False, "note": "", "started": start - 5, "stopped": start + 300}, fh)
    return f


def test_narrate_label_runs_the_pipeline_as_a_job(dirs, monkeypatch):
    from aankhen import narrate as nr
    folder = _session(rt._narrate_dir())
    audio_dir = dirs / "audio"
    audio_dir.mkdir()
    a = audio_dir / "rec.m4a"
    a.write_bytes(b"x" * 10)
    (audio_dir / "notes.txt").write_text("not audio")
    c, app, pub = make(hw_hub())
    s = c.get("/api/aankhen/narrate/sessions").json()
    assert [x["folder"] for x in s["sessions"]] == [folder] and s["sessions"][0]["labelled"] is False
    assert [x["name"] for x in s["audio"]] == ["rec.m4a"]
    import numpy as np
    monkeypatch.setattr(nr, "load_audio", lambda p, rate=16000: np.zeros(16000))
    monkeypatch.setattr(nr, "find_syncs", lambda audio, rate=16000, min_sep_s=5.0: [(1.0, 20.0)])
    monkeypatch.setattr(nr, "transcribe", lambda p, language="en", model=None: [
        {"a": 10.0, "w": "wardrobe"}, {"a": 60.0, "w": "bathroom"}])
    assert c.post("/api/aankhen/narrate/label", json={"audio": str(dirs / "missing.m4a")}).status_code == 400
    assert c.post("/api/aankhen/narrate/label", json={"audio": str(audio_dir / "notes.txt")}).status_code == 400
    assert c.post("/api/aankhen/narrate/label", json={"audio": str(a), "session": str(dirs)}).status_code == 400
    assert c.post("/api/aankhen/narrate/label", json={"audio": str(a)}).status_code == 200
    wait(app.state.aankhen_train_jobs["narrate"])
    v = c.get("/api/aankhen/narrate/label").json()
    assert v["job"]["state"] == "done", v["job"]["error"]
    sm = v["summary"]
    assert sm["folder"] == folder and sm["words"] == 2 and sm["stretches"] >= 1
    assert "wardrobe" in sm["minutes"]
    assert os.path.exists(os.path.join(folder, "labels.jsonl"))


def test_narrate_label_fails_fast_on_a_missing_chirp(dirs, monkeypatch):
    from aankhen import narrate as nr
    _session(rt._narrate_dir())
    a = dirs / "a.wav"
    a.write_bytes(b"x")
    import numpy as np
    monkeypatch.setattr(nr, "load_audio", lambda p, rate=16000: np.zeros(16000))
    monkeypatch.setattr(nr, "find_syncs", lambda audio, rate=16000, min_sep_s=5.0: [])
    called = []
    monkeypatch.setattr(nr, "transcribe", lambda *a, **k: called.append(1) or [])
    c, app, _ = make(hw_hub())
    c.post("/api/aankhen/narrate/label", json={"audio": str(a)})
    wait(app.state.aankhen_train_jobs["narrate"])
    v = c.get("/api/aankhen/narrate/label").json()
    assert v["job"]["state"] == "error" and not called            # never reached Whisper
