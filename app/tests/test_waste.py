"""The empty-room rules, on a fake clock and fake presence: grace, nudge, and an
auto-off that only ever follows a long hold and a spoken check — never at night, never
for a sleeper, never on simulated presence, never for must-not-auto-off loads."""
from datetime import datetime

import pytest

from jarvis_app.waste import Load, WasteConfig, WasteDetector

T0 = datetime(2026, 10, 12, 18, 0).timestamp()            # evening, outside the night window
NIGHT = datetime(2026, 10, 12, 23, 30).timestamp()

REAL_EMPTY = {"state": "empty", "source": "hardware", "learned": None}
SIM_EMPTY = {"state": "empty", "source": "simulation", "learned": None}
OCCUPIED = {"state": "moving", "source": "hardware", "learned": None}


def loads(light=True, fan=True, lamp=False, wall=False):
    return [
        Load("L1", "Bedroom tube light", "bedroom", light, 20 if light else 0, switchable=True, kind="light"),
        Load("F1", "Bedroom ceiling fan", "bedroom", fan, 48 if fan else 0, switchable=True, kind="fan"),
        Load("L8", "Night lamp", "bedroom", lamp, 3 if lamp else 0, switchable=True, kind="light",
             must_not_auto_off=True),
        Load("L2", "Bedroom wall lamp", "bedroom", wall, 9 if wall else 0, switchable=False, kind="light"),
        Load("L3", "Hall tube light", "hall", True, 20, switchable=False, kind="light"),   # not the sensed room
    ]


def detector(**cfg) -> WasteDetector:
    return WasteDetector(WasteConfig.from_config({"sensed_room": "bedroom", **cfg}))


def run(d: WasteDetector, minutes: float, presence: dict, start: float = T0, step_s: float = 5.0,
        core_running: bool = True, spoken_ok: bool = True, **load_kw) -> list[dict]:
    """Tick every step_s for `minutes`; speak every nudge (as the service would)."""
    actions = []
    t = start
    end = start + minutes * 60
    while t <= end + 1e-6:
        for a in d.tick(presence, loads(**load_kw), now=t, core_running=core_running):
            actions.append(a)
            if a["type"] == "nudge" and a["speak"]:
                d.mark_spoken(a["nudge"]["id"], spoken_ok, now=t)
        t += step_s
    return actions


def kinds(actions):
    return [a["type"] for a in actions]


def test_nudge_only_after_the_hold_and_only_once():
    d = detector()
    assert run(d, 19.5, REAL_EMPTY) == []
    acts = run(d, 30, REAL_EMPTY, start=T0 + 19.5 * 60 + 5)
    assert kinds(acts) == ["nudge"]
    n = acts[0]["nudge"]
    assert n["circuits"] == ["L1", "F1"] and "L3" not in n["circuits"]          # the hall is not watched
    assert n["text"].startswith("The bedroom has been empty for 20 minutes")
    assert "sab band karo" in n["text"]                    # words core/room.py already understands
    assert acts[0]["speak"] == n["text"] and n["spoken"] is True


def test_waste_minutes_start_after_the_grace_period():
    d = detector(grace_min=5)
    run(d, 30, REAL_EMPTY, light=True, fan=False)
    day = d.days[datetime.fromtimestamp(T0).strftime("%Y-%m-%d")]
    assert day["_room"]["s"] == pytest.approx(25 * 60, abs=6)
    assert day["L1"]["wh"] == pytest.approx(20 * 25 / 60, abs=0.05)
    assert day["_room"]["sim_s"] == 0


def test_someone_coming_back_ends_the_episode():
    d = detector()
    acts = run(d, 25, REAL_EMPTY)
    assert kinds(acts) == ["nudge"]
    acts = run(d, 1, OCCUPIED, start=T0 + 26 * 60)
    assert kinds(acts) == ["resolved"] and acts[0]["nudge"]["status"] == "resolved"
    acts = run(d, 25, REAL_EMPTY, start=T0 + 30 * 60)
    assert kinds(acts) == ["nudge"]                        # a new episode, a new nudge


@pytest.mark.parametrize("state", ["uncertain", "still", "no data", None])
def test_anything_but_a_confident_empty_counts_as_someone_there(state):
    d = detector()
    assert run(d, 60, {"state": state, "source": "hardware", "learned": None}) == []
    assert d.days == {}


def test_a_sleeper_the_radar_lost_is_not_an_empty_room():
    d = detector(auto_off={"enabled": True})
    assert run(d, 120, {**REAL_EMPTY, "learned": "bed"}) == []
    assert "bed" in d.status["text"]


