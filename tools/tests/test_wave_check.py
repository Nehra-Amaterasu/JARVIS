"""wave_check as N01 left it: the owned-file table, the changed-file rule and the entry rule (its own self-tests run
under pytest here, and the CLI paths the integrator uses are exercised)."""
import json
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import wave_check as wc  # noqa: E402


def _self_tests():
    return sorted(k for k, v in vars(wc).items() if k.startswith("test_") and callable(v))


@pytest.mark.parametrize("name", _self_tests())
def test_builtin_self_tests(name, tmp_path):
    fn = getattr(wc, name)
    fn(tmp_path) if "tmp_path" in fn.__code__.co_varnames[: fn.__code__.co_argcount] else fn()


def test_cli_self_test_exits_zero():
    assert wc.main(["--self-test"]) == 0


def test_cli_table_exit_codes(tmp_path):
    good = tmp_path / "good.json"
    good.write_text(json.dumps({"wave": 0, "packages": [{"id": "A", "owns": ["x/**"], "entry": False}, {"id": "B", "owns": ["y/**"], "entry": False}]}), encoding="utf-8")
    assert wc.main([str(good), "--no-entry", "--repo", str(tmp_path)]) == 0
    bad = tmp_path / "bad.json"
    bad.write_text(json.dumps({"wave": 0, "packages": [{"id": "A", "owns": ["x/**"]}, {"id": "B", "owns": ["x/f.ts"]}]}), encoding="utf-8")
    assert wc.main([str(bad), "--no-entry", "--repo", str(tmp_path)]) == 1
    assert wc.main([str(tmp_path / "missing.json")]) == 2


def test_cli_package_changed_files_with_exclude(tmp_path):
    t = tmp_path / "t.json"
    t.write_text(json.dumps({"wave": 0, "packages": [{"id": "A", "owns": ["x/**"], "entry": False}]}), encoding="utf-8")
    files = tmp_path / "files.txt"
    files.write_text("x/a.ts\npackage-lock.json\n", encoding="utf-8")
    base = [str(t), "--package", "A", "--files", str(files), "--repo", str(tmp_path)]
    assert wc.main(base) == 1
    assert wc.main([*base, "--exclude", "package-lock.json"]) == 0


def test_wave5_table_still_disjoint_and_lane_clean():
    assert wc.check_disjoint(wc.WAVE_TABLES[5]) == []
    assert wc.check_lanes(wc.WAVE_TABLES[5]) == []  # no lane keys: shared-file rule only, and none of its paths is shared
