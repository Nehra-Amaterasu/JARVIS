"""wave_check N03: the lane check, the route check, the freeze check and exclusion globs. Fixture tables only: no
git, no network, no npm; the board test reads a copy written to a temp folder."""
import json
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import wave_check as wc  # noqa: E402
import wave_comms  # noqa: E402


def table(*pkgs):
    return {"wave": 0, "packages": [{"id": i, "lane": lane, "owns": owns, **extra} for i, lane, owns, *rest in pkgs
                                    for extra in [rest[0] if rest else {}]]}


# ------------------------------------------------------------------------------------------------ lane check
def test_ui_package_with_a_py_path_fails():
    found = wc.check_lanes(table(("U1", "ui", ["app/ui/src/a/**", "app/ui/scripts/make.py"])))
    assert len(found) == 1 and "U1" in found[0] and "Python path" in found[0]


def test_ui_package_in_an_engine_folder_fails():
    for bad in ("app/jarvis_app/ww_x.py", "core/agent.py", "app/tests/test_x.py", "tools/engine/run.py", "core/**"):
        assert wc.check_lanes(table(("U1", "ui", [bad]))), bad


def test_ui_package_owning_a_broad_glob_over_an_engine_folder_fails():
    assert wc.check_lanes(table(("U1", "ui", ["app/**"])))


def test_ui_package_may_own_tools_python():
    # rule 8: a UI package owns tools/** except tools/engine/**; this tool itself is a .py file under tools/
    ok = table(("N03", "ui", ["tools/wave_check.py", "tools/tests/test_wave_check.py", "tools/**"]))
    assert wc.check_lanes(ok) == []


def test_engine_package_with_a_tsx_path_fails():
    found = wc.check_lanes(table(("E1", "engine", ["app/jarvis_app/ww_a.py", "app/ui/src/ww/a.tsx"])))
    assert len(found) == 1 and "E1" in found[0] and "app/ui" in found[0]


@pytest.mark.parametrize("bad", ["app/ui/src/x.ts", "app/ui/src/x.css", "app/ui/package.json", "app/ui/src/**", "app/ui/**", "app/**"])
def test_engine_package_under_app_ui_fails(bad):
    assert wc.check_lanes(table(("E1", "engine", [bad])))


def test_engine_package_may_own_python_and_docs():
    ok = table(("E1", "engine", ["app/jarvis_app/ww_a.py", "core/x/**", "app/tests/test_a.py", "tools/engine/**",
                                  "docs/design/well-wisher-engine-plan.md", "docs/research/well-wisher-engine.md"]))
    assert wc.check_lanes(ok) == []


@pytest.mark.parametrize("shared", ["data/notes/NOW.md", "docs/research/product-design-overhaul.md", "docs/research/*.md",
                                    "docs/design/jarvis-product-overhaul.md"])
def test_shared_file_in_an_owned_list_fails(shared):
    for lane in ("ui", "engine", None):
        found = wc.check_lanes(table(("P1", lane, ["tools/x.py" if lane != "engine" else "core/x.py", shared])))
        assert any("shared file" in f for f in found), (lane, shared)


def test_board_as_it_stands_passes(tmp_path):
    # The row set the comms bulletin of 14 Nov listed (UI lane, wave 6), as the board stores it.
    rows = [
        ("N03", ["tools/wave_check.py", "tools/integrate_wave.py", "tools/tests/test_wave_check.py", "tools/tests/test_wave_check_lanes.py", "tools/tests/test_integrate_wave.py"]),
        ("R01", ["app/ui/src/styles/design/clay/**", "app/ui/src/shared/kit/**", "app/ui/src/shell/shell.css", "app/ui/src/gallery/gallery.css"]),
        ("RC1", ["app/ui/src/jarvis/core/**", "app/ui/src/shell/views/core*.view.ts", "app/ui/e2e/core-v2.spec.ts", "app/ui/e2e/core-shot.spec.ts"]),
        ("RD2", ["app/ui/src/shared/data/tables/**", "app/ui/e2e/d03/**", "app/ui/e2e/d03-tables.spec.ts"]),
        ("RG1", ["app/ui/e2e/jury/**", "app/ui/e2e/jury.spec.ts"]),
    ]
    board = wave_comms.empty_board()
    board["packages"] = [{"pkg": p, "lane": "ui", "wave": 6, "state": "building", "purpose": "x", "owns": o, "adds": [], "imports": [], "note": ""}
                         for p, o in rows]
    f = tmp_path / "board.json"
    f.write_text(json.dumps(board), encoding="utf-8")
    t = wc.board_table(wc.load_board(f))
    assert len(t["packages"]) == 5
    assert wc.check_lanes(t) == []


