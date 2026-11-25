"""The little HTML reading the paper-source parsers share. Regular expressions on purpose: a listing page is read
for its links and the text beside them, never rendered, and no parser library is installed for it."""
from __future__ import annotations

import html
import re
from typing import Optional

A_OPEN = re.compile(r"<a\b([^>]*)>", re.I | re.S)
A_FULL = re.compile(r"<a\b([^>]*)>(.*?)</a\s*>", re.I | re.S)
_HREF = re.compile(r"""\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))""", re.I)
_QUOTED = re.compile(r"""=\s*(?:"[^"]*"|'[^']*')""")
_UNSEEN = re.compile(r"display\s*:\s*none|visibility\s*:\s*hidden", re.I)


def text(fragment: str) -> str:
    """The words of a fragment: tags out, entities read, spaces collapsed."""
    return " ".join(html.unescape(re.sub(r"<[^>]+>", " ", fragment)).split())


def href(attrs: str) -> Optional[str]:
    m = _HREF.search(attrs)
    if not m:
        return None
    return html.unescape(next(g for g in m.groups() if g is not None)).strip()


def hidden(attrs: str) -> bool:
    """A link the page does not show a reader: the `hidden` attribute, or a style that hides it. One listing page read
    on 25 Nov 2026 carries exactly one such link, to a random address: it is there for crawlers, and is never followed."""
    return bool(re.search(r"\bhidden\b", _QUOTED.sub("", attrs), re.I) or _UNSEEN.search(attrs))
