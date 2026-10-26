"""Adversarial and property tests from the 2026-10-23 test audit
(docs/research/2026-10-23-test-audit-aankhen.md). Each block names the agreed
constraint it holds; the inputs are the ones the older tests never tried: out-of-range
and non-finite features, uninformative models, packet gaps, a fan or firmware change
without a reference, simulation leaking as real, replayed and forged datagrams,
counter rollover, oversize datagrams. Property tests use seeded loops (no hypothesis in
the venv): a failure names its seed."""
import json
import os
import re
import time
from pathlib import Path

import numpy as np
import pytest

import aankhen
from aankhen import netlink as nl
from aankhen.belief import (ACTIVITY_FLOOR, STATE_FLOOR, ZONE_FLOOR, BeliefTracker, OodGuard, ZoneBelief,
                            coarse_likelihood)
from aankhen.learn import FEATURES
from aankhen.protocol import StatusPacket
from aankhen.room import default_room
from aankhen.zones import ACTIVITIES, COARSE, ZONE_IDS, ZoneMap, ZoneSpec, default_zones

FW_DIR = Path(__file__).resolve().parents[1] / "firmware"
ZM = ZoneMap(default_zones(default_room()))
WEIRD = [float("nan"), float("inf"), -float("inf"), -1.0, 0.0, 1e-300, 1e300]


def _check_outputs(bt: BeliefTracker, seed: int, step: int) -> None:
    """What every output must satisfy whatever went in (Honesty: Aankhen)."""
    where = f"seed {seed} step {step}"
    p = bt.belief.p
    assert np.all(np.isfinite(p)) and np.all(p >= 0) and abs(p.sum() - 1) < 1e-9, where
    c = bt.contract()
    json.dumps(c, allow_nan=False)                       # the dot cloud gets valid JSON
    assert [z["id"] for z in c["zones"]] == ZM.ids, where
    assert abs(sum(z["p"] for z in c["zones"]) - 1) < 2e-3, where
    assert c["state"] in ("in_room", "empty", "unsure"), where
    if c["state"] != "unsure":                           # a state is said only above its floor
        assert c["confidence"] >= STATE_FLOOR - 1e-9, where
    act = c["activity"]
    if act is not None:
        assert act["state"] in ACTIVITIES and act["state"] != "waving", where
        if act["state"] != "none":
            assert c["state"] == "in_room" and act["p"] >= ACTIVITY_FLOOR, where
    h = bt.honest()
    json.dumps(h, allow_nan=False)
    assert h["state"] == c["state"], where
    if h["zone"] is not None:                            # a zone only sure, in the room, referenced
        i = ZM.index[h["zone"]]
        assert h["state"] == "in_room" and bt.reference_ok and ZM.zones[i].in_room, where
        assert p[i] >= ZONE_FLOOR, where
    if h["state"] == "unsure" or (h["state"] == "in_room" and h["zone"] is None):
        assert h["why"], where                           # never unsure without saying why
    assert "waving" not in json.dumps(c) and h["activity"] != "waving", where


def _random_evidence(rng):
    kw = {}
    r = rng.random()
    if r < 0.3:
        v = rng.dirichlet(np.ones(len(COARSE)))
        if rng.random() < 0.15:
            v[rng.integers(len(v))] = rng.choice(WEIRD)
        kw["coarse_p"] = dict(zip(COARSE, map(float, v)))
    elif r < 0.55:
        ids = rng.choice(ZONE_IDS, size=rng.integers(1, len(ZONE_IDS) + 1), replace=False)
        v = rng.dirichlet(np.ones(len(ids)) * rng.choice([0.1, 1.0, 10.0]))
        if rng.random() < 0.15:
            v[rng.integers(len(v))] = rng.choice(WEIRD)
        kw["zone_p"] = dict(zip(ids, map(float, v)))
    if rng.random() < 0.4:
        names = ["none", "still", "typing", "waving", "walking"] if rng.random() < 0.5 else list(ACTIVITIES)
        kw["activity_p"] = dict(zip(names, map(float, rng.dirichlet(np.ones(len(names))))))
    if rng.random() < 0.15:
        kw["ood"] = "shape_dev1 outside the trained range"
    if rng.random() < 0.1:
        kw["teacher"] = {"at": 0.0, "typing": bool(rng.random() < 0.5), "away": bool(rng.random() < 0.5)}
    return kw


