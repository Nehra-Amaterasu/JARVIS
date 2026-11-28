"""/api/mission/pyq/takeout: a Classroom export .zip he made himself, listed first and read only on his word (ww_pyq/takeout.py).

    POST   /api/mission/pyq/takeout                         R-46 {path} (an absolute .zip) or the raw zip body with ?name=: list it, extract nothing
    POST   /api/mission/pyq/takeout/{id}/accept             R-47 {entries: [name]}: extract only those pdf and pptx entries into the inbox and read them

Every JSON answer is {state, reason, source, ...} (ww_pyq/api.py). R-46 copies the archive to takeout/<id>.zip under the
store root (500 MB at most, refused by Content-Length first and again at the cap while reading) and lists it from the
central directory with zipfile alone: nothing is inflated, nothing is written but the copy and takeout/<id>.json. Only the
last 3 listings are kept (an export can be 500 MB and the disk is small; an older listing answers 404 and is listed
again). R-47 opens that copy, extracts the accepted entries one by one with a byte cap equal to each declared size,
writes them to the store's inbox under names the code makes, and starts the one ingest job (409 while one runs, with
nothing left behind). An id is checked against tk-<10 hex> before it touches a path. Nothing here predicts a paper or a
result.
"""
from __future__ import annotations

import json
import os
import re
import zipfile
from pathlib import Path
from typing import Optional

from fastapi import Body, FastAPI, HTTPException, Request
from starlette.concurrency import run_in_threadpool

from .ww_pyq import api, ingest, takeout
from .ww_pyq import store as store_mod

SOURCE = "your Classroom export"
KEEP_LISTINGS = 3                  # each listing keeps its zip copy (up to 500 MB); three is a retry and a second export
# used with fullmatch: "$" alone also matches before a final newline
_NAME = re.compile(r"^[A-Za-z0-9][A-Za-z0-9 ._()-]{0,119}\.zip$")
_DEVICE = re.compile(r"^(?:con|prn|aux|nul|com[0-9]|lpt[0-9])\s*(?:\.|$)", re.I)


def _store():
    return store_mod.default_store()


def _dir(st) -> Path:
    d = st.root / "takeout"
    d.mkdir(parents=True, exist_ok=True)
    return d


def _check_id(raw) -> str:
    if not isinstance(raw, str) or not takeout.ID_RE.fullmatch(raw):
        raise KeyError("No such export listing.")
    return raw


def check_zip_path(raw) -> Path:
    """The .zip he typed: absolute, on this PC, there, a file, not a whole drive (the routes_ww_pyq_ingest.check_path rule)."""
    if not isinstance(raw, str) or not raw.strip():
        raise ValueError("Give the full path of a .zip file on this PC.")
    text = raw.strip().strip('"').strip("'")
    if text.replace("/", "\\").startswith("\\\\"):
        # a UNC name makes exists() open an SMB connection (and offer his Windows login) before any check could say no
        raise ValueError("Give a file on this PC, not a network or device path.")
    p = Path(text)
    if not p.is_absolute():
        raise ValueError("Give the full path of the file, like D:\\Exports\\classroom.zip.")
    if p.parent == p or p.resolve().parent == p.resolve():
        raise ValueError("That is a whole drive; give the .zip file.")
    if not p.exists():
        raise ValueError("There is no file at that path.")
    if not p.is_file():
        raise ValueError("That is a folder; give the .zip file.")
    if p.suffix.lower() != ".zip":
        raise ValueError(f"I read .zip exports; {p.suffix or 'this file'} is not one.")
    return p


def _too_big() -> HTTPException:
    return HTTPException(413, f"An export is at most {takeout.MAX_ARCHIVE // (1024 * 1024)} MB.")