def test_simulated_presence_is_never_spoken_never_acted_on_and_kept_apart():
    d = detector(auto_off={"enabled": True, "after_min": 45})
    acts = run(d, 180, SIM_EMPTY)
    assert kinds(acts) == ["nudge"]
    n = acts[0]["nudge"]
    assert n["sim"] is True and n["text"].startswith("[simulated presence]")
    assert acts[0]["speak"] is None and n["not_spoken"] == "simulated presence"
    assert n["auto_off"]["will_auto_off"] is False and "presence is simulated" in n["auto_off"]["why_not"]
    day = d.days[datetime.fromtimestamp(T0).strftime("%Y-%m-%d")]
    assert day["_room"]["s"] == 0 and day["_room"]["sim_s"] > 0


def test_auto_off_is_off_by_default():
    d = detector()
    acts = run(d, 180, REAL_EMPTY)
    assert kinds(acts) == ["nudge"]
    assert acts[0]["nudge"]["auto_off"]["why_not"][0] == "auto-off is off"


def test_auto_off_after_the_long_hold_and_a_spoken_nudge_spares_what_it_must():
    d = detector(auto_off={"enabled": True, "after_min": 45})
    acts = run(d, 44.5, REAL_EMPTY, lamp=True, wall=True)
    assert kinds(acts) == ["nudge"]
    plan = acts[0]["nudge"]["auto_off"]
    assert plan["will_auto_off"] is True and plan["targets"] == ["L1", "F1"]
    assert "will be left alone" in plan["why_not"][-1]
    acts = run(d, 2, REAL_EMPTY, start=T0 + 44.5 * 60 + 5, lamp=True, wall=True)
    assert kinds(acts) == ["auto_off"]
    switched = [l.id for l in acts[0]["loads"]]
    assert switched == ["L1", "F1"]                         # not the night lamp, not the unswitchable lamp
    assert acts[0]["speak"].startswith("I've switched the bedroom tube light and the bedroom ceiling fan off")
    assert acts[0]["nudge"]["status"] == "auto_off"


def test_no_auto_off_without_a_spoken_check_first():
    # JARVIS is not running, so nobody was asked: the nudge goes to the app only.
    d = detector(auto_off={"enabled": True, "after_min": 45})
    acts = run(d, 240, REAL_EMPTY, core_running=False)
    assert kinds(acts) == ["nudge"]
    assert acts[0]["speak"] is None and acts[0]["nudge"]["not_spoken"] == "JARVIS is not running"
    # JARVIS was running, but saying it failed: still no auto-off.
    d = detector(auto_off={"enabled": True, "after_min": 45})
    assert kinds(run(d, 240, REAL_EMPTY, spoken_ok=False)) == ["nudge"]


def test_never_at_night():
    d = detector(auto_off={"enabled": True, "after_min": 45}, night={"start": "23:00", "end": "07:00"})
    acts = run(d, 240, REAL_EMPTY, start=NIGHT)
    assert kinds(acts) == ["nudge"]
    assert acts[0]["speak"] is None and "night" in acts[0]["nudge"]["not_spoken"]
    assert "it is night" in acts[0]["nudge"]["auto_off"]["why_not"]


def test_keep_it_on_cancels_the_auto_off():
    d = detector(auto_off={"enabled": True, "after_min": 45})
    acts = run(d, 21, REAL_EMPTY)
    nid = acts[0]["nudge"]["id"]
    assert d.keep(nid)["status"] == "kept"
    assert run(d, 120, REAL_EMPTY, start=T0 + 21 * 60 + 5) == []


def test_the_hold_cannot_be_configured_short():
    cfg = WasteConfig.from_config({"sensed_room": "bedroom", "nudge_after_min": 20,
                                   "auto_off": {"enabled": True, "after_min": 5, "min_after_nudge_min": 1}})
    assert cfg.min_after_nudge_min == 5 and cfg.auto_off_after_min == 30
    assert len(cfg.notes) == 2
    d = WasteDetector(cfg)
    acts = run(d, 29.5, REAL_EMPTY)
    assert kinds(acts) == ["nudge"]                         # nothing switched before 30 min
    assert kinds(run(d, 1, REAL_EMPTY, start=T0 + 29.5 * 60 + 5)) == ["auto_off"]


def test_night_window_wraps_midnight():
    cfg = WasteConfig.from_config({"night": {"start": "23:00", "end": "07:00"}})
    assert cfg.is_night(datetime(2026, 10, 12, 23, 30).timestamp())
    assert cfg.is_night(datetime(2026, 10, 13, 6, 59).timestamp())
    assert not cfg.is_night(datetime(2026, 10, 13, 7, 0).timestamp())
    assert not cfg.is_night(datetime(2026, 10, 12, 18, 0).timestamp())


