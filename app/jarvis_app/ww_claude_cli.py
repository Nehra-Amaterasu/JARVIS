"""The outside model: Claude asked through the Claude command-line tool on this PC, on his own subscription (B1, R-64).

    mode_for(store)      -> "off" | "local" | "claude"     what R-64 last chose; rules_only on means "off"
    provider_for(store)  -> Provider | None                a (system, user) -> text callable for "claude", None otherwise
    name_for(store)      -> str                            "claude-cli:haiku", "local" or "off", kept beside what a model wrote
    available()          -> {"claude": bool, "local": bool} found by `claude --version` and the local model's version call
    set_mode(store, provider, claude_model=None) -> the stored choice   (R-64 PUT)
    claude_provider(model, workdir) -> Provider            the call itself
    resolve_command()    -> [program, ...] | None          the program that really runs, never a .cmd

Why the call has this exact shape (measured on this PC on 28 Nov, research file "Claude inside the app without an API
key"): a plain `claude -p` carried 46,777 tokens of setup from installed plugins; with the tools off, MCP ignored, no
session kept and our own short system prompt it used 1,330 input tokens and took 4.1 s. `--bare` cannot be used: it
reads only an API key, and he decided on 27 Nov not to use one. One prompt goes in on stdin as UTF-8, one JSON envelope
comes out; `result` is handed back as text and ww_counsel's own parser reads the model's JSON, fences and all.

Why the .cmd shim is never run with arguments: npm installs `claude.cmd`, and Windows runs a .cmd through cmd.exe, which
reads `&`, `|`, `%VAR%` and `^` in the arguments as its own syntax (the 2024 "BatBadBut" class). Our system prompt holds
quotes, newlines and percent signs. So the shim is read as text and the program it launches (bin/claude.exe for the
2.1 npm package on this PC) is run directly as an argument list, with no shell; a .exe parses its own command line by
the rules subprocess.list2cmdline writes for. A shim this module cannot read is not run at all.

Privacy: the child gets a copy of this process's environment with nothing added (no key is ever set here, none is
read or printed), runs in an empty folder under the pyq store so no project file is in its working directory, and
whatever is sent leaves the PC and counts against his Claude usage. R-64 says so in its reason sentence.
"""
from __future__ import annotations

import json
import os
import re
import shutil
import signal
import subprocess
import threading
import time
import urllib.request
from dataclasses import dataclass
from pathlib import Path
from typing import Callable, Optional

from .ww_pyq import settings
from .ww_pyq.blueprint import write_json_atomic

Provider = Callable[[str, str], str]          # the same shape as ww_counsel.Provider

MODES = ("off", "local", "claude")
CLAUDE_MODELS = ("haiku", "sonnet", "opus")
DEFAULT_CLAUDE_MODEL = "haiku"                # the measured call: 1,330 input tokens, 4.1 s
TIMEOUT_S = 120.0                             # 4.1 s measured for haiku; 120 s leaves room for opus on a long prompt
VERSION_TIMEOUT_S = 10.0                      # `--version` starts the program and prints one line
AVAILABLE_TTL_S = 60.0                        # a screen polls R-64; one version call a minute at most
MAX_STDOUT = 2 * 1024 * 1024                  # one answer is a few KB; 2 MB means something is wrong, not a long answer
MAX_STDERR = 64 * 1024
MAX_SYSTEM = 8000                             # our prompt files are 304 to 738 characters; Windows caps a command line at 32,767
MAX_SHIM = 64 * 1024                          # the npm shim is 200 bytes
WORKDIR = "claude-cwd"                        # under the pyq store root, kept empty


def workdir_for(store) -> Path:
    """The folder the tool runs in: the store's own empty folder, unless a parent of it holds a CLAUDE.md. The tool reads
    those files from its working folder upward (measured 28 Nov 2026: 4,386 tokens of setup from inside a project
    against 1,330 from outside), and the real store lives under the project, so it gets a folder under the system
    temp directory instead: the project's instructions are not sent, and are not paid for, on every call."""
    import tempfile
    w = Path(store.root) / WORKDIR
    if any((p / "CLAUDE.md").exists() for p in w.resolve().parents):
        return Path(tempfile.gettempdir()) / "jarvis-claude-cwd"
    return w
