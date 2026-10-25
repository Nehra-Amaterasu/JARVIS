"""Hallucination eval for the chat-memory loop: a labelled probe set over an invented home.

Three invented chat sessions (a pump that moves boards twice, a sister moving abroad,
a friend's dislikes, a loved song, a misheard line) are read by learn_chats with a
scripted model that also writes the mistakes a 4B model makes: a memory nobody said, a
friend's fact as his, a fact from a misheard line. Then four labelled sets of questions
go through chat_memory.context_block, the exact block JARVIS reads:

    recall          the answer is in the block: hit@1 / hit@3 over the block's lines
    false memory    nothing was said: the block is empty, or holds nothing forbidden
    supersession    only the newest truth is shown; the replaced one never is
    stored          no invented / misattributed / misheard memory reached the store

Thresholds are regression floors (docs/research/2026-10-25-yaadash-test-audit.md has the
measured numbers). Run with -s for the report. The model is scripted, so this measures
the guards and the retrieval, not the 4B model's judgement; the live eval
(test_live_eval.py, -m live) re-measures on the real stores.
"""
import json
import re

import pytest

import chat_memory as cm
from test_learn_chats import FakeLLM, env, mem  # noqa: F401  (env is a fixture)

pytestmark = pytest.mark.needs_bge          # relevance gates measured on bge-small distances

PUMP_NANO = "The Arduino Nano on COM5 runs the greenhouse pump, not the ESP32."
PUMP_PI = "The Raspberry Pi runs the greenhouse pump now; the Arduino Nano is retired."

S1 = [("Which board runs the greenhouse pump?", "The ESP32 runs it, sir."),
      ("Actually, we are not using the ESP32 for the pump, we are using the Arduino Nano on COM5 for the "
       "greenhouse pump.", "Thank you, sir."),
      ("My sister Tara is moving to Lisbon in January for her design job.", "Splendid news."),
      ("I take my chai with cardamom and no sugar, every single morning.", "Noted, sir."),
      ("the render wala thing fan light haan bolo", "That one got lost on its way to me, sir. Once more?")]
S2 = [("Play something for the drive.", "Now playing Midnight Rally by Juno Vale in Spotify."),
      ("Yes! I love this song, best thing ever.", "Enjoy it, sir."),
      ("My friend Kabir hates horror movies, so no horror on Friday movie night.", "Understood."),
      ("My bike is a blue Hero Sprint with a broken bell, I ride it to college.", "A classic."),
      ("The spare key for the shed is under the blue flowerpot by the gate.", "Noted, sir.")]
S3 = [("Correction: the greenhouse pump now runs on the Raspberry Pi, the Arduino Nano is retired.", "Very good."),
      ("Kal se gym subah saat baje, yaad rakhna bhai, gym ka bag ready rakhna hai.", "Noted."),
      ("From now on always keep your replies under three sentences.", "Of course.")]

# What the scripted model writes for each session, mistakes included.
DISTIL = {
    "Which board runs the greenhouse pump?": [
        {"kind": "correction", "text": PUMP_NANO, "turn": 3},
        {"kind": "fact", "text": "His sister Tara is moving to Lisbon in January for a design job.", "turn": 5},
        {"kind": "fact", "text": "He is moving to Lisbon in January.", "turn": 5},                 # misattributed
        {"kind": "preference", "text": "He takes his chai with cardamom and no sugar.", "turn": 7},
        {"kind": "fact", "text": "He renders the fan light with the wala thing.", "turn": 9},       # misheard line
    ],
    "Play something for the drive.": [
        {"kind": "fact", "text": "His friend Kabir hates horror movies.", "turn": 5},
        {"kind": "preference", "text": "He hates horror movies.", "turn": 5},                      # misattributed
        {"kind": "fact", "text": "His bike is a blue Hero Sprint with a broken bell.", "turn": 7},
        {"kind": "fact", "text": "He owns a red Ferrari.", "turn": 7},                             # never said
    ],
    "Correction: the greenhouse pump": [
        {"kind": "correction", "text": PUMP_PI, "turn": 1},
        {"kind": "fact", "text": "He goes to the gym at saat baje subah from tomorrow.", "turn": 3},
    ],
}

