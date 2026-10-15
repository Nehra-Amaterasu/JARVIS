"""Keep Ollama, the server JARVIS's model runs in, up.

2026-10-10: Ollama had been closed (its log just stops; no crash), and every reply
failed with "[WinError 10061] No connection could be made because the target
machine actively refused it". JARVIS said nothing and the raw error was all Aman
saw, so it looked like JARVIS refusing him. Now:
  - at boot and on a refused connection, JARVIS starts `ollama serve` himself;
  - if that fails, he says so in one plain sentence.

The server is started detached, so putting JARVIS to sleep (the app terminates his
process) leaves it running for the next wake.
"""
import os
import re
import shutil
import subprocess
import threading
import time

import httpx

URL = "http://127.0.0.1:11434"
START_WAIT_S = 30           # a cold `ollama serve` answers in ~1-3 s; GPU discovery can take longer
_lock = threading.Lock()
_last_start = 0.0


def up(timeout: float = 0.8) -> bool:
    try:
        return httpx.get(f"{URL}/api/version", timeout=timeout).status_code == 200
    except Exception:
        return False


def find_exe():
    exe = shutil.which("ollama")
    if exe:
        return exe
    guess = os.path.join(os.environ.get("LOCALAPPDATA", ""), "Programs", "Ollama", "ollama.exe")
    return guess if os.path.isfile(guess) else None


def clean_env() -> dict:
    """The environment for a server JARVIS starts: without the venv folders jarvis.py
    puts first on PATH (its pip-installed cuBLAS for Whisper), so Ollama loads its own
    bundled CUDA libraries as it does when started from its tray app."""
    env = dict(os.environ)
    env["PATH"] = os.pathsep.join(p for p in env.get("PATH", "").split(os.pathsep)
                                  if p and "site-packages" not in p.lower() and ".venv" not in p.lower())
    return env


def ensure(wait_s: float = START_WAIT_S, log=print) -> bool:
    """True once Ollama answers, starting it if needed. Never raises."""
    global _last_start
    if up():
        return True
    with _lock:
        if up():
            return True
        exe = find_exe()
        if not exe:
            log("[Ollama] not installed: ollama.exe not found")
            return False
        if time.monotonic() - _last_start > 10:     # don't stack starts while one is booting
            _last_start = time.monotonic()
            log(f"[Ollama] not running, starting {exe} serve")
            logdir = os.path.join(os.environ.get("LOCALAPPDATA", ""), "Ollama")
            out = (open(os.path.join(logdir, "server-jarvis.log"), "ab")
                   if os.path.isdir(logdir) else subprocess.DEVNULL)
            flags = 0
            if os.name == "nt":
                flags = subprocess.DETACHED_PROCESS | subprocess.CREATE_NEW_PROCESS_GROUP
            try:
                subprocess.Popen([exe, "serve"], stdin=subprocess.DEVNULL, stdout=out, stderr=out,
                                 creationflags=flags, close_fds=True, env=clean_env())
            except Exception as e:
                log(f"[Ollama] could not start: {e}")
                return False
        deadline = time.monotonic() + wait_s
        while time.monotonic() < deadline:
            if up():
                log("[Ollama] up")
                return True
            time.sleep(0.25)
        log(f"[Ollama] still not answering after {wait_s:.0f} s")
        return False


def is_down_error(e: BaseException) -> bool:
    """Did this fail because nothing is listening on Ollama's port?"""
    seen = set()
    while e is not None and id(e) not in seen:
        seen.add(id(e))
        if isinstance(e, ConnectionRefusedError) or type(e).__name__ in ("ConnectError", "ConnectTimeout"):
            return True
        msg = str(e)
        if "10061" in msg or "actively refused" in msg or "Failed to connect to Ollama" in msg:
            return True
        e = e.__cause__ or e.__context__
    return False


# ------------------------------------------------------------------ keep the brain resident
# 2026-10-15: the brain was asked for with keep_alive="30m", and every other client of the
# same model (the chat learner, the beliefs and taste passes, Mission's AI) also sends
# "30m". So after 30 quiet minutes Ollama dropped it, and the next question paid a cold
# load (124.6 s measured on 10-08; ~6-10 s from a warm disk cache). Now JARVIS asks with
# keep_alive=-1 (resident until unloaded) and a keeper re-pins it: any request from
# another client with "30m" resets the timer to 30 minutes, so every KEEP_CHECK_S the
# keeper reads /api/ps and, when the brain is missing or due to expire, loads it again
# with -1 (an empty /api/generate loads the weights and generates nothing).
KEEP_ALIVE = -1                  # Ollama: a negative duration keeps the model loaded
KEEP_CHECK_S = 300.0
PINNED_AFTER_S = 10 * 365 * 24 * 3600   # -1 shows in /api/ps as an expiry centuries ahead


