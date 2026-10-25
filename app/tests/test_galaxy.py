"""The memory galaxy (ROADMAP Y1, Y2): layout, cache, payload limits, growth, routes.

Everything runs on a throwaway LanceDB of invented rows with synthetic vectors in
three clusters, plus an invented people table and taste profile. Nothing reads
data/yaadash, and the embedding model is never loaded."""
import json
import subprocess
import sys

import numpy as np
import pandas as pd
import pyarrow as pa
import pytest
from fastapi import FastAPI
from starlette.testclient import TestClient

from jarvis_app.paths import YAADASH, ensure_jarvis_importable

ensure_jarvis_importable()
import yaadash_galaxy as yg  # noqa: E402

DIM = 384
LONG = "This is a deliberately long private message. " * 20     # ~900 chars

MEM_SCHEMA = pa.schema([
    pa.field("id", pa.string()), pa.field("text", pa.string()),
    pa.field("vector", pa.list_(pa.float32(), DIM)), pa.field("source", pa.string()),
    pa.field("role", pa.string()), pa.field("timestamp", pa.string()), pa.field("user_id", pa.string()),
])
BELIEF_SCHEMA = pa.schema([
    pa.field("id", pa.string()), pa.field("claim", pa.string()), pa.field("category", pa.string()),
    pa.field("era", pa.string()), pa.field("confidence", pa.float64()), pa.field("status", pa.string()),
    pa.field("support", pa.int64()), pa.field("evidence", pa.string()), pa.field("source", pa.string()),
    pa.field("updated", pa.string()), pa.field("vector", pa.list_(pa.float32(), DIM)),
])

RNG = np.random.default_rng(7)
CENTERS = RNG.normal(size=(3, DIM))
CENTERS /= np.linalg.norm(CENTERS, axis=1, keepdims=True)


def vec(cluster: int, i: int) -> list[float]:
    r = np.random.default_rng(1000 * cluster + i).normal(size=DIM) * 0.035
    v = CENTERS[cluster] + r
    return (v / np.linalg.norm(v)).astype(np.float32).tolist()


def mem(i, text, source, ts, cluster):
    return {"id": f"{source}:{i}", "text": text, "vector": vec(cluster, i), "source": source,
            "role": "note", "timestamp": ts, "user_id": "boss"}


def base_rows() -> list[list[dict]]:
    """Batches of invented memories; each batch is one write (one LanceDB version)."""
    dm = [mem(i, f"Test Friend and I watched the match {i}, what a goal", "instagram:dm:Test Friend",
              f"2022-0{1 + i % 6}-1{i % 9}T10:00:00+00:00", 0) for i in range(12)]
    dev = [mem(100 + i, f"verilog testbench for the fpga counter, attempt {i}", "claude:session.json",
               f"2025-0{3 + i % 3}-0{1 + i % 8}T09:00:00+00:00", 1) for i in range(10)]
    notes = [mem(200 + i, f"germany masters vlsi application step {i}; Riya Example checked the SOP",
                 "note:germany.md", f"2025-08-2{i % 9}T12:00:00+00:00", 2) for i in range(8)]
    facts = [mem(300 + i, f"Authored fact number {i} about him.", "authored:Who he is",
                 "2026-10-01T00:00:00+00:00", 2) for i in range(3)]
    facts.append(mem(310, 'On 9 October 2026 he told you: "exam on 12 November"', "authored:confirmed:told",
                     "2026-10-09T00:00:00+00:00", 2))
    voice = [mem(400 + i, f"User: hi {i}\nJARVIS: hello", "voice_interaction", "2026-10-10T20:00:00+00:00", 1)
             for i in range(3)]
    odd = [mem(500, "no date on this one", "import", None, 0),
           mem(501, "a broken date", "import", "sometime last year", 0),
           mem(502, LONG, "instagram:caption", "2023-05-05T00:00:00+00:00", 0)]
    return [dm, dev, notes, facts, voice, odd]


