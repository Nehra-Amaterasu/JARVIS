"""Family phones on the home Wi-Fi: is anybody home, judged from the LAN alone.

Away mode (away.py, SIH 2022 DR729) needs to know when the family is out without
asking anyone and without a camera. A phone on the home Wi-Fi is the proxy: people
carry them, and a phone that has not been seen for a while has left with its owner.

Only tools that ship with Windows are used, and nothing is installed:

  ping <ip>                                a reply line carries "TTL=". Windows also
                                           prints "Reply from <this PC>: Destination
                                           host unreachable" for a dead address; that
                                           is not a reply, and the exit code cannot
                                           tell them apart (measured: exit 0 for an
                                           unused address on this LAN at -w 1000).
  netsh interface ipv4 show neighbors      the neighbour table with its STATE.
                                           "Reachable" means the address answered an
                                           ARP request in the last ~30 s — which a
                                           dozing phone does even when it ignores ping.
  arp -a                                   the IP <-> MAC table. Used to find a phone's
                                           current IP from its MAC (DHCP moves it).

An `arp -a` entry on its own is NOT a sighting. It lists Stale entries as "dynamic"
too: measured on this laptop (2026-10-12), arp -a showed 2 dynamic entries that the
neighbour table called 1 Reachable and 1 Stale. A phone that left an hour ago can
still sit in it.

Which way to lean when the evidence is ambiguous: towards "home". A wrong "home"
only delays arming; a wrong "away" arms the house around the family. So a ping
reply counts unless the ARP table positively says the address now belongs to a
different MAC (DHCP gave the phone's old address to the TV).

Phones randomise their Wi-Fi MAC. This works only with a FIXED per-network address:
iPhone: Wi-Fi > (i) > Private Wi-Fi Address = Fixed (not Rotating); Android: Wi-Fi >
network > Privacy > "Use device MAC" or a per-network randomised MAC that is kept.

Privacy: last-seen times live in memory only. No history of who came and went is
written anywhere, and nothing about a phone is published on the event bus.
"""
from __future__ import annotations

import ipaddress
import re
import subprocess
import sys
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field
from typing import Callable, Iterable, Optional

CREATE_NO_WINDOW = 0x08000000           # no console window flashing up on Windows
MAX_PHONES = 12

_MAC = re.compile(r"^[0-9a-f]{2}([-:]?)[0-9a-f]{2}(\1[0-9a-f]{2}){4}$", re.I)
_ARP_IFACE = re.compile(r"^\s*Interface:\s*(\d{1,3}(?:\.\d{1,3}){3})", re.I)
_ARP_ROW = re.compile(r"^\s*(\d{1,3}(?:\.\d{1,3}){3})\s+([0-9a-f]{2}(?:-[0-9a-f]{2}){5})\s+(\w+)", re.I)
_IPV4 = re.compile(r"^\d{1,3}(?:\.\d{1,3}){3}$")


# ------------------------------------------------------------------ validation
def normalise_mac(s: str) -> str:
    """'AA:BB:CC:DD:EE:FF', 'aa-bb-…' or 'aabbccddeeff' -> 'aa-bb-cc-dd-ee-ff' (the
    form Windows prints). Raises ValueError for anything else."""
    t = (s or "").strip().lower()
    if not _MAC.match(t):
        raise ValueError(f"not a MAC address: {s!r}")
    hexes = re.sub(r"[-:]", "", t)
    mac = "-".join(hexes[i:i + 2] for i in range(0, 12, 2))
    if mac in ("00-00-00-00-00-00", "ff-ff-ff-ff-ff-ff") or int(hexes[1], 16) & 1:
        raise ValueError(f"{s!r} is a broadcast/multicast address, not a phone")
    return mac


def check_ip(s: str) -> str:
    """A private (home-LAN) IPv4 address, or ValueError. Away mode pings these, so a
    public address — someone else's machine — is refused."""
    try:
        ip = ipaddress.ip_address((s or "").strip())
    except ValueError:
        raise ValueError(f"not an IP address: {s!r}") from None
    if ip.version != 4 or not ip.is_private or ip.is_loopback or ip.is_multicast \
            or ip.is_link_local or ip.is_unspecified or str(ip).endswith((".255", ".0")):
        raise ValueError(f"{s!r} is not a home-network address (expected e.g. 192.168.1.23)")
    return str(ip)


