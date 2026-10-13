"""The movement watcher on synthetic frame sequences, with an injected clock.

FakeRoom plays the hub: it answers (mode, frame) with the learned zone and activity the
test sets, and a human band whose last second is busy or calm. Nothing here touches
Aankhen; the frames have the fields engine.frame_message() gives the watcher.
"""
import pytest

from crew.agents.movement import (CANNOT_SEE, FORGET_S, LEAVE_HOLD_S, SEDENTARY_S, STALE_S, ZONE_HOLD_S,
                                  MovementWatcher)

GATE = 1.6                       # motion.HBE_RECENT_GATE, as the frame reports it


class Clock:
    def __init__(self):
        self.t = 1_800_000_000.0

    def __call__(self):
        return self.t


class FakeRoom:
    def __init__(self, clock):
        self.clock = clock
        self.on, self.mode, self.source = True, "hardware", "hardware"
        self.model, self.frozen = True, False
        self.zone, self.zone_p = "empty", 0.9
        self.activity, self.activity_p = "none", 0.82
        self.busy = lambda t: False              # the human band's last second, at time t
        self.energy = 1.0
        self.device_t = 0.0

    def __call__(self):
        if not self.on:
            return None, None
        if not self.frozen:
            self.device_t = self.clock.t - 1_799_000_000.0
        learned = None
        if self.model:
            learned = {"t": self.device_t, "state": self.zone, "p": {self.zone: self.zone_p},
                       "activity": {"state": self.activity, "p": {self.activity: self.activity_p}}}
        recent = 3.0 if self.busy(self.clock.t) else 1.0
        return self.mode, {"source": self.source, "t": self.device_t, "learned": learned,
                           "motion_detail": {"human_band": {"energy": self.energy, "ratio": 1.0, "recent": recent,
                                                            "start_gate": GATE}}}


@pytest.fixture
def clock():
    return Clock()


@pytest.fixture
def room(clock):
    return FakeRoom(clock)


@pytest.fixture
def watcher(room, clock):
    return MovementWatcher(room, clock=clock)


def feed(w, room, seconds, step=0.5, **set_room):
    """Let `seconds` pass with the room as given, one tick per `step`."""
    for k, v in set_room.items():
        setattr(room, k, v)
    for _ in range(int(round(seconds / step))):
        room.clock.t += step
        assert w.run(), w.health.last_error


def kinds(w):
    return [e["kind"] for e in w.board.since(0)]


def last(w, kind):
    return [e for e in w.board.since(0) if e["kind"] == kind][-1]


def test_an_arrival_after_watching_began_with_the_room_empty(watcher, room):
    feed(watcher, room, 10, zone="empty")
    assert watcher.zone == "empty" and kinds(watcher) == []           # watching began here: not news
    feed(watcher, room, 3, zone="desk", activity="still")
    assert watcher.zone == "empty" and kinds(watcher) == []           # inside the 4 s hold
    feed(watcher, room, 2)
    ev = last(watcher, "arrived")
    assert ev["text"] == "Came into the room (at the desk)"
    assert ev["data"] == {"zone": "desk", "from_zone": "empty", "away_min": 0, "at_least": True}
    assert watcher.zone == "desk" and watcher.zone_seen


def test_back_after_minutes_away_and_the_leave_needs_eight_seconds(watcher, room, clock):
    feed(watcher, room, 10, zone="desk", activity="still")            # was at the desk when watching began
    feed(watcher, room, LEAVE_HOLD_S - 1, zone="outside", activity="none")
    assert "left" not in kinds(watcher) and watcher.zone == "desk"    # 7 s outside is not a departure yet
    feed(watcher, room, 2)
    left = last(watcher, "left")
    assert left["text"] == "Left the room after at least 10 s in it"
    assert left["data"]["from_zone"] == "desk" and left["data"]["at_least"] is True
    feed(watcher, room, 300 - 9, zone="empty")                        # away 5 min in all, empty or outside
    feed(watcher, room, 5, zone="desk", activity="still")
    ev = last(watcher, "arrived")
    assert ev["text"] == "Back in the room after 5 min away (at the desk)"
    assert ev["data"]["away_min"] == 5 and ev["data"]["at_least"] is False


def test_a_move_from_desk_to_bed_is_dated_from_when_it_started(watcher, room, clock):
    feed(watcher, room, 10, zone="desk", activity="still")
    started = clock.t + 0.5
    feed(watcher, room, ZONE_HOLD_S + 1, zone="bed")
    ev = last(watcher, "moved")
    assert ev["text"] == "Moved from the desk to the bed"
    assert ev["data"] == {"zone": "bed", "from_zone": "desk"}
    assert watcher.zone == "bed" and watcher.zone_since == started
    feed(watcher, room, 5, zone="room")
    assert last(watcher, "moved")["text"] == "Got up from the bed"
    feed(watcher, room, 5, zone="desk")
    assert last(watcher, "moved")["text"] == "Sat down at the desk"


