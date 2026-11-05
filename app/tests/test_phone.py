"""Phone access (phone.py, routes_phone.py): off by default, its own listener and rules.

One TestClient plays both sides. Requests to http://192.168.1.50:8778 arrive with that
server address in the ASGI scope, which is exactly how a request on the phone listener
looks; requests to http://testserver are the desktop window (token header)."""
import json
import socket

import httpx
import pytest
from starlette.testclient import TestClient

from jarvis_app import phone
from jarvis_app.desktop import free_port
from jarvis_app.security import Guard
from jarvis_app.server import create_app

TOKEN = "desk-token-123456"
LAN = "192.168.1.50"
PHONE = f"http://{LAN}:8778"
DESK = "http://testserver"
WS = f"ws://{LAN}:8778"                     # websocket_connect needs the full address
D = {"X-Jarvis-Token": TOKEN}
P = {"X-Jarvis-Phone": "1"}


@pytest.fixture
def setup(tmp_path, monkeypatch):
    monkeypatch.delenv("JARVIS_PHONE", raising=False)
    monkeypatch.delenv("JARVIS_PHONE_PORT", raising=False)
    monkeypatch.setattr(phone, "CONFIG_FILE", tmp_path / "config.json")
    monkeypatch.setattr(phone, "DEVICES_FILE", tmp_path / "devices.json")
    monkeypatch.setattr(phone, "INBOX", tmp_path / "inbox")
    guard = Guard(8777, TOKEN, extra_hosts=["testserver"])
    app = create_app(guard, autostart_aankhen="off", features=['phone', 'security'])
    access = app.state.phone
    access.config_path = tmp_path / "config.json"
    access.devices = phone.DeviceStore(tmp_path / "devices.json")
    access.addresses_fn = lambda: [LAN]
    access.listen = False                       # the rules, without opening a real socket
    with TestClient(app, base_url=PHONE, client=("192.168.1.20", 50123)) as c:
        yield c, app, access, tmp_path


def enable(c):
    r = c.put(f"{DESK}/api/remote", headers=D, json={"enabled": True})
    assert r.status_code == 200, r.text
    return r.json()


def pair(c, name="OnePlus Nord 5"):
    code = c.post(f"{DESK}/api/remote/pair", headers=D, json={}).json()["code"]
    return c.post("/api/phone/pair", headers=P, json={"code": code, "name": name})


# ---------------------------------------------------------------- off by default
def test_phone_access_is_off_by_default_and_refuses_everything(setup):
    c, app, access, _ = setup
    v = c.get(f"{DESK}/api/remote", headers=D).json()
    assert v["enabled"] is False and v["running"] is False and v["listening_on"] == []
    assert phone.PhoneConfig().enabled is False
    assert c.get("/phone").status_code == 403
    assert c.get("/api/phone/state").json() == {"error": "phone access is off"}
    # pairing cannot even start
    assert c.post(f"{DESK}/api/remote/pair", headers=D, json={}).status_code == 409


def test_env_override_forces_it_either_way(setup, monkeypatch):
    c, app, access, _ = setup
    monkeypatch.setenv("JARVIS_PHONE", "1")
    assert access.enabled and c.get("/phone").status_code == 200
    enable(c)
    monkeypatch.setenv("JARVIS_PHONE", "0")
    assert not access.enabled and c.get("/phone").status_code == 403