LOCAL_URL = "http://127.0.0.1:11434"          # ww_counsel.OLLAMA, on loopback
_KEY_PROVIDER, _KEY_MODEL = "model_provider", "claude_model"


class ClaudeCliError(RuntimeError):
    """One plain sentence; ww_counsel turns it into a "no model" answer."""


# ------------------------------------------------------------------ the setting R-64 writes
def _stored(store) -> dict:
    d = settings._read(store)                 # the same file and reader as rules_only, so unknown keys survive both
    provider = d.get(_KEY_PROVIDER) if d.get(_KEY_PROVIDER) in ("local", "claude") else "local"
    model = d.get(_KEY_MODEL) if d.get(_KEY_MODEL) in CLAUDE_MODELS else DEFAULT_CLAUDE_MODEL
    return {"provider": provider, "claude_model": model}


def mode_for(store) -> str:
    if settings.rules_only(store):
        return "off"
    return _stored(store)["provider"]


def claude_model_for(store) -> str:
    return _stored(store)["claude_model"]


def name_for(store) -> str:
    mode = mode_for(store)
    return f"claude-cli:{claude_model_for(store)}" if mode == "claude" else mode


def provider_for(store) -> Optional[Provider]:
    if mode_for(store) != "claude":
        return None                           # "local": ww_counsel uses its default; "off": the caller asks nothing
    return claude_provider(claude_model_for(store), workdir_for(store))


def set_mode(store, provider, claude_model=None) -> dict:
    """Write R-64's choice. "off" is rules_only on and keeps the last model choice, so turning rules_only off with R-35
    returns to what he had; "local" and "claude" turn rules_only off."""
    if provider not in MODES:
        raise ValueError("provider is local, claude or off.")
    if claude_model is not None and claude_model not in CLAUDE_MODELS:
        raise ValueError("claude_model is haiku, sonnet or opus.")
    with settings._LOCK:                      # one lock with settings.save, so neither write loses the other's key
        d = settings._read(store)
        d["rules_only"] = provider == "off"
        if provider != "off":
            d[_KEY_PROVIDER] = provider
        if claude_model is not None:
            d[_KEY_MODEL] = claude_model
        write_json_atomic(settings._path(store), d)
    return {"provider": mode_for(store), "claude_model": claude_model_for(store)}


# ------------------------------------------------------------------ finding the program
def _which(name: str) -> Optional[str]:
    return shutil.which(name)


_TOKEN = re.compile(r'"([^"]*)"|(\S+)')


def _from_shim(shim: Path) -> Optional[list[str]]:
    """The argument list the npm shim would launch, read from its text. None when the shim is not the known shape."""
    try:
        raw = shim.read_bytes()[:MAX_SHIM].decode("utf-8", "replace")
    except OSError:
        return None
    lines = [ln for ln in raw.splitlines() if "%*" in ln]
    if not lines:
        return None
    line = lines[-1].split("%*", 1)[0]
    if " & " in line:                         # the older npm shim: `endLocal & goto ... & "%_prog%" "...\cli.js" %*`
        line = line.rsplit(" & ", 1)[1]
    dp0 = str(shim.parent) + os.sep
    out: list[str] = []
    for quoted, bare in _TOKEN.findall(line):
        tok = quoted if quoted else bare
        if tok in ("%_prog%", "%_prog%".upper()):
            local_node = shim.parent / "node.exe"
            tok = str(local_node) if local_node.is_file() else (_which("node") or "")
        tok = tok.replace("%dp0%", dp0).replace("%~dp0", dp0).replace("%DP0%", dp0)
        if not tok or "%" in tok:             # a variable we cannot expand: do not guess what cmd.exe would run
            return None
        out.append(os.path.normpath(tok) if (os.sep in tok or "/" in tok) else tok)
    if not out:
        return None
    prog = Path(out[0])
    if prog.suffix.lower() not in (".exe", ".com") or not prog.is_file():
        return None
    return out


