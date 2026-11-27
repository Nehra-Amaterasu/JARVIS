"""R-63 the life counter row's layout, and the optional `expect` on POST /api/mission/life/count (wave EW9).
The store is a scratch folder; the counters are the generic defaults (college, snacks, screen, water)."""
import pytest
from starlette.testclient import TestClient

from jarvis_app import germoney, ww_life
from jarvis_app.security import Guard
from jarvis_app.server import create_app

TOKEN = "t" * 32
IDS = [c["id"] for c in ww_life.DEFAULT_COUNTERS]


@pytest.fixture
def kv(tmp_path):
    return germoney.KVStore(tmp_path / "kv", tmp_path / "bk")          # never the real store


def make_client(kv):
    app = create_app(Guard(8777, TOKEN, extra_hosts=["testserver"]), autostart_aankhen="off", features=["mission", "ww_life"])
    c = TestClient(app)
    c.__enter__()
    c.headers.update({"X-Jarvis-Token": TOKEN})
    c.app.state.svc.kv = kv
    c.app.state.svc.plan.kv = kv
    return c


@pytest.fixture
def client(kv):
    c = make_client(kv)
    yield c
    c.__exit__(None, None, None)


def count(client, **body):
    return client.post("/api/mission/life/count", json=body)


def today_of(client, cid):
    return next(x for x in client.get("/api/mission/life").json()["counters"] if x["id"] == cid)["today"]


# ------------------------------------------------------------------ the pure functions
def test_layout_without_a_saved_one_is_every_counter_in_settings_order():
    assert ww_life.layout(None, IDS) == {"shown": IDS, "order": IDS}
    assert ww_life.layout({}, IDS) == {"shown": IDS, "order": IDS}


def test_a_counter_added_in_settings_later_goes_to_the_end_and_shows():
    saved = {"order": ["water", "college", "snacks", "screen"], "shown": ["water"]}
    got = ww_life.layout(saved, IDS + ["steps"])
    assert got == {"order": ["water", "college", "snacks", "screen", "steps"], "shown": ["water", "steps"]}


def test_a_counter_removed_from_settings_drops_out():
    saved = {"order": ["water", "gone", "college"], "shown": ["gone", "college"]}
    got = ww_life.layout(saved, ["college", "water"])
    assert got == {"order": ["water", "college"], "shown": ["college"]}


def test_clean_layout_dedupes_and_refuses_non_lists():
    got = ww_life.clean_layout({"order": ["water", "water", "snacks"], "shown": ["snacks", "snacks"]}, IDS)
    assert got["order"] == ["water", "snacks", "college", "screen"] and got["shown"] == ["snacks"]
    for bad in ({"order": "water"}, {"shown": [1]}, {}, {"other": []}):
        with pytest.raises(ValueError):
            ww_life.clean_layout(bad, IDS)


# ------------------------------------------------------------------ R-63 the routes
def test_get_before_any_put_answers_the_present_default(client):
    r = client.get("/api/mission/life/layout")
    assert r.status_code == 200
    assert r.json() == {"shown": IDS, "order": IDS, "saved": False}


def test_layout_round_trip(client):
    body = {"shown": ["water", "snacks"], "order": ["water", "screen", "snacks", "college"]}
    r = client.put("/api/mission/life/layout", json=body)
    assert r.status_code == 200
    assert r.json() == {"shown": ["water", "snacks"], "order": ["water", "screen", "snacks", "college"], "saved": True}
    assert client.get("/api/mission/life/layout").json() == r.json()


def test_unknown_ids_are_a_400_and_nothing_is_written(client):
    for body in ({"shown": ["water", "nope"], "order": IDS}, {"shown": IDS, "order": ["nope"]}, {"order": "water"}, {}):
        r = client.put("/api/mission/life/layout", json=body)
        assert r.status_code == 400, body
    assert "nope" in client.put("/api/mission/life/layout", json={"order": ["nope"]}).json()["detail"]
    assert client.get("/api/mission/life/layout").json()["saved"] is False


