"""The tool registry: tiers, receipts, schemas for bind_tools, and the capability
list the persona is built from."""
import pytest

import tools
from tools.builtin import ToolContext, default_registry, say
from tools.registry import CANNOT, Receipt, Registry, Tier, Tool


def test_the_checkout_under_test_is_this_one():
    # jarvis.pth puts the main checkout on sys.path; conftest must win.
    from pathlib import Path
    assert Path(tools.__file__).resolve().parents[2] == Path(__file__).resolve().parents[2]


def test_every_tool_declares_name_schema_tier_and_capability():
    reg = default_registry()
    names = {t.name for t in reg.tools()}
    assert {"get_datetime", "room_state", "presence", "memory_search", "list_reminders", "set_device",
            "set_scene", "set_reminder", "cancel_reminder", "switch_later", "send_message"} <= names
    for t in reg.tools():
        assert t.description and t.capability and isinstance(t.tier, Tier)
        assert set(t.required) <= set(t.params)
        s = t.schema()["function"]
        assert s["name"] == t.name and s["parameters"]["type"] == "object"
    tiers = {t.name: t.tier for t in reg.tools()}
    assert tiers["get_datetime"] == tiers["room_state"] == tiers["presence"] == tiers["memory_search"] == Tier.T0
    assert tiers["set_device"] == tiers["set_reminder"] == tiers["switch_later"] == Tier.T1
    assert tiers["send_message"] == Tier.T2


def test_t3_is_never_registered():
    reg = Registry()
    with pytest.raises(ValueError, match="never registered"):
        reg.register(Tool("transfer_money", "pay someone", {}, (), Tier.T3, lambda ctx: None, "pay"))
    assert reg.get("transfer_money") is None


def test_t2_is_registered_but_off_and_never_bound():
    reg = default_registry()
    msg = reg.get("send_message")
    assert msg is not None and msg.enabled is False
    assert "send_message" not in {s["function"]["name"] for s in reg.schemas()}
    r = reg.call("send_message", {"to": "Mum", "text": "hi"}, ToolContext())
    assert r.ok is False and r.error == "disabled" and "switched off" in r.did
    assert "for you" in r.did                      # said TO him, not about him


def test_t2_can_only_be_switched_on_by_him(monkeypatch):
    monkeypatch.setenv("JARVIS_T2_ENABLED", "send_message")
    reg = default_registry()
    assert reg.get("send_message").enabled is True
    # Enabled, it still sends nothing: there is no message channel, and the receipt says so.
    r = reg.call("send_message", {"to": "Mum", "text": "hi"}, ToolContext())
    assert r.ok is False and "nothing was sent" in r.did


def test_a_receipt_records_what_where_when_and_whether():
    reg = default_registry()
    from datetime import datetime
    r = reg.call("get_datetime", {}, ToolContext(now=lambda: datetime(2026, 10, 12, 21, 5)))
    d = r.to_dict()
    assert d["ok"] is True and d["tool"] == "get_datetime" and d["tier"] == "T0"
    assert d["did"] == "It is 9:05 pm on Monday 12 October 2026." and d["source"] == "the laptop's clock"
    assert isinstance(d["at"], float) and d["backs"] == ["time"]
    assert "RECEIPT get_datetime [T0] OK" in r.for_model()


def test_bad_arguments_and_unknown_tools_are_failed_receipts_not_crashes():
    reg = default_registry()
    ctx = ToolContext()
    assert reg.call("launch_rocket", {}, ctx).error == "unknown tool"
    assert "must be one of" in reg.call("set_device", {"device": "toaster", "action": "on"}, ctx).error
    assert reg.call("set_device", {"device": "fan"}, ctx).error == "missing action"
    assert "at most 100" in reg.call("set_device", {"device": "fan", "action": "set", "value": 400}, ctx).error

    def boom(ctx):
        raise RuntimeError("wire fell out")
    r2 = Registry()
    r2.register(Tool("flaky", "x", {}, (), Tier.T0, boom, "do a flaky thing", backs=("time",)))
    r = r2.call("flaky", {}, ctx)
    assert r.ok is False and "wire fell out" in r.error and r.backs == ()


