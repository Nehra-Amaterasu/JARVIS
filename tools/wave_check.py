"""Wave merge check (spec 15.6 rule 7, 20.14): packages of one wave must own disjoint files.

What it fails on:
  1. two packages of a wave own paths that can overlap (the owned-file table, 15.6.2);
  2. a package changed a file outside its own folders (one shared file is allowed: the research record, and the
     package's own gallery entry file, because every package adds exactly one entry under the N01-owned gallery);
  3. a package that must add a gallery entry has none.

A wave table is a JSON file (or one of the built-in WAVE_TABLES):
  { "wave": 5,
    "root": "app/ui/src",                      # optional: prefix of every owned path that does not start with a repo folder
    "shared": ["docs/research/product-design-overhaul.md"],
    "entry_dir": "app/ui/src/gallery/entries",
    "packages": [ { "id": "N01", "owns": ["gallery/**", "tools/wave_check.py"], "entry": false }, ... ] }
A path under "owns" is a repo-relative glob: "dir/**" is a whole folder, "*" matches inside one folder level, anything else is
literal. A package's entry file is any file in entry_dir named "<id lower>.tsx" or "<id lower>-<more>.tsx".

Usage:
  python tools/wave_check.py --wave 5                           # the owned-file table is disjoint, and every entry exists
  python tools/wave_check.py table.json --package G01 --base main   # what G01 changed since main stays inside G01
  python tools/wave_check.py --wave 5 --all --base main         # every package of the wave, each against its own branch name
  python tools/wave_check.py --self-test                        # two fixture tables (also: pytest tools/wave_check.py)
Lane, route and freeze checks (N03; spec 15.6.1 e and f, rule 8 and 9 of block C, decision D-V3-22):
  python tools/wave_check.py --board                  # the live wave comms board: lanes + routes + freeze (+ ownership clashes)
  python tools/wave_check.py --board b.json --lanes   # only the lane check, on another board file
  python tools/wave_check.py --wave 5 --exclude "**/package-lock.json" --package G01 --base main
A board row (pkg, lane, owns) is read as a package; a table package may carry "lane" and "kind": "fix" too.
Exit code 0 = clean, 1 = a finding, 2 = a bad table or call. Never writes anything.
"""
from __future__ import annotations

import argparse
import fnmatch
import json
import re
import os
import subprocess
import sys
from pathlib import Path
from typing import Iterable

# The wave 5 owned-file table (15.6.2), under app/ui/src unless the path starts with a repo folder. Kept in code so the
# integrator needs no file; a later wave adds its own entry here (or passes a JSON file).
_UI = "app/ui/"
WAVE_TABLES: dict[int, dict] = {
    5: {
        "wave": 5,
        "shared": ["docs/research/product-design-overhaul.md"],
        "entry_dir": _UI + "src/gallery/entries",
        "packages": [
            {"id": "N01", "entry": False, "owns": [_UI + "src/gallery/**", _UI + "e2e/bench/entry.tsx", _UI + "e2e/gallery.spec.ts", "tools/wave_check.py"]},
            {"id": "N02", "entry": False, "owns": [_UI + "src/shell/**", _UI + "src/ww/frame/**", _UI + "src/styles/shell.css", _UI + "e2e/shell*.spec.ts", _UI + "src/__tests__/shell/**"]},
            {"id": "G01", "entry": True, "owns": [_UI + "src/styles/design/clay/**", _UI + "src/shared/kit/**", _UI + "src/shared/lamp/**", _UI + "src/shared/planned/**", _UI + "src/__tests__/kit/**", _UI + "e2e/bench/known.ts", _UI + "e2e/bench.spec.ts"]},
            {"id": "G02", "entry": True, "owns": [_UI + "src/shared/grammar/**", _UI + "src/__tests__/grammar/**"]},
            {"id": "G03", "entry": True, "owns": ["tools/art/**", _UI + "src/art/**"]},
        ],
    }
}

_WILD = re.compile(r"[*?\[]")


def _norm(p: str) -> str:
    p = p.replace("\\", "/")
    return p[2:] if p.startswith("./") else p


def _literal_prefix(pattern: str) -> str:
    """The part of a pattern before its first wildcard. 'a/b/**' gives 'a/b/'; 'a/shell*.ts' gives 'a/shell'."""
    m = _WILD.search(pattern)
    return pattern if not m else pattern[: m.start()]


