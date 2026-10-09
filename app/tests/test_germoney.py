"""Mission Germoney's server half: storage that can't lose progress, AI output that
must match the phone app's schemas, and a calendar that understands weekly classes."""
from datetime import date, datetime, timedelta, timezone

import pytest

from jarvis_app import germoney as g


# ------------------------------------------------------------------ storage
def test_kv_round_trip_with_the_phone_apps_keys(tmp_path):
    kv = g.KVStore(tmp_path / "kv", tmp_path / "bk")
    kv.set("@silicon_player_v2", '{"level": 3}')
    assert kv.get("@silicon_player_v2") == '{"level": 3}'
    assert kv.keys() == ["@silicon_player_v2"]
    kv.delete("@silicon_player_v2")
    assert kv.get("@silicon_player_v2") is None


def test_keys_are_case_safe_on_windows(tmp_path):
    kv = g.KVStore(tmp_path / "kv", tmp_path / "bk")
    kv.set("@a", "1")
    kv.set("@A", "2")                       # different keys, different files on NTFS
    assert (kv.get("@a"), kv.get("@A")) == ("1", "2")


def test_bad_keys_and_values_are_refused(tmp_path):
    kv = g.KVStore(tmp_path / "kv", tmp_path / "bk")
    for bad in ["../escape", "a/b", "", "x" * 200]:
        with pytest.raises(ValueError):
            kv.set(bad, "v")
    with pytest.raises(ValueError):
        kv.set("@ok", 123)                  # AsyncStorage stores strings only


def test_daily_backup_is_taken_before_the_first_change(tmp_path):
    kv = g.KVStore(tmp_path / "kv", tmp_path / "bk")
    kv.set("@silicon_player_v2", "old")
    kv.set("@silicon_player_v2", "new")      # first write of a day with data present
    snaps = list((tmp_path / "bk").iterdir())
    assert len(snaps) == 1
    import json
    saved = [json.loads(p.read_text()) for p in snaps[0].glob("*.json")]
    assert saved[0]["value"] == "old"        # the backup holds the state BEFORE today's edits


def test_export_import(tmp_path):
    a = g.KVStore(tmp_path / "a", tmp_path / "ab")
    a.set("@silicon_logs_v1", "[1]")
    b = g.KVStore(tmp_path / "b", tmp_path / "bb")
    assert b.import_all(a.export_all() | {"../bad": "x", "@n": 5}) == 1
    assert b.get("@silicon_logs_v1") == "[1]"


# ------------------------------------------------------------------ AI validation
def test_quests_must_match_the_schema():
    ok = {"quests": [{"title": f"Quest {i}", "description": "Do one specific thing today.", "xp": 20,
                      "skillBranch": "theForge"} for i in range(3)]}
    assert len(g.validate("quests", ok)["quests"]) == 3
    for bad in [{"quests": ok["quests"][:2]},                                   # too few
                {"quests": [dict(q, xp=500) for q in ok["quests"]]},           # absurd XP
                {"quests": [dict(q, skillBranch="cooking") for q in ok["quests"]]}]:
        with pytest.raises(ValueError):
            g.validate("quests", bad)


def test_failure_category_must_be_known():
    good = {"rootCause": "Slept at 3am", "category": "energy", "intervention": "Bed by 11.", "verdict": "Fix the input."}
    assert g.validate("failure", good)["category"] == "energy"
    with pytest.raises(ValueError):
        g.validate("failure", dict(good, category="bad luck"))


def test_clip_never_cuts_a_word():
    s = g._clip("Translate and verify a German technical sentence into English today", 60)
    assert len(s) <= 60 and s.endswith("…") and not s[:-1].endswith("Englis")
    assert g._clip("short", 60) == "short"


def test_extract_json_from_fenced_or_chatty_output():
    assert g.extract_json('Sure! ```json\n{"a": 1}\n``` hope that helps') == {"a": 1}
    assert g.extract_json('Here: {"quests": []} done') == {"quests": []}
    with pytest.raises(ValueError):
        g.extract_json("no json at all")


