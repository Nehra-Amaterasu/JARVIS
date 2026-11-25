"""Paper sources of the harvester (ww_harvest_sources, routes R-43 to R-45, R-53, R-54) on invented pages: no network, ever.

The two listing pages below are invented, in the layouts read by hand on 25 Nov 2026: a table whose every cell links
the row's PDF (one row disagreeing with itself, one paper id that looks like a year), and a download page with the
paper and the key of a subject per year plus a hidden link. The transport is ww_check_harvest.FakeNet."""
import random
import time

import pytest
from starlette.testclient import TestClient

from jarvis_app import ww_check_harvest as fake
from jarvis_app import ww_harvest as wh
from jarvis_app import ww_harvest_sources as ps
from jarvis_app.security import Guard
from jarvis_app.server import create_app
from jarvis_app.ww_harvest_sources import gate_papers, papers_table
from jarvis_app.ww_pyq import store as store_mod
from jarvis_app.ww_pyq.store import Store

TOKEN = "desk-token-123456"
SITE = "https://papers.example.org"
LIST = SITE + "/exam/old-papers.html"
F20, F2030 = SITE + "/exam/pdf_old/v-0020.pdf", SITE + "/exam/pdf_old/v-2030.pdf"
GATE = gate_papers.LISTING
GHOST = "https://gate2027.iitm.ac.in/"

TABLE = """<html><body><a href="model-paper.html">Back</a>
<table width="100%" id="tableData"><thead>
 <th width="12%">CS NAME</th><th align="left"> PAPER ID</th><th> SUBJECT CODE</th><th>SUBJECT NAME</th>
 </tr><tr>
 </thead><tbody>
 <td ><a href="pdf_old/v-0020.pdf" target="_blank">B.Tech</a></td>
 <td align="left" ><a target="_blank" href="pdf_old/v-0020.pdf">20</a></td>
 <td ><a target="_blank" href="pdf_old/v-0020.pdf">AG-123</a></td>
 <td ><a target="_blank" href="pdf_old/v-0021.pdf">Surveying &amp; Levelling</a></td>
 </tr><tr>
 <td ><a href="pdf_old/v-2030.pdf">B.Tech</a></td><td><a href="pdf_old/v-2030.pdf">2030-31</a></td>
 <td ><a href="pdf_old/v-2030.pdf">EC-602</a></td><td><a href="pdf_old/v-2030.pdf">Digital Communication</a></td>
 </tr><tr>
 <td><a href="https://elsewhere.example.net/x.pdf">B.Tech</a></td><td>31</td><td>EC-401</td><td>Field Theory</td>
 </tr><tr>
 <td><a hidden href="pdf_old/trap.pdf">B.Tech</a></td><td>9</td><td>ZZ-999</td><td>Not for readers</td>
 </tr><tr>
 <td>MBA</td><td>7</td><td>MB-101</td><td>A row without a file</td>
 </tr>
</tbody></table></body></html>"""

DOWNLOADS = """<html><body><table>
<tr><td><span class="text-zoom">
  <a
    href="static/doc/download/2026/QPs/EC.pdf"
    target="_blank"
  >
    Electronics and Communication Engineering
  </a></span></td>
 <td><a href="static/doc/download/2026/Keys/EC_Keys.pdf" target="_blank">EC</a></td></tr>
<tr><td><a href="static/doc/download/2024/EC24S7.pdf">EC</a></td><td><a href="static/doc/download/2024/ECFinalAnswerKey.pdf">Key</a></td></tr>
<tr><td><a href="static/doc/download/2023/cs_2023.pdf">CS</a></td><td><a href="static/doc/download/Answer_keys2023/CS_ANS_GATE2023.pdf">Key</a></td></tr>
</table>
<a href="static/doc/sample-question-paper/Robotics-SampleQP.pdf">A sample paper</a>
<a href="https://drive.example.com/drive/folders/abc">2007 to 2026 in one folder</a>
<a href="static/doc/download/../../secret.pdf">up and out</a>
<a href="/download">Download</a>
</body>
<a hidden href="/Rx9InventedTrap=.html">Rx9InventedTrap=.html</a>
<a hidden href="static/doc/download/2026/QPs/ZZ.pdf">never shown</a>
</html>"""

