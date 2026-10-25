"""The JARVIS app server: one FastAPI app behind the window.

    /api/core/*      start / stop / talk to JARVIS          (core.py)
    /api/memory/*    Yaadash search, beliefs, corrections, people, taste (memory.py)
    /api/aankhen/*   spatial twin control                   (aankhen/hub.py)
    /ws/aankhen      the twin's live stream                 (aankhen/server.py)
    /api/limbs/*     the room's devices                     (limbs.py)
    /api/connect     what's plugged in                      (connect.py)
    /api/system/*    vitals, models                         (system.py)
    /api/kv/*, /api/germoney/*   Mission Germoney     (germoney.py)
    /api/transcripts/*           conversation history (transcripts.py)
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
from typing import Iterable, Optional

from fastapi import Body, FastAPI, HTTPException, Request, WebSocket
from fastapi.responses import HTMLResponse, JSONResponse, RedirectResponse, Response
from fastapi.staticfiles import StaticFiles
from starlette.concurrency import run_in_threadpool

from . import __version__, connect, germoney, memory, system
from .bus import EventBus
from .core import CoreProcess
from .limbs import Limbs
from .paths import DATA, DOCS, UI_DIST, ensure_jarvis_importable
from .security import Guard
from .wsutil import serve_until_gone

ensure_jarvis_importable()
from aankhen.hub import AankhenHub          # noqa: E402  (needs the JARVIS root on the path)
from aankhen.server import attach           # noqa: E402


class Services:
    def __init__(self, bus: EventBus, guard: Guard):
        self.bus = bus
        self.core = CoreProcess(bus, f"http://127.0.0.1:{guard.port}", guard.token)
        self.hub = AankhenHub()
        # The relay board: an Arduino Uno on USB (uno.py) since 2026-10-13. JARVIS_UNO=0
        # turns it off (tests); then the ESP32 hub path is used, as before.
        from . import uno
        self.relays = uno.UnoRelays(bus) if uno.enabled() else None
        self.limbs = Limbs(self.core, self.hub, bus, relays=self.relays)
        # After the Uno is adopted (its relays boot OFF), presence_on.py may switch the
        # room back on once per app start when he is there (A6, 2026-10-15).
        from .presence_on import PresenceOn
        self.presence_on = PresenceOn(self.limbs, bus, hub=self.hub, core=self.core)
        if self.relays is not None:
            self.relays.on_connect = lambda: (self.limbs.adopt_board(), self.presence_on.start())
        self.core.room_boot_listener = self.limbs.sync_core
        self._board_was_connected = False
        self.kv = germoney.KVStore()
        self.calendar = germoney.Calendar()
        self._last_presence: Optional[str] = None
        # Game actions waiting for the Mission UI to answer: id -> (event, result)
        self.game_pending: dict[str, list] = {}
        self._seen_aankhen_event = 0


def register_feature_routes(app: FastAPI, svc: "Services", bus: EventBus,
                            only: Optional[Iterable[str]] = None) -> list[tuple[str, str]]:
    """Import every jarvis_app/routes_*.py and call its register(app, svc, bus).
    Returns (module, error) for the ones that failed, in name order.

    `only` (tests): register just these features ("settings" for routes_settings.py).
    FastAPI builds a pydantic model per route, ~200 routes in all, and that was 40 % of
    the app suite's time (10-23 audit: about 1 s per create_app on this laptop)."""
    import importlib
    import pkgutil
    from . import __path__ as pkg_path
    failed = []
    for m in sorted(pkgutil.iter_modules(pkg_path), key=lambda m: m.name):
        if not m.name.startswith("routes_"):
            continue
        if only is not None and m.name[len("routes_"):] not in only:
            continue
        try:
            importlib.import_module(f"{__package__}.{m.name}").register(app, svc, bus)
        except Exception as e:                       # one broken feature must not stop the app
            failed.append((m.name, f"{type(e).__name__}: {e}"))
    return failed


