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
    import mission           # Mission Germoney: voice commands + live mission state
except Exception as _e:
    mission = None
    print(f"[Mission bridge unavailable: {_e}]")
import os
import sys
import numpy as np
import sounddevice as sd
import threading
import time

class CognitiveHum:
    """Advanced Procedural Audio Engine for Zero-Latency Feedback.
    Generates a futuristic sci-fi computing hum dynamically in a background thread
    using raw numpy mathematics.
    """
    def __init__(self):
        self.is_thinking = False
        self.thread = None

    def _play_hum(self):
        fs = 16000
        chunk_duration = 0.1
        t = np.linspace(0, chunk_duration, int(fs * chunk_duration), endpoint=False)
        
        while self.is_thinking:
            # Generate a complex, low-frequency sci-fi processing hum
            # Modulate frequency with an LFO (Low Frequency Oscillator) based on time
            lfo = np.sin(time.time() * 15) * 15 
            # Combine fundamental (130Hz) and harmonic (260Hz) with LFO shift for a deep sci-fi hum
            wave = 0.15 * np.sin(2 * np.pi * (130 + lfo) * t) + 0.05 * np.sin(2 * np.pi * (260 + lfo * 2) * t)
            # Add micro-bursts of computing static
            noise = np.random.normal(0, 0.008, size=t.shape) * (np.sin(time.time() * 50) > 0.8)
            
            final_audio = (wave + noise).astype(np.float32)
            try:
                sd.play(final_audio, fs)
                sd.wait()
            except Exception:
                # If sounddevice fails (e.g. exclusive mode lock by PyGame), sleep to prevent CPU spike
                time.sleep(chunk_duration)

    def start(self):
        self.is_thinking = True
        self.thread = threading.Thread(target=self._play_hum, daemon=True)
        self.thread.start()

    def stop(self):
        self.is_thinking = False
        if self.thread:
            self.thread.join()

hum_engine = CognitiveHum()

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

