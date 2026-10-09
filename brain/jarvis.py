"""JARVIS v2.0 — Zero Latency, Self-Evolving, Hinglish Voice Assistant."""
import os
import sys

# 2026-10-08: Windows consoles default to cp1252 and raise UnicodeEncodeError on
# Devanagari or emoji, which killed the voice loop mid-reply whenever Whisper
# returned Hindi script. Reconfigured in code rather than via PYTHONIOENCODING
# because python -I ignores env vars (that is how this bug slipped through before).
try:
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')
    sys.stderr.reconfigure(encoding='utf-8', errors='replace')
except Exception:
    pass
# Dynamically add CUDA 12 libraries to the Windows PATH
try:
    import nvidia.cublas
    import nvidia.cudnn
    
    cublas_dir = nvidia.cublas.__path__[0]
    cudnn_dir = nvidia.cudnn.__path__[0]
    
    # Prepend NVIDIA libraries to PATH to ensure PyTorch and CTranslate2 find them
    os.environ["PATH"] = os.path.join(cublas_dir, "bin") + os.pathsep + \
                         os.path.join(cudnn_dir, "bin") + os.pathsep + \
                         os.environ.get("PATH", "")
except Exception as e:
    # Fail silently to avoid spamming the user if PyTorch already handles CUDA natively
    pass

import warnings
import inspect
import asyncio
import threading
import uuid
import time

# [200 IQ FIX]: ChromaDB internally uses the deprecated asyncio.iscoroutinefunction which throws spam in Python 3.14.
# Instead of hiding it, we monkey-patch the module globally to use the correct modern inspect function.
if hasattr(asyncio, 'iscoroutinefunction'):
    asyncio.iscoroutinefunction = inspect.iscoroutinefunction

# [TERMINAL WARNING FIXES]: Disable oneDNN numerical recalculations and set clean logging
os.environ["TF_ENABLE_ONEDNN_OPTS"] = "0"
os.environ["TF_CPP_MIN_LOG_LEVEL"] = "2"
os.environ["HF_HUB_DISABLE_SYMLINKS_WARNING"] = "1"
os.environ["POSTHOG_DISABLED"] = "1"
os.environ["MEM0_TELEMETRY"] = "false"
os.environ["ANONYMIZED_TELEMETRY"] = "false"

# [TFLITE FIX FOR WINDOWS PYTHON 3.11]: openwakeword expects tflite_runtime.interpreter.
# Since tflite-runtime is unavailable on PyPI for Windows Python 3.11, we alias tensorflow.lite.
try:
    import tflite_runtime.interpreter
except ImportError:
    try:
        import tensorflow.lite as tflite_interp
        import types
        tflite_runtime = types.ModuleType("tflite_runtime")
        tflite_runtime.interpreter = tflite_interp
        sys.modules["tflite_runtime"] = tflite_runtime
        sys.modules["tflite_runtime.interpreter"] = tflite_interp
    except Exception:
        pass

import pygame
import edge_tts
import numpy as np
import sounddevice as sd
from faster_whisper import WhisperModel
try:
    from indic_transliteration import sanscript
except ImportError:
    sanscript = None
from openwakeword.model import Model
import traceback

import room
import agent
import hinglish
import chimes

SAMPLE_RATE = 16000
SILENCE_THRESHOLD = 0.04  # Lowered from 0.08 so JARVIS can hear normal speaking volume
# 2026-10-08: was 2.0, which cut me off mid-paragraph. I think out loud and
# pauses for 2-3s between clauses; a 2s cutoff ends the recording during those pauses,
# so long multi-question prompts arrived as fragments. The UI even printed "pausing
# for 4s" while the constant said 2.0. 4.0 matches the promise and my speech rhythm.
SILENCE_DURATION = 4.0

