"""Whisper falls back to the CPU when CUDA will not start, and returns to the GPU (10-25).

The live failure, verbatim from data/app/core_crashes.log: ctranslate2 raised
RuntimeError("CUDA failed with error no CUDA-capable device is detected") at import and
jarvis.py died on every restart. A fake WhisperModel replays it; no model is loaded.
"""
import threading

import pytest

import whisper_load

CUDA_DOWN = RuntimeError("CUDA failed with error no CUDA-capable device is detected")


class FakeWhisper:
    """faster_whisper.WhisperModel's constructor and transcribe, nothing else."""
    gpu_ok = False
    made: list = []

    def __init__(self, name, device="auto", compute_type="default", **kw):
        if device == "cuda" and not FakeWhisper.gpu_ok:
            raise CUDA_DOWN
        self.name, self.device, self.compute_type = name, device, compute_type
        FakeWhisper.made.append((name, device, compute_type))

    def transcribe(self, audio, **kw):
        return iter([f"heard on {self.device}"]), {"language": "en"}


@pytest.fixture(autouse=True)
def _fresh():
    FakeWhisper.gpu_ok = False
    FakeWhisper.made = []
    yield


def test_no_cuda_device_means_the_cpu_not_a_crash():
    logs = []
    m = whisper_load.WhisperOnDevice(FakeWhisper, log=logs.append)
    assert m.device == "cpu" and FakeWhisper.made == [("large-v3-turbo", "cpu", "int8")]
    assert "no CUDA-capable device" in m.gpu_error
    assert any("GPU unavailable" in line and "CPU" in line for line in logs)     # said, not silent
    segs, info = m.transcribe(b"audio")                                         # used like the model
    assert list(segs) == ["heard on cpu"]
    assert m.status() == {"device": "cpu", "gpu_error": m.gpu_error, "model": "large-v3-turbo"}


def test_with_a_gpu_it_is_the_old_path():
    FakeWhisper.gpu_ok = True
    m = whisper_load.WhisperOnDevice(FakeWhisper, log=lambda s: None)
    assert m.device == "cuda" and FakeWhisper.made == [("large-v3-turbo", "cuda", "int8_float16")]
    assert m.gpu_error is None


def test_the_gpu_is_tried_again_and_the_model_moves_in_place():
    m = whisper_load.WhisperOnDevice(FakeWhisper, log=lambda s: None)
    holder = m.transcribe                          # what wake.whisper_transcriber kept...
    assert m.retry_gpu() is False and m.device == "cpu"      # still down: stays on the CPU
    FakeWhisper.gpu_ok = True
    assert m.retry_gpu() is True and m.device == "cuda" and m.gpu_error is None
    assert list(m.transcribe(b"a")[0]) == ["heard on cuda"]  # ...the object itself now hears on the GPU
    assert list(holder(b"a")[0]) == ["heard on cpu"]         # (a bound method keeps its old model: hold the object)
    assert m.retry_gpu() is False                              # nothing to do on the GPU


def test_the_background_retry_reports_the_move_once():
    m = whisper_load.WhisperOnDevice(FakeWhisper, log=lambda s: None)
    moved = threading.Event()
    seen = []
    m.start_gpu_retry(lambda w: (seen.append(w.device), moved.set()), every_s=0.01)
    FakeWhisper.gpu_ok = True
    assert moved.wait(2.0)
    m.stop()
    assert seen == ["cuda"]


def test_a_cpu_only_model_can_be_chosen(monkeypatch):
    m = whisper_load.WhisperOnDevice(FakeWhisper, log=lambda s: None, cpu_name="small")
    assert FakeWhisper.made == [("small", "cpu", "int8")] and m.status()["model"] == "small"


def test_jarvis_loads_whisper_through_the_fallback():
    """jarvis.py cannot be imported in a test (mic, pygame, models); its source must
    build the model through whisper_load, never straight on CUDA."""
    from pathlib import Path
    src = (Path(whisper_load.__file__).with_name("jarvis.py")).read_text(encoding="utf-8")
    assert "whisper_load.WhisperOnDevice(WhisperModel)" in src
    assert 'WhisperModel("large-v3-turbo", device="cuda"' not in src