def test_belief_outputs_hold_their_contract_for_any_input():
    """Property: 60 random runs x 80 steps, including NaN/inf/negative model outputs,
    motion outside 0..1, clocks that jump back or skip ahead, a reference that comes
    and goes, out-of-range windows and free-teacher hints."""
    for seed in range(60):
        rng = np.random.default_rng(seed)
        bt = BeliefTracker(ZM, clock=lambda: 0.0)
        t = 0.0
        for k in range(80):
            t += float(rng.choice([0.5, 0.5, 0.5, -3.0, 30.0, 0.0]))
            if rng.random() < 0.05:
                bt.reference_ok = not bt.reference_ok
            motion = rng.choice([None, float(rng.random()), float("nan"), float("inf"), -2.0, 7.0])
            bt.step(t, motion=motion, **_random_evidence(rng))
            _check_outputs(bt, seed, k)


def test_a_model_that_knows_nothing_never_puts_him_in_or_out_of_the_room():
    """Property: whatever the zone map (any split of zones in and out of the room),
    evidence that carries no information (a coarse model answering its own prior, a
    zone model flat over the zones) leaves the state "unsure". Before the audit the
    uniform prior over 15 zones already sat at P(in room) 0.7999 against the 0.8 floor,
    and a coarse model answering 0.2 for each class read as 94 % "empty"."""
    base = default_zones(default_room())
    for seed in range(25):
        rng = np.random.default_rng(100 + seed)
        inside = rng.random(len(base)) < rng.uniform(0.2, 0.95)
        inside[0], inside[-1] = True, False              # at least one of each
        zs = [ZoneSpec(z.id, z.name, z.x, z.y, z.r, "room" if inside[i] else "empty", in_room=bool(inside[i]),
                       dwell_s=z.dwell_s, neighbours=list(z.neighbours)) for i, z in enumerate(base)]
        zm = ZoneMap(zs)
        prior = dict(zip(COARSE, map(float, rng.dirichlet(np.ones(len(COARSE)) * 3))))
        for kind in ("coarse", "zone"):
            bt = BeliefTracker(zm, clock=lambda: 0.0)
            for k in range(200):
                if kind == "coarse":
                    bt.step(k * 0.5, motion=0.0, coarse_p=prior, coarse_prior=prior)
                else:
                    bt.step(k * 0.5, motion=0.0, zone_p={z: 1.0 / len(zm) for z in zm.ids})
            st, conf = bt.state()
            assert st == "unsure", (seed, kind, st, conf)
            assert bt.honest()["zone"] is None and bt.honest()["why"]


def test_broken_model_output_is_not_evidence():
    bt = BeliefTracker(ZM, clock=lambda: 0.0)
    for k in range(30):
        bt.step(k * 0.5, motion=0.1, zone_p={"bed_lying": float("nan"), "at_desk_chair": 0.5})
        bt.step(k * 0.5 + 0.25, motion=float("nan"), coarse_p={"bed": float("inf"), "desk": 0.1})
    assert bt.honest()["why"] == "no evidence yet" and bt.state()[0] == "unsure"
    assert np.allclose(bt.belief.p[ZM.in_room_mask()].sum(), 0.5, atol=0.05)
    assert bt.contract()["motion"] is None


def test_coarse_likelihood_uses_the_prior():
    pri = {"empty": 0.5, "outside": 0.1, "room": 0.2, "desk": 0.1, "bed": 0.1}
    lik = coarse_likelihood(ZM, {"empty": 0.5, "outside": 0.1, "room": 0.2, "desk": 0.3, "bed": 0.1}, pri)
    assert lik[ZM.index["at_desk_chair"]] == pytest.approx(3.0)       # 0.3 / 0.1: desk evidence
    assert lik[ZM.index["out_of_room"]] == pytest.approx(1.0)         # (0.5 + 0.1) / (0.5 + 0.1)


def test_a_long_packet_gap_is_not_read_as_movement():
    """Silence never counts as "something happened": past 5 s a hole (the real board had
    21-30 s stalls) runs with motion unknown, so a 25 s hole after a moving reading moves
    the belief less than 25 s of seen movement does (council 2026-10-26 replaced the old
    hard 5 s cap, which froze the belief through 10 min dead links)."""
    def start():
        b = ZoneBelief(ZM)
        b.p = np.full(len(ZM), 1e-6); b.p[ZM.index["at_desk_chair"]] = 1; b.p /= b.p.sum()
        b.predict(0.0, 1.0)
        return b
    hole = start(); hole.predict(25.0, 1.0)
    seen = start()
    for k in range(1, 6):
        seen.predict(5.0 * k, 1.0)
    desk = ZM.index["at_desk_chair"]
    assert hole.p[desk] > seen.p[desk]
    assert hole.p[desk] > 0.5


