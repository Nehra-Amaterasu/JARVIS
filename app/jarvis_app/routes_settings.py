"""/api/settings and /api/imports: the Connect tab's controls and the System tab's answers.

    GET  /api/settings/brain                installed Ollama models, the chosen and running one
    POST /api/settings/brain                {model}: choose (applies when JARVIS restarts)
    POST /api/settings/brain/restart        stop JARVIS and start him again, same mode
    GET  /api/settings/voice                Edge (British, American, Indian English) and Kokoro voices
    POST /api/settings/voice                {id?, speed?}: applies from his next sentence
    POST /api/settings/voice/test           {text?}: JARVIS says it, if he is listening
    GET  /api/settings/voice/preview?text=  the chosen voice as audio, made here (JARVIS off)
    GET  /api/settings/pronunciations       word -> how he says it
    POST /api/settings/pronunciations       {word, say}
    DELETE /api/settings/pronunciations/{word}
    GET  /api/settings/modules              heavy modules: cost, status, time left
    POST /api/settings/modules/{id}/on      {minutes, model?}
    POST /api/settings/modules/{id}/off
    POST /api/settings/modules/unload_all/run
    GET  /api/settings/latency              wake -> first word -> full reply (live + transcripts)
    GET  /api/imports                       every data export: what to ask for, what arrived
    POST /api/imports/{source}/request      open the service's export page in the browser
    POST /api/imports/{source}/upload?name= the file itself, streamed (the drop zone)
    POST /api/imports/{source}/path         {path}: copy an export that is on disk
    POST /api/imports/{source}/open         open DATA/imports/<source> in Explorer

Wiring, without editing server.py or core.py's logic: an env hook hands JARVIS the
chosen brain and the settings file at each start, and an event tap feeds the wake log.
"""
from __future__ import annotations

import asyncio
import os
import threading
import webbrowser
from typing import Optional

from fastapi import Body, FastAPI, HTTPException, Request
from fastapi.responses import Response
from starlette.concurrency import run_in_threadpool

from . import imports, latency
from . import settings as st
from .modules import Modules
from .paths import ensure_jarvis_importable

ensure_jarvis_importable()
import user_settings                   # noqa: E402  core/user_settings.py

PREVIEW_MAX_CHARS = 300
_kokoro_lock = threading.Lock()
_kokoro_engine = None


def _http(fn, *args, code: int = 400):
    try:
        return fn(*args)
    except KeyError as e:
        raise HTTPException(404, f"unknown: {e}")
    except (ValueError, RuntimeError) as e:
        raise HTTPException(code, str(e))


def preview_audio(text: str) -> tuple[bytes, str]:
    """The chosen voice saying `text`, made in the app (JARVIS is not running). The same
    choices as voice.py: the voice, the speed, the offline switch, the pronunciations."""
    import voice                                       # core/voice.py
    global _kokoro_engine
    p = voice.resolve_prefs(st.store.read())
    style = voice.STYLES[p.default_key]
    spoken = user_settings.apply_pronunciations(text, p.pron)
    problem = None
    if not p.offline:
        try:
            rate = user_settings.edge_rate(p.speed)
            path = asyncio.run(voice._edge_synth(spoken, p.edge.get(style.key, style.edge), rate))
            return _consume(path), "audio/mpeg"
        except Exception as e:
            problem = f"online voice failed ({type(e).__name__})"
    offline = style if style.kokoro else voice.STYLES[voice.DEFAULT_STYLE]
    with _kokoro_lock:
        if _kokoro_engine is None:
            _kokoro_engine = voice._Kokoro(str(st.kokoro_dir()))
        k = _kokoro_engine
    if not k.available:
        raise RuntimeError((problem + "; " if problem else "") + "the offline voice is not installed")
    kv = p.kokoro.get(offline.key, offline.kokoro)
    return _consume(k.synth(spoken, *kv, speed=p.speed)), "audio/wav"


def _consume(path: str) -> bytes:
    try:
        with open(path, "rb") as f:
            return f.read()
    finally:
        try:
            os.remove(path)
        except OSError:
            pass


