"""Mission Germoney from JARVIS's side: voice commands for the game, and the live
mission state for his prompt.

    "Jarvis, brief me"                      -> the day: floor, contracts, boss, Marks
    "log 2 hours of German"                 -> German logged, Deutsch rep ticked
    "maine 45 minute verilog kiya"          -> 45 min of Silicon logged
    "start a 50 minute focus on German"     -> a Crucible starts in the app
    "contract done: ripple carry adder"     -> that contract completed (a voice claim)
    "how many marks do I have"              -> balance and what it buys
    "redeem an anime episode"               -> bought in the Armory

Parsing is deterministic regex, not the model. The 4B model is good at talking and
bad at structured actions; "log 2 hours" must never be heard as something else, and
it must be instant. Questions ("did I log German today?") are NOT actions — they go
to the model with the mission state in its prompt instead.

The game itself runs in the app (one engine, tested there). This module only talks
to the app's server: POST /api/game/action, GET /api/game/brief. Outside the app
(no JARVIS_API_URL) every function quietly does nothing.
"""
from __future__ import annotations

import os
import re
from typing import Optional

_WORD_NUM = {
    "a": 1, "an": 1, "one": 1, "ek": 1, "two": 2, "do": 2, "three": 3, "teen": 3, "four": 4, "char": 4, "chaar": 4,
    "five": 5, "paanch": 5, "half": 0.5, "aadha": 0.5, "adha": 0.5, "dedh": 1.5, "dhai": 2.5, "ten": 10, "das": 10,
    "fifteen": 15, "twenty": 20, "bees": 20, "thirty": 30, "tees": 30, "forty": 40, "forty five": 45, "fifty": 50,
    "sixty": 60, "ninety": 90,
}
_WORDS = "forty five|" + "|".join(sorted((k for k in _WORD_NUM if k != "forty five"), key=len, reverse=True))
_UNIT = r"(hours?|hrs?|ghante|ghanta|minutes?|mins?|min)"
# Digits may touch the unit ("2h", "45min"); a word-number needs its own word and a
# space before the unit ("an hour"). Without that, "ah" read as a + h = one hour and
# "7 am" as one minute. A bare "m" is never a unit.
_DUR = re.compile(r"\b(\d+(?:\.\d+)?)\s*(?:-\s*)?(h|" + _UNIT[1:] + r"\b|\b(" + _WORDS + r")\s+" + _UNIT + r"\b", re.I)
_HALF_HOUR = re.compile(r"\b(half an hour|aadha ghanta|adha ghanta|half hour)\b", re.I)

_TRACKS = [
    ("deutsch", re.compile(r"\b(german|deutsch|jarman|duolingo|nicos weg)\b", re.I)),
    ("silicon", re.compile(r"\b(verilog|vlsi|silicon|rtl|hdl|hdlbits|digital|systemverilog|uvm|fpga|risc ?v|electronics|chip|gate)\b", re.I)),
    ("body", re.compile(r"\b(workout|gym|exercise|training|run|running|walk|kasrat)\b", re.I)),
]

_QUESTION = re.compile(r"^\s*(did|have|has|had|should|shall|can|could|would|will|what|which|how much time|when|why|kya maine|kya mai|kitna)\b", re.I)

_BRIEF = re.compile(r"\b(brief me|briefing|mission (brief|status|report|update)|status report|aaj ka plan|aaj kya karna( hai)?|"
                    r"what('?s| is) (my|the|today'?s) (plan|mission|brief)|what should i do today|today'?s (plan|contracts|quests))\b", re.I)
_STREAK = re.compile(r"\b(my streak|streak status|kitne din (ki|ka) streak|what'?s my streak|how long is my streak)\b", re.I)
_MARKS = re.compile(r"\b(how many marks|marks (do i have|balance)|kitne marks|my marks|mark balance)\b", re.I)
_BUY = re.compile(r"\b(redeem|buy|kharid(?:o|na)?|purchase)\b\s+(.+)", re.I)
_SHOP_WORDS = re.compile(r"\b(marks|armory|reward|shop)\b", re.I)
_ARTICLE = re.compile(r"(an?|one|ek)\s+", re.I)
_FOCUS = re.compile(r"\b(start|begin|shuru|initiate|launch)\b.*\b(focus|crucible|deep work|lockdown|session|pomodoro)\b", re.I)
_CONTRACT_DONE = re.compile(r"\b(contract|quest|task)\b.*\b(done|complete|completed|finished|ho gaya|khatam|kar liya)\b"
                            r"|\b(done|completed|finished)\b.*\b(contract|quest)\b", re.I)
_LOG = re.compile(r"\b(log|logged|did|done|studied|study|padha|padhi|padhai|kiya|ki|practi[cs]ed|completed|finished|worked)\b", re.I)
_REP_DONE = re.compile(r"\b(german|deutsch|verilog|vlsi|silicon|workout|gym)\b\s*(done|ho gaya|ho gayi|complete|finished|khatam)\b", re.I)

_DEFAULT_MIN = {"deutsch": 15, "silicon": 25, "body": 45}


def _minutes(text: str) -> Optional[float]:
    if _HALF_HOUR.search(text):
        return 30.0
    m = _DUR.search(text)
    if not m:
        return None
    if m.group(1):
        n, unit = float(m.group(1)), m.group(2).lower()
    else:
        n, unit = float(_WORD_NUM.get(m.group(3).lower(), 0)), m.group(4).lower()
    if not n:
        return None
    return n * 60 if unit.startswith(("h", "g")) else n