def belief(bid, claim, status, cluster, conf=0.6, updated="2026-10-05T00:00:00+00:00"):
    return {"id": bid, "claim": claim, "category": "goal", "era": "now", "confidence": conf, "status": status,
            "support": 2, "evidence": "[]", "source": "distill", "updated": updated, "vector": vec(cluster, 900)}


@pytest.fixture
def store(tmp_path, monkeypatch):
    import lancedb
    ldb, data = tmp_path / "lancedb", tmp_path / "yaadash"
    data.mkdir()
    db = lancedb.connect(str(ldb))
    t = db.create_table("memories", schema=MEM_SCHEMA)
    for batch in base_rows():
        t.add(batch)
    b = db.create_table("beliefs", schema=BELIEF_SCHEMA)
    b.add([belief("b_conf", "He wants an MS in VLSI in Germany", "confirmed", 2, 0.9),
           belief("b_unc", "He writes testbenches before the RTL", "unconfirmed", 1, 0.5),
           belief("b_old", "He played football every evening", "outdated", 0, 0.7, "2024-02-01T00:00:00+00:00"),
           belief("b_rej", "He dislikes Germany", "rejected", 2, 0.4)])
    pd.DataFrame([
        {"name": "Test Friend", "thread": "t1", "closeness": 80.0, "rank": 1, "first_iso": "2021-11-02T00:00:00",
         "last_iso": "2022-06-30T00:00:00", "n_msgs": 900, "span_days": 240.0, "calls": 3, "why": "longevity"},
        {"name": "Riya Example", "thread": "t2", "closeness": 60.0, "rank": 2, "first_iso": "2025-07-01T00:00:00",
         "last_iso": "2025-09-01T00:00:00", "n_msgs": 50, "span_days": 60.0, "calls": 0, "why": "depth"},
        {"name": "Nobody Linked", "thread": "t3", "closeness": 20.0, "rank": 3, "first_iso": "2020-01-01T00:00:00",
         "last_iso": "2020-02-01T00:00:00", "n_msgs": 5, "span_days": 31.0, "calls": 0, "why": "recency"},
        {"name": "Some Group", "thread": "t4", "closeness": None, "rank": None, "first_iso": "2021-01-01T00:00:00",
         "last_iso": "2021-01-02T00:00:00", "n_msgs": 5, "span_days": 1.0, "calls": 0, "why": None},
    ]).to_parquet(data / "people.parquet", index=False)
    (data / "taste_profile.json").write_text(json.dumps({"topics": [
        {"label": "chip design", "words": ["verilog", "testbench", "fpga"], "share": 0.3, "trend": "rising",
         "by_year": {"2024": 2.0, "2025": 5.0}},
        {"label": "football", "words": ["match", "goal"], "share": 0.1, "trend": "faded", "by_year": {"2021": 1.0}},
        {"label": "nothing matches", "words": ["zzzqqq"], "share": 0.05, "trend": "steady", "by_year": {}},
    ]}), encoding="utf-8")
    return ldb, data


def by_kind(g, kind):
    return [n for n in g["nodes"] if n["kind"] == kind]


def pos(n):
    return np.array([n["x"], n["y"], n["z"]])


# ------------------------------------------------------------------ the payload
def test_every_node_carries_the_fields_the_ui_draws(store):
    g = yg.galaxy(*store)
    assert g["counts"] == {"memories": 40, "memories_shown": 40, "people": 3, "beliefs": 3, "topics": 3,
                           "edges": len(g["edges"])}
    for n in g["nodes"]:
        assert {"id", "kind", "label", "source", "time", "importance", "x", "y", "z"} <= n.keys()
        assert 0 <= n["importance"] <= 1
        assert all(np.isfinite([n["x"], n["y"], n["z"]]))
    ids = [n["id"] for n in g["nodes"]]
    assert len(ids) == len(set(ids))
    assert all(0 <= a < len(ids) and 0 <= b < len(ids) and a != b for a, b in g["edges"])
    assert len({tuple(e) for e in g["edges"]}) == len(g["edges"])      # no duplicate edges


