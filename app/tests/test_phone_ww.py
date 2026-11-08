"""Well Wisher behind the phone door (routes_phone_ww.py): the page and its taps exist only
under /phone and /api/phone/*, so the listener's rules apply unchanged: unpaired gets 401,
a paired phone gets the day and can tap a class and a counter."""
import json

import pytest
from starlette.testclient import TestClient

from jarvis_app import phone
from jarvis_app.security import Guard
from jarvis_app.server import create_app

TOKEN = "desk-token-123456"
LAN = "192.168.1.50"
PHONE = f"http://{LAN}:8778"
DESK = "http://testserver"
D = {"X-Jarvis-Token": TOKEN}
P = {"X-Jarvis-Phone": "1"}
DAYS = ("mon", "tue", "wed", "thu", "fri", "sat", "sun")


@pytest.fixture
def setup(tmp_path, monkeypatch):
    monkeypatch.delenv("JARVIS_PHONE", raising=False)
    monkeypatch.delenv("JARVIS_PHONE_PORT", raising=False)
    monkeypatch.setattr(phone, "CONFIG_FILE", tmp_path / "config.json")
    monkeypatch.setattr(phone, "DEVICES_FILE", tmp_path / "devices.json")
    monkeypatch.setattr(phone, "INBOX", tmp_path / "inbox")
    # A class on every weekday, so "today" always has one to tap; one Life counter.
    inputs = {"timetable": {"slots": [{"day": d, "start": "08:45", "end": "09:45", "subject": "control"} for d in DAYS]},
              "attendance_rule": {"threshold": 0.75, "confirmed": True},
              "life": {"counters": [{"id": "water", "name": "Glasses of water", "want": "more"}]}}
    (tmp_path / "inputs.json").write_text(json.dumps(inputs), encoding="utf-8")
    monkeypatch.setenv("JARVIS_ENGINE_INPUTS", str(tmp_path / "inputs.json"))
    guard = Guard(8777, TOKEN, extra_hosts=["testserver"])
    app = create_app(guard, autostart_aankhen="off", features=["phone", "phone_ww", "security"])
    access = app.state.phone
    access.config_path = tmp_path / "config.json"
    access.devices = phone.DeviceStore(tmp_path / "devices.json")
    access.addresses_fn = lambda: [LAN]
    access.listen = False
    with TestClient(app, base_url=PHONE, client=("192.168.1.20", 50123)) as c:
        c.put(f"{DESK}/api/remote", headers=D, json={"enabled": True})
        yield c


def pair(c):
    code = c.post(f"{DESK}/api/remote/pair", headers=D, json={}).json()["code"]
    r = c.post("/api/phone/pair", headers=P, json={"code": code, "name": "Phone"})
    assert r.status_code == 200, r.text


def test_the_page_is_served_and_the_api_needs_a_paired_phone(setup):
    c = setup
    r = c.get("/phone/ww")
    assert r.status_code == 200 and "Well Wisher" in r.text and "Content-Security-Policy" in r.headers
    assert c.get("/phone/ww.js").status_code == 200
    assert c.get("/phone/ww.css").status_code == 200
    assert c.get("/api/phone/ww/today", headers=P).status_code == 401
    assert c.post("/api/phone/ww/class", headers=P, json={"slot": "x", "status": "present"}).status_code == 401
    assert c.get("/phone/ww-not-a-page").status_code == 404      # the allow-list, not a wildcard


def test_a_paired_phone_gets_the_day_and_taps_a_class_and_a_counter(setup):
    c = setup
    pair(c)
    d = c.get("/api/phone/ww/today", headers=P).json()
    assert set(d) >= {"date", "say", "blocks", "papers", "paper", "classes", "attendance", "rule", "counters"}
    assert d["paper"] is None and d["papers"] == []             # no date sheet in this scratch
    assert len(d["classes"]) == 1 and d["classes"][0]["status"] is None
    slot = d["classes"][0]["id"]
    d = c.post("/api/phone/ww/class", headers=P, json={"slot": slot, "status": "present"}).json()
    assert d["classes"][0]["status"] == "present"
    row = next(r for r in d["attendance"] if r["subject"] == "control")
    assert (row["held"], row["attended"], row["can_miss"]) == (1, 1, 0)
    d = c.post("/api/phone/ww/class", headers=P, json={"slot": slot, "status": "clear"}).json()
    assert d["classes"][0]["status"] is None
    assert c.post("/api/phone/ww/class", headers=P, json={"slot": "nope", "status": "present"}).status_code == 400
    d = c.post("/api/phone/ww/count", headers=P, json={"id": "water", "delta": 1}).json()
    water = next(x for x in d["counters"] if x["id"] == "water")
    assert water["today"] == 1
    # The header is the listener's cross-site check: a POST without it is refused.
    assert c.post("/api/phone/ww/count", json={"id": "water", "delta": 1}).status_code == 403