def matches(pattern: str, path: str) -> bool:
    """Does repo-relative path match the owned pattern? '**' crosses folders, '*' stays inside one level."""
    pattern, path = _norm(pattern), _norm(path)
    if pattern.endswith("/**"):
        return path.startswith(pattern[:-2])  # keeps the trailing slash: 'shared/kit/' never matches 'shared/kit-x/'
    rx = re.escape(pattern).replace(r"\*\*", ".*").replace(r"\*", "[^/]*").replace(r"\?", "[^/]")
    return re.fullmatch(rx, path) is not None


def may_overlap(a: str, b: str) -> bool:
    """Can some path match both patterns? Exact when either is literal; otherwise conservative on the literal prefixes
    (a false alarm costs a reviewer one look, a miss costs a broken merge)."""
    a, b = _norm(a), _norm(b)
    wa, wb = bool(_WILD.search(a)), bool(_WILD.search(b))
    if not wa:
        return matches(b, a)
    if not wb:
        return matches(a, b)
    pa, pb = _literal_prefix(a), _literal_prefix(b)
    return pa.startswith(pb) or pb.startswith(pa)


def load_table(src: str | Path | dict) -> dict:
    if isinstance(src, dict):
        table = src
    else:
        table = json.loads(Path(src).read_text(encoding="utf-8"))
    if not isinstance(table.get("packages"), list) or not table["packages"]:
        raise ValueError("a wave table needs a non-empty 'packages' list")
    ids = [p.get("id") for p in table["packages"]]
    if len(set(ids)) != len(ids) or not all(ids):
        raise ValueError("package ids must be present and unique")
    for p in table["packages"]:
        if not isinstance(p.get("owns"), list) or not p["owns"]:
            raise ValueError(f"package {p['id']} owns nothing")
    return table


def check_disjoint(table: dict) -> list[str]:
    """Rule 1: no two packages own overlapping paths."""
    out: list[str] = []
    pk = table["packages"]
    for i, p in enumerate(pk):
        for q in pk[i + 1:]:
            for a in p["owns"]:
                for b in q["owns"]:
                    if may_overlap(a, b):
                        out.append(f"{p['id']} owns '{a}' and {q['id']} owns '{b}': they can touch the same file")
    return out


def entry_name_ok(pkg_id: str, filename: str) -> bool:
    low = pkg_id.lower()
    stem = filename.rsplit(".", 1)[0] if "." in filename else filename
    return filename.endswith((".tsx", ".ts")) and (stem == low or stem.startswith(low + "-"))


def check_entries(table: dict, root: Path, packages: Iterable[str] | None = None) -> list[str]:
    """Rule 3: a package that adds components must ship a gallery entry file."""
    out: list[str] = []
    entry_dir = table.get("entry_dir")
    if not entry_dir:
        return out
    d = root / entry_dir
    have = sorted(f.name for f in d.glob("*")) if d.is_dir() else []
    for p in table["packages"]:
        if packages is not None and p["id"] not in set(packages):
            continue
        if not p.get("entry", True):
            continue
        if not any(entry_name_ok(p["id"], n) for n in have):
            out.append(f"{p['id']} has no gallery entry file in {entry_dir} (expected {p['id'].lower()}.tsx or {p['id'].lower()}-<name>.tsx)")
    return out


def check_changed(table: dict, pkg_id: str, files: Iterable[str], exclude: Iterable[str] = ()) -> list[str]:
    """Rule 2: every changed file is inside the package's folders, the shared record, or its own gallery entry.
    A file matching an exclusion glob (the table's "exclude" list plus the argument) is generated noise and never counts."""
    pkg = next((p for p in table["packages"] if p["id"] == pkg_id), None)
    if pkg is None:
        raise ValueError(f"no package {pkg_id} in the table")
    shared = [_norm(s) for s in table.get("shared", [])]
    entry_dir = _norm(table.get("entry_dir", "")).rstrip("/")
    skip = [_norm(g) for g in (*table.get("exclude", []), *exclude)]
    out: list[str] = []
    for f in map(_norm, files):
        if not f or any(matches(g, f) for g in skip):
            continue
        if any(matches(o, f) for o in pkg["owns"]) or f in shared:
            continue
        if pkg.get("entry", True) and entry_dir and f.startswith(entry_dir + "/") and entry_name_ok(pkg_id, f.rsplit("/", 1)[-1]):
            continue
        owner = next((q["id"] for q in table["packages"] if q["id"] != pkg_id and any(matches(o, f) for o in q["owns"])), None)
        out.append(f"{pkg_id} changed '{f}'" + (f", which {owner} owns" if owner else ", which no package of the wave owns"))
    return out


