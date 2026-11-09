"""The harvester (ww_harvest.py, routes_ww_harvest.py) on recorded fixtures: no network, ever.

The transport is jarvis_app.ww_check_harvest.FakeNet over app/tests/fixtures/harvest/; the bank is a
pytest tmp folder (WW_BANK_DIR). PDF tests need the local pdftotext and skip, loudly named, without it."""
import json

import pytest
from starlette.testclient import TestClient

from jarvis_app import ww_bank_store as store
from jarvis_app import ww_check_harvest as fake
from jarvis_app import ww_harvest as wh
from jarvis_app.security import Guard
from jarvis_app.server import create_app

needs_pdf = pytest.mark.skipif(not fake.pdf_reader_available(), reason="pdftotext (poppler) is not installed")
TOKEN = "desk-token-123456"
D = {"X-Jarvis-Token": TOKEN}


@pytest.fixture(autouse=True)
def bank(tmp_path, monkeypatch):
    monkeypatch.setenv("WW_BANK_DIR", str(tmp_path / "bank"))
    return tmp_path / "bank"


def start(net=None, **kw):
    net = net or fake.world(fake.FakeNet())
    h = fake.harvester(net, **kw)
    return h, net


def one(h, subject="control", topic="Routh-Hurwitz stability", sources=None, **kw):
    h.queue_topic(subject, topic, sources=sources, **kw)
    h.resume()
    h.run(30)
    return h.status()["items"][0]


# ---------------------------------------------------------------- sources and switches
def test_sources_list_every_source_with_status_and_licence():
    h, _ = start()
    v = h.sources_view()
    rows = {r["id"]: r for r in v["sources"]}
    assert set(rows) == {"mit_ocw", "openstax", "stackexchange", "gate_official", "nptel", "textbooks"}
    assert rows["mit_ocw"]["license"] == "CC BY-NC-SA 4.0" and rows["stackexchange"]["license"] == "CC BY-SA 4.0"
    assert rows["openstax"]["license"] == "not recorded" and "licence not recorded, so it stays off" in rows["openstax"]["reason"]
    assert all(rows[i]["status"] == "off" for i in ("mit_ocw", "stackexchange")), "off until the owner switches it on"
    assert all(rows[i]["status"] == "pointer" for i in ("gate_official", "nptel", "textbooks"))
    assert rows["nptel"]["license"] == "unconfirmed" and rows["gate_official"]["license"] == "reserved"
    assert {n["name"] for n in v["not_used"]} >= {"Indian coaching banks", "Reddit"}
    assert "@" not in v["user_agent"] and "JARVIS" in v["user_agent"]


def test_switching_on_turns_the_licensed_sources_on_and_pause_turns_them_off():
    h, _ = start()
    h.resume()
    rows = {r["id"]: r["status"] for r in h.sources_view()["sources"]}
    assert rows["mit_ocw"] == rows["stackexchange"] == "on" and rows["openstax"] == "off"
    h.pause()
    assert {r["id"]: r["status"] for r in h.sources_view()["sources"]}["mit_ocw"] == "paused"
    assert h.flags()["state"] == "paused"


def test_nothing_runs_while_the_harvester_is_off_or_paused():
    h, net = start()
    h.queue_topic("control", "Bode plot")
    assert h.run(5)["ran"] is False and h.flags()["state"] == "off" and net.calls == []
    h.resume()
    h.pause()
    out = h.run(5)
    assert out == {"ran": False, "reason": "paused", "requests": 0} and net.calls == []


def test_the_queue_validates_dedupes_and_survives_a_restart():
    h, _ = start()
    for bad in (dict(subject="../x", topic="a"), dict(subject="control", topic=""), dict(subject="control", topic="a", tier="x"),
                dict(subject="control", topic="a", max=0), dict(subject="control", topic="a", unit=11), dict(subject="control", topic="a", sources=["reddit"])):
        with pytest.raises(ValueError):
            h.queue_topic(**bad)
    a = h.queue_topic("control", "Bode plot", unit=2, max=5)
    assert h.queue_topic("control", "bode PLOT")["id"] == a["id"] and len(h.status()["items"]) == 1
    h2, _ = start()                                        # a new process over the same folder
    s = h2.status()
    assert [i["topic"] for i in s["items"]] == ["Bode plot"] and s["queued"] == 1 and s["items"][0]["max"] == 5


