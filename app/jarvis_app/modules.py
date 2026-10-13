"""Heavy capabilities JARVIS can switch on for a moment, then give the memory back.

Each module says what it does, what it costs (VRAM, RAM) and its status:
    not_installed   its files are not on this machine; `download` says what it would
                    take. Nothing here ever downloads: that is Aman's call.
    installed       ready, not in memory
    loaded          in memory right now (Ollama's /api/ps, or JARVIS's own log line)
and, while switched on, `until` (epoch seconds).

    deep_think     a bigger (or reasoning) installed model answers for N minutes. The
                   4B brain is unloaded first so the big one gets the VRAM, the big one
                   is preloaded so the first question does not pay its load, and when
                   the time is up it is unloaded and the brain preloaded again.
                   core/agent.py reads the switch before every turn (no restart).
    offline_voice  Kokoro-82M on the CPU instead of Microsoft's cloud voice, for N
                   minutes: core/voice.py reads the switch before every sentence.
    unload_all     drops every model Ollama holds, now, and switches deep think off.

The time limit is enforced twice: a timer per activation, and a sweep on every read
(so a switch left on by an app that was closed still ends on time).
"""
from __future__ import annotations

import threading
import time
from typing import Callable, Optional

import httpx

from . import connect
from . import settings as st
from .paths import ensure_jarvis_importable

ensure_jarvis_importable()
import user_settings                    # noqa: E402  core/user_settings.py

MINUTES = (1, 240)                       # what one activation may ask for
BRAIN_KEEP_ALIVE = "30m"                 # core/agent.py keeps the brain this long
OFFLINE_LOADED = "[voice] offline voice loaded"
KOKORO_FILES_MB = {"kokoro-v1.0.int8.onnx": 92, "voices-v1.0.bin": 28}    # measured, 2026-10-09 install
# Not installed here, worth knowing about: same family as the brain, reasons before it
# answers. Its size is Ollama's library listing.
SUGGESTED_DEEP = {"name": "qwen3:8b", "gb": 5.2, "command": "ollama pull qwen3:8b",
                  "why": "Qwen3 8B: same family as the brain, reasons before answering."}


def preload(model: str, keep_alive: str) -> bool:
    """Ask Ollama to load a model now (an empty generate loads it and returns)."""
    try:
        httpx.post(f"{st.OLLAMA}/api/generate", json={"model": model, "keep_alive": keep_alive}, timeout=120)
        return True
    except Exception:
        return False


def unload(model: str) -> bool:
    try:
        httpx.post(f"{st.OLLAMA}/api/generate", json={"model": model, "keep_alive": 0}, timeout=10)
        return True
    except Exception:
        return False


