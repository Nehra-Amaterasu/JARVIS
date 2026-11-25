"""Well Wisher's question harvester over HTTP (ww_harvest.py, ww_bank_store.py).

    GET    /api/mission/harvest/queue     the queue (waiting, fetching, done, refused with the reason), the switches, questions on disk
    GET    /api/mission/harvest/sources   every source with its status and licence line, the sources not used and why, the PDF reader
    POST   /api/mission/harvest/queue     {subject, topic, unit?, tier?, max?, sources?}  queue a topic (does not fetch)
    POST   /api/mission/harvest/pause     pause the queue
    POST   /api/mission/harvest/resume    switch the harvester on (it is off until the owner does this) and resume
    POST   /api/mission/harvest/run       {max_requests?}  work the queue now, one polite request at a time; 409 while a run is going
    GET    /api/phone/ww/harvest          the phone's flags: state, queued, on disk (read-only; the switches stay on the desk)
    GET    /api/mission/harvest/manifest                 R-43 ?source= where every paper file and pointer came from, newest first
    PUT    /api/mission/harvest/sources/{sid}            R-44 {on?, local_copy?, address?} the two switches of a paper source
    POST   /api/mission/harvest/dropin                   R-45 {path, subject?, year?, exam_kind?} a file he downloaded joins the manifest and is read
    GET    /api/mission/harvest/sources/{sid}/index      R-53 ?q=&code=&refresh= what the publisher lists (asked once a day at most)
    POST   /api/mission/harvest/sources/{sid}/fetch      R-54 {key, subject?, year?, exam_kind?} a pointer, or a local copy sent to the paper desk

Nothing here starts a thread or touches the network by itself: the queue is worked only by the run
route (or `python -m jarvis_app.ww_harvest`). With the harvester off, `run` answers {"ran": false, ...}.
The phone route sits under /api/phone so the phone listener's checks apply; the desk routes do not.

Paper sources (ww_harvest_sources) are whole past papers from a publisher's listing page. Each has two switches,
both off: with them off R-53 answers `planned` and nothing is asked of the site. A fetch is a pointer line and no
request unless the local copy is switched on; then it is one polite request, the PDF is kept under the private data
directory and goes to the paper desk like a dropped file. R-43 to R-54 answer the {state, reason, source, ...}
envelope of ww_pyq/api.py; a refusal by the site or by a rate rule is state `fault` with the reason, not an error.
"""
from __future__ import annotations

from typing import Optional

from fastapi import Body, FastAPI, HTTPException
from starlette.concurrency import run_in_threadpool

from . import ww_bank_store, ww_harvest
from . import ww_harvest_sources as papers
from .routes_ww_pyq_ingest import _meta as ingest_meta
from .routes_ww_pyq_ingest import check_path
from .ww_pyq import api
from .ww_pyq import store as pyq_store

RUN_CAP = 20          # network requests one run may spend; at 2 to 5 s each that is under two minutes
PAPERS = "the harvester's manifest"
READING = "Already reading files; wait for that to finish."


