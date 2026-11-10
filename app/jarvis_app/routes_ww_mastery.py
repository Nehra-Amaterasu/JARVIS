"""/api/mission/mastery: sharpen and de-master (rules in ww_mastery.py).

    GET  /api/mission/mastery/{node}                what Sharpen and De-master may do now, with the sentence that says why not
    POST /api/mission/mastery/{node}/gate-solve     {question_id}  file a GATE-tier question solved on this node
    POST /api/mission/mastery/{node}/sharpen        open a round: the node's contracts again with a harder check
    POST /api/mission/mastery/{node}/sharpen-done   close the round: the node is re-proved
    POST /api/mission/mastery/{node}/demaster       take "mastered" off, only when nothing above it is mastered

A separate prefix on purpose: /api/mission/node/{id}/{op} is a catch-all that answers 400 to any op it does
not know, and it is registered first. A refused sharpen or de-master is HTTP 200 with ok false and the
blocker in `say`, like start_node's "3 things are in progress": the page prints it as the reason.
The plan store is svc.plan, set by routes_mission (its module name sorts first).
"""
from __future__ import annotations

from typing import Optional

from fastapi import Body, FastAPI, HTTPException
from starlette.concurrency import run_in_threadpool

from . import ww_mastery


def register(app: FastAPI, svc, bus) -> None:
    def plan():
        p = getattr(svc, "plan", None)
        if p is None:
            raise HTTPException(503, "the plan store is not up yet")
        return p

    def guard(fn, *a):
        try:
            return fn(*a)
        except KeyError as e:
            raise HTTPException(404, str(e).strip("'\""))
        except ValueError as e:
            raise HTTPException(400, str(e))

    def publish(text: str) -> None:
        try:
            bus.publish("mission", "update", text[:140])
        except Exception:
            pass

    @app.get("/api/mission/mastery/{nid}")
    async def mastery(nid: str):
        return await run_in_threadpool(guard, ww_mastery.mastery, plan(), nid)

    @app.post("/api/mission/mastery/{nid}/{op}")
    async def mastery_op(nid: str, op: str, payload: Optional[dict] = Body(None)):
        p = plan()
        if op == "gate-solve":
            r = await run_in_threadpool(guard, ww_mastery.record_gate_solve, p, nid, str((payload or {}).get("question_id") or ""))
        elif op == "sharpen":
            r = await run_in_threadpool(guard, ww_mastery.sharpen, p, nid)
        elif op == "sharpen-done":
            r = await run_in_threadpool(guard, ww_mastery.finish_sharpen, p, nid)
        elif op == "demaster":
            r = await run_in_threadpool(guard, ww_mastery.demaster, p, nid)
        else:
            raise HTTPException(400, "op must be gate-solve, sharpen, sharpen-done or demaster")
        if r.get("ok"):
            publish(r.get("say", ""))
        return r
