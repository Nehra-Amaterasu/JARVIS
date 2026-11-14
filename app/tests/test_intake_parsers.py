"""C01: the manual intake parsers (paste, calendar file, name match).

Every case is one row of a table so a person can read it. All titles are invented. "Today" in
the paste tables is Saturday 14 Nov 2026; the calendar tables use a local zone of Europe/Berlin
(UTC+1 in winter, UTC+2 from 28 Mar 2027), so every shift and every window can be checked by hand.
"""
from __future__ import annotations

import copy
from datetime import datetime, timezone
from zoneinfo import ZoneInfo

import pytest

from jarvis_app.ww_intake import match_name, parse_ics, parse_paste

BERLIN = ZoneInfo("Europe/Berlin")
NOW = datetime(2026, 11, 14, 10, 0)  # Saturday; naive on purpose: only its date is read
NOW_B = datetime(2026, 11, 14, 10, 0, tzinfo=BERLIN)


# ---------------------------------------------------------------- parse_paste

# line, title, date, time
PASTE_CLEAN = [
    ("Lab report 3 18 Nov", "Lab report 3", "2026-11-18", None),
    ("Lab report 3 - 18 Nov", "Lab report 3", "2026-11-18", None),
    ("Unit test 2, 18/11", "Unit test 2", "2026-11-18", None),
    ("Nov 18 Quiz 1", "Quiz 1", "2026-11-18", None),
    ("18 November 2026 Final viva", "Final viva", "2026-11-18", None),
    ("Project demo 18 Nov 2027", "Project demo", "2027-11-18", None),
    ("Assignment 4 Friday", "Assignment 4", "2026-11-20", None),
    ("Assignment 4 next Monday", "Assignment 4", "2026-11-16", None),
    ("Quiz tomorrow", "Quiz", "2026-11-15", None),
    ("Quiz today 5 pm", "Quiz", "2026-11-14", "17:00"),
    ("Quiz Saturday", "Quiz", "2026-11-14", None),
    ("Quiz next Saturday", "Quiz", "2026-11-21", None),
    ("Quiz this Friday", "Quiz", "2026-11-20", None),
    ("Lab 18 Nov 5pm", "Lab", "2026-11-18", "17:00"),
    ("Lab 18 Nov 5:30pm", "Lab", "2026-11-18", "17:30"),
    ("Lab 18 Nov 17:00", "Lab", "2026-11-18", "17:00"),
    ("Lab 18 Nov at 9 am", "Lab", "2026-11-18", "09:00"),
    ("Lab 18 Nov 12 am", "Lab", "2026-11-18", "00:00"),
    ("Lab 18 Nov 12 pm", "Lab", "2026-11-18", "12:00"),
    ("Lab 18 Nov 12:30 AM", "Lab", "2026-11-18", "00:30"),
    ("Lab 18 Nov 5 p.m.", "Lab", "2026-11-18", "17:00"),
    ("Lab 1 Nov", "Lab", "2027-11-01", None),          # already past: next year
    ("Lab 14 Nov", "Lab", "2026-11-14", None),         # today counts
    ("Lab 13 Nov", "Lab", "2027-11-13", None),         # yesterday does not
    ("Lab 29 Feb", "Lab", "2028-02-29", None),         # waits for a leap year
    ("Lab 31/12", "Lab", "2026-12-31", None),
    ("Lab 5 Jan", "Lab", "2027-01-05", None),
    ("Lab Jan 5th", "Lab", "2027-01-05", None),
    ("Lab 5th Jan", "Lab", "2027-01-05", None),
    ("Lab 5th of January", "Lab", "2027-01-05", None),
    ("Lab 18-11-2026", "Lab", "2026-11-18", None),
    ("Lab 18.11.2026", "Lab", "2026-11-18", None),
    ("Lab 2026-11-18", "Lab", "2026-11-18", None),
    ("Lab 18/11/26", "Lab", "2026-11-18", None),
    ("Lab Sept 3", "Lab", "2027-09-03", None),
    ("Lab Wed", "Lab", "2026-11-18", None),
    ("Lab Thurs 6pm", "Lab", "2026-11-19", "18:00"),
    ("Lab Friday 20 Nov", "Lab", "2026-11-20", None),  # the weekday is a label, not a title
    ("Lab day after tomorrow", "Lab", "2026-11-16", None),
    ("Lab tonight 8 pm", "Lab", "2026-11-14", "20:00"),
    ("Lab, due 20 Nov", "Lab", "2026-11-20", None),
    ("Lab due by 20 Nov", "Lab", "2026-11-20", None),
    ("- Lab 20 Nov", "Lab", "2026-11-20", None),
    ("* Lab 20 Nov", "Lab", "2026-11-20", None),
    ("3) Lab 20 Nov", "Lab", "2026-11-20", None),
    ("Lab 3.5 report 20 Nov", "Lab 3.5 report", "2026-11-20", None),
    ("Chapter 3-4 quiz 20 Nov", "Chapter 3-4 quiz", "2026-11-20", None),
    ("Lab 20 NOV", "Lab", "2026-11-20", None),
    ("Month-end report Friday", "Month-end report", "2026-11-20", None),
    ("Lab 11/11", "Lab", "2027-11-11", None),          # same day both ways: not ambiguous
    ("Lab 13/11", "Lab", "2027-11-13", None),          # no month 13: day first only
    ("Lab 11/13", "Lab", "2027-11-13", None),          # no day-first reading (month 13)
    ("Lab 20 Nov 2026 9:15", "Lab", "2026-11-20", "09:15"),
    ("Lab at 5 pm on 20 Nov", "Lab", "2026-11-20", "17:00"),
]