# --- Voice ---
# Was en-IN-NeerjaNeural at rate="+15%". The speed-up is what made Hinglish sound
# garbled (rated 4/10): Hindi words in Latin script need full duration to land.
# Prabhat is male, which fits JARVIS, and handles Latin-script Hinglish cleanly.
# Swap to "en-IN-NeerjaNeural" (female) or "hi-IN-MadhurNeural" (true Hindi voice,
# better for Devanagari output) if preferred.
TTS_VOICE = "en-IN-PrabhatNeural"
TTS_RATE = "+0%"

print("Booting Cognitive Subsystems...")
print("1. Loading Whisper STT (large-v3-turbo on GPU, int8_float16)...")
# Benchmarked 2026-10-08 on real Hinglish audio (same clip, ground truth known):
#   small / CPU / int8        -> 10.7s, badly garbled
#   large-v3-turbo / CUDA     ->  2.7s, every word correct
# Turbo is ~1GB at int8_float16 and fits in the ~2.6GB left beside qwen3:4b.
# Language is deliberately NOT pinned: auto-detect keeps English words in Latin,
# which the room-command keyword matching in agent.py depends on ("turn off light").
# Pinning hi would render those in Devanagari and silently break light control.
model = WhisperModel("large-v3-turbo", device="cuda", compute_type="int8_float16")

print("2. Initializing Audio Drivers (Edge-TTS + Cognitive Hum)...")
pygame.mixer.init(frequency=22050, size=-16, channels=2)

print("3. Loading Wake Word Engine (hey_jarvis)...")
oww_model = Model(wakeword_models=["hey_jarvis_v0.1"], inference_framework="onnx")

# Warm memory + brain during boot, not during the first question.
# Measured 2026-10-08: the bge-small embedder loaded lazily inside the first
# get_context() call, adding 6.76s to the first reply (0.09s once warm). The LLM
# likewise paid its weight-load on the first real question. Both costs now land
# here, while the user is already watching the boot sequence.
print("4. Warming Yaadash memory + brain...")
try:
    agent.yaadash_core.get_context("warmup")
    if agent.yaadash_recall is not None:
        agent.yaadash_recall.recall_context("yaad hai warmup")   # BM25 + people + archive
    agent.llm.invoke("hi")
except Exception as _e:
    print(f"   (warm-up skipped: {_e})")

# --- PROCEDURAL SIRI-STYLE SOOTHING COGNITIVE HUM ENGINE ---
hum_sound = None
def _init_cognitive_hum():
    global hum_sound
    try:
        sample_rate = 22050
        duration = 1.5 # 1.5 sec smooth loop
        t = np.linspace(0, duration, int(sample_rate * duration), endpoint=False)
        # Soothing Siri-style harmonic resonance (432Hz fundamental + 864Hz octave)
        envelope = np.sin(np.pi * t / duration) # Soft fade in/out envelope
        wave = (0.05 * np.sin(2 * np.pi * 432 * t) + 0.02 * np.sin(2 * np.pi * 864 * t)) * envelope
        stereo_wave = np.column_stack((wave, wave))
        audio_int16 = (stereo_wave * 32767).astype(np.int16)
        hum_sound = pygame.sndarray.make_sound(audio_int16)
    except Exception as e:
        hum_sound = None

_init_cognitive_hum()

def start_hum():
    global hum_sound
    if hum_sound:
        try: hum_sound.play(loops=-1)
        except Exception: pass

def stop_hum():
    global hum_sound
    if hum_sound:
        try: hum_sound.stop()
        except Exception: pass

# --- SEQUENTIAL SPEECH AUDIO QUEUE (PREVENTS WORD-EATING & TRUNCATION) ---
import queue
speech_queue = queue.Queue()

def _tts_worker():
    global last_interrupted_script
    while True:
        item = speech_queue.get()
        if item is None:
            break
        text, audio_file = item
        try:
            pygame.mixer.music.load(audio_file)
            pygame.mixer.music.play()
            while pygame.mixer.music.get_busy():
                time.sleep(0.05)
            pygame.mixer.music.unload()
            if os.path.exists(audio_file):
                os.remove(audio_file)
        except Exception:
            pass
        speech_queue.task_done()

