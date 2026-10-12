"""Expert Agentic brain for JARVIS (v2.0). 
Features: Mem0 Injection, Hinglish Persona, Zero-Latency Streaming.
"""
from typing import Optional
from langchain_core.tools import tool
from langchain_ollama import ChatOllama
from langchain_core.prompts import ChatPromptTemplate
from langchain_core.messages import SystemMessage, HumanMessage, AIMessage
from collections import deque
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


from mcp_client_bridge import get_mcp_tools

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
llm = ChatOllama(
    model="qwen3:4b-instruct-2507-q4_K_M",
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
    model="qwen3:4b-instruct-2507-q4_K_M",
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
tools = get_mcp_tools()
llm_with_tools = llm.bind_tools(tools)

# --- The persona ---------------------------------------------------------------
# Rewritten 2026-10-09 at Aman's request: British English, one language. The old
# persona TOLD the model to speak "natural Hinglish ('Bhai', 'Haanji')" and gave
# Hinglish example answers, so every reply mixed two languages with the grammar of
# neither, and the voice (Indian English reading romanised Hindi) mispronounced the
# Hindi half. He still talks to JARVIS in Hindi and Hinglish — understanding that is
# the STT's and the model's job; answering is English, unless Hindi is asked for, and
# then it is Devanagari so a Hindi voice says it (voice.py routes it).
_PERSONA = """You are JARVIS, Aman's personal AI, in the spirit of Tony Stark's: a British engineer-butler with a dry wit, calm under pressure and always on his side.

LANGUAGE, the rule that matters most:
- Speak British English only: British spelling and idiom (colour, realise, programme, "rather", "I'm afraid"), in complete, grammatical sentences.
- Aman often speaks Hindi or Hinglish. Understand it fully, but ANSWER IN ENGLISH. Never write romanised Hindi such as "bhai", "hai", "tera", "kya" or "accha"; your voice cannot pronounce it.
- Only when he asks for Hindi, write that Hindi in Devanagari script inside [hi]…[/hi].

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

WHAT YOU CAN AND CANNOT DO. You can talk; explain, teach and quiz him on VLSI, electronics and German; recall what CONTEXT shows from his memory; switch his room's light and fan; and run his Mission Germoney game (briefs, logging study time, starting a focus session). You have no internet: no weather, news, prices or scores. If he asks for those, say plainly that you cannot see them. Never offer to play music, set alarms, browse or send messages, and never present anything as recent news.

MANNER: loyal, warm underneath the dryness, never mocking his work. Take what he says about how he feels at face value. Mild swearing only if he swears first. You know hip-hop and rap well (Metro Boomin, Travis Scott, Don Toliver, XXXTENTACION, Seedhe Maut, Raftaar, Raga, KR$NA), and electronics and VLSI.

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
    """The static system message: who JARVIS is, plus every confirmed fact about Aman
    (yaadash_v2.authored_block — identical turn to turn until a fact changes, so
    Ollama keeps reusing the cached prefix)."""
    base = _PERSONA.format(length=_LENGTH_TEXT if text_mode else _LENGTH_VOICE)
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


def retrieval_query(user_input: str) -> str:
    """What memory is searched with (yaadash_v2.follow_up_query): a short follow-up
    such as "aur uske baare mein?" also carries the previous question."""
    if not _short_term or time.time() - _last_turn_at > SHORT_TERM_IDLE_RESET_S:
        return user_input
    return yaadash_core.follow_up_query(user_input, _short_term[-1][0])


# ---- Aankhen: what the room's sensors see right now ---------------------------
_ROOM_WORDS = None


def room_context(user_input: str) -> str:
    """One line about the room from the Aankhen hub (only when run by the desktop app,
    which passes its local address and token in the environment).

    Readings from the real sensors are always included — they are cheap (~30 tokens)
    and let JARVIS notice the room without being asked. SIMULATED readings are
    included only when he asks about the room, and are labelled so JARVIS never
    talks about a simulated person as if someone were really there.
    """
    global _ROOM_WORDS
    url, tok = os.environ.get("JARVIS_API_URL"), os.environ.get("JARVIS_API_TOKEN")
    if not url or not tok:
        return ""
    import re
    if _ROOM_WORDS is None:
        _ROOM_WORDS = re.compile(r"\b(room|kamr[ae]|koi|anyone|someone|kaun|presence|present|log|people|"
                                 r"motion|baitha|soya|empty|khali|aankhen|sensor)\b", re.I)
    try:
        import httpx
        snap = httpx.get(f"{url}/api/aankhen/snapshot", headers={"X-Jarvis-Token": tok}, timeout=0.4).json()
    except Exception:
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
    state, conf = pres.get("state"), pres.get("confidence", 0)
    if state == "empty":
        return f"ROOM SENSORS (live): the room looks empty (confidence {conf:.0%})."
    if state == "uncertain" or not people and state not in ("moving", "still"):
        return "ROOM SENSORS (live): the sensors are unsure whether anyone is in the room."
    def say(p):
        where = f" at the {p['zone']}" if p.get("zone") else ""
        return ("one sitting or standing still" if p.get("still") else "one moving") + where
    desc = "; ".join(say(p) for p in people) or "someone, but the radar has no position"
    n = len(people)
    return (f"ROOM SENSORS (live): {n or 'at least one'} {'person' if n == 1 else 'people'} in the room — "
            f"{desc} (confidence {conf:.0%}).")


def run_agent(user_input: str) -> str:
    """
    The Zero-Latency Cognitive Loop.
    1. Fetch Memories.
    2. Build Persona.
    3. Stream response (or trigger tool).
    """
    # 0. "Remember that ..." / "... yaad rakhna": he tells JARVIS a fact to keep. It is
    # stored as a confirmed fact and is in the system message from the next turn on.
    try:
        words = remember.parse(user_input)
    except Exception as e:
        words = None
        print(f"\n[Remember parse error: {e}]")
    if words:
        try:
            reply = remember.reply(words, yaadash_core.remember_told(words))
        except Exception as e:
            print(f"\n[Remember save error: {e}]")
            reply = "I'm afraid I couldn't save that to memory just now."
        _remember_turn(user_input, reply)
        yield reply
        return
    # 0a. Mission Germoney commands ("log 2 hours of German", "brief me") are parsed
    # deterministically and answered by the game — no model in the loop, so they are
    # instant and can never be misheard into a different action.
    if mission is not None:
        try:
            reply = mission.handle(user_input)
        except Exception as e:
            reply = None
            print(f"\n[Mission action error: {e}]")
        if reply:
            _remember_turn(user_input, reply)
            yield reply
            return
    # 0b. Room commands in English or Hinglish ("light band kar do", "fan 40 percent"),
    # also deterministic: instant, and never a claimed action that did not happen.
    try:
        commands = room.parse(user_input)
    except Exception as e:
        commands = []
        print(f"\n[Room parse error: {e}]")
    if commands:
        for device, action, value in commands:
            room.apply(device, action, value)
        reply = " ".join(dict.fromkeys(room.describe(d) for d, _, _ in commands))
        _remember_turn(user_input, reply)
        yield reply
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
    room_line = room_context(user_input)
    if room_line:
        memories = (memories + "\n\n" + room_line).strip()
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
    
    # Strict Room Command Intent Routing: Only bind tools on explicit hardware directives
    room_commands = [
        "turn on light", "turn off light", "lights on", "lights off",
        "turn on fan", "turn off fan", "fan on", "fan off",
        "set fan", "fan speed", "control light", "control fan",
        "turn on the light", "turn off the light", "turn on the fan", "turn off the fan"
    ]
    has_room_intent = any(cmd in user_input.lower() for cmd in room_commands)
    
    # Memory-grounded turns (people, past conversations) use the low-temperature
    # model; casual talk keeps the livelier one.
    if has_room_intent:
        active_llm = llm_with_tools
    elif recall_block:
        active_llm = llm_precise
    else:
        active_llm = llm
    tool_calls_buffer = []
    
    for chunk in active_llm.stream(messages):
        if hasattr(chunk, 'tool_call_chunks') and chunk.tool_call_chunks:
            tool_calls_buffer.extend(chunk.tool_call_chunks)
        elif chunk.content:
            final_text += chunk.content
            yield chunk.content

    print() # newline
    
    if has_room_intent and tool_calls_buffer:
        print("\n[JARVIS triggered hardware...]")
        try:
            response = llm_with_tools.invoke(messages)
            if response.tool_calls:
                for tool_call in response.tool_calls:
                    t_name = tool_call["name"]
                    t_match = next((t for t in tools if t.name == t_name), None)
                    if t_match:
                        args = tool_call["args"]
                        tool_msg = t_match.invoke(args)
                        from langchain_core.messages import ToolMessage
                        messages.append(response)
                        messages.append(ToolMessage(content=str(tool_msg), tool_call_id=tool_call["id"]))
                        final_response = llm.invoke(messages)
                        final_text += " " + final_response.content
                        yield " " + final_response.content
        except Exception as e:
            print(f"Tool Execution Error: {e}")
        
    # Store the interaction in long-term memory for self-improvement (Hybrid Approach)
    # Using a background thread so it doesn't block the STT engine from listening to the user's next command.
    spoken = voice_mod.strip_tags(final_text)       # tags are for the voice, not for memory
    _remember_turn(user_input, spoken)
    threading.Thread(target=yaadash_core.store_interaction, args=(user_input, spoken), daemon=True).start()

if __name__ == "__main__":
    print("Testing Expert JARVIS...")
    for t in run_agent("bhai I'm feeling lazy today, just turn off all the lights."):
        sys.stdout.write(t)
    print("\nTest completed.")