def test_the_listener_really_binds_only_when_switched_on(setup):
    c, app, access, _ = setup
    access.listen = True
    port = free_port(18800)
    r = c.put(f"{DESK}/api/remote", headers=D, json={"enabled": True, "bind": "127.0.0.1", "port": port})
    v = r.json()
    try:
        assert v["running"] and v["listening_on"] == ["127.0.0.1"], v
        page = httpx.get(f"http://127.0.0.1:{port}/phone", timeout=5)
        assert page.status_code == 200 and "JARVIS" in page.text
        assert "frame-ancestors 'none'" in page.headers["content-security-policy"]
        assert httpx.get(f"http://127.0.0.1:{port}/api/phone/state", timeout=5).status_code == 401
        # the desktop's routes do not exist on the phone listener, token or not
        assert httpx.get(f"http://127.0.0.1:{port}/api/core", headers=D, timeout=5).status_code == 404
        assert httpx.get(f"http://127.0.0.1:{port}/api/memory/stats", headers=D, timeout=5).status_code == 404
    finally:
        v = c.put(f"{DESK}/api/remote", headers=D, json={"enabled": False}).json()
    assert not v["running"]
    with socket.socket() as s:                       # the port is free again: nothing listens
        s.bind(("127.0.0.1", port))


def test_the_desktop_never_takes_the_phone_port():
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        busy = s.getsockname()[1]
        assert free_port(busy, avoid=(busy + 1,)) not in (busy, busy + 1)


# ---------------------------------------------------------------- the host guard
def test_host_guard_accepts_the_lan_address_and_nothing_else(setup):
    c, app, access, _ = setup
    enable(c)
    assert c.get("/phone").status_code == 200
    assert c.get("/phone", headers={"Host": "evil.example:8778"}).status_code == 403
    assert c.get("/phone", headers={"Host": "127.0.0.1:8777"}).status_code == 403   # desktop host, wrong listener
    assert c.get("/", follow_redirects=False).headers["location"] == "/phone"
    # only the phone's routes exist here; the desktop token opens nothing on this listener
    for path in ("/api/core", "/api/memory/stats", "/api/remote", "/api/security", "/api/kv"):
        assert c.get(path, headers=D).status_code == 404, path
    # a peer outside the home network is refused even with the right Host
    with TestClient(app, base_url=PHONE, client=("8.8.8.8", 4000)) as outsider:
        assert outsider.get("/phone").status_code == 403
    # the desktop window is untouched
    assert c.get(f"{DESK}/api/core", headers=D).status_code == 200
    assert c.get(f"{DESK}/api/core", headers={"X-Jarvis-Token": "nope"}).status_code == 401


def test_a_tailscale_name_he_adds_is_accepted(setup):
    c, app, access, _ = setup
    v = c.put(f"{DESK}/api/remote", headers=D,
              json={"enabled": True, "urls": ["https://jarvis.tail1234.ts.net/"]}).json()
    assert v["urls"] == ["https://jarvis.tail1234.ts.net"]
    assert v["open_at"][0] == "https://jarvis.tail1234.ts.net/phone" and v["mic_ready"]
    assert c.get("/phone", headers={"Host": "jarvis.tail1234.ts.net"}).status_code == 200
    assert c.put(f"{DESK}/api/remote", headers=D, json={"urls": ["javascript:alert(1)"]}).status_code == 400
    assert c.put(f"{DESK}/api/remote", headers=D, json={"port": 8777}).status_code == 400   # the desktop's own


# ---------------------------------------------------------------- pairing
def test_pairing_gives_an_httponly_cookie_and_stores_only_a_hash(setup):
    c, app, access, tmp = setup
    enable(c)
    d = c.post(f"{DESK}/api/remote/pair", headers=D, json={}).json()
    assert d["link"].startswith(f"{PHONE}/phone#pair=") and d["qr_svg"].startswith("<svg")
    assert len(d["code"]) == 9 and d["expires_in"] > 250
    r = c.post("/api/phone/pair", headers=P, json={"code": d["code"].lower(), "name": "Nord <b>5</b>"})
    assert r.status_code == 200, r.text
    cookie = r.headers["set-cookie"]
    assert "HttpOnly" in cookie and "SameSite=strict" in cookie.replace("Strict", "strict")
    token = cookie.split(";")[0].split("=", 1)[1]
    assert r.json()["device"]["name"] == "Nord b5/b"
    stored = (tmp / "devices.json").read_text()
    assert token not in stored and phone._hash(token) in stored
    s = c.get("/api/phone/state").json()
    assert s["device"]["name"] == "Nord b5/b" and [x["id"] for x in s["limbs"]["devices"]] == ["light", "fan"]
    # one use only
    assert c.post("/api/phone/pair", headers=P, json={"code": d["code"]}).status_code == 400
    assert [x["name"] for x in c.get(f"{DESK}/api/remote", headers=D).json()["devices"]] == ["Nord b5/b"]


