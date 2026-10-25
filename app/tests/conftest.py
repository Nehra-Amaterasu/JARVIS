"""Test setup for the JARVIS app server.

paths.DATA is decided at import time, so the environment variable must be set
BEFORE anything imports jarvis_app: every test writes into a throwaway folder and
never into app/data (real Mission progress, real transcripts).
"""
import ipaddress
import os
import socket
import sys
import tempfile
import warnings
from pathlib import Path

_TMP = tempfile.mkdtemp(prefix="jarvis-test-")
os.environ["JARVIS_DATA_DIR"] = _TMP
os.environ["JARVIS_LEARNED_DIR"] = os.path.join(_TMP, "learned")   # the crew's chat learner: never the real store
os.environ["AANKHEN_HOTPLUG"] = "0"          # never listen to this machine's real serial ports
os.environ["AANKHEN_STREAM"] = "0"           # never record into the real data/aankhen/stream
os.environ["JARVIS_UNO"] = "0"              # never open the real Uno: opening COM8 resets it and drops the relays
os.environ["AANKHEN_NET"] = "0"             # never greet a real ESP32 on the LAN over the Wi-Fi link (UDP)
os.environ["JARVIS_MEDIA_OS"] = "0"          # never open a browser or Spotify, never press a media key
APP = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(APP))
warnings.filterwarnings("ignore", category=DeprecationWarning)

import pytest  # noqa: E402


@pytest.fixture
def data_dir() -> Path:
    return Path(_TMP)


# The rule "tests never call the running app (127.0.0.1:8777) and never reach the LAN"
# was held by environment switches alone (10-23 audit). This makes it a hard failure:
# a connect or a datagram to anything but loopback, or to the live app's port, raises.
LIVE_APP_PORT = 8777
_real_connect, _real_connect_ex, _real_sendto = socket.socket.connect, socket.socket.connect_ex, socket.socket.sendto


def _check(addr) -> None:
    if not isinstance(addr, tuple) or len(addr) < 2:
        return                                          # AF_UNIX and friends
    host, port = str(addr[0]), int(addr[1])
    try:
        loopback = ipaddress.ip_address(host.split("%")[0]).is_loopback
    except ValueError:
        loopback = host == "localhost"
    if not loopback:
        raise OSError(f"test tried to reach {host}:{port}: tests never touch the network")
    if port == LIVE_APP_PORT:
        raise OSError("test tried to reach the running JARVIS app on 127.0.0.1:8777")


def _connect(self, addr):
    _check(addr)
    return _real_connect(self, addr)


def _connect_ex(self, addr):
    _check(addr)
    return _real_connect_ex(self, addr)


def _sendto(self, data, *args):
    _check(args[-1])
    return _real_sendto(self, data, *args)


socket.socket.connect, socket.socket.connect_ex, socket.socket.sendto = _connect, _connect_ex, _sendto