def create_app(guard: Guard, autostart_aankhen: str = "auto", features: Optional[Iterable[str]] = None) -> FastAPI:
    bus = EventBus()
    svc = Services(bus, guard)

    async def aankhen_watch():
        """Relay the twin's presence changes and track events to the ticker."""
        while True:
            await asyncio.sleep(0.5)
            # An ESP32 that (re)connects, over USB or Wi-Fi: the room adopts its relays
            # (limbs.resync_hardware; never pushed), then the presence rule may run.
            connected = svc.hub.can_command
            if connected and not svc._board_was_connected:
                res = await run_in_threadpool(svc.limbs.resync_hardware)
                took = ", ".join(f"{d} {'on' if on else 'off'}" for d, on in res.items())
                bus.publish("limbs", "board", "ESP32 connected: the room took its relay states"
                            + (f" ({took})" if took else ""), adopted=res)
            svc._board_was_connected = connected
            eng = svc.hub.engine
            if eng is None:
                continue
            try:
                f = eng.latest_frame()       # no engine lock: this runs on the event loop
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
        if svc.relays is not None:
            svc.relays.start()
        watcher = asyncio.create_task(aankhen_watch())
        yield
        svc.presence_on.stop()
        if svc.relays is not None:
            svc.relays.stop()
        watcher.cancel()
        svc.core.stop()
        svc.hub.stop()

    app = FastAPI(title="JARVIS", version=__version__, lifespan=lifespan,
                  docs_url=None, redoc_url=None, openapi_url=None)
    app.state.svc = svc
    app.state.guard = guard

    @app.middleware("http")
    async def guard_api(request: Request, call_next):
        path = request.url.path
        # A request that came in on the phone listener (phone.py; off unless switched on)
        # answers to the phone's rules only: its own hosts, a paired device, its own routes.
        phone = getattr(app.state, "phone", None)
        if phone is not None and phone.is_remote(request.scope):
            status, reason, device = phone.check(
                method=request.method, path=path, host=request.headers.get("host"),
                client=request.client.host if request.client else None,
                origin=request.headers.get("origin"), header=request.headers.get("x-jarvis-phone"),
                cookies=request.cookies)
            if status == 307:
                return RedirectResponse(reason, status_code=307)
            if status != 200:
                return JSONResponse({"error": reason}, status_code=status)
            request.state.phone_device = device
            return await call_next(request)
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

    @app.post("/api/core/speak")
    def core_speak(text: str = Body(..., embed=True)):
        try:
            return {"ok": True, "turn": svc.core.speak(text)}
        except Exception as e:
            raise HTTPException(409, str(e))

    # ------------------------------------------------------------ the Mission game <-> JARVIS
    # The game's rules live in the UI (one engine, unit-tested there). JARVIS reaches
    # them through here: a voice action becomes an ephemeral bus event, the Mission
    # UI runs it and posts the result back, and this request returns it as one line.
    @app.get("/api/game/brief")
    def game_brief():
        raw = svc.kv.get("@silicon_game_brief")
        if not raw:
            raise HTTPException(404, "No mission brief yet — open the Mission tab once.")
        try:
            return json.loads(raw)
        except ValueError:
            raise HTTPException(500, "The stored brief is damaged.")

    @app.post("/api/game/action")
    async def game_action(payload: dict = Body(...)):
        action = str(payload.get("action") or "")
        if not re.fullmatch(r"[a-z_]{2,24}", action):
            raise HTTPException(400, "bad action")
        args = payload.get("args") or {}
        if not isinstance(args, dict):
            raise HTTPException(400, "args must be an object")
        if bus.listeners == 0:
            raise HTTPException(503, "The JARVIS window is not open, so the game cannot run the action.")
        import secrets
        action_id = secrets.token_hex(8)
        done = asyncio.Event()
        svc.game_pending[action_id] = [done, None]
        bus.publish("game", "action", f"game: {action}", ephemeral=True, action_id=action_id, action=action, args=args)
        try:
            await asyncio.wait_for(done.wait(), timeout=6)
        except asyncio.TimeoutError:
            raise HTTPException(504, "The Mission screen did not answer.")
        finally:
            entry = svc.game_pending.pop(action_id, [None, None])
        return entry[1]

    @app.post("/api/game/result")
    async def game_result(payload: dict = Body(...)):
        entry = svc.game_pending.get(str(payload.get("id") or ""))
        if not entry:
            raise HTTPException(404, "unknown or expired action")
        entry[1] = {"ok": bool(payload.get("ok")), "say": str(payload.get("say") or "")[:800], "data": payload.get("data")}
        entry[0].set()
        if entry[1]["say"]:
            bus.publish("game", "result", entry[1]["say"][:140])
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

    @app.post("/api/memory/teach")
    async def mem_teach(answer: str = Body(..., embed=True), question: str = Body("", embed=True)):
        try:
            added = await run_in_threadpool(memory.teach, question, answer)
        except ValueError as e:
            raise HTTPException(400, str(e))
        bus.publish("memory", "teach", "Learned a correction" if added else "Already knew that correction")
        return {"ok": True, "added": added}

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

    # Teach: I label what I am doing while Aankhen records, then the spatial model
    # trains on it and is scored on time it never saw (aankhen/teach.py). Recordings
    # made while the simulator runs are named teach-sim-* and never trained on.
    def _teach(fn):
        try:
            return fn()
        except (RuntimeError, ValueError) as e:
            raise HTTPException(400, str(e))

    @app.get("/api/aankhen/teach")
    def aankhen_teach():
        return svc.hub.teacher.status()

    @app.post("/api/aankhen/teach/start")
    def aankhen_teach_start():
        return _teach(svc.hub.teacher.start)

    @app.post("/api/aankhen/teach/label")
    def aankhen_teach_label(label: Optional[str] = Body(None, embed=True)):
        return _teach(lambda: svc.hub.teacher.label(label or None))

    @app.post("/api/aankhen/teach/stop")
    def aankhen_teach_stop():
        return _teach(svc.hub.teacher.stop)

    @app.post("/api/aankhen/learn/train")
    def aankhen_learn_train(include_sim: bool = Body(True, embed=True)):
        info = _teach(lambda: svc.hub.teacher.train_async(include_sim))
        bus.publish("aankhen", "learn", "Aankhen: training the spatial model on my labels")
        return info

    attach(app, svc.hub, "/ws/aankhen", authorize=guard.ws_ok)

    # ------------------------------------------------------------- limbs
    @app.get("/api/limbs")
    def limbs_view():
        return svc.limbs.view()

    @app.post("/api/limbs/scene/{name}")
    def limbs_scene(name: str):
        try:
            return svc.limbs.scene(name)
        except ValueError as e:
            raise HTTPException(400, str(e))

    @app.post("/api/limbs/{device}")
    def limbs_control(device: str, action: str = Body(..., embed=True), value: Optional[int] = Body(None, embed=True)):
        try:
            return svc.limbs.apply(device, action, value)
        except ValueError as e:
            raise HTTPException(400, str(e))

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

    # ------------------------------------------------------------- transcripts
    @app.get("/api/transcripts/summary")
    async def tr_summary(days: int = 7):
        return await run_in_threadpool(svc.core.transcripts.summary, days)

    @app.get("/api/transcripts/recent")
    async def tr_recent(days: int = 2, limit: int = 200):
        return await run_in_threadpool(svc.core.transcripts.recent, days, limit)

    @app.post("/api/transcripts/flag")
    def tr_flag(session: str = Body(..., embed=True), id: int = Body(..., embed=True),
                verdict: str = Body(..., embed=True), note: str = Body("", embed=True),
                expected: str = Body("", embed=True)):
        try:
            f = svc.core.transcripts.flag(session, id, verdict, note, expected)
        except ValueError as e:
            raise HTTPException(400, str(e))
        bus.publish("core", "flag", f"Marked a reply as {verdict}", verdict=verdict)
        return f

    @app.post("/api/transcripts/export")
    async def tr_export(days: int = Body(7, embed=True)):
        path = await run_in_threadpool(svc.core.transcripts.export_review, days)
        bus.publish("core", "review", f"Review for Claude written: {path.name}")
        return {"path": str(path), "name": path.name,
                "summary": await run_in_threadpool(svc.core.transcripts.summary, days)}

    @app.post("/api/open")
    def open_folder(which: str = Body(..., embed=True)):
        """Open a data folder in Explorer (only these known folders — never a path
        from the request)."""
        folders = {"reviews": DATA / "reviews", "transcripts": DATA / "transcripts",
                   "recordings": svc.hub.recordings_dir, "data": DATA}
        target = folders.get(which)
        if target is None:
            raise HTTPException(404, "unknown folder")
        target.mkdir(parents=True, exist_ok=True)
        import os
        os.startfile(str(target))                    # noqa: S606 — fixed, known path
        return {"ok": True}

    # ------------------------------------------------------------- mission germoney
    @app.get("/api/kv")
    def kv_keys():
        return {"keys": svc.kv.keys()}

    @app.get("/api/kv/{key}")
    def kv_get(key: str):
        try:
            return {"value": svc.kv.get(key)}
        except ValueError as e:
            raise HTTPException(400, str(e))

    @app.put("/api/kv/{key}")
    def kv_set(key: str, value: str = Body(..., embed=True)):
        try:
            svc.kv.set(key, value)
        except ValueError as e:
            raise HTTPException(400, str(e))
        return {"ok": True}

    @app.delete("/api/kv/{key}")
    def kv_delete(key: str):
        try:
            svc.kv.delete(key)
        except ValueError as e:
            raise HTTPException(400, str(e))
        return {"ok": True}

    @app.get("/api/germoney/export")
    def gm_export():
        """Everything Mission Germoney stores, as one JSON document (a backup)."""
        return Response(json.dumps(svc.kv.export_all(), indent=1), media_type="application/json",
                        headers={"Content-Disposition": "attachment; filename=mission-germoney-backup.json"})

    @app.post("/api/germoney/import")
    def gm_import(data: dict = Body(...)):
        n = svc.kv.import_all(data)
        bus.publish("mission", "import", f"Imported {n} Mission Germoney record(s)")
        return {"imported": n}

    @app.post("/api/germoney/ai/{task}")
    async def gm_ai(task: str, ctx: dict = Body(...)):
        try:
            return await run_in_threadpool(germoney.generate, task, ctx)
        except ValueError as e:
            raise HTTPException(400, str(e))
        except RuntimeError as e:
            # The UI falls back to the deterministic engine and says so.
            raise HTTPException(503, str(e))

    @app.get("/api/germoney/github")
    async def gm_github(user: str):
        try:
            return await run_in_threadpool(germoney.github_summary, user)
        except ValueError as e:
            raise HTTPException(400, str(e))
        except Exception as e:
            raise HTTPException(502, f"GitHub unreachable: {e}")

    @app.get("/api/germoney/arxiv")
    async def gm_arxiv(q: str, max: int = 6):
        try:
            return await run_in_threadpool(germoney.arxiv, q, max)
        except Exception as e:
            raise HTTPException(502, f"arXiv unreachable: {e}")

    @app.get("/api/germoney/focus")
    def gm_focus():
        return germoney.foreground()

    @app.get("/api/germoney/calendar/today")
    async def gm_cal_today():
        return await run_in_threadpool(svc.calendar.today)

    @app.put("/api/germoney/calendar/feed")
    def gm_cal_feed(url: Optional[str] = Body(None, embed=True)):
        try:
            svc.calendar.set_feed(url)
        except ValueError as e:
            raise HTTPException(400, str(e))
        return {"ok": True}

    @app.post("/api/germoney/calendar/block")
    def gm_cal_block(title: str = Body("Study block", embed=True), start: str = Body(..., embed=True),
                     minutes: int = Body(90, embed=True)):
        try:
            return svc.calendar.add_block(title, start, minutes)
        except ValueError as e:
            raise HTTPException(400, str(e))

    @app.delete("/api/germoney/calendar/block/{block_id}")
    def gm_cal_block_delete(block_id: str):
        svc.calendar.remove_block(block_id)
        return {"ok": True}

    @app.get("/api/germoney/calendar/block/{block_id}.ics")
    def gm_cal_block_ics(block_id: str):
        try:
            body = svc.calendar.block_ics(block_id)
        except KeyError:
            raise HTTPException(404, "no such block")
        return Response(body, media_type="text/calendar",
                        headers={"Content-Disposition": f"attachment; filename={block_id}.ics"})

    # ------------------------------------------------------------- events
    @app.websocket("/ws/events")
    async def events_ws(ws: WebSocket):
        if not guard.ws_ok(ws):
            await ws.close(code=4403)
            return
        await ws.accept()
        q = bus.subscribe()

        async def send_loop():
            await ws.send_text(json.dumps({"kind": "history", "events": bus.history(80)}))
            while True:
                ev = await q.get()
                await ws.send_text(json.dumps(ev, ensure_ascii=False))
        try:
            await serve_until_gone(ws, send_loop)      # ends on the disconnect, not on a dead send
        finally:
            bus.unsubscribe(q)

    # ------------------------------------------------------------- feature routes
    # Each feature keeps its routes in its own module, jarvis_app/routes_<area>.py,
    # with register(app, svc, bus). Adding a feature never edits this file, and a
    # feature that fails to load is reported instead of taking the server down.
    for name, err in register_feature_routes(app, svc, bus, only=None if features is None else set(features)):
        bus.publish("system", "error", f"Feature routes {name} failed to load: {err}")

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
