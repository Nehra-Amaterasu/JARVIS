"""The watched folder: one folder he points at, and the PDFs and decks in it that are not read yet.

No timer and no thread (plan 9.1.1 item 2): the folder is looked at when a route asks, so a
running app never wakes on its own. A file counts as read when its SHA-256 equals one on file, so
renaming or moving a file does not make it new and a changed file does.

Only files directly inside the chosen folder are listed. A symbolic link is skipped, because
following it could leave the folder he chose (acceptance 6); a name is never joined from outside
input, only from what the directory itself lists.
"""
from __future__ import annotations

import hashlib
import os
from datetime import datetime
from pathlib import Path
from typing import Optional

from .schema import FolderState
from .store import Store

SUFFIXES = (".pdf", ".pptx")
_CHUNK = 1 << 20


def _file(store: Store) -> Path:
    return store.root / "folder.json"


def _read(store: Store) -> dict:
    with store._lock:
        return store._load(_file(store), dict)


def _write(store: Store, data: dict) -> None:
    with store._lock:
        store._save(_file(store), data)


def _state(data: dict) -> FolderState:
    path = data.get("path") or None
    return {"path": path, "exists": bool(path and Path(path).is_dir()),
            "files_seen": int(data.get("files_seen") or 0),
            "pending_files": [str(n) for n in data.get("pending_files") or []],
            "last_scan": data.get("last_scan")}


def get_folder(store: Store) -> FolderState:
    """What was found at the last look; `exists` is checked now."""
    return _state(_read(store))


def set_folder(store: Store, path: Optional[str]) -> FolderState:
    if path is None:
        _write(store, {})
        return _state({})
    if not isinstance(path, str) or not path.strip():
        raise ValueError("Give the folder as a full path, or null to stop watching.")
    p = Path(path.strip())
    if not p.is_absolute():
        raise ValueError("The folder must be a full path, like C:\\Papers.")
    if p.parent == p:
        raise ValueError("Choose a folder, not a whole drive.")
    if not p.is_dir():
        raise ValueError("That is not a folder on this computer.")
    real = p.resolve()
    if real.parent == real:
        raise ValueError("Choose a folder, not a whole drive.")
    _write(store, {"path": str(real)})
    return scan(store)


def _sha(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for block in iter(lambda: f.read(_CHUNK), b""):
            h.update(block)
    return h.hexdigest()


def scan(store: Store) -> FolderState:
    """Look at the folder now. Hashes are remembered by (size, mtime) so a poll of an unchanged
    folder reads no file twice: a 40 MB paper hashes in about 0.1 s, a dozen of them on every
    screen refresh would not be free."""
    with store._lock:
        data = _read(store)
        path = data.get("path")
        now = datetime.now().isoformat(timespec="seconds")
        if not path:
            return _state(data)
        top = Path(path)
        if not top.is_dir():
            data.update(files_seen=0, pending_files=[], last_scan=now)
            _write(store, data)
            return _state(data)
        known = data.get("hashes") if isinstance(data.get("hashes"), dict) else {}
        hashes, seen, pending = {}, 0, []
        try:
            entries = sorted(os.scandir(top), key=lambda e: e.name.lower())
        except OSError:
            entries = []
        for e in entries:
            if Path(e.name).suffix.lower() not in SUFFIXES:
                continue
            try:
                if e.is_symlink() or not e.is_file(follow_symlinks=False):
                    continue
                st = e.stat(follow_symlinks=False)
            except OSError:
                continue
            seen += 1
            old = known.get(e.name)
            if isinstance(old, list) and len(old) == 3 and old[0] == st.st_size and old[1] == st.st_mtime_ns:
                sha = old[2]
            else:
                try:
                    sha = _sha(Path(e.path))
                except OSError:
                    continue                                    # held open by another program: seen, not offered
            hashes[e.name] = [st.st_size, st.st_mtime_ns, sha]
            if store.find_by_sha(sha) is None:
                pending.append(e.name)
        data.update(hashes=hashes, files_seen=seen, pending_files=pending, last_scan=now)
        _write(store, data)
        return _state(data)


def pending_paths(store: Store) -> list[Path]:
    """Full paths of the files to read next, each still a direct child of the chosen folder."""
    st = scan(store)
    if not st["path"]:
        return []
    top = Path(st["path"])
    return [top / n for n in st["pending_files"] if (top / n).parent == top]
