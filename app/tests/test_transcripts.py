"""Transcripts: what's kept, what's flagged, and the review file Claude reads."""
import json
import time

from jarvis_app.transcripts import TranscriptStore


def _store(tmp_path):
    return TranscriptStore(tmp_path / "t", tmp_path / "r")


def _turns(store, session="s1"):
    store.record_turn(session, {"id": 1, "role": "you", "text": "what is my name?", "t": time.time()}, "text", {})
    store.record_turn(session, {"id": 2, "role": "jarvis", "text": "Mera naam Aman hai", "t": time.time(),
                                "seconds": 2.5}, "text", {"first_token": 0.6, "reply": 2.5})
    store.record_turn(session, {"id": 3, "role": "you", "text": "koi hai room mein?", "t": time.time()}, "voice",
                      {"stt": 2.7})
    store.record_turn(session, {"id": 4, "role": "jarvis", "text": "Room khali hai.", "t": time.time(),
                                "seconds": 9.0}, "voice", {"first_token": 4.0, "reply": 9.0})


def test_turns_and_errors_are_kept(tmp_path):
    s = _store(tmp_path)
    _turns(s)
    s.record_error("s1", "ollama timed out", critical=True)
    sm = s.summary(1)
    assert (sm["sessions"], sm["turns"], sm["questions"], sm["replies"], sm["errors"]) == (1, 4, 2, 2, 1)
    assert sm["reply_seconds_median"] == 5.75


def test_flag_validates_verdict(tmp_path):
    s = _store(tmp_path)
    _turns(s)
    s.flag("s1", 2, "wrong", expected="Tera naam Aman hai")
    try:
        s.flag("s1", 2, "terrible")
        raise AssertionError("bad verdict accepted")
    except ValueError:
        pass
    assert s.summary(1)["flags"] == {"wrong": 1}


def test_a_later_flag_overrides_an_earlier_one(tmp_path):
    s = _store(tmp_path)
    _turns(s)
    s.flag("s1", 4, "good")
    s.flag("s1", 4, "slow")
    assert s.flags()[("s1", 4)]["verdict"] == "slow"


def test_review_lists_flagged_turns_first_with_what_was_expected(tmp_path):
    s = _store(tmp_path)
    _turns(s)
    s.flag("s1", 2, "wrong", expected="Tera naam Aman hai", note="perspective swap")
    s.record_error("s1", "mic disconnected")
    text = s.export_review(1).read_text(encoding="utf-8")
    flagged_at = text.index("## Flagged by Aman")
    assert flagged_at < text.index("## Full transcript")
    block = text[flagged_at:text.index("## Errors")]
    assert "WRONG" in block and "Mera naam Aman hai" in block
    assert "**EXPECTED:** Tera naam Aman hai" in block and "perspective swap" in block
    assert "what is my name?" in block                    # the question before it, for context
    assert "mic disconnected" in text
    assert "Slowest replies" in text and "Room khali hai." in text


def test_a_torn_last_line_never_breaks_reading(tmp_path):
    s = _store(tmp_path)
    _turns(s)
    day = next(s.root.glob("*.jsonl"))
    with open(day, "a", encoding="utf-8") as f:
        f.write('{"kind": "turn", "sess')                  # power cut mid-write
    assert s.summary(1)["turns"] == 4


def test_recent_attaches_flags(tmp_path):
    s = _store(tmp_path)
    _turns(s)
    s.flag("s1", 4, "slow")
    recent = s.recent(1)
    assert recent[-1]["flag"]["verdict"] == "slow"
    assert json.dumps(recent)                              # serialisable for the API
