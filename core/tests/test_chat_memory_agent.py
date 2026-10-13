"""The agent's three chat-memory hooks (yaadash/chat_memory.py), with the scripted fake
model from test_agent_tools: "remember that." saves HIS previous statement without the
model, "call me sir" changes the persona, and what was learned reaches the turn.
All examples are invented; the learned store is a scratch folder (conftest.py)."""
import json
import os
from pathlib import Path

import pytest

from test_agent_tools import agent, brain, receipts, run, words  # noqa: F401  (fixtures)

LEARNED = Path(os.environ["JARVIS_LEARNED_DIR"])


@pytest.fixture(autouse=True)
def clean_store():
    for p in LEARNED.glob("*.json"):
        p.unlink()
    yield
    for p in LEARNED.glob("*.json"):
        p.unlink()


def say(brain, text, reply="Very good."):
    brain.plain.rounds.append(words(reply))
    return run(brain.agent, text)


def test_remember_that_saves_his_previous_statement_not_the_command(brain):
    say(brain, "Actually let me correct you, the Raspberry Pi runs the garden pump, not the laptop.",
        "Thank you for the correction.")
    out = run(brain.agent, "Remember that.")
    told = brain.agent._yaadash_stub.told[-1]
    assert "Raspberry Pi runs the garden pump" in told and "Remember" not in told
    assert out.startswith("Saved, sir:") and "Raspberry Pi" in out
    assert "record" not in out.lower()
    assert receipts(brain.agent)[0].tool == "remember" and receipts(brain.agent)[0].ok
    assert not brain.plain.rounds                     # the scripted reply for turn 1 was used; no model call


def test_a_wordy_note_it_reaches_back_past_another_memory_command(brain):
    say(brain, "My cousin's wedding is in Jaipur on the twentieth of December.")
    run(brain.agent, "Remember that.")
    out = run(brain.agent, "Jarvis, I want you to note it. That's why I am saying it again and again. "
                           "I want you to remember it. Also, yeah, that's all.")
    assert brain.agent._yaadash_stub.told[-1].startswith("My cousin's wedding is in Jaipur")
    assert "Jaipur" in out and "don't have a record" not in out


def test_remember_that_with_nothing_before_asks_instead_of_inventing(brain):
    out = run(brain.agent, "Remember that.")
    assert out.startswith("Remember what") and not receipts(brain.agent)[0].ok


def test_a_question_about_memory_still_goes_to_the_model(brain):
    out = say(brain, "Do you remember that?", "I'm not sure which moment you mean.")
    assert out == "I'm not sure which moment you mean."


def test_call_me_sir_is_kept_and_changes_the_persona(brain):
    before = brain.agent.persona(True)
    assert 'Call him "sir" now and then, Aman otherwise.' in before
    out = run(brain.agent, "Actually, I want you to not call me Aman anymore. Call me sir, always, okay?")
    assert out.startswith("Very good, sir.")
    prefs = json.loads((LEARNED / "prefs_live.json").read_text(encoding="utf-8"))
    assert prefs["address"] == "sir" and prefs["avoid"] == ["Aman"]
    after = brain.agent.persona(True)
    assert 'Address him as "sir", always' in after and "Aman otherwise" not in after
    assert after == brain.agent.persona(True)         # static: Ollama's cached prefix survives
    assert after.rstrip().endswith("JSON.")           # the LENGTH rule is still last


def test_call_me_at_nine_is_not_a_name(brain):
    out = say(brain, "Call me at nine if I'm not up.", "I can't make calls, I'm afraid.")
    assert not (LEARNED / "prefs_live.json").exists() and "Very good" not in out


def test_what_was_learned_reaches_the_turn_and_stays_small(brain):
    (LEARNED / "memories.json").write_text(json.dumps([
        {"id": "a1", "kind": "correction", "text": "The Raspberry Pi runs the garden pump; the laptop does not.",
         "evidence": ["20990101-000000#3"], "confidence": 0.8, "support": 1, "first_seen": 4.1e9,
         "last_seen": 4.1e9, "status": "active"},
        {"id": "a2", "kind": "fact", "text": "The laptop runs the garden pump.", "evidence": ["20990101-000000#1"],
         "confidence": 0.5, "support": 1, "first_seen": 4.0e9, "last_seen": 4.0e9, "status": "superseded"},
        {"id": "a3", "kind": "dont", "text": "Long replies: he wants them short", "evidence": ["x#1"],
         "confidence": 0.6, "support": 2, "first_seen": 4.0e9, "last_seen": 4.0e9, "status": "active"},
    ]), encoding="utf-8")
    say(brain, "what runs the garden pump these days?", "The Raspberry Pi, sir.")
    seen = brain.plain.seen[-1]
    turn, system = seen[-1].content, seen[0].content
    assert "LEARNED FROM YOUR CHATS" in turn and "Raspberry Pi runs the garden pump" in turn
    assert "The laptop runs the garden pump." not in turn          # superseded: never shown
    assert "HE DISLIKED" in system and "Long replies" in system    # don'ts are standing: the persona
    block = turn.split("NOW:")[0]
    assert len(block) < 1300
