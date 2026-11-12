"""Trace a sigil primitive from a catalogue picture into a small SVG (docs/design/jarvis-product-overhaul.md 20.4.1).

    python tools/art/trace_sigil.py --id C01-18 --out data/design-assets/private [--frac X0 Y0 X1 Y1]
                                    [--threshold 0.5] [--ink dark|light|auto] [--data-root C:/Projects/JARVIS]

Crop by bounding box (fractions of the catalogue crop), threshold to a bi-level mask, marching squares on the
lightly blurred mask, Ramer-Douglas-Peucker at 0.8 px, and at most 60 segments per shape (a shape that is
still over 60 gets a doubled epsilon until it fits, so the cap is a hard guarantee and the loss is visible in
the printed epsilon). Output is `sigil-<id>.svg` in --out, stroke `currentColor`, 1.5 px non-scaling.

The output is derived from a third-party picture, so it is written only to the git-ignored private folder:
the script refuses an --out that is inside tools/ or app/ (the one tracked place a sigil may end up is a
hand redraw in tools/art/own, made by a person, 20.4.1). Nothing here is shown in the app by id: a sigil
traced here is a private-track file named by catalogue id.
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageFilter

sys.path.insert(0, str(Path(__file__).resolve().parent))
import artlib as A  # noqa: E402
import build_art as B  # noqa: E402

MAX_SEGMENTS = 60
EPS = 0.8
MAX_SIDE = 256            # tracing happens at most this wide; a sigil is a 16 to 48 px object, more is wasted detail
MIN_LENGTH = 8.0          # a speck shorter than this (in traced pixels) is not a shape


def _length(pts: list[tuple[float, float]]) -> float:
    return float(sum(np.hypot(b[0] - a[0], b[1] - a[1]) for a, b in zip(pts, pts[1:])))


def fit(pts: list[tuple[float, float]], eps: float = EPS, cap: int = MAX_SEGMENTS) -> tuple[list[tuple[float, float]], float]:
    """RDP at eps; while the result has more than `cap` segments, double eps. Returns (points, eps used)."""
    out = A.rdp(pts, eps)
    while len(out) - 1 > cap:
        eps *= 2.0
        out = A.rdp(pts, eps)
    return out, eps


def trace(g: np.ndarray, threshold: float = 0.5, ink: str = "auto", max_shapes: int = 12) -> tuple[list[list[tuple[float, float]]], float]:
    """Bi-level mask -> shapes. `ink` says which side of the threshold is the drawing: dark, light, or auto
    (the minority side, since a drawing is the smaller part of its sheet). Returns (shapes, worst eps)."""
    mask = (g < threshold) if ink == "dark" else (g >= threshold) if ink == "light" else None
    if mask is None:
        dark = float((g < threshold).mean())
        mask = g < threshold if dark <= 0.5 else g >= threshold
    z = np.asarray(Image.fromarray((mask * 255).astype(np.uint8), "L").filter(ImageFilter.GaussianBlur(0.8)), dtype=np.float64)
    pad = np.pad(z, 1, mode="constant")            # a shape touching the border still closes
    lines = [[(x - 1, y - 1) for x, y in ln] for ln in A.iso_polylines(pad, 127.5)]
    lines = [ln for ln in lines if _length(ln) >= MIN_LENGTH]
    lines.sort(key=_length, reverse=True)
    shapes, worst = [], EPS
    for ln in lines[:max_shapes]:
        pts, eps = fit(ln)
        worst = max(worst, eps)
        shapes.append(pts)
    return shapes, worst


def to_svg(shapes: list[list[tuple[float, float]]], w: int, h: int) -> str:
    d = "".join("M" + " ".join(f"{x:.1f} {y:.1f}" for x, y in s) for s in shapes)
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {w} {h}" aria-hidden="true" fill="none" '
            f'stroke="currentColor" stroke-width="1.5" vector-effect="non-scaling-stroke" stroke-linejoin="round">'
            f'<path d="{d}"/></svg>\n')


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--id", required=True, help="catalogue id, for example C01-18")
    ap.add_argument("--out", required=True, help="the private folder to write into")
    ap.add_argument("--frac", nargs=4, type=float, metavar=("X0", "Y0", "X1", "Y1"), help="crop box as fractions of the crop")
    ap.add_argument("--threshold", type=float, default=0.5)
    ap.add_argument("--ink", choices=("dark", "light", "auto"), default="auto")
    ap.add_argument("--max-shapes", type=int, default=12)
    ap.add_argument("--root", default=str(B.ROOT))
    ap.add_argument("--data-root", default=None)
    a = ap.parse_args(argv)
    p = B.Paths(Path(a.root), Path(a.data_root) if a.data_root else None)
    out = Path(a.out).resolve()
    for forbidden in (p.root / "tools", p.root / "app", p.root / "docs"):
        if forbidden in out.parents or out == forbidden:
            print(f"refusing --out {out}: a traced sigil is derived from a third-party picture and goes only to the git-ignored private folder")
            return 2
    src = {"kind": "catalogue", "id": a.id, "w": MAX_SIDE}
    if a.frac:
        src["frac"] = a.frac
    g = A.tone(B.make_source(src, 0, p).luma)
    shapes, eps = trace(g, a.threshold, a.ink, a.max_shapes)
    h, w = g.shape
    out.mkdir(parents=True, exist_ok=True)
    f = out / f"sigil-{a.id}.svg"
    f.write_text(to_svg(shapes, w, h), encoding="utf-8", newline="\n")
    segs = [len(s) - 1 for s in shapes]
    print(f"{f.name}: {len(shapes)} shape(s), segments per shape {segs}, worst epsilon {eps:g} px, {f.stat().st_size} B")
    return 0


if __name__ == "__main__":
    sys.exit(main())
