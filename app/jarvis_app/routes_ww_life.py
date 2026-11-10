"""/api/mission/life/...: Well Wisher's Life workspace (ww_life.py), the parts routes_mission does not have.

    GET  /api/mission/life/day            the life view plus "item_rows" (each logged item with its index) and
                                          "reels_pending" {queued_today, due, total}, counted without the engine's cap of 3
    POST /api/mission/life/item/delete    {index, kind, text}   take today's item out; answers {removed, index, ...day}
    POST /api/mission/life/item/restore   {index, item}         put a removed item back (the undo); answers the day

Additive and live-safe: no existing route or state key changes. These two routes edit the same plan-state
log that POST /api/mission/life/item writes (state["life"][date]["items"]), under the Plan's own lock, so
a delete cannot interleave with a count or an add. Today's items only: yesterday's list is history.

Why delete asks for kind and text as well as the index: the page shows a list it fetched a moment ago, and
a second window or a late reply can have moved it. An index alone would remove whatever sits there now;
with the text it removes the row the person pointed at or refuses.
"""
from __future__ import annotations

from datetime import date
from typing import Optional

from fastapi import Body, FastAPI, HTTPException
from starlette.concurrency import run_in_threadpool

from . import germoney, ww_life


def day_view(plan, today: Optional[str] = None) -> dict:
    """The life view plus what the Life workspace needs that the engine does not return."""
    today = today or date.today().isoformat()
    view = plan.life_view(today)
    log = plan.load(today).get("life") or {}
    items = (log.get(today) or {}).get("items") or []
    return {**view, "item_rows": [{"index": i, **it} for i, it in enumerate(items)],
            "reels_pending": ww_life.reels_pending(log, today)}


def delete(plan, index, kind: str, text: str, today: Optional[str] = None) -> dict:
    today = today or date.today().isoformat()
    with plan._lock:
        st = plan.load(today)
        removed = ww_life.delete_item(st.setdefault("life", {}), today, index, kind, text)
        plan.save(st)
    return {"removed": removed, "index": index, **day_view(plan, today)}


def restore(plan, index, item: dict, today: Optional[str] = None) -> dict:
    today = today or date.today().isoformat()
    with plan._lock:
        st = plan.load(today)
        ww_life.restore_item(st.setdefault("life", {}), today, index, item)
        plan.save(st)
    return day_view(plan, today)


def register(app: FastAPI, svc, bus) -> None:
    # routes_mission registers first (alphabetical) and leaves its Plan on svc; a test that loads only this
    # feature gets a Plan of its own over the same store.
    plan = getattr(svc, "plan", None) or germoney.Plan(svc.kv)

    async def guard(fn, *a):
        try:
            return await run_in_threadpool(fn, *a)
        except ValueError as e:
            raise HTTPException(400, str(e))

    @app.get("/api/mission/life/day")
    async def life_day():
        return await run_in_threadpool(day_view, plan)

    @app.post("/api/mission/life/item/delete")
    async def life_item_delete(payload: dict = Body(...)):
        return await guard(delete, plan, payload.get("index"), str(payload.get("kind") or ""), str(payload.get("text") or ""))

    @app.post("/api/mission/life/item/restore")
    async def life_item_restore(payload: dict = Body(...)):
        item = payload.get("item")
        if not isinstance(item, dict):
            raise HTTPException(400, "restore needs the item that was removed")
        return await guard(restore, plan, payload.get("index"), item)
