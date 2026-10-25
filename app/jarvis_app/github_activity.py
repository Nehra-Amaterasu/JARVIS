"""Public GitHub activity per day, for the proof engine (ww_proof.py).

    days(user, now=None, fetch=None) -> {"user", "fetched", "days": [{date, commits}], "error"?}

Reads https://api.github.com/users/<user>/events/public (no token: public data,
60 requests an hour per IP), counts commits per local day from PushEvents, and
caches the result in data/app/germoney/github.json for 30 minutes so the Today
screen never spends the hourly allowance. Only the date and a count are kept;
repo names, messages and diffs are thrown away.

Limits worth knowing: the events feed covers about the last 90 days and 300
events, and pushes to private repos are not in it. The contribution graph on the
profile page can therefore show more green than this.
"""
from __future__ import annotations

import json
import time
import urllib.request
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Callable, Optional

from .paths import DATA

CACHE = DATA / "germoney" / "github.json"
FRESH_S = 30 * 60
IST = timezone(timedelta(hours=5, minutes=30))   # his days end at local midnight, not UTC midnight
API = "https://api.github.com/users/{user}/events/public?per_page=100&page={page}"


def _get(url: str) -> list:
    req = urllib.request.Request(url, headers={"Accept": "application/vnd.github+json", "User-Agent": "jarvis-well-wisher"})
    with urllib.request.urlopen(req, timeout=8) as r:
        return json.loads(r.read().decode("utf-8"))


def count_days(events: list[dict], tz: timezone = IST) -> list[dict]:
    """Commits per local day from raw events. Pure."""
    per: dict[str, int] = {}
    for e in events:
        if e.get("type") != "PushEvent" or not e.get("created_at"):
            continue
        p = e.get("payload") or {}
        n = p.get("distinct_size", p.get("size", 1))
        try:
            n = max(1, int(n))
        except (TypeError, ValueError):
            n = 1
        day = datetime.fromisoformat(e["created_at"].replace("Z", "+00:00")).astimezone(tz).date().isoformat()
        per[day] = per.get(day, 0) + n
    return [{"date": d, "commits": c} for d, c in sorted(per.items())]


def days(user: str, now: Optional[float] = None, fetch: Optional[Callable[[str], list]] = None,
         cache: Path = CACHE) -> dict:
    now = time.time() if now is None else now
    try:
        old = json.loads(cache.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        old = None
    if old and old.get("user") == user and now - float(old.get("at", 0)) < FRESH_S:
        return {k: v for k, v in old.items() if k != "at"}
    fetch = fetch or _get
    events: list = []
    try:
        for page in (1, 2, 3):
            got = fetch(API.format(user=user, page=page))
            if not isinstance(got, list):
                break
            events += got
            if len(got) < 100:
                break
    except Exception as e:  # offline, rate-limited, renamed user: keep the last good answer
        if old and old.get("user") == user:
            return {**{k: v for k, v in old.items() if k != "at"}, "error": f"using the copy from {old.get('fetched')}: {type(e).__name__}"}
        return {"user": user, "fetched": None, "days": [], "error": f"could not reach GitHub: {type(e).__name__}"}
    out = {"user": user, "fetched": datetime.fromtimestamp(now, IST).isoformat(timespec="minutes"), "days": count_days(events)}
    try:
        cache.parent.mkdir(parents=True, exist_ok=True)
        cache.write_text(json.dumps({**out, "at": now}), encoding="utf-8")
    except OSError:
        pass
    return out
