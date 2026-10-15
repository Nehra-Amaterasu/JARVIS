"""Aankhen hub: one source + one engine, shared by every viewer.

The desktop app's Aankhen tab and the standalone `python -m aankhen serve` (phone /
AR viewer) both sit on this. It owns the lifecycle — pick a source, calibrate,
start the consumer thread, stop cleanly — and builds the messages viewers receive.

Source selection ("auto"): the ESP32 if one has identified itself on USB (boards.py:
a CRC-valid Aankhen frame read from the port, not a USB vendor id), otherwise the
simulator. The simulator is never silent about itself: every message carries source=
"simulation", and in that mode the hub also sends the simulator's ground truth and
live tracking error, so the twin can draw where people REALLY are next to where the
pipeline thinks they are.

Hot-plug (enable_hotplug): while the hub runs, a watcher looks for a board every few
seconds. If the simulator is running only because no board answered at start
("auto"), the first board that answers takes over. If a person chose the simulation,
it is left alone and the board is announced instead.
"""
from __future__ import annotations

import json
import math
import os
import threading
import time
from pathlib import Path
from typing import Optional

import numpy as np
from scipy.optimize import linear_sum_assignment

from .engine import Engine, run_engine
from .motion import Baseline
from .protocol import Frame, FrameType
from . import DATA_DIR
from .room import Room, layout_kind, load_room
from .simulator import ROOM_SCENARIOS, SCENARIOS, Simulator, SimulatorSource, scenario_life
from .boards import default_finder
from .transport import ReplaySource, SerialSource, find_esp32_port

BASELINE_FILE = os.path.join(DATA_DIR, "baseline.json")          # room-specific
BASELINE_FAN_FILE = os.path.join(DATA_DIR, "baseline_fan.json")  # same, with the ceiling fan running


HOTPLUG_INTERVAL_S = 2.0     # how often the watcher looks; F4 asks for < 5 s after the handshake