def register(app: FastAPI, svc, bus) -> None:
    h = ww_harvest.shared()

    def guard(fn, *a, **k):
        try:
            return fn(*a, **k)
        except ValueError as e:
            raise HTTPException(400, str(e))

    @app.get("/api/mission/harvest/queue")
    async def harvest_queue():
        return await run_in_threadpool(h.status)

    @app.get("/api/mission/harvest/sources")
    async def harvest_sources():
        return await run_in_threadpool(h.sources_view)

    @app.post("/api/mission/harvest/queue")
    async def harvest_queue_topic(payload: dict = Body(...)):
        def go():
            src = payload.get("sources")
            if src is not None and not (isinstance(src, list) and all(isinstance(x, str) for x in src)):
                raise ValueError("sources is a list of source ids")
            return h.queue_topic(payload.get("subject"), payload.get("topic"), payload.get("unit"),
                                 payload.get("tier") or "gate", payload.get("max", 20), src)
        item = await run_in_threadpool(guard, go)
        return {"item": item, "state": (await run_in_threadpool(h.flags))["state"]}

    @app.post("/api/mission/harvest/pause")
    async def harvest_pause():
        return await run_in_threadpool(h.pause)

    @app.post("/api/mission/harvest/resume")
    async def harvest_resume():
        return await run_in_threadpool(h.resume)

    @app.post("/api/mission/harvest/run")
    async def harvest_run(payload: Optional[dict] = Body(default=None)):
        n = (payload or {}).get("max_requests", 10)
        if isinstance(n, bool) or not isinstance(n, int) or not 1 <= n <= RUN_CAP:
            raise HTTPException(400, f"max_requests is a whole number from 1 to {RUN_CAP}")
        out = await run_in_threadpool(h.run, n)
        if not out["ran"] and out["reason"] == "a run is already going":
            raise HTTPException(409, out["reason"])
        return out

    @app.get("/api/phone/ww/harvest")
    async def phone_harvest(subject: Optional[str] = None):
        def go():
            sub = ww_bank_store.slug(subject) if subject else None
            return h.flags(sub)
        return await run_in_threadpool(guard, go)

    # ------------------------------------------------------------------ paper sources: R-43 to R-45, R-53, R-54
    def ingest_jobs():
        return getattr(app.state, "pyq_ingest", None)          # the paper desk's one reading job (routes_ww_pyq_ingest)

    def with_paper_ids(rows: list) -> list:
        st = pyq_store.default_store()
        return [{**m, "paper_id": st.find_by_sha(m.get("sha256") or "")} for m in rows]

    def count(n: int, one: str, many: str) -> str:
        return f"{n} {one if n == 1 else many}"

    @app.get("/api/mission/harvest/manifest")
    async def harvest_manifest(source: Optional[str] = None):
        def work():
            rows = with_paper_ids(papers.manifest(h, source or None))[::-1]
            if not rows:
                return api.items([], "waiting", "Nothing fetched or dropped yet.", PAPERS)
            files = sum(1 for m in rows if m.get("sha256"))
            return api.items(rows, "live", f"{count(files, 'file', 'files')} and {count(len(rows) - files, 'pointer', 'pointers')} on record.", PAPERS)
        return await run_in_threadpool(api.guard, work)

    @app.put("/api/mission/harvest/sources/{sid}")
    async def harvest_source_switch(sid: str, body: dict = Body(...)):
        def work():
            src = papers.set_switches(h, sid, body)
            return api.ok("live", src["reason"], PAPERS, paper_source=src)
        return await run_in_threadpool(api.guard, work)

    @app.get("/api/mission/harvest/sources/{sid}/index")
    async def harvest_source_index(sid: str, q: str = "", code: str = "", refresh: bool = False):
        def work():
            none = {"listed": 0, "read_at": None, "note": ""}
            try:
                r = papers.index(h, sid, q, code, refresh)
            except papers.Off as e:
                return api.items([], "planned", str(e), PAPERS, **none)
            except papers.NeedsAddress as e:
                return api.items([], "waiting", str(e), PAPERS, **none)
            except ww_harvest.Refused as e:
                return api.items([], "fault", e.reason, PAPERS, **none)
            return api.items(r["items"], "live", f"{len(r['items'])} of the {r['listed']} listed.", PAPERS,
                             listed=r["listed"], read_at=r["read_at"], note=r["note"])
        return await run_in_threadpool(api.guard, work)

    @app.post("/api/mission/harvest/sources/{sid}/fetch")
    async def harvest_source_fetch(sid: str, body: dict = Body(...)):
        def work():
            meta = ingest_meta(body)
            jobs = ingest_jobs()
            try:
                # asked before any request: a paper is not fetched while the desk cannot take it
                if papers.wants_local(h, sid) and jobs is not None and jobs.running():
                    raise api.Busy(READING)
                entry, path = papers.fetch(h, sid, body.get("key"))
            except (papers.Off, papers.NeedsAddress) as e:
                raise ValueError(str(e))
            except ww_harvest.Refused as e:
                return api.ok("fault", e.reason, PAPERS, entry=None, job=None)
            job = None
            if path is not None and jobs is not None:
                meta.setdefault("source_note", f"{entry['source']}: {entry['url']}"[:500])
                job = jobs.start([path], store=pyq_store.default_store(), meta=meta)
            if path is None:
                reason = "A pointer is on record; the site was not asked. Switch the local copy on to keep the file."
            else:
                reason = "The paper is on this PC and is being read at the paper desk." if job else "The paper is on this PC."
            return api.ok("live", reason, PAPERS, entry=with_paper_ids([entry])[0], job=job)
        return await run_in_threadpool(api.guard, work)

    @app.post("/api/mission/harvest/dropin")
    async def harvest_dropin(body: dict = Body(...)):
        def work():
            meta = ingest_meta(body)
            p = check_path(body.get("path"))
            jobs = ingest_jobs()
            if jobs is not None and jobs.running():
                raise api.Busy(READING)
            entry = papers.dropin(h, p)
            meta.setdefault("source_note", "a file you downloaded yourself")
            job = jobs.start([p], store=pyq_store.default_store(), meta=meta) if jobs is not None else None
            return api.ok("live", "The file is on record" + (" and is being read at the paper desk." if job else "."), PAPERS,
                          entry=with_paper_ids([entry])[0], job=job)
        return await run_in_threadpool(api.guard, work)