# ----------------------------------------------------------------------------------- lane check (rule 8)
# Engine folders a UI package never owns. 'tools/**' is a UI folder (spec 15.6 rule 8) except tools/engine/**, and a UI
# package may own .py files there (this tool is one), so the .py ban stops at tools/.
ENGINE_FOLDERS = ("app/jarvis_app/", "core/", "app/tests/", "tools/engine/")
UI_ROOT = "app/ui/"
UI_CODE_EXT = (".ts", ".tsx", ".css", ".json")
# The state file, the research files and the specification are appended to by every package and owned by none. The
# engine lane's own research file is the one exception (rule 8: it owns it).
SHARED_FILES = ("data/notes/NOW.md", "docs/design/jarvis-product-overhaul.md", "docs/research/*.md")
SHARED_EXEMPT = ("docs/research/well-wisher-engine.md",)


def check_lanes(table: dict) -> list[str]:
    """No UI package owns a .py path (outside tools/) or anything in an engine folder; no engine package owns a
    .ts, .tsx, .css or .json path under app/ui (a folder glob there counts: it would include them); no package owns
    a shared file. A package with no lane is checked for shared files only."""
    out: list[str] = []
    for p in table["packages"]:
        lane, pid = p.get("lane"), p.get("id") or p.get("pkg")
        for raw in p["owns"]:
            o = _norm(raw)
            if o not in SHARED_EXEMPT:
                hit = next((s for s in SHARED_FILES if may_overlap(o, s)), None)
                if hit:
                    out.append(f"{pid} owns '{o}', which covers the shared file {hit}: shared files are appended to, never owned")
            wild = bool(_WILD.search(o))
            if lane == "ui":
                if o.endswith(".py") and not (o.startswith("tools/") and not o.startswith("tools/engine/")):
                    out.append(f"{pid} (ui lane) owns the Python path '{o}'")
                    continue
                for f in ENGINE_FOLDERS:
                    # inside the folder, or a broad glob ('app/**') that would swallow it; tools/** is allowed by rule 8
                    if o.startswith(f) or (wild and f.startswith(_literal_prefix(o)) and not o.startswith("tools/")):
                        out.append(f"{pid} (ui lane) owns '{o}', in the engine folder {f}")
                        break
            elif lane == "engine":
                under_ui = o.startswith(UI_ROOT) or (wild and UI_ROOT.startswith(_literal_prefix(o)))
                if under_ui and (o.endswith(UI_CODE_EXT) or o.endswith("*") or "." not in o.rsplit("/", 1)[-1]):
                    out.append(f"{pid} (engine lane) owns '{o}', under app/ui where only the UI lane writes code")
    return out


# -------------------------------------------------------------------------------- route check (rule 9)
ENGINE_PLAN = "docs/design/well-wisher-engine-plan.md"
_ROUTE_RX = re.compile(r"""["'`](/api/[A-Za-z0-9_\-./{}:$]+)""")
_PLAN_RX = re.compile(r"(/api/[A-Za-z0-9_\-./{}:$*]+)")


def norm_route(route: str) -> str:
    """'/api/mission/q/${id}/x?y=1', '/api/mission/q/:id/x' and '/api/mission/q/{qid}/x' are one route."""
    route = route.split("?", 1)[0]
    route = re.sub(r"\$\{[^}]*\}", "{}", route)
    route = re.sub(r"\{[^}/]*\}", "{}", route)
    route = re.sub(r"/:[A-Za-z_]\w*", "/{}", route)
    return route.rstrip("/")


def plan_routes(plan_text: str) -> set[str]:
    """Routes the engine plan lists. Convention text ('/api/*', '/api/mission/...', '/api/phone/') is not an entry:
    a real route has at least three segments after the host and no wildcard or ellipsis."""
    found = set()
    for m in _PLAN_RX.finditer(plan_text):
        raw = m.group(1)
        r = raw.rstrip(".,;:)")
        if "*" in r or raw.endswith("..") or r.endswith("/") or r.count("/") < 3:
            continue
        found.add(norm_route(r))
    return found


