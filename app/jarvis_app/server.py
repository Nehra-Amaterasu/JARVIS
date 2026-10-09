"""The JARVIS app server: one FastAPI app behind the window.

    /api/core/*      start / stop / talk to JARVIS          (core.py)
    /api/memory/*    Yaadash search, beliefs, people, taste (memory.py)
    /api/aankhen/*   spatial twin control                   (brain/aankhen/hub.py)
    /ws/aankhen      the twin's live stream                 (brain/aankhen/server.py)
    /api/limbs/*     the room's devices                     (limbs.py)
    /api/connect     what's plugged in                      (connect.py)
    /api/system/*    vitals, models                         (system.py)
    /api/mission     weekly roadmap numbers                 (mission.py)
    /ws/events       everything that happens, as it happens (bus.py)
    /                the UI bundle (app/ui/dist)

Every /api and /ws route is guarded (security.py). Slow work — memory search,
detection scans, model listings — runs in the threadpool so the stream never stalls.
"""
from __future__ import annotations

import asyncio
import json
import re
import threading
from contextlib import asynccontextmanager
from typing import Optional

from fastapi import Body, FastAPI, HTTPException, Request, WebSocket
from fastapi.responses import HTMLResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from starlette.concurrency import run_in_threadpool

from . import __version__, connect, memory, mission, system
from .bus import EventBus
from .core import CoreProcess
from .limbs import Limbs
from .paths import DOCS, UI_DIST, ensure_brain_importable
from .security import Guard

ensure_brain_importable()
from aankhen.hub import AankhenHub          # noqa: E402  (needs brain/ on the path)
from aankhen.server import attach           # noqa: E402


class Services:
    def __init__(self, bus: EventBus, guard: Guard):
        self.bus = bus
        self.core = CoreProcess(bus, f"http://127.0.0.1:{guard.port}", guard.token)
        self.limbs = Limbs(self.core)
        self.hub = AankhenHub()
        self._last_presence: Optional[str] = None
        self._seen_aankhen_event = 0


