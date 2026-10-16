"""The Wi-Fi link (netlink.py, NetSource): HMAC handshake, replay and forgery refused,
batching and unbatching, reordering, reconnects, and the C side's constants agreeing
with the Python ones. Everything runs on 127.0.0.1 against fakenet.FakeNetBoard: no
datagram ever goes to a device on the LAN."""
import json
import os
import re
import socket
import struct
import time
from pathlib import Path

import pytest

from aankhen import netlink as nl
from aankhen.protocol import (CSI_GAIN_FMT, CSI_META_FMT, MAX_PAYLOAD_BY_TYPE, Frame, FrameType,
                              StreamDecoder, decode_packet)
from aankhen.transport import NetSource, probe_board

from .fakenet import FakeNetBoard

FW_DIR = Path(__file__).resolve().parents[1] / "firmware"
KEY = bytes(range(32))


def wait_for(cond, timeout=5.0, step=0.01):
    t0 = time.monotonic()
    while time.monotonic() - t0 < timeout:
        if cond():
            return True
        time.sleep(step)
    return cond()


@pytest.fixture
def board():
    b = FakeNetBoard(KEY).start()
    yield b
    b.stop()


def net_source(board, key=KEY, **kw):
    kw = {"host_port": 0, "bind_host": "127.0.0.1", "reconnect_s": 0.1, "hello_wait_s": 0.5, **kw}
    return NetSource(key, ["127.0.0.1"], board_port=board.port, **kw)


# ------------------------------------------------------------------ datagrams
def test_a_datagram_verifies_only_under_its_key_and_untouched():
    dg = nl.pack(KEY, nl.Kind.DATA, 7, 42, b"frames")
    d = nl.verify(KEY, dg)
    assert (d.kind, d.session, d.counter, d.payload) == (nl.Kind.DATA, 7, 42, b"frames")
    with pytest.raises(nl.LinkError, match="bad tag"):
        nl.verify(bytes(32), dg)                                   # another key
    for i in (0, 5, 9, 15, 21, len(dg) - 1):                       # any one bit, anywhere
        bad = bytearray(dg)
        bad[i] ^= 0x01
        with pytest.raises(nl.LinkError):
            nl.verify(KEY, bytes(bad))
    with pytest.raises(nl.LinkError):
        nl.verify(KEY, dg[:-1])                                    # truncated
    assert len(nl.pack(KEY, nl.Kind.DATA, 1, 1, bytes(nl.MAX_PAYLOAD))) == nl.MAX_DATAGRAM < 1400
    with pytest.raises(ValueError):
        nl.pack(KEY, nl.Kind.DATA, 1, 1, bytes(nl.MAX_PAYLOAD + 1))


def test_the_session_key_needs_both_nonces_and_the_link_key():
    a = nl.session_key(KEY, 5, b"h" * 16, b"b" * 16)
    assert a != nl.session_key(KEY, 5, b"h" * 16, b"c" * 16)
    assert a != nl.session_key(KEY, 6, b"h" * 16, b"b" * 16)
    assert a != nl.session_key(bytes(32), 5, b"h" * 16, b"b" * 16)
    assert len(a) == 32 and nl.fingerprint(KEY) != nl.fingerprint(bytes(32)) and len(nl.fingerprint(KEY)) == 8


def test_parse_key_takes_only_64_hex_characters():
    assert nl.parse_key(KEY.hex().upper()) == KEY
    for bad in ("", "00" * 31, "zz" * 32, KEY.hex() + "0"):
        with pytest.raises(ValueError):
            nl.parse_key(bad)


# ------------------------------------------------------------------ batching
def _csi(seq):
    meta = struct.pack(CSI_META_FMT, -55, -92, 6, 0, 1, 0, 0, 0, b"\x11" * 6, 128)
    return Frame(FrameType.CSI_GAIN, seq, 1_000_000 + seq * 2000, meta + struct.pack(CSI_GAIN_FMT, 30, 2, 0)
                 + os.urandom(128)).encode()