def test_wrong_codes_burn_the_code_and_tries_are_rate_limited(setup):
    c, app, access, _ = setup
    enable(c)
    code = c.post(f"{DESK}/api/remote/pair", headers=D, json={}).json()["code"]
    for _ in range(5):
        assert c.post("/api/phone/pair", headers=P, json={"code": "WRONG-CODE"}).status_code == 400
    # burned after 5 misses: even the right code fails now
    assert c.post("/api/phone/pair", headers=P, json={"code": code}).status_code == 400
    # and the 7th try in a minute from one address is not even looked at
    assert c.post("/api/phone/pair", headers=P, json={"code": code}).status_code == 429


def test_pairing_codes_expire():
    now = [1000.0]
    p = phone.Pairing(ttl=300, clock=lambda: now[0])
    code = p.start()
    now[0] += 301
    assert not p.redeem(code) and not p.active()


# ---------------------------------------------------------------- revoke
def test_revoking_a_phone_ends_it_at_once_including_its_socket(setup):
    c, app, access, _ = setup
    enable(c)
    dev = pair(c).json()["device"]
    with c.websocket_connect(WS + "/ws/phone", headers={"origin": PHONE}) as ws:
        hello = ws.receive_json()
        assert hello["kind"] == "hello" and hello["device"]["id"] == dev["id"]
        r = c.delete(f"{DESK}/api/remote/devices/{dev['id']}", headers=D)
        assert r.status_code == 200 and r.json()["devices"] == []
        with pytest.raises(Exception):
            for _ in range(20):
                ws.receive_json()
    assert c.get("/api/phone/state").status_code == 401
    assert c.delete(f"{DESK}/api/remote/devices/{dev['id']}", headers=D).status_code == 404


def test_websocket_needs_same_origin_and_a_paired_phone(setup):
    c, app, access, _ = setup
    enable(c)
    with pytest.raises(Exception):
        with c.websocket_connect(WS + "/ws/phone", headers={"origin": PHONE}) as ws:
            ws.receive_json()                                   # not paired
    pair(c)
    with pytest.raises(Exception):
        with c.websocket_connect(WS + "/ws/phone", headers={"origin": "http://evil.example"}) as ws:
            ws.receive_json()                                   # cross-site WebSocket hijacking
    # the desktop's own event stream refuses the phone listener, whatever the token
    with pytest.raises(Exception):
        with c.websocket_connect(f"{WS}/ws/events?t={TOKEN}") as ws:
            ws.receive_json()


def test_a_phone_can_forget_itself(setup):
    c, app, access, _ = setup
    enable(c)
    pair(c)
    assert c.post("/api/phone/unpair", headers=P).status_code == 200
    assert access.devices.list() == []


# ---------------------------------------------------------------- CSRF + what a phone can do
def test_changes_need_the_header_and_a_matching_origin(setup):
    c, app, access, _ = setup
    enable(c)
    pair(c)
    assert c.post("/api/phone/limbs/light", json={"action": "on"}).status_code == 403
    r = c.post("/api/phone/limbs/light", headers={**P, "Origin": "http://evil.example"}, json={"action": "on"})
    assert r.status_code == 403
    r = c.post("/api/phone/limbs/light", headers={**P, "Origin": PHONE}, json={"action": "on"})
    assert r.status_code == 200


