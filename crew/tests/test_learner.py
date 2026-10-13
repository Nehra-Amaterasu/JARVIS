"""The chat learner agent with a fake pass: its start delay, its counts, its events, and
that no memory or conversation text reaches the board."""
from crew.agents.learner import ChatLearner
from crew.board import Blackboard


class Clock:
    def __init__(self, t=1000.0):
        self.t = t

    def __call__(self):
        return self.t


def test_waits_out_its_start_delay_then_learns_and_posts_counts_only():
    clock, calls = Clock(), []

    def learn():
        calls.append(clock.t)
        return {"new_turns": 12, "sessions": 2, "added": 3, "merged": 1, "superseded": 1, "by": "llm+rules"}
    a = ChatLearner(learn, start_delay_s=60, clock=clock)
    a.board = Blackboard()
    assert a.run() and calls == [] and a.state in ("off", "idle")
    clock.t += 61
    assert a.run() and calls == [1061.0]
    assert a.totals == {"passes": 1, "turns": 12, "learned": 3, "merged": 1, "superseded": 1}
    assert "12 turns indexed, 3 memories learned, 1 replaced" in a.summary
    ev = a.board.since(0)
    assert len(ev) == 1 and ev[0]["kind"] == "learned" and ev[0]["data"]["added"] == 3
    assert a.context_line() == ""                                 # nothing for JARVIS's prompt


def test_a_quiet_pass_posts_nothing_and_a_locked_one_counts_nothing():
    clock = Clock()
    results = iter([{"new_turns": 0, "added": 0, "superseded": 0}, {"skipped": "another run holds the lock"}])
    a = ChatLearner(lambda: next(results), start_delay_s=0, clock=clock)
    a.board = Blackboard()
    a.run()
    a.run()
    assert a.board.since(0) == [] and a.totals["passes"] == 1


def test_a_failing_pass_is_recorded_not_raised():
    def boom():
        raise RuntimeError("store unreadable")
    a = ChatLearner(boom, start_delay_s=0)
    a.board = Blackboard()
    assert a.run() is False and a.health.errors == 1
