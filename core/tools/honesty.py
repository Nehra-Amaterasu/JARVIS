"""A reply may only claim what a receipt shows.

The 10-10 session: asked to track his steps and to upload a file to Claude, JARVIS
said he would — he can do neither. The persona already said "never claim an action
a tool did not confirm"; a 4B model does not reliably obey a rule in a prompt. So
the reply is checked in code, sentence by sentence, before it is spoken:

  * a sentence that CLAIMS an action ("I've turned off the light", "I'll remind you
    at 9", "Message sent", "I'll keep track of your steps", "Noted.") must have a
    successful receipt of that kind from this turn, else it is replaced by what is
    true ("I haven't set a reminder; nothing was saved. Say ...");
  * a sentence that OFFERS something impossible ("Shall I text her?", "I can look it
    up online") is replaced by what JARVIS cannot do;
  * a failed receipt wins over the model's optimism: its own sentence is said.

Detection is deliberately narrow — first-person, affirmative forms (negations, "if"
clauses, explanations of how a circuit "turns off" are left alone) — because a guard
that mangles honest replies would be switched off. The test set holds both sides.

The guard releases text at exactly the points the voice would speak it
(voice.split_ready: a sentence end, or a long first clause at a comma), so first
audio is not delayed; on screen the reply now arrives a clause at a time.
"""
from __future__ import annotations

import re
from typing import Callable, Optional

from .registry import Receipt, Registry, to_him

_I_DID = r"\bI(?:'ve| have)(?:\s+(?:just|now|already|also|successfully|gone ahead and|quickly|been))*\s+"
_I_WILL = (r"(?:\bI(?:'ll| will| shall)|\bI(?:'m| am) (?:going|about) to|\blet me)"
           r"(?:\s+(?:just|now|also|go ahead and|quickly|right away|immediately|happily|gladly|definitely|"
           r"certainly|make sure to|be sure to))*\s+")
_I_PAST = r"\bI(?:\s+(?:just|also|already))?\s+"
_I_ING = r"\bI(?:'m| am)(?:\s+(?:now|currently|already|also))*\s+"
_I_CAN = (r"(?:\bI can|\bI could|\bI'd be happy to|\bhappy to|\bshall I|\bshould I|\bwant me to|"
          r"\bwould you like me to|\bdo you want me to|\bI(?:'m| am) able to)\s+(?:also\s+|just\s+)?")

_DEV = (r"(?:\s+(?:off|on|down|up))?\s+(?:(?:the|your|all\s+the|both(?:\s+the)?|a|an)\s+)?"
        r"(?:(?:[\w-]+\s+)?(?:scene|mode)\b|(?:lights?|lamps?|bulbs?|fans?|ac|air[- ]?conditioner|tv|television|"
        r"geyser|heater|everything|it|them)\b)")
# The only things a switch tool can reach. A switch claim about anything else (the AC,
# the TV, the geyser) gets "I can't control that", not "say 'light off'".
_REACHABLE = re.compile(r"\b(?:lights?|lamps?|bulbs?|fans?|scene|mode)\b", re.I)
_REM = r"(?:\s+(?:up|you))?\s+(?:a|an|the|your|that|this|one)?\s*(?:[\w-]+\s+){0,2}?(?:reminders?|alarms?|timers?)\b"
_MEDIA = (r"(?=.{0,40}\b(?:music|songs?|tracks?|playlists?|albums?|videos?|something|lo-?fi|beats|radio|"
          r"podcasts?|spotify|youtube|for you)\b)")
_NOT_YOU = r"(?!\s+(?:you|yourself)\b)"
_NOT_MEM = r"(?!.{0,25}\bmemory)"
# "tell" as in "pass a message on", not "make out". In the 10-13 eval, "I can tell your
# arms are moving" was JARVIS reading his sensors, and the guard swapped it for "I can't
# send messages". An object followed by its own verb is perceiving.
_TELL = (r"tell(?!\s+(?:your|the|that|this|if|whether|how|what|when|from|by)\b[^.?!,;]{0,30}?\b"
         r"(?:is|are|was|were|has|have|looks?|seems?|moving|bent)\b)")
