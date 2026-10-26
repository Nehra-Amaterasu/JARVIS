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


# ------------------------------------------------------------------ local commits (work sessions)
def local_commits(repos: list[dict], since_days: int = 14, run: Optional[Callable] = None) -> list[dict]:
    """Commits from local git repos for ww_sessions: [{sha, ts, repo, subject, url}].
    Reads `git log` on the checked-out branch only; a missing or broken repo is
    skipped, never an error. Nothing leaves the laptop."""
    import subprocess
    run = run or (lambda args, cwd: subprocess.run(args, cwd=cwd, capture_output=True, text=True, encoding="utf-8",
                                                   timeout=10, check=False).stdout)
    out: list[dict] = []
    for r in repos:
        path = Path(r.get("path") or "")
        if not (path / ".git").exists():
            continue
        try:
            text = run(["git", "log", f"--since={since_days} days ago", "--format=%H%x1f%at%x1f%s"], str(path))
        except Exception:
            continue
        for line in (text or "").splitlines():
            parts = line.split("\x1f")
            if len(parts) != 3 or not parts[1].isdigit():
                continue
            url = f"{r['url'].rstrip('/')}/commit/{parts[0]}" if r.get("url") else None
            out.append({"sha": parts[0], "ts": int(parts[1]), "repo": r.get("name") or path.name, "subject": parts[2], "url": url})
    return out
