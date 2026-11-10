"""Knowledge of the day (ww_knowledge.py, routes_ww_knowledge.py, the phone read in routes_phone_ww.py).
Lists are fictional files in a scratch folder; the learning bank is the built-in fictional example.
Nothing may be generated: every card must be an item of its pool."""
import json

import pytest
from starlette.testclient import TestClient

from jarvis_app import germoney, phone, ww_knowledge
from jarvis_app.security import Guard
from jarvis_app.server import create_app

TOKEN = "t" * 32
DAY = "2026-11-10"


class MemKV:
    def __init__(self):
        self.d = {}

    def get(self, k):
        return self.d.get(k)

    def set(self, k, v):
        self.d[k] = v


class StubPlan:
    def __init__(self, n=6):
        self.n = n

    def engine(self, name, today):
        return {"papers": [{"id": "p1", "title": "Paper One", "topics": [
            {"key": f"t{j}", "topic": f"Topic {j}", "unit_title": "Unit A"} for j in range(self.n)]}]}


BANK = {"nodes": {"n1": {"id": "n1", "name": "Signals", "outcomes": ["Convolve", "Sample"]}, "n2": {"id": "n2", "name": "Circuits", "outcomes": []}},
        "order": ["n1", "n2"]}


@pytest.fixture
def kdir(tmp_path, monkeypatch):
    d = tmp_path / "knowledge"
    d.mkdir()
    monkeypatch.setenv("JARVIS_KNOWLEDGE_DIR", str(d))
    monkeypatch.setenv("JARVIS_LEARN_FILE", str(tmp_path / "missing-learn.md"))      # the fictional example concepts
    return d


def fill(d, words=40, facts=5, thoughts=1):
    (d / "words.txt").write_text("# my words\n" + "\n".join(f"word{n} :: meaning of {n}" for n in range(words)), encoding="utf-8")
    (d / "facts.txt").write_text("\n".join(f"Fact {n}." for n in range(facts)), encoding="utf-8")
    (d / "thoughts.txt").write_text("\n".join(f"Thought {n}." for n in range(thoughts)), encoding="utf-8")


# ------------------------------------------------------------------ the lists
def test_word_lines_split_on_the_three_separators_and_comments_and_duplicates_drop():
    items = ww_knowledge.parse_list("word", "# header\nephemeral :: lasting a short time\nterse - brief\nlucid — clear\nbare\n\nterse - brief\n- bullet :: ok")
    assert [(i["title"], i["body"]) for i in items] == [("ephemeral", "lasting a short time"), ("terse", "brief"), ("lucid", "clear"),
                                                         ("bare", ""), ("bullet", "ok")]


def test_ids_are_the_words_not_the_line_number():
    a = ww_knowledge.parse_list("fact", "Alpha.\nBeta.")
    b = ww_knowledge.parse_list("fact", "Gamma.\nBeta.\nAlpha.")
    assert {i["id"] for i in a} <= {i["id"] for i in b}


def test_missing_list_is_empty_and_md_is_read_when_there_is_no_txt(kdir):
    assert ww_knowledge.load_list("word") == []
    (kdir / "facts.md").write_text("A fact.\n", encoding="utf-8")
    assert [i["body"] for i in ww_knowledge.load_list("fact")] == ["A fact."]


# ------------------------------------------------------------------ drawing
def test_window_grows_with_the_pool_then_caps():
    assert [ww_knowledge.window_for(n) for n in (0, 1, 2, 5, 31, 32, 500)] == [0, 0, 1, 4, 30, 30, 30]


@pytest.mark.parametrize("size", [2, 3, 5, 12, 31, 45])
def test_no_item_repeats_inside_the_window_for_any_pool_size(size):
    pool = [{"id": f"i{n}"} for n in range(size)]
    seen, got = [], []
    for k in range(size * 4 + 10):
        item, _ = ww_knowledge.draw(pool, seen, f"s|{k}")
        seen.append({"id": item["id"], "date": DAY})
        got.append(item["id"])
    w = ww_knowledge.window_for(size)
    assert all(len(set(got[i:i + w + 1])) == w + 1 for i in range(len(got) - w)), (size, got)


