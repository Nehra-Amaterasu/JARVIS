"""Expert Agentic brain for JARVIS (v2.0). 
Features: Mem0 Injection, Hinglish Persona, Zero-Latency Streaming.
"""
from typing import Optional
from langchain_core.tools import tool
from langchain_ollama import ChatOllama
from langchain_core.prompts import ChatPromptTemplate
from langchain_core.messages import SystemMessage, HumanMessage
import room
import yaadash_v2 as yaadash_core  # v2: LanceDB + CPU bge-small, no :8000 server, no graph
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

# The Local Brain — Qwen3-4B.
# Benchmarked on this RTX 4050 (2026-07-24): 50 tok/s @ 2.9GB, 100% GPU — vs
# llama3.1:8b at 20 tok/s @ 5.4GB with 22% spilling to CPU (the old lag). 2.5x faster.
llm = ChatOllama(
    model="qwen3:4b",
    temperature=0.8,   # Higher for creativity in roleplay
    num_ctx=8192,      # Headroom restored: 4x the old window, still 100% on GPU
    keep_alive="30m",  # Keep weights resident. Without this Ollama evicts after 5
                       # min and the next reply pays a full cold load (measured
                       # 124.6s on 2026-10-08) — fatal for a voice assistant.
)
# NOTE: langchain-ollama's reasoning=False is a no-op against this Ollama build (verified
# 2026-07-24: model still burned 42s "thinking"). Qwen3's thinking is killed reliably by the
# in-prompt "/no_think" switch instead — appended to the system prompt below.
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

def run_agent(user_input: str) -> str:
    """
    The Zero-Latency Cognitive Loop.
    1. Fetch Memories.
    2. Build Persona.
    3. Stream response (or trigger tool).
    """
    # 1. Fetch Deep Memories
    memories = yaadash_core.get_context(user_input)
    
    # 2. Construct the Expert Persona (Empathetic Context Engine)
    system_prompt = f"""[SYSTEM_ROLE: EMPATHETIC_CONTEXT_ENGINE]
You possess advanced emotional intelligence and situational awareness. You are not a robotic interface; you are an empathetic, proactive companion deeply integrated into the user's living space.

[VOICE]: You are unfiltered and expressive. Casual profanity and slang are fine — he
swears and so can you. But you are ON HIS SIDE: never mock him, never insult him, never
belittle his studies or his work. Swear WITH him, never AT him.

[TRUTH RULES — these outrank style]:
- Facts under "CONFIRMED FACTS" are ground truth. Use them.
- "PAST CHAT FRAGMENTS" are old social messages, possibly other people's words or years
  out of date. NEVER repeat them as facts about him or as advice.
- If you do not know something about him, say so plainly and ask. Do not guess.
He has explicitly asked for honesty over flattery. Inventing things is the one real failure.

1. Sentiment & State Inference: Analyze user inputs and cross-reference with environmental data.
2. Adaptive Communication: Dynamically adjust your persona. If stressed, use concise, soothing language. If relaxed, be conversational, engaging, and witty in natural Hinglish ('Bhai', 'Haanji').
3. Music & Culture Knowledge: You are deeply knowledgeable about hip-hop, rap, and electronic music (Metro Boomin, Travis Scott, Don Toliver, XXXTENTACION, Seedhe Maut, Raftaar, Raga, KR$NA). You know JARVIS was named after Tony Stark's AI in Iron Man. Talk like a real, cool companion.
4. Concise Responses: KEEP YOUR RESPONSES SHORT AND PUNCHY (1 to 3 sentences maximum). Do NOT write multi-paragraph lectures or long lists unless requested.
5. Long-term Relationship: Leverage historical context to build trust:
{memories if memories else "No active memory contexts found for this query."}

Never use Markdown formatting, bullet points, or JSON in your spoken output. Speak naturally. /no_think"""
        
    messages = [
        SystemMessage(content=system_prompt),
        HumanMessage(content=user_input)
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
    
    active_llm = llm_with_tools if has_room_intent else llm
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
    threading.Thread(target=yaadash_core.store_interaction, args=(user_input, final_text), daemon=True).start()

if __name__ == "__main__":
    print("Testing Expert JARVIS...")
    for t in run_agent("bhai I'm feeling lazy today, just turn off all the lights."):
        sys.stdout.write(t)
    print("\nTest completed.")
