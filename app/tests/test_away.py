"""Away mode's rules (jarvis_app/away.py) with a fake clock, a fake LAN and recorded
actions: when it arms and disarms, when motion becomes an alarm, and the privacy and
honesty rules — nothing while disarmed, SIMULATED on every simulated alert, and no
spoken claim without a receipt."""
import json

import pytest

from jarvis_app.away import (Actions, AwayConfig, AwayMode, IncidentStore, KofN, Sample, load_config,
                             sample_from_hub)
from jarvis_app.presence import Phone, PresenceChecker

PAPA, MAA = "192.168.1.23", "192.168.1.40"


class Clock:
    def __init__(self, t=1_800_000_000.0):
        self.t = t

    def __call__(self):
        return self.t


class Net:
    """Phones listed by IP; a phone in `home` answers ping."""

    def __init__(self, home=()):
        self.home = set(home)

    def __call__(self, cmd):
        if cmd[0] == "ping":
            ip = cmd[-1]
            return f"Reply from {ip}: bytes=32 time=3ms TTL=64" if ip in self.home else "Request timed out."
        return ""                                   # empty arp / neighbour tables


class Rec(Actions):
    def __init__(self, lights=True, voice=True):
        self.events, self.lights, self.said = [], [], []
        self._lights, self._voice = lights, voice

    def lights_on(self):
        self.lights.append(1)
        return {"done": self._lights, "detail": "test"}

    def speak(self, text):
        self.said.append(text)
        return {"done": self._voice, "detail": "test"}

    def publish(self, kind, text, **data):
        self.events.append({"kind": kind, "text": text, **data})

    def alerts(self, level=None):
        return [e for e in self.events if e["kind"] == "alert" and (level is None or e["level"] == level)]


def make(tmp_path, phones=(PAPA,), home=(PAPA,), actions=None, **cfg):
    clock, net = Clock(), Net(home)
    plist = [Phone(f"P{i}", None, ip) for i, ip in enumerate(phones)]
    c = AwayConfig(phones=plist, **cfg)
    chk = PresenceChecker(plist, run=net, clock=clock)
    acts = actions or Rec()
    away = AwayMode(c, chk, acts, IncidentStore(tmp_path), tmp_path / "state.json", clock=clock)
    return away, chk, net, acts, clock


def check(away, chk):
    chk.check()
    away.on_presence(chk.clock())


def walk(minutes, away, chk, clock, every_s=30):
    for _ in range(int(minutes * 60 / every_s)):
        clock.t += every_s
        check(away, chk)


def hw(t, pos=True, **kw):
    return Sample(t, "hardware", "motion" if pos else "quiet", 4.0 if pos else 0.6, 1.8,
                  hardware=True, csi_age_s=kw.pop("age", 0.1), **kw)


def feed(away, clock, seconds, make_sample=hw, **kw):
    for _ in range(seconds):
        clock.t += 1
        away.on_sample(make_sample(clock.t, **kw), clock.t)
        away.tick(clock.t)


# ------------------------------------------------------------------ k of n
def test_k_of_n_needs_k_positive_windows_in_the_last_n():
    k = KofN(4, 8)
    assert [k.push(x) for x in [1, 0, 0, 0, 1, 0, 0, 0] * 3] == [False] * 24   # 1 in 4 never
    k.reset()
    assert [k.push(x) for x in [1, 1, 0, 1, 0, 1]] == [False, False, False, False, False, True]
    k.reset()
    assert [k.push(1) for _ in range(4)] == [False, False, False, True]


def test_a_window_is_positive_only_for_real_motion():
    t = 0.0
    assert Sample(t, "hardware", "motion").positive
    assert not Sample(t, "hardware", "recent").positive            # the hold after motion
    assert not Sample(t, "hardware", "motion", settling=True).positive   # fan just switched
    assert Sample(t, "hardware", "quiet", moving=1).positive        # a moving radar track
    assert not Sample(t, "hardware", "quiet", still=1).positive


def test_wifi_motion_is_vetoed_while_a_live_radar_sees_nobody_in_the_room():
    t = 0.0
    assert not Sample(t, "hardware", "motion", radar_live=True).positive      # the corridor, not the room
    assert Sample(t, "hardware", "motion", radar_live=True, still=1).positive  # someone is in the room
    assert Sample(t, "hardware", "quiet", radar_live=True, moving=1).positive
    assert Sample(t, "hardware", "motion", radar_live=False).positive         # no radar: Wi-Fi alone


