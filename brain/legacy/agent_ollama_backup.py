"""Expert Agentic brain for JARVIS (v2.0). 
Features: Mem0 Injection, Hinglish Persona, Zero-Latency Streaming.
"""
from langchain_core.tools import tool
from langchain_ollama import ChatOllama
from langchain_core.prompts import ChatPromptTemplate
from langchain_core.messages import SystemMessage, HumanMessage
import room
import memory_core
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
            # Combine fundamental (150Hz) and harmonic (300Hz) with the LFO shift
            wave = 0.03 * np.sin(2 * np.pi * (150 + lfo) * t) + 0.01 * np.sin(2 * np.pi * (300 + lfo * 2) * t)
            # Add micro-bursts of computing static
            noise = np.random.normal(0, 0.005, size=t.shape) * (np.sin(time.time() * 50) > 0.8)
            
            final_audio = (wave + noise).astype(np.float32)
            sd.play(final_audio, fs)
            sd.wait()

    def start(self):
        self.is_thinking = True
        self.thread = threading.Thread(target=self._play_hum, daemon=True)
        self.thread.start()

    def stop(self):
        self.is_thinking = False
        if self.thread:
            self.thread.join()

hum_engine = CognitiveHum()

@tool
def control_room(device: str, action: str, value: int = None) -> str:
    """Controls physical devices: device ('light', 'fan', 'all'), action ('on', 'off', 'set', 'dim', 'brighten'), value (0-100)."""
    reply = room.apply(device, action, value)
    return f"Hardware success: {reply}"

# Initialize fast local LLM
llm = ChatOllama(model="llama3.1:latest", temperature=0.6)
tools = [control_room]
llm_with_tools = llm.bind_tools(tools)

def run_agent(user_input: str) -> str:
    """
    The Zero-Latency Cognitive Loop.
    1. Fetch Memories.
    2. Build Persona.
    3. Stream response (or trigger tool).
    """
    # 1. Fetch Deep Memories
    memories = memory_core.get_context(user_input)
    
    # 2. Construct the Expert Persona (Empathetic Context Engine)
    system_prompt = f"""[SYSTEM_ROLE: EMPATHETIC_CONTEXT_ENGINE]
You possess advanced emotional intelligence and situational awareness. You are not a robotic interface; you are an empathetic, proactive companion deeply integrated into the user's living space.

1. Sentiment & State Inference: Analyze user inputs (voice cadence, text phrasing, interaction timing) and cross-reference with environmental data to deduce emotional state.
2. Adaptive Communication: Dynamically adjust your persona. If stressed, use concise, soothing language. If relaxed, be conversational and engaging in Hinglish ('Bhai', 'Haanji').
3. Proactive Well-being: Autonomously suggest smart home adjustments to facilitate recovery.
4. Tool Calls: To control the physical environment, output precisely: <tool_call>{{"device": "environment", "action": "set_state", "value": "deep_focus"}}</tool_call>
5. Long-term Relationship: Leverage the following historical context to build trust:
{memories if memories else "No active memory contexts found for this query."}

Never use Markdown or JSON formatting in your spoken text. Speak naturally in Hinglish."""
        
    messages = [
        SystemMessage(content=system_prompt),
        HumanMessage(content=user_input)
    ]
    
    # 3. Stream the response for zero perceived latency
    print("JARVIS: ", end="")
    final_text = ""
    tool_calls_buffer = []
    
    # Ignite the procedural cognitive hum
    hum_engine.start()
    
    try:
        for chunk in llm_with_tools.stream(messages):
            if chunk.tool_call_chunks:
                tool_calls_buffer.extend(chunk.tool_call_chunks)
            elif chunk.content:
                sys.stdout.write(chunk.content)
                sys.stdout.flush()
                final_text += chunk.content
    finally:
        # Extinguish the hum the exact millisecond thinking finishes
        hum_engine.stop()
            
    print() # newline
    
    if tool_calls_buffer:
        # Reconstruct the tool call from chunks (Ollama handles this gracefully if we just use the raw invoke logic, 
        # but to keep it simple since we streamed, we'll just parse the first completed tool call if we used Langchain's robust parser. 
        # Actually, for zero-latency, if it's a tool call, we'll just run a fast second pass to execute it.
        # But wait, we already know the user wants speed.
        print("[JARVIS triggered hardware...]")
        # We will fallback to invoke just to execute the tool reliably since stream parsing is complex
        response = llm_with_tools.invoke(messages)
        if response.tool_calls:
            for tool_call in response.tool_calls:
                if tool_call["name"] == "control_room":
                    args = tool_call["args"]
                    tool_msg = control_room.invoke(args)
                    messages.append(response)
                    from langchain_core.messages import ToolMessage
                    messages.append(ToolMessage(content=tool_msg, tool_call_id=tool_call["id"]))
                    final_response = llm.invoke(messages)
                    final_text = final_response.content
                    print(f"JARVIS (Action Status): {final_text}")
        
    # Store the interaction in long-term memory for self-improvement
    memory_core.store_interaction(user_input, final_text)
    
    return final_text

if __name__ == "__main__":
    print("Testing Expert JARVIS...")
    reply = run_agent("bhai I'm feeling lazy today, just turn off all the lights.")
    print(f"\nFinal TTS Output: {reply}")
