"""The wave comms board: claims, the ownership clash rule, requests, the bulletin, and the lock."""
import json
import os
import sys
import threading
import time
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import wave_comms as wc  # noqa: E402


@pytest.fixture()
def board(tmp_path: Path) -> Path:
    return tmp_path / "wave-comms.json"


def run(board: Path, *args: str) -> int:
    return wc.main(["--board", str(board), *args])


def claim(board: Path, lane: str, pkg: str, owns: str, wave: int = 1, adds: str = "") -> int:
    return run(board, "claim", "--lane", lane, "--wave", str(wave), "--pkg", pkg, "--purpose", f"purpose of {pkg}",
               "--owns", owns, "--adds", adds)


def test_a_claim_is_stored_and_shown(board, capsys):
    assert claim(board, "engine", "E05", "app/jarvis_app/ww_qstore.py,app/tests/test_ww_qstore.py", adds="GET /api/ww/questions") == 0
    assert run(board, "show") == 0
    text = capsys.readouterr().out
    assert "WAVE COMMS BULLETIN" in text
    assert "| engine | 1 | E05 | planned |" in text
    assert "GET /api/ww/questions" in text
    assert "Standing rules:" in text


@pytest.mark.parametrize("mine,theirs,clash", [
    ("app/ui/src/shell/**", "app/ui/src/shell/views/core.view.ts", True),
    ("app/ui/src/shared/data/numbers/**", "app/ui/src/shared/data/series/**", False),
    ("app/jarvis_app/ww_qstore.py", "app/jarvis_app/ww_qstore.py", True),
    ("app/jarvis_app/ww_qstore.py", "app/jarvis_app/ww_qstore_tags.py", False),
    ("**", "app/ui/src/x.ts", True),
    ("app/ui/src/gallery/entries/d0*.tsx", "app/ui/src/gallery/entries/**", True),
    ("app/ui/e2e/core-v2.spec.ts", "app/ui/e2e/d03*", False),
    ("app/ui/e2e/d03-tables.spec.ts", "app/ui/e2e/d0*", True),
    ("app/ui/src/shell/views/core*.view.ts", "app/ui/src/shell/views/day-*.view.ts", False),
    ("app/ui/src/shell", "app/ui/src/shell/x.ts", True),
])
def test_the_overlap_rule(mine, theirs, clash):
    assert wc.overlaps(mine, theirs) is clash
    assert wc.overlaps(theirs, mine) is clash


def test_a_clashing_claim_is_refused_across_lanes_and_changes_nothing(board, capsys):
    assert claim(board, "ui", "N02", "app/ui/src/shell/**") == 0
    assert claim(board, "engine", "E99", "app/ui/src/shell/views/x.view.ts") == 1
    assert "ownership clash" in capsys.readouterr().err
    pkgs = [p["pkg"] for p in json.loads(board.read_text(encoding="utf-8"))["packages"]]
    assert pkgs == ["N02"]


def test_a_merged_package_frees_its_paths_and_moves_to_the_merged_list(board, capsys):
    assert claim(board, "ui", "N02", "app/ui/src/shell/**") == 0
    assert run(board, "status", "--pkg", "N02", "--state", "merged", "--note", "at abc1234") == 0
    assert claim(board, "ui", "N03", "app/ui/src/shell/views/x.view.ts", wave=2) == 0
    capsys.readouterr()
    run(board, "show")
    text = capsys.readouterr().out
    assert "- N02 (ui): purpose of N02" in text
    assert "| ui | 2 | N03 | planned |" in text


def test_a_package_can_update_its_own_claim(board):
    assert claim(board, "ui", "N02", "app/ui/src/shell/**") == 0
    assert claim(board, "ui", "N02", "app/ui/src/shell/**,app/ui/e2e/shell*.spec.ts") == 0
    data = json.loads(board.read_text(encoding="utf-8"))
    assert len(data["packages"]) == 1 and len(data["packages"][0]["owns"]) == 2


def test_requests_between_lanes(board, capsys):
    assert run(board, "ask", "--from", "ui", "--to", "engine", "--text", "shape of GET /api/ww/questions?") == 0
    run(board, "show")
    assert "#1 ui asks engine" in capsys.readouterr().out
    assert run(board, "answer", "--id", "1", "--text", "route R-03 in the plan file") == 0
    run(board, "show")
    text = capsys.readouterr().out
    assert "Open requests between lanes:\n(none)" in text
    assert "=> route R-03 in the plan file" in text
    assert run(board, "answer", "--id", "9", "--text", "x") == 1


def test_check_reports_a_clash_written_by_hand(board, capsys):
    data = wc.empty_board()
    for pkg, owns in (("A", ["app/x/**"]), ("B", ["app/x/y.py"])):
        data["packages"].append({"pkg": pkg, "lane": "ui", "wave": 1, "state": "building", "purpose": pkg,
                                 "owns": owns, "adds": [], "imports": [], "note": ""})
    wc.save(board, data)
    assert run(board, "check") == 1
    assert "OWNERSHIP CLASHES" in capsys.readouterr().out


def test_unknown_package_and_empty_ownership_are_errors(board):
    assert run(board, "status", "--pkg", "ZZ", "--state", "merged") == 1
    assert claim(board, "ui", "N02", " , ") == 2


def test_twenty_concurrent_writers_lose_nothing(board):
    errors: list[BaseException] = []

    def write(i: int) -> None:
        try:
            assert run(board, "note", "--lane", "ui", "--text", f"note {i}") == 0
        except BaseException as exc:  # a failed assert in a thread must fail the test
            errors.append(exc)

    threads = [threading.Thread(target=write, args=(i,)) for i in range(20)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    assert not errors
    notes = json.loads(board.read_text(encoding="utf-8"))["notes"]
    assert sorted(n["text"] for n in notes) == sorted(f"note {i}" for i in range(20))


def test_a_stale_lock_is_broken_and_a_fresh_one_is_respected(board, monkeypatch):
    lock = board.with_suffix(board.suffix + ".lock")
    lock.write_text("dead")
    old = time.time() - wc.LOCK_STALE_S - 5
    os.utime(lock, (old, old))
    assert run(board, "note", "--lane", "engine", "--text", "after a dead writer") == 0
    assert not lock.exists()
    lock.write_text("alive")
    monkeypatch.setattr(wc, "LOCK_WAIT_S", 0.2)
    with pytest.raises(TimeoutError):
        run(board, "note", "--lane", "engine", "--text", "blocked")
    lock.unlink()


def test_the_board_path_can_come_from_the_environment(tmp_path, monkeypatch):
    target = tmp_path / "elsewhere.json"
    monkeypatch.setenv("JARVIS_WAVE_COMMS", str(target))
    assert wc.default_board_path() == target
