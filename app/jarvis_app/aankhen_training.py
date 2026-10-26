"""The one place the app touches Aankhen's training code (agent A's dataset + fingerprint).

WHY ONE MODULE
  The new training loop (aankhen/dataset.py spans, aankhen/fingerprint.py train_job and
  model_status) is being written in parallel with the app's Teach / Train / Correct UI.
  Every call the app makes goes through here, so the merge is one file to check, and a
  missing function becomes a clear sentence on the page instead of a 500.

THE CONTRACT (2026-10-27)
  aankhen.dataset.add_span(recording, t0, t1, zone, source) -> dict   ValueError on bad input
  aankhen.dataset.list_spans() -> list[dict]
  aankhen.dataset.catalog() -> dict                                     seconds per label per day
  aankhen.fingerprint.train_job(per_place_s=30, progress=None, adabn=False) -> report dict
      progress(stage: str, fraction: float)
  aankhen.fingerprint.model_status() -> {status: "predicting"|"answering", days, sessions,
      seconds_per_place, last_trained, report_path}

  `recording` (my assumption, the merge must confirm it): the absolute path of the raw.akr
  the span lies in, or "stream" for the rolling week of raw Wi-Fi (stream.py) when no
  board recording is open: a correction labels the last N seconds, and only the rolling
  stream holds those when nothing else was recording.

Also here: Job, the app's background-job shape for training and narration labelling
(one thread, stage + fraction, the result or the error), and plain_report(), which turns
the training report into the sentences the Train panel shows.
"""
from __future__ import annotations

import importlib
import json
import os
import threading
import time
from typing import Any, Callable, Optional

SOURCES = ("minidrill", "correction", "confirmed", "narrate", "drill")
STATUS_WORDS = ("predicting", "answering")


class TrainingUnavailable(RuntimeError):
    """The training code this app expects is not in this checkout (yet)."""


def _fn(module: str, name: str) -> Callable:
    try:
        mod = importlib.import_module(module)
    except Exception as e:                      # ImportError, or the module failing to import
        raise TrainingUnavailable(f"{module} could not be loaded ({type(e).__name__}: {e})") from e
    f = getattr(mod, name, None)
    if not callable(f):
        raise TrainingUnavailable(f"{module}.{name} is missing: this checkout has not got the new "
                                  "training code yet, so this button cannot work")
    return f


def available() -> dict:
    """Which pieces exist, for the page to say what works: {name: bool, "missing": [...]}."""
    out, missing = {}, []
    for mod, name in (("aankhen.dataset", "add_span"), ("aankhen.dataset", "list_spans"),
                      ("aankhen.dataset", "catalog"), ("aankhen.fingerprint", "train_job"),
                      ("aankhen.fingerprint", "model_status")):
        try:
            _fn(mod, name)
            out[name] = True
        except TrainingUnavailable:
            out[name] = False
            missing.append(f"{mod}.{name}")
    out["missing"] = missing
    return out


# ---------------------------------------------------------------- the wrapped calls
def add_span(recording: str, t0: float, t1: float, zone: str, source: str) -> dict:
    if source not in SOURCES:
        raise ValueError(f"source is one of {', '.join(SOURCES)}")
    return _fn("aankhen.dataset", "add_span")(recording, float(t0), float(t1), zone, source)


def list_spans() -> list:
    return list(_fn("aankhen.dataset", "list_spans")() or [])


def catalog() -> dict:
    return dict(_fn("aankhen.dataset", "catalog")() or {})


def train_job(per_place_s: float = 30, progress: Optional[Callable[[str, float], None]] = None,
              adabn: bool = False) -> dict:
    return _fn("aankhen.fingerprint", "train_job")(per_place_s=per_place_s, progress=progress, adabn=adabn)


def model_status() -> dict:
    st = dict(_fn("aankhen.fingerprint", "model_status")() or {})
    # Anything but the two words is "predicting": the page never claims more than it was told.
    if st.get("status") not in STATUS_WORDS:
        st["status"] = "predicting"
    return st


def status_or_reason() -> dict:
    """model_status(), or {status: "predicting", unavailable: why} when it cannot be read."""
    try:
        return model_status()
    except TrainingUnavailable as e:
        return {"status": "predicting", "unavailable": str(e)}
    except Exception as e:
        return {"status": "predicting", "unavailable": f"model_status failed: {type(e).__name__}: {e}"}