def test_holds_stop_one_frame_flicker(watcher, room):
    feed(watcher, room, 10, zone="desk", activity="still")
    for zone, activity in [("bed", "still"), ("outside", "walking"), ("empty", "none"), ("room", "typing")]:
        feed(watcher, room, 0.5, zone=zone, activity=activity)       # one frame of nonsense
        feed(watcher, room, 3, zone="desk", activity="still")
    feed(watcher, room, ZONE_HOLD_S - 0.5, zone="bed")               # 3.5 s on the bed: under the hold
    feed(watcher, room, 3, zone="desk")
    feed(watcher, room, LEAVE_HOLD_S - 0.5, zone="outside")          # 7.5 s outside: not a departure
    feed(watcher, room, 3, zone="desk")
    assert kinds(watcher) == []
    assert (watcher.zone, watcher.activity) == ("desk", "still")


def test_a_wave_episode_is_posted_once_and_counted_for_a_minute(watcher, room):
    feed(watcher, room, 10, zone="desk", activity="still")
    feed(watcher, room, 1.5, activity="waving")
    feed(watcher, room, 2, activity="still")
    ev = last(watcher, "waved")
    assert ev["text"] == "Waved at the desk" and ev["data"]["zone"] == "desk" and ev["data"]["p"] == 0.82
    assert watcher.activity == "still"                                # 1.5 s of waving never became the activity
    feed(watcher, room, 1.5, activity="waving")                       # again, inside the 5 s cooldown
    feed(watcher, room, 2, activity="still")
    feed(watcher, room, 0.5, activity="waving")                       # half a second: not an episode
    feed(watcher, room, 2, activity="still")
    assert kinds(watcher).count("waved") == 1
    assert watcher.data["waves_60s"] == 2
    assert "waved twice in the last minute" in watcher.context_line()
    feed(watcher, room, 60)
    assert watcher.data["waves_60s"] == 0 and "waved" not in watcher.context_line()


def test_simulated_frames_never_describe_him(watcher, room):
    room.mode = room.source = "simulation"
    for zone, activity in [("desk", "typing"), ("bed", "still"), ("outside", "walking"), ("desk", "waving")]:
        feed(watcher, room, 60, zone=zone, activity=activity, busy=lambda t: True)
    assert kinds(watcher) == []
    d = watcher.data
    assert d["source"] == "simulation" and d["live"] is False and d["zone"] is None and d["waves_60s"] == 0
    assert set(d["energy"]) == {None}                                 # not even the sparkline
    assert "simulation" in watcher.summary
    assert watcher.context_line() == ("Movement: Aankhen is running a simulation, so the room sensors show "
                                      "nothing real about him.")
    assert watcher.live is False and watcher.idle is True
    room.mode = room.source = "hardware"                              # the board takes over
    feed(watcher, room, 10, zone="desk", activity="still")
    assert kinds(watcher) == [] and watcher.zone == "desk" and not watcher.zone_seen


def test_replay_frames_are_not_live_either(watcher, room):
    room.mode = room.source = "replay"
    feed(watcher, room, 30, zone="desk", activity="waving")
    assert kinds(watcher) == [] and "replaying a recording" in watcher.context_line()


def test_typing_events_only_for_stretches_of_twenty_seconds(watcher, room):
    feed(watcher, room, 10, zone="desk", activity="still")
    feed(watcher, room, 10, activity="typing")
    feed(watcher, room, 5, activity="still")
    assert kinds(watcher) == []                                       # 10 s of typing is not a stretch
    feed(watcher, room, 25, activity="typing")
    assert kinds(watcher) == ["typing_started"]
    feed(watcher, room, 5, activity="still")
    stopped = last(watcher, "typing_stopped")
    assert stopped["text"] == "Stopped typing after 25 s"
    got = []
    watcher.board.sink = got.append                                   # routine events stay off the bus
    feed(watcher, room, 25, activity="typing")
    assert kinds(watcher)[-1] == "typing_started" and got == []


def test_walking_then_a_long_sit_is_sedentary_once(watcher, room):
    feed(watcher, room, 10, zone="desk", activity="still")
    feed(watcher, room, 4, activity="walking")
    assert last(watcher, "walking")["text"] == "Walking around the room"
    feed(watcher, room, SEDENTARY_S - 60, step=2.0, activity="typing")
    assert "sedentary" not in kinds(watcher)
    feed(watcher, room, 120, step=2.0)
    ev = last(watcher, "sedentary")
    assert ev["text"] == "At the desk 45 min without getting up" and ev["data"]["minutes"] == 45
    feed(watcher, room, 600, step=2.0, activity="still")              # still sitting: once per stretch
    feed(watcher, room, 1.5, activity="waving")                       # a wave is not getting up
    assert kinds(watcher).count("sedentary") == 1
    assert watcher.data["sitting_s"] > SEDENTARY_S
    feed(watcher, room, 4, activity="walking")                        # this is
    assert watcher.data["sitting_s"] is None
    feed(watcher, room, SEDENTARY_S + 60, step=2.0, activity="still")
    assert kinds(watcher).count("sedentary") == 2


