"""One command the integrator runs after a merge: every check of the wave merge test, one report.

    python tools/integrate_wave.py                          # all steps, report in the system temp folder
    python tools/integrate_wave.py --only tsc,vitest        # 'vitest' means vitest-1 and vitest-2
    python tools/integrate_wave.py --skip playwright,art
    python tools/integrate_wave.py --specs e2e/core-v2.spec.ts e2e/gallery.spec.ts   # Playwright on these only
    python tools/integrate_wave.py --dry-run                # print the commands, run nothing
    python tools/integrate_wave.py --report C:/tmp/r.json   # JSON here, the text table beside it as r.txt

Why it exists: a wave merge on 14 Nov took six separate commands and a long outage cost the results of the ones
already done. Here each step has its own real exit code and time, the run continues after a failure, and the report
(JSON plus a short text table) is rewritten after EVERY step, so an outage leaves a usable report and the next run
can start from the steps that never finished.

Safety, all enforced in code:
  * the report goes to the system temp folder by default and is refused inside the repository (so never under data/
    and never a tracked path);
  * pytest steps run with JARVIS_DATA_DIR and AANKHEN_DATA_DIR pointing at fresh scratch folders, never data/;
  * ports 8777 and 8778 are never contacted except for one connect probe on 8777; the steps that build or serve the UI
    (bundle, playwright, art) are refused while something listens on 8777 (the running app serves app/ui/dist);
    bundle:check and Playwright write to dist-e2e, never dist;
  * the last step only LISTS leftovers (ww_sandbox, "vite preview", playwright processes older than 3 hours, with age
    and port); it never kills anything and never lists the sandbox on port 8791.
Exit code: 0 when every step that ran passed, 1 when any failed or was refused, 2 for a bad call.
Standard library only; the runner, the port probe and the process lister are injected in the tests.
"""
from __future__ import annotations

import argparse
import json
import os
import re
import shutil
import socket
import subprocess
import sys
import tempfile
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Callable, Sequence, TextIO

ROOT = Path(__file__).resolve().parents[1]
LIVE_PORT = 8777           # the running app: serves app/ui/dist and holds the ESP32's serial port
NEVER_TOUCH = (8777, 8778)
SANDBOX_KEEP_PORT = 8791   # the long-lived sandbox of the owner's session; never a leftover
LEFTOVER_AGE_S = 3 * 3600  # an agent run is under 3 hours; older ones belong to a finished agent
LEFTOVER_PATTERNS = ("ww_sandbox", "vite preview", "playwright")
TAIL_CHARS = 3000          # enough for a failing test's summary, small enough to keep the report readable
TIMEOUT_S = {"playwright": 3600.0, "bundle": 900.0}
DEFAULT_TIMEOUT_S = 1800.0

Runner = Callable[[Sequence[str], Path, dict, float], "tuple[int, str]"]
PortProbe = Callable[[int], bool]
Lister = Callable[[], "list[dict]"]


@dataclass
class Step:
    name: str
    argv: list[str] = field(default_factory=list)
    cwd: Path = ROOT
    guarded: bool = False   # refused while something listens on 8777
    internal: bool = False  # not a command: the leftovers listing


def _which(name: str) -> str:
    return shutil.which(name) or name  # npx is npx.cmd on Windows


def build_steps(root: Path, python: str, specs: Sequence[str] = ()) -> list[Step]:
    ui, app = root / "app" / "ui", root / "app"
    pw = [_which("npx"), "playwright", "test", *specs]
    pytest = lambda *paths: [python, "-m", "pytest", *paths, "-q"]  # noqa: E731
    return [
        Step("tsc", [_which("npx"), "tsc", "-b"], ui),
        Step("vitest-1", [_which("npx"), "vitest", "run"], ui),
        Step("vitest-2", [_which("npx"), "vitest", "run"], ui),  # twice: one flake in five runs on 14 Nov (9.8 s vs 2 s)
        Step("springs", [_which("npm"), "run", "springs:check"], ui),
        Step("bundle", [_which("npm"), "run", "bundle:check"], ui, guarded=True),
        Step("wave-check", [python, "tools/wave_check.py", "--board", "--repo", str(root)], root),
        Step("playwright", pw, ui, guarded=True),
        Step("art", pytest("tools/art/tests"), root, guarded=True),
        Step("pytest-tools", pytest("tools/tests"), root),
        Step("pytest-root", pytest("tests"), root),
        Step("pytest-core", pytest("core/tests"), root),
        Step("pytest-app", pytest("tests"), app),
        Step("commits", [python, "tests/check_commits.py", "origin/main..HEAD"], root),
        Step("leftovers", [], root, internal=True),
    ]


