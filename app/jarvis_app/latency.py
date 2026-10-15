"""How fast JARVIS answers, and whether he answered at all, from what he reported.

A spoken turn, as core/jarvis.py times it:
    "Hey Jarvis" -> wake      (openWakeWord's score, threshold 0.35)
    you talk, then stop
    endpoint    silence waited before the recording closed     (timing "endpoint")
    stt         Whisper turning it into text                   (timing "stt")
    first_audio question in -> his voice starts                 (timing "first_audio")
    reply       question in -> the last word generated          (reply_end "seconds")
So, from the moment Aman stops talking:
    heard       = endpoint + stt
    first word  = endpoint + stt + first_audio
    full reply  = endpoint + stt + reply          (the text complete)
    done        = endpoint + stt + speech_done    (his voice stops; live log only)
(A typed turn has no hearing; its first word is the first token on screen.)

Two sources: the transcripts on disk (every turn of the last days, transcripts.py) and
a live log of each wake since the app started, with its outcome. The live log is what
answers "he doesn't reply when I say Jarvis": answered, heard nothing, or an error, and
how sure the wake word was. A wake that was never detected leaves no trace anywhere;
low scores on the ones that were are the sign of it.
"""
from __future__ import annotations

import json
import os
import statistics
import threading
import time
from collections import deque
from pathlib import Path
from typing import Iterable, Optional

WAKE_THRESHOLD = 0.35            # core/jarvis.py listen_for_wake_word
KEEP_WAKES = 20                  # shown: the wakes since the app started
KEEP_WAKES_ON_DISK = 500         # kept: data/app/wake.jsonl, across restarts (overnight false wakes)


def _num(v) -> Optional[float]:
    return float(v) if isinstance(v, (int, float)) else None


def turns(entries: Iterable[dict]) -> list[dict]:
    """JARVIS's replies with their stages, oldest first."""
    entries = list(entries)
    audio = {(e.get("session"), e.get("id")): _num(e.get("seconds")) for e in entries
             if e.get("kind") == "timing" and e.get("stage") == "first_audio"}
    out = []
    for e in entries:
        if e.get("kind") != "turn" or e.get("role") != "jarvis" or e.get("announce"):
            continue
        t = e.get("timings") or {}
        stt, endpoint = _num(t.get("stt")), _num(t.get("endpoint"))
        first_token, reply = _num(t.get("first_token")), _num(e.get("seconds") or t.get("reply"))
        if reply is None:
            # Not a reply: a line the app had him say (a brief, a nudge). It is kept
            # with the timings of the turn before it, which are not its own.
            continue
        first_audio = audio.get((e.get("session"), e.get("id")))
        spoken = stt is not None
        lead = (endpoint or 0.0) + (stt or 0.0)
        out.append({
            "ts": e.get("ts"), "session": e.get("session"), "id": e.get("id"), "spoken": spoken,
            "endpoint": endpoint, "stt": stt, "first_token": first_token, "first_audio": first_audio,
            "heard": round(lead, 2) if spoken else None,
            "first_word": round(lead + first_audio, 2) if first_audio is not None
            else (round(lead + first_token, 2) if first_token is not None and not spoken else None),
            "full": round(lead + reply, 2) if reply is not None else None,
        })
    return out


def _stats(vals: list[float]) -> Optional[dict]:
    if not vals:
        return None
    s = sorted(vals)
    return {"median": round(statistics.median(s), 2), "p90": round(s[int(0.9 * (len(s) - 1))], 2), "n": len(s)}


def summary(rows: list[dict]) -> dict:
    spoken = [r for r in rows if r["spoken"]]
    pick = lambda rs, k: [r[k] for r in rs if r[k] is not None]   # noqa: E731
    return {"turns": len(rows), "spoken": len(spoken),
            "heard": _stats(pick(spoken, "heard")),
            "first_word": _stats(pick(spoken, "first_word")),
            "full": _stats(pick(spoken, "full")),
            "typed_first_word": _stats(pick([r for r in rows if not r["spoken"]], "first_word"))}


