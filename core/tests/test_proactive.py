"""core/proactive.py: when JARVIS may speak unprompted (rate limit, quiet hours, mute,
busy, media, evidence) and what he may say (the LLM's line is checked, else a template)."""
import json
import time

import proactive as p

NOON = time.mktime((2026, 10, 15, 12, 0, 0, 0, 0, -1))
ONE_AM = time.mktime((2026, 10, 15, 1, 0, 0, 0, 0, -1))


class Clock:
    def __init__(self, t):
        self.t = t

    def __call__(self):
        return self.t


def arrived(ts=None, **kw):
    ev = {"kind": "arrived", "priority": 2, "summary": "Back in the room after 12 min away",
          "facts": {"zone": "desk", "away_min": 12}, "evidence": "observed", "certainty": "probable", "ts": ts}
    ev.update(kw)
    return ev


def policy(clock, settings=None):
    return p.Policy(settings=lambda: {"proactive": dict(settings or {})}, clock=clock)


def test_speaks_once_then_rate_limits_for_the_gap():
    clock = Clock(NOON)
    pol = policy(clock, {"min_gap_min": 20})
    assert pol.decide(arrived(NOON)).speak
    pol.spoke()
    clock.t += 19 * 60
    d = pol.decide(arrived(clock.t))
    assert (d.speak, d.reason) == (False, "rate_limited")
    clock.t += 2 * 60
    assert pol.decide(arrived(clock.t)).speak


def test_never_in_quiet_hours_including_across_midnight():
    assert policy(Clock(ONE_AM)).decide(arrived(ONE_AM)).reason == "quiet_hours"          # default 00:30-07:00
    night = policy(Clock(ONE_AM), {"quiet_start": "22:00", "quiet_end": "07:00"})
    assert night.decide(arrived(ONE_AM)).reason == "quiet_hours"
    assert policy(Clock(NOON), {"quiet_start": "22:00", "quiet_end": "07:00"}).decide(arrived(NOON)).speak
    assert p.in_quiet_hours(NOON, "12:00", "12:00") is False                              # equal: no window


def test_mute_and_off_win_over_everything():
    assert policy(Clock(NOON), {"muted": True}).decide(arrived(NOON)).reason == "muted"
    assert policy(Clock(NOON), {"enabled": False}).decide(arrived(NOON)).reason == "off"


def test_busy_media_and_text_mode_hold_it():
    pol = policy(Clock(NOON))
    assert pol.decide(arrived(NOON), {"talking": True}).reason == "busy"
    assert pol.decide(arrived(NOON), {"in_turn": True}).reason == "busy"
    assert pol.decide(arrived(NOON), {"last_heard_at": NOON - 30}).reason == "busy"
    assert pol.decide(arrived(NOON), {"last_heard_at": NOON - 300}).speak
    assert pol.decide(arrived(NOON), {"media_playing": True}).reason == "media"
    assert pol.decide(arrived(NOON), {"text_mode": True}).reason == "text_mode"
    assert pol.counts["busy"] == 3


def test_only_honest_evidence_is_spoken():
    pol = policy(Clock(NOON))
    assert pol.decide(arrived(NOON, sim=True)).reason == "no_evidence"
    assert pol.decide(arrived(NOON, certainty="unknown")).reason == "no_evidence"
    assert pol.decide(arrived(NOON, evidence="none")).reason == "no_evidence"
    assert pol.decide({"kind": "left", "evidence": "observed", "certainty": "probable"}).reason == "nobody_there"
    assert pol.decide({"kind": "reminder_due", "evidence": "system", "certainty": "sure"}).reason == "handled"
    assert pol.decide(arrived(NOON - p.STALE_S - 1)).reason == "stale"


def test_bad_settings_fall_back_to_the_defaults():
    s = p.settings_from({"proactive": {"enabled": "yes", "quiet_start": "25:00", "min_gap_min": -3}})
    assert s == p.DEFAULTS


def test_voice_switch_phrases():
    assert p.voice_command("quiet mode") == "mute"
    assert p.voice_command("Jarvis, quiet mode please") == "mute"
    assert p.voice_command("stop commenting") == "mute"
    assert p.voice_command("you can talk again") == "unmute"
    assert p.voice_command("quiet mode off") == "unmute"
    assert p.voice_command("be quiet") is None                 # "stop talking now", not a standing switch
    assert p.voice_command("turn the light off") is None
    assert p.voice_command("tell me a long story about how quiet mode works in a library at night") is None


def test_set_muted_writes_the_apps_settings_file(tmp_path):
    path = tmp_path / "settings.json"
    assert p.set_muted(True, path=path)
    assert json.loads(path.read_text(encoding="utf-8"))["proactive"]["muted"] is True
    assert p.set_muted(False, path=path)
    assert json.loads(path.read_text(encoding="utf-8"))["proactive"]["muted"] is False


def test_the_llm_line_is_checked_for_hedges_numbers_and_length():
    ev = arrived(NOON)
    assert p.clean_line("Welcome back, sir; you seem to have been away about 12 minutes.", ev)
    assert p.clean_line("Welcome back, sir. You were away 12 minutes.", ev) is None       # no hedge
    assert p.clean_line("Welcome back, sir; you seem to have been out for 40 minutes.", ev) is None   # invented
    assert p.clean_line("Sir, it seems " + "very " * 40 + "nice.", ev) is None              # too long
    assert p.clean_line("It seems you're back, sir. Did you have a nice walk?", ev) is None  # invites a reply
    sure = {"kind": "relay_failed", "facts": {"device": "light"}, "certainty": "sure", "evidence": "system"}
    assert p.clean_line("Remark: The light did not confirm the switch, sir.", sure) == \
        "The light did not confirm the switch, sir."


def test_make_line_falls_back_to_the_template():
    ev = arrived(NOON)
    line, via = p.make_line(ev, lambda prompt: "You were away exactly 99 minutes!")
    assert via == "template" and "12 minutes" in line and "seem" in line
    line, via = p.make_line(ev, lambda prompt: (_ for _ in ()).throw(ConnectionError("ollama down")))
    assert via == "template"
    line, via = p.make_line(ev, lambda prompt: "Welcome back, sir. It seems you were away 12 minutes.")
    assert via == "llm"
    prompt_text = p.prompt(ev)
    assert "away_min: 12" in prompt_text and "probably" in prompt_text


def test_every_template_kind_says_something_and_hedges_estimates():
    for kind, facts in (("long_stillness", {"still_min": 70}), ("went_to_bed", {}), ("woke_up", {}),
                        ("sedentary", {"minutes": 50})):
        line = p.fallback_line({"kind": kind, "facts": facts, "certainty": "probable"})
        assert line and any(h in line.lower() for h in p.HEDGES), line
    assert "light" in p.fallback_line({"kind": "relay_failed", "facts": {"device": "light"}})