def select(steps: list[Step], only: Sequence[str], skip: Sequence[str]) -> tuple[list[Step], list[Step]]:
    """(to run, not run). A token matches a step by name or as the prefix of 'name-N' ('vitest' = vitest-1, vitest-2)."""
    def hit(step: Step, tokens: Sequence[str]) -> bool:
        return any(step.name == t or step.name.startswith(t + "-") for t in tokens)
    names = {s.name for s in steps}
    for t in (*only, *skip):
        if not any(n == t or n.startswith(t + "-") for n in names):
            raise ValueError(f"no step named '{t}' (steps: {', '.join(s.name for s in steps)})")
    run = [s for s in steps if (not only or hit(s, only)) and not hit(s, skip)]
    return run, [s for s in steps if s not in run]


# ----------------------------------------------------------------------------------------- real runner and probes
def real_runner(argv: Sequence[str], cwd: Path, env: dict, timeout: float) -> tuple[int, str]:
    try:
        r = subprocess.run(list(argv), cwd=cwd, env=env, capture_output=True, text=True, encoding="utf-8",
                           errors="replace", timeout=timeout, stdin=subprocess.DEVNULL)
        return r.returncode, (r.stdout or "") + (r.stderr or "")
    except subprocess.TimeoutExpired:
        return 124, f"timed out after {timeout:.0f} s"
    except OSError as e:
        return 127, f"could not start {argv[0]}: {e}"


def real_probe(port: int) -> bool:
    """Is something listening? One connect to loopback, no request sent."""
    try:
        with socket.create_connection(("127.0.0.1", port), timeout=0.3):
            return True
    except OSError:
        return False


_PORT_RX = re.compile(r"(?:--port[ =]|\s-p\s|--port\s+|:)(\d{4,5})\b")


def parse_port(cmd: str) -> int | None:
    m = _PORT_RX.search(cmd)
    return int(m.group(1)) if m else None


def filter_leftovers(rows: Sequence[dict], own_pid: int | None = None) -> list[dict]:
    """rows: {pid, age_s, cmd}. Keep the old agent processes; drop the sandbox on 8791, the lister itself and us."""
    out = []
    for r in rows:
        cmd = str(r.get("cmd") or "")
        low = cmd.lower()
        if r.get("age_s", 0) < LEFTOVER_AGE_S or r.get("pid") == own_pid:
            continue
        if not any(p in low for p in LEFTOVER_PATTERNS) or "get-ciminstance" in low or "ps -eo" in low:
            continue
        port = parse_port(cmd)
        if port == SANDBOX_KEEP_PORT:
            continue
        out.append({"pid": r["pid"], "age_h": round(r["age_s"] / 3600, 1), "port": port, "cmd": cmd[:160]})
    return out