_BODY = (r"(?:elbows?|knees?|shoulders?|wrists?|fingers?|thumbs?|palms?|fists?|neck|spine|hips?|ankles?|"
         r"forearms?|arms?|legs?|head|back)")
# A sentence that gives advice or a condition, not a report: "keep your elbows bent at 90
# degrees", "ideally, knees at 90 degrees", "if your back is at 30 degrees...".
_NOT_ADVICE = (r"^(?!\W*(?:keep|hold|try|make sure|bend|raise|lower|sit|stand|put|place|rest|aim|set|stretch|"
               r"ideally|if|when|while|always|never|don't|do not|you should|you could|it helps)\b)[^.?!]*?\b")


def _rx(*parts: str) -> list:
    return [re.compile(p, re.I) for p in parts]


# kind -> (assertion patterns, offer patterns)
KINDS: dict[str, tuple[list, list]] = {
    "switch": (_rx(
        _I_DID + r"(?:turned|switched|shut|dimmed|brightened|powered|set)" + _DEV,
        _I_WILL + r"(?:turn|switch|shut|dim|brighten|power|set)" + _DEV,
        _I_PAST + r"(?:turned|switched|dimmed|brightened|powered)" + _DEV,
        _I_ING + r"(?:turning|switching|shutting|dimming|brightening|powering|setting)" + _DEV,
        r"^\W*(?:lights?|fan|lamp|everything)\s+(?:off|on)\b[.!]*\s*$",
        r"\b(?:lights?|lamp|fan|ac|tv)\s+(?:has|have)\s+been\s+(?:turned|switched|set|dimmed)\b",
        # Narrated as done, no "I": "Set the air conditioner to 24 degrees." (live run, 10-12)
        r"^\W*(?:turned|switched|set|dimmed|brightened)\s+(?:off\s+|on\s+)?(?:the\s+|your\s+)?"
        r"(?:lights?|lamps?|fans?|ac|air[- ]?conditioner|tv|television|geyser|heater)\b",
    ), _rx(_I_CAN + r"(?:turn|switch|shut|dim|brighten|power|set)" + _DEV)),
    "switch_state": (_rx(
        r"^\W*(?!if\b|when\b|once\b|whenever\b|while\b|unless\b|until\b).{0,30}?\b(?:the|your)\s+(?:room\s+)?"
        r"(?:lights?|lamp|fan|ac|air[- ]?conditioner|tv)\s+(?:is|are)\s+(?:now\s+|currently\s+|already\s+|still\s+)?"
        r"(?:off|on|running|at\s+\d+|dimming|brightening|spinning|slowing|glowing)\b",
        r"^\W*(?!if\b|when\b|once\b|whenever\b|while\b|unless\b|until\b).{0,30}?\b(?:the|your)\s+room"
        r"(?:\s+temperature)?\s+(?:is|should|will|would)\s+(?:now\s+)?(?:be\s+)?(?:now\s+)?(?:\w+\s+)?"
        r"(?:cool|cooler|warm|warmer|dark|darker|bright|brighter|lit|dim|dimmer|quiet|regulated|comfortable)\b",
        # "The room will dim and the fan will slow" (live run, 10-12)
        r"^\W*(?!if\b|when\b|once\b|whenever\b|while\b|unless\b|until\b).{0,30}?\b(?:the|your)\s+"
        r"(?:room|lights?|lamp|fan)\s+will\s+(?:now\s+)?(?:dim|brighten|slow|speed up|turn|switch|go)\b",
    ), []),
    "reminder": (_rx(
        _I_DID + r"(?:set|added|created|scheduled|made|put in|saved|booked)" + _REM,
        _I_WILL + r"(?:remind|wake|ping|nudge|alert|notify|buzz)\s+you\b",
        _I_WILL + r"(?:set|add|create|schedule|make|put in|start)" + _REM,
        _I_WILL + r"(?:let you know|tell you)\s+(?:at|when|in|tomorrow|tonight|later|before|after)\b",
        _I_ING + r"(?:setting|adding|creating|scheduling|starting)" + _REM,
        r"\b(?:reminders?|alarms?|timers?)\s+(?:is\s+|are\s+|has\s+been\s+|have\s+been\s+)?(?:now\s+)?"
        r"(?:set|added|created|scheduled|started|running)\b",
    ), _rx(_I_CAN + r"(?:remind|wake|set|add|create|schedule)\b")),
    "schedule": (_rx(
        _I_DID + r"(?:scheduled|arranged|booked in|lined up|queued up)\b",
        _I_WILL + r"(?:schedule|arrange|line up)\b",
        _I_ING + r"(?:scheduling|arranging)\b",
        r"\b(?:is|are|has been|have been)\s+(?:now\s+)?scheduled\b",
    ), []),
    "message": (_rx(
        _I_DID + r"(?:sent|messaged|texted|emailed|e-mailed|forwarded|replied|called|rung|phoned|"
        r"whatsapp(?:'d|ed)|dropped (?:her|him|them) a (?:line|message|text)|told|informed|notified|"
        r"let\s+(?!you\b)\w+(?:\s+\w+)?\s+know)" + _NOT_YOU,
        _I_WILL + r"(?:send|message|text|email|e-mail|forward|reply to|call|ring|phone|whatsapp|"
        r"drop (?:her|him|them) a|tell|inform|notify|let\s+(?!you\b)\w+(?:\s+\w+)?\s+know)\b" + _NOT_YOU,
        _I_PAST + r"(?:sent|messaged|texted|emailed|forwarded|phoned|whatsapped)" + _NOT_YOU,
        # "I’ll make sure your brother knows you’ll call him later" (live run, 10-12)
        _I_WILL + r"(?:make sure|ensure|see to it)\s+(?:that\s+)?(?!you\b)(?:your\s+|the\s+)?\w+\s+"
        r"(?:knows|hears|gets the message|is told|finds out)\b",
        _I_WILL + r"pass\s+(?:it|that|this|the message|your message|that message)(?:\s+on)?\b",
        _I_DID + r"passed\s+(?:it|that|this|the message|your message)(?:\s+on)?\b",
        _I_ING + r"(?:sending|messaging|texting|emailing|forwarding|calling|phoning)" + _NOT_YOU,
        r"\b(?:message|text|email|e-mail|whatsapp|sms)\s+(?:has\s+been\s+|was\s+|is\s+)?(?:sent|delivered)\b",
    ), _rx(_I_CAN + r"(?:send|message|text|email|e-mail|forward|call|ring|phone|whatsapp|" + _TELL + r"|inform|"
           r"notify|let\s+(?!you\b)\w+(?:\s+\w+)?\s+know)\b" + _NOT_YOU)),
    "track": (_rx(
        _I_WILL + r"(?:keep\s+(?:a\s+)?(?:track|tabs|an eye|a log|a record|count)|track|monitor|watch over|log|"
        r"record|count|measure)\b",
        _I_ING + r"(?:tracking|monitoring|logging|recording|counting|measuring|watching (?:over\s+)?(?:you|your|the)|"
        r"keeping (?:track|tabs|an eye|count))\b",
        _I_DID + r"(?:started\s+)?(?:tracking|monitoring|logging|recording|logged|recorded|tracked|counted|measured)\b",
        _I_PAST + r"(?:logged|recorded|tracked|counted|measured)\b",
    ), _rx(_I_CAN + r"(?:track|monitor|log|record|count|measure|keep track)\b")),
    "web": (_rx(
        _I_DID + r"(?:searched|googled|browsed|checked\s+online|looked\s+(?:it\s+|that\s+|this\s+)?up" + _NOT_MEM
        + r"|uploaded|downloaded|booked|ordered|bought|purchased|paid|transferred|installed|subscribed|posted|"
        r"tweeted|fetched)\b",
        _I_WILL + r"(?:search(?!\s+(?:your|my|his)\s+memor)|google|browse|check\s+online|look\s+(?:it\s+|that\s+|"
        r"this\s+)?up" + _NOT_MEM + r"|upload|download|book|order|buy|purchase|pay(?!\s+attention)|transfer|install|"
        r"subscribe|post|tweet|fetch)\b",
        _I_ING + r"(?:searching(?!\s+(?:your|my|his)\s+memor)|googling|browsing|uploading|downloading|booking|"
        r"ordering|buying|paying(?!\s+attention)|transferring|installing)\b",
        _I_PAST + r"(?:searched|googled|browsed|uploaded|downloaded|booked|ordered|bought|purchased|paid|"
        r"transferred|installed)\b",
        r"\b(?:according to|as per)\s+(?:the\s+)?(?:latest|today'?s|current|recent|live)\b",
        r"\b(?:today'?s|current|the latest|live)\s+(?:weather|forecast|news|headlines|scores?|prices?|rates?)\s+"
        r"(?:is|are|shows?|says?)\b",
        r"^\W*(?:uploaded|downloaded|booked|ordered|paid|purchased)\b",
        # An inbox he never connected, read out as if it were real.
        r"\byou have \d+\s+(?:new\s+|unread\s+)?(?:emails?|mails?|notifications?|missed calls?|whatsapp messages?)\b",
    ), _rx(_I_CAN + r"(?:search(?!\s+(?:your|my|his)\s+memor)|google|browse|look\s+(?:it\s+|that\s+)?up"
           + _NOT_MEM + r"|upload|download|book|order|buy|purchase|pay(?!\s+attention)|install|post|"
           r"check\s+(?:online|the\s+(?:weather|news|price|score)))\b")),
    "media": (_rx(
        _I_WILL + r"(?:play|put on|queue(?:\s+up)?|stream|blast|start playing)\b" + _MEDIA,
        _I_DID + r"(?:played|queued(?:\s+up)?|put on|started playing|streamed)\b" + _MEDIA,
        _I_ING + r"(?:playing|queuing|queueing|streaming)\b" + _MEDIA,
        r"^\W*(?:now\s+)?playing\b", r"\bnow playing\b",
    ), _rx(_I_CAN + r"(?:play|put on|queue|stream)\b" + _MEDIA)),
    "memory": (_rx(
        _I_WILL + r"(?:remember|keep\s+(?:that|this|it)\s+in\s+mind|make\s+a\s+note|note\s+(?:that|this|it)|"
        r"save\s+(?:that|this|it)\b|store\s+(?:that|this|it)\b|add\s+(?:that|this|it)\s+to\s+(?:my|your)\s+memory|"
        r"never\s+forget|commit\s+(?:that|this|it)\s+to\s+memory)\b",
        _I_DID + r"(?:saved|stored|noted|remembered|made\s+a\s+note|written\s+(?:that|this|it)\s+down|"
        r"added\s+(?:that|this|it)\s+to\s+(?:my|your)\s+memory|committed\s+(?:that|this|it)\s+to\s+memory|"
        r"memori[sz]ed)\b",
        _I_PAST + r"(?:noted|saved|stored|memori[sz]ed)\b",
        r"^\W*(?:noted|duly noted|got it,?\s*noted|memory updated|saved to memory)\W*$",
        r"\b(?:saved|stored|added)\s+(?:that\s+|it\s+|this\s+)?(?:to|in)\s+(?:my|your)\s+memory\b",
    ), []),
    "presence": (_rx(
        r"\bI\s+(?:can\s+)?(?:see|sense|detect|spot|notice)\s+(?:that\s+)?(?:you(?:'re| are)?|someone|somebody|"
        r"nobody|no one|a person|people|\w+ people|movement|motion)\b.{0,40}\b(?:in the room|at (?:the|your) desk|"
        r"in bed|on the bed|on the sofa|by the door|sitting|standing|lying|moving|walking|asleep|sleeping|here)\b",
        r"\b(?:the|your)\s+room\s+(?:is|looks|seems)\s+(?:empty|occupied)\b",
        r"\bthere(?:'s| is| are)\s+(?:someone|somebody|nobody|no one|\w+ people)\s+in\s+(?:the|your)\s+room\b",
        r"\b(?:sensors|aankhen)\s+(?:show|shows|say|says|see|sees|detect|detects)\b",
    ), []),
    "lookup": (_rx(
        r"\blet me (?:just\s+)?(?:check|find out|have a look|take a look|look into|pull (?:that|it) up)\b[^.?!,]*[,.]?",
        r"\bI'll (?:just\s+)?(?:check|find out|have a look|take a look|look into)\b[^.?!,]*[,.]?",
        r"^\W*(?:one|just a)\s+(?:moment|second|sec)\b[^.?!]*[.!]?",
        r"\bgive me a (?:moment|second|sec)\b[^.?!]*[,.!]?",
    ), []),
    # Body detail no sensor here produces. 10-12, asked to describe his movement, the
    # model said "elbows bent at 140 degrees, shoulders relaxed, arms slightly
    # outstretched": one Wi-Fi link sees that a body moved, never how it is bent. No tool
    # backs this kind, so a claim is always replaced. Advice is left alone ("keep your
    # elbows at 90 degrees while you type" has no copula and starts with a verb).
    "perception": (_rx(
        r"\b(?:your|his)\s+(?:left\s+|right\s+|both\s+)?" + _BODY + r"\s+(?:is|are|'re|'s|sits?|stays?|looks?)\s+"
        r"(?:\w+\s+){0,3}?(?:at\s+|to\s+|by\s+)?(?:about\s+|around\s+|roughly\s+|nearly\s+)?\d{1,3}(?:\.\d+)?\s*"
        r"(?:°|degrees?\b)",
        _NOT_ADVICE + _BODY + r"\s+(?:bent|angled|raised|held|tilted|turned|rotated|flexed|lifted)\s+"
        r"(?:at|to|by)\s+(?:about\s+|around\s+|roughly\s+|nearly\s+)?\d{1,3}(?:\.\d+)?\s*(?:°|degrees?\b)",
        r"\bI\s+(?:can\s+)?(?:see|saw|sense[ds]?|detect(?:ed)?|spot(?:ted)?|notice[ds]?|tell|read)\s+(?:that\s+)?"
        r"(?:you(?:'re|\s+are)?|your)\b[^.?!]{0,50}?\b(?:smil\w*|frown\w*|grin\w*|blink\w*|wink\w*|eyebrows?|"
        r"expression|face|fingers?|thumbs?|fists?|posture|slouch\w*|hunch\w*|elbows?|knees?|wrists?|shoulders?)\b",
        r"\b(?:your|his)\s+(?:posture|facial expression|expression|face|fingers?|elbows?|shoulders?|knees?)\s+"
        r"(?:is|are|look|looks|seem|seems)\s+(?:\w+\s+){0,2}?(?:relaxed|tense|straight|bent|curled|crossed|"
        r"slumped|hunched|upright|raised|lowered|clenched)\b",
        # Fine detail credited to the sensors. 10-13 eval: "Aankhen reckons you've been at the
        # desk for over an hour, sir, your head is tilted, eyes fixed on the screen."
        r"\b(?:aankhen|my sensors|the sensors|my staff|I can see|I see|I notice|I spot|I detect)\b[^.?!]{0,80}?"
        r"\b(?:head is|head's|eyes are|eyes fixed|eyes glued|gaze|staring|tilted|leaning|slouch\w*|hunch\w*|"
        r"frown\w*|smil\w*|fingers?|elbows?|posture|face)\b",
    ), []),
    "generic": (_rx(
        r"^\W*(?:done|all done|all set|consider it done|sorted|right away|on it|will do|it'?s done|that'?s done|"
        r"taken care of|done and done)\b(?:\s*[,!.-]\s*(?:sir|aman|boss))?\W*$",
        _I_DID + r"(?:done|taken care of|handled|sorted|completed|finished|fixed|got it done)\s+"
        r"(?:it|that|this|everything|the rest)\b",
        _I_WILL + r"(?:do|handle|take care of|sort out|sort|get on|see to)\s+(?:it|that|this|everything)\b",
    ), []),
}

