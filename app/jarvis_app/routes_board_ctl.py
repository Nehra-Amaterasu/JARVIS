"""The ESP32 on the Limbs tab: its live state, its firmware, flashing, relay test clicks.

    GET  /api/board                     the board over USB or Wi-Fi, the last build, the job
    POST /api/board/wifi                {ip}: where the board is on the Wi-Fi (else learnt from USB)
    GET  /api/board/config              config.h's editable #defines, with the form's rules
    POST /api/board/config              {changes: {KEY: value}}: validated, then written
    GET  /api/board/source?name=        firmware.ino or config.h, read-only (never secrets.h)
    POST /api/board/compile             arduino-cli compile into data/app/firmware/build
    GET  /api/board/job                 the running or last compile/flash, with its output
    POST /api/board/flash/plan          {target: usb|wifi, port?, ip?}: what a flash would do
    POST /api/board/flash               {plan_id, confirm: true, password?}: do it
    POST /api/board/relay-test/{device} toggle one relay for 1 s, restore it, return a receipt

Nothing uploads without both calls: the plan (a click) and the flash with that plan's id
and confirm=true (the confirm button). The logic lives in board_ctl.py.
"""
from __future__ import annotations

from typing import Any, Optional

from fastapi import Body, HTTPException
from starlette.concurrency import run_in_threadpool

from .board_ctl import BoardControl, BoardError


def register(app, svc, bus) -> None:
    ctl = BoardControl(svc.hub, svc.limbs, bus)
    app.state.board_ctl = ctl

    def call(fn, *a, **kw):
        try:
            return fn(*a, **kw)
        except BoardError as e:
            raise HTTPException(e.status, str(e))
        except (OSError, ValueError) as e:
            raise HTTPException(400, f"{type(e).__name__}: {e}")

    @app.get("/api/board")
    async def board_view():
        return await run_in_threadpool(call, ctl.view)

    @app.post("/api/board/wifi")
    def board_wifi(ip: str = Body(..., embed=True)):
        return call(ctl.set_ip, ip)

    @app.get("/api/board/config")
    def board_config():
        return call(ctl.config_view)

    @app.post("/api/board/config")
    def board_config_set(changes: dict = Body(..., embed=True)):
        return call(ctl.update_config, changes)

    @app.get("/api/board/source")
    def board_source(name: str = "firmware.ino"):
        return call(ctl.source, name)

    @app.post("/api/board/compile")
    def board_compile():
        return call(ctl.start_compile)

    @app.get("/api/board/job")
    def board_job():
        return {"job": ctl.job_view()}

    @app.post("/api/board/flash/plan")
    async def board_flash_plan(target: str = Body(..., embed=True), port: Optional[str] = Body(None, embed=True),
                               ip: Optional[str] = Body(None, embed=True)):
        return await run_in_threadpool(call, ctl.plan_flash, target, port, ip)

    @app.post("/api/board/flash")
    def board_flash(plan_id: str = Body("", embed=True), confirm: Any = Body(None, embed=True),
                    password: Optional[str] = Body(None, embed=True)):
        return call(ctl.flash, plan_id, confirm, password)

    @app.post("/api/board/relay-test/{device}")
    async def board_relay_test(device: str):
        return await run_in_threadpool(call, ctl.relay_test, device)
