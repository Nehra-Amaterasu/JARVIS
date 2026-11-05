"""Firmware 3.8.0: the brownout policy, last-tap-wins and the board's HTTP rules, pinned in
the source. 3.7.2 re-energised every saved relay inside setup() after any reset, so each
brownout switched back on the coils that caused it (a reboot loop, 5-6 Nov 2026). These
checks read firmware.ino and config.h; the board itself is tested by the soak.
"""
import re
from pathlib import Path

FW_DIR = Path(__file__).resolve().parents[1] / "firmware"
INO = (FW_DIR / "firmware.ino").read_text(encoding="utf-8")
CFG = (FW_DIR / "config.h").read_text(encoding="utf-8")


def _body(name: str) -> str:
    """The body of a C function in firmware.ino, by brace counting."""
    m = re.search(rf"\n(?:static )?[\w\s\*]*\b{name}\([^)]*\)\s*\{{", INO)
    assert m, name
    i, depth = m.end(), 1
    while depth:
        depth += {"{": 1, "}": -1}.get(INO[i], 0)
        i += 1
    return INO[m.end():i - 1]


def _define(text: str, name: str) -> int:
    return int(re.search(rf"#define {name} (-?\d+)", text).group(1))


def test_nothing_is_energised_inside_setup():
    for fn in ("setup", "bootPower"):
        body = _body(fn)
        assert "applyRelay(" not in body and "setRelay(" not in body and "delay(1" not in body, fn
    assert "bootRelays" not in INO and "relayKeepMagic" not in INO


def test_brownout_boots_off_and_waits_for_wifi_then_restores_slowly():
    boot = _body("bootPower")
    assert "ESP_RST_POWERON" in boot and "memset(&rtcKeep, 0" in boot
    brown = boot[boot.index("ESP_RST_BROWNOUT"):boot.index("ESP_RST_SW")]
    assert "restoreNeedsWifi = true" in brown and "RESTORE_GAP_MS" in brown
    assert "rtcKeep.armed" in brown and "rtcKeep.safe = 1" in brown       # second brownout -> safe
    assert _define(INO, "RESTORE_WIFI_MS") == 10000
    assert _define(INO, "RESTORE_GAP_MS") == 600
    assert _define(INO, "RESTORE_ARM_MS") == 120000
    tick = _body("powerTick")
    assert "RESTORE_WIFI_MS" in tick and "restoreGapMs" in tick and "RESTORE_ARM_MS" in tick


def test_safe_mode_is_left_only_by_the_app_command():
    assert INO.count("leaveSafeMode()") == 2                               # defined once, called once
    cmd = _body("handleCommand")
    assert '"\\"power\\""' in cmd and '"normal"' in cmd and "leaveSafeMode();" in cmd


def test_last_tap_wins():
    set_ = _body("setRelay")
    assert "r.target = on" in set_ and "relayTaps++" in set_
    assert "if (!on && r.on) applyRelay(r, false)" in set_                 # OFF at once
    assert "applyRelay(r, true)" not in set_                               # ON never directly
    pump = _body("pumpRelays")
    assert "RELAY_SETTLE_MS" in pump and "RELAY_STAGGER_MS" in pump and "return;" in pump
    assert _define(INO, "RELAY_SETTLE_MS") == 250
    assert "!r.target" in _body("handleCommand") and "!r->target" in _body("onRelay")
    assert "!r->on" not in INO and "!r.on : " not in INO                  # toggle never reads the coil


def test_relay_http_is_post_only_with_a_token_and_never_open():
    http = _body("startHttp")
    assert 'http.on("/relay", HTTP_POST, onRelay)' in http
    assert 'http.on("/relay", HTTP_GET' not in http and "405" in http
    relay = _body("onRelay")
    assert "#ifndef RELAY_TOKEN_VALUE" in relay and "503" in relay and "tokenOk()" in relay
    assert '\\"target\\"' in relay and '\\"on\\"' in relay
    assert "Access-Control-Allow-Origin" not in INO


def test_public_status_has_no_relays():
    status = _body("onStatus")
    public = status[status.index("#endif"):]
    assert "relays" not in public and "buildStatus" not in public and '\\"full\\":false' in public


def test_config_for_the_wall_box():
    assert _define(CFG, "RELAY_LIGHT6_PIN") == -1 and _define(CFG, "RELAY_LIGHT7_PIN") == -1
    assert _define(CFG, "CSI_RATE_HZ") == 200
    assert _define(CFG, "WIFI_PIN_BSSID") == 1
    assert _define(CFG, "WIFI_FALLBACK_AFTER_S") == 45 and _define(CFG, "WIFI_PRIMARY_RETRY_S") == 60
    assert "WIFI_POWER_15dBm" in _body("startWifi")
