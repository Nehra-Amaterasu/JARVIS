"""JARVIS's watchdog: starts the app at login and brings it back if it dies.

    .venv/Scripts/pythonw.exe app/watchdog.pyw [--core voice|text|off] [--always]

The Startup-folder shortcut made by app/install_startup.py runs exactly that. It:
  - holds a single-instance lock (data/app/watchdog.lock): a second watchdog exits at once;
  - starts app/JARVIS.pyw with JARVIS_AUTOSTART_CORE=<--core> (default voice), so the voice
    core starts with the window, and with JARVIS_NO_MESSAGEBOX=1 (an error dialog at 3 am
    would block the restart until someone clicks it);
  - if JARVIS is already open (data/app/instance.json names a live process), watches that
    one instead of starting a second;
  - when the app exits with code 0, the window was closed on purpose: the watchdog stops
    too (--always restarts it anyway). Any other exit is a crash: it is logged to
    data/app/watchdog.log and the app is started again after 10 s, 30 s, 2 min, then 5 min,
    at most 6 times in any hour; past that it waits for the hour to free a slot.
Nothing here needs admin rights, the registry or a scheduled task.
"""
from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
import time
from pathlib import Path
from typing import Callable, Optional

APP = Path(__file__).resolve().parent
sys.path.insert(0, str(APP))
from jarvis_app.backoff import RestartBudget  # noqa: E402  (stdlib only)

DATA = Path(os.environ.get("JARVIS_DATA_DIR") or (APP.parent / "data" / "app"))
LOG = DATA / "watchdog.log"
LOCK = DATA / "watchdog.lock"
INSTANCE = DATA / "instance.json"
DELAYS = (10, 30, 120, 300)
MAX_PER_HOUR = 6
HEALTHY_S = 900


def log(text: str, path: Path = LOG) -> None:
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        with open(path, "a", encoding="utf-8") as f:
            f.write(f"{time.strftime('%Y-%m-%d %H:%M:%S')} {text}\n")
    except OSError:
        pass


def acquire_lock(path: Path = LOCK):
    """An open, locked file (keep it for the process's life), or None when another
    watchdog holds it. The OS drops the lock when the holder dies, crash or not."""
    path.parent.mkdir(parents=True, exist_ok=True)
    f = open(path, "a+")
    try:
        if os.name == "nt":
            import msvcrt
            f.seek(0)
            msvcrt.locking(f.fileno(), msvcrt.LK_NBLCK, 1)
        else:
            import fcntl
            fcntl.flock(f.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
    except OSError:
        f.close()
        return None
    return f


def pythonw() -> str:
    exe = APP.parent / ".venv" / "Scripts" / "pythonw.exe"
    return str(exe) if exe.exists() else sys.executable


def running_instance(path: Path = INSTANCE) -> Optional[int]:
    """The pid of a JARVIS app already running (JARVIS.pyw writes it), else None."""
    try:
        pid = int(json.loads(path.read_text(encoding="utf-8")).get("pid", -1))
    except (OSError, ValueError, TypeError, AttributeError):
        return None
    try:
        import psutil
        if not psutil.pid_exists(pid):
            return None
        name = psutil.Process(pid).name().lower()
        return pid if name.startswith("python") else None
    except Exception:
        return None


def wait_pid(pid: int) -> Optional[int]:
    """Wait for a process this watchdog did not start; its exit code if Windows tells it."""
    try:
        import psutil
        return psutil.Process(pid).wait()
    except Exception:
        return None


class Watchdog:
    def __init__(self, launch: Callable[[], object], core: str = "voice", always: bool = False,
                 budget: Optional[RestartBudget] = None, sleep: Callable[[float], None] = time.sleep,
                 clock: Callable[[], float] = time.time, existing: Callable[[], Optional[int]] = running_instance,
                 wait_existing: Callable[[int], Optional[int]] = wait_pid, say: Callable[[str], None] = log,
                 max_runs: Optional[int] = None):
        self.launch, self.core, self.always = launch, core, always
        self.budget = budget or RestartBudget(DELAYS, MAX_PER_HOUR, HEALTHY_S, clock=clock)
        self.sleep, self.clock, self.existing, self.wait_existing = sleep, clock, existing, wait_existing
        self.say = say
        self.max_runs = max_runs                     # tests stop after this many runs
        self.runs = 0

    def run(self) -> int:
        self.say(f"watchdog started (core={self.core}, always={self.always}, pid {os.getpid()})")
        while self.max_runs is None or self.runs < self.max_runs:
            self.runs += 1
            t0 = self.clock()
            pid = self.existing()
            if pid is not None:
                self.say(f"JARVIS already running (pid {pid}): watching it")
                code = self.wait_existing(pid)
                code = 0 if code is None else code     # not ours and no code: assume he closed it
            else:
                try:
                    proc = self.launch()
                except Exception as e:
                    self.say(f"could not start JARVIS: {e}")
                    code = -1
                else:
                    self.say(f"started JARVIS (pid {getattr(proc, 'pid', '?')})")
                    code = proc.wait()
            ran = self.clock() - t0
            if code == 0 and not self.always:
                self.say(f"JARVIS closed normally after {ran:.0f} s: the watchdog stops too")
                return 0
            delay = self.budget.next_delay(ran)
            if delay is None:
                wait = self.budget.wait_until_allowed()
                self.say(f"JARVIS exited ({code}) after {ran:.0f} s; {self.budget.max_per_hour} restarts this hour "
                         f"already: waiting {wait:.0f} s")
                self.sleep(max(wait, 1.0))
                continue
            self.say(f"JARVIS exited ({code}) after {ran:.0f} s: restarting in {delay:.0f} s")
            self.sleep(delay)
        return 0


def launcher(core: str) -> Callable[[], subprocess.Popen]:
    def launch() -> subprocess.Popen:
        env = {**os.environ, "JARVIS_NO_MESSAGEBOX": "1", "JARVIS_WATCHDOG": "1"}
        if core in ("voice", "text"):
            env["JARVIS_AUTOSTART_CORE"] = core
        else:
            env.pop("JARVIS_AUTOSTART_CORE", None)
        return subprocess.Popen([pythonw(), str(APP / "JARVIS.pyw")], cwd=str(APP), env=env,
                                creationflags=0x08000000 if os.name == "nt" else 0)
    return launch


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description="Start JARVIS and restart it if it dies.")
    ap.add_argument("--core", choices=("voice", "text", "off"), default="voice",
                    help="start the voice core with the app (default voice)")
    ap.add_argument("--always", action="store_true", help="restart even after a normal close")
    a = ap.parse_args(argv)
    lock = acquire_lock()
    if lock is None:
        log("another watchdog is already running: exiting")
        return 0
    try:
        return Watchdog(launcher(a.core), core=a.core, always=a.always).run()
    finally:
        lock.close()


if __name__ == "__main__":
    sys.exit(main())
