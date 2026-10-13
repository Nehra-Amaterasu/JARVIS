"""The crew: every agent on its own loop, a raising tick recorded and survived, the status
the API serves, and the block JARVIS reads (problems first, 600 characters at most)."""
import time

import pytest

from crew.base import CONTEXT_MAX, Agent, clip
from crew.manager import CONTEXT_HEADER, Crew


class Fake(Agent):
    def __init__(self, id, line="", cadence=0.01, urgent=False, live=False, fail=False):
        super().__init__()
        self.id, self.name, self.role, self.cadence_s = id, f"Agent {id}", f"does {id}", cadence
        self.line, self._urgent, self._live, self.fail = line, urgent, live, fail
        self.ticks = 0

    def tick(self, now):
        self.ticks += 1
        if self.fail:
            raise RuntimeError(f"{self.id} broke")

    @property
    def summary(self):
        return f"{self.id} ticked {self.ticks} times."

    @property
    def data(self):
        return {"ticks": self.ticks}

    def context_line(self):
        return self.line

    @property
    def urgent(self):
        return self._urgent

    @property
    def live(self):
        return self._live


def wait_for(cond, timeout=3.0):
    end = time.monotonic() + timeout
    while time.monotonic() < end:
        if cond():
            return True
        time.sleep(0.01)
    return False


def test_agents_run_on_their_own_and_a_raising_tick_never_ends_the_loop():
    good, bad = Fake("good"), Fake("bad", fail=True)
    crew = Crew([good, bad])
    crew.start()
    crew.start()                                         # idempotent: still one loop per agent
    try:
        assert wait_for(lambda: good.ticks >= 5 and bad.ticks >= 5)
        assert crew.running and good.state == "running" and bad.state == "error"
        assert bad.health.errors >= 5 and bad.health.last_error == "RuntimeError: bad broke"
        assert good.health.avg_ms is not None and good.health.errors == 0
    finally:
        crew.stop()
        crew.stop()                                      # idempotent too
    assert not crew.running and good.state == "off"
    ticks = good.ticks
    time.sleep(0.05)
    assert good.ticks == ticks                           # really stopped
    crew.start()                                         # and can start again
    try:
        assert wait_for(lambda: good.ticks > ticks)
    finally:
        crew.stop()


def test_status_and_run_now():
    a, b = Fake("a", cadence=60), Fake("b", cadence=600)
    crew = Crew([a, b])
    entry = crew.entry(a)
    assert entry["summary"] == "No reading yet." and entry["state"] == "off" and entry["data"] == {}
    got = crew.run_now("a")
    assert got == {"id": "a", "name": "Agent a", "role": "does a", "state": "off", "summary": "a ticked 1 times.",
                   "data": {"ticks": 1},
                   "health": {"runs": 1, "errors": 0, "last_error": None, "avg_ms": got["health"]["avg_ms"],
                              "last_tick": got["health"]["last_tick"], "cadence_s": 60}}
    a.post("hello", "first event")
    s = crew.status()
    assert [x["id"] for x in s["agents"]] == ["a", "b"] and [e["text"] for e in s["events"]] == ["first event"]
    with pytest.raises(KeyError):
        crew.run_now("nope")
    with pytest.raises(ValueError):
        Crew([Fake("a"), Fake("a")])


def test_the_block_for_jarvis_puts_problems_first_and_leaves_out_failing_agents():
    move = Fake("movement", "Movement (Wi-Fi estimate): at the desk 25 min, typing (82%).", live=True)
    steward = Fake("steward", "Systems: PROBLEM: Ollama not answering.", urgent=True)
    quiet = Fake("ledger", "")
    broken = Fake("broken", "a stale line from an agent whose last tick failed")
    crew = Crew([move, quiet, steward, broken])
    assert crew.context() == ""                          # nobody has ticked: nothing to say
    for a in (move, quiet, steward, broken):
        a.run()
    broken.fail = True
    broken.run()
    assert crew.context() == "\n".join([CONTEXT_HEADER, steward.line, move.line])
    assert crew.lines() == {"movement": move.line, "ledger": "", "steward": steward.line, "broken": ""}
    assert crew.live() == ["movement"]


def test_the_block_never_passes_600_characters():
    agents = [Fake(f"a{i}", f"Agent {i} says: " + "word " * 60) for i in range(5)]
    crew = Crew(agents)
    for a in agents:
        a.run()
    text = crew.context()
    lines = text.split("\n")
    assert len(text) <= 600 and lines[0] == CONTEXT_HEADER
    assert all(len(line) <= CONTEXT_MAX for line in lines)
    assert lines[-1].endswith("…") or len(lines) == 4    # the last line clipped at a word, or dropped


def test_clip_cuts_at_a_word():
    assert clip("short line", 200) == "short line"
    assert clip("one two three four", 12) == "one two…"
    assert len(clip("x" * 300, 200)) == 200
