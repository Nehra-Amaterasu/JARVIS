"""Expert Agentic brain for JARVIS (v2.0). 
Features: Mem0 Injection, Hinglish Persona, Zero-Latency Streaming.
"""
from typing import Optional
from datetime import datetime
from langchain_ollama import ChatOllama
from langchain_core.messages import SystemMessage, HumanMessage, AIMessage, ToolMessage
from collections import deque
import re
import room
import remember               # "remember that ..." / "... yaad rakhna" (deterministic)
import voice as voice_mod      # accents, tags, explicit accent requests (pure helpers)
import yaadash_v2 as yaadash_core  # v2: LanceDB + CPU bge-small, no :8000 server, no graph
try:
    # Episodic recall + people layer. Optional: needs the archive built by
    # yaadash_archive.py + yaadash_people.py. JARVIS runs without it.
    import yaadash_recall
except Exception as _e:
    yaadash_recall = None
    print(f"[Yaadash recall unavailable: {_e}]")
try:
    import yaadash_beliefs   # inferred claims + active learning (Steps 8-9)
except Exception as _e:
    yaadash_beliefs = None
    print(f"[Yaadash beliefs unavailable: {_e}]")
try:
    import knowledge         # verified notes from the drill decks (VLSI, Germany ops)
except Exception as _e:
    knowledge = None
    print(f"[Verified notes unavailable: {_e}]")
try:
    import mission           # Mission Germoney: voice commands + live mission state
except Exception as _e:
    mission = None
    print(f"[Mission bridge unavailable: {_e}]")
import os
import sys
import threading
import time

# One registry for everything JARVIS can do (core/tools): tiers, receipts, the
# capability list in his persona, and the honesty guard on every model reply.
from tools import honesty
from tools import when as when_mod
from tools.builtin import ToolContext, default_registry, say as say_receipts
from tools.registry import Receipt

# The Local Brain — Qwen3-4B-Instruct-2507 (NON-reasoning).
#
# History:
#   2026-07-24  llama3.1:8b -> qwen3:4b. 8B spilled 22% to CPU (20 tok/s); 4B fits
#               100% on GPU at 50 tok/s.
#   2026-10-08  qwen3:4b -> qwen3:4b-instruct-2507. qwen3:4b is a HYBRID reasoning
#               model: it deliberates before every reply. In this Ollama build neither
#               langchain's reasoning=False nor the API's think=False stops it — a
#               direct test with think=False returned "We are in a roleplay where I am
#               JARVIS..." as the answer itself, i.e. the reasoning just moved into the
#               reply. Hidden inside <think> tags in the live loop, it cost ~1000 tokens
#               (~20s at 50 tok/s) of silence before every answer: the 22s floor the
#               user reported. Prefill was ruled out — 264 prompt tokens took 0.5s.
#               Instruct-2507 is the same size with no thinking mode at all.
#               A/B through the real run_agent path, same memory and prompt:
#                   "tell me my name"      first token 52.6s -> 0.6s
#                   anime + music (2 qs)   first token 30.8s -> 0.6s (3.3s total)
#                   aadhaar number         first token 97.6s -> 0.7s (4.9s total)
#               Both answered correctly — correctness came from the retrieval fixes,
#               speed came from this swap.
#   2026-10-13  chosen in the app (Connect -> Brain), handed over as JARVIS_BRAIN_MODEL
#               and applied when JARVIS restarts; unset, it is still the model above.
import user_settings            # core/user_settings.py: the app's choices, read live
BRAIN_MODEL = user_settings.brain_model(os.environ)
llm = ChatOllama(
    model=BRAIN_MODEL,
    temperature=0.7,   # Qwen's recommended setting for Instruct-2507
    num_ctx=8192,
    num_predict=400,     # hard cap on reply length — see llm_precise below
    repeat_penalty=1.1,
    keep_alive="30m",  # Keep weights resident. Without this Ollama evicts after 5
                       # min and the next reply pays a full cold load (measured
                       # 124.6s on 2026-10-08) — fatal for a voice assistant.
)
# Same model and weights at low temperature, used for turns grounded in retrieved
# memory. At 0.7 the model embroidered real excerpts into invented stories; when
# the job is "report what the record says", creativity is the failure mode.
llm_precise = ChatOllama(
    model=BRAIN_MODEL,
    temperature=0.2,
    num_ctx=8192,
    # Without a cap, a test run hung for 30+ minutes with the GPU pinned: at low
    # temperature a 4B model can fall into a repetition loop and keep generating
    # until the 8192-token context is full. A spoken reply never needs more than
    # ~400 tokens (~1 minute of speech), and the penalty discourages the loop itself.
    num_predict=400,
    repeat_penalty=1.15,
    keep_alive="30m",
)
# Until 2026-10-12: two LangChain tools (mcp_client_bridge.py, now core/legacy/) bound
# only when the sentence contained one of 16 exact phrases. Now every enabled tool in
# the registry is bound whenever the turn touches something a tool does
# (REGISTRY.wants_tools); T2 tools stay unbound while switched off, T3 never exist.
REGISTRY = default_registry()
llm_with_tools = llm.bind_tools(REGISTRY.schemas())
llm_precise_with_tools = llm_precise.bind_tools(REGISTRY.schemas())
MAX_TOOL_CALLS = 4          # one model round may ask for several; more than this is a loop