# What to say instead. HAVENT: something could do it, nothing did. CANNOT: nothing can.
HAVENT = {
    "switch": "I haven't switched anything yet; say, for example, \"light off\" and I will.",
    "switch_state": "I haven't checked the light and fan, so I can't say how they are.",
    "reminder": "I haven't set a reminder; nothing was saved. Say, for example, \"remind me at 9 to call Mum\".",
    "schedule": "I haven't scheduled anything; nothing was saved. Say, for example, \"remind me at 9 to call Mum\".",
    "message": "I haven't sent anything.",
    "track": "I haven't logged that. What I keep is study time you report, like \"log 2 hours of German\", and "
             "Aankhen's record of where you were and how much you moved.",
    "perception": "I can't see that much detail: Aankhen's Wi-Fi tells me where you are and roughly how you're "
                  "moving, not angles, fingers or faces.",
    "memory": "I haven't saved that. Say \"remember that …\" and I'll keep it.",
    "presence": "I haven't checked the room sensors, so I can't say who is there.",
    "media": "I haven't played anything.",
    "web": "I haven't done that.",
    "generic": "I haven't done anything yet.",
    "lookup": "",
}
CANNOT_SAY = {
    "switch": "I can't switch things in the room right now.",
    "switch_state": "I can't see the light and fan right now.",
    "reminder": "I can't set reminders right now.",
    "schedule": "I can't schedule things right now.",
    "message": "I can't send messages, emails or calls for you.",
    "track": "I can't track that on my own. What I keep is study time you report, like \"log 2 hours of "
             "German\", and Aankhen's record of where you were and how much you moved.",
    "perception": "I can't see that much detail: Aankhen's Wi-Fi tells me where you are and roughly how you're "
                  "moving, not angles, fingers or faces.",
    "web": "I have no internet access, so I can't search, see news or weather, upload, book or buy anything.",
    "media": "I can't play music or videos yet.",
    "memory": "I haven't saved that. Say \"remember that …\" and I'll keep it.",
    "presence": "I can't see who is in the room right now.",
    "generic": "I haven't done anything yet.",
    "lookup": "",
}
UNREACHABLE = "I can't control that from here; I can only switch the room's light and fan."
SIM_NOTE = {"switch": "Virtual room only; no relay board is connected.",
            "switch_state": "Virtual room only; no relay board is connected."}