# ---------------------------------------------------------------- politeness
def test_robots_disallow_is_refused_with_its_reason_and_the_page_is_never_asked_for():
    net = fake.world(fake.FakeNet(), robots="block")
    h, _ = start(net)
    it = one(h, sources=["mit_ocw"])
    assert it["status"] == "refused" and it["reason_code"] == "robots" and "robots.txt" in it["reason"] and "/courses/" in it["reason"]
    assert net.calls == ["https://ocw.mit.edu/robots.txt"]


def test_robots_is_fetched_once_per_host_per_day_and_again_the_next_day():
    day = ["2026-11-09"]
    h, net = start(day=day)
    one(h, sources=["stackexchange"])
    h.queue_topic("control", "Nyquist stability", sources=["stackexchange"])
    h.run(30)
    assert net.hits("robots.txt") == 1
    day[0] = "2026-11-10"
    h.queue_topic("control", "Bode plot stability", sources=["stackexchange"])
    h.run(30)
    assert net.hits("robots.txt") == 2


def test_robots_that_cannot_be_read_is_a_refusal_not_a_free_pass():
    net = fake.world(fake.FakeNet())
    net.add("https://api.stackexchange.com/robots.txt", b"", status=500)
    it = one(start(net)[0], sources=["stackexchange"])
    assert it["reason_code"] == "robots" and "not reachable" in it["reason"] and net.hits("/2.3/") == 0
    net2 = fake.world(fake.FakeNet())
    net2.add("https://api.stackexchange.com/robots.txt", b"", status=404)       # no robots.txt means no rules
    assert one(start(net2)[0], sources=["stackexchange"])["status"] == "done"
    net3 = fake.world(fake.FakeNet())
    net3.add("https://api.stackexchange.com/robots.txt", b"", status=400)          # what the live API answers: no file, no rules (RFC 9309)
    assert one(start(net3)[0], sources=["stackexchange"])["status"] == "done"


def test_requests_are_one_at_a_time_two_to_five_seconds_apart_with_an_honest_user_agent():
    clock = fake.FakeClock()
    h, net = start(clock=clock, delay=(2.0, 5.0))
    h.queue_topic("control", "Routh-Hurwitz stability", sources=["stackexchange", "mit_ocw"])
    h.resume()
    h.run(30)
    assert len(net.calls) >= 6 and net.overlap is False
    assert clock.sleeps and all(2.0 <= s <= 5.0 for s in clock.sleeps) and len(clock.sleeps) == len(net.calls) - 1
    assert {x["User-Agent"] for x in net.headers_seen} == {wh.USER_AGENT} and all("Cookie" not in x and "Authorization" not in x for x in net.headers_seen)


def test_a_second_run_cannot_start_while_one_is_going():
    h, net = start()
    h.queue_topic("control", "Routh-Hurwitz stability", sources=["stackexchange"])
    h.resume()
    inner = []
    net.on_call = lambda url: inner.append(h.run(5)) if not inner else None
    h.run(30)
    assert inner and inner[0] == {"ran": False, "reason": "a run is already going", "requests": 0}


@pytest.mark.parametrize("code", [403, 429])
def test_a_first_403_or_429_is_not_retried_and_a_second_stops_the_host_for_the_day(code):
    day = ["2026-11-09"]
    net = fake.world(fake.FakeNet())
    net.add_prefix("https://api.stackexchange.com/2.3/search/advanced", b"", status=code)
    h, _ = start(net, day=day)
    for t in ("Routh-Hurwitz stability", "Nyquist stability", "Bode stability"):
        h.queue_topic("control", t, sources=["stackexchange"])
    h.resume()
    h.run(30)
    items = h.status()["items"][::-1]
    assert net.hits("/2.3/") == 2, "the third topic must not be asked once the host answered twice"
    assert [i["status"] for i in items] == ["refused"] * 3
    assert f"HTTP {code}" in items[0]["reason"] and "stopped for today" in items[1]["reason"] and "left alone" in items[2]["reason"]
    assert {r["id"]: r["status"] for r in h.sources_view()["sources"]}["stackexchange"] == "stopped today"
    h.run(30)
    assert net.hits("/2.3/") == 2, "refused items are not retried the same day"
    day[0] = "2026-11-10"
    net.exact.clear(); net.prefix.clear(); fake.world(net)
    h.run(30)
    assert [i["status"] for i in h.status()["items"][::-1]] == ["done", "done", "done"] or net.hits("/2.3/") > 2


