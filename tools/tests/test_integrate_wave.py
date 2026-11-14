"""integrate_wave: step order, continue after a failure, exit code, --only and --skip, the report written after each
step, the 8777 refusal, --dry-run, the leftovers list. The runner, the port probe and the lister are fakes: no
subprocess, no socket, no npm."""
import io
import json
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import integrate_wave as iw  # noqa: E402

ALL = ["tsc", "vitest-1", "vitest-2", "springs", "bundle", "wave-check", "playwright", "art",
       "pytest-tools", "pytest-root", "pytest-core", "pytest-app", "commits", "leftovers"]


class FakeRunner:
    def __init__(self, fail: tuple[str, ...] = (), report: Path | None = None):
        self.calls: list[dict] = []
        self.fail = fail
        self.report = report
        self.seen_after_each: list[list[str]] = []

    def __call__(self, argv, cwd, env, timeout):
        self.calls.append({"argv": list(argv), "cwd": Path(cwd), "env": dict(env), "timeout": timeout})
        if self.report is not None and self.report.exists():  # what a reader would see if the machine died right now
            self.seen_after_each.append([r["name"] for r in json.loads(self.report.read_text("utf-8"))["steps"] if r["status"] in ("ok", "failed")])
        name = self.names[len(self.calls) - 1]
        return (1, f"{name} broke") if name in self.fail else (0, f"{name} fine")


def go(tmp_path, *args, fail=(), listening=(), leftovers=(), runner=None):
    report = tmp_path / "out" / "r.json"
    r = runner or FakeRunner(fail, report)
    a = ["--report", str(report), *args]
    # the names a real run would use, in order, to label each fake call
    steps, _ = iw.select(iw.build_steps(iw.ROOT, "python", _specs(args)), _tok(args, "--only"), _tok(args, "--skip"))
    r.names = [s.name for s in steps if not s.internal and not (s.guarded and iw.LIVE_PORT in listening)]
    out = io.StringIO()
    code = iw.main(a, runner=r, probe=lambda p: p in listening, lister=lambda: list(leftovers), out=out)
    return code, r, report, out.getvalue()


def _tok(args, flag):
    return [t for i, a in enumerate(args) if a == flag for t in args[i + 1].split(",")]


def _specs(args):
    if "--specs" not in args:
        return []
    i = args.index("--specs") + 1
    out = []
    while i < len(args) and not args[i].startswith("--"):
        out.append(args[i])
        i += 1
    return out


def rows(report: Path):
    return {r["name"]: r for r in json.loads(report.read_text("utf-8"))["steps"]}


# ------------------------------------------------------------------------------------------------ order and codes
def test_steps_run_in_the_documented_order_and_exit_zero(tmp_path):
    code, r, report, _ = go(tmp_path)
    assert code == 0
    assert r.names == [n for n in ALL if n != "leftovers"]
    assert [row for row in rows(report)] == ALL
    assert all(v["status"] == "ok" for v in rows(report).values())
    assert json.loads(report.read_text("utf-8"))["finished"] is True


def test_vitest_runs_twice():
    steps = {s.name: s for s in iw.build_steps(iw.ROOT, "python")}
    assert steps["vitest-1"].argv == steps["vitest-2"].argv and steps["vitest-1"].argv[-2:] == ["vitest", "run"]


def test_a_failure_does_not_stop_the_run_and_sets_the_exit_code(tmp_path):
    code, r, report, out = go(tmp_path, fail=("tsc", "pytest-core"))
    assert code == 1
    assert len(r.calls) == len(ALL) - 1  # every step still ran
    st = rows(report)
    assert st["tsc"]["status"] == "failed" and st["tsc"]["rc"] == 1 and "tsc broke" in st["tsc"]["tail"]
    assert st["pytest-core"]["status"] == "failed" and st["commits"]["status"] == "ok"
    assert "FAILED: tsc, pytest-core" in report.with_suffix(".txt").read_text("utf-8")
    assert "failed: tsc, pytest-core" in out


def test_each_step_has_its_own_exit_code_and_time(tmp_path):
    ticks = iter(range(0, 1000, 3))
    report = tmp_path / "r.json"
    r = FakeRunner(("springs",))
    r.names = [n for n in ALL if n != "leftovers"]
    iw.main(["--report", str(report)], runner=r, probe=lambda p: False, lister=lambda: [], clock=lambda: next(ticks), out=io.StringIO())
    st = rows(report)
    assert st["springs"]["rc"] == 1 and st["tsc"]["rc"] == 0
    assert all(v["seconds"] == 3.0 for k, v in st.items())  # each step timed on its own (start and end tick)


def test_exit_code_is_nonzero_only_for_a_real_failure(tmp_path):
    assert go(tmp_path)[0] == 0
    assert go(tmp_path, fail=("commits",))[0] == 1


# ------------------------------------------------------------------------------------------ --only and --skip
def test_only_runs_just_those_steps_and_marks_the_rest_skipped(tmp_path):
    code, r, report, _ = go(tmp_path, "--only", "tsc,wave-check")
    assert code == 0 and r.names == ["tsc", "wave-check"]
    st = rows(report)
    assert st["vitest-1"]["status"] == "skipped" and st["tsc"]["status"] == "ok"


