"""Reminders and times, parsed without the model (tools/when.py). `now` is fixed:
Monday 12 October 2026, 7 pm, so every expectation is exact."""
from datetime import datetime

import pytest

import room
from tools import when as W

NOW = datetime(2026, 10, 12, 19, 0)          # a Monday evening


def at(d, h, m=0):
    return datetime(2026, 10, d, h, m)


@pytest.mark.parametrize("text, kind, task, due, repeat, interval", [
    # the forms in the brief
    ("remind me at 9 to call mum", "reminder", "call mum", at(12, 21), None, None),
    ("medicine at 8 am every day", "reminder", "medicine", at(13, 8), "daily", None),
    ("timer for 10 minutes", "timer", "", at(12, 19, 10), None, None),
    # English
    ("remind me to call my mum at 9 pm", "reminder", "call my mum", at(12, 21), None, None),
    ("set a timer for 1 hour 30 minutes", "timer", "", at(12, 20, 30), None, None),
    ("remind me in 2 hours to check the oven", "reminder", "check the oven", at(12, 21), None, None),
    ("remind me in half an hour to drink water", "reminder", "drink water", at(12, 19, 30), None, None),
    ("remind me tomorrow at 7 to submit the form", "reminder", "submit the form", at(13, 7), None, None),
    ("remind me on Friday at 5 pm to pay rent", "reminder", "pay rent", at(16, 17), None, None),
    ("remind me on 25 October to renew the insurance", "reminder", "renew the insurance", at(25, 9), None, None),
    ("remind me every day at 9 pm to take my medicine", "reminder", "take my medicine", at(12, 21), "daily", None),
    ("remind me every 8 hours to take the antibiotic", "reminder", "take the antibiotic", at(13, 3), None, 480),
    ("remind me every Monday at 8 to take out the trash", "reminder", "take out the trash", at(19, 8), "weekly", None),
    ("remind me tonight at 10 to lock the door", "reminder", "lock the door", at(12, 22), None, None),
    ("remind me at 17:30 to leave", "reminder", "leave", at(13, 17, 30), None, None),
    ("remind me in 10 minutes to turn off the gas", "reminder", "turn off the gas", at(12, 19, 10), None, None),
    ("remember to call mum at 9", "reminder", "call mum", at(12, 21), None, None),
    ("gym at 6 every day", "reminder", "gym", at(13, 18), "daily", None),
    # Hinglish
    ("10 minute ka timer laga do", "timer", "", at(12, 19, 10), None, None),
    ("paanch minute ka timer laga do", "timer", "", at(12, 19, 5), None, None),
    ("har roz raat 10 baje dawai yaad dilana", "reminder", "dawai", at(12, 22), "daily", None),
    ("mujhe 5 baje yaad dilana ki doodh lena hai", "reminder", "doodh lena hai", at(13, 17), None, None),
    ("kal subah 7 baje yaad dilana ki form bharna hai", "reminder", "form bharna hai", at(13, 7), None, None),
    ("remind me saade 9 baje to sleep", "reminder", "sleep", at(12, 21, 30), None, None),
    ("remind me raat 2 baje to check", "reminder", "check", at(13, 2), None, None),
    # alarms: an early hour said in the evening is the morning
    ("wake me up at 6:30", "alarm", "", at(13, 6, 30), None, None),
    ("kal subah 6 baje utha dena", "alarm", "", at(13, 6), None, None),
    ("set an alarm for 6 am", "alarm", "", at(13, 6), None, None),
])
def test_reminders_parse(text, kind, task, due, repeat, interval):
    got = W.parse_reminder(text, NOW, room_parse=room.parse)
    assert got is not None and got.op == "create" and got.missing is None, got
    assert got.kind == kind
    assert got.text == task
    assert got.when.due == due
    assert got.when.repeat == repeat and got.when.interval_min == interval


@pytest.mark.parametrize("text, device, action, due", [
    ("turn off the fan in 30 minutes", "fan", "off", at(12, 19, 30)),
    ("fan band kar do 1 ghante baad", "fan", "off", at(12, 20)),
    ("switch off the light at 11 pm", "light", "off", at(12, 23)),
])
def test_a_switch_at_a_later_time_is_scheduled_not_done_now(text, device, action, due):
    got = W.parse_reminder(text, NOW, room_parse=room.parse)
    assert got.kind == "action" and got.action["device"] == device and got.action["action"] == action
    assert got.when.due == due


@pytest.mark.parametrize("text, op, kind, query, all_", [
    ("cancel the reminder to call mum", "cancel", "reminder", "call mum", False),
    ("cancel all reminders", "cancel", "reminder", "", True),
    ("stop the timer", "cancel", "timer", "", False),
    ("what reminders do I have", "list", "reminder", "", False),
    ("how much time is left on the timer", "list", "timer", "", False),
])
def test_cancel_and_list(text, op, kind, query, all_):
    got = W.parse_reminder(text, NOW)
    assert (got.op, got.kind, got.query, got.all) == (op, kind, query, all_)


