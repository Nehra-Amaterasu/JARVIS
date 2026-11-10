"""Season and evening for Well Wisher, computed once on the server (plan 3.3 state rules, 9.0).

The desktop frame and the phone page both show the same two states, so they must never
disagree about them. This module is pure: no file, no clock of its own, no Plan. The caller
hands it the exams-engine payload and a `now`, and gets one small dict back that rides on the
mission `today` payload and on `/api/phone/ww/today`.

  season   "exams" when the nearest dated paper is within `window` days, else "normal".
           window is 45 days (plan question 8, assumed: the 3-week CIE run plus the
           end-sem study leave is about six weeks, and 45 days keeps the countdown from
           flickering on for a paper that is still a term away).
  evening  after 18:00 local, or earlier when today's planned study is already done
           (plan question 8 asks the owner to confirm both halves).

What the state changes (from the plan, so both pages read it from here and never re-derive it):
  exams   left column opens on the Countdown, Study opens first, Findings hidden, "Due soon"
          looks 3 days ahead.
  normal  left column opens on the Horizon, Life opens first, "Due soon" looks 7 days ahead.

`mode` is the owner's pill (auto | exams | normal). The server only knows what it was told;
the desktop pill keeps its choice in the browser and sends nothing, so the phone, which has no
pill, always reports "auto". An unknown mode is read as auto rather than failing the page.
"""
from __future__ import annotations

from datetime import date, datetime
from typing import Optional

DEFAULT_WINDOW_DAYS = 45
EVENING_HOUR = 18
MODES = ("auto", "exams", "normal")
DUE_SOON_DAYS = {"exams": 3, "normal": 7}


def nearest_days(papers: list[dict], today: str) -> Optional[int]:
    """Days to the nearest paper dated today or later, or None with no dated paper ahead."""
    best: Optional[int] = None
    for p in papers or []:
        d = p.get("date")
        if not isinstance(d, str):
            continue
        try:
            n = (date.fromisoformat(d[:10]) - date.fromisoformat(today)).days
        except ValueError:
            continue
        if n >= 0 and (best is None or n < best):
            best = n
    return best


def season_of(nearest: Optional[int], window: int = DEFAULT_WINDOW_DAYS, mode: str = "auto") -> str:
    """exams or normal. An explicit mode wins; auto compares the nearest paper with the window."""
    if mode in ("exams", "normal"):
        return mode
    return "exams" if nearest is not None and nearest <= window else "normal"


def is_evening(hour: int, blocks_done: bool = False) -> tuple[bool, Optional[str]]:
    """(evening, why). The clock wins the label when both hold, because it is the simpler thing to say."""
    if hour >= EVENING_HOUR:
        return True, "clock"
    if blocks_done:
        return True, "blocks_done"
    return False, None


def blocks_done_today(exams: dict, today: str) -> bool:
    """True when today has planned study and none of it is left.

    The exams engine already subtracts the minutes logged today from the first slot, so a
    slot at 0 minutes is a slot whose work is done. A day with no slots is NOT done: nothing was planned, so nothing was finished.
    """
    day = next((d for d in exams.get("days") or [] if d.get("date") == today), None)
    slots = [s for s in (day or {}).get("slots") or [] if not s.get("reserved")]
    if not slots:
        return False
    return all(int(s.get("minutes") or 0) <= 0 for s in slots)


def season_state(exams: dict, today: str, now: Optional[datetime] = None, mode: str = "auto",
                 window: int = DEFAULT_WINDOW_DAYS) -> dict:
    """The one dict both pages read. `exams` is the exams-engine payload (papers, days)."""
    now = now or datetime.now()
    mode = mode if mode in MODES else "auto"
    near = nearest_days(exams.get("papers") or [], today)
    s = season_of(near, window, mode)
    ev, why = is_evening(now.hour, blocks_done_today(exams, today))
    return {
        "season": s, "mode": mode, "window_days": window, "nearest_days": near,
        "evening": ev, "evening_why": why,
        "left_top": "countdown" if s == "exams" else "horizon",
        "opens": "study" if s == "exams" else "life",
        "due_soon_days": DUE_SOON_DAYS[s],
        "findings_hidden": s == "exams",
        "now_card": "close_the_day" if ev else "now",
    }


def with_season(plan, payload: dict, today: Optional[str] = None, now: Optional[datetime] = None) -> dict:
    """Add `season` to a mission payload. A broken exams input must not take the day down,
    so on any error the payload is returned unchanged and the page falls back to its own default."""
    today = today or date.today().isoformat()
    try:
        return {**payload, "season": season_state(plan.engine("exams", today), today, now)}
    except Exception:
        return payload