PAPER = "Q.1 State the sampling theorem.   [2]\nQ.2 Derive the bit error rate of BPSK.   [10]"


@pytest.fixture(autouse=True)
def bank(tmp_path, monkeypatch):
    monkeypatch.setenv("WW_BANK_DIR", str(tmp_path / "bank"))
    return tmp_path / "bank"


def make(net=None, **kw):
    net = net if net is not None else fake.FakeNet()
    return fake.harvester(net, **kw), net


def table_source(h, net, local=False):
    net.add(LIST, TABLE, headers={"etag": '"v1"'})
    ps.set_switches(h, "papers_table", {"address": LIST, "on": True})
    if local:
        ps.set_switches(h, "papers_table", {"local_copy": True})
    return {i["code"]: i for i in ps.index(h, "papers_table")["items"]}


# ---------------------------------------------------------------- the two parsers
def test_the_table_parser_reads_rows_and_keeps_to_what_the_page_shows():
    r = papers_table.parse(TABLE.encode(), LIST)
    assert [(i["code"], i["title"], i["url"], i["year"]) for i in r["items"]] == [
        ("AG-123", "Surveying & Levelling", F20, None), ("EC-602", "Digital Communication", F2030, None)]
    assert "2 files" in r["items"][0]["note"], "three cells say v-0020 and one says v-0021: the majority is listed and the row says so"
    assert "note" not in r["items"][1]
    assert r["note"] == "1 row points at more than one file; 1 row links another site and is not listed"
    assert all("trap" not in i["url"] for i in r["items"]), "a hidden link is not a paper"


def test_a_paper_id_that_looks_like_a_year_is_not_a_year_but_a_session_is():
    assert papers_table.parse(TABLE.encode(), LIST)["items"][1]["year"] is None        # the paper id cell says 2030-31: two ids, not a session
    page = ('<table><tr><th>Subject</th><th>Code</th><th>Session</th></tr>'
            '<tr><td><a href="a.pdf">Signals</a></td><td>EC-402</td><td>2021-22</td></tr>'
            '<tr><td><a href="b.PDF?x=1">Networks</a></td><td>EC-301</td><td>Dec 2019</td></tr></table>')
    got = papers_table.parse(page.encode(), SITE + "/p/")["items"]
    assert [(i["title"], i["code"], i["year"], i["url"]) for i in got] == [
        ("Signals", "EC-402", 2021, SITE + "/p/a.pdf"), ("Networks", "EC-301", 2019, SITE + "/p/b.PDF?x=1")]
    bare = '<table><tr><td><a href="c.pdf">Control Systems</a></td><td>EE-803</td><td>2032</td></tr></table>'
    (one,) = papers_table.parse(bare.encode(), SITE + "/")["items"]
    assert (one["title"], one["code"], one["year"]) == ("Control Systems", "EE-803", None), "no header row: the code by its shape, no year guessed"


def test_the_download_page_parser_lists_paper_and_key_per_year_and_no_hidden_link():
    r = gate_papers.parse(DOWNLOADS.encode(), GATE)
    assert [(i["year"], i["code"], i["kind"]) for i in r["items"]] == [
        (2026, "EC", "paper"), (2026, "EC", "key"), (2024, "EC", "paper"), (2024, "EC", "key"), (2023, "CS", "paper"), (2023, "CS", "key")]
    assert r["items"][0]["url"] == GHOST + "static/doc/download/2026/QPs/EC.pdf"
    assert r["items"][0]["title"] == "GATE 2026 EC question paper: Electronics and Communication Engineering"
    assert r["items"][1]["title"] == "GATE 2026 EC answer key"
    assert r["note"] == "1 hidden link was skipped"
    urls = " ".join(i["url"] for i in r["items"])
    assert "ZZ.pdf" not in urls and "Trap" not in urls and "sample" not in urls and "drive" not in urls and ".." not in urls


