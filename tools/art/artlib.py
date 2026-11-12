"""Pure, deterministic art steps for the derivative pipeline (docs/design/jarvis-product-overhaul.md 8.5).

Every function here is a pure function of its pixels and parameters. No model, no clock, no random
module: randomness comes from `hash2`, an integer hash of (x, y, seed), so the same recipe gives the same
bytes on any machine with the same Pillow. numpy's Generator is avoided on purpose because its streams
are not guaranteed stable across releases, and a determinism check that breaks on a numpy upgrade would
be noise. PIL and numpy only (both already in the venv).

Pixel convention: luma arrays are float64 in 0..1, row 0 on top, 1 is light.
"""
from __future__ import annotations

import hashlib
import io
import math
import re
from pathlib import Path

import numpy as np
from PIL import Image, ImageFilter

RAMP = " .:-=+*#%@"          # light to dense, ASCII only so any mono font draws it (8.5.2)
CELL_W, CELL_H = 7.2, 16.0   # px, Geist Mono 12 px advance 0.6 em and a 16 px line (8.3)
BAYER8 = np.array([
    [0, 32, 8, 40, 2, 34, 10, 42], [48, 16, 56, 24, 50, 18, 58, 26],
    [12, 44, 4, 36, 14, 46, 6, 38], [60, 28, 52, 20, 62, 30, 54, 22],
    [3, 35, 11, 43, 1, 33, 9, 41], [51, 19, 59, 27, 49, 17, 57, 25],
    [15, 47, 7, 39, 13, 45, 5, 37], [63, 31, 55, 23, 61, 29, 53, 21]], dtype=np.float64)
BAYER_T = (BAYER8 + 0.5) / 64.0   # thresholds in (0, 1), 8.5.2: (M + 0.5) / 64


# ---------------------------------------------------------------- colour helpers
def hex_rgb(h: str) -> tuple[int, int, int]:
    h = h.lstrip("#")
    return int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16)


def _lin(c: float) -> float:
    c = c / 255.0
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def rel_luminance(rgb: tuple[float, float, float]) -> float:
    """WCAG 2.x relative luminance."""
    r, g, b = (_lin(v) for v in rgb)
    return 0.2126 * r + 0.7152 * g + 0.0722 * b


def contrast_ratio(a: tuple[float, float, float], b: tuple[float, float, float]) -> float:
    la, lb = rel_luminance(a), rel_luminance(b)
    hi, lo = max(la, lb), min(la, lb)
    return (hi + 0.05) / (lo + 0.05)


# ---------------------------------------------------------------- seeded noise
def hash2(ix: np.ndarray, iy: np.ndarray, seed: int) -> np.ndarray:
    """Integer hash of (x, y, seed) to float64 in [0, 1]. uint32 arithmetic wraps the same everywhere."""
    with np.errstate(over="ignore"):
        h = (ix.astype(np.int64).astype(np.uint32) * np.uint32(374761393)
             + iy.astype(np.int64).astype(np.uint32) * np.uint32(668265263)
             + np.uint32(seed & 0xFFFFFFFF) * np.uint32(2246822519))
        h = (h ^ (h >> np.uint32(13))) * np.uint32(1274126177)
        h = h ^ (h >> np.uint32(16))
    return h.astype(np.float64) / 4294967295.0


def value_noise(w: int, h: int, cell: float, seed: int) -> np.ndarray:
    """Smoothstep-interpolated lattice noise, w x h, values 0..1."""
    ys, xs = np.mgrid[0:h, 0:w].astype(np.float64)
    x, y = xs / cell, ys / cell
    x0, y0 = np.floor(x), np.floor(y)
    fx, fy = x - x0, y - y0
    fx, fy = fx * fx * (3 - 2 * fx), fy * fy * (3 - 2 * fy)
    a, b = hash2(x0, y0, seed), hash2(x0 + 1, y0, seed)
    c, d = hash2(x0, y0 + 1, seed), hash2(x0 + 1, y0 + 1, seed)
    return (a * (1 - fx) + b * fx) * (1 - fy) + (c * (1 - fx) + d * fx) * fy