def resolve_command() -> Optional[list[str]]:
    """The program (and any fixed leading arguments) that `claude` runs, or None. Never a .cmd or .bat."""
    exe = _which("claude")
    if not exe:
        return None
    p = Path(exe)
    ext = p.suffix.lower()
    if ext in (".cmd", ".bat"):
        return _from_shim(p)
    if os.name == "nt" and ext not in (".exe", ".com"):
        return None                           # a .ps1 or a bare sh shim is not something CreateProcess can run
    return [str(p)]


# ------------------------------------------------------------------ running a process
@dataclass
class Ran:
    returncode: Optional[int]
    stdout: bytes
    stderr: bytes
    timed_out: bool = False
    overflow: bool = False


def _kill_tree(p: subprocess.Popen) -> None:
    """The npm program may start children of its own; a timeout ends all of them, not only the first."""
    try:
        if os.name == "nt":
            tk = os.path.join(os.environ.get("SystemRoot", r"C:\Windows"), "System32", "taskkill.exe")
            subprocess.run([tk, "/F", "/T", "/PID", str(p.pid)], stdout=subprocess.DEVNULL,
                           stderr=subprocess.DEVNULL, timeout=10, creationflags=0x08000000)
        else:
            os.killpg(p.pid, signal.SIGKILL)
    except (OSError, subprocess.SubprocessError):
        pass
    try:
        p.kill()
    except OSError:
        pass


def _real_run(argv: list[str], stdin: bytes, cwd: Optional[str], env: dict, timeout: float, max_out: int) -> Ran:
    kw: dict = {}
    if os.name == "nt":
        kw["creationflags"] = 0x08000000 | 0x00000200     # CREATE_NO_WINDOW (the app runs windowless), new process group
    else:
        kw["start_new_session"] = True                     # its own group, so killpg reaches its children
    p = subprocess.Popen(argv, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                         cwd=cwd, env=env, shell=False, **kw)
    out, err, over = bytearray(), bytearray(), threading.Event()

    def pump(stream, buf: bytearray, limit: int, is_out: bool) -> None:
        try:
            while True:
                chunk = stream.read(65536)
                if not chunk:
                    return
                room = limit + 1 - len(buf)
                if room > 0:
                    buf += chunk[:room]
                if is_out and len(buf) > limit and not over.is_set():
                    over.set()                             # stop a runaway at the cap instead of holding all of it
                    _kill_tree(p)
        except (OSError, ValueError):
            return

    def feed() -> None:
        try:
            p.stdin.write(stdin)
        except (OSError, ValueError):
            pass
        finally:
            try:
                p.stdin.close()
            except (OSError, ValueError):
                pass

    threads = [threading.Thread(target=pump, args=(p.stdout, out, max_out, True), daemon=True),
               threading.Thread(target=pump, args=(p.stderr, err, MAX_STDERR, False), daemon=True),
               threading.Thread(target=feed, daemon=True)]
    for t in threads:
        t.start()
    timed_out = False
    try:
        p.wait(timeout=timeout)
    except subprocess.TimeoutExpired:
        timed_out = True
        _kill_tree(p)
        try:
            p.wait(timeout=10)
        except subprocess.TimeoutExpired:
            pass
    for t in threads:
        t.join(timeout=5)
    return Ran(p.returncode, bytes(out[:max_out]), bytes(err[:MAX_STDERR]), timed_out, over.is_set())


_runner: Callable[..., Ran] = _real_run       # tests replace this with a recorder; nothing else does