def test_board_table_reads_only_active_rows():
    board = wave_comms.empty_board()
    board["packages"] = [
        {"pkg": "A", "lane": "ui", "wave": 6, "state": "merged", "purpose": "", "owns": ["app/ui/a/**"], "adds": [], "imports": []},
        {"pkg": "B", "lane": "engine", "wave": 6, "state": "building", "purpose": "", "owns": ["core/b/**"], "adds": [], "imports": []},
        {"pkg": "C", "lane": "ui", "wave": 7, "state": "planned", "purpose": "", "owns": ["app/ui/c/**"], "adds": [], "imports": []},
    ]
    assert [p["id"] for p in wc.board_table(board)["packages"]] == ["B", "C"]
    assert [p["id"] for p in wc.board_table(board, wave=7)["packages"]] == ["C"]
    assert wc.board_table(wave_comms.empty_board())["packages"] == []


def test_cli_board_flags_a_py_path_and_passes_a_clean_one(tmp_path, capsys):
    board = wave_comms.empty_board()
    board["packages"] = [{"pkg": "U1", "lane": "ui", "wave": 1, "state": "building", "purpose": "", "owns": ["app/ui/src/a/**"], "adds": [], "imports": []}]
    f = tmp_path / "b.json"
    f.write_text(json.dumps(board), encoding="utf-8")
    freeze = tmp_path / "none.json"
    args = ["--board", str(f), "--repo", str(tmp_path), "--freeze-file", str(freeze)]
    assert wc.main(args) == 0
    board["packages"][0]["owns"].append("app/ui/gen.py")
    f.write_text(json.dumps(board), encoding="utf-8")
    assert wc.main(args) == 1
    assert "FAIL U1 (ui lane) owns the Python path" in capsys.readouterr().out


# ---------------------------------------------------------------------------------------------- route check
PLAN = """# Engine plan
Convention: paths under `/api/mission/...` and `/api/*`; the phone uses `/api/phone/`.
## R-01 questions
GET `/api/mission/questions` and `POST /api/mission/questions/{qid}/answer` return state, reason and source.
## R-02
`/api/mission/review/due?limit=20` is planned.
"""


def make_repo(tmp_path: Path, adapter_text: str | None, plan: str | None = PLAN) -> Path:
    if plan is not None:
        p = tmp_path / wc.ENGINE_PLAN
        p.parent.mkdir(parents=True)
        p.write_text(plan, encoding="utf-8")
    if adapter_text is not None:
        a = tmp_path / "app/ui/src/ww/study/adapters/engine.register.ts"
        a.parent.mkdir(parents=True)
        a.write_text(adapter_text, encoding="utf-8")
    return tmp_path


def test_route_check_passes_with_no_adapters(tmp_path):
    assert wc.check_routes(make_repo(tmp_path, None)) == []
    assert wc.check_routes(tmp_path / "empty") == []  # not even an app/ui folder


def test_route_check_accepts_listed_routes_in_any_param_spelling(tmp_path):
    src = ("const a = fetch('/api/mission/questions')\n"
           "const b = fetch(`/api/mission/questions/${id}/answer`, {method: 'POST'})\n"
           "const c = '/api/mission/review/due?limit=5'\n"
           "const d = '/api/mission/questions/:qid/answer'\n")
    assert wc.check_routes(make_repo(tmp_path, src)) == []


def test_route_check_reports_unknown_routes_once(tmp_path):
    src = "fetch('/api/mission/secret')\nfetch('/api/mission/secret')\nfetch('/api/mission/questions')\n"
    found = wc.check_routes(make_repo(tmp_path, src))
    assert len(found) == 1 and "/api/mission/secret" in found[0] and "engine.register.ts" in found[0]


def test_route_check_ignores_convention_text_as_entries(tmp_path):
    # '/api/mission/...' and '/api/*' in the plan's prose must not make every route "listed"
    assert wc.plan_routes(PLAN) == {"/api/mission/questions", "/api/mission/questions/{}/answer", "/api/mission/review/due"}
    assert wc.check_routes(make_repo(tmp_path, "fetch('/api/mission/anything')\n"))