@pytest.mark.parametrize("line,title,day,clock", PASTE_CLEAN, ids=[r[0] for r in PASTE_CLEAN])
def test_paste_clean_lines(line, title, day, clock):
    r = parse_paste(line, NOW)
    assert r["unread"] == []
    (it,) = r["items"]
    assert (it["title"], it["date"], it["time"]) == (title, day, clock)
    assert it["ambiguous"] is False and it["reason"] is None
    assert [x["date"] for x in it["readings"]] == [day]
    assert it["line"] == 1


# line, readings (day first, then month first), time
PASTE_AMBIGUOUS = [
    ("Lab 03/04", ["2027-04-03", "2027-03-04"], None),
    ("Lab 05/06 5pm", ["2027-06-05", "2027-05-06"], "17:00"),
    ("Lab 03/04/2027", ["2027-04-03", "2027-03-04"], None),
    ("Lab 03-04-26", ["2026-04-03", "2026-03-04"], None),
    ("Lab 12/11", ["2027-11-12", "2026-12-11"], None),
    ("Lab 01.02.2027", ["2027-02-01", "2027-01-02"], None),
]


@pytest.mark.parametrize("line,readings,clock", PASTE_AMBIGUOUS, ids=[r[0] for r in PASTE_AMBIGUOUS])
def test_paste_ambiguous_dates_are_returned_both_ways_and_never_guessed(line, readings, clock):
    (it,) = parse_paste(line, NOW)["items"]
    assert it["ambiguous"] is True
    assert it["date"] is None                      # never resolved by a guess
    assert [x["date"] for x in it["readings"]] == readings
    assert [x["order"] for x in it["readings"]] == ["day-month", "month-day"]
    assert it["time"] == clock and it["title"] == "Lab"
    assert it["reason"]


PASTE_NO_DATE = [
    ("Bring calculator", "Bring calculator", None),
    ("Bring calculator 5 pm", "Bring calculator", "17:00"),
    ("Read chapter 3.5", "Read chapter 3.5", None),
]


@pytest.mark.parametrize("line,title,clock", PASTE_NO_DATE, ids=[r[0] for r in PASTE_NO_DATE])
def test_paste_line_without_a_date_is_kept_with_a_reason(line, title, clock):
    r = parse_paste(line, NOW)
    (it,) = r["items"]
    assert it["date"] is None and it["readings"] == [] and it["ambiguous"] is False
    assert (it["title"], it["time"]) == (title, clock)
    assert "no date" in it["reason"].lower()
    assert r["unread"] == []


PASTE_UNREAD = [
    ("20 Nov", "title"),
    ("Friday", "title"),
    ("Lab 31/02", "real date"),
    ("Lab 31 Nov", "real date"),
    ("Lab Feb 30", "real date"),
    ("Lab 20 Nov 25:00", "time"),
    ("Lab 20 Nov 13 pm", "time"),
    ("Lab 20 Nov 0 am", "time"),
    ("Lab 2026-13-40", "real date"),
]


@pytest.mark.parametrize("line,word", PASTE_UNREAD, ids=[r[0] for r in PASTE_UNREAD])
def test_paste_unreadable_line_goes_to_unread_with_its_line_number(line, word):
    r = parse_paste("first line 20 Nov\n" + line, NOW)
    assert [i["title"] for i in r["items"]] == ["first line"]
    (u,) = r["unread"]
    assert u["line"] == 2 and u["raw"] == line and word in u["reason"]


def test_paste_blank_lines_count_for_line_numbers_and_are_not_items():
    r = parse_paste("Lab 20 Nov\n\n   \r\nQuiz 21 Nov\r\n", NOW)
    assert [(i["line"], i["title"], i["date"]) for i in r["items"]] == [
        (1, "Lab", "2026-11-20"), (4, "Quiz", "2026-11-21")]
    assert r["today"] == "2026-11-14"


def test_paste_empty_input():
    assert parse_paste("", NOW) == {"today": "2026-11-14", "items": [], "unread": []}
    assert parse_paste("  \n\n", NOW)["items"] == []