def create_app(guard: Guard, autostart_aankhen: str = "auto") -> FastAPI:
    bus = EventBus()
    svc = Services(bus, guard)

    async def aankhen_watch():
        """Relay the twin's presence changes and track events to the ticker."""
        while True:
            await asyncio.sleep(0.5)
            eng = svc.hub.engine
            if eng is None:
                continue
            try:
                f = eng.frame_message()
            except Exception:
                continue
            for e in f.get("events", []):
                if e["id"] > svc._seen_aankhen_event:
                    svc._seen_aankhen_event = e["id"]
                    bus.publish("aankhen", e["kind"], e["text"], sim=f["source"] != "hardware")
            st = (f.get("presence") or {}).get("state")
            if st and st != svc._last_presence:
                svc._last_presence = st
                bus.publish("aankhen", "presence", f"Room: {st}", state=st, sim=f["source"] != "hardware")

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        bus.bind(asyncio.get_running_loop())
        bus.publish("system", "boot", f"JARVIS app {__version__} online")

        def start_hub():
            try:
                info = svc.hub.start(autostart_aankhen)
                bus.publish("aankhen", "source", f"Aankhen: {info['kind']}"
                            + (f" · {info['scenario']}" if info.get("scenario") else ""), info=info)
            except Exception as e:
                svc.hub.error = str(e)
                bus.publish("aankhen", "error", f"Aankhen failed to start: {e}")
        if autostart_aankhen != "off":
            threading.Thread(target=start_hub, daemon=True).start()
        watcher = asyncio.create_task(aankhen_watch())
        yield
        watcher.cancel()
        svc.core.stop()
        svc.hub.stop()

    app = FastAPI(title="JARVIS", version=__version__, lifespan=lifespan,
                  docs_url=None, redoc_url=None, openapi_url=None)
    app.state.svc = svc

    @app.middleware("http")
    async def guard_api(request: Request, call_next):
        path = request.url.path
        if not guard.host_ok(request.headers.get("host")):
            return JSONResponse({"error": "bad host"}, status_code=403)
        if path.startswith("/api/") and path != "/api/health" and not guard.http_ok(request):
            return JSONResponse({"error": "unauthorised"}, status_code=401)
        return await call_next(request)

    # ------------------------------------------------------------- health
    @app.get("/api/health")
    def health():
        return {"ok": True, "version": __version__}

    # ------------------------------------------------------------- core
    @app.get("/api/core")
    def core_info():
        return svc.core.info()

    @app.post("/api/core/start")
    def core_start(mode: str = Body("voice", embed=True)):
        try:
            return svc.core.start(mode)
        except Exception as e:
            raise HTTPException(400, str(e))

    @app.post("/api/core/stop")
    def core_stop():
        return svc.core.stop()

    @app.post("/api/core/say")
    def core_say(text: str = Body(..., embed=True)):
        try:
            svc.core.say(text)
        except Exception as e:
            raise HTTPException(409, str(e))
        return {"ok": True}

    @app.get("/api/core/transcript")
    def core_transcript(n: int = 60):
        return svc.core.transcript(n)

    @app.get("/api/core/logs")
    def core_logs(n: int = 300):
        return svc.core.log_tail(n)

    # ------------------------------------------------------------- memory
    @app.get("/api/memory/stats")
    async def mem_stats():
        return await run_in_threadpool(memory.stats)

    @app.get("/api/memory/search")
    async def mem_search(q: str, k: int = 4):
        if not q.strip():
            raise HTTPException(400, "empty query")
        res = await run_in_threadpool(memory.search, q.strip(), k)
        bus.publish("memory", "search", f"Recalled “{q.strip()[:40]}”: "
                    f"{len(res['excerpts'])} moment(s), {len(res['facts'])} fact(s)")
        return res

    @app.get("/api/memory/questions")
    async def mem_questions(n: int = 6):
        return await run_in_threadpool(memory.questions, n)

    @app.post("/api/memory/beliefs/{belief_id}")
    async def mem_answer(belief_id: str, verdict: str = Body(..., embed=True),
                         correction: Optional[str] = Body(None, embed=True)):
        try:
            ok = await run_in_threadpool(memory.answer, belief_id, verdict, correction)
        except ValueError as e:
            raise HTTPException(400, str(e))
        if not ok:
            raise HTTPException(404, "no such belief")
        bus.publish("memory", "belief", f"Belief {verdict}" + (" with a correction" if correction else ""),
                    verdict=verdict)
        return {"ok": True}

    @app.get("/api/memory/beliefs")
    async def mem_beliefs(status: str = "confirmed", limit: int = 40):
        return await run_in_threadpool(memory.beliefs, status, limit)

    @app.get("/api/memory/people")
    async def mem_people(limit: int = 30):
        return await run_in_threadpool(memory.people, limit)

    @app.get("/api/memory/taste")
    async def mem_taste():
        return await run_in_threadpool(memory.taste)

    # ------------------------------------------------------------- aankhen
    @app.get("/api/aankhen")
    def aankhen_info():
        return svc.hub.info()

    @app.post("/api/aankhen/start")
    async def aankhen_start(mode: str = Body("auto", embed=True), scenario: str = Body("evening", embed=True),
                            port: Optional[str] = Body(None, embed=True), path: Optional[str] = Body(None, embed=True),
                            speed: float = Body(1.0, embed=True)):
        try:
            info = await run_in_threadpool(svc.hub.start, mode, scenario, port, path, speed)
        except Exception as e:
            raise HTTPException(400, str(e))
        bus.publish("aankhen", "source", f"Aankhen: {info['kind']}"
                    + (f" · {info['scenario']}" if info.get("scenario") else ""), info=info)
        return info

    @app.post("/api/aankhen/stop")
    def aankhen_stop():
        svc.hub.stop()
        bus.publish("aankhen", "source", "Aankhen stopped")
        return svc.hub.info()

    @app.get("/api/aankhen/snapshot")
    def aankhen_snapshot():
        return svc.hub.snapshot()

    attach(app, svc.hub, "/ws/aankhen", authorize=guard.ws_ok)

    # ------------------------------------------------------------- limbs
    @app.get("/api/limbs")
    def limbs_view():
        return svc.limbs.view()

    @app.post("/api/limbs/{device}")
    def limbs_control(device: str, action: str = Body(..., embed=True), value: Optional[int] = Body(None, embed=True)):
        try:
            svc.limbs.control(device, action, value)
        except (ValueError, RuntimeError) as e:
            raise HTTPException(409, str(e))
        return {"ok": True}

    @app.post("/api/limbs/scene/{name}")
    def limbs_scene(name: str):
        try:
            svc.limbs.scene(name)
        except (ValueError, RuntimeError) as e:
            raise HTTPException(409, str(e))
        return {"ok": True}

    # ------------------------------------------------------------- connect / system
    @app.get("/api/connect")
    async def connect_view():
        return await run_in_threadpool(connect.detect, svc.core.info(), svc.hub.info())

    @app.get("/api/system")
    async def system_view():
        v = await run_in_threadpool(system.vitals)
        v["core"] = svc.core.info()
        v["aankhen"] = svc.hub.info()
        return v

    @app.get("/api/system/models")
    async def system_models():
        return await run_in_threadpool(system.models)

    @app.post("/api/system/unload")
    async def system_unload(model: str = Body(..., embed=True)):
        ok = await run_in_threadpool(system.ollama_unload, model)
        bus.publish("system", "unload", f"Unloaded {model} from VRAM" if ok else f"Could not unload {model}")
        return {"ok": ok}

    @app.get("/api/decisions")
    def decisions(limit: int = 12):
        """The engineering log's entries (newest first): title + first paragraph."""
        try:
            text = (DOCS / "DECISIONS.md").read_text(encoding="utf-8")
        except FileNotFoundError:
            return []
        out = []
        for block in re.split(r"\n## ", text)[1:limit + 1]:
            title, _, body = block.partition("\n")
            para = next((p.strip() for p in body.split("\n\n") if p.strip() and not p.startswith("---")), "")
            out.append({"title": title.strip(), "summary": re.sub(r"\s+", " ", para)[:420]})
        return out

    # ------------------------------------------------------------- mission
    @app.get("/api/mission")
    def mission_view():
        return mission.view()

    @app.post("/api/mission")
    def mission_add(kind: str = Body(..., embed=True), delta: int = Body(..., embed=True)):
        try:
            v = mission.add(kind, delta)
        except ValueError as e:
            raise HTTPException(400, str(e))
        bus.publish("mission", "log", f"{mission.LABELS[kind]} {'+' if delta >= 0 else ''}{delta}"
                    + (" min" if kind == "german_min" else ""))
        return v

    # ------------------------------------------------------------- events
    @app.websocket("/ws/events")
    async def events_ws(ws: WebSocket):
        if not guard.ws_ok(ws):
            await ws.close(code=4403)
            return
        await ws.accept()
        q = bus.subscribe()
        try:
            await ws.send_text(json.dumps({"kind": "history", "events": bus.history(80)}))
            while True:
                ev = await q.get()
                await ws.send_text(json.dumps(ev, ensure_ascii=False))
        except Exception:
            pass
        finally:
            bus.unsubscribe(q)

    # ------------------------------------------------------------- UI
    if UI_DIST.exists():
        app.mount("/", StaticFiles(directory=str(UI_DIST), html=True), name="ui")
    else:
        @app.get("/", response_class=HTMLResponse)
        def no_ui():
            return ("<body style='background:#050506;color:#ddd;font:15px system-ui;padding:40px'>"
                    "<h2>JARVIS server is running</h2><p>The interface isn't built yet. Run "
                    "<code>npm run build</code> in <code>app/ui</code>.</p></body>")
    return app
