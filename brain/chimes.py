import numpy as np
import sounddevice as sd
import time

def play_chime(type="wake"):
    """
    Procedurally generates futuristic audio cues.
    'wake' = Ascending harmonic chord
    'process' = Descending double beep
    'error' = Low dissonant buzz
    """
    fs = 16000
    if type == "wake":
        # Ascending major third
        t1 = np.linspace(0, 0.15, int(fs * 0.15), endpoint=False)
        wave1 = 0.5 * np.sin(2 * np.pi * 440 * t1) + 0.5 * np.sin(2 * np.pi * 880 * t1)
        
        t2 = np.linspace(0, 0.25, int(fs * 0.25), endpoint=False)
        wave2 = 0.5 * np.sin(2 * np.pi * 554.37 * t2) + 0.5 * np.sin(2 * np.pi * 1108.73 * t2)
        
        audio = np.concatenate([wave1, np.zeros(int(fs*0.05)), wave2]) * 0.2
        
    elif type == "process":
        # Snappy double high-pitched beep
        t = np.linspace(0, 0.1, int(fs * 0.1), endpoint=False)
        wave = np.sin(2 * np.pi * 1200 * t) * np.exp(-15 * t)
        audio = np.concatenate([wave, np.zeros(int(fs*0.05)), wave]) * 0.3
        
    elif type == "error":
        # Low dissonance
        t = np.linspace(0, 0.4, int(fs * 0.4), endpoint=False)
        wave = 0.5 * np.sin(2 * np.pi * 150 * t) + 0.5 * np.sin(2 * np.pi * 165 * t)
        audio = wave * 0.3
        
    else:
        return

    # Apply fade out to prevent popping
    fade_len = int(fs * 0.02)
    audio[-fade_len:] *= np.linspace(1, 0, fade_len)
    audio[:fade_len] *= np.linspace(0, 1, fade_len)
    
    try:
        sd.play(audio.astype(np.float32), fs)
        sd.wait()
    except Exception as e:
        pass

if __name__ == "__main__":
    print("Testing Wake Chime...")
    play_chime("wake")
    time.sleep(0.5)
    print("Testing Process Chime...")
    play_chime("process")
    time.sleep(0.5)
    print("Testing Error Chime...")
    play_chime("error")