def test_the_guard_refuses_infinite_features_and_lets_missing_ones_pass():
    rng = {"shape_dev1": (-179.0, -19.0), "level_dev_db": (-3.0, 3.0)}
    g = OodGuard(FEATURES, rng)
    v = np.zeros(len(FEATURES))
    v[FEATURES.index("log_hbe")] = 0.2
    v[FEATURES.index("shape_dev1")] = -100.0
    v[FEATURES.index("level_dev_db")] = np.nan           # no reference level yet: missing
    assert g.check(v) is None
    for bad in (np.inf, -np.inf, 1e9, -377.0):
        w = v.copy()
        w[FEATURES.index("shape_dev1")] = bad
        assert g.check(w) and "shape_dev1" in g.last_reason, bad


def test_floors_are_what_the_constraints_say():
    """Agreed numbers (belief.py): state 0.8, zone 0.6, activity 0.7."""
    assert (STATE_FLOOR, ZONE_FLOOR, ACTIVITY_FLOOR) == (0.8, 0.6, 0.7)


# ---------------------------------------------------------------- reference per firmware + fan
def _status(t, fw, fan=None):
    f = {"fw": fw}
    if fan is not None:
        f["relays"] = {"light": False, "fan": fan}
    return StatusPacket(int(t * 1e6), 0, f)


def _sure_zone_steps(eng, t0, n=60):
    for k in range(n):
        eng.belief.step(t0 + k * 0.5, 0.0, zone_p={"bed_lying": 0.97, "at_desk_chair": 0.03})


def test_no_zone_after_a_firmware_change_without_its_reference(tmp_path):
    from aankhen.engine import Engine
    from aankhen.recal import ReferenceStore
    ReferenceStore(str(tmp_path)).save("aankhen-3.5.0", False, {"shape": [0.0] * 6, "level": 1.0, "rssi": -60.0,
                                                               "windows": 300}, "drill", "2026-10-20")
    eng = Engine(default_room(), "hardware", room_measured=True, references=str(tmp_path))
    eng.belief.zone_floor = 0.6          # as if the day-7 zone test had passed (test_zone_trust)
    eng.process(_status(1.0, "aankhen-3.5.0", fan=False))
    assert eng.reference["matched"] and eng.belief.reference_ok
    _sure_zone_steps(eng, 2.0)
    assert eng.belief.honest()["zone"] == "bed_lying"
    eng.process(_status(40.0, "aankhen-3.6.0", fan=False))      # flashed: no reference for it yet
    assert not eng.reference["matched"] and not eng.belief.reference_ok
    _sure_zone_steps(eng, 41.0)
    h = eng.belief.honest()
    assert h["zone"] is None and "reference" in h["why"]
    assert eng.frame_message()["reference"]["firmware"] == "aankhen-3.6.0"


def test_no_zone_after_a_fan_change_without_its_reference(tmp_path):
    """The Uno reports the fan on; only a fan-off reference exists for this firmware."""
    from aankhen.engine import Engine
    from aankhen.recal import ReferenceStore
    ReferenceStore(str(tmp_path)).save("aankhen-3.5.0", False, {"shape": [0.0] * 6, "level": 1.0, "rssi": -60.0,
                                                               "windows": 300}, "drill", "2026-10-20")
    eng = Engine(default_room(), "hardware", references=str(tmp_path))
    eng.process(_status(1.0, "aankhen-3.5.0"))
    eng.set_fan_external(False, t=1.0)
    assert eng.belief.reference_ok
    eng.set_fan_external(True, t=2.0)
    assert not eng.belief.reference_ok and eng._csi_settling(20.0)
    _sure_zone_steps(eng, 3.0)
    assert eng.belief.honest()["zone"] is None


# ---------------------------------------------------------------- simulation never shown as real
def _sim_engine(seconds=6.0):
    from aankhen.engine import Engine
    from aankhen.protocol import StreamDecoder, decode_packet
    from aankhen.simulator import Simulator, scenario_still
    room = default_room()
    eng = Engine(room, "simulation")
    dec = StreamDecoder()
    for ch in Simulator(room, scenario_still(room), seed=3).chunks(seconds):
        for fr in dec.feed(ch):
            p = decode_packet(fr)
            if p is not None:
                eng.process(p)
    return eng