def adapter_files(root: Path) -> list[Path]:
    base = root / "app" / "ui" / "src"
    if not base.is_dir():
        return []
    return sorted(f for d in base.rglob("adapters") if d.is_dir() for f in d.rglob("*")
                  if f.is_file() and f.suffix in (".ts", ".tsx", ".js", ".mjs"))


def check_routes(root: Path, plan: Path | None = None) -> list[str]:
    """Every route an adapter file under app/ui/src/**/adapters/ calls has an entry in the engine plan. No adapter
    files passes (the null-adapter days); adapters with the plan file missing is a finding."""
    files = adapter_files(root)
    if not files:
        return []
    plan = plan or root / ENGINE_PLAN
    if not plan.is_file():
        return [f"{ENGINE_PLAN} is missing, so no adapter route can be checked"]
    known = plan_routes(plan.read_text(encoding="utf-8"))
    out: set[str] = set()
    for f in files:
        for m in _ROUTE_RX.finditer(f.read_text(encoding="utf-8", errors="replace")):
            r = norm_route(m.group(1))
            if r not in known:
                out.add(f"{f.relative_to(root).as_posix()} calls {r}, which {ENGINE_PLAN} does not list")
    return sorted(out)


# ------------------------------------------------------------------------------------- freeze check (D-V3-22)
FREEZE_FOLDERS = ("app/ui/src/ww/study/**", "app/ui/src/ww/focus/**", "app/jarvis_app/ww_pyq/**")


def default_freeze_path() -> Path:
    """The owner's exam-season freeze is a private file in the main checkout's notes (data/ is git-ignored, so the lead
    time never reaches this public repository). JARVIS_EXAM_FREEZE overrides it; tests do. Existence turns it on."""
    env = os.environ.get("JARVIS_EXAM_FREEZE")
    if env:
        return Path(env)
    here = Path(__file__).resolve().parent
    try:
        common = subprocess.run(["git", "rev-parse", "--path-format=absolute", "--git-common-dir"], cwd=here,
                                capture_output=True, text=True, check=True).stdout.strip()
        root = Path(common).parent
    except (OSError, subprocess.CalledProcessError):
        root = here.parent
    return root / "data" / "notes" / "exam-freeze.json"


def is_fix(pkg: dict) -> bool:
    """Only bug fixes merge during the freeze: 'kind': 'fix', or a purpose or note that starts with fix or bug."""
    if pkg.get("kind") == "fix":
        return True
    return any(str(pkg.get(k) or "").strip().lower().startswith(("fix", "bug")) for k in ("purpose", "note"))


def check_freeze(table: dict, freeze_file: Path | None, changed: dict[str, list[str]] | None = None) -> list[str]:
    """While the freeze file exists a feature package owns and changes nothing in the frozen folders. An absent file
    means no freeze (the default, I34). `changed` maps a package id to its changed files, when they are known."""
    if freeze_file is None or not freeze_file.exists():
        return []
    out: list[str] = []
    for p in table["packages"]:
        pid = p.get("id") or p.get("pkg")
        if is_fix(p) or p.get("state") in ("merged", "dropped"):
            continue
        for o in p["owns"]:
            hit = next((fz for fz in FREEZE_FOLDERS if may_overlap(o, fz)), None)
            if hit:
                out.append(f"{pid} owns '{o}' in the frozen folder {hit} while the exam freeze is set (D-V3-22)")
        for f in (changed or {}).get(pid, []):
            if any(matches(fz, f) for fz in FREEZE_FOLDERS):
                out.append(f"{pid} changed '{f}' in a frozen folder while the exam freeze is set (D-V3-22)")
    return out


# --------------------------------------------------------------------------------------------- the board
def board_table(board: dict, wave: int | None = None) -> dict:
    """Read the wave comms board's active rows as a wave table (pkg becomes id; lane, state and purpose are kept)."""
    rows = [r for r in board.get("packages", []) if r.get("state") in ("planned", "building", "review", "blocked")
            and (wave is None or r.get("wave") == wave)]
    return {"wave": wave if wave is not None else "board", "shared": [], "packages": [
        {"id": r["pkg"], "lane": r.get("lane"), "state": r.get("state"), "purpose": r.get("purpose", ""),
         "note": r.get("note", ""), "kind": r.get("kind"), "owns": list(r["owns"])} for r in rows]}


