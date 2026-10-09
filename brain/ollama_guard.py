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