# A sentence end, as voice.split_ready sees it (kept identical on purpose).
_SENTENCE_END = re.compile(r"(?<!\d)[.?!।…]+[\"')\]]*(?=\s|$)")
EARLY_FLUSH_WORDS = 8
_TAG = re.compile(r"\[/?(?:uk|british|gb|us|american|usa|hi|hindi|in|indian)\]", re.I)


def split_ready(buffer: str, first: bool) -> tuple[str, str]:
    """voice.split_ready, duplicated so this module has no audio imports."""
    last = None
    for m in _SENTENCE_END.finditer(buffer):
        last = m
    if last is not None:
        return buffer[:last.end()], buffer[last.end():]
    if first:
        comma = buffer.rfind(",")
        if comma > 0 and len(buffer[:comma].split()) >= EARLY_FLUSH_WORDS:
            return buffer[:comma + 1], buffer[comma + 1:]
    return "", buffer


# For judging (not for releasing): a number can end a sentence when a capital follows
# ("... on 12 October 2026. I'll remind you"), so a claim is not judged together with
# the honest sentence before it.
_ENDS_SENTENCE = re.compile(r"[.?!।…][\"')\]]*\s*$")
_JUDGE_END = re.compile(r"(?<!\d)[.?!।…]+(?:\[/[a-z]+\])?[\"')\]]*(?=\s|$)|(?<=\d)\.(?=\s+[A-Z\[\"'])", re.I)


