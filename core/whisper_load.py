"""Whisper on the GPU when there is one, on the CPU when CUDA will not start.

2026-10-22/25: the laptop's RTX 4050 was powered down by the hybrid-graphics mode at
boot, CTranslate2 raised "CUDA failed with error no CUDA-capable device is detected",
and jarvis.py died at import, every restart, until he noticed the window said Offline.
A missing GPU is not a reason to be deaf: Whisper falls back to the CPU (int8), says
so, and tries the GPU again every RETRY_S, swapping the model in place when it works.

    stt = WhisperOnDevice(WhisperModel)      # loads: cuda int8_float16, else cpu int8
    stt.transcribe(audio, ...)               # what faster_whisper.WhisperModel does
    stt.device                               # "cuda" | "cpu"
    stt.start_gpu_retry(on_change)           # background: back to the GPU when it returns

Everything that held the model (stt.transcribe(model, ...), wake.whisper_transcriber,
the endpoint judge) holds this object instead, so a swap reaches all of them.
"""
from __future__ import annotations

import os
import threading
import time
from typing import Callable, Optional

MODEL = "large-v3-turbo"
GPU = ("cuda", "int8_float16")      # benchmarked 2026-10-08: 2.7 s for a 15 s Hinglish clip
CPU = ("cpu", "int8")               # slower (several seconds a sentence) but every word still there
# Ten minutes: the dGPU wakes when Windows next needs it (a game, the brain loading on
# it, unplugging and replugging power); trying every few seconds would only spam the log.
RETRY_S = float(os.environ.get("JARVIS_GPU_RETRY_S", "600"))


class WhisperOnDevice:
    def __init__(self, factory: Callable, name: str = MODEL, log: Callable[[str], None] = print,
                 cpu_name: Optional[str] = None, clock: Callable[[], float] = time.time, **kw):
        self.factory, self.name, self.log, self.kw, self.clock = factory, name, log, kw, clock
        self.cpu_name = cpu_name or os.environ.get("JARVIS_CPU_WHISPER") or name
        self._inner = None
        self.device: Optional[str] = None
        self.gpu_error: Optional[str] = None        # why the GPU was not used, when it was not
        self.last_gpu_try: Optional[float] = None
        self._lock = threading.Lock()
        self._stop = threading.Event()
        self._thread: Optional[threading.Thread] = None
        self.load()

    # ------------------------------------------------------------------ loading
    def _try_gpu(self):
        self.last_gpu_try = self.clock()
        return self.factory(self.name, device=GPU[0], compute_type=GPU[1], **self.kw)

    def load(self) -> str:
        try:
            self._inner, self.device, self.gpu_error = self._try_gpu(), "cuda", None
        except Exception as e:                      # no device, a driver error, a missing cuDNN DLL
            self.gpu_error = f"{type(e).__name__}: {e}"
            self.log(f"[stt] GPU unavailable ({self.gpu_error}); Whisper {self.cpu_name} on the CPU (int8). "
                     f"Trying the GPU again every {RETRY_S / 60:g} min.")
            self._inner = self.factory(self.cpu_name, device=CPU[0], compute_type=CPU[1], **self.kw)
            self.device = "cpu"
        return self.device

    def retry_gpu(self) -> bool:
        """On the CPU: try the GPU once. True when the model moved to it."""
        if self.device == "cuda":
            return False
        try:
            gpu = self._try_gpu()
        except Exception as e:
            self.gpu_error = f"{type(e).__name__}: {e}"
            return False
        with self._lock:
            self._inner, self.device, self.gpu_error = gpu, "cuda", None
        self.log("[stt] The GPU is back: Whisper moved to CUDA.")
        return True

    def start_gpu_retry(self, on_change: Optional[Callable[["WhisperOnDevice"], None]] = None,
                        every_s: Optional[float] = None) -> None:
        if self.device == "cuda" or self._thread is not None:
            return
        every = RETRY_S if every_s is None else every_s

        def run():
            while not self._stop.wait(every):
                if self.retry_gpu():
                    if on_change is not None:
                        try:
                            on_change(self)
                        except Exception:
                            pass
                    return

        self._thread = threading.Thread(target=run, name="whisper-gpu-retry", daemon=True)
        self._thread.start()

    def stop(self) -> None:
        self._stop.set()

    # ------------------------------------------------------------------ the model
    def __getattr__(self, attr):
        # Only reached for what this class does not define: transcribe, detect_language,
        # feature_extractor ... always on the model of the moment.
        inner = self.__dict__.get("_inner")
        if inner is None:
            raise AttributeError(attr)
        return getattr(inner, attr)

    def status(self) -> dict:
        return {"device": self.device, "gpu_error": self.gpu_error, "model": self.name if self.device == "cuda"
                else self.cpu_name}