class WakeLog:
    """Each "Hey Jarvis" since the app started, and what came of it.

    Fed every event JARVIS's process sends (CoreProcess.event_taps). Follow-up turns
    (no new wake word) do not open a record: this is about the wake word.
        listening -> thinking (he heard words) -> answered
                  -> heard_nothing (back to sleep with no words)
                  -> error
    """

    OPEN = ("listening", "thinking")

    def __init__(self, keep: int = KEEP_WAKES, clock=time.time, path: Optional[Path] = None,
                 keep_on_disk: int = KEEP_WAKES_ON_DISK):
        self._wakes: deque = deque(maxlen=keep)
        self._lock = threading.Lock()
        self.clock = clock
        # On disk: the last keep_on_disk wakes from every run (one JSON object a line), so
        # a night's false wakes can be counted in the morning. view() still shows only
        # this run's, as before.
        self.path = Path(path) if path else None
        self._disk: deque = deque(maxlen=keep_on_disk)
        if self.path is not None:
            try:
                for line in self.path.read_text(encoding="utf-8").splitlines():
                    try:
                        self._disk.append(json.loads(line))
                    except ValueError:
                        pass
            except OSError:
                pass

    def _save(self) -> None:
        if self.path is None:
            return
        try:
            self.path.parent.mkdir(parents=True, exist_ok=True)
            tmp = self.path.with_suffix(".tmp")
            tmp.write_text("".join(json.dumps(w, ensure_ascii=False) + "\n" for w in self._disk), encoding="utf-8")
            os.replace(tmp, self.path)
        except OSError:
            pass                                    # a full disk must not stop the wake log

    def on_event(self, ev: dict) -> None:
        if self.path is None:
            return self._on_event(ev)
        with self._lock:
            cur = self._wakes[-1] if self._wakes else None
            before = (id(cur), json.dumps(cur, sort_keys=True, default=str)) if cur is not None else None
        self._on_event(ev)
        with self._lock:
            cur = self._wakes[-1] if self._wakes else None
            if cur is None:
                return
            if before is None or before[0] != id(cur):
                self._disk.append(cur)               # the same dict: later updates show up in it
            elif before[1] == json.dumps(cur, sort_keys=True, default=str):
                return
            self._save()

    def _on_event(self, ev: dict) -> None:
        kind = ev.get("kind")
        t = _num(ev.get("t")) or self.clock()
        with self._lock:
            if kind == "wake":
                self._wakes.append({"t": t, "score": _num(ev.get("score")), "outcome": "listening"})
                return
            cur = self._wakes[-1] if self._wakes else None
            if cur is None:
                return
            if kind == "timing":
                stage, sec = ev.get("stage"), _num(ev.get("seconds"))
                if stage == "stt" and cur["outcome"] == "listening":
                    cur["stt"] = sec                   # sent before "heard"
                elif stage == "endpoint" and cur["outcome"] == "thinking" and "endpoint" not in cur:
                    cur["endpoint"] = sec              # respond() sends it just after "heard"
                elif stage == "first_token" and cur["outcome"] == "thinking" and "first_token" not in cur:
                    cur["first_token"] = sec
                elif stage == "first_audio" and "first_audio" not in cur and cur.get("heard_at"):
                    cur["first_audio"] = sec       # playback often starts after the text has ended
            elif kind == "heard" and cur["outcome"] == "listening":
                cur.update(outcome="thinking", heard_at=t)
            elif kind == "heard":
                cur["closed"] = True               # a follow-up turn: not this wake's any more
            elif kind == "reply_end" and cur["outcome"] == "thinking":
                cur.update(outcome="answered", reply=_num(ev.get("seconds")))
            elif kind == "speech_done" and cur["outcome"] == "answered" and not cur.get("closed"):
                # The text is often complete before the voice is. The playback queue can
                # run dry between two sentences while the next is synthesised, so the
                # LAST speech_done of the turn is when he went quiet.
                cur["spoken"] = round(t - cur["heard_at"], 2)
            elif kind == "state" and ev.get("state") == "sleeping" and cur["outcome"] == "listening":
                cur["outcome"] = "heard_nothing"
            elif kind == "error" and cur["outcome"] in self.OPEN:
                cur.update(outcome="error", error=str(ev.get("message") or "")[:160])

    def view(self) -> dict:
        with self._lock:
            wakes = [dict(w) for w in self._wakes]
        for w in wakes:
            lead = (w.get("endpoint") or 0.0) + (w.get("stt") or 0.0)
            w["first_word"] = round(lead + w["first_audio"], 2) if w.get("first_audio") is not None else None
            w["full"] = round(lead + w["reply"], 2) if w.get("reply") is not None else None
            w["done_speaking"] = round(lead + w["spoken"], 2) if w.get("spoken") is not None else None
            w["marginal"] = w.get("score") is not None and w["score"] < WAKE_THRESHOLD + 0.15
        counts: dict = {}
        for w in wakes:
            counts[w["outcome"]] = counts.get(w["outcome"], 0) + 1
        return {"wakes": list(reversed(wakes)), "counts": counts, "threshold": WAKE_THRESHOLD}
