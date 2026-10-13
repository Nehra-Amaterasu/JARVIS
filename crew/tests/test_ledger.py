"""The task ledger on a scratch transcript folder of synthetic requests (English and
romanised Hinglish): the rules, the ranking, the candidates, and that no request text
ever leaves the transcripts."""
import json
from datetime import datetime

import pytest

from crew.agents.ledger import WINDOW_DAYS, TaskLedger, classify, read_requests

NOW = datetime(2026, 10, 12, 18, 0).timestamp()          # local time, like the transcripts' file names
DAY = 86400.0


@pytest.mark.parametrize("text,family", [
    ("hey jarvis", "chat"),
    ("Hey Jarvis.", "chat"),
    ("how are you", "chat"),
    ("kaise ho", "chat"),
    ("Hey Jarvis, what time is it?", "time"),
    ("kitne baje hain", "time"),
    ("aaj ki date kya hai", "time"),
    ("batti band karo", "room"),
    ("pankha chalu karo", "room"),
    ("Jarvis, turn off the light", "room"),
    ("remind me to water the cactus at 9", "reminders"),
    ("mujhe 6 baje yaad dila dena", "reminders"),
    ("set a timer for ten minutes", "reminders"),
    ("can you see me", "presence"),
    ("aankhen ne kya dekha", "presence"),
    ("track my movement", "presence"),
    ("where am i right now", "presence"),
    ("who is in the room", "presence"),
    ("kya hua, sun rahe ho?", "status"),
    ("why are you not listening", "status"),
    ("are you working", "status"),
    ("yaad hai humne kal kya baat ki", "memory"),
    ("who is my best friend", "memory"),
    ("do you know my favourite food", "memory"),
    ("aaj ki padhai kitni hui", "study"),
    ("log 2 hours of german", "study"),
    ("give me the morning brief", "study"),
    ("sing me a rap", "music"),
    ("gaana sunao", "music"),
    ("spit some bars", "music"),
    ("help me be consistent", "advice"),
    ("how do i win at life", "advice"),
    ("main kya karun yaar", "advice"),
    ("tell me about the quokka at the zoo", "other"),
])
def test_requests_fall_into_families(text, family):
    assert classify(text) == family


def you(session, i, t, text):
    return {"kind": "turn", "session": session, "id": i, "role": "you", "text": text, "ts": t, "mode": "voice"}


def jarvis(session, i, t, seconds, text="(reply)"):
    return {"kind": "turn", "session": session, "id": i, "role": "jarvis", "text": text, "ts": t, "mode": "voice",
            "seconds": seconds, "timings": {"first_token": 0.4}}


def error(session, t, message):
    return {"kind": "error", "session": session, "ts": t, "message": message, "critical": False}


def write(folder, entries):
    for e in entries:
        with open(folder / f"{datetime.fromtimestamp(e['ts']):%Y-%m-%d}.jsonl", "a", encoding="utf-8") as f:
            f.write(json.dumps(e) + "\n")


ASKED = []                                               # every request text the fixture writes


def conversation(session, start, pairs):
    """[(request, reply seconds)] -> turns a minute apart."""
    out = []
    for n, (text, seconds) in enumerate(pairs):
        t = start + 60 * n
        ASKED.append(text)
        out += [you(session, 2 * n + 1, t, text), jarvis(session, 2 * n + 2, t + 5, seconds)]
    return out


@pytest.fixture
def transcripts(tmp_path):
    folder = tmp_path / "transcripts"
    folder.mkdir()
    yesterday, today = NOW - DAY - 3600, NOW - 3600
    write(folder, conversation("a", yesterday, [
        ("can you see me", 2.0), ("track my movement", 2.4), ("where am i right now", 2.2),
        ("hey jarvis", 1.0), ("are you working", 0.9)]))
    write(folder, [error("a", yesterday + 4 * 60 + 8, "[WinError 10061] connection refused")])
    write(folder, conversation("a2", yesterday + 1200, [("why are you not listening", 1.1)]))
    write(folder, conversation("b", today, [
        ("aankhen ne kya dekha", 3.0), ("kya main desk pe hu? can you see me", 2.6), ("kaise ho", 1.0),
        ("help me be consistent", 6.0), ("how do i win at life", 6.2), ("tell me about the quokka at the zoo", 1.2)]))
    # A reminder asked for, an announcement spoken in between (no seconds), then the reply.
    ASKED.append("remind me to water the cactus at 9")
    write(folder, [you("c", 1, today + 900, "remind me to water the cactus at 9"),
                   jarvis("c", 2, today + 901, None, "This is the reminder you asked for."),
                   jarvis("c", 3, today + 903, 1.0),
                   error("d", today + 950, "mic disconnected")])            # no request before it: stray
    (folder / "flags.jsonl").write_text(json.dumps({"session": "a", "id": 1, "verdict": "good"}) + "\n")
    old = NOW - (WINDOW_DAYS + 3) * DAY                                     # outside the window
    write(folder, conversation("z", old, [("batti band karo", 1.0)] * 5))
    with open(folder / f"{datetime.fromtimestamp(today):%Y-%m-%d}.jsonl", "a", encoding="utf-8") as f:
        f.write('{"kind": "turn", "session": "b", "role": "you", "te')         # a torn last line
    return folder


