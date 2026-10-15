"""The drill runner: short, scripted, randomised, quality-checked blocks that can really
teach the ESP32 where Aman is and what he is doing. Replaces the in-app "learn my room".

    python -m aankhen drill [--minutes 26] [--zones a,b,...] [--fan both|on|off] [--seed N]

WHY (docs/research/2026-10-14-aankhen-data-protocol.md, section 3)
  The installed models learned ~5 minutes of one evening in a fixed order, one posture
  per class, with the fan always on. Anything else falls into "bed"/"waving". A drill is
  a day's session of BLOCKS in a seeded random order: each block is one (zone, activity,
  fan on/off) held for 50 s, plus two empty-room captures (fan off, fan on) that also
  give the day's empty-room reference. Days are what generalise; one drill a day.

ONE BLOCK
  JARVIS says the prompt ("Next: lie on the bed, still.") -> Aman says he is ready (Enter,
  the app's button, or a voice command the app forwards) -> "Starting in 5... go." ->
  50 s labelled -> "Done." -> he confirms: ok, redo, bad, or WHERE he actually was (the
  label is what he confirms, not what was asked). Free-teacher checks run on every block:
  keyboard/mouse counts (typing must type, still must not), packet rate, gap share, RSSI
  against the day's empty block. A failed block is queued again once, at the end.

WHERE IT RECORDS
  - The app is running (it owns the board's serial port): through the app's hub, over
    its local HTTP API (HttpBackend). The drill never opens COM9 itself then.
  - The app is not running: directly from the board (DirectBackend).
  - Inside the app (the endpoint the UI starts): HubBackend, in process.

OUTPUT  data/aankhen/drill/YYYY-MM-DD/<session>/
  raw.akr        the exact byte stream with host times (transport.Recorder format)
  labels.jsonl   one line per block attempt: t_start, t_end (host epoch), zone, activity,
                 fan, confirmed, verdict, notes, firmware, packet_rate, qc, retry_of
  session.json   the plan, seed, protocol version, firmware, summary
  data/aankhen/drill/index.jsonl   one line per session
"""
from __future__ import annotations

import json
import os
import queue
import random
import threading
import time
from dataclasses import asdict, dataclass, field
from typing import Callable, Optional

import numpy as np

from . import DATA_DIR
from .zones import ACTIVITIES, NAMES, ZONE_IDS

DRILL_DIR = os.path.join(DATA_DIR, "drill")
INDEX_FILE = os.path.join(DRILL_DIR, "index.jsonl")
PROTOCOL_VERSION = 1

BLOCK_S = 50.0
EMPTY_S = 120.0
COUNTDOWN_S = 5.0            # "Starting in 5... go." doubles as the settle, never labelled
OVERHEAD_S = 20.0            # prompt + ready + countdown + confirm, per block, for budgeting
DEFAULT_MINUTES = 26.0

# (zone, activity) pairs a drill draws from. The CORE pairs go in every fan condition.
PAIRS = [
    ("at_desk_chair", "still"), ("at_desk_chair", "typing"), ("desk_standing", "still"),
    ("beside_bed_desk_side", "moving"), ("bed_lying", "lying"), ("bed_sitting", "still"),
    ("standing_on_bed", "still"), ("beside_bed_bathroom_wall", "moving"), ("outside_bathroom", "still"),
    ("inside_bathroom", "none"), ("between_bed_and_balcony_door", "moving"), ("at_balcony_door", "still"),
    ("balcony", "none"), ("room_door", "still"), ("wardrobe", "still"),
]
CORE = [("at_desk_chair", "still"), ("at_desk_chair", "typing"), ("bed_lying", "lying"),
        ("beside_bed_desk_side", "moving")]