def real_lister() -> list[dict]:
    if sys.platform == "win32":
        ps = ("$p = @(Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -match 'ww_sandbox|vite preview|playwright' } | "
              "ForEach-Object { [pscustomobject]@{pid=[int]$_.ProcessId; age_s=[int]((Get-Date)-$_.CreationDate).TotalSeconds; cmd=$_.CommandLine} }); "
              "ConvertTo-Json -Compress -InputObject $p")
        r = subprocess.run(["powershell", "-NoProfile", "-NonInteractive", "-Command", ps], capture_output=True, text=True,
                           encoding="utf-8", errors="replace", timeout=60, stdin=subprocess.DEVNULL)
        data = json.loads(r.stdout.strip() or "[]")
        return data if isinstance(data, list) else [data]
    r = subprocess.run(["ps", "-eo", "pid=,etimes=,args="], capture_output=True, text=True, timeout=30)
    rows = []
    for ln in r.stdout.splitlines():
        parts = ln.strip().split(None, 2)
        if len(parts) == 3 and parts[0].isdigit() and parts[1].isdigit():
            rows.append({"pid": int(parts[0]), "age_s": int(parts[1]), "cmd": parts[2]})
    return rows


# ----------------------------------------------------------------------------------------------------- the report
def text_table(report: dict) -> str:
    rows = report["steps"]
    w = max([4] + [len(r["name"]) for r in rows])
    out = [f"integrate_wave: {report['finished'] and 'finished' or 'running'}  started {report['started']}  "
           f"{sum(1 for r in rows if r['status'] in ('ok', 'failed', 'refused'))} of {len(rows)} steps done",
           f"{'step'.ljust(w)}  {'status':8}  {'rc':>4}  {'seconds':>8}"]
    for r in rows:
        rc = "-" if r["rc"] is None else str(r["rc"])
        out.append(f"{r['name'].ljust(w)}  {r['status']:8}  {rc:>4}  {r['seconds']:>8.1f}")
    bad = [r["name"] for r in rows if r["status"] in ("failed", "refused")]
    out.append("FAILED: " + (", ".join(bad) if bad else "none"))
    for r in rows:
        if r["status"] in ("failed", "refused") and r.get("tail"):
            out.append(f"--- {r['name']} (last output)\n{r['tail'].strip()[-600:]}")
        if r["name"] == "leftovers" and r.get("leftovers"):
            for lo in r["leftovers"]:
                out.append(f"leftover pid {lo['pid']} age {lo['age_h']} h port {lo['port']}: {lo['cmd']}")
    return "\n".join(out) + "\n"


def write_report(path: Path, report: dict) -> None:
    """Atomic: the previous report stays whole if the machine dies mid-write."""
    path.parent.mkdir(parents=True, exist_ok=True)
    for target, text in ((path, json.dumps(report, indent=1, ensure_ascii=False) + "\n"), (path.with_suffix(".txt"), text_table(report))):
        tmp = target.with_name(target.name + ".tmp")
        tmp.write_text(text, encoding="utf-8")
        for attempt in range(20):  # a viewer may hold the file open on Windows
            try:
                os.replace(tmp, target)
                break
            except PermissionError:
                if attempt == 19:
                    raise
                time.sleep(0.05)


def default_report_path(now: float | None = None) -> Path:
    return Path(tempfile.gettempdir()) / "jarvis-integrate" / time.strftime("report-%Y%m%d-%H%M%S.json", time.localtime(now))


def inside(path: Path, folder: Path) -> bool:
    try:
        path.resolve().relative_to(folder.resolve())
        return True
    except ValueError:
        return False