def sentences(text: str) -> list[str]:
    """Split keeping each sentence's leading whitespace, so joining restores the text."""
    out, pos = [], 0
    for m in _JUDGE_END.finditer(text):
        out.append(text[pos:m.end()])
        pos = m.end()
    if pos < len(text):
        out.append(text[pos:])
    return [s for s in out if s]


_CURLY = str.maketrans({"’": "'", "‘": "'", "ʼ": "'"})


def plain(text: str) -> str:
    """Typographic apostrophes as straight ones: the live model writes "I’ve" as often
    as "I've", and a pattern for one missed the other (10-12, "I’ve done that for you")."""
    return (text or "").translate(_CURLY)


def claims(sentence: str) -> list[tuple[str, str]]:
    """[(kind, "assert" | "offer")] that a sentence makes, in kind order."""
    s = plain(_TAG.sub("", sentence)).strip()
    if not s:
        return []
    question = s.rstrip().endswith("?")
    found = []
    for kind, (asserts, offers) in KINDS.items():
        if not question and any(p.search(s) for p in asserts):
            found.append((kind, "assert"))
        elif any(p.search(s) for p in offers) or (question and any(p.search(s) for p in asserts)):
            found.append((kind, "offer"))
    return found


def _backed(kind: str, receipts: list[Receipt]) -> list[Receipt]:
    ok = [r for r in receipts if r.ok]
    if kind == "lookup":
        return ok
    if kind == "generic":
        return [r for r in ok if r.tier in ("T1", "T2")]
    if kind == "switch_state":
        return [r for r in ok if {"switch", "switch_state"} & set(r.backs)]
    return [r for r in ok if kind in r.backs]


