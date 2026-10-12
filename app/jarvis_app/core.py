"""JARVIS himself: core/jarvis.py as a supervised child process.

Why a child process and not an import: the voice loop owns the microphone,
Whisper on CUDA and audio playback. A crash there must not take the window down,
and "stop JARVIS" must really give the ~1 GB of VRAM back — only process exit
guarantees that. The two sides talk through appio.py (see its docstring).

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

from .bus import EventBus
from .paths import CORE, core_python
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

    # ------------------------------------------------------------ control
    @property
    def running(self) -> bool:
        return self.proc is not None and self.proc.poll() is None

    def start(self, mode: str = "voice") -> dict:
        if mode not in ("voice", "text"):
            raise ValueError("mode must be 'voice' or 'text'")
        with self._lock:
            if self.running:
                return self.info()
            args = [core_python(), "-u", "jarvis.py", "--app"] + (["--text"] if mode == "text" else [])
            env = {**os.environ, "PYTHONIOENCODING": "utf-8", "PYTHONUNBUFFERED": "1"}
            if self.api_url and self.api_token:
                env.update(JARVIS_API_URL=self.api_url, JARVIS_API_TOKEN=self.api_token)
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
        return self.info()

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
            }

    def transcript(self, n: int = 60) -> list[dict]:
        with self._lock:
            return [dict(t) for t in list(self.turns)[-n:]]

    def log_tail(self, n: int = 300) -> list[dict]:
        return list(self.logs)[-n:]
