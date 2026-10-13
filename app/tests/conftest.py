"""Test setup for the JARVIS app server.

paths.DATA is decided at import time, so the environment variable must be set
BEFORE anything imports jarvis_app: every test writes into a throwaway folder and
never into app/data (real Mission progress, real transcripts).
"""
import os
import sys
import tempfile
import warnings
from pathlib import Path

_TMP = tempfile.mkdtemp(prefix="jarvis-test-")
os.environ["JARVIS_DATA_DIR"] = _TMP
os.environ["AANKHEN_HOTPLUG"] = "0"          # never listen to this machine's real serial ports
os.environ["AANKHEN_STREAM"] = "0"           # never record into the real data/aankhen/stream
APP = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(APP))
warnings.filterwarnings("ignore", category=DeprecationWarning)

import pytest  # noqa: E402


@pytest.fixture
def data_dir() -> Path:
    return Path(_TMP)
