"""Life workspace backend (ww_life.py delete / restore / reels_pending, routes_ww_life.py).
Every row here is fictional; the store is a scratch folder, never the real one."""
from datetime import date

import pytest
from starlette.testclient import TestClient

from jarvis_app import germoney, ww_life
from jarvis_app.security import Guard
from jarvis_app.server import create_app

TOKEN = "t" * 32


# ------------------------------------------------------------------ the pure functions
def log_of(*items, day="2026-11-10"):
    return {day: {"items": [dict(i) for i in items]}}


def test_delete_returns_the_item_and_keeps_the_others_in_order():
    log = log_of({"kind": "meal", "text": "dal"}, {"kind": "anime", "text": "ep 3", "minutes": 24}, {"kind": "reel", "text": "a trick"})
    got = ww_life.delete_item(log, "2026-11-10", 1, "anime", "ep 3")
    assert got == {"kind": "anime", "text": "ep 3", "minutes": 24}
    assert [i["text"] for i in log["2026-11-10"]["items"]] == ["dal", "a trick"]


def test_delete_refuses_a_row_that_moved_and_changes_nothing():
    log = log_of({"kind": "meal", "text": "dal"}, {"kind": "meal", "text": "rice"})
    before = [dict(i) for i in log["2026-11-10"]["items"]]
    for idx, kind, text in ((0, "meal", "rice"), (1, "reel", "rice"), (5, "meal", "dal"), (-1, "meal", "rice"), (True, "meal", "rice"), ("0", "meal", "dal")):
        with pytest.raises(ValueError):
            ww_life.delete_item(log, "2026-11-10", idx, kind, text)
    assert log["2026-11-10"]["items"] == before


def test_restore_puts_the_item_back_where_it_was_and_clamps_a_short_list():
    log = log_of({"kind": "meal", "text": "dal"}, {"kind": "anime", "text": "ep 3"}, {"kind": "reel", "text": "a trick"})
    got = ww_life.delete_item(log, "2026-11-10", 1, "anime", "ep 3")
    ww_life.restore_item(log, "2026-11-10", 1, got)
    assert [i["text"] for i in log["2026-11-10"]["items"]] == ["dal", "ep 3", "a trick"]
    ww_life.restore_item(log, "2026-11-10", 99, {"kind": "note", "text": "late"})
    assert log["2026-11-10"]["items"][-1]["text"] == "late"


def test_restore_validates_like_the_add_does():
    log = log_of()
    with pytest.raises(ValueError):
        ww_life.restore_item(log, "2026-11-10", 0, {"kind": "nonsense", "text": "x"})
    with pytest.raises(ValueError):
        ww_life.restore_item(log, "2026-11-10", 0, {"kind": "meal", "text": "   "})
    it = ww_life.restore_item(log, "2026-11-10", 0, {"kind": "reel", "text": "t" * 900, "minutes": 99999, "url": "javascript:alert(1)", "extra": 1})
    assert len(it["text"]) == 500 and "minutes" not in it and "url" not in it and "extra" not in it


def test_restore_keeps_an_explained_reel_explained():
    log = log_of()
    ww_life.restore_item(log, "2026-11-10", 0, {"kind": "reel", "text": "r", "explained": "2026-11-10", "explanation": "because", "grade": {"score": 2}})
    only = log["2026-11-10"]["items"][0]
    assert only["explained"] == "2026-11-10" and only["explanation"] == "because" and only["grade"] == {"score": 2}


def test_a_full_day_refuses_a_restore_instead_of_growing():
    log = log_of(*({"kind": "note", "text": f"n{i}"} for i in range(ww_life.MAX_ITEMS)))
    with pytest.raises(ValueError):
        ww_life.restore_item(log, "2026-11-10", 0, {"kind": "note", "text": "one more"})


def test_reels_pending_counts_today_and_earlier_and_skips_explained_ones_without_the_cap_of_three():
    log = {"2026-11-10": {"items": [{"kind": "reel", "text": "a"}, {"kind": "meal", "text": "m"}]}}
    for n in range(1, 6):
        log[f"2026-11-0{n}"] = {"items": [{"kind": "reel", "text": f"old{n}"}]}
    log["2026-11-06"] = {"items": [{"kind": "reel", "text": "done", "explained": "2026-11-07"}]}
    p = ww_life.reels_pending(log, "2026-11-10")
    assert p == {"queued_today": 1, "due": 5, "total": 6}
    engine = ww_life.life({}, "2026-11-10", log)
    assert len(engine["reels_to_explain"]) == 3       # the engine caps at 3; the count above does not


