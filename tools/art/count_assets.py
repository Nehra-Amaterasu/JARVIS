"""Print the 8.7 counts from the assignment JSON, in the form Appendix C uses.

    python tools/art/count_assets.py                       print the Counts line and the meaning split
    python tools/art/count_assets.py --verify-spec FILE    exit 1 if the 'Counts:' line in FILE differs

The text of the specification is never hand-counted: this script is the only source of those numbers.
"""
from __future__ import annotations

import argparse
import re
import sys
from collections import Counter
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from assets import assignments_path, load_assignments, ordered  # noqa: E402


def counts_line(rows: list[dict]) -> str:
    def part(label: str, key: str, by_name: bool = False) -> str:
        return f"{label} " + ", ".join(f"{k} {n}" for k, n in ordered(Counter(r[key] for r in rows), by_name))
    return f"Counts: {part('sections', 'section', True)}. {part('Uses', 'use')}. {part('Tracks', 'track')}."


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--assignments")
    ap.add_argument("--verify-spec")
    a = ap.parse_args(argv)
    rows = load_assignments(assignments_path(a.assignments))
    line = counts_line(rows)
    meaning = Counter(r["meaning"] for r in rows)
    print(f"{len(rows)} pictures")
    print(line)
    print("Meaning " + ", ".join(f"{k} {n}" for k, n in ordered(meaning)) + ".")
    if a.verify_spec:
        text = Path(a.verify_spec).read_text(encoding="utf-8")
        m = re.search(r"^Counts: .*$", text, re.M)
        if not m:
            print("FAIL no 'Counts:' line in the spec")
            return 1
        if m.group(0).strip() != line:
            print("FAIL the spec's Counts line differs:\n  spec: " + m.group(0).strip() + "\n  json: " + line)
            return 1
        print("OK the spec's Counts line equals the JSON")
    return 0


if __name__ == "__main__":
    sys.exit(main())