def test_an_action_the_model_chose_must_be_what_he_asked_for():
    reg = default_registry()
    calls = []
    ctx = ToolContext(http=lambda m, p, b, t: calls.append((m, p)) or (200, {"reminder": {}, "say": "ok"}))
    # First live run: "schedule a call with mum at nine" made the model schedule a room scene.
    r = reg.call("switch_later", {"device": "scene", "action": "focus", "when": "in 30 minutes"}, ctx,
                 asked="schedule a call with mum at nine")
    assert r.ok is False and r.error == "not asked" and calls == []
    assert reg.call("set_reminder", {"text": "call mum", "when": "at nine"}, ctx,
                    asked="schedule a call with mum at nine").ok
    # reads may be guessed at; and a fast path (no `asked`) is not limited
    assert reg.call("get_datetime", {}, ToolContext(), asked="hello").ok
    assert reg.call("switch_later", {"device": "fan", "action": "off", "when": "in 30 minutes"}, ctx).ok


def test_numbers_sent_as_strings_are_accepted():
    class Room:
        state = {"light": {"on": False, "level": 100}, "fan": {"on": False, "level": 60}}

        def apply(self, device, action, value=None):
            self.state[device] = {"on": action != "off", "level": int(value) if value is not None else 60}
    r = default_registry().call("set_device", {"device": "fan", "action": "set", "value": "40"}, ToolContext(room=Room()))
    assert r.ok and r.args["value"] == 40 and "40 percent" in r.did


def test_capability_block_is_generated_from_the_registry():
    reg = default_registry()
    block = reg.capability_block()
    for t in reg.bindable():
        assert f"({t.name})" in block
    assert "send messages or make calls for him" in block.split("switched off")[1]   # T2 listed as off
    cannot = block.split("You cannot:")[1]
    assert "use the internet" in cannot                                # no tool backs this
    assert "play music or videos" not in cannot and "(play_media)" in block   # a tool does, since 10-13
    assert "No money" in block and "RECEIPT" in block
    assert "set reminders" not in block.split("You cannot:")[1]        # a tool exists for that now
    assert reg.capability_block() == block                             # static: Ollama's prefix cache holds


def test_capability_block_follows_the_registry_when_tools_change():
    reg = Registry()
    reg.register(Tool("play_music", "play", {}, (), Tier.T1, lambda ctx: None, "play music", backs=("media",)))
    block = reg.capability_block()
    assert "(play_music)" in block and "play music or videos" not in block
    cannot = block.split("You cannot:")[1]
    for kind, words in CANNOT.items():
        if kind != "media":
            assert words in cannot


def test_wants_tools_binds_on_domains_not_on_chit_chat():
    reg = default_registry()
    for text in ("is the light on?", "what time is it in the evening", "pankha kitna tez hai",
                 "remind me later to call", "is anyone in my room", "search my memory for the exam",
                 "play Blinding Lights", "gaana band karo", "I need some music to focus", "next song"):
        assert reg.wants_tools(text), text
    for text in ("how are you today", "explain setup time", "track my steps", "what is the weather",
                 "tell me a joke about verilog", "let's play chess", "play devil's advocate for me"):
        assert not reg.wants_tools(text), text


def test_a_number_for_a_string_field_is_accepted():
    """The model may send the volume as 30, not "30"."""
    sent = []
    ctx = ToolContext(http=lambda m, p, b, t: (sent.append(b), (200, {"ok": True, "confirmed": True,
                                                                      "say": "Set the volume to about 30 percent."}))[1])
    r = default_registry().call("media_control", {"action": "volume", "value": 30}, ctx)
    assert r.ok and sent == [{"action": "volume", "value": "30"}]


def test_say_merges_receipts_and_says_virtual_once():
    a = Receipt("set_device", "T1", True, "The light is off. Virtual room only; no relay board is connected.",
                "x", simulated=True)
    b = Receipt("set_device", "T1", True, "The fan is off. Virtual room only; no relay board is connected.",
                "x", simulated=True)
    assert say([a, b]) == "The light is off. The fan is off. Virtual room only; no relay board is connected."


def test_presence_from_the_learned_models_says_where_what_and_how_long():
    """No radar: where I am comes from the spatial model, what I am doing from the
    activity model, both said as the sensors' estimate, with the journal's times."""
    from tools.builtin import _learned_presence
    r = _learned_presence({"state": "desk", "p": {"desk": 0.86}, "activity": {"state": "typing"}},
                          {"now": {"zone": "desk", "seconds": 1500},
                           "today": {"zones": {"desk": 4200, "bed": 900, "outside": 300}}})
    assert r.ok and r.backs == ("presence",)
    assert "at your desk" in r.did and "typing" in r.did and "model, 86%" in r.did
    assert "25 min" in r.did and "desk 1 h 10 min" in r.did and "outside" not in r.did.split("Today")[1]
    out = _learned_presence({"state": "outside", "p": {"outside": 0.7}, "activity": {"state": "none"}}, {})
    assert "out of your room" in out.did and "none" not in out.did
