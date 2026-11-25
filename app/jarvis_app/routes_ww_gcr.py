"""/api/mission/gcr: the Google link's HTTP face (ww_gcr/): sign-in, a sync of his Classroom files, and the hand-off of test papers.

    GET    /api/mission/gcr/status                     G-01 sign-in state, scopes, counts, the sync job; never a token or an address
    POST   /api/mission/gcr/connect                    G-02 opens the browser sign-in in one background thread; 409 while one waits
    POST   /api/mission/gcr/disconnect                 G-03 revokes and forgets the sign-in; files already on disk stay
    POST   /api/mission/gcr/sync                       G-04 {courses?} starts the sync job; 409 when busy, 400 when not connected
    GET    /api/mission/gcr/sync                       G-05 the job: status (idle, running, done, failed, stopped), text, counts, fault_lines
    GET    /api/mission/gcr/courses                    G-06 the courses read, with file, note and paper counts
    PATCH  /api/mission/gcr/courses/{cid}              G-07 {subject?, include?}: the subject by hand, and whether a sync reads the course
    GET    /api/mission/gcr/files?course=&kind=&q=     G-08 the files, newest first
    PATCH  /api/mission/gcr/files/{fid}                G-09 {kind}: notes, paper or other, by hand
    GET    /api/mission/gcr/files/{fid}/note           G-10 the Markdown note of a file
    GET    /api/mission/gcr/files/{fid}/original      G-11 the original bytes, inline
    POST   /api/mission/gcr/files/{fid}/open           G-12 opens the original in the PC's own program (document types only)
    POST   /api/mission/gcr/files/{fid}/to-papers      G-13 hands a PDF or a Word file to the paper desk; its questions arrive pending

Every JSON answer is {state, reason, source, ...} (ww_pyq/api.py), so a screen prints the reason as it is. Read only towards
Google: the sync, the sign-in and the Classroom reader are the ones in ww_gcr/; this file only starts them and reads what they
wrote. One sync at a time, in one thread, and one sign-in at a time: a second start is 409. Every writer of the manifest (the sync
thread, G-07, G-09, the paper hand-off) goes through GcrStore.update, one read-modify-write under one process-wide lock per store
folder, so a hand edit made while a sync runs is kept. A sync is 409 while a hand-off is on its way, and one file is on its way at
most once. A damaged manifest is set aside and every route answers `fault` with the sentence. A paper the rule found (kind "paper", a PDF, no paper_id yet) is sent to the paper desk at the end of a sync,
one after another, as PENDING drafts: nothing is accepted on his behalf. With JARVIS_GOOGLE=off every route answers "planned"
and connect and sync are 400: the audit sandbox is a copy and must not sign in or pull his files.
"""
from __future__ import annotations

import os
import re
import threading
import time
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable, Optional

import httpx
from fastapi import Body, FastAPI, HTTPException
from fastapi.responses import FileResponse

from .ww_gcr import auth
from .ww_gcr import sync as sync_mod
from .ww_gcr.api import ApiError, GoogleApi, as_reason
from .ww_pyq import api
from .ww_pyq import store as pyq_store

SOURCE = "your Google Classroom"
OFF_REASON = "The Google link is switched off in this instance."
KINDS = ("notes", "paper", "other")
PAPER_EXT = ("pdf", "docx", "doc")     # what the paper desk reads from a Classroom original; Word files are printed to PDF there
# A fetched file must never be executed: only document types are handed to the PC's default program. An .exe, .bat, .lnk or
# .js named like a lecture would run with his rights; the list is closed, not a block list of bad names.
OPENABLE = frozenset({"pdf", "pptx", "ppt", "docx", "doc", "xlsx", "txt", "md", "jpg", "png", "webp"})
MEDIA = {"pdf": "application/pdf", "txt": "text/plain; charset=utf-8", "md": "text/markdown; charset=utf-8",
         "jpg": "image/jpeg", "png": "image/png", "webp": "image/webp",
         "pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
         "docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
         "xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
         "ppt": "application/vnd.ms-powerpoint", "doc": "application/msword"}
