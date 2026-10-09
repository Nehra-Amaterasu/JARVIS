"""Yaadash facts: every confirmed fact in JARVIS's system message, "remember that ..."
by voice, corrections taught from a flagged reply, and follow-up-aware retrieval.

Uses a throwaway LanceDB and a fake embedder: nothing touches brain/lancedb and the
embedding model is never loaded."""
import numpy as np
import pytest

from jarvis_app.paths import ensure_brain_importable

ensure_brain_importable()
import remember  # noqa: E402
import yaadash_v2 as y  # noqa: E402


@pytest.fixture
def store(tmp_path, monkeypatch):
    monkeypatch.setattr(y, "DB_PATH", str(tmp_path / "lancedb"))
    monkeypatch.setattr(y, "_db", None)
    monkeypatch.setattr(y, "_table", None)
    monkeypatch.setattr(y, "_facts", {"sig": None, "block": "", "checked": -1e9})
    monkeypatch.setattr(y, "embed", lambda texts, is_query=False: np.ones(
        (1 if isinstance(texts, str) else len(texts), y._EMBED_DIM), dtype=np.float32) / y._EMBED_DIM ** 0.5)
    y.add_many([
        {"text": "His name is Test Person.", "source": "authored:Who he is", "role": "fact"},
        {"text": "He likes synthwave.", "source": "authored:Taste", "role": "fact"},
        {"text": "He builds a radar.", "source": "authored:What he is building", "role": "fact"},
        {"text": "In the past (not now): he played chess daily.", "source": "authored:confirmed:past", "role": "fact"},
        {"text": "User: hi\nJARVIS: hello", "source": "voice_interaction", "role": "interaction"},
    ])
    return y


# ------------------------------------------------------------- the facts block
def test_every_fact_is_in_the_block_in_a_stable_order(store):
    block = store.authored_block()
    assert block.startswith("CONFIRMED FACTS ABOUT AMAN")
    lines = block.splitlines()
    # identity first, whatever order the rows were written in
    assert lines.index("- His name is Test Person.") < lines.index("- He builds a radar.") < lines.index(
        "- He likes synthwave.")
    assert "TRUE IN THE PAST, NOT NOW:" in block and "chess" in block.split("TRUE IN THE PAST")[1]
    assert "JARVIS: hello" not in block          # his past turns are never facts
    assert store.authored_block() is block       # cached: same string, Ollama's prefix cache holds


def test_the_block_says_what_is_not_there_is_not_known(store):
    assert "Never guess a number, a date or a name" in store.authored_block()


def test_remember_that_reaches_the_block_and_is_not_stored_twice(store):
    assert store.remember_told("my exam is on 12 November") is True
    block = store.authored_block()
    assert "THINGS HE TOLD YOU TO REMEMBER" in block
    assert 'he told you: "my exam is on 12 November"' in block
    assert store.remember_told("my exam is on 12 November") is False
    assert store.authored_block().count("12 November") == 1


def test_a_taught_correction_reaches_the_block(store):
    assert store.remember_correction("what is my favourite genre?", "Synthwave, not jazz.") is True
    block = store.authored_block()
    assert "CORRECTIONS HE GAVE YOU" in block
    assert 'When he asked "what is my favourite genre?", the right answer is: Synthwave, not jazz.' in block
    assert store.remember_correction("what is my favourite genre?", "Synthwave, not jazz.") is False
    assert store.remember_correction("q", "   ") is False


def test_a_fact_written_by_another_handle_is_seen(store, monkeypatch):
    """The app and the brain are separate processes; the brain must see the app's
    writes without a restart (read_consistency_interval in _get_table)."""
    store.authored_block()
    import lancedb
    lancedb.connect(store.DB_PATH).open_table(store.TABLE_NAME).add([{
        "id": "x", "text": "He moved to a new room.", "vector": [0.0] * store._EMBED_DIM,
        "source": "authored:confirmed", "role": "fact", "timestamp": "2026-10-09", "user_id": store.USER_ID}])
    monkeypatch.setattr(store, "_facts", {**store._facts, "checked": -1e9})
    store._get_table().checkout_latest()      # the 5 s consistency interval, without waiting
    assert "He moved to a new room." in store.authored_block()


def test_get_context_can_leave_facts_to_the_system_message(store, monkeypatch):
    monkeypatch.setattr(store, "search_fragments", lambda q, top_k=3: [])
    assert store.get_context("what is my name?", facts=False) == ""
    assert "Test Person" in store.get_context("what is my name?")


# ------------------------------------------------------- follow-up retrieval
@pytest.mark.parametrize("text", ["aur uske baare mein?", "what about her?", "and since when?",
                                  "why?", "uska number kya tha", "and how do you fix it?"])
