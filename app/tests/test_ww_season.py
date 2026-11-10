"""Season and evening (ww_season.py): pure, one answer for the desktop frame and the phone page.
Fictional dates only; the clock is always passed in, never read."""
from datetime import date, datetime, timedelta

from jarvis_app import routes_phone_ww
from jarvis_app import ww_season as S

TODAY = "2026-11-02"


def papers(*days_ahead):
    t = date.fromisoformat(TODAY)
    return [{"id": f"p{i}", "date": (t + timedelta(days=n)).isoformat()} for i, n in enumerate(days_ahead)]


def at(h):
    return datetime(2026, 11, 2, h, 0)


def test_nearest_ignores_past_and_undated_papers():
    ps = papers(-3, 12, 40) + [{"id": "x"}, {"id": "y", "date": "not a date"}]
    assert S.nearest_days(ps, TODAY) == 12
    assert S.nearest_days([], TODAY) is None


def test_the_window_edge_is_inclusive_at_45_days():
    assert S.season_of(45) == "exams"
    assert S.season_of(46) == "normal"
    assert S.season_of(None) == "normal"          # no dated paper ahead is normal season, not a crash


def test_an_explicit_mode_beats_the_dates_and_junk_reads_as_auto():
    assert S.season_of(3, mode="normal") == "normal"
    assert S.season_of(300, mode="exams") == "exams"
    assert S.season_state({"papers": papers(3)}, TODAY, at(9), mode="bogus")["mode"] == "auto"


def test_evening_starts_at_18_or_when_the_blocks_are_done():
    assert S.is_evening(17, False) == (False, None)
    assert S.is_evening(18, False) == (True, "clock")
    assert S.is_evening(10, True) == (True, "blocks_done")
    assert S.is_evening(19, True) == (True, "clock")


def test_blocks_done_needs_planned_slots_all_at_zero_minutes():
    day = lambda *m: {"days": [{"date": TODAY, "slots": [{"minutes": x, "blocks": [{}]} for x in m]}]}
    assert S.blocks_done_today(day(0), TODAY) is True
    assert S.blocks_done_today(day(0, 30), TODAY) is False
    assert S.blocks_done_today({"days": []}, TODAY) is False          # nothing planned is not "done"
    assert S.blocks_done_today({"days": [{"date": "2026-11-03", "slots": [{"minutes": 0}]}]}, TODAY) is False


def test_exam_season_state_reads_the_plan_wording():
    st = S.season_state({"papers": papers(10)}, TODAY, at(9))
    assert (st["season"], st["left_top"], st["opens"], st["due_soon_days"], st["findings_hidden"]) == ("exams", "countdown", "study", 3, True)
    assert st["evening"] is False and st["now_card"] == "now" and st["nearest_days"] == 10


def test_normal_season_state_and_evening_swap():
    st = S.season_state({"papers": papers(90)}, TODAY, at(18))
    assert (st["season"], st["left_top"], st["opens"], st["due_soon_days"], st["findings_hidden"]) == ("normal", "horizon", "life", 7, False)
    assert st["evening"] is True and st["evening_why"] == "clock" and st["now_card"] == "close_the_day"


def test_with_season_adds_the_key_and_survives_a_broken_engine():
    class Plan:
        def engine(self, name, today):
            return {"papers": papers(5), "days": []}
    out = S.with_season(Plan(), {"a": 1}, TODAY, at(9))
    assert out["a"] == 1 and out["season"]["season"] == "exams"

    class Broken:
        def engine(self, name, today):
            raise RuntimeError("bad input")
    assert S.with_season(Broken(), {"a": 1}, TODAY) == {"a": 1}


def test_the_phone_payload_carries_the_identical_season_dict():
    """Both pages read one function, so the phone cannot show a season the desktop would not."""
    class Plan:
        def engine(self, name, today):
            return {"papers": papers(20), "days": []} if name == "exams" else {"today": [], "subjects": [], "rule": None}
        def life_view(self, today):
            return {"counters": []}
    ex = {"papers": papers(20), "days": []}
    phone = routes_phone_ww.today_view(Plan(), today=TODAY, now=at(19))
    assert phone["season"] == S.season_state(ex, TODAY, at(19))
    assert phone["season"]["evening"] is True and phone["season"]["season"] == "exams"