def _track(text: str) -> Optional[str]:
    for name, rx in _TRACKS:
        if rx.search(text):
            return name
    return None


def parse(text: str) -> Optional[dict]:
    """A game action dict for an imperative/statement, or None (let the model answer)."""
    t = (text or "").strip()
    if len(t) < 3:
        return None
    if _BRIEF.search(t):
        return {"action": "brief", "args": {}}
    if _QUESTION.search(t) and not _MARKS.search(t) and not _STREAK.search(t):
        return None
    if _STREAK.search(t):
        return {"action": "streak", "args": {}}
    if _MARKS.search(t):
        return {"action": "marks", "args": {}}
    m = _BUY.search(t)
    if m and not _LOG.search(t[:m.start()]):
        after = m.group(2)
        article = _ARTICLE.match(after)
        # "redeem …" is always the Armory. "buy …" only when it is clearly a purchase
        # ("buy an anime episode", "buy … with marks") — not "buy me some time".
        if m.group(1).lower() == "redeem" or article or _SHOP_WORDS.search(t):
            query = after[article.end():] if article else after
            query = re.sub(r"\b(please|for me|from the armory|with (my )?marks)\b", "", query, flags=re.I).strip(" .!?")
            if query:
                return {"action": "buy", "args": {"query": query}}
    if _FOCUS.search(t):
        return {"action": "focus", "args": {"minutes": _minutes(t) or 50, "track": _track(t) or "silicon"}}
    if _CONTRACT_DONE.search(t):
        query = re.sub(r"\b(jarvis|hey|contract|quest|task|is|are|the|my|done|complete|completed|finished|ho gaya|khatam|kar liya|maine|mera|i|have|just)\b", " ", t, flags=re.I)
        query = re.sub(r"[^\w\s-]", " ", query)
        return {"action": "complete", "args": {"query": re.sub(r"\s+", " ", query).strip(), "utterance": t}}
    track = _track(t)
    minutes = _minutes(t)
    if track and minutes and _LOG.search(t):
        return {"action": "log", "args": {"track": track, "minutes": round(minutes)}}
    if track and minutes and track == "body":
        return {"action": "log", "args": {"track": "body", "minutes": round(minutes)}}
    if _REP_DONE.search(t) and track:
        return {"action": "log", "args": {"track": track, "minutes": _DEFAULT_MIN[track]}}
    return None


# ------------------------------------------------------------------ talking to the app
def _api():
    url, tok = os.environ.get("JARVIS_API_URL"), os.environ.get("JARVIS_API_TOKEN")
    return (url, tok) if url and tok else (None, None)


def _post(path: str, payload: dict, timeout: float = 8.0):
    import httpx
    url, tok = _api()
    return httpx.post(f"{url}{path}", json=payload, headers={"X-Jarvis-Token": tok}, timeout=timeout)


def _get(path: str, timeout: float = 0.6):
    import httpx
    url, tok = _api()
    return httpx.get(f"{url}{path}", headers={"X-Jarvis-Token": tok}, timeout=timeout)


def handle(text: str) -> Optional[str]:
    """If `text` is a game command, run it and return JARVIS's one-line answer."""
    intent = parse(text)
    if intent is None or _api()[0] is None:
        return None
    try:
        r = _post("/api/game/action", intent)
    except Exception:
        return "Mission control is not answering right now. Try again in a moment."
    if r.status_code == 200:
        return (r.json() or {}).get("say") or "Done."
    if r.status_code in (503, 504):
        return "The Mission screen isn't open, so I couldn't do that. Open the JARVIS window and say it again."
    return "The game refused that one."


_MISSION_WORDS = re.compile(
    r"\b(mission|germoney|quest|contract|boss|streak|marks|floor|crucible|focus|drill|study|studies|padhai|padhna|"
    r"german|deutsch|verilog|vlsi|exam|aps|dmat|ielts|germany|tu9|rwth|plan|aaj|today|week|internship|job|certificat\w*)\b", re.I)


def context(text: str) -> str:
    """The live mission state, when the question is about the mission (~120 tokens)."""
    if not _MISSION_WORDS.search(text or "") or _api()[0] is None:
        return ""
    try:
        r = _get("/api/game/brief")
        if r.status_code != 200:
            return ""
        b = r.json()
    except Exception:
        return ""
    data = b.get("data") or {}
    boss = data.get("boss") or {}
    lines = [
        "MISSION STATE (live from his Mission Germoney game — facts, use them):",
        "Game words: a 'boss' is this month's real deliverable; 'hurting/damaging the boss' means doing work on "
        "its track; 'the floor' is his daily minimum (Silicon 25 min, Deutsch 15 min, Body); Marks are the game's currency. "
        "His toolchain is open-source: Icarus Verilog + GTKWave, Yosys, Verilator — never suggest paid tools.",
        b.get("text", ""),
    ]
    if boss.get("deliverable"):
        lines.append(f"Boss {boss.get('name', '')} is killed by delivering: {boss['deliverable']}")
    if boss.get("nextStep"):
        lines.append(f"His next unfinished step on it: {boss['nextStep']}")
    open_contracts = [c["title"] for c in data.get("contracts", []) if not c.get("done")]
    if open_contracts:
        lines.append("Open contracts: " + "; ".join(open_contracts) + ".")
    return "\n".join(x for x in lines if x)