def test_paste_resolves_against_now_argument_only():
    # The same line against two different "now" values must follow the argument, never the system clock.
    assert parse_paste("Lab 18 Nov", datetime(2020, 1, 1))["items"][0]["date"] == "2020-11-18"
    assert parse_paste("Lab 18 Nov", datetime(2031, 12, 1))["items"][0]["date"] == "2032-11-18"
    # next Monday on a Monday is 7 days away, a bare Monday is today
    mon = datetime(2026, 11, 16, 8, 0)
    assert parse_paste("Lab next Monday", mon)["items"][0]["date"] == "2026-11-23"
    assert parse_paste("Lab Monday", mon)["items"][0]["date"] == "2026-11-16"


def test_paste_keeps_raw_text_and_only_the_first_date():
    (it,) = parse_paste("  Lab 20 Nov and 25 Nov  ", NOW)["items"]
    assert it["raw"] == "Lab 20 Nov and 25 Nov"
    assert it["date"] == "2026-11-20" and it["date_text"] == "20 Nov"
    assert "25 Nov" in it["title"]


def test_paste_mixed_text_keeps_order():
    text = "Lab 20 Nov\nno date here\nQuiz 03/04\n31/02 broken"
    r = parse_paste(text, NOW)
    assert [i["line"] for i in r["items"]] == [1, 2, 3]
    assert [u["line"] for u in r["unread"]] == [4]
    assert r["items"][2]["ambiguous"] is True


# ---------------------------------------------------------------- parse_ics

def cal(*events: str) -> str:
    return "\r\n".join(["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//test//EN",
                        *events, "END:VCALENDAR", ""])


def vev(*lines: str) -> str:
    return "\r\n".join(["BEGIN:VEVENT", *lines, "END:VEVENT"])


def starts(evs):
    return [e["start"] for e in evs]