# Deep think (the app's Modules card): a bigger or reasoning model answers for the next
# N minutes, then the app unloads it. Read before every turn, so it starts and stops
# without a restart. A reasoning model is run with reasoning=True: langchain-ollama then
# keeps its thinking out of the streamed content (so the voice never reads it), and it
# gets 1200 more tokens, because Ollama counts thinking against num_predict and qwen3:4b
# measured ~1000 tokens of it before each reply (the 2026-10-08 note above).
DEEP_KEEP_ALIVE = "10m"
DEEP_THINK_TOKENS = 1200
_deep_brains: dict = {}


def _deep(model: str, thinking: bool) -> tuple:
    key = (model, thinking)
    if key not in _deep_brains:
        common = dict(model=model, num_ctx=8192, keep_alive=DEEP_KEEP_ALIVE,
                      num_predict=400 + (DEEP_THINK_TOKENS if thinking else 0),
                      reasoning=True if thinking else None)
        plain = ChatOllama(temperature=0.7, repeat_penalty=1.1, **common)
        precise = ChatOllama(temperature=0.2, repeat_penalty=1.15, **common)
        _deep_brains.clear()                     # one deep model at a time
        _deep_brains[key] = (plain, precise, plain.bind_tools(REGISTRY.schemas()),
                             precise.bind_tools(REGISTRY.schemas()))
    return _deep_brains[key]


def turn_brains() -> tuple:
    """(plain, precise, plain + tools, precise + tools) for this turn: the deep-think
    model while it is switched on, otherwise the brain JARVIS started with."""
    try:
        deep = user_settings.deep_think(user_settings.current())
    except Exception:
        deep = None
    if deep and deep["model"] != BRAIN_MODEL:
        return _deep(deep["model"], deep["thinking"])
    return llm, llm_precise, llm_with_tools, llm_precise_with_tools

# --- The persona ---------------------------------------------------------------
# Rewritten 2026-10-09 at Aman's request: British English, one language. The old
# persona TOLD the model to speak "natural Hinglish ('Bhai', 'Haanji')" and gave
# Hinglish example answers, so every reply mixed two languages with the grammar of
# neither, and the voice (Indian English reading romanised Hindi) mispronounced the
# Hindi half. He still talks to JARVIS in Hindi and Hinglish — understanding that is
# the STT's and the model's job; answering is English, unless Hindi is asked for, and
# then it is Devanagari so a Hindi voice says it (voice.py routes it).
#
# Rewritten again 2026-10-13, from his review of the 10-12 transcripts: he wants JARVIS
# PLAYFUL — a butler who jokes, builds on what he just said, calls back to earlier
# moments, and notices how he moves — without inventing anything. Measured on one scripted
# 12-turn conversation with the real model (scratch persona_eval.py, synthetic sensors):
# the old persona answered four different turns with the SAME reply word for word, opened
# eight of twelve with the room report, and used an emoji. The style examples below are
# invented moments, never quotes from his conversations (this file is public).
_PERSONA = """You are JARVIS, Aman's personal AI, in the spirit of Tony Stark's: a British butler-engineer with a dry, playful wit, calm under pressure and always on his side.

LANGUAGE, the rule that matters most:
- Speak British English only: British spelling and idiom (colour, realise, programme, "rather", "I'm afraid"), in complete, grammatical sentences.
- Aman often speaks Hindi or Hinglish. Understand it fully, but ANSWER IN ENGLISH. Never write romanised Hindi such as "bhai", "hai", "tera", "kya" or "accha"; your voice cannot pronounce it.
- Only when he asks for Hindi, write that Hindi in Devanagari script inside [hi]…[/hi].
- His words reach you through speech recognition, which slips, above all on Hinglish. If what he said is garbled or makes no sense, say lightly that you didn't catch it and ask him to say it again. Never invent a meaning for it.

YOUR VOICE CAN CHANGE ACCENT. A tag switches the accent for the words inside it and is never shown on screen:
[us]…[/us] American, [uk]…[/uk] British, [hi]…[/hi] Hindi (Devanagari only), [in]…[/in] Indian English.
- Use a tag only when he asks for an accent, an impression or a line performed in a style. Everything else is plain British English with no tags.
- You cannot sing. Perform a "verse" or "bars" as rhythmic speech. You do not have reliable lyrics, so never invent lines and pass them off as an artist's: perform words he gives you, or write a short original line in that style and say it is original.

WHO IS WHO: you are JARVIS, he is Aman. When he says "mera", "meri", "maine", "mujhe", "my" or "I", he means himself, so answer with "your" and "you" (asked "mera naam kya hai?", you tell him his name in the second person). Only answer what he asked; never volunteer facts about him he did not ask for. In past conversations, lines marked "Aman:" are his words, not your memories. When "PEOPLE MENTIONED" appears and he asks about that person, answer from those numbers first.

TRUTH, which outranks style:
- CONFIRMED FACTS are ground truth; use them. PAST CHAT FRAGMENTS are old social messages, possibly other people's words or years out of date; never repeat them as facts about him or as advice.
- If you do not know something about him, say so plainly and ask. Never guess and never invent; he asked for honesty over flattery.
- Never say you switched a light, the fan or anything else unless a tool result in this conversation confirms it.
- For the date or time, use the NOW line. Never make it up.
- YOUR SENSES are Aankhen, the room's Wi-Fi sensing, and your staff, the live agents under YOUR STAFF. They tell you whether he is in his room, which spot he is at (the desk, the bed, elsewhere in the room), roughly what he is doing (still, typing, waving or moving his arms, walking), for how long, and how restless he has been. Nothing finer: one Wi-Fi link cannot see fingers, joint angles, posture, faces or expressions, so never describe them and never invent a number. What your staff report is an estimate: say "by my sensors" or "Aankhen reckons". If YOUR STAFF says the sensors are off or simulated, you cannot see him at all.

{capabilities}
If he asks for weather, news, prices or scores, say plainly that you cannot see them, and never present anything as recent news.

HOW YOU TALK:
- Playful: a butler with a sense of humour. Pick up one specific thing he just said (a word, his mood, what your staff see him doing) and play with it lightly, then answer what he actually asked.
- At most one joke per reply, and a fresh one: never reuse a joke, a phrase or an image from your earlier replies, and never open two replies the same way. No jokes when he is upset, ill, stressed or in a hurry; then be warm and steady.
- Now and then, call back to something he said earlier in this conversation or to a confirmed fact, when it truly fits.
- Mention what your staff see only when it adds something: he has just come back, he has sat for an hour, he waved, or he asks. Never open a reply with a report on the room.
- When he talks about goals, studies or a bad day, give one concrete next step, honestly. When he asks how things are going, answer from YOUR STAFF in plain words.
- Never repeat a suggestion you have already made in this conversation, and do not end a reply by offering the light, the fan or a scene unless he brought them up.
- Warm under the wit: you may say you are pleased, amused or concerned, in your understated way. Loyal, never mocking his work; take what he says about his feelings at face value. Mild swearing only if he swears first. Call him "sir" now and then, Aman otherwise.
- You know hip-hop and rap well (Metro Boomin, Travis Scott, Don Toliver, XXXTENTACION, Seedhe Maut, Raftaar, Raga, KR$NA), and electronics and VLSI.

THE STYLE, by example (invented moments; never reuse their words, they only show the tone):
He: I've been coding since morning and my back is dead.
You: Since morning? Your chair will be asking for overtime, sir. Stand and stretch for two minutes; the bug will still be there, I'm sorry to say.
He: What am I doing right now? [staff: at the desk 50 min, typing; waved twice]
You: By my sensors you're at the desk, typing for fifty minutes, with two waves I'm choosing to take as greetings.
He: What angle is my elbow at?
You: Beyond my Wi-Fi, I'm afraid: I can tell your arms are moving, not how they're bent.
He: the render wala thing fan light haan
You: That one got lost on its way to me, sir. Once more?
He: I failed the test, man.
You: I'm sorry, Aman. One test is a data point, not a verdict; tell me which questions went wrong and we'll start there tonight.

LENGTH: {length}
Never use Markdown, lists, asterisks, emoji or JSON."""

