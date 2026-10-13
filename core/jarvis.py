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
import re
import uuid
import time
import tempfile

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

# Text-only mode (--text, from the desktop app) never touches the microphone, so it
# skips TensorFlow, Whisper and the wake-word engine entirely: those imports were
# most of a 44 s text-mode start for code that never runs.
_TEXT_ONLY_EARLY = "--text" in sys.argv

# [TFLITE FIX FOR WINDOWS PYTHON 3.11]: openwakeword expects tflite_runtime.interpreter.
# Since tflite-runtime is unavailable on PyPI for Windows Python 3.11, we alias tensorflow.lite.
try:
    if _TEXT_ONLY_EARLY:
        raise RuntimeError("text-only: no wake word")
    import tflite_runtime.interpreter
except RuntimeError:
    pass
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
if not _TEXT_ONLY_EARLY:
    from faster_whisper import WhisperModel
try:
    from indic_transliteration import sanscript
except ImportError:
    sanscript = None
if not _TEXT_ONLY_EARLY:
    from openwakeword.model import Model
import traceback

import room
import agent
import hinglish
import chimes
import appio

# Under the desktop app (--app) this process reports its state as structured
# events; with --text it skips the microphone, Whisper, the wake word and speech
# entirely. Run from a terminal with no flags, nothing below changes behaviour.
TEXT_ONLY = appio.TEXT_ONLY

# The Limbs tab drives the same room.apply() that voice commands use, so the app
# and JARVIS can never disagree about whether the light is on.
room.on_change = lambda device, st: appio.emit("room", device=device, state=st)
appio.on("room", lambda c: room.apply(c["device"], c["action"], c.get("value")))
appio.on("room_state", lambda c: appio.emit("room_state", state=room.state, mqtt=room.MQTT_OK))
# A line the app wants said verbatim (mission brief, nudge, Crucible call). Spoken on its
# own thread so the stdin reader stays free for room commands; silent in --text mode.
appio.on("speak", lambda c: threading.Thread(target=speak, args=(str(c.get("text", "")),), daemon=True).start())

SAMPLE_RATE = 16000
SILENCE_THRESHOLD = 0.04  # Lowered from 0.08 so JARVIS can hear normal speaking volume
# 2026-10-08: was 2.0, which cut me off mid-paragraph. I think out loud and
# pauses for 2-3s between clauses; a 2s cutoff ends the recording during those pauses,
# so long multi-question prompts arrived as fragments. The UI even printed "pausing
# for 4s" while the constant said 2.0. 4.0 matches the promise and my speech rhythm.
SILENCE_DURATION = 4.0

# --- End-pointing (when have I finished speaking?) ---
# 2026-10-12: the energy rule above (record_vad) cut me off on 10-10 and made every
# reply wait 4 s; endpoint.py replaces it with Silero VAD and a silence tail chosen by
# how my words end. The old rule stays, untouched, for comparison:
#   JARVIS_ENDPOINTER=energy  (or --endpointer=energy)
#   JARVIS_ENDPOINT_JUDGE=0   keeps Silero but turns off the speculative transcript
#                             (then the tail is a fixed 1.2 s)
import endpoint
ENDPOINTER = endpoint.mode_from(sys.argv, os.environ)
USE_JUDGE = os.environ.get("JARVIS_ENDPOINT_JUDGE", "1").strip() not in ("0", "false", "off", "no")
WAKE_TIMEOUT_S = 8.0       # after "Hey Jarvis", silence this long goes back to sleep (TESTING A8)
FOLLOWUP_S = 5.0           # follow-up window, counted once JARVIS has stopped talking

# --- Voice ---
# Was en-IN-PrabhatNeural reading romanised Hinglish: an English voice guessing at
# Hindi words spelled in Latin letters. Since 2026-10-09 voice.py owns the voices:
# British English by default, American / Hindi / Indian English on request or per
# tagged line, Devanagari always spoken by a native Hindi voice, offline fallback
# (Kokoro on the CPU), and nothing in the speech path can end a turn any more.
import voice as voice_mod
import stt
import ollama_guard              # starts Ollama if it isn't running
BRAIN_DOWN = ("My brain isn't running: Ollama is closed and I couldn't start it. "
              "Open Ollama, then ask me again.")