def load_board(path: Path | None) -> dict:
    sys.path.insert(0, str(Path(__file__).resolve().parent))
    import wave_comms  # read only: the board tool is never edited or written from here
    return wave_comms.load(path or wave_comms.default_board_path())


def git_changed(base: str, repo: Path, head: str = "HEAD") -> list[str]:
    r = subprocess.run(["git", "-C", str(repo), "diff", "--name-only", f"{base}...{head}"], capture_output=True, text=True)
    if r.returncode != 0:
        raise RuntimeError(r.stderr.strip() or "git diff failed")
    return [ln for ln in r.stdout.splitlines() if ln.strip()]


# --------------------------------------------------------------------------------------------------- self-test
_GOOD = {
    "wave": 0, "shared": ["docs/r.md"], "entry_dir": "ui/gallery/entries",
    "packages": [
        {"id": "A1", "entry": False, "owns": ["ui/gallery/**", "tools/x.py"]},
        {"id": "B1", "owns": ["ui/kit/**", "ui/e2e/shell*.spec.ts"]},
        {"id": "C1", "owns": ["ui/kit-extra/**", "ui/e2e/study*.spec.ts"]},
    ],
}
_BAD = {
    "wave": 0, "entry_dir": "ui/gallery/entries",
    "packages": [
        {"id": "A1", "entry": False, "owns": ["ui/kit/**"]},
        {"id": "B1", "owns": ["ui/kit/Button.tsx"]},
        {"id": "C1", "owns": ["ui/e2e/shell*.spec.ts"]},
        {"id": "D1", "owns": ["ui/e2e/shell-v2.spec.ts"]},
    ],
}


def test_disjoint_table_is_clean():
    assert check_disjoint(_GOOD) == []  # 'kit/' and 'kit-extra/' are different folders; shell* and study* differ


def test_overlapping_table_fails():
    found = check_disjoint(_BAD)
    assert any("A1" in f and "B1" in f for f in found)  # folder against a file inside it
    assert any("C1" in f and "D1" in f for f in found)  # a wildcard against the file it matches
    assert len(found) == 2


def test_changed_file_outside_folders_fails():
    ok = ["ui/kit/Button.tsx", "docs/r.md", "ui/gallery/entries/b1-kit.tsx"]
    assert check_changed(_GOOD, "B1", ok) == []
    bad = check_changed(_GOOD, "B1", ["ui/kit/Button.tsx", "ui/kit-extra/x.ts", "ui/gallery/entries/c1.tsx", "ui/other.ts"])
    assert len(bad) == 3 and "C1 owns" in bad[0] and "no package" in bad[2]


def test_entry_file_required(tmp_path):
    (tmp_path / "ui/gallery/entries").mkdir(parents=True)
    assert any("B1" in f for f in check_entries(_GOOD, tmp_path))  # B1 and C1 have none
    (tmp_path / "ui/gallery/entries/b1-kit.tsx").write_text("")
    (tmp_path / "ui/gallery/entries/c1.tsx").write_text("")
    assert check_entries(_GOOD, tmp_path) == []
    (tmp_path / "ui/gallery/entries/c1.tsx").unlink()
    (tmp_path / "ui/gallery/entries/c10.tsx").write_text("")  # c10 is not c1
    assert [f for f in check_entries(_GOOD, tmp_path) if f.startswith("C1")]


def test_wave5_table_is_disjoint():
    assert check_disjoint(WAVE_TABLES[5]) == []


def test_bad_table_is_refused():
    for bad in ({"packages": []}, {"packages": [{"id": "A", "owns": []}]}, {"packages": [{"id": "A", "owns": ["x"]}, {"id": "A", "owns": ["y"]}]}):
        try:
            load_table(bad)
        except ValueError:
            continue
        raise AssertionError("a bad table was accepted")