PLACE_PHRASE = {
    "at_desk_chair": "sit on the desk chair", "desk_standing": "stand at the desk",
    "beside_bed_desk_side": "walk slowly up and down beside the bed, in front of the desk",
    "bed_lying": "lie on the bed", "bed_sitting": "sit on the edge of the bed",
    "standing_on_bed": "stand on the bed", "beside_bed_bathroom_wall": "walk slowly beside the bed, along the bathroom wall",
    "outside_bathroom": "stand just outside the bathroom door", "inside_bathroom": "go into the bathroom and close the door",
    "between_bed_and_balcony_door": "walk slowly between the bed and the balcony door",
    "at_balcony_door": "stand at the balcony door", "balcony": "go out onto the balcony and close the door behind you",
    "room_door": "stand at the room door, inside", "wardrobe": "stand at the wardrobe",
    "out_of_room": "leave the room and close the door",
}
ACT_PHRASE = {"still": "still", "typing": "typing normally", "moving": "", "lying": "still", "none": ""}


@dataclass
class Block:
    idx: int
    zone: str
    activity: str
    fan: bool
    seconds: float = BLOCK_S
    kind: str = "zone"                 # zone | empty
    retry_of: Optional[int] = None

    def prompt(self) -> str:
        fan = "fan on" if self.fan else "fan off"
        if self.kind == "empty":
            return (f"Empty room, {fan}. Say ready, then leave the room and close the door. "
                    f"I record for {int(self.seconds)} seconds; come back when the chime sounds.")
        act = ACT_PHRASE.get(self.activity, "")
        what = PLACE_PHRASE.get(self.zone, self.zone.replace("_", " "))
        return f"Next: {what}{', ' + act if act else ''}. {fan.capitalize()}."

    def to_dict(self) -> dict:
        return asdict(self)


