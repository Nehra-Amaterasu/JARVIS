"""Where everything lives. One place, so nothing hard-codes a path twice.

The layout itself is written down once, in core/home.py; this module adds what only
the app needs (its UI build, its own state folder) on top of it.
"""
from __future__ import annotations

import os
import sys
from pathlib import Path

APP = Path(__file__).resolve().parents[1]          # .../JARVIS/app
REPO = APP.parent                                  # .../JARVIS
CORE = REPO / "core"                               # JARVIS himself (jarvis.py and friends)
YAADASH = REPO / "yaadash"                         # memory modules
DOCS = REPO / "docs"
UI_DIST = APP / "ui" / "dist"
VENV = REPO / ".venv"
VENV_PYTHON = VENV / "Scripts" / "python.exe"
HOME = Path(os.path.expanduser("~"))
DOWNLOADS = HOME / "Downloads"


def ensure_jarvis_importable() -> None:
    """Put core/, yaadash/ and the root (for the aankhen package) on sys.path.

    The venv's jarvis.pth already does this; doing it here too means the app also
    runs under an interpreter that lacks it.
    """
    for p in (str(REPO), str(YAADASH), str(CORE)):
        if p not in sys.path:
            sys.path.insert(0, p)


ensure_jarvis_importable()
import home  # noqa: E402  core/home.py

YAADASH_DATA = home.YAADASH_DATA                   # data/yaadash
LANCEDB = home.LANCEDB                             # data/yaadash/lancedb
# Personal state (Mission progress, transcripts, room state). JARVIS_DATA_DIR points
# a test or dev server somewhere else, so testing never writes into real progress.
DATA = Path(os.environ.get("JARVIS_DATA_DIR") or home.APP_DATA)   # data/app, git-ignored


def core_python() -> str:
    """The interpreter that runs jarvis.py: the project venv, else this one."""
    return str(VENV_PYTHON) if VENV_PYTHON.exists() else sys.executable


DATA.mkdir(parents=True, exist_ok=True)