def test_every_message_from_a_simulation_says_simulation():
    eng = _sim_engine()
    assert eng.firmware() == "aankhen-simulator"
    for msg in (eng.frame_message(), eng.status_message(), eng.room_message(), eng.eyes_message(), eng.snapshot()):
        assert msg["source"] == "simulation", msg.get("type")
    states = {s["state"] for s in eng.status_message()["sensors"].values()}
    assert "live" not in states and states <= {"simulated", "silent", "absent"}
    # the simulator's own reference survives its STATUS frames (it used to go stale at the first)
    assert eng.reference == {"source": "simulated", "matched": True} and eng.belief.reference_ok


def test_a_simulation_never_saves_an_empty_room_reference(tmp_path):
    from aankhen.engine import Engine
    eng = Engine(default_room(), "simulation", references=str(tmp_path))
    eng.recalibrate_from("drill")
    eng.recalibrate_from("teachers")
    assert eng.recal.active_source is None and not os.listdir(tmp_path)


def test_the_tests_never_touch_the_real_data_folder():
    """Scratch data (conftest.py): no module keeps a path into data/aankhen."""
    from aankhen import hub, learn, recal, room, zones
    real = os.path.normcase(os.path.abspath(Path(__file__).resolve().parents[2] / "data" / "aankhen"))
    for path in (aankhen.DATA_DIR, recal.REF_DIR, learn.MODEL_DIR, zones.ZONES_FILE, hub.BASELINE_FILE,
                 room.ROOM_FILE):
        assert not os.path.normcase(os.path.abspath(path)).startswith(real), path


# ---------------------------------------------------------------- the Wi-Fi link (Safety: firmware/link)
KEY = bytes(range(32))


def test_forged_truncated_oversize_and_foreign_datagrams_never_verify():
    """Property: 400 random corruptions of a real datagram, and datagrams cut short,
    padded past one 802.11 frame, or tagged under another key: always LinkError."""
    rng = np.random.default_rng(7)
    good = nl.pack(KEY, nl.Kind.CMD, 0x1234, 9, b"\xaa\x55" + bytes(30))
    assert nl.verify(KEY, good).counter == 9
    for _ in range(400):
        bad = bytearray(good)
        for i in rng.choice(len(bad), size=rng.integers(1, 4), replace=False):
            bad[i] ^= int(rng.integers(1, 256))
        with pytest.raises(nl.LinkError):
            nl.verify(KEY, bytes(bad))
    for n in (0, 1, nl.HDR_SIZE, nl.HDR_SIZE + nl.TAG_SIZE - 1, len(good) - 1):
        with pytest.raises(nl.LinkError):
            nl.verify(KEY, good[:n])
    with pytest.raises(nl.LinkError):
        nl.peek(bytes(nl.MAX_DATAGRAM + 1))                    # oversize: refused before any parsing
    with pytest.raises(nl.LinkError):
        nl.verify(bytes(32), good)
    # a datagram whose LENGTH field lies about its payload
    head = bytearray(good)
    head[6] ^= 1
    with pytest.raises(nl.LinkError):
        nl.peek(bytes(head))


def test_the_counter_is_64_bit_and_cannot_wrap_into_a_fresh_one():
    """Rollover: 2^64 - 1 round-trips; one more is masked to 0, which every receiver
    drops as "not above the last" (a replay), never a new command. At one datagram a
    millisecond the counter needs 584 million years to get there."""
    top = nl.verify(KEY, nl.pack(KEY, nl.Kind.CMD, 1, 2 ** 64 - 1))
    assert top.counter == 2 ** 64 - 1
    assert nl.verify(KEY, nl.pack(KEY, nl.Kind.CMD, 1, 2 ** 64)).counter == 0
    r = nl.Reorderer(clock=lambda: 0.0)
    assert r.push(2 ** 64 - 2, b"a") == [b"a"]
    assert r.push(0, b"wrapped") == [] and r.stats.late == 1


def test_the_reorderer_delivers_each_counter_once_and_in_order():
    """Property: random reordering, duplicates and replays of earlier counters."""
    for seed in range(40):
        rng = np.random.default_rng(seed)
        t = [0.0]
        r = nl.Reorderer(window=8, wait_s=0.05, clock=lambda: t[0])
        sent = list(range(1, 120))
        stream = []
        for c in sent:
            stream.append(c)
            if rng.random() < 0.2:
                stream.append(int(rng.integers(1, c + 1)))           # a replay of an earlier one
        for i in range(len(stream) - 1):                             # local swaps
            if rng.random() < 0.15:
                stream[i], stream[i + 1] = stream[i + 1], stream[i]
        out = []
        for c in stream:
            t[0] += 0.001
            out += r.push(c, c.to_bytes(4, "little"))
            if rng.random() < 0.05:
                t[0] += 0.1
                out += r.poll()
        t[0] += 1.0
        out += r.poll()
        got = [int.from_bytes(b, "little") for b in out]
        assert got == sorted(set(got)), seed                        # strictly rising: once each
        assert set(got) <= set(sent), seed


