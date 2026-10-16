"""The ESP32's Wi-Fi link, the app's side: the shared key, where the board is, which link.

THE KEY. 32 random bytes the app makes the first time it starts (secrets.token_bytes),
kept in data/app/esp32_link.json: the app's private data folder, git-ignored, never in
the repository and never in a log or an event. The same bytes go into the board's
secrets.h as LINK_KEY_VALUE; secrets_line() gives that line, and only when asked (a
button, a POST). Both sides show a fingerprint instead, 8 hex characters of
SHA-256("AKN1 fingerprint" | key): equal fingerprints mean equal keys (the board puts
its own in STATUS "net.key").

WHERE THE BOARD IS, in the order the hub greets it (netlink.NetConfig.addresses):
the address typed in the app, the last address the board answered from over Wi-Fi, the
address it reported over USB (board_ctl's board.json), then aankhen.local (mDNS, which
Windows 10+ resolves itself).

WHICH LINK: "auto" (USB when the board is on USB, else Wi-Fi), "usb" or "wifi".

THE FIREWALL. The board's datagrams come to UDP HOST_PORT on the laptop. They usually
pass as answers to the laptop's own HELLO and keepalives, but a Public network profile
or an old "block Python" choice drops them; firewall_command() is the exact rule to run
once in an administrator PowerShell. The app never runs it.
"""
from __future__ import annotations

import ipaddress
import json
import os
import re
import secrets
import threading
import time
from pathlib import Path
from typing import Callable, Optional

from .paths import DATA, ensure_jarvis_importable

ensure_jarvis_importable()
from aankhen import netlink as nl  # noqa: E402

FILE = DATA / "esp32_link.json"
PREFER = ("auto", "usb", "wifi")
MDNS_NAME = "aankhen.local"
_HOSTNAME = re.compile(r"^(?=.{1,63}$)[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.local)?$")


def enabled() -> bool:
    """AANKHEN_NET=0 keeps the hub off the network entirely (the tests: no HELLO ever
    leaves for a real device on the LAN)."""
    return os.environ.get("AANKHEN_NET", "1") != "0"


def firewall_command(port: int = nl.HOST_PORT) -> str:
    """The one inbound rule the link needs, for an ADMIN PowerShell: UDP to this port
    only, from the home network only (LocalSubnet), on Private networks only."""
    return (f'New-NetFirewallRule -DisplayName "JARVIS Aankhen ESP32 link (UDP {port})" -Direction Inbound '
            f'-Protocol UDP -LocalPort {port} -Profile Private -RemoteAddress LocalSubnet -Action Allow')


def check_address(text: str) -> str:
    """A home-network IPv4 address, or a LAN host name (aankhen, aankhen.local). Never an
    address on the internet: the link sends HELLOs there."""
    t = str(text or "").strip().lower()
    try:
        a = ipaddress.IPv4Address(t)
    except ValueError:
        if _HOSTNAME.match(t) and not t.replace(".", "").isdigit():
            return t
        raise ValueError(f"{text!r} is not an IPv4 address or a LAN name like aankhen.local")
    if not a.is_private or a.is_loopback or a.is_unspecified or a.is_multicast:
        raise ValueError(f"{a} is not an address on the home network")
    return str(a)


class Esp32Link:
    def __init__(self, path: Path = FILE, board_ip: Optional[Callable[[], Optional[str]]] = None,
                 clock: Callable[[], float] = time.time):
        self.path = Path(path)
        self.board_ip = board_ip                  # () -> the IP the board reported over USB
        self.clock = clock
        self._lock = threading.Lock()
        self._data = self._load()

    # ------------------------------------------------------------ the file
    def _load(self) -> dict:
        try:
            raw = json.loads(self.path.read_text(encoding="utf-8"))
            return raw if isinstance(raw, dict) else {}
        except (OSError, ValueError):
            return {}

    def _save(self) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        tmp = self.path.with_suffix(".tmp")
        tmp.write_text(json.dumps(self._data, indent=1), encoding="utf-8")
        tmp.replace(self.path)

    # ------------------------------------------------------------ the key
    def key(self, create: bool = True) -> Optional[bytes]:
        """The link key; made (and saved) the first time when `create`."""
        with self._lock:
            hexkey = self._data.get("key")
            if hexkey:
                try:
                    return nl.parse_key(hexkey)
                except ValueError:
                    pass                               # a damaged file: make a new key
            if not create:
                return None
            key = secrets.token_bytes(nl.KEY_SIZE)
            self._data["key"] = key.hex()
            self._data["created"] = self.clock()
            self._save()
            return key

    def fingerprint(self) -> Optional[str]:
        k = self.key(create=False)
        return nl.fingerprint(k) if k else None

    def secrets_line(self) -> str:
        """The line for aankhen/firmware/secrets.h. Shown on request only, never logged."""
        return f'#define LINK_KEY_VALUE "{self.key().hex()}"'

    def new_key(self) -> dict:
        """A fresh key (the old one stops working: flash the new line before using it)."""
        with self._lock:
            self._data.pop("key", None)
        self.key()
        return self.view()

    # ------------------------------------------------------------ where, and which link
    def set(self, address: Optional[str] = None, prefer: Optional[str] = None, clear_address: bool = False) -> dict:
        with self._lock:
            if clear_address:
                self._data.pop("address", None)
            elif address is not None:
                self._data["address"] = check_address(address)
            if prefer is not None:
                if prefer not in PREFER:
                    raise ValueError(f"link must be one of {', '.join(PREFER)}")
                self._data["prefer"] = prefer
            self._save()
        return self.view()

    def note_peer(self, ip: str) -> None:
        """The board answered from `ip`: remember it (written only when it changes)."""
        with self._lock:
            if self._data.get("last_ip") == ip:
                return
            self._data["last_ip"] = ip
            self._data["last_ip_at"] = self.clock()
            self._save()

    def addresses(self) -> list[str]:
        usb_ip = None
        if self.board_ip is not None:
            try:
                usb_ip = self.board_ip()
            except Exception:
                usb_ip = None
        d = self._data
        out = [d.get("address"), d.get("last_ip"), usb_ip, MDNS_NAME]
        return list(dict.fromkeys(a for a in out if a))

    def config(self) -> nl.NetConfig:
        """What the hub reads (hub.net_config) before every start and HELLO round."""
        return nl.NetConfig(key=self.key(create=False), addresses=self.addresses(),
                            prefer=self._data.get("prefer") or "auto",
                            board_port=int(self._data.get("board_port") or nl.BOARD_PORT),
                            host_port=int(self._data.get("host_port") or nl.HOST_PORT))

    def view(self, board_status: Optional[dict] = None) -> dict:
        """Everything the settings card shows. Never the key."""
        cfg = self.config()
        board_fp = ((board_status or {}).get("net") or {}).get("key") if isinstance(board_status, dict) else None
        mine = self.fingerprint()
        return {"configured": cfg.key is not None, "fingerprint": mine, "address": self._data.get("address"),
                "last_ip": self._data.get("last_ip"), "addresses": cfg.addresses, "prefer": cfg.prefer,
                "board_port": cfg.board_port, "host_port": cfg.host_port, "mdns": MDNS_NAME,
                "board_fingerprint": board_fp,
                "key_matches": (board_fp == mine) if board_fp and mine else None,
                "firewall": firewall_command(cfg.host_port),
                "secrets_file": "aankhen/firmware/secrets.h"}