def test_every_registered_source_has_an_id_a_name_and_a_terms_note():
    assert set(ps.ADAPTERS) == {"papers_table", "gate_papers"}
    for a in ps.ADAPTERS.values():
        assert a.name and a.rights and len(a.terms_note) > 60
    assert ps.ADAPTERS["papers_table"].needs_address and not ps.ADAPTERS["papers_table"].hosts, "no site is named in the code"
    with pytest.raises(ValueError):
        ps.register(ps.Adapter(id="mit_ocw", name="x", rights="x", terms_note="x", parse=gate_papers.parse, needs_address=True))
    with pytest.raises(ValueError):
        ps.register(ps.Adapter(id="loose", name="x", rights="x", terms_note="x", parse=gate_papers.parse, listing=GATE, hosts=("other.example.org",)))


# ---------------------------------------------------------------- off means nothing is asked
def test_every_paper_source_is_off_and_with_them_off_no_request_is_made():
    h, net = make()
    assert [(v["id"], v["on"], v["local_copy"]) for v in ps.view(h)] == [("gate_papers", False, False), ("papers_table", False, False)]
    for sid in ps.ADAPTERS:
        with pytest.raises(ps.Off):
            ps.index(h, sid)
        with pytest.raises(ps.Off):
            ps.fetch(h, sid, "0" * 12)
    assert net.calls == [] and ps.manifest(h) == []


def test_a_source_without_a_terms_note_cannot_be_switched_on(monkeypatch):
    monkeypatch.setitem(ps.ADAPTERS, "bare", ps.Adapter(id="bare", name="No terms read", rights="unknown", terms_note="", parse=gate_papers.parse, needs_address=True))
    h, net = make()
    with pytest.raises(ValueError, match="no terms note"):
        ps.set_switches(h, "bare", {"on": True})
    v = {x["id"]: x for x in ps.view(h)}["bare"]
    assert v["on"] is False and v["reason"] == "This source has no terms note; it stays off."
    st = h.load()
    st["paper_sources"]["bare"] = {"on": True, "address": LIST}       # even a state file edited by hand does not switch it on
    h.save(st)
    with pytest.raises(ps.Off):
        ps.index(h, "bare")
    assert net.calls == []


def test_the_second_switch_needs_the_first_and_never_outlives_it():
    h, _ = make()
    with pytest.raises(ValueError, match="second switch"):
        ps.set_switches(h, "gate_papers", {"local_copy": True})
    assert ps.set_switches(h, "gate_papers", {"on": True})["local_copy"] is False
    assert ps.set_switches(h, "gate_papers", {"local_copy": True})["local_copy"] is True
    off = ps.set_switches(h, "gate_papers", {"on": False})
    assert off["on"] is False and off["local_copy"] is False
    assert ps.set_switches(h, "gate_papers", {"on": True})["local_copy"] is False, "switching on again does not bring the copy back"
    with pytest.raises(ValueError):
        ps.set_switches(h, "gate_papers", {"on": False, "local_copy": True})
    for bad in ({}, {"on": "yes"}, {"speed": 9}, {"local_copy": 1}):
        with pytest.raises(ValueError):
            ps.set_switches(h, "gate_papers", bad)
    with pytest.raises(ValueError, match="own switch"):
        ps.set_switches(h, "mit_ocw", {"on": True})
    with pytest.raises(KeyError):
        ps.set_switches(h, "nowhere", {"on": True})


def test_an_address_is_a_public_site_by_name_and_only_for_a_source_that_takes_one():
    h, net = make()
    with pytest.raises(ValueError, match="takes no address"):
        ps.set_switches(h, "gate_papers", {"address": LIST})
    for bad in ("", "papers.example.org/list", "ftp://papers.example.org/x", "https://me:pw@papers.example.org/", "http://localhost:8777/api",
                "http://127.0.0.1/x", "http://192.168.1.10/list", "http://printer/list", "https://nas.local/x", "http://[::1]/x", "x" * 501):
        if bad:
            with pytest.raises(ValueError):
                ps.set_switches(h, "papers_table", {"address": bad})
    v = ps.set_switches(h, "papers_table", {"address": LIST})
    assert v["address"] == LIST and v["hosts"] == ["papers.example.org"] and v["on"] is False
    ps.set_switches(h, "papers_table", {"on": True, "address": ""})
    with pytest.raises(ps.NeedsAddress):
        ps.index(h, "papers_table")
    assert net.calls == []