def test_unseen_items_come_first_then_the_longest_ago():
    pool = [{"id": c} for c in "abcd"]
    seen = [{"id": c, "date": DAY} for c in "abc"]
    assert ww_knowledge.draw(pool, seen, "x")[0]["id"] == "d"            # the only never-seen one
    seen += [{"id": "d", "date": DAY}]
    # all seen, window 3: a is outside it and the oldest
    assert ww_knowledge.draw(pool, seen, "x")[0]["id"] == "a"


def test_same_seed_same_draw_other_seed_can_differ():
    pool = [{"id": str(n)} for n in range(30)]
    assert ww_knowledge.draw(pool, [], "a") == ww_knowledge.draw(pool, [], "a")
    assert len({ww_knowledge.draw(pool, [], f"s{k}")[0]["id"] for k in range(20)}) > 3


def test_empty_pool_draws_nothing_and_a_pool_of_one_says_it_repeats(kdir):
    assert ww_knowledge.draw([], [], "s")[0] is None
    fill(kdir, thoughts=1)
    kv = MemKV()
    ww_knowledge.today_view(kv, DAY, StubPlan(), BANK)
    c = ww_knowledge.refresh(kv, "thought", DAY, StubPlan(), BANK)["lists"][2]
    assert c["body"] == "Thought 0." and "repeats" in c["note"]


# ------------------------------------------------------------------ the day
def test_first_read_draws_six_cards_and_later_reads_return_the_same(kdir):
    fill(kdir)
    kv = MemKV()
    a = ww_knowledge.today_view(kv, DAY, StubPlan(), BANK)
    assert [c["slot"] for c in a["tracks"]] == ["exam", "skill", "life"] and [c["slot"] for c in a["lists"]] == ["word", "fact", "thought"]
    assert not a["empty"] and all(not c["empty"] for c in a["tracks"] + a["lists"])
    assert ww_knowledge.today_view(kv, DAY, StubPlan(), BANK) == a
    # Even with a different plan (the pool changed), today's cards are the stored ones.
    assert ww_knowledge.today_view(kv, DAY, StubPlan(1), BANK) == a


def test_each_card_is_an_item_of_its_pool_never_made_up(kdir):
    fill(kdir)
    kv = MemKV()
    v = ww_knowledge.today_view(kv, DAY, StubPlan(), BANK)
    exam, skill, life = v["tracks"]
    assert exam["title"] in {f"Topic {j}" for j in range(6)} and exam["body"] == "Unit A | Paper One" and exam["source"] == "exams"
    assert (skill["title"], skill["body"]) in {("Signals", "Convolve"), ("Signals", "Sample"), ("Circuits", "")} and skill["source"] == "skilltree"
    assert life["title"] in {"Ohm's law", "Big-O notation"} and life["source"] == "learn-example"       # said, never passed off as his
    assert v["lists"][0]["title"].startswith("word") and v["lists"][1]["body"].startswith("Fact ")


def test_a_new_day_draws_again_and_does_not_repeat_yesterdays_card(kdir):
    fill(kdir)
    kv = MemKV()
    prev = {c["slot"]: c["id"] for c in ww_knowledge.today_view(kv, DAY, StubPlan(), BANK)["lists"]}
    nxt = {c["slot"]: c["id"] for c in ww_knowledge.today_view(kv, "2026-11-11", StubPlan(), BANK)["lists"]}
    assert all(prev[s] != nxt[s] for s in ("word", "fact"))             # pools of 40 and 5; thought has a pool of one


def test_refresh_changes_one_slot_only_and_records_the_draw(kdir):
    fill(kdir)
    kv = MemKV()
    a = ww_knowledge.today_view(kv, DAY, StubPlan(), BANK)
    b = ww_knowledge.refresh(kv, "word", DAY, StubPlan(), BANK)
    assert b["lists"][0]["id"] != a["lists"][0]["id"] and b["lists"][0]["drawn"] == 2
    assert b["tracks"] == a["tracks"] and b["lists"][1:] == a["lists"][1:]
    assert len(json.loads(kv.get(ww_knowledge.KEY))["seen"]["word"]) == 2


