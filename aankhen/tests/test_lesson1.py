"""Lesson 1 reads all three label formats into host-time stretches."""
import json

from aankhen import lesson1 as L


def test_labels_from_drill_jsonl(tmp_path):
    p = tmp_path / "labels.jsonl"
    p.write_text("\n".join(json.dumps(x) for x in [
        {"t_start": 10, "t_end": 60, "zone": "wardrobe", "activity": "still", "kind": "zone", "verdict": "ok"},
        {"t_start": 60, "t_end": 90, "zone": "out_of_room", "activity": "none", "kind": "empty", "verdict": "ok"},
        {"t_start": 90, "t_end": 99, "zone": "bed_lying", "activity": "lying", "kind": "zone", "verdict": "bad"}]))
    got = L.load_labels(str(p), 0.0)
    assert [g["label"] for g in got] == ["wardrobe (still)", "empty room"]


def test_labels_from_old_json_both_clocks(tmp_path):
    p = tmp_path / "x.labels.json"
    p.write_text(json.dumps({"segments": [{"start": 0, "end": 5, "label": "empty"},
                                          {"start_host": 100.0, "end_host": 120.0, "zone": "desk", "activity": "still"}]}))
    got = L.load_labels(str(p), 50.0)
    assert got[0] == {"t0": 50.0, "t1": 55.0, "label": "empty"}
    assert got[1]["label"] == "desk (still)" and got[1]["t0"] == 100.0