def self_test() -> int:
    import tempfile
    failed = 0
    for name, fn in sorted((k, v) for k, v in globals().items() if k.startswith("test_") and callable(v)):
        try:
            if "tmp_path" in fn.__code__.co_varnames[: fn.__code__.co_argcount]:
                with tempfile.TemporaryDirectory() as t:
                    fn(Path(t))
            else:
                fn()
            print(f"ok   {name}")
        except AssertionError as e:
            failed += 1
            print(f"FAIL {name}: {e}")
    return 1 if failed else 0


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("table", nargs="?", help="wave table JSON (or use --wave)")
    ap.add_argument("--wave", type=int, help="a built-in wave table")
    ap.add_argument("--package", help="check what this package changed")
    ap.add_argument("--all", action="store_true", help="with --branch-prefix: check every package's branch")
    ap.add_argument("--branch-prefix", default="overhaul/", help="branch of package ID is <prefix><id lower> (default overhaul/)")
    ap.add_argument("--base", default="main", help="the ref the package branch started from")
    ap.add_argument("--head", default="HEAD", help="the package's branch (default HEAD)")
    ap.add_argument("--files", help="a text file of changed paths instead of git")
    ap.add_argument("--repo", default=".", help="repo root (default .)")
    ap.add_argument("--no-entry", action="store_true", help="skip the entry-file rule")
    ap.add_argument("--board", nargs="?", const="", default=None, metavar="FILE",
                    help="read packages from the wave comms board (no FILE: the live board); runs the three new checks unless some are named")
    ap.add_argument("--board-wave", type=int, help="with --board: only this wave's active rows")
    ap.add_argument("--lanes", action="store_true", help="the lane check (rule 8)")
    ap.add_argument("--routes", action="store_true", help="the route check (rule 9)")
    ap.add_argument("--freeze", action="store_true", help="the exam-season freeze check (D-V3-22)")
    ap.add_argument("--freeze-file", help="the private freeze file (default: data/notes/exam-freeze.json of the main checkout)")
    ap.add_argument("--plan", help="the engine plan file the route check reads (default: docs/design/well-wisher-engine-plan.md)")
    ap.add_argument("--exclude", action="append", default=[], metavar="GLOB", help="changed files matching this glob never count (repeatable)")
    ap.add_argument("--self-test", action="store_true")
    a = ap.parse_args(argv)
    if a.self_test:
        return self_test()
    try:
        if a.board is not None:
            data = load_board(Path(a.board) if a.board else None)
            table = board_table(data, a.board_wave)  # an empty board is a clean pass here, not a bad table
            if not (a.lanes or a.routes or a.freeze):
                a.lanes = a.routes = a.freeze = True
            sys.path.insert(0, str(Path(__file__).resolve().parent))
            import wave_comms
            findings = sorted({f"{p['pkg']}: {c}" for p in data["packages"] if p["state"] in wave_comms.ACTIVE
                               for c in wave_comms.clashes(data, p["pkg"], p["owns"])})
        elif a.wave is not None:
            table = load_table(WAVE_TABLES[a.wave])
            findings = check_disjoint(table)
        elif a.table:
            table = load_table(a.table)
            findings = check_disjoint(table)
        else:
            ap.error("give a table file, --wave N or --board")
        repo = Path(a.repo).resolve()
        if a.lanes:
            findings += check_lanes(table)
        if a.routes:
            findings += check_routes(repo, Path(a.plan) if a.plan else None)
        changed: dict[str, list[str]] = {}
        if a.package:
            files = Path(a.files).read_text(encoding="utf-8").splitlines() if a.files else git_changed(a.base, repo, a.head)
            changed[a.package] = files
        if a.freeze:
            findings += check_freeze(table, Path(a.freeze_file) if a.freeze_file else default_freeze_path(), changed)
        if a.package:
            findings += check_changed(table, a.package, files, a.exclude)
            if not a.no_entry:
                findings += check_entries(table, repo, [a.package])
        elif a.all:
            for p in table["packages"]:
                head = f"{a.branch_prefix}{p['id'].lower()}"
                findings += check_changed(table, p["id"], git_changed(a.base, repo, head), a.exclude)
            if not a.no_entry:
                findings += check_entries(table, repo)
        elif a.board is None and not a.no_entry and (repo / table.get("entry_dir", "\0")).is_dir():
            findings += check_entries(table, repo)
    except (ValueError, KeyError, RuntimeError, OSError) as e:
        print(f"wave_check: {e}", file=sys.stderr)
        return 2
    for f in findings:
        print(f"FAIL {f}")
    print(f"wave {table.get('wave', '?')}: {len(table['packages'])} packages, {len(findings)} findings")
    return 1 if findings else 0


if __name__ == "__main__":
    sys.exit(main())
