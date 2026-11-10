"""/api/mission/resources: checklists for the resources of the skill tree, and where he is in them.

    GET    /api/mission/resources/progress?node=&weeks=   every resource with a checklist (or, for a node, all its resources) + the weekly series
    GET    /api/mission/resources/weekly?weeks=           sections done per week, oldest first, the current week last and partial
    GET    /api/mission/resource/{rid}                    one resource: its items with state, the bookmark, what is next
    PUT    /api/mission/resource/{rid}/checklist          {items}  type or re-type the checklist (text, one item per line, or a list)
    DELETE /api/mission/resource/{rid}/checklist          remove it and its marks
    POST   /api/mission/resource/{rid}/tap                {item, state}  state: done | skip | open | here

Logic and the storage shape are in ww_resources.py (key "@ww_resources", beside the plan state, for
the reason routes_ww_dmat.py gives). Additive: no existing route or state key changes. The phone
reads and taps the same data through routes_phone_ww.py.
"""
from __future__ import annotations

import threading
from datetime import date
from typing import Any, Optional

from fastapi import Body, FastAPI, HTTPException, Query
from starlette.concurrency import run_in_threadpool

from . import germoney, ww_resources


def _today() -> str:
    return date.today().isoformat()


def register(app: FastAPI, svc, bus) -> None:
    lock = threading.Lock()

    def call(fn):
        try:
            return fn()
        except ValueError as e:
            msg = str(e)
            raise HTTPException(404 if msg.startswith(("unknown resource", "unknown node")) else 400, msg)

    @app.get("/api/mission/resources/progress")
    async def res_progress(node: Optional[str] = Query(None), weeks: int = Query(ww_resources.WEEKS_DEFAULT)):
        return await run_in_threadpool(call, lambda: ww_resources.progress(svc.kv, germoney.load_bank(), _today(), node, weeks))

    @app.get("/api/mission/resources/weekly")
    async def res_weekly(weeks: int = Query(ww_resources.WEEKS_DEFAULT)):
        return await run_in_threadpool(call, lambda: ww_resources.weekly(svc.kv, germoney.load_bank(), _today(), weeks))

    @app.get("/api/mission/resource/{rid}")
    async def res_one(rid: str):
        return await run_in_threadpool(call, lambda: ww_resources.detail(svc.kv, germoney.load_bank(), rid, _today()))

    @app.put("/api/mission/resource/{rid}/checklist")
    async def res_set(rid: str, items: Any = Body(..., embed=True)):
        def go():
            with lock:
                r = ww_resources.set_checklist(svc.kv, germoney.load_bank(), rid, items, _today())
            return {**r, "resource": ww_resources.detail(svc.kv, germoney.load_bank(), rid, _today())}
        return await run_in_threadpool(call, go)

    @app.delete("/api/mission/resource/{rid}/checklist")
    async def res_clear(rid: str):
        def go():
            with lock:
                return ww_resources.clear_checklist(svc.kv, germoney.load_bank(), rid)
        return await run_in_threadpool(call, go)

    @app.post("/api/mission/resource/{rid}/tap")
    async def res_tap(rid: str, item: str = Body(..., embed=True), state: str = Body(..., embed=True)):
        def go():
            with lock:
                return ww_resources.tap(svc.kv, germoney.load_bank(), rid, item, state, _today())
        return await run_in_threadpool(call, go)
