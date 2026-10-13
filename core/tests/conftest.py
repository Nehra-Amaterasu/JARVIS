"""Test setup for JARVIS's core (the agent's tools, the reminder parser, the honesty guard).

The venv's jarvis.pth puts the MAIN checkout's core/ and yaadash/ on sys.path; these
tests must import THIS checkout's code, so its core/, yaadash/ and root go first.

Nothing here talks to Ollama, the app, MQTT or the real memory: the agent is imported
with stand-in memory modules and driven by a scripted fake model (test_agent_tools.py).
"""
import os
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
for _p in (str(ROOT), str(ROOT / "yaadash"), str(ROOT / "core")):
    while _p in sys.path:
        sys.path.remove(_p)
    sys.path.insert(0, _p)

# core/room.py connects to an MQTT broker at import and publishes RETAINED state on
# every change; the ESP32 firmware switches mains relays on those topics (ROADMAP F5).
# A test must never reach a real broker, so paho is made unimportable here.
for _m in ("paho", "paho.mqtt", "paho.mqtt.client"):
    sys.modules[_m] = None

os.environ["JARVIS_DATA_DIR"] = tempfile.mkdtemp(prefix="jarvis-core-test-")
# What JARVIS learned from his chats (yaadash/chat_memory.py): a scratch folder, never the real one.
os.environ["JARVIS_LEARNED_DIR"] = tempfile.mkdtemp(prefix="jarvis-core-learned-")
os.environ.pop("JARVIS_API_URL", None)          # the agent must not find a running app
os.environ.pop("JARVIS_API_TOKEN", None)
os.environ.pop("JARVIS_T2_ENABLED", None)


import pytest  # noqa: E402


@pytest.fixture(autouse=True)
def _fresh_corrections():
    """Each test is its own conversation: corrections said in one never mute another."""
    from tools import honesty
    honesty.forget_recent()
    yield