def fractal(w: int, h: int, cell: float, seed: int, octaves: int = 3, gain: float = 0.5) -> np.ndarray:
    out = np.zeros((h, w))
    amp, total = 1.0, 0.0
    for o in range(octaves):
        out += amp * value_noise(w, h, max(cell / (2 ** o), 1.0), seed + 101 * o)
        total += amp
        amp *= gain
    return out / total


def permutation(n: int, seed: int) -> list[int]:
    """Fixed reveal order for growing art (8.5.5 item 3): items sorted by their hash, ties by index."""
    keys = hash2(np.arange(n), np.zeros(n, dtype=np.int64), seed)
    return [int(i) for i in sorted(range(n), key=lambda i: (keys[i], i))]


# ---------------------------------------------------------------- tone and ascii
def luma709(im: Image.Image) -> np.ndarray:
    a = np.asarray(im.convert("RGB"), dtype=np.float64) / 255.0
    return 0.2126 * a[..., 0] + 0.7152 * a[..., 1] + 0.0722 * a[..., 2]


def tone(g: np.ndarray, lo_pct: float = 2.0, hi_pct: float = 98.0, gamma: float = 1.0) -> np.ndarray:
    """Stretch between the 2nd and 98th percentile, optional gamma (8.5.2 `tone`)."""
    lo, hi = np.percentile(g, lo_pct), np.percentile(g, hi_pct)
    if hi - lo < 1e-9:
        return np.clip(g, 0.0, 1.0)
    return np.clip((g - lo) / (hi - lo), 0.0, 1.0) ** gamma


def _box_resize(g: np.ndarray, w: int, h: int) -> np.ndarray:
    im = Image.fromarray((np.clip(g, 0, 1) * 255.0 + 0.5).astype(np.uint8), "L")
    return np.asarray(im.resize((w, h), Image.BOX), dtype=np.float64) / 255.0


def ascii_text(g: np.ndarray, edge_threshold: float | None = 0.35) -> str:
    """One glyph per 7.2 x 16 px cell: mean luma picks the ramp glyph (dense glyph = bright, for a light
    glyph on a charcoal ground); where the Sobel gradient of the cell grid is above the threshold a
    direction glyph replaces it. LF endings, no trailing spaces, ASCII only."""
    h, w = g.shape
    cols, rows = max(int(w / CELL_W), 1), max(int(h / CELL_H), 1)
    c = _box_resize(g, cols, rows)
    idx = np.rint(c * (len(RAMP) - 1)).astype(int)
    grid = [[RAMP[i] for i in row] for row in idx]
    if edge_threshold is not None and cols > 2 and rows > 2:
        p = np.pad(c, 1, mode="edge")
        gx = (p[:-2, 2:] + 2 * p[1:-1, 2:] + p[2:, 2:]) - (p[:-2, :-2] + 2 * p[1:-1, :-2] + p[2:, :-2])
        gy = (p[2:, :-2] + 2 * p[2:, 1:-1] + p[2:, 2:]) - (p[:-2, :-2] + 2 * p[:-2, 1:-1] + p[:-2, 2:])
        mag = np.hypot(gx, gy) / 4.0     # Sobel on 0..1 luma peaks at 4
        for y, x in zip(*np.nonzero(mag > edge_threshold)):
            ang = math.degrees(math.atan2(gy[y, x], gx[y, x])) % 180.0   # gradient direction; the edge is normal to it
            if ang < 22.5 or ang >= 157.5:
                ch = "|"
            elif ang < 67.5:
                ch = "\\"
            elif ang < 112.5:
                ch = "-"
            else:
                ch = "/"
            grid[y][x] = ch
    return "\n".join("".join(r).rstrip() for r in grid) + "\n"


# ---------------------------------------------------------------- dithers
def _png(bits: np.ndarray, ground: str, ink: str, k: int) -> bytes:
    """1-bit indexed PNG with a 2-colour palette, scaled by an integer k with nearest neighbour.
    bits True means ink. compress_level 9 and no metadata keep the bytes stable."""
    im = Image.fromarray(np.where(bits, 1, 0).astype(np.uint8), "P")
    if k > 1:
        im = im.resize((im.width * k, im.height * k), Image.NEAREST)
    pal = list(hex_rgb(ground)) + list(hex_rgb(ink)) + [0] * (256 * 3 - 6)
    im.putpalette(pal)
    buf = io.BytesIO()
    im.save(buf, "PNG", bits=1, optimize=False, compress_level=9)
    return buf.getvalue()


