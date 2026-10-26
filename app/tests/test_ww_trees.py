"""Life trees (ww_trees.py): status from evidence, locks from prerequisites, the shipped
lifetrees.json is a valid set of DAGs, and filing a proof through the plan."""
import copy
import json

import pytest

from jarvis_app import germoney as g
from jarvis_app import ww_engines
from jarvis_app.ww_trees import KINDS, trees

TODAY = "2026-10-30"
BANK = {"trees": [{"id": "t", "name": "T", "nodes": [
    {"id": "a", "name": "A", "tier": 0, "prereqs": [], "proof": {"kind": "link", "need": 2}},
    {"id": "b", "name": "B", "tier": 1, "prereqs": ["a"], "proof": {"kind": "github_days", "need": 7}},
    {"id": "c", "name": "C", "tier": 2, "prereqs": ["b"], "proof": {"kind": "money_income", "need": 1000, "unit": "Rs"}}]}]}


def node(ans, nid):
    return next(n for t in ans["trees"] for n in t["nodes"] if n["id"] == nid)


def test_status_follows_evidence_and_locks_follow_prerequisites():
    r = trees({}, TODAY, bank=BANK)
    assert [node(r, x)["status"] for x in "abc"] == ["available", "locked", "locked"]
    one = {"t": {"a": [{"date": TODAY, "url": "https://example.org/1", "note": "first"}]}}
    r = trees({}, TODAY, bank=BANK, proofs=one)
    assert node(r, "a")["status"] == "in_progress" and node(r, "a")["proof"]["have"] == 1
    two = {"t": {"a": one["t"]["a"] * 2}}
    r = trees({}, TODAY, bank=BANK, proofs=two, measures={"github_days": 9, "money_income": 500})
    assert [node(r, x)["status"] for x in "abc"] == ["mastered", "mastered", "in_progress"]
    assert r["trees"][0]["progress"] == {"mastered": 2, "total": 3}


def test_measured_nodes_say_so_and_link_to_where_they_are_measured():
    r = trees({}, TODAY, bank=BANK, measures={"github_days": 3})
    b = node(r, "b")
    assert b["proof"]["measured"] and b["proof"]["have"] == 3 and not node(r, "a")["proof"]["measured"]
    kinds = {(l["kind"], l["target"]) for l in b["links"]}
    assert ("node", "a") in kinds and ("node", "c") in kinds and ("page", "status") in kinds


def test_filed_links_become_evidence_and_url_links():
    one = {"t": {"a": [{"date": TODAY, "url": "https://example.org/1", "note": "first"}]}}
    a = node(trees({}, TODAY, bank=BANK, proofs=one), "a")
    assert a["evidence"] == [{"date": TODAY, "text": "first", "url": "https://example.org/1"}]
    assert {"kind": "url", "target": "https://example.org/1", "label": "first"} in a["links"]


def test_pure_and_empty():
    before = copy.deepcopy(BANK)
    assert trees({}, TODAY, bank=BANK) == trees({}, TODAY, bank=copy.deepcopy(BANK)) and BANK == before
    assert trees({}, TODAY)["trees"] == []
    assert ww_engines.run("trees", {}, TODAY, bank=BANK)["status"] == "ok"


def test_the_shipped_life_trees_are_valid_dags():
    bank = g.load_lifetrees()
    assert len(bank["trees"]) >= 5
    for t in bank["trees"]:
        ids = [n["id"] for n in t["nodes"]]
        assert len(ids) == len(set(ids)), t["id"]
        tier = {n["id"]: n["tier"] for n in t["nodes"]}
        for n in t["nodes"]:
            assert n["proof"]["kind"] in KINDS, n["id"]
            assert n["name"] and n["outcomes"] and n["proof"]["text"], n["id"]
            for p in n["prereqs"]:
                assert p in tier and tier[p] < n["tier"], (n["id"], p)      # prerequisites exist and sit higher: no cycles
        assert any(not n["prereqs"] for n in t["nodes"]), t["id"]           # every tree has a way in
    r = trees({}, TODAY, bank=bank)
    assert all(n["status"] in ("available", "locked") for t in r["trees"] for n in t["nodes"])   # nothing mastered without evidence


@pytest.fixture()
def plan(tmp_path, monkeypatch):
    import shutil
    from pathlib import Path
    fix = Path(__file__).resolve().parents[1] / "ui" / "src" / "__tests__" / "fixtures" / "mission-bank"
    d = tmp_path / "bank"
    d.mkdir()
    for n in g.BANK_FILES:
        shutil.copy(fix / n, d / n)
    (d / "lifetrees.json").write_text(json.dumps(BANK), encoding="utf-8")
    bank = g.load_bank(d)
    monkeypatch.setattr(g, "bank_dir", lambda: d)
    (tmp_path / "in.json").write_text("{}", encoding="utf-8")
    monkeypatch.setenv("JARVIS_ENGINE_INPUTS", str(tmp_path / "in.json"))
    monkeypatch.setattr(g.github_activity, "local_commits", lambda repos, **k: [])
    monkeypatch.setattr(g.github_activity, "days", lambda user, **k: {"days": [], "fetched": None})
    return g.Plan(g.KVStore(tmp_path / "kv", tmp_path / "bk"), bank_loader=lambda: bank, academics_loader=lambda: None,
                  apps=g.Applications(calendar=tmp_path / "c.json", store=tmp_path / "a.json"))


def test_a_filed_proof_counts_and_measured_nodes_refuse_one(plan):
    r = plan.tree_proof("t", "a", {"url": "https://example.org/x", "note": "n"}, today=TODAY)
    assert node(r, "a")["proof"]["have"] == 1
    assert plan.load(TODAY)["tree_proofs"]["t"]["a"][0]["url"] == "https://example.org/x"
    with pytest.raises(ValueError):
        plan.tree_proof("t", "b", {"url": "https://example.org/x"}, today=TODAY)
    with pytest.raises(ValueError):
        plan.tree_proof("t", "a", {"url": "ftp://x"}, today=TODAY)
    with pytest.raises(KeyError):
        plan.tree_proof("t", "zz", {"note": "x"}, today=TODAY)