CONNECT_WAIT = 300           # s: how long the browser sign-in may take (auth.connect's own timeout)
BUSY_WAIT = 600              # s: how long the automatic hand-off waits for a paper desk job he started himself
# s: how long a hand-off waits for the paper desk to finish one file. Before this limit a desk job that never left "running"
# held the hand-off forever, and every later sync was 409 until the app restarted.
PAPER_WAIT = 600
EMPTY_COURSES = "courses is empty: name at least one course id, or leave it out to sync every course."


def _now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _off() -> bool:
    return os.environ.get("JARVIS_GOOGLE", "").strip().lower() == "off"


def _store() -> sync_mod.GcrStore:
    return sync_mod.GcrStore()


def _api(account: str = auth.MAIN) -> GoogleApi:
    # a 401 forgets this account's cached token and the request is tried once with a new one
    return GoogleApi(token=lambda: auth.access_token(account=account), on_unauthorized=lambda: auth.forget_token(account))


def _any_live() -> bool:
    return any(auth.status(a)["state"] == "live" for a in (auth.accounts() or [auth.MAIN]))


def _account(body: Any) -> str:
    """The account a connect or disconnect is for: a short name he chooses ("college"), main when none is given."""
    name = (body or {}).get("account") if isinstance(body, dict) else None
    name = auth.MAIN if name in (None, "") else name
    if not isinstance(name, str):
        raise ValueError("account is a short name.")
    auth._slot(name)                                  # ValueError (400) for anything but a short lower-case name
    return name


def _default_open(path: Path) -> None:
    if not hasattr(os, "startfile"):
        raise ValueError("Opening a file in its own program works on Windows only.")
    os.startfile(str(path))                                    # noqa: S606  the extension was checked against OPENABLE


opener: Callable[[Path], None] = _default_open                 # the test seam: a test never opens a program


def _subjects(svc) -> list[dict]:
    """The plan's subjects as {id, name, code}; a missing or broken plan is an empty list, not a crash."""
    try:
        ac = svc.plan.academics() or {}
        return [{"id": str(s["id"]), "name": str(s.get("name") or s["id"]), "code": str(s.get("code") or "")}
                for s in ac.get("subjects") or [] if s.get("id")]
    except Exception:
        return []


def _plural(n: int, one: str, many: str) -> str:
    return f"{n} {one if n == 1 else many}"


def _ascii_name(title: str, ext: str) -> str:
    base = re.sub(r"[^A-Za-z0-9._ -]", "_", title or "")[:100].strip(" .") or "file"
    return f"{base}.{ext}"


def _inside(store: sync_mod.GcrStore, rel: str) -> bool:
    """Does this manifest path name a real file inside the store? (the listing's has_original / has_note)"""
    if not rel:
        return False
    try:
        p = (store.root / rel).resolve()
        return store.root.resolve() in p.parents and p.is_file()
    except OSError:
        return False


