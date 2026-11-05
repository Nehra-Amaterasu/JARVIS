"""The relays view (phone_page/relays.js) and the wall box's page generated from it.

One source, two places: the JARVIS phone app links relays.js; board_page.py inlines it
into aankhen/firmware/web_page.h. These tests keep the header equal to the generator's
output, keep private data out of it, and run the tap rules under Node."""
import json
import re
import shutil
import subprocess
from pathlib import Path

import pytest

from jarvis_app import board_page

HARNESS = Path(__file__).parent / "fixtures" / "relays_harness.js"


def test_web_page_h_is_exactly_what_the_generator_writes():
    assert board_page.OUT.read_text(encoding="utf-8") == board_page.render(), \
        "web_page.h was edited by hand or is stale: run python -m jarvis_app.board_page"


def test_the_board_page_carries_the_same_relays_view_as_the_app():
    text = board_page.render()
    js = (board_page.PAGE_DIR / "relays.js").read_text(encoding="utf-8").strip()
    css = (board_page.PAGE_DIR / "relays.css").read_text(encoding="utf-8").strip()
    assert js in text and css in text
    assert "/*RELAYS_" not in text
    index = (board_page.PAGE_DIR / "index.html").read_text(encoding="utf-8")
    assert '<script src="/phone/relays.js">' in index and 'href="/phone/relays.css"' in index


def test_the_board_page_holds_no_addresses_and_no_invented_sensor_data():
    text = board_page.render()
    assert not re.search(r"\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b", text), "an IP address in a tracked file"
    assert not re.search(r"\b[0-9a-f]{2}(:[0-9a-f]{2}){5}\b", text, re.I), "a MAC address in a tracked file"
    for word in ("RADAR", "Math.random", "api/limbs/"):
        assert word not in text
    # it talks to the board with the token, POST only
    assert "method: 'POST'" in text and "X-Aankhen-Token" in text and "'/relay'" in text
    assert "/relay?" not in text                     # no GET-style switch links


def test_the_phone_app_shows_no_invented_aankhen_data():
    page = board_page.PAGE_DIR
    for f in ("index.html", "app.js"):
        t = (page / f).read_text(encoding="utf-8")
        assert "RADAR" not in t and "Math.random" not in t, f
        assert "HMAC-SHA256 OK" not in t and "500 Hz" not in t, f


def test_the_generator_refuses_a_page_that_would_break_the_raw_string(monkeypatch, tmp_path):
    for f in ("relays.js", "relays.css", "board.html"):
        (tmp_path / f).write_text((board_page.PAGE_DIR / f).read_text(encoding="utf-8"), encoding="utf-8")
    (tmp_path / "relays.js").write_text('const x = ")HTML"', encoding="utf-8")
    monkeypatch.setattr(board_page, "PAGE_DIR", tmp_path)
    with pytest.raises(ValueError, match="raw string"):
        board_page.render()


@pytest.mark.skipif(shutil.which("node") is None, reason="Node is not installed")
def test_taps_settle_for_150_ms_and_the_last_one_wins():
    r = subprocess.run(["node", str(HARNESS), str(board_page.PAGE_DIR / "relays.js")],
                       capture_output=True, text=True, encoding="utf-8", timeout=60)
    assert r.returncode == 0, r.stderr
    out = json.loads(r.stdout)
    assert out["initial"]["light6"] == "off|unavailable"
    assert out["five_taps_sent"] == [["light", True]]          # 5 taps in 200 ms -> one command
    assert out["waiting"] == "wait|turning on…"                # amber until the board says so
    assert out["during_flight_sent"] == 1                      # one command in flight per relay
    assert out["after_release_sent"] == [["light", True], ["light", False]]
    assert out["confirmed"] == "off|off · confirmed"
    assert out["netted_sent"] == 0 and out["unavailable_sent"] == 0
    assert out["unconfirmed"] == "fault|not confirmed"
    assert out["failed"] == "fault|token refused"
