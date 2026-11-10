"""Resource checklists (ww_resources.py, routes_ww_resources.py, the phone read and tap in
routes_phone_ww.py). Everything is fictional: a two-node bank written into a scratch folder, an
in-memory or scratch key-value store. Counts must come from taps and nothing else."""
import json

import pytest
from starlette.testclient import TestClient

from jarvis_app import germoney, phone, ww_resources
from jarvis_app.security import Guard
from jarvis_app.server import create_app

TOKEN = "t" * 32
LECTURES = "\n".join(f"Lecture {n}: Part {n}" for n in range(1, 13))


class MemKV:
    def __init__(self):
        self.d = {}

    def get(self, k):
        return self.d.get(k)

    def set(self, k, v):
        self.d[k] = v


def make_bank():
    tree = {"version": 1, "careers": [], "nodes": [
        {"id": "sig", "name": "Signals", "branch": "general", "resources": ["course-a", "book-b"], "outcomes": ["Convolve"]},
        {"id": "cir", "name": "Circuits", "branch": "general", "resources": ["course-c"]}]}
    res = [{"id": "course-a", "title": "Course A", "kind": "course", "url": "https://example.invalid/a"},
           {"id": "book-b", "title": "Book B", "kind": "book", "url": "https://example.invalid/b"},
           {"id": "course-c", "title": "Course C", "kind": "course", "url": "https://example.invalid/c"}]
    return germoney.merge_bank({"skilltree.json": tree, "resources-career.json": res})


@pytest.fixture
def bank():
    return make_bank()


# ------------------------------------------------------------------ parsing
def test_parse_strips_bullets_numbers_and_guesses_the_kind_from_the_first_word():
    items = ww_resources.parse_checklist("- Chapter 1: Limits\n2. Lecture 2\n\nSet 3 problems\nSetup notes\n* Week 5")
    assert [i["kind"] for i in items] == ["chapter", "lecture", "exercise", "section", "week"]
    assert items[0]["title"] == "Chapter 1: Limits"


def test_repeated_titles_get_distinct_ids_and_a_list_works_as_input():
    items = ww_resources.parse_checklist(["Review", "Review", {"title": "Final", "kind": "exercise"}])
    assert [i["id"] for i in items] == ["review", "review-2", "final"] and items[2]["kind"] == "exercise"


@pytest.mark.parametrize("raw", ["", "  \n \n", [], 5, [{"title": "x", "kind": "movie"}], [3], "x" * 121, "\n".join(str(i) + "a" for i in range(301))])
def test_bad_checklists_are_refused_in_words(raw):
    with pytest.raises(ValueError) as e:
        ww_resources.parse_checklist(raw)
    assert str(e.value)


# ------------------------------------------------------------------ taps and counts
def typed(bank, kv=None):
    kv = kv or MemKV()
    ww_resources.set_checklist(kv, bank, "course-a", LECTURES, "2026-11-10")
    return kv


def test_counts_come_only_from_taps_and_skips_leave_the_denominator(bank):
    kv = typed(bank)
    s = ww_resources.summary(bank, "course-a", ww_resources._load(kv)["lists"]["course-a"], "2026-11-10")
    assert (s["done"], s["skipped"], s["left"]) == (0, 0, 12) and s["pct"] == 0 and s["at"] is None
    for n in (1, 2, 3):
        ww_resources.tap(kv, bank, "course-a", f"lecture-{n}-part-{n}", "done", "2026-11-10")
    s = ww_resources.tap(kv, bank, "course-a", "lecture-4-part-4", "skip", "2026-11-10")
    assert (s["done"], s["skipped"], s["left"], s["pct"]) == (3, 1, 8, 27)       # 3 of 11 counted
    assert s["say"] == "3 of 11 sections done (1 skipped); 8 left."
    assert s["at"]["id"] == "lecture-4-part-4" and s["next"]["id"] == "lecture-5-part-5"