def test_a_counter_missing_from_order_keeps_its_place_at_the_end(client):
    r = client.put("/api/mission/life/layout", json={"shown": ["screen", "water"], "order": ["screen", "water"]}).json()
    assert r["order"] == ["screen", "water", "college", "snacks"]           # the missing two, in Settings order
    assert r["shown"] == ["screen", "water"]                                # he sent shown, so they stay hidden


def test_a_field_left_out_keeps_what_was_saved(client):
    client.put("/api/mission/life/layout", json={"shown": ["water"], "order": ["water", "snacks", "screen", "college"]})
    r = client.put("/api/mission/life/layout", json={"shown": ["water", "college"]}).json()
    assert r["order"] == ["water", "snacks", "screen", "college"] and r["shown"] == ["water", "college"]


def test_the_layout_survives_a_reload_of_the_store(client, kv):
    client.put("/api/mission/life/layout", json={"shown": ["college"], "order": ["college", "water", "snacks", "screen"]})
    other = make_client(kv)                                 # a second app over the same store: another device, a restart
    try:
        assert other.get("/api/mission/life/layout").json() == {"shown": ["college"], "order": ["college", "water", "snacks", "screen"],
                                                               "saved": True}
    finally:
        other.__exit__(None, None, None)
    assert germoney.Plan(kv).load()["life_layout"]["shown"] == ["college"]     # in the plan state, not the browser


def test_a_count_never_touches_the_layout_and_the_layout_never_touches_a_count(client):
    client.put("/api/mission/life/layout", json={"shown": ["water"], "order": IDS})
    assert count(client, id="water", delta=2).status_code == 200
    assert client.get("/api/mission/life/layout").json()["shown"] == ["water"]
    client.put("/api/mission/life/layout", json={"shown": IDS})
    assert today_of(client, "water") == 2


# ------------------------------------------------------------------ expect on POST /api/mission/life/count
def test_expect_that_matches_writes_as_before(client):
    assert count(client, id="water", value=3).status_code == 200
    r = count(client, id="water", value=1, expect=3)
    assert r.status_code == 200
    assert next(x for x in r.json()["counters"] if x["id"] == "water")["today"] == 1


def test_expect_that_differs_is_a_409_with_the_present_value_and_nothing_is_written(client):
    count(client, id="water", value=3)
    count(client, id="water", delta=1)                     # another window counted: now 4
    r = count(client, id="water", value=3, expect=3)       # the undo of a tap he saw as 3
    assert r.status_code == 409
    d = r.json()["detail"]
    assert d["present"] == 4 and d["id"] == "water" and "changed" in d["message"]
    assert today_of(client, "water") == 4
    assert count(client, id="water", delta=-1, expect=5).status_code == 409   # a delta is guarded the same way
    assert today_of(client, "water") == 4


def test_an_unlogged_count_is_expected_as_zero(client):
    assert count(client, id="snacks", value=2, expect=0).status_code == 200
    assert count(client, id="screen", value=1, expect=None).status_code == 200
    r = count(client, id="college", value=1, expect=1)
    assert r.status_code == 409 and r.json()["detail"]["present"] is None    # not logged today: present is null
    assert today_of(client, "college") is None


def test_a_bad_expect_is_a_400(client):
    for bad in ("3", True, [3]):
        assert count(client, id="water", value=1, expect=bad).status_code == 400
    assert today_of(client, "water") is None


def test_without_expect_the_count_behaves_exactly_as_today(client):
    assert count(client, id="water", delta=1).status_code == 200
    assert count(client, id="water", delta=1).status_code == 200
    assert count(client, id="water", value=7).status_code == 200
    assert today_of(client, "water") == 7
    assert count(client, id="water", value=501).status_code == 400       # the old bounds still hold
    assert count(client, id="nope", value=1).status_code == 400
    assert count(client, id="water", delta=-8).status_code == 400
    assert today_of(client, "water") == 7
