"""WebSocket streaming for the Aankhen hub, mountable on any FastAPI app.

Protocol (JSON text frames):
  server -> client   room | frame (10 Hz) | heatmap (1 Hz, per client layer) | status (1 Hz)
                     | eyes (10 Hz, ONLY to clients that asked for it, see below)
  client -> server   {"type": "hello", "want": "snapshot" | "heatmap", "layer": "live" | "learned"}
                     {"type": "hello", "want": "eyes"}   start receiving "eyes" (also when
                                                         "want" is a list that includes it)
                     {"type": "hello", "drop": "eyes"}   stop receiving them

  eyes = {"type": "eyes", "source", "t" (device s), "rate_hz" (packets/s), "seconds"
          (stream since start or channel change),
          "column": [51] | null        amplitude ripple: per subcarrier (-26..-1, +2..+26),
                                       deviation from a ~10 s baseline in noise units, +-6
          "phase_column": [51] | null  the same from the phase, after removing the line
                                       the unsynchronised clocks scramble (eyes.py)
          "spectrum": {"hz": [64], "power": [64] log10 x noise floor, "peak_hz": float |
                       null, "bands": {"breathing", "body", "fast", "above"} x noise,
                       "window_s"} | null}
  Building it consumes the columns, so the server builds ONE per tick, and only when
  someone asked; clients that never ask get exactly what they always got.

Each client has a LATEST-WINS mailbox per message type. A slow client (a phone on
bad Wi-Fi, a background tab) never builds a backlog and never slows the others: if
it hasn't taken the previous frame yet, the new one simply replaces it.

Security: the hub reports presence in a home, so connections are refused unless
`authorize(websocket)` approves them. The standalone server below only accepts
browsers whose Origin is the server itself or localhost — a WebSocket is not
covered by CORS, so without this any web page the user visits could read it.
"""
from __future__ import annotations

import asyncio
import json
import os
from typing import Awaitable, Callable, Optional
from urllib.parse import urlparse

from fastapi import Request, WebSocket

from .hub import AankhenHub

FRAME_HZ = 10.0
STREAMS = ("eyes",)              # opt-in message types a hello can ask for (or drop)


def _names(v) -> set[str]:
    """A hello's "want"/"drop": one name or a list of names."""
    if isinstance(v, str):
        return {v}
    if isinstance(v, (list, tuple)):
        return {x for x in v if isinstance(x, str)}
    return set()


class _Client:
    def __init__(self, ws):
        self.ws = ws
        self.layer = "live"
        self.wants: set[str] = set()                 # opt-in streams (STREAMS)
        self.pending: dict[str, dict] = {}
        self.wake = asyncio.Event()

    def offer(self, msg: Optional[dict]) -> None:
        if msg is None:
            return
        key = msg["type"] if msg["type"] != "heatmap" else f"heatmap:{msg.get('layer')}"
        self.pending[key] = msg
        self.wake.set()

    async def pump(self) -> None:
        while True:
            await self.wake.wait()
            self.wake.clear()
            batch, self.pending = self.pending, {}
            for msg in batch.values():
                await self.ws.send_text(json.dumps(msg, separators=(",", ":")))


class Streamer:
    """Fans the hub's messages out to every connected client."""

    def __init__(self, hub: AankhenHub):
        self.hub = hub
        self.clients: set[_Client] = set()
        self._task: Optional[asyncio.Task] = None
        self._side: Optional[asyncio.Task] = None      # the lock-taking messages, off the schedule

    def ensure_running(self) -> None:
        if self._task is None or self._task.done():
            self._task = asyncio.get_running_loop().create_task(self._loop())

    async def _loop(self) -> None:
        tick = 0
        period = 1.0 / FRAME_HZ
        loop = asyncio.get_running_loop()
        due = loop.time()
        while True:
            # On a schedule, not "sleep 100 ms after the work": the sleep-after-work
            # loop ran at 1 / (0.1 s + the tick's work + the event loop's lag), 6.6 Hz in
            # the live app. A tick that overruns is not caught up with a burst.
            due += period
            now = loop.time()
            if due < now:
                due = now
            await asyncio.sleep(due - now)
            tick += 1
            if not self.clients:
                continue
            frame = self.hub.frame()             # published by the engine: no lock, no wait
            for c in list(self.clients):
                c.offer(frame)
            want_status = tick % 10 == 0
            layers = {c.layer for c in self.clients} if tick % 10 == 5 else set()
            # Built only when someone watches: it consumes the columns (engine.eyes_message).
            want_eyes = any("eyes" in c.wants for c in self.clients)
            if not (want_status or layers or want_eyes):
                continue
            # These take the engine lock, which a busy consumer can hold for whole bursts.
            # So they are built on a thread, beside the schedule: the wait stalls neither
            # the event loop (every other route, the app's watcher) nor the frames. While
            # one build is still waiting, the next tick's is skipped: status and heatmap are
            # latest-wins anyway, and the eyes columns keep accumulating for the next one.
            if self._side is None or self._side.done():
                self._side = loop.create_task(self._send_locked(want_status, layers, want_eyes))

    async def _send_locked(self, want_status: bool, layers: set, want_eyes: bool) -> None:
        status, heat, eyes = await asyncio.to_thread(self._locked_messages, want_status, layers, want_eyes)
        for c in list(self.clients):
            c.offer(status)
            if c.layer in heat:
                c.offer(heat[c.layer])
            if eyes is not None and "eyes" in c.wants:
                c.offer(eyes)

    def _locked_messages(self, want_status: bool, layers: set, want_eyes: bool):
        status = self.hub.status() if want_status else None
        heat = {layer: self.hub.heatmap(layer) for layer in layers}
        eyes = self.hub.eyes() if want_eyes else None
        return status, heat, eyes

    async def serve(self, ws) -> None:
        await ws.accept()
        self.ensure_running()
        client = _Client(ws)
        self.clients.add(client)
        client.offer(self.hub.room_message())
        client.offer(self.hub.status())
        client.offer(self.hub.heatmap("live"))
        pump = asyncio.get_running_loop().create_task(client.pump())
        try:
            while True:
                raw = await ws.receive_text()
                try:
                    msg = json.loads(raw)
                except json.JSONDecodeError:
                    continue
                if msg.get("type") == "hello":
                    if msg.get("layer") in ("live", "learned"):
                        client.layer = msg["layer"]
                    want = _names(msg.get("want"))
                    client.wants |= want & set(STREAMS)
                    client.wants -= _names(msg.get("drop"))
                    if "snapshot" in want:
                        client.offer(self.hub.room_message())
                        client.offer(self.hub.status())
                    client.offer(self.hub.heatmap(client.layer))
        except Exception:
            pass
        finally:
            self.clients.discard(client)
            pump.cancel()


