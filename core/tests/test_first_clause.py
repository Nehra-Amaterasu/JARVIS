"""When the first piece of a reply is ready for the voice (voice.split_ready, 10-25).

The first clause now goes at 5 words (was 8) and at ; : or a dash as well as a comma, so
the voice starts sooner. The honesty guard splits with its own copy; the two must agree.
"""
import pytest

import voice
from tools import honesty

SPLITTERS = [voice.split_ready, honesty.split_ready]


@pytest.mark.parametrize("split", SPLITTERS)
def test_a_five_word_first_clause_is_spoken_at_its_comma(split):
    assert split("Right sir, here is the thing, and", True) == ("Right sir, here is the thing,", " and")


@pytest.mark.parametrize("split", SPLITTERS)
def test_four_words_still_wait_for_more(split):
    assert split("Of course sir, I", True) == ("", "Of course sir, I")


@pytest.mark.parametrize("split", SPLITTERS)
def test_only_the_first_piece_flushes_early(split):
    buf = "and then the second clause runs on, still going"
    assert split(buf, False) == ("", buf)


@pytest.mark.parametrize("split", SPLITTERS)
@pytest.mark.parametrize("mark", [";", ":"])
def test_semicolon_and_colon_are_clause_breaks(split, mark):
    buf = f"Here are the three things{mark} first"
    assert split(buf, True) == (f"Here are the three things{mark}", " first")


@pytest.mark.parametrize("split", SPLITTERS)
def test_a_spaced_dash_is_a_clause_break(split):
    buf = "VLSI stands for Very Large Scale Integration — it is"
    ready, rest = split(buf, True)
    assert ready == "VLSI stands for Very Large Scale Integration —" and rest == " it is"
    assert voice.clean_for_speech(ready) == "VLSI stands for Very Large Scale Integration ,"


@pytest.mark.parametrize("split", SPLITTERS)
@pytest.mark.parametrize("buf", ["The fan uses about 1,000", "The alarm is set for 10:30", "The fan uses about 1,"])
def test_numbers_are_never_cut(split, buf):
    assert split(buf, True) == ("", buf)


@pytest.mark.parametrize("split", SPLITTERS)
def test_a_full_stop_still_wins_over_a_clause(split):
    assert split("The light is off. And the fan, which", True) == ("The light is off.", " And the fan, which")


@pytest.mark.parametrize("split", SPLITTERS)
def test_the_last_long_enough_clause_is_taken(split):
    buf = "Yes, I can see that the lights are on, the fan is off, and"
    assert split(buf, True) == ("Yes, I can see that the lights are on, the fan is off,", " and")


def test_the_two_copies_agree_on_a_stream():
    text = ("Well sir, that is a fine question; the short answer — as far as I know — is yes. "
            "Then 1,000 more words: here they come, slowly.")
    for split_a, split_b in [(voice.split_ready, honesty.split_ready)]:
        for i in range(len(text) + 1):
            for first in (True, False):
                assert split_a(text[:i], first) == split_b(text[:i], first)
    assert voice.EARLY_FLUSH_WORDS == honesty.EARLY_FLUSH_WORDS == 5


def test_the_guard_still_holds_a_claiming_clause_for_its_whole_sentence():
    # Unchanged rule: an early clause that claims something is judged with its sentence.
    g = honesty.Guard(honesty_registry(), [])
    out = ""
    for ch in "I have turned off the light, as you asked. Anything else?":
        out += g.feed(ch)
    out += g.finish()
    assert "turned off the light, as you asked" not in out


def honesty_registry():
    from tools.builtin import default_registry
    return default_registry()


def test_heard_part_counts_whole_words_by_speaking_rate():
    text = "one two three four five six seven"
    assert voice.heard_part(text, 0.0) == ""
    assert voice.heard_part(text, 1.0) == "one two"            # 2.8 words a second
    assert voice.heard_part(text, 60.0) == text
    assert voice.heard_part("", 3.0) == ""
