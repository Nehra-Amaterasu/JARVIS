"""Art id and catalogue id checks (docs/design/jarvis-product-overhaul.md 8.2, 8.5.3 item 2, 8.7).

    python tools/art/check_ids.py                      every `art.x.y` id in app/ui/src exists in the manifest
    python tools/art/check_ids.py --spec FILE --assignments JSON
                                                       no reference-only (refused) catalogue id in the spec's 7 and 8
    python tools/art/check_ids.py --ids-columns --assignments JSON
                                                       print each section's usable ids (id plus its one trait)

The product refers to art ids only; a catalogue id in source code is a leak of the private catalogue, so it
fails here too (the ids appear in tools/, docs/ and the private notes, never in app/ui/src).
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from assets import ROOT, assignments_path, load_assignments  # noqa: E402

ART_ID = re.compile(r"(?<![\w.-])art\.[a-z][a-z0-9-]*(?:\.[a-z][a-z0-9-]*)+(?![\w-])")
CAT_ID = re.compile(r"\bC0[1-4]-\d{2,3}\b")
SKIP_DIRS = {"node_modules", "dist", "dist-e2e", "generated", "private-local", "__tests__"}
FILE_EXT = re.compile(r"\.(?:png|svg|txt|webp)$")


def src_files(src: Path):
    for f in sorted(src.rglob("*")):
        if f.is_file() and f.suffix in (".ts", ".tsx", ".css") and not SKIP_DIRS & set(f.relative_to(src).parts) and ".test." not in f.name:
            yield f


def strip_comments(text: str) -> list[str]:
    """Lines with block comments and trailing // comments blanked, same line count. A catalogue id in a
    comment is provenance (the clay tokens name the swatch their value came from); in code it is a leak."""
    blank = re.sub(r"/\*.*?\*/", lambda m: re.sub(r"[^\n]", " ", m.group(0)), text, flags=re.S)
    return [re.sub(r"(^|\s)//.*$", "", ln) for ln in blank.splitlines()]


def check_source(src: Path, manifest: dict) -> list[str]:
    """Every art id named in app/ui/src is in the manifest; no catalogue id in app/ui/src."""
    known = set(manifest["art"])
    bad = []
    for f in src_files(src):
        text = f.read_text(encoding="utf-8", errors="replace")
        code = strip_comments(text)
        for i, line in enumerate(text.splitlines(), 1):
            for m in ART_ID.finditer(line):
                # a CSS or TS property path such as `art.kit.x` only counts when it looks like a full art id (3 parts)
                aid = FILE_EXT.sub("", m.group(0))   # a file name in a comment (art.x.y.png) names the id
                if aid.count(".") >= 2 and aid not in known:
                    bad.append(f"{f.relative_to(src).as_posix()}:{i}: art id {aid} is not in the manifest")
            for m in CAT_ID.finditer(code[i - 1]):
                bad.append(f"{f.relative_to(src).as_posix()}:{i}: catalogue id {m.group(0)} in shipped source (use an art id)")
    return bad


def section_text(spec: str, start: str, end: str) -> str:
    a = spec.index(start)
    return spec[a:spec.index(end, a)]


def check_spec(spec: str, rows: list[dict]) -> list[str]:
    """A.Q01: a refused id (track reference-only) appears nowhere in 7 or 8 except where it is named as refused
    ('Avoid', 'refuse', 'refusal', 'Do not reproduce')."""
    # the 25 recorded refusals: reference-only AND deck use "rejected directions". Swatches, mood boards and
    # technique samples are also reference-only but are legitimate ideas to name in 7 and 8.
    refused = {r["id"] for r in rows if r["track"] == "reference-only" and r.get("deck_use", "").startswith("rejected")}
    bad = []
    for start, end in (("## 7 ", "## 8 "), ("## 8 ", "## 9 ")):
        try:
            body = section_text(spec, start, end)
        except ValueError:
            continue
        for i, line in enumerate(body.splitlines(), 1):
            for m in CAT_ID.finditer(line):
                if m.group(0) in refused and not re.search(r"\b(avoid|refus\w*|rejected|blocks?|do not reproduce|never rendered)\b", line, re.I):
                    bad.append(f"section {start.strip()}, line {i}: refused id {m.group(0)} used as a source")
    return bad


def ids_columns(rows: list[dict]) -> dict[str, list[str]]:
    """Per section: `id (trait)` for every id the JSON gives a product use. Reference-only ids are left out."""
    out: dict[str, list[str]] = {}
    for r in rows:
        if r["track"] == "reference-only":
            continue
        out.setdefault(r["section"], []).append(f"{r['id']} ({r['purpose']})")
    return out


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--src", default=str(ROOT / "app/ui/src"))
    ap.add_argument("--manifest", default=str(ROOT / "app/ui/src/art/art-manifest.json"))
    ap.add_argument("--spec")
    ap.add_argument("--assignments")
    ap.add_argument("--ids-columns", action="store_true")
    a = ap.parse_args(argv)
    bad: list[str] = []
    if a.spec or a.ids_columns:
        rows = load_assignments(assignments_path(a.assignments))
        if a.spec:
            bad += check_spec(Path(a.spec).read_text(encoding="utf-8"), rows)
        if a.ids_columns:
            for sec, items in sorted(ids_columns(rows).items()):
                print(f"{sec}: " + "; ".join(items))
    else:
        bad += check_source(Path(a.src), json.loads(Path(a.manifest).read_text(encoding="utf-8")))
    for b in bad:
        print("FAIL", b)
    print(f"{len(bad)} problem(s)")
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())