# ---------------------------------------------------------------- the listing
def test_the_listing_is_read_once_a_day_and_asked_again_conditionally():
    day = ["2026-11-25"]
    h, net = make(day=day)
    got = table_source(h, net)
    assert set(got) == {"AG-123", "EC-602"} and net.calls == [SITE + "/robots.txt", LIST], "a 404 for robots.txt is no rules"
    r = ps.index(h, "papers_table", q="digital comm")
    assert [i["code"] for i in r["items"]] == ["EC-602"] and r["listed"] == 2 and "another site" in r["note"]
    assert ps.index(h, "papers_table", code="ag-123")["items"][0]["title"] == "Surveying & Levelling"
    assert ps.index(h, "papers_table", q="thermodynamics")["items"] == []
    assert len(net.calls) == 2, "the same day: the reading on file answers"
    net.add(LIST, b"", status=304)
    again = ps.index(h, "papers_table", refresh=True)
    assert len(again["items"]) == 2 and len(net.calls) == 3 and net.headers_seen[-1]["If-None-Match"] == '"v1"'
    day[0] = "2026-11-26"
    assert len(ps.index(h, "papers_table")["items"]) == 2
    assert net.calls[3:] == [SITE + "/robots.txt", LIST], "a new day: robots again, then the page, still conditional"
    assert net.headers_seen[-1]["If-None-Match"] == '"v1"'
    with pytest.raises(ValueError):
        ps.index(h, "papers_table", q="x" * 81)


def test_a_changed_address_forgets_the_old_listing():
    h, net = make()
    key = table_source(h, net)["EC-602"]["key"]
    other = "https://other.example.com/list.html"
    net.add(other, '<table><tr><td><a href="z.pdf">Machines</a></td><td>EE-501</td></tr></table>')
    ps.set_switches(h, "papers_table", {"address": other})
    with pytest.raises(KeyError):
        ps.fetch(h, "papers_table", key)             # a key of the old page is not fetched under the new address
    assert [i["url"] for i in ps.index(h, "papers_table")["items"]] == ["https://other.example.com/z.pdf"]


# ---------------------------------------------------------------- a pointer, a local copy
def test_a_fetch_without_the_second_switch_is_a_pointer_and_asks_the_site_nothing(bank):
    h, net = make()
    got = table_source(h, net)
    before = len(net.calls)
    entry, path = ps.fetch(h, "papers_table", got["EC-602"]["key"])
    assert path is None and len(net.calls) == before
    assert entry["local"] == "pointer only" and entry["bytes"] is None and entry["sha256"] is None and entry["url"] == F2030
    assert entry["source"] == "papers_table" and entry["title"] == "Digital Communication" and entry["terms_note"] and entry["rights"]
    ps.fetch(h, "papers_table", got["EC-602"]["key"])
    assert len(ps.manifest(h)) == 1, "the same pointer twice is one line"
    assert not (bank / "_harvest" / "papers").exists()
    rows = {i["code"]: i["on_file"] for i in ps.index(h, "papers_table")["items"]}
    assert rows == {"AG-123": False, "EC-602": True}
    for bad in ("nope", None, 7, "g" * 12, "0" * 12):
        with pytest.raises(KeyError):
            ps.fetch(h, "papers_table", bad)


def test_with_the_second_switch_the_pdf_is_kept_once_and_replaces_its_pointer(bank):
    h, net = make()
    got = table_source(h, net)
    key = got["EC-602"]["key"]
    ps.fetch(h, "papers_table", key)                                   # the pointer first
    ps.set_switches(h, "papers_table", {"local_copy": True})
    pdf = fake.make_pdf(PAPER)
    net.add(F2030, pdf)
    entry, path = ps.fetch(h, "papers_table", key)
    assert path.read_bytes() == pdf and path.parent == bank / "_harvest" / "papers" / "papers_table"
    assert entry["bytes"] == len(pdf) and len(entry["sha256"]) == 64 and entry["local"] == f"_harvest/papers/papers_table/{path.name}"
    assert entry["robots_checked"] == "2026-11-09" and net.calls[-1] == F2030
    assert [m["local"] for m in ps.manifest(h)] == [entry["local"]], "the file's line replaces the pointer's"
    ps.fetch(h, "papers_table", key)
    assert len(ps.manifest(h)) == 1 and len(list(path.parent.iterdir())) == 1, "re-running is idempotent by hash"
    assert ps.manifest(h, "manual") == [] and len(ps.manifest(h, "papers_table")) == 1