# ------------------------------------------------------------------ arming by presence
def test_arms_after_everyone_is_away_and_disarms_when_a_phone_returns(tmp_path):
    away, chk, net, acts, clock = make(tmp_path)
    check(away, chk)
    assert not away.armed and away.auto_arm_ready(clock.t)[1] == "a family phone was seen recently"
    net.home.clear()                                    # Papa leaves
    walk(14.5, away, chk, clock)
    assert not away.armed
    walk(1, away, chk, clock)
    assert away.armed and away.armed_by == "auto"
    assert away.watching(clock.t)                       # no exit delay: the house is already empty
    assert acts.events[-1]["kind"] == "armed"
    net.home.add(PAPA)                                  # he is back
    clock.t += 30
    check(away, chk)
    assert not away.armed and away.disarmed_by == "phone"
    assert acts.events[-1] == {"kind": "disarmed", "text": "Away mode disarmed: P0's phone came home",
                               "by": "phone", "who": "P0"}


def test_auto_arm_waits_until_every_listed_phone_has_been_seen(tmp_path):
    away, chk, net, acts, clock = make(tmp_path, phones=(PAPA, MAA), home=(PAPA,))
    check(away, chk)
    net.home.clear()
    walk(20, away, chk, clock)
    ready, why, _ = away.auto_arm_ready(clock.t)
    assert not away.armed and not ready and "not yet: P1" in why


def test_auto_arm_off_means_no_phone_checks_at_all(tmp_path):
    away, *_ = make(tmp_path, auto_arm=False)
    assert away.check_interval() is None               # nothing needs to know who is home
    away.arm("app")
    assert away.check_interval() == 30                 # armed: watch for a homecoming


def test_a_broken_phone_check_never_arms(tmp_path):
    away, chk, net, acts, clock = make(tmp_path)
    check(away, chk)
    chk.run = lambda cmd: (_ for _ in ()).throw(OSError("arp missing"))
    walk(30, away, chk, clock)
    assert not away.armed and "failing" in away.auto_arm_ready(clock.t)[1]


def test_disarming_by_hand_with_no_phone_home_pauses_auto_arm(tmp_path):
    away, chk, net, acts, clock = make(tmp_path, home=())
    chk.states[PAPA].last_seen = clock.t - 3600         # seen once, an hour ago
    away.arm("app")
    away.disarm("app")                                  # someone without a listed phone is home
    assert away.auto_paused
    walk(30, away, chk, clock)
    assert not away.armed and away.auto_arm_ready(clock.t)[1].startswith("paused")
    net.home.add(PAPA)
    clock.t += 30
    check(away, chk)
    assert not away.auto_paused                         # a family phone is back: normal rules
    net.home.clear()
    walk(16, away, chk, clock)
    assert away.armed and away.armed_by == "auto"


def test_a_phone_dozing_at_home_does_not_disarm_a_manual_arm(tmp_path):
    away, chk, net, acts, clock = make(tmp_path, home=(PAPA,), return_gap_s=120)
    check(away, chk)
    net.home.clear()                                    # the phone dozes for 10 min
    walk(10, away, chk, clock)
    away.arm("voice")                                   # "Jarvis, arm the house" on the way out
    net.home.add(PAPA)                                  # the phone wakes as he walks out
    clock.t += 30
    check(away, chk)
    assert away.armed                                   # not a homecoming
    net.home.clear()                                    # he has gone
    walk(3, away, chk, clock)
    net.home.add(PAPA)                                  # and comes back
    clock.t += 30
    check(away, chk)
    assert not away.armed and away.disarmed_by == "phone"


# ------------------------------------------------------------------ privacy
def test_nothing_is_sampled_recorded_or_alerted_while_disarmed(tmp_path):
    away, chk, net, acts, clock = make(tmp_path)
    feed(away, clock, 60)                               # a family member walking about at home
    assert acts.events == [] and acts.lights == [] and acts.said == []
    assert not (tmp_path / "incidents").exists() and len(away._pre) == 0


def test_the_exit_delay_watches_nothing(tmp_path):
    away, chk, net, acts, clock = make(tmp_path, exit_delay_s=60)
    away.arm("app")
    assert away.status()["phase"] == "arming" and away.status()["exit_left_s"] == 60
    feed(away, clock, 59)                               # the family leaving
    assert acts.alerts() == [] and len(away._pre) == 0
    feed(away, clock, 4)
    assert away.incident is not None                    # watching from 60 s on


