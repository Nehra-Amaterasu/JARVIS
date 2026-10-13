"""Phone access: JARVIS from his phone, served by the laptop, on the home network only.

OFF unless he switches it on (Connect -> Phone, or JARVIS_PHONE=1). When on, a SECOND
listener opens beside the desktop one; the desktop path (127.0.0.1:<port>, its
per-launch token) is not touched:

    desktop window ──▶ 127.0.0.1:8777   desktop token, every route        (security.py)
    phone (Wi-Fi)  ──▶ <LAN IP>:8778    device cookie, /phone + /api/phone/* only
    Tailscale Serve ─▶ 127.0.0.1:8778   the same rules (HTTPS ends at Tailscale)

Which listener a request came in on is read from the socket it arrived on (ASGI
scope["server"]), never from a header a client can write. On the phone listener:

  * Host must be one of this laptop's LAN addresses (with the port) or an address he
    added (his ts.net name): DNS rebinding cannot reach it.
  * The peer must be a private, loopback or Tailscale (100.64/10) address.
  * Only the phone's routes exist there: /phone, /api/phone/*, /ws/phone, /api/health.
    Memory, transcripts export, Mission data, Away mode, settings: 404.
  * Every /api/phone call needs a paired device's token: an HttpOnly, SameSite=Strict
    cookie (JavaScript on the page cannot read it). Stored hashed (SHA-256 of 256
    random bits) in DATA/phone/devices.json; revoking a device ends it at once,
    including its open socket.
  * Anything that changes something also needs the X-Jarvis-Phone header (a
    cross-site form cannot set it without a CORS preflight, which is never granted)
    and, when the browser sends one, an Origin naming the same host. That is the CSRF
    guard, on top of SameSite=Strict.
  * Pairing: the desktop shows a QR code and an 8-letter code, valid 5 minutes, one
    use, burned after 5 wrong tries; at most 6 tries a minute per address.
  * Rate limits per device: 240 calls a minute in all, 20 voice clips a minute.
"""
from __future__ import annotations

import asyncio
import hashlib
import ipaddress
import json
import os
import re
import secrets
import socket
import threading
import time
from collections import deque
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Optional
from urllib.parse import urlsplit

from .paths import DATA

DIR = DATA / "phone"
CONFIG_FILE = DIR / "config.json"
DEVICES_FILE = DIR / "devices.json"
INBOX = DIR / "inbox"

DEFAULT_PORT = 8778
COOKIE = "jarvis_phone"
COOKIE_MAX_AGE = 365 * 24 * 3600
HEADER = "x-jarvis-phone"
PAIR_TTL_S = 300
PAIR_MAX_FAILS = 5
PAIR_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"      # no 0/O, 1/I/L: read aloud or typed
PAIR_LEN = 8
MAX_DEVICES = 8
NAME_MAX = 40
FIREWALL_RULE = "JARVIS phone"

# Private ranges a phone in the house (or on his tailnet) can come from.
_PRIVATE_NETS = [ipaddress.ip_network(n) for n in (
    "10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16", "100.64.0.0/10", "127.0.0.0/8",
    "fc00::/7", "fe80::/10", "::1/128")]
# Addresses the listener may bind: a home LAN or Tailscale, never a public interface.
_BINDABLE_NETS = [ipaddress.ip_network(n) for n in ("10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16",
                                                    "100.64.0.0/10")]

# Paths the phone listener answers at all; everything else is a 404 there.
PHONE_PATHS = {"/phone", "/phone/", "/phone/app.js", "/phone/manifest.webmanifest", "/phone/icon-192.png",
               "/phone/icon-512.png", "/api/health", "/ws/phone"}
PHONE_API = "/api/phone/"


def firewall_command(port: int) -> str:
    """The one line he runs in an ADMIN PowerShell (the app never touches the firewall)."""
    return (f'New-NetFirewallRule -DisplayName "{FIREWALL_RULE} (TCP {port})" -Direction Inbound '
            f'-Protocol TCP -LocalPort {port} -Action Allow -Profile Private -RemoteAddress LocalSubnet')