def test_route_check_with_adapters_but_no_plan_fails(tmp_path):
    found = wc.check_routes(make_repo(tmp_path, "fetch('/api/mission/questions')", plan=None))
    assert found and "missing" in found[0]


def test_route_check_ignores_files_outside_adapter_folders(tmp_path):
    repo = make_repo(tmp_path, None)
    other = repo / "app/ui/src/ww/study/ports.ts"
    other.parent.mkdir(parents=True)
    other.write_text("fetch('/api/mission/unlisted')", encoding="utf-8")
    assert wc.check_routes(repo) == []


def test_the_real_plan_file_today_lists_no_route_and_the_repo_has_no_adapters():
    root = Path(__file__).resolve().parents[2]
    assert wc.check_routes(root) == []  # an empty adapter set passes; the day one is added this test starts to bite


# ---------------------------------------------------------------------------------------------- freeze check
FROZEN = table(
    ("F1", "ui", ["app/ui/src/ww/study/exam/**"]),
    ("F2", "engine", ["app/jarvis_app/ww_pyq/readiness.py"]),
    ("F3", "ui", ["app/ui/src/ww/study/exam/**"], {"kind": "fix"}),
    ("F4", "ui", ["app/ui/src/ww/day/**"]),
    ("F5", "ui", ["app/ui/src/ww/focus/timer/**"], {"purpose": "Fix the timer rounding"}),
)


def test_freeze_absent_means_no_freeze(tmp_path):
    assert wc.check_freeze(FROZEN, tmp_path / "exam-freeze.json") == []
    assert wc.check_freeze(FROZEN, None) == []


def test_freeze_present_refuses_feature_packages_in_frozen_folders(tmp_path):
    f = tmp_path / "exam-freeze.json"
    f.write_text("{}", encoding="utf-8")
    found = wc.check_freeze(FROZEN, f)
    assert [x.split()[0] for x in found] == ["F1", "F2"]  # F3 and F5 are fixes, F4 is outside the folders
    assert all("D-V3-22" in x for x in found)


def test_freeze_present_checks_changed_files_too(tmp_path):
    f = tmp_path / "exam-freeze.json"
    f.write_text("{}", encoding="utf-8")
    t = table(("F4", "ui", ["app/ui/src/ww/day/**"]))
    assert wc.check_freeze(t, f, {"F4": ["app/ui/src/ww/day/a.tsx"]}) == []
    found = wc.check_freeze(t, f, {"F4": ["app/ui/src/ww/day/a.tsx", "app/jarvis_app/ww_pyq/x.py"]})
    assert len(found) == 1 and "ww_pyq/x.py" in found[0]


def test_freeze_file_comes_from_the_environment(monkeypatch, tmp_path):
    f = tmp_path / "x.json"
    monkeypatch.setenv("JARVIS_EXAM_FREEZE", str(f))
    assert wc.default_freeze_path() == f
    monkeypatch.delenv("JARVIS_EXAM_FREEZE")
    assert wc.default_freeze_path().name == "exam-freeze.json" and "notes" in wc.default_freeze_path().parts


def test_cli_freeze_with_and_without_the_file(tmp_path):
    t = tmp_path / "t.json"
    two = {"wave": 0, "packages": [p for p in FROZEN["packages"] if p["id"] in ("F1", "F2")]}  # disjoint, both feature work
    t.write_text(json.dumps(two), encoding="utf-8")
    base = [str(t), "--freeze", "--no-entry", "--repo", str(tmp_path)]
    assert wc.main([*base, "--freeze-file", str(tmp_path / "absent.json")]) == 0
    present = tmp_path / "exam-freeze.json"
    present.write_text("{}", encoding="utf-8")
    assert wc.main([*base, "--freeze-file", str(present)]) == 1


# ------------------------------------------------------------------------------------------- exclusion globs
def test_exclusion_globs_drop_generated_files():
    t = {"wave": 0, "packages": [{"id": "A", "owns": ["ui/a/**"]}]}
    files = ["ui/a/x.ts", "package-lock.json", "ui/dist-e2e/app.js"]
    assert len(wc.check_changed(t, "A", files)) == 2
    assert wc.check_changed(t, "A", files, exclude=["package-lock.json", "ui/dist-e2e/**"]) == []
    t["exclude"] = ["package-lock.json"]  # the table's own list counts too
    assert len(wc.check_changed(t, "A", files)) == 1
    assert len(wc.check_changed(t, "A", ["ui/b/y.ts"], exclude=["ui/a/**"])) == 1  # an exclusion never widens ownership
