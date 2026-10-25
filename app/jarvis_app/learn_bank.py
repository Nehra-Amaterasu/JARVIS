"""The concepts the learning engine teaches, read from his private LEARN.md.

LEARN.md (data/notes/well-wisher/, git-ignored) has one concept per section:

    ## 3. Domain shift [AL][AB]
    <the explanation, one or more lines>
    Quiz: (a) first question? (b) second? (c) third?

parse() turns that into [{id, title, body, quiz}]. Without the private file the
fictional EXAMPLE is used, and `source` says so, so a screen never passes the
example off as his.
"""
from __future__ import annotations

import os
import re
from pathlib import Path

_HEAD = re.compile(r"^##\s+(\d+)\.\s+(.+?)\s*(?:\[[^\]]*\]\s*)*$")
_Q = re.compile(r"\(([a-z])\)\s*")

EXAMPLE = [
    {"id": "c1", "title": "Ohm's law", "body": "Voltage across a resistor is current times resistance.",
     "quiz": ["What is V when I = 2 A and R = 5 ohm?", "Why does a thinner wire heat up more?", "What does R mean physically?"]},
    {"id": "c2", "title": "Big-O notation", "body": "How work grows with input size, ignoring constants.",
     "quiz": ["What is the cost of binary search?", "Why drop constants?", "Name an O(n log n) sort."]},
]


def path() -> Path:
    env = os.environ.get("JARVIS_LEARN_FILE")
    return Path(env) if env else Path(__file__).resolve().parents[2] / "data" / "notes" / "well-wisher" / "LEARN.md"


def parse(text: str) -> list[dict]:
    out: list[dict] = []
    cur = None
    for line in text.splitlines():
        m = _HEAD.match(line.strip())
        if m:
            cur = {"id": f"c{m.group(1)}", "title": m.group(2).strip(), "body": "", "quiz": []}
            out.append(cur)
        elif cur is not None and line.strip().lower().startswith("quiz:"):
            parts = [p.strip() for p in _Q.split(line.split(":", 1)[1]) if p.strip()]
            # split() alternates letter, question: keep the questions
            cur["quiz"] = [p for p in parts if not re.fullmatch(r"[a-z]", p)]
        elif cur is not None and line.strip():
            cur["body"] = (cur["body"] + " " + line.strip()).strip()
    return out


def load(p: Path | None = None) -> dict:
    p = p or path()
    try:
        concepts = parse(p.read_text(encoding="utf-8-sig"))
    except OSError:
        concepts = []
    if concepts:
        return {"source": "private", "concepts": concepts}
    return {"source": "example", "concepts": EXAMPLE}