def attach(app, hub: AankhenHub, path: str = "/ws",
           authorize: Optional[Callable[[object], bool]] = None) -> Streamer:
    """Register the WebSocket route on a FastAPI app.

    WebSocket is imported at module level on purpose: with postponed annotations
    FastAPI resolves the parameter's type from the module's globals, and a local
    import left it unresolved — every connection was rejected with HTTP 403.
    """
    streamer = Streamer(hub)

    @app.websocket(path)
    async def _aankhen_ws(ws: WebSocket):
        if authorize is not None and not authorize(ws):
            await ws.close(code=4403)
            return
        await streamer.serve(ws)

    attach_room_routes(app, hub)
    return streamer


def attach_room_routes(app, hub: AankhenHub, room_file: Optional[str] = None, data_dir: Optional[str] = None) -> None:
    """Measure my room + drill readiness, under /api/aankhen/ (the JARVIS app's token
    middleware guards every /api/ route, these included: test_room_routes)."""
    from fastapi import Body, HTTPException

    from . import DATA_DIR, measure, readiness
    from .room import ROOM_FILE
    rf, dd = room_file or ROOM_FILE, data_dir or DATA_DIR

    def _room() -> Optional[dict]:
        try:
            with open(rf, encoding="utf-8") as f:
                return json.load(f)
        except (OSError, ValueError):
            return None

    @app.get("/api/aankhen/readiness")
    def _readiness():
        return readiness.check(dd)

    @app.get("/api/aankhen/room-measure")
    def _room_get():
        return {"form": measure.form_from_room(_room()), "readiness": readiness.check(dd)}

    @app.post("/api/aankhen/room-measure")
    def _room_post(form: dict = Body(...)):
        errs = measure.validate(form)
        if errs:
            raise HTTPException(422, {"errors": errs})
        try:
            new = measure.save(form, rf)
        except ValueError as e:
            raise HTTPException(422, {"errors": [{"field": "", "error": str(e)}]})
        hub.measured_room(new)
        return {"ok": True, "layout": "measured", "readiness": readiness.check(dd)}


def local_origin_only(ws) -> bool:
    """Accept non-browser clients and browsers whose page came from this machine."""
    origin = ws.headers.get("origin")
    if not origin:
        return True                                    # not a browser (scripts, tests)
    host = urlparse(origin).hostname
    if host in ("localhost", "127.0.0.1", "::1"):
        return True
    return origin.split("://", 1)[-1] == ws.headers.get("host")


def create_standalone_app(hub: AankhenHub):
    """`python -m aankhen serve`: the hub + the lightweight phone/AR viewer."""
    from fastapi import FastAPI
    from fastapi.responses import JSONResponse
    from fastapi.staticfiles import StaticFiles

    app = FastAPI(title="Aankhen", docs_url=None, redoc_url=None)
    attach(app, hub, "/ws", authorize=local_origin_only)

    @app.get("/api/snapshot")
    def snapshot():
        return JSONResponse(hub.snapshot())

    @app.get("/api/info")
    def info():
        return JSONResponse(hub.info())

    # TEACH: label what you are doing, train on it (teach.py). Writes only from this
    # page: a cross-site request cannot set X-Aankhen without a CORS preflight, which
    # this server never approves, and the Origin, when sent, must be this host.
    # (Request is imported at module level: with postponed annotations FastAPI
    # resolves "Request" from the module's globals, or it reads it as a query param.)
    from fastapi.responses import Response

    def _same_page(req: Request) -> bool:
        if req.headers.get("x-aankhen") != "1":
            return False
        origin = req.headers.get("origin")
        return origin is None or origin.split("://", 1)[-1] == req.headers.get("host")

    def _guarded(fn):
        async def handler(req: Request):
            if not _same_page(req):
                return Response(status_code=403)
            try:
                body = await req.json() if req.headers.get("content-length") not in (None, "0") else {}
                return JSONResponse(fn(body))
            except (RuntimeError, ValueError) as e:
                return JSONResponse({"error": str(e)}, status_code=400)
        return handler

    @app.get("/api/teach")
    def teach_status():
        return JSONResponse(hub.teacher.status())

    app.post("/api/teach/start")(_guarded(lambda b: hub.teacher.start()))
    app.post("/api/teach/label")(_guarded(lambda b: hub.teacher.label(b.get("label") or None)))
    app.post("/api/teach/stop")(_guarded(lambda b: hub.teacher.stop()))
    app.post("/api/learn/train")(_guarded(lambda b: hub.teacher.train_async(bool(b.get("include_sim", True)))))

    web = os.path.join(os.path.dirname(os.path.abspath(__file__)), "web")
    app.mount("/", StaticFiles(directory=web, html=True), name="web")
    return app