threading.Thread(target=_tts_worker, daemon=True).start()

def listen_for_wake_word():
    print("\n[Sleeping. Say 'Hey Jarvis' to wake up...]")
    # Reset openWakeWord internal state to clear stale audio features
    oww_model.reset()
    
    import queue
    q = queue.Queue()
    
    def callback(indata, frames, time, status):
        # Downmix multi-channel arrays to mono to fix Intel Smart Sound array bug
        if indata.shape[1] > 1:
            mono_data = np.mean(indata, axis=1).astype(np.int16)
        else:
            mono_data = indata.flatten()
        q.put(mono_data.copy())
        
    with sd.InputStream(samplerate=16000, dtype="int16", blocksize=1280, callback=callback):
        # Discard the first 2 chunks to flush stream startup noise
        for _ in range(2):
            if not q.empty(): q.get()
            
        while True:
            chunk = q.get()
            prediction = oww_model.predict(chunk.flatten())
            
            # Lowered threshold from 0.5 to 0.35 for effortless detection
            for model_name, score in prediction.items():
                if score > 0.35:
                    print(f"\n>>> WAKE WORD DETECTED! ({model_name}: {score:.2f}) <<<")
                    oww_model.reset()
                    return

# Interruption Continuation Memory Buffer
last_interrupted_script = ""
was_interrupted = False

async def _async_speak(text):
    if not text: return
    # Balanced voice (en-IN-NeerjaNeural) set to +15% speed (1.15x) for fluid, snappy delivery
    communicate = edge_tts.Communicate(text, TTS_VOICE, rate=TTS_RATE)
    audio_file = f"response_{uuid.uuid4().hex[:8]}.mp3"
    await communicate.save(audio_file)
    if os.path.exists(audio_file) and os.path.getsize(audio_file) > 100:
        speech_queue.put((text, audio_file))

import re as _re

_EMOJI = _re.compile(
    "[\U0001F300-\U0001FAFF\U00002600-\U000027BF\U0001F000-\U0001F2FF"
    "\U0000FE0F\U0000200D]+"
)


def clean_for_speech(text: str) -> str:
    """Strip markup the model writes for screens but a voice cannot say.

    2026-10-08: Qwen3 emits Markdown (**bold**, *italic*, numbered lists) despite the
    prompt forbidding it, and edge-tts read every marker literally — "asterisk
    asterisk stop wasting ten seconds asterisk asterisk". Prompt rules alone are not
    a reliable guard on model output, so the voice path sanitises unconditionally.
    The printed transcript keeps the original text; only the spoken audio is cleaned.
    """
    if not text:
        return text
    t = _re.sub(r"`{1,3}[^`]*`{1,3}", "", text)           # code spans
    t = _re.sub(r"\*{1,3}|_{2,}|~~|#{1,6}\s*", "", t)      # bold/italic/strike/headers
    t = _re.sub(r"^\s*[-*•]\s+", "", t, flags=_re.M)       # bullet markers
    t = _re.sub(r"^\s*\d+[.)]\s+", "", t, flags=_re.M)     # "1. " list numbers
    t = _re.sub(r"\[([^\]]+)\]\([^)]+\)", r"\1", t)        # [label](url) -> label
    t = _EMOJI.sub("", t)                                  # emoji are noise in TTS
    t = _re.sub(r"[—–]", ", ", t)                          # dashes -> natural pause
    t = _re.sub(r"\s+", " ", t).strip()
    return t


def speak(text):
    """Queues TTS audio for sequential playback without sentence truncation."""
    text = clean_for_speech(text)
    if not text: return
    asyncio.run(_async_speak(text))

