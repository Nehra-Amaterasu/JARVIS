"""Away mode over HTTP (ROADMAP SIH-1; the logic is in away.py and presence.py).

    GET    /api/security                  arming state, phones, sensor, open incident, limits
    POST   /api/security/arm              {by: "app" | "voice"}  (manual: exit delay first)
    POST   /api/security/disarm           from the app only — voice never disarms
    POST   /api/security/check            check the family's phones now
    GET    /api/security/config           settings
    PUT    /api/security/config           change settings (validated, saved)
    POST   /api/security/phones           add a phone {name, mac?, ip?}
    DELETE /api/security/phones/{key}     remove one (key = its MAC, else its IP)
    GET    /api/security/neighbors        devices in this PC's ARP table (to find a phone)
    GET    /api/security/incidents        recent incidents, newest first (no traces)
    GET    /api/security/incidents/{id}   one incident with its 60 s trace

Bus events, all with source "security": armed, disarmed, watching, alert (level
pending | alarm | tamper | warning; label SIMULATED/REPLAY and sim=True when the
sensors are simulated), incident (closed). Nothing about a phone coming or going is
ever published — that would be a log of the family's movements.

The loop starts and stops with the app (it is chained onto the app's lifespan), so
importing this module or building an app in a test runs nothing. With no phones
listed it never runs a network command.
"""
from __future__ import annotations

import asyncio
import time
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Optional

from fastapi import Body, FastAPI, HTTPException
from starlette.concurrency import run_in_threadpool

from .away import Actions, AwayConfig, AwayMode, IncidentStore, load_config, sample_from_hub, save_config
from .bus import EventBus
from .paths import DATA
from .presence import MAX_PHONES, Phone, PresenceChecker, is_randomised, parse_arp, parse_neighbors, run_command

ROOT = DATA / "security"


class AppActions(Actions):
    """Away mode's hands in the app: the room light through Limbs, JARVIS's voice
    through the core process, the event bus. Receipts say what really happened."""

    def __init__(self, svc, bus: EventBus):
        self.svc, self.bus = svc, bus

    def lights_on(self) -> dict:
        limbs = getattr(self.svc, "limbs", None)
        if limbs is None:
            return {"done": False, "detail": "no lights in this app"}
        try:
            r = limbs.apply("light", "on", 100, origin="security")
        except Exception as e:
            return {"done": False, "detail": f"lights failed: {e}"}
        if "light" not in r.get("changed", []):
            usb = bool(self.svc.hub and self.svc.hub.can_command)
            return {"done": usb, "detail": "the light was already on"
                    + ("" if usb else " (no relay board: in the app only)")}
        if r.get("delivered", {}).get("light"):
            return {"done": True, "detail": "relay command delivered to the board"}
        return {"done": False, "detail": "no relay board connected: switched in the app only"}

    def speak(self, text: str) -> dict:
        core = getattr(self.svc, "core", None)
        if core is None or not core.running:
            return {"done": False, "detail": "JARVIS is not running, so nothing was said"}
        if getattr(core, "mode", None) != "voice":
            return {"done": False, "detail": "JARVIS is in text mode: shown, not spoken"}
        try:
            core.speak(text)
        except Exception as e:
            return {"done": False, "detail": f"could not reach JARVIS's voice: {e}"}
        return {"done": True, "detail": "sent to JARVIS's voice"}

    def publish(self, kind: str, text: str, **data) -> None:
        self.bus.publish("security", kind, text, **data)


class SecurityService:
    TICK_S = 1.0

    def __init__(self, svc, bus: EventBus, root: Optional[Path] = None, run=None, clock=time.time):
        root = root or ROOT                         # looked up now, so a test can point it elsewhere
        run = run or run_command
        self.svc, self.bus, self.root, self.clock = svc, bus, root, clock
        cfg, self.config_problem = load_config(root)
        self.checker = PresenceChecker(cfg.phones, run=run, clock=clock, ping=cfg.ping)
        self.run_cmd = run
        self.store = IncidentStore(root)
        self.away = AwayMode(cfg, self.checker, AppActions(svc, bus), self.store,
                             root / "state.json", clock=clock)
        self._checking = False
        self._check: Optional[asyncio.Task] = None
        self._last_check = float("-inf")
        self._errors = 0
        if self.config_problem:
            bus.publish("security", "error", f"Away mode: {self.config_problem}")
        if self.away.restored:
            self.away.actions.publish("armed", "Away mode is still armed after a restart — nothing was "
                                      "watched while JARVIS was off", by=self.away.armed_by, restored=True)

    # ------------------------------------------------------------ the loop
    def step(self, now: Optional[float] = None) -> None:
        """One second: sample Aankhen if armed and watching, run the timers."""
        now = self.clock() if now is None else now
        if self.away.watching(now):
            self.away.on_sample(sample_from_hub(self.svc.hub, now), now)
        self.away.tick(now)

    def check_due(self, now: float) -> bool:
        iv = self.away.check_interval()
        return iv is not None and not self._checking and now - self._last_check >= iv

    def check_now(self) -> dict:
        """Check the phones (blocking: pings take up to ~1 s each, in parallel)."""
        self._checking = True
        try:
            r = self.checker.check()
            self._last_check = r.at
            self.away.on_presence(self.clock())
            return {"ok": r.ok, "error": r.error, "seen": len(r.seen), "method": r.method}
        finally:
            self._checking = False

    async def _check_task(self) -> None:
        try:
            await run_in_threadpool(self.check_now)
        except Exception as e:
            self._checking = False
            self.bus.publish("security", "error", f"Away mode phone check failed: {type(e).__name__}: {e}")

    async def run(self) -> None:
        while True:
            try:
                now = self.clock()
                self.step(now)
                if self.check_due(now):
                    # Claimed before the thread starts, and the task is kept: an
                    # unreferenced task can be garbage-collected mid-run.
                    self._checking = True
                    self._check = asyncio.create_task(self._check_task())
                self._errors = 0
            except asyncio.CancelledError:
                raise
            except Exception as e:                  # a bug here must not kill the loop silently
                self._errors += 1
                if self._errors in (1, 10, 100):
                    self.bus.publish("security", "error", f"Away mode loop error: {type(e).__name__}: {e}")
            await asyncio.sleep(self.TICK_S)

    # ------------------------------------------------------------ views
    def status(self) -> dict:
        st = self.away.status()
        hub = getattr(self.svc, "hub", None)
        st["aankhen"] = {"running": bool(hub and hub.running), "mode": getattr(hub, "mode", None)}
        st["config_problem"] = self.config_problem
        st["config"] = self.away.cfg.to_dict()
        return st

    def set_config(self, cfg: AwayConfig) -> None:
        save_config(self.root, cfg)
        self.config_problem = None
        self.away.apply_config(cfg)

    def neighbors(self) -> list[dict]:
        """Devices this PC has talked to recently, to help find a phone's MAC. Only
        dynamic (learned) entries; never a broadcast or multicast address."""
        arp = parse_arp(self.run_cmd(["arp", "-a"]))
        try:
            states = {n.ip: n.kind for n in parse_neighbors(self.run_cmd(
                ["netsh", "interface", "ipv4", "show", "neighbors"]))}
        except Exception:
            states = {}
        listed = {p.mac for p in self.away.cfg.phones if p.mac} | {p.ip for p in self.away.cfg.phones if p.ip}
        return [{"ip": n.ip, "mac": n.mac, "state": states.get(n.ip, "unknown"),
                 "randomised_mac": is_randomised(n.mac), "listed": n.mac in listed or n.ip in listed}
                for n in arp if n.kind == "dynamic"]


