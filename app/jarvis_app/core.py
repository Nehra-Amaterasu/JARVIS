"""JARVIS himself: core/jarvis.py as a supervised child process.

Why a child process and not an import: the voice loop owns the microphone,
Whisper on CUDA and audio playback. A crash there must not take the window down,
and "stop JARVIS" must really give the ~1 GB of VRAM back — only process exit
guarantees that. The two sides talk through appio.py (see its docstring).

Supervision (2026-10-15): when the process exits on its own while the app still wants
him (a crash, a CUDA or memory failure at boot, a killed process), the app writes the
exit and the last log lines to DATA/core_crashes.log and starts him again in the same
mode after a backoff of 5 s, 15 s, 60 s, then 300 s, at most 5 restarts in any hour
(backoff.RestartBudget). A run that lasted 10 minutes resets the backoff. stop() is the
only deliberate exit, so it is never "restarted".

States, as the Core tab shows them:
    offline -> booting -> sleeping (voice: waiting for "Hey Jarvis")
                       -> idle     (text: waiting for a typed message)
    listening -> transcribing -> thinking -> replying -> speaking -> followup
"""
from __future__ import annotations

import json
import os
import subprocess
import threading
import time
from collections import deque
from typing import Optional

from .backoff import RestartBudget
from .bus import EventBus
from .paths import CORE, DATA, core_python
from .transcripts import TranscriptStore

SENTINEL = "\x1eJARVIS "
CREATE_NO_WINDOW = 0x08000000          # no console window flashing up on Windows