class Verdict:
    __slots__ = ("kind", "mode", "original", "replacement")

    def __init__(self, kind, mode, original, replacement):
        self.kind, self.mode, self.original, self.replacement = kind, mode, original, replacement

    def __repr__(self):
        return f"Verdict({self.kind}, {self.mode}, {self.original!r} -> {self.replacement!r})"


def honest_line(kind: str, registry: Registry, receipts: list[Receipt]) -> str:
    failed = [r for r in receipts if not r.ok and registry.get(r.tool) is not None
              and kind in registry.get(r.tool).backs]
    if failed:
        return failed[-1].did
    if registry.can(kind):
        return HAVENT.get(kind, "")
    off = [t for t in registry.tools_backing(kind) if not t.enabled]
    if off:
        return f"I can't {to_him(off[0].capability)}: that is switched off."
    return CANNOT_SAY.get(kind, "")


_SAYS_SIM = re.compile(r"virtual|simulat", re.I)


def sim_note(state: dict, text_so_far: str) -> str:
    """The virtual-room note, once, at the END of a reply — and only if the reply never
    said so itself. (Inserted after the first claim, it was said twice when the model
    mentioned the virtual room a sentence later: live run, 10-12.)"""
    note = state.pop("sim_pending", None)
    return "" if not note or _SAYS_SIM.search(text_so_far) else " " + note