def test_the_phone_switches_through_limbs_the_only_writer(setup):
    c, app, access, _ = setup
    enable(c)
    pair(c)
    c.post("/api/phone/limbs/light", headers=P, json={"action": "off"})
    seen = []
    app.state.svc.limbs.add_listener(seen.append)
    r = c.post("/api/phone/limbs/light", headers=P, json={"action": "on"})
    assert r.status_code == 200 and r.json()["limbs"]["devices"][0]["state"]["on"] is True
    assert seen[-1]["device"] == "light" and seen[-1]["origin"] == "phone"
    desk = c.get(f"{DESK}/api/limbs", headers=D).json()
    assert desk["devices"][0]["state"]["on"] is True
    assert c.post("/api/phone/limbs/light", headers=P, json={"action": "off"}).json()["limbs"]["devices"][0]["state"]["on"] is False
    assert c.post("/api/phone/limbs/toaster", headers=P, json={"action": "on"}).status_code == 400
    assert c.post("/api/phone/scene/sleep", headers=P).status_code == 200


def test_say_needs_jarvis_awake(setup):
    c, app, access, _ = setup
    enable(c)
    pair(c)
    r = c.post("/api/phone/say", headers=P, json={"text": "light on"})
    assert r.status_code == 409 and "wake him" in r.json()["detail"]


def test_a_voice_clip_goes_to_jarvis_whisper_in_voice_mode_only(setup, monkeypatch):
    c, app, access, tmp = setup
    enable(c)
    pair(c)
    core = app.state.svc.core
    clip = b"\x1aE\xdf\xa3" + b"\0" * 400                        # a webm header and some bytes
    r = c.post("/api/phone/hear", headers={**P, "Content-Type": "audio/webm;codecs=opus"}, content=clip)
    assert r.status_code == 409 and "asleep" in r.json()["detail"]
    sent = []
    with monkeypatch.context() as m:              # undone before the app shuts down
        m.setattr(type(core), "running", property(lambda self: True))
        m.setattr(core, "_send", sent.append)
        _clip_checks(c, core, clip, sent, tmp)


def _clip_checks(c, core, clip, sent, tmp):
    core.mode = "text"
    r = c.post("/api/phone/hear", headers={**P, "Content-Type": "audio/webm"}, content=clip)
    assert r.status_code == 409 and "text mode" in r.json()["detail"]
    core.mode = "voice"
    r = c.post("/api/phone/hear", headers={**P, "Content-Type": "audio/webm;codecs=opus"}, content=clip)
    assert r.status_code == 200, r.text
    assert sent[-1]["type"] == "hear" and sent[-1]["id"] == r.json()["clip"]
    path = sent[-1]["path"]
    assert path.endswith(".webm") and open(path, "rb").read() == clip and str(tmp / "inbox") in path
    assert c.post("/api/phone/hear", headers={**P, "Content-Type": "text/plain"}, content=clip).status_code == 415
    big = b"\0" * (8 * 2**20 + 1)
    assert c.post("/api/phone/hear", headers={**P, "Content-Type": "audio/webm"}, content=big).status_code == 413
    core.mode = None


def test_what_jarvis_heard_reaches_the_phone(setup):
    c, app, access, _ = setup
    enable(c)
    pair(c)
    with c.websocket_connect(WS + "/ws/phone", headers={"origin": PHONE}) as ws:
        ws.receive_json()
        app.state.svc.core._on_event({"kind": "phone_heard", "id": "abc", "text": "light on"})
        ev = ws.receive_json()
        assert ev["source"] == "phone" and ev["kind"] == "heard" and ev["heard"] == "light on"


def test_firewall_command_is_one_line_for_the_private_profile():
    cmd = phone.firewall_command(8778)
    assert "\n" not in cmd and "-LocalPort 8778" in cmd and "-Profile Private" in cmd
    assert "-RemoteAddress LocalSubnet" in cmd and cmd.startswith("New-NetFirewallRule")


def test_private_address_rules():
    assert phone.is_private("192.168.1.20") and phone.is_private("100.101.102.103")
    assert phone.is_private("127.0.0.1") and phone.is_private("::ffff:192.168.1.4")
    assert not phone.is_private("8.8.8.8") and not phone.is_private("testclient")
    assert phone.bindable("192.168.0.4") and not phone.bindable("8.8.8.8") and not phone.bindable("127.0.0.1")