def test_every_page_is_cached_so_a_repeat_costs_no_request():
    h, net = start()
    one(h, sources=["stackexchange"])
    n = len(net.calls)
    h.queue_topic("control", "Routh-Hurwitz stability", tier="exam", sources=["stackexchange"])
    h.run(30)
    assert len(net.calls) == n, "the same API page came from disk"
    assert list((store.harvest_dir() / "cache").rglob("*.body"))


def test_a_login_in_the_address_is_refused_before_any_request():
    h, net = start()
    st = h.load()
    with pytest.raises(wh.Refused) as e:
        h.get("https://user:pw@ocw.mit.edu/x", st)
    assert e.value.code == "blocked" and net.calls == []


def test_the_run_budget_leaves_the_rest_queued():
    h, net = start()
    h.queue_topic("control", "Routh-Hurwitz stability", sources=["mit_ocw"])
    h.resume()
    out = h.run(1)
    assert out["requests"] == 1 and h.status()["items"][0]["status"] == "waiting" and h.status()["items"][0]["reason_code"] == "budget"


# ---------------------------------------------------------------- Stack Exchange
def test_stack_exchange_questions_are_stored_with_licence_author_and_link():
    h, net = start()
    it = one(h, sources=["stackexchange"], unit=3)
    assert it["status"] == "done" and it["added"] == 2
    recs = store.all_records("control")
    by_ref = {r["ref"]: r for r in recs}
    assert set(by_ref) == {"electronics q1001", "electronics q1003"}, "picture, zero-vote and off-topic posts are left out"
    a, b = by_ref["electronics q1001"], by_ref["electronics q1003"]
    assert a["license"] == "CC BY-SA 4.0" and b["license"] == "CC BY-SA 3.0", "a 2011 post is not claimed to be 4.0"
    assert "Alice Example" in a["source"] and a["source_url"].endswith("/1001/routh-hurwitz") and a["origin"] == "cc-verbatim"
    assert a["tier"] == "gate" and a["unit"] == 3 and a["topic"] == "Routh-Hurwitz stability" and a["marks"] in (2.0, 5.0, 7.0)
    assert "<p>" not in a["question"] and "Routh array" in a["question"]
    assert "gain $K$?" in a["question"] and ("\\" + "$") not in a["question"], "electronics writes maths as backslash-dollar; stored as plain dollars so the renderer sees maths"
    api = [c for c in net.calls if "/2.3/" in c]
    assert len(api) == 2 and any("site=electronics" in c for c in api) and all("filter=withbody" in c and "key=" not in c for c in api)


def test_stack_exchange_backoff_is_honoured_before_the_next_request():
    body = json.loads(fake.fx("se_electronics.json"))
    body["backoff"] = 30
    net = fake.world(fake.FakeNet())
    net.add_prefix("https://api.stackexchange.com/2.3/search/advanced", json.dumps(body))
    clock = fake.FakeClock()
    h, _ = start(net, clock=clock)
    h.queue_topic("control", "Routh-Hurwitz stability", sources=["stackexchange"])
    h.queue_topic("control", "Nyquist stability criterion", sources=["stackexchange"])
    h.resume()
    h.run(30)
    items = h.status()["items"][::-1]
    assert items[0]["status"] == "done" and items[1]["reason_code"] == "backoff" and net.hits("/2.3/") == 1
    clock.t += 31
    h.queue_topic("control", "Bode stability margin", sources=["stackexchange"])
    h.run(30)
    assert net.hits("/2.3/") == 2


def test_the_daily_limit_of_300_requests_stops_the_api_calls():
    h, net = start()
    st = h.load()
    st["se_requests"] = {"date": "2026-11-09", "n": wh.SE_DAILY}
    h.save(st)
    it = one(h, sources=["stackexchange"])
    assert it["reason_code"] == "quota" and net.hits("/2.3/") == 0
    st = h.load()
    assert {r["id"]: r["status"] for r in h.sources_view()["sources"]}["stackexchange"] == "limit"