# id, event lines, expected start list, subset of the first event
ICS_SINGLE = [
    ("utc", ["SUMMARY:Lab report 3", "DTSTART:20261120T090000Z", "DTEND:20261120T110000Z"],
     ["2026-11-20T10:00:00+01:00"],
     {"end": "2026-11-20T12:00:00+01:00", "original_zone": "UTC", "local_date": "2026-11-20",
      "summary": "Lab report 3", "repeats": "none", "all_day": False, "status": "ok"}),
    ("utc-shift-across-midnight-forward", ["SUMMARY:Late lab", "DTSTART:20261120T233000Z"],
     ["2026-11-21T00:30:00+01:00"], {"local_date": "2026-11-21", "end": None}),
    ("newyork-shift-across-midnight",
     ["SUMMARY:Evening class", "DTSTART;TZID=America/New_York:20261120T210000"],
     ["2026-11-21T03:00:00+01:00"],
     {"local_date": "2026-11-21", "original_zone": "America/New_York"}),
    ("kolkata-shift-back-across-midnight",
     ["SUMMARY:Early class", "DTSTART;TZID=Asia/Kolkata:20261121T020000"],
     ["2026-11-20T21:30:00+01:00"],
     {"local_date": "2026-11-20", "original_zone": "Asia/Kolkata"}),
    ("tzid-same-as-local", ["SUMMARY:Seminar", "DTSTART;TZID=Europe/Berlin:20261120T090000"],
     ["2026-11-20T09:00:00+01:00"], {"original_zone": "Europe/Berlin"}),
    ("tzid-quoted", ['SUMMARY:Seminar', 'DTSTART;TZID="America/New_York":20261120T090000'],
     ["2026-11-20T15:00:00+01:00"], {"original_zone": "America/New_York"}),
    ("floating", ["SUMMARY:Seminar", "DTSTART:20261120T090000"],
     ["2026-11-20T09:00:00+01:00"], {"original_zone": "floating", "notes": []}),
    ("unknown-tzid-kept-as-floating", ["SUMMARY:Seminar", "DTSTART;TZID=Mars/Olympus:20261120T090000"],
     ["2026-11-20T09:00:00+01:00"],
     {"original_zone": "Mars/Olympus", "status": "ok"}),
    ("windows-tzid-is-unknown", ["SUMMARY:Seminar", "DTSTART;TZID=W. Europe Standard Time:20261120T090000"],
     ["2026-11-20T09:00:00+01:00"], {"original_zone": "W. Europe Standard Time"}),
    ("all-day", ["SUMMARY:Holiday", "DTSTART;VALUE=DATE:20261120"],
     ["2026-11-20T00:00:00+01:00"],
     {"all_day": True, "end": "2026-11-21T00:00:00+01:00", "local_date": "2026-11-20",
      "original_zone": "date"}),
    ("all-day-with-end", ["SUMMARY:Break", "DTSTART;VALUE=DATE:20261120", "DTEND;VALUE=DATE:20261123"],
     ["2026-11-20T00:00:00+01:00"], {"all_day": True, "end": "2026-11-23T00:00:00+01:00"}),
    ("all-day-without-value-param", ["SUMMARY:Holiday", "DTSTART:20261120"],
     ["2026-11-20T00:00:00+01:00"], {"all_day": True}),
    ("explicit-date-time-value", ["SUMMARY:Seminar", "DTSTART;VALUE=DATE-TIME:20261120T090000Z"],
     ["2026-11-20T10:00:00+01:00"], {"all_day": False}),
    ("no-seconds", ["SUMMARY:Seminar", "DTSTART:20261120T0900Z"],
     ["2026-11-20T10:00:00+01:00"], {}),
    ("folded-space", ["SUMMARY:Unit te", " st 2", "DTSTART:20261120T090000Z"],
     ["2026-11-20T10:00:00+01:00"], {"summary": "Unit test 2"}),
    ("folded-tab-and-many-folds", ["DESCRIPTION:one\\, tw", "\to\\, thr", " ee", "SUMMARY:S",
                                   "DTSTART:20261120T090000Z"],
     ["2026-11-20T10:00:00+01:00"], {"description": "one, two, three"}),
    ("escapes", ["SUMMARY:Lab\\, part 1\\; room B", "DESCRIPTION:Line one\\nLine two\\NThree\\\\end",
                 "DTSTART:20261120T090000Z"],
     ["2026-11-20T10:00:00+01:00"],
     {"summary": "Lab, part 1; room B", "description": "Line one\nLine two\nThree\\end"}),
    ("backslash-then-n-is-not-a-newline", ["SUMMARY:a\\\\nb", "DTSTART:20261120T090000Z"],
     ["2026-11-20T10:00:00+01:00"], {"summary": "a\\nb"}),
    ("colon-in-value", ["SUMMARY:Lab", "LOCATION:Room 4: Block B", "DTSTART:20261120T090000Z"],
     ["2026-11-20T10:00:00+01:00"], {"location": "Room 4: Block B"}),
    ("uid-kept", ["UID:abc-123@example.invalid", "SUMMARY:Lab", "DTSTART:20261120T090000Z"],
     ["2026-11-20T10:00:00+01:00"], {"uid": "abc-123@example.invalid"}),
    ("no-uid", ["SUMMARY:Lab", "DTSTART:20261120T090000Z"],
     ["2026-11-20T10:00:00+01:00"], {"uid": ""}),
    ("duration", ["SUMMARY:Lab", "DTSTART:20261120T090000Z", "DURATION:PT90M"],
     ["2026-11-20T10:00:00+01:00"], {"end": "2026-11-20T11:30:00+01:00"}),
    ("duration-days-and-hours", ["SUMMARY:Lab", "DTSTART:20261120T090000Z", "DURATION:P1DT2H"],
     ["2026-11-20T10:00:00+01:00"], {"end": "2026-11-21T12:00:00+01:00"}),
    ("dtend-in-other-zone", ["SUMMARY:Lab", "DTSTART:20261120T090000Z",
                             "DTEND;TZID=America/New_York:20261120T050000"],
     ["2026-11-20T10:00:00+01:00"], {"end": "2026-11-20T11:00:00+01:00"}),
    ("missing-summary-is-kept-with-a-note", ["DTSTART:20261120T090000Z"],
     ["2026-11-20T10:00:00+01:00"], {"summary": "", "status": "ok"}),
    ("end-before-start-is-noted", ["SUMMARY:Lab", "DTSTART:20261120T090000Z", "DTEND:20261120T080000Z"],
     ["2026-11-20T10:00:00+01:00"], {"status": "ok"}),
    ("due-field", ["SUMMARY:Report", "DTSTART:20261120T090000Z", "DUE:20261125T170000Z"],
     ["2026-11-20T10:00:00+01:00"], {"due": "2026-11-25T18:00:00+01:00"}),
    ("start-from-due", ["SUMMARY:Report", "DUE:20261125T170000Z"],
     ["2026-11-25T18:00:00+01:00"], {"due": "2026-11-25T18:00:00+01:00"}),
    ("alarm-does-not-overwrite", ["SUMMARY:Lab", "DESCRIPTION:real", "DTSTART:20261120T090000Z",
                                  "BEGIN:VALARM", "ACTION:DISPLAY", "DESCRIPTION:alarm text",
                                  "TRIGGER:-PT15M", "END:VALARM"],
     ["2026-11-20T10:00:00+01:00"], {"description": "real"}),
    ("lower-case-property-names", ["summary:Lab", "dtstart:20261120T090000Z"],
     ["2026-11-20T10:00:00+01:00"], {"summary": "Lab"}),
    ("past-event-is-still-returned", ["SUMMARY:Old", "DTSTART:20250101T090000Z"],
     ["2025-01-01T10:00:00+01:00"], {"repeats": "none"}),
    ("dst-summer-offset", ["SUMMARY:Summer", "DTSTART:20270601T090000Z"],
     ["2027-06-01T11:00:00+02:00"], {"local_date": "2027-06-01"}),
]


@pytest.mark.parametrize("name,lines,want,first", ICS_SINGLE, ids=[r[0] for r in ICS_SINGLE])
def test_ics_single_events(name, lines, want, first):
    evs = parse_ics(cal(vev(*lines)), NOW_B)
    assert starts(evs) == want
    for k, v in first.items():
        assert evs[0][k] == v, k