def correction_recording(minidrill_recording: Optional[str], hub) -> Optional[str]:
    """What a correction's span lies in: the open mini-drill recording, else the rolling
    stream while it records the real board, else None (nothing on disk to label)."""
    if minidrill_recording:
        return minidrill_recording
    stream = getattr(hub, "stream", None)
    if stream is not None and getattr(hub, "mode", None) == "hardware":
        running = getattr(stream, "running", None)
        if running is None or (running() if callable(running) else running):
            return "stream"
    return None


# ---------------------------------------------------------------- background jobs
class Job:
    """One background job at a time: state idle|running|done|error, a stage and a 0..1
    fraction the work reports, then its result or its error. Plain threads, as the drill
    and the old teacher's train_async already use: the work is CPU/GPU bound and long,
    and the app's request threads must never wait for it."""

    def __init__(self, name: str):
        self.name = name
        self._lock = threading.Lock()
        self._thread: Optional[threading.Thread] = None
        self.state, self.stage, self.fraction = "idle", "", 0.0
        self.result: Any = None
        self.error: Optional[str] = None
        self.started: Optional[float] = None
        self.finished: Optional[float] = None
        self.args: dict = {}

    def running(self) -> bool:
        t = self._thread
        return t is not None and t.is_alive()

    def progress(self, stage: str, fraction: float) -> None:
        try:
            f = float(fraction)
        except (TypeError, ValueError):
            f = self.fraction
        self.stage, self.fraction = str(stage), max(0.0, min(1.0, f))

    def start(self, work: Callable[[Callable[[str, float], None]], Any], args: Optional[dict] = None,
              on_done: Optional[Callable[["Job"], None]] = None) -> bool:
        """Run work(progress) on a thread. False when one is already running."""
        with self._lock:
            if self.running():
                return False
            self.state, self.stage, self.fraction = "running", "starting", 0.0
            self.result, self.error, self.args = None, None, dict(args or {})
            self.started, self.finished = time.time(), None

            def go():
                try:
                    self.result = work(self.progress)
                    self.state, self.fraction, self.stage = "done", 1.0, "done"
                except Exception as e:
                    self.error = str(e) if isinstance(e, (ValueError, TrainingUnavailable)) \
                        else f"{type(e).__name__}: {e}"
                    self.state = "error"
                finally:
                    self.finished = time.time()
                    if on_done is not None:
                        try:
                            on_done(self)
                        except Exception:
                            pass
            self._thread = threading.Thread(target=go, name=f"aankhen-{self.name}", daemon=True)
            self._thread.start()
            return True

    def join(self, timeout: Optional[float] = None) -> None:
        t = self._thread
        if t is not None:
            t.join(timeout)

    def view(self) -> dict:
        return {"name": self.name, "state": self.state, "stage": self.stage,
                "fraction": round(self.fraction, 3), "error": self.error, "started": self.started,
                "finished": self.finished, "args": self.args}


# ---------------------------------------------------------------- the report in plain words
def _num(v) -> Optional[float]:
    try:
        f = float(v)
    except (TypeError, ValueError):
        return None
    return f if f == f else None                # NaN is no number


def _pct(v: Optional[float]) -> str:
    return "?" if v is None else f"{round(v * 100)} %"


def _pair(v) -> Optional[list]:
    if isinstance(v, (list, tuple)) and len(v) == 2 and all(_num(x) is not None for x in v):
        return [_num(v[0]), _num(v[1])]
    return None


def _pick_model(rep: dict) -> Optional[str]:
    m = rep.get("model")
    bal = rep.get("balanced")
    if isinstance(m, str) and (not isinstance(bal, dict) or m in bal):
        return m
    if isinstance(bal, dict):
        for k in ("cnn", "knn"):
            if k in bal:
                return k
        rest = [k for k in bal if k != "majority" and not k.endswith("_shuffled")]
        return rest[0] if rest else None
    return None


def load_report(path: Optional[str]) -> Optional[dict]:
    if not path or not os.path.isfile(path):
        return None
    try:
        with open(path, encoding="utf-8") as f:
            r = json.load(f)
        return r if isinstance(r, dict) else None
    except (OSError, ValueError):
        return None