class CoreProcess:
    def __init__(self, bus: EventBus, api_url: Optional[str] = None, api_token: Optional[str] = None,
                 transcripts: Optional[TranscriptStore] = None):
        self.bus = bus
        # Every question, reply and error is written to disk as it happens, so a
        # bad answer can be flagged and reviewed later (transcripts.py).
        self.transcripts = transcripts or TranscriptStore()
        self.session: Optional[str] = None
        # Set by Limbs: called when JARVIS changes the room (voice) and when his
        # room.py reports its state at boot, so the app stays the single owner.
        self.room_listener = None
        self.room_boot_listener = None
        # Handed to JARVIS so his brain can ask the Aankhen hub what the room looks
        # like (agent.room_context). Local address, per-launch token; never logged.
        self.api_url, self.api_token = api_url, api_token
        # Feature hooks, so a feature never edits this file (routes_settings uses both):
        # env_hooks add to JARVIS's environment at each start (the chosen brain, the
        # settings file); event_taps see every event he sends (the latency meter).
        self.env_hooks: list = []
        self.event_taps: list = []
        self.proc: Optional[subprocess.Popen] = None
        self.mode: Optional[str] = None
        self.state = "offline"
        self.boot_step: Optional[str] = None
        self.started_at: Optional[float] = None
        self.ready_at: Optional[float] = None
        self.last_error: Optional[str] = None
        self.exit_code: Optional[int] = None
        self.room: dict = {}
        self.mqtt: Optional[bool] = None
        self.timings: dict = {}          # latest of each stage (shown in the UI)
        # Per-turn timings for the transcript. Hearing (stt) is reported BEFORE the
        # "heard" event, so it is parked until that turn exists; a typed question
        # therefore never inherits the previous spoken turn's hearing time.
        self._pending_stt: Optional[float] = None
        self._turn_timings: dict = {}
        self.turns: deque = deque(maxlen=200)
        self.logs: deque = deque(maxlen=1500)
        self._turn_id = 0
        self._lock = threading.RLock()
        self._stdin_lock = threading.Lock()
        # The supervisor (module docstring). wanted: the app wants him running (start()
        # sets it, only stop() clears it). schedule(delay, fn) runs fn later and returns
        # something with cancel(); tests replace it.
        self.supervise = True
        self.wanted = False
        self.budget = RestartBudget()
        self.crash_log = DATA / "core_crashes.log"
        self.restarts = 0
        self.restart_due_at: Optional[float] = None
        self.gave_up_at: Optional[float] = None
        self.stop_hooks: list = []               # called after a deliberate stop (routes_alwayson)
        self._restart_timer = None
        self.schedule = _timer
        # Where his Whisper runs (core/whisper_load.py): {"device": "cuda"|"cpu", "gpu_error"}.
        # On the CPU the UI says "voice on CPU (GPU unavailable)" instead of a bare state.
        self.stt: Optional[dict] = None

    # ------------------------------------------------------------ control
    @property
    def running(self) -> bool:
        return self.proc is not None and self.proc.poll() is None

    def start(self, mode: str = "voice", _auto: bool = False) -> dict:
        if mode not in ("voice", "text"):
            raise ValueError("mode must be 'voice' or 'text'")
        with self._lock:
            self.wanted = True
            if not _auto:                          # a person asked: a fresh backoff
                self._cancel_restart()
                self.budget.reset()
                self.gave_up_at = None
            if self.running:
                return self.info()
            args = [core_python(), "-u", "jarvis.py", "--app"] + (["--text"] if mode == "text" else [])
            env = {**os.environ, "PYTHONIOENCODING": "utf-8", "PYTHONUNBUFFERED": "1"}
            if self.api_url and self.api_token:
                env.update(JARVIS_API_URL=self.api_url, JARVIS_API_TOKEN=self.api_token)
            for hook in self.env_hooks:
                env.update({k: str(v) for k, v in (hook() or {}).items()})
            self.proc = subprocess.Popen(
                args, cwd=str(CORE), env=env, stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT, creationflags=CREATE_NO_WINDOW if os.name == "nt" else 0)
            self.mode, self.state, self.boot_step = mode, "booting", "starting"
            self.session = time.strftime("%Y%m%d-%H%M%S")
            self.started_at, self.ready_at = time.time(), None
            self.last_error, self.exit_code = None, None
            threading.Thread(target=self._read, args=(self.proc,), name="core-reader", daemon=True).start()
        self.bus.publish("core", "starting", f"Waking JARVIS ({mode} mode)", mode=mode)
        return self.info()

    def stop(self) -> dict:
        with self._lock:
            self.wanted = False                    # a deliberate stop is never restarted
            self._cancel_restart()
            proc = self.proc
        if proc is None or proc.poll() is not None:
            return self.info()
        try:
            proc.stdin.close()                 # text mode exits cleanly on EOF
        except Exception:
            pass
        try:
            proc.wait(timeout=2.5)
        except subprocess.TimeoutExpired:
            proc.terminate()                    # voice mode blocks on the mic: hard stop
            try:
                proc.wait(timeout=3)
            except subprocess.TimeoutExpired:
                proc.kill()
        for hook in self.stop_hooks:
            try:
                hook()
            except Exception as e:
                self._log(f"[app] stop hook failed: {e!r}")
        return self.info()

    # ------------------------------------------------------------ supervisor
    def _cancel_restart(self) -> None:
        t, self._restart_timer, self.restart_due_at = self._restart_timer, None, None
        if t is not None:
            try:
                t.cancel()
            except Exception:
                pass

    def _crashed(self, proc: subprocess.Popen, code: Optional[int]) -> None:
        """He exited on his own while wanted: log it and schedule the restart (or give up)."""
        now = time.time()
        ran = now - self.started_at if self.started_at else None
        tail = [l["line"] for l in list(self.logs)[-40:]]
        try:
            self.crash_log.parent.mkdir(parents=True, exist_ok=True)
            with open(self.crash_log, "a", encoding="utf-8") as f:
                f.write(f"=== {time.strftime('%Y-%m-%d %H:%M:%S')} exit {code} after "
                        f"{'?' if ran is None else round(ran)} s ({self.mode} mode, pid {proc.pid})\n")
                f.write("\n".join(tail) + "\n")
        except OSError as e:
            self._log(f"[app] crash log write failed: {e}")
        delay = self.budget.next_delay(ran)
        if delay is None:
            # The hourly cap is spent. Until 10-25 that was the end: a boot-time fault that
            # cleared later (the GPU waking up) left him dead until someone pressed Start.
            # One more try once the oldest restart leaves the hour keeps the cap of
            # max_per_hour and still brings him back without a person.
            self.gave_up_at = now
            wait = max(300.0, self.budget.wait_until_allowed())
            self.restart_due_at = now + wait
            self.bus.publish("core", "gave_up", f"JARVIS keeps crashing: {self.budget.max_per_hour} restarts in an "
                             f"hour. Trying again in {wait / 60:.0f} min; see core_crashes.log", exit_code=code,
                             retry_s=round(wait))
            self._restart_timer = self.schedule(wait, self._auto_restart)
            return
        self.restart_due_at = now + delay
        self.bus.publish("core", "restarting", f"JARVIS exited ({code}); restarting in {delay:.0f} s",
                         exit_code=code, delay_s=delay, restarts=self.restarts)
        self._restart_timer = self.schedule(delay, self._auto_restart)

    def _auto_restart(self) -> None:
        with self._lock:
            self._restart_timer, self.restart_due_at = None, None
            if not self.wanted or self.running:
                return
            self.restarts += 1
            mode = self.mode or "voice"
        try:
            self.start(mode, _auto=True)
        except Exception as e:
            self.last_error = f"restart failed: {e}"
            self.bus.publish("core", "error", f"Could not restart JARVIS: {e}")

    def _send(self, obj: dict) -> None:
        if not self.running:
            raise RuntimeError("JARVIS is not running")
        line = json.dumps(obj, ensure_ascii=False) + "\n"
        with self._stdin_lock:
            self.proc.stdin.write(line.encode("utf-8"))
            self.proc.stdin.flush()

    def say(self, text: str) -> None:
        text = text.strip()
        if not text:
            raise ValueError("empty message")
        self._send({"type": "say", "text": text})

    def speak(self, text: str) -> dict:
        """JARVIS says `text` as-is (a brief, a nudge, a Crucible call) — it is NOT
        sent to the model as a message from Aman. Kept in the transcript as his turn."""
        text = text.strip()
        if not text:
            raise ValueError("empty line")
        self._send({"type": "speak", "text": text[:600]})
        with self._lock:
            self._turn_id += 1
            turn = {"id": self._turn_id, "role": "jarvis", "text": text[:600], "t": time.time(), "done": True,
                    "session": self.session, "announce": True}
            self.turns.append(turn)
            self._keep(turn)
        self.bus.publish("core", "turn", "", turn=turn)
        return turn

    def hear(self, path: str, clip_id: str) -> None:
        """A recording from his phone: JARVIS's own Whisper (already loaded in voice mode)
        transcribes it and the text becomes a turn, exactly like a typed message. He
        deletes the file once read and answers with a `phone_heard` event."""
        if not self.running:
            raise RuntimeError("JARVIS is not running")
        if self.mode != "voice":
            raise RuntimeError("JARVIS is in text mode: there is no Whisper to hear with")
        self._send({"type": "hear", "path": path, "id": clip_id})

    def room_command(self, device: str, action: str, value=None) -> None:
        self._send({"type": "room", "device": device, "action": action, "value": value})

    # ------------------------------------------------------------ reading
    def _read(self, proc: subprocess.Popen) -> None:
        for raw in iter(proc.stdout.readline, b""):
            line = raw.decode("utf-8", "replace").rstrip("\r\n")
            if line.startswith(SENTINEL):
                try:
                    self._on_event(json.loads(line[len(SENTINEL):]))
                except json.JSONDecodeError:
                    self._log(line)
                except Exception as e:
                    # This thread is the only reader of JARVIS's stdout. If it dies,
                    # the pipe fills and JARVIS blocks on his next print — he hangs
                    # silently mid-conversation (exactly what a keyword clash in
                    # _set_state once caused). A bad event is logged, never fatal.
                    self._log(f"[app] could not handle event: {e!r} :: {line[:200]}")
            elif line.strip():
                self._log(line)
        code = proc.wait()
        with self._lock:
            if proc is self.proc:
                self.exit_code = code
                self.state = "offline"
                self.boot_step = None
        if code not in (0, None) and self.last_error is None:
            tail = [l["line"] for l in list(self.logs)[-6:]]
            self.last_error = f"exited with code {code}: " + " | ".join(tail)[-400:]
        self.bus.publish("core", "stopped",
                         "JARVIS stopped" if code in (0, None, 1) else f"JARVIS exited ({code})",
                         exit_code=code, error=self.last_error)
        with self._lock:
            crashed = self.supervise and self.wanted and proc is self.proc
        if crashed:
            self._crashed(proc, code)

    def _log(self, line: str) -> None:
        self.logs.append({"t": time.time(), "line": line})

    def _set_state(self, state: str, saying: Optional[str] = None) -> None:
        if state != self.state:
            self.state = state
            self.bus.publish("core", "state", "", state=state, saying=saying)

    def _current_reply(self) -> dict:
        if self.turns and self.turns[-1]["role"] == "jarvis" and not self.turns[-1]["done"]:
            return self.turns[-1]
        self._turn_id += 1
        turn = {"id": self._turn_id, "role": "jarvis", "text": "", "t": time.time(), "done": False,
                "session": self.session}
        self.turns.append(turn)
        return turn

    def _keep(self, turn: dict) -> None:
        try:
            self.transcripts.record_turn(self.session or "unknown", turn, self.mode, self._turn_timings)
        except OSError as e:
            self._log(f"[app] transcript write failed: {e}")

    def _on_event(self, ev: dict) -> None:
        kind = ev.get("kind")
        for tap in self.event_taps:
            try:
                tap(ev)
            except Exception as e:                   # a tap must never stop the reader
                self._log(f"[app] event tap failed: {e!r}")
        with self._lock:
            if kind == "boot":
                self.boot_step = ev.get("step")
                self.bus.publish("core", "boot", f"Booting: {self.boot_step}", step=self.boot_step)
            elif kind == "ready":
                self.ready_at = time.time()
                self.boot_step = None
                took = self.ready_at - (self.started_at or self.ready_at)
                self.bus.publish("core", "ready", f"JARVIS online ({ev.get('mode')}) in {took:.0f} s",
                                 mode=ev.get("mode"), boot_s=round(took, 1))
            elif kind == "state":
                self._set_state(ev.get("state", "idle"), saying=ev.get("text"))
            elif kind == "stt":
                was = (self.stt or {}).get("device")
                self.stt = {"device": ev.get("device"), "gpu_error": ev.get("gpu_error"), "model": ev.get("model")}
                if self.stt["device"] == "cpu":
                    self.bus.publish("core", "stt_cpu", "Voice on CPU (GPU unavailable): hearing is slower until "
                                     "the GPU is back", error=ev.get("gpu_error"))
                elif was == "cpu":
                    self.bus.publish("core", "stt_gpu", "The GPU is back: voice on the GPU again")
            elif kind == "wake":
                self.bus.publish("core", "wake", "Wake word heard", score=ev.get("score"))
            elif kind == "level":
                self.bus.publish("core", "level", ephemeral=True, level=ev.get("level"),
                                 threshold=ev.get("threshold"))
            elif kind == "heard":
                self._turn_id += 1
                turn = {"id": self._turn_id, "role": "you", "text": ev.get("text", ""),
                        "t": time.time(), "done": True, "session": self.session}
                self.turns.append(turn)
                self._turn_timings = {"stt": self._pending_stt} if self._pending_stt is not None else {}
                self._pending_stt = None
                self._keep(turn)
                self.bus.publish("core", "turn", "", turn=turn)
            elif kind == "reply_chunk":
                turn = self._current_reply()
                turn["text"] += ev.get("text", "")
                self.bus.publish("core", "reply_chunk", ephemeral=True, turn_id=turn["id"],
                                 chunk=ev.get("text", ""))
            elif kind == "reply_end":
                turn = self._current_reply()
                turn["text"] = ev.get("text", turn["text"])
                turn["done"] = True
                turn["seconds"] = ev.get("seconds")
                self.timings["reply"] = ev.get("seconds")
                self._turn_timings["reply"] = ev.get("seconds")
                self._keep(turn)
                self.bus.publish("core", "turn", "", turn=turn)
            elif kind == "timing":
                self.timings[ev.get("stage")] = ev.get("seconds")
                if ev.get("stage") == "stt":
                    self._pending_stt = ev.get("seconds")
                elif ev.get("stage") == "first_audio":
                    jt = next((t for t in reversed(self.turns) if t["role"] == "jarvis"), None)
                    if jt is not None:
                        try:
                            self.transcripts.record_timing(self.session or "unknown", jt["id"], "first_audio",
                                                           ev.get("seconds"))
                        except OSError as e:
                            self._log(f"[app] timing write failed: {e}")
                else:
                    self._turn_timings[ev.get("stage")] = ev.get("seconds")
                self.bus.publish("core", "timing", ephemeral=True, stage=ev.get("stage"),
                                 seconds=ev.get("seconds"))
            elif kind in ("room", "room_state"):
                if kind == "room":
                    self.room[ev["device"]] = ev["state"]
                    if self.room_listener is not None:
                        self.room_listener(ev["device"], ev["state"])
                else:
                    self.room = dict(ev.get("state") or {})
                    self.mqtt = ev.get("mqtt")
                    if self.room_boot_listener is not None:
                        self.room_boot_listener()
            elif kind == "speech_done":
                self.bus.publish("core", "speech_done", ephemeral=True)
            elif kind == "receipt":
                # What a tool really did (core/tools): the evidence behind a reply.
                receipt = {k: v for k, v in ev.items() if k not in ("kind", "t")}
                self.bus.publish("core", "receipt", str(ev.get("did") or "")[:200], receipt=receipt,
                                 sim=bool(ev.get("simulated")))
            elif kind == "honesty":
                replaced = ev.get("replaced") or []
                self.bus.publish("core", "honesty", f"Replaced {len(replaced)} unbacked claim(s) in a reply",
                                 replaced=replaced)
            elif kind in ("error", "diagnosis"):
                msg = ev.get("message") or ev.get("text") or ""
                if kind == "error":
                    self.last_error = msg
                    try:
                        self.transcripts.record_error(self.session or "unknown", msg, bool(ev.get("critical")))
                    except OSError:
                        pass
                self.bus.publish("core", kind, msg, critical=ev.get("critical", False))

    # ------------------------------------------------------------ views
    def info(self) -> dict:
        with self._lock:
            return {
                "running": self.running,
                "mode": self.mode,
                "state": self.state if self.running else "offline",
                "boot_step": self.boot_step,
                "pid": self.proc.pid if self.running else None,
                "started_at": self.started_at,
                "ready_at": self.ready_at,
                "uptime_s": round(time.time() - self.started_at, 1) if self.running and self.started_at else None,
                "last_error": self.last_error,
                "exit_code": self.exit_code,
                "timings": dict(self.timings),
                "room": dict(self.room),
                "mqtt": self.mqtt,
                "session": self.session,
                "stt": dict(self.stt) if self.stt and self.running else None,
                "status_line": self._status_line(),
                "supervisor": {"on": self.supervise, "wanted": self.wanted, "restarts": self.restarts,
                               "restarts_last_hour": self.budget.used_last_hour(),
                               "restart_due_at": self.restart_due_at, "gave_up_at": self.gave_up_at},
            }

    def _status_line(self) -> str:
        """What the window says about him, in words (the caller holds the lock)."""
        if not self.running:
            if self.restart_due_at:
                return f"Offline: restarting in {max(0, round(self.restart_due_at - time.time()))} s"
            return "Offline" + (": " + self.last_error[:120] if self.last_error else "")
        if self.stt and self.stt.get("device") == "cpu":
            return "Voice on CPU (GPU unavailable)"
        return self.state

    def note_remark(self, text: str, reason: str = "proactive") -> dict:
        """A line JARVIS said on his own (an unprompted remark): kept in the transcript
        as his turn, like speak(), but nothing is sent to him (he already said it)."""
        with self._lock:
            self._turn_id += 1
            turn = {"id": self._turn_id, "role": "jarvis", "text": text[:600], "t": time.time(), "done": True,
                    "session": self.session, "announce": True, "proactive": reason}
            self.turns.append(turn)
            self._keep(turn)
        self.bus.publish("core", "turn", "", turn=turn)
        return turn

    def transcript(self, n: int = 60) -> list[dict]:
        with self._lock:
            return [dict(t) for t in list(self.turns)[-n:]]

    def log_tail(self, n: int = 300) -> list[dict]:
        return list(self.logs)[-n:]


def _timer(delay: float, fn):
    t = threading.Timer(delay, fn)
    t.daemon = True
    t.start()
    return t
