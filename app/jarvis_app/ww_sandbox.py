"""A second JARVIS on a copy of the data, for audits and UI work while the real app runs.

    python -m jarvis_app.ww_sandbox [--port 8790] [--token ww-audit] [--fresh]

Why: the desktop app holds port 8777, its token lives only in its process, and its state is his.
Auditing "in the app itself" without touching it means another instance on another port, over a
COPY of data/app and a COPY of the engine inputs, with everything that reaches outside the box
turned off: no phone listener (8778 is the real one's), no Aankhen, no core autostart, no Uno.
Taps in the sandbox land in the copy. The copy is rebuilt with --fresh; otherwise it is reused.
Nothing here is imported by the app.
"""
from __future__ import annotations

import argparse
import os
import shutil
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
REAL_DATA = ROOT / "data" / "app"
REAL_INPUTS = ROOT / "data" / "notes" / "well-wisher" / "engine-inputs.json"
SKIP = {"firmware", "media", "transcripts", "watchdog.lock", "instance.json", "jarvis.log", "health.log",
        "core_crashes.log", "watchdog.log"}


def make_copy(dest: Path, fresh: bool) -> Path:
    if fresh and dest.exists():
        shutil.rmtree(dest)
    if not dest.exists():
        dest.mkdir(parents=True)
        for item in REAL_DATA.iterdir():
            if item.name in SKIP:
                continue
            if item.is_dir():
                shutil.copytree(item, dest / item.name)
            else:
                shutil.copy2(item, dest / item.name)
        if REAL_INPUTS.exists():
            shutil.copy2(REAL_INPUTS, dest / "engine-inputs.json")
    return dest


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description="JARVIS sandbox over a copy of the data")
    ap.add_argument("--port", type=int, default=8790)
    ap.add_argument("--token", default="ww-audit")
    ap.add_argument("--dir", default=str(Path(tempfile.gettempdir()) / "jarvis-ww-sandbox"))
    ap.add_argument("--fresh", action="store_true", help="rebuild the copy")
    a = ap.parse_args(argv)
    copy = make_copy(Path(a.dir), a.fresh)
    os.environ["JARVIS_DATA_DIR"] = str(copy)
    os.environ["JARVIS_ENGINE_INPUTS"] = str(copy / "engine-inputs.json")
    os.environ["JARVIS_PHONE"] = "0"             # never bind the real phone port
    os.environ["JARVIS_AUTOSTART_CORE"] = "0"
    os.environ["JARVIS_UNO"] = "off"
    os.environ["JARVIS_TOKEN"] = a.token
    print(f"sandbox data: {copy}", flush=True)
    from . import desktop
    return desktop.main(["--server-only", "--port", str(a.port), "--token", a.token, "--aankhen", "off"])


if __name__ == "__main__":
    sys.exit(main())