def is_private(ip: Optional[str]) -> bool:
    try:
        addr = ipaddress.ip_address((ip or "").split("%")[0])
    except ValueError:
        return False
    if isinstance(addr, ipaddress.IPv6Address) and addr.ipv4_mapped:
        addr = addr.ipv4_mapped
    return any(addr in n for n in _PRIVATE_NETS)


def bindable(ip: str) -> bool:
    try:
        addr = ipaddress.ip_address(ip)
    except ValueError:
        return False
    return isinstance(addr, ipaddress.IPv4Address) and any(addr in n for n in _BINDABLE_NETS)


def lan_addresses() -> list[str]:
    """This laptop's IPv4 addresses on a home LAN or Tailscale, Wi-Fi first."""
    try:
        import psutil
        addrs = psutil.net_if_addrs()
        stats = psutil.net_if_stats()
    except Exception:
        return []
    found = []
    for name, entries in addrs.items():
        st = stats.get(name)
        if st is not None and not st.isup:
            continue
        for a in entries:
            if a.family == socket.AF_INET and bindable(a.address):
                wifi = bool(re.search(r"wi-?fi|wlan|wireless", name, re.I))
                found.append((0 if wifi else 1, a.address))
    return [ip for _, ip in sorted(set(found))]


# ---------------------------------------------------------------- settings
@dataclass
class PhoneConfig:
    enabled: bool = False
    port: int = DEFAULT_PORT
    bind: str = "auto"                       # "auto" = every LAN/Tailscale address, or one IPv4
    cert: str = ""                           # optional TLS cert/key (tailscale cert, mkcert)
    key: str = ""
    urls: list = field(default_factory=list)   # extra addresses he reaches it by: https://<name>.ts.net

    @property
    def https(self) -> bool:
        return bool(self.cert and self.key)


def _valid_url(u: str) -> str:
    u = (u or "").strip().rstrip("/")
    p = urlsplit(u)
    if p.scheme not in ("http", "https") or not p.hostname or p.path or p.query or p.fragment \
            or p.username or p.password:
        raise ValueError(f"{u!r} is not an address like https://laptop.tail1234.ts.net")
    return f"{p.scheme}://{p.netloc.lower()}"


def validate(cfg: PhoneConfig) -> PhoneConfig:
    if not isinstance(cfg.port, int) or not 1024 <= cfg.port <= 65535:
        raise ValueError("The phone port must be a number from 1024 to 65535.")
    if cfg.bind != "auto" and not (bindable(cfg.bind) or cfg.bind == "127.0.0.1"):
        raise ValueError("Bind must be 'auto' or one of this laptop's home-network IPv4 addresses.")
    if bool(cfg.cert) != bool(cfg.key):
        raise ValueError("HTTPS needs both the certificate file and its key file.")
    for f in (cfg.cert, cfg.key):
        if f and not Path(f).is_file():
            raise ValueError(f"No file at {f}.")
    cfg.urls = [_valid_url(u) for u in cfg.urls][:6]
    return cfg


def load_config(path: Path = CONFIG_FILE) -> PhoneConfig:
    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
    except (FileNotFoundError, ValueError):
        raw = {}
    cfg = PhoneConfig()
    for k in asdict(cfg):
        if k in raw:
            setattr(cfg, k, raw[k])
    cfg.enabled = bool(cfg.enabled)
    try:
        cfg.port = int(cfg.port)
    except (TypeError, ValueError):
        cfg.port = DEFAULT_PORT
    env_port = os.environ.get("JARVIS_PHONE_PORT", "").strip()
    if env_port.isdigit():
        cfg.port = int(env_port)
    cfg.urls = [u for u in cfg.urls if isinstance(u, str)] if isinstance(cfg.urls, list) else []
    return cfg


def save_config(cfg: PhoneConfig, path: Path = CONFIG_FILE) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".tmp")
    tmp.write_text(json.dumps(asdict(cfg), indent=1), encoding="utf-8")
    tmp.replace(path)