# ---------------------------------------------------------------- Cloudflare tunnel (mobile data)
TUNNEL = "https://jarvis.example.com"
JWT = {"Cf-Access-Jwt-Assertion": "eyJ.signed.by-access"}


def test_a_named_tunnel_is_allowed_only_behind_cloudflare_access(setup):
    c, app, access, _ = setup
    v = c.put(f"{DESK}/api/remote", headers=D, json={"enabled": True, "tunnel": TUNNEL + "/"}).json()
    assert v["tunnel"] == TUNNEL and v["open_at"][0] == TUNNEL + "/phone" and v["mic_ready"]
    host = {"Host": "jarvis.example.com"}
    # without the Access login header: refused, so a tunnel with no Access policy fails closed
    assert c.get("/phone", headers=host).status_code == 403
    assert c.get("/api/phone/state", headers=host).json() == {"error": "the tunnel must sit behind a Cloudflare Access login"}
    # with it: the page loads, and the phone still needs pairing behind it
    assert c.get("/phone", headers={**host, **JWT}).status_code == 200
    assert c.get("/phone", headers={"Host": "jarvis.example.com:443", **JWT}).status_code == 200
    assert c.get("/api/phone/state", headers={**host, **JWT}).status_code == 401
    # cloudflared reaches the listener from loopback: a private peer, same rules
    assert access.check(method="GET", path="/api/phone/state", host="jarvis.example.com", client="127.0.0.1",
                        origin=None, header=None, cookies={}, access_jwt="x")[0] == 401
    # the LAN address does not need the Access header (home Wi-Fi), other hosts stay refused
    assert c.get("/phone").status_code == 200
    assert c.get("/phone", headers={"Host": "evil.example.com", **JWT}).status_code == 403


def test_the_tunnel_websocket_needs_the_access_header_too(setup):
    c, app, access, _ = setup
    c.put(f"{DESK}/api/remote", headers=D, json={"enabled": True, "tunnel": TUNNEL})
    pair(c)
    cookies = dict(c.cookies)
    kw = dict(host="jarvis.example.com", client="127.0.0.1", origin=TUNNEL, cookies=cookies)
    assert access.ws_check(**kw) is None
    assert access.ws_check(**kw, access_jwt="x") is not None
    assert access.ws_check(**{**kw, "origin": "https://evil.example.com"}, access_jwt="x") is None


def test_quick_tunnels_plain_http_and_ports_are_refused(setup):
    c, app, access, _ = setup
    for bad in ("https://random-words.trycloudflare.com", "http://jarvis.example.com",
                "https://jarvis.example.com:8443", "javascript:alert(1)"):
        assert c.put(f"{DESK}/api/remote", headers=D, json={"tunnel": bad}).status_code == 400, bad


def test_cloudflared_points_at_the_phone_listener_and_never_the_desktop(setup):
    c, app, access, _ = setup
    v = c.put(f"{DESK}/api/remote", headers=D, json={"enabled": True, "tunnel": TUNNEL}).json()
    yml = v["cloudflared_yml"]
    assert "service: http://127.0.0.1:8778" in yml and ":8777" not in yml
    assert "hostname: jarvis.example.com" in yml and "httpHostHeader: jarvis.example.com" in yml
    assert "required: true" in yml and yml.rstrip().endswith("service: http_status:404")
    with pytest.raises(ValueError, match="never the desktop"):
        phone.cloudflared_config(TUNNEL, 8777, 8777)


