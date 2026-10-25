"""Is the real board sending CSI? A 20-second check that ends in one PASS or FAIL line.

    .venv\\Scripts\\python.exe -m aankhen.tools.smoke_board            # USB first, then Wi-Fi
    .venv\\Scripts\\python.exe -m aankhen.tools.smoke_board --link wifi --address 192.168.1.40

What it does, in order:
  1. USB: lists the serial ports (an Arduino Uno is never opened: opening it resets the
     relays), LISTENS on each until it sees a CRC-valid Aankhen frame. Nothing is written.
  2. Wi-Fi (if no board on USB, or --link wifi): reads the link key from the app's
     data/app/esp32_link.json, greets the board on UDP 47269 and listens on 47270.
     Every datagram is checked with HMAC-SHA256; accepted and rejected counts are printed.
  3. Counts for --seconds: CSI frames/s, RSSI (min/median/max), subcarrier count,
     frames lost, and what the board's own STATUS says (Wi-Fi state, csi_hz).

It never sends a relay command, never needs a camera, and never prints the key: only
its 8-character fingerprint. It does not read firmware/secrets.h.

Close the JARVIS app first: it holds COM9 and UDP 47270 while it runs.
"""
from __future__ import annotations

import argparse
import json
import os
import statistics
import sys
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Optional

from aankhen import netlink as nl
from aankhen.boards import probe_port
from aankhen.protocol import CsiLinkPacket, CsiPacket, StatusPacket
from aankhen.transport import NetSource, SerialSource, list_candidate_ports

MIN_HZ = 10.0          # the engine wants ~20-100 Hz; under 10 the motion features starve
MIN_SUBCARRIERS = 52   # an HT20 capture has 64 slots, 52+ usable; fewer means a broken buffer
ROOT = Path(__file__).resolve().parents[2]


def key_file() -> Path:
    data = os.environ.get("JARVIS_DATA_DIR")
    return Path(data) / "esp32_link.json" if data else ROOT / "data" / "app" / "esp32_link.json"


def load_link(path: Path) -> tuple[Optional[bytes], list[str]]:
    """(key, addresses) from the app's link file; (None, []) if it is missing or damaged."""
    try:
        d = json.loads(path.read_text(encoding="utf-8"))
        key = nl.parse_key(d.get("key", ""))
    except (OSError, ValueError, AttributeError):
        return None, []
    addrs = [d.get("address"), d.get("last_ip"), "aankhen.local"]
    return key, list(dict.fromkeys(a for a in addrs if a))


@dataclass
class Report:
    link: str = "none"                  # "usb" | "wifi" | "none"
    where: str = ""                     # COM9, or the board's IP
    seconds: float = 0.0
    csi: int = 0                        # router -> board captures (link 1)
    csi_other: int = 0                  # phone link and other transmitters
    status: int = 0
    rssi: list = field(default_factory=list)
    subcarriers: dict = field(default_factory=dict)   # n -> count
    frames_lost: int = 0
    crc_errors: int = 0
    hmac_ok: Optional[int] = None       # Wi-Fi only
    hmac_bad: Optional[int] = None
    fw: Optional[str] = None
    last_status: dict = field(default_factory=dict)
    note: str = ""

    @property
    def hz(self) -> float:
        return self.csi / self.seconds if self.seconds > 0 else 0.0

    @property
    def main_subcarriers(self) -> int:
        return max(self.subcarriers, key=self.subcarriers.get) if self.subcarriers else 0


def collect(src, seconds: float, report: Report, clock=time.monotonic) -> Report:
    """Count what `src` (already started) delivers for `seconds`. Stops the source."""
    t0 = clock()
    try:
        while clock() - t0 < seconds:
            try:
                pkt = src.packets.get(timeout=0.2)
            except Exception:
                if src._finished():          # a replay or test source that has run dry
                    break
                continue
            if isinstance(pkt, CsiPacket):
                report.csi += 1
                report.rssi.append(pkt.rssi)
                n = pkt.n_subcarriers
                report.subcarriers[n] = report.subcarriers.get(n, 0) + 1
            elif isinstance(pkt, CsiLinkPacket):
                report.csi_other += 1
            elif isinstance(pkt, StatusPacket):
                report.status += 1
                report.last_status = dict(pkt.fields or {})
    finally:
        report.seconds = clock() - t0
        report.frames_lost = src.decoder.stats.frames_lost
        report.crc_errors = src.decoder.stats.crc_errors
        report.fw = getattr(src, "fw", None) or report.last_status.get("fw")
        net = getattr(src, "net", None)
        if net is not None:
            report.hmac_ok, report.hmac_bad = net.datagrams, net.bad_tag
        src.stop()
    return report


def verdict(r: Report) -> tuple[bool, list[str]]:
    """(passed, reasons it failed). Pure: the tests drive it with made-up reports."""
    why = []
    if r.link == "none":
        why.append("no board found on USB or Wi-Fi")
        return False, why
    if r.csi == 0:
        st = r.last_status
        if st.get("wifi") not in (None, "connected"):
            why.append(f"no CSI: the board says Wi-Fi '{st.get('wifi')}' at {st.get('rssi')} dBm "
                       "(it cannot join the router; check SSID/password in secrets.h, move it closer)")
        elif r.status == 0:
            why.append("no CSI and no STATUS: the board is silent (press RST, check the cable)")
        else:
            why.append("no CSI although the board talks: router traffic too low, or CSI disabled")
    elif r.hz < MIN_HZ:
        why.append(f"CSI rate {r.hz:.1f} Hz is under {MIN_HZ:g} Hz")
    if r.csi and r.main_subcarriers < MIN_SUBCARRIERS:
        why.append(f"{r.main_subcarriers} subcarriers per capture, expected {MIN_SUBCARRIERS}+")
    if r.hmac_bad:
        why.append(f"{r.hmac_bad} datagrams failed HMAC: the board's LINK_KEY_VALUE is not the app's key")
    return not why, why