RECALL = [  # (question, a phrase the block must hold)
    ("which board runs the greenhouse pump now?", "Raspberry Pi"),
    ("how do I take my chai?", "cardamom"),
    ("where is Tara moving?", "Lisbon"),
    ("which song did I love on the drive?", "Midnight Rally"),
    ("what bike do I ride to college?", "Hero Sprint"),
    ("what does Kabir think of horror movies?", "Kabir hates horror"),
    ("what did I tell you about the gym?", "gym"),
    ("what did I tell you about the spare key for the shed?", "blue flowerpot"),
]
NEVER_SAID = [  # the block must be empty
    "what did I tell you about my trip to Iceland?", "what is my favourite football team?",
    "do you remember my cat's name?", "which language am I learning?", "what is my blood group?",
    "what did I tell you about the dentist appointment?",
]
FORBIDDEN = [  # (question, what the block must never claim)
    ("do I hate horror movies?", r"\bHe hates horror"),
    ("am I moving to Lisbon?", r"\bHe is moving"),
    ("which car do I own?", r"Ferrari"),
    ("what was that render wala thing about the fan light?", r"renders the fan"),
]
SUPERSEDED = [  # (question, must hold, must never hold)
    ("which board runs the greenhouse pump?", "Raspberry Pi", "COM5"),
    ("what did I tell you about the pump on COM5?", "Raspberry Pi", "Nano on COM5 runs"),
    ("is the ESP32 running the greenhouse pump?", "Raspberry Pi", "The ESP32 runs it"),
]
INVENTED = [r"\bHe is moving", r"\bHe hates horror", r"Ferrari", r"renders the fan"]

FLOORS = {"hit@1": 0.75, "hit@3": 1.0, "false_memory": 0.0, "supersession": 1.0, "stored_invented": 0}


class PumpJudge(FakeLLM):
    """Says NEW replaces OLD only when both are about the pump (a fair judge)."""

    def __call__(self, prompt):
        if prompt.startswith("Two notes"):
            self.prompts.append(prompt)
            old, new = re.search(r"OLD: (.*)\nNEW: (.*)", prompt).groups()
            return json.dumps({"replaces": "pump" in old and "pump" in new})
        return super().__call__(prompt)


def _lines(block):
    return [ln for ln in block.splitlines() if ln.startswith("- ")]


@pytest.fixture
def learned(env):
    env.chat("s1", *S1, day="2026-09-20")
    env.chat("s2", *S2, day="2026-09-25")
    env.chat("s3", *S3, day="2026-10-01")
    env.learn(llm=PumpJudge(DISTIL))
    return env


def test_hallucination_eval(learned):
    hit1 = hit3 = 0
    misses = []
    for q, want in RECALL:
        lines = _lines(cm.context_block(q)[0])
        rank = next((i for i, ln in enumerate(lines, 1) if want in ln), None)
        hit1 += rank == 1
        hit3 += rank is not None and rank <= 3
        if rank != 1:
            misses.append((q, rank))
    false = [q for q in NEVER_SAID if _lines(cm.context_block(q)[0])]
    false += [q for q, bad in FORBIDDEN if re.search(bad, cm.context_block(q)[0])]
    sup_ok = 0
    for q, must, never in SUPERSEDED:
        block = cm.context_block(q)[0]
        sup_ok += must in block and never not in block
    stored = [m["text"] for m in cm.memories(active_only=False)]
    invented = [t for t in stored for rx in INVENTED if re.search(rx, t)]
    got = {"hit@1": hit1 / len(RECALL), "hit@3": hit3 / len(RECALL),
           "false_memory": len(false) / (len(NEVER_SAID) + len(FORBIDDEN)),
           "supersession": sup_ok / len(SUPERSEDED), "stored_invented": len(invented)}
    print(f"\nchat-memory eval: recall n={len(RECALL)} hit@1 {hit1}/{len(RECALL)} hit@3 {hit3}/{len(RECALL)}; "
          f"false memory {len(false)}/{len(NEVER_SAID) + len(FORBIDDEN)}; supersession {sup_ok}/{len(SUPERSEDED)}; "
          f"invented memories stored {len(invented)}; misses {misses}; false {false}")
    assert got["hit@1"] >= FLOORS["hit@1"] and got["hit@3"] >= FLOORS["hit@3"], misses
    assert got["false_memory"] <= FLOORS["false_memory"], false
    assert got["supersession"] >= FLOORS["supersession"]
    assert got["stored_invented"] <= FLOORS["stored_invented"], invented

    # One fixture build serves both checks (the 3-session learn is the slow part).
    block, used = cm.context_block("what did I tell you about the Arduino Nano on COM5 and the pump?")
    assert used and "Raspberry Pi" in block
    assert "we are using the Arduino Nano on COM5" not in block      # the superseded line, as an excerpt