class Gcr:
    """The state of the link in this app: one sign-in thread, one sync thread, the hand-offs in flight."""

    def __init__(self, svc):
        self.svc = svc
        self.lock = threading.Lock()
        self.stop = threading.Event()
        self.connecting = False
        self.connect_error = ""
        self.connect_thread: Optional[threading.Thread] = None
        self.sync_thread: Optional[threading.Thread] = None
        self.job: Optional[dict] = None
        self.sending: set[str] = set()             # files on their way to the paper desk (paper_id not written yet)
        self.watchers: list[threading.Thread] = []
        self.ingest = None

    @property
    def pending(self) -> int:
        with self.lock:
            return len(self.sending)

    # ------------------------------------------------------------------ the paper desk
    def ingest_jobs(self, app: FastAPI):
        """The paper desk's own job object when its routes are up (one ingest at a time for both doors), else a private one."""
        j = getattr(app.state, "pyq_ingest", None)
        if j is None:
            from .ww_pyq import ingest
            with self.lock:
                if self.ingest is None:
                    self.ingest = ingest.IngestJob(None)
                j = self.ingest
        return j

    def start_paper(self, app: FastAPI, fid: str) -> tuple[dict, dict]:
        """Start the paper desk's reading of one original. Returns (file record, job). Busy is api.Busy, a bad file ValueError."""
        store = _store()
        m = store.manifest()
        rec = m["files"].get(fid)
        if not rec:
            raise KeyError("No such file.")
        if rec.get("ext") not in PAPER_EXT:
            raise ValueError("Only a PDF or a Word file can go to the paper desk.")
        try:
            path = store.original(fid)
        except KeyError:
            raise ValueError("The original was not fetched, so there is nothing to send.") from None
        meta: dict = {"title": (rec.get("title") or fid)[:200], "source_note": "from Google Classroom"}
        subject = (m["courses"].get(rec.get("course"), {}) or {}).get("subject") or rec.get("subject")
        if subject:
            meta["subject"] = subject
        job = self.ingest_jobs(app).start([path], store=pyq_store.default_store(), meta=meta)
        return rec, job

    def finish_paper(self, app: FastAPI, fid: str, job_id: str) -> str:
        """Wait for that job, then write its paper_id on the file record. Raises ValueError with a sentence on a failed reading."""
        jobs = self.ingest_jobs(app)
        limit = PAPER_WAIT
        deadline = time.time() + limit
        while True:
            try:
                j = jobs.get(job_id)
            except KeyError:
                raise ValueError("The paper desk lost the job before it finished.") from None
            if j and j["status"] != "running":
                break
            if self.stop.is_set():
                raise ValueError("Stopped before the paper desk finished; send it again later.")
            if time.time() >= deadline:
                raise ValueError(f"The paper desk did not finish within {max(1, round(limit / 60))} minutes; send it again later.")
            t = time.time()
            jobs.wait(min(5.0, max(0.05, deadline - t)))
            if time.time() - t < 0.05:                 # a wait that returns at once must not spin the CPU for ten minutes
                time.sleep(0.05)
        row = (j["files"] or [{}])[0]
        if row.get("status") == "failed" or not row.get("paper_id"):
            raise ValueError(row.get("note") or "The paper desk could not read this file.")
        pid = row["paper_id"]

        def put(m: dict) -> None:
            if fid in m["files"]:
                m["files"][fid]["paper_id"] = pid
        _store().update(put)
        return pid

    # ------------------------------------------------------------------ the sync job
    def idle_job(self) -> dict:
        return {"status": "idle", "started": "", "finished": "", "text": "", "counts": {}, "fault_lines": []}

    def job_copy(self) -> Optional[dict]:
        with self.lock:
            j = self.job
            return None if j is None else {**j, "counts": dict(j["counts"]), "fault_lines": list(j["fault_lines"])}

    def sync_running(self) -> bool:
        with self.lock:
            return bool(self.job and self.job["status"] == "running")

    def start_sync(self, app: FastAPI, only: Optional[list[str]]) -> dict:
        with self.lock:
            if (self.job and self.job["status"] == "running") or self.sending:
                raise api.Busy("A sync or a hand-off to the paper desk is running; wait for it to finish.")
            self.stop.clear()
            self.job = {"status": "running", "started": _now(), "finished": "", "text": "Starting.", "counts": {}, "fault_lines": []}
            subjects = _subjects(self.svc)
            t = threading.Thread(target=self._run_sync, args=(app, only, subjects), daemon=True, name="gcr-sync")
            self.sync_thread = t
            t.start()
        return self.job_copy()

    def _end(self, status: str, text: str, counts: Optional[dict] = None, lines: Optional[list] = None) -> None:
        with self.lock:
            j = self.job
            j.update(status=status, text=text, finished=_now())
            if counts is not None:
                j["counts"] = counts
            if lines is not None:
                j["fault_lines"] = lines

    def _run_sync(self, app: FastAPI, only: Optional[list[str]], subjects: list[dict]) -> None:
        live = {"courses": 0, "fetched": 0}

        def on_event(e: dict) -> None:
            with self.lock:                          # counts so far, from what happened: a fetch counts when it ENDS
                c = self.job["counts"]
                if e.get("kind") == "course":
                    live["courses"] += 1
                    c["courses"] = live["courses"]
                elif e.get("kind") == "fetched":
                    live["fetched"] += 1
                    c["fetched"] = live["fetched"]
                self.job["text"] = str(e.get("text", ""))[:200]

        store = _store()
        out: dict = {}
        lines: list[str] = []
        seen: set = set()                             # a file met under two accounts is fetched once
        failed, first, stopped = 0, "", False
        names = [a for a in auth.accounts() if auth.status(a)["state"] == "live"] or [auth.MAIN]
        for name in names:                            # one account after another; one that fails does not stop the next
            if self.stop.is_set():
                stopped = True
                break
            g = _api() if name == auth.MAIN else _api(name)
            try:
                one = sync_mod.sync(g, store, subjects=subjects, only=only, on_event=on_event, stop=self.stop, account=name, seen=seen)
            except (auth.NotConnected, ApiError, httpx.HTTPError) as e:
                failed, first = failed + 1, first or as_reason(e)
                lines.append(as_reason(e) if len(names) == 1 else f"{name}: {as_reason(e)}")
                continue
            except Exception as e:                    # a bug or a broken disk: the job says so and the app stays up
                why = f"The sync stopped ({type(e).__name__})."
                failed, first = failed + 1, first or why
                lines.append(why if len(names) == 1 else f"{name}: {why}")
                continue
            finally:
                g.close()
            if one.get("error"):                      # the sign-in died part way: what it fetched is kept and counted
                failed, first = failed + 1, first or one["error"]
            stopped = stopped or bool(one.get("stopped"))
            lines += list(one.get("fault_lines") or [])
            for k, v in one.items():
                if isinstance(v, (int, float)) and not isinstance(v, bool):
                    out[k] = out.get(k, 0) + v
        counts = {k: out.get(k, 0) for k in ("courses", "posts", "files", "fetched", "unchanged", "notes", "papers", "faults", "bytes")}
        counts["seconds"] = round(out.get("seconds", 0), 1)
        with self.lock:                               # an account that raised part way: its real fetches are the events'
            counts["fetched"] = max(counts["fetched"], live["fetched"])
        if failed and failed == len(names):
            counts["papers_sent"] = 0
            self._end("failed", first, counts, lines[:100])
            return
        if stopped or self.stop.is_set():
            counts["papers_sent"] = 0
            self._end("stopped", "Stopped before it finished.", counts, lines[:100])
            return
        try:
            counts["papers_sent"] = self._send_found_papers(app, only, lines)
        except sync_mod.ManifestError as e:
            counts["papers_sent"] = 0
            lines.append(str(e))
        text = (f"{counts['fetched']} fetched, {counts['unchanged']} unchanged, {counts['papers_sent']} sent to the paper desk, "
                f"{_plural(len(lines), 'fault', 'faults')}.")
        self._end("done", text, counts, lines[:100])

    def _send_found_papers(self, app: FastAPI, only: Optional[list[str]], lines: list[str]) -> int:
        """The rule's papers (kind paper, a PDF, no paper_id yet) one after another; a failure is a line, not the end."""
        m = _store().manifest()
        todo = [(fid, r) for fid, r in m["files"].items()
                if r.get("kind") == "paper" and r.get("ext") in PAPER_EXT and not r.get("paper_id") and r.get("state") == "live"
                and r.get("path") and (not only or r.get("course") in only)]
        sent = 0
        for fid, r in todo:
            if self.stop.is_set():
                break
            with self.lock:
                if fid in self.sending:               # he is sending this one by hand right now
                    continue
                self.sending.add(fid)
                self.job["text"] = f"Sending {r.get('title') or fid} to the paper desk"
            try:
                deadline = time.time() + BUSY_WAIT
                while True:
                    try:
                        _, job = self.start_paper(app, fid)
                        break
                    except api.Busy:                  # a reading he started himself: wait for it, do not skip the paper
                        if time.time() > deadline or self.stop.is_set():
                            raise ValueError("The paper desk stayed busy.") from None
                        time.sleep(0.5)
                self.finish_paper(app, fid, job["id"])
                sent += 1
            except (ValueError, KeyError) as e:
                lines.append(f"{r.get('title') or fid}: {str(e).strip(chr(39))}")
            except Exception as e:
                lines.append(f"{r.get('title') or fid}: could not be sent ({type(e).__name__}).")
            finally:
                with self.lock:
                    self.sending.discard(fid)
        return sent

    # ------------------------------------------------------------------ the sign-in thread
    def start_connect(self, account: str = auth.MAIN) -> None:
        with self.lock:
            if self.connecting:
                raise api.Busy("Already waiting for you to approve in the browser.")
            self.connecting = True
            self.connect_error = ""
            t = threading.Thread(target=self._run_connect, args=(account,), daemon=True, name="gcr-connect")
            self.connect_thread = t
            t.start()

    def _run_connect(self, account: str = auth.MAIN) -> None:
        err = ""
        try:
            if account == auth.MAIN:
                auth.connect(timeout=CONNECT_WAIT)
            else:
                auth.connect(timeout=CONNECT_WAIT, account=account)
        except auth.NotConnected as e:
            err = str(e)
        except Exception:                             # a closed tab or the 300 s running out ends the same way
            err = "The browser sign-in did not finish. Press Connect to try again."
        with self.lock:
            self.connect_error = err
            self.connecting = False

    # ------------------------------------------------------------------ answers
    def status_body(self) -> dict:
        names = auth.accounts() or [auth.MAIN]
        each = [{"name": n, **{k: v for k, v in auth.status(n).items() if k in ("state", "reason")}} for n in names]
        live = next((n for n in names if auth.status(n)["state"] == "live"), names[0])
        st = auth.status(live)                           # the link is live when any account is
        with self.lock:
            connecting, err = self.connecting, self.connect_error
        if connecting:
            state, reason = "waiting", "Approve in the browser window that opened."
        elif err:
            state, reason = "fault", err
        else:
            state, reason = st["state"], st["reason"]
        have = set(st.get("scopes") or [])
        scopes = [{"name": n, "label": label, "granted": n in have} for n, label in auth.SCOPES.items()]
        try:
            m = _store().manifest()
        except sync_mod.ManifestError as e:          # a damaged list of files is a fault the screen names, not a 500
            state, reason = "fault", str(e)
            m = {"courses": {}, "files": {}, "faults": [], "synced_at": ""}
        files = m["files"].values()
        counts = {"courses": len(m["courses"]), "files": len(m["files"]), "notes": sum(1 for r in files if r.get("note")),
                  "papers": sum(1 for r in files if r.get("kind") == "paper"), "faults": len(m.get("faults") or [])}
        return api.ok(state, reason, SOURCE, scopes=scopes, accounts=each, connecting=connecting, synced_at=m.get("synced_at", ""),
                      counts=counts, job=self.job_copy())