def test_no_full_private_text_in_the_payload(store):
    g = yg.galaxy(*store)
    raw = json.dumps(g)
    assert LONG.strip() not in raw and LONG[:200] not in raw
    assert all(len(n["label"]) <= yg.LABEL_CHARS for n in g["nodes"])
    assert "_index" not in g                                     # row ids stay server-side
    assert "instagram:dm:Test Friend" not in raw                 # sources travel as families only


def test_rejected_beliefs_are_left_out_and_statuses_kept(store):
    g = yg.galaxy(*store)
    assert {b["status"] for b in by_kind(g, "belief")} == {"confirmed", "unconfirmed", "outdated"}
    assert not any("dislikes Germany" in b["label"] for b in by_kind(g, "belief"))


def test_sources_fold_into_families(store):
    g = yg.galaxy(*store)
    assert g["sources"] == {"instagram": 13, "claude": 10, "note": 8, "authored": 4, "voice": 3, "other": 2}
    assert yg.family("authored:confirmed:told") == "authored"
    assert yg.family("voice_interaction") == "voice" and yg.family(None) == "other"


def test_authored_facts_matter_more_than_chatter(store):
    g = yg.galaxy(*store)
    mems = by_kind(g, "memory")
    told = [n for n in mems if n["label"].startswith("On 9 October")]
    assert told and told[0]["importance"] == 1.0
    assert min(n["importance"] for n in mems if n["source"] == "authored") >= 0.85
    assert max(n["importance"] for n in mems if n["source"] == "voice") < 0.85


# ------------------------------------------------------------------ positions
def test_similar_memories_land_together(store):
    g = yg.galaxy(*store)
    mems = by_kind(g, "memory")
    dev = np.array([pos(n) for n in mems if n["source"] == "claude"])
    notes = np.array([pos(n) for n in mems if n["source"] == "note"])
    spread = np.linalg.norm(dev - dev.mean(0), axis=1).mean()
    assert np.linalg.norm(dev.mean(0) - notes.mean(0)) > 3 * spread
    radii = np.linalg.norm(np.array([pos(n) for n in mems]), axis=1)
    assert radii.max() < 1.6 + 1e-6                                # outliers squashed onto the rim


def test_people_sit_by_their_conversations_and_unlinked_ones_on_the_shell(store):
    g = yg.galaxy(*store)
    nodes = g["nodes"]
    people = {n["label"]: n for n in by_kind(g, "person")}
    dm = np.array([pos(n) for n in by_kind(g, "memory") if n["label"].startswith("Test Friend")])
    assert np.linalg.norm(pos(people["Test Friend"]) - dm.mean(0)) < 0.1
    # Riya is never a DM here; the notes that name her place her.
    notes = np.array([pos(n) for n in by_kind(g, "memory") if n["source"] == "note" and "Riya" in n["label"]])
    assert np.linalg.norm(pos(people["Riya Example"]) - notes.mean(0)) < 0.1
    assert np.linalg.norm(pos(people["Nobody Linked"])) == pytest.approx(yg.SHELL_R, abs=1e-3)
    tf = nodes.index(people["Test Friend"])
    linked = [nodes[b if a == tf else a] for a, b in g["edges"] if tf in (a, b)]
    assert 0 < len(linked) <= yg.PERSON_LINKS
    assert all(n["label"].startswith("Test Friend") for n in linked)
    assert "Some Group" not in people                              # groups have no closeness


def test_beliefs_go_through_the_same_projection(store):
    g = yg.galaxy(*store)
    conf = next(b for b in by_kind(g, "belief") if b["status"] == "confirmed")
    notes = np.array([pos(n) for n in by_kind(g, "memory") if n["source"] == "note"])
    dev = np.array([pos(n) for n in by_kind(g, "memory") if n["source"] == "claude"])
    assert np.linalg.norm(pos(conf) - notes.mean(0)) < np.linalg.norm(pos(conf) - dev.mean(0))


def test_topics_link_to_the_memories_that_use_their_words(store):
    g = yg.galaxy(*store)
    nodes = g["nodes"]
    topics = {n["label"]: n for n in by_kind(g, "topic")}
    chip = nodes.index(topics["chip design"])
    linked = [nodes[b if a == chip else a] for a, b in g["edges"] if chip in (a, b)]
    assert linked and all("verilog" in n["label"] for n in linked)
    assert topics["chip design"]["time"] == "2024-01-01" and topics["chip design"]["status"] == "inferred"
    assert np.linalg.norm(pos(topics["nothing matches"])) == pytest.approx(yg.SHELL_R, abs=1e-3)