def _chain_lifespan(app: FastAPI, start) -> None:
    """Run `start()` (a coroutine function) for as long as the app runs, inside the
    app's own lifespan — the same mechanism FastAPI uses to merge router lifespans."""
    inner = app.router.lifespan_context

    @asynccontextmanager
    async def lifespan(a):
        async with inner(a) as state:
            task = asyncio.create_task(start())
            try:
                yield state
            finally:
                task.cancel()
                try:
                    await task
                except BaseException:
                    pass
    app.router.lifespan_context = lifespan


def register(app: FastAPI, svc, bus: EventBus) -> None:
    sec = SecurityService(svc, bus)
    app.state.security = sec
    _chain_lifespan(app, sec.run)

    @app.get("/api/security")
    def security_status():
        return sec.status()

    @app.post("/api/security/arm")
    def security_arm(by: str = Body("app", embed=True)):
        if by not in ("app", "voice"):
            raise HTTPException(400, "by must be app or voice")
        return sec.away.arm(by)

    @app.post("/api/security/disarm")
    def security_disarm():
        return sec.away.disarm("app")

    @app.post("/api/security/check")
    async def security_check():
        if not sec.away.cfg.phones:
            raise HTTPException(400, "No family phones are listed yet.")
        if sec._checking:
            raise HTTPException(409, "A phone check is already running.")
        return await run_in_threadpool(sec.check_now)

    @app.get("/api/security/config")
    def security_config():
        return sec.away.cfg.to_dict()

    @app.put("/api/security/config")
    def security_config_set(changes: dict = Body(...)):
        try:
            cfg = AwayConfig.from_dict({**sec.away.cfg.to_dict(), **changes})
        except ValueError as e:
            raise HTTPException(400, str(e))
        sec.set_config(cfg)
        bus.publish("security", "config", "Away mode settings changed")
        return cfg.to_dict()

    @app.post("/api/security/phones")
    def security_phone_add(phone: dict = Body(...)):
        try:
            p = Phone.parse(phone)
            cur = sec.away.cfg.to_dict()
            if len(cur["phones"]) >= MAX_PHONES:
                raise ValueError(f"at most {MAX_PHONES} phones")
            cfg = AwayConfig.from_dict({**cur, "phones": cur["phones"] + [p.to_dict()]})
        except ValueError as e:
            raise HTTPException(400, str(e))
        sec.set_config(cfg)
        bus.publish("security", "config", "A family phone was added to away mode")
        return cfg.to_dict()

    @app.delete("/api/security/phones/{key}")
    def security_phone_remove(key: str):
        cur = sec.away.cfg
        keep = [p for p in cur.phones if p.key != key.lower() and p.key != key]
        if len(keep) == len(cur.phones):
            raise HTTPException(404, "no such phone")
        cfg = AwayConfig.from_dict({**cur.to_dict(), "phones": [p.to_dict() for p in keep]})
        sec.set_config(cfg)
        bus.publish("security", "config", "A family phone was removed from away mode")
        return cfg.to_dict()

    @app.get("/api/security/neighbors")
    async def security_neighbors():
        try:
            return await run_in_threadpool(sec.neighbors)
        except Exception as e:
            raise HTTPException(502, f"Could not read this PC's ARP table: {e}")

    @app.get("/api/security/incidents")
    def security_incidents(limit: int = 10):
        return sec.store.list(limit)

    @app.get("/api/security/incidents/{incident_id}")
    def security_incident(incident_id: str):
        inc = sec.store.get(incident_id)
        if inc is None:
            raise HTTPException(404, "no such incident")
        return inc
