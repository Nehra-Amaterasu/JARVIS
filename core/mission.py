"""Mission Germoney from JARVIS's side: voice commands for the game, and the live
mission state for his prompt.

The plan (Mission v2, the skill tree) runs in the server, so these work with the
window closed (POST /api/mission/voice):

    "Jarvis, brief me" / "what's today's contract"  -> today's first contract, then the rest
    "explain this contract"                 -> what to read first, the steps, the hint, the check
    "I finished it" / "contract done: …"    -> that contract completed (a voice claim, amber)
    "what's next on the tree"               -> the node to resume, or the best one to start
    "exam mode for DSP" / "exam mode off"   -> contracts switch to that subject's units + PYQs
    "how many days to EMT"                  -> days left to that exam
    "park an idea: a GPU in a weekend"      -> the parking lot, so the idea stops pulling
    "what internship deadlines are coming up" -> the pipeline's next closing dates
    "weekly review" / "how did my week go"  -> the Well Wisher weekly review: totals, moved, stalled, one change
    "what's my next career step"            -> the career engine's top step, with the days left
    "log 2 hours of German"                 -> the one log (XP now; the Deutsch rep ticks when the window syncs)
    "maine 45 minute verilog kiya"          -> 45 min of Silicon logged

The Floor, Marks and the Crucible still run in the window (POST /api/game/action):

    "start a 50 minute focus on German"     -> a Crucible starts in the app
    "how many marks do I have"              -> balance and what it buys
    "redeem an anime episode"               -> bought in the Armory

Parsing is deterministic regex, not the model. The 4B model is good at talking and
bad at structured actions; "log 2 hours" must never be heard as something else, and
it must be instant. Questions ("did I log German today?") are NOT actions — they go
to the model with the mission state in its prompt instead. Outside the app (no
JARVIS_API_URL) every function quietly does nothing.
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

# ---- Mission v2 plan intents (answered by the server; the window is not needed)
_TODAY_CONTRACT = re.compile(r"\b(what('?s| is) (my |today'?s |the )?(contracts?|task)( for today| today)?|today'?s contracts?|"
                             r"aaj ka contract|read (me )?my contracts?|what('?s| is) on (for )?today)\b", re.I)
_EXPLAIN = re.compile(r"\b(explain (this|the|my|today'?s|that)?\s*(contract|task|one)|how do i (do|start) (this|it|the contract)|"
                      r"(contract|ye|yeh) samjha(o|do)|what do i do (first )?for (this|it))\b", re.I)
_FINISHED_IT = re.compile(r"^\s*(jarvis,?\s*)?(i('?ve| have)?\s+(just\s+)?(finished|completed|done)\s+(it|that|this)(\s+one)?|"
                          r"done with (it|that|this)|finished it|(it'?s|that'?s) done|ho gaya|kar liya|khatam)\b", re.I)
_NEXT_NODE = re.compile(r"\b(what('?s| is) next on (the|my) (skill )?tree|next (skill|node)( on the tree)?|what should i learn next|"
                        r"next on the tree|tree (pe|par) (aage )?kya)\b", re.I)
_EXAM_MODE = re.compile(r"\bexam mode\b(?:\s+(on|off))?(?:\s+(?:for|on))?\s*(.*)$", re.I)
_DAYS_TO = re.compile(r"\bhow (?:many|much) days?\s+(?:are\s+)?(?:left\s+)?(?:to|until|till|before|for)\s+(.*?)\s*\??$"
                      r"|\bkitne din\s+(?:bache\s+|hain\s+)?(.*?)\s*\??$", re.I)
_PARK = re.compile(r"^\s*(?:jarvis,?\s*)?park\b(?:\s+(?:an?|this|the|my)?\s*idea)?\s*[:,-]?\s*(.+)$", re.I)
_DEADLINES = re.compile(r"\b(internship|application)s?\b.*\b(deadlines?|due|closing|close)\b|\b(deadlines?)\b.*\b(internship|application)s?\b"
                        r"|\bwhat('?s| is| are)? (coming up|due)\b.*\b(apply|applications?|internships?)\b", re.I)
_WEEKLY = re.compile(r"\b(weekly review|week(ly)? in review|review (of )?(my|the|this) week|how did (my|the|this) week go|"
                     r"week ka review|hafte ka review)\b", re.I)
_CAREER_NEXT = re.compile(r"\b(next career (step|move|action)|what('?s| is) my next career (step|move)|career (step|move) next)\b", re.I)
_EXAM_FILLER = re.compile(r"\b(my|the|next|exams?|paper|left|mein|me|tak|hain|bache)\b", re.I)


def _plan(intent: str, action: str, **args) -> dict:
    return {"action": action, "via": "plan", "intent": intent, "args": args}


_LEARNING = re.compile(r"^\s*(?:jarvis,?\s*)?(?:log|note)\s*[:\-]\s*(.+)$", re.I)


def parse_plan(text: str) -> Optional[dict]:
    """A plan intent (answered by the server), or None."""
    t = (text or "").strip()
    m = _LEARNING.match(t)
    if m and len(m.group(1).strip()) > 3:               # "Jarvis, log: watched a lecture on systolic arrays, 40 min"
        body = m.group(1).strip(" .")
        mins = _minutes(body)
        what = _DUR.sub("", _HALF_HOUR.sub("", body)).strip(" ,.-")
        return _plan("learning", "learning", text=what or body, minutes=round(mins) if mins else 0)
    m = _PARK.match(t)
    if m and m.group(1).strip(" .,:"):
        return _plan("park", "park", text=m.group(1).strip(" .,:"))
    if _WEEKLY.search(t):
        return _plan("weekly_review", "weekly_review")
    if _CAREER_NEXT.search(t):
        return _plan("career_next", "career_next")
    if _DEADLINES.search(t):
        return _plan("deadlines", "deadlines")
    if _EXPLAIN.search(t):
        return _plan("explain", "explain")
    if _NEXT_NODE.search(t):
        return _plan("next_node", "next_node")
    m = _EXAM_MODE.search(t)
    if m:
        subj = (m.group(2) or "").strip(" .?!")
        if (m.group(1) or "").lower() == "off" or subj.lower() in ("off", "band", "band karo"):
            return _plan("exam_mode", "exam_mode", subject=None)
        if subj:
            return _plan("exam_mode", "exam_mode", subject=subj)
    m = _DAYS_TO.search(t)
    if m:
        subj = m.group(1) if m.group(1) is not None else (m.group(2) or "")
        subj = re.sub(r"\s+", " ", _EXAM_FILLER.sub(" ", subj)).strip(" .?!")
        return _plan("days_to", "days_to", subject=subj)
    if _TODAY_CONTRACT.search(t) or _BRIEF.search(t):
        return _plan("today", "brief")
    if _FINISHED_IT.search(t):
        return _plan("finish", "complete", query="", utterance=t)
    return None


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
    if _REP_DONE.search(t) and _track(t):         # "german ho gaya" is a log, not "I finished it"
        trk = _track(t)
        return _plan("log", "log", track=trk, minutes=round(_minutes(t) or _DEFAULT_MIN[trk]))
    plan = parse_plan(t)
    if plan is not None:
        return plan
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
        return _plan("finish", "complete", query=re.sub(r"\s+", " ", query).strip(), utterance=t)
    track = _track(t)
    minutes = _minutes(t)
    if track and minutes and _LOG.search(t):
        return _plan("log", "log", track=track, minutes=round(minutes))
    if track and minutes and track == "body":
        return _plan("log", "log", track="body", minutes=round(minutes))
    if _REP_DONE.search(t) and track:
        return _plan("log", "log", track=track, minutes=_DEFAULT_MIN[track])
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
    if intent.get("via") == "plan":
        try:
            r = _post("/api/mission/voice", {"intent": intent["intent"], "args": intent["args"]})
        except Exception:
            return "Mission control is not answering right now. Try again in a moment."
        if r.status_code == 200:
            return (r.json() or {}).get("say") or "Done."
        return "Mission control couldn't do that one."
    try:
        r = _post("/api/game/action", {"action": intent["action"], "args": intent["args"]})
    except Exception:
        return "Mission control is not answering right now. Try again in a moment."
    if r.status_code == 200:
        return (r.json() or {}).get("say") or "Done."
    if r.status_code in (503, 504):
        return "The Mission screen isn't open, so I couldn't do that. Open the JARVIS window and say it again."
    return "The game refused that one."


# Game words are enough on their own; generic words need company. Until 2026-10-09 one
# "aaj" ("bhai aaj thak gaya hoon") pulled the whole game state into a conversation
# about being tired, and the model recited shields and contracts at him.
_GAME_WORDS = re.compile(r"\b(mission|germoney|quest|contract|boss|streak|marks|floor|crucible|drill|brief)\b", re.I)
_TOPIC_WORDS = re.compile(
    r"\b(focus|study|studies|padhai|padhna|german|deutsch|verilog|vlsi|exam|aps|dmat|ielts|germany|tu9|rwth|"
    r"plan|aaj|today|week|internship|job|certificat\w*)\b", re.I)


def is_about_mission(text: str) -> bool:
    t = text or ""
    if _GAME_WORDS.search(t):
        return True
    return len({m.group(0).lower() for m in _TOPIC_WORDS.finditer(t)}) >= 2


def context(text: str) -> str:
    """The live mission state, when the question is about the mission (~120 tokens)."""
    if not is_about_mission(text) or _api()[0] is None:
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
    try:                                            # the plan (skill tree) answers even with the window closed
        t = _get("/api/mission/today")
        d = t.json() if t.status_code == 200 else {}
        plan_open = [c["title"] for c in (d or {}).get("contracts", []) if isinstance(c, dict) and c.get("title") and not c.get("done")]
        open_contracts = plan_open or open_contracts
        exam = (d or {}).get("exam")
        if isinstance(exam, dict) and isinstance(exam.get("subject"), dict):
            lines.append(f"Exam mode: {exam['subject'].get('name')}, {exam.get('days_left')} days left.")
        wb = (d or {}).get("welcome_back")
        if isinstance(wb, dict) and wb.get("idle_days"):
            lines.append(f"He is back after {wb['idle_days']} idle days: welcome him warmly, offer one small first win, no guilt.")
    except Exception:
        pass
    try:                                            # how to talk to him about the work (his profile's style rules)
        pr = _get("/api/mission/profile")
        rules = (pr.json() or {}).get("rules") if pr.status_code == 200 else None
        if isinstance(rules, list) and rules:
            lines.append("HIS STYLE (follow it): " + "; ".join(str(r) for r in rules[:6]) + ".")
    except Exception:
        pass
    if open_contracts:
        lines.append("Open contracts: " + "; ".join(dict.fromkeys(open_contracts)) + ".")
    return "\n".join(x for x in lines if x)