def test_only_network_requests_count_against_the_daily_limit():
    h, net = start()
    one(h, sources=["stackexchange"])
    assert h.load()["se_requests"]["n"] == net.hits("/2.3/") + net.hits("robots.txt") == 3     # two sites and the robots file, counted conservatively
    h.queue_topic("control", "Routh-Hurwitz stability", tier="exam", sources=["stackexchange"])
    h.run(30)
    assert h.load()["se_requests"]["n"] == 3, "the cached pages were free"


# ---------------------------------------------------------------- MIT OCW, OpenStax, GATE pointers
@needs_pdf
def test_mit_ocw_problems_are_stored_verbatim_with_course_pdf_licence_and_ref():
    h, net = start()
    it = one(h, sources=["mit_ocw"], unit=2)
    assert it["status"] == "done" and it["added"] == 1, it
    (r,) = store.all_records("control")
    assert r["license"] == "CC BY-NC-SA 4.0" and r["origin"] == "cc-verbatim" and r["marks"] == 10.0, "an explicit (10 points) wins the marks guess"
    assert r["source_url"] == fake.OCW_PDF and r["ref"].startswith("6.302 ") and "Problem 1" in r["ref"]
    assert r["source"].startswith("MIT OCW 6.302") and r["source"].endswith("CC BY-NC-SA 4.0")
    assert "Routh-Hurwitz criterion" in r["question"], "text kept as printed"
    assert not any("_sol" in c for c in net.calls), "solutions are never downloaded"
    assert "courtesy" not in r["question"].lower()


@needs_pdf
def test_openstax_records_the_book_licence_before_storing_anything():
    h, net = start()
    it = one(h, subject="maths", topic="Green's theorem", sources=["openstax"])
    assert it["status"] == "done" and it["added"] == 1, it
    (r,) = store.all_records("maths")
    assert r["license"] == "CC BY-NC-SA 4.0" and r["source"].startswith("OpenStax calculus-volume-3")
    row = {x["id"]: x for x in h.sources_view()["sources"]}["openstax"]
    assert row["license"] == "CC BY-NC-SA 4.0" and row["status"] == "on" and row["on_disk"] == 1


def test_an_openstax_book_with_no_licence_line_stays_off_and_stores_nothing():
    net = fake.world(fake.FakeNet())
    net.add(fake.OS_PAGE, "<html><body><h1>Calculus Volume 3</h1><a href='x.pdf'>Download a PDF</a></body></html>")
    it = one(start(net)[0], subject="maths", topic="Green's theorem", sources=["openstax"])
    assert it["status"] == "refused" and it["reason_code"] == "licence-unknown" and net.hits(".pdf") == 0
    assert store.counts()["total"] == 0


def test_openstax_licence_line_parser():
    f = wh.openstax_licence_line
    assert f("licensed under a Creative Commons Attribution-NonCommercial-ShareAlike 4.0 International License") == "CC BY-NC-SA 4.0"
    assert f("under a Creative Commons Attribution 4.0 International License") == "CC BY 4.0"
    assert f("all rights reserved") is None


@needs_pdf
def test_official_gate_papers_become_pointers_and_the_pdf_is_never_saved():
    h, net = start()
    it = one(h, sources=["gate_official"], unit=3)
    assert it["status"] == "done" and it["added"] == 2, it
    recs = store.all_records("control")
    assert {r["ref"] for r in recs} == {"GATE 2026 EC Q1", "GATE 2026 EC Q4"}
    assert {r["ref"]: r["marks"] for r in recs} == {"GATE 2026 EC Q1": 1.0, "GATE 2026 EC Q4": 2.0}, "marks from the paper's own header"
    assert all(r["origin"] == "pointer" and "question" not in r and r["source_url"] == fake.GATE_PDF for r in recs)
    on_disk = " ".join(p.read_text(encoding="utf-8", errors="ignore") for p in store.bank_root().rglob("*") if p.is_file() and p.suffix != ".body")
    assert "fourth order polynomial" not in on_disk and "matched filter" not in on_disk
    assert not [p for p in (store.harvest_dir() / "cache").rglob("*.body") if p.read_bytes()[:4] == b"%PDF"], "the GATE PDF is read in memory only"
    assert [r["question"] for r in store.load_for("control")][0].startswith("Solve: GATE 2026 EC")