print("Booting Cognitive Subsystems...")
print("1. Loading Whisper STT (large-v3-turbo on GPU, int8_float16)...")
# Benchmarked 2026-10-08 on real Hinglish audio (same clip, ground truth known):
#   small / CPU / int8        -> 10.7s, badly garbled
#   large-v3-turbo / CUDA     ->  2.7s, every word correct
# Turbo is ~1GB at int8_float16 and fits in the ~2.6GB left beside qwen3:4b.
# Language is deliberately NOT pinned: auto-detect keeps English words in Latin,
# which the room-command keyword matching in agent.py depends on ("turn off light").
# Pinning hi would render those in Devanagari and silently break light control.
appio.emit("boot", step="whisper", text_only=TEXT_ONLY)
model = None if TEXT_ONLY else WhisperModel("large-v3-turbo", device="cuda", compute_type="int8_float16")

def _hear_phone(cmd: dict) -> None:
    """A recording from his phone (the app's /api/phone/hear): transcribe it with the
    Whisper already loaded and queue the text as a turn, like a typed message. Runs on
    its own thread so the stdin reader stays free for room commands. The file is the
    app's (DATA/phone/inbox) and is deleted here once read."""
    path, clip = str(cmd.get("path") or ""), cmd.get("id")

    def work():
        text, meta = "", {}
        try:
            if model is None:
                raise RuntimeError("text mode has no Whisper")
            t0 = time.time()
            raw, meta = stt.transcribe(model, path)          # faster-whisper decodes webm/ogg via PyAV
            text = hinglish.romanize(raw)
            text = text if len(text) >= 2 else ""
            meta = {**meta, "stt_s": round(time.time() - t0, 3)}
        except Exception as e:
            appio.emit("phone_heard", id=clip, text="", error=str(e))
            return
        finally:
            try:
                os.remove(path)
            except OSError:
                pass
        appio.emit("phone_heard", id=clip, text=text, **{k: v for k, v in meta.items() if k != "id"})
        appio.queue_say(text)
    threading.Thread(target=work, name="phone-hear", daemon=True).start()


appio.on("hear", _hear_phone)

print("2. Initializing Audio Drivers (Edge-TTS + Cognitive Hum)...")
appio.emit("boot", step="audio")
if not TEXT_ONLY:
    pygame.mixer.init(frequency=22050, size=-16, channels=2)

print("3. Loading Wake Word Engine (hey_jarvis)...")
appio.emit("boot", step="wakeword")
oww_model = None if TEXT_ONLY else Model(wakeword_models=["hey_jarvis_v0.1"], inference_framework="onnx")

# The end-pointer's VAD (Silero v6 from faster-whisper's assets, CPU, 0.17 ms a frame).
# If it cannot load, the old energy rule is used and the log says so.
silero_vad = None
if not TEXT_ONLY and ENDPOINTER == "silero":
    try:
        silero_vad = endpoint.SileroStream()
    except Exception as _e:
        print(f"   (Silero VAD unavailable, using the old energy rule: {_e})")
        ENDPOINTER = "energy"
print(f"   End-pointing: {ENDPOINTER}" + (" + speculative transcript" if ENDPOINTER == "silero" and USE_JUDGE else ""))

# Waking on his name alone (core/wake.py): Silero finds a burst of speech, Whisper
# reads it, "Jarvis" anywhere in it wakes him. Its own Silero stream: the end-pointer's
# keeps LSTM state of its own. JARVIS_NAME_WAKE=0 turns it off (openWakeWord only).
import wake
name_spotter = None
if not TEXT_ONLY and model is not None and os.environ.get("JARVIS_NAME_WAKE", "1") != "0":
    try:
        name_spotter = wake.NameSpotter(vad=endpoint.SileroStream(), transcribe=wake.whisper_transcriber(model),
                                        hold=lambda: _jarvis_talking())
        print("   Wake: \"Jarvis\" (Whisper name spotter) + \"Hey Jarvis\" (openWakeWord)")
    except Exception as _e:
        print(f"   (name spotter unavailable, \"Hey Jarvis\" only: {_e})")