def record_vad():
    """Records audio automatically by detecting voice activity with visual feedback."""
    chimes.play_chime("wake")
    print("\n[Listening... Speak naturally. Pausing for 4s processes the command]")
    audio_data = []
    silence_frames = 0
    is_speaking = False
    
    import sys
    
    pulse_icons = [" |iI|iI|iI|iI| ", " iI|iI|iI|iI| ", " I|iI|iI|iI|i ", " |iI|iI|iI|iI| "]
    pulse_idx = 0
    
    def callback(indata, frames, timestamp, status):
        nonlocal is_speaking, silence_frames, pulse_idx
        volume_norm = np.linalg.norm(indata) * 10
        
        if volume_norm > SILENCE_THRESHOLD:
            # [PHASE 4: FULL-DUPLEX INTERRUPTION]
            # Instantly stop playback and save un-spoken text into the continuation buffer if user speaks
            if pygame.mixer.music.get_busy() or not speech_queue.empty():
                pygame.mixer.music.stop()
                
                # Gather remaining un-spoken text for seamless continuation
                remaining_text = []
                while not speech_queue.empty():
                    try:
                        txt, f_path = speech_queue.get_nowait()
                        remaining_text.append(txt)
                    except Exception: pass
                
                if remaining_text:
                    global last_interrupted_script, was_interrupted
                    last_interrupted_script = " ".join(remaining_text)
                    was_interrupted = True
                    
                sys.stdout.write("\n[System: Interrupted by User Voice — Script Saved to Continuation Buffer]\n")
                sys.stdout.flush()
                
            is_speaking = True
            silence_frames = 0
            # Compact single-line overwriting indicator (|iI|iI|iI|iI|)
            sys.stdout.write(f"\r[Listening...] {pulse_icons[pulse_idx % len(pulse_icons)]}")
            sys.stdout.flush()
            pulse_idx += 1
            
        if is_speaking:
            audio_data.append(indata.copy())
            if volume_norm <= SILENCE_THRESHOLD:
                silence_frames += 1
                
    with sd.InputStream(samplerate=SAMPLE_RATE, channels=1, dtype="float32", callback=callback):
        while True:
            # If we've been speaking and hit 4.0 seconds of silence, stop recording
            # Or if user hits Ctrl+C to force stop
            if is_speaking and silence_frames > (SAMPLE_RATE / 1024) * 4.0:
                print() # New line after the visual indicator finishes
                break
            sd.sleep(100)
            
    chimes.play_chime("process")
    return np.concatenate(audio_data).flatten() if audio_data else np.array([], dtype="float32")