def plain_report(rep: Optional[dict], status: Optional[dict] = None, per_place_s: float = 30,
                 names: Optional[dict] = None) -> dict:
    """The Train panel's view of a training report, defensive about its shape:
        balanced accuracy (each place counts the same) beside the always-the-commonest
        baseline, its 95 % interval, recall per place, seconds per place against the
        target ("desk 12 s of 30 s"), and the status word.
    Accepts the held-out shape fingerprint.evaluate_held_out writes (balanced/ci95/
    per_place keyed by model) or flat keys (balanced_accuracy, baseline, interval, recall)."""
    rep = rep if isinstance(rep, dict) else {}
    status = status if isinstance(status, dict) else {}
    names = names or {}
    nm = lambda z: names.get(z) or str(z).replace("_", " ")
    model = _pick_model(rep)
    bal = rep.get("balanced")
    balanced = _num(bal.get(model)) if isinstance(bal, dict) and model else _num(rep.get("balanced_accuracy", bal))
    base = rep.get("baseline")
    baseline = _num(base) if base is not None else (_num(bal.get("majority")) if isinstance(bal, dict) else None)
    ci = rep.get("ci95")
    interval = _pair(ci.get(model)) if isinstance(ci, dict) and model else _pair(rep.get("interval") or ci)
    recall: list = []
    pp, rc = rep.get("per_place"), rep.get("recall")
    if isinstance(rc, dict):
        recall = [{"place": z, "name": nm(z), "recall": _num(v)} for z, v in rc.items()]
    elif isinstance(pp, dict):
        for z, v in pp.items():
            r = _num(v.get(model)) if isinstance(v, dict) and model else _num(v.get("recall") if isinstance(v, dict) else v)
            recall.append({"place": z, "name": nm(z), "recall": r})
    sp = status.get("seconds_per_place") or rep.get("seconds_per_place") or {}
    need = _num(rep.get("per_place_s")) or _num(per_place_s) or 30.0
    seconds = []
    if isinstance(sp, dict):
        for z, v in sp.items():
            have = _num(v) or 0.0
            seconds.append({"place": z, "name": nm(z), "have": round(have, 1), "need": need,
                            "missing": round(max(0.0, need - have), 1)})
    seconds.sort(key=lambda s: (s["missing"] == 0, -s["missing"], s["name"]))
    word = status.get("status") if status.get("status") in STATUS_WORDS else (
        rep.get("status") if rep.get("status") in STATUS_WORDS else "predicting")
    clears = None
    if interval is not None and baseline is not None:
        clears = interval[0] > baseline
    lines = []
    if rep.get("error"):
        lines.append(str(rep["error"]))
    if balanced is not None:
        s = f"Balanced accuracy {_pct(balanced)}"
        if interval is not None:
            s += f" (95 % interval {_pct(interval[0])} to {_pct(interval[1])})"
        if baseline is not None:
            s += f", against {_pct(baseline)} for always saying the commonest place"
        lines.append(s + ".")
        if clears is True:
            lines.append("The whole interval is above the baseline: it is learning places.")
        elif clears is False:
            lines.append("The interval reaches down to the baseline: not yet better than guessing the commonest place.")
    short = [s for s in seconds if s["missing"] > 0]
    if short:
        lines.append("Still needed: " + ", ".join(f"{s['name']} {round(s['have'])} s of {round(s['need'])} s"
                                                  for s in short[:6]) + ("…" if len(short) > 6 else "") + ".")
    elif seconds:
        lines.append(f"Every place has its {round(need)} s.")
    days = status.get("days")
    if word == "answering":
        lines.append("Status: answering. It passed a held-out day.")
    else:
        lines.append("Status: predicting. It answers only after 4-5 days of drills and a passed held-out day"
                     + (f" (days so far: {days})." if days is not None else "."))
    return {"status": word, "model": model, "balanced": balanced, "baseline": baseline, "interval": interval,
            "clears_baseline": clears, "recall": recall, "seconds": seconds, "per_place_s": need,
            "days": days, "sessions": status.get("sessions"), "last_trained": status.get("last_trained"),
            "error": rep.get("error"), "lines": lines}
