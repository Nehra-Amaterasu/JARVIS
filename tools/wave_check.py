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
Exit code 0 = clean, 1 = a finding, 2 = a bad table or call. Never writes anything.
"""
from __future__ import annotations

import argparse
import fnmatch
import json
import re
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


def check_changed(table: dict, pkg_id: str, files: Iterable[str]) -> list[str]:
    """Rule 2: every changed file is inside the package's folders, the shared record, or its own gallery entry."""
    pkg = next((p for p in table["packages"] if p["id"] == pkg_id), None)
    if pkg is None:
        raise ValueError(f"no package {pkg_id} in the table")
    shared = [_norm(s) for s in table.get("shared", [])]
    entry_dir = _norm(table.get("entry_dir", "")).rstrip("/")
    out: list[str] = []
    for f in map(_norm, files):
        if not f:
            continue
        if any(matches(o, f) for o in pkg["owns"]) or f in shared:
            continue
        if pkg.get("entry", True) and entry_dir and f.startswith(entry_dir + "/") and entry_name_ok(pkg_id, f.rsplit("/", 1)[-1]):
            continue
        owner = next((q["id"] for q in table["packages"] if q["id"] != pkg_id and any(matches(o, f) for o in q["owns"])), None)
        out.append(f"{pkg_id} changed '{f}'" + (f", which {owner} owns" if owner else ", which no package of the wave owns"))
    return out


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
    ap.add_argument("--self-test", action="store_true")
    a = ap.parse_args(argv)
    if a.self_test:
        return self_test()
    try:
        if a.wave is not None:
            table = load_table(WAVE_TABLES[a.wave])
        elif a.table:
            table = load_table(a.table)
        else:
            ap.error("give a table file or --wave N")
        repo = Path(a.repo).resolve()
        findings = check_disjoint(table)
        if a.package:
            files = Path(a.files).read_text(encoding="utf-8").splitlines() if a.files else git_changed(a.base, repo, a.head)
            findings += check_changed(table, a.package, files)
            if not a.no_entry:
                findings += check_entries(table, repo, [a.package])
        elif a.all:
            for p in table["packages"]:
                head = f"{a.branch_prefix}{p['id'].lower()}"
                findings += check_changed(table, p["id"], git_changed(a.base, repo, head))
            if not a.no_entry:
                findings += check_entries(table, repo)
        elif not a.no_entry and (repo / table.get("entry_dir", "\0")).is_dir():
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