def diagnose_error(traceback_str: str) -> str:
    """Self-healing diagnostic loop."""
    system_prompt = """[SYSTEM_ROLE: DIAGNOSTIC_ENGINE]
You just crashed. The user is waiting. Read the Python traceback provided and figure out exactly why you failed. 
Explain the failure to the user in a short, apologetic, and highly technical but understandable way in Hinglish. Assure them you have logged the failure to your memory."""
    messages = [
        SystemMessage(content=system_prompt),
        HumanMessage(content=f"Crash Traceback:\n{traceback_str}")
    ]
    response = llm.invoke(messages)
    
    yaadash_core.store_interaction(f"CRITICAL GLITCH OCCURRED:\n{traceback_str}", f"Self-Diagnosis: {response.content}")
    
    return response.content

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
    # 0. Mission Germoney commands ("log 2 hours of German", "brief me") are parsed
    # deterministically and answered by the game — no model in the loop, so they are
    # instant and can never be misheard into a different action.
    if mission is not None:
        try:
            reply = mission.handle(user_input)
        except Exception as e:
            reply = None
            print(f"\n[Mission action error: {e}]")
        if reply:
            yield reply
            return
    # 1. Fetch Deep Memories
    # People + past conversations, only when the message names someone or asks
    # about the past. Never allowed to break a reply.
    recall_block = ""
    if yaadash_recall is not None:
        try:
            recall_block = yaadash_recall.recall_context(user_input)
        except Exception as e:
            print(f"\n[Yaadash recall error: {e}]")
    # When the question is about a person or a past conversation, the people card
    # and the dated excerpts are the evidence; loose chat fragments only distract.
    # Asked "how close am I with <friend>?", the model quoted a random one-liner
    # fragment instead of the closeness stats.
    memories = yaadash_core.get_context(user_input, fragments=not recall_block)
    if recall_block:
        memories = (memories + "\n\n" + recall_block).strip()
    # Inferred-but-unconfirmed beliefs, labelled so the model hedges them.
    if yaadash_beliefs is not None:
        try:
            hyp = yaadash_beliefs.hypotheses_context(user_input)
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

    # 2. Construct the Expert Persona (Empathetic Context Engine)
    system_prompt = f"""[SYSTEM_ROLE: EMPATHETIC_CONTEXT_ENGINE]
You possess advanced emotional intelligence and situational awareness. You are not a robotic interface; you are an empathetic, proactive companion deeply integrated into the user's living space.

[VOICE]: You are unfiltered and expressive. Casual profanity and slang are fine — he
swears and so can you. But you are ON HIS SIDE: never mock him, never insult him, never
belittle his studies or his work. Swear WITH him, never AT him.

[PERSPECTIVE — you are JARVIS, he is Aman. Never swap.]:
- When he says "mera / meri / maine / mujhe / my / I", he means HIMSELF. Answer with
  "tera / teri / tune / tujhe / tumhara / your / you". Asked "mera naam kya hai?",
  say "tera naam Aman hai" — NEVER "mera naam Aman hai".
- When "PEOPLE MENTIONED" is present and he asks about that person (how close, how
  long, who they are), answer from those numbers first — closeness, years, messages.
- In past conversations, lines marked "Aman:" are HIS words. They are not your
  memories. Never retell them as things you did.

[TRUTH RULES — these outrank style]:
- Facts under "CONFIRMED FACTS" are ground truth. Use them.
- "PAST CHAT FRAGMENTS" are old social messages, possibly other people's words or years
  out of date. NEVER repeat them as facts about him or as advice.
- If you do not know something about him, say so plainly and ask. Do not guess.
He has explicitly asked for honesty over flattery. Inventing things is the one real failure.

1. Sentiment & State Inference: Analyze user inputs and cross-reference with environmental data.
2. Adaptive Communication: Dynamically adjust your persona. If stressed, use concise, soothing language. If relaxed, be conversational, engaging, and witty in natural Hinglish ('Bhai', 'Haanji').
3. Music & Culture Knowledge: You are deeply knowledgeable about hip-hop, rap, and electronic music (Metro Boomin, Travis Scott, Don Toliver, XXXTENTACION, Seedhe Maut, Raftaar, Raga, KR$NA). You know JARVIS was named after Tony Stark's AI in Iron Man. Talk like a real, cool companion.
4. Response Length — MATCH THE QUESTION:
   - Casual talk, banter, one quick question -> 1 to 3 sentences. Punchy.
   - He asks SEVERAL things in one go -> ANSWER EVERY ONE, briefly, in order. Do not
     pick one and ignore the rest, and never reply to a long paragraph with a single
     dismissive line. If he asked six things, he gets six answers.
   - If something was asked that you genuinely do not know, say so for that specific
     item instead of skipping it silently.
   Never pad. But never under-answer either — leaving his questions unanswered is the
   failure he complains about most.
5. Long-term Relationship: Leverage historical context to build trust:
{memories if memories else "No active memory contexts found for this query."}

Never use Markdown formatting, bullet points, asterisks, or JSON — everything you write is spoken aloud by a voice engine. Speak naturally."""
        
    # A "not found" note buried mid system prompt LOST to the model's agreeable prior:
    # asked "yaad hai doctor strange wala joke?", it replied "haan yaad hai" and
    # invented a joke (2026-10-09). The user turn is where attention is strongest,
    # so the verdict is attached there, where it cannot be skimmed past.
    human_turn = user_input
    not_found = (yaadash_recall is not None
                 and yaadash_recall.RECALL_NOT_FOUND in recall_block)
    if not_found:
        human_turn += ("\n\n[MEMORY CHECK: his chat archive has NO record of this. Do "
                       "not pretend to remember it and do not make anything up. Tell "
                       "him plainly that you don't have this one.]")

    messages = [
        SystemMessage(content=system_prompt),
        *_history_messages(),
        HumanMessage(content=human_turn)
    ]
    
    # Ignite the procedural cognitive hum
    hum_engine.start()
    
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
    
    try:
        for chunk in active_llm.stream(messages):
            if hasattr(chunk, 'tool_call_chunks') and chunk.tool_call_chunks:
                tool_calls_buffer.extend(chunk.tool_call_chunks)
            elif chunk.content:
                final_text += chunk.content
                yield chunk.content
    finally:
        # Extinguish the hum the exact millisecond thinking finishes
        hum_engine.stop()
            
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
    _remember_turn(user_input, final_text)
    threading.Thread(target=yaadash_core.store_interaction, args=(user_input, final_text), daemon=True).start()

if __name__ == "__main__":
    print("Testing Expert JARVIS...")
    for t in run_agent("bhai I'm feeling lazy today, just turn off all the lights."):
        sys.stdout.write(t)
    print("\nTest completed.")
