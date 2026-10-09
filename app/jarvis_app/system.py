"""System vitals, measured — the numbers the 6 GB VRAM ceiling is judged against.

Everything here is read from the machine (NVML, psutil, Ollama's API). If a
reading isn't available it comes back as None and the UI shows "—", never a guess.
"""
from __future__ import annotations

import os
import shutil
import threading
import time
from pathlib import Path
from typing import Optional

import httpx
import psutil

from .paths import BRAIN, HOME

OLLAMA = "http://127.0.0.1:11434"
_nvml_ok: Optional[bool] = None
_nvml_lock = threading.Lock()
gpu_error: Optional[str] = None      # why the last GPU read failed (shown, not swallowed)


def _nvml():
    global _nvml_ok
    with _nvml_lock:
        if _nvml_ok is None:
            try:
                import pynvml
                pynvml.nvmlInit()
                _nvml_ok = True
            except Exception as e:
                global gpu_error
                gpu_error = f"NVML init: {e!r}"
                _nvml_ok = False
    if not _nvml_ok:
        return None
    import pynvml
    return pynvml


def gpu() -> Optional[dict]:
    """GPU readings, each taken separately.

    On this Optimus laptop NVML intermittently answers NVMLError_Unknown (999)
    while the discrete GPU is powered down — seen in the server process but not
    in a one-off script. One flaky call used to blank the whole panel; now each
    reading fails alone, and a failed handle forces NVML to re-initialise.
    """
    global gpu_error, _nvml_ok
    nv = _nvml()
    if nv is None:
        return None

    def read(fn, *args):
        try:
            return fn(*args)
        except Exception as e:
            global gpu_error
            gpu_error = f"{fn.__name__}: {e!r}"
            return None

    h = read(nv.nvmlDeviceGetHandleByIndex, 0)
    if h is None:
        with _nvml_lock:
            try:
                nv.nvmlShutdown()
            except Exception:
                pass
            _nvml_ok = None                     # retry init on the next call
        return None
    mem = read(nv.nvmlDeviceGetMemoryInfo, h)
    util = read(nv.nvmlDeviceGetUtilizationRates, h)
    name = read(nv.nvmlDeviceGetName, h) or "NVIDIA GPU"
    name = name.decode() if isinstance(name, bytes) else name
    temp = read(nv.nvmlDeviceGetTemperature, h, nv.NVML_TEMPERATURE_GPU)
    power = read(nv.nvmlDeviceGetPowerUsage, h)
    limit = read(nv.nvmlDeviceGetEnforcedPowerLimit, h)
    if power is not None:
        power /= 1000.0
        # This laptop's NVML reports ~590 W against a 43 W enforced limit: not a
        # trustworthy sensor. An impossible reading becomes None ("—"), never a
        # confident wrong number.
        if limit and power > 1.5 * limit / 1000.0:
            power = None
    procs = []
    for p in read(nv.nvmlDeviceGetComputeRunningProcesses, h) or []:
        try:
            pname = psutil.Process(p.pid).name()
        except Exception:
            pname = str(p.pid)
        used = getattr(p, "usedGpuMemory", None)
        procs.append({"pid": p.pid, "name": pname, "mem_mb": round(used / 2**20) if used else None})
    if mem is None:
        return None
    gpu_error = None
    return {"name": name, "util": util.gpu if util is not None else None,
            "mem_used_mb": round(mem.used / 2**20), "mem_total_mb": round(mem.total / 2**20),
            "temp_c": temp, "power_w": round(power, 1) if power else None, "processes": procs}


def ollama_loaded() -> Optional[list[dict]]:
    try:
        r = httpx.get(f"{OLLAMA}/api/ps", timeout=1.0)
        out = []
        for m in r.json().get("models", []):
            out.append({"name": m.get("name"), "size_mb": round(m.get("size", 0) / 2**20),
                        "vram_mb": round(m.get("size_vram", 0) / 2**20),
                        "expires_at": m.get("expires_at")})
        return out
    except Exception:
        return None


def ollama_unload(model: str) -> bool:
    """Ask Ollama to drop a model from VRAM now (keep_alive=0)."""
    try:
        httpx.post(f"{OLLAMA}/api/generate", json={"model": model, "keep_alive": 0}, timeout=10)
        return True
    except Exception:
        return False


def vitals() -> dict:
    vm = psutil.virtual_memory()
    disk = shutil.disk_usage(str(BRAIN.anchor or "C:\\"))
    return {
        "t": time.time(),
        "cpu_pct": psutil.cpu_percent(interval=None),
        "cpu_count": psutil.cpu_count(),
        "ram_used_mb": round((vm.total - vm.available) / 2**20),
        "ram_total_mb": round(vm.total / 2**20),
        "disk_free_gb": round(disk.free / 2**30, 1),
        "disk_total_gb": round(disk.total / 2**30, 1),
        "gpu": gpu(),
        "gpu_error": gpu_error,
        "ollama": ollama_loaded(),
    }


# ---------------------------------------------------------------- models on disk
_models_cache: dict = {"t": 0.0, "data": None}


def _dir_size(p: Path) -> int:
    total = 0
    for root, _, files in os.walk(p):
        for f in files:
            try:
                total += os.path.getsize(os.path.join(root, f))
            except OSError:
                pass
    return total


def models() -> dict:
    """Models on disk, with sizes. Cached for a minute: walking caches is slow."""
    if _models_cache["data"] is not None and time.time() - _models_cache["t"] < 60:
        return _models_cache["data"]
    hf = []
    hub = HOME / ".cache" / "huggingface" / "hub"
    if hub.exists():
        for d in sorted(hub.glob("models--*")):
            hf.append({"name": d.name[len("models--"):].replace("--", "/"),
                       "size_mb": round(_dir_size(d) / 2**20)})
    try:
        tags = httpx.get(f"{OLLAMA}/api/tags", timeout=1.5).json().get("models", [])
        oll = [{"name": m["name"], "size_mb": round(m.get("size", 0) / 2**20),
                "params": m.get("details", {}).get("parameter_size"),
                "quant": m.get("details", {}).get("quantization_level")} for m in tags]
    except Exception:
        oll = None
    data = {"huggingface": hf, "ollama": oll}
    _models_cache.update(t=time.time(), data=data)
    return data
