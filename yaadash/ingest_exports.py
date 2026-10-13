"""Reading the data exports Aman requests for memory: ChatGPT, Spotify, YouTube Music.

The first step of an ingest, and only that: each reader turns an export into plain
records (his own words, his plays), and `read_export` says what is in one: how many,
from when to when, the top artists. Nothing is written into Yaadash here. The memory
gets these when its importer for each source is built; until then the app shows what
was read, never a "remembered" it did not do. Instagram is not here: Yaadash's archive
(yaadash_archive.py) has read Instagram exports since 2026-08-31.

The formats, as the services document them (sources in docs/research/2026-10-13-
connect-and-system.md):
    ChatGPT        conversations.json (or numbered conversations-*.json): a list of
                   conversations, each a "mapping" of nodes whose message has an author
                   role, a create_time (epoch s) and content.parts (text strings)
    Spotify        Extended streaming history: Streaming_History_Audio_*.json, lists of
                   {ts (UTC, end of play), ms_played, master_metadata_track_name,
                   master_metadata_album_artist_name, ...}; track name null for
                   podcasts and some plays. Account data: StreamingHistory_music_*.json,
                   {endTime, artistName, trackName, msPlayed}.
    YouTube Music  Takeout history/watch-history.json: [{header: "YouTube Music",
                   title: "Watched <title>", subtitles: [{name: "<artist> - Topic"}],
                   time (ISO)}]; header "YouTube" for ordinary YouTube. HTML if the
                   default format was left: then there is nothing to read.
"""
from __future__ import annotations

import json
import re
import zipfile
from collections import Counter
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Callable, Iterable, Iterator, Optional

SKIP_MS = 30_000            # Spotify counts a stream from 30 s; shorter is a skip
MAX_JSON_BYTES = 400 * 2**20   # one JSON file is parsed whole; past this it is refused, not half-read

PATTERNS = {
    "chatgpt": re.compile(r"(^|/)conversations(-\d+)?\.json$", re.I),
    "spotify": re.compile(r"(^|/)(Streaming_History_(Audio|Video)_[^/]*|StreamingHistory(_music_|_podcast_)?\d*)\.json$", re.I),
    "ytmusic": re.compile(r"(^|/)watch-history\.(json|html)$", re.I),
    "instagram": re.compile(r"(^|/)messages/inbox/[^/]+/message_\d+\.(json|html)$", re.I),
}


def _iso(ts: float) -> str:
    return datetime.fromtimestamp(ts, timezone.utc).strftime("%Y-%m-%d")


def _parse_time(s) -> Optional[float]:
    if not s or not isinstance(s, str):
        return None
    s = s.strip().replace("Z", "+00:00")
    for fmt in (None, "%Y-%m-%d %H:%M"):
        try:
            dt = datetime.fromisoformat(s) if fmt is None else datetime.strptime(s, fmt)
            if dt.tzinfo is None:
                dt = dt.replace(tzinfo=timezone.utc)
            return dt.timestamp()
        except ValueError:
            continue
    return None


# ------------------------------------------------------------------ ChatGPT
def chatgpt_messages(conversations) -> Iterator[dict]:
    """His messages only (author role "user"), text parts joined, in no set order."""
    for conv in conversations if isinstance(conversations, list) else []:
        if not isinstance(conv, dict):
            continue
        title = conv.get("title") or ""
        for node in (conv.get("mapping") or {}).values():
            msg = (node or {}).get("message") or {}
            if ((msg.get("author") or {}).get("role")) != "user":
                continue
            parts = (msg.get("content") or {}).get("parts") or []
            text = " ".join(p for p in parts if isinstance(p, str)).strip()
            if not text:
                continue                          # an image or a file with no words
            yield {"ts": msg.get("create_time") or conv.get("create_time"), "conversation": title, "text": text}


# ------------------------------------------------------------------ Spotify
def spotify_plays(records) -> Iterator[dict]:
    """Music plays of 30 s or more. Both the extended and the account-data shapes."""
    for r in records if isinstance(records, list) else []:
        if not isinstance(r, dict):
            continue
        if "ms_played" in r:
            track, artist, ms, ts = (r.get("master_metadata_track_name"), r.get("master_metadata_album_artist_name"),
                                     r.get("ms_played"), _parse_time(r.get("ts")))
        else:
            track, artist, ms, ts = r.get("trackName"), r.get("artistName"), r.get("msPlayed"), _parse_time(r.get("endTime"))
        if not track or not artist or not isinstance(ms, (int, float)) or ms < SKIP_MS:
            continue                              # a podcast, an unnamed play, or a skip
        yield {"ts": ts, "track": track, "artist": artist, "ms": int(ms)}


# ------------------------------------------------------------------ YouTube Music
_TOPIC = re.compile(r"\s*-\s*Topic$")