def is_randomised(mac: str) -> bool:
    """Locally administered (the second hex digit is 2, 6, A or E): a phone's private
    Wi-Fi address rather than its factory one. Fine if it is FIXED for this network."""
    return bool(int(mac[1], 16) & 2)


@dataclass
class Phone:
    name: str
    mac: Optional[str] = None
    ip: Optional[str] = None

    @property
    def key(self) -> str:
        return self.mac or self.ip or self.name

    @staticmethod
    def parse(d: dict) -> "Phone":
        name = str(d.get("name") or "").strip()[:40]
        if not name:
            raise ValueError("a phone needs a name (whose phone is it?)")
        mac = normalise_mac(d["mac"]) if d.get("mac") else None
        ip = check_ip(d["ip"]) if d.get("ip") else None
        if not mac and not ip:
            raise ValueError(f"{name}: give the phone's MAC address, its IP, or both")
        return Phone(name, mac, ip)

    def to_dict(self) -> dict:
        return {"name": self.name, "mac": self.mac, "ip": self.ip}


# ------------------------------------------------------------------ parsing
@dataclass
class Neighbor:
    ip: str
    mac: Optional[str]
    kind: str                       # arp: dynamic | static ; netsh: Reachable | Stale | ...
    interface: Optional[str] = None


def parse_arp(text: str) -> list[Neighbor]:
    """`arp -a` (Windows). Header words are localised, so rows are recognised by
    shape (IP, MAC, type) and interface lines by "Interface: <ip>". Broadcast and
    multicast rows are dropped — they are never a phone."""
    out, iface = [], None
    for line in (text or "").splitlines():
        m = _ARP_IFACE.match(line)
        if m:
            iface = m.group(1)
            continue
        m = _ARP_ROW.match(line)
        if not m:
            continue
        ip, mac, kind = m.group(1), m.group(2).lower(), m.group(3).lower()
        if mac == "ff-ff-ff-ff-ff-ff" or int(mac[1], 16) & 1 or ip.endswith(".255"):
            continue
        if kind.startswith(("dyn", "din")):         # dynamisch, dynamique, dinámico …
            kind = "dynamic"
        out.append(Neighbor(ip, mac, kind, iface))
    return out


def parse_neighbors(text: str) -> list[Neighbor]:
    """`netsh interface ipv4 show neighbors`. A row is "<ip> <mac or blank or
    'Unreachable'> <state>"; the state is the LAST word. Only English state names
    are understood — on a localised Windows nothing reads as Reachable and the
    checker falls back to ping replies, which is the safe direction."""
    out, iface = [], None
    for line in (text or "").splitlines():
        s = line.strip()
        if s.lower().startswith("interface"):
            iface = s
            continue
        parts = s.split()
        if len(parts) < 2 or not _IPV4.match(parts[0]):
            continue
        mac = parts[1].lower() if len(parts) >= 3 and re.match(r"^[0-9a-f]{2}(-[0-9a-f]{2}){5}$", parts[1], re.I) else None
        out.append(Neighbor(parts[0], mac, parts[-1], iface))
    return out


def ping_replied(text: str) -> bool:
    """A real echo reply carries "TTL=" in every Windows language; "Destination host
    unreachable" (sent by this PC itself) does not."""
    return "ttl=" in (text or "").lower()


# ------------------------------------------------------------------ running commands
def run_command(cmd: list[str], timeout: float = 6.0) -> str:
    """Run a built-in Windows tool (list args, never a shell) and return its stdout."""
    kw = {"creationflags": CREATE_NO_WINDOW} if sys.platform == "win32" else {}
    p = subprocess.run(cmd, capture_output=True, timeout=timeout, **kw)
    return p.stdout.decode("utf-8", "replace")