def test_500_hz_csi_batches_eight_frames_a_datagram_and_unbatches_byte_exact():
    t = [0.0]
    b = nl.Batcher(clock=lambda: t[0])
    frames = [_csi(i) for i in range(500)]                       # one second at CSI_RATE_HZ 500
    assert len(frames[0]) == 166
    payloads = []
    for f in frames:
        t[0] += 0.002
        payloads += b.add(f)
        if b.due():
            payloads.append(b.flush())
    payloads.append(b.flush())
    sizes = [len(nl.pack(KEY, nl.Kind.DATA, 1, 1, p)) for p in payloads]
    assert max(sizes) < 1400 and len(payloads) == 63              # 500 datagrams a second become 63
    assert [len(nl.frame_spans(p)) for p in payloads[:-1]] == [8] * 62
    assert [f for p in payloads for f in nl.frame_spans(p)] == frames
    dec = StreamDecoder()
    got = [fr for p in payloads for fr in dec.feed(p)]
    assert len(got) == 500 and dec.stats.crc_errors == 0 and dec.stats.frames_lost == 0


def test_a_part_full_batch_leaves_after_20_ms():
    t = [0.0]
    b = nl.Batcher(clock=lambda: t[0])
    b.add(_csi(1))
    t[0] = 0.019
    assert not b.due()
    t[0] = 0.020
    assert b.due() and len(nl.frame_spans(b.flush())) == 1 and not b.due()


def test_frame_spans_refuses_a_cut_frame():
    f = _csi(1)
    with pytest.raises(nl.LinkError):
        nl.frame_spans(f[:-3])
    with pytest.raises(nl.LinkError):
        nl.frame_spans(b"junk" + f)


def _status_worst_case() -> bytes:
    """firmware.ino buildStatus() at its longest: five relays, a phone, a session, every
    counter at its widest. Written from the C format string, value by value."""
    relays = ",".join(f'"{n}":false' for n in ("light", "fan", "light2", "light3", "light4"))
    pins = ",".join(f'"{n}":{p}' for n, p in (("light", 4), ("fan", 5), ("light2", 6), ("light3", 7), ("light4", 8)))
    u32 = 4294967295
    beacon = (f'{{"ip":"255.255.255.255","mac_known":false,"pings_ok":{u32},"rate_hz":{u32},"rssi":-100,'
              f'"dropped":{u32},"rejected":{u32},"fallback":false}}')
    net = (f'{{"key":"abcdef01","port":47269,"peer":"255.255.255.255:65535","dgrams":{u32},"cmds":{u32},'
           f'"bad":{u32},"replays":{u32},"fail":{u32}}}')
    js = (f'{{"fw":"aankhen-3.5.0","uptime_s":4294967.3,"relays":{{{relays}}},"relay_pins":{{{pins}}},'
          f'"wifi":"connecting","ip":"255.255.255.255","mdns":"aankhen.local","rssi":-100,"channel":13,'
          f'"csi_hz":{u32},"csi_dropped":{u32},"csi_rejected":{u32},"radar_frames":{u32},"radar_bad":{u32},'
          f'"mqtt":false,"http":false,"heap_free":{u32},"crc_ok":false,"gain":"unavailable","ota":false,'
          f'"reset":"reset-pin","beacon_enabled":false,"beacon":{beacon},"net":{net}}}')
    return js.encode()


def test_the_longest_status_fits_its_buffer_the_host_limit_and_one_datagram():
    js = _status_worst_case()
    json.loads(js)
    status_max = int(re.search(r"#define STATUS_MAX (\d+)", (FW_DIR / "firmware.ino").read_text()).group(1))
    assert len(js) < status_max <= MAX_PAYLOAD_BY_TYPE[FrameType.STATUS]
    frame = Frame(FrameType.STATUS, 1, 1, js).encode()
    assert len(nl.pack(KEY, nl.Kind.DATA, 1, 1, frame)) < 1400


