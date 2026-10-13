"""Data exports for memory: request them, bring the file in, see what is in it.

Yaadash is only as fresh as its last export. For each source the app:
  - opens the service's own export page in the browser. Aman requests it himself,
    signed in: the app never submits anything on his account;
  - says in one line what to ask for (the right format matters: an HTML export
    cannot be read);
  - takes the file when it arrives (dropped on the card, a path typed in, or picked
    from Downloads, where it usually lands) into DATA/imports/<source>/;
  - reads it in the background (yaadash/ingest_exports.py) and shows what is in it.

What is never claimed: that an export is "in memory" when no importer has put it
there. Instagram is the one source Yaadash already reads (yaadash_archive.py), so its
card says when the archive was last built and whether this export is newer.
"""
from __future__ import annotations

import os
import re
import shutil
import threading
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable, Optional

from .paths import DATA, DOWNLOADS, YAADASH_DATA, ensure_jarvis_importable

ensure_jarvis_importable()
import ingest_exports                      # noqa: E402  yaadash/ingest_exports.py

IMPORTS = DATA / "imports"
MAX_BYTES = 20 * 2**30                     # Instagram's export with media reaches several GB
DOWNLOADS_SCAN = 80                        # newest files in Downloads looked at
SAFE_NAME = re.compile(r"[^A-Za-z0-9._ \-()]+")


@dataclass(frozen=True)
class Source:
    id: str
    name: str
    url: str                                # the service's own page; opened, never filled in
    ask: str                                # what to request, in one line
    wait: str                               # how long it takes to arrive
    memory: str                             # what happens with it after


SOURCES = {s.id: s for s in (
    Source("instagram", "Instagram", "https://accountscenter.instagram.com/info_and_permissions/",
           "Download your information → Some of your information: Messages. Format JSON, date range All time.",
           "Hours to two days; Meta emails the link.",
           "Yaadash's archive reads it: rebuild memory after it arrives."),
    Source("chatgpt", "ChatGPT", "https://chatgpt.com/#settings/DataControls",
           "Settings → Data controls → Export data. The zip holds conversations.json.",
           "Minutes to a few hours by email; the link works for 24 hours.",
           "Read here: your messages, counted. The memory importer for it is the next step."),
    Source("spotify", "Spotify", "https://www.spotify.com/account/privacy/",
           "Download your data: tick Extended streaming history (every play since the account began).",
           "Up to 30 days; confirm the email Spotify sends first.",
           "Read here: plays and top artists. The taste importer for it is the next step."),
    Source("ytmusic", "YouTube Music", "https://takeout.google.com/",
           "Deselect all, tick YouTube and YouTube Music → only history; Multiple formats → History: JSON.",
           "Usually under an hour; Google emails the link.",
           "Read here: plays and top artists. The taste importer for it is the next step."),
)}

_jobs: dict[str, dict] = {}
_jobs_lock = threading.Lock()
_class_cache: dict[tuple, Optional[str]] = {}


def folder(source: str) -> Path:
    if source not in SOURCES:
        raise KeyError(source)
    return IMPORTS / source


def _job(source: str, **kw) -> None:
    with _jobs_lock:
        if kw:
            _jobs[source] = {**kw, "t": time.time()}
        else:
            _jobs.pop(source, None)


def safe_name(name: str) -> str:
    """A file name from the request, made harmless: its base name only, no path parts,
    no characters Windows or a shell would treat specially."""
    base = os.path.basename((name or "").replace("\\", "/"))
    base = SAFE_NAME.sub("_", base).strip(" .")
    if not base or not re.search(r"\.(zip|json)$", base, re.I):
        raise ValueError("Bring the export as the .zip (or .json) the service sent.")
    return base[:120]


def classify(path: Path) -> Optional[str]:
    try:
        st = path.stat()
    except OSError:
        return None
    key = (str(path), st.st_mtime_ns, st.st_size)
    if key not in _class_cache:
        try:
            _class_cache[key] = ingest_exports.classify(path)
        except Exception:
            _class_cache[key] = None
    return _class_cache[key]


# ---------------------------------------------------------------- reading what came in
def _summary_path(f: Path) -> Path:
    return f.parent / ".read" / (f.name + ".json")


def read_in_background(source: str, f: Path) -> None:
    def run():
        import json
        _job(source, state="reading", file=f.name)
        try:
            out = {"ok": True, **ingest_exports.read_export(source, f)}
        except Exception as e:
            out = {"ok": False, "error": str(e)[:300]}
        out.update(size=f.stat().st_size, mtime=f.stat().st_mtime, read_at=time.time())
        p = _summary_path(f)
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(json.dumps(out, ensure_ascii=False), encoding="utf-8")
        _job(source)
    threading.Thread(target=run, name=f"import-read-{source}", daemon=True).start()