def test_pacing_is_not_a_stream_of_walking_events(watcher, room):
    feed(watcher, room, 10, zone="room", activity="still")
    for _ in range(6):                                                # walk 4 s, stop 3 s, for 42 s
        feed(watcher, room, 4, activity="walking")
        feed(watcher, room, 3, activity="still")
    assert kinds(watcher).count("walking") == 2                       # at 0 s and after the 30 s cooldown


def test_restlessness_crosses_half_once_until_it_settles(watcher, room):
    feed(watcher, room, 10, zone="desk", activity="still")            # ~6 calm seconds at the desk
    feed(watcher, room, 50, busy=lambda t: int(t) % 5 < 3)            # 60 % busy, but under a minute of data
    assert "restless" not in kinds(watcher) and watcher.data["restlessness"] is None
    feed(watcher, room, 60)
    ev = last(watcher, "restless")
    assert ev["data"]["zone"] == "desk" and 0.5 <= ev["data"]["index"] <= 0.7
    assert "fairly restless" in watcher.context_line()
    feed(watcher, room, 120)
    assert kinds(watcher).count("restless") == 1                      # stays above: no repeat
    feed(watcher, room, 300, busy=lambda t: False)                    # settles below 0.4: re-armed
    assert watcher.data["restlessness"] == 0.0
    feed(watcher, room, 300, busy=lambda t: True)
    assert kinds(watcher).count("restless") == 2
    assert "very restless" in watcher.context_line()


def test_restlessness_counts_only_the_desk_and_the_bed(watcher, room):
    feed(watcher, room, 10, zone="room", activity="walking")
    feed(watcher, room, 300, busy=lambda t: True)
    assert watcher.data["restlessness"] is None and "restless" not in kinds(watcher)


def test_the_energy_sparkline_is_one_value_a_second_for_two_minutes(watcher, room):
    feed(watcher, room, 30, zone="desk", activity="still", energy=2.5)
    e = watcher.data["energy"]
    assert len(e) == 120
    assert e[:89] == [None] * 89 and e[89:] == [2.5] * 31          # seconds 0..30 of the feed, none before


def test_a_silent_board_is_not_still_at_the_desk(watcher, room):
    feed(watcher, room, 10, zone="desk", activity="typing")
    assert watcher.live
    feed(watcher, room, STALE_S + 1, frozen=True)
    assert not watcher.live and watcher.state != "running"
    assert watcher.summary.startswith("No new reading from the board since")
    assert watcher.context_line() == ("Movement: the room sensors have sent nothing new, so where he is now "
                                      "is unknown.")
    assert watcher.zone == "desk"                                     # kept a while, in case it was a hiccup
    feed(watcher, room, FORGET_S)
    assert watcher.zone is None                                       # then dropped
    feed(watcher, room, 10, frozen=False, zone="bed")
    assert kinds(watcher) == [] and watcher.zone == "bed"             # back: a fresh start, not a "move"


def test_with_aankhen_off_or_no_model_it_says_what_it_cannot_see(watcher, room):
    room.on = False
    feed(watcher, room, 2)
    assert watcher.summary == "Aankhen is off, so the room sensors see nothing."
    assert watcher.context_line() == "Movement: Aankhen is off, so you cannot see the room."
    room.on, room.model = True, False
    feed(watcher, room, 2)
    assert "no room estimate" in watcher.summary and "no room estimate" in watcher.context_line()
    assert watcher.data["cannot_see"] == CANNOT_SEE and "fingers" in CANNOT_SEE


def test_the_context_line_reads_like_the_example(watcher, room, clock):
    feed(watcher, room, 10, zone="empty")
    arrived = clock.t + 0.5
    feed(watcher, room, 1200, zone="desk", activity="typing", activity_p=0.82)    # 20 min of calm typing
    feed(watcher, room, 245, busy=lambda t: int(t) % 5 < 3)          # from here on 60 % of seconds are busy
    for gap in (18.5, 34.0):                                          # two waves in the last minute
        feed(watcher, room, 1.5, activity="waving")
        feed(watcher, room, gap, activity="typing")
    assert clock.t - arrived == 25 * 60
    assert watcher.context_line() == ("Movement (Wi-Fi estimate): at the desk 25 min, typing (82%); "
                                      "waved twice in the last minute; fairly restless.")
    assert watcher.summary == "You've been at the desk for 25 min, typing."
    assert watcher.data["restlessness"] == 0.6
    assert watcher.live and watcher.state == "off"                    # live data; no crew is running it


def test_an_unsure_zone_is_said_with_probably(watcher, room):
    feed(watcher, room, 10, zone="bed", activity="still", zone_p=0.45)
    assert watcher.context_line().startswith("Movement (Wi-Fi estimate): probably on the bed at least ")