def keep_alive_value(environ=None):
    """JARVIS_KEEP_ALIVE overrides (e.g. "30m" to go back to the old behaviour); default -1."""
    raw = ((environ if environ is not None else os.environ).get("JARVIS_KEEP_ALIVE") or "").strip()
    if not raw:
        return KEEP_ALIVE
    try:
        return int(raw)
    except ValueError:
        return raw


def _expiry_s(expires_at, now: float):
    """Seconds until an /api/ps expires_at ("2026-10-15T13:02:11.5+05:30"), or None."""
    if not expires_at:
        return None
    from datetime import datetime
    s = str(expires_at)
    m = re.match(r"(\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d)(\.\d+)?(Z|[+-]\d\d:\d\d)?", s)
    if not m:
        return None
    tz = m.group(3) or "+00:00"
    try:
        dt = datetime.fromisoformat(m.group(1) + (tz if tz != "Z" else "+00:00"))
    except ValueError:
        return None
    return dt.timestamp() - now


def brain_status(model: str, ps: list, now: float = None) -> dict:
    """{"loaded": bool, "vram_mb", "expires_in_s", "pinned"} for `model` in /api/ps's list."""
    now = time.time() if now is None else now
    for m in ps or []:
        if (m.get("name") or m.get("model")) == model:
            exp = _expiry_s(m.get("expires_at"), now)
            return {"loaded": True, "vram_mb": int(m.get("size_vram") or 0) // 2**20,
                    "expires_in_s": None if exp is None else round(exp),
                    "pinned": exp is not None and exp > PINNED_AFTER_S,
                    "num_ctx": m.get("context_length")}
    return {"loaded": False, "vram_mb": 0, "expires_in_s": None, "pinned": False, "num_ctx": None}


def needs_pin(status: dict, keep_alive=KEEP_ALIVE, num_ctx=None) -> bool:
    """Load when the brain is not loaded, or loaded with another context size (the next
    question would reload it: measured 2026-10-15, an empty /api/generate loads it at
    4096, JARVIS asks at 8192). In resident mode (keep_alive < 0), also re-pin when
    another client's request put it back on a timer (minutes, not centuries)."""
    if not status.get("loaded"):
        return True
    if num_ctx and status.get("num_ctx") and int(status["num_ctx"]) != int(num_ctx):
        return True
    return isinstance(keep_alive, int) and keep_alive < 0 and not status.get("pinned")


def ps(timeout: float = 2.0) -> list:
    r = httpx.get(f"{URL}/api/ps", timeout=timeout)
    r.raise_for_status()
    return r.json().get("models") or []


def pin(model: str, keep_alive=KEEP_ALIVE, num_ctx=None, timeout: float = 180.0) -> bool:
    """Load `model` (if needed) at JARVIS's context size and set its keep_alive. Never raises."""
    body = {"model": model, "keep_alive": keep_alive}
    if num_ctx:
        body["options"] = {"num_ctx": int(num_ctx)}
    try:
        httpx.post(f"{URL}/api/generate", json=body, timeout=timeout)
        return True
    except Exception:
        return False


class Keeper:
    """The thread that keeps the brain resident. check() is one look (tests call it)."""

    def __init__(self, model: str, keep_alive=KEEP_ALIVE, interval_s: float = KEEP_CHECK_S,
                 get_ps=None, do_pin=None, log=print, busy=lambda: False, num_ctx=None):
        self.model, self.keep_alive, self.interval_s, self.num_ctx = model, keep_alive, interval_s, num_ctx
        self.get_ps = get_ps or ps
        self.do_pin = do_pin or (lambda m, k: pin(m, k, num_ctx))
        self.log, self.busy = log, busy
        self.last: dict = {}
        self.pins = 0
        self._stop = threading.Event()

    def check(self) -> dict:
        try:
            st = brain_status(self.model, self.get_ps())
        except Exception as e:
            self.last = {"error": f"{type(e).__name__}: {e}"[:160]}
            return self.last
        if needs_pin(st, self.keep_alive, self.num_ctx) and not self.busy():
            why = ("not loaded" if not st["loaded"] else
                   f"loaded at num_ctx {st.get('num_ctx')}" if self.num_ctx and st.get("num_ctx")
                   and int(st["num_ctx"]) != int(self.num_ctx) else f"expires in {st['expires_in_s']} s")
            ok = self.do_pin(self.model, self.keep_alive)
            self.pins += 1
            self.log(f"[Ollama] brain {why}: {'pinned again' if ok else 'pin FAILED'} (keep_alive={self.keep_alive})")
            st = {**st, "repinned": ok}
        self.last = st
        return st

    def start(self) -> "Keeper":
        def loop():
            while not self._stop.wait(self.interval_s):
                self.check()
        threading.Thread(target=loop, name="ollama-keeper", daemon=True).start()
        return self

    def stop(self) -> None:
        self._stop.set()