def test_disarming_drops_the_buffer_and_ends_the_trace(tmp_path):
    away, chk, net, acts, clock = make(tmp_path)
    away.arm("auto")
    feed(away, clock, 2)
    feed(away, clock, 2, pos=False)
    assert len(away._pre) == 4
    away.disarm("app")
    assert len(away._pre) == 0
    feed(away, clock, 20)
    assert away.incident is None and acts.alerts() == []


# ------------------------------------------------------------------ the alarm pipeline
def test_confirmed_motion_lights_alert_then_alarm_after_the_entry_delay(tmp_path):
    away, chk, net, acts, clock = make(tmp_path, entry_delay_s=30, clear_after_s=30)
    away.arm("auto")
    feed(away, clock, 5, pos=False)
    feed(away, clock, 3)
    assert away.incident is None                        # 3 of 8: not yet
    feed(away, clock, 1)
    inc = away.incident
    assert inc and inc["stage"] == "pending" and acts.lights == [1]
    pend = acts.alerts("pending")
    assert len(pend) == 1 and "Alarm in 30 s" in pend[0]["text"] and pend[0]["sim"] is False
    assert away.check_interval() == 3                   # look hard for a returning phone
    on_disk = json.loads((tmp_path / "incidents" / f"{inc['id']}.json").read_text(encoding="utf-8"))
    assert on_disk["stage"] == "pending" and on_disk["source"] == "hardware" and on_disk["label"] is None
    assert [r["pos"] for r in on_disk["trace"]] == [False] * 5 + [True] * 4     # the build-up
    assert on_disk["started_at"] == on_disk["confirmed_at"] - 3                 # first positive window
    assert acts.said == []
    feed(away, clock, 30)                               # the intruder keeps moving
    assert away.incident["stage"] == "alarm" and len(acts.alerts("alarm")) == 1
    assert acts.said == ["Warning. This house is armed and movement has been detected inside. "
                         "It has been logged. The lights are on."]
    assert away.status()["phase"] == "alarm"
    feed(away, clock, 30, pos=False)                    # gone quiet
    assert away.incident is None
    done = IncidentStore(tmp_path).get(inc["id"])
    assert done["outcome"] == "motion stopped" and done["duration_s"] == 33.0
    assert done["actions"]["lights"]["done"] and done["actions"]["speech"]["done"]
    assert len(done["trace"]) <= 30 + 31 and done["trace"][-1]["t"] <= 30
    assert away.armed                                   # still armed for the next one
    assert IncidentStore(tmp_path).list()[0]["trace_n"] == len(done["trace"])


def test_speech_never_claims_lights_that_were_not_confirmed(tmp_path):
    away, chk, net, acts, clock = make(tmp_path, actions=Rec(lights=False), entry_delay_s=0)
    away.arm("auto")
    feed(away, clock, 4)
    assert "lights" not in acts.said[0].lower()
    assert "lights NOT confirmed" in acts.alerts("alarm")[0]["text"]
    assert "nothing spoken" not in acts.alerts("alarm")[0]["text"]


def test_a_family_phone_returning_in_the_entry_delay_cancels_the_alarm(tmp_path):
    away, chk, net, acts, clock = make(tmp_path, home=())
    chk.states[PAPA].last_seen = clock.t - 3600
    away.arm("auto")
    feed(away, clock, 6)                                # they walk in before the phone rejoins
    inc_id = away.incident["id"]
    net.home.add(PAPA)
    clock.t += 3
    check(away, chk)
    assert not away.armed and acts.said == [] and acts.alerts("alarm") == []
    rec = IncidentStore(tmp_path).get(inc_id)
    assert rec["outcome"] == "cancelled during the entry delay: P0's phone came home"
    n = len(rec["trace"])
    feed(away, clock, 10)                               # at home now: nothing more is recorded
    assert len(IncidentStore(tmp_path).get(inc_id)["trace"]) == n


def test_standing_still_after_confirmation_does_not_cancel_the_alarm(tmp_path):
    away, chk, net, acts, clock = make(tmp_path, entry_delay_s=30, clear_after_s=20)
    away.arm("auto")
    feed(away, clock, 4)                                # confirmed
    feed(away, clock, 40, pos=False)                    # then frozen in place
    assert len(acts.alerts("alarm")) == 1 and len(acts.said) == 1
    assert IncidentStore(tmp_path).list()[0]["outcome"] == "motion stopped"   # closed only after sounding


