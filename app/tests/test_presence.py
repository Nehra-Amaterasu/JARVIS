"""Phone presence from the LAN (jarvis_app/presence.py), on synthetic Windows output.

The fake network below prints exactly the shapes Windows prints (checked against this
laptop's arp -a, netsh neighbour table and ping on 2026-10-12, addresses invented)."""
import pytest

from jarvis_app.presence import (Phone, PresenceChecker, check_ip, is_randomised, normalise_mac,
                                 parse_arp, parse_neighbors, ping_replied)

ME = "192.168.1.5"
PAPA = "3a-11-22-33-44-55"      # a fixed private (randomised) MAC
MAA = "8c-aa-bb-cc-dd-ee"


def arp_text(rows, iface=ME):
    out = [f"\r\nInterface: {iface} --- 0x3\r\n", "  Internet Address      Physical Address      Type\r\n"]
    for ip, mac in rows:
        out.append(f"  {ip:<20}  {mac}     dynamic   \r\n")
    out += [f"  192.168.1.255         ff-ff-ff-ff-ff-ff     static    \r\n",
            f"  224.0.0.22            01-00-5e-00-00-16     static    \r\n",
            f"  239.255.255.250       01-00-5e-7f-ff-fa     static    \r\n"]
    return "".join(out)


def netsh_text(rows):
    out = ["\r\nInterface 1: Loopback Pseudo-Interface 1\r\n\r\n\r\n",
           "Internet Address                              Physical Address   Type\r\n",
           "--------------------------------------------  -----------------  -----------\r\n",
           "224.0.0.22                                                       Permanent \r\n",
           "\r\nInterface 3: Wi-Fi\r\n\r\n\r\n",
           "Internet Address                              Physical Address   Type\r\n",
           "--------------------------------------------  -----------------  -----------\r\n"]
    for ip, mac, state in rows:
        out.append(f"{ip:<46}{mac or 'Unreachable':<19}{state} \r\n")
    return "".join(out)


REPLY = ("\r\nPinging {ip} with 32 bytes of data:\r\nReply from {ip}: bytes=32 time=4ms TTL=64\r\n\r\n"
         "Ping statistics for {ip}:\r\n    Packets: Sent = 1, Received = 1, Lost = 0 (0% loss),\r\n")
DEAD = ("\r\nPinging {ip} with 32 bytes of data:\r\nReply from " + ME + ": Destination host unreachable.\r\n\r\n"
        "Ping statistics for {ip}:\r\n    Packets: Sent = 1, Received = 1, Lost = 0 (0% loss),\r\n")
TIMEOUT = "\r\nPinging {ip} with 32 bytes of data:\r\nRequest timed out.\r\n"


class FakeLan:
    """Devices by IP. A device answers ping if `ping`, answers ARP if `present`.
    The ARP cache keeps an entry after its device leaves (that is what Stale means)."""

    def __init__(self):
        self.devices = {}          # ip -> dict(mac, present, ping)
        self.cache = {}            # ip -> mac   (what arp -a shows)
        self.reachable = set()     # ips that answered ARP since the last ping round
        self.calls = []

    def add(self, ip, mac, present=True, ping=True, cached=True):
        self.devices[ip] = {"mac": mac, "present": present, "ping": ping}
        if cached:
            self.cache[ip] = mac
            if present:
                self.reachable.add(ip)

    def leave(self, ip):
        self.devices[ip]["present"] = False
        self.reachable.discard(ip)

    def __call__(self, cmd):
        self.calls.append(tuple(cmd))
        if cmd[0] == "arp":
            return arp_text(sorted(self.cache.items()))
        if cmd[0] == "netsh":
            rows = []
            for ip in sorted(self.cache):
                rows.append((ip, self.cache[ip], "Reachable" if ip in self.reachable else "Stale"))
            return netsh_text(rows)
        if cmd[0] == "ping":
            ip = cmd[-1]
            d = self.devices.get(ip)
            if d and d["present"]:
                self.cache[ip] = d["mac"]           # the ping resolved it
                self.reachable.add(ip)
                return (REPLY if d["ping"] else TIMEOUT).format(ip=ip)
            if ip in self.cache:
                self.reachable.discard(ip)
            return DEAD.format(ip=ip)
        raise AssertionError(f"unexpected command {cmd}")


