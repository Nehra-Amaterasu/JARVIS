import numpy as np
import sounddevice as sd
from openwakeword.model import Model
import sys

# --- CONFIGURATION ---
WAKE_WORD_MODEL = "hey_jarvis_v0.1"
INFERENCE_FRAMEWORK = "onnx"
THRESHOLD = 0.4  # Lowered for testing
CHUNK_SIZE = 1280
RATE = 16000
CHANNELS = 1

def calculate_rms(audio_data):
    """Calculate Root Mean Square to measure audio volume."""
    audio_float = audio_data.astype(np.float32)
    rms = np.sqrt(np.mean(audio_float**2))
    return rms

def main():
    print("Initializing openWakeWord model...")
    try:
        oww_model = Model(
            wakeword_models=[WAKE_WORD_MODEL],
            inference_framework=INFERENCE_FRAMEWORK
        )
    except Exception as e:
        print(f"Failed to load model: {e}")
        sys.exit(1)

    print("\n================ AVAILABLE AUDIO DEVICES ================")
    print(sd.query_devices())
    print("=========================================================\n")
    print("Ensure your default microphone is set correctly in Windows.")

    def audio_callback(indata, frames, time, status):
        if status:
            print(f"Stream Status: {status}")

        audio_data = indata.flatten()
        
        # Enforce exactly 1280 samples
        if len(audio_data) != CHUNK_SIZE:
            print(f"[WARNING] Expected {CHUNK_SIZE} samples, got {len(audio_data)}")
            return

        volume = calculate_rms(audio_data)
        
        prediction = oww_model.predict(audio_data)
        
        for mdl, score in prediction.items():
            if score > 0.05:
                # Print raw scores to help calibrate
                print(f"[{mdl}] Score: {score:.3f} | Vol: {volume:.1f}", end='\r')
                
            if score >= THRESHOLD:
                print(f"\n\n>>> WAKE WORD DETECTED! ({mdl} - Score: {score:.3f}) <<<\n")

    print(f"\nStarting audio stream... Listening for '{WAKE_WORD_MODEL}'")
    print(f"Settings: {RATE}Hz, {CHANNELS} Channel, {CHUNK_SIZE} Chunk Size")
    print("Speak 'Hey Jarvis' to test. Press Ctrl+C to stop.\n")
    
    try:
        with sd.InputStream(
            samplerate=RATE,
            channels=CHANNELS,
            dtype='int16',
            blocksize=CHUNK_SIZE,
            callback=audio_callback
        ):
            while True:
                sd.sleep(1000)
    except Exception as e:
        print(f"Stream Error: {e}")
    except KeyboardInterrupt:
        print("\nStopping...")

if __name__ == '__main__':
    main()
