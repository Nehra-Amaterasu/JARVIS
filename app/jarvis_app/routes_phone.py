"""Phone access over HTTP (the rules and the listener are in phone.py).

Desktop (the window's token, desktop listener only):
    GET    /api/remote                 the switch, addresses, paired phones, pairing state
    PUT    /api/remote                 {enabled?, port?, bind?, cert?, key?, urls?} save + apply
    POST   /api/remote/pair            {url?}: a new 5-minute code, its link and QR (SVG)
    DELETE /api/remote/pair            cancel the code
    DELETE /api/remote/devices/{id}    revoke a phone (its open socket is closed too)

Phone (a paired device's cookie, phone listener):
    GET    /phone                      the phone page (also a home-screen app: manifest + icons)
    POST   /api/phone/pair             {code, name}: becomes a paired device (sets the cookie)
    POST   /api/phone/unpair           forget this phone
    GET    /api/phone/state            light + fan (board-confirmed), JARVIS's state, recent turns
    POST   /api/phone/limbs/{device}   {action, value?}: through Limbs, the room's ONLY writer
    POST   /api/phone/scene/{name}
    POST   /api/phone/say              {text}: the same path as typing in the desktop chat
    POST   /api/phone/core/start       {mode}: wake JARVIS (text or voice)
    POST   /api/phone/hear             raw audio (MediaRecorder webm/ogg/mp4, <= 8 MB): JARVIS's
                                       Whisper turns it into a turn (voice mode only)
    GET    /api/phone/speech?text=     his chosen voice saying a reply, as audio for the phone
    WS     /ws/phone                   live: room changes, his state, turns as they stream
"""
from __future__ import annotations

import json
import secrets
from pathlib import Path
from typing import Optional

from fastapi import Body, FastAPI, HTTPException, Request, WebSocket
from fastapi.responses import FileResponse, HTMLResponse, JSONResponse, Response
from starlette.concurrency import run_in_threadpool

from . import phone, qr
from .wsutil import serve_until_gone

PAGE_DIR = Path(__file__).resolve().parent / "phone_page"
MAX_CLIP_BYTES = 8 * 2**20
MAX_SAY = 2000
SPEECH_MAX = 600
AUDIO_TYPES = {"audio/webm": ".webm", "audio/ogg": ".ogg", "audio/mp4": ".m4a", "audio/mpeg": ".mp3",
               "audio/wav": ".wav", "audio/x-wav": ".wav", "audio/aac": ".aac"}
# What the phone hears live: the room and JARVIS's conversation. Not mic levels (12 Hz,
# battery), not memory searches, not Away mode.
PAGE_HEADERS = {"Cache-Control": "no-cache", "Referrer-Policy": "no-referrer", "X-Frame-Options": "DENY",
                "X-Content-Type-Options": "nosniff"}
# Same-origin everything: no third-party script, no frame, nothing posted elsewhere.
CSP = ("default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; "
       "media-src 'self' blob:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'")
CORE_KINDS = {"state", "turn", "reply_chunk", "ready", "starting", "stopped", "error", "speech_done", "boot"}


def _limbs_view(svc) -> dict:
    v = svc.limbs.view()
    return {
        "devices": [{k: d.get(k) for k in ("id", "name", "kind", "state", "link", "hardware_on", "confirmed")}
                    for d in v["devices"]],
        "scenes": v["scenes"], "usb": v["usb"], "hardware": v["hardware"],
    }


def _core_view(svc) -> dict:
    i = svc.core.info()
    return {"running": i["running"], "mode": i["mode"], "state": i["state"], "boot_step": i["boot_step"],
            "last_error": i["last_error"]}


