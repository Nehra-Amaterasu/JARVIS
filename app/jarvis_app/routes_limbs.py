"""/api/limbs extras: the room's modes, a test click per relay, and the presence rule.

    POST   /api/limbs/modes/new             {name, set: {device: true|false, "*": ...}}
    PUT    /api/limbs/modes/{id}            {name?, set?}
    DELETE /api/limbs/modes/{id}
    POST   /api/limbs/{device}/test         flip one relay for 1 s and back; the board's receipt
    GET    /api/limbs/presence-on           the presence rule's settings, status, last decision
    POST   /api/limbs/presence-on/settings  {enabled?, window_min?, quiet_start?, quiet_end?, ...}

(GET /api/limbs, POST /api/limbs/{device} and POST /api/limbs/scene/{name} stay in
server.py.) Registering also hands the Uno transport to Connect, so its Detected list
shows the relay board from the transport's real state.
"""
from __future__ import annotations

from typing import Optional

from fastapi import Body, HTTPException
from starlette.concurrency import run_in_threadpool

from . import connect


def register(app, svc, bus) -> None:
    limbs = svc.limbs
    connect.bind_relays(getattr(svc, "relays", None))

    def call(fn, *a, **kw):
        try:
            return fn(*a, **kw)
        except KeyError as e:
            raise HTTPException(404, f"unknown: {e}")
        except ValueError as e:
            raise HTTPException(400, str(e))
        except RuntimeError as e:
            raise HTTPException(409, str(e))

    @app.post("/api/limbs/modes/new")
    def mode_new(name: str = Body(..., embed=True), set: dict = Body(..., embed=True)):
        return call(limbs.create_mode, name, set)

    @app.put("/api/limbs/modes/{mode_id}")
    def mode_update(mode_id: str, name: Optional[str] = Body(None, embed=True),
                    set: Optional[dict] = Body(None, embed=True)):
        return call(limbs.update_mode, mode_id, name, set)

    @app.delete("/api/limbs/modes/{mode_id}")
    def mode_delete(mode_id: str):
        call(limbs.delete_mode, mode_id)
        return {"deleted": mode_id}

    @app.post("/api/limbs/{device}/test")
    async def relay_test(device: str):
        return await run_in_threadpool(call, limbs.test_click, device)

    presence = getattr(svc, "presence_on", None)

    @app.get("/api/limbs/presence-on")
    def presence_get():
        if presence is None:
            raise HTTPException(404, "the presence rule is not running")
        return presence.view()

    @app.post("/api/limbs/presence-on/settings")
    def presence_set(changes: dict = Body(...)):
        if presence is None:
            raise HTTPException(404, "the presence rule is not running")
        return call(presence.set_settings, changes)