def test_skipping_never_lowers_the_percentage(bank):
    kv = typed(bank)
    ww_resources.tap(kv, bank, "course-a", "lecture-1-part-1", "done", "2026-11-10")
    before = ww_resources.detail(kv, bank, "course-a", "2026-11-10")["pct"]
    after = ww_resources.tap(kv, bank, "course-a", "lecture-2-part-2", "skip", "2026-11-10")["pct"]
    assert after >= before


def test_here_moves_the_bookmark_without_finishing_and_open_clears_a_mark(bank):
    kv = typed(bank)
    s = ww_resources.tap(kv, bank, "course-a", "lecture-7-part-7", "here", "2026-11-10")
    assert s["done"] == 0 and s["at"]["id"] == "lecture-7-part-7" and s["next"]["id"] == "lecture-8-part-8"
    ww_resources.tap(kv, bank, "course-a", "lecture-2-part-2", "done", "2026-11-10")
    s = ww_resources.tap(kv, bank, "course-a", "lecture-2-part-2", "open", "2026-11-10")
    # Clearing a mark does not move the bookmark: it stays where the done tap put it.
    assert s["done"] == 0 and s["at"]["id"] == "lecture-2-part-2"


def test_next_wraps_to_the_first_open_item_when_nothing_is_open_after_the_bookmark(bank):
    kv = typed(bank)
    for n in range(2, 13):
        ww_resources.tap(kv, bank, "course-a", f"lecture-{n}-part-{n}", "done", "2026-11-10")
    s = ww_resources.summary(bank, "course-a", ww_resources._load(kv)["lists"]["course-a"], "2026-11-10")
    assert s["next"]["id"] == "lecture-1-part-1"
    s = ww_resources.tap(kv, bank, "course-a", "lecture-1-part-1", "done", "2026-11-10")
    assert s["next"] is None and s["left"] == 0 and s["say"] == "All 12 sections done."


def test_retyping_keeps_the_marks_of_surviving_ids_and_counts_the_dropped(bank):
    kv = typed(bank)
    for n in (1, 2, 3):
        ww_resources.tap(kv, bank, "course-a", f"lecture-{n}-part-{n}", "done", "2026-11-10")
    ww_resources.tap(kv, bank, "course-a", "lecture-12-part-12", "skip", "2026-11-10")
    r = ww_resources.set_checklist(kv, bank, "course-a", "\n".join(f"Lecture {n}: Part {n}" for n in range(1, 11)), "2026-11-11")
    assert r == {"rid": "course-a", "items": 10, "kept_marks": 3, "dropped_marks": 1}
    assert ww_resources.detail(kv, bank, "course-a", "2026-11-11")["at"] is None        # its bookmark item went


def test_taps_are_refused_when_they_make_no_sense(bank):
    kv = typed(bank)
    for args in (("nope", "x", "done"), ("course-a", "nope", "done"), ("course-a", "lecture-1-part-1", "finished"), ("course-c", "x", "done")):
        with pytest.raises(ValueError):
            ww_resources.tap(kv, bank, *args, "2026-11-10")
    with pytest.raises(ValueError, match="no checklist"):
        ww_resources.tap(kv, bank, "course-c", "x", "done", "2026-11-10")


# ------------------------------------------------------------------ weekly
def test_weekly_counts_by_monday_week_oldest_first_and_marks_the_current_week_partial(bank):
    kv = typed(bank)
    for n, day in enumerate(["2026-10-26", "2026-11-01", "2026-11-02", "2026-11-08", "2026-11-09", "2026-11-10"], start=1):
        ww_resources.tap(kv, bank, "course-a", f"lecture-{n}-part-{n}", "done", day)
    w = ww_resources.weekly(kv, bank, "2026-11-10", 3)
    assert [r["week"] for r in w["weeks"]] == ["2026-10-26", "2026-11-02", "2026-11-09"]
    assert [r["done"] for r in w["weeks"]] == [2, 2, 2]                    # 10-26 and 11-01 are one Monday-week
    assert [r.get("partial") for r in w["weeks"]] == [None, None, True]
    assert w["total"] == 6 and w["this_week"] == 2
    assert w["weeks"][-1]["by_resource"] == {"course-a": 2}


