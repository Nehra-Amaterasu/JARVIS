"""Well Wisher behind the phone door (routes_phone_ww.py): the page and its taps exist only
under /phone and /api/phone/*, so the listener's rules apply unchanged: unpaired gets 401,
a paired phone gets the day and can tap a class and a counter."""
import json
import re

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


# ---- 44 px targets (plan 9.0, chunk 1b): the page and its stylesheet, as served ----
KIT = {"--hit": 44, "--space-2": 8, "--radius-control": 10, "--radius-card": 14}


def _px(css, name):
    m = re.search(rf"{re.escape(name)}:(\d+)px", css)
    assert m, f"{name} is not a plain px token in ww.css"
    return int(m.group(1))


def test_the_stylesheet_keeps_44_px_targets_and_mirrors_the_kit_tokens(setup):
    css = setup.get("/phone/ww.css").text
    for name, want in KIT.items():
        assert _px(css, name) == want, name
    # The focus ring is the kit's: 2 px, offset 2, in the kit's saffron-400.
    assert "outline:2px solid var(--focus-ring);outline-offset:2px" in css
    assert "--focus-ring:#ff9454" in css
    # Every fixed min-height/min-width in the sheet is the hit token or at least 44: the old 36 and 40 are gone.
    for m in re.finditer(r"(?<!\()min-(?:height|width):\s*([^;}]+)", css):     # not a media query's (min-width:600px)
        v = m.group(1).strip()
        if v in ("1em", "0"):              # .err (a text line) and .classes .name (lets a long name wrap): not controls
            continue
        assert v == "var(--hit)" or (v.endswith("px") and int(v[:-2]) >= 44), f"small target left: {m.group(0)}"
    assert re.search(r"\.btn\{[^}]*min-height:var\(--hit\)[^}]*min-width:var\(--hit\)", css)
    sm = re.search(r"\.btn\.sm\{([^}]*)\}", css).group(1)
    assert "min-height" not in sm, ".btn.sm must not shrink the 44 px height"
    # Gaps between taps are at least 8 px (token or literal), so two 44 px areas never overlap.
    for sel in (".chips{", ".topics{", ".classes .taps{", ".counters{", ".row{"):
        body = css[css.index(sel):].split("}")[0]
        g = re.search(r"gap:([^;]+)", body).group(1)
        assert g == "var(--space-2)" or (g.endswith("px") and int(g[:-2]) >= 8), (sel, g)
    # Reduced motion is honoured, and nothing imports the not-yet-generated tokens file.
    assert "prefers-reduced-motion:reduce" in css
    assert not re.search(r"^\s*@import", css, re.M), "/phone/tokens.css does not exist yet; keep the mirrored values"


def test_the_page_markup_and_script_keep_their_hooks_and_invent_no_numbers(setup):
    html = setup.get("/phone/ww").text
    for mins in ("25", "50", "90"):
        assert f'data-min="{mins}"' in html
    assert 'name="viewport"' in html and "width=device-width" in html
    js = setup.get("/phone/ww.js").text
    # A missing figure shows a dash, never an invented 0 or an invented "today".
    assert "c.today ?? 0" not in js and "has(c.today)" in js and "has(x.days_left)" in js


# ---- plan 4.14 / 9.0 row 6: the phone page is the left column alone ----
def test_the_page_lists_the_left_column_sections_in_the_laptops_order_with_an_honest_last_line(setup):
    html = setup.get("/phone/ww").text
    # same ids, same order as L1 to L4 in app/ui/src/ww/left/model.ts (LEFT_SECTION_IDS)
    ids = re.findall(r'<section id="(L\d)" class="card" data-section="(L\d)"', html)
    assert ids == [("L1", "L1"), ("L2", "L2"), ("L3", "L3"), ("L4", "L4")]
    assert "L5" not in html                                  # the Phone pointer is the laptop's; this IS the phone
    assert 'data-chip="phone">This is your phone<' in html
    # the last line says what is not here, in the registry's own words (ww/plannedFeatures.ts phone-papers)
    assert re.search(r'id="last"[^>]*>Desktop only: papers, Tree, Setup \(not on the phone yet\)\.<', html)
    assert html.index('id="L4"') < html.index('id="last"')
    # Now carries Start and the three presets; Classes and Counters carry their taps
    assert 'id="start"' in html and html.index('id="L2"') < html.index('data-min="25"') < html.index('id="L3"')


def test_the_stylesheet_is_one_column_below_600_px_and_the_script_carries_the_view_model(setup):
    css = setup.get("/phone/ww.css").text
    assert "@media (max-width:599px){#main{display:block}}" in css
    assert re.search(r"@media \(min-width:600px\)\{#main\{display:grid;grid-template-columns:repeat\(2,", css)
    js = setup.get("/phone/ww.js").text
    # left.test.tsx runs this copy against model.ts on the same fixtures; here only that it is exposed
    assert "function buildLeft(" in js and "window.WWLeft = { buildLeft" in js
    assert "const LEFT_SECTION_IDS = ['L1', 'L2', 'L3', 'L4']" in js
    # counters are tiles: one tap adds one, and a failed tap restores the payload it replaced
    assert "'/api/phone/ww/count', { id, delta }" in js and "D = before; render(); fail(e)" in js
