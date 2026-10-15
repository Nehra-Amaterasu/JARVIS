"""JARVIS always on: the staff's event feed into the voice core, the remark log, the
once-a-minute health line, and starting him with the app.

    GET  /api/alwayson                the feed's queue, the last remark decisions, the last
                                      health line, the supervisor and the microphone
    GET  /api/settings/proactive      the remark switches (core/proactive.py DEFAULTS)
    POST /api/settings/proactive      {enabled?, muted?, quiet_start?, quiet_end?, min_gap_min?}

Wiring, without editing server.py:
  - the bus: every published event also goes to the feed (crew/feed.py classify), so the
    movement watcher's arrivals, the steward's alarms, the Uno and the reminders reach it;
  - the movement watcher's state is read every few seconds for the events the feed works
    out itself (long stillness, bed, up in the morning);
  - a pump hands the voice core the most important event, at most one every FORWARD_GAP_S,
    with whether media is playing; the core (core/proactive.py) decides and answers with a
    "proactive" event: every decision, spoken or not, goes to DATA/proactive.jsonl;
  - DATA/health.log: one JSON line a minute (RAM and private bytes of the app and the core,
    VRAM, CPU, mic alive, last wake, the brain resident or not, uptimes, restarts);
  - JARVIS_AUTOSTART_CORE=voice|text (set by app/watchdog.pyw): the core starts with the app;
  - a deliberate stop of the core puts the brain back on Ollama's 30-minute timer, so the
    VRAM is given back when he is not wanted (the core keeps it resident while he runs).
"""
from __future__ import annotations

import asyncio
import json
import os
import subprocess
import threading
import time
from collections import deque
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Callable, Optional

import httpx
from fastapi import Body, FastAPI, HTTPException
from starlette.concurrency import run_in_threadpool

from . import settings as st
from .paths import DATA, ensure_jarvis_importable

ensure_jarvis_importable()
import proactive                                   # noqa: E402  core/proactive.py
from crew.feed import Derivations, EventFeed      # noqa: E402

PROACTIVE_LOG = DATA / "proactive.jsonl"
HEALTH_LOG = DATA / "health.log"
LOG_MAX_BYTES = 2_000_000                          # then the older half is dropped
PUMP_S = 2.0
FORWARD_GAP_S = 5.0
DERIVE_S = 5.0
HEALTH_S = 60.0
UNPIN_KEEP_ALIVE = "30m"
CREATE_NO_WINDOW = 0x08000000


