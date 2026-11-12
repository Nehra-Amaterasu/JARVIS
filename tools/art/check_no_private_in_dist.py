"""Fail if any private-track picture, or anything derived from one, is inside a dist that leaves the machine
(docs/design/jarvis-product-overhaul.md 8.6.2, gate row).

    python tools/art/check_no_private_in_dist.py DIST [DIST ...]

The private hash list is data/design-assets/private/private-hashes.json (written by build_art.py --private)
plus every file in data/design-assets/private and app/ui/src/art/private-local, which are hashed here. A file
leaks when (1) its sha256 equals a private file's, or (2) a private file of at most 256 KB appears inside a
bundle as raw bytes or as base64 (Vite inlines assets under 4 KB into JS and CSS as data URIs, so a hash of
the file alone would miss them). Cost is O(private bytes x dist bytes) in the worst case; with a few dozen
small private files and a dist of a few MB that is well under a second (measured in the test).
No private files present means nothing to leak: the script says so and exits 0.
"""
from __future__ import annotations

import base64
import hashlib
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
MAX_NEEDLE = 256 * 1024
MIN_NEEDLE = 16          # a needle shorter than this matches by accident


def private_files(root: Path) -> list[Path]:
    out: list[Path] = []
    for d in (root / "data/design-assets/private", root / "app/ui/src/art/private-local", root / "data/design-assets/source"):
        if d.is_dir():
            out += [f for f in sorted(d.rglob("*")) if f.is_file() and f.name != "private-hashes.json"]
    return out


def private_hashes(root: Path) -> dict[str, str]:
    """sha256 -> a label that never contains pixel data (the art id or file name)."""
    h: dict[str, str] = {}
    lst = root / "data/design-assets/private/private-hashes.json"
    if lst.is_file():
        for aid, row in json.loads(lst.read_text(encoding="utf-8")).items():
            h[row["sha256"]] = aid
            h[row["source_sha256"]] = f"{aid} (source)"
    for f in private_files(root):
        h[hashlib.sha256(f.read_bytes()).hexdigest()] = f.name
    return h


def scan(dists: list[Path], root: Path = ROOT) -> list[str]:
    hashes = private_hashes(root)
    needles: list[tuple[str, bytes, bytes]] = []
    for f in private_files(root):
        b = f.read_bytes()
        if MIN_NEEDLE <= len(b) <= MAX_NEEDLE:
            needles.append((f.name, b, base64.b64encode(b).rstrip(b"=")))
    bad: list[str] = []
    for d in dists:
        if not d.is_dir():
            bad.append(f"{d}: not a folder")
            continue
        for f in sorted(d.rglob("*")):
            if not f.is_file():
                continue
            data = f.read_bytes()
            sha = hashlib.sha256(data).hexdigest()
            rel = f.relative_to(d).as_posix()
            if sha in hashes:
                bad.append(f"{d.name}/{rel}: is the private file {hashes[sha]}")
                continue
            for name, raw, b64 in needles:
                if len(data) >= len(raw) and (raw in data or b64 in data):
                    bad.append(f"{d.name}/{rel}: contains the private file {name} ({'raw' if raw in data else 'base64'})")
                    break
    return bad


def main(argv: list[str] | None = None) -> int:
    args = sys.argv[1:] if argv is None else argv
    if not args:
        print("usage: check_no_private_in_dist.py DIST [DIST ...]")
        return 2
    n = len(private_hashes(ROOT))
    bad = scan([Path(a) for a in args])
    for b in bad:
        print("FAIL", b)
    print(f"{n} private hash(es) checked against {len(args)} dist folder(s), {len(bad)} leak(s)" if n else "no private files on this machine: nothing can leak")
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())
