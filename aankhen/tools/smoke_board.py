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
  4. Link quality: the longest gap between two router captures (from the board's own
     timestamps, so it is the radio's gap plus anything lost on the way), the frame loss
     in %, and, from firmware 3.6.0's STATUS "lq", ping timeouts in %, the router's PHY
     rate, reconnects and the last disconnect reason.

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
from aankhen.protocol import CsiLinkPacket, CsiPacket, LinkQuality, StatusPacket, ping_loss
from aankhen.transport import NetSource, SerialSource, list_candidate_ports

MIN_HZ = 10.0          # the engine wants ~20-100 Hz; under 10 the motion features starve
MIN_SUBCARRIERS = 52   # an HT20 capture has 64 slots, 52+ usable; fewer means a broken buffer
# Link-quality bounds, from the council's link review (2026-10-26, "What good means").
# The host's Resampler forward-fills a gap and breaks the stream past 250 ms (csi.py), so
# a longer gap fails on any link. On USB only the radio can lose a capture, and at 500 Hz
# one lost ping costs 2 ms, so a gap over 50 ms there is a stalled ping thread or loop
# (3.5.1 fixed a 1 s one): USB must stay under 50 ms. Wi-Fi batches ~8 captures to a
# datagram (16 ms), so two lost datagrams in a row already make ~36 ms: there 50-250 ms is
# "usable", said, not failed.
GAP_GOOD_MS = 50.0
GAP_BREAK_MS = 250.0
LOSS_MAX = 0.05        # > 5 % of frames lost: interference or a weak signal
LOSS_GOOD = 0.01       # < 1 % is good
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
    frames_ok: int = 0
    frames_lost: int = 0
    crc_errors: int = 0
    gap_ms: Optional[float] = None      # longest gap between consecutive router captures (board clock)
    lq_first: Optional[LinkQuality] = None   # firmware 3.6.0+ STATUS "lq", first and last seen
    lq_last: Optional[LinkQuality] = None
    board_gap_ms: Optional[int] = None  # the largest lq.gap_ms the board reported
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

    @property
    def loss(self) -> Optional[float]:
        """Fraction of frames lost on the way (sequence gaps); None before any frame."""
        total = self.frames_ok + self.frames_lost
        return self.frames_lost / total if total else None

    @property
    def ping_loss(self) -> Optional[float]:
        return ping_loss(self.lq_first, self.lq_last)


def collect(src, seconds: float, report: Report, clock=time.monotonic) -> Report:
    """Count what `src` (already started) delivers for `seconds`. Stops the source."""
    t0 = clock()
    last_ts = None
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
                # The board's timestamps, not arrival times: USB and Wi-Fi batching move
                # arrivals by up to 20 ms without the radio having missed anything.
                if last_ts is not None and pkt.timestamp_us > last_ts:
                    gap = (pkt.timestamp_us - last_ts) / 1000.0
                    report.gap_ms = gap if report.gap_ms is None else max(report.gap_ms, gap)
                if last_ts is None or pkt.timestamp_us > last_ts:
                    last_ts = pkt.timestamp_us
            elif isinstance(pkt, CsiLinkPacket):
                report.csi_other += 1
            elif isinstance(pkt, StatusPacket):
                report.status += 1
                report.last_status = dict(pkt.fields or {})
                lq = pkt.link_quality
                if lq is not None:
                    report.lq_first = report.lq_first or lq
                    report.lq_last = lq
                    if lq.gap_ms is not None:
                        report.board_gap_ms = max(report.board_gap_ms or 0, lq.gap_ms)
    finally:
        report.seconds = clock() - t0
        report.frames_ok = src.decoder.stats.frames_ok
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
    if r.csi >= 2 and r.gap_ms is not None:
        bound = GAP_GOOD_MS if r.link == "usb" else GAP_BREAK_MS
        if r.gap_ms >= bound:
            why.append(f"longest CSI gap {r.gap_ms:.0f} ms, must stay under {bound:g} ms on {r.link}"
                       + (" (past 250 ms the host breaks the stream)" if r.gap_ms >= GAP_BREAK_MS else ""))
    if r.loss is not None and r.loss > LOSS_MAX:
        why.append(f"{100 * r.loss:.1f} % of frames lost, over {100 * LOSS_MAX:g} %")
    return not why, why


def _pct(x: Optional[float]) -> str:
    return "n/a" if x is None else f"{100 * x:.1f} %"


def link_lines(r: Report) -> list[str]:
    """The link-quality block: gap, loss, and the board's own lq when it sends one."""
    gap = "n/a" if r.gap_ms is None else f"{r.gap_ms:.0f} ms"
    if r.gap_ms is not None:
        gap += ("  good" if r.gap_ms < GAP_GOOD_MS else "  usable" if r.gap_ms < GAP_BREAK_MS
                else "  BREAKS THE STREAM")
    board = "" if r.board_gap_ms is None else f"   (board's own: {r.board_gap_ms} ms)"
    loss = _pct(r.loss)
    if r.loss is not None:
        loss += "  good" if r.loss < LOSS_GOOD else "  usable" if r.loss <= LOSS_MAX else "  BAD"
    out = [f"CSI gap max : {gap}{board}",
           f"frame loss  : {loss}  ({r.frames_lost} of {r.frames_ok + r.frames_lost})"]
    lq = r.lq_last
    if lq is None:
        out.append("board link  : no lq in STATUS (firmware before 3.6.0)")
        return out
    mbps = lq.rate_mbps
    if lq.rate is None:
        phy = "n/a"
    else:
        phy = (f"{mbps:g} Mbit/s" if mbps is not None else f"code {lq.rate}")             + (" (11n)" if lq.rate >= 128 else " (11b/g)")
    reconn = "n/a" if lq.reconnects is None else str(lq.reconnects)
    out.append(f"board link  : ping timeouts {_pct(r.ping_loss)}, router PHY {phy}, "
               f"reconnects {reconn}, last disconnect {lq.disconnect_name or 'none'}, AP ..:{lq.ap or '?'}")
    return out


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
    if r.link != "none":
        out.extend(link_lines(r))
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
    gap = "" if r.gap_ms is None else f", gap max {r.gap_ms:.0f} ms"
    loss = "" if r.loss is None else f", {100 * r.loss:.1f} % lost"
    print(("PASS" if ok else "FAIL") + f": {r.link} {r.hz:.1f} CSI/s, {r.main_subcarriers} subcarriers{gap}{loss}"
          + ("" if ok else " -- " + "; ".join(why)))
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