def test_layout_is_deterministic(store):
    a = yg.galaxy(*store, force=True)
    b = yg.galaxy(*store, force=True)
    assert a["nodes"] == b["nodes"] and a["edges"] == b["edges"]


def test_knn_matches_brute_force():
    X = np.random.default_rng(3).normal(size=(57, 16))
    idx, sim = yg.knn(X, 3, block=10)                  # several blocks on purpose
    Xn = X / np.linalg.norm(X, axis=1, keepdims=True)
    S = Xn @ Xn.T
    np.fill_diagonal(S, -np.inf)
    want = np.argsort(-S, axis=1, kind="stable")[:, :3]
    assert (idx == want).all()
    assert np.allclose(sim, np.take_along_axis(S, want, axis=1), atol=1e-5)
    assert yg.knn(X[:1], 3)[0].shape == (1, 0)          # one point has no neighbours


def test_tiny_and_empty_stores_do_not_break(tmp_path):
    g = yg.galaxy(tmp_path / "nothing", tmp_path / "data")
    assert g["nodes"] == [] and g["edges"] == [] and g["counts"]["memories"] == 0
    assert g["growth"]["months"] == []
    import lancedb
    t = lancedb.connect(str(tmp_path / "one")).create_table("memories", schema=MEM_SCHEMA)
    t.add([mem(1, "just one memory", "note:x", "2025-01-01", 0)])
    g = yg.galaxy(tmp_path / "one", tmp_path / "data1")
    assert len(g["nodes"]) == 1 and g["edges"] == []


# ------------------------------------------------------------------ limits
def test_more_memories_than_the_cap_are_sampled_and_facts_always_kept(store):
    ldb, data = store
    import lancedb
    t = lancedb.connect(str(ldb)).open_table("memories")
    t.add([mem(1000 + i, f"filler chatter {i}", "instagram:dm:Crowd", "2024-01-01T00:00:00+00:00", i % 3)
           for i in range(80)])
    g = yg.galaxy(ldb, data, max_memories=yg.MIN_MAX_MEMORIES)
    assert g["sampled"] is True and g["counts"]["memories"] == 120
    assert g["counts"]["memories_shown"] == yg.MIN_MAX_MEMORIES
    assert sum(1 for n in by_kind(g, "memory") if n["source"] == "authored") == 4
    assert g["growth"]["totals"]["memories"] == 120              # growth counts every row, shown or not
    assert yg.clamp_max(10 ** 9) == yg.HARD_MAX_MEMORIES and yg.clamp_max("x") == yg.DEFAULT_MAX_MEMORIES


def test_sampling_is_stable_when_one_row_arrives():
    ids = [f"r{i}" for i in range(500)]
    fams = ["instagram"] * 500
    a = set(yg.select_memories(ids, fams, 200).tolist())
    b = set(yg.select_memories(ids + ["r500"], fams + ["instagram"], 200).tolist())
    assert len(a ^ b) <= 2                     # at most the newcomer in, one row out


def test_edges_respect_the_cap(store, monkeypatch):
    monkeypatch.setattr(yg, "EDGE_CAP", 360 + 20)       # 10*6 + 50*2 + 25*8 reserved for links, 20 for memories
    monkeypatch.setattr(yg, "PEOPLE_TOP", 10)
    monkeypatch.setattr(yg, "BELIEF_CAP", 50)
    monkeypatch.setattr(yg, "TOPIC_CAP", 25)
    g = yg.galaxy(*store, force=True)
    n_mem = g["counts"]["memories_shown"]
    mem_edges = [e for e in g["edges"] if e[0] < n_mem and e[1] < n_mem]
    assert len(mem_edges) == 20 and len(g["edges"]) <= yg.EDGE_CAP


