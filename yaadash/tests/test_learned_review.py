"""Keep / Wrong on what JARVIS learned from his chats (chat_memory.review_queue / review).

Invented memories in a scratch learned/ folder: no transcripts, no model, no embedder."""
import json
import time

import pytest

import chat_memory as cm

NOW = time.time()
DAY = 86400.0


def _mem(mid, text, kind="fact", age_days=1.0, status="active", **kw):
    t = NOW - age_days * DAY
    return {"id": mid, "kind": kind, "text": text, "evidence": [f"s1#{len(mid)}"], "confidence": 0.7,
            "support": 1, "first_seen": t, "last_seen": t, "status": status, "by": "rules", **kw}


@pytest.fixture
def store(tmp_path, monkeypatch):
    d = tmp_path / "learned"
    d.mkdir()
    monkeypatch.setenv("JARVIS_LEARNED_DIR", str(d))

    def write(rows):
        (d / cm.MEMORIES_FILE).write_text(json.dumps(rows), encoding="utf-8")
    write([
        _mem("m_new", "The greenhouse sensor runs on a solar panel.", age_days=0.5),
        _mem("m_old", "Prefers tea after nine.", kind="preference", age_days=3),
        _mem("m_ancient", "Liked the blue mug.", age_days=40),
        _mem("m_style", "Ha, fair point.", kind="exemplar", age_days=0.2),
        _mem("m_gone", "The Uno drives the relays.", age_days=0.3, status="superseded"),
    ])
    return d


def test_the_queue_is_recent_unjudged_facts_newest_first(store):
    q = cm.review_queue(n=8, now=NOW)
    assert [i["id"] for i in q["items"]] == ["m_new", "m_old"]     # not 40 days old, not style, not superseded
    assert q["pending"] == 2 and q["kept"] == 0 and q["wrong"] == 0
    first = q["items"][0]
    assert first["text"].startswith("The greenhouse") and first["kind"] == "fact" and first["evidence"] == 1
    assert cm.review_queue(n=1, now=NOW)["pending"] == 2                # n caps the list, not the count


def test_keep_leaves_the_memory_in_use_and_takes_it_off_the_queue(store):
    assert cm.review("m_new", "keep") is True
    assert [m["id"] for m in cm.memories()].count("m_new") == 1
    q = cm.review_queue(now=NOW)
    assert [i["id"] for i in q["items"]] == ["m_old"] and q["kept"] == 1


def test_wrong_stops_jarvis_using_it_at_once_but_keeps_the_record(store):
    assert cm.review("m_old", "wrong") is True
    assert "m_old" not in {m["id"] for m in cm.memories()}            # gone from every reply
    every = {m["id"]: m for m in cm.memories(active_only=False)}
    assert every["m_old"]["status"] == "rejected"                       # kept, so it can be audited
    rows = json.loads((store / cm.MEMORIES_FILE).read_text(encoding="utf-8"))
    assert next(r for r in rows if r["id"] == "m_old")["status"] == "active"   # the crew's file is untouched
    assert cm.review_queue(now=NOW)["wrong"] == 1


def test_a_later_verdict_replaces_the_first(store):
    cm.review("m_new", "wrong")
    cm.review("m_new", "keep")
    assert "m_new" in {m["id"] for m in cm.memories()}
    assert cm.reviews()["m_new"]["verdict"] == "keep"


def test_unknown_id_and_bad_verdict(store):
    assert cm.review("nope", "keep") is False
    with pytest.raises(ValueError):
        cm.review("m_new", "maybe")
    assert not (store / cm.REVIEWS_FILE).exists()


def test_no_store_at_all_is_an_empty_queue(tmp_path, monkeypatch):
    monkeypatch.setenv("JARVIS_LEARNED_DIR", str(tmp_path / "none"))
    assert cm.review_queue(now=NOW) == {"items": [], "pending": 0, "kept": 0, "wrong": 0}