def test_an_answer_that_is_not_a_pdf_is_not_kept(bank):
    h, net = make()
    got = table_source(h, net, local=True)
    net.add(F2030, "<html><body>Please sign in</body></html>")
    with pytest.raises(wh.Refused, match="did not answer with a PDF"):
        ps.fetch(h, "papers_table", got["EC-602"]["key"])
    assert ps.manifest(h) == [] and not (bank / "_harvest" / "papers").exists()


def test_a_paper_file_never_comes_from_another_site(bank):
    h, net = make()
    got = table_source(h, net, local=True)
    net.add(F2030, b"", status=302, headers={"location": "https://elsewhere.example.net/x.pdf"})
    net.add("https://elsewhere.example.net/x.pdf", fake.make_pdf(PAPER))
    with pytest.raises(wh.Refused, match="leaves the source's own site"):
        ps.fetch(h, "papers_table", got["EC-602"]["key"])
    assert net.hits("elsewhere") == 0 and ps.manifest(h) == []
    assert all("elsewhere" not in i["url"] for i in ps.listing(h, "papers_table")["items"]), "and an off-site link is never listed"


def test_a_robots_disallow_stops_that_path():
    h, net = make()
    net.add(SITE + "/robots.txt", "User-agent: *\nDisallow: /exam/pdf_old/\n")
    got = table_source(h, net, local=True)
    assert len(got) == 2, "the listing page itself is allowed"
    with pytest.raises(wh.Refused) as e:
        ps.fetch(h, "papers_table", got["EC-602"]["key"])
    assert e.value.code == "robots" and net.hits("v-2030") == 0


# ---------------------------------------------------------------- the rate rules
def test_one_host_is_asked_at_most_every_three_seconds_and_200_times_a_day():
    clock, net = fake.FakeClock(), fake.FakeNet()
    h = wh.Harvester(transport=net, sleep=clock.sleep, clock=clock.now, today=lambda: "2026-11-25", delay=(0.0, 0.0), rng=random.Random(1))
    table_source(h, net)
    assert clock.sleeps == [wh.HOST_GAP], "robots.txt, then the page: one wait of 3 s between them"
    st = h.load()
    assert st["host_counts"]["papers.example.org"] == {"date": "2026-11-25", "n": 2}
    st["host_counts"]["papers.example.org"]["n"] = wh.HOST_DAILY
    h.save(st)
    with pytest.raises(wh.Refused) as e:
        ps.index(h, "papers_table", refresh=True)
    assert e.value.code == "quota" and len(net.calls) == 2


def test_a_503_is_honoured_for_as_long_as_it_asks():
    clock, net = fake.FakeClock(), fake.FakeNet()
    h = wh.Harvester(transport=net, sleep=clock.sleep, clock=clock.now, today=lambda: "2026-11-25", delay=(0.0, 0.0), rng=random.Random(1))
    net.add(LIST, b"", status=503, headers={"retry-after": "120"})
    ps.set_switches(h, "papers_table", {"address": LIST, "on": True})
    with pytest.raises(wh.Refused, match="left alone for 2 minutes"):
        ps.index(h, "papers_table")
    calls = len(net.calls)
    with pytest.raises(wh.Refused) as e:
        ps.index(h, "papers_table")
    assert e.value.code == "backoff" and len(net.calls) == calls, "inside the two minutes the host is not asked"
    clock.t += 121
    net.add(LIST, TABLE)
    assert len(ps.index(h, "papers_table")["items"]) == 2


def test_a_switch_pressed_while_a_request_is_out_is_not_undone():
    h, net = make()
    net.add(LIST, TABLE)
    ps.set_switches(h, "papers_table", {"address": LIST, "on": True})
    net.on_call = lambda url: ps.set_switches(h, "papers_table", {"local_copy": True}) if url == LIST else None
    ps.index(h, "papers_table")
    assert {v["id"]: v for v in ps.view(h)}["papers_table"]["local_copy"] is True
    assert h.load()["host_counts"]["papers.example.org"]["n"] == 2, "and the request is still counted"