# ------------------------------------------------------------------ parsing
def test_arp_parsing_windows_format():
    text = arp_text([("192.168.1.1", "a0-b1-c2-d3-e4-f5"), ("192.168.1.23", PAPA)])
    rows = parse_arp(text)
    assert [(r.ip, r.mac, r.kind, r.interface) for r in rows] == [
        ("192.168.1.1", "a0-b1-c2-d3-e4-f5", "dynamic", ME),
        ("192.168.1.23", PAPA, "dynamic", ME)]          # broadcast + multicast rows dropped


def test_arp_parsing_two_interfaces_and_localised_headers():
    text = ("\r\nSchnittstelle: 10.0.0.2 --- 0x7\r\n  Internetadresse  Physische Adresse  Typ\r\n"
            "  10.0.0.9              10-22-33-44-55-66     dynamisch \r\n"
            "  10.0.0.10             11-22-33-44-55-66     dynamisch \r\n"     # odd first octet: multicast
            + arp_text([("192.168.1.40", MAA)]))
    rows = parse_arp(text)
    assert [(r.ip, r.mac) for r in rows] == [("10.0.0.9", "10-22-33-44-55-66"), ("192.168.1.40", MAA)]
    assert rows[0].kind == "dynamic"                  # "dynamisch" read as dynamic
    assert rows[1].interface == ME


def test_neighbour_table_states_and_unreachable_rows():
    rows = parse_neighbors(netsh_text([("192.168.1.1", "a0-b1-c2-d3-e4-f5", "Reachable"),
                                       ("192.168.1.23", PAPA, "Stale"),
                                       ("192.168.1.99", None, "Unreachable")]))
    by_ip = {r.ip: r for r in rows}
    assert by_ip["192.168.1.1"].kind == "Reachable" and by_ip["192.168.1.23"].kind == "Stale"
    assert by_ip["192.168.1.99"].mac is None and by_ip["192.168.1.99"].kind == "Unreachable"
    assert by_ip["224.0.0.22"].kind == "Permanent" and by_ip["224.0.0.22"].mac is None


def test_only_a_ttl_line_is_a_ping_reply():
    assert ping_replied(REPLY.format(ip="192.168.1.23"))
    # Windows exits 0 for this one (measured): the reply comes from this PC itself.
    assert not ping_replied(DEAD.format(ip="192.168.1.23"))
    assert not ping_replied(TIMEOUT.format(ip="192.168.1.23"))
    assert ping_replied("Antwort von 192.168.1.23: Bytes=32 Zeit=3ms TTL=64")   # German Windows


def test_mac_and_ip_validation():
    assert normalise_mac("3A:11:22:33:44:55") == PAPA
    assert normalise_mac("3a1122334455") == PAPA
    for bad in ("3a:11:22:33:44", "zz-11-22-33-44-55", "ff-ff-ff-ff-ff-ff", "01-00-5e-00-00-16", "3a-11:22-33-44-55"):
        with pytest.raises(ValueError):
            normalise_mac(bad)
    assert check_ip(" 192.168.1.23 ") == "192.168.1.23"
    for bad in ("8.8.8.8", "127.0.0.1", "192.168.1.255", "192.168.1.0", "fe80::1", "hello", "224.0.0.1"):
        with pytest.raises(ValueError):
            check_ip(bad)
    assert is_randomised(PAPA) and not is_randomised(MAA)


def test_phone_needs_a_name_and_an_address():
    with pytest.raises(ValueError):
        Phone.parse({"name": "", "mac": PAPA})
    with pytest.raises(ValueError):
        Phone.parse({"name": "Papa"})
    p = Phone.parse({"name": "Papa", "mac": "3A:11:22:33:44:55"})
    assert p.key == PAPA and p.ip is None


# ------------------------------------------------------------------ the checker
class Clock:
    def __init__(self, t=1_000_000.0):
        self.t = t

    def __call__(self):
        return self.t


def test_ping_reply_is_a_sighting_and_a_stale_arp_entry_is_not():
    lan, clock = FakeLan(), Clock()
    lan.add("192.168.1.23", PAPA)
    chk = PresenceChecker([Phone("Papa", PAPA)], run=lan, clock=clock)
    r = chk.check()
    assert r.ok and r.seen == [PAPA]
    st = chk.states[PAPA]
    assert st.evidence == "ping" and st.ip_now == "192.168.1.23" and st.last_seen == clock.t
    # He leaves. arp -a still lists his phone as "dynamic" (Stale), and that must not count.
    lan.leave("192.168.1.23")
    clock.t += 60
    r = chk.check()
    assert r.ok and r.seen == []
    assert "192.168.1.23" in lan.cache                       # still in arp -a …
    assert chk.states[PAPA].last_seen == clock.t - 60        # … but not seen