def bayer_bits(g: np.ndarray) -> np.ndarray:
    h, w = g.shape
    t = np.tile(BAYER_T, (h // 8 + 1, w // 8 + 1))[:h, :w]
    return g > t


def bayer_png(g: np.ndarray, ground: str, ink: str, k: int = 1) -> bytes:
    return _png(bayer_bits(g), ground, ink, k)


def atkinson_bits(g: np.ndarray) -> np.ndarray:
    """Error diffusion: 1/8 of the error to six neighbours, a quarter dropped. Sequential, so offline only."""
    a = (np.clip(g, 0, 1) * 255.0).copy()
    h, w = a.shape
    out = np.zeros((h, w), dtype=bool)
    for y in range(h):
        row = a[y]
        for x in range(w):
            old = row[x]
            new = 255.0 if old > 127.0 else 0.0
            out[y, x] = new > 0
            e = (old - new) / 8.0
            if e == 0.0:
                continue
            if x + 1 < w:
                a[y, x + 1] += e
            if x + 2 < w:
                a[y, x + 2] += e
            if y + 1 < h:
                if x > 0:
                    a[y + 1, x - 1] += e
                a[y + 1, x] += e
                if x + 1 < w:
                    a[y + 1, x + 1] += e
            if y + 2 < h:
                a[y + 2, x] += e
    return out


def atkinson_png(g: np.ndarray, ground: str, ink: str, k: int = 1) -> bytes:
    return _png(atkinson_bits(g), ground, ink, k)


# ---------------------------------------------------------------- contour (marching squares + RDP)
# For each of the 16 corner cases, the edge pairs to join. Corners: a=TL, b=TR, c=BR, d=BL.
# Edges: 0 top (a-b), 1 right (b-c), 2 bottom (d-c), 3 left (a-d). Bit order a=8, b=4, c=2, d=1.
_MS = {0: [], 1: [(3, 2)], 2: [(2, 1)], 3: [(3, 1)], 4: [(0, 1)], 5: [(0, 3), (2, 1)], 6: [(0, 2)], 7: [(0, 3)],
       8: [(0, 3)], 9: [(0, 2)], 10: [(0, 1), (3, 2)], 11: [(0, 1)], 12: [(3, 1)], 13: [(2, 1)], 14: [(3, 2)], 15: []}


def _edge_id(edge: int, x: int, y: int) -> tuple:
    """Canonical id of a cell edge so the two cells that share it agree exactly: ('h', x, y) is the
    horizontal edge from lattice point (x, y) to (x+1, y); ('v', x, y) the vertical one to (x, y+1)."""
    return {0: ("h", x, y), 2: ("h", x, y + 1), 3: ("v", x, y), 1: ("v", x + 1, y)}[edge]


def _edge_point(eid: tuple, z: np.ndarray, level: float) -> tuple[float, float]:
    kind, x, y = eid
    x2, y2 = (x + 1, y) if kind == "h" else (x, y + 1)
    z1, z2 = z[y, x], z[y2, x2]
    t = 0.5 if z1 == z2 else (level - z1) / (z2 - z1)
    t = min(max(t, 0.0), 1.0)
    return x + (x2 - x) * t, y + (y2 - y) * t


def iso_polylines(z: np.ndarray, level: float) -> list[list[tuple[float, float]]]:
    h, w = z.shape
    segs: dict[tuple, list[tuple]] = {}
    above = z >= level
    for y in range(h - 1):
        for x in range(w - 1):
            case = (above[y, x] << 3) | (above[y, x + 1] << 2) | (above[y + 1, x + 1] << 1) | above[y + 1, x]
            if case in (0, 15):
                continue
            # saddles (5 and 10) resolved by the cell mean so the choice is a pure function of the data
            pairs = _MS[case]
            if case in (5, 10) and (z[y, x] + z[y, x + 1] + z[y + 1, x + 1] + z[y + 1, x]) / 4.0 >= level:
                pairs = [(0, 1), (3, 2)] if case == 5 else [(0, 3), (2, 1)]
            for e1, e2 in pairs:
                a, b = _edge_id(e1, x, y), _edge_id(e2, x, y)
                segs.setdefault(a, []).append(b)
                segs.setdefault(b, []).append(a)
    lines: list[list[tuple[float, float]]] = []
    seen: set[tuple] = set()
    order = sorted(segs)                                 # sorted ids: deterministic walk order

    def walk(start: tuple) -> list[tuple]:
        chain = [start]
        seen.add(start)
        cur, prev = start, None
        while True:
            nxt = [n for n in segs[cur] if n != prev and not (n in seen and n != start)]
            if not nxt:
                return chain
            n = nxt[0]
            if n == start:
                chain.append(start)
                return chain
            chain.append(n)
            seen.add(n)
            prev, cur = cur, n

    for s in order:                                      # open lines first (degree 1), then closed loops
        if s not in seen and len(segs[s]) == 1:
            lines.append([_edge_point(e, z, level) for e in walk(s)])
    for s in order:
        if s not in seen:
            lines.append([_edge_point(e, z, level) for e in walk(s)])
    return lines


def rdp(pts: list[tuple[float, float]], eps: float) -> list[tuple[float, float]]:
    """Ramer-Douglas-Peucker, iterative so a long line cannot hit the recursion limit."""
    n = len(pts)
    if n < 3:
        return pts
    keep = [False] * n
    keep[0] = keep[-1] = True
    stack = [(0, n - 1)]
    while stack:
        i, j = stack.pop()
        (x1, y1), (x2, y2) = pts[i], pts[j]
        dx, dy = x2 - x1, y2 - y1
        norm = math.hypot(dx, dy)
        best, idx = -1.0, -1
        for m in range(i + 1, j):
            px, py = pts[m]
            d = math.hypot(px - x1, py - y1) if norm == 0 else abs(dy * (px - x1) - dx * (py - y1)) / norm
            if d > best:
                best, idx = d, m
        if best > eps:
            keep[idx] = True
            stack.append((i, idx))
            stack.append((idx, j))
    return [p for p, k in zip(pts, keep) if k]


def contour_svg(g: np.ndarray, levels: int = 8, blur: float = 1.5, eps: float = 0.8, scale: float = 1.0) -> str:
    """Iso-lines at evenly spaced luma percentiles as one path per level. stroke is currentColor so a
    token colours it; vector-effect keeps it 1 px at any scale."""
    h, w = g.shape
    z = np.asarray(Image.fromarray((np.clip(g, 0, 1) * 255.0 + 0.5).astype(np.uint8), "L").filter(
        ImageFilter.GaussianBlur(blur)), dtype=np.float64)
    iso = [float(np.percentile(z, 100.0 * (i + 1) / (levels + 1))) for i in range(levels)]
    paths = []
    for lv in iso:
        d = []
        for line in iso_polylines(z, lv):
            pts = rdp(line, eps)
            if len(pts) < 2:
                continue
            d.append("M" + " ".join(f"{x * scale:.1f} {y * scale:.1f}" for x, y in pts))
        if d:
            paths.append(f'<path d="{"".join(d)}"/>')
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {w * scale:g} {h * scale:g}" aria-hidden="true" '
            f'fill="none" stroke="currentColor" stroke-width="1" vector-effect="non-scaling-stroke" '
            f'stroke-linejoin="round">{"".join(paths)}</svg>\n')


# ---------------------------------------------------------------- duotone and terminal
def duotone_webp(g: np.ndarray, ground: str, ink: str, quality: int = 70, tones: int = 16) -> bytes:
    """Map luma through two stops in linear light, quantised to 16 tones, lossy WebP. WebP bytes depend on
    the libwebp build, so build_art --check compares them by sha only when the manifest's environment
    matches, and always by size."""
    t = np.rint(np.clip(g, 0, 1) * (tones - 1)) / (tones - 1)
    lo = np.array([_lin(c) for c in hex_rgb(ground)])
    hi = np.array([_lin(c) for c in hex_rgb(ink)])
    lin = lo + (hi - lo) * t[..., None]
    srgb = np.where(lin <= 0.0031308, lin * 12.92, 1.055 * np.power(np.maximum(lin, 0), 1 / 2.4) - 0.055)
    rgb = np.rint(np.clip(srgb, 0, 1) * 255).astype(np.uint8)
    buf = io.BytesIO()
    Image.fromarray(rgb, "RGB").save(buf, "WEBP", quality=quality, method=4)
    return buf.getvalue()


def terminal_text(lines: list[str], title: str = "", tags: list[str] | None = None, width: int | None = None) -> str:
    """ASCII plus a box-drawing frame and bracket tags, text only (8.5.2 `terminal`)."""
    tags = tags or []
    head = (f"[{title}]" if title else "") + "".join(f" [{t}]" for t in tags)
    inner = max([len(x) for x in lines] + [len(head)] + [width or 0])
    top = "┌" + "─" * (inner + 2) + "┐"
    out = [top]
    if head:
        out.append("│ " + head.ljust(inner) + " │")
        out.append("├" + "─" * (inner + 2) + "┤")
    out += ["│ " + x.ljust(inner) + " │" for x in lines]
    out.append("└" + "─" * (inner + 2) + "┘")
    return "\n".join(out) + "\n"


# ---------------------------------------------------------------- generators (the customer track's own art)
def hill_luma(w: int, h: int, seed: int) -> np.ndarray:
    """Three value-noise ridgelines, each a mound, drawn as a stipple that is dense just under the line
    and fades down. Zero source picture: the customer replacement for the voice hill (8.6.3)."""
    ys = np.arange(h, dtype=np.float64)[:, None]
    xs = np.arange(w, dtype=np.float64)
    out = np.zeros((h, w))
    for layer, (base, amp, gain) in enumerate(((0.92, 0.62, 1.0), (0.96, 0.46, 0.7), (1.0, 0.3, 0.45))):
        n = fractal(w, 1, w / 6.0, seed + 31 * layer, octaves=3)[0]
        mound = np.exp(-(((xs / w) - 0.5) / 0.28) ** 2)
        ridge = (base - amp * mound * (0.55 + 0.9 * n)) * h
        d = np.maximum(ys - ridge[None, :], 0.0)
        shade = np.where(ys >= ridge[None, :], np.exp(-d / (h * 0.16)), 0.0) * gain
        out = np.maximum(out, shade)
    return out


def terrain_luma(w: int, h: int, seed: int) -> np.ndarray:
    """Fractal terrain for the contour island: a raised noise field with a soft falloff to flat sea."""
    ys, xs = np.mgrid[0:h, 0:w].astype(np.float64)
    r = np.hypot((xs - w / 2) / (w / 2), (ys - h / 2) / (h / 2))
    return np.clip(fractal(w, h, w / 5.0, seed, octaves=4) * np.clip(1.15 - r, 0, 1) ** 0.8 * 1.6, 0, 1)


def grain_luma(w: int, h: int, seed: int) -> np.ndarray:
    """A strip that is sparse at the top and denser at the base, broken up by noise (empty-state grain)."""
    ys = np.linspace(0.0, 1.0, h)[:, None]
    return np.clip(ys * (0.45 + 0.9 * fractal(w, h, 9.0, seed, octaves=2)) , 0, 1)


def paper_luma(w: int, h: int, seed: int) -> np.ndarray:
    """Quiet paper: broad low-contrast fibres plus fine grain, centred on mid-grey."""
    return np.clip(0.5 + 0.22 * (fractal(w, h, 48.0, seed, octaves=3) - 0.5)
                   + 0.10 * (value_noise(w, h, 2.0, seed + 7) - 0.5), 0, 1)


def dither_tiles(n: int = 8, size: int = 32) -> np.ndarray:
    """n tiles of size x size, density (i + 0.5) / n, side by side."""
    y, x = np.mgrid[0:size, 0:size]
    t = BAYER_T[y % 8, x % 8]
    return np.concatenate([(((i + 0.5) / n) > t) for i in range(n)], axis=1)


def lsystem_text(cols: int, rows: int, seed: int, iterations: int = 5, angle: float = 22.0) -> str:
    """A branch as characters (8.6.3: L-system, 22 degrees, 5 iterations). Strokes are |, /, \\ and -;
    twig tips beyond the trunk depth dissolve into letters picked by hash2. Drawn on a 7.2 x 16 px cell
    grid so the picture keeps its proportions in a mono font."""
    s = "X"
    for _ in range(iterations):
        s = "".join({"X": "F[+X]F[-X]+X", "F": "FF"}.get(c, c) for c in s)
    x = y = 0.0
    hd = math.radians(90.0)
    stack: list[tuple[float, float, float, int]] = []
    depth = 0
    segs: list[tuple[float, float, float, float, int]] = []
    for ch in s:
        if ch == "F":
            nx, ny = x + math.cos(hd), y + math.sin(hd)
            segs.append((x, y, nx, ny, depth))
            x, y = nx, ny
        elif ch == "+":
            hd += math.radians(angle)
        elif ch == "-":
            hd -= math.radians(angle)
        elif ch == "[":
            stack.append((x, y, hd, depth))
            depth += 1
        elif ch == "]":
            x, y, hd, depth = stack.pop()
    xs = [p for sg in segs for p in (sg[0], sg[2])]
    ys = [p for sg in segs for p in (sg[1], sg[3])]
    wpx, hpx = (max(xs) - min(xs)) or 1.0, (max(ys) - min(ys)) or 1.0
    sc = min(cols * CELL_W / wpx, rows * CELL_H / hpx)   # px per unit
    ox = (cols * CELL_W - wpx * sc) / 2.0 - min(xs) * sc
    grid = [[" "] * cols for _ in range(rows)]
    dgrid = [[-1] * cols for _ in range(rows)]
    max_depth = max(sg[4] for sg in segs)
    letters = "abcdefghijklmnopqrstuvwxyz"
    for x1, y1, x2, y2, d in segs:
        steps = max(int(math.hypot((x2 - x1) * sc / CELL_W, (y2 - y1) * sc / CELL_H) * 2), 1)
        ang = math.degrees(math.atan2((y2 - y1) * sc, (x2 - x1) * sc)) % 180.0
        stroke = "-" if (ang < 22.5 or ang >= 157.5) else ("/" if ang < 67.5 else ("|" if ang < 112.5 else "\\"))
        for i in range(steps + 1):
            t = i / steps
            px = (x1 + (x2 - x1) * t) * sc + ox
            py = rows * CELL_H - ((y1 + (y2 - y1) * t) - min(ys)) * sc - 1e-6   # trunk foot on the bottom row
            cx, cy = int(px / CELL_W), int(py / CELL_H)
            if 0 <= cx < cols and 0 <= cy < rows and d >= dgrid[cy][cx]:
                dgrid[cy][cx] = d
                if d > max(max_depth - 2, 1):
                    k = int(hash2(np.array([cx]), np.array([cy]), seed)[0] * 26) % 26
                    grid[cy][cx] = letters[k]
                else:
                    grid[cy][cx] = stroke
    return "\n".join("".join(r).rstrip() for r in grid) + "\n"


# ---------------------------------------------------------------- guards
def silhouette_iou(a: np.ndarray, b: np.ndarray, threshold: float = 0.5) -> float:
    """Intersection over union of two luma arrays' bright masks, b resized to a. The redraw guard of 8.6.2
    fails a customer render above 0.5 against its private source; a human then reviews."""
    if a.shape != b.shape:
        b = _box_resize(b, a.shape[1], a.shape[0])
    ma, mb = a > threshold, b > threshold
    union = np.logical_or(ma, mb).sum()
    return 1.0 if union == 0 else float(np.logical_and(ma, mb).sum() / union)


def sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def parse_tokens(css_text: str) -> dict[str, str]:
    """--name: #hex pairs from a CSS file (the primitives)."""
    return {m.group(1): m.group(2).lower() for m in re.finditer(r"(--[\w-]+)\s*:\s*(#[0-9a-fA-F]{6})\b", css_text)}


def load_tokens(root: Path) -> dict[str, str]:
    return parse_tokens((root / "app/ui/src/styles/design/clay/primitive-color.css").read_text(encoding="utf-8"))
