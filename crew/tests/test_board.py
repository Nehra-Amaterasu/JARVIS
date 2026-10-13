"""The blackboard: rising ids, the 300-event ring, since(), the sink for notable events only."""
import threading

from crew.board import EVENTS_KEPT, Blackboard


def test_ids_rise_and_since_returns_only_newer_events():
    b = Blackboard(clock=lambda: 100.0)
    first = b.post("movement", "arrived", "Came into the room", {"zone": "desk"})
    second = b.post("steward", "ollama_down", "Ollama stopped answering")
    assert (first["id"], second["id"]) == (1, 2)
    assert first == {"id": 1, "ts": 100.0, "agent": "movement", "kind": "arrived", "text": "Came into the room",
                     "data": {"zone": "desk"}}
    assert second["data"] == {}
    assert [e["id"] for e in b.since(0)] == [1, 2]
    assert [e["id"] for e in b.since(1)] == [2]
    assert b.since(2) == []
    assert b.post("ledger", "candidate", "x", ts=42.0)["ts"] == 42.0      # an agent stamps its own tick time
    tags = {"agent": "movement", "kind": "x", "ts": 1}                   # tag names never clash with the event's
    assert b.post("ledger", "candidate", "y", tags)["data"] == tags


def test_the_ring_keeps_the_last_300_and_ids_keep_rising():
    b = Blackboard()
    for i in range(EVENTS_KEPT + 50):
        b.post("movement", "waved", f"wave {i}")
    kept = b.since(0)
    assert len(kept) == EVENTS_KEPT == 300
    assert kept[0]["id"] == 51 and kept[-1]["id"] == 350
    assert [e["id"] for e in b.recent(3)] == [348, 349, 350]
    assert b.recent(0) == []


def test_only_notable_events_reach_the_sink_and_a_broken_sink_harms_nothing():
    got = []
    b = Blackboard(sink=got.append)
    b.post("movement", "waved", "Waved at the desk")
    b.post("movement", "typing_started", "Started typing", notable=False)
    assert [e["kind"] for e in got] == ["waved"]

    def broken(ev):
        raise RuntimeError("bus closed")
    b.sink = broken
    ev = b.post("movement", "left", "Left the room")
    assert b.since(ev["id"] - 1) == [ev]


def test_states_are_replaced_whole_per_agent():
    b = Blackboard()
    assert b.state("movement") is None
    b.set_state("movement", {"summary": "a"})
    b.set_state("movement", {"summary": "b"})
    b.set_state("ledger", {"summary": "c"})
    assert b.state("movement") == {"summary": "b"} and b.state("ledger") == {"summary": "c"}


def test_writers_on_many_threads_never_share_an_id():
    b = Blackboard(maxlen=10_000)

    def write():
        for _ in range(500):
            b.post("x", "tick", "")
    threads = [threading.Thread(target=write) for _ in range(8)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    ids = [e["id"] for e in b.since(0)]
    assert len(ids) == 4000 and ids == sorted(set(ids))