def test_weekly_with_nothing_done_says_so_and_clamps_the_window(bank):
    w = ww_resources.weekly(MemKV(), bank, "2026-11-10", 0)
    assert len(w["weeks"]) == 1 and w["total"] == 0 and w["say"].startswith("No section")
    assert len(ww_resources.weekly(MemKV(), bank, "2026-11-10", 999)["weeks"]) == ww_resources.WEEKS_MAX


def test_progress_lists_resources_with_lists_and_a_node_lists_all_its_resources(bank):
    kv = typed(bank)
    p = ww_resources.progress(kv, bank, "2026-11-10")
    assert [r["rid"] for r in p["resources"]] == ["course-a"] and p["without_list"] == 2 and not p["empty"]
    n = ww_resources.progress(kv, bank, "2026-11-10", node="sig")
    assert [(r["rid"], r["has_list"]) for r in n["resources"]] == [("course-a", True), ("book-b", False)]
    assert "No checklist" in n["resources"][1]["say"]
    assert ww_resources.progress(MemKV(), bank, "2026-11-10")["empty"] is True
    with pytest.raises(ValueError, match="unknown node"):
        ww_resources.progress(kv, bank, "2026-11-10", node="zzz")


def test_a_corrupt_store_reads_as_empty_not_as_an_error(bank):
    kv = MemKV()
    kv.set(ww_resources.KEY, "{not json")
    assert ww_resources.progress(kv, bank, "2026-11-10")["empty"] is True
    kv.set(ww_resources.KEY, json.dumps([1, 2]))
    assert ww_resources.weekly(kv, bank, "2026-11-10")["total"] == 0


# ------------------------------------------------------------------ desktop routes
@pytest.fixture()
def client(tmp_path, monkeypatch):
    bank_dir = tmp_path / "bank"
    bank_dir.mkdir()
    (bank_dir / "skilltree.json").write_text(json.dumps({"version": 1, "careers": [], "nodes": [
        {"id": "sig", "name": "Signals", "branch": "general", "resources": ["course-a"]}]}), encoding="utf-8")
    (bank_dir / "resources-career.json").write_text(json.dumps([
        {"id": "course-a", "title": "Course A", "kind": "course", "url": "https://example.invalid/a"}]), encoding="utf-8")
    monkeypatch.setenv("JARVIS_MISSION_BANK", str(bank_dir))
    app = create_app(Guard(8777, TOKEN, extra_hosts=["testserver"]), autostart_aankhen="off", features=["ww_resources"])
    import jarvis_app.routes_ww_resources as rr
    monkeypatch.setattr(rr, "_today", lambda: "2026-11-10")
    with TestClient(app) as c:
        c.headers.update({"X-Jarvis-Token": TOKEN})
        c.app.state.svc.kv = germoney.KVStore(tmp_path / "kv", tmp_path / "bk")          # never the real store
        yield c


def test_route_round_trip_type_tap_read(client):
    r = client.put("/api/mission/resource/course-a/checklist", json={"items": LECTURES})
    assert r.status_code == 200 and r.json()["items"] == 12 and r.json()["resource"]["items"][0]["state"] == "open"
    t = client.post("/api/mission/resource/course-a/tap", json={"item": "lecture-1-part-1", "state": "done"}).json()
    assert t["done"] == 1 and t["this_week"] == 1
    d = client.get("/api/mission/resource/course-a").json()
    assert d["items"][0]["state"] == "done" and d["items"][0]["date"] == "2026-11-10" and d["items"][0]["here"] is True
    p = client.get("/api/mission/resources/progress", params={"node": "sig"}).json()
    assert p["resources"][0]["done"] == 1 and p["weekly"]["weeks"][-1]["done"] == 1
    assert client.get("/api/mission/resources/weekly", params={"weeks": 2}).json()["total"] == 1


