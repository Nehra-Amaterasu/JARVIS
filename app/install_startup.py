"""Start JARVIS at login: a shortcut in the user's Startup folder (shell:startup) that runs
app/watchdog.pyw with the project's pythonw. No registry edits, no scheduled task, no admin.

    .venv\\Scripts\\python.exe app\\install_startup.py              create (or refresh) it
    .venv\\Scripts\\python.exe app\\install_startup.py --remove     delete it
    .venv\\Scripts\\python.exe app\\install_startup.py --dry-run    print what it would do
    --core voice|text|off   what the watchdog starts with the window (default voice)

The shortcut is "%APPDATA%\\Microsoft\\Windows\\Start Menu\\Programs\\Startup\\JARVIS.lnk".
Windows runs everything in that folder when he signs in. Deleting the file (or --remove)
undoes it completely.
"""
from __future__ import annotations

import argparse
import os
import subprocess
import sys
from pathlib import Path
from typing import Callable, Optional

APP = Path(__file__).resolve().parent
REPO = APP.parent
LINK_NAME = "JARVIS.lnk"


def startup_dir(environ=None) -> Path:
    env = os.environ if environ is None else environ
    appdata = env.get("APPDATA")
    if not appdata:
        raise RuntimeError("APPDATA is not set: cannot find the Startup folder")
    return Path(appdata) / "Microsoft" / "Windows" / "Start Menu" / "Programs" / "Startup"


def spec(core: str = "voice", repo: Path = REPO, environ=None) -> dict:
    app = repo / "app"
    return {
        "link": str(startup_dir(environ) / LINK_NAME),
        "target": str(repo / ".venv" / "Scripts" / "pythonw.exe"),
        "arguments": f'"{app / "watchdog.pyw"}" --core {core}',
        "workdir": str(app),
        "icon": str(app / "assets" / "jarvis.ico"),
        "description": "JARVIS - starts at login and comes back if it closes unexpectedly",
    }


def _ps_quote(s: str) -> str:
    return "'" + str(s).replace("'", "''") + "'"


def ps_script(sp: dict) -> str:
    """PowerShell that writes the .lnk through WScript.Shell (the same COM object as
    install_shortcut.ps1)."""
    return "; ".join([
        "$ErrorActionPreference = 'Stop'",
        "$s = (New-Object -ComObject WScript.Shell).CreateShortcut(" + _ps_quote(sp["link"]) + ")",
        "$s.TargetPath = " + _ps_quote(sp["target"]),
        "$s.Arguments = " + _ps_quote(sp["arguments"]),
        "$s.WorkingDirectory = " + _ps_quote(sp["workdir"]),
        "$s.IconLocation = " + _ps_quote(sp["icon"] + ",0"),
        "$s.Description = " + _ps_quote(sp["description"]),
        "$s.Save()",
    ])


def install(sp: dict, run: Callable = subprocess.run) -> Path:
    if not Path(sp["target"]).exists():
        raise RuntimeError(f"the project interpreter is missing: {sp['target']}")
    Path(sp["link"]).parent.mkdir(parents=True, exist_ok=True)
    r = run(["powershell.exe", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command",
             ps_script(sp)], capture_output=True, text=True)
    if getattr(r, "returncode", 1) != 0:
        raise RuntimeError(f"PowerShell could not write the shortcut: {getattr(r, 'stderr', '')}".strip())
    return Path(sp["link"])


def remove(sp: dict) -> bool:
    p = Path(sp["link"])
    if p.exists():
        p.unlink()
        return True
    return False


def main(argv: Optional[list] = None, run: Callable = subprocess.run, environ=None) -> int:
    ap = argparse.ArgumentParser(description="Add (or remove) JARVIS in the Startup folder.")
    ap.add_argument("--remove", action="store_true", help="delete the Startup shortcut")
    ap.add_argument("--dry-run", action="store_true", help="print what would be done, change nothing")
    ap.add_argument("--core", choices=("voice", "text", "off"), default="voice")
    a = ap.parse_args(argv)
    sp = spec(a.core, environ=environ)
    if a.dry_run:
        print(("Would delete: " if a.remove else "Would create: ") + sp["link"])
        if not a.remove:
            print(f"  runs: {sp['target']} {sp['arguments']}\n  in:   {sp['workdir']}")
        return 0
    if a.remove:
        print(("Deleted " if remove(sp) else "Nothing to delete at ") + sp["link"])
        return 0
    try:
        link = install(sp, run)
    except RuntimeError as e:
        print(f"Failed: {e}", file=sys.stderr)
        return 1
    print(f"Created {link}\n  runs: {sp['target']} {sp['arguments']}\n"
          "JARVIS (with its watchdog) now starts when you sign in. Undo: --remove")
    return 0


if __name__ == "__main__":
    sys.exit(main())