# Warm memory + brain during boot, not during the first question.
# Measured 2026-10-08: the bge-small embedder loaded lazily inside the first
# get_context() call, adding 6.76s to the first reply (0.09s once warm). The LLM
# likewise paid its weight-load on the first real question. Both costs now land
# here, while the user is already watching the boot sequence.
print("4. Warming Yaadash memory + brain...")
appio.emit("boot", step="memory")
if not ollama_guard.ensure():
    appio.emit("error", message=BRAIN_DOWN)
try:
    agent.yaadash_core.get_context("warmup")
    if agent.yaadash_recall is not None:
        agent.yaadash_recall.recall_context("yaad hai warmup")   # BM25 + people + archive
    # With the real system message (persona + every confirmed fact, ~1900 tokens),
    # so Ollama has that prefix cached before the first question, not just the weights.
    agent.llm.invoke([agent.SystemMessage(content=agent.persona(agent.appio_text_mode())),
                      agent.HumanMessage(content="hi")])
except Exception as _e:
    print(f"   (warm-up skipped: {_e})")
# Whisper's first decode pays CUDA set-up: measured 2026-10-12 on the RTX 4050, the
# same 1.5 s clip took 2.77 s cold and 0.62 s warm. The end-pointer transcribes at the
# first pause, so that cost would land on the first question. Pay it here instead
# (no VAD filter: on silence the filter would skip the decoder and warm nothing).
if model is not None:
    try:
        _noise = (np.random.default_rng(0).standard_normal(SAMPLE_RATE) * 0.003).astype(np.float32)
        list(model.transcribe(_noise, beam_size=5, vad_filter=False, condition_on_previous_text=False,
                              initial_prompt=stt.VOCAB_PROMPT)[0])
    except Exception as _e:
        print(f"   (Whisper warm-up skipped: {_e})")

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

if not TEXT_ONLY:
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
        text, audio_file = item[0], item[1]
        gain = item[2] if len(item) > 2 else 1.0     # levels accents (voice.py Style gains)
        try:
            appio.emit("state", state="speaking", text=text)
            global _first_audio_pending
            if _first_audio_pending:
                _first_audio_pending = False
                appio.emit("timing", stage="first_audio", seconds=round(time.time() - _turn_started, 3))
            pygame.mixer.music.load(audio_file)
            pygame.mixer.music.set_volume(gain)
            pygame.mixer.music.play()
            while pygame.mixer.music.get_busy():
                time.sleep(0.05)
            pygame.mixer.music.unload()
            if os.path.exists(audio_file):
                os.remove(audio_file)
        except Exception:
            pass
        if speech_queue.empty() and voice_engine.pending() == 0:
            appio.emit("speech_done")
        speech_queue.task_done()

threading.Thread(target=_tts_worker, daemon=True).start()

def listen_for_wake_word():
    """Block until "Hey Jarvis" -> None, or until the app sends a typed message
    -> that text (so typing in the app works while JARVIS is asleep)."""
    print("\n[Sleeping. Say 'Jarvis' to wake me...]")
    appio.emit("state", state="sleeping")
    # Reset openWakeWord internal state to clear stale audio features
    oww_model.reset()
    if name_spotter is not None:
        name_spotter.reset()
    
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
            typed = appio.poll_say()
            if typed:
                return typed
            try:
                chunk = q.get(timeout=0.1)
            except queue.Empty:
                continue
            prediction = oww_model.predict(chunk.flatten())
            if name_spotter is not None:
                heard = name_spotter.feed(chunk)
                if heard is not None:
                    # "Jarvis, turn off the light" in one breath: the rest IS the request.
                    print(f"\n>>> NAME HEARD: \"{heard.text}\" <<<")
                    appio.emit("wake", score=1.0, by="name", heard=heard.text)
                    oww_model.reset()
                    if heard.rest:
                        return heard.rest
                    return None

            # Lowered threshold from 0.5 to 0.35 for effortless detection
            for model_name, score in prediction.items():
                if score > 0.35:
                    print(f"\n>>> WAKE WORD DETECTED! ({model_name}: {score:.2f}) <<<")
                    appio.emit("wake", score=round(float(score), 2))
                    oww_model.reset()
                    return None

# Interruption Continuation Memory Buffer
last_interrupted_script = ""
was_interrupted = False