def test_payload_size_is_bounded_per_node(store):
    g = yg.galaxy(*store)
    per_node = len(json.dumps(g["nodes"])) / len(g["nodes"])
    assert per_node < 260                       # ~1.6 MB for 6k nodes at worst


# ------------------------------------------------------------------ cache
def test_cache_is_reused_until_the_store_grows(store, monkeypatch):
    ldb, data = store
    first = yg.galaxy(ldb, data)
    assert first["cached"] is False and (data / yg.CACHE_FILE).exists()

    def boom(*a, **k):
        raise AssertionError("recomputed although nothing changed")
    monkeypatch.setattr(yg, "build_layout", boom)
    second = yg.galaxy(ldb, data)
    assert second["cached"] is True and second["nodes"] == first["nodes"]
    monkeypatch.undo()

    import lancedb
    lancedb.connect(str(ldb)).open_table("memories").add([mem(2000, "a new memory", "note:x", "2026-10-11", 2)])
    third = yg.galaxy(ldb, data)
    assert third["cached"] is False and third["counts"]["memories"] == 41


def test_a_stale_layout_is_served_while_the_new_one_builds(store):
    ldb, data = store
    yg.galaxy(ldb, data)
    import lancedb
    lancedb.connect(str(ldb)).open_table("memories").add([mem(2001, "said just now", "voice_interaction",
                                                              "2026-10-12", 1)])
    built = []
    res = yg.galaxy(ldb, data, background=True, on_built=built.append)
    assert res["stale"] is True and res["counts"]["memories"] == 40      # the old picture, at once
    yg.wait_for_refresh(data)
    assert built and built[0]["counts"]["memories"] == 41 and built[0]["stale"] is False
    again = yg.galaxy(ldb, data, background=True)
    assert again["stale"] is False and again["cached"] is True and again["counts"]["memories"] == 41


def test_a_different_size_is_never_served_stale(store):
    ldb, data = store
    yg.galaxy(ldb, data, max_memories=8000)
    res = yg.galaxy(ldb, data, max_memories=yg.MIN_MAX_MEMORIES, background=True)
    assert res["stale"] is False and res["cached"] is False and res["max_memories"] == yg.MIN_MAX_MEMORIES


def test_projection_is_pca(store):
    """Same axes as sklearn's exact PCA, up to sign, with the sign fixed by convention."""
    from sklearn.decomposition import PCA
    X = np.random.default_rng(5).normal(size=(300, 24)) + np.linspace(0, 3, 24)
    Xn = X / np.linalg.norm(X, axis=1, keepdims=True)
    p = yg.Projection(X)
    ref = PCA(3, svd_solver="full").fit(Xn)
    assert np.allclose(np.abs(p.components), np.abs(ref.components_), atol=1e-6)
    assert (p.components[np.arange(3), np.abs(p.components).argmax(axis=1)] > 0).all()
    r = np.linalg.norm(p(X), axis=1)
    assert np.mean(r <= 1.0 + 1e-9) >= 0.95 - 1e-9


def test_cache_notices_a_rewrite_that_keeps_the_count(store):
    """ingest_identity.py deletes and re-adds the authored facts: same count, new text."""
    ldb, data = store
    yg.galaxy(ldb, data)
    import lancedb
    t = lancedb.connect(str(ldb)).open_table("memories")
    t.delete("id = 'authored:Who he is:300'")
    t.add([mem(301 + 50, "Authored fact, reworded.", "authored:Who he is", "2026-10-12", 2)])
    g = yg.galaxy(ldb, data)
    assert g["cached"] is False and g["counts"]["memories"] == 40
    assert any(n["label"] == "Authored fact, reworded." for n in g["nodes"])


def test_cache_key_changes_with_people_and_topics(store):
    ldb, data = store
    k1 = yg.store_key(ldb, data, 8000)
    (data / "taste_profile.json").write_text(json.dumps({"topics": []}), encoding="utf-8")
    assert yg.store_key(ldb, data, 8000) != k1
    assert yg.store_key(ldb, data, 9000) != yg.store_key(ldb, data, 8000)


