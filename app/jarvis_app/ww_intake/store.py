"""The intake store (C02): what he pastes, a calendar file and the files of his watched folder, as rows with a state.

    IntakeStore(root)                     rows.json (atomic, one lock, schema version) and files/ (copies the app owns)
    default_store() -> IntakeStore        one per process at paths.DATA / "intake" (read on use, so tests can move it)
    store.add_paste(result)               rows from C01 parse_paste, state "new"; the same line twice adds nothing
    store.add_events(events, today)       rows from C01 parse_ics, state "new"; the same UID and start adds nothing
    store.add_file(name, data)            a copy the app owns, under files/, as a file row
    store.get / put / update / delete     by id; delete answers {"row": True, "file": bool}
    store.owned_path(row)                 the copy's real path, or None when it is not provably inside files/
    folder_rows(store, pyq_store)         the unread files of the watched folder as rows (computed, not stored)
    file_path(store, row, pyq_store)      the file a Take reads: an owned copy, or a direct child of the chosen folder
    suggest(title, subjects)              the best subject at 0.6 or more, shown and never applied by itself

IntakeRow (plan 9.2.5): {id, source: paste|ics|folder, kind: deadline|event|file, state: new|accepted|declined|taken,
title, date or null, time or null, readings, ambiguous, subject or "", subject_suggestion or null, repeats,
file: {name, size, owned} or null, raw, raw_hash, added, updated}. `raw` is the pasted line as he typed it (500
characters at most, so the desk can show what he pasted); "" for a calendar event or a file.

Rules that decided the shape:
- Nothing here writes to the date sheet, the calendar or the question store. A row is only a row; an accepted
  deadline is read back by R-42 and no other store is touched (plan 9.2.1 item 3).
- A duplicate is decided by a hash of what was read: the pasted line with the date it resolved to, or the
  event UID with its start. The row id is taken from that hash, so the same paste twice lands on the same id.
  The resolved date is in the hash because "quiz tomorrow" pasted a week later is a different deadline.
- Delete removes a file only when the row says owned AND its real path (links and junctions followed first)
  is a direct child of the real files/ folder AND files/ itself is not a link or junction. The name in
  rows.json is never trusted: "../x", a drive letter or a separator in it is refused before any path is
  built. Paths are compared after os.path.normcase, so odd casing on Windows neither escapes nor locks out.
- A folder row is computed on every read, because the folder is his and changes; it is stored only once he
  accepts, declines, takes or deletes it, so his decision survives the next scan. A deleted folder row is
  remembered in `dismissed` so it does not come back while his file stays where it is.
"""
from __future__ import annotations

import hashlib
import json
import os
import re
import stat as _stat
import threading
import time
import uuid
from datetime import date as _date
from datetime import datetime
from pathlib import Path
from typing import Any, Optional

from .match import match_name

SCHEMA_VERSION = 1
STATES = ("new", "accepted", "declined", "taken")
SOURCES = ("paste", "ics", "folder")
KINDS = ("deadline", "event", "file")
SUGGEST_AT = 0.6           # plan 9.2.5 and spec 21.4.3: a name match of 0.6 or more is offered, below is unmapped
MAX_TITLE = 200
MAX_SUBJECT = 120
MAX_RAW = 500          # a deadline line is 20 to 80 characters; 500 keeps a long pasted sentence whole and no page
MAX_FILE = 40 * 1024 * 1024    # the paper desk's upload cap (routes_ww_pyq_ingest.MAX_UPLOAD): a scanned 30-page paper is ~15 MB
MAX_NAME = 120
_FIXED = ("id", "source", "kind", "raw", "raw_hash", "added", "file")   # a row's identity: update() never changes these
_ID = re.compile(r"^i-[0-9a-f]{12}$")
_TIME = re.compile(r"^([01]\d|2[0-3]):[0-5]\d$")
_DEVICE = re.compile(r"^(?:con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\.|$)", re.I)   # Windows opens these names as devices
_REPLACE_TRIES = 8         # Windows can hold a target for a few ms (antivirus, an open reader)
_REPARSE = 0x400           # FILE_ATTRIBUTE_REPARSE_POINT: a junction is one, and os.path.islink misses it on 3.11