# ------------------------------------------------------------------ the call
def build_argv(command: list[str], model: str, system: str) -> list[str]:
    if model not in CLAUDE_MODELS:
        raise ValueError("claude_model is haiku, sonnet or opus.")
    if system.startswith("-"):
        system = " " + system                 # a value that starts with a dash would be read as a flag
    return [*command, "-p", "--model", model, "--output-format", "json", "--system-prompt", system,
            "--tools", "", "--strict-mcp-config", "--no-session-persistence"]


def _sentence(text: str, limit: int = 160) -> str:
    s = " ".join(str(text).split())[:limit].rstrip(" .")
    return s


def parse_envelope(stdout: bytes) -> str:
    try:
        env = json.loads(stdout.decode("utf-8", "replace"))
    except ValueError:
        raise ClaudeCliError("The Claude tool did not answer in its JSON shape.") from None
    if not isinstance(env, dict):
        raise ClaudeCliError("The Claude tool did not answer in its JSON shape.")
    if env.get("is_error") is True:
        detail = _sentence(env.get("result") or env.get("subtype") or "")
        raise ClaudeCliError(f"The Claude tool reported an error: {detail}." if detail else "The Claude tool reported an error.")
    result = env.get("result")
    if not isinstance(result, str):
        raise ClaudeCliError("The Claude tool answered without a result.")
    return result


def ask(system: str, user: str, model: str = DEFAULT_CLAUDE_MODEL, workdir: Optional[Path] = None,
        timeout: float = TIMEOUT_S) -> str:
    command = resolve_command()
    if command is None:
        raise ClaudeCliError("The Claude tool is not found on this PC.")
    if not isinstance(system, str) or not isinstance(user, str):
        raise ValueError("system and user are text.")
    if len(system) > MAX_SYSTEM:
        raise ClaudeCliError(f"The system prompt is longer than {MAX_SYSTEM} characters, so it is not sent.")
    argv = build_argv(command, model, system)
    cwd = None
    if workdir is not None:
        Path(workdir).mkdir(parents=True, exist_ok=True)
        cwd = str(workdir)
    try:
        ran = _runner(argv, user.encode("utf-8"), cwd, dict(os.environ), timeout, MAX_STDOUT)
    except OSError:
        raise ClaudeCliError("The Claude tool could not be started.") from None
    if ran.timed_out:
        raise ClaudeCliError(f"The Claude tool took longer than {int(timeout)} seconds and was stopped.")
    if ran.overflow:
        raise ClaudeCliError("The Claude tool answered more than 2 MB, so the answer was dropped.")
    if not ran.stdout.strip():
        raise ClaudeCliError(f"The Claude tool stopped with exit code {ran.returncode} and no answer.")
    return parse_envelope(ran.stdout)


def claude_provider(model: str = DEFAULT_CLAUDE_MODEL, workdir: Optional[Path] = None) -> Provider:
    if model not in CLAUDE_MODELS:
        raise ValueError("claude_model is haiku, sonnet or opus.")

    def run(system: str, user: str) -> str:
        return ask(system, user, model=model, workdir=workdir)
    return run


# ------------------------------------------------------------------ what is on this PC
def _claude_probe() -> bool:
    command = resolve_command()
    if command is None:
        return False
    try:
        ran = _runner([*command, "--version"], b"", None, dict(os.environ), VERSION_TIMEOUT_S, 4096)
    except OSError:
        return False
    return not ran.timed_out and ran.returncode == 0 and bool(ran.stdout.strip())


def _local_probe() -> bool:
    try:
        with urllib.request.urlopen(LOCAL_URL + "/api/version", timeout=2) as r:
            return r.status == 200
    except (OSError, ValueError):
        return False


_clock: Callable[[], float] = time.monotonic
_cache: dict = {}
_cache_lock = threading.Lock()


def available(refresh: bool = False) -> dict:
    with _cache_lock:
        now = _clock()
        if not refresh and _cache.get("value") is not None and now - _cache["at"] < AVAILABLE_TTL_S:
            return dict(_cache["value"])
        value = {"claude": _claude_probe(), "local": _local_probe()}
        _cache.update(value=value, at=now)
        return dict(value)