def register(app: FastAPI, svc, bus) -> None:
    core = svc.core
    wakes = latency.WakeLog(path=st.SETTINGS_PATH.parent / "wake.jsonl")   # last 500 kept on disk
    mods = Modules(core, bus.publish)
    svc.modules, svc.wakes = mods, wakes

    def env() -> dict:
        model = st.chosen_brain()
        core.brain_model = model                       # what this run thinks with
        return {"JARVIS_BRAIN_MODEL": model, "JARVIS_SETTINGS": str(st.SETTINGS_PATH)}
    core.env_hooks.append(env)
    core.event_taps.append(wakes.on_event)
    threading.Thread(target=mods.resume, name="modules-resume", daemon=True).start()

    # ------------------------------------------------------------ brain
    def brain_view() -> dict:
        return st.brain_view(st.store.read(), st.ollama_models(), st.ollama_loaded(),
                             getattr(core, "brain_model", None), core.running)

    @app.get("/api/settings/brain")
    async def brain_get():
        return await run_in_threadpool(brain_view)

    @app.post("/api/settings/brain")
    async def brain_set(model: str = Body(..., embed=True)):
        m = await run_in_threadpool(lambda: _http(st.choose_brain, model.strip(), st.ollama_models()))
        bus.publish("settings", "brain", f"Brain set to {m['name']}"
                    + (": restart JARVIS to use it" if core.running else ""), model=m["name"])
        return await run_in_threadpool(brain_view)

    @app.post("/api/settings/brain/restart")
    async def brain_restart():
        mode = core.mode if core.running and core.mode in ("voice", "text") else "voice"

        def go():
            core.stop()
            return core.start(mode)
        info = await run_in_threadpool(lambda: _http(go, code=409))
        bus.publish("settings", "restart", f"Restarting JARVIS ({mode}) with {st.chosen_brain()}")
        return {"ok": True, "core": info, "brain": st.chosen_brain()}

    # ------------------------------------------------------------ voice
    def voice_view() -> dict:
        return st.voice_view(st.store.read(), st.edge_voices(), st.kokoro_voices())

    @app.get("/api/settings/voice")
    async def voice_get():
        return await run_in_threadpool(voice_view)

    @app.post("/api/settings/voice")
    async def voice_set(id: Optional[str] = Body(None, embed=True), speed: Optional[float] = Body(None, embed=True)):
        def go():
            v = voice_view()
            return st.choose_voice(id, speed, v["edge"] + v["kokoro"])
        chosen = await run_in_threadpool(lambda: _http(go))
        bus.publish("settings", "voice", f"Voice: {chosen.get('id') or st.DEFAULT_VOICE}, speed {chosen.get('speed')}")
        return await run_in_threadpool(voice_view)

    @app.post("/api/settings/voice/test")
    def voice_test(text: Optional[str] = Body(None, embed=True)):
        line = (text or "").strip()[:PREVIEW_MAX_CHARS] or st.speak_sample("my voice")
        if core.running and core.mode == "voice":
            try:
                core.speak(line)
                return {"via": "jarvis", "text": line}
            except Exception:
                pass                                   # fall through: the window plays it
        return {"via": "window", "text": line}

    @app.get("/api/settings/voice/preview")
    async def voice_preview(text: str = ""):
        line = text.strip()[:PREVIEW_MAX_CHARS] or st.speak_sample("my voice")
        data, media = await run_in_threadpool(lambda: _http(preview_audio, line, code=503))
        return Response(data, media_type=media, headers={"Cache-Control": "no-store"})

    # ------------------------------------------------------------ pronunciation
    @app.get("/api/settings/pronunciations")
    def pron_get():
        return {"table": st.store.read().get("pronunciations") or {}}

    @app.post("/api/settings/pronunciations")
    def pron_set(word: str = Body(..., embed=True), say: str = Body(..., embed=True)):
        table = _http(st.set_pronunciation, word, say)
        bus.publish("settings", "pronunciation", f"JARVIS now says “{word.strip()}” as “{say.strip()}”")
        return {"table": table}

    @app.delete("/api/settings/pronunciations/{word}")
    def pron_delete(word: str):
        return {"table": st.remove_pronunciation(word)}

    # ------------------------------------------------------------ modules
    @app.get("/api/settings/modules")
    async def modules_get():
        return {"modules": await run_in_threadpool(mods.view)}

    @app.post("/api/settings/modules/unload_all/run")
    async def modules_unload():
        return await run_in_threadpool(lambda: _http(mods.unload_all, code=503))

    @app.post("/api/settings/modules/{mid}/on")
    async def modules_on(mid: str, minutes: int = Body(15, embed=True), model: Optional[str] = Body(None, embed=True)):
        return await run_in_threadpool(lambda: _http(mods.activate, mid, minutes, model))

    @app.post("/api/settings/modules/{mid}/off")
    async def modules_off(mid: str):
        return await run_in_threadpool(lambda: _http(mods.deactivate, mid))

    # ------------------------------------------------------------ latency (System)
    def latency_view() -> dict:
        rows = latency.turns(core.transcripts.entries(7))
        return {"live": wakes.view(), "summary": latency.summary(rows), "recent": list(reversed(rows[-12:])),
                "core": {"running": core.running, "mode": core.mode if core.running else None,
                         "state": core.info()["state"], "brain": getattr(core, "brain_model", None) if core.running else None,
                         "chosen_brain": st.chosen_brain(), "last_error": core.last_error}}

    @app.get("/api/settings/latency")
    async def latency_get():
        return await run_in_threadpool(latency_view)

    # ------------------------------------------------------------ data exports
    @app.get("/api/imports")
    async def imports_get():
        return {"sources": await run_in_threadpool(imports.status)}

    @app.post("/api/imports/{source}/request")
    def imports_request(source: str):
        s = imports.SOURCES.get(source)
        if s is None:
            raise HTTPException(404, "unknown source")
        # A fixed address from SOURCES, never one from the request. The page opens in his
        # own browser, where he is signed in; the request is his click there, not ours.
        webbrowser.open(s.url)
        bus.publish("memory", "export", f"Opened {s.name}'s export page: request it there")
        return {"ok": True, "url": s.url}

    @app.post("/api/imports/{source}/upload")
    async def imports_upload(source: str, request: Request, name: str):
        if source not in imports.SOURCES:
            raise HTTPException(404, "unknown source")
        _http(imports.safe_name, name)                 # refuse a bad name before any byte is read
        length = request.headers.get("content-length")
        # The body is written to disk on a worker thread (never on the event loop), fed
        # through a small queue: at most 64 chunks (~4 MB) of a multi-GB export in RAM.
        loop = asyncio.get_running_loop()
        q: asyncio.Queue = asyncio.Queue(maxsize=64)

        def chunks():
            while True:
                c = asyncio.run_coroutine_threadsafe(q.get(), loop).result()
                if c is None:
                    return
                yield c

        job = loop.run_in_executor(None, lambda: _http(imports.save_stream, source, name, chunks(),
                                                       int(length) if length and length.isdigit() else None))

        async def put(item) -> bool:
            """False once the writer has stopped (it refused or failed): stop feeding it."""
            p = asyncio.ensure_future(q.put(item))
            done, _ = await asyncio.wait({p, job}, return_when=asyncio.FIRST_COMPLETED)
            if p not in done:
                p.cancel()
                return False
            return True

        async for c in request.stream():
            if c and not await put(c):
                break
        if not job.done():
            await put(None)
        saved = await job
        bus.publish("memory", "import", f"{imports.SOURCES[source].name} export saved: {saved['name']}")
        return saved

    @app.post("/api/imports/{source}/path")
    async def imports_path(source: str, path: str = Body(..., embed=True)):
        res = await run_in_threadpool(lambda: _http(imports.import_path, source, path))
        bus.publish("memory", "import", f"Copying a {imports.SOURCES[source].name} export: {res['name']}")
        return res

    @app.post("/api/imports/{source}/open")
    def imports_open(source: str):
        d = _http(imports.folder, source)
        d.mkdir(parents=True, exist_ok=True)
        os.startfile(str(d))                           # noqa: S606 — fixed, known path
        return {"ok": True}