def test_the_firmware_and_the_host_agree_on_the_wire():
    ino = (FW_DIR / "firmware.ino").read_text(encoding="utf-8")
    cfg = (FW_DIR / "config.h").read_text(encoding="utf-8")

    def define(text, name):
        return int(re.search(rf"#define {name} (\d+)", text).group(1))

    assert define(ino, "LINK_HDR") == nl.HDR_SIZE and define(ino, "LINK_TAG") == nl.TAG_SIZE
    assert define(ino, "LINK_DGRAM_MAX") == nl.MAX_DATAGRAM
    assert define(cfg, "LINK_PORT") == nl.BOARD_PORT
    assert define(cfg, "LINK_FLUSH_MS") == round(nl.FLUSH_S * 1000)
    kinds = re.search(r"enum : uint8_t \{ LK_HELLO = 1, ([^}]*)\}", ino).group(1)
    names = ["HELLO"] + [k.strip().replace("LK_", "") for k in kinds.split(",")]
    assert {n: i + 1 for i, n in enumerate(names)} == {k.name: int(k) for k in nl.Kind}
    assert '"AKN1 session", 12' in ino and nl.SESSION_LABEL == b"AKN1 session"
    assert '"AKN1 fingerprint", 16' in ino
    assert re.search(r'#define FW_VERSION "aankhen-3\.5\.0"', ino)


# ------------------------------------------------------------------ order
def test_the_reorderer_puts_datagrams_back_in_order_and_counts_what_it_cannot():
    t = [0.0]
    r = nl.Reorderer(wait_s=0.05, clock=lambda: t[0])
    assert r.push(1, b"1") == [b"1"]
    assert r.push(3, b"3") == []                                   # 2 is late: wait for it
    assert r.push(2, b"2") == [b"2", b"3"] and r.stats.reordered == 1
    assert r.push(2, b"2") == [] and r.stats.duplicate == 1         # a replay of a delivered one
    assert r.push(5, b"5") == []
    t[0] = 0.06
    assert r.poll() == [b"5"] and r.stats.lost == 1                 # 4 never came
    assert r.push(4, b"4") == [] and r.stats.late == 1              # ... and when it does, it is too late
    assert r.stats.delivered == 4


# ------------------------------------------------------------------ the live link
def test_handshake_streams_the_board_frames_through_the_same_decoder(board):
    src = net_source(board).start()
    try:
        assert src.connected.wait(3)
        assert src.kind == "hardware" and src.link == "wifi" and src.address == "127.0.0.1"
        assert src.fw == "aankhen-3.5.0" and src.net.handshakes == 1 and src.net.rtt_ms is not None
        st = src.wait_status(time.perf_counter(), 2)
        assert st["relays"] == {"light": False, "fan": False, "light2": False, "light3": False, "light4": False}
        assert st["net"]["key"] == nl.fingerprint(KEY)
        assert src.decoder.stats.crc_errors == 0 and src.net.bad_tag == 0
    finally:
        src.stop()
    assert wait_for(lambda: board.live is None)                    # BYE ended the board's session at once


def test_a_command_over_wifi_switches_and_the_board_answers_with_its_state(board):
    src = net_source(board).start()
    try:
        assert src.connected.wait(3)
        cmd = Frame(FrameType.COMMAND, 1, 0, json.dumps({"relay": "light2", "on": True}).encode()).encode()
        sent = time.perf_counter()
        assert src.write(cmd)
        st = src.wait_status(sent, 1.0, lambda s: s["relays"].get("light2") is True)
        assert st is not None and board.relays["light2"] is True
        assert board.commands == [{"relay": "light2", "on": True}] and board.counts["replays"] == 0
    finally:
        src.stop()


def test_the_wrong_key_gets_no_session_and_no_frames(board):
    src = net_source(board, key=bytes(32)).start()
    try:
        time.sleep(1.2)
        assert not src.connected.is_set() and src.net.handshakes == 0
        assert board.counts["welcome"] == 0 and board.counts["bad"] >= 1   # the board answered nothing
        assert src.packets.empty()
    finally:
        src.stop()


