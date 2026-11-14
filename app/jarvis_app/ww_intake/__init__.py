"""Manual intake parsers (C01): pasted lines, calendar files and name match.

All three are pure functions (no clock but the `now` argument, no file, no network, no state);
the store and the routes that call them are C02.
"""
from __future__ import annotations

from .ics import IcsEvent, parse_ics
from .match import match_name
from .paste import ParseResult, PasteItem, UnreadLine, parse_paste

__all__ = [
    "IcsEvent", "ParseResult", "PasteItem", "UnreadLine",
    "match_name", "parse_ics", "parse_paste",
]