def _capped_copy(src: Path, tmp: Path) -> None:
    """Copy with the 500 MB cap counted while copying: the size checked a moment ago can grow (a download still running)."""
    n = 0
    with open(src, "rb") as f, open(tmp, "xb") as out:
        while chunk := f.read(takeout.CHUNK):
            n += len(chunk)
            if n > takeout.MAX_ARCHIVE:
                raise _too_big()
            out.write(chunk)


def _prune(d: Path) -> None:
    """Keep the newest KEEP_LISTINGS listings and their copies."""
    olds = sorted(d.glob("tk-*.json"), key=lambda p: p.stat().st_mtime, reverse=True)[KEEP_LISTINGS:]
    for j in olds:
        if takeout.ID_RE.fullmatch(j.stem):
            (d / f"{j.stem}.zip").unlink(missing_ok=True)
            j.unlink(missing_ok=True)


def _finish(st, tmp: Path, name: str) -> dict:
    """tmp holds a copy of the archive: list it, keep it as takeout/<id>.zip, record the listing."""
    d = _dir(st)
    try:
        listing = takeout.list_archive(tmp)
        aid = takeout.new_id()
        os.replace(tmp, d / f"{aid}.zip")
    finally:
        tmp.unlink(missing_ok=True)
    listing = {"id": aid, "name": name, **listing}
    (d / f"{aid}.json").write_text(json.dumps(listing, indent=1), encoding="utf-8")
    _prune(d)
    ok_n = sum(1 for e in listing["entries"] if e["refused"] is None and e["kind"] != "other")
    # an entry the door does not read carries a sentence too, but it is not refused for being hostile: counted apart
    bad_n = sum(1 for e in listing["entries"] if e["refused"] is not None and e["kind"] != "other")
    reason = (f"Listed {len(listing['entries'])} files in {name}: {ok_n} papers or decks you can read"
              + (f", {bad_n} refused" if bad_n else "") + ". Nothing was extracted.")
    return api.ok("live", reason, SOURCE, listing=listing)


def _load(st, aid: str) -> dict:
    d = _dir(st)
    f = d / f"{_check_id(aid)}.json"
    if not f.is_file() or not (d / f"{aid}.zip").is_file():
        raise KeyError("No such export listing.")
    listing = json.loads(f.read_text(encoding="utf-8"))
    takeout.mend_entries(listing.get("entries") or [])
    return listing


def _accept(st, listing: dict, names, runner: ingest.IngestJob) -> dict:
    if not isinstance(names, list) or not names or any(not isinstance(n, str) for n in names):
        raise ValueError("Give entries: the names of the files to read, from the listing.")
    by_name = {e["name"]: e for e in listing["entries"]}
    wanted = list(dict.fromkeys(names))
    for n in wanted:
        e = by_name.get(n)
        if e is None:
            raise ValueError(f"{n} is not in this listing.")
        if e["refused"] and e["refused"] != takeout.NOT_READ:      # a hostile name says so before its kind
            raise ValueError(f"{n} was refused: {e['refused']}")
        if e["kind"] == "other":
            raise ValueError(f"{n} is not a .pdf or .pptx; I read only those.")
    if runner.running():
        raise api.Busy("Already reading files; wait for that to finish.")
    inbox = st.paths.inbox.resolve()
    # a second accept from one listing numbers on after the first, so "A/x y.pdf" then "B/x-y.pdf" (both x-y) get
    # two names; extract_entry still refuses to write over anything
    pat = re.compile(rf"^{re.escape(listing['id'])}-(\d+)-")
    first = 1 + max((int(m.group(1)) for p in inbox.glob(f"{listing['id']}-*") if (m := pat.match(p.name))), default=0)
    written: list[Path] = []
    total = 0
    try:
        with zipfile.ZipFile(_dir(st) / f"{listing['id']}.zip") as zf:
            infos: dict[str, list[zipfile.ZipInfo]] = {}
            for i in zf.infolist():
                infos.setdefault(i.filename, []).append(i)
            for k, n in enumerate(wanted, first):
                found = infos.get(n) or []
                if len(found) != 1 or found[0].file_size != by_name[n]["size"]:
                    raise ValueError(f"{n} changed since it was listed; list the export again.")
                dest = inbox / takeout.safe_flat_name(listing["id"], k, n)
                if dest.parent != inbox:                 # the name is the code's own; this holds it to the inbox anyway
                    raise ValueError(f"{n} could not be placed in the inbox.")
                total += takeout.extract_entry(zf, found[0], dest)
                written.append(dest)
                if total > takeout.MAX_DECLARED:         # the declared sums were checked; this counts real bytes
                    raise ValueError("The accepted files inflate past the archive limit.")
        job = runner.start(written, store=st, meta={"source_note": f"Classroom export {listing['name']}"[:500]})
    except BaseException:
        for p in written:                                # nothing half-extracted stays in the inbox
            p.unlink(missing_ok=True)
        raise
    m = len(written)
    return api.ok("live", f"Reading {m} {'file' if m == 1 else 'files'} from {listing['name']}.", SOURCE, job=job)