# ---------------------------------------------------------------- a dropped file
def test_a_dropped_file_joins_the_manifest_as_manual_and_only_once(tmp_path):
    h, net = make()
    f = tmp_path / "ec-2019.pdf"
    f.write_bytes(fake.make_pdf(PAPER))
    e = ps.dropin(h, f)
    assert e["source"] == "manual" and e["url"] == "" and e["bytes"] == f.stat().st_size and e["local"] == str(f) and e["robots_checked"] is None
    assert ps.dropin(h, f) == e and len(ps.manifest(h)) == 1 and net.calls == []


# ---------------------------------------------------------------- routes
@pytest.fixture()
def desk(tmp_path, monkeypatch):
    st = Store(tmp_path / "pyq")
    monkeypatch.setattr(store_mod, "default_store", lambda: st)
    net = fake.FakeNet()
    net.add(GATE, DOWNLOADS)
    monkeypatch.setattr(wh, "_SHARED", fake.harvester(net))
    app = create_app(Guard(8777, TOKEN, extra_hosts=["testserver"]), autostart_aankhen="off", features=["ww_harvest", "ww_pyq_ingest"])
    with TestClient(app) as c:
        c.headers.update({"X-Jarvis-Token": TOKEN})
        yield c, net, app, st


S = "/api/mission/harvest/sources"


def wait_for_reading(c):
    for _ in range(200):
        job = c.get("/api/mission/pyq/ingest/last").json()["job"]
        if job and job["status"] != "running":
            return job
        time.sleep(0.05)
    raise AssertionError("the reading job did not finish")


def test_routes_everything_is_off_first_and_nothing_is_asked(desk):
    c, net, _, _ = desk
    s = c.get(S).json()
    assert [(p["id"], p["on"], p["local_copy"], p["kind"]) for p in s["paper_sources"]] == [("gate_papers", False, False, "papers"), ("papers_table", False, False, "papers")]
    assert s["pdf_reader"]["available"] is True and "PyMuPDF" in s["pdf_reader"]["note"] and len(s["sources"]) == 6
    m = c.get("/api/mission/harvest/manifest").json()
    assert m["state"] == "waiting" and m["reason"] == "Nothing fetched or dropped yet." and m["items"] == []
    i = c.get(f"{S}/gate_papers/index").json()
    assert (i["state"], i["reason"], i["items"], i["listed"]) == ("planned", "This source is off.", [], 0)
    w = c.put(f"{S}/papers_table", json={"on": True}).json()
    assert w["state"] == "live" and w["paper_source"]["on"] is True and w["paper_source"]["reason"] == "Give the address of the listing page first."
    assert c.get(f"{S}/papers_table/index").json()["state"] == "waiting"
    assert c.post(f"{S}/gate_papers/fetch", json={"key": "0" * 12}).status_code == 400, "a fetch from a source that is off is refused"
    assert net.calls == []


def test_routes_switch_errors(desk):
    c, _, _, _ = desk
    assert c.put(f"{S}/gate_papers", json={"local_copy": True}).status_code == 400
    assert c.put(f"{S}/gate_papers", json={}).status_code == 400
    assert c.put(f"{S}/gate_papers", json={"address": LIST}).status_code == 400
    assert c.put(f"{S}/papers_table", json={"address": "http://127.0.0.1:8777/api/settings"}).status_code == 400
    r = c.put(f"{S}/mit_ocw", json={"on": True})
    assert r.status_code == 400 and "own switch" in r.json()["detail"]
    assert c.put(f"{S}/nowhere", json={"on": True}).status_code == 404
    assert c.get(f"{S}/nowhere/index").status_code == 404
    assert c.post(f"{S}/nowhere/fetch", json={"key": "0" * 12}).status_code == 404