def test_a_follow_up_carries_the_previous_question(text):
    assert y.follow_up_query(text, "tell me about the blocked account") == \
        f"tell me about the blocked account {text}"


# "it" is usually a dummy pronoun: these inherited the previous topic when it counted.
@pytest.mark.parametrize("text", ["what is setup time", "mera naam kya hai", "what time is it?",
                                  "is it going to rain today?", "what is this weather like?",
                                  "explain how a two flop synchroniser handles metastability in detail please"])
def test_a_standalone_question_is_searched_alone(text):
    assert y.follow_up_query(text, "tell me about the blocked account") == text


def test_no_previous_question_means_no_change():
    assert y.follow_up_query("what about her?", "") == "what about her?"


# --------------------------------------------------------- "remember that ..."
@pytest.mark.parametrize("said, words", [
    ("remember that my exam is on 12 November", "my exam is on 12 November"),
    ("Jarvis, remember that I prefer tea over coffee.", "I prefer tea over coffee"),
    ("please don't forget my mock test is on Friday", "my mock test is on Friday"),
    ("make a note that the APS appointment is on the 3rd", "the APS appointment is on the 3rd"),
    ("remember: the lab key is with the porter", "the lab key is with the porter"),
    ("yaad rakhna ki mera exam 12 november ko hai", "mera exam 12 november ko hai"),
    ("yaad rakh lo, kal German test hai", "kal German test hai"),
    ("mera roll number 42 hai, yaad rakhna", "mera roll number 42 hai"),
    ("my IELTS is on the 20th, remember that", "my IELTS is on the 20th"),
    ("ye yaad rakhna ki mujhe chai pasand hai", "mujhe chai pasand hai"),
])
def test_remember_instructions_are_parsed(said, words):
    assert remember.parse(said) == words


@pytest.mark.parametrize("said", [
    "do you remember my exam date?", "remember when we talked about VLSI?", "remember to call mom",
    "yaad hai kal kya hua tha?", "kya tumhe yaad hai mera naam", "remember that?", "remember this",
    "what do you remember about me", "I can't remember the formula", "remember", "",
    "what is setup time", "light band kar do",
])
def test_questions_reminders_and_everything_else_are_not(said):
    assert remember.parse(said) is None


def test_the_confirmation_is_english_and_second_person():
    assert remember.reply("my exam is on 12 November", True) == "Noted. I'll remember that your exam is on 12 November."
    assert remember.reply("I am allergic to peanuts", True) == "Noted. I'll remember that you are allergic to peanuts."
    assert remember.reply("Sam owes me 500 rupees", True) == "Noted. I'll remember that Sam owes you 500 rupees."
    # Hinglish is understood but never spoken back (British English only)
    assert remember.reply("mera exam 12 november ko hai", True) == "Noted. I'll remember that."
    assert remember.reply("मेरा परीक्षा कल है", True) == "Noted. I'll remember that."
    # "you" would come out backwards when echoed
    assert remember.reply("you should call me boss", True) == "Noted. I'll remember that."
    assert remember.reply("my exam is on 12 November", False) == "I already have that noted."


# ------------------------------------------------- who is named in a sentence
@pytest.fixture
def people(monkeypatch):
    import pandas as pd
    import yaadash_people as yp
    rows = [  # synthetic: a distant account whose name is a Hindi word, a close friend whose
              # name is an English word, a distant friend with a distinctive name
        {"thread": "t1", "name": "Gaya Arts", "username": "gaya.arts", "closeness": 3.0, "rank": 300},
        {"thread": "t2", "name": "Mood Board", "username": "moodboard", "closeness": 2.0, "rank": 310},
        {"thread": "t3", "name": "Dev Kumar", "username": "devk", "closeness": 80.0, "rank": 3},
        {"thread": "t4", "name": "Zorawar Singh", "username": "zsingh", "closeness": 1.0, "rank": 400},
    ]
    for r in rows:
        r.update(is_self=False, n_text=50)
    monkeypatch.setattr(yp, "_people", pd.DataFrame(rows))
    monkeypatch.setattr(yp, "_common", {"dev", "mood", "board", "studio"} | yp._HINDI_COMMON)
    return yp


@pytest.mark.parametrize("said", ["kal bahar gaya tha", "mood off hai yaar", "wo ghar gaya"])
def test_everyday_words_do_not_name_a_distant_account(people, said):
    assert people.resolve_person(said) == []


def test_a_close_friend_with_a_dictionary_name_is_still_found(people):
    assert [r.thread for r, _ in people.resolve_person("how close am I with Dev?")] == ["t3"]


def test_a_distinctive_name_finds_even_a_distant_person(people):
    assert [r.thread for r, _ in people.resolve_person("zorawar ka message aaya tha")] == ["t4"]
