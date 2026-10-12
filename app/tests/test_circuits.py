"""The switchboard model, and the rule that an AC, a geyser, a heater or anything over
5.6 A never goes on a 7 A relay — enforced in code whatever the config says."""
import copy
import json

import pytest

from jarvis_app.bus import EventBus
from jarvis_app.circuits import (EXAMPLE_FILE, SAFE_CURRENT_A, RelaySafetyError, load_circuits,
                                 parse_config)
from jarvis_app.limbs import Limbs

from test_limbs import FakeCore, FakeHub


def _example() -> dict:
    return json.loads(EXAMPLE_FILE.read_text(encoding="utf-8"))


def _with(*circuits, channels=12) -> dict:
    return {"relay_channels": channels, "circuits": list(circuits)}


def _c(cid, kind="light", watts=20, relay=None, **kw) -> dict:
    return {"id": cid, "name": f"{cid} name", "room": "bedroom", "kind": kind, "rated_w": watts,
            "relay": relay, **kw}


def test_the_example_is_a_valid_switchboard():
    cs = parse_config(_example(), "example")
    assert cs.problems == []
    on_relays = [c for c in cs.circuits if c.relay is not None]
    assert [c.id for c in on_relays] == ["L1", "L2", "L3", "L4", "L5", "L6", "L7", "L8", "F1"]
    assert len({c.relay for c in on_relays}) == 9                  # nine circuits, no channel twice
    assert cs.by_alias("light").id == "L1" and cs.by_alias("fan").id == "F1"
    assert all(c.relay_safe for c in on_relays)
    # The AC and the geyser are tracked, never relayed, and say why.
    for cid in ("AC1", "G1"):
        c = cs.get(cid)
        assert c.relay is None and not c.relay_safe and "never goes on a relay" in c.relay_check()
    assert cs.example is True


@pytest.mark.parametrize("kind,watts", [("geyser", 2000), ("ac", 1500), ("heater", 1000),
                                        ("water_heater", 3000), ("air_conditioner", 900),
                                        ("heater", 200)])        # even a small heater: it is the kind
def test_heat_and_cooling_loads_are_refused_on_a_relay_at_load(kind, watts):
    cs = parse_config(_with(_c("X1", kind, watts, relay=3, safe_7a=True)))   # the config even claims it is safe
    x = cs.get("X1")
    assert x.relay is None and x.requested_relay == 3
    assert "never goes on a relay" in x.refused
    assert cs.problems and cs.problems[0]["id"] == "X1"


def test_anything_over_the_safe_current_is_refused():
    # 1000 W at the conservative power factor 0.8: 5.43 A, inside 5.6 A. 1100 W: 5.98 A, outside.
    cs = parse_config(_with(_c("S1", "socket", 1000, relay=1), _c("S2", "socket", 1100, relay=2)))
    assert cs.get("S1").relay == 1 and cs.get("S1").current_a() < SAFE_CURRENT_A
    s2 = cs.get("S2")
    assert s2.relay is None and "5.6 A" in s2.refused and "6.0 A" in s2.refused


def test_a_real_power_factor_changes_the_verdict():
    """A resistive 1250 W load at pf 1.0 draws 5.43 A — safe; the default pf 0.8 says 6.8 A."""
    assert parse_config(_with(_c("S1", "socket", 1250, relay=1, power_factor=1.0))).get("S1").relay == 1
    assert parse_config(_with(_c("S1", "socket", 1250, relay=1))).get("S1").relay is None


def test_declared_unsafe_bad_channel_and_double_booking_are_refused():
    cs = parse_config(_with(_c("A", relay=1, safe_7a=False), _c("B", relay=13), _c("C", relay=2),
                            _c("D", relay=2)))
    assert "safe_7a: false" in cs.get("A").refused
    assert "does not exist" in cs.get("B").refused
    assert cs.get("C").relay == 2
    assert "already carries C" in cs.get("D").refused


def test_assign_relay_refuses_unsafe_loads_and_saves_nothing(tmp_path):
    cs = parse_config(_example(), "example")
    target = tmp_path / "circuits.json"
    with pytest.raises(RelaySafetyError, match="geyser never goes on a relay"):
        cs.assign_relay("G1", 10, path=target)
    with pytest.raises(RelaySafetyError, match="an AC never goes on a relay"):
        cs.assign_relay("AC1", 1, path=target)        # refused for being an AC before the clash matters
    with pytest.raises(RelaySafetyError, match="already carries L1"):
        cs.assign_relay("L2", 1, path=target)
    with pytest.raises(RelaySafetyError, match="does not exist"):
        cs.assign_relay("L2", 0, path=target)
    assert not target.exists()
    c = cs.assign_relay("L2", 10, path=target)          # a safe load to a free channel: saved
    assert c.relay == 10
    saved = json.loads(target.read_text(encoding="utf-8"))
    assert next(d for d in saved["circuits"] if d["id"] == "L2")["relay"] == 10
    assert saved["from_example"] is True
    assert load_circuits(target).get("L2").relay == 10


def test_a_broken_user_file_falls_back_to_the_example_and_says_so(tmp_path):
    bad = tmp_path / "circuits.json"
    bad.write_text("{not json", encoding="utf-8")
    cs = load_circuits(bad)
    assert cs.source == "example" and "could not be read" in cs.problems[0]["error"]


def test_fan_watts_follow_the_regulator_step_and_lights_ignore_brightness():
    cs = parse_config(_example())
    fan, light = cs.get("F1"), cs.get("L1")
    assert [fan.watts(True, lvl) for lvl in (10, 20, 30, 60, 100)] == [24, 24, 36, 48, 75]
    assert fan.watts(False, 60) == 0
    # On a relay a light is on or off: no dimmer is wired, so 30 % still draws 20 W.
    assert light.watts(True, 30) == 20 and light.watts(False, 30) == 0


def test_limbs_never_drives_a_relay_whose_circuit_was_refused(tmp_path):
    raw = _example()
    raw = copy.deepcopy(raw)
    # Someone wires a room heater to the "light" relay and says so in the config.
    for d in raw["circuits"]:
        if d.get("alias") == "light":
            d.update(kind="heater", rated_w=1200, name="Room heater")
    cs = parse_config(raw)
    assert cs.blocked("light") and "heater" in cs.blocked("light")
    hub, bus = FakeHub(), EventBus()
    limbs = Limbs(FakeCore(), hub, bus, path=tmp_path / "room.json", circuits=cs)
    r = limbs.apply("light", "on")
    assert r["delivered"] == {"light": False}
    assert hub.commands == []                                     # the relay was never touched
    assert any(e["kind"] == "refused" for e in bus.history())
    # The fan's relay is unaffected.
    assert limbs.apply("fan", "on")["delivered"] == {"fan": True}


def test_limbs_view_names_each_device_s_circuit(tmp_path):
    limbs = Limbs(FakeCore(), FakeHub(), EventBus(), path=tmp_path / "room.json",
                  circuits=parse_config(_example(), "example"))
    devices = {d["id"]: d for d in limbs.view()["devices"]}
    assert devices["light"]["circuit"]["id"] == "L1" and devices["light"]["circuit"]["rated_w"] == 20
    assert devices["fan"]["circuit"]["speed_steps"] == 5