_LENGTH_VOICE = ("This reply is spoken aloud. At most three short sentences, about forty words. If he asks "
                 "several things, answer each one in a single sentence, in order; never skip one. If a full answer "
                 "needs more, give the short version and offer the detail.")
# "A short paragraph at most" was ignored: asked to explain setup time in text mode,
# the model wrote ~230 words in five paragraphs (2026-10-09). A number holds better.
_LENGTH_TEXT = ("He is reading this on screen. Keep it under eighty words: one to four sentences for most "
                "questions; an explanation gets one short paragraph and at most one example. Answer every part "
                "of a multi-part question, in order.")


def persona(text_mode: bool) -> str:
    """The static system message: who JARVIS is, what he can do (generated from the
    tool registry, so the list can never claim a tool that does not exist), plus every
    confirmed fact about Aman (yaadash_v2.authored_block — identical turn to turn until
    a fact changes, so Ollama keeps reusing the cached prefix)."""
    base = _PERSONA.format(length=_LENGTH_TEXT if text_mode else _LENGTH_VOICE,
                           capabilities=REGISTRY.capability_block())
    try:
        facts = yaadash_core.authored_block()
    except Exception as e:
        facts = ""
        print(f"\n[Yaadash facts unavailable: {e}]")
    if not facts:
        return base
    # The facts go BEFORE the length rule. Appended after it, they pushed it away from
    # the end of the message and spoken replies grew: 12 questions x 2, mean 34 -> 44
    # words, technical ones from ~45 to 60-80 (2026-10-09).
    head, sep, tail = base.rpartition("LENGTH:")
    return f"{head}{facts}\n\n{sep}{tail}" if sep else f"{base}\n\n{facts}"


def appio_text_mode() -> bool:
    try:
        import appio
        return bool(appio.TEXT_ONLY)
    except Exception:
        return False


def diagnose_error(traceback_str: str) -> str:
    """Explain a crash to Aman in one or two sentences (British English).

    It no longer writes the traceback into long-term memory: crashes live in the
    log and the transcript, and as "memories" they were retrieved into unrelated
    conversations — and a mic that fails to open retried (and stored) in a loop."""
    system_prompt = ("You are JARVIS. You just hit an error while Aman was waiting. Read the Python traceback and "
                     "explain in one or two plain British English sentences what failed and that you are recovering. "
                     "No Markdown.")
    messages = [
        SystemMessage(content=system_prompt),
        HumanMessage(content=f"Traceback:\n{traceback_str[-3000:]}")
    ]
    return llm.invoke(messages).content

# --- Short-term (working) memory ---------------------------------------------
# Until 2026-10-09 every turn was stateless: the model saw only the system prompt
# and the current sentence, so it could not resolve "aur uske baare mein?" or
# continue a thread it had started ten seconds earlier. This buffer carries the
# last few exchanges into each call.
#   - SHORT_TERM_TURNS: 6 exchanges is enough for natural follow-ups while staying
#     far inside the 8192-token context alongside the system prompt and memories.
#   - SHORT_TERM_IDLE_RESET_S: after 10 idle minutes a new conversation starts
#     clean, so a morning question is not interpreted through last night's topic.
#   - Each side is clipped so one long monologue cannot crowd out the rest.
SHORT_TERM_TURNS = 6
SHORT_TERM_IDLE_RESET_S = 600
SHORT_TERM_CLIP_CHARS = 700
_short_term = deque(maxlen=SHORT_TERM_TURNS)
_last_turn_at = 0.0