class AankhenHub:
    def __init__(self, room: Optional[Room] = None, room_measured: Optional[bool] = None,
                 boards=None):
        if room is None:
            room, measured = load_room()
            room_measured = measured if room_measured is None else room_measured
            self.layout = layout_kind()             # measured | estimated | default
        else:
            self.layout = "measured" if room_measured else "default"
        self.room = room
        self.room_measured = bool(room_measured)
        self.source = None
        self.engine: Optional[Engine] = None
        # The day as Aankhen saw it (journal.py): fed once a second from the REAL board.
        from .journal import ActivityJournal
        self.journal = ActivityJournal()
        self._journal_thread: Optional[threading.Thread] = None
        self.sim: Optional[Simulator] = None
        self.mode: Optional[str] = None
        self.scenario: Optional[str] = None
        self.started_at: Optional[float] = None
        self.error: Optional[str] = None
        self._stop = threading.Event()
        self._thread: Optional[threading.Thread] = None
        self._lock = threading.RLock()
        self._sim_baseline: Optional[Baseline] = None
        self._cmd_seq = 0
        self.recordings_dir = Path(DATA_DIR) / "recordings"
        # Which serial port is the board (boards.BoardFinder). None: the process-wide
        # finder, shared with the Connect page; a test passes one over fake ports.
        self.boards = boards
        self.requested_mode: Optional[str] = None   # what was asked: "auto" may become either
        # Set while something else needs the board's serial port (the app's firmware
        # flasher): start() refuses, so neither a button nor the hot-plug watcher can
        # reopen the port in the middle of an upload.
        self.hold: Optional[str] = None
        self.link_note: Optional[str] = None        # the serial link's last word
        self._hotplug_cb = None
        self._hotplug_interval = HOTPLUG_INTERVAL_S
        self._hotplug_thread: Optional[threading.Thread] = None
        self._hotplug_stop = threading.Event()
        self._announced: set[str] = set()
        self.hotplug_last: Optional[dict] = None
        from .teach import Teacher
        self.teacher = Teacher(self)
        # The rolling week of raw Wi-Fi (stream.py): recording while the REAL board runs.
        self.stream = None
        self.stream_error: Optional[str] = None
        self._stream_usage: tuple[float, dict] = (float("-inf"), {})
        # Free teachers (teachers.py): laptop input counts, phone on Wi-Fi, voice turns,
        # relay changes. Logged while the REAL board runs. The app hands the hub two
        # readers: the fan as the Uno reports it, and a running count of voice turns.
        self.teachers = None
        self.fan_reader = None                  # () -> Optional[bool]
        self.voice_reader = None                # () -> int, rises by one per voice turn
        self._voice_seen: Optional[int] = None
        self.fan_board: Optional[bool] = None

    # ------------------------------------------------------------ lifecycle
    def start(self, mode: str = "auto", scenario: str = "evening", port: Optional[str] = None,
              path: Optional[str] = None, speed: float = 1.0, loop: bool = True) -> dict:
        with self._lock:
            if self.hold:
                raise RuntimeError(f"Aankhen is paused: {self.hold}")
            self._stop_source()
            self.error = None
            requested, found = mode, None
            if mode == "auto":
                found = port or self._find_board(force=False)
                mode = "hardware" if found else "simulation"
            if mode == "hardware":
                # Asked for the board explicitly but none answers: say so, instead of
                # silently switching to a source that waits forever (the "ESP32"
                # button used to do exactly that). A person pressed a button, so every
                # port is asked again, even the ones that said "not Aankhen" before.
                if not port and not found and not self._find_board(force=True):
                    raise FileNotFoundError(self._no_board_message())
                finder = self._finder()
                source = SerialSource(port, opener=finder.opener, finder=finder,
                                      on_status=self._on_link)
                baseline = Baseline.load(BASELINE_FILE)
                fan_baseline = Baseline.load(BASELINE_FAN_FILE)
            elif mode == "replay":
                if not path or not os.path.exists(path):
                    raise FileNotFoundError(f"recording not found: {path}")
                source = ReplaySource(path, speed=speed, loop=loop)
                baseline = Baseline.load(BASELINE_FILE)
                fan_baseline = Baseline.load(BASELINE_FAN_FILE)
            elif mode == "simulation":
                if scenario not in self.scenarios():
                    raise ValueError(f"unknown scenario {scenario!r}; one of {self.scenarios()}")
                if self._sim_baseline is None:
                    from .bench import simulated_baseline
                    self._sim_baseline = simulated_baseline(self.room)
                baseline = self._sim_baseline
                fan_baseline = None                     # learned from the radar-empty room
                seed = int(time.time()) % 10_000
                if scenario in SCENARIOS:
                    scen = SCENARIOS[scenario](self.room)   # mapped onto this room's bed, desk and door
                elif scenario == "day":                 # a random ordinary day in this house
                    scen = scenario_life(self.room, np.random.default_rng(seed))
                else:                                   # built from room.json "house"
                    scen = ROOM_SCENARIOS[scenario](self.room)
                self.sim = Simulator(self.room, scen, seed=seed)
                source = SimulatorSource(self.sim, speed=speed)
            else:
                raise ValueError(f"unknown mode {mode!r}")
            if mode != "simulation":
                self.sim = None
            from .dayeval import ZoneModel
            from .learn import ActivityModel, SpatialModel
            prev = self.engine
            self.engine = Engine(self.room, source.kind, self.room_measured, baseline,
                                 fan_baseline=fan_baseline, spatial_model=SpatialModel.load(),
                                 activity_model=ActivityModel.load(),
                                 zone_model=ZoneModel.load_current() if mode != "simulation" else None)
            if self.fan_board is not None and mode == "hardware":
                self.engine.set_fan_external(self.fan_board)
            if prev is not None:
                # Event ids keep rising across a source switch. The app relays an event
                # only if its id is above the last one relayed (server.aankhen_watch), so
                # an engine counting from 1 again was muted after every switch — and a
                # hot-plug switch is one nobody asked for, so it must not go quiet.
                self.engine._event_id = prev._event_id
            self.source = source
            self.mode, self.scenario = mode, scenario if mode == "simulation" else None
            self._start_stream(source.kind)
            self.requested_mode = requested
            self.link_note = None
            self._stop = threading.Event()
            source.start()
            self._thread = threading.Thread(target=run_engine, args=(source, self.engine, self._stop),
                                            name="aankhen-engine", daemon=True)
            self._thread.start()
            self.started_at = time.time()
            self._ensure_hotplug()
            self._ensure_journal()
            self._ensure_teachers(mode)
            return self.info()

    def stop(self) -> None:
        """Stop the source and the hot-plug watcher: a stopped hub stays stopped."""
        self._stop_hotplug()
        self._stop_source()
        if self.teachers is not None:
            self.teachers.stop()
            self.teachers = None

    # ------------------------------------------------------------ free teachers
    def _ensure_teachers(self, mode: str) -> None:
        from . import teachers as ft
        if mode != "hardware" or not ft.enabled():
            if self.teachers is not None:
                self.teachers.stop()
                self.teachers = None
            return
        if self.teachers is None:
            self.teachers = ft.FreeTeachers()
        self.teachers.start()

    def note_fan(self, on: Optional[bool]) -> None:
        """What the relay board (the Uno) says the fan is doing."""
        changed = on != self.fan_board
        self.fan_board = on
        if self.teachers is not None:
            self.teachers.note_relay("fan", on)
        eng = self.engine
        if changed and eng is not None and on is not None and self.mode == "hardware":
            eng.set_fan_external(on)

    def note_relay(self, device: str, on: Optional[bool]) -> None:
        if self.teachers is not None:
            self.teachers.note_relay(device, on)

    def note_voice_turn(self) -> None:
        if self.teachers is not None:
            self.teachers.note_voice_turn()

    def _teacher_tick(self) -> None:
        """Once a second: read the app's fan and voice counters, hand the teachers' hint
        to the engine, and run the daily empty-room recalibration only while the teachers
        say the room is empty (phone away and laptop idle, 10+ minutes)."""
        if self.fan_reader is not None:
            try:
                self.note_fan(self.fan_reader())
            except Exception:
                pass
        if self.voice_reader is not None:
            try:
                n = int(self.voice_reader())
                if self._voice_seen is not None and n > self._voice_seen:
                    for _ in range(min(n - self._voice_seen, 10)):
                        self.note_voice_turn()
                self._voice_seen = n
            except Exception:
                pass
        eng, t = self.engine, self.teachers
        if eng is None or t is None or self.mode != "hardware":
            return
        hint = t.hint()
        eng.teacher_hint = hint
        active = eng.recal.active_source
        if hint["away"] and active is None:
            eng.recalibrate_from("teachers")
        elif not hint["away"] and active == "teachers":
            eng.recalibrate_from(None)

    def belief(self) -> Optional[dict]:
        """The zone belief (belief.py contract), or None before anything runs."""
        eng = self.engine
        if eng is None:
            return None
        return eng.latest_frame().get("belief")

    def _stop_source(self) -> None:
        with self._lock:
            if getattr(self, "teacher", None) is not None and self.teacher.session is not None:
                self.teacher.stop()             # close the labels before the stream goes
            self._stop.set()
            if self.source is not None:
                try:
                    self.source.stop()
                except Exception:
                    pass
            if self._thread is not None:
                self._thread.join(timeout=2)
            self.source, self._thread = None, None
            if self.stream is not None:     # after the consumer: every packet is queued
                if self.engine is not None:
                    self.engine.tap = None
                self.stream.stop()
                self.stream = None

    # ------------------------------------------------------------ raw stream
    def _start_stream(self, kind: str) -> None:
        """Record the rolling raw stream for the real board only (stream.py)."""
        from . import stream as raw_stream
        self.stream_error = None
        if kind != "hardware" or not raw_stream.enabled():
            return
        try:
            self.stream = raw_stream.StreamRecorder(Path(DATA_DIR) / "stream").start()
            self.engine.tap = self.stream
        except Exception as e:                  # no recorder is no reason to lose the board
            self.stream, self.stream_error = None, f"{type(e).__name__}: {e}"

    def stream_info(self) -> dict:
        """The raw-stream recorder: on, today's MB, days kept, drops (stream.py)."""
        from . import stream as raw_stream
        on = raw_stream.enabled()
        rec = self.stream
        if rec is not None:
            return {"enabled": on, **rec.info()}
        at, u = self._stream_usage
        if time.monotonic() - at > 10.0:        # info() runs at 1 Hz; the disk changes slowly
            u = raw_stream.usage(Path(DATA_DIR) / "stream")
            self._stream_usage = (time.monotonic(), u)
        if not on:
            why = "off (AANKHEN_STREAM=0)"
        elif self.stream_error:
            why = f"failed to start: {self.stream_error}"
        elif self.running and self.mode != "hardware":
            why = f"not recording: {self.mode} is never recorded, only the real board"
        else:
            why = "not recording: no board running"
        return {"enabled": on, "on": False, "today_mb": u.get("today_mb", 0.0),
                "total_mb": u.get("total_mb", 0.0), "days_kept": u.get("days", 0),
                "keep_days": raw_stream.KEEP_DAYS, "drops": 0, "note": why}

    @property
    def running(self) -> bool:
        return self.source is not None

    # ------------------------------------------------------------ boards
    def _finder(self):
        return self.boards if self.boards is not None else default_finder()

    def _find_board(self, force: bool = False) -> Optional[str]:
        if self.boards is not None:
            return self.boards.find(force=force)
        return find_esp32_port(force=force)         # the process-wide finder

    def boards_scan(self, force: bool = False) -> list:
        """Every USB serial port with what it said (boards.ProbeResult)."""
        return self._finder().scan(force=force)

    def boards_seen(self) -> list:
        """What the ports said at the last look, without looking again (no port opened)."""
        return self._finder().results()

    # ------------------------------------------------------------ the port, lent out
    def lend_port(self, port: str, reason: str) -> dict:
        """Free the board's serial port for something else (the app's firmware flasher)
        and keep it free until return_port(loan): the serial source stops if one is
        running (it may hold the port, or open it any second), start() refuses while
        `hold` is set, and the finder never probes the port meanwhile. A Windows COM
        port has one owner at a time, so an upload needs all three."""
        self.hold = reason                      # first: no start() can slip in after the stop
        info = self.info()
        stopped = isinstance(self.source, SerialSource)
        if stopped:
            self.stop()                         # the source and the hot-plug watcher
        loan = {"port": port, "claim": _PortLoan(reason), "stopped": stopped,
                "requested_mode": info.get("requested_mode"), "scenario": info.get("scenario"),
                "was_port": info.get("port")}
        self._finder().claim(port, loan["claim"])
        return loan

    def return_port(self, loan: dict) -> Optional[dict]:
        """Undo lend_port(). What the port said before is forgotten (the board behind it
        has restarted into new firmware), and the serial source lend_port() stopped is
        started again ON THAT PORT: right after an upload the board is still rebooting,
        and an explicit port waits for it where "auto" would fall back to the simulator."""
        finder = self._finder()
        finder.release(loan["port"], loan["claim"])
        finder.forget(loan["port"])
        self.hold = None
        if not loan["stopped"]:
            return None
        return self.start(loan.get("requested_mode") or "auto", scenario=loan.get("scenario") or "evening",
                          port=loan["port"])

    def _no_board_message(self) -> str:
        """Why no board, from what the ports said at the last look (no new probing)."""
        others = [r for r in self._finder().results() if not r.is_board]
        msg = "No ESP32 found on USB: no port sent an Aankhen frame."
        if others:
            msg += " " + "; ".join(f"{r.device} ({r.port.chip if r.port and r.port.chip else 'USB serial'}) "
                                   f"{r.detail}" for r in others[:3]) + "."
            msg += (" That is an Arduino, an ESP32 without the Aankhen firmware, or a board"
                    " still starting up.")
        return msg + (" Plug the board in with a data cable (charge-only cables look identical),"
                      " flash aankhen/firmware, then press ESP32 again.")

    def _on_link(self, msg: str) -> None:
        self.link_note = msg

    def board_info(self) -> dict:
        """What the live link really shows: the handshake, and when the radar last
        sent a frame (host clock). Cheap; no probing."""
        src = self.source
        out: dict = {"source": getattr(src, "kind", None)}
        if isinstance(src, SerialSource):
            since = src.stats.seconds_since_data()
            out.update(port=src.port, handshake=src.connected.is_set(), handshake_at=src.handshake_at,
                       fw=src.fw, note=self.link_note,
                       last_byte_s=round(since, 2) if since != float("inf") else None)
        eng = self.engine
        if eng is not None:
            with eng.lock:
                last = eng.last_host.get("radar")
                out["radar"] = {"frames": eng.counters.get("radar_frames", 0),
                                "last_s": round(eng.clock() - last, 2) if last is not None else None,
                                "hz": round(eng.radar_rate_hz(), 1)}
        return out

    # ------------------------------------------------------------ hot-plug
    def enable_hotplug(self, on_event, interval_s: float = HOTPLUG_INTERVAL_S) -> None:
        """Watch for boards plugged in while the hub runs. on_event(kind, text, **data)
        hears "source" when the hub switches to the board, "board" when a board is
        found but a person's choice (a simulation scenario) is kept."""
        self._hotplug_cb = on_event
        self._hotplug_interval = interval_s
        if self.running:
            self._ensure_hotplug()

    def hotplug_info(self) -> dict:
        t = self._hotplug_thread
        return {"enabled": self._hotplug_cb is not None, "watching": bool(t and t.is_alive()),
                "interval_s": self._hotplug_interval, "requested_mode": self.requested_mode,
                "announced": sorted(self._announced), "last": self.hotplug_last}

    def _ensure_hotplug(self) -> None:
        if self._hotplug_cb is None:
            return
        t = self._hotplug_thread
        if t is not None and t.is_alive():
            return
        self._hotplug_stop = threading.Event()
        self._hotplug_thread = threading.Thread(target=self._hotplug_loop, args=(self._hotplug_stop,),
                                                name="aankhen-hotplug", daemon=True)
        self._hotplug_thread.start()

    def _stop_hotplug(self) -> None:
        self._hotplug_stop.set()
        t = self._hotplug_thread
        if t is not None and t is not threading.current_thread():
            t.join(timeout=5)
        self._hotplug_thread = None

    def _hotplug_loop(self, stop: threading.Event) -> None:
        while not stop.is_set():
            try:
                self.hotplug_tick()
            except Exception as e:                  # a bad driver must not end the watching
                self.hotplug_last = {"t": time.time(), "action": "error", "text": str(e)}
            stop.wait(self._hotplug_interval)

    def hotplug_tick(self) -> Optional[str]:
        """One look for a board plugged in since the hub started. Returns what it did:
        "switched", "announced" or None."""
        if not self.running or self.mode in ("hardware", "replay"):
            return None                             # nothing to find, or a person's replay
        results = self.boards_scan()
        boards = [r for r in results if r.is_board and not r.in_use]
        self._announced &= {r.device for r in boards}   # unplugged: announce it again next time
        if not boards:
            return None
        board = boards[0]
        fw = f" ({board.fw})" if board.fw else ""
        with self._lock:
            if self.running and self.mode == "simulation" and self.requested_mode == "auto":
                info = self.start("auto", scenario=self.scenario or "evening")
                if info.get("mode") == "hardware":
                    text = (f"ESP32 found on {board.device}{fw}: Aankhen switched from the simulation"
                            " to live hardware")
                    self.hotplug_last = {"t": time.time(), "action": "switched", "text": text}
                    self._emit_hotplug("source", text, info=info, port=board.device, fw=board.fw)
                    return "switched"
                return None
        if board.device in self._announced:
            return None
        self._announced.add(board.device)
        what = f"the {self.scenario} simulation" if self.mode == "simulation" and self.scenario else "what you chose"
        text = (f"ESP32 found on {board.device}{fw}: still running {what}, as you chose. "
                "Press ESP32 on the Aankhen tab to use the board.")
        self.hotplug_last = {"t": time.time(), "action": "announced", "text": text}
        self._emit_hotplug("board", text, port=board.device, fw=board.fw)
        return "announced"

    def _emit_hotplug(self, kind: str, text: str, **data) -> None:
        cb = self._hotplug_cb
        if cb is None:
            return
        try:
            cb(kind, text, **data)
        except Exception:
            pass                                    # the bus's problem, never the watcher's

    def scenarios(self) -> list[str]:
        """The simulator's scenarios; with a house in room.json, also "house" (the
        family moves outside while I visit my desk) and "day" (a random ordinary day)."""
        extra = sorted(ROOM_SCENARIOS) + ["day"] if self.room.house else []
        return sorted(SCENARIOS) + extra

    def info(self) -> dict:
        src = self.source
        return {
            "running": self.running,
            "mode": self.mode,
            "kind": getattr(src, "kind", None),
            "scenario": self.scenario,
            "scenarios": self.scenarios(),
            "port": getattr(src, "port", None),
            "room": self.room.name,
            "room_measured": self.room_measured,
            "layout": self.layout,
            "requested_mode": self.requested_mode,
            "board": self.board_info(),
            "hotplug": self.hotplug_info(),
            "started_at": self.started_at,
            "baseline": (self.engine.motion.baseline.source
                         if self.engine and self.engine.motion.baseline else "none"),
            "error": self.error,
            "hold": self.hold,
            "stream": self.stream_info(),
        }

    # ------------------------------------------------------------ commands
    @property
    def can_command(self) -> bool:
        """True when a real board is attached and can take commands."""
        return isinstance(self.source, SerialSource) and self.source.connected.is_set()

    def command(self, payload: dict) -> bool:
        """Send one JSON command frame down the USB link (e.g. a relay switch).

        Returns False when no board is connected — callers treat that as "not
        delivered", never as success.
        """
        src = self.source
        if not isinstance(src, SerialSource):
            return False
        body = json.dumps(payload, separators=(",", ":")).encode("utf-8")
        self._cmd_seq = (self._cmd_seq + 1) & 0xFFFF
        frame = Frame(FrameType.COMMAND, self._cmd_seq, int(time.time() * 1e6), body)
        return src.write(frame.encode())

    def device_status(self) -> dict:
        """The board's last STATUS report (includes relay states), if any."""
        eng = self.engine
        return dict(eng.device_status) if eng is not None else {}

    # ------------------------------------------------------------ messages
    def link(self) -> dict:
        src = self.source
        if src is None:
            return {}
        st = src.decoder.stats
        return {"frames_ok": st.frames_ok, "crc_errors": st.crc_errors,
                "loss_ratio": round(st.loss_ratio(), 4), "bytes_skipped": st.bytes_skipped,
                "queue_overflows": src.queue_overflows, "port": getattr(src, "port", None)}

    def frame(self) -> Optional[dict]:
        eng = self.engine
        if eng is None:
            return None
        msg = eng.latest_frame()            # published by the consumer, read without the lock
        if self.sim is not None and eng.device_t is not None:
            t = msg["t"] - self.sim.boot_us / 1e6     # the frame's own time: truth beside its tracks
            truth = [s.to_dict() for s in self.sim.truth_at(t)]
            msg["truth"] = truth
            msg["metrics"] = _match(truth, msg["tracks"])
            msg["scenario"] = {"name": self.scenario, "t": round(t, 1),
                               "period_s": self.sim.scenario.period_s}
        return msg

    def heatmap(self, layer: str = "live") -> Optional[dict]:
        return self.engine.heatmap_message(layer) if self.engine else None

    def eyes(self) -> Optional[dict]:
        """The channel as a picture (engine.eyes_message): ripples and rhythm. Each
        call consumes the columns built since the last, so only the streamer calls it."""
        eng = self.engine
        return eng.eyes_message() if eng is not None else None

    def status(self) -> Optional[dict]:
        if self.engine is None:
            return {"type": "status", "source": "unknown", "sensors": {}, "link": {},
                    "room_measured": self.room_measured, "hub": self.info()}
        msg = self.engine.status_message(self.link())
        msg["hub"] = self.info()
        f = self.engine.latest_frame()
        msg["belief"] = f.get("belief")
        msg["honest"] = f.get("honest")
        return msg

    def room_message(self) -> dict:
        if self.engine is not None:
            return self.engine.room_message()
        return {"type": "room", "source": "unknown", "room": self.room.to_dict(),
                "room_measured": self.room_measured}

    def snapshot(self) -> dict:
        """Compact presence summary for JARVIS's brain, with where I am, what I am doing
        and how long (the learned models and the journal)."""
        snap = self.engine.snapshot() if self.engine else {"source": None, "presence": None}
        if self.engine is not None and snap.get("source") == "hardware":
            snap["journal"] = self.journal.summary()
        return snap

    def _ensure_journal(self) -> None:
        if self._journal_thread is not None and self._journal_thread.is_alive():
            return

        def loop():
            while True:
                time.sleep(1.0)
                try:
                    self._teacher_tick()
                except Exception:
                    pass
                eng = self.engine
                if eng is None or self.mode != "hardware":
                    self.journal.close()           # the segment ends when the board does
                    continue
                try:
                    f = eng.latest_frame()
                except Exception:
                    continue
                # The journal keeps what the HONEST output says: a zone only when sure,
                # "unsure" / "empty" otherwise, never "waving".
                h = f.get("honest") or {}
                zone = h.get("zone") or h.get("state")
                act = h.get("activity")
                self.journal.update(zone, act, f["motion_detail"].get("state") == "motion")

        self._journal_thread = threading.Thread(target=loop, name="aankhen-journal", daemon=True)
        self._journal_thread.start()


class _PortLoan:
    """A claim on a serial port held by something other than a SerialSource (lend_port).
    The finder shows the port as claimed, with this note, and never probes it."""

    def __init__(self, note: str):
        self.claim_note = note


def _match(truth: list[dict], tracks: list[dict], gate: float = 1.0) -> dict:
    """Pair simulated people with tracks: the live tracking error the twin draws."""
    pairs = []
    if truth and tracks:
        cost = np.array([[math.hypot(a["x"] - b["x"], a["y"] - b["y"]) for b in tracks] for a in truth])
        for i, j in zip(*linear_sum_assignment(cost)):
            if cost[i, j] <= gate:
                pairs.append({"truth": truth[i]["name"], "track": tracks[j]["id"],
                              "error_m": round(float(cost[i, j]), 3)})
    errs = [p["error_m"] for p in pairs]
    return {"pairs": pairs, "truth_n": len(truth), "tracked_n": len(tracks),
            "mean_error_m": round(float(np.mean(errs)), 3) if errs else None}
