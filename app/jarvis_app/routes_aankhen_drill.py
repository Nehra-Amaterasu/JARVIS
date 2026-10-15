"""Aankhen drills, the zone belief and the free teachers, as app routes.

    GET  /api/aankhen/belief             the zone belief (aankhen/belief.py contract)
    GET  /api/aankhen/zones              the zone map in use (editable data/aankhen/zones.json)
    GET  /api/aankhen/drill              the in-app drill: state, current block, history
    POST /api/aankhen/drill/plan         {minutes, zones, fan, seed} -> the blocks, nothing started
    POST /api/aankhen/drill/start        {minutes, zones, fan, seed} -> runs a drill in the app
    POST /api/aankhen/drill/confirm      {answer: ready|ok|redo|bad|stop, zone?, activity?, note?}
    POST /api/aankhen/drill/stop
  Used by `python -m aankhen drill` while the app holds the board (it never opens COM9 then):
    POST /api/aankhen/drill/record       {action: start|stop, path?, meta?}
    GET  /api/aankhen/drill/sample       one QC sample (packets, fill, RSSI, HBE, firmware, fan)
    POST /api/aankhen/drill/fan          {on} switches the fan through the relay board
    POST /api/aankhen/drill/recal        {source: "drill" | null} empty-room reference capture

The CLI finds the app through <JARVIS data>/runtime/aankhen-api.json (port + this launch's
token), written here at start-up. It is a local file in the user's own data folder: the
token guards the API against web pages (security.py), not against programs he runs.
"""
from __future__ import annotations

import json
import os
import threading
from typing import Optional

from fastapi import Body, HTTPException


def _fan_reader(svc):
    def read() -> Optional[bool]:
        r = getattr(svc, "relays", None)
        if r is not None and r.connected:
            v = r.state.get("fan")
            return None if v is None else bool(v)
        return None
    return read


def _voice_reader(svc):
    def read() -> int:
        turns = list(getattr(svc.core, "turns", []) or [])
        return next((int(t.get("id", 0)) for t in reversed(turns) if t.get("role") == "you"), 0)
    return read


def _set_fan(svc):
    def switch(on: bool) -> bool:
        limbs = getattr(svc, "limbs", None)
        if limbs is None:
            return False
        res = limbs.apply("fan", "on" if on else "off", origin="aankhen-drill")
        d = (res.get("delivered") or {}).get("fan")
        return bool(d) if d is not None else bool(res.get("state", {}).get("fan", {}).get("on") == on)
    return switch


def _write_runtime(app) -> None:
    try:
        from .paths import DATA
        guard = getattr(app.state, "guard", None)
        if guard is None:
            return
        folder = os.path.join(str(DATA), "runtime")
        os.makedirs(folder, exist_ok=True)
        with open(os.path.join(folder, "aankhen-api.json"), "w", encoding="utf-8") as f:
            json.dump({"base": f"http://127.0.0.1:{guard.port}", "token": guard.token, "pid": os.getpid()}, f)
    except Exception:
        pass