clean_for_speech = voice_mod.clean_for_speech


def _play(text, audio_file, gain=1.0):
    speech_queue.put((text, audio_file, gain))


voice_engine = voice_mod.VoiceEngine(play=_play, log=print, enabled=not TEXT_ONLY)


def speak(text):
    """Queue text for speech and return at once (synthesis runs on the voice thread).

    Until 2026-10-09 this synthesised synchronously, one new event loop per sentence,
    so the token loop stalled ~1-1.8 s per sentence, and any edge-tts error (a bare
    "..." raised NoAudioReceived; no network raised at boot) killed the turn or the loop.
    """
    if TEXT_ONLY or not text:
        return
    voice_engine.say(text)


def record_vad():
    """Records audio automatically by detecting voice activity with visual feedback."""
    chimes.play_chime("wake")
    appio.emit("state", state="listening")
    print("\n[Listening... Speak naturally. Pausing for 4s processes the command]")
    last_level = [0.0]
    audio_data = []
    silence_frames = 0
    is_speaking = False
    
    import sys
    
    pulse_icons = [" |iI|iI|iI|iI| ", " iI|iI|iI|iI| ", " I|iI|iI|iI|i ", " |iI|iI|iI|iI| "]
    pulse_idx = 0
    
    def callback(indata, frames, timestamp, status):
        nonlocal is_speaking, silence_frames, pulse_idx
        volume_norm = np.linalg.norm(indata) * 10
        now = time.time()
        if now - last_level[0] > 0.08:
            last_level[0] = now
            appio.emit("level", level=round(float(volume_norm), 4), threshold=SILENCE_THRESHOLD)
        
        if volume_norm > SILENCE_THRESHOLD:
            # [PHASE 4: FULL-DUPLEX INTERRUPTION]
            # Instantly stop playback and save un-spoken text into the continuation buffer if user speaks
            if pygame.mixer.music.get_busy() or not speech_queue.empty() or voice_engine.pending():
                pygame.mixer.music.stop()
                voice_engine.clear()          # sentences not yet synthesised are dropped too
                
                # Gather remaining un-spoken text for seamless continuation
                remaining_text = []
                while not speech_queue.empty():
                    try:
                        queued = speech_queue.get_nowait()
                        txt, f_path = queued[0], queued[1]
                        remaining_text.append(txt)
                        if os.path.exists(f_path):
                            os.remove(f_path)
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


def _followup_energy() -> bool:
    """The pre-2026-10-12 follow-up listener (energy rule): True if any sound came
    within 5 s. Kept verbatim for JARVIS_ENDPOINTER=energy."""
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
    return in_followup


def _jarvis_talking() -> bool:
    """True while a reply is still playing or queued (the follow-up clock waits)."""
    try:
        return bool(pygame.mixer.music.get_busy() or not speech_queue.empty() or voice_engine.pending())
    except Exception:
        return False


def _interrupt_speech() -> None:
    """Barge-in: stop JARVIS mid-reply and keep what he had not said yet (the same
    continuation buffer record_vad fills)."""
    global last_interrupted_script, was_interrupted
    pygame.mixer.music.stop()
    voice_engine.clear()
    remaining_text = []
    while not speech_queue.empty():
        try:
            queued = speech_queue.get_nowait()
            remaining_text.append(queued[0])
            if os.path.exists(queued[1]):
                os.remove(queued[1])
        except Exception:
            pass
    if remaining_text:
        last_interrupted_script = " ".join(remaining_text)
        was_interrupted = True
    sys.stdout.write("\n[System: Interrupted by User Voice — Script Saved to Continuation Buffer]\n")
    sys.stdout.flush()


_quick_whisper = wake.whisper_transcriber(model) if model is not None else None


def _quick_text(audio) -> str:
    """A fast greedy transcript of a short burst (for "stop Jarvis" while he talks)."""
    try:
        return _quick_whisper(audio) if _quick_whisper is not None else ""
    except Exception as e:
        print(f"\n[quick transcript failed: {e}]")
        return ""


def _judge_fn(audio):
    """The end-pointer's judge: transcribe the audio so far, exactly as a finished turn
    would be (stt.transcribe), so the result can be reused instead of decoding twice."""
    raw, meta = stt.transcribe(model, audio)
    return hinglish.romanize(raw), (raw, meta)