def test_one_noisy_second_never_alarms(tmp_path):
    away, chk, net, acts, clock = make(tmp_path)
    away.arm("auto")
    for i in range(120):                                # a blip every 4 s for two minutes
        clock.t += 1
        away.on_sample(hw(clock.t, pos=(i % 4 == 0)), clock.t)
        away.tick(clock.t)
    assert away.incident is None and acts.alerts("pending") == []


# ------------------------------------------------------------------ tamper
def test_no_csi_for_30_s_in_hardware_mode_is_a_tamper_alert_once(tmp_path):
    away, chk, net, acts, clock = make(tmp_path)
    away.arm("auto")
    for age in (5, 20, 29.5):
        clock.t += 1
        away.on_sample(hw(clock.t, pos=False, age=age), clock.t)
    assert acts.alerts("tamper") == []
    for age in (31, 32, 33):
        clock.t += 1
        away.on_sample(hw(clock.t, pos=False, age=age), clock.t)
    t = acts.alerts("tamper")
    assert len(t) == 1 and "Sensor offline" in t[0]["text"] and "31 s" in t[0]["text"]
    assert away.status()["tamper"]["id"] == t[0]["incident"]
    clock.t += 1
    away.on_sample(hw(clock.t, pos=False, age=0.2), clock.t)        # frames are back
    assert away.tamper is None
    rec = IncidentStore(tmp_path).get(t[0]["incident"])
    assert rec["kind"] == "tamper" and rec["outcome"] == "frames resumed"


def test_no_tamper_in_simulation_or_while_disarmed(tmp_path):
    away, chk, net, acts, clock = make(tmp_path)
    for _ in range(5):
        clock.t += 1
        away.on_sample(hw(clock.t, pos=False, age=120), clock.t)    # disarmed
    away.arm("auto")
    for _ in range(5):
        clock.t += 1
        away.on_sample(Sample(clock.t, "simulation", "quiet", csi_age_s=120), clock.t)
    assert acts.alerts("tamper") == []


# ------------------------------------------------------------------ honesty about simulation
def sim(t, pos=True, **kw):
    return Sample(t, "simulation", "motion" if pos else "quiet", 4.0 if pos else 0.5, 1.8, csi_age_s=0.1)


def test_every_alert_from_the_simulator_is_labelled_simulated(tmp_path):
    away, chk, net, acts, clock = make(tmp_path, entry_delay_s=5)
    away.arm("auto")
    feed(away, clock, 20, make_sample=sim)
    alerts = acts.alerts()
    assert {a["level"] for a in alerts} == {"warning", "pending", "alarm"}
    for a in alerts:
        assert a["label"] == "SIMULATED" and a["sim"] is True and a["text"].startswith("SIMULATED — ")
    assert "real house is not being watched" in acts.alerts("warning")[0]["text"]
    assert acts.said[0].startswith("Simulated alert. ")
    rec = IncidentStore(tmp_path).list()[0]
    assert rec["label"] == "SIMULATED" and rec["simulated"] is True
    assert any("simulation" in w for w in away.status()["warnings"])


def test_armed_with_aankhen_off_says_nothing_is_watched_once(tmp_path):
    away, chk, net, acts, clock = make(tmp_path)
    away.arm("auto")
    for _ in range(5):
        clock.t += 1
        away.on_sample(Sample(clock.t, None), clock.t)
    w = acts.alerts("warning")
    assert len(w) == 1 and "nothing is being watched" in w[0]["text"]


# ------------------------------------------------------------------ restart, config
def test_an_armed_house_stays_armed_after_a_restart(tmp_path):
    away, chk, net, acts, clock = make(tmp_path, exit_delay_s=60)
    away.arm("app")
    clock.t += 3600
    again = AwayMode(away.cfg, chk, Rec(), IncidentStore(tmp_path), tmp_path / "state.json", clock=clock)
    assert again.armed and again.armed_by == "app" and again.restored
    assert again.watching(clock.t)                      # no second exit delay
    assert any("restart" in w for w in again.status()["warnings"])
    again.disarm("app")
    assert not any("restart" in w for w in again.status()["warnings"])
    third = AwayMode(away.cfg, chk, Rec(), IncidentStore(tmp_path), tmp_path / "state.json", clock=clock)
    assert not third.armed