def test_the_gate_pointer_source_is_for_the_gate_tier_only():
    h, net = start()
    it = one(h, sources=["gate_official"], tier="exam")
    assert it["status"] == "refused" and net.hits(".pdf") == 0


# ---------------------------------------------------------------- licence and coverage rules
def test_a_source_with_no_recorded_licence_is_never_fetched(monkeypatch):
    monkeypatch.setitem(wh.SOURCES["mit_ocw"], "license", None)
    h, net = start()
    it = one(h, sources=["mit_ocw"])
    assert net.calls == [] and it["reason_code"] == "licence-unknown" and "licence not recorded" in it["reason"]


def test_a_subject_with_no_gate_line_is_refused_for_the_gate_tier_with_the_reason():
    h, net = start()
    it = one(h, subject="iot", topic="MQTT", sources=["stackexchange"])
    assert it["reason_code"] == "no-source" and net.calls == []


def test_the_subjects_map_to_the_gate_ec_headings():
    assert "Control Systems" in wh.gate_map("control")["gate"]
    assert "Analog Circuits" in wh.gate_map("microelectronic-circuits")["gate"]
    assert "Communications" in wh.gate_map("digital-communication")["gate"]
    assert "nearest line" in wh.gate_map("ic-fabrication")["gate"]
    assert "Engineering Mathematics" in wh.gate_map("applied-maths-stochastic")["gate"]
    assert "not in GATE EC" in wh.gate_map("network-analysis-synthesis")["gate"]
    assert all(wh.gate_map(s)["gate"] is None for s in ("iot", "ev", "pie", "constitution"))
    assert wh.gate_map("unknown-thing") is None


def test_a_missing_pdf_reader_is_a_clear_error_and_a_refusal_not_a_crash(monkeypatch):
    monkeypatch.setattr(wh, "find_pdftotext", lambda: None)
    with pytest.raises(wh.PdfReaderMissing) as e:
        wh.pdf_text(b"%PDF-1.4")
    assert "pdftotext" in str(e.value) and "No Python PDF library" in str(e.value)
    h, net = start()
    it = one(h, sources=["mit_ocw"])
    assert it["status"] == "refused" and it["reason_code"] == "pdf-reader-missing" and "pdftotext" in it["reason"]
    assert h.sources_view()["pdf_reader"]["available"] is False


@needs_pdf
def test_pdf_text_reads_a_real_pdf_through_the_local_reader():
    assert "Problem 1." in wh.pdf_text(fake.make_pdf("Problem 1. Find x."))


def test_problem_splitting_topic_matching_and_marks_guess():
    text = "Problem 1. " + "word " * 12 + "about the Nyquist plot\n\n3\n\nProblem 2. " + "other " * 12 + "text\n2. tiny"
    probs = wh.split_problems(text)
    assert [p[0] for p in probs] == ["1", "2"] and "3" not in probs[0][1].split()[-3:]
    assert wh.matches_topic("the Routh Hurwitz stability table", "Routh-Hurwitz stability"), "a hyphen or a space"
    assert wh.matches_topic("the Nyquist plot of the loop gain", "Nyquist plot") and not wh.matches_topic("a diode", "Nyquist plot")
    assert wh.matches_topic("what is a sampling rate", "Sampling", ("sampling",))
    assert wh.guess_marks("short") == 2.0 and wh.guess_marks("x" * 300) == 5.0 and wh.guess_marks("x" * 600) == 7.0
    assert wh.guess_marks("Find it. [15 points]") == 15.0


# ---------------------------------------------------------------- the shortfall hook
def test_missing_topics_are_queued_from_the_units_and_the_bank():
    h, _ = start()
    units = [{"n": 1, "topics": ["Bode plot", "Nyquist"]}, {"n": 2, "topics": ["Routh"]}]
    bank = [{"topic": "Bode plot", "tier": "gate"}, {"topic": "Routh", "tier": "exam"}]
    got = h.queue_missing_topics("control", units, bank, tier="gate", want=1)
    assert sorted(i["topic"] for i in got) == ["Nyquist", "Routh"]
    assert {i["topic"]: i["unit"] for i in got} == {"Nyquist": 1, "Routh": 2}