judge = (endpoint.ThreadJudge(_judge_fn)
         if (not TEXT_ONLY and ENDPOINTER == "silero" and USE_JUDGE and model is not None) else None)


def _record_silero(followup: bool = False) -> "endpoint.Utterance":
    """One utterance through endpoint.EndPointer: mic blocks of 512 samples go to a
    queue, and this thread scores and segments them (the audio callback stays tiny)."""
    cfg = endpoint.EndpointConfig(start_timeout_s=FOLLOWUP_S if followup else WAKE_TIMEOUT_S)
    ep = endpoint.EndPointer(cfg, vad=silero_vad, judge=judge, hold=_jarvis_talking)
    if followup:
        print(f"\n[Active Conversation Mode: Speak directly within {FOLLOWUP_S:.0f}s of my reply, or say 'Hey Jarvis']")
        appio.emit("state", state="followup")
    else:
        chimes.play_chime("wake")
        appio.emit("state", state="listening")
        print("\n[Listening... Speak naturally; I stop when you have finished]")
    blocks: "queue.Queue[np.ndarray]" = queue.Queue()

    def callback(indata, frames, timestamp, status):
        blocks.put(indata[:, 0].copy())

    def next_block(timeout):
        try:
            return blocks.get(timeout=timeout)
        except queue.Empty:
            return None

    # Speech that starts while JARVIS is talking no longer interrupts him. With noise
    # suppression off (10-13), room noise and his own voice opened "utterances" that
    # cut him off and were answered as if Aman had spoken ("pravadi aur English
    # donon"). Now such speech is only checked for "stop Jarvis" (wake.is_stop).
    over = {"jarvis": False}

    def on_event(kind, _t, _info):
        if kind == "start":
            over["jarvis"] = _jarvis_talking()
            if followup and not over["jarvis"]:
                appio.emit("state", state="listening")

    pulse_icons = [" |iI|iI|iI|iI| ", " iI|iI|iI|iI| ", " I|iI|iI|iI|i ", " |iI|iI|iI|iI| "]
    shown = {"pulse": 0, "level_t": 0.0}

    def on_block(block):
        now = time.time()
        if now - shown["level_t"] > 0.08:
            shown["level_t"] = now
            # Same level/threshold as before so the reactor looks the same; the VAD's
            # own view rides along for anything that wants it.
            appio.emit("level", level=round(float(np.linalg.norm(block) * 10), 4),
                       threshold=SILENCE_THRESHOLD, speech_prob=round(ep.last_prob, 3),
                       vad_threshold=cfg.start_threshold, speaking=ep.started)
        if ep.started and ep.last_prob >= cfg.stop_threshold:
            sys.stdout.write(f"\r[Listening...] {pulse_icons[shown['pulse'] % len(pulse_icons)]}")
            sys.stdout.flush()
            shown["pulse"] += 1

    with sd.InputStream(samplerate=SAMPLE_RATE, channels=1, dtype="float32",
                        blocksize=endpoint.FRAME, callback=callback):
        while True:
            utt = endpoint.listen(ep, next_block, on_event=on_event, on_block=on_block)
            if not (utt.has_speech and over["jarvis"]):
                break
            heard = _quick_text(utt.audio)
            ep = endpoint.EndPointer(cfg, vad=silero_vad, judge=judge, hold=_jarvis_talking)
            over["jarvis"] = False
            if wake.is_stop(heard):
                print(f"\n[\"{heard}\": stopping]")
                _interrupt_speech()
                chimes.play_chime("wake")
                appio.emit("state", state="listening")
            else:
                print(f"\n[Ignored while talking: \"{heard[:60]}\"]")
    if utt.reason == "closed":
        print("\n[Microphone stopped sending audio]")
    if utt.has_speech:
        print(f"\n[End of speech: waited {utt.endpoint_s:.2f} s"
              f" ({utt.verdict or 'no transcript yet'}, {utt.reason})]")
        chimes.play_chime("process")
    elif not followup:
        print("\n[Heard nothing; back to sleep]")
    return utt