# ------------------------------------------------------------------ growth (Y2)
def test_growth_counts_each_source_per_month(store):
    gr = yg.galaxy(*store)["growth"]
    months = gr["months"]
    assert months[0] == "2020-01" and months[-1] == "2026-10"     # people's first contact starts it
    assert len(months) == len(set(months)) == (2026 - 2020) * 12 + 10
    by = {f: dict(zip(months, gr["by_source"][f])) for f in gr["families"]}
    assert sum(by["instagram"].values()) == 13 and by["instagram"]["2023-05"] == 1
    assert by["claude"]["2025-03"] + by["claude"]["2025-04"] + by["claude"]["2025-05"] == 10
    assert by["authored"]["2026-10"] == 4 and by["voice"]["2026-10"] == 3
    assert gr["undated"] == {"other": 2}
    assert gr["families"] == ["claude", "note", "instagram", "voice", "authored", "other"]
    assert sum(gr["people_new"]) == 3 and dict(zip(months, gr["people_new"]))["2021-11"] == 1
    assert sum(gr["beliefs_updated"]) == 4                       # every belief, rejected too, has a history
    assert gr["totals"] == {"memories": 40, "people": 3, "beliefs": 4}


def test_ingest_ledger_comes_from_lancedb_versions(store):
    gr = yg.galaxy(*store)["growth"]
    assert gr["ingest"] and gr["ingest"][-1]["rows"] == 40
    assert all(e["rows"] >= 0 and len(e["date"]) == 10 for e in gr["ingest"])
    assert gr["beliefs_ingest"][-1]["rows"] == 4


def test_dates_are_parsed_or_refused():
    assert yg.date_of("2024-03-05T10:00:00+00:00") == "2024-03-05"
    assert yg.date_of("1970-01-01") is None and yg.date_of("soon") is None and yg.date_of(None) is None
    assert yg.date_of("2024-13-01") is None
    assert yg._month_range({"2024-11", "2025-02"}) == ["2024-11", "2024-12", "2025-01", "2025-02"]


# ------------------------------------------------------------------ opening a node
def test_opening_a_memory_shows_its_source_date_and_an_excerpt(store):
    ldb, data = store
    g = yg.galaxy(ldb, data)
    long_node = next(n for n in by_kind(g, "memory") if n["label"].startswith("This is a deliberately"))
    d = yg.node_detail(ldb, data, long_node["id"])
    assert d["source"] == "instagram:caption" and d["date"] == "2023-05-05"
    assert len(d["snippet"]) <= yg.DETAIL_CHARS and d["snippet"].endswith("…")
    dm = next(n for n in by_kind(g, "memory") if n["label"].startswith("Test Friend"))
    d = yg.node_detail(ldb, data, dm["id"])
    assert d["source"] == "instagram:dm:Test Friend" and d["family"] == "instagram"
    assert any(link["kind"] in ("memory", "person") for link in d["links"])


def test_opening_people_beliefs_and_topics(store):
    ldb, data = store
    g = yg.galaxy(ldb, data)
    person = next(n for n in by_kind(g, "person") if n["label"] == "Test Friend")
    d = yg.node_detail(ldb, data, person["id"])
    assert d["closeness"] == 80.0 and d["date"] == "2021-11-02" and d["last"] == "2022-06-30"
    b = next(n for n in by_kind(g, "belief") if n["status"] == "unconfirmed")
    d = yg.node_detail(ldb, data, b["id"])
    assert d["status"] == "unconfirmed" and d["confidence"] == 0.5 and "testbenches" in d["snippet"]
    t = next(n for n in by_kind(g, "topic") if n["label"] == "chip design")
    d = yg.node_detail(ldb, data, t["id"])
    assert d["words"][:2] == ["verilog", "testbench"] and d["status"] == "inferred"


def test_two_people_with_one_name_stay_two_nodes(store):
    ldb, data = store
    df = pd.read_parquet(data / "people.parquet")
    twin = df.iloc[[0]].copy()
    twin["thread"], twin["closeness"], twin["n_msgs"] = "t9", 50.0, 7
    pd.concat([df, twin]).to_parquet(data / "people.parquet", index=False)
    g = yg.galaxy(ldb, data)
    friends = [n for n in by_kind(g, "person") if n["label"] == "Test Friend"]
    assert len(friends) == 2 and friends[0]["id"] != friends[1]["id"]
    assert sorted(yg.node_detail(ldb, data, f["id"])["n_msgs"] for f in friends) == [7, 900]