def check(text: str, registry: Registry, receipts: list[Receipt], log: Optional[list] = None,
          state: Optional[dict] = None) -> str:
    """The text with every unbacked claim and impossible offer replaced. `state`
    carries per-reply memory across streamed pieces (lines already said, a pending
    virtual-room note); without it, the text is treated as the whole reply."""
    whole = state is None
    state = state if state is not None else {}
    said = state.setdefault("said", set())
    out = []
    for sent in sentences(text):
        lead = sent[:len(sent) - len(sent.lstrip())]
        body = sent.strip()
        found = claims(body)
        if not found:
            out.append(sent)
            continue
        replace, drop_lookup = [], False
        for kind, mode in found:
            backing = _backed(kind, receipts)
            if mode == "offer" and registry.can(kind):
                continue                                  # offering what a tool really does is fine
            if mode == "assert" and backing:
                # Backed, but only by a virtual room: he must hear that, once (sim_note).
                if kind in SIM_NOTE and all(r.simulated for r in backing):
                    state.setdefault("sim_pending", SIM_NOTE[kind])
                continue
            line = honest_line(kind, registry, receipts)
            if kind == "switch" and line == HAVENT["switch"] and not _REACHABLE.search(plain(body)):
                line = UNREACHABLE                        # the AC, the TV: no tool reaches them at all
            if log is not None:
                log.append(Verdict(kind, mode, body, line))
            if kind == "lookup":
                drop_lookup = True                        # "let me check" with nothing checked: drop the words
            else:
                replace.append((kind, line))
        if replace:
            # "Done" next to a specific correction (or after one) adds nothing but noise.
            if len(replace) > 1 or state.get("corrected"):
                replace = [(k, ln) for k, ln in replace if k != "generic"] or []
            lines = [ln for ln in dict.fromkeys(ln for _, ln in replace) if ln and ln not in said]
            said.update(lines)
            if lines:
                out.append(lead + " ".join(lines))
                state["corrected"] = True
            continue
        if drop_lookup:
            body = plain(body)
            for p in KINDS["lookup"][0]:
                body = p.sub("", body)
            body = re.sub(r"^\W+", "", body).strip()
            if not body:
                continue
            body = body[0].upper() + body[1:]
        out.append(lead + body)
    result = "".join(out)
    return result + sim_note(state, result) if whole else result