def record_utterance(followup: bool = False) -> "endpoint.Utterance":
    """Listen for one utterance with the chosen end-pointer (see ENDPOINTER)."""
    if ENDPOINTER == "silero":
        return _record_silero(followup)
    if followup:
        print("\n[Active Conversation Mode: Speak directly within 5s or say 'Hey Jarvis']")
        appio.emit("state", state="followup")
        if not _followup_energy():
            return endpoint.Utterance(np.zeros(0, dtype=np.float32), "timeout")
    audio = record_vad()
    return endpoint.Utterance(audio, "silence", speech_start_s=0.0 if audio.size else None)


def transcribe_utterance(utt: "endpoint.Utterance") -> str:
    """Text for an utterance; reuses the end-pointer's speculative transcript when it
    already covers every word (then nothing is decoded twice)."""
    if not utt.has_speech:
        return ""
    t0 = time.time()
    j = utt.judgement
    if j is None and utt.judge_upto is not None and judge is not None:
        appio.emit("state", state="transcribing")
        j = judge.wait_for(utt.judge_upto, timeout=20.0)   # it is already decoding this audio
    if j is not None and isinstance(j.payload, tuple):
        raw, meta = j.payload
        appio.emit("state", state="transcribing")
        appio.emit("timing", stage="stt", seconds=round(time.time() - t0, 3))
        appio.emit("stt_meta", **meta, speculative=True, stt_compute_s=round(j.seconds, 3))
        return j.text if len(j.text) >= 2 else ""
    return transcribe(utt.audio)


def transcribe(audio) -> str:
    """Whisper -> romanised Hinglish text ('' if nothing usable was said). See stt.py."""
    appio.emit("state", state="transcribing")
    t0 = time.time()
    raw, meta = stt.transcribe(model, audio)
    # Whisper returns Hindi in Devanagari and English in Latin. Romanize only
    # the Devanagari runs so the line reads as one script; English is left
    # alone, keeping the room-command keywords working.
    text = hinglish.romanize(raw)
    appio.emit("timing", stage="stt", seconds=round(time.time() - t0, 3))
    appio.emit("stt_meta", **meta)
    return text if len(text) >= 2 else ""


_turn_started = 0.0             # when the current reply began (for the first_audio timing)
_first_audio_pending = False


def _stream_reply(text: str, t0: float, full: list) -> None:
    """Stream one reply from the agent into the voice queue and the app."""
    sentence_buffer = ""
    first_token = True
    spoke_once = False
    for chunk in agent.run_agent(text):
        if first_token:
            stop_hum()
            first_token = False
            appio.emit("timing", stage="first_token", seconds=round(time.time() - t0, 3))
            appio.emit("state", state="replying")
        sys.stdout.write(chunk)
        sys.stdout.flush()
        full.append(chunk)
        appio.emit("reply_chunk", text=chunk)
        sentence_buffer += chunk
        ready, sentence_buffer = voice_mod.split_ready(sentence_buffer, first=not spoke_once)
        if ready.strip():
            speak(ready.strip())
            spoke_once = True
    if sentence_buffer.strip():
        speak(sentence_buffer.strip())


def respond(text: str, endpoint_s=None) -> None:
    """One full turn: think, stream the reply, speak it sentence by sentence.

    Speech is queued (voice.py synthesises on its own thread), so the model streams
    at full speed while earlier sentences play. The accent Aman asked for ("in an
    American accent", "Hindi mein") becomes the reply's default voice.
    `endpoint_s` (silence waited before the recording was closed) is reported after
    "heard" so the app files it with this turn: end of speech -> first audio is
    endpoint + stt + first_audio.
    """
    global _turn_started, _first_audio_pending
    print(f"\nYou said: {text}")
    appio.emit("heard", text=text)
    if endpoint_s is not None:
        appio.emit("timing", stage="endpoint", seconds=endpoint_s)
    print("Thinking...", end="\r")
    appio.emit("state", state="thinking")
    voice_engine.begin_turn(voice_mod.requested_style(text))
    t0 = time.time()
    _turn_started, _first_audio_pending = t0, True
    full = []
    try:
        print("JARVIS: ", end="")
        try:
            _stream_reply(text, t0, full)
        except Exception as e:
            # Ollama closed: start it and try once more, if nothing was said yet.
            if full or not ollama_guard.is_down_error(e) or not ollama_guard.ensure():
                raise
            _stream_reply(text, t0, full)
        appio.emit("reply_end", text=voice_mod.strip_tags("".join(full)), seconds=round(time.time() - t0, 3))
    except Exception as e:
        stop_hum()
        print(f"\n[Cognitive Glitch]: {e}")
        down = ollama_guard.is_down_error(e)
        # Keep what was said before the failure: the transcript used to lose the turn.
        if full:
            appio.emit("reply_end", text=voice_mod.strip_tags("".join(full)) + " [interrupted by an error]",
                       seconds=round(time.time() - t0, 3))
        # Say it out loud: a silent failure with a raw socket error on screen read as
        # JARVIS refusing to answer (2026-10-10).
        speak(BRAIN_DOWN if down else "I'm afraid that reply failed. The error is in the log.")
        appio.emit("error", message=BRAIN_DOWN if down else str(e))