def test_ics_notes_say_what_happened():
    unknown = parse_ics(cal(vev("SUMMARY:S", "DTSTART;TZID=Mars/Olympus:20261120T090000")), NOW_B)[0]
    assert any("Mars/Olympus" in n for n in unknown["notes"])
    nosum = parse_ics(cal(vev("DTSTART:20261120T090000Z")), NOW_B)[0]
    assert any("SUMMARY" in n for n in nosum["notes"])
    rev = parse_ics(cal(vev("SUMMARY:S", "DTSTART:20261120T090000Z", "DTEND:20261120T080000Z")), NOW_B)[0]
    assert any("before" in n for n in rev["notes"])


ICS_SKIPPED = [
    ("no-dtstart", ["SUMMARY:Lab"], "DTSTART"),
    ("bad-month", ["SUMMARY:Lab", "DTSTART:20261340T000000Z"], "DTSTART"),
    ("not-a-date", ["SUMMARY:Lab", "DTSTART:tomorrow"], "DTSTART"),
    ("bad-hour", ["SUMMARY:Lab", "DTSTART:20261120T250000Z"], "DTSTART"),
    ("empty-dtstart", ["SUMMARY:Lab", "DTSTART:"], "DTSTART"),
    ("bad-date-value", ["SUMMARY:Lab", "DTSTART;VALUE=DATE:2026-11-20"], "DTSTART"),
]


@pytest.mark.parametrize("name,lines,word", ICS_SKIPPED, ids=[r[0] for r in ICS_SKIPPED])
def test_ics_malformed_event_is_skipped_with_a_note_and_never_raises(name, lines, word):
    good = vev("SUMMARY:Fine", "DTSTART:20261121T090000Z")
    evs = parse_ics(cal(vev("SUMMARY:First", "DTSTART:20261119T090000Z"), vev(*lines), good), NOW_B)
    assert [e["status"] for e in evs] == ["ok", "skipped", "ok"]   # file order is kept
    bad = evs[1]
    assert bad["start"] is None and bad["end"] is None and bad["local_date"] is None
    assert word in bad["notes"][0]


def test_ics_unterminated_event_is_skipped():
    text = "BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nSUMMARY:Cut off\r\nDTSTART:20261120T090000Z\r\n"
    evs = parse_ics(text, NOW_B)
    assert [e["status"] for e in evs] == ["skipped"] and "END:VEVENT" in evs[0]["notes"][0]


def test_ics_event_opened_twice_skips_the_first():
    text = cal("BEGIN:VEVENT", "SUMMARY:Lost", vev("SUMMARY:Kept", "DTSTART:20261120T090000Z"))
    evs = parse_ics(text, NOW_B)
    assert [(e["summary"], e["status"]) for e in evs] == [("Lost", "skipped"), ("Kept", "ok")]


@pytest.mark.parametrize("text", ["", "   \n", "garbage", "BEGIN:VCALENDAR\r\nEND:VCALENDAR\r\n",
                                  "BEGIN:VEVENT", "END:VEVENT\r\nEND:VEVENT", ":::\r\n;;;\r\n"])
def test_ics_junk_gives_a_list_not_an_exception(text):
    assert isinstance(parse_ics(text, NOW_B), list)


def test_ics_line_endings_lf_and_cr_are_read_like_crlf():
    body = vev("SUMMARY:Lab", "DTSTART:20261120T090000Z")
    for ending in ("\n", "\r"):
        evs = parse_ics(cal(body).replace("\r\n", ending), NOW_B)
        assert starts(evs) == ["2026-11-20T10:00:00+01:00"]


def test_ics_naive_now_is_taken_as_utc_and_utc_now_works():
    body = cal(vev("SUMMARY:Lab", "DTSTART:20261120T233000Z"))
    assert starts(parse_ics(body, NOW)) == ["2026-11-20T23:30:00+00:00"]
    assert starts(parse_ics(body, datetime(2026, 11, 14, tzinfo=timezone.utc))) == ["2026-11-20T23:30:00+00:00"]