def _off_status() -> dict:
    scopes = [{"name": n, "label": label, "granted": False} for n, label in auth.SCOPES.items()]
    return api.ok("planned", OFF_REASON, SOURCE, scopes=scopes, connecting=False, synced_at="",
                  counts={"courses": 0, "files": 0, "notes": 0, "papers": 0, "faults": 0}, job=None)


def _off_answer(**payload: Any) -> dict:
    return api.ok("planned", OFF_REASON, SOURCE, **payload)


def _file_item(store: sync_mod.GcrStore, rec: dict) -> dict:
    return {"id": rec["id"], "course": rec.get("course", ""), "course_name": rec.get("course_name", ""), "subject": rec.get("subject", ""),
            "title": rec.get("title", ""), "ext": rec.get("ext", ""), "kind": rec.get("kind", "notes"),
            "kind_source": rec.get("kind_source", "rule"), "state": rec.get("state", "fault"), "reason": rec.get("reason", ""),
            "note_state": rec.get("note_state", "waiting"), "note_reason": rec.get("note_reason", ""),
            "pages": rec.get("pages", 0), "words": rec.get("words", 0), "scanned_pages": rec.get("scanned_pages", 0),
            "size": rec.get("size", 0), "modified": rec.get("modified", ""),
            "post": {"kind": (rec.get("post") or {}).get("kind", ""), "title": (rec.get("post") or {}).get("title", ""),
                     "topic": (rec.get("post") or {}).get("topic", "")},
            "has_note": _inside(store, rec.get("note", "")), "has_original": _inside(store, rec.get("path", "")),
            "paper_id": rec.get("paper_id", ""),
            # added 22 Nov: a live copy whose newer version could not be fetched, and the other places one Drive file is attached
            "stale": bool(rec.get("stale")), "also_in": list(rec.get("also_in") or [])}


