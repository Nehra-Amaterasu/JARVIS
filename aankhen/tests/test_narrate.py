"""Narrated labels: the sync sound is found under noise and drift, words map to the right
places, and a session folder ends up in the drill's label format."""
import json
import os

import numpy as np
import pytest

from aankhen import fingerprint as fp
from aankhen import narrate as nr

R = nr.DETECT_RATE


def _audio(seconds, syncs_at, rate=R, noise=0.05, gain=0.3, seed=0):
    rng = np.random.default_rng(seed)
    a = rng.normal(0, noise, int(seconds * rate)).astype(np.float32)
    s = nr.sync_sound(rate) * gain
    for t in syncs_at:
        i = int(t * rate)
        a[i:i + len(s)] += s
    return a


def test_sync_found_to_a_few_ms_under_noise_and_a_voice():
    a = _audio(60, [3.25, 52.5])
    rng = np.random.default_rng(1)
    t = np.arange(len(a)) / R
    a += (0.2 * np.sin(2 * np.pi * 180 * t) * (rng.random(len(a)) > 0.5)).astype(np.float32)  # a buzzy "voice"
    found = sorted(t for t, _ in nr.find_syncs(a))
    assert len(found) == 2
    assert abs(found[0] - 3.25) < 0.005 and abs(found[1] - 52.5) < 0.005


def test_no_sync_in_plain_noise():
    assert nr.find_syncs(_audio(30, [])) == []


def test_clock_map_corrects_phone_drift():
    # phone clock runs 50 ppm fast: 1000 s of host time shows as 1000.05 s of audio
    host0, host1 = 1_700_000_000.0, 1_700_001_000.0
    to_host, info = nr.clock_map([(10.0, 50), (10.0 + 1000.05, 50)], host0, host1)
    assert abs(to_host(10.0) - host0) < 1e-6
    assert abs(to_host(10.0 + 1000.05) - host1) < 1e-6
    assert "drift corrected" in info["note"]


def test_clock_map_rejects_an_impossible_drift():
    _, info = nr.clock_map([(10.0, 50), (40.0, 50)], 0.0, 1000.0)
    assert info["scale"] == 1.0 and "impossible" in info["note"]


def test_clock_map_needs_a_sync():
    with pytest.raises(ValueError):
        nr.clock_map([], 0.0, None)


def _w(t, text):
    return [{"t": t + 0.3 * i, "w": w} for i, w in enumerate(text.split())]


def test_longest_phrase_wins():
    ev = nr.find_events(_w(0, "okay now standing at the desk") + _w(10, "sitting on the bed") + _w(20, "bathroom door"))
    assert [e["value"] for e in ev] == ["desk_standing", "bed_sitting", "outside_bathroom"]


def test_punctuation_and_case_do_not_matter():
    ev = nr.find_events([{"t": 0, "w": " Wardrobe,"}, {"t": 1, "w": "Fan"}, {"t": 1.3, "w": "ON."}])
    assert [(e["kind"], e["value"]) for e in ev] == [("zone", "wardrobe"), ("fan", "on")]


def test_events_to_labels_stretches_and_activities():
    ev = nr.find_events(_w(100, "desk chair") + _w(160, "typing") + _w(200, "wardrobe")
                        + _w(230, "pause") + _w(260, "leaving the room"))
    labels = nr.events_to_labels(ev, t_end=400, fan=False)
    got = [(l["zone"], l["activity"], l["kind"]) for l in labels]
    assert got == [("at_desk_chair", "still", "zone"), ("at_desk_chair", "typing", "zone"),
                   ("wardrobe", "still", "zone"), ("out_of_room", "none", "empty")]
    assert labels[0]["t_start"] == 100 and labels[0]["t_end"] == pytest.approx(160 - nr.LAG_END_S)
    assert all(l["verdict"] == "ok" and l["source"] == "narration" for l in labels)
    # nothing is labelled between "pause" and the next place
    assert not any(230 <= l["t_start"] < 260 for l in labels)


def test_short_stretches_are_dropped_and_fan_splits():
    ev = nr.find_events(_w(0, "bed") + _w(2, "desk") + _w(50, "fan on") + _w(90, "wardrobe"))
    labels = nr.events_to_labels(ev, t_end=120, fan=False)
    assert [(l["zone"], l["fan"]) for l in labels] == [("at_desk_chair", False), ("at_desk_chair", True), ("wardrobe", True)]


def test_label_session_end_to_end(tmp_path):
    info = nr.new_session(fan=False, root=str(tmp_path), clock=lambda: 1_700_000_000.0)
    info.host_start_sync, info.host_end_sync, info.stopped = 1_700_000_005.0, 1_700_000_065.0, 1_700_000_070.0
    nr.save_session(info)
    audio = _audio(80, [7.0, 67.0])                       # the phone started 2 s before the start chirp
    words = [{"a": 12.0, "w": "desk"}, {"a": 12.3, "w": "chair"}, {"a": 40.0, "w": "leaving"},
             {"a": 40.3, "w": "the"}, {"a": 40.6, "w": "room"}]
    rep = nr.label_session(info.folder, "unused.m4a", words_audio=words, audio=audio)
    labels = [json.loads(l) for l in open(os.path.join(info.folder, "labels.jsonl"), encoding="utf-8")]
    assert [l["zone"] for l in labels] == ["at_desk_chair", "out_of_room"]
    # audio 12.0 s is 5.0 s after the start chirp -> host start sync + 5 s
    assert labels[0]["t_start"] == pytest.approx(1_700_000_010.0, abs=0.01)
    assert rep["clock"]["note"].startswith("drift corrected")
    assert os.path.exists(os.path.join(info.folder, "transcript.json"))


def test_fingerprint_borrows_the_days_empty_reference():
    rng = np.random.default_rng(0)
    wins = [(float(t), rng.normal(0, 1, (fp.N_SUB, 50)).astype(np.float32)) for t in range(0, 200, 1)]
    labels = [{"t_start": 0, "t_end": 100, "zone": "at_desk_chair", "activity": "still", "fan": False,
               "kind": "zone", "verdict": "ok"}]
    assert len(fp.label_windows(wins, labels)["zone"]) == 0          # no empty stretch: can't clean
    d = fp.label_windows(wins, labels, fallback_refs={False: np.zeros(fp.N_SUB)})
    assert len(d["zone"]) > 0 and d["refs"] == {}
