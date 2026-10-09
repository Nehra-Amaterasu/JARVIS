"""App bridge for jarvis.py: structured events out on stdout, commands in on stdin.

The desktop app runs the voice loop as a child process (it owns the microphone,
Whisper on CUDA and audio playback; a crash there must not take the window down,
and stopping JARVIS must actually free the GPU). The two talk over the child's
standard streams:

  child -> app   one line per event:  "\\x1eJARVIS " + JSON
                 {"kind": "state", "state": "thinking", "t": 1760000000.0}
                 Everything else on stdout is ordinary log text and is shown as such.
  app -> child   one JSON object per line on stdin:
                 {"type": "say", "text": "what's on my desk?"}

Run directly from a terminal (no --app), emit() does nothing and no stdin reader
starts, so `python jarvis.py` behaves exactly as it always has.

Flags:
  --app    enable the bridge
  --text   text-only mode: no microphone, no Whisper, no wake word, no speech.
           Typed messages in, streamed replies out. Starts in seconds and leaves
           ~1 GB of VRAM free that Whisper would otherwise hold.
"""
from __future__ import annotations

import json
import queue
import sys
import threading
import time
from typing import Optional

SENTINEL = "\x1eJARVIS "
ENABLED = "--app" in sys.argv
TEXT_ONLY = "--text" in sys.argv

_out_lock = threading.Lock()
_commands: "queue.Queue[Optional[dict]]" = queue.Queue()
_handlers: dict = {}


def on(cmd_type: str, handler) -> None:
    """Handle a command type immediately on the reader thread (quick actions such
    as switching a light), instead of queueing it behind the conversation."""
    _handlers[cmd_type] = handler


def emit(kind: str, **data) -> None:
    """Send one structured event to the app (no-op outside the app)."""
    if not ENABLED:
        return
    line = SENTINEL + json.dumps({"kind": kind, "t": time.time(), **data}, ensure_ascii=False)
    with _out_lock:
        try:
            stream = sys.__stdout__
            stream.write("\n" + line + "\n")   # leading newline: never glue onto a partial log line
            stream.flush()
        except Exception:
            pass


def _reader() -> None:
    for raw in sys.stdin:
        raw = raw.strip()
        if not raw:
            continue
        try:
            cmd = json.loads(raw)
        except json.JSONDecodeError:
            cmd = {"type": "say", "text": raw}
        handler = _handlers.get(cmd.get("type"))
        if handler is not None:
            try:
                handler(cmd)
            except Exception as e:
                emit("error", message=f"{cmd.get('type')} command failed: {e}")
            continue
        _commands.put(cmd)
    _commands.put(None)                      # stdin closed: the app has gone


if ENABLED:
    threading.Thread(target=_reader, name="appio-stdin", daemon=True).start()


def poll_say() -> Optional[str]:
    """Non-blocking: a typed message waiting from the app, else None."""
    try:
        cmd = _commands.get_nowait()
    except queue.Empty:
        return None
    if cmd is None:
        _commands.put(None)                  # keep the "closed" marker for wait_say()
        return None
    return cmd.get("text") if cmd.get("type") == "say" else None


def wait_say() -> Optional[str]:
    """Blocking: the next typed message, or None once the app closes stdin."""
    while True:
        cmd = _commands.get()
        if cmd is None:
            return None
        if cmd.get("type") == "say" and cmd.get("text", "").strip():
            return cmd["text"].strip()