def env_override() -> Optional[bool]:
    """JARVIS_PHONE=1 forces phone access on, =0 forces it off; unset: the saved switch."""
    v = os.environ.get("JARVIS_PHONE", "").strip().lower()
    if v in ("1", "on", "true", "yes"):
        return True
    if v in ("0", "off", "false", "no"):
        return False
    return None


# ---------------------------------------------------------------- devices
def _hash(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def clean_name(name: str) -> str:
    name = re.sub(r"[\x00-\x1f\x7f<>]", "", str(name or "")).strip()
    return name[:NAME_MAX] or "Phone"


class DeviceStore:
    """Paired phones. Only a SHA-256 of each token is kept: the file alone opens nothing."""

    def __init__(self, path: Path = DEVICES_FILE):
        self.path = path
        self._lock = threading.Lock()
        self._devices: dict[str, dict] = {}            # id -> {id, name, hash, created, last_seen}
        self._by_hash: dict[str, str] = {}
        self._dirty_seen = 0.0
        self._load()

    def _load(self) -> None:
        try:
            rows = json.loads(self.path.read_text(encoding="utf-8"))
        except (FileNotFoundError, ValueError):
            rows = []
        for r in rows if isinstance(rows, list) else []:
            if isinstance(r, dict) and r.get("id") and isinstance(r.get("hash"), str) and len(r["hash"]) == 64:
                self._devices[r["id"]] = r
                self._by_hash[r["hash"]] = r["id"]

    def _save(self) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        tmp = self.path.with_suffix(".tmp")
        tmp.write_text(json.dumps(list(self._devices.values()), indent=1), encoding="utf-8")
        tmp.replace(self.path)

    def add(self, name: str) -> tuple[dict, str]:
        token = secrets.token_urlsafe(32)
        with self._lock:
            if len(self._devices) >= MAX_DEVICES:
                raise ValueError(f"{MAX_DEVICES} phones are paired already: remove one on the desktop first.")
            dev = {"id": secrets.token_hex(6), "name": clean_name(name), "hash": _hash(token),
                   "created": time.time(), "last_seen": time.time()}
            self._devices[dev["id"]] = dev
            self._by_hash[dev["hash"]] = dev["id"]
            self._save()
        return self.public(dev), token

    def verify(self, token: Optional[str]) -> Optional[dict]:
        if not token or len(token) > 200:
            return None
        with self._lock:
            did = self._by_hash.get(_hash(token))
            dev = self._devices.get(did) if did else None
            if dev is None:
                return None
            now = time.time()
            dev["last_seen"] = now
            if now - self._dirty_seen > 60:              # last-seen on disk at most once a minute
                self._dirty_seen = now
                self._save()
            return self.public(dev)

    def revoke(self, device_id: str) -> bool:
        with self._lock:
            dev = self._devices.pop(device_id, None)
            if dev is None:
                return False
            self._by_hash.pop(dev["hash"], None)
            self._save()
            return True

    def list(self) -> list[dict]:
        with self._lock:
            return [self.public(d) for d in sorted(self._devices.values(), key=lambda d: d["created"])]

    @staticmethod
    def public(dev: dict) -> dict:
        return {k: dev[k] for k in ("id", "name", "created", "last_seen")}


# ---------------------------------------------------------------- pairing
def normalise_code(code: str) -> str:
    return re.sub(r"[^A-Z0-9]", "", str(code or "").upper())


def format_code(code: str) -> str:
    return f"{code[:4]}-{code[4:]}"


class Pairing:
    """One pairing code at a time, made on the desktop, used once by a phone."""

    def __init__(self, ttl: float = PAIR_TTL_S, clock=time.time):
        self.ttl, self.clock = ttl, clock
        self.code: Optional[str] = None
        self.expires = 0.0
        self.fails = 0
        self._lock = threading.Lock()

    def start(self) -> str:
        with self._lock:
            self.code = "".join(secrets.choice(PAIR_ALPHABET) for _ in range(PAIR_LEN))
            self.expires = self.clock() + self.ttl
            self.fails = 0
            return self.code

    def cancel(self) -> None:
        with self._lock:
            self.code = None

    def active(self) -> bool:
        return self.code is not None and self.clock() < self.expires

    def remaining(self) -> int:
        return max(0, int(self.expires - self.clock())) if self.active() else 0

    def redeem(self, code: str) -> bool:
        """True once for the right code; a wrong one counts towards burning it."""
        given = normalise_code(code)
        with self._lock:
            if self.code is None or self.clock() >= self.expires:
                self.code = None
                return False
            if secrets.compare_digest(given.encode(), self.code.encode()):
                self.code = None
                return True
            self.fails += 1
            if self.fails >= PAIR_MAX_FAILS:
                self.code = None
            return False


class RateLimiter:
    """Sliding window: at most `limit` events per `window` seconds per key."""

    def __init__(self, clock=time.monotonic):
        self.clock = clock
        self._hits: dict[str, deque] = {}
        self._lock = threading.Lock()

    def allow(self, key: str, limit: int, window: float = 60.0) -> bool:
        now = self.clock()
        with self._lock:
            q = self._hits.setdefault(key, deque())
            while q and now - q[0] >= window:
                q.popleft()
            if len(q) >= limit:
                return False
            q.append(now)
            if len(self._hits) > 2000:                    # forget idle keys
                for k in [k for k, v in self._hits.items() if not v]:
                    self._hits.pop(k, None)
            return True


# ---------------------------------------------------------------- the listener
class PhoneServer:
    """A second uvicorn server for the same app, on the app's own event loop.

    Same loop, so the event bus, the WebSocket queues and every service are shared
    exactly as with the desktop listener; lifespan="off", so starting it never boots
    the hub, the Uno or JARVIS a second time.
    """

    def __init__(self, app):
        self.app = app
        self.server = None
        self.task: Optional[asyncio.Task] = None
        self.bound: list[str] = []
        self.error: Optional[str] = None

    @property
    def running(self) -> bool:
        return self.task is not None and not self.task.done() and bool(self.server and self.server.started)

    async def start(self, cfg: PhoneConfig, addresses: list[str]) -> None:
        import uvicorn
        await self.stop()
        self.error = None
        socks, bound = [], []
        for ip in addresses:
            s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
            if hasattr(socket, "SO_EXCLUSIVEADDRUSE"):       # Windows: no one can hijack the port
                s.setsockopt(socket.SOL_SOCKET, socket.SO_EXCLUSIVEADDRUSE, 1)
            try:
                s.bind((ip, cfg.port))
            except OSError as e:
                s.close()
                self.error = f"could not listen on {ip}:{cfg.port}: {e.strerror or e}"
                continue
            s.setblocking(False)
            socks.append(s)
            bound.append(ip)
        if not socks:
            self.error = self.error or "no home-network address to listen on (is Wi-Fi connected?)"
            return
        config = uvicorn.Config(
            self.app, lifespan="off", log_config=None, log_level="warning", ws_ping_interval=20,
            proxy_headers=False, server_header=False, timeout_graceful_shutdown=2,
            ssl_certfile=cfg.cert or None, ssl_keyfile=cfg.key or None)
        try:
            config.load()
        except Exception as e:                               # a bad cert/key: say which
            for s in socks:
                s.close()
            self.error = f"HTTPS could not start: {e}"
            return
        self.server = uvicorn.Server(config)
        self.task = asyncio.create_task(self.server.serve(sockets=socks))
        for _ in range(100):                                 # up to ~2 s
            if self.server.started or self.task.done():
                break
            await asyncio.sleep(0.02)
        if self.task.done():
            exc = self.task.exception() if not self.task.cancelled() else None
            self.error = f"the phone listener stopped: {exc}" if exc else "the phone listener stopped"
            self.task = None
            for s in socks:
                s.close()
            return
        self.bound = bound
        self._socks = socks

    async def stop(self) -> None:
        if self.server is not None:
            self.server.should_exit = True
        if self.task is not None:
            try:
                await asyncio.wait_for(asyncio.shield(self.task), timeout=5)
            except Exception:
                self.task.cancel()
        for s in getattr(self, "_socks", []):
            try:
                s.close()
            except OSError:
                pass
        self._socks = []
        self.server, self.task, self.bound = None, None, []


class PhoneAccess:
    """Everything the phone path needs: the switch, the addresses, the devices, the guard."""

    def __init__(self, desktop_port: int, config_path: Path = CONFIG_FILE, devices_path: Path = DEVICES_FILE):
        self.desktop_port = desktop_port
        self.config_path = config_path
        self.cfg = load_config(config_path)
        self.devices = DeviceStore(devices_path)
        self.pairing = Pairing()
        self.limits = RateLimiter()
        self.server: Optional[PhoneServer] = None
        self.listen = True                       # tests set False: rules without a real socket
        self.addresses_fn = lan_addresses
        self.sockets: dict[str, set] = {}        # device id -> open /ws/phone sockets

    # ------------------------------------------------------------ state
    @property
    def forced(self) -> Optional[bool]:
        return env_override()

    @property
    def enabled(self) -> bool:
        f = self.forced
        return f if f is not None else self.cfg.enabled

    @property
    def port(self) -> int:
        return self.cfg.port

    def addresses(self) -> list[str]:
        """Where the listener binds: every LAN/Tailscale address (or the one chosen),
        plus loopback so Tailscale Serve can forward to it."""
        if self.cfg.bind != "auto":
            ips = [self.cfg.bind]
        else:
            ips = list(self.addresses_fn())
        return ips + (["127.0.0.1"] if "127.0.0.1" not in ips else [])

    def scheme(self) -> str:
        return "https" if self.cfg.https else "http"

    def urls(self) -> list[str]:
        """Base addresses to open on the phone, best first: his own (ts.net), then LAN."""
        lan = [f"{self.scheme()}://{ip}:{self.port}" for ip in self.addresses() if ip != "127.0.0.1"]
        return list(self.cfg.urls) + lan

    def allowed_hosts(self) -> set[str]:
        hosts = {f"{ip}:{self.port}" for ip in self.addresses()} | {f"localhost:{self.port}"}
        for u in self.cfg.urls:
            p = urlsplit(u)
            hosts.add(p.netloc.lower())
            if p.port is None:                    # a proxy may or may not add the default port
                hosts.add(f"{p.hostname}:{443 if p.scheme == 'https' else 80}")
        return hosts

    def is_remote(self, scope) -> bool:
        """True when this request arrived on the phone listener (the socket, not a header)."""
        server = scope.get("server")
        return bool(server) and len(server) > 1 and server[1] == self.port and self.port != self.desktop_port

    # ------------------------------------------------------------ the guard
    def device_for(self, cookies) -> Optional[dict]:
        return self.devices.verify(cookies.get(COOKIE))

    def check(self, *, method: str, path: str, host: Optional[str], client: Optional[str],
              origin: Optional[str], header: Optional[str], cookies) -> tuple[int, str, Optional[dict]]:
        """(status, reason, device) for one request on the phone listener; 200 = allowed."""
        if not self.enabled:
            return 403, "phone access is off", None
        if (host or "").lower() not in self.allowed_hosts():
            return 403, "bad host", None
        if not is_private(client):
            return 403, "not from the home network", None
        if path == "/":
            return 307, "/phone", None
        if not (path in PHONE_PATHS or path.startswith(PHONE_API)):
            return 404, "not here", None
        if not path.startswith(PHONE_API):
            return 200, "", None
        mutating = method not in ("GET", "HEAD", "OPTIONS")
        if mutating or path.startswith(PHONE_API):
            if origin and urlsplit(origin).netloc.lower() != (host or "").lower():
                return 403, "cross-site request refused", None
        if mutating and header != "1":
            return 403, "missing X-Jarvis-Phone header", None
        if path == PHONE_API + "pair":
            if not self.limits.allow(f"pair:{client}", 6):
                return 429, "too many pairing tries: wait a minute", None
            return 200, "", None
        dev = self.device_for(cookies)
        if dev is None:
            return 401, "this phone is not paired", None
        if not self.limits.allow(f"dev:{dev['id']}", 240):
            return 429, "slow down", None
        return 200, "", dev

    def ws_check(self, *, host: Optional[str], client: Optional[str], origin: Optional[str], cookies) -> Optional[dict]:
        if not self.enabled or (host or "").lower() not in self.allowed_hosts() or not is_private(client):
            return None
        if not origin or urlsplit(origin).netloc.lower() != (host or "").lower():
            return None                            # cross-site WebSocket hijacking
        return self.device_for(cookies)

    # ------------------------------------------------------------ listener control
    async def _apply_now(self, app) -> None:
        if self.server is None:
            self.server = PhoneServer(app)
        if self.enabled and self.listen:
            await self.server.start(self.cfg, self.addresses())
        else:
            await self.server.stop()

    async def manage(self, app) -> None:
        """Own the listener for as long as the app runs (started from its lifespan).

        The listener's task must not be created inside a request: the HTTP middleware
        runs each request in a task group that is cancelled once the response is sent,
        and a server started there would die with it. So requests ask, this task does."""
        self._requests = asyncio.Queue()
        try:
            await self._apply_now(app)
            while True:
                fut = await self._requests.get()
                try:
                    await self._apply_now(app)
                    if not fut.done():
                        fut.set_result(None)
                except Exception as e:                   # reported to the caller, never fatal
                    if not fut.done():
                        fut.set_exception(e)
        finally:
            self._requests = None
            if self.server is not None:
                await self.server.stop()

    async def apply(self, app) -> None:
        """Start, restart or stop the listener to match the switch."""
        q = getattr(self, "_requests", None)
        if q is None:                                    # no manager (app not running): do it here
            await self._apply_now(app)
            return
        fut = asyncio.get_running_loop().create_future()
        q.put_nowait(fut)
        await fut

    def update(self, changes: dict) -> PhoneConfig:
        cfg = PhoneConfig(**asdict(self.cfg))
        for k in ("enabled", "port", "bind", "cert", "key", "urls"):
            if k in changes and changes[k] is not None:
                setattr(cfg, k, changes[k])
        cfg.enabled = bool(cfg.enabled)
        cfg.cert, cfg.key = str(cfg.cert or "").strip().strip('"'), str(cfg.key or "").strip().strip('"')
        cfg.bind = str(cfg.bind or "auto").strip()
        if not isinstance(cfg.urls, list):
            raise ValueError("urls must be a list")
        validate(cfg)
        if cfg.port == self.desktop_port:
            raise ValueError(f"Port {cfg.port} is the desktop window's own port: choose another.")
        save_config(cfg, self.config_path)
        self.cfg = cfg
        return cfg

    def view(self) -> dict:
        running = bool(self.server and self.server.running)
        return {
            "enabled": self.enabled, "forced": self.forced, "saved_enabled": self.cfg.enabled,
            "running": running, "listening_on": list(self.server.bound) if running else [],
            "error": self.server.error if self.server else None,
            "port": self.port, "bind": self.cfg.bind, "https": self.cfg.https,
            "cert": self.cfg.cert, "key": self.cfg.key, "urls": self.cfg.urls,
            "addresses": [ip for ip in self.addresses() if ip != "127.0.0.1"],
            "open_at": [u + "/phone" for u in self.urls()],
            "devices": self.devices.list(),
            "pairing": {"active": self.pairing.active(), "expires_in": self.pairing.remaining()},
            "firewall_cmd": firewall_command(self.port),
            "mic_ready": self.cfg.https or any(u.startswith("https://") for u in self.cfg.urls),
        }