def test_cookie_is_secure_through_the_tunnel(setup):
    c, app, access, _ = setup
    c.put(f"{DESK}/api/remote", headers=D, json={"enabled": True, "tunnel": TUNNEL})
    code = c.post(f"{DESK}/api/remote/pair", headers=D, json={"url": TUNNEL}).json()["code"]
    with TestClient(app, base_url="http://jarvis.example.com:8778", client=("127.0.0.1", 50124)) as t:
        r = t.post("/api/phone/pair", json={"code": code, "name": "Phone"},
                   headers={**P, **JWT, "Host": "jarvis.example.com", "X-Forwarded-Proto": "https",
                            "Origin": TUNNEL})
    # The server address in this scope is jarvis.example.com:8778, the phone port: the phone listener.
    assert r.status_code == 200, r.text
    assert "secure" in r.headers["set-cookie"].lower() and "httponly" in r.headers["set-cookie"].lower()


# ---------------------------------------------------------------- one app: shared relays view, real data only
def test_the_shared_relays_files_are_served_on_the_phone_listener(setup):
    c, app, access, _ = setup
    enable(c)
    js = c.get("/phone/relays.js")
    assert js.status_code == 200 and "RelayPanel" in js.text and "javascript" in js.headers["content-type"]
    assert c.get("/phone/relays.css").status_code == 200
    assert c.get("/phone/board.html").status_code == 404          # the board's template is not served
    page = c.get("/phone").text
    assert "RADAR" not in page and "Relays only" in page and "Pair with JARVIS" in page


def test_phone_state_reports_only_what_aankhen_really_has(setup):
    c, app, access, _ = setup
    enable(c)
    pair(c)
    s = c.get("/api/phone/state", headers=P).json()
    a = s["aankhen"]
    assert a is None or set(a) == {"source", "presence", "motion", "guess", "people", "link"}
    for d in s["limbs"]["devices"]:
        assert {"hardware_on", "confirmed", "link", "channel"} <= set(d)
        if d["link"] == "virtual":
            assert d["confirmed"] is False                       # no board, nothing confirmed


# ---------------------------------------------------------------- power-safe mode (firmware 3.8.0)
class _FakeHub:
    def __init__(self, status, result):
        self.status, self.result, self.calls = status, result, 0

    def device_status(self):
        return self.status

    def clear_power_safe(self, timeout_s=1.2):
        self.calls += 1
        if self.result[0]:
            self.status = {**self.status, "power": "normal", "power_why": None}
        return self.result

    def snapshot(self):
        return {}

    def link(self):
        return {}

    def __getattr__(self, name):              # stop(), etc.: whatever the app calls at shutdown
        return lambda *a, **k: None


def test_power_safe_mode_is_shown_and_cleared_through_jarvis_only(setup, monkeypatch):
    c, app, access, _ = setup
    enable(c)
    pair(c)
    hub = _FakeHub({"power": "safe", "power_why": "repeat brownout", "brownouts": 2}, (True, ""))
    monkeypatch.setattr(app.state.svc, "hub", hub, raising=False)
    s = c.get("/api/phone/state", headers=P).json()
    assert s["board_power"] == {"power": "safe", "why": "repeat brownout", "brownouts": 2}
    assert c.post("/api/phone/power/normal").status_code == 403          # CSRF header needed
    r = c.post("/api/phone/power/normal", headers=P)
    assert r.status_code == 200 and r.json() == {"power": "normal"} and hub.calls == 1
    assert c.get("/api/phone/state", headers=P).json()["board_power"]["power"] == "normal"
    page = c.get("/phone").text
    assert 'id="powerSafe"' in page and "browned out twice" in page


def test_power_safe_refusals_say_why_and_old_boards_show_nothing(setup, monkeypatch):
    c, app, access, _ = setup
    enable(c)
    pair(c)
    hub = _FakeHub({"relays": {"light": False}}, (False, "the board runs firmware before 3.8.0"))
    monkeypatch.setattr(app.state.svc, "hub", hub, raising=False)
    assert c.get("/api/phone/state", headers=P).json()["board_power"] is None   # no "power" field
    r = c.post("/api/phone/power/normal", headers=P)
    assert r.status_code == 409 and "before 3.8.0" in r.json()["detail"]
    c.post("/api/phone/unpair", headers=P)
    assert c.post("/api/phone/power/normal", headers=P).status_code == 401      # paired phones only