class Modules:
    def __init__(self, core=None, publish: Optional[Callable] = None, *,
                 models: Optional[Callable] = None, loaded: Optional[Callable] = None,
                 load: Optional[Callable] = None, drop: Optional[Callable] = None,
                 kokoro: Optional[Callable] = None, clock: Callable[[], float] = time.time,
                 background: bool = True):
        self.core = core
        self.publish = publish or (lambda *a, **k: None)
        # Looked up at each call (not bound here), so the module-level functions can be
        # replaced: by a test, or by a dev server with no Ollama.
        self.models = models or (lambda: st.ollama_models())
        self.loaded = loaded or (lambda: st.ollama_loaded())
        self.load = load or (lambda m, k: preload(m, k))
        self.drop = drop or (lambda m: unload(m))
        self.kokoro = kokoro or (lambda: connect.kokoro_ready(st.kokoro_dir()))
        self.clock = clock
        self.background = background            # tests run the GPU work inline
        self._timers: dict[str, threading.Timer] = {}
        self._lock = threading.Lock()

    # ------------------------------------------------------------ helpers
    def _later(self, fn, *args) -> None:
        if self.background:
            threading.Thread(target=fn, args=args, daemon=True).start()
        else:
            fn(*args)

    def _core_running(self) -> bool:
        return bool(self.core is not None and getattr(self.core, "running", False))

    def running_brain(self) -> str:
        """The model JARVIS is thinking with: the one he was started with while he runs,
        else the one he will start with."""
        started = getattr(self.core, "brain_model", None) if self._core_running() else None
        return started or st.chosen_brain()

    def deep_candidates(self, models: Optional[list[dict]], brain: str) -> list[dict]:
        """Installed models JARVIS can think with that are bigger than the brain, or the
        same size but reasoning; the biggest first."""
        b = next((m for m in models or [] if m["name"] == brain), None)
        b_params = st.params_b(b["params"]) if b else 4.0
        out = []
        for m in models or []:
            if m["name"] == brain or st.why_not_brain(m):
                continue
            p = st.params_b(m.get("params"))
            thinking = "thinking" in (m.get("capabilities") or [])
            if p > b_params or (p >= b_params and thinking):
                out.append({"name": m["name"], "params": m.get("params"), "gb": round(m["size"] / 1e9, 2),
                            "vram_gb": round((m["size"] + st.VRAM_OVERHEAD_BYTES) / 1e9, 1),
                            "thinking": thinking, "warn": st.vram_warning(m), "note": st._note(m["name"])})
        out.sort(key=lambda c: (-st.params_b(c["params"]), not c["thinking"]))
        return out

    # ------------------------------------------------------------ the view
    def view(self) -> list[dict]:
        self.expire_due()
        s = st.store.read()
        now = self.clock()
        models = self.models()
        ps = self.loaded()
        in_mem = {m["name"]: m for m in ps or []}
        brain = self.running_brain()

        deep_on = user_settings.module_active(s, "deep_think", now)
        cands = self.deep_candidates(models, brain)
        installed = {m["name"] for m in models or []}
        deep = {
            "id": "deep_think", "name": "Deep think", "kind": "timed",
            "what": "A bigger model answers for a while: slower, more careful. The brain is unloaded to make room, "
                    "then brought back when the time is up.",
            "candidates": cands, "model": (deep_on or {}).get("model") or (cands[0]["name"] if cands else None),
            "until": (deep_on or {}).get("until"),
            "cost": {"vram_gb": cands[0]["vram_gb"] if cands else None, "ram_gb": None,
                     "note": "Over ~5 GB, Ollama puts the rest in RAM and runs it on the CPU."},
            "download": None if SUGGESTED_DEEP["name"] in installed else SUGGESTED_DEEP,
        }
        if models is None:
            deep.update(status="unknown", detail="Ollama is not answering.")
        elif not cands:
            deep.update(status="not_installed",
                        detail="No installed model is bigger than the brain or reasons before answering.")
        else:
            active = deep["model"]
            deep.update(status="loaded" if active in in_mem else "installed",
                        detail=f"{active} holds {in_mem[active]['vram'] / 1e9:.1f} GB of VRAM now." if active in in_mem
                        else f"{len(cands)} installed model(s) can do it.")

        k_ok, k_detail = self.kokoro()
        core_logs = list(getattr(self.core, "logs", []) or []) if self.core is not None else []
        since = getattr(self.core, "started_at", None) or 0
        k_loaded = self._core_running() and any(OFFLINE_LOADED in l.get("line", "") and l.get("t", 0) >= since
                                                 for l in core_logs)
        off_on = user_settings.module_active(s, "offline_voice", now)
        voice_id = user_settings.parse_voice_id((s.get("voice") or {}).get("id"))
        offline = {
            "id": "offline_voice", "name": "Offline voice", "kind": "timed",
            "what": "Kokoro-82M speaks on the CPU instead of Microsoft's cloud voice: nothing leaves the laptop, "
                    "and it works with no internet.",
            "until": (off_on or {}).get("until"),
            "always": bool(voice_id and voice_id[0] == "kokoro"),
            "cost": {"vram_gb": 0, "ram_gb": 0.3, "note": "About 1 s to load on its first sentence."},
            "status": "loaded" if k_loaded else ("installed" if k_ok else "not_installed"),
            "detail": ("In JARVIS's memory now." if k_loaded else k_detail),
            "download": None if k_ok else {
                "name": "Kokoro-82M", "gb": round(sum(KOKORO_FILES_MB.values()) / 1000, 2),
                "command": None, "why": "kokoro-v1.0.int8.onnx (92 MB) and voices-v1.0.bin (28 MB) into data/models/kokoro."},
        }

        total = sum(m["vram"] for m in ps or [])
        free = {
            "id": "unload_all", "name": "Free the GPU", "kind": "action",
            "what": "Unload every model Ollama holds, now, and switch deep think off. The next question reloads "
                    "the brain (a few seconds).",
            "cost": {"vram_gb": round(total / 1e9, 1), "ram_gb": None,
                     "note": "Whisper stays in JARVIS's process until he is stopped."},
            "loaded": [{"name": m["name"], "vram_gb": round(m["vram"] / 1e9, 2)} for m in ps or []],
            "status": "unknown" if ps is None else ("loaded" if ps else "installed"),
            "detail": "Ollama is not answering." if ps is None else
                      (f"{len(ps)} model(s), {total / 1e9:.1f} GB of VRAM." if ps else "Nothing loaded."),
        }
        return [deep, offline, free]

    # ------------------------------------------------------------ switching
    def activate(self, mid: str, minutes: int, model: Optional[str] = None) -> dict:
        if not (MINUTES[0] <= int(minutes) <= MINUTES[1]):
            raise ValueError(f"minutes must be {MINUTES[0]} to {MINUTES[1]}")
        now = self.clock()
        until = now + int(minutes) * 60
        if mid == "deep_think":
            brain = self.running_brain()
            cands = self.deep_candidates(self.models(), brain)
            pick = next((c for c in cands if c["name"] == model), None) if model else (cands[0] if cands else None)
            if pick is None:
                raise ValueError("That model cannot deep-think here (not installed, or not bigger than the brain).")
            st.store.update(lambda s: s["modules"].__setitem__(
                "deep_think", {"model": pick["name"], "thinking": pick["thinking"], "until": until, "brain": brain}))
            if self._core_running():
                self._later(self._swap, brain, pick["name"], f"{int(minutes)}m")
            self.publish("modules", "deep_think", f"Deep think on for {int(minutes)} min: {pick['name']}",
                         model=pick["name"], until=until)
        elif mid == "offline_voice":
            ok, why = self.kokoro()
            if not ok:
                raise ValueError(f"The offline voice is not installed: {why}")
            st.store.update(lambda s: s["modules"].__setitem__("offline_voice", {"until": until}))
            self.publish("modules", "offline_voice", f"Offline voice for {int(minutes)} min (Kokoro, CPU)")
        else:
            raise KeyError(mid)
        self._schedule(mid, until - now)
        return {"ok": True, "until": until}

    def _swap(self, out_model: str, in_model: str, keep: str) -> None:
        self.drop(out_model)
        self.load(in_model, keep)

    def deactivate(self, mid: str, reason: str = "switched off") -> dict:
        if mid not in ("deep_think", "offline_voice"):
            raise KeyError(mid)
        old = {}

        def change(s):
            old.update(s["modules"].pop(mid, None) or {})
        st.store.update(change)
        with self._lock:
            t = self._timers.pop(mid, None)
        if t is not None:
            t.cancel()
        if mid == "deep_think" and old.get("model"):
            def back():
                self.drop(old["model"])
                if self._core_running():
                    self.load(self.running_brain(), BRAIN_KEEP_ALIVE)
            self._later(back)
            self.publish("modules", "deep_think", f"Deep think off ({reason}): back to {self.running_brain()}")
        elif mid == "offline_voice" and old:
            self.publish("modules", "offline_voice", f"Offline voice off ({reason})")
        return {"ok": True, "was": old or None}

    def unload_all(self) -> dict:
        if user_settings.module_active(st.store.read(), "deep_think", self.clock()):
            self.deactivate("deep_think", "the GPU was freed")
        ps = self.loaded()
        if ps is None:
            raise RuntimeError("Ollama is not answering.")
        done = [m["name"] for m in ps if self.drop(m["name"])]
        freed = sum(m["vram"] for m in ps if m["name"] in done)
        self.publish("system", "unload", f"Freed {freed / 1e9:.1f} GB of VRAM: {', '.join(done) or 'nothing loaded'}")
        return {"ok": True, "unloaded": done, "freed_gb": round(freed / 1e9, 2)}

    # ------------------------------------------------------------ time limits
    def _schedule(self, mid: str, delay: float) -> None:
        if not self.background:
            return
        t = threading.Timer(max(0.0, delay) + 0.5, self.expire_due)
        t.daemon = True
        with self._lock:
            old = self._timers.pop(mid, None)
            self._timers[mid] = t
        if old is not None:
            old.cancel()
        t.start()

    def expire_due(self) -> list[str]:
        """Switch off every module whose time is up. Returns their ids."""
        s = st.store.read()
        now = self.clock()
        ended = []
        for mid, entry in list((s.get("modules") or {}).items()):
            if isinstance(entry, dict) and float(entry.get("until") or 0) <= now and mid in ("deep_think", "offline_voice"):
                self.deactivate(mid, "time is up")
                ended.append(mid)
        return ended

    def resume(self) -> None:
        """At app start: end what expired while the app was closed, re-arm the rest."""
        self.expire_due()
        s = st.store.read()
        for mid, entry in (s.get("modules") or {}).items():
            if isinstance(entry, dict) and entry.get("until"):
                self._schedule(mid, float(entry["until"]) - self.clock())
