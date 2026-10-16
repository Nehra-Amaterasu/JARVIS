"""The ESP32 Wi-Fi link's settings: the key is made once, kept in the app's private data
folder, given out only on request as the secrets.h line, never in a view or on the bus;
addresses in order; the firewall rule exact; the routes; and AANKHEN_NET=0 (set for every
app test) keeps the hub off the network."""
import json
import re

import pytest
from fastapi.testclient import TestClient

from aankhen import netlink as nl
from jarvis_app.esp32_link import MDNS_NAME, Esp32Link, check_address, enabled, firewall_command
from jarvis_app.paths import DATA, REPO
from jarvis_app.security import Guard

TOKEN = "e" * 32


def test_the_key_is_made_once_and_kept_in_the_private_data_folder(tmp_path):
    link = Esp32Link(path=tmp_path / "esp32_link.json")
    assert link.key(create=False) is None and link.view()["configured"] is False
    k = link.key()
    assert len(k) == 32 and Esp32Link(path=tmp_path / "esp32_link.json").key() == k   # kept, not remade
    assert link.fingerprint() == nl.fingerprint(k)
    from jarvis_app import esp32_link
    assert esp32_link.FILE == DATA / "esp32_link.json"        # the app's data folder: data/app by default
    ignored = (REPO / ".gitignore").read_text(encoding="utf-8").splitlines()
    assert "data/" in ignored                                  # ... which is never tracked


def test_the_secrets_line_is_the_firmware_define_and_the_view_never_holds_the_key(tmp_path):
    link = Esp32Link(path=tmp_path / "l.json")
    line = link.secrets_line()
    m = re.fullmatch(r'#define LINK_KEY_VALUE "([0-9a-f]{64})"', line)
    assert m and nl.parse_key(m.group(1)) == link.key()
    view = json.dumps(link.view())
    assert m.group(1) not in view and link.fingerprint() in view


def test_addresses_come_in_order_typed_last_seen_usb_then_mdns(tmp_path):
    usb = {"ip": "192.168.1.77"}
    link = Esp32Link(path=tmp_path / "l.json", board_ip=lambda: usb["ip"])
    link.key()
    assert link.config().addresses == ["192.168.1.77", MDNS_NAME]
    link.note_peer("192.168.1.80")
    link.set(address="192.168.1.50")
    assert link.config().addresses == ["192.168.1.50", "192.168.1.80", "192.168.1.77", MDNS_NAME]
    assert link.config().configured and link.config().prefer == "auto"
    link.set(prefer="wifi", clear_address=True)
    assert link.config().prefer == "wifi" and link.config().addresses[0] == "192.168.1.80"


@pytest.mark.parametrize("bad", ["8.8.8.8", "127.0.0.1", "0.0.0.0", "224.0.0.1", "evil.example.com", "", "1.2.3"])
def test_only_home_network_addresses_are_accepted(bad):
    with pytest.raises(ValueError):
        check_address(bad)


def test_lan_names_are_accepted():
    assert check_address("Aankhen.local") == "aankhen.local" and check_address("10.0.0.9") == "10.0.0.9"


def test_the_firewall_rule_is_exact_private_and_local_subnet_only():
    assert firewall_command(47270) == (
        'New-NetFirewallRule -DisplayName "JARVIS Aankhen ESP32 link (UDP 47270)" -Direction Inbound '
        '-Protocol UDP -LocalPort 47270 -Profile Private -RemoteAddress LocalSubnet -Action Allow')


def test_the_board_fingerprint_is_compared_not_the_key(tmp_path):
    link = Esp32Link(path=tmp_path / "l.json")
    link.key()
    assert link.view({"net": {"key": link.fingerprint()}})["key_matches"] is True
    assert link.view({"net": {"key": "00000000"}})["key_matches"] is False
    assert link.view(None)["key_matches"] is None


def test_a_new_key_replaces_the_old_one(tmp_path):
    link = Esp32Link(path=tmp_path / "l.json")
    old = link.key()
    link.new_key()
    assert link.key() != old


@pytest.fixture
def client():
    from jarvis_app.server import create_app
    app = create_app(Guard(8782, TOKEN, extra_hosts=["testserver"]), autostart_aankhen="off")
    with TestClient(app) as c:
        c.headers.update({"X-Jarvis-Token": TOKEN})
        yield c


def test_the_tests_keep_the_hub_off_the_network(client):
    assert enabled() is False
    assert client.app.state.svc.hub.net_config is None          # no HELLO can leave in an app test


def test_routes_give_the_line_only_when_asked(client):
    v = client.get("/api/esp32-link").json()
    assert v["configured"] and len(v["fingerprint"]) == 8 and v["firewall"].startswith("New-NetFirewallRule")
    line = client.post("/api/esp32-link/secrets-line").json()["line"]
    hexkey = line.split('"')[1]
    assert len(hexkey) == 64 and hexkey not in json.dumps(v)
    r = client.post("/api/esp32-link/settings", json={"address": "192.168.1.51"})
    assert hexkey not in json.dumps(client.app.state.svc.bus.history(300)) and hexkey not in r.text
    r = client.post("/api/esp32-link/settings", json={"address": "8.8.8.8"})
    assert r.status_code == 400
    r = client.post("/api/esp32-link/settings", json={"address": "192.168.1.50", "prefer": "wifi"})
    assert r.status_code == 200 and r.json()["address"] == "192.168.1.50" and r.json()["prefer"] == "wifi"
    assert client.post("/api/esp32-link/settings", json={"prefer": "bluetooth"}).status_code == 400


def test_the_presence_rule_hangs_on_the_esp32_connect(client):
    svc = client.app.state.svc
    assert svc.presence_on.start in svc.limbs.on_board_connect


def test_connect_over_wifi_without_settings_says_why(client):
    r = client.post("/api/esp32-link/connect", json={"link": "wifi"})
    assert r.status_code == 404 and "no key" in r.json()["detail"]      # AANKHEN_NET=0: the hub has no settings
    assert client.post("/api/esp32-link/connect", json={"link": "carrier pigeon"}).status_code == 400