# ------------------------------------------------------------------------------------------------------- the run
def run_steps(steps: list[Step], not_run: list[Step], env: dict, report_path: Path, *, runner: Runner, probe: PortProbe,
              lister: Lister, clock: Callable[[], float] = time.monotonic, out: TextIO = sys.stdout) -> dict:
    report = {"started": time.strftime("%Y-%m-%d %H:%M:%S"), "finished": False, "root": str(ROOT), "steps": [
        {"name": s.name, "status": "pending", "rc": None, "seconds": 0.0, "command": " ".join(s.argv) or "(list leftover processes)"}
        for s in [*steps, *not_run]]}
    for r in report["steps"]:
        if r["name"] in {s.name for s in not_run}:
            r["status"] = "skipped"
    by_name = {r["name"]: r for r in report["steps"]}
    write_report(report_path, report)
    for s in steps:
        row = by_name[s.name]
        t0 = clock()
        if s.guarded and probe(LIVE_PORT):
            row.update(status="refused", tail=f"something listens on {LIVE_PORT} (the running app); this step builds or serves the UI, so it was not run")
        elif s.internal:
            try:
                found = filter_leftovers(lister(), os.getpid())
                row.update(status="ok", rc=0, leftovers=found, tail=f"{len(found)} leftover process(es) older than 3 h; none was touched")
            except (OSError, ValueError, subprocess.SubprocessError) as e:  # listing is advice, never a gate
                row.update(status="ok", rc=0, leftovers=[], tail=f"could not list processes: {e}")
        else:
            rc, tail = runner(s.argv, s.cwd, env, TIMEOUT_S.get(s.name, DEFAULT_TIMEOUT_S))
            row.update(status="ok" if rc == 0 else "failed", rc=rc, tail=tail[-TAIL_CHARS:])
        row["seconds"] = round(clock() - t0, 2)
        print(f"{s.name:14} {row['status']:8} rc={row['rc']} {row['seconds']}s", file=out, flush=True)
        write_report(report_path, report)  # after EVERY step: an outage leaves everything done so far
    report["finished"] = True
    write_report(report_path, report)
    return report


def _tokens(values: Sequence[str]) -> list[str]:
    return [t.strip() for v in values for t in v.split(",") if t.strip()]


def main(argv: Sequence[str] | None = None, *, runner: Runner | None = None, probe: PortProbe | None = None,
         lister: Lister | None = None, root: Path = ROOT, clock: Callable[[], float] = time.monotonic,
         out: TextIO | None = None) -> int:
    out = out or sys.stdout
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--only", action="append", default=[], help="run only these steps (comma list; repeatable)")
    ap.add_argument("--skip", action="append", default=[], help="do not run these steps")
    ap.add_argument("--specs", nargs="+", default=[], metavar="SPEC", help="Playwright specs (relative to app/ui) instead of the whole suite")
    ap.add_argument("--report", type=Path, default=None, help="JSON report path (the text table is written beside it)")
    ap.add_argument("--dry-run", action="store_true", help="print the commands and exit")
    ap.add_argument("--python", default=sys.executable, help="interpreter for the Python steps (default: this one)")
    a = ap.parse_args(argv)
    try:
        steps, not_run = select(build_steps(root, a.python, a.specs), _tokens(a.only), _tokens(a.skip))
    except ValueError as e:
        print(f"integrate_wave: {e}", file=sys.stderr)
        return 2
    if a.dry_run:
        for s in steps:
            print(f"[{s.name}] (cwd {s.cwd.relative_to(root) if s.cwd != root else '.'}) " + (" ".join(s.argv) or "list processes older than 3 h; never kills"), file=out)
        print(f"data dirs: JARVIS_DATA_DIR and AANKHEN_DATA_DIR -> fresh folders under {tempfile.gettempdir()}", file=out)
        return 0
    report_path = (a.report or default_report_path()).resolve()
    if inside(report_path, root):
        print(f"integrate_wave: refusing to write the report inside the repository ({report_path}); use a temp path", file=sys.stderr)
        return 2
    scratch = Path(tempfile.mkdtemp(prefix="jarvis-integrate-data-"))
    try:
        env = dict(os.environ, JARVIS_DATA_DIR=str(scratch / "data"), AANKHEN_DATA_DIR=str(scratch / "aankhen"))
        for k in ("JARVIS_DATA_DIR", "AANKHEN_DATA_DIR"):
            Path(env[k]).mkdir(parents=True, exist_ok=True)
        report = run_steps(steps, not_run, env, report_path, runner=runner or real_runner, probe=probe or real_probe,
                           lister=lister or real_lister, clock=clock, out=out)
    finally:
        shutil.rmtree(scratch, ignore_errors=True)
    bad = [r["name"] for r in report["steps"] if r["status"] in ("failed", "refused")]
    print(f"report: {report_path}  failed: {', '.join(bad) or 'none'}", file=out)
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())