def register(app, svc, bus) -> None:
    from aankhen import drill as dr
    from aankhen.teachers import FreeTeachers

    hub = svc.hub
    hub.fan_reader = _fan_reader(svc)
    hub.voice_reader = _voice_reader(svc)
    _write_runtime(app)
    state: dict = {"runner": None, "thread": None, "confirmer": None, "result": None, "inputs": None}
    lock = threading.Lock()

    @app.get("/api/aankhen/belief")
    def belief():
        b = hub.belief()
        if b is None:
            raise HTTPException(404, "Aankhen is not running")
        return b

    @app.get("/api/aankhen/zones")
    def zones():
        eng = hub.engine
        if eng is not None:
            return {"source": eng.zmap.source, **eng.zmap.to_dict()}
        from aankhen.zones import load_zones
        zm = load_zones(hub.room)
        return {"source": zm.source, **zm.to_dict()}

    def _seed(body: dict) -> int:
        import time as _t
        return int(body.get("seed") or int(_t.time() // 86400))      # one plan per day by default

    def _plan(body: dict) -> list:
        return dr.plan_session(_seed(body), float(body.get("minutes") or dr.DEFAULT_MINUTES),
                               body.get("zones") or None, body.get("fan") or "both")

    @app.post("/api/aankhen/drill/plan")
    def drill_plan(body: dict = Body(default={})):
        try:
            blocks = _plan(body)
        except ValueError as e:
            raise HTTPException(400, str(e))
        return {"blocks": [b.to_dict() | {"prompt": b.prompt()} for b in blocks],
                "minutes": round(dr.session_minutes(blocks), 1)}

    @app.get("/api/aankhen/drill")
    def drill_status():
        r = state["runner"]
        c = state["confirmer"]
        st = r.st.__dict__ if r is not None else {"state": "idle"}
        return {**st, "waiting_for": c.waiting if c is not None else None, "result": state["result"]}

    @app.post("/api/aankhen/drill/start")
    def drill_start(body: dict = Body(default={})):
        with lock:
            t = state["thread"]
            if t is not None and t.is_alive():
                raise HTTPException(409, "a drill is already running")
            if hub.mode != "hardware":
                raise HTTPException(400, "drills record the real board: start Aankhen on the ESP32 first")
            try:
                blocks = _plan(body)
            except ValueError as e:
                raise HTTPException(400, str(e))
            conf = dr.QueueConfirmer()
            inputs = FreeTeachers(write_lines=False).start()      # its input counts only
            runner = dr.DrillRunner(dr.HubBackend(hub, _set_fan(svc)), conf, inputs=inputs)
            seed = _seed(body)

            def go():
                try:
                    state["result"] = runner.run(blocks, seed)
                    bus.publish("aankhen", "drill", f"Drill {runner.st.state}: {runner.st.passed} blocks passed")
                except Exception as e:
                    state["result"] = {"error": f"{type(e).__name__}: {e}"}
                finally:
                    inputs.stop()
            state.update(runner=runner, confirmer=conf, result=None, inputs=inputs,
                         thread=threading.Thread(target=go, name="aankhen-drill", daemon=True))
            state["thread"].start()
            bus.publish("aankhen", "drill", f"Drill started: {len(blocks)} blocks")
            return {"started": True, "blocks": len(blocks), "minutes": round(dr.session_minutes(blocks), 1)}

    @app.post("/api/aankhen/drill/confirm")
    def drill_confirm(answer: str = Body("ok", embed=True), zone: Optional[str] = Body(None, embed=True),
                      activity: Optional[str] = Body(None, embed=True), note: str = Body("", embed=True)):
        c = state["confirmer"]
        if c is None:
            raise HTTPException(400, "no drill is running")
        a = dr.parse_answer(answer)
        if zone:
            a = dr.parse_answer(f"w {zone} {activity or ''}")
        a.note = note or a.note
        c.put(a)
        return {"ok": True, "verdict": a.verdict, "zone": a.zone}

    @app.post("/api/aankhen/drill/stop")
    def drill_stop():
        r, c = state["runner"], state["confirmer"]
        if r is not None:
            r.stop()
        if c is not None:
            c.put(dr.Answer("stop"))
        return {"stopping": r is not None}

    # ---------------------------------------------------- the CLI's block-level API
    @app.post("/api/aankhen/drill/record")
    def drill_record(action: str = Body(..., embed=True), path: Optional[str] = Body(None, embed=True),
                     meta: Optional[dict] = Body(None, embed=True)):
        src = hub.source
        if src is None or hub.mode != "hardware":
            raise HTTPException(400, "Aankhen is not running on the real board")
        if action == "start":
            if not path:
                raise HTTPException(400, "path required")
            from aankhen.drill import DRILL_DIR
            full = os.path.abspath(path)
            if not full.startswith(os.path.abspath(DRILL_DIR) + os.sep):
                raise HTTPException(400, "drill recordings go under data/aankhen/drill")
            src.record_to(full, meta or {})
            return {"recording": full}
        if action == "stop":
            src.stop_recording()
            return {"recording": None}
        raise HTTPException(400, "action is start or stop")

    @app.get("/api/aankhen/drill/sample")
    def drill_sample():
        return dr._sample_engine(hub.engine)

    @app.post("/api/aankhen/drill/fan")
    def drill_fan(on: bool = Body(..., embed=True)):
        try:
            return {"ok": _set_fan(svc)(on)}
        except Exception as e:
            return {"ok": False, "error": str(e)}

    @app.post("/api/aankhen/drill/recal")
    def drill_recal(source: Optional[str] = Body(None, embed=True)):
        if hub.engine is None:
            raise HTTPException(400, "Aankhen is not running")
        if source not in (None, "drill"):
            raise HTTPException(400, "source is \"drill\" or null")
        hub.engine.recalibrate_from(source)
        return {"ok": True, "source": source}
