"""/api/mission/intake: what he brings in by hand, as rows he accepts, declines, takes or deletes (ww_intake/store.py).

    GET     /api/mission/intake?state=&source=       R-36 the rows: pasted lines, calendar events, files of the watched folder
    POST    /api/mission/intake/paste                R-37 {text} (20,000 characters at most): one line, one row, state "new"; unreadable lines in `unread`
    POST    /api/mission/intake/ics                  R-38 the raw text/calendar body (2 MB at most): one row per event, state "new"
    PATCH   /api/mission/intake/{id}                 R-39 {state: accepted|declined, title?, date?, time?, subject?}
    POST    /api/mission/intake/{id}/take            R-40 {to: papers|notes}: a file row goes to the paper desk's or the notes library's reading job
    DELETE  /api/mission/intake/{id}                 R-41 the row, and its file only when it is a copy the app owns under intake/files/
    GET     /api/mission/intake/deadlines?from=&to=  R-42 accepted rows with a date, for the Life calendar

Every JSON answer is {state, reason, source, ...} (ww_pyq/api.py): KeyError is 404, ValueError 400, Busy 409.
The parsers are C01 (ww_intake), the folder is E05 (ww_pyq/folder.py, scanned when R-36 asks, no timer), the
readers are the paper desk's IngestJob (app.state.pyq_ingest) and the library's (app.state.library_jobs), looked
up when a request arrives because this module may register before theirs. Nothing here writes to the date sheet,
the calendar or the question store: accepting a row only changes the row, and R-42 reads accepted rows back.
A subject suggestion (name match at 0.6 or more against the plan's subjects) is shown and never applied, and an
ambiguous date cannot be accepted until he gives the date. His own folders are never written or deleted.
"""
from __future__ import annotations

from datetime import datetime
from typing import Any, Optional

from fastapi import Body, FastAPI, HTTPException, Request
from starlette.concurrency import run_in_threadpool

from .ww_intake import parse_ics, parse_paste
from .ww_intake import ics as ics_mod
from .ww_intake import store as intake_store
from .ww_pyq import api
from .ww_pyq import store as pyq_store_mod

SOURCE = "what you brought in"
MAX_PASTE = 20000              # characters (plan 9.2.5): a term's deadline list is a few hundred; 20,000 is a pasted page
MAX_ICS = 2 * 1024 * 1024      # bytes (plan 9.2.5): a semester calendar export is 20 to 200 KB
MAX_ICS_RULES = 500            # RRULE lines: each open daily repeat expands to 121 rows in C01's 120-day window, and
                               # 45 KB of 500 such repeats parsed into 60,500 events (40 MB, 7.7 s, 27 Nov); 2 MB of them
                               # would be ~2.7 million rows on a machine already short of memory. A term has tens.
_STATES = intake_store.STATES
_SOURCES = intake_store.SOURCES


def _now() -> datetime:
    """The clock the parsers resolve relative dates against, in the local zone; a test replaces it."""
    return datetime.now().astimezone()


def _store() -> intake_store.IntakeStore:
    return intake_store.default_store()


def _pyq():
    return pyq_store_mod.default_store()


def _plural(n: int, one: str, many: str) -> str:
    return f"{n} {one if n == 1 else many}"


def _body(body: Any) -> dict:
    if not isinstance(body, dict):
        raise ValueError("Send a JSON object.")
    return body


def _subjects(svc) -> list[tuple[str, str]]:
    """(id, name) of the plan's subjects; none when the plan store is not up, so the rows still list."""
    plan = getattr(svc, "plan", None)
    if plan is None:
        return []
    try:
        subs = (plan.academics() or {}).get("subjects") or []
    except Exception:          # a broken plan file must not take the intake list down
        return []
    out = []
    for s in subs:
        if isinstance(s, dict) and (s.get("id") or s.get("name")):
            out.append((str(s.get("id") or s.get("name")), str(s.get("name") or s.get("id"))))
    return out


def _view(row: dict, subjects: list[tuple[str, str]]) -> dict:
    """The row as the screen sees it: a suggestion is computed now, for a row with no subject chosen, and never stored."""
    out = dict(row)
    out["subject_suggestion"] = None
    if not out.get("subject") and out.get("kind") != "file":
        out["subject_suggestion"] = intake_store.suggest(out.get("title") or "", subjects)
    return out


