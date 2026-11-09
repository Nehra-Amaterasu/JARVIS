"""Well Wisher's question harvester over HTTP (ww_harvest.py, ww_bank_store.py).

    GET    /api/mission/harvest/queue     the queue (waiting, fetching, done, refused with the reason), the switches, questions on disk
    GET    /api/mission/harvest/sources   every source with its status and licence line, the sources not used and why, the PDF reader
    POST   /api/mission/harvest/queue     {subject, topic, unit?, tier?, max?, sources?}  queue a topic (does not fetch)
    POST   /api/mission/harvest/pause     pause the queue
    POST   /api/mission/harvest/resume    switch the harvester on (it is off until the owner does this) and resume
    POST   /api/mission/harvest/run       {max_requests?}  work the queue now, one polite request at a time; 409 while a run is going
    GET    /api/phone/ww/harvest          the phone's flags: state, queued, on disk (read-only; the switches stay on the desk)

Nothing here starts a thread or touches the network by itself: the queue is worked only by the run
route (or `python -m jarvis_app.ww_harvest`). With the harvester off, `run` answers {"ran": false, ...}.
The phone route sits under /api/phone so the phone listener's checks apply; the desk routes do not.
"""
from __future__ import annotations

from typing import Optional

from fastapi import Body, FastAPI, HTTPException
from starlette.concurrency import run_in_threadpool

from . import ww_bank_store, ww_harvest

RUN_CAP = 20          # network requests one run may spend; at 2 to 5 s each that is under two minutes


def register(app: FastAPI, svc, bus) -> None:
    h = ww_harvest.Harvester()

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
