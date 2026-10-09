"""Where everything lives. One place, so nothing hard-codes a path twice."""
from __future__ import annotations

import os
import sys
from pathlib import Path

APP = Path(__file__).resolve().parents[1]          # .../jarvis-room/app
REPO = APP.parent                                  # .../jarvis-room
BRAIN = REPO / "brain"
DOCS = REPO / "docs"
UI_DIST = APP / "ui" / "dist"
DATA = APP / "data"                                # gitignored: settings, mission log
VENV_PYTHON = BRAIN / ".venv311_gpu" / "Scripts" / "python.exe"
HOME = Path(os.path.expanduser("~"))
DOWNLOADS = HOME / "Downloads"


def ensure_brain_importable() -> None:
    """Make brain/ modules (aankhen, yaadash_*) importable from the app."""
    p = str(BRAIN)
    if p not in sys.path:
        sys.path.insert(0, p)


def core_python() -> str:
    """The interpreter that runs jarvis.py: the project venv, else this one."""
    return str(VENV_PYTHON) if VENV_PYTHON.exists() else sys.executable


DATA.mkdir(parents=True, exist_ok=True)