def register(app: FastAPI, svc, bus) -> None:
    def all_rows() -> list[dict]:
        st = _store()
        stored = st.list_rows()
        have = {r["id"] for r in stored}
        try:
            scanned = [r for r in intake_store.folder_rows(st, _pyq()) if r["id"] not in have]
        except OSError:
            scanned = []                 # a folder that vanished mid-scan must not take the whole list down
        rows = stored + scanned
        rows.sort(key=lambda r: (r["added"], r["id"]))
        return rows

    def find(rid: str) -> tuple[dict, bool]:
        """(row, stored). A folder row that is not stored yet is found by scanning; anything else is 404."""
        if not intake_store.valid_id(rid):
            raise KeyError("No such row.")
        st = _store()
        try:
            return st.get(rid), True
        except KeyError:
            pass
        for r in intake_store.folder_rows(st, _pyq()):
            if r["id"] == rid:
                return r, False
        raise KeyError("No such row.")

    def save(row: dict, stored: bool, changes: dict) -> dict:
        if stored:
            return _store().update(row["id"], changes)
        return _store().put({**row, **changes, "updated": intake_store._now()})

    # ------------------------------------------------------------------ R-36
    @app.get("/api/mission/intake")
    async def list_intake(state: Optional[str] = None, source: Optional[str] = None):
        def work():
            if state not in (None, "") and state not in _STATES:
                raise ValueError(f"The state is one of {', '.join(_STATES)}.")
            if source not in (None, "") and source not in _SOURCES:
                raise ValueError(f"The source is one of {', '.join(_SOURCES)}.")
            rows = all_rows()
            if state:
                rows = [r for r in rows if r["state"] == state]
            if source:
                rows = [r for r in rows if r["source"] == source]
            subs = _subjects(svc)
            problems = list(_store().problems)
            if not rows:
                if problems:
                    return api.items([], "fault", problems[-1], SOURCE, problems=problems)
                return api.items([], "waiting", "Nothing brought in yet.", SOURCE)
            return api.items([_view(r, subs) for r in rows], "live", f"{_plural(len(rows), 'row', 'rows')} brought in.",
                             SOURCE, **({"problems": problems} if problems else {}))
        return await run_in_threadpool(api.guard, work)

    # ------------------------------------------------------------------ R-42 (registered before the {id} routes)
    @app.get("/api/mission/intake/deadlines")
    async def deadlines(request: Request):
        def work():
            q = request.query_params
            lo = intake_store.check_date(q["from"]) if q.get("from") else None
            hi = intake_store.check_date(q["to"]) if q.get("to") else None
            if lo and hi and lo > hi:
                raise ValueError("The range starts after it ends.")
            rows = [r for r in _store().list_rows()
                    if r["state"] == "accepted" and r.get("date") and r.get("kind") != "file"
                    and (lo is None or r["date"] >= lo) and (hi is None or r["date"] <= hi)]
            rows.sort(key=lambda r: (r["date"], r.get("time") or "99:99", r["id"]))
            out = [{"id": r["id"], "title": r["title"], "date": r["date"], "time": r.get("time") or None,
                    "subject": r.get("subject") or "", "source": r["source"]} for r in rows]
            if not out:
                return api.items([], "waiting", "No accepted deadlines in that range.", SOURCE)
            return api.items(out, "live", f"{_plural(len(out), 'deadline', 'deadlines')} you accepted.", SOURCE)
        return await run_in_threadpool(api.guard, work)

    # ------------------------------------------------------------------ R-37
    @app.post("/api/mission/intake/paste")
    async def paste(body: Any = Body(None)):
        def work():
            text = _body(body).get("text")
            if not isinstance(text, str) or not text.strip():
                raise ValueError("Paste at least one line.")
            if len(text) > MAX_PASTE:
                raise ValueError(f"Paste at most {MAX_PASTE:,} characters at a time; this was {len(text):,}.")
            res = parse_paste(text, _now())
            new = _store().add_paste(res)
            subs = _subjects(svc)
            dup = len(res["items"]) - len(new)
            reason = f"{_plural(len(new), 'new row', 'new rows')} from your lines"
            if dup:
                reason += f"; {_plural(dup, 'line was', 'lines were')} already here"
            if res["unread"]:
                reason += f"; {_plural(len(res['unread']), 'line', 'lines')} could not be read"
            unread = [{"line": u["line"], "text": u["raw"], "reason": u["reason"]} for u in res["unread"]]
            return api.items([_view(r, subs) for r in new], "live", reason + ".", SOURCE, unread=unread)
        return await run_in_threadpool(api.guard, work)

    # ------------------------------------------------------------------ R-38
    @app.post("/api/mission/intake/ics")
    async def ics(request: Request):
        too_big = f"A calendar file is at most {MAX_ICS // (1024 * 1024)} MB."
        size = request.headers.get("content-length")
        if size is not None and size.strip().isdigit() and int(size) > MAX_ICS:
            raise HTTPException(413, too_big)
        buf = bytearray()
        async for chunk in request.stream():
            buf += chunk
            if len(buf) > MAX_ICS:           # the header was missing or lied: stop reading at the cap
                raise HTTPException(413, too_big)

        def work():
            text = bytes(buf).decode("utf-8-sig", errors="replace")
            if "BEGIN:VCALENDAR" not in text.upper():
                raise ValueError("That does not look like a calendar file (.ics).")
            # counted with C01's own unfolding and property reader, so a folded "RR\r\n ULE" is counted too
            rules = sum(1 for ln in ics_mod._unfold(text) if (p := ics_mod._parse_prop(ln)) and p[0] == "RRULE")
            if rules > MAX_ICS_RULES:
                raise ValueError(f"This calendar has {rules:,} repeating events; I take at most {MAX_ICS_RULES} "
                                 "at a time. Export a shorter range.")
            now = _now()
            events = parse_ics(text, now)
            new, skipped, past = _store().add_events(events, today=now.date().isoformat())
            subs = _subjects(svc)
            reason = f"{_plural(len(new), 'new row', 'new rows')} from the calendar"
            if past:
                reason += f"; {_plural(past, 'event', 'events')} already over, left out"
            if skipped:
                reason += f"; {_plural(skipped, 'event', 'events')} could not be read"
            return api.items([_view(r, subs) for r in new], "live", reason + ".", SOURCE, skipped=skipped, past=past)
        return await run_in_threadpool(api.guard, work)

    # ------------------------------------------------------------------ R-39
    @app.patch("/api/mission/intake/{rid}")
    async def patch(rid: str, body: Any = Body(None)):
        def work():
            b = _body(body)
            row, stored = find(rid)
            new_state = b.get("state")
            if new_state not in ("accepted", "declined"):
                raise ValueError("The state is accepted or declined.")
            if row["state"] == "taken":
                raise ValueError("This file was already taken; delete the row instead.")
            ch: dict = {"state": new_state}
            if "title" in b:
                t = b["title"]
                if not isinstance(t, str) or not t.strip():
                    raise ValueError("The title cannot be empty.")
                ch["title"] = t.strip()[:intake_store.MAX_TITLE]
            if b.get("date") not in (None, ""):
                if row.get("kind") == "file":
                    raise ValueError("A file row has no date.")
                ch["date"] = intake_store.check_date(b["date"])
                ch["ambiguous"] = False          # he gave the date: the two readings stay for the record
            if "time" in b:
                ch["time"] = intake_store.check_time(b["time"])
            if "subject" in b:
                s = b["subject"]
                if s is not None and not isinstance(s, str):
                    raise ValueError("The subject is a name.")
                ch["subject"] = (s or "").strip()[:intake_store.MAX_SUBJECT]
            if new_state == "accepted" and row.get("ambiguous") and "date" not in ch:
                raise ValueError("This date can be read two ways; give the date before accepting.")
            out = save(row, stored, ch)
            return api.ok("live", f"Row {new_state}.", SOURCE, row=_view(out, _subjects(svc)))
        return await run_in_threadpool(api.guard, work)

    # ------------------------------------------------------------------ R-40
    @app.post("/api/mission/intake/{rid}/take")
    async def take(rid: str, body: Any = Body(None)):
        def work():
            b = _body(body)
            row, stored = find(rid)
            to = b.get("to")
            if to not in ("papers", "notes"):
                raise ValueError("Take it to papers or to notes.")
            if row.get("kind") != "file" or not isinstance(row.get("file"), dict):
                raise ValueError("Only a file can be taken; this row is a date.")
            path = intake_store.file_path(_store(), row, _pyq())
            if path is None:
                raise KeyError("That file is not there any more.")
            if to == "papers":
                from .routes_ww_pyq_ingest import _meta, check_path
                jobs = getattr(app.state, "pyq_ingest", None)
                if jobs is None:
                    raise HTTPException(503, "The paper desk is not up yet.")
                meta = _meta({"subject": row.get("subject") or None, "source_note": "brought in by hand"})
                job = jobs.start([check_path(str(path))], store=_pyq(), meta=meta)      # Busy is 409
            else:
                from .routes_library import check_path as lib_check
                jobs = getattr(app.state, "library_jobs", None)
                if jobs is None:
                    raise HTTPException(503, "The notes library is not up yet.")
                p = lib_check(str(path))
                if not p.is_file():
                    raise ValueError("Only one file can be taken.")
                try:
                    job = jobs.start(str(p))
                except RuntimeError as e:          # the library's own one-job rule
                    raise api.Busy(str(e))
            out = save(row, stored, {"state": "taken"})
            where = "the paper desk" if to == "papers" else "your notes"
            return api.ok("live", f"Reading {path.name} into {where}.", SOURCE, row=_view(out, _subjects(svc)), job=job)
        return await run_in_threadpool(api.guard, work)

    # ------------------------------------------------------------------ R-41
    @app.delete("/api/mission/intake/{rid}")
    async def delete(rid: str):
        def work():
            row, stored = find(rid)
            st = _store()
            if stored:
                removed = st.delete(rid)
            else:
                st.dismiss(row["id"])             # a folder row not stored yet: hidden from the list, his file stays
                removed = {"row": True, "file": False}
            reason = "Row removed and the app's copy deleted." if removed["file"] else "Row removed."
            return api.ok("live", reason, SOURCE, removed=removed)
        return await run_in_threadpool(api.guard, work)