class Guard:
    """Streams a reply through check(), releasing text where the voice would speak it.

    hold_claims: in a round where the model may still call tools, a sentence that
    makes a claim is held (with everything after it, to keep the order) until
    settle() — by then the tools have run and their receipts can back it."""

    def __init__(self, registry: Registry, receipts: list[Receipt], hold_claims: bool = False,
                 split: Optional[Callable[[str, bool], tuple[str, str]]] = None):
        self.registry, self.receipts = registry, receipts
        self.hold_claims = hold_claims
        self.split = split or split_ready
        self.buf = ""
        self.held: list[str] = []
        self.released = ""
        self.verdicts: list[Verdict] = []
        self._state: dict = {}

    def emit(self, text: str) -> str:
        """Check and release `text` now (also used for a reply built from receipts)."""
        out = check(text, self.registry, self.receipts, self.verdicts, self._state)
        if out and not self.released and out.strip():
            out = out.lstrip()
        self.released += out
        return out

    def feed(self, chunk: str) -> str:
        if not chunk:
            return ""
        self.buf += chunk
        ready, self.buf = self.split(self.buf, not self.released.strip())
        if not ready:
            return ""
        if not _ENDS_SENTENCE.search(ready) and claims(ready):
            # An early comma flush of a clause that claims something: judge the whole
            # sentence instead, or its tail is orphaned ("... 2026. I'll make sure",
            # live run, 10-12). Costs the early start on this one sentence only.
            self.buf = ready + self.buf
            return ""
        if self.held or (self.hold_claims and claims(ready)):
            self.held.append(ready)
            return ""
        return self.emit(ready)

    def settle(self) -> str:
        """Tools have run: release what was held, judged against the receipts."""
        held, self.held = "".join(self.held), []
        return self.emit(held) if held else ""

    def finish(self) -> str:
        rest, self.buf = self.buf, ""
        out = self.settle()
        if rest.strip():
            out += self.emit(rest)
        if not self.released.strip() and self.verdicts:
            fallback = honest_line(self.verdicts[0].kind, self.registry, self.receipts) or \
                "I haven't done anything yet."
            self.released += fallback
            out += fallback
        note = sim_note(self._state, self.released)
        self.released += note
        return out + note


def unbacked(text: str, registry: Registry, receipts: list[Receipt]) -> list[tuple[str, str, str]]:
    """[(kind, mode, sentence)] for every claim in `text` no receipt backs — what the
    tests (and a transcript audit) use to say "this reply lied"."""
    bad = []
    for sent in sentences(text):
        for kind, mode in claims(sent):
            if mode == "offer":
                if not registry.can(kind):
                    bad.append((kind, mode, sent.strip()))
            elif not _backed(kind, receipts):
                bad.append((kind, mode, sent.strip()))
    return bad
