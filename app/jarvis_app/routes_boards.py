"""Boards: which USB serial device is which, and boards plugged in while JARVIS runs.

    GET  /api/boards        every USB serial port with what it said (aankhen/boards.py),
                            the live link's handshake, and the hot-plug watcher's state
    POST /api/boards/scan   look again now, asking even the ports that answered "not
                            Aankhen" before (a person pressed Scan: worth an Uno reset)

Registering also does the two things server.py cannot be edited for (ROADMAP F2, F4):
  - hot-plug: the hub's watcher is switched on, and what it finds goes on the event
    bus ("ESP32 found on COM7: switched to live hardware", or, when a simulation was
    chosen, "...still running the simulation you chose");
  - Connect: the running JARVIS process is bound, so the voice's status can come from
    the voice engine's own log.
AANKHEN_HOTPLUG=0 leaves the watcher off (the app's test suite does: tests never touch
real ports).
"""
from __future__ import annotations

import os

from starlette.concurrency import run_in_threadpool

from . import connect


def hotplug_wanted() -> bool:
    return os.environ.get("AANKHEN_HOTPLUG", "1").strip().lower() not in ("0", "off", "false", "no")


def boards_view(hub, force: bool = False) -> dict:
    results = hub.boards_scan(force=force)
    info = hub.info()
    return {
        "ports": [r.to_dict() for r in results],
        "board": info.get("board") or {},
        "hub": {k: info.get(k) for k in ("running", "mode", "kind", "scenario", "requested_mode", "port")},
        "hotplug": hub.hotplug_info(),
    }


def summary(view: dict) -> str:
    ports = view["ports"]
    boards = [p["device"] for p in ports if p["verdict"] == "aankhen"]
    others = len(ports) - len(boards)
    if not ports:
        return "USB scan: no USB serial devices"
    head = f"USB scan: Aankhen board on {', '.join(boards)}" if boards else "USB scan: no Aankhen board"
    return head + (f"; {others} other device(s)" if others else "")


def register(app, svc, bus) -> None:
    hub = svc.hub
    if hotplug_wanted():
        hub.enable_hotplug(lambda kind, text, **data: bus.publish("aankhen", kind, text, **data))
    connect.bind(core=svc.core, hub=hub)

    @app.get("/api/boards")
    async def boards_get():
        return await run_in_threadpool(boards_view, hub, False)

    @app.post("/api/boards/scan")
    async def boards_scan():
        view = await run_in_threadpool(boards_view, hub, True)
        bus.publish("aankhen", "scan", summary(view), ports=len(view["ports"]))
        return view