def _subnet_hosts(iface_ips: Iterable[str]) -> list[str]:
    """Every address of each interface's /24, for the sweep that finds a phone whose
    IP is not known yet. Private /24s only."""
    hosts: list[str] = []
    for ip in iface_ips:
        try:
            net = ipaddress.ip_network(f"{ip}/24", strict=False)
        except ValueError:
            continue
        if not net.is_private:
            continue
        hosts += [str(h) for h in net.hosts() if str(h) != ip]
    return hosts


# ------------------------------------------------------------------ the checker
@dataclass
class Sighting:
    seen: bool
    evidence: str                    # "ping" | "arp-reachable" | why not
    ip: Optional[str] = None


@dataclass
class PhoneState:
    phone: Phone
    last_seen: Optional[float] = None
    evidence: Optional[str] = None
    ip_now: Optional[str] = None
    prev_seen: Optional[float] = None    # last_seen before the latest check (for "returned")
    seen_in_last_check: bool = False


@dataclass
class CheckResult:
    at: float
    ok: bool
    error: Optional[str] = None
    seen: list[str] = field(default_factory=list)   # phone keys seen in this check
    method: str = ""


class PresenceChecker:
    """Who of the listed phones is on the Wi-Fi now, and when each was last seen.

    `run` is how commands are executed (a fake in tests); `clock` is time.time.
    """

    PING_TIMEOUT_MS = 1000
    # The sweep only needs the ARP entries a ping creates, not the replies, so it
    # waits less: measured 0.25 s per dead address at -w 300 (1.00 s at -w 1000), so
    # a /24 with 32 workers takes ~2-3 s.
    SWEEP_TIMEOUT_MS = 300
    SWEEP_WORKERS = 32
    SWEEP_EVERY_S = 300.0

    def __init__(self, phones: list[Phone], run: Callable[[list[str]], str] = run_command,
                 clock: Callable[[], float] = time.time, ping: bool = True, sweep: bool = True,
                 workers: int = 16):
        self.run, self.clock, self.ping, self.sweep, self.workers = run, clock, ping, sweep, workers
        self.started_at = clock()
        self.states: dict[str, PhoneState] = {}
        self.last: Optional[CheckResult] = None
        self._last_sweep = float("-inf")
        self._lock = threading.Lock()
        self.set_phones(phones)

    # ------------------------------------------------------------ config
    def set_phones(self, phones: list[Phone]) -> None:
        """Replace the list; a phone that stays keeps its last-seen time."""
        with self._lock:
            old = self.states
            self.states = {}
            for p in phones:
                st = old.get(p.key) or PhoneState(p)
                st.phone = p
                self.states[p.key] = st

    @property
    def phones(self) -> list[Phone]:
        return [s.phone for s in self.states.values()]

    # ------------------------------------------------------------ one check
    def _ping_all(self, ips: list[str], timeout_ms: Optional[int] = None,
                  workers: Optional[int] = None) -> set[str]:
        if not ips:
            return set()
        wait = str(timeout_ms or self.PING_TIMEOUT_MS)

        def one(ip: str) -> Optional[str]:
            try:
                out = self.run(["ping", "-n", "1", "-w", wait, ip])
            except Exception:
                return None
            return ip if ping_replied(out) else None
        with ThreadPoolExecutor(max_workers=min(workers or self.workers, len(ips))) as ex:
            return {ip for ip in ex.map(one, ips) if ip}

    def _tables(self) -> tuple[list[Neighbor], list[Neighbor]]:
        arp = parse_arp(self.run(["arp", "-a"]))
        try:
            neigh = parse_neighbors(self.run(["netsh", "interface", "ipv4", "show", "neighbors"]))
        except Exception:
            neigh = []                      # ping replies still work without it
        return arp, neigh

    @staticmethod
    def _mac_at(ip: str, arp: list[Neighbor], neigh: list[Neighbor]) -> Optional[str]:
        for n in arp + neigh:
            if n.ip == ip and n.mac:
                return n.mac
        return None

    def _candidates(self, p: Phone, arp: list[Neighbor], neigh: list[Neighbor]) -> list[str]:
        ips = [p.ip] if p.ip else []
        if p.mac:
            ips += [n.ip for n in arp + neigh if n.mac == p.mac and n.ip not in ips]
        return ips

    def check(self) -> CheckResult:
        """Ping each phone's known address(es), then read the ARP and neighbour
        tables and decide who answered. Never raises: a broken check is reported
        (ok=False), and away mode refuses to arm itself on a broken check."""
        now = self.clock()
        if not self.states:
            self.last = CheckResult(now, True, None, [], "no phones listed")
            return self.last
        try:
            arp, neigh = self._tables()
            phones = self.phones
            # A phone listed by MAC whose address no table knows yet: sweep the
            # Wi-Fi's /24 once in a while so its ARP entry appears. Only interfaces
            # with real (dynamic) neighbours — not a VM's virtual adapter.
            unknown = [p for p in phones if not self._candidates(p, arp, neigh)]
            swept = False
            if unknown and self.sweep and self.ping and now - self._last_sweep >= self.SWEEP_EVERY_S:
                self._last_sweep = now
                lans = sorted({n.interface for n in arp if n.interface and n.kind == "dynamic"})
                self._ping_all(_subnet_hosts(lans), self.SWEEP_TIMEOUT_MS, self.SWEEP_WORKERS)
                arp, neigh = self._tables()
                swept = True
            cands = {p.key: self._candidates(p, arp, neigh) for p in phones}
            replied = self._ping_all(sorted({ip for ips in cands.values() for ip in ips})) if self.ping else set()
            if replied:
                arp, neigh = self._tables()         # the pings refreshed them
            reachable = {n.ip: n.mac for n in neigh if n.kind.lower() == "reachable"}
            seen = []
            with self._lock:
                for p in phones:
                    st = self.states.get(p.key)
                    if st is None:
                        continue
                    s = self._decide(p, cands[p.key], replied, reachable, arp, neigh)
                    st.prev_seen = st.last_seen
                    st.seen_in_last_check = s.seen
                    if s.seen:
                        st.last_seen, st.evidence, st.ip_now = now, s.evidence, s.ip
                        seen.append(p.key)
                    elif st.last_seen is None:
                        st.evidence = s.evidence
            method = ("ping + " if self.ping else "") + "neighbour table" + (" + subnet sweep" if swept else "")
            self.last = CheckResult(now, True, None, seen, method)
        except Exception as e:                      # arp missing, timeout, …
            self.last = CheckResult(now, False, f"{type(e).__name__}: {e}", [], "")
        return self.last

    def _decide(self, p: Phone, ips: list[str], replied: set[str], reachable: dict,
                arp: list[Neighbor], neigh: list[Neighbor]) -> Sighting:
        if not ips:
            return Sighting(False, "address unknown: not in this PC's ARP table yet")
        for ip in ips:
            mac_now = self._mac_at(ip, arp, neigh)
            if p.mac and mac_now and mac_now != p.mac:
                continue                            # that address is another device now
            if ip in replied:
                return Sighting(True, "ping", ip)
            if ip in reachable and (not p.mac or reachable[ip] in (None, p.mac)):
                return Sighting(True, "arp-reachable", ip)
        return Sighting(False, "no answer")

    # ------------------------------------------------------------ questions
    def seen_within(self, key: str, seconds: float, now: float) -> bool:
        st = self.states.get(key)
        return bool(st and st.last_seen is not None and now - st.last_seen <= seconds)

    def all_verified(self) -> bool:
        """Every listed phone has been seen at least once since JARVIS started."""
        return bool(self.states) and all(s.last_seen is not None for s in self.states.values())

    def snapshot(self, now: float, home_window_s: float) -> list[dict]:
        out = []
        for st in self.states.values():
            p = st.phone
            ago = None if st.last_seen is None else round(now - st.last_seen, 1)
            out.append({**p.to_dict(), "key": p.key,
                        "last_seen": st.last_seen, "seen_ago_s": ago,
                        "home": ago is not None and ago <= home_window_s,
                        "evidence": st.evidence, "ip_now": st.ip_now,
                        "randomised_mac": bool(p.mac and is_randomised(p.mac))})
        return out
