"""Invented papers for the ingest tests, turned into files at test time (no binary is committed).

    build_pdf(spec, folder) -> Path     a PDF laid out from papers.py with PyMuPDF
    build_pptx(spec, folder) -> Path    a slide deck with python-pptx
    PAPERS, BY_NAME, DECK, long_paper   the data
"""
from __future__ import annotations

from pathlib import Path

from .papers import BY_NAME, DECK, PAPERS, long_paper

__all__ = ["PAPERS", "BY_NAME", "DECK", "long_paper", "build_pdf", "build_pptx", "RIGHT_X", "LEFT_X"]

LEFT_X = 72
RIGHT_X = 530
TOP_Y = 60
FONT = 11


def _line_items(page, lines, width, fitz):
    """Write the lines of one page; returns nothing, draws in place."""
    y = TOP_Y
    for item in lines:
        if isinstance(item, str):
            item = {"t": item}
        if "gap" in item:
            y += item["gap"]
            continue
        if "table" in item:
            y = _table(page, item["table"], y, fitz)
            continue
        size = item.get("size", FONT)
        y += size * 1.45
        text = item["t"]
        if item.get("c"):
            x = (width - fitz.get_text_length(text, fontsize=size)) / 2
        else:
            x = item.get("x", LEFT_X)
        page.insert_text((x, y), text, fontsize=size)
        if item.get("r"):
            page.insert_text((RIGHT_X, y), item["r"], fontsize=size)


def _table(page, t, y, fitz):
    widths = t.get("widths") or [80] * len(t["cols"])
    x0 = 50
    xs = [x0]
    for w in widths:
        xs.append(xs[-1] + w)
    rows = [t["cols"]] + t["rows"]
    h = 20
    top = y + 6
    ys = [top + i * h for i in range(len(rows) + 1)]
    for x in xs:
        page.draw_line((x, ys[0]), (x, ys[-1]))
    for yy in ys:
        page.draw_line((xs[0], yy), (xs[-1], yy))
    for r, row in enumerate(rows):
        for c, cell in enumerate(row):
            page.insert_text((xs[c] + 3, ys[r] + 14), cell, fontsize=9)
    return ys[-1]


def build_pdf(spec: dict, folder: Path) -> Path:
    import fitz
    folder = Path(folder)
    folder.mkdir(parents=True, exist_ok=True)
    w, h = (842, 595) if spec.get("landscape") else (595, 842)
    doc = fitz.open()
    for lines in spec["pages"]:
        page = doc.new_page(width=w, height=h)
        if isinstance(lines, dict) and "image" in lines:
            # a page that is only a picture of text: what a phone scan of a paper looks like to a PDF reader
            tmp = fitz.open()
            tp = tmp.new_page(width=w, height=h)
            _line_items(tp, lines["image"], w, fitz)
            pix = tp.get_pixmap(dpi=100)
            page.insert_image(page.rect, pixmap=pix)
            tmp.close()
            continue
        _line_items(page, lines, w, fitz)
    out = folder / f"{spec['name']}.pdf"
    doc.save(str(out))
    doc.close()
    return out


def build_pptx(spec: dict, folder: Path) -> Path:
    from pptx import Presentation
    folder = Path(folder)
    folder.mkdir(parents=True, exist_ok=True)
    prs = Presentation()
    layout = prs.slide_layouts[1]           # title and content
    for s in spec["slides"]:
        slide = prs.slides.add_slide(layout)
        slide.shapes.title.text = s["title"]
        body = slide.placeholders[1].text_frame
        body.text = s["body"][0]
        for line in s["body"][1:]:
            body.add_paragraph().text = line
        if s.get("notes"):
            slide.notes_slide.notes_text_frame.text = s["notes"]
    out = folder / f"{spec['name']}.pptx"
    prs.save(str(out))
    return out