def test_a_long_on_reminder_fires_once_per_on_period():
    d = detector()
    geyser = [Load("G1", "Bathroom geyser (15 L)", "bathroom", True, 2000, switchable=False, kind="geyser",
                   on_since=T0, remind_after_min=25)]
    out = []
    for m in range(0, 60):
        out += d.tick(OCCUPIED, geyser, now=T0 + m * 60, core_running=True)
    assert kinds(out) == ["remind"]
    assert out[0]["nudge"]["text"] == ("The bathroom geyser (15 L) has been on for 25 minutes. "
                                       "Switch it off once the water is hot.")
    assert out[0]["nudge"]["auto_off"]["will_auto_off"] is False
    # Off, then on again: a new on-period, a new reminder.
    d.tick(OCCUPIED, [Load("G1", "Bathroom geyser (15 L)", "bathroom", False, 0, False, kind="geyser")],
           now=T0 + 61 * 60)
    again = [Load("G1", "Bathroom geyser (15 L)", "bathroom", True, 2000, False, kind="geyser",
                  on_since=T0 + 62 * 60, remind_after_min=25)]
    assert kinds(d.tick(OCCUPIED, again, now=T0 + 90 * 60, core_running=True)) == ["remind"]


def _light(on: bool, since=None):
    return [Load("L1", "Bedroom tube light", "bedroom", on, 20 if on else 0, switchable=True, kind="light",
                 on_since=since if on else None)]


def _tick_until(d, presence, minutes_from, minutes_to, load_fn, step_s=5.0):
    out, t = [], T0 + minutes_from * 60
    while t <= T0 + minutes_to * 60 + 1e-6:
        for a in d.tick(presence, load_fn(t), now=t, core_running=True):
            out.append((round((t - T0) / 60, 2), a))
            if a["type"] == "nudge" and a["speak"]:
                d.mark_spoken(a["nudge"]["id"], True, now=t)
        t += step_s
    return out


def test_a_light_switched_on_in_an_empty_room_gets_the_full_hold():
    """The room has been empty an hour; someone switches the light on from the app.
    That is not 'an hour of waste': the nudge waits the full 20 minutes from the switch."""
    d = detector(auto_off={"enabled": True, "after_min": 45})
    assert _tick_until(d, REAL_EMPTY, 0, 60, lambda t: _light(False)) == []
    assert "empty 60 min" in d.status["text"]                 # the empty timer kept running
    on_at = T0 + 60 * 60
    acts = _tick_until(d, REAL_EMPTY, 60.05, 100, lambda t: _light(True, on_at))
    assert [a["type"] for _, a in acts] == ["nudge"]
    assert 80.0 <= acts[0][0] <= 80.1                         # 20 min after the switch, not at once


def test_no_quick_second_switch_off_after_an_auto_off():
    d = detector(auto_off={"enabled": True, "after_min": 45})
    acts = _tick_until(d, REAL_EMPTY, 0, 46, lambda t: _light(True, T0 - 60))
    assert [a["type"] for _, a in acts] == ["nudge", "auto_off"]
    # Off for a minute, then someone switches it back on; the sensors still say empty.
    acts = _tick_until(d, REAL_EMPTY, 46.05, 47, lambda t: _light(False))
    assert acts == []
    back = T0 + 47.05 * 60
    acts = _tick_until(d, REAL_EMPTY, 47.05, 100, lambda t: _light(True, back))
    assert [(a["type"]) for _, a in acts] == ["nudge", "auto_off"]
    assert acts[0][0] >= 67.0 and acts[1][0] >= 92.0          # full 20 and 45 minute holds again


def test_spoken_lines_say_one_minute_not_one_minutes():
    d = detector(grace_min=0, nudge_after_min=1)
    acts = run(d, 2, REAL_EMPTY)
    assert "empty for 1 minute and" in acts[0]["nudge"]["text"]


def test_nudges_survive_a_restart_but_their_episode_does_not(tmp_path):
    d = WasteDetector(WasteConfig.from_config({"sensed_room": "bedroom"}), folder=tmp_path)
    run(d, 25, REAL_EMPTY)
    d.flush(force=True)
    again = WasteDetector(WasteConfig.from_config({"sensed_room": "bedroom"}), folder=tmp_path)
    assert again.nudges[-1]["status"] == "closed"
    assert again.days == d.days
    new = run(again, 25, REAL_EMPTY, start=T0 + 3600)
    assert new[0]["nudge"]["id"] != d.nudges[-1]["id"]