# ------------------------------------------------------------------ small files
def append_jsonl(path: Path, obj: dict, max_bytes: int = LOG_MAX_BYTES) -> None:
    """One JSON line; past max_bytes the file keeps its newer half. Never raises."""
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        with open(path, "a", encoding="utf-8") as f:
            f.write(json.dumps(obj, ensure_ascii=False, default=str) + "\n")
        if path.stat().st_size > max_bytes:
            lines = path.read_text(encoding="utf-8").splitlines(keepends=True)
            path.write_text("".join(lines[len(lines) // 2:]), encoding="utf-8")
    except OSError:
        pass


# ------------------------------------------------------------------ measurements
def gpu_memory() -> Optional[dict]:
    """{"used_mib", "total_mib"} from nvidia-smi, or None."""
    try:
        out = subprocess.run(["nvidia-smi", "--query-gpu=memory.used,memory.total", "--format=csv,noheader,nounits"],
                             capture_output=True, text=True, timeout=10,
                             creationflags=CREATE_NO_WINDOW if os.name == "nt" else 0).stdout.strip()
        used, total = (int(x) for x in out.splitlines()[0].split(","))
        return {"used_mib": used, "total_mib": total}
    except Exception:
        return None


class ProcMeter:
    """RAM (working set and private bytes) and CPU of the app and of the core's process
    tree (the venv's python.exe is a launcher; the real interpreter is its child)."""

    def __init__(self):
        import psutil
        self.psutil = psutil
        self._procs: dict[int, object] = {}

    def _proc(self, pid: int):
        p = self._procs.get(pid)
        if p is None:
            p = self._procs[pid] = self.psutil.Process(pid)
            try:
                p.cpu_percent(None)                      # the first call only starts the clock
            except Exception:
                pass
        return p

    def tree(self, root_pid: Optional[int], exclude: set = frozenset()) -> Optional[dict]:
        if not root_pid:
            return None
        try:
            root = self._proc(root_pid)
            procs = [root] + [self._proc(c.pid) for c in root.children(recursive=True)]
        except Exception:
            return None
        ws = priv = cpu = 0.0
        for p in procs:
            if p.pid in exclude:
                continue
            try:
                mi = p.memory_info()
                ws += mi.rss
                priv += getattr(mi, "private", 0) or getattr(mi, "vms", 0)
                cpu += p.cpu_percent(None)
            except Exception:
                continue
        live = {p.pid for p in procs}
        for pid in [k for k in self._procs if k not in live and k != root_pid]:
            self._procs.pop(pid, None)
        return {"ws_mb": round(ws / 2**20), "priv_mb": round(priv / 2**20), "cpu_pct": round(cpu, 1)}

    def descendants(self, pid: Optional[int]) -> set:
        if not pid:
            return set()
        try:
            p = self.psutil.Process(pid)
            return {pid} | {c.pid for c in p.children(recursive=True)}
        except Exception:
            return set()


def brain_now(model: Optional[str]) -> Optional[dict]:
    import ollama_guard
    try:
        return ollama_guard.brain_status(model or st.chosen_brain(), ollama_guard.ps(timeout=2.0))
    except Exception as e:
        return {"error": type(e).__name__}


def media_playing(svc) -> bool:
    """Anything playing: the window's own player, or a Windows media session marked Playing."""
    player = getattr(svc, "media", None)
    if player is None:
        return False
    try:
        if player.local_active():
            return True
    except Exception:
        pass
    try:
        snap = player.system.sessions(max_wait=0.3)
        return any(s.get("status") == "Playing" for s in (snap or {}).get("sessions") or [])
    except Exception:
        return False


# ------------------------------------------------------------------ the always-on service
class AlwaysOn:
    def __init__(self, svc, bus, clock: Callable[[], float] = time.time):
        self.svc, self.bus, self.clock = svc, bus, clock
        self.core = svc.core
        self.feed = EventFeed(clock=clock)
        self.derive = Derivations()
        self.decisions: deque = deque(maxlen=60)
        self.mic: Optional[dict] = None
        self.health: Optional[dict] = None
        self.started = clock()
        self._lock = threading.Lock()
        self._last_forward = 0.0
        self._last_derive = 0.0
        self.meter = None

    # -------------------------------------------------- decisions
    def log_decision(self, rec: dict) -> None:
        rec = {"t": round(self.clock(), 3), **rec}
        self.decisions.append(rec)
        append_jsonl(PROACTIVE_LOG, rec)

    def on_bus_event(self, ev: dict) -> None:
        if ev.get("source") not in ("crew", "limbs", "reminders"):
            return
        with self._lock:
            self.feed.offer_bus_event(ev)
            dropped = self.feed.take_dropped()
        for d in dropped:
            self.log_decision({"event": _brief(d), "speak": False, "reason": d.get("dropped"), "by": "feed"})

    def on_core_event(self, ev: dict) -> None:
        kind = ev.get("kind")
        if kind == "proactive":
            rec = {k: v for k, v in ev.items() if k not in ("kind", "t")}
            self.log_decision({**rec, "by": "core"})
            if rec.get("speak") and rec.get("line"):
                try:
                    self.core.note_remark(str(rec["line"]))
                except Exception:
                    pass
                self.bus.publish("core", "remark", str(rec["line"])[:200], event=(rec.get("event") or {}).get("kind"))
        elif kind == "mic":
            self.mic = {k: v for k, v in ev.items() if k != "kind"}
            if ev.get("alive") is False:
                self.bus.publish("core", "mic", f"Microphone {ev.get('reason') or 'problem'}: "
                                 f"{ev.get('device') or 'unknown'} (reopened {ev.get('reopens', 0)}x)",
                                 reason=ev.get("reason"))
        elif kind == "brain":
            append_jsonl(HEALTH_LOG, {"t": time.strftime("%Y-%m-%d %H:%M:%S"), "brain_event": ev.get("text")})

    # -------------------------------------------------- the pump
    def _movement(self) -> Optional[dict]:
        crew = getattr(self.svc, "crew", None)
        if crew is None:
            return None
        try:
            snap = crew.board.state("movement") or {}
        except Exception:
            return None
        return snap.get("data")

    def pump_once(self, media: Optional[Callable[[], bool]] = None) -> Optional[dict]:
        """Derive, then forward at most one event. Returns what was forwarded (or None)."""
        now = self.clock()
        if now - self._last_derive >= DERIVE_S:
            self._last_derive = now
            for fe in self.derive.update(self._movement(), now):
                with self._lock:
                    self.feed.push(fe)
        if now - self._last_forward < FORWARD_GAP_S:
            return None
        with self._lock:
            fe = self.feed.pop()
            dropped = self.feed.take_dropped()
        for d in dropped:
            self.log_decision({"event": _brief(d), "speak": False, "reason": d.get("dropped"), "by": "feed"})
        if fe is None:
            return None
        self._last_forward = now
        info = self.core.info()
        if not info.get("running") or info.get("ready_at") is None:
            self.log_decision({"event": _brief(fe), "speak": False, "reason": "core_offline", "by": "app"})
            return None
        playing = False
        try:
            playing = bool((media or (lambda: media_playing(self.svc)))())
        except Exception:
            pass
        try:
            self.core._send({"type": "event", "event": fe, "context": {"media_playing": playing}})
        except Exception as e:
            self.log_decision({"event": _brief(fe), "speak": False, "reason": "send_failed", "error": str(e)[:160],
                               "by": "app"})
            return None
        return fe

    # -------------------------------------------------- health
    def health_line(self) -> dict:
        if self.meter is None:
            self.meter = ProcMeter()
        info = self.core.info()
        core_pid = info.get("pid")
        core_pids = self.meter.descendants(core_pid)
        app = self.meter.tree(os.getpid(), exclude=core_pids)
        core = self.meter.tree(core_pid) if core_pid else None
        wakes = getattr(self.svc, "wakes", None)
        last_wake = None
        if wakes is not None:
            try:
                w = (wakes.view().get("wakes") or [None])[0]
                if w:
                    last_wake = {"t": time.strftime("%H:%M:%S", time.localtime(w["t"])), "outcome": w.get("outcome"),
                                 "ago_s": round(self.clock() - w["t"])}
            except Exception:
                pass
        mic = None
        if self.mic is not None:
            age = self.clock() - float(self.mic.get("t") or 0)
            mic = {"alive": bool(self.mic.get("alive", True)) and age < 150, "age_s": round(age),
                   "device": self.mic.get("device"), "reopens": self.mic.get("reopens"),
                   "peak": self.mic.get("peak")}
        sup = info.get("supervisor") or {}
        line = {
            "t": time.strftime("%Y-%m-%d %H:%M:%S"),
            "app": app, "core": core, "gpu": gpu_memory(),
            "brain": brain_now(getattr(self.core, "brain_model", None)) if info.get("running") else None,
            "core_state": info.get("state"), "core_mode": info.get("mode"),
            "core_uptime_s": info.get("uptime_s"), "app_uptime_s": round(self.clock() - self.started),
            "mic": mic, "last_wake": last_wake, "restarts": sup.get("restarts"),
            "remarks_queued": len(self.feed),
        }
        self.health = line
        return line

    def write_health(self) -> dict:
        line = self.health_line()
        append_jsonl(HEALTH_LOG, line)
        return line

    def unpin_brain(self) -> None:
        """After a deliberate stop: back on Ollama's timer (only if it is loaded; never loads it)."""
        model = getattr(self.core, "brain_model", None) or st.chosen_brain()
        try:
            loaded = st.ollama_loaded() or []
            if any(m.get("name") == model for m in loaded):
                httpx.post(f"{st.OLLAMA}/api/generate", json={"model": model, "keep_alive": UNPIN_KEEP_ALIVE},
                           timeout=10)
        except Exception:
            pass

    def view(self) -> dict:
        info = self.core.info()
        return {"queue": [_brief(e) for e in self.feed.peek()], "decisions": list(self.decisions)[-30:],
                "health": self.health, "mic": self.mic, "supervisor": info.get("supervisor"),
                "proactive": proactive.settings_from(st.store.read())}


def _brief(ev: dict) -> dict:
    return {k: ev.get(k) for k in ("id", "kind", "priority", "certainty", "evidence", "summary", "ts", "source")
            if ev.get(k) is not None}


def _tap_bus(bus, fn) -> None:
    """Every publish also goes to fn (after the bus has it). The bus is not subscribed to:
    a subscriber would count as an open window (bus.listeners)."""
    inner = bus.publish

    def publish(source, kind, text="", ephemeral=False, **data):
        ev = inner(source, kind, text, ephemeral=ephemeral, **data)
        if not ephemeral:
            try:
                fn(ev)
            except Exception:
                pass
        return ev
    bus.publish = publish


def save_proactive(change: dict) -> dict:
    allowed = {"enabled": bool, "muted": bool, "quiet_start": str, "quiet_end": str, "min_gap_min": (int, float)}
    clean = {}
    for k, v in change.items():
        if v is None:
            continue
        if k not in allowed or not isinstance(v, allowed[k]) or (k == "min_gap_min" and isinstance(v, bool)):
            raise ValueError(f"bad setting {k!r}")
        if k in ("quiet_start", "quiet_end") and proactive.parse_hhmm(v) is None:
            raise ValueError(f"{k} must be HH:MM")
        if k == "min_gap_min" and not 1 <= float(v) <= 24 * 60:
            raise ValueError("min_gap_min must be between 1 and 1440")
        clean[k] = v
    st.store.update(lambda s: s.setdefault("proactive", {}).update(clean))
    return proactive.settings_from(st.store.read())


def register(app: FastAPI, svc, bus) -> None:
    ao = AlwaysOn(svc, bus)
    svc.alwayson = ao
    _tap_bus(bus, ao.on_bus_event)
    svc.core.event_taps.append(ao.on_core_event)
    svc.core.stop_hooks.append(lambda: threading.Thread(target=ao.unpin_brain, daemon=True).start())

    def health_loop(stop: threading.Event):
        while not stop.wait(HEALTH_S):
            try:
                ao.write_health()
            except Exception as e:
                append_jsonl(HEALTH_LOG, {"t": time.strftime("%Y-%m-%d %H:%M:%S"), "error": str(e)[:200]})

    inner = app.router.lifespan_context

    @asynccontextmanager
    async def lifespan(a):
        async with inner(a) as state:
            stop = threading.Event()
            threading.Thread(target=health_loop, args=(stop,), name="health-log", daemon=True).start()

            async def pump():
                while True:
                    await asyncio.sleep(PUMP_S)
                    try:
                        await run_in_threadpool(ao.pump_once)
                    except Exception:
                        pass
            task = asyncio.create_task(pump())
            mode = (os.environ.get("JARVIS_AUTOSTART_CORE") or "").strip().lower()
            if mode in ("voice", "text"):
                def autostart():
                    time.sleep(3.0)                    # let the hub and the crew settle first
                    try:
                        svc.core.start(mode)
                        bus.publish("core", "autostart", f"Started JARVIS with the app ({mode})")
                    except Exception as e:
                        bus.publish("core", "error", f"Could not start JARVIS with the app: {e}")
                threading.Thread(target=autostart, name="core-autostart", daemon=True).start()
            try:
                yield state
            finally:
                stop.set()
                task.cancel()

    app.router.lifespan_context = lifespan

    @app.get("/api/alwayson")
    async def alwayson_view():
        return await run_in_threadpool(ao.view)

    @app.get("/api/settings/proactive")
    def proactive_get():
        return proactive.settings_from(st.store.read())

    @app.post("/api/settings/proactive")
    def proactive_set(enabled: Optional[bool] = Body(None, embed=True), muted: Optional[bool] = Body(None, embed=True),
                      quiet_start: Optional[str] = Body(None, embed=True), quiet_end: Optional[str] = Body(None, embed=True),
                      min_gap_min: Optional[float] = Body(None, embed=True)):
        try:
            out = save_proactive({"enabled": enabled, "muted": muted, "quiet_start": quiet_start,
                                  "quiet_end": quiet_end, "min_gap_min": min_gap_min})
        except ValueError as e:
            raise HTTPException(400, str(e))
        bus.publish("settings", "proactive", "Unprompted remarks: " + ("off" if not out["enabled"] else
                    "muted" if out["muted"] else f"on, at most one every {out['min_gap_min']:g} min"))
        return out