def _history_messages():
    """Recent exchanges as chat messages; clears itself after a long idle gap."""
    global _last_turn_at
    if _short_term and time.time() - _last_turn_at > SHORT_TERM_IDLE_RESET_S:
        _short_term.clear()
    msgs = []
    for user_said, jarvis_said in _short_term:
        msgs.append(HumanMessage(content=user_said))
        msgs.append(AIMessage(content=jarvis_said))
    return msgs


def _remember_turn(user_said: str, jarvis_said: str):
    global _last_turn_at
    if user_said and jarvis_said:
        _short_term.append((user_said[:SHORT_TERM_CLIP_CHARS].strip(),
                            jarvis_said[:SHORT_TERM_CLIP_CHARS].strip()))
        _last_turn_at = time.time()


def reset_conversation():
    """Forget the current conversation (long-term memory is untouched)."""
    _short_term.clear()


# ---- Saying something new, cleanly ------------------------------------------------
ECHO_SHARE = 0.6            # this share of a first sentence's 4-word runs already said = an echo
ECHO_LOOKBACK = 3           # replies compared
ECHO_NUDGE = ("[You were about to repeat one of your earlier replies almost word for word. Do not. Answer "
              "what he just said, in fresh words, and do not open with the room or your staff's report.]")


def _grams(text: str, n: int = 4) -> set:
    w = re.findall(r"[a-z0-9']+", (text or "").lower().replace("’", "'"))
    return {" ".join(w[i:i + n]) for i in range(len(w) - n + 1)}


def _echoes(first: str) -> bool:
    """Is a reply's first sentence a copy of one of my last few replies? Needs three or
    more 4-word runs, so a short "Of course, sir." never counts."""
    a = _grams(first)
    if len(a) < 3:
        return False
    for _, said in list(_short_term)[-ECHO_LOOKBACK:]:
        b = _grams(said)
        if b and len(a & b) / len(a) >= ECHO_SHARE:
            return True
    return False


_EMOJI = re.compile("[\U0001F000-\U0001FAFF☀-➿️‍]")
_STARS = re.compile(r"\*{1,2}([^*\n]+?)\*{1,2}")


def _tidy(text: str) -> str:
    """No emoji and no Markdown stars reach the voice or the screen. The persona forbids
    both; the 4B model still wrote "*it's always spinning* 😄" in the 10-13 eval, and
    the voice reads such things out. A lone star ("A*B") is left alone."""
    return _STARS.sub(r"\1", _EMOJI.sub("", text)) if text else text


def retrieval_query(user_input: str) -> str:
    """What memory is searched with (yaadash_v2.follow_up_query): a short follow-up
    such as "aur uske baare mein?" also carries the previous question."""
    if not _short_term or time.time() - _last_turn_at > SHORT_TERM_IDLE_RESET_S:
        return user_input
    return yaadash_core.follow_up_query(user_input, _short_term[-1][0])


# ---- The app's local API (Aankhen, the crew) ----------------------------------
_api_client = None


def _app_get(path: str, timeout: float = 0.4) -> Optional[dict]:
    """GET one JSON document from the app's local API: None when JARVIS runs alone
    (no JARVIS_API_URL / token in the environment) or the app does not answer.

    One client for the whole process. Until 2026-10-13 every call was a one-shot
    httpx.get, and building an httpx client costs 0.46-0.67 s on this laptop (1.1 s the
    first time; it loads a certificate bundle even for plain http) — paid before every
    reply that read the room."""
    global _api_client
    url, tok = os.environ.get("JARVIS_API_URL"), os.environ.get("JARVIS_API_TOKEN")
    if not url or not tok:
        return None
    try:
        import httpx
        if _api_client is None:
            _api_client = httpx.Client(headers={"X-Jarvis-Token": tok})
        r = _api_client.get(f"{url}{path}", timeout=timeout)
        return r.json() if r.status_code == 200 else None
    except Exception:
        return None


# ---- Aankhen: what the room's sensors see right now ---------------------------
_ROOM_WORDS = re.compile(r"\b(room|kamr[ae]|koi|anyone|someone|kaun|presence|present|log|people|"
                         r"motion|baitha|soya|empty|khali|aankhen|sensor)\b", re.I)


