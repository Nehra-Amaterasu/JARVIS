"""Speech clips for the end-pointer tests, made offline — never recorded.

Sentences are synthesised with Kokoro (the offline voice JARVIS already has, read
from data/models/kokoro without writing to it), resampled to 16 kHz, levelled to
-20 dBFS RMS and laid on a bed of pink noise and fan hum, with pauses where a
person would stop to think. Every clip knows where each part of it really starts
and ends, so a test can measure the end-pointer against the truth.

Kokoro takes ~5 s per sentence on the CPU, so clips are cached (by voice, language
and text) in the temp folder; later runs take milliseconds. If Kokoro or its model
files are missing, kokoro_ready() says why and the speech tests skip; the logic
tests (scripted VAD) still run.

JARVIS_KOKORO_DIR points at another copy of the model files (a git worktree has no
data/ folder of its own).
"""
from __future__ import annotations

import hashlib
import os
import tempfile
import threading
from dataclasses import dataclass, field
from pathlib import Path
from typing import Optional

import numpy as np

SR = 16000
CACHE = Path(tempfile.gettempdir()) / "jarvis-endpoint-clips"
_FILES = ("kokoro-v1.0.int8.onnx", "voices-v1.0.bin")
_lock = threading.Lock()
_kokoro = None


def kokoro_dir() -> Optional[Path]:
    cands = []
    if os.environ.get("JARVIS_KOKORO_DIR"):
        cands.append(Path(os.environ["JARVIS_KOKORO_DIR"]))
    try:
        import home
        cands.append(home.MODELS / "kokoro")
    except Exception:
        pass
    for d in cands:
        if all((d / f).exists() for f in _FILES):
            return d
    return None


def kokoro_ready() -> tuple[bool, str]:
    try:
        import kokoro_onnx  # noqa: F401
    except Exception as e:                       # pragma: no cover - depends on the venv
        return False, f"kokoro_onnx not importable: {e}"
    if kokoro_dir() is None:
        return False, "Kokoro model files not found (data/models/kokoro or JARVIS_KOKORO_DIR)"
    return True, ""


def _engine():
    global _kokoro
    with _lock:
        if _kokoro is None:
            from kokoro_onnx import Kokoro
            d = kokoro_dir()
            _kokoro = Kokoro(str(d / _FILES[0]), str(d / _FILES[1]))
        return _kokoro


def trim(x: np.ndarray, db: float = -45.0) -> np.ndarray:
    """Cut leading/trailing silence (10 ms envelope below `db` dBFS)."""
    env = np.sqrt(np.convolve(x.astype(np.float64) ** 2, np.ones(160) / 160, "same"))
    on = np.where(env > 10 ** (db / 20))[0]
    return x[on[0]:on[-1] + 1] if on.size else x[:0]


def speech(text: str, voice: str = "bm_george", lang: str = "en-gb", level_db: float = -20.0) -> np.ndarray:
    """Kokoro speech at 16 kHz, trimmed and levelled. Cached on disk."""
    key = hashlib.sha1(f"{voice}|{lang}|{text}".encode("utf-8")).hexdigest()[:16]
    path = CACHE / f"{key}.npy"
    if path.exists():
        x = np.load(path)
    else:
        from scipy.signal import resample_poly
        samples, sr = _engine().create(text, voice=voice, speed=1.0, lang=lang)
        assert sr == 24000, sr
        x = resample_poly(np.asarray(samples, dtype=np.float64), 2, 3).astype(np.float32)
        CACHE.mkdir(parents=True, exist_ok=True)
        tmp = path.with_suffix(".tmp.npy")
        np.save(tmp, x)
        os.replace(tmp, path)
    x = trim(x)
    return (x / np.sqrt(np.mean(x.astype(np.float64) ** 2)) * 10 ** (level_db / 20)).astype(np.float32)