def test_a_replayed_datagram_does_not_keep_a_dead_board_alive():
    """The board goes quiet; someone on the Wi-Fi keeps replaying one of its old DATA
    datagrams from its address. The tag verifies (it IS the board's), the reorderer
    drops it, and the session must still time out so the hub greets the board again."""
    from aankhen.transport import NetSource

    from .fakenet import FakeNetBoard
    board = FakeNetBoard(KEY).start()
    src = NetSource(KEY, ["127.0.0.1"], board_port=board.port, host_port=0, bind_host="127.0.0.1",
                    reconnect_s=5.0, hello_wait_s=0.3, timeout_s=0.6, keepalive_s=0.2)
    src.start()
    try:
        assert src.connected.wait(3)
        sid, ks, peer = src._session
        old = nl.pack(ks, nl.Kind.DATA, sid, 1, board.status_frame())
        board.silent = True
        t0 = time.monotonic()
        while time.monotonic() - t0 < 2.0 and src.net.timeouts == 0:
            board.sock.sendto(old, (peer[0], src.bound_port))
            time.sleep(0.05)
        assert src.net.timeouts >= 1
        assert src.reorder.stats.duplicate + src.reorder.stats.late >= 1 or src._session is None
    finally:
        src.stop()
        board.stop()


# ---------------------------------------------------------------- firmware, read on the host side
def _ino():
    return (FW_DIR / "firmware.ino").read_text(encoding="utf-8")


def _body(text, signature):
    i = text.index(signature)
    j = text.index("\n}\n", i)
    return text[i:j]


def test_firmware_checks_the_tag_before_it_believes_the_counter():
    """A forged datagram with a huge counter must not move rx (that would lock the
    laptop out): tag first, then "counter above the last", then rx = counter."""
    h = _body(_ino(), "static void linkHandle(")
    tag, replay, take = h.index("linkTagOk("), h.index("h->counter <= s->rx"), h.index("s->rx = h->counter")
    assert tag < replay < take
    assert "n > LINK_DGRAM_MAX" in h                                   # oversize refused first
    assert "ip != s->ip || port != s->port" in h                       # only the session's peer
    assert "linkBad++" in h[h.index("LK_KEEPALIVE && h->kind != LK_BYE"):]  # WELCOME/DATA never accepted


def test_firmware_boots_every_relay_off_before_the_network_starts():
    ino = _ino()
    init = _body(ino, "static void initRelay(")
    assert init.index("digitalWrite(") < init.index("pinMode(")    # off level latched before OUTPUT
    assert "r.on = false" in init
    setup = _body(ino, "void setup()")
    # 3.6.0: startWifi() returns at once and loop() finishes the join, so relays are off first
    assert setup.index("bootRelays()") < setup.index("startWifi()") < setup.index("startHttp()")
    boot = _body(ino, "static const char *bootRelays()")
    # kept ON only across a software reset that the OTA path marked: never a power cut
    assert "esp_reset_reason() == ESP_RST_SW && relayKeepMagic == RELAY_KEEP_MAGIC" in boot
    assert "relayKeepMagic = 0" in boot


def test_the_only_relay_paths_without_hmac_are_compiled_out_by_default():
    """HTTP /relay needs RELAY_TOKEN_VALUE and MQTT needs a broker login; the example
    secrets leave both off, so a board flashed from it switches only over USB or the
    signed link. (Both, when enabled, are replayable on the LAN: see the audit note.)"""
    ino = _ino()
    relay_route = ino.index('http.on("/relay"')
    assert ino.rfind("#ifdef RELAY_TOKEN_VALUE", 0, relay_route) > ino.rfind("#endif", 0, relay_route)
    assert "#if defined(MQTT_URI_VALUE) && defined(MQTT_USER_VALUE)" in _body(ino, "static void startMqtt()")
    ex = (FW_DIR / "secrets.example.h").read_text(encoding="utf-8")
    for name in ("RELAY_TOKEN_VALUE", "MQTT_URI_VALUE", "MQTT_USER_VALUE", "LINK_KEY_VALUE", "OTA_PASS_VALUE"):
        assert not re.search(rf"^\s*#define {name}\b", ex, re.M), name