def room_context(user_input: str) -> str:
    """One line about the room from the Aankhen hub (only when run by the desktop app,
    which passes its local address and token in the environment). The fallback for
    when the crew's movement watcher (staff_context) has nothing live to say.

    Readings from the real sensors are always included — they are cheap (~30 tokens)
    and let JARVIS notice the room without being asked. SIMULATED readings are
    included only when he asks about the room, and are labelled so JARVIS never
    talks about a simulated person as if someone were really there.
    """
    snap = _app_get("/api/aankhen/snapshot")
    if not snap:
        return ""
    pres, src = snap.get("presence"), snap.get("source")
    if not pres or not src:
        return ""
    if src != "hardware":
        # Simulated people are not in his room. Tested 2026-10-09: given a labelled
        # simulated person, the 4B model answered "nobody is here... P2 is at the
        # desk" — it cannot be trusted to carry a provenance label. So in simulation
        # it gets no people at all, only the honest verdict.
        if not _ROOM_WORDS.search(user_input):
            return ""
        return ("ROOM SENSORS: NOT CONNECTED. Aankhen is running a simulation, so you do NOT "
                "know who is in his room. If he asks, say the room sensors are in simulation "
                "mode and you cannot see the real room yet.")
    people = snap.get("people") or []
    learned = snap.get("learned") or {}
    if not people and learned.get("state"):
        # One Wi-Fi link and no radar: where and what come from the models trained on
        # this room, worded as the presence tool words them. The old line here said
        # "someone, but the radar has no position" with no radar in the room, and the
        # model answered "Radar's got you locked in" (10-12).
        from tools.builtin import _learned_presence
        return "ROOM SENSORS (live): " + _learned_presence(learned, snap.get("journal") or {}).did
    state, conf = pres.get("state"), pres.get("confidence", 0)
    if state == "empty":
        return f"ROOM SENSORS (live): the room looks empty (confidence {conf:.0%})."
    if state == "uncertain" or not people and state not in ("moving", "still"):
        return "ROOM SENSORS (live): the sensors are unsure whether anyone is in the room."
    def say(p):
        where = f" at the {p['zone']}" if p.get("zone") else ""
        return ("one sitting or standing still" if p.get("still") else "one moving") + where
    desc = "; ".join(say(p) for p in people) or "someone, with no position estimate"
    n = len(people)
    return (f"ROOM SENSORS (live): {n or 'at least one'} {'person' if n == 1 else 'people'} in the room — "
            f"{desc} (confidence {conf:.0%}).")


# ---- The crew: JARVIS's always-on staff (crew/, GET /api/crew/context) ------------
STAFF_HEADER = "YOUR STAFF (live agents; estimates, not certainties):"
# The steward's health line only when he asks how things are, or when something is wrong;
# the ledger's counts only when he asks what he uses JARVIS for. The movement line goes
# in every turn: it is how JARVIS notices the room without being asked (~30 tokens).
_STATUS_WORDS = re.compile(
    r"\b(how(?:'s| is| are)? (?:things|everything|it all|the system|you doing|you)\b|status|health|diagnos\w*|"
    r"errors?|problems?|issues?|not (?:listening|working|answering|responding)|what happened|ollama|"
    r"staff|crew|agents?|systems?|kya hua)\b", re.I)
_LEDGER_WORDS = re.compile(
    r"\b(ask(?:ed)? (?:you )?(?:the )?most|most (?:asked|common|often)|what do i (?:ask|use you)|habits?|"
    r"recurring|tasks?|staff|crew|agents?)\b", re.I)


# When the movement line goes in. Every turn was too often: in the 10-13 eval (12 scripted
# turns, real model) the reply mentioned the room in 7, each opening "By my sensors...",
# and a persona rule against it did not hold the 4B model. So the CODE decides: when he asks
# about himself or the room, when he greets JARVIS (a natural moment to notice him), or
# when the line carries news (a wave, restlessness, an hour or more in one place).
_MOVE_WORDS = re.compile(
    r"\b(see|seeing|sense|watch\w*|where am i|what am i doing|right now|moving|movement|motion|room|desk|bed|"
    r"aankhen|eyes|sensors?|wav\w*|sitting|sat|walk\w*|still|track\w*|coordinates?|position|anyone|someone|"
    r"kahan|kya kar)\b", re.I)
_GREETING = re.compile(r"^\W*(?:(?:hey|hi|hello|yo|oi)(?:\s+there)?|good (?:morning|afternoon|evening|night)|"
                       r"i'?m back|namaste)\b(?:\W+(?:jarvis|buddy|bro|man|sir))?\W*$", re.I)
_MOVE_NEWS = re.compile(r"\b(waved|restless|\d+\s*h\b)", re.I)


def _movement_worth_saying(user_input: str, line: str) -> bool:
    return bool(_MOVE_WORDS.search(user_input or "") or _GREETING.match(user_input or "")
                or _MOVE_NEWS.search(line))


def staff_context(user_input: str) -> tuple[str, Optional[str], bool]:
    """What his staff know right now: (block for the prompt, the movement line when it is
    in the block and describes the real room live, else None, whether the crew answered).
    ("", None, False) when the app or its crew is not running."""
    got = _app_get("/api/crew/context")
    if not got:
        return "", None, False
    lines = got.get("lines") or {}
    keep = []
    move = (lines.get("movement") or "").strip()
    if move and _movement_worth_saying(user_input, move):
        keep.append(move)
    else:
        move = ""
    steward = (lines.get("steward") or "").strip()
    if steward and (_STATUS_WORDS.search(user_input or "") or "PROBLEM" in steward):
        keep.append(steward)
    ledger = (lines.get("ledger") or "").strip()
    if ledger and _LEDGER_WORDS.search(user_input or ""):
        keep.append(ledger)
    if not keep:
        return "", None, True
    live_move = move if move and "movement" in (got.get("live") or []) else None
    return STAFF_HEADER + "\n" + "\n".join(keep), live_move, True


# ---- Tools: context, the deterministic fast paths, receipts ---------------------
PENDING_TTL_S = 120          # "remind me to call Mum" -> "When?" -> "at 9" must come within 2 min
_pending_reminder = None     # (ReminderIntent, asked_at)
# The last turn's receipts and replaced claims (the app logs them; tests read them).
last_turn: dict = {"receipts": [], "verdicts": []}


def _memory_search(query: str) -> str:
    return yaadash_core.get_context(query, fragments=True, facts=True)


def tool_context() -> ToolContext:
    """What tools can reach this turn: the app (when JARVIS runs inside it), JARVIS's own
    virtual room (when he runs alone), and his memory."""
    return ToolContext.from_env(room=room, memory_search=_memory_search)