def register(app: FastAPI, svc, bus) -> None:
    access = phone.PhoneAccess(desktop_port=app.state.guard.port)
    app.state.phone = access
    app.state.guard.is_remote = access.is_remote      # desktop sockets refuse the phone listener
    access.server = phone.PhoneServer(app)
    svc.phone = access

    # The listener follows the switch from the moment the app runs.
    from .routes_security import _chain_lifespan

    async def run():
        import asyncio

        async def announce():
            for _ in range(100):                           # the first apply takes < 2 s
                await asyncio.sleep(0.05)
                if access.server.running or access.server.error:
                    break
            if access.server.error and access.enabled:
                bus.publish("phone", "error", f"Phone access: {access.server.error}")
            elif access.server.running:
                bus.publish("phone", "listening", "Phone access on: " + ", ".join(access.urls()))
        if access.enabled:
            asyncio.ensure_future(announce())
        await access.manage(app)
    _chain_lifespan(app, run)

    # JARVIS answers a phone recording with `phone_heard`; the phone learns what he heard.
    def tap(ev: dict) -> None:
        if ev.get("kind") == "phone_heard":
            bus.publish("phone", "heard", (ev.get("text") or "")[:140], ephemeral=True, clip=ev.get("id"),
                        heard=ev.get("text") or "", error=ev.get("error"))
    svc.core.event_taps.append(tap)

    def device(request: Request) -> Optional[dict]:
        return getattr(request.state, "phone_device", None)

    # ================================================================ desktop side
    @app.get("/api/remote")
    def remote_view():
        return access.view()

    @app.put("/api/remote")
    async def remote_update(payload: dict = Body(...)):
        try:
            await run_in_threadpool(access.update, payload)
        except ValueError as e:
            raise HTTPException(400, str(e))
        await access.apply(app)
        v = access.view()
        if v["enabled"] and v["running"]:
            bus.publish("phone", "listening", "Phone access on: " + ", ".join(v["open_at"][:2]))
        elif v["enabled"]:
            bus.publish("phone", "error", f"Phone access could not start: {v['error']}")
        else:
            bus.publish("phone", "off", "Phone access off")
        return v

    @app.post("/api/remote/pair")
    def remote_pair(url: Optional[str] = Body(None, embed=True)):
        if not access.enabled:
            raise HTTPException(409, "Switch phone access on first.")
        urls = access.urls()
        base = (url or "").rstrip("/") or (urls[0] if urls else "")
        if base not in urls:
            raise HTTPException(400, "That address is not one this laptop serves the phone page on.")
        code = access.pairing.start()
        link = f"{base}/phone#pair={code}"
        bus.publish("phone", "pairing", "Pairing code shown on the desktop (5 minutes)")
        return {"code": phone.format_code(code), "url": base + "/phone", "link": link,
                "qr_svg": qr.svg(link, scale=6), "expires_in": access.pairing.remaining()}

    @app.delete("/api/remote/pair")
    def remote_pair_cancel():
        access.pairing.cancel()
        return {"ok": True}

    @app.delete("/api/remote/devices/{device_id}")
    async def remote_revoke(device_id: str):
        if not access.devices.revoke(device_id):
            raise HTTPException(404, "no such phone")
        for ws in list(access.sockets.pop(device_id, set())):
            try:
                await ws.close(code=4401)
            except Exception:
                pass
        bus.publish("phone", "revoked", "A phone was unpaired")
        return {"devices": access.devices.list()}

    # ================================================================ the phone page
    @app.get("/phone", response_class=HTMLResponse)
    @app.get("/phone/", response_class=HTMLResponse)
    def phone_page():
        return FileResponse(PAGE_DIR / "index.html", media_type="text/html", headers={**PAGE_HEADERS, "Content-Security-Policy": CSP})

    @app.get("/phone/app.js")
    def phone_script():
        return FileResponse(PAGE_DIR / "app.js", media_type="text/javascript", headers=PAGE_HEADERS)

    @app.get("/phone/manifest.webmanifest")
    def phone_manifest():
        return FileResponse(PAGE_DIR / "manifest.webmanifest", media_type="application/manifest+json")

    @app.get("/phone/icon-{size}.png")
    def phone_icon(size: int):
        if size not in (192, 512):
            raise HTTPException(404, "no such icon")
        return FileResponse(PAGE_DIR / f"icon-{size}.png", media_type="image/png")

    # ================================================================ the phone's API
    @app.post("/api/phone/pair")
    def phone_pair(request: Request, code: str = Body(..., embed=True), name: str = Body("Phone", embed=True)):
        if not access.pairing.redeem(code):
            raise HTTPException(400, "That code is wrong or has expired: make a new one on the desktop.")
        try:
            dev, token = access.devices.add(name)
        except ValueError as e:
            raise HTTPException(409, str(e))
        bus.publish("phone", "paired", f"Phone paired: {dev['name']}", device=dev["id"])
        secure = request.url.scheme == "https" or (
            request.client is not None and request.client.host == "127.0.0.1"
            and request.headers.get("x-forwarded-proto") == "https")
        resp = JSONResponse({"ok": True, "device": dev})
        resp.set_cookie(phone.COOKIE, token, max_age=phone.COOKIE_MAX_AGE, path="/", httponly=True,
                        samesite="strict", secure=secure)
        return resp

    @app.post("/api/phone/unpair")
    async def phone_unpair(request: Request):
        dev = device(request)
        if dev is not None:
            access.devices.revoke(dev["id"])
            bus.publish("phone", "revoked", f"{dev['name']} unpaired itself")
        resp = JSONResponse({"ok": True})
        resp.delete_cookie(phone.COOKIE, path="/")
        return resp

    @app.get("/api/phone/state")
    async def phone_state(request: Request):
        limbs = await run_in_threadpool(_limbs_view, svc)
        return {"device": device(request), "limbs": limbs, "core": _core_view(svc),
                "turns": svc.core.transcript(16), "secure": request.url.scheme == "https"}

    @app.post("/api/phone/limbs/{dev_id}")
    def phone_limbs(request: Request, dev_id: str, action: str = Body(..., embed=True),
                    value: Optional[int] = Body(None, embed=True)):
        if dev_id not in ("light", "fan", "all") or action not in ("on", "off", "set", "dim", "brighten"):
            raise HTTPException(400, "unknown device or action")
        try:
            r = svc.limbs.apply(dev_id, action, value, origin="phone")
        except ValueError as e:
            raise HTTPException(400, str(e))
        return {"result": {"changed": r["changed"], "delivered": r["delivered"]}, "limbs": _limbs_view(svc)}

    @app.post("/api/phone/scene/{name}")
    def phone_scene(name: str):
        try:
            r = svc.limbs.scene(name)
        except ValueError as e:
            raise HTTPException(400, str(e))
        return {"result": {"changed": r["changed"], "delivered": r["delivered"]}, "limbs": _limbs_view(svc)}

    @app.post("/api/phone/say")
    def phone_say(text: str = Body(..., embed=True)):
        text = text.strip()[:MAX_SAY]
        if not text:
            raise HTTPException(400, "empty message")
        try:
            svc.core.say(text)
        except Exception as e:
            raise HTTPException(409, f"{e}: wake him first.")
        return {"ok": True}

    @app.post("/api/phone/core/start")
    async def phone_core_start(mode: str = Body("text", embed=True)):
        if mode not in ("text", "voice"):
            raise HTTPException(400, "mode must be text or voice")
        try:
            info = await run_in_threadpool(svc.core.start, mode)
        except Exception as e:
            raise HTTPException(409, str(e))
        return {"core": {k: info[k] for k in ("running", "mode", "state")}}

    @app.post("/api/phone/hear")
    async def phone_hear(request: Request):
        dev = device(request)
        key = dev["id"] if dev else "desktop"
        if not access.limits.allow(f"hear:{key}", 20):
            raise HTTPException(429, "Too many recordings this minute.")
        core = svc.core
        if not core.running:
            raise HTTPException(409, "JARVIS is asleep: wake him in voice mode to talk, or type.")
        if core.mode != "voice":
            raise HTTPException(409, "JARVIS is in text mode (no Whisper loaded): type, or restart him in voice mode.")
        ctype = (request.headers.get("content-type") or "").split(";")[0].strip().lower()
        ext = AUDIO_TYPES.get(ctype)
        if ext is None:
            raise HTTPException(415, f"not an audio type I take: {ctype or 'none'}")
        declared = request.headers.get("content-length")
        if declared and declared.isdigit() and int(declared) > MAX_CLIP_BYTES:
            raise HTTPException(413, "That recording is too long (8 MB at most).")
        body = bytearray()
        async for chunk in request.stream():
            body.extend(chunk)
            if len(body) > MAX_CLIP_BYTES:
                raise HTTPException(413, "That recording is too long (8 MB at most).")
        if len(body) < 200:
            raise HTTPException(400, "That recording is empty.")
        clip = secrets.token_hex(6)
        phone.INBOX.mkdir(parents=True, exist_ok=True)
        import time
        for old in phone.INBOX.iterdir():              # JARVIS deletes each clip once read; a crash
            try:                                       # mid-clip must not leave recordings behind
                if time.time() - old.stat().st_mtime > 600:
                    old.unlink()
            except OSError:
                pass
        path = phone.INBOX / f"{clip}{ext}"
        path.write_bytes(bytes(body))
        try:
            core.hear(str(path), clip)
        except Exception as e:
            path.unlink(missing_ok=True)
            raise HTTPException(409, str(e))
        return {"ok": True, "clip": clip, "bytes": len(body)}

    @app.get("/api/phone/speech")
    async def phone_speech(request: Request, text: str = ""):
        dev = device(request)
        if not access.limits.allow(f"speech:{dev['id'] if dev else 'desktop'}", 30):
            raise HTTPException(429, "Too many voice requests this minute.")
        line = text.strip()[:SPEECH_MAX]
        if not line:
            raise HTTPException(400, "nothing to say")
        from .routes_settings import preview_audio

        def make():
            try:
                return preview_audio(line)
            except Exception as e:
                raise HTTPException(503, f"No voice available: {e}")
        data, media = await run_in_threadpool(make)
        return Response(data, media_type=media, headers={"Cache-Control": "no-store"})

    # ================================================================ live
    @app.websocket("/ws/phone")
    async def phone_ws(ws: WebSocket):
        dev = None
        if access.is_remote(ws.scope):
            client = ws.client.host if ws.client else None
            dev = access.ws_check(host=ws.headers.get("host"), client=client,
                                  origin=ws.headers.get("origin"), cookies=ws.cookies)
            if dev is None:
                await ws.close(code=4403)
                return
        else:
            guard = app.state.guard
            if not guard.ws_ok(ws):
                await ws.close(code=4403)
                return
        await ws.accept()
        key = dev["id"] if dev else "desktop"
        access.sockets.setdefault(key, set()).add(ws)
        q = bus.subscribe()

        async def send_loop():
            hello = {"kind": "hello", "device": dev, "limbs": await run_in_threadpool(_limbs_view, svc),
                     "core": _core_view(svc), "turns": svc.core.transcript(16)}
            await ws.send_text(json.dumps(hello, ensure_ascii=False))
            while True:
                ev = await q.get()
                src, kind = ev.get("source"), ev.get("kind")
                if src == "limbs" or src == "phone" or (src == "core" and kind in CORE_KINDS):
                    if src == "limbs":
                        ev = {**ev, "limbs": await run_in_threadpool(_limbs_view, svc)}
                    await ws.send_text(json.dumps(ev, ensure_ascii=False))
        try:
            await serve_until_gone(ws, send_loop)      # a phone that left is dropped at once (wsutil.py)
        finally:
            bus.unsubscribe(q)
            access.sockets.get(key, set()).discard(ws)
