"""Double-click to open JARVIS (no console window).

Run with the project's interpreter:  brain/.venv311_gpu/Scripts/pythonw.exe app/JARVIS.pyw
The Start-menu / Desktop shortcut made by install_shortcut.ps1 does exactly that.

If the interface has never been built, it is built first (needs Node.js), so a
fresh clone opens with one click. Errors go to app/data/launch.log, because a
.pyw has nowhere else to print them.
"""
import os
import shutil
import subprocess
import sys
import traceback
from pathlib import Path

APP = Path(__file__).resolve().parent
sys.path.insert(0, str(APP))
LOG = APP / "data" / "launch.log"


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
    LOG.parent.mkdir(exist_ok=True)
    try:
        ensure_ui()
        from jarvis_app.desktop import main as run
        return run([])
    except Exception:
        LOG.write_text(traceback.format_exc(), encoding="utf-8")
        try:
            import ctypes
            ctypes.windll.user32.MessageBoxW(
                None, f"JARVIS could not start.\n\nDetails were written to:\n{LOG}", "JARVIS", 0x10)
        except Exception:
            pass
        return 1


if __name__ == "__main__":
    sys.exit(main())
