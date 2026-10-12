"""/api/energy/*: the energy ledger, reports, circuits and the empty-room nudges.

    GET  /api/energy?period=day|week|month   everything the Energy card shows
    GET  /api/energy/report?period=&at=      one report (at = any timestamp in the period)
    GET  /api/energy/circuits                the switchboard, with each relay's safety verdict
    POST /api/energy/circuits/{id}/relay     {"channel": n | null}; unsafe loads are refused (400)
    POST /api/energy/circuits/{id}/state     {"on": bool, "level"?: n}; switches it if JARVIS can,
                                             otherwise records what you reported (and says so)
    POST /api/energy/nudges/{id}/keep        "keep it on": no automatic switch-off this episode
    POST /api/energy/auto-off                {"enabled": bool}

The detector ticks every 5 s in a background task. server.py's lifespan is not edited:
this module wraps it, so the task starts and stops with the app.
"""
from __future__ import annotations

import asyncio
from contextlib import asynccontextmanager
from typing import Optional

from fastapi import Body, FastAPI, HTTPException
from starlette.concurrency import run_in_threadpool

from .circuits import RelaySafetyError
from .energy import PERIODS
from .energy_service import TICK_S, EnergyService


def register(app: FastAPI, svc, bus) -> None:
    service = EnergyService(svc.limbs, bus, core=svc.core, hub=svc.hub)
    svc.energy = service
    app.state.energy = service

    async def tick_loop():
        while True:
            await asyncio.sleep(TICK_S)
            try:
                await run_in_threadpool(service.tick)
            except Exception as e:                       # one bad tick must not end the loop
                bus.publish("energy", "error", f"Energy tick failed: {e}")

    inner = app.router.lifespan_context

    @asynccontextmanager
    async def lifespan(a):
        async with inner(a) as state:
            task = asyncio.create_task(tick_loop())
            try:
                yield state
            finally:
                task.cancel()

    app.router.lifespan_context = lifespan

    def _period(period: str) -> str:
        if period not in PERIODS:
            raise HTTPException(400, f"period must be one of {', '.join(PERIODS)}")
        return period

    @app.get("/api/energy")
    async def energy_view(period: str = "day"):
        return await run_in_threadpool(service.view, _period(period))

    @app.get("/api/energy/report")
    async def energy_report(period: str = "day", at: Optional[float] = None):
        return await run_in_threadpool(service.report, _period(period), at)

    @app.get("/api/energy/circuits")
    def energy_circuits():
        return service.circuits.to_dict()

    @app.post("/api/energy/circuits/{cid}/relay")
    def energy_relay(cid: str, channel: Optional[int] = Body(None, embed=True)):
        try:
            return service.assign_relay(cid, channel)
        except KeyError:
            raise HTTPException(404, f"no circuit {cid}")
        except RelaySafetyError as e:
            bus.publish("energy", "refused", str(e), circuit=cid)
            raise HTTPException(400, str(e))

    @app.post("/api/energy/circuits/{cid}/state")
    def energy_state(cid: str, on: bool = Body(..., embed=True), level: Optional[int] = Body(None, embed=True)):
        try:
            return service.set_state(cid, on, level)
        except KeyError:
            raise HTTPException(404, f"no circuit {cid}")
        except ValueError as e:
            raise HTTPException(400, str(e))

    @app.post("/api/energy/nudges/{nid}/keep")
    def energy_keep(nid: str):
        try:
            return service.keep(nid)
        except KeyError:
            raise HTTPException(404, "no such nudge")

    @app.post("/api/energy/auto-off")
    def energy_auto_off(enabled: bool = Body(..., embed=True)):
        return service.set_auto_off(enabled)
