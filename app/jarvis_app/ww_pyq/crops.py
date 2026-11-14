"""Page pictures and question crops (E06).

    render_page(doc, page_no, out, dpi=150) -> Path         one PNG of a whole page (PyMuPDF)
    render_crop(page_png, bbox, page_size, out) -> Path     a box of that PNG, the box in PDF points

Why a crop is cut from the stored page picture and not rendered again from the PDF: the page is
drawn once (spec 21.3.1 rule 2), and moving a crop's edges (R-14) then needs no PDF at all, only the
PNG. The density is schema.CROP_DPI (150, spec 21.3.1): an A4 page is then 1240 x 1754 pixels,
about 6.5 MB of RGB while it is drawn, and only one page is held at a time.

Every file is written beside its target under a dot-name and then moved over it, so a reader never
sees half a PNG and a crash leaves the old one.
"""
from __future__ import annotations

import os
import uuid
from pathlib import Path
from typing import Sequence

from .schema import CROP_DPI


def _tmp(out: Path) -> Path:
    return out.with_name(f".{out.stem}.{uuid.uuid4().hex[:8]}.tmp.png")


def _replace(tmp: Path, out: Path) -> None:
    try:
        os.replace(tmp, out)
    finally:
        tmp.unlink(missing_ok=True)


def render_page_image(doc, page_no: int, out: Path, dpi: int = CROP_DPI):
    """Draw a page, save it to `out` as PNG, and return it as a PIL image so its crops can be cut
    without decoding the PNG again (about 27 ms a page on this laptop)."""
    from PIL import Image
    out = Path(out)
    out.parent.mkdir(parents=True, exist_ok=True)
    pix = doc[page_no - 1].get_pixmap(dpi=dpi, alpha=False)
    tmp = _tmp(out)
    try:
        pix.save(str(tmp), output="png")
        im = Image.frombytes("RGB", (pix.width, pix.height), pix.samples)
    finally:
        pix = None
    _replace(tmp, out)
    return im


def render_page(doc, page_no: int, out: Path, dpi: int = CROP_DPI) -> Path:
    """Draw page `page_no` (1-based) of an open PyMuPDF document to `out` as PNG."""
    render_page_image(doc, page_no, out, dpi).close()
    return Path(out)


def clip_box(bbox: Sequence[float], page_size: Sequence[float]) -> list[float]:
    """The box cut down to the page, in points."""
    w, h = float(page_size[0]), float(page_size[1])
    x0, y0, x1, y1 = (float(v) for v in bbox)
    return [max(0.0, min(x0, w)), max(0.0, min(y0, h)), max(0.0, min(x1, w)), max(0.0, min(y1, h))]


def cut(im, bbox: Sequence[float], page_size: Sequence[float], out: Path) -> Path:
    """Cut `bbox` out of an open page picture `im` (PIL) into `out`. The scale is read from the
    picture itself, so a page drawn at another density still crops right. Ingest opens a page
    picture once and cuts all its questions from it: decoding a 150 dpi page costs about 15 ms."""
    out = Path(out)
    out.parent.mkdir(parents=True, exist_ok=True)
    x0, y0, x1, y1 = clip_box(bbox, page_size)
    if x1 - x0 < 1 or y1 - y0 < 1:
        raise ValueError("A crop needs a box inside the page.")
    sx, sy = im.width / float(page_size[0]), im.height / float(page_size[1])
    part = im.crop((round(x0 * sx), round(y0 * sy), round(x1 * sx), round(y1 * sy)))
    tmp = _tmp(out)
    try:
        # level 1: 6 ms a crop against 25 ms at Pillow's default 6; on a whole page the file was 148 KB against 87 KB
        part.save(tmp, format="PNG", compress_level=1)
    finally:
        part.close()
    _replace(tmp, out)
    return out


def render_crop(page_png: Path, bbox: Sequence[float], page_size: Sequence[float], out: Path) -> Path:
    """Cut `bbox` (PDF points on a page of `page_size` points) out of the page picture into `out`."""
    from PIL import Image
    with Image.open(page_png) as im:
        return cut(im, bbox, page_size, out)


def page_size_of(page_png: Path, dpi: int) -> tuple[float, float]:
    """The page's size in points, read back from a picture drawn at `dpi` (R-14 has no PDF open).
    Rounding at draw time moves it by under 0.5 pt."""
    from PIL import Image
    with Image.open(page_png) as im:
        return im.width * 72.0 / dpi, im.height * 72.0 / dpi