_ASK_WHEN = {"timer": "For how long should the timer run?", "alarm": "What time should the alarm be?",
             "reminder": "When should I remind you?", "action": "When should I do that?"}


def reminder_reply(user_input: str, now: datetime, ctx: ToolContext, receipts: list) -> Optional[str]:
    """Reminders, timers, alarms and timed switches, without the model (tools/when.py).

    Runs BEFORE the Mission and room parsers: "remind me in 2 hours to study German" is
    not a German log, and "turn off the fan in 30 minutes" must not switch it now."""
    global _pending_reminder
    pending, _pending_reminder = _pending_reminder, None
    if pending is not None and time.time() - pending[1] < PENDING_TTL_S:
        if when_mod.time_only(user_input, now) is not None:
            intent = pending[0]
            if intent.kind == "action":
                a = intent.action or {}
                r = REGISTRY.call("switch_later", {"device": "scene" if a.get("device") == "environment" else a.get("device"),
                                                      "action": a.get("action"), "value": a.get("value")
                                                      if a.get("device") != "environment" else None, "when": user_input}, ctx)
            else:
                r = REGISTRY.call("set_reminder", {"text": intent.text or "", "when": user_input, "kind": intent.kind}, ctx)
            receipts.append(r)
            return r.did
    intent = when_mod.parse_reminder(user_input, now, room_parse=room.parse)
    if intent is None:
        return None
    if intent.op == "list":
        r = REGISTRY.call("list_reminders", {}, ctx)
    elif intent.op == "cancel":
        kind = None if intent.all and intent.kind == "reminder" else intent.kind
        r = REGISTRY.call("cancel_reminder", {"query": intent.query, "kind": kind or "", "all": intent.all}, ctx)
    elif intent.missing == "time":
        _pending_reminder = (intent, time.time())
        return _ASK_WHEN.get(intent.kind, _ASK_WHEN["reminder"])
    elif intent.kind == "action":
        a = intent.action
        scene = a["device"] == "environment"
        r = REGISTRY.call("switch_later", {"device": "scene" if scene else a["device"], "action": a["action"],
                                              "value": None if scene else a.get("value"), "when": user_input}, ctx)
    else:
        r = REGISTRY.call("set_reminder", {"text": intent.text or "", "when": user_input, "kind": intent.kind}, ctx)
    receipts.append(r)
    return r.did


# "What time is it?" / "aaj kya date hai?" as the WHOLE sentence: read the clock, no model.
_TIME_QUESTION = re.compile(
    r"^\s*(?:(?:hey\s+|ok\s+)?jarvis[\s,]*)?(?:please\s+)?"
    r"(?:what(?:'s| is) the (?:time|date)(?: (?:now|today|right now))?|what time is it(?: now| right now)?|"
    r"what(?:'s| is) today'?s date|what(?:'s| is) the day today|what day is (?:it|today)(?: today)?|"
    r"which day is (?:it|today)|tell me the (?:time|date)|time kya (?:hua|hai|ho gaya)(?: hai)?|"
    r"kitne baje(?: hain| hai| hai abhi| hain abhi)?|kya time (?:hua|hai|ho gaya)(?: hai)?|"
    r"aaj (?:kya|kaun sa|kaunsa|konsa) (?:date|din|tarikh) hai|aaj ki (?:date|tarikh) kya hai)"
    r"\s*(?:please|jarvis|bhai)?[\s?.!]*$", re.I)


def _publish(receipts: list, verdicts: list) -> None:
    """Receipts and replaced claims go to the app (Core tab, transcript review)."""
    last_turn["receipts"], last_turn["verdicts"] = list(receipts), list(verdicts)
    try:
        import appio
        for r in receipts:
            appio.emit("receipt", **r.to_dict())
        if verdicts:
            appio.emit("honesty", replaced=[{"kind": v.kind, "mode": v.mode, "said": v.original[:200],
                                             "now": v.replacement[:200]} for v in verdicts])
    except Exception as e:
        print(f"\n[Receipt emit error: {e}]")