def _course_item(cid: str, c: dict, files: list[dict]) -> dict:
    return {"id": cid, "name": c.get("name", ""), "section": c.get("section", ""), "state": c.get("state", ""),
            "subject": c.get("subject", ""), "subject_source": c.get("subject_source", "none"), "include": c.get("include", True),
            "files": len(files), "notes": sum(1 for r in files if r.get("note")), "papers": sum(1 for r in files if r.get("kind") == "paper"),
            "read_at": c.get("read_at", ""), "link": c.get("link", "")}


def register(app: FastAPI, svc, bus) -> None:
    g = Gcr(svc)
    app.state.gcr = g
    inner = app.router.lifespan_context

    @asynccontextmanager
    async def lifespan(a):
        async with inner(a) as state:
            try:
                yield state
            finally:
                g.stop.set()                           # a sync in flight ends after the file it is on, keeping what it wrote

    app.router.lifespan_context = lifespan

    def guarded(work: Callable, **fault_payload: Any) -> Any:
        """api.guard, and a damaged manifest as state fault with its sentence (never a 500, never a silent blank)."""
        try:
            return api.guard(work)
        except sync_mod.ManifestError as e:
            return api.ok("fault", str(e), SOURCE, **fault_payload)

    def guarded_items(work: Callable) -> Any:
        try:
            return api.guard(work)
        except sync_mod.ManifestError as e:
            return api.items([], "fault", str(e), SOURCE)

    def course_rec(m: dict, cid: str) -> dict:
        c = m["courses"].get(cid)
        if not c:
            raise KeyError("No such course.")
        return c

    def file_rec(m: dict, fid: str) -> dict:
        r = m["files"].get(fid) if isinstance(fid, str) else None
        if not r:
            raise KeyError("No such file.")
        return r

    # ------------------------------------------------------------------ G-01 to G-05
    @app.get("/api/mission/gcr/status")
    def status():
        return _off_status() if _off() else g.status_body()

    @app.post("/api/mission/gcr/connect")
    def connect(body: dict = Body(default_factory=dict)):
        if _off():
            raise HTTPException(400, OFF_REASON)
        api.guard(lambda: g.start_connect(_account(body)))
        return g.status_body()

    @app.post("/api/mission/gcr/disconnect")
    def disconnect(body: dict = Body(default_factory=dict)):
        if _off():
            return _off_status()
        name = api.guard(lambda: _account(body))
        out = auth.disconnect() if name == auth.MAIN else auth.disconnect(account=name)
        with g.lock:
            g.connect_error = ""
        answer = g.status_body()
        if (out or {}).get("reason") == auth.UNTOLD:   # forgotten here, but Google still holds the grant: he must know
            answer["reason"] = auth.UNTOLD
        return answer

    @app.post("/api/mission/gcr/sync")
    def sync_start(body: dict = Body(default_factory=dict)):
        if _off():
            raise HTTPException(400, OFF_REASON)

        def work():
            only = body.get("courses")
            if only is not None and (not isinstance(only, list) or not all(isinstance(x, str) and x for x in only)):
                raise ValueError("courses is a list of course ids.")
            if only == []:                            # an empty list read as "all courses" before (only or None)
                raise ValueError(EMPTY_COURSES)
            if not _any_live():
                raise ValueError(auth.status()["reason"])
            job = g.start_sync(app, only)
            return api.ok("live", "Sync started.", SOURCE, job=job)
        return api.guard(work)

    @app.get("/api/mission/gcr/sync")
    def sync_job():
        if _off():
            return _off_answer(job=g.idle_job())
        j = g.job_copy() or g.idle_job()
        reason = {"idle": "No sync has run yet.", "running": j["text"] or "Syncing.", "done": j["text"],
                  "failed": j["text"], "stopped": j["text"]}[j["status"]]
        state = {"idle": "waiting", "running": "live", "done": "fault" if j["fault_lines"] else "live", "failed": "fault",
                 "stopped": "waiting"}[j["status"]]
        return api.ok(state, reason, SOURCE, job=j)

    # ------------------------------------------------------------------ G-06, G-07
    @app.get("/api/mission/gcr/courses")
    def courses():
        if _off():
            return api.items([], "planned", OFF_REASON, SOURCE)

        def work():
            m = _store().manifest()
            rows = [_course_item(cid, c, [r for r in m["files"].values() if r.get("course") == cid]) for cid, c in m["courses"].items()]
            rows.sort(key=lambda r: r["name"].lower())
            if not rows:
                return api.items([], "waiting", "No course has been read yet. Connect, then sync.", SOURCE)
            return api.items(rows, "live", f"{_plural(len(rows), 'course', 'courses')} read.", SOURCE)
        return guarded_items(work)

    @app.patch("/api/mission/gcr/courses/{cid}")
    def course_patch(cid: str, body: dict = Body(...)):
        if _off():
            return _off_answer(course=None)

        def work():
            if not isinstance(body, dict) or not ({"subject", "include"} & set(body)):
                raise ValueError("Give subject or include.")
            if "include" in body and not isinstance(body["include"], bool):
                raise ValueError("include is true or false.")
            s = body.get("subject")
            if "subject" in body:
                if not isinstance(s, str):
                    raise ValueError("subject is a subject id of your plan, or an empty text to clear it.")
                if s and s not in {x["id"] for x in _subjects(svc)}:
                    raise ValueError("That is not a subject of your plan.")

            def put(m: dict) -> dict:                 # under the store's lock, on the newest copy: a running sync keeps it
                c = course_rec(m, cid)
                if "include" in body:
                    c["include"] = body["include"]
                if "subject" in body:
                    if s:
                        c.update(subject=s, subject_source="hand")
                    else:
                        c.update(subject="", subject_source="none")     # the next sync may find it by the rule again
                    for r in m["files"].values():
                        if r.get("course") == cid:
                            r["subject"] = c["subject"]
                return _course_item(cid, c, [r for r in m["files"].values() if r.get("course") == cid])
            item = _store().update(put)
            return api.ok("live", "Course updated.", SOURCE, course=item)
        return guarded(work, course=None)

    # ------------------------------------------------------------------ G-08, G-09
    @app.get("/api/mission/gcr/files")
    def files(course: str = "", kind: str = "", q: str = ""):
        if _off():
            return api.items([], "planned", OFF_REASON, SOURCE)

        def work():
            if kind and kind not in KINDS:
                raise ValueError("kind is notes, paper or other.")
            st = _store()
            m = st.manifest()
            if not m["files"]:
                return api.items([], "waiting", "No file has been fetched yet. Press Sync." if _any_live()
                                 else "No file has been fetched yet. Connect to Google, then sync.", SOURCE)
            needle = q.strip().lower()
            rows = []
            for r in m["files"].values():
                if course and r.get("course") != course:
                    continue
                if kind and r.get("kind", "notes") != kind:
                    continue
                post = r.get("post") or {}
                if needle and not any(needle in str(x or "").lower() for x in (r.get("title"), post.get("title"), post.get("topic"))):
                    continue
                rows.append(_file_item(st, r))
            rows.sort(key=lambda r: r["modified"], reverse=True)
            n_all = len(m["files"])
            return api.items(rows, "live", f"{_plural(len(rows), 'file', 'files')} shown of {n_all}." if len(rows) != n_all
                             else f"{_plural(n_all, 'file', 'files')}.", SOURCE)
        return guarded_items(work)

    @app.patch("/api/mission/gcr/files/{fid}")
    def file_patch(fid: str, body: dict = Body(...)):
        if _off():
            return _off_answer(file=None)

        def work():
            if not isinstance(body, dict) or body.get("kind") not in KINDS:
                raise ValueError("kind is notes, paper or other.")
            st = _store()

            def put(m: dict) -> dict:
                r = file_rec(m, fid)
                r.update(kind=body["kind"], kind_source="hand")
                return dict(r)
            r = st.update(put)
            return api.ok("live", "Kind set by hand.", SOURCE, file=_file_item(st, r))
        return guarded(work, file=None)

    # ------------------------------------------------------------------ G-10, G-11
    @app.get("/api/mission/gcr/files/{fid}/note")
    def file_note(fid: str):
        if _off():
            return _off_answer(markdown="", title="", words=0, pages=0, scanned_pages=0)

        def work():
            st = _store()
            r = file_rec(st.manifest(), fid)
            base = {"title": r.get("title", ""), "words": r.get("words", 0), "pages": r.get("pages", 0),
                    "scanned_pages": r.get("scanned_pages", 0)}
            try:
                text = st.note(fid).read_text(encoding="utf-8")
            except (KeyError, OSError):
                return api.ok("waiting", r.get("note_reason") or "This file has no note.", SOURCE, markdown="", **base)
            return api.ok(r.get("note_state") or "live", r.get("note_reason") or "", SOURCE, markdown=text, **base)
        return guarded(work, markdown="", title="", words=0, pages=0, scanned_pages=0)

    @app.get("/api/mission/gcr/files/{fid}/original")
    def file_original(fid: str):
        if _off():
            return _off_answer()
        st = _store()
        try:
            r = file_rec(st.manifest(), fid)
            p = st.original(fid)                       # refuses ids and paths outside the store
        except KeyError:
            raise HTTPException(404, "There is no original for this file.")
        except sync_mod.ManifestError as e:
            return api.ok("fault", str(e), SOURCE)
        ext = p.suffix.lstrip(".").lower()
        # the header is built here: Starlette writes filename*=utf-8'' for a name with a space, and the contract is a plain quoted name
        name = _ascii_name(r.get("title", ""), ext or "bin")
        return FileResponse(p, media_type=MEDIA.get(ext, "application/octet-stream"),
                            headers={"X-Content-Type-Options": "nosniff", "Content-Disposition": f'inline; filename="{name}"'})

    # ------------------------------------------------------------------ G-12, G-13
    @app.post("/api/mission/gcr/files/{fid}/open")
    def file_open(fid: str):
        if _off():
            return _off_answer()

        def work():
            st = _store()
            file_rec(st.manifest(), fid)
            p = st.original(fid)
            if p.suffix.lstrip(".").lower() not in OPENABLE:
                raise ValueError("This kind of file is not opened from here: a fetched file is never run.")
            opener(p)
            return api.ok("live", "Opened in its own program.", SOURCE)
        return guarded(work)

    @app.post("/api/mission/gcr/files/{fid}/to-papers")
    def file_to_papers(fid: str):
        if _off():
            return _off_answer(file=None, job=None)

        def work():
            st = _store()
            r = file_rec(st.manifest(), fid)
            if r.get("paper_id"):                      # sent before: the desk has it, sending again would only repeat the reading
                return api.ok("live", "Already at the paper desk.", SOURCE, file=_file_item(st, r), job=None)
            with g.lock:                               # check and mark in one step: two presses cannot both pass
                if fid in g.sending:
                    raise api.Busy("This file is already on its way to the paper desk.")
                g.sending.add(fid)
            try:
                rec, job = g.start_paper(app, fid)

                def finish():
                    try:
                        g.finish_paper(app, fid, job["id"])
                    except Exception:
                        pass                            # the paper desk's own job row carries the reason
                    finally:
                        with g.lock:
                            g.sending.discard(fid)
                t = threading.Thread(target=finish, daemon=True, name="gcr-paper")
                with g.lock:
                    g.watchers = [w for w in g.watchers if w.is_alive()] + [t]
                t.start()                              # inside the try: a thread that never starts must not keep the mark
            except BaseException:
                with g.lock:
                    g.sending.discard(fid)
                raise
            return api.ok("live", "Sent to the paper desk: its questions arrive pending, for you to review.", SOURCE,
                          file=_file_item(_store(), rec), job=job)
        return guarded(work, file=None, job=None)