def test_route_errors_are_plain_and_correctly_coded(client):
    assert client.get("/api/mission/resource/nope").status_code == 404
    assert client.put("/api/mission/resource/nope/checklist", json={"items": "a"}).status_code == 404
    assert client.get("/api/mission/resources/progress", params={"node": "zzz"}).status_code == 404
    assert client.put("/api/mission/resource/course-a/checklist", json={"items": "  "}).status_code == 400
    assert client.post("/api/mission/resource/course-a/tap", json={"item": "x", "state": "done"}).status_code == 400
    assert client.post("/api/mission/resource/course-a/tap", json={"state": "done"}).status_code == 422


def test_clearing_a_checklist_removes_its_marks(client):
    client.put("/api/mission/resource/course-a/checklist", json={"items": LECTURES})
    client.post("/api/mission/resource/course-a/tap", json={"item": "lecture-1-part-1", "state": "done"})
    assert client.delete("/api/mission/resource/course-a/checklist").json() == {"rid": "course-a", "removed": True}
    assert client.get("/api/mission/resource/course-a").json()["has_list"] is False
    assert client.get("/api/mission/resources/weekly").json()["total"] == 0


# ------------------------------------------------------------------ the phone door
@pytest.fixture
def phone_client(client, tmp_path, monkeypatch):
    monkeypatch.setattr(phone, "CONFIG_FILE", tmp_path / "pc.json")
    monkeypatch.setattr(phone, "DEVICES_FILE", tmp_path / "pd.json")
    monkeypatch.setattr(phone, "INBOX", tmp_path / "inbox")
    app = create_app(Guard(8777, TOKEN, extra_hosts=["testserver"]), autostart_aankhen="off", features=["phone", "phone_ww", "ww_resources", "security"])
    access = app.state.phone
    access.config_path = tmp_path / "pc.json"
    access.devices = phone.DeviceStore(tmp_path / "pd.json")
    access.addresses_fn = lambda: ["192.168.1.50"]
    access.listen = False
    with TestClient(app, base_url="http://192.168.1.50:8778", client=("192.168.1.20", 50123)) as c:
        app.state.svc.kv = germoney.KVStore(tmp_path / "kv2", tmp_path / "bk2")
        d = {"X-Jarvis-Token": TOKEN}
        c.put("http://testserver/api/remote", headers=d, json={"enabled": True})
        code = c.post("http://testserver/api/remote/pair", headers=d, json={}).json()["code"]
        assert c.post("/api/phone/pair", headers={"X-Jarvis-Phone": "1"}, json={"code": code, "name": "Phone"}).status_code == 200
        c.headers.update({"X-Jarvis-Phone": "1"})
        # the checklist is typed on the desktop door
        assert c.put("http://testserver/api/mission/resource/course-a/checklist", headers=d, json={"items": LECTURES}).status_code == 200
        yield c


def test_phone_reads_and_taps_the_same_data(phone_client):
    c = phone_client
    p = c.get("/api/phone/ww/resources").json()
    assert p["resources"][0]["rid"] == "course-a" and p["resources"][0]["done"] == 0 and len(p["weekly"]["weeks"]) == 4
    t = c.post("/api/phone/ww/resource/tap", json={"rid": "course-a", "item": "lecture-1-part-1", "state": "done"}).json()
    assert t["done"] == 1
    assert c.get("/api/phone/ww/resources", params={"node": "sig"}).json()["resources"][0]["done"] == 1
    assert c.post("/api/phone/ww/resource/tap", json={"rid": "course-a", "item": "x", "state": "done"}).status_code == 400


def test_phone_resources_need_a_paired_phone(phone_client):
    c = phone_client
    c.cookies.clear()
    assert c.get("/api/phone/ww/resources").status_code == 401
