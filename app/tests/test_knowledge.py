"""Verified notes (brain/knowledge.py): checked drill-deck answers go into JARVIS's
prompt for technical questions — and never for everyday ones."""
import pytest

from jarvis_app.paths import ensure_brain_importable

ensure_brain_importable()
import knowledge  # noqa: E402


def test_the_cards_load_from_the_ui_decks():
    assert len(knowledge.cards()) >= 60


@pytest.mark.parametrize("question, card", [
    ("explain setup time in simple words", "Setup time"),
    ("can I fix a hold violation by slowing the clock?", "Can slowing the clock fix a hold violation?"),
    ("why use two flip-flops to synchronise an async input?", "Why a 2-flop synchroniser?"),
    ("gray code kya hota hai", "Why gray code for async FIFO pointers?"),
    ("what is the APS fee", "APS India fee (June 2026 leaflet)"),
    ("how much is the blocked account", "Blocked account (Sperrkonto) amount, 2026"),
])
def test_technical_questions_get_the_right_card(question, card):
    notes = knowledge.notes(question)
    assert notes.startswith("VERIFIED NOTES")
    assert notes.splitlines()[1].startswith(f"- {card}:")


@pytest.mark.parametrize("question", ["what time is it", "how was your day", "bhai aaj thak gaya",
                                      "what is a good morning routine", "tell me a joke", "light band kar do", ""])
def test_everyday_questions_get_nothing(question):
    assert knowledge.notes(question) == ""


@pytest.mark.parametrize("question", ["mera CGPA kya hai?", "what is my German grade", "Germany mein kahan jaana hai?"])
def test_questions_about_him_never_get_the_germany_cards(question):
    """Their worked examples and fees read like facts about him: "mera CGPA kya hai?" got
    a card with a sample CGPA until 2026-10-09 — an invitation to invent his grade."""
    assert knowledge.notes(question) == ""


def test_personal_but_technical_still_gets_concept_notes():
    assert "Setup time" in knowledge.notes("mera setup time calculation galat hai")


def test_no_regex_in_the_brain_contains_a_literal_backspace():
    """A heredoc once turned \b into a backspace (chr 8) and silently disabled two regexes."""
    import glob, os
    from jarvis_app.paths import BRAIN
    bad = [p for p in glob.glob(os.path.join(str(BRAIN), "*.py")) if chr(8) in open(p, encoding="utf-8").read()]
    assert bad == []