def test_unknown_or_hostile_ids_open_nothing(store):
    ldb, data = store
    assert yg.node_detail(ldb, data, "mdeadbeef") is None           # no cache yet
    yg.galaxy(ldb, data)
    assert yg.node_detail(ldb, data, "m' OR 1=1 --") is None
    assert yg.node_detail(ldb, data, "nope") is None


def test_laying_out_never_loads_the_embedding_model():
    code = ("import sys; sys.path[:0] = [r'%s', r'%s']; import yaadash_galaxy; "
            "print('sentence_transformers' in sys.modules, 'yaadash_v2' in sys.modules)"
            % (YAADASH, YAADASH.parent / "core"))
    out = subprocess.run([sys.executable, "-c", code], capture_output=True, text=True, timeout=120)
    assert out.stdout.strip() == "False False", out.stderr


# ------------------------------------------------------------------ the routes
class FakeBus:
    def __init__(self):
        self.events = []

    def publish(self, source, kind, text="", **data):
        self.events.append((source, kind, text))


@pytest.fixture
def client(store, monkeypatch):
    from jarvis_app import routes_galaxy
    ldb, data = store
    monkeypatch.setattr(routes_galaxy, "LANCEDB_DIR", ldb)
    monkeypatch.setattr(routes_galaxy, "DATA_DIR", data)
    app = FastAPI()
    bus = FakeBus()
    routes_galaxy.register(app, None, bus)
    with TestClient(app) as c:
        c.bus = bus
        yield c


def test_galaxy_route_lays_out_once_and_says_so(client):
    r = client.get("/api/galaxy").json()
    assert r["cached"] is False and r["counts"]["memories"] == 40
    assert [e[:2] for e in client.bus.events] == [("memory", "galaxy")]
    assert "40 memories" in client.bus.events[0][2]
    r2 = client.get("/api/galaxy").json()
    assert r2["cached"] is True and len(client.bus.events) == 1    # a cache hit is not news
    assert client.get("/api/galaxy", params={"refresh": True}).json()["cached"] is False
    assert client.get("/api/galaxy", params={"max_nodes": 5}).json()["max_memories"] == yg.MIN_MAX_MEMORIES


def test_galaxy_route_serves_stale_then_announces_the_new_layout(client, store):
    ldb, data = store
    client.get("/api/galaxy")
    import lancedb
    lancedb.connect(str(ldb)).open_table("memories").add([mem(2002, "a new note", "note:x", "2026-10-12", 2)])
    r = client.get("/api/galaxy").json()
    assert r["stale"] is True and r["counts"]["memories"] == 40
    yg.wait_for_refresh(data)
    assert len(client.bus.events) == 2 and "41 memories" in client.bus.events[1][2]
    assert client.get("/api/galaxy").json()["counts"]["memories"] == 41


def test_node_route(client):
    g = client.get("/api/galaxy").json()
    node = g["nodes"][0]
    d = client.get("/api/galaxy/node", params={"id": node["id"]})
    assert d.status_code == 200 and d.json()["id"] == node["id"]
    assert client.get("/api/galaxy/node", params={"id": "nope"}).status_code == 404
    assert client.get("/api/galaxy/node", params={"id": "x" * 65}).status_code == 400


def test_growth_route(client):
    r = client.get("/api/galaxy/growth").json()
    assert r["growth"]["totals"]["memories"] == 40 and "nodes" not in r


def test_the_app_discovers_the_galaxy_routes():
    from jarvis_app.security import Guard
    from jarvis_app.server import create_app
    app = create_app(Guard(8777, "t" * 20, extra_hosts=["testserver"]), autostart_aankhen="off", features=['galaxy'])
    paths = {getattr(r, "path", "") for r in app.routes}
    assert {"/api/galaxy", "/api/galaxy/node", "/api/galaxy/growth"} <= paths