def test_group_token_selects_numbered_steps(tmp_path):
    assert go(tmp_path, "--only", "vitest")[1].names == ["vitest-1", "vitest-2"]


def test_skip_removes_steps(tmp_path):
    _, r, report, _ = go(tmp_path, "--skip", "playwright,art")
    assert "playwright" not in r.names and "art" not in r.names and "tsc" in r.names
    assert rows(report)["playwright"]["status"] == "skipped"


def test_a_skipped_failing_step_cannot_fail_the_run(tmp_path):
    assert go(tmp_path, "--skip", "tsc", fail=("tsc",))[0] == 0


def test_unknown_step_name_is_a_usage_error(tmp_path, capsys):
    assert iw.main(["--only", "tsx", "--report", str(tmp_path / "r.json")], runner=FakeRunner()) == 2
    assert "no step named 'tsx'" in capsys.readouterr().err


# ----------------------------------------------------------------------------------------------------- report
def test_report_is_rewritten_after_every_step(tmp_path):
    _, r, report, _ = go(tmp_path)
    # before call k the report already holds the k-1 finished steps: an outage after step k leaves k steps on disk
    assert [len(s) for s in r.seen_after_each[1:]] == list(range(1, len(r.calls)))


def test_report_has_json_and_a_text_table(tmp_path):
    _, _, report, _ = go(tmp_path, fail=("art",))
    text = report.with_suffix(".txt").read_text("utf-8")
    assert "step" in text.splitlines()[1] and "art" in text and "failed" in text
    assert not list(report.parent.glob("*.tmp"))


def test_report_inside_the_repository_is_refused(capsys):
    r = FakeRunner()
    assert iw.main(["--report", str(iw.ROOT / "data" / "r.json")], runner=r) == 2
    assert iw.main(["--report", str(iw.ROOT / "tools" / "r.json")], runner=r) == 2
    assert r.calls == [] and "inside the repository" in capsys.readouterr().err


def test_default_report_is_under_the_system_temp_folder():
    import tempfile
    p = iw.default_report_path(0)
    assert Path(tempfile.gettempdir()) in p.parents and not iw.inside(p, iw.ROOT)


# ------------------------------------------------------------------------------------------------- scratch dirs
def test_pytest_steps_get_fresh_scratch_data_dirs(tmp_path):
    _, r, _, _ = go(tmp_path)
    envs = [c["env"] for c in r.calls]
    jd = {e["JARVIS_DATA_DIR"] for e in envs}
    ad = {e["AANKHEN_DATA_DIR"] for e in envs}
    assert len(jd) == 1 and len(ad) == 1
    d = Path(next(iter(jd)))
    assert d != iw.ROOT / "data" and not iw.inside(d, iw.ROOT) and "jarvis-integrate" in str(d)
    assert not d.exists()  # removed after the run
    again = go(tmp_path)[1].calls[0]["env"]["JARVIS_DATA_DIR"]
    assert again != next(iter(jd))  # fresh each run


def test_pytest_commands_and_folders():
    steps = {s.name: s for s in iw.build_steps(iw.ROOT, "py")}
    assert steps["pytest-tools"].argv[:3] == ["py", "-m", "pytest"] and "tools/tests" in steps["pytest-tools"].argv
    assert "tools/art/tests" in steps["art"].argv and "core/tests" in steps["pytest-core"].argv
    assert steps["pytest-root"].argv[3] == "tests" and steps["pytest-root"].cwd == iw.ROOT
    assert steps["pytest-app"].cwd == iw.ROOT / "app" and steps["pytest-app"].argv[3] == "tests"
    assert steps["commits"].argv[-2:] == ["tests/check_commits.py", "origin/main..HEAD"][-2:]
    assert steps["wave-check"].argv[2:4] == ["--board", "--repo"]


def test_specs_narrow_playwright(tmp_path):
    steps = {s.name: s for s in iw.build_steps(iw.ROOT, "py", ["e2e/a.spec.ts", "e2e/b.spec.ts"])}
    assert steps["playwright"].argv[-3:] == ["test", "e2e/a.spec.ts", "e2e/b.spec.ts"][-3:] or steps["playwright"].argv[-2:] == ["e2e/a.spec.ts", "e2e/b.spec.ts"]
    assert steps["playwright"].cwd == iw.ROOT / "app" / "ui"
    _, r, _, _ = go(tmp_path, "--only", "playwright", "--specs", "e2e/a.spec.ts")
    assert r.calls[0]["argv"][-1] == "e2e/a.spec.ts" and "playwright" in r.calls[0]["argv"]


def test_no_step_builds_into_dist():
    for s in iw.build_steps(iw.ROOT, "py"):
        assert "dist" not in s.argv and "--outDir" not in s.argv  # bundle:check owns dist-e2e inside package.json
    pkg = json.loads((iw.ROOT / "app/ui/package.json").read_text("utf-8"))["scripts"]
    assert "--outDir dist-e2e" in pkg["bundle:check"] and "springs:check" in pkg