def _raw_session(board):
    """The laptop's side by hand: HELLO, WELCOME, READY. (socket, session, ks, send)."""
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    s.bind(("127.0.0.1", 0))
    s.settimeout(1.0)
    hn = os.urandom(16)
    s.sendto(nl.hello(KEY, hn), ("127.0.0.1", board.port))
    while True:
        data, _ = s.recvfrom(2048)
        d = nl.verify(KEY, data)
        if d.kind == nl.Kind.WELCOME:
            break
    _, bn, _ = nl.parse_welcome(d.payload)
    ks = nl.session_key(KEY, d.session, hn, bn)
    sent = []

    def send(kind, counter, payload=b""):
        dg = nl.pack(ks, kind, d.session, counter, payload)
        sent.append(dg)
        s.sendto(dg, ("127.0.0.1", board.port))
        return dg

    send(nl.Kind.READY, 1)
    assert wait_for(lambda: board.live is not None)
    return s, d.session, ks, send


def _cmd(relay, on):
    return Frame(FrameType.COMMAND, 1, 0, json.dumps({"relay": relay, "on": on}).encode()).encode()


def test_a_replayed_command_is_dropped_and_the_relay_stays_as_last_commanded(board):
    s, sid, ks, send = _raw_session(board)
    try:
        on = send(nl.Kind.CMD, 2, _cmd("fan", True))
        assert wait_for(lambda: board.relays["fan"] is True)
        send(nl.Kind.CMD, 3, _cmd("fan", False))
        assert wait_for(lambda: board.relays["fan"] is False)
        s.sendto(on, ("127.0.0.1", board.port))                     # a captured "fan on", sent again
        send(nl.Kind.CMD, 3, _cmd("fan", True))                     # a counter already used
        assert wait_for(lambda: board.counts["replays"] == 2)
        time.sleep(0.1)
        assert board.relays["fan"] is False and board.counts["cmds"] == 2
        forged = bytearray(nl.pack(ks, nl.Kind.CMD, sid, 9, _cmd("fan", True)))
        forged[-1] ^= 1                                             # without the key, no valid tag
        s.sendto(bytes(forged), ("127.0.0.1", board.port))
        time.sleep(0.1)
        assert board.relays["fan"] is False and board.counts["bad"] >= 1
    finally:
        s.close()


def test_a_replayed_hello_or_ready_cannot_take_over_the_session(board):
    s, sid, ks, send = _raw_session(board)
    try:
        hello = nl.hello(KEY, os.urandom(16))
        s.sendto(hello, ("127.0.0.1", board.port))
        assert wait_for(lambda: board.pending is not None)
        assert board.live["id"] == sid                              # the live session is untouched
        # The attacker has the HELLO and its WELCOME, but not the key: no READY it can sign.
        fake_ks = nl.session_key(bytes(32), board.pending["id"], b"x" * 16, b"y" * 16)
        s.sendto(nl.pack(fake_ks, nl.Kind.READY, board.pending["id"], 1), ("127.0.0.1", board.port))
        s.sendto(nl.pack(ks, nl.Kind.READY, sid, 1), ("127.0.0.1", board.port))   # the old READY again
        time.sleep(0.15)
        assert board.live["id"] == sid and board.counts["sessions"] == 1
    finally:
        s.close()


def test_the_host_drops_a_replayed_data_datagram_and_a_stale_welcome(board):
    src = net_source(board).start()
    try:
        assert src.connected.wait(3)
        sid, ks, peer = src._session
        assert wait_for(lambda: src.net.datagrams >= 2)
        frames_before = src.decoder.stats.frames_ok
        # An old DATA datagram (counter 1) replayed at the laptop, from the board's address.
        board.sock.sendto(nl.pack(ks, nl.Kind.DATA, sid, 1, board.status_frame()), (peer[0], src.bound_port))
        assert wait_for(lambda: src.reorder.stats.duplicate + src.reorder.stats.late >= 1)
        assert src.decoder.stats.frames_ok - frames_before <= src.net.datagrams      # nothing decoded twice
        # A WELCOME for a nonce this laptop never sent is not a handshake.
        board.sock.sendto(nl.pack(KEY, nl.Kind.WELCOME, 99, 0, nl.welcome_payload(os.urandom(16), os.urandom(16), "x")),
                          (peer[0], src.bound_port))
        time.sleep(0.1)
        assert src.net.handshakes == 1 and src._session[0] == sid
    finally:
        src.stop()