def test_an_empty_slot_says_so_and_fills_in_when_the_list_appears(kdir):
    kv = MemKV()
    v = ww_knowledge.today_view(kv, DAY, None, {"nodes": {}, "order": []})
    words = v["lists"][0]
    assert words["empty"] and "words.txt" in words["say"] and v["tracks"][0]["empty"] and "exam" in v["tracks"][0]["say"].lower()
    fill(kdir)
    v2 = ww_knowledge.today_view(kv, DAY, StubPlan(), BANK)
    assert not v2["lists"][0]["empty"] and not v2["tracks"][0]["empty"]


def test_empty_slots_leave_no_history_and_the_example_still_feeds_life(kdir):
    kv = MemKV()
    v = ww_knowledge.today_view(kv, DAY, None, {"nodes": {}, "order": []})
    assert v["empty"] is False                       # the example concepts still feed the life track
    seen = json.loads(kv.get(ww_knowledge.KEY))["seen"]
    assert {k for k, v in seen.items() if v} == {"life"}          # an empty slot leaves no history


def test_unknown_slot_refused(kdir):
    with pytest.raises(ValueError, match="slot is one of"):
        ww_knowledge.refresh(MemKV(), "colour", DAY)


def test_a_corrupt_store_is_treated_as_a_fresh_start(kdir):
    fill(kdir)
    kv = MemKV()
    kv.set(ww_knowledge.KEY, "[[[")
    assert not ww_knowledge.today_view(kv, DAY, StubPlan(), BANK)["empty"]


# ------------------------------------------------------------------ routes
@pytest.fixture()
def client(tmp_path, kdir):
    fill(kdir)
    app = create_app(Guard(8777, TOKEN, extra_hosts=["testserver"]), autostart_aankhen="off", features=["ww_knowledge"])
    import jarvis_app.routes_ww_knowledge as rk
    rk._today = lambda: DAY
    with TestClient(app) as c:
        c.headers.update({"X-Jarvis-Token": TOKEN})
        c.app.state.svc.kv = germoney.KVStore(tmp_path / "kv", tmp_path / "bk")
        yield c
    rk._today = lambda: __import__("datetime").date.today().isoformat()


def test_routes_today_and_refresh(client):
    a = client.get("/api/mission/knowledge/today").json()
    assert a["date"] == DAY and len(a["tracks"]) == 3 and len(a["lists"]) == 3
    assert client.get("/api/mission/knowledge/today").json() == a
    r = client.post("/api/mission/knowledge/refresh", json={"slot": "fact"}).json()
    assert r["lists"][1]["id"] != a["lists"][1]["id"] and r["lists"][0] == a["lists"][0]
    assert client.post("/api/mission/knowledge/refresh", json={"slot": "colour"}).status_code == 400
    assert client.post("/api/mission/knowledge/refresh", json={}).status_code == 422


# ------------------------------------------------------------------ the phone door
@pytest.fixture
def phone_client(tmp_path, kdir, monkeypatch):
    fill(kdir)
    monkeypatch.setattr(phone, "CONFIG_FILE", tmp_path / "pc.json")
    monkeypatch.setattr(phone, "DEVICES_FILE", tmp_path / "pd.json")
    monkeypatch.setattr(phone, "INBOX", tmp_path / "inbox")
    app = create_app(Guard(8777, TOKEN, extra_hosts=["testserver"]), autostart_aankhen="off", features=["phone", "phone_ww", "security"])
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
        yield c


def test_phone_reads_and_refreshes_the_cards(phone_client):
    c = phone_client
    a = c.get("/api/phone/ww/knowledge").json()
    assert len(a["lists"]) == 3 and a["lists"][0]["title"].startswith("word")
    assert c.get("/api/phone/ww/knowledge").json() == a
    r = c.post("/api/phone/ww/knowledge/refresh", json={"slot": "word"}).json()
    assert r["lists"][0]["id"] != a["lists"][0]["id"]
    assert c.post("/api/phone/ww/knowledge/refresh", json={"slot": "x"}).status_code == 400


def test_phone_knowledge_needs_a_paired_phone(phone_client):
    c = phone_client
    c.cookies.clear()
    assert c.get("/api/phone/ww/knowledge").status_code == 401