# ------------------------------------------------------------------------------------------ the 8777 refusal
def test_guarded_steps_are_refused_while_8777_listens(tmp_path):
    code, r, report, _ = go(tmp_path, listening=(8777,))
    st = rows(report)
    for name in ("bundle", "playwright", "art"):
        assert st[name]["status"] == "refused" and "8777" in st[name]["tail"] and st[name]["rc"] is None
    assert st["tsc"]["status"] == "ok" and st["pytest-core"]["status"] == "ok"
    assert code == 1  # a refusal means the wave was not fully checked
    assert not any("playwright" in c["argv"] or "bundle:check" in c["argv"] for c in r.calls)


def test_nothing_is_refused_when_nothing_listens(tmp_path):
    assert go(tmp_path, listening=(8123,))[0] == 0


def test_only_the_live_port_is_probed_never_8778(tmp_path):
    probed = []
    fake = FakeRunner()
    fake.names = ["bundle", "playwright"]
    iw.main(["--report", str(tmp_path / "r.json"), "--only", "bundle,playwright"], runner=fake, probe=lambda p: probed.append(p) or False,
            lister=lambda: [], out=io.StringIO())
    assert set(probed) == {8777} and 8778 not in probed
    assert 8778 in iw.NEVER_TOUCH


# ------------------------------------------------------------------------------------------------- --dry-run
def test_dry_run_prints_commands_and_runs_nothing(tmp_path):
    out = io.StringIO()
    r = FakeRunner()
    report = tmp_path / "r.json"
    code = iw.main(["--dry-run", "--report", str(report), "--skip", "art"], runner=r, probe=lambda p: pytest.fail("probed"), out=out)
    text = out.getvalue()
    assert code == 0 and r.calls == [] and not report.exists()
    assert "[tsc]" in text and "[pytest-app]" in text and "[art]" not in text and "check_commits.py" in text
    assert "JARVIS_DATA_DIR" in text


# --------------------------------------------------------------------------------------------------- leftovers
H = 3600


def test_leftovers_lists_old_processes_with_age_and_port():
    rows_ = [
        {"pid": 10, "age_s": 5 * H, "cmd": "python -m jarvis_app.ww_sandbox --port 8790 --token x"},
        {"pid": 11, "age_s": 4 * H, "cmd": "node vite preview --port 5174"},
        {"pid": 12, "age_s": 3.5 * H, "cmd": "node playwright test e2e/a.spec.ts"},
        {"pid": 13, "age_s": 2 * H, "cmd": "python -m jarvis_app.ww_sandbox --port 8790"},       # too young
        {"pid": 14, "age_s": 9 * H, "cmd": "python -m jarvis_app.ww_sandbox --port 8791"},       # the kept sandbox
        {"pid": 15, "age_s": 9 * H, "cmd": "python JARVIS.pyw"},                                 # not a leftover pattern
        {"pid": 16, "age_s": 9 * H, "cmd": "powershell Get-CimInstance Win32_Process | ww_sandbox"},  # the lister itself
    ]
    found = iw.filter_leftovers(rows_, own_pid=999)
    assert [(f["pid"], f["age_h"], f["port"]) for f in found] == [(10, 5.0, 8790), (11, 4.0, 5174), (12, 3.5, None)]


def test_leftovers_step_never_fails_and_reports_them(tmp_path):
    lo = [{"pid": 10, "age_s": 5 * H, "cmd": "python -m jarvis_app.ww_sandbox --port 8790"}]
    code, _, report, _ = go(tmp_path, "--only", "leftovers", leftovers=lo)
    row = rows(report)["leftovers"]
    assert code == 0 and row["status"] == "ok" and row["leftovers"][0]["pid"] == 10
    assert "leftover pid 10 age 5.0 h port 8790" in report.with_suffix(".txt").read_text("utf-8")


def test_leftovers_lister_error_is_advice_not_a_failure(tmp_path):
    def boom():
        raise OSError("no powershell")
    report = tmp_path / "r.json"
    code = iw.main(["--only", "leftovers", "--report", str(report)], runner=FakeRunner(), probe=lambda p: False, lister=boom, out=io.StringIO())
    assert code == 0 and "could not list" in rows(report)["leftovers"]["tail"]


def test_leftovers_step_has_no_kill_in_the_source():
    src = (Path(iw.__file__)).read_text("utf-8")
    code_only = "\n".join(ln for ln in src.splitlines() if not ln.lstrip().startswith(("#", '"', "*")))
    for word in ("taskkill", ".kill(", "terminate(", "Stop-Process", "os.kill"):
        assert word not in code_only, word


def test_parse_port():
    assert iw.parse_port("x --port 8790 --token y") == 8790
    assert iw.parse_port("x --port=5174") == 5174
    assert iw.parse_port("vite preview localhost:4173") == 4173
    assert iw.parse_port("node playwright test") is None


def test_real_runner_reports_a_missing_program():
    rc, tail = iw.real_runner(["definitely-not-a-program-xyz"], iw.ROOT, {}, 5)
    assert rc == 127 and "could not start" in tail