def main_loop():
    print(f"\nMQTT broker: {'connected' if room.MQTT_OK else 'virtual room only'}")
    speak("System online. I am ready, boss.")
    
    while True:
        try:
            print("\n" + room.render())
            listen_for_wake_word()
            audio = record_vad()
            
            start_hum()
            print("Transcribing...", end="\r")
            speak("Transcribing.")
            # Dual Devanagari & English prompt with beam_size=5 for 100% accurate Hindi & Hinglish STT
            segments, info = model.transcribe(
                audio, 
                initial_prompt="नमस्ते, मैं हिन्दी और English दोनों में बात कर रहा हूँ। Hey Jarvis, kya haal hai?",
                condition_on_previous_text=False,
                vad_filter=True, 
                vad_parameters=dict(min_silence_duration_ms=1500, threshold=0.3, speech_pad_ms=400), 
                beam_size=5
            )
            # Whisper returns Hindi in Devanagari and English in Latin. Romanize only
            # the Devanagari runs so the line reads as one script; English is left
            # alone, keeping the room-command keywords in agent.py working.
            text = hinglish.romanize(" ".join(s.text for s in segments).strip())
            
            if len(text) < 2:
                stop_hum()
                continue
                    
            print(f"\nYou said: {text}")
            
            # Check if user wants to resume an interrupted thought
            global last_interrupted_script, was_interrupted
            resume_keywords = ["continue", "pick up", "go on", "what were you saying", "carry on", "finish your thought"]
            if was_interrupted and any(kw in text.lower() for kw in resume_keywords) and last_interrupted_script:
                print("\n[Resuming Interrupted Script...]")
                speak(f"Right, as I was saying... {last_interrupted_script}")
                was_interrupted = False
                last_interrupted_script = ""
                stop_hum()
                continue
                
            print("Thinking...", end="\r")
            speak("Thinking.")
            try:
                # Route to the Expert Streaming Brain
                print("JARVIS: ", end="")
                sentence_buffer = ""
                first_token = True
                for chunk in agent.run_agent(text):
                    if first_token:
                        stop_hum()
                        first_token = False
                        
                    sys.stdout.write(chunk)
                    sys.stdout.flush()
                    sentence_buffer += chunk
                    
                    # If we hit a punctuation mark, queue the sentence for full, clear playback
                    if any(p in chunk for p in ['.', '?', '!']):
                        if sentence_buffer.strip():
                            speak(sentence_buffer.strip())
                            sentence_buffer = ""
                
                # Speak any leftover text
                if sentence_buffer.strip():
                    speak(sentence_buffer.strip())
                    
            except Exception as e:
                stop_hum()
                print(f"\n[Cognitive Glitch]: {e}")
                
            # Active Follow-Up Conversation Loop:
            # Wait up to 5 seconds for user follow-up speech before returning to wake word sleep
            print("\n[Active Conversation Mode: Speak directly within 5s or say 'Hey Jarvis']")
            in_followup = False
            start_time = time.time()
            
            def followup_callback(indata, frames, timestamp, status):
                nonlocal in_followup
                volume_norm = np.linalg.norm(indata) * 10
                if volume_norm > SILENCE_THRESHOLD:
                    in_followup = True
                    
            with sd.InputStream(samplerate=SAMPLE_RATE, channels=1, dtype="float32", callback=followup_callback):
                while time.time() - start_time < 5.0:
                    if in_followup:
                        break
                    sd.sleep(100)
                    
            if in_followup:
                audio = record_vad()
                start_hum()
                segments, info = model.transcribe(
                    audio, 
                    initial_prompt="नमस्ते, मैं हिन्दी और English दोनों में बात कर रहा हूँ। Hey Jarvis, kya haal hai?",
                    condition_on_previous_text=False,
                    vad_filter=True, 
                    vad_parameters=dict(min_silence_duration_ms=1500, threshold=0.3, speech_pad_ms=400), 
                    beam_size=5
                )
                text = hinglish.romanize(" ".join(s.text for s in segments).strip())
                if len(text) >= 2:
                    print(f"\nYou said: {text}")
                    print("Thinking...", end="\r")
                    speak("Thinking.")
                    try:
                        print("JARVIS: ", end="")
                        sentence_buffer = ""
                        first_token = True
                        for chunk in agent.run_agent(text):
                            if first_token:
                                stop_hum()
                                first_token = False
                            sys.stdout.write(chunk)
                            sys.stdout.flush()
                            sentence_buffer += chunk
                            if any(p in chunk for p in ['.', '?', '!']):
                                if sentence_buffer.strip():
                                    speak(sentence_buffer.strip())
                                    sentence_buffer = ""
                        if sentence_buffer.strip():
                            speak(sentence_buffer.strip())
                    except Exception as e:
                        stop_hum()
                        print(f"\n[Cognitive Glitch]: {e}")
                    
        except Exception as e:
            tb = traceback.format_exc()
            print(f"\n[CRITICAL GLITCH DETECTED]: {e}")
            chimes.play_chime("error")
            speak("I encountered a critical error. Running self-diagnostics.")
            
            try:
                print("Diagnosing error in background...")
                diagnostic_reply = agent.diagnose_error(tb)
                print(f"JARVIS Diagnosis: {diagnostic_reply}")
                speak(diagnostic_reply)
            except Exception as inner_e:
                print(f"Self-diagnosis failed: {inner_e}")
                speak("Self-diagnostics failed. The core system requires manual intervention.")

if __name__ == "__main__":
    try:
        main_loop()
    except KeyboardInterrupt:
        print("\nSystem offline.")
