"""Slide decks as study units (E06): one unit per slide, never a question with marks.

    read_deck(path) -> Deck          a .pptx through yaadash/library.py extract, speaker notes left out
    pdf_slide(rows, page_no) -> dict one unit for a page of a deck exported to PDF

Why the library reader and not a second one: yaadash/library.py already reads titles, text frames and
tables of every slide (python-pptx), and two readers would drift. It appends the speaker notes to a
slide's text as "Speaker notes: ..."; those are his presenter's words, not the slide, so they are cut
off again here by the exact notes text, read with python-pptx from the same file.
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field
from pathlib import Path

_NOTES = "Speaker notes: "
MAX_LABEL = 120
MAX_UNZIPPED = 250 * 1024 * 1024     # a 40 MB deck of photos holds about 45 MB of XML and media; 250 MB declared is a bomb, not a deck
MAX_MEMBERS = 5000                   # a 300-slide deck has about 2500 parts


def _ws(text: str) -> str:
    return re.sub(r"\s+", " ", text or "").strip()


@dataclass
class Deck:
    title: str
    pages: int
    units: list[dict] = field(default_factory=list)      # {page, heading, text}
    scanned: list[int] = field(default_factory=list)     # slides that are only pictures
    blank: list[int] = field(default_factory=list)


def _notes_by_slide(path: Path) -> dict[int, str]:
    from pptx import Presentation
    out = {}
    for i, slide in enumerate(Presentation(str(path)).slides, start=1):
        if slide.has_notes_slide:
            text = _ws(slide.notes_slide.notes_text_frame.text)
            if text:
                out[i] = text
    return out


def _without_notes(text: str, notes: str) -> str:
    tail = _NOTES + notes
    if notes and text.endswith(tail):
        return text[:-len(tail)].rstrip()
    i = text.rfind(_NOTES)                        # notes the reader cleaned differently: cut at the marker
    return text[:i].rstrip() if notes and i >= 0 else text


def _check_zip(path: Path) -> None:
    """Refuse a deck that expands enormously before python-pptx reads any part of it. The sizes are the
    central directory's; zipfile cuts a read at the declared size, so a header that understates them
    cannot make a part larger than it says."""
    import zipfile
    try:
        with zipfile.ZipFile(path) as z:
            infos = z.infolist()
    except (zipfile.BadZipFile, OSError) as e:
        raise ValueError("This file does not open as a slide deck.") from e
    if len(infos) > MAX_MEMBERS or sum(i.file_size for i in infos) > MAX_UNZIPPED:
        raise ValueError("This deck expands to far more than a deck should; I did not open it.")


def read_deck(path: Path) -> Deck:
    from ..paths import ensure_jarvis_importable
    ensure_jarvis_importable()
    import library
    path = Path(path)
    _check_zip(path)
    try:
        ex = library.extract(path)
        notes = _notes_by_slide(path)
    except ValueError:
        raise
    except Exception as e:                        # a damaged zip or a file that is not a deck
        raise ValueError("This file does not open as a slide deck.") from e
    deck = Deck(title=ex.title, pages=ex.pages, scanned=list(ex.scanned), blank=list(ex.blank))
    for s in ex.sections:
        text = _ws(_without_notes(s.text, notes.get(s.page, "")))
        if not text:
            deck.blank.append(s.page)
            continue
        deck.units.append({"page": s.page, "heading": _ws(s.heading)[:MAX_LABEL], "text": text})
    deck.blank.sort()
    return deck


def pdf_slide(rows: list[dict], page_no: int) -> dict:
    """A page of a deck saved as PDF: its biggest line is the heading, all its lines the text."""
    if not rows:
        return {"page": page_no, "heading": "", "text": ""}
    top = max(rows, key=lambda r: (r.get("size") or 0, -r["y0"]))
    return {"page": page_no, "heading": _ws(top["text"])[:MAX_LABEL], "text": _ws(" ".join(r["text"] for r in rows))}