def ytmusic_plays(entries) -> Iterator[dict]:
    """YouTube Music plays only (not ordinary YouTube watching)."""
    for e in entries if isinstance(entries, list) else []:
        if not isinstance(e, dict):
            continue
        if e.get("header") != "YouTube Music" and "music.youtube.com" not in (e.get("titleUrl") or ""):
            continue
        title = re.sub(r"^Watched\s+", "", e.get("title") or "").strip()
        if not title or title.startswith("https://"):
            continue                              # a removed video: Takeout keeps only its URL
        subs = e.get("subtitles") or []
        artist = _TOPIC.sub("", (subs[0] or {}).get("name", "")) if subs and isinstance(subs[0], dict) else ""
        yield {"ts": _parse_time(e.get("time")), "track": title, "artist": artist or None}


# ------------------------------------------------------------------ one export
READERS = {"chatgpt": chatgpt_messages, "spotify": spotify_plays, "ytmusic": ytmusic_plays}
CLASSIFY_MAX_NAMES = 50_000      # an Instagram export lists ~20k files; enough to decide


def classify_names(names: Iterable[str]) -> Optional[str]:
    """Which service an export is from, by the files it holds (most matches wins)."""
    hits: Counter = Counter()
    for i, n in enumerate(names):
        if i >= CLASSIFY_MAX_NAMES:
            break
        for src, rx in PATTERNS.items():
            if rx.search(n):
                hits[src] += 1
    return hits.most_common(1)[0][0] if hits else None


def classify(path: Path | str) -> Optional[str]:
    """The source of a zip, a folder or a loose JSON file, or None."""
    path = Path(path)
    if path.is_dir():
        return classify_names(p.relative_to(path).as_posix() for p in path.rglob("*") if p.is_file())
    if zipfile.is_zipfile(path):
        with zipfile.ZipFile(path) as z:
            return classify_names(z.namelist())
    return classify_names([path.name])


@contextmanager
def _members(path: Path, source: str) -> Iterator[list[tuple[str, int, Callable]]]:
    """(name, size, open) for each file of this source in a zip, a folder or a file.
    A zip is only opened: its central directory is read, nothing is extracted."""
    rx = PATTERNS[source]
    if path.is_dir():
        yield [(p.relative_to(path).as_posix(), p.stat().st_size, (lambda p=p: p.open("rb")))
               for p in sorted(path.rglob("*")) if p.is_file() and rx.search(p.relative_to(path).as_posix())]
    elif zipfile.is_zipfile(path):
        with zipfile.ZipFile(path) as z:
            yield [(i.filename, i.file_size, (lambda i=i: z.open(i))) for i in z.infolist() if rx.search(i.filename)]
    else:
        yield [(path.name, path.stat().st_size, (lambda: path.open("rb")))] if rx.search(path.name) else []


def read_export(source: str, path: Path | str) -> dict:
    """What is in one export: counts, dates, top artists. Raises ValueError when the
    export is not of this source or cannot be read as it is."""
    path = Path(path)
    if source not in PATTERNS:
        raise ValueError(f"unknown source {source!r}")
    with _members(path, source) as files:
        return _read(source, files)


def _read(source: str, files: list) -> dict:
    if source == "instagram":
        threads, html = set(), 0
        for name, _, _ in files:
            m = re.search(r"messages/inbox/([^/]+)/", name)
            threads.add(m.group(1) if m else name)
            html += name.lower().endswith(".html")
        if not threads:
            raise ValueError("No Instagram messages inside (messages/inbox/...).")
        out = {"threads": len(threads)}
        if html:
            out["warning"] = "This export is HTML. Yaadash reads JSON: request it again with Format: JSON."
        return out
    if not files:
        raise ValueError({"chatgpt": "No conversations.json inside.",
                          "spotify": "No streaming history files inside.",
                          "ytmusic": "No YouTube history inside (history/watch-history.json)."}[source])
    if all(n.lower().endswith(".html") for n, _, _ in files):
        return {"items": 0, "warning": "This is the HTML history. Request it again with History set to JSON "
                                      "(Takeout: Multiple formats -> History -> JSON)."}
    items: list[dict] = []
    for name, size, opener in files:
        if name.lower().endswith(".html"):
            continue
        if size > MAX_JSON_BYTES:
            raise ValueError(f"{name} is {size / 2**20:.0f} MB, more than this reader takes in one piece.")
        with opener() as f:
            try:
                data = json.load(f)
            except ValueError as e:
                raise ValueError(f"{name} is not valid JSON ({e}).")
        items.extend(READERS[source](data))
    return summarise(source, items, files=len(files))


def summarise(source: str, items: Iterable[dict], files: int = 1) -> dict:
    items = list(items)
    times = [i["ts"] for i in items if isinstance(i.get("ts"), (int, float))]
    out: dict = {"items": len(items), "files": files,
                 "first": _iso(min(times)) if times else None, "last": _iso(max(times)) if times else None}
    if source == "chatgpt":
        out["conversations"] = len({i["conversation"] for i in items})
        out["words"] = sum(len(i["text"].split()) for i in items)
    else:
        top = Counter(i["artist"] for i in items if i.get("artist")).most_common(5)
        out["top_artists"] = [{"artist": a, "plays": n} for a, n in top]
        if source == "spotify":
            out["hours"] = round(sum(i["ms"] for i in items) / 3_600_000, 1)
    return out
