"""The proof engine (GitHub streak) and its fetcher. No network: the fetcher gets a fake."""
import json

from jarvis_app import github_activity as gha
from jarvis_app import ww_engines
from jarvis_app.ww_proof import proof

TODAY = "2026-10-26"


def _days(*pairs):
    return [{"date": d, "commits": c} for d, c in pairs]


def test_no_user_says_so_and_never_guesses():
    r = proof({}, TODAY, days=_days((TODAY, 3)), user=None)
    assert r["status"] == "ok" and r["configured"] is False and "username" in r["say"]


def test_streak_counts_back_from_today_when_today_is_green():
    r = proof({}, TODAY, days=_days(("2026-10-24", 1), ("2026-10-25", 2), (TODAY, 1)), user="someone")
    assert r["today_done"] and r["current_streak"] == 3


def test_an_open_today_does_not_break_yesterdays_streak():
    r = proof({}, TODAY, days=_days(("2026-10-24", 1), ("2026-10-25", 2)), user="someone")
    assert not r["today_done"] and r["current_streak"] == 2
    assert r["suggestion"]["kind"] == "problem"


def test_a_gap_resets_the_streak_and_longest_remembers():
    days = _days(("2026-10-10", 1), ("2026-10-11", 1), ("2026-10-12", 1), ("2026-10-20", 1))
    r = proof({}, TODAY, days=days, user="someone")
    assert r["current_streak"] == 0 and r["longest_in_window"] == 3


def test_zero_and_future_days_never_count():
    r = proof({}, TODAY, days=_days((TODAY, 0), ("2026-10-27", 5)), user="someone")
    assert not r["today_done"] and r["current_streak"] == 0


def test_strip_is_thirty_days_ending_today():
    r = proof({}, TODAY, days=_days((TODAY, 2)), user="someone")
    assert len(r["strip"]) == 30 and r["strip"][-1] == {"date": TODAY, "commits": 2}


def test_never_suggests_an_empty_or_generated_commit():
    from jarvis_app.ww_proof import PROOF_IDEAS
    for _, text in PROOF_IDEAS:
        low = text.lower()
        assert "empty" not in low and "allow-empty" not in low and "generate" not in low


def test_registered_and_schema_checked():
    assert "proof" in ww_engines.REGISTRY
    bad = ww_engines.run("proof", {}, TODAY, days=[{"date": "26-10-2026", "commits": 1}], user="x")
    assert bad["status"] == "invalid_input"


def test_github_username_is_validated_in_inputs():
    ok = ww_engines.normalize_inputs({"profile": {"github": "Some-User1"}})
    bad = ww_engines.normalize_inputs({"profile": {"github": "x; rm -rf /"}})
    assert ok["profile"]["github"] == "Some-User1" and bad["profile"]["github"] is None


def test_inputs_saved_with_a_bom_still_load(tmp_path):
    p = tmp_path / "inputs.json"
    p.write_bytes(b"\xef\xbb\xbf" + json.dumps({"profile": {"github": "someone"}}).encode())
    got = ww_engines.load_inputs(p)
    assert got["source"] == "private" and got["profile"]["github"] == "someone"


def test_count_days_uses_local_midnight_and_keeps_only_counts():
    events = [
        {"type": "PushEvent", "created_at": "2026-10-25T19:00:00Z", "payload": {"distinct_size": 2, "commits": [{"message": "secret"}]}},
        {"type": "WatchEvent", "created_at": "2026-10-25T10:00:00Z", "payload": {}},
        {"type": "PushEvent", "created_at": "2026-10-25T10:00:00Z", "payload": {"size": 1}},
    ]
    # 19:00 UTC is 00:30 IST on the 26th; 10:00 UTC is still the 25th.
    assert gha.count_days(events) == [{"date": "2026-10-25", "commits": 1}, {"date": "2026-10-26", "commits": 2}]


def test_fetcher_caches_and_falls_back_to_the_last_good_copy(tmp_path):
    cache = tmp_path / "github.json"
    calls = []

    def fake(url):
        calls.append(url)
        return [{"type": "PushEvent", "created_at": "2026-10-25T10:00:00Z", "payload": {"size": 1}}]

    a = gha.days("someone", now=1000.0, fetch=fake, cache=cache)
    b = gha.days("someone", now=1000.0 + 60, fetch=fake, cache=cache)
    assert a["days"] == b["days"] and len(calls) == 1          # second call served from cache
    saved = json.loads(cache.read_text())
    assert set(saved) == {"user", "fetched", "days", "at"}     # no repo names or messages kept

    def offline(url):
        raise OSError("no network")

    c = gha.days("someone", now=1000.0 + gha.FRESH_S + 1, fetch=offline, cache=cache)
    assert c["days"] == a["days"] and "using the copy" in c["error"]