def main_loop():
    print(f"\nMQTT broker: {'connected' if room.MQTT_OK else 'virtual room only'}")
    appio.emit("ready", mode="voice")
    appio.emit("room_state", state=room.state, mqtt=room.MQTT_OK)
    hour = time.localtime().tm_hour
    speak(f"Systems online. Good {'morning' if hour < 12 else 'afternoon' if hour < 17 else 'evening'}, Aman.")

    while True:
        try:
            print("\n" + room.render())
            typed = listen_for_wake_word()
            if typed:
                respond(typed)                 # typed in the app while asleep
                continue
            utt = record_utterance()
            if not utt.has_speech:
                continue                       # woken, then nothing said: back to sleep

            start_hum()
            print("Transcribing...", end="\r")
            text = transcribe_utterance(utt)
            if not text:
                stop_hum()
                continue

            # Check if user wants to resume an interrupted thought
            global last_interrupted_script, was_interrupted
            resume_keywords = ["continue", "pick up", "go on", "what were you saying", "carry on", "finish your thought"]
            if was_interrupted and any(kw in text.lower() for kw in resume_keywords) and last_interrupted_script:
                print("\n[Resuming Interrupted Script...]")
                speak(f"As I was saying, {last_interrupted_script}")
                was_interrupted = False
                last_interrupted_script = ""
                stop_hum()
                continue

            respond(text, endpoint_s=utt.endpoint_s)

            # Active Follow-Up Conversation Loop: wait for follow-up speech before
            # returning to wake-word sleep. With Silero the follow-up IS the recording
            # (pre-roll included), so its first words are no longer lost to a second
            # stream opening after the sound that triggered it; and the 5 s only run
            # once JARVIS has stopped talking.
            utt = record_utterance(followup=True)
            if utt.has_speech:
                start_hum()
                text = transcribe_utterance(utt)
                if text:
                    respond(text, endpoint_s=utt.endpoint_s)
                else:
                    stop_hum()

        except Exception as e:
            tb = traceback.format_exc()
            print(f"\n[CRITICAL GLITCH DETECTED]: {e}")
            appio.emit("error", message=str(e), critical=True)
            chimes.play_chime("error")
            speak("I have hit an error. One moment while I look into it.")

            try:
                print("Diagnosing error in background...")
                diagnostic_reply = agent.diagnose_error(tb)
                print(f"JARVIS Diagnosis: {diagnostic_reply}")
                appio.emit("diagnosis", text=diagnostic_reply)
                speak(diagnostic_reply)
            except Exception as inner_e:
                print(f"Self-diagnosis failed: {inner_e}")
                speak("I could not diagnose that one. It is in the log.")


def text_loop():
    """--text: typed messages from the app in, streamed replies out. No audio."""
    print("\nText mode: no microphone, no speech. Waiting for messages from the app.")
    appio.emit("ready", mode="text")
    appio.emit("room_state", state=room.state, mqtt=room.MQTT_OK)
    appio.emit("state", state="idle")
    while True:
        text = appio.wait_say()
        if text is None:                       # the app closed our stdin: shut down
            return
        respond(text)
        appio.emit("state", state="idle")


if __name__ == "__main__":
    try:
        text_loop() if TEXT_ONLY else main_loop()
    except KeyboardInterrupt:
        print("\nSystem offline.")