def test_config_is_validated(tmp_path):
    with pytest.raises(ValueError, match="confirm_k"):
        AwayConfig.from_dict({"confirm_k": 9, "confirm_n": 8})
    with pytest.raises(ValueError, match="between"):
        AwayConfig.from_dict({"away_after_min": 0})
    with pytest.raises(ValueError, match="twice"):
        AwayConfig.from_dict({"phones": [{"name": "A", "ip": PAPA}, {"name": "B", "ip": PAPA}]})
    with pytest.raises(ValueError, match="5-300"):
        AwayConfig.from_dict({"warning": "hi"})
    with pytest.raises(ValueError, match="home-network"):
        AwayConfig.from_dict({"phones": [{"name": "A", "ip": "8.8.8.8"}]})
    cfg = AwayConfig.from_dict({"auto_arm": 0, "confirm_n": "10", "nonsense": 1})
    assert cfg.auto_arm is False and cfg.confirm_n == 10
    assert AwayConfig.from_dict(cfg.to_dict()).to_dict() == cfg.to_dict()
    (tmp_path / "config.json").write_text("{not json", encoding="utf-8")
    loaded, problem = load_config(tmp_path)
    assert loaded.phones == [] and "config.json" in problem


def test_incident_ids_cannot_escape_the_folder(tmp_path):
    store = IncidentStore(tmp_path)
    assert store.get("../state") is None and store.get("..\\x") is None
    assert store.list() == []


# ------------------------------------------------------------------ reading the hub
class FakeEngine:
    def __init__(self, frame, csi_at, now):
        self.frame, self.last_host, self._now = frame, {"csi": csi_at}, now

    def frame_message(self):
        return self.frame

    def clock(self):
        return self._now


class FakeHub:
    def __init__(self, engine, mode="hardware", running=True):
        self.engine, self.mode, self.running, self.started_at = engine, mode, running, 100.0


def test_sample_from_hub_reads_the_engine_frame():
    frame = {"source": "hardware",
             "motion_detail": {"state": "motion", "score": 5.2, "threshold": 1.8, "settling": False},
             "tracks": [{"id": "P1", "still": False}, {"id": "P2", "still": True}],
             "presence": {"state": "moving", "count_source": "radar"}}
    s = sample_from_hub(FakeHub(FakeEngine(frame, csi_at=50.0, now=52.5)), now=200.0)
    assert (s.source, s.wifi, s.score, s.moving, s.still, s.presence, s.hardware, s.radar_live) == \
        ("hardware", "motion", 5.2, 1, 1, "moving", True, True)
    assert s.csi_age_s == 2.5 and s.positive
    never = sample_from_hub(FakeHub(FakeEngine(frame, csi_at=None, now=0)), now=160.0)
    assert never.csi_age_s == 60.0                      # nothing since the hub started
    off = sample_from_hub(FakeHub(None, running=False), now=1.0)
    assert off.source is None and not off.positive


def _run_real_engine(tmp_path, scenario, seconds, baseline, room):
    """The real Aankhen engine on the simulator, sampled once per simulated second
    exactly as routes_security samples the hub, feeding the real AwayMode."""
    from aankhen.engine import Engine
    from aankhen.protocol import StreamDecoder, decode_packet
    from aankhen.simulator import SCENARIOS, Simulator
    sim = Simulator(room, SCENARIOS[scenario](), seed=1)
    eng = Engine(room, "simulation", baseline=baseline)
    eng.clock = lambda: eng.device_t or 0.0
    hub = FakeHub(eng, mode="simulation")
    clock, acts = Clock(0.0), Rec()
    away = AwayMode(AwayConfig(entry_delay_s=5), PresenceChecker([]), acts, IncidentStore(tmp_path),
                    tmp_path / "state.json", clock=clock)
    away.arm("auto", now=0.0)
    dec, nxt, off = StreamDecoder(), 3.0, sim.boot_us / 1e6
    for ch in sim.chunks(seconds):
        for fr in dec.feed(ch):
            eng.process(decode_packet(fr))
        while eng.device_t is not None and nxt <= eng.device_t - off:
            clock.t = nxt
            away.on_sample(sample_from_hub(hub, nxt), nxt)
            away.tick(nxt)
            nxt += 1.0
    return acts


def test_the_real_engine_confirms_a_simulated_walker_and_not_an_empty_room(tmp_path):
    from aankhen.bench import simulated_baseline
    from aankhen.room import default_room
    room = default_room()
    baseline = simulated_baseline(room)
    walk = _run_real_engine(tmp_path / "walk", "walk", 20, baseline, room)
    assert len(walk.alerts("pending")) == 1 and len(walk.alerts("alarm")) == 1
    assert all(a["label"] == "SIMULATED" for a in walk.alerts())
    empty = _run_real_engine(tmp_path / "empty", "empty", 60, baseline, room)
    assert empty.alerts("pending") == [] and empty.alerts("alarm") == []