@pytest.mark.parametrize("text", [
    "I wake up at 7 every day",            # a statement about him, not an instruction
    "light band kar do",                   # the room parser's job, now
    "turn off the light",
    "what time is it",
    "start a 50 minute focus on German",   # Mission Germoney
    "log 2 hours of German",
    "explain setup time",
    "",
])
def test_not_a_reminder(text):
    assert W.parse_reminder(text, NOW, room_parse=room.parse) is None


def test_no_time_means_ask_for_it():
    got = W.parse_reminder("remind me to call mum", NOW)
    assert got.missing == "time" and got.text == "call mum"
    # "this evening", said in the evening, is not 6 pm tomorrow: ask
    assert W.parse_reminder("remind me this evening to call dad", NOW).missing == "time"


def test_a_time_alone_answers_when():
    assert W.time_only("at 9", NOW).due == at(12, 21)
    assert W.time_only("kal subah 7 baje", NOW).due == at(13, 7)
    assert W.time_only("call mum at 9", NOW) is None


@pytest.mark.parametrize("phrase, now, due", [
    ("at 9", at(12, 8), at(12, 9)),                # morning: 9 am is next
    ("at 9", at(12, 19), at(12, 21)),              # evening: 9 pm is next
    ("at 9", at(12, 22), at(13, 9)),               # night: tomorrow morning
    ("5 baje", at(12, 19), at(13, 17)),            # both gone today: 5 pm tomorrow, not 5 am
    ("at 2", at(12, 19), at(13, 14)),
    ("tomorrow at 3", at(12, 19), at(13, 15)),     # a day and 1–6: afternoon
    ("tomorrow at 9", at(12, 19), at(13, 9)),      # a day and 7–11: morning
    ("shaam 6 baje", at(12, 10), at(12, 18)),
    ("dopahar 2 baje", at(12, 10), at(12, 14)),
    ("next week", at(12, 19), at(19, 9)),
    ("in 3 days", at(12, 19), at(15, 19)),
    ("paune 8 baje", at(12, 19), at(12, 19, 45)),
    ("sawa 9 baje", at(12, 19), at(12, 21, 15)),
    ("dedh baje", at(12, 10), at(12, 13, 30)),
    ("25/12", at(12, 19), datetime(2026, 12, 25, 9)),
    ("on the 5th", at(12, 19), datetime(2026, 11, 5, 9)),   # this month's 5th has gone
])
def test_time_phrases(phrase, now, due):
    assert W.parse_when(phrase, now).due == due


def test_durations():
    assert W.find_duration("an hour and a half")[0] == 5400
    assert W.find_duration("dedh ghanta")[0] == 5400
    assert W.find_duration("aadha ghanta")[0] == 1800
    assert W.find_duration("2h 15min")[0] == 8100
    assert W.find_duration("45 seconds")[0] == 45
    assert W.find_duration("no time at all") is None


def test_repeats_move_to_their_next_time():
    d = at(12, 8)
    assert W.next_occurrence(d, "daily", None, at(12, 9)) == at(13, 8)
    assert W.next_occurrence(d, "daily", None, at(15, 9)) == at(16, 8)      # missed days: once, next future
    assert W.next_occurrence(d, "weekly", None, at(12, 9)) == at(19, 8)
    assert W.next_occurrence(d, None, 480, at(12, 9)) == at(12, 16)
    fri = datetime(2026, 10, 16, 8)
    assert W.next_occurrence(fri, "weekdays", None, datetime(2026, 10, 16, 9)) == datetime(2026, 10, 19, 8)
    assert W.next_occurrence(d, None, None, at(12, 9)) is None


def test_times_are_said_back_the_way_people_say_them():
    assert W.fmt_due(at(12, 21), NOW) == "9 pm today"
    assert W.fmt_due(at(13, 6, 30), NOW) == "6:30 am tomorrow"
    assert W.fmt_due(at(16, 17), NOW) == "5 pm on Friday"
    assert W.fmt_due(at(25, 9), NOW) == "9 am on 25 October"
    assert W.fmt_clock(at(12, 12)) == "12 noon" and W.fmt_clock(at(13, 0)) == "midnight"
    assert W.fmt_repeat("daily", None, at(13, 8)) == "every day at 8 am"
    assert W.fmt_repeat(None, 480, at(13, 8)) == "every 8 hours"
    assert W.fmt_span(5400) == "1 hour 30 minutes" and W.fmt_span(45) == "45 seconds"
    assert W.second_person("call my mum and tell me") == "call your mum and tell you"