def test_a_phone_that_ignores_ping_is_seen_through_the_neighbour_table():
    lan = FakeLan()
    lan.add("192.168.1.40", MAA, ping=False)          # dozing: no echo reply, answers ARP
    chk = PresenceChecker([Phone("Maa", MAA)], run=lan, clock=Clock())
    assert chk.check().seen == [MAA]
    assert chk.states[MAA].evidence == "arp-reachable"


def test_an_ip_given_to_another_device_is_not_the_phone():
    lan = FakeLan()
    lan.add("192.168.1.23", "c0-ff-ee-00-00-01")      # DHCP gave Papa's old address to the TV
    chk = PresenceChecker([Phone("Papa", PAPA, "192.168.1.23")], run=lan, clock=Clock())
    r = chk.check()
    assert r.seen == [] and chk.states[PAPA].last_seen is None


def test_ip_only_phone_counts_on_any_reply():
    lan = FakeLan()
    lan.add("192.168.1.23", PAPA, cached=False)
    chk = PresenceChecker([Phone("Papa", None, "192.168.1.23")], run=lan, clock=Clock())
    assert chk.check().seen == ["192.168.1.23"]


def test_mac_only_phone_not_in_the_cache_is_found_by_a_sweep():
    lan, clock = FakeLan(), Clock()
    lan.add("192.168.1.1", "a0-b1-c2-d3-e4-f5")       # the router: gives the interface a dynamic row
    lan.add("192.168.1.77", PAPA, cached=False)       # this PC has never talked to the phone
    chk = PresenceChecker([Phone("Papa", PAPA)], run=lan, clock=clock)
    r = chk.check()
    assert r.seen == [PAPA] and "subnet sweep" in r.method
    pings = [c for c in lan.calls if c[0] == "ping"]
    assert len(pings) == 254 and all(c[4] == "300" for c in pings[:253])   # the sweep's short wait
    assert pings[-1][4] == "1000"                                           # then the phone itself
    # The next check knows the address: no second sweep.
    lan.calls.clear()
    clock.t += 30
    assert chk.check().seen == [PAPA]
    assert len([c for c in lan.calls if c[0] == "ping"]) == 1


def test_sweep_is_rate_limited_and_can_be_turned_off():
    lan, clock = FakeLan(), Clock()
    lan.add("192.168.1.1", "a0-b1-c2-d3-e4-f5")
    chk = PresenceChecker([Phone("Papa", PAPA)], run=lan, clock=clock, sweep=False)
    r = chk.check()
    assert r.ok and r.seen == [] and not any(c[0] == "ping" for c in lan.calls)
    assert chk.states[PAPA].evidence.startswith("address unknown")


def test_a_broken_tool_is_reported_not_raised():
    def broken(cmd):
        raise FileNotFoundError("arp")
    chk = PresenceChecker([Phone("Papa", PAPA)], run=broken, clock=Clock())
    r = chk.check()
    assert not r.ok and "FileNotFoundError" in r.error


def test_no_phones_runs_no_command():
    calls = []
    chk = PresenceChecker([], run=lambda c: calls.append(c) or "", clock=Clock())
    assert chk.check().ok and calls == []


def test_changing_the_list_keeps_last_seen():
    lan, clock = FakeLan(), Clock()
    lan.add("192.168.1.23", PAPA)
    chk = PresenceChecker([Phone("Papa", PAPA)], run=lan, clock=clock)
    chk.check()
    chk.set_phones([Phone("Papa (new name)", PAPA), Phone("Maa", MAA)])
    assert chk.states[PAPA].last_seen == clock.t and chk.states[MAA].last_seen is None
    assert not chk.all_verified()
    snap = {p["key"]: p for p in chk.snapshot(clock.t + 10, 900)}
    assert snap[PAPA]["home"] and snap[PAPA]["seen_ago_s"] == 10 and snap[PAPA]["randomised_mac"]
    assert not snap[MAA]["home"] and snap[MAA]["seen_ago_s"] is None
