"""Shared reader for asset-assignments.json (docs/design/jarvis-product-overhaul.md 8.7).

The JSON lives in the git-ignored private folder (it is the owner's catalogue), so every script takes a
path: --assignments, or ART_ASSIGNMENTS, or the default private location below. Nothing here copies it.
"""
from __future__ import annotations

import json
import os
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
DEFAULT = "data/notes/design-taste/2026-11-12-well-wisher-overhaul/catalogue/asset-assignments.json"
REQUIRED = ("id", "section", "use", "track", "meaning", "contrast_treatment", "alt_text", "purpose")


def assignments_path(arg: str | None = None) -> Path:
    return Path(arg or os.environ.get("ART_ASSIGNMENTS") or ROOT / DEFAULT)


def load_assignments(path: Path) -> list[dict]:
    if not path.is_file():
        raise SystemExit(f"no assignments file at {path}: pass --assignments or set ART_ASSIGNMENTS (the file is private and git-ignored)")
    rows = json.loads(path.read_text(encoding="utf-8"))
    ids = [r["id"] for r in rows]
    if len(set(ids)) != len(ids):
        raise SystemExit("duplicate catalogue id in the assignments")
    for r in rows:
        miss = [k for k in REQUIRED if k not in r]
        if miss:
            raise SystemExit(f"{r.get('id')}: missing field(s) {miss}")
    return rows


def ordered(c: Counter, by_name: bool = False) -> list[tuple[str, int]]:
    """Appendix C lists sections by name and uses and tracks by count, ties by name."""
    return sorted(c.items(), key=(lambda kv: kv[0]) if by_name else (lambda kv: (-kv[1], kv[0])))