def test_nothing_pending_is_zero_not_missing():
    assert ww_life.reels_pending({}, "2026-11-10") == {"queued_today": 0, "due": 0, "total": 0}


# ------------------------------------------------------------------ the routes
@pytest.fixture
def client(tmp_path):
    app = create_app(Guard(8777, TOKEN, extra_hosts=["testserver"]), autostart_aankhen="off", features=["mission", "ww_life"])
    with TestClient(app) as c:
        c.headers.update({"X-Jarvis-Token": TOKEN})
        kv = germoney.KVStore(tmp_path / "kv", tmp_path / "bk")          # never the real store
        c.app.state.svc.kv = kv
        c.app.state.svc.plan.kv = kv
        yield c


def add(client, kind, text, **kw):
    r = client.post("/api/mission/life/item", json={"kind": kind, "text": text, **kw})
    assert r.status_code == 200, r.text
    return r.json()


def rows(client):
    return client.get("/api/mission/life/day").json()["item_rows"]


def test_day_lists_each_item_with_its_index_and_counts_pending_reels(client):
    d = client.get("/api/mission/life/day").json()
    assert d["item_rows"] == [] and d["reels_pending"] == {"queued_today": 0, "due": 0, "total": 0}
    add(client, "meal", "dal", minutes=15)
    add(client, "reel", "a trick", url="https://example.com/r")
    d = client.get("/api/mission/life/day").json()
    assert [(r["index"], r["kind"], r["text"]) for r in d["item_rows"]] == [(0, "meal", "dal"), (1, "reel", "a trick")]
    assert d["reels_pending"]["queued_today"] == 1 and d["reels_pending"]["total"] == 1
    assert d["engine"] == "life" and "counters" in d            # the plain life view is still in there


def test_delete_then_undo_round_trips_to_the_same_list(client):
    add(client, "meal", "dal")
    add(client, "anime", "ep 3", minutes=24)
    add(client, "reel", "a trick")
    before = rows(client)
    r = client.post("/api/mission/life/item/delete", json={"index": 1, "kind": "anime", "text": "ep 3"})
    assert r.status_code == 200
    body = r.json()
    assert body["removed"] == {"kind": "anime", "text": "ep 3", "minutes": 24} and body["index"] == 1
    assert [x["text"] for x in body["item_rows"]] == ["dal", "a trick"]
    assert [x["text"] for x in rows(client)] == ["dal", "a trick"]          # really gone from the store
    back = client.post("/api/mission/life/item/restore", json={"index": body["index"], "item": body["removed"]})
    assert back.status_code == 200
    assert rows(client) == before


def test_deleting_a_reel_drops_the_pending_count_and_undo_brings_it_back(client):
    add(client, "reel", "a trick")
    r = client.post("/api/mission/life/item/delete", json={"index": 0, "kind": "reel", "text": "a trick"}).json()
    assert r["reels_pending"]["total"] == 0
    back = client.post("/api/mission/life/item/restore", json={"index": 0, "item": r["removed"]}).json()
    assert back["reels_pending"]["queued_today"] == 1


def test_delete_with_a_stale_row_is_a_400_and_removes_nothing(client):
    add(client, "meal", "dal")
    add(client, "meal", "rice")
    r = client.post("/api/mission/life/item/delete", json={"index": 0, "kind": "meal", "text": "rice"})
    assert r.status_code == 400 and "changed" in r.json()["detail"]
    assert [x["text"] for x in rows(client)] == ["dal", "rice"]
    assert client.post("/api/mission/life/item/delete", json={"index": 9, "kind": "meal", "text": "dal"}).status_code == 400
    assert client.post("/api/mission/life/item/delete", json={}).status_code == 400


def test_restore_rejects_a_bad_body(client):
    assert client.post("/api/mission/life/item/restore", json={"index": 0}).status_code == 400
    assert client.post("/api/mission/life/item/restore", json={"index": 0, "item": {"kind": "bogus", "text": "x"}}).status_code == 400
    assert rows(client) == []


def test_the_new_routes_leave_the_old_ones_alone(client):
    add(client, "meal", "dal")
    assert client.get("/api/mission/life").json()["items"][0]["text"] == "dal"
    c = client.post("/api/mission/life/count", json={"id": "water", "delta": 1})
    assert c.status_code == 200
    client.post("/api/mission/life/item/delete", json={"index": 0, "kind": "meal", "text": "dal"})
    water = next(x for x in client.get("/api/mission/life").json()["counters"] if x["id"] == "water")
    assert water["today"] == 1                    # a delete never touches a counter
    assert date.today().isoformat() == client.get("/api/mission/life/day").json()["date"]
