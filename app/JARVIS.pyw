"""Double-click to open JARVIS (no console window).

Run with the project's interpreter:  .venv/Scripts/pythonw.exe app/JARVIS.pyw
The Start-menu / Desktop shortcut made by install_shortcut.ps1 does exactly that.

Things this launcher handles so a double-click always works:
  - pythonw has NO console: sys.stdout and sys.stderr are None. Anything that
    prints, or checks isatty() (uvicorn's logging did, and crashed the first
    shortcut launch), would fail. Both streams go to data/app/jarvis.log instead.
  - A second double-click while JARVIS is open brings the existing window to the
    front instead of starting a second server and a second set of sensors.
  - If the interface has never been built, it is built first (needs Node.js).
  - Any failure is written to data/app/launch.log and shown in a message box,
    because a .pyw has nowhere else to say what went wrong.
"""
import json
import os
import shutil
import subprocess
import sys
import traceback
from pathlib import Path

APP = Path(__file__).resolve().parent
DATA = APP / "data"
DATA.mkdir(exist_ok=True)
LOG = DATA / "launch.log"
INSTANCE = DATA / "instance.json"

if sys.stdout is None or sys.stderr is None:          # started by pythonw (shortcut)
    _log = open(DATA / "jarvis.log", "a", encoding="utf-8", buffering=1)
    sys.stdout = sys.stdout or _log
    sys.stderr = sys.stderr or _log

sys.path.insert(0, str(APP))


def message(text: str, error: bool = True) -> None:
    try:
        import ctypes
        ctypes.windll.user32.MessageBoxW(None, text, "JARVIS", 0x10 if error else 0x40)
    except Exception:
        pass


def focus_existing() -> bool:
    """If JARVIS is already running, bring its window forward and return True."""
    try:
        info = json.loads(INSTANCE.read_text(encoding="utf-8"))
    except (FileNotFoundError, json.JSONDecodeError):
        return False
    try:
        import psutil
        if not psutil.pid_exists(int(info.get("pid", -1))):
            return False
    except Exception:
        return False
    try:
        import ctypes
        user32 = ctypes.windll.user32
        hwnd = user32.FindWindowW(None, "JARVIS")
        if not hwnd:
            return False
        user32.ShowWindow(hwnd, 9)                      # SW_RESTORE
        user32.SetForegroundWindow(hwnd)
        return True
    except Exception:
        return False


def ensure_ui() -> None:
    dist = APP / "ui" / "dist" / "index.html"
    if dist.exists():
        return
    npm = shutil.which("npm")
    if npm is None:
        raise RuntimeError("The interface isn't built and Node.js isn't installed (needed once to build it).")
    ui = APP / "ui"
    flags = 0x08000000 if os.name == "nt" else 0          # no console window
    if not (ui / "node_modules").exists():
        subprocess.run([npm, "ci"], cwd=ui, check=True, creationflags=flags)
    subprocess.run([npm, "run", "build"], cwd=ui, check=True, creationflags=flags)


def main() -> int:
    if focus_existing():
        return 0
    try:
        ensure_ui()
        from jarvis_app.desktop import main as run
        INSTANCE.write_text(json.dumps({"pid": os.getpid()}), encoding="utf-8")
        try:
            return run([])
        finally:
            try:
                INSTANCE.unlink()
            except FileNotFoundError:
                pass
    except Exception:
        LOG.write_text(traceback.format_exc(), encoding="utf-8")
        message(f"JARVIS could not start.\n\nDetails were written to:\n{LOG}")
        return 1


if __name__ == "__main__":
    sys.exit(main())