# id, event lines, now, horizon, expected starts
BERLIN_SUMMER_NOW = datetime(2027, 3, 20, 10, 0, tzinfo=BERLIN)
ICS_REPEAT = [
    ("weekly-count-3", ["DTSTART:20261116T080000Z", "RRULE:FREQ=WEEKLY;COUNT=3"], NOW_B, 120,
     ["2026-11-16T09:00:00+01:00", "2026-11-23T09:00:00+01:00", "2026-11-30T09:00:00+01:00"]),
    ("weekly-until-datetime-is-inclusive",
     ["DTSTART:20261116T080000Z", "RRULE:FREQ=WEEKLY;UNTIL=20261207T080000Z"], NOW_B, 120,
     ["2026-11-16T09:00:00+01:00", "2026-11-23T09:00:00+01:00", "2026-11-30T09:00:00+01:00",
      "2026-12-07T09:00:00+01:00"]),
    ("weekly-until-one-second-early-drops-the-last",
     ["DTSTART:20261116T080000Z", "RRULE:FREQ=WEEKLY;UNTIL=20261207T075959Z"], NOW_B, 120,
     ["2026-11-16T09:00:00+01:00", "2026-11-23T09:00:00+01:00", "2026-11-30T09:00:00+01:00"]),
    ("weekly-until-date-is-inclusive",
     ["DTSTART:20261116T080000Z", "RRULE:FREQ=WEEKLY;UNTIL=20261207"], NOW_B, 120,
     ["2026-11-16T09:00:00+01:00", "2026-11-23T09:00:00+01:00", "2026-11-30T09:00:00+01:00",
      "2026-12-07T09:00:00+01:00"]),
    ("weekly-until-floating-in-event-zone",
     ["DTSTART;TZID=Europe/Berlin:20261116T090000", "RRULE:FREQ=WEEKLY;UNTIL=20261123T090000"], NOW_B, 120,
     ["2026-11-16T09:00:00+01:00", "2026-11-23T09:00:00+01:00"]),
    ("weekly-interval-2",
     ["DTSTART:20261116T080000Z", "RRULE:FREQ=WEEKLY;INTERVAL=2;COUNT=3"], NOW_B, 120,
     ["2026-11-16T09:00:00+01:00", "2026-11-30T09:00:00+01:00", "2026-12-14T09:00:00+01:00"]),
    ("weekly-byday-three-days",
     ["DTSTART:20261116T080000Z", "RRULE:FREQ=WEEKLY;BYDAY=MO,WE,FR;COUNT=5"], NOW_B, 120,
     ["2026-11-16T09:00:00+01:00", "2026-11-18T09:00:00+01:00", "2026-11-20T09:00:00+01:00",
      "2026-11-23T09:00:00+01:00", "2026-11-25T09:00:00+01:00"]),
    ("weekly-byday-earlier-days-of-first-week-are-skipped",
     ["DTSTART:20261118T080000Z", "RRULE:FREQ=WEEKLY;BYDAY=MO,WE;COUNT=3"], NOW_B, 120,
     ["2026-11-18T09:00:00+01:00", "2026-11-23T09:00:00+01:00", "2026-11-25T09:00:00+01:00"]),
    ("weekly-wkst-monday-rfc-example",
     ["DTSTART:20261116T080000Z", "RRULE:FREQ=WEEKLY;INTERVAL=2;COUNT=3;BYDAY=SU,MO;WKST=MO"], NOW_B, 120,
     ["2026-11-16T09:00:00+01:00", "2026-11-22T09:00:00+01:00", "2026-11-30T09:00:00+01:00"]),
    ("weekly-wkst-sunday-rfc-example",
     ["DTSTART:20261116T080000Z", "RRULE:FREQ=WEEKLY;INTERVAL=2;COUNT=3;BYDAY=SU,MO;WKST=SU"], NOW_B, 120,
     ["2026-11-16T09:00:00+01:00", "2026-11-29T09:00:00+01:00", "2026-11-30T09:00:00+01:00"]),
    ("daily-count-3-includes-earlier-today",
     ["DTSTART:20261114T080000Z", "RRULE:FREQ=DAILY;COUNT=3"], NOW_B, 120,
     ["2026-11-14T09:00:00+01:00", "2026-11-15T09:00:00+01:00", "2026-11-16T09:00:00+01:00"]),
    ("daily-interval-3-count-4",
     ["DTSTART:20261114T080000Z", "RRULE:FREQ=DAILY;INTERVAL=3;COUNT=4"], NOW_B, 120,
     ["2026-11-14T09:00:00+01:00", "2026-11-17T09:00:00+01:00", "2026-11-20T09:00:00+01:00",
      "2026-11-23T09:00:00+01:00"]),
    ("daily-until",
     ["DTSTART:20261114T080000Z", "RRULE:FREQ=DAILY;UNTIL=20261118T080000Z"], NOW_B, 120,
     ["2026-11-14T09:00:00+01:00", "2026-11-15T09:00:00+01:00", "2026-11-16T09:00:00+01:00",
      "2026-11-17T09:00:00+01:00", "2026-11-18T09:00:00+01:00"]),
    ("daily-horizon-5-days-includes-both-ends",
     ["DTSTART:20261114T080000Z", "RRULE:FREQ=DAILY"], NOW_B, 5,
     [f"2026-11-{d}T09:00:00+01:00" for d in (14, 15, 16, 17, 18, 19)]),
    ("daily-horizon-0-is-today-only",
     ["DTSTART:20261114T080000Z", "RRULE:FREQ=DAILY"], NOW_B, 0, ["2026-11-14T09:00:00+01:00"]),
    ("count-and-until-stop-at-the-earlier",
     ["DTSTART:20261116T080000Z", "RRULE:FREQ=WEEKLY;COUNT=10;UNTIL=20261124T000000Z"], NOW_B, 120,
     ["2026-11-16T09:00:00+01:00", "2026-11-23T09:00:00+01:00"]),
    ("count-used-up-in-the-past-gives-nothing",
     ["DTSTART:20260101T080000Z", "RRULE:FREQ=WEEKLY;COUNT=3"], NOW_B, 120, []),
    ("count-crossing-today-keeps-only-the-tail",
     ["DTSTART:20261026T080000Z", "RRULE:FREQ=WEEKLY;COUNT=4"], NOW_B, 120,
     ["2026-11-16T09:00:00+01:00"]),
    ("started-long-ago-no-end",
     ["DTSTART:20250105T080000Z", "RRULE:FREQ=WEEKLY"], NOW_B, 14,
     ["2026-11-15T09:00:00+01:00", "2026-11-22T09:00:00+01:00"]),
    ("tzid-weekly-keeps-wall-clock-across-dst",
     ["DTSTART;TZID=Europe/Berlin:20261026T090000", "RRULE:FREQ=WEEKLY"], BERLIN_SUMMER_NOW, 14,
     ["2027-03-22T09:00:00+01:00", "2027-03-29T09:00:00+02:00"]),
    ("utc-weekly-follows-utc-across-dst",
     ["DTSTART:20261026T080000Z", "RRULE:FREQ=WEEKLY"], BERLIN_SUMMER_NOW, 14,
     ["2027-03-22T09:00:00+01:00", "2027-03-29T10:00:00+02:00"]),
    ("exdate-removes-an-occurrence",
     ["DTSTART:20261116T080000Z", "RRULE:FREQ=WEEKLY;COUNT=3", "EXDATE:20261123T080000Z"], NOW_B, 120,
     ["2026-11-16T09:00:00+01:00", "2026-11-30T09:00:00+01:00"]),
    ("exdate-list-and-tzid",
     ["DTSTART;TZID=Europe/Berlin:20261116T090000", "RRULE:FREQ=WEEKLY;COUNT=4",
      "EXDATE;TZID=Europe/Berlin:20261123T090000,20261207T090000"], NOW_B, 120,
     ["2026-11-16T09:00:00+01:00", "2026-11-30T09:00:00+01:00"]),
    ("repeat-shifts-across-local-midnight",
     ["DTSTART;TZID=America/New_York:20261120T210000", "RRULE:FREQ=WEEKLY;COUNT=2"], NOW_B, 120,
     ["2026-11-21T03:00:00+01:00", "2026-11-28T03:00:00+01:00"]),
    ("all-day-weekly",
     ["DTSTART;VALUE=DATE:20261116", "RRULE:FREQ=WEEKLY;COUNT=2"], NOW_B, 120,
     ["2026-11-16T00:00:00+01:00", "2026-11-23T00:00:00+01:00"]),
    ("weekly-window-edge-is-inclusive",
     ["DTSTART:20261116T080000Z", "RRULE:FREQ=WEEKLY"], NOW_B, 9,
     ["2026-11-16T09:00:00+01:00", "2026-11-23T09:00:00+01:00"]),
]


