"""A paper source whose listing is one page with one table of papers: each row is a paper, its cells link the PDF.

The shape was read by hand on 25 Nov 2026 from a university's public archive of old papers: 679 rows, four columns
(course, paper id, subject code, subject name), every cell of a row a link to the same PDF, old-scheme codes and no
year. One row of the 679 points its cells at two different files, so the link most cells agree on is taken and the
row says so. A paper id there can look like a year (2030, 2032) and seven id cells hold a range (2018-19), so a year is
read only from a column headed as one, or from a session (2021-22) in the title, or in any cell of a table without headers.

The address is his to give (R-44) and is kept in the private harvest state: this module names no site. It parses the
page it is handed and nothing else.
"""
from __future__ import annotations

import re
from collections import Counter
from typing import Optional
from urllib.parse import urljoin, urlparse

from . import Adapter, _html, register

_TR = re.compile(r"<tr\b", re.I)
_TD = re.compile(r"<td\b[^>]*>(.*?)</td\s*>", re.I | re.S)
_TH = re.compile(r"<th\b[^>]*>(.*?)</th\s*>", re.I | re.S)
_CODE = re.compile(r"^[A-Za-z]{1,6}[ -]?\d{2,4}(?:\s?\(?[A-Za-z0-9]{1,2}\)?)?$")
_YEAR = re.compile(r"\b((?:19|20)\d\d)\b")
_SESSION = re.compile(r"\b((?:19|20)\d\d)\s?[-/]\s?(?:\d\d|(?:19|20)\d\d)\b")


def _pdf_links(cell: str) -> list[str]:
    out = []
    for attrs in _html.A_OPEN.findall(cell):
        h = _html.href(attrs)
        if h and not _html.hidden(attrs) and urlparse(h).path.lower().endswith(".pdf"):
            out.append(h)
    return out


def _columns(heads: list[str]) -> dict[str, Optional[int]]:
    def first(*words: str) -> Optional[int]:
        return next((i for i, h in enumerate(heads) if any(w in h for w in words)), None)
    code = first("code")
    title = first("subject name", "paper name", "title")
    if title is None:
        named = [i for i, h in enumerate(heads) if ("name" in h or "subject" in h) and i != code]
        title = named[-1] if named else None
    return {"code": code, "title": title, "year": first("year", "session")}


def parse(page: bytes, base: str) -> dict:
    s = page.decode("utf-8", "replace")
    heads = [_html.text(h).lower() for h in _TH.findall(s)]
    col = _columns(heads)
    host = urlparse(base).hostname
    items, odd, off_site = [], 0, 0
    for chunk in _TR.split(s)[1:]:
        cells = _TD.findall(chunk)
        links = [link for c in cells for link in _pdf_links(c)]
        if not links:
            continue
        counts = Counter(links)
        url = urljoin(base, counts.most_common(1)[0][0])
        if urlparse(url).hostname != host:
            off_site += 1
            continue
        texts = [_html.text(c) for c in cells]
        by_head = len(heads) == len(texts)

        def cell(name: str) -> str:
            i = col[name]
            return texts[i] if by_head and i is not None else ""
        code = cell("code") or next((t for t in texts if _CODE.match(t)), "")
        title = cell("title") or max((t for t in texts if t != code), key=len, default="")
        # under a header row only the title may carry a session: on the page read by hand 7 paper-id cells hold a range of ids (2018-19)
        ym = _YEAR.search(cell("year")) or next((m for m in (_SESSION.search(t) for t in ([title] if by_head else texts)) if m), None)
        it = {"title": title, "code": code, "year": int(ym.group(1)) if ym else None, "kind": "paper", "url": url}
        if len(counts) > 1:
            odd += 1
            it["note"] = f"The cells of this row point at {len(counts)} files; the one most cells agree on is listed."
        items.append(it)
    notes = []
    if odd:
        notes.append(f"{odd} {'row points' if odd == 1 else 'rows point'} at more than one file")
    if off_site:
        notes.append(f"{off_site} {'row links' if off_site == 1 else 'rows link'} another site and {'is' if off_site == 1 else 'are'} not listed")
    return {"items": items, "note": "; ".join(notes)}


register(Adapter(
    id="papers_table", name="A page with a table of past papers (you give the address)", needs_address=True, parse=parse,
    rights="not known to this tool: the site's own terms decide",
    terms_note="You name the page. This tool knows nothing of that site's terms: read them there before you switch this on. "
               "A fetch is a pointer to the paper; a local copy is your second switch, for your own study on this PC, and is never passed on."))