def plan_session(seed: int, minutes: float = DEFAULT_MINUTES, zones: Optional[list[str]] = None,
                 fan: str = "both", block_s: float = BLOCK_S, empty_s: float = EMPTY_S) -> list[Block]:
    """A day's blocks. Per fan condition: its empty capture first, then the CORE pairs plus
    as many others as the time budget allows, drawn and ordered by the seed. Which fan
    condition goes first alternates with the seed, so it is never always the same."""
    if fan not in ("both", "on", "off"):
        raise ValueError("fan must be both, on or off")
    rng = random.Random(seed)
    pairs = [p for p in PAIRS if zones is None or p[0] in zones]
    if zones is not None:
        unknown = [z for z in zones if z not in ZONE_IDS]
        if unknown:
            raise ValueError(f"unknown zone(s) {unknown}; one of {list(ZONE_IDS)}")
        if not pairs:
            raise ValueError("none of those zones has a drill block")
    conds = {"both": [False, True], "on": [True], "off": [False]}[fan]
    if fan == "both" and seed % 2:
        conds = conds[::-1]
    budget = minutes * 60.0 - len(conds) * (empty_s + OVERHEAD_S)
    per_cond = max(1, int(budget // (block_s + OVERHEAD_S)) // len(conds))
    blocks: list[Block] = []
    for fan_on in conds:
        core = [p for p in CORE if p in pairs]
        rest = [p for p in pairs if p not in core]
        rng.shuffle(rest)
        chosen = (core + rest)[:max(per_cond, 1)]
        rng.shuffle(chosen)
        blocks.append(Block(len(blocks), "out_of_room", "none", fan_on, empty_s, "empty"))
        for z, a in chosen:
            blocks.append(Block(len(blocks), z, a, fan_on, block_s))
    return blocks


def session_minutes(blocks: list[Block]) -> float:
    return sum(b.seconds + OVERHEAD_S for b in blocks) / 60.0


# ---------------------------------------------------------------- quality checks
QC_MIN_RATE = 150.0           # CSI packets/s
QC_MAX_GAP = 0.10             # share of resampler slots with no packet
QC_RSSI_DB = 6.0              # RSSI median within this of the day's empty block
QC_HBE_SHARE = 0.80           # share of seconds with a human-band reading


def quality(block: Block, samples: list[dict], inputs: dict, empty_rssi: Optional[float],
            min_rate: float = QC_MIN_RATE) -> dict:
    """The automatic checks on one block. samples: one per second from the backend
    ({csi_packets, t, fill, rssi, hbe}); inputs: the input counts over the block."""
    out: dict = {"checks": {}}
    if len(samples) >= 2:
        dt = samples[-1]["t"] - samples[0]["t"]
        dn = samples[-1]["csi_packets"] - samples[0]["csi_packets"]
        rate = dn / dt if dt > 0 else 0.0
    else:
        rate = 0.0
    fills = [s["fill"] for s in samples if s.get("fill") is not None]
    rssis = [s["rssi"] for s in samples if s.get("rssi") is not None]
    hbe = [s.get("hbe") is not None for s in samples]
    out["packet_rate"] = round(rate, 1)
    out["gap_share"] = round(1.0 - float(np.mean(fills)), 3) if fills else None
    out["rssi"] = round(float(np.median(rssis)), 1) if rssis else None
    out["hbe_share"] = round(float(np.mean(hbe)), 2) if hbe else 0.0
    out["inputs"] = dict(inputs)
    c = out["checks"]
    c["packet_rate"] = rate >= min_rate
    c["gaps"] = out["gap_share"] is not None and out["gap_share"] <= QC_MAX_GAP
    c["rssi"] = True if empty_rssi is None or out["rssi"] is None else abs(out["rssi"] - empty_rssi) <= QC_RSSI_DB
    c["hbe"] = out["hbe_share"] >= QC_HBE_SHARE
    secs = max(block.seconds, 1.0)
    if block.activity == "typing":
        c["typing"] = inputs.get("input_events", 0) / secs >= 1.0
    elif block.kind == "empty" or block.activity in ("still", "lying", "none"):
        c["no_input"] = inputs.get("keyish_events", 0) == 0 and inputs.get("mouse_moves", 0) <= 2
    out["pass"] = all(c.values())
    return out


# ---------------------------------------------------------------- backends
class Backend:
    """Where the bytes come from and where the fan is switched."""
    kind = "none"

    def start_recording(self, path: str, meta: dict) -> None: ...
    def stop_recording(self) -> None: ...
    def sample(self) -> dict: return {}
    def set_fan(self, on: bool) -> bool: return False
    def recalibrate(self, source: Optional[str]) -> None: ...
    def firmware(self) -> Optional[str]: return None
    def close(self) -> None: ...


def _sample_engine(eng, src=None) -> dict:
    f = eng.latest_frame() if eng is not None else {}
    csi = f.get("csi") or {}
    hb = (f.get("motion_detail") or {}).get("human_band")
    fan = ((f.get("motion_detail") or {}).get("fan") or {}).get("on")
    return {"t": time.time(), "csi_packets": int((eng.counters if eng else {}).get("csi_packets", 0)),
            "fill": csi.get("fill_ratio"), "rssi": csi.get("rssi"),
            "hbe": hb.get("energy") if isinstance(hb, dict) else None, "fan": fan,
            "firmware": eng.firmware() if eng is not None else None,
            "source": f.get("source")}


class HubBackend(Backend):
    """In process: the app's (or `serve`'s) hub owns the board."""
    kind = "hub"

    def __init__(self, hub, set_fan: Optional[Callable[[bool], bool]] = None):
        self.hub, self._set_fan = hub, set_fan

    def start_recording(self, path, meta):
        if self.hub.source is None:
            raise RuntimeError("Aankhen is not running: start it first")
        self.hub.source.record_to(path, meta)

    def stop_recording(self):
        if self.hub.source is not None:
            self.hub.source.stop_recording()

    def sample(self):
        return _sample_engine(self.hub.engine)

    def set_fan(self, on):
        return bool(self._set_fan(on)) if self._set_fan else False

    def recalibrate(self, source):
        if self.hub.engine is not None:
            self.hub.engine.recalibrate_from(source)

    def firmware(self):
        return self.hub.engine.firmware() if self.hub.engine is not None else None


class HttpBackend(Backend):
    """The app is running and holds COM9: everything goes through its local API
    (app/jarvis_app/routes_aankhen_drill.py)."""
    kind = "app"

    def __init__(self, base: str, token: str, timeout: float = 5.0):
        self.base, self.token, self.timeout = base.rstrip("/"), token, timeout

    def _call(self, method: str, path: str, body: Optional[dict] = None) -> dict:
        import urllib.request
        data = json.dumps(body).encode() if body is not None else None
        req = urllib.request.Request(self.base + path, data=data, method=method,
                                     headers={"content-type": "application/json", "x-jarvis-token": self.token})
        with urllib.request.urlopen(req, timeout=self.timeout) as r:
            return json.loads(r.read().decode() or "{}")

    def start_recording(self, path, meta):
        self._call("POST", "/api/aankhen/drill/record", {"action": "start", "path": path, "meta": meta})

    def stop_recording(self):
        self._call("POST", "/api/aankhen/drill/record", {"action": "stop"})

    def sample(self):
        return self._call("GET", "/api/aankhen/drill/sample")

    def set_fan(self, on):
        return bool(self._call("POST", "/api/aankhen/drill/fan", {"on": bool(on)}).get("ok"))

    def recalibrate(self, source):
        self._call("POST", "/api/aankhen/drill/recal", {"source": source})

    def firmware(self):
        return self.sample().get("firmware")


class DirectBackend(Backend):
    """No app running: open the board here, with an engine (no models) for the QC numbers."""
    kind = "board"

    def __init__(self, port: Optional[str] = None):
        from .engine import Engine, run_engine
        from .room import load_room
        from .transport import SerialSource
        room, measured = load_room()
        self.src = SerialSource(port, on_status=lambda m: print(f"  {m}"))
        self.engine = Engine(room, "hardware", measured)
        self._stop = threading.Event()
        self.src.start()
        if not self.src.connected.wait(timeout=10):
            self.src.stop()
            raise RuntimeError("No Aankhen board answered within 10 s (no valid frame on any port).")
        self._t = threading.Thread(target=run_engine, args=(self.src, self.engine, self._stop), daemon=True)
        self._t.start()

    def start_recording(self, path, meta):
        self.src.record_to(path, meta)

    def stop_recording(self):
        self.src.stop_recording()

    def sample(self):
        return _sample_engine(self.engine)

    def recalibrate(self, source):
        self.engine.recalibrate_from(source)

    def firmware(self):
        return self.engine.firmware()

    def close(self):
        self._stop.set()
        self.src.stop()


# ---------------------------------------------------------------- confirmation
@dataclass
class Answer:
    verdict: str = "ok"               # ok | redo | bad | ready | stop
    zone: Optional[str] = None        # where he actually was, when different
    activity: Optional[str] = None
    note: str = ""


def parse_answer(text: str) -> Answer:
    """What he typed or said: "" or "ok"/"yes" -> ok; "r"/"redo"; "b"/"bad"; "q"/"stop";
    "w <zone> [activity]" or "where <zone>" -> ok, with the zone he was really in."""
    t = (text or "").strip().lower()
    if t in ("", "ok", "yes", "y", "done", "ready", "go"):
        return Answer("ok")
    if t in ("r", "redo", "again"):
        return Answer("redo")
    if t in ("b", "bad", "no"):
        return Answer("bad")
    if t in ("q", "quit", "stop"):
        return Answer("stop")
    parts = t.replace(",", " ").split()
    if parts and parts[0] in ("w", "where", "i", "was"):
        rest = [p for p in parts[1:] if p not in ("was", "at", "on", "in", "the")]
        zone = rest[0] if rest else None
        act = rest[1] if len(rest) > 1 and rest[1] in ACTIVITIES else None
        if zone in ZONE_IDS:
            return Answer("ok", zone=zone, activity=act)
        return Answer("bad", note=f"unknown zone {zone!r}")
    return Answer("ok", note=t[:200])


class KeyboardConfirmer:
    """The CLI: Enter = ready / ok; r = redo; b = bad; w <zone> = I was there; q = stop."""

    def __init__(self, read: Callable[[str], str] = input):
        self.read = read

    def ready(self, block: Block) -> Answer:
        a = parse_answer(self.read("  ready? [Enter] (q to stop) > "))
        return Answer("stop") if a.verdict == "stop" else Answer("ready")

    def done(self, block: Block) -> Answer:
        return parse_answer(self.read("  done as asked? [Enter]=yes, r=redo, b=bad, w <zone>=I was there > "))


class QueueConfirmer:
    """The app: answers arrive from POST /api/aankhen/drill/confirm (a button, or a voice
    command the app forwards)."""

    def __init__(self, timeout_s: float = 600.0):
        self.q: queue.Queue = queue.Queue()
        self.timeout_s = timeout_s
        self.waiting: Optional[str] = None

    def put(self, answer: Answer) -> None:
        self.q.put(answer)

    def _get(self, what: str) -> Answer:
        self.waiting = what
        try:
            return self.q.get(timeout=self.timeout_s)
        except queue.Empty:
            return Answer("stop", note="no answer")
        finally:
            self.waiting = None

    def ready(self, block: Block) -> Answer:
        a = self._get("ready")
        return Answer("stop") if a.verdict == "stop" else Answer("ready")

    def done(self, block: Block) -> Answer:
        return self._get("done")


# ---------------------------------------------------------------- the runner
def speak_default(text: str) -> None:
    from .firstlight import say
    try:
        say(text, True)
    except Exception:
        print(f"  JARVIS: {text}\a", flush=True)


@dataclass
class DrillState:
    state: str = "idle"                # idle | running | done | stopped | error
    session: Optional[str] = None
    folder: Optional[str] = None
    block: Optional[dict] = None
    phase: Optional[str] = None        # prompt | ready | countdown | recording | confirm
    remaining_s: Optional[float] = None
    done_blocks: int = 0
    total_blocks: int = 0
    passed: int = 0
    failed: int = 0
    error: Optional[str] = None
    history: list = field(default_factory=list)


class DrillRunner:
    def __init__(self, backend: Backend, confirmer, out_root: str = DRILL_DIR,
                 speak: Callable[[str], None] = speak_default, sleep: Callable[[float], None] = time.sleep,
                 clock: Callable[[], float] = time.time, inputs=None, min_rate: float = QC_MIN_RATE,
                 manual_fan: Optional[Callable[[bool], None]] = None):
        self.backend, self.confirmer = backend, confirmer
        self.out_root, self.speak, self.sleep, self.clock = out_root, speak, sleep, clock
        self.min_rate = min_rate
        self.inputs = inputs                 # a teachers.FreeTeachers used only for its counts
        self.manual_fan = manual_fan
        self.st = DrillState()
        self._stop = threading.Event()
        self.fan_state: Optional[bool] = None

    def stop(self) -> None:
        self._stop.set()

    # ------------------------------------------------------------ helpers
    def _set_fan(self, on: bool) -> None:
        if self.fan_state == on:
            return
        ok = False
        try:
            ok = self.backend.set_fan(on)
        except Exception:
            ok = False
        if not ok:
            self.speak(f"Please switch the fan {'on' if on else 'off'} now, then say ready.")
            if self.manual_fan is not None:
                self.manual_fan(on)
            else:
                self.confirmer.ready(Block(-1, "out_of_room", "none", on))
        self.fan_state = on
        self.speak("Letting the fan settle for a moment.")
        self._wait(30.0 if ok else 10.0, None)

    def _wait(self, seconds: float, samples: Optional[list]) -> None:
        end = self.clock() + seconds
        while not self._stop.is_set():
            left = end - self.clock()
            if left <= 0:
                break
            self.st.remaining_s = round(left, 1)
            if samples is not None:
                try:
                    samples.append(self.backend.sample())
                except Exception:
                    pass
            self.sleep(min(1.0, left))
        self.st.remaining_s = None

    def _input_counts(self) -> dict:
        if self.inputs is None:
            return {}
        with self.inputs.lock:
            return dict(self.inputs.counts)

    @staticmethod
    def _diff(a: dict, b: dict) -> dict:
        return {k: b.get(k, 0) - a.get(k, 0) for k in set(a) | set(b)}

    # ------------------------------------------------------------ one session
    def run(self, blocks: list[Block], seed: int, note: str = "") -> dict:
        day = time.strftime("%Y-%m-%d", time.localtime(self.clock()))
        sid = time.strftime("%H%M%S", time.localtime(self.clock())) + f"-s{seed}"
        folder = os.path.join(self.out_root, day, sid)
        os.makedirs(folder, exist_ok=True)
        raw, labels = os.path.join(folder, "raw.akr"), os.path.join(folder, "labels.jsonl")
        fw = None
        try:
            fw = self.backend.firmware()
        except Exception:
            pass
        session = {"session": sid, "day": day, "seed": seed, "protocol": PROTOCOL_VERSION,
                   "backend": self.backend.kind, "firmware": fw, "started": self.clock(),
                   "plan": [b.to_dict() for b in blocks], "note": note}
        self._write_json(os.path.join(folder, "session.json"), session)
        self.st = DrillState("running", sid, folder, total_blocks=len(blocks))
        queue_ = list(blocks)
        retried: set[int] = set()
        empty_rssi: dict = {}
        self.backend.start_recording(raw, {"label": "drill", "session": sid, "seed": seed})
        try:
            self.speak("This is JARVIS. Drill starting. Answer each prompt when you are in place.")
            while queue_ and not self._stop.is_set():
                b = queue_.pop(0)
                self.st.block, self.st.phase = b.to_dict(), "prompt"
                self._set_fan(b.fan)
                self.speak(b.prompt())
                self.st.phase = "ready"
                if self.confirmer.ready(b).verdict == "stop":
                    break
                self.st.phase = "countdown"
                self.speak("Starting in 5... go." if b.kind != "empty" else "Leave now. Recording starts in 15 seconds.")
                self._wait(COUNTDOWN_S if b.kind != "empty" else 15.0, None)
                if self._stop.is_set():
                    break
                if b.kind == "empty":
                    self.backend.recalibrate("drill")
                self.st.phase = "recording"
                in0, samples = self._input_counts(), []
                t0 = self.clock()
                self._wait(b.seconds, samples)
                t1 = self.clock()
                if b.kind == "empty":
                    self.backend.recalibrate(None)
                ins = self._diff(in0, self._input_counts()) if self.inputs is not None else {}
                self.speak("Done." if b.kind != "empty" else "Chime. Empty room recorded. Come back in.")
                self.st.phase = "confirm"
                ans = self.confirmer.done(b)
                if ans.verdict == "stop":
                    break
                qc = quality(b, samples, ins, empty_rssi.get(b.fan), self.min_rate)
                if self.inputs is None:
                    qc["checks"].pop("typing", None)
                    qc["checks"].pop("no_input", None)
                    qc["pass"] = all(qc["checks"].values())
                zone = ans.zone or b.zone
                act = ans.activity or (b.activity if not ans.zone or ans.zone == b.zone else
                                       ("none" if ans.zone in ("inside_bathroom", "balcony", "out_of_room")
                                        else b.activity))
                good = ans.verdict == "ok" and qc["pass"]
                line = {"session": sid, "block": b.idx, "kind": b.kind, "t_start": round(t0, 3),
                        "t_end": round(t1, 3), "zone": zone, "activity": act, "asked_zone": b.zone,
                        "asked_activity": b.activity, "fan": b.fan, "confirmed": ans.verdict == "ok",
                        "verdict": "ok" if good else ("redo" if ans.verdict == "redo" else
                                                      "bad" if ans.verdict == "bad" else "qc_fail"),
                        "notes": ans.note, "firmware": fw or (samples[-1].get("firmware") if samples else None),
                        "packet_rate": qc["packet_rate"], "qc": qc, "retry_of": b.retry_of}
                with open(labels, "a", encoding="utf-8") as f:
                    f.write(json.dumps(line) + "\n")
                if b.kind == "empty" and good and qc.get("rssi") is not None:
                    empty_rssi[b.fan] = qc["rssi"]
                self.st.history.append({k: line[k] for k in ("block", "zone", "activity", "fan", "verdict")})
                self.st.done_blocks += 1
                if good:
                    self.st.passed += 1
                else:
                    self.st.failed += 1
                    if b.idx not in retried and b.retry_of is None:
                        retried.add(b.idx)
                        nb = Block(1000 + b.idx, b.zone, b.activity, b.fan, b.seconds, b.kind,
                                   retry_of=b.idx)
                        queue_.append(nb)
                        self.st.total_blocks += 1
                        why = [k for k, v in qc["checks"].items() if not v]
                        self.speak("That block goes again at the end" + (f": {', '.join(why)}." if why else "."))
            self.st.state = "stopped" if (queue_ or self._stop.is_set()) else "done"
            self.speak("Drill finished. Thank you." if self.st.state == "done" else "Drill stopped.")
        except Exception as e:
            self.st.state, self.st.error = "error", f"{type(e).__name__}: {e}"
            raise
        finally:
            try:
                self.backend.stop_recording()
            except Exception:
                pass
            try:
                self.backend.recalibrate(None)
            except Exception:
                pass
            session.update(finished=self.clock(), state=self.st.state, passed=self.st.passed,
                           failed=self.st.failed, blocks_done=self.st.done_blocks)
            self._write_json(os.path.join(folder, "session.json"), session)
            self._index(session, folder)
            self.st.phase, self.st.block = None, None
        return {"session": sid, "folder": folder, "state": self.st.state, "passed": self.st.passed,
                "failed": self.st.failed, "summary": summarize(folder)}

    def _write_json(self, path: str, d: dict) -> None:
        tmp = path + ".tmp"
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(d, f, indent=1)
        os.replace(tmp, path)

    def _index(self, session: dict, folder: str) -> None:
        os.makedirs(self.out_root, exist_ok=True)
        line = {"session": session["session"], "day": session["day"], "folder": os.path.relpath(folder, self.out_root),
                "seed": session["seed"], "firmware": session.get("firmware"), "state": session.get("state"),
                "passed": session.get("passed"), "failed": session.get("failed"), "backend": session["backend"],
                "protocol": PROTOCOL_VERSION}
        with open(os.path.join(self.out_root, "index.jsonl"), "a", encoding="utf-8") as f:
            f.write(json.dumps(line) + "\n")


# ---------------------------------------------------------------- reading sessions
def read_labels(folder: str) -> list[dict]:
    p = os.path.join(folder, "labels.jsonl")
    if not os.path.exists(p):
        return []
    out = []
    with open(p, encoding="utf-8") as f:
        for ln in f:
            ln = ln.strip()
            if ln:
                try:
                    out.append(json.loads(ln))
                except ValueError:
                    continue
    return out


def sessions(root: str = DRILL_DIR) -> list[dict]:
    """Every session folder under root with a raw.akr and labels: {day, folder, labels}."""
    out = []
    if not os.path.isdir(root):
        return out
    for day in sorted(os.listdir(root)):
        dpath = os.path.join(root, day)
        if not os.path.isdir(dpath) or len(day) != 10:
            continue
        for sid in sorted(os.listdir(dpath)):
            folder = os.path.join(dpath, sid)
            if os.path.exists(os.path.join(folder, "raw.akr")) and os.path.exists(os.path.join(folder, "labels.jsonl")):
                out.append({"day": day, "session": sid, "folder": folder, "labels": read_labels(folder)})
    return out


def summarize(folder: str) -> dict:
    """Minutes per (zone, activity, fan) that passed, and the QC pass rate."""
    labels = read_labels(folder)
    ok = [l for l in labels if l.get("verdict") == "ok"]
    per: dict = {}
    for l in ok:
        k = f"{l['zone']}/{l['activity']}/fan-{'on' if l['fan'] else 'off'}"
        per[k] = round(per.get(k, 0.0) + (l["t_end"] - l["t_start"]) / 60.0, 2)
    rates = [l["packet_rate"] for l in labels if l.get("packet_rate")]
    return {"blocks": len(labels), "passed": len(ok),
            "pass_rate": round(len(ok) / len(labels), 2) if labels else None,
            "packet_rate_median": round(float(np.median(rates)), 1) if rates else None,
            "minutes": per}


def describe_plan(blocks: list[Block]) -> str:
    lines = [f"{len(blocks)} blocks, about {session_minutes(blocks):.0f} minutes:"]
    for b in blocks:
        lines.append(f"  {b.idx + 1:2d}. fan {'on ' if b.fan else 'off'}  {b.seconds:3.0f} s  "
                     + (NAMES.get(b.zone, (b.zone,))[0] if b.kind != "empty" else "EMPTY ROOM (you leave)")
                     + (f" - {b.activity}" if b.kind != "empty" else ""))
    return "\n".join(lines)