def render(r: Report, fp: Optional[str] = None) -> list[str]:
    out = [f"link        : {r.link} {r.where}".rstrip(),
           f"firmware    : {r.fw or 'unknown'}",
           f"listened    : {r.seconds:.1f} s"]
    out.append(f"CSI frames  : {r.csi}  ({r.hz:.1f} /s)   other links: {r.csi_other}")
    if r.rssi:
        out.append(f"RSSI dBm    : min {min(r.rssi)}  median {statistics.median(r.rssi):g}  max {max(r.rssi)}")
    if r.subcarriers:
        out.append("subcarriers : " + ", ".join(f"{n} x{c}" for n, c in sorted(r.subcarriers.items())))
    out.append(f"lost / CRC  : {r.frames_lost} lost, {r.crc_errors} CRC errors")
    if r.hmac_ok is not None:
        out.append(f"HMAC        : {r.hmac_ok} ok, {r.hmac_bad} failed" + (f"   key {fp}" if fp else ""))
    st = r.last_status
    if st:
        net = st.get("net") or {}
        board_fp = net.get("key") if isinstance(net, dict) else None
        same = "" if not (fp and board_fp) else ("  key matches" if board_fp == fp else "  KEY DIFFERS")
        out.append(f"board says  : wifi {st.get('wifi')}, rssi {st.get('rssi')}, ch {st.get('channel')}, "
                   f"csi_hz {st.get('csi_hz')}{same}")
    if r.note:
        out.append(f"note        : {r.note}")
    return out


def find_usb(window_s: float, port: Optional[str]) -> tuple[Optional[str], str]:
    """The first port that delivers an Aankhen frame (listen-only), and a one-line note."""
    ports = [port] if port else [c.device for c in list_candidate_ports()]
    if not ports:
        return None, "no USB serial ports"
    notes = []
    for dev in ports:
        res = probe_port(dev, window_s=window_s)
        if res.is_board:
            return dev, f"{dev}: Aankhen ({res.frame})"
        notes.append(f"{dev}: {res.detail}")
    return None, "; ".join(notes)


def usb_status(dev: str, wait_s: float = 4.0) -> dict:
    """The board's STATUS over USB (listen only): where it is on Wi-Fi, its key fingerprint."""
    src = SerialSource(port=dev).start()
    try:
        return src.wait_status(0.0, wait_s) or {}
    finally:
        src.stop()


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--link", choices=("auto", "usb", "wifi"), default="auto")
    ap.add_argument("--port", help="serial port (default: look at every one)")
    ap.add_argument("--address", help="board IP or name for Wi-Fi (default: from the app's link file)")
    ap.add_argument("--seconds", type=float, default=20.0)
    ap.add_argument("--probe-s", type=float, default=6.0, help="listen this long per serial port")
    a = ap.parse_args(argv)

    r = Report()
    fp = None
    usb_note = ""
    if a.link in ("auto", "usb"):
        print("looking for the board on USB (listen only) ...", flush=True)
        dev, usb_note = find_usb(a.probe_s, a.port)
        if dev:
            r.link, r.where = "usb", dev
            src = SerialSource(port=dev).start()
            collect(src, a.seconds, r)
    if r.link == "none" and a.link in ("auto", "wifi"):
        key, addrs = load_link(key_file())
        if a.address:
            addrs = [a.address] + addrs
        if a.link == "wifi" and not a.address:
            dev, _ = find_usb(a.probe_s, a.port)        # the board on USB too: ask it its IP
            ip = usb_status(dev).get("ip") if dev else None
            if ip and ip != "0.0.0.0":
                addrs = [ip] + [x for x in addrs if x != ip]
        if key is None:
            r.note = (f"no link key in {key_file()} (start the app once); " + usb_note).strip("; ")
        else:
            fp = nl.fingerprint(key)
            print(f"trying Wi-Fi: {', '.join(addrs)} (key {fp}) ...", flush=True)
            src = NetSource(key, addrs).start()
            if src.connected.wait(timeout=8.0):
                r.link, r.where = "wifi", src.address or ""
                collect(src, a.seconds, r)
            else:
                n = src.net
                src.stop()
                r.hmac_ok, r.hmac_bad = n.datagrams, n.bad_tag
                r.note = (f"no WELCOME from {', '.join(addrs)} ({n.hellos} HELLOs, {n.bad_tag} bad HMAC). "
                          f"USB: {usb_note}").strip()
                if n.bad_tag:
                    r.link, r.where = "wifi", "(key mismatch)"
    elif r.link == "none":
        r.note = usb_note

    for line in render(r, fp):
        print(line)
    ok, why = verdict(r)
    print(("PASS" if ok else "FAIL") + f": {r.link} {r.hz:.1f} CSI/s, {r.main_subcarriers} subcarriers"
          + ("" if ok else " -- " + "; ".join(why)))
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
