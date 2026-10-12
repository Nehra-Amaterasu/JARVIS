"""The day as Aankhen saw it: segments, the hold against flicker, today's totals."""
from aankhen.journal import HOLD_S, ActivityJournal


class Clock:
    def __init__(self):
        self.t = 1_800_000_000.0

    def __call__(self):
        return self.t


def feed(j, clock, zone, act, seconds, motion=False):
    for _ in range(int(seconds)):
        clock.t += 1.0
        j.update(zone, act, motion)


def test_a_flicker_shorter_than_the_hold_never_splits_a_segment(tmp_path):
    c = Clock()
    j = ActivityJournal(str(tmp_path), clock=c)
    feed(j, c, "desk", "typing", 60, motion=True)
    feed(j, c, "bed", "still", HOLD_S - 2)          # a blip
    feed(j, c, "desk", "typing", 30)
    assert j.segments() == [] and j.summary()["now"]["zone"] == "desk"


def test_segments_close_on_a_lasting_change_and_totals_add_up(tmp_path):
    c = Clock()
    j = ActivityJournal(str(tmp_path), clock=c)
    feed(j, c, "desk", "typing", 120, motion=True)
    feed(j, c, "bed", "still", 300)
    segs = j.segments(__import__("time").strftime("%Y-%m-%d", __import__("time").localtime(c.t)))
    assert len(segs) == 1 and segs[0]["zone"] == "desk" and segs[0]["activity"] == "typing"
    assert abs(segs[0]["seconds"] - (120 + 1)) < 2 and segs[0]["moving_share"] > 0.9
    s = j.summary()
    assert s["now"]["zone"] == "bed" and s["now"]["seconds"] > 290
    j.close()
    assert len(j.segments(__import__("time").strftime("%Y-%m-%d", __import__("time").localtime(c.t)))) == 2