def _summary(f: Path) -> Optional[dict]:
    import json
    p = _summary_path(f)
    try:
        s = json.loads(p.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None
    st = f.stat()
    return s if s.get("size") == st.st_size and s.get("mtime") == st.st_mtime else None


# ---------------------------------------------------------------- bringing a file in
def _check_kind(source: str, path: Path) -> None:
    got = classify(path)
    if got is None:
        raise ValueError(f"This does not look like a {SOURCES[source].name} export "
                         f"({SOURCES[source].ask.split('.')[0]}).")
    if got != source:
        raise ValueError(f"This is a {SOURCES[got].name} export: drop it on the {SOURCES[got].name} card.")


def save_stream(source: str, name: str, chunks: Iterable[bytes], length: Optional[int] = None) -> dict:
    """Write an upload to DATA/imports/<source>/<name>, then check what it is. A file
    that is not this source's export is removed again and the reason given."""
    target_dir = folder(source)
    fname = safe_name(name)
    if length is not None and length > MAX_BYTES:
        raise ValueError(f"{length / 2**30:.1f} GB is more than the {MAX_BYTES / 2**30:.0f} GB this takes.")
    incoming = target_dir / ".incoming"          # its own name kept: a loose JSON is known by it
    incoming.mkdir(parents=True, exist_ok=True)
    if length is not None and shutil.disk_usage(target_dir).free < length + 2**30:
        raise ValueError("Not enough free disk space for it (and 1 GB to spare).")
    part = incoming / fname
    written = 0
    try:
        with open(part, "wb") as out:
            for chunk in chunks:
                written += len(chunk)
                if written > MAX_BYTES:
                    raise ValueError(f"More than the {MAX_BYTES / 2**30:.0f} GB this takes.")
                out.write(chunk)
        _check_kind(source, part)
    except BaseException:
        part.unlink(missing_ok=True)
        raise
    final = target_dir / fname
    os.replace(part, final)
    read_in_background(source, final)
    return {"name": final.name, "size": written}


def import_path(source: str, raw: str) -> dict:
    """Copy an export that is already on disk (a .zip, a .json or an extracted folder)
    into DATA/imports/<source>/. Only a path Aman typed or picked from Downloads."""
    p = Path(os.path.expandvars(os.path.expanduser((raw or "").strip().strip('"'))))
    if not p.is_absolute():
        raise ValueError("Give the full path, e.g. C:\\Users\\you\\Downloads\\export.zip")
    if not p.exists():
        raise ValueError("Nothing is at that path.")
    if p.is_dir() and p.parent == p:
        raise ValueError("That is a whole drive, not an export.")
    if p.resolve().is_relative_to(IMPORTS.resolve()):
        raise ValueError("That is already in JARVIS's imports.")
    if p.is_file():
        safe_name(p.name)
    _check_kind(source, p)
    size = p.stat().st_size if p.is_file() else sum(f.stat().st_size for f in p.rglob("*") if f.is_file())
    if size > MAX_BYTES:
        raise ValueError(f"{size / 2**30:.1f} GB is more than the {MAX_BYTES / 2**30:.0f} GB this takes.")
    target_dir = folder(source)
    target_dir.mkdir(parents=True, exist_ok=True)
    if shutil.disk_usage(target_dir).free < size + 2**30:
        raise ValueError("Not enough free disk space for a copy (and 1 GB to spare).")
    dest = target_dir / (safe_name(p.name) if p.is_file() else SAFE_NAME.sub("_", p.name)[:120])

    def run():
        _job(source, state="copying", file=dest.name, size=size)
        try:
            if p.is_file():
                tmp = dest.with_name(dest.name + ".part")
                shutil.copyfile(p, tmp)
                os.replace(tmp, dest)
            else:
                shutil.copytree(p, dest, dirs_exist_ok=True)
        except Exception as e:
            _job(source, state="failed", file=dest.name, error=str(e)[:300])
            return
        _job(source)
        read_in_background(source, dest)
    threading.Thread(target=run, name=f"import-copy-{source}", daemon=True).start()
    return {"name": dest.name, "size": size, "copying": True}


# ---------------------------------------------------------------- what is there
def downloads_candidates(downloads: Optional[Path] = None) -> dict[str, list[dict]]:
    """Exports sitting in Downloads, by source (the newest files only, zip and json)."""
    out: dict[str, list[dict]] = {k: [] for k in SOURCES}
    downloads = downloads or DOWNLOADS
    try:
        files = [f for f in downloads.iterdir() if f.is_file() and f.suffix.lower() in (".zip", ".json")]
    except OSError:
        return out
    files.sort(key=lambda f: f.stat().st_mtime, reverse=True)
    for f in files[:DOWNLOADS_SCAN]:
        src = classify(f)
        if src in out:
            st = f.stat()
            out[src].append({"path": str(f), "name": f.name, "size": st.st_size, "mtime": st.st_mtime})
    return out


def archive_built() -> Optional[float]:
    """When Yaadash's message archive was last built (its parquet's mtime)."""
    try:
        return (YAADASH_DATA / "archive_msgs.parquet").stat().st_mtime
    except OSError:
        return None


def status(downloads: Optional[dict] = None) -> list[dict]:
    downloads = downloads if downloads is not None else downloads_candidates()
    with _jobs_lock:
        jobs = dict(_jobs)
    out = []
    for s in SOURCES.values():
        d = IMPORTS / s.id
        files = []
        if d.exists():
            for f in sorted(d.iterdir(), key=lambda f: f.stat().st_mtime, reverse=True):
                if f.name.startswith(".") or f.name.endswith((".part", ".check")):
                    continue
                st = f.stat()
                files.append({"name": f.name, "size": st.st_size if f.is_file() else None, "mtime": st.st_mtime,
                              "folder": f.is_dir(), "read": _summary(f) if f.is_file() else None})
        have = {(f["name"], f["size"]) for f in files}
        cands = [c for c in downloads.get(s.id, []) if (c["name"], c["size"]) not in have]
        entry = {"id": s.id, "name": s.name, "url": s.url, "ask": s.ask, "wait": s.wait, "memory": s.memory,
                 "files": files, "downloads": cands[:3], "job": jobs.get(s.id),
                 "state": "imported" if files else ("arrived" if cands else "not_requested")}
        if s.id == "instagram":
            built = archive_built()
            entry["archive_built"] = built
            newest = max((f["mtime"] for f in files), default=None)
            entry["archive_stale"] = bool(newest and (built is None or newest > built))
        out.append(entry)
    return out
