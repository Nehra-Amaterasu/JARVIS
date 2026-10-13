"""/api/media: play a song by name, control what is playing, say what is on (media.py).

    POST /api/media/play       {query, source?}   source: auto | local | youtube | ytmusic | spotify
    POST /api/media/control    {action, value?, target?}   action: play | pause | toggle | next | prev | volume
    GET  /api/media/state      what was last asked for, the window's player, Windows' media sessions
    GET  /api/media/settings   PUT {folder?, default_source?}    POST /api/media/scan
    GET  /api/media/file/{id}  a song from the indexed folder (never a path from the request)
    POST /api/media/ack        the window's answer to a play/control it was sent
    POST /api/media/local      the window's player changed state (playing, paused, ended)

Every play and control answers with a receipt: {ok, say, confirmed, ...}. `say` is the
one true sentence JARVIS speaks; `confirmed` is True only when something reported the
effect. A song from the music folder is played by the window, the same round trip the
Mission game uses: an ephemeral bus event out, the window's answer back, here.
"""
from __future__ import annotations

import asyncio
import secrets
import threading
from contextlib import asynccontextmanager
from typing import Any, Optional

from fastapi import Body, FastAPI, HTTPException
from fastapi.responses import FileResponse
from starlette.concurrency import run_in_threadpool

from .media import AUDIO_EXT, MediaError, MediaPlayer, public, track_say
from .paths import DATA

WINDOW_ANSWER_S = 5.0        # the window fetches the file (local, ~10 ms) and calls play()


def _lifetime(app: FastAPI, start, close) -> None:
    """start() in the background once the server is up; close() when it stops."""
    inner = app.router.lifespan_context

    @asynccontextmanager
    async def lifespan(a):
        async with inner(a) as state:
            threading.Thread(target=start, name="media-warm", daemon=True).start()
            try:
                yield state
            finally:
                close()
    app.router.lifespan_context = lifespan


def register(app: FastAPI, svc, bus) -> None:
    player = MediaPlayer(DATA / "media")
    app.state.media = player
    if svc is not None:
        svc.media = player
    # Windows' media sessions are read by a PowerShell that takes 1-5 s to give its first
    # reading (measured, research note): start it with the app, not on his first "play".
    _lifetime(app, player.warm, player.close)
    pending: dict[str, list] = {}

    async def to_window(kind: str, text: str, **data) -> Optional[dict]:
        """Send the window a job; its answer, {"ok": False, "error": "timeout"}, or None
        when no window is open."""
        if bus.listeners == 0:
            return None
        rid = secrets.token_hex(8)
        done = asyncio.Event()
        pending[rid] = [done, None]
        bus.publish("media", kind, text, ephemeral=True, request_id=rid, **data)
        try:
            await asyncio.wait_for(done.wait(), timeout=WINDOW_ANSWER_S)
        except asyncio.TimeoutError:
            return {"ok": False, "error": "timeout"}
        finally:
            entry = pending.pop(rid, [None, None])
        return entry[1] or {"ok": False, "error": "no answer"}

    def tell(r: dict) -> dict:
        # `via`, not `source`: the bus's own first argument is called source.
        bus.publish("media", r["action"], r["say"], ok=r["ok"], confirmed=r["confirmed"], via=r.get("source"))
        return r

    async def play_local(plan: dict) -> dict:
        t = plan["track"]
        answer = await to_window("local_play", f"Media: playing {track_say(t)}", track=public(t))
        return player.local_result(plan, answer)

    @app.post("/api/media/play")
    async def media_play(payload: dict = Body(...)):
        query = str(payload.get("query") or "").strip()
        source = str(payload.get("source") or "auto")
        if not query:                                # "play" alone: resume what was playing
            return await media_control_run("play", None)
        try:
            plan = await run_in_threadpool(player.plan, query, source, bus.listeners > 0)
        except MediaError as e:
            raise HTTPException(400, str(e))
        if plan["kind"] == "local":
            return tell(await play_local(plan))
        if plan["kind"] == "online":
            return tell(await run_in_threadpool(player.open_online, plan))
        return tell(plan["receipt"])

    async def media_control_run(action: str, value: Any, target: Optional[str] = None) -> dict:
        try:
            plan = await run_in_threadpool(player.control, action, value, target)
        except MediaError as e:
            raise HTTPException(400, str(e))
        if plan["kind"] == "local":
            answer = await to_window("local_control", f"Media: {plan['action']}", action=plan["action"])
            return tell(player.local_control_result(plan["action"], answer))
        if plan["kind"] == "local_play":
            r = await play_local(plan)
            r["action"] = plan["action"]
            return tell(r)
        return tell(plan["receipt"])

    @app.post("/api/media/control")
    async def media_control(action: str = Body(..., embed=True), value: Any = Body(None, embed=True),
                            target: Optional[str] = Body(None, embed=True)):
        return await media_control_run(str(action), value, "local" if target == "local" else None)

    @app.get("/api/media/state")
    async def media_state():
        return await run_in_threadpool(player.state)

    @app.get("/api/media/settings")
    def media_settings():
        return player.view()

    def scan_and_tell(folder=None) -> dict:
        folder = folder or player.library.folder
        if folder is None:
            raise MediaError("No music folder is set.")
        res = player.library.scan(folder)
        bus.publish("media", "scan", f"Music folder: {res['tracks']} songs"
                    + (" (stopped at the cap)" if res["truncated"] else "") + f" ({res['took_s']:.1f} s)", **res)
        return res

    def scan_in_background(folder) -> None:
        try:
            scan_and_tell(folder)
        except Exception as e:                       # a scan that dies says so, on the ticker
            bus.publish("media", "error", f"Music folder scan failed: {type(e).__name__}: {e}")

    @app.put("/api/media/settings")
    async def media_settings_put(folder: Optional[str] = Body(None, embed=True),
                                 default_source: Optional[str] = Body(None, embed=True)):
        try:
            if default_source is not None:
                player.set_default_source(default_source)
            if folder is not None:
                if folder.strip():
                    path = player.check_folder(folder)
                    player.library.scanning = True
                    # A big folder takes a while: scan in the background, say when done.
                    threading.Thread(target=scan_in_background, args=(path,), name="media-scan", daemon=True).start()
                else:
                    player.library.forget()
        except MediaError as e:
            raise HTTPException(400, str(e))
        return player.view()

    @app.post("/api/media/scan")
    async def media_scan():
        try:
            return await run_in_threadpool(scan_and_tell)
        except MediaError as e:
            raise HTTPException(400, str(e))

    @app.get("/api/media/file/{track_id}")
    def media_file(track_id: str):
        t = player.library.get(track_id)
        path = player.library.path_of(t) if t else None
        if path is None:
            raise HTTPException(404, "no such song in the music folder")
        return FileResponse(str(path), media_type=AUDIO_EXT.get(path.suffix.lower(), "application/octet-stream"))

    @app.post("/api/media/ack")
    async def media_ack(payload: dict = Body(...)):
        entry = pending.get(str(payload.get("id") or ""))
        if not entry:
            raise HTTPException(404, "unknown or expired request")
        entry[1] = {"ok": bool(payload.get("ok")), "error": str(payload.get("error") or "")[:200] or None}
        entry[0].set()
        return {"ok": True}

    @app.post("/api/media/local")
    def media_local(state: str = Body(..., embed=True), track_id: Optional[str] = Body(None, embed=True)):
        try:
            return player.set_local(state, track_id)
        except MediaError as e:
            raise HTTPException(400, str(e))