@pytest.fixture
def ledger(transcripts, tmp_path):
    return TaskLedger(transcripts, tmp_path / "crew", clock=lambda: NOW)


def test_requests_replies_and_failures_are_paired_by_session(transcripts):
    requests, stray = read_requests(transcripts, datetime.fromtimestamp(NOW).date(), WINDOW_DAYS)
    assert len(requests) == 13 and stray == 1
    by = {}
    for r in requests:
        by.setdefault(r.family, []).append(r)
    assert [r.seconds for r in by["reminders"]] == [1.0]          # the announcement in between is skipped
    assert [r.failed for r in by["status"]] == [True, False]      # the error came after "are you working"


def test_families_are_ranked_by_time_cost_then_days(ledger):
    assert ledger.run(NOW), ledger.health.last_error
    rows = {r["id"]: r for r in ledger.data["families"]}
    assert [r["id"] for r in ledger.data["families"]] == ["advice", "presence", "chat", "status", "other", "reminders"]
    p = rows["presence"]
    assert (p["count"], p["days"], p["median_s"], p["cost_s"], p["failures"]) == (5, 2, 2.4, 12.0, 0)
    assert rows["advice"]["cost_s"] == 12.2 and rows["advice"]["days"] == 1
    assert rows["chat"]["cost_s"] == rows["status"]["cost_s"] == 2.0      # a tie: chat was seen on 2 days
    assert rows["status"]["failures"] == 1
    assert rows["presence"]["share"] == round(5 / 13, 3)
    assert rows["presence"]["last_seen"] == NOW - 3600 + 60
    assert ledger.data["requests"] == 13 and ledger.data["stray_errors"] == 1 and ledger.data["days_seen"] == 2


def test_candidates_say_what_an_agent_would_do_and_which_exist(ledger):
    ledger.run(NOW)
    cands = {c["id"]: c for c in ledger.data["candidates"]}
    assert list(cands) == ["presence", "chat"]               # 5 asks; 2 asks but on 2 days
    assert cands["presence"]["exists"] is True and cands["presence"]["covered_by"] == "movement"
    assert "movement watcher" in cands["presence"]["proposal"]
    assert cands["chat"]["exists"] is False and cands["chat"]["covered_by"] is None
    assert cands["chat"]["proposal"].startswith("A greeter")
    status = next(r for r in ledger.data["families"] if r["id"] == "status")
    assert status["candidate"] is False and status["covered_by"] == "steward"
    assert ledger.summary == ("13 requests over 2 days; most time goes to advice & life (2 asks, median 6.1 s). "
                              "Recurring, with no agent yet: greeting & chat.")


def test_the_line_for_jarvis(ledger):
    ledger.run(NOW)
    assert ledger.context_line() == ("Most asked lately: presence & movement (5), chat (2), advice & life (2); "
                                     "slowest: advice & life at 6.1 s.")


def test_a_candidate_is_announced_once_even_across_a_restart(ledger, transcripts, tmp_path):
    ledger.run(NOW)
    first = [e for e in ledger.board.since(0) if e["kind"] == "candidate"]
    assert [e["data"]["family"] for e in first] == ["presence", "chat"]
    assert first[0]["text"].startswith("Recurring job: presence & movement (5 asks over 2 days). ")
    ledger.run(NOW + 600)
    assert len(ledger.board.since(0)) == 2
    again = TaskLedger(transcripts, tmp_path / "crew", clock=lambda: NOW)     # the app restarted
    again.run(NOW + 1200)
    assert again.board.since(0) == []
    write(transcripts, conversation("e", NOW - 60, [("set a timer for ten minutes", 0.8)] * 3))
    again.run(NOW + 1800)
    assert [e["data"]["family"] for e in again.board.since(0)] == ["reminders"]


def test_no_request_text_leaves_the_transcripts(ledger, tmp_path):
    ledger.run(NOW)
    raw = (tmp_path / "crew" / "ledger.json").read_text(encoding="utf-8")
    saved = raw.lower()
    shown = json.dumps([ledger.data, ledger.summary, ledger.context_line(), ledger.board.since(0)]).lower()
    for text in ASKED:
        assert text.lower() not in saved and text.lower() not in shown
    for word in ("quokka", "cactus", "consistent", "aankhen ne", "desk pe"):
        assert word not in saved and word not in shown
    assert json.loads(raw) == ledger.data                    # what the UI gets is exactly what is on disk


def test_an_empty_folder_is_idle_and_says_nothing_to_jarvis(tmp_path):
    l = TaskLedger(tmp_path / "missing", tmp_path / "crew", clock=lambda: NOW)
    assert l.run(NOW)
    assert l.idle and l.context_line() == "" and l.summary == "No requests to JARVIS in the last 30 days to count."
    assert json.loads((tmp_path / "crew" / "ledger.json").read_text())["requests"] == 0
