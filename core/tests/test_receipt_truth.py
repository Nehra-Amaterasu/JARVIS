"""A switch receipt is true only when the board confirmed it (audit 10-23).

The app's Limbs answer carries `delivered` per device: True only when the board's own
reply (Uno state line, ESP32 STATUS) showed the new state. A receipt built from that
answer must fail when a relay was not confirmed and a board is linked, or the honesty
guard would back "I've switched on Deep focus" while a relay never moved.
"""
from tools import honesty
from tools.builtin import ToolContext, default_registry, set_device, set_scene

REG = default_registry()


def _ctx(post_reply, usb=True):
    calls = []

    def http(method, path, body, timeout):
        calls.append((method, path, body))
        if method == "GET" and path == "/api/limbs":
            return 200, {"usb": usb, "devices": []}
        return 200, post_reply

    return ToolContext(http=http), calls


def test_a_mode_the_board_did_not_confirm_is_a_failed_receipt():
    reply = {"changed": ["light", "fan"], "delivered": {"light": True, "fan": False},
             "state": {"light": {"on": True}, "fan": {"on": False}},
             "mode": {"id": "focus", "name": "Deep focus", "resolved": ["light", "fan"]}}
    ctx, _ = _ctx(reply)
    r = set_scene(ctx, "focus")
    assert r.ok is False and r.error == "relay not delivered"
    assert "did not take it for fan" in r.did and "The fan is off" in r.did
    # and the guard does not let the model claim it
    said = "I've switched on the focus mode for you."
    assert honesty.unbacked(said, REG, [r])
    assert "did not take it for fan" in honesty.check(said, REG, [r])


def test_a_mode_every_relay_confirmed_backs_the_claim():
    reply = {"changed": ["light", "fan"], "delivered": {"light": True, "fan": True},
             "state": {"light": {"on": True}, "fan": {"on": True}},
             "mode": {"id": "focus", "name": "Deep focus", "resolved": ["light", "fan"]}}
    ctx, _ = _ctx(reply)
    r = set_scene(ctx, "focus")
    assert r.ok and not r.simulated and "switch" in r.backs
    assert honesty.unbacked("I've switched on the focus mode for you.", REG, [r]) == []


def test_a_device_the_board_did_not_confirm_is_a_failed_receipt():
    reply = {"changed": ["light"], "delivered": {"light": False}, "state": {"light": {"on": False}}}
    ctx, calls = _ctx(reply)
    r = set_device(ctx, "light", "on")
    assert ("POST", "/api/limbs/light", {"action": "on", "value": None}) in calls
    assert r.ok is False and "did not take it" in r.did
    assert honesty.unbacked("I've turned the light on.", REG, [r])


def test_without_a_board_the_receipt_says_virtual_room():
    """No board linked: the switch is the virtual room's, said once at the end."""
    reply = {"changed": ["light"], "delivered": {"light": False}, "state": {"light": {"on": True}}}
    ctx, _ = _ctx(reply, usb=False)
    r = set_device(ctx, "light", "on")
    assert r.ok and r.simulated and "Virtual room only" in r.did
    out = honesty.check("I've turned the light on.", REG, [r])
    assert out.endswith(honesty.SIM_NOTE["switch"])