def test_routes_list_then_a_pointer_then_a_local_copy_that_reaches_the_paper_desk(desk):
    c, net, _, st = desk
    assert c.put(f"{S}/gate_papers", json={"on": True}).json()["paper_source"]["hosts"] == ["gate2027.iitm.ac.in"]
    i = c.get(f"{S}/gate_papers/index", params={"code": "EC"}).json()
    assert i["state"] == "live" and i["count"] == 4 and i["listed"] == 6 and i["note"] == "1 hidden link was skipped" and i["read_at"]
    assert all(set(x) >= {"key", "title", "code", "year", "kind", "url", "on_file"} for x in i["items"])
    paper = next(x for x in i["items"] if x["year"] == 2026 and x["kind"] == "paper")
    before = len(net.calls)
    p = c.post(f"{S}/gate_papers/fetch", json={"key": paper["key"]}).json()
    assert p["state"] == "live" and p["job"] is None and p["entry"]["local"] == "pointer only" and p["entry"]["paper_id"] is None
    assert "not asked" in p["reason"] and len(net.calls) == before
    assert c.post(f"{S}/gate_papers/fetch", json={"key": "f" * 12}).status_code == 404
    assert c.post(f"{S}/gate_papers/fetch", json={"key": paper["key"], "year": "soon"}).status_code == 400

    assert c.put(f"{S}/gate_papers", json={"local_copy": True}).json()["paper_source"]["local_copy"] is True
    pdf = fake.make_pdf(PAPER)
    net.add(paper["url"], pdf)
    r = c.post(f"{S}/gate_papers/fetch", json={"key": paper["key"], "subject": "digital-communication", "year": 2026}).json()
    assert r["state"] == "live" and r["job"]["status"] in ("running", "done") and r["entry"]["bytes"] == len(pdf)
    assert r["entry"]["local"].startswith("_harvest/papers/gate_papers/") and net.calls[-1] == paper["url"]
    job = wait_for_reading(c)
    assert job["status"] == "done" and [f["status"] for f in job["files"]] == ["added"], job
    m = c.get("/api/mission/harvest/manifest", params={"source": "gate_papers"}).json()
    assert m["state"] == "live" and m["count"] == 1 and m["reason"] == "1 file and 0 pointers on record."
    pid = m["items"][0]["paper_id"]
    (on_desk,) = st.list_papers()
    assert pid == on_desk["id"] and on_desk["subject"] == "digital-communication" and on_desk["year"] == 2026
    assert on_desk["source_note"] == f"gate_papers: {paper['url']}", "the desk's paper says where it came from"
    assert c.get(f"{S}/gate_papers/index", params={"q": "2026 question"}).json()["items"][0]["on_file"] is True


def test_routes_a_refusal_is_a_state_with_the_reason_not_an_error(desk):
    c, net, _, _ = desk
    net.add(GATE, b"", status=503)
    c.put(f"{S}/gate_papers", json={"on": True})
    i = c.get(f"{S}/gate_papers/index").json()
    assert i["state"] == "fault" and "503" in i["reason"] and "10 minutes" in i["reason"] and i["items"] == []


def test_routes_no_paper_is_fetched_while_the_desk_is_reading(desk, monkeypatch):
    c, net, app, _ = desk
    c.put(f"{S}/gate_papers", json={"on": True})
    key = c.get(f"{S}/gate_papers/index").json()["items"][0]["key"]
    c.put(f"{S}/gate_papers", json={"local_copy": True})
    monkeypatch.setattr(app.state.pyq_ingest, "running", lambda: True)
    before = len(net.calls)
    assert c.post(f"{S}/gate_papers/fetch", json={"key": key}).status_code == 409
    assert len(net.calls) == before, "asked before the request, so none is wasted"


def test_routes_dropin_puts_his_own_file_on_record_and_reads_it(desk, tmp_path):
    c, net, _, st = desk
    assert c.post("/api/mission/harvest/dropin", json={"path": "papers/ec.pdf"}).status_code == 400
    assert c.post("/api/mission/harvest/dropin", json={"path": str(tmp_path / "missing.pdf")}).status_code == 400
    f = tmp_path / "ec-2019.pdf"
    f.write_bytes(fake.make_pdf(PAPER))
    r = c.post("/api/mission/harvest/dropin", json={"path": str(f), "year": 2019}).json()
    assert r["state"] == "live" and r["entry"]["source"] == "manual" and r["job"] is not None
    assert wait_for_reading(c)["status"] == "done"
    (m,) = c.get("/api/mission/harvest/manifest").json()["items"]
    (paper,) = st.list_papers()
    assert m["paper_id"] == paper["id"] and paper["year"] == 2019 and paper["source_note"] == "a file you downloaded yourself"
    assert net.calls == []