@pytest.mark.parametrize("name,lines,now,horizon,want", ICS_REPEAT, ids=[r[0] for r in ICS_REPEAT])
def test_ics_repeats_are_expanded_inside_the_window(name, lines, now, horizon, want):
    evs = parse_ics(cal(vev("SUMMARY:Unit test 2", "UID:u1", *lines)), now, horizon)
    assert starts(evs) == want
    assert [e["occurrence"] for e in evs] == list(range(len(want)))
    assert all(e["repeats"] == "expanded" and e["uid"] == "u1" for e in evs)


def test_ics_default_horizon_is_120_days_and_weekly_gives_17_mondays():
    evs = parse_ics(cal(vev("SUMMARY:Lab", "DTSTART:20261116T080000Z", "RRULE:FREQ=WEEKLY")), NOW_B)
    # Monday 16 Nov 2026 to Monday 8 Mar 2027 is 112 days, so 17 occurrences before 14 Mar 2027.
    assert len(evs) == 17 and evs[-1]["start"] == "2027-03-08T09:00:00+01:00"


def test_ics_expanded_occurrences_keep_their_length():
    evs = parse_ics(cal(vev("SUMMARY:Lab", "DTSTART:20261116T080000Z", "DTEND:20261116T093000Z",
                            "RRULE:FREQ=WEEKLY;COUNT=2")), NOW_B)
    assert [(e["start"], e["end"]) for e in evs] == [
        ("2026-11-16T09:00:00+01:00", "2026-11-16T10:30:00+01:00"),
        ("2026-11-23T09:00:00+01:00", "2026-11-23T10:30:00+01:00")]


def test_ics_local_date_follows_the_local_day_for_every_occurrence():
    evs = parse_ics(cal(vev("SUMMARY:Lab", "DTSTART:20261120T233000Z", "RRULE:FREQ=DAILY;COUNT=2")), NOW_B)
    assert [e["local_date"] for e in evs] == ["2026-11-21", "2026-11-22"]