# Mid-sentence pauses: part A stops on a word a sentence cannot end on, the way a
# thought is interrupted ("…and" [thinks] "…whether we should go out").
MID_SENTENCE = [
    ("bm_george", "en-gb", "I was thinking about the weather today, and", "whether we should go out tonight."),
    ("am_michael", "en-us", "Tell me the plan for tomorrow, because", "I have an exam in the morning."),
    ("hm_psi", "hi", "मुझे बताओ कि", "कल मेरा कौन सा पेपर है?"),
]
# Short, finished requests: the case that should be answered quickly.
REQUESTS = [
    ("am_michael", "en-us", "What time is it?"),
    ("bf_emma", "en-gb", "Switch on the fan."),
    ("hm_psi", "hi", "लाइट बंद करो।"),
]


# ------------------------------------------------------------------ room sounds
def pink(n: int, rms: float, seed: int = 0) -> np.ndarray:
    w = np.random.default_rng(seed).standard_normal(n)
    X = np.fft.rfft(w)
    f = np.arange(len(X), dtype=np.float64)
    f[0] = 1.0
    y = np.fft.irfft(X / np.sqrt(f), n)
    return (y / np.sqrt(np.mean(y ** 2)) * rms).astype(np.float32)


def fan(n: int, rms: float, seed: int = 1) -> np.ndarray:
    """A ceiling fan: 50 Hz mains harmonics, blade-rate wobble, broadband air."""
    t = np.arange(n) / SR
    hum = sum(np.sin(2 * np.pi * k * 50 * t + k) / k for k in range(1, 8))
    y = hum * (0.5 * (1 + 0.3 * np.sin(2 * np.pi * 12 * t))) + 0.6 * pink(n, 1.0, seed)
    return (y / np.sqrt(np.mean(y ** 2)) * rms).astype(np.float32)


def clicks(n: int, peak: float, seed: int = 2) -> np.ndarray:
    """Keyboard-like clicks every ~180 ms on a quiet floor."""
    rng = np.random.default_rng(seed)
    y = pink(n, peak * 0.003, seed)
    for k in range(0, n - 1200, int(0.18 * SR)):
        j = k + int(rng.integers(0, 800))
        y[j:j + 200] += (peak * np.exp(-np.arange(200) / 30.0) * rng.choice([-1, 1], 200)).astype(np.float32)
    return y


def beeps(n: int, rms: float) -> np.ndarray:
    """A 1 kHz appliance beep, on and off every second."""
    t = np.arange(n) / SR
    return (np.sin(2 * np.pi * 1000 * t) * (np.sin(2 * np.pi * 0.5 * t) > 0) * rms * np.sqrt(2)).astype(np.float32)


# ------------------------------------------------------------------ clips with ground truth
@dataclass
class Part:
    text: str
    start_s: float
    end_s: float


@dataclass
class Clip:
    audio: np.ndarray
    parts: list = field(default_factory=list)

    @property
    def end_s(self) -> float:
        return self.parts[-1].end_s

    def text_upto(self, sample: int) -> str:
        """What a perfect transcriber would have heard by stream sample `sample`."""
        return " ".join(p.text for p in self.parts if p.end_s * SR <= sample)


def compose(parts: list, pauses: list, lead_s: float = 1.0, tail_s: float = 6.0,
            noise_db: float = -45.0, seed: int = 7) -> Clip:
    """parts: [(text, audio)]; pauses[k] is the gap after part k (tail_s after the last)."""
    pieces, marks, t = [np.zeros(int(lead_s * SR), np.float32)], [], int(lead_s * SR)
    for k, (text, a) in enumerate(parts):
        pieces.append(a)
        marks.append(Part(text, t / SR, (t + len(a)) / SR))
        t += len(a)
        gap = int((pauses[k] if k < len(pauses) else tail_s) * SR)
        pieces.append(np.zeros(gap, np.float32))
        t += gap
    x = np.concatenate(pieces)
    floor = 10 ** (noise_db / 20)
    x = x + pink(len(x), floor, seed) + fan(len(x), floor * 0.7, seed + 1)
    return Clip(x.astype(np.float32), marks)


def oracle(clip: Clip, ep) -> callable:
    """A judge that transcribes perfectly: the text of every part that has ended by the
    end of the audio it is given (the end-pointer hands over utterance audio, which
    starts at ep's pre-roll start)."""
    def fn(audio: np.ndarray) -> str:
        return clip.text_upto(ep.audio_start + len(audio))
    return fn