def _now() -> str:
    return datetime.now().isoformat(timespec="seconds")


def _hash(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def row_id(raw_hash: str) -> str:
    return "i-" + raw_hash[:12]


def valid_id(rid: Any) -> bool:
    return isinstance(rid, str) and bool(_ID.fullmatch(rid))


def check_date(v: Any) -> str:
    if not isinstance(v, str):
        raise ValueError("A date is written like 2026-11-18.")
    try:
        return _date.fromisoformat(v.strip()).isoformat()
    except ValueError:
        raise ValueError("A date is written like 2026-11-18.")


def check_time(v: Any) -> Optional[str]:
    if v in (None, ""):
        return None
    if not isinstance(v, str) or not _TIME.fullmatch(v.strip()):
        raise ValueError("A time is written like 17:30.")
    return v.strip()


def suggest(title: str, subjects: list[tuple[str, str]]) -> Optional[dict]:
    """The subject (id, name) whose name or id matches the title best, at 0.6 or more; None below that."""
    best: Optional[dict] = None
    for sid, name in subjects:
        s = max(match_name(title, name), match_name(title, sid))
        if s >= SUGGEST_AT and (best is None or s > best["score"]):
            best = {"subject": sid, "score": round(s, 3)}
    return best


def _is_link(p: Path) -> bool:
    """A symbolic link or a junction (any reparse point) at p itself; an unreadable p counts as a link."""
    try:
        st = os.lstat(p)
    except OSError:
        return True
    return _stat.S_ISLNK(st.st_mode) or bool(getattr(st, "st_file_attributes", 0) & _REPARSE)


def inside(base: Path, target: Path) -> bool:
    """True when target is a direct child of base, compared after normcase so case cannot fool it either way."""
    b = os.path.normcase(os.path.abspath(base))
    t = os.path.normcase(os.path.abspath(target))
    return os.path.normcase(os.path.dirname(t)) == b and t != b


def plain_name(name: Any) -> bool:
    """A bare file name: no separator, no drive, not . or .., no device name, no leading dot."""
    if not isinstance(name, str) or not name or len(name) > MAX_NAME + 13:
        return False
    if any(c in name for c in '/\\:\x00') or name in (".", "..") or name.startswith("."):
        return False
    return not _DEVICE.match(name) and name == name.strip()


class IntakeStore:
    def __init__(self, root: Path):
        self.root = Path(root)
        self.files = self.root / "files"
        self._lock = threading.RLock()
        self.problems: list[str] = []      # what was found broken and set aside; R-36 prints it
        self._kept: set[str] = set()       # set-aside notices: the only pointer at a copy he can recover, kept until
                                           # the process ends or he dismisses them (clear_problems), not by a clean read
        self.root.mkdir(parents=True, exist_ok=True)
        self.files.mkdir(parents=True, exist_ok=True)

    # ------------------------------------------------------------------ disk
    @property
    def _path(self) -> Path:
        return self.root / "rows.json"

    def _say(self, problem: str) -> None:
        if problem not in self.problems:
            self.problems.append(problem)

    def _load(self) -> dict:
        """The whole file; unknown keys are kept so a later wave's fields survive a round trip."""
        empty = {"version": SCHEMA_VERSION, "rows": [], "dismissed": []}
        try:
            raw = self._path.read_text(encoding="utf-8")
        except FileNotFoundError:
            return empty
        except OSError as e:
            self._say(f"rows.json could not be read ({type(e).__name__}).")
            return empty
        try:
            data = json.loads(raw)
            if not isinstance(data, dict):
                raise ValueError("wrong shape")
        except ValueError:
            # set aside, never overwritten silently: the next write would destroy what he can still recover
            aside = self._path.with_name(f"rows.json.{int(time.time())}.corrupt")
            try:
                os.replace(self._path, aside)
            except OSError:
                pass
            note = f"rows.json could not be parsed; kept beside it as {aside.name}."
            self._kept.add(note)
            self._say(note)
            return empty
        data["rows"] = [r for r in data.get("rows") or [] if isinstance(r, dict) and valid_id(r.get("id"))]
        mended = 0
        for r in data["rows"]:
            # every list sorts by `added` and filters by `state`: a row edited by hand without them raised KeyError,
            # which the routes answer as 404 for the whole list (found in review, 27 Nov). It is mended, not dropped.
            if not isinstance(r.get("added"), str) or not isinstance(r.get("state"), str):
                r["added"] = r["added"] if isinstance(r.get("added"), str) else ""
                r["state"] = r["state"] if isinstance(r.get("state"), str) else "new"
                mended += 1
        if mended:
            self._say(f"{mended} row(s) in rows.json had no date or state; they are listed first and as new.")
        else:
            # rows.json exists and reads cleanly: a fault found earlier is over, so its line goes (request 20: a
            # problem printed on every R-36 after the file was mended read as a fault that never ended). A missing
            # file does not count, because right after a corrupt file is set aside the notice must still show.
            # A set-aside notice stays: a fresh rows.json reads cleanly while the copy is still beside it.
            self.problems[:] = [p for p in self.problems if p in self._kept]
        data["dismissed"] = [d for d in data.get("dismissed") or [] if valid_id(d)]
        data.setdefault("version", SCHEMA_VERSION)
        return data

    def _save(self, data: dict) -> None:
        self._write_atomic(self._path, json.dumps(data, ensure_ascii=False, indent=1).encode("utf-8"))

    @staticmethod
    def _write_atomic(path: Path, blob: bytes) -> None:
        """A temporary file beside the target, then replace, so a reader sees all or nothing."""
        tmp = path.with_name(f".{path.name}.{uuid.uuid4().hex[:8]}.tmp")
        try:
            with open(tmp, "wb") as f:
                f.write(blob)
                f.flush()
                os.fsync(f.fileno())
            for i in range(_REPLACE_TRIES):
                try:
                    os.replace(tmp, path)
                    return
                except PermissionError:
                    if i == _REPLACE_TRIES - 1:
                        raise
                    time.sleep(0.02 * (i + 1))
        finally:
            try:
                tmp.unlink()
            except OSError:
                pass

    # ------------------------------------------------------------------ rows
    @staticmethod
    def make_row(*, source: str, kind: str, title: str, raw_hash: str, date: Optional[str] = None,
                 time_: Optional[str] = None, readings: Optional[list] = None, ambiguous: bool = False,
                 repeats: str = "none", file: Optional[dict] = None, raw: str = "") -> dict:
        now = _now()
        return {"id": row_id(raw_hash), "source": source, "kind": kind, "state": "new",
                "title": (title or "")[:MAX_TITLE], "date": date, "time": time_, "readings": list(readings or []),
                "ambiguous": bool(ambiguous), "subject": "", "subject_suggestion": None,
                "repeats": repeats, "file": file, "raw": (raw or "")[:MAX_RAW], "raw_hash": raw_hash,
                "added": now, "updated": now}

    def _add(self, rows: list[dict]) -> list[dict]:
        with self._lock:
            data = self._load()
            have = {r["id"] for r in data["rows"]}
            new = []
            for r in rows:
                if r["id"] in have:
                    continue
                have.add(r["id"])
                new.append(r)
            if new:
                data["rows"].extend(new)
                self._save(data)
            return [dict(r) for r in new]

    def add_paste(self, result: dict) -> list[dict]:
        """One deadline row per readable line of parse_paste; unread lines are the caller's to show."""
        rows = []
        for it in result["items"]:
            key = it["raw"] + "|" + ",".join(r["date"] for r in it["readings"])
            rows.append(self.make_row(
                source="paste", kind="deadline", title=it["title"] or it["raw"], raw_hash=_hash("paste|" + key),
                date=it["date"], time_=it["time"], readings=it["readings"], ambiguous=it["ambiguous"], raw=it["raw"]))
        return self._add(rows)

    def add_events(self, events: list[dict], today: Optional[str] = None) -> tuple[list[dict], int, int]:
        """(new rows, skipped, past). A skipped event could not be read; a past one ended before `today`
        (a semester export carries years of finished lectures, and a row for each would bury the new ones)."""
        rows, skipped, past = [], 0, 0
        for ev in events:
            if ev.get("status") != "ok" or not ev.get("start"):
                skipped += 1
                continue
            key = f"{ev['uid']}|{ev['start']}" if ev["uid"] else f"{ev['summary']}|{ev['start']}"
            if ev.get("due"):
                day, hhmm, kind = ev["due"][:10], ev["due"][11:16], "deadline"
            else:
                day, hhmm, kind = ev["local_date"], ev["start"][11:16], "event"
            if today and day and day < today:
                past += 1
                continue
            rows.append(self.make_row(
                source="ics", kind=kind, title=ev["summary"] or "(no title)", raw_hash=_hash("ics|" + key),
                date=day, time_=None if ev["all_day"] and not ev.get("due") else (hhmm or None),
                readings=[{"date": day, "order": ""}] if day else [], repeats=ev["repeats"]))
        return self._add(rows), skipped, past

    def add_file(self, name: str, data: bytes, source: str = "folder") -> dict:
        """A copy the app owns, under files/; only such a copy is ever deleted. ValueError for a bad name or size."""
        base = Path(str(name).replace("\\", "/")).name.strip()
        if not plain_name(base) or len(base) > MAX_NAME:
            raise ValueError("Give the file a plain name with no folder in it.")
        if len(data) > MAX_FILE:
            raise ValueError(f"A file is at most {MAX_FILE // (1024 * 1024)} MB.")
        if not data:
            raise ValueError("The file is empty.")
        digest = hashlib.sha256(data).hexdigest()
        stored = f"{digest[:12]}-{base}"
        with self._lock:
            self._write_atomic(self.files / stored, data)
            row = self.make_row(source=source, kind="file", title=base, raw_hash=_hash("file|" + digest),
                                file={"name": stored, "size": len(data), "owned": True})
            added = self._add([row])
        return added[0] if added else self.get(row["id"])

    def list_rows(self) -> list[dict]:
        with self._lock:
            return [dict(r) for r in self._load()["rows"]]

    def hidden(self) -> set[str]:
        with self._lock:
            return set(self._load()["dismissed"])

    def get(self, rid: str) -> dict:
        if not valid_id(rid):
            raise KeyError("No such row.")
        with self._lock:
            for r in self._load()["rows"]:
                if r["id"] == rid:
                    return dict(r)
        raise KeyError("No such row.")

    def clear_problems(self) -> None:
        """He dismissed the notices, the set-aside ones too."""
        with self._lock:
            self.problems.clear()
            self._kept.clear()

    @staticmethod
    def _expect(row: dict, expect) -> None:
        # checked under the lock, on the row as stored now: a take that finished after the caller read the row must not
        # be undone by an accept, a decline or a return to new
        if expect is not None and row.get("state") not in expect:
            raise ValueError("This file was already taken; delete the row instead." if row.get("state") == "taken"
                             else f"This row is {row.get('state')} now; look again.")

    def put(self, row: dict, expect: Optional[tuple] = None) -> dict:
        """Store (or replace) one row by id: how a computed folder row becomes a stored one. With `expect`, a row of
        that id already stored must be in one of those states."""
        if not valid_id(row.get("id")):
            raise KeyError("No such row.")
        with self._lock:
            data = self._load()
            for r in data["rows"]:
                if r["id"] == row["id"]:
                    self._expect(r, expect)
            data["rows"] = [r for r in data["rows"] if r["id"] != row["id"]] + [dict(row)]
            data["dismissed"] = [d for d in data["dismissed"] if d != row["id"]]
            self._save(data)
        return dict(row)

    def update(self, rid: str, changes: dict, expect: Optional[tuple] = None) -> dict:
        """Change one row; with `expect`, only while its state is one of those (checked under the lock)."""
        if not valid_id(rid):
            raise KeyError("No such row.")
        clean = {k: v for k, v in changes.items() if k not in _FIXED}
        with self._lock:
            data = self._load()
            for r in data["rows"]:
                if r["id"] == rid:
                    self._expect(r, expect)
                    r.update(clean)
                    r["updated"] = _now()
                    self._save(data)
                    return dict(r)
        raise KeyError("No such row.")

    def dismiss(self, rid: str) -> None:
        if not valid_id(rid):
            raise KeyError("No such row.")
        with self._lock:
            data = self._load()
            if rid not in data["dismissed"]:
                data["dismissed"].append(rid)
                self._save(data)

    # ------------------------------------------------------------------ files
    def owned_path(self, row: dict) -> Optional[Path]:
        """The real path of an owned copy, or None unless it provably is a file directly inside files/."""
        f = row.get("file")
        if not isinstance(f, dict) or f.get("owned") is not True or not plain_name(f.get("name")):
            return None
        if _is_link(self.files):
            return None                     # files/ swapped for a junction to his folder: own nothing
        try:
            base = Path(os.path.realpath(self.files))
            real = Path(os.path.realpath(self.files / f["name"]))   # links and junctions followed before the test
        except (OSError, ValueError):
            return None
        return real if inside(base, real) else None

    def delete(self, rid: str) -> dict:
        """Remove the row, and its file only when the app owns that copy. KeyError when there is no such row."""
        if not valid_id(rid):
            raise KeyError("No such row.")
        with self._lock:
            data = self._load()
            row = next((r for r in data["rows"] if r["id"] == rid), None)
            if row is None:
                raise KeyError("No such row.")
            data["rows"] = [r for r in data["rows"] if r["id"] != rid]
            removed_file = False
            target = self.owned_path(row)
            if target is not None:
                try:
                    if target.is_file() and not _is_link(target):
                        target.unlink()
                        removed_file = True
                except OSError:
                    pass                    # held open by a reader: the row goes, the copy waits for a later delete
            if row.get("source") == "folder" and not removed_file and rid not in data["dismissed"]:
                data["dismissed"].append(rid)   # his file stays; the row must not come back on the next scan
            self._save(data)
            return {"row": True, "file": removed_file}


_DEFAULTS: dict[str, IntakeStore] = {}
_DEFAULT_LOCK = threading.Lock()


def default_store() -> IntakeStore:
    """One store per process at paths.DATA / "intake"; paths.DATA is read here so a test can point it elsewhere."""
    from .. import paths
    root = Path(paths.DATA) / "intake"
    key = str(root)
    with _DEFAULT_LOCK:
        if key not in _DEFAULTS:
            _DEFAULTS[key] = IntakeStore(root)
        return _DEFAULTS[key]


def _folder_hash(name: str) -> str:
    return _hash("folder|" + name)


def folder_rows(store: IntakeStore, pyq_store) -> list[dict]:
    """Each unread file of the chosen folder as a row, not stored. Scanned now, never on a timer (E05)."""
    from ..ww_pyq import folder
    st = folder.get_folder(pyq_store)
    if not st.get("path") or not st.get("exists"):
        return []
    top = Path(st["path"])
    hidden = store.hidden()
    out = []
    for p in folder.pending_paths(pyq_store):
        p = Path(p)
        if p.parent != top or not plain_name(p.name):
            continue
        h = _folder_hash(p.name)
        if row_id(h) in hidden:
            continue
        try:
            size = p.stat().st_size
        except OSError:
            continue
        out.append(store.make_row(source="folder", kind="file", title=p.name, raw_hash=h,
                                  file={"name": p.name, "size": size, "owned": False}))
    return out


def file_path(store: IntakeStore, row: dict, pyq_store) -> Optional[Path]:
    """The file a Take reads, or None: an owned copy inside files/, or a plain file directly in the chosen folder."""
    f = row.get("file")
    if row.get("kind") != "file" or not isinstance(f, dict):
        return None
    if f.get("owned") is True:
        p = store.owned_path(row)
        return p if p is not None and p.is_file() else None
    if row.get("source") != "folder" or not plain_name(f.get("name")):
        return None
    from ..ww_pyq import folder
    st = folder.get_folder(pyq_store)
    if not st.get("path"):
        return None
    if str(st["path"]).replace("/", "\\").startswith("\\\\"):
        # UNC, extended-length and device paths: a stat on a UNC name opens SMB to that host and offers his login,
        # and the notes library's check_path does not refuse one, so it is refused here before any file call
        return None
    top = Path(st["path"])
    p = top / f["name"]
    if not inside(top, p) or _is_link(p) or not p.is_file():
        return None
    return p