ICS_NOT_EXPANDED = [
    ("monthly", "FREQ=MONTHLY;COUNT=3"),
    ("yearly", "FREQ=YEARLY"),
    ("hourly", "FREQ=HOURLY;COUNT=5"),
    ("daily-with-byday", "FREQ=DAILY;BYDAY=MO,TU"),
    ("weekly-with-bymonth", "FREQ=WEEKLY;BYMONTH=11"),
    ("weekly-with-ordinal-byday", "FREQ=WEEKLY;BYDAY=1MO"),
    ("weekly-with-bysetpos", "FREQ=WEEKLY;BYDAY=MO,TU;BYSETPOS=1"),
    ("interval-zero", "FREQ=WEEKLY;INTERVAL=0"),
    ("interval-text", "FREQ=WEEKLY;INTERVAL=two"),
    ("count-zero", "FREQ=DAILY;COUNT=0"),
    ("no-freq", "COUNT=3"),
    ("garbage", "this is not a rule"),
]


@pytest.mark.parametrize("name,rule", ICS_NOT_EXPANDED, ids=[r[0] for r in ICS_NOT_EXPANDED])
def test_ics_other_rules_are_returned_once_as_not_expanded(name, rule):
    evs = parse_ics(cal(vev("SUMMARY:Lab", "DTSTART:20261116T080000Z", "RRULE:" + rule)), NOW_B)
    assert len(evs) == 1
    assert evs[0]["repeats"] == "not expanded" and evs[0]["rrule"] == rule
    assert evs[0]["start"] == "2026-11-16T09:00:00+01:00" and evs[0]["status"] == "ok"
    assert any("not expanded" in n.lower() for n in evs[0]["notes"])


def test_ics_event_without_repeat_has_repeats_none_and_no_rrule():
    (e,) = parse_ics(cal(vev("SUMMARY:Lab", "DTSTART:20261116T080000Z")), NOW_B)
    assert e["repeats"] == "none" and e["rrule"] is None and e["occurrence"] == 0


def test_ics_huge_count_cannot_freeze_the_parser():
    evs = parse_ics(cal(vev("SUMMARY:Lab", "DTSTART:19700101T080000Z",
                            "RRULE:FREQ=WEEKLY;COUNT=99999999")), NOW_B, 14)
    assert len(evs) == 2   # 14 days hold two Thursdays (the 1970 start day); the loop stopped on its cap or the window


def test_ics_is_pure_same_input_same_output_and_input_not_changed():
    text = cal(vev("SUMMARY:Lab", "DTSTART:20261116T080000Z", "RRULE:FREQ=WEEKLY;COUNT=3"),
               vev("SUMMARY:Broken"))
    before = copy.copy(text)
    a, b = parse_ics(text, NOW_B), parse_ics(text, NOW_B)
    assert a == b and text == before


# ---------------------------------------------------------------- match_name

MATCH = [
    ("Signals and Systems", "signals and systems", 1.0),
    ("Signals & Systems", "systems signals", 1.0),     # order and punctuation do not matter
    ("Signals and Systems", "Systems, Signals", 2 / 3),
    ("Unit test 2", "Unit test 3", 2 / 4),
    ("Lab", "Lab Lab Lab", 1.0),                       # repeats do not count twice
    ("Lab report", "Quiz", 0.0),
    ("", "Lab", 0.0),
    ("Lab", "", 0.0),
    ("", "", 0.0),
    ("   ", "!!!", 0.0),
    ("Maths-II", "maths ii", 1.0),
    ("a b c d", "a b", 0.5),
    ("a b c", "b c d", 2 / 4),
]


@pytest.mark.parametrize("a,b,want", MATCH, ids=[f"{r[0]!r}~{r[1]!r}" for r in MATCH])
def test_match_name_values(a, b, want):
    assert match_name(a, b) == pytest.approx(want)
    assert match_name(b, a) == pytest.approx(want)   # symmetric


def test_match_name_underscore_is_a_separator_not_a_letter():
    assert match_name("Unit_test", "unit test") == 1.0


@pytest.mark.parametrize("a,b", [("Signals", "Signals"), ("A b-c", "c B a"), ("x1 y2", "Y2 X1"),
                                 ("Matematik I", "matematik i")])
def test_match_name_equal_token_sets_give_one(a, b):
    assert match_name(a, b) == 1.0


@pytest.mark.parametrize("a,b", [("Signals", "Circuits"), ("one two", "three four"), ("", "x"), ("--", "..")])
def test_match_name_disjoint_or_empty_gives_zero(a, b):
    assert match_name(a, b) == 0.0


def test_match_name_stays_between_zero_and_one_and_is_symmetric_on_a_grid():
    names = ["", "Signals", "Signals and Systems", "Systems", "Unit test 2", "unit test", "x y z", "z y"]
    for a in names:
        for b in names:
            s = match_name(a, b)
            assert 0.0 <= s <= 1.0 and s == match_name(b, a)