def test_generate_falls_over_cleanly_without_ollama(monkeypatch):
    def boom(*a, **k):
        raise g.httpx.ConnectError("refused")
    monkeypatch.setattr(g.httpx, "post", boom)
    with pytest.raises(RuntimeError):
        g.generate("quests", {"level": 0, "rank": "x", "phase": "y"})


# ------------------------------------------------------------------ calendar
ICS = """BEGIN:VCALENDAR
BEGIN:VEVENT
SUMMARY:Digital Electronics lecture
DTSTART;TZID=Asia/Kolkata:20261005T100000
DTEND;TZID=Asia/Kolkata:20261005T110000
RRULE:FREQ=WEEKLY;BYDAY=MO,WE,FR;UNTIL=20261231T000000Z
EXDATE;TZID=Asia/Kolkata:20261007T100000
END:VEVENT
BEGIN:VEVENT
SUMMARY:Holiday
DTSTART;VALUE=DATE:20261009
DTEND;VALUE=DATE:20261010
END:VEVENT
BEGIN:VEVENT
SUMMARY:Call with
  a folded line
DTSTART:20261009T083000Z
DTEND:20261009T090000Z
END:VEVENT
END:VCALENDAR
"""


def test_weekly_class_recurs_on_its_days_only():
    ev = next(e for e in g.parse_ics(ICS) if e["title"].startswith("Digital"))
    assert g._occurs_on(ev, date(2026, 10, 12))            # Monday
    assert g._occurs_on(ev, date(2026, 10, 9))             # Friday
    assert g._occurs_on(ev, date(2026, 10, 13)) is None    # Tuesday
    assert g._occurs_on(ev, date(2026, 10, 7)) is None     # EXDATE: cancelled
    assert g._occurs_on(ev, date(2027, 1, 4)) is None      # after UNTIL


def test_all_day_and_utc_and_folded_lines():
    evs = g.parse_ics(ICS)
    holiday = next(e for e in evs if e["title"] == "Holiday")
    assert holiday["all_day"] and g._occurs_on(holiday, date(2026, 10, 9))
    call = next(e for e in evs if e["title"].startswith("Call with"))
    assert call["title"] == "Call with a folded line"
    expect = datetime(2026, 10, 9, 8, 30, tzinfo=timezone.utc).astimezone().replace(tzinfo=None)
    assert call["start"] == expect                         # UTC shown in local time


def test_free_blocks_skip_busy_time_and_short_gaps():
    day = date(2026, 10, 9)
    evs = [{"start": "2026-10-09T10:00", "end": "2026-10-09T11:00", "allDay": False},
           {"start": "2026-10-09T11:20", "end": "2026-10-09T12:00", "allDay": False},   # 20-min gap: too short
           {"start": "2026-10-09T00:00", "end": "2026-10-10T00:00", "allDay": True}]    # all-day ignored
    free = g.free_blocks(evs, day)
    assert [(f["start"][11:], f["end"][11:]) for f in free] == [("08:00", "10:00"), ("12:00", "23:00")]


def test_study_blocks_and_ics_export(tmp_path):
    cal = g.Calendar(tmp_path / "cal.json")
    start = datetime.now() + timedelta(hours=1)          # after 23:00 that is tomorrow: ask for its day
    b = cal.add_block("VLSI deep work", start.isoformat(timespec="minutes"), 90)
    assert any(e.get("id") == b["id"] for e in cal.today(start.date())["events"])
    ics = cal.block_ics(b["id"])
    assert "BEGIN:VEVENT" in ics and "SUMMARY:VLSI deep work" in ics
    with pytest.raises(ValueError):
        cal.add_block("x", datetime.now().isoformat(), 5)          # under 15 min
    with pytest.raises(ValueError):
        cal.set_feed("http://not-https.example/cal.ics")
    cal.remove_block(b["id"])
    assert not any(e.get("id") == b["id"] for e in cal.today(start.date())["events"])


def test_focus_guard_reports_a_shape():
    f = g.foreground()
    assert "supported" in f
    if f["supported"]:
        assert set(f) >= {"title", "exe", "distraction"}