def register(app: FastAPI, svc, bus) -> None:
    def jobs() -> ingest.IngestJob:
        j = getattr(app.state, "pyq_ingest", None)
        if j is None:                                  # the ingest feature is not mounted: own one job slot, same class
            j = app.state.pyq_ingest = ingest.IngestJob(bus)
        return j

    # ------------------------------------------------------------------ R-46
    @app.post("/api/mission/pyq/takeout")
    async def takeout_list(request: Request, name: Optional[str] = None):
        ctype = request.headers.get("content-type", "")
        if ctype.split(";")[0].strip().lower() == "application/json":
            try:
                body = await request.json()
            except ValueError:
                raise HTTPException(400, "Send {path} or the raw bytes of a .zip.")
            if not isinstance(body, dict):
                raise HTTPException(400, "Send {path} or the raw bytes of a .zip.")

            def from_path():
                src = check_zip_path(body.get("path"))
                if src.stat().st_size > takeout.MAX_ARCHIVE:
                    raise _too_big()
                st = _store()
                tmp = _dir(st) / f".{takeout.new_id()}.part"
                try:
                    _capped_copy(src, tmp)
                    return _finish(st, tmp, src.name)
                finally:
                    tmp.unlink(missing_ok=True)
            return await run_in_threadpool(api.guard, from_path)

        def check_name() -> str:
            if not isinstance(name, str) or not _NAME.fullmatch(name) or _DEVICE.match(name):
                raise ValueError("Give the file a plain name ending in .zip, with no folder in it.")
            return name
        fname = api.guard(check_name)
        size = request.headers.get("content-length")
        if size is not None and size.strip().isdigit() and int(size) > takeout.MAX_ARCHIVE:
            raise _too_big()
        st = _store()
        tmp = _dir(st) / f".{takeout.new_id()}.part"
        n = 0
        head = b""
        try:
            with open(tmp, "xb") as f:
                async for chunk in request.stream():
                    n += len(chunk)
                    if n > takeout.MAX_ARCHIVE:        # the header was missing or lied: stop at the cap
                        raise _too_big()
                    if len(head) < 4:
                        head = (head + chunk)[:4]
                    f.write(chunk)
            if n == 0:
                raise HTTPException(400, "The file is empty.")
            if not head.startswith(b"PK"):
                raise HTTPException(400, "This is not a .zip file inside.")
            return await run_in_threadpool(api.guard, _finish, st, tmp, fname)
        finally:
            tmp.unlink(missing_ok=True)

    # ------------------------------------------------------------------ R-47
    @app.post("/api/mission/pyq/takeout/{id}/accept")
    async def takeout_accept(id: str, body: dict = Body(...)):
        def work():
            st = _store()
            return _accept(st, _load(st, id), body.get("entries"), jobs())
        return await run_in_threadpool(api.guard, work)