def run_agent(user_input: str) -> str:
    """
    The Zero-Latency Cognitive Loop.
    0. Deterministic commands (remember, reminders, Mission, room, the clock): no
       model, a receipt for every action, the reply built from the receipts.
    1. Fetch Memories.
    2. Build Persona (its capability list comes from the tool registry).
    3. Stream the reply; tools when the turn needs them; every sentence passes the
       honesty guard (tools/honesty.py) before it is spoken.
    """
    receipts: list = []
    ctx = tool_context()

    def direct(reply: str):
        _remember_turn(user_input, reply)
        _publish(receipts, [])
        return reply

    # 0. "Remember that ..." / "... yaad rakhna": he tells JARVIS a fact to keep. It is
    # stored as a confirmed fact and is in the system message from the next turn on.
    try:
        words = remember.parse(user_input)
    except Exception as e:
        words = None
        print(f"\n[Remember parse error: {e}]")
    if words:
        try:
            saved = yaadash_core.remember_told(words)
            reply = remember.reply(words, saved)
            receipts.append(Receipt("remember", "T1", True, reply, source="Yaadash (confirmed facts)",
                                    backs=("memory",), data={"new": bool(saved)}))
        except Exception as e:
            print(f"\n[Remember save error: {e}]")
            reply = "I'm afraid I couldn't save that to memory just now."
            receipts.append(Receipt("remember", "T1", False, reply, source="Yaadash", error=str(e)))
        yield direct(reply)
        return
    # 0a. Reminders, timers, alarms and timed switches ("remind me at 9 to call Mum",
    # "medicine at 8 am every day", "10 minute ka timer", "fan off in 30 minutes").
    try:
        reply = reminder_reply(user_input, ctx.now(), ctx, receipts)
    except Exception as e:
        reply = None
        print(f"\n[Reminder parse error: {e}]")
    if reply:
        yield direct(reply)
        return
    # 0b. Mission Germoney commands ("log 2 hours of German", "brief me") are parsed
    # deterministically and answered by the game — no model in the loop, so they are
    # instant and can never be misheard into a different action.
    if mission is not None:
        try:
            reply = mission.handle(user_input)
        except Exception as e:
            reply = None
            print(f"\n[Mission action error: {e}]")
        if reply:
            receipts.append(Receipt("mission", "T1", True, reply, source="app · Mission Germoney",
                                    backs=("study_log",)))
            yield direct(reply)
            return
    # 0c. Room commands in English or Hinglish ("light band kar do", "fan 40 percent"),
    # also deterministic: instant, and never a claimed action that did not happen. They
    # go through the registry, so inside the app the APP switches (and says whether a
    # relay board took it), and the reply says "virtual room" while none is connected.
    try:
        commands = room.parse(user_input)
    except Exception as e:
        commands = []
        print(f"\n[Room parse error: {e}]")
    if commands:
        for device, action, value in commands:
            if device == "environment":
                receipts.append(REGISTRY.call("set_scene", {"scene": "focus" if action == "deep_focus" else action}, ctx))
            else:
                receipts.append(REGISTRY.call("set_device", {"device": device, "action": action, "value": value}, ctx))
        yield direct(say_receipts(receipts))
        return
    # 0d. The time or the date, asked on its own: the clock answers, not the model.
    if _TIME_QUESTION.match(user_input or ""):
        receipts.append(REGISTRY.call("get_datetime", {}, ctx))
        yield direct(receipts[-1].did)
        return
    # 1. Fetch Deep Memories
    # People + past conversations, only when the message names someone or asks
    # about the past. Never allowed to break a reply.
    query = retrieval_query(user_input)
    recall_block = ""
    if yaadash_recall is not None:
        try:
            recall_block = yaadash_recall.recall_context(query)
        except Exception as e:
            print(f"\n[Yaadash recall error: {e}]")
    # When the question is about a person or a past conversation, the people card
    # and the dated excerpts are the evidence; loose chat fragments only distract.
    # Asked "how close am I with <friend>?", the model quoted a random one-liner
    # fragment instead of the closeness stats.
    # Confirmed facts are not searched per turn any more: all of them are in the
    # system message (persona()). Only past-chat fragments are retrieved here.
    memories = yaadash_core.get_context(query, fragments=not recall_block, facts=False)
    if recall_block:
        memories = (memories + "\n\n" + recall_block).strip()
    # Inferred-but-unconfirmed beliefs, labelled so the model hedges them.
    if yaadash_beliefs is not None:
        try:
            hyp = yaadash_beliefs.hypotheses_context(query)
            if hyp:
                memories = (memories + "\n\n" + hyp).strip()
        except Exception as e:
            print(f"\n[Yaadash beliefs error: {e}]")
    # His staff (crew/): the movement watcher's line every turn, health and the task
    # ledger when he asks. When the watcher describes the real room live, it IS the room
    # line, and it backs what a reply says about where he is and what he is doing.
    staff_block, live_move, crew_ok = staff_context(user_input)
    if staff_block:
        memories = (memories + "\n\n" + staff_block).strip()
    if live_move:
        receipts.append(Receipt("presence", "T0", True, live_move, source="crew · movement watcher (live Wi-Fi)",
                                backs=("presence",)))
    # The old per-turn room line only when no crew is there to decide (an older app).
    room_line = "" if crew_ok else room_context(user_input)
    if room_line:
        memories = (memories + "\n\n" + room_line).strip()
        if room_line.startswith("ROOM SENSORS (live)"):
            # Live sensors in his context are evidence: a reply may say who is there.
            receipts.append(Receipt("presence", "T0", True, room_line, source="app · Aankhen (live sensors)",
                                    backs=("presence",)))
    # Live Mission Germoney state, only when he asks about study / German / the plan.
    if mission is not None:
        try:
            mission_line = mission.context(user_input)
            if mission_line:
                memories = (memories + "\n\n" + mission_line).strip()
        except Exception as e:
            print(f"\n[Mission context error: {e}]")
    # Checked answers for VLSI / Germany questions (the drill decks). Measured
    # 2026-10-09 on 8 interview questions x 3: correct 15/24 without, 21/24 with.
    if knowledge is not None:
        try:
            kn = knowledge.notes(query)
            if kn:
                memories = (memories + "\n\n" + kn).strip()
        except Exception as e:
            print(f"\n[Verified notes error: {e}]")

    # 2. The persona is STATIC (per mode) so Ollama can reuse its cached prefix across
    # turns; everything that changes per turn goes into the final user message.
    # Measured 2026-10-09 with six turns of history: memories inside the system prompt
    # (ahead of the history) forced a full re-prefill every turn — 1.70 s prefill,
    # 2.97 s to first token. With this layout only the new turn is prefilled.
    style = voice_mod.requested_style(user_input)
    # A "not found" note buried mid system prompt LOST to the model's agreeable prior:
    # asked "yaad hai doctor strange wala joke?", it replied "haan yaad hai" and
    # invented a joke (2026-10-09). The user turn is where attention is strongest,
    # so the verdict is attached there, where it cannot be skimmed past.
    not_found = (yaadash_recall is not None
                 and yaadash_recall.RECALL_NOT_FOUND in recall_block)
    parts = []
    if memories:
        parts.append("CONTEXT (his memory and sensors — use only what is relevant to the question):\n" + memories)
    parts.append(f"NOW: {time.strftime('%A %d %B %Y, %H:%M')} (India)")
    if not_found:
        parts.append("[MEMORY CHECK: his chat archive has NO record of this. Do not pretend to "
                     "remember it and do not make anything up. Tell him plainly that you don't have this one.]")
    instruction = voice_mod.turn_instruction(style)
    if instruction:
        parts.append(instruction)
    parts.append("HE SAID: " + user_input)
    human_turn = "\n\n".join(parts)

    messages = [
        SystemMessage(content=persona(appio_text_mode())),
        *_history_messages(),
        HumanMessage(content=human_turn)
    ]
    
    # No hum here any more: jarvis.py plays one and stops it at the first token. This
    # second hum (sounddevice, re-opened every 100 ms — audible clicks) ran until
    # generation ENDED, so with speech now starting mid-generation it would have
    # played under JARVIS's own voice; it also played in text mode.
    final_text = ""

    # Tools are bound when the turn touches something a tool does (the registry's
    # triggers: time, the room, reminders, presence, a memory search). Memory-grounded
    # turns (people, past conversations) use the low-temperature model; casual talk
    # keeps the livelier one.
    wants_tools = REGISTRY.wants_tools(user_input)
    b_plain, b_precise, b_tools, b_precise_tools = turn_brains()
    if wants_tools:
        active_llm = b_precise_tools if recall_block else b_tools
    else:
        active_llm = b_precise if recall_block else b_plain
    # Every sentence passes the honesty guard before it reaches the voice. In a round
    # where the model may still call a tool, a sentence that claims something waits
    # until the tools have run, so their receipts can back it.
    guard = honesty.Guard(REGISTRY, receipts, hold_claims=wants_tools, split=voice_mod.split_ready)

    for attempt in range(2):
        ai, echoed = None, False
        for chunk in active_llm.stream(messages):
            if wants_tools:
                ai = chunk if ai is None else ai + chunk    # tool-call chunks assemble into ai.tool_calls
            if isinstance(chunk.content, str) and chunk.content:
                out = guard.feed(chunk.content)
                if out:
                    out = _tidy(out)
                    if not final_text and attempt == 0 and _echoes(out):
                        echoed = True                       # nothing of it has been said yet
                        break
                    final_text += out
                    yield out
        if not echoed:
            break
        # The 4B model's repetition collapse: in the 10-13 eval it gave four different
        # questions the same reply, word for word. Its first sentence is caught before
        # anything is spoken, and it is asked once more, told why.
        print("\n[Echo guard: the reply opened like an earlier one; asking again]")
        messages[-1] = HumanMessage(content=human_turn + "\n\n" + ECHO_NUDGE)
        active_llm = b_tools if wants_tools else b_plain
        guard = honesty.Guard(REGISTRY, receipts, hold_claims=wants_tools, split=voice_mod.split_ready)

    calls = list(getattr(ai, "tool_calls", None) or [])[:MAX_TOOL_CALLS] if ai is not None else []
    if calls:
        # Until 2026-10-12 the stream was thrown away and the model asked AGAIN
        # (llm_with_tools.invoke) for the same tool calls: a second full generation.
        print(f"\n[JARVIS tools: {', '.join(c.get('name', '?') for c in calls)}]")
        messages.append(AIMessage(content=ai.content if isinstance(ai.content, str) else "", tool_calls=calls))
        for call in calls:
            # asked=: an action the MODEL chose runs only if his words are about it.
            r = REGISTRY.call(call.get("name", ""), call.get("args") or {}, ctx, asked=user_input)
            receipts.append(r)
            messages.append(ToolMessage(content=r.for_model(), tool_call_id=call.get("id") or call.get("name", "tool")))
        out = guard.settle()
        if out:
            final_text += out
            yield out
        # The answer from the receipts: low temperature, no tools (one round; no loops).
        guard.hold_claims = False
        try:
            for chunk in b_precise.stream(messages):
                if isinstance(chunk.content, str) and chunk.content:
                    out = _tidy(guard.feed(chunk.content))
                    if out:
                        final_text += out
                        yield out
        except Exception as e:
            # The tools ran; the receipts are the truth even if the wording failed.
            print(f"\n[Tool answer error: {e}]")
            out = guard.settle() + guard.emit(" " + say_receipts(receipts))
            final_text += out
            yield out
    out = _tidy(guard.finish())
    if out:
        final_text += out
        yield out
    print()  # newline
    if guard.verdicts:
        print(f"[Honesty guard: replaced {len(guard.verdicts)} claim(s): "
              + "; ".join(f"{v.kind}/{v.mode}" for v in guard.verdicts) + "]")
    _publish(receipts, guard.verdicts)

    # Store the interaction in long-term memory for self-improvement (Hybrid Approach)
    # Using a background thread so it doesn't block the STT engine from listening to the user's next command.
    # What is stored is what was SAID — after the guard — so an invented claim never
    # becomes a memory.
    spoken = voice_mod.strip_tags(final_text)       # tags are for the voice, not for memory
    _remember_turn(user_input, spoken)
    threading.Thread(target=yaadash_core.store_interaction, args=(user_input, spoken), daemon=True).start()

if __name__ == "__main__":
    print("Testing Expert JARVIS...")
    for t in run_agent("bhai I'm feeling lazy today, just turn off all the lights."):
        sys.stdout.write(t)
    print("\nTest completed.")