def test_the_gate_cases_pass():
    from jarvis_app import ww_check_harvest
    r = ww_check_harvest.run()
    assert r["problems"] == [] and r["cases"] >= 20


# ---------------------------------------------------------------- routes
@pytest.fixture
def client(tmp_path, monkeypatch):
    guard = Guard(8777, TOKEN, extra_hosts=["testserver"])
    app = create_app(guard, autostart_aankhen="off", features=["ww_harvest"])
    with TestClient(app) as c:
        yield c


def test_routes_queue_sources_pause_resume_and_run(client):
    q = client.get("/api/mission/harvest/queue", headers=D).json()
    assert q["state"] == "off" and q["items"] == [] and q["on_disk"] == 0
    s = client.get("/api/mission/harvest/sources", headers=D).json()
    assert [r["id"] for r in s["sources"]][:3] == ["mit_ocw", "openstax", "stackexchange"] and s["not_used"]
    assert client.post("/api/mission/harvest/queue", headers=D, json={"subject": "control", "topic": ""}).status_code == 400
    assert client.post("/api/mission/harvest/queue", headers=D, json={"subject": "control", "topic": "Bode plot", "sources": "x"}).status_code == 400
    r = client.post("/api/mission/harvest/queue", headers=D, json={"subject": "control", "topic": "Bode plot", "max": 5})
    assert r.status_code == 200 and r.json()["item"]["status"] == "waiting" and r.json()["state"] == "off"
    run = client.post("/api/mission/harvest/run", headers=D, json={}).json()
    assert run["ran"] is False and "off" in run["reason"]
    assert client.post("/api/mission/harvest/run", headers=D, json={"max_requests": 99}).status_code == 400
    assert client.post("/api/mission/harvest/resume", headers=D).json()["state"] == "queued"
    assert client.post("/api/mission/harvest/pause", headers=D).json()["state"] == "paused"


def test_routes_need_the_desk_token(client):
    assert client.get("/api/mission/harvest/queue").status_code in (401, 403)
    assert client.post("/api/mission/harvest/resume").status_code in (401, 403)


def test_the_phone_flags_route_lives_under_the_phone_door(tmp_path, monkeypatch):
    from jarvis_app import phone
    monkeypatch.delenv("JARVIS_PHONE", raising=False)
    monkeypatch.delenv("JARVIS_PHONE_PORT", raising=False)
    monkeypatch.setattr(phone, "CONFIG_FILE", tmp_path / "config.json")
    monkeypatch.setattr(phone, "DEVICES_FILE", tmp_path / "devices.json")
    monkeypatch.setattr(phone, "INBOX", tmp_path / "inbox")
    guard = Guard(8777, TOKEN, extra_hosts=["testserver"])
    app = create_app(guard, autostart_aankhen="off", features=["phone", "ww_harvest", "security"])
    access = app.state.phone
    access.config_path, access.devices, access.addresses_fn, access.listen = tmp_path / "config.json", phone.DeviceStore(tmp_path / "devices.json"), (lambda: ["192.168.1.50"]), False
    with TestClient(app, base_url="http://192.168.1.50:8778", client=("192.168.1.20", 50123)) as c:
        P = {"X-Jarvis-Phone": "1"}
        c.put("http://testserver/api/remote", headers=D, json={"enabled": True})
        assert c.get("/api/phone/ww/harvest", headers=P).status_code == 401
        code = c.post("http://testserver/api/remote/pair", headers=D, json={}).json()["code"]
        assert c.post("/api/phone/pair", headers=P, json={"code": code, "name": "Phone"}).status_code == 200
        r = c.get("/api/phone/ww/harvest", headers=P)
        assert r.status_code == 200 and set(r.json()) >= {"state", "queued", "fetching", "on_disk", "enabled", "paused"} and r.json()["state"] == "off"
        assert c.get("/api/phone/ww/harvest?subject=../x", headers=P).status_code == 400
        assert c.post("/api/mission/harvest/resume", headers=P).status_code in (401, 403, 404), "the switches are not on the phone's door"