def test_datagrams_that_arrive_swapped_are_decoded_in_the_board_order(board):
    board.csi_hz = 400
    src = net_source(board).start()
    try:
        assert src.connected.wait(3)
        for _ in range(5):
            board.swap_next = True
            assert wait_for(lambda: not board.swap_next, timeout=2)
        assert wait_for(lambda: src.reorder.stats.reordered >= 3)
        time.sleep(0.2)
        assert src.decoder.stats.frames_lost == 0 and src.reorder.stats.lost == 0
        ts = []
        while not src.packets.empty():
            p = src.packets.get_nowait()
            if hasattr(p, "raw"):
                ts.append(p.timestamp_us)
        assert ts == sorted(ts) and len(ts) > 50
    finally:
        src.stop()


def test_netsource_greets_the_board_again_after_it_reboots(board):
    src = net_source(board, timeout_s=0.6, keepalive_s=0.2).start()
    try:
        assert src.connected.wait(3)
        epoch = src.epoch
        board.restart()                                            # power cut: sessions forgotten
        assert wait_for(lambda: src.net.handshakes >= 2, timeout=5)
        assert wait_for(lambda: src.connected.is_set(), timeout=3)
        assert src.net.timeouts >= 1 and src.epoch > epoch
        assert src.fresh_status()["relays"]["light"] is False
    finally:
        src.stop()


def test_netsource_says_why_while_the_board_is_silent(board):
    board.silent = True
    notes = []
    src = net_source(board, on_status=notes.append).start()
    try:
        time.sleep(0.8)
        assert not src.connected.is_set() and any("no answer from 127.0.0.1" in n for n in notes)
        assert not src.write(b"anything")                          # no session: nothing sent
        board.silent = False
        assert src.connected.wait(3)
    finally:
        src.stop()


def test_probe_board_answers_without_opening_a_session(board):
    got = probe_board(KEY, ["127.0.0.1"], board_port=board.port, host_port=0, wait_s=0.5)
    assert got["ip"] == "127.0.0.1" and got["fw"] == "aankhen-3.5.0" and got["rtt_ms"] is not None
    assert board.live is None and board.pending is not None         # half-open; it expires on the board
    assert probe_board(bytes(32), ["127.0.0.1"], board_port=board.port, host_port=0, wait_s=0.3) is None
    assert probe_board(KEY, [], board_port=board.port, host_port=0) is None


def test_a_name_that_does_not_resolve_is_not_asked_every_second(board):
    asked = []

    def resolver(name):
        asked.append(name)
        if name == "aankhen.local":
            return []
        return [name]

    src = NetSource(KEY, ["aankhen.local", "127.0.0.1"], board_port=board.port, host_port=0, bind_host="127.0.0.1",
                    resolver=resolver, reconnect_s=0.05, hello_wait_s=0.2)
    assert src._resolve(src.addresses()) == ["127.0.0.1"]
    assert src._resolve(src.addresses()) == ["127.0.0.1"]
    assert asked.count("aankhen.local") == 1


def test_csi_over_wifi_decodes_as_the_same_packets_as_usb(board):
    board.csi_hz = 200
    src = net_source(board).start()
    try:
        assert src.connected.wait(3)
        assert wait_for(lambda: src.packets.qsize() > 60, timeout=3)
        kinds = set()
        while not src.packets.empty():
            kinds.add(type(src.packets.get_nowait()).__name__)
        assert {"CsiPacket", "StatusPacket"} <= kinds
        assert max(board.datagram_sizes) < 1400
        assert board.counts["frames"] / max(1, board.counts["dgrams"]) > 1.5      # batched, not one per frame
    finally:
        src.stop()


def test_decode_packet_is_untouched_by_the_link():
    f = Frame.encode(Frame(FrameType.STATUS, 1, 5, b'{"fw":"x"}'))
    (frame,) = list(StreamDecoder().feed(f))
    assert decode_packet(frame).fields == {"fw": "x"}
