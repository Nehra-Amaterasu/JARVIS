"""Away mode: home security for when the family is out, without cameras.

SIH 2022 DR729 "Security Management System" (AICTE) asks for security that does not
depend on CCTV and alerts residents who are away. This is that, built from what the
house already has: the family's phones on the Wi-Fi (presence.py), Aankhen's Wi-Fi
motion sensing, the relay-driven light (limbs.py) and JARVIS's voice.

    phones: nobody seen for 15 min ────────────────▶ ARMED (auto)
    app or "Jarvis, arm the house" ──▶ exit delay ─▶ ARMED (manual)
    a family phone comes back, or the app ─────────▶ DISARMED

    while ARMED, once a second:
      Aankhen frame ─▶ positive window? (a moving radar track, or Wi-Fi state "motion"
                       — vetoed while a live radar sees nobody in the room)
                    ─▶ k of the last n windows positive ─▶ CONFIRMED
          lights on (limbs) · "alert" on the bus · incident file written
          ─▶ entry delay: a family phone joining the Wi-Fi, or the app, cancels it
          ─▶ ALARM: spoken warning through JARVIS (if he is running) · "alert"
      hardware mode and no Wi-Fi CSI for 30 s ─▶ "sensor offline" (tamper)

PRIVACY is the rule this module is built around: it must not watch the family at
home. Nothing is sampled, recorded or alerted while disarmed, nor during the exit
delay (that is the family leaving). On disarm the sample buffer is dropped, and an
open incident's trace stops at the moment of disarming.

HONESTY: every alert raised from the simulator or a replay says SIMULATED / REPLAY,
in the text, in the event and in the incident file; while armed on a simulation the
app says the real house is not being watched. The spoken warning mentions an action
only when that action's receipt confirms it (the light only if the relay command was
delivered); nothing claims the owners were notified, because nothing can reach their
phones yet.

Why delays: a real alarm panel has an exit delay (time to leave after arming) and an
entry delay (time to disarm on return). The entry delay matters more here than on a
panel: a returning phone can take tens of seconds to rejoin the Wi-Fi, and without
the delay every homecoming would sound the alarm. The light comes on at once anyway
— harmless if it is you, a deterrent if it is not.
"""
from __future__ import annotations

import json
import math
import re
import threading
import time
from collections import deque
from dataclasses import dataclass, field, fields
from pathlib import Path
from typing import Callable, Optional

from .presence import MAX_PHONES, Phone, PresenceChecker

DEFAULT_WARNING = ("Warning. This house is armed and movement has been detected inside. "
                   "It has been logged.")

LIMITS = [
    "Motion only: someone standing or sitting still is often missed.",
    "No identity: it cannot tell an intruder from a pet, domestic help, or a family "
    "member without a listed phone.",
    "Auto-arm assumes everyone in the house carries a listed phone. If someone at home "
    "has none (grandparents, children, help), keep auto-arm off and arm by hand.",
    "Covers only where Aankhen's Wi-Fi link and radar reach — one room, not the house.",
    "Without the radar, movement just outside the room near the router (a corridor, a "
    "neighbour) can set it off; with the radar, Wi-Fi motion counts only if the radar "
    "sees someone in the room.",
    "Alerts reach this PC only (the screen and JARVIS's voice). Your phone is not "
    "notified until remote access is set up.",
]


# ====================================================================== config
@dataclass
class AwayConfig:
    phones: list[Phone] = field(default_factory=list)
    auto_arm: bool = True
    away_after_min: float = 15.0      # no phone seen this long -> everyone is away
    return_gap_s: float = 120.0       # unseen this long while armed, then seen = came home
    exit_delay_s: float = 60.0        # manual arming: time to leave before watching starts
    entry_delay_s: float = 30.0       # confirmed motion -> this long to cancel before the alarm
    confirm_k: int = 4                # k of the last n one-second windows must be positive
    confirm_n: int = 8
    clear_after_s: float = 30.0       # no motion this long closes an incident
    tamper_after_s: float = 30.0      # hardware mode, no CSI this long -> sensor offline
    check_every_s: float = 30.0       # phone checks (every 3 s during an entry delay)
    ping: bool = True
    warning: str = DEFAULT_WARNING

    RANGES = {"away_after_min": (1, 240), "return_gap_s": (30, 3600), "exit_delay_s": (0, 600),
              "entry_delay_s": (0, 300), "confirm_k": (1, 30), "confirm_n": (1, 30),
              "clear_after_s": (5, 600), "tamper_after_s": (10, 600), "check_every_s": (5, 600)}

    @classmethod
    def from_dict(cls, d: dict) -> "AwayConfig":
        """Validated config; raises ValueError with a sentence a person can act on."""
        if not isinstance(d, dict):
            raise ValueError("config must be an object")
        cfg = cls()
        names = {f.name for f in fields(cls)}
        for k, v in d.items():
            if k not in names:
                continue                                  # unknown keys are ignored
            if k == "phones":
                if not isinstance(v, list):
                    raise ValueError("phones must be a list")
                if len(v) > MAX_PHONES:
                    raise ValueError(f"at most {MAX_PHONES} phones")
                phones = [Phone.parse(p if isinstance(p, dict) else {}) for p in v]
                keys = [p.key for p in phones]
                if len(set(keys)) != len(keys):
                    raise ValueError("the same phone is listed twice")
                cfg.phones = phones
            elif k in ("auto_arm", "ping"):
                setattr(cfg, k, bool(v))
            elif k == "warning":
                text = re.sub(r"\s+", " ", str(v or "")).strip()
                if not 5 <= len(text) <= 300:
                    raise ValueError("the spoken warning must be 5-300 characters")
                cfg.warning = text
            else:
                lo, hi = cls.RANGES[k]
                try:
                    x = float(v)
                except (TypeError, ValueError):
                    raise ValueError(f"{k} must be a number") from None
                if not (math.isfinite(x) and lo <= x <= hi):
                    raise ValueError(f"{k} must be between {lo} and {hi}")
                setattr(cfg, k, int(x) if k.startswith("confirm_") else x)
        if cfg.confirm_k > cfg.confirm_n:
            raise ValueError("confirm_k cannot be larger than confirm_n")
        return cfg

    def to_dict(self) -> dict:
        d = {f.name: getattr(self, f.name) for f in fields(self)}
        d["phones"] = [p.to_dict() for p in self.phones]
        return d


def _atomic_write(path: Path, data) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(json.dumps(data, indent=1, ensure_ascii=False), encoding="utf-8")
    tmp.replace(path)


def load_config(root: Path) -> tuple[AwayConfig, Optional[str]]:
    """(config, problem). A missing file is the defaults; a damaged one is the
    defaults plus a note, never a crash — and never auto-arming on a guess (the
    defaults list no phones)."""
    path = root / "config.json"
    try:
        return AwayConfig.from_dict(json.loads(path.read_text(encoding="utf-8"))), None
    except FileNotFoundError:
        return AwayConfig(), None
    except (ValueError, TypeError) as e:
        return AwayConfig(), f"{path.name} could not be used ({e}); using defaults"


def save_config(root: Path, cfg: AwayConfig) -> None:
    _atomic_write(root / "config.json", cfg.to_dict())


# ====================================================================== samples
@dataclass
class Sample:
    """One second of Aankhen, reduced to what the alarm needs."""
    t: float
    source: Optional[str]            # hardware | simulation | replay | None (Aankhen off)
    wifi: Optional[str] = None       # motion | recent | quiet | uncalibrated
    score: Optional[float] = None    # x empty-room level
    threshold: Optional[float] = None
    moving: int = 0                  # radar tracks that are moving
    still: int = 0
    presence: Optional[str] = None   # Aankhen's fused state
    settling: bool = False           # Wi-Fi ignored (fan switched, channel changed)
    csi_age_s: Optional[float] = None
    hardware: bool = False           # the hub is in hardware mode
    radar_live: bool = False         # an LD2450 is in the layout and sending frames

    @property
    def positive(self) -> bool:
        """A window counts when the radar has a moving track, or when Wi-Fi itself
        says "motion" (not the 'recent' hold after it) outside a settling period.

        RADAR VETO: Wi-Fi motion alone does not count while a live radar sees nobody
        in the room. The Wi-Fi link runs from the router, often outside the room, so
        it also sees the corridor: in the simulator's hallway scenario (room empty, a
        neighbour pacing by the router) Wi-Fi said "motion" for 272 of 297 s on each
        of 3 seeds while the live radar had no track at all, and the alarm fired.
        The radar sees only the room. Without a radar there is no witness, so Wi-Fi
        motion counts on its own — that house will hear its corridor."""
        if self.moving > 0:
            return True
        wifi = self.wifi == "motion" and not self.settling
        return wifi and (not self.radar_live or self.still > 0)

    def row(self, t0: float) -> dict:
        return {"t": round(self.t - t0, 1), "wifi": self.wifi,
                "score": None if self.score is None else round(float(self.score), 2),
                "thr": None if self.threshold is None else round(float(self.threshold), 2),
                "moving": self.moving, "still": self.still, "radar": self.radar_live,
                "presence": self.presence, "pos": self.positive}


def sample_from_hub(hub, now: float) -> Sample:
    """Read the Aankhen hub (aankhen/hub.py) the way the alarm needs it."""
    eng = getattr(hub, "engine", None)
    if eng is None or not getattr(hub, "running", False):
        return Sample(now, None)
    f = eng.frame_message()
    md = f.get("motion_detail") or {}
    tracks = f.get("tracks") or []
    pres = f.get("presence") or {}
    last = (getattr(eng, "last_host", None) or {}).get("csi")
    if last is not None:
        age = max(0.0, eng.clock() - last)
    elif getattr(hub, "started_at", None):
        age = max(0.0, now - hub.started_at)          # nothing at all since the start
    else:
        age = None
    return Sample(now, f.get("source"), md.get("state"), md.get("score"), md.get("threshold"),
                  sum(1 for t in tracks if not t.get("still")), sum(1 for t in tracks if t.get("still")),
                  pres.get("state"), bool(md.get("settling")), age,
                  getattr(hub, "mode", None) == "hardware",
                  # fusion counts people from the radar exactly when the radar is live
                  pres.get("count_source") == "radar")


class KofN:
    """Confirmed when at least k of the last n windows were positive: one noisy
    second never sounds an alarm, a person moving for a few seconds does."""

    def __init__(self, k: int, n: int):
        self.k, self.n = k, n
        self.w: deque = deque(maxlen=n)

    def push(self, positive: bool) -> bool:
        self.w.append(bool(positive))
        return sum(self.w) >= self.k

    @property
    def count(self) -> int:
        return sum(self.w)

    def reset(self) -> None:
        self.w.clear()


def label_for(source: Optional[str]) -> Optional[str]:
    return {"simulation": "SIMULATED", "replay": "REPLAY"}.get(source or "")


# ====================================================================== incidents
_ID = re.compile(r"^\d{8}-\d{6}(-\d{1,3})?$")


class IncidentStore:
    """One JSON file per incident in <data>/security/incidents, written when the
    incident opens (so a crash cannot lose it) and rewritten as it changes."""

    def __init__(self, root: Path):
        self.dir = root / "incidents"

    def new_id(self, t: float) -> str:
        base = time.strftime("%Y%m%d-%H%M%S", time.localtime(t))
        i, cand = 1, base
        while (self.dir / f"{cand}.json").exists():
            i += 1
            cand = f"{base}-{i}"
        return cand

    def save(self, inc: dict) -> bool:
        try:
            _atomic_write(self.dir / f"{inc['id']}.json", {k: v for k, v in inc.items() if not k.startswith("_")})
            return True
        except OSError:
            return False

    def get(self, incident_id: str) -> Optional[dict]:
        if not _ID.match(incident_id or ""):
            return None
        try:
            return json.loads((self.dir / f"{incident_id}.json").read_text(encoding="utf-8"))
        except (FileNotFoundError, ValueError):
            return None

    def list(self, limit: int = 10) -> list[dict]:
        if not self.dir.exists():
            return []
        out = []
        for p in sorted(self.dir.glob("*.json"), reverse=True)[:max(1, min(limit, 100))]:
            try:
                d = json.loads(p.read_text(encoding="utf-8"))
            except ValueError:
                continue
            d["trace_n"] = len(d.pop("trace", []) or [])
            out.append(d)
        return out


# ====================================================================== actions
class Actions:
    """What away mode can do to the world. Every action returns a receipt
    {"done": bool | None, "detail": str}; nothing is claimed without one.
    This base does nothing (tests and a dry run); routes_security wires the app's."""

    def lights_on(self) -> dict:
        return {"done": False, "detail": "no lights wired"}

    def speak(self, text: str) -> dict:
        return {"done": False, "detail": "no voice wired"}

    def publish(self, kind: str, text: str, **data) -> None:
        pass


# ====================================================================== the mode
class AwayMode:
    PRE_S = 30.0          # the trace keeps this much before confirmation …
    POST_S = 30.0         # … and this much after it: the minute around the alarm
    FAST_CHECK_S = 3.0    # phone checks during an entry delay

    def __init__(self, cfg: AwayConfig, checker: PresenceChecker, actions: Actions,
                 store: IncidentStore, state_file: Path, clock: Callable[[], float] = time.time):
        self.cfg, self.checker, self.actions, self.store = cfg, checker, actions, store
        self.state_file, self.clock = state_file, clock
        self._lock = threading.RLock()
        self.armed = False
        self.armed_by: Optional[str] = None
        self.armed_at: Optional[float] = None
        self.watch_from: Optional[float] = None
        self.disarmed_at: Optional[float] = None
        self.disarmed_by: Optional[str] = None
        self.auto_paused = False
        self.restored = False
        self.kofn = KofN(cfg.confirm_k, cfg.confirm_n)
        self._pre: deque = deque()
        self.incident: Optional[dict] = None       # open motion incident
        self.tamper: Optional[dict] = None         # open sensor-offline incident
        self._absent: set[str] = set()             # phones away since arming (their sighting = home)
        self._source_seen: Optional[str] = "unset"  # what Aankhen was last watching with
        self.last_source: Optional[str] = None
        self._restore()

    # ------------------------------------------------------------ persistence
    def _save_state(self) -> None:
        try:
            _atomic_write(self.state_file, {"armed": self.armed, "armed_by": self.armed_by,
                                            "armed_at": self.armed_at, "auto_paused": self.auto_paused,
                                            "disarmed_at": self.disarmed_at})
        except OSError:
            pass

    def _restore(self) -> None:
        """A power cut must not disarm the house: an armed state survives a restart.
        Watching resumes at once (the house was empty when it was armed); what
        happened while JARVIS was off was not seen, and the app says so."""
        try:
            st = json.loads(self.state_file.read_text(encoding="utf-8"))
        except (FileNotFoundError, ValueError):
            return
        self.auto_paused = bool(st.get("auto_paused"))
        self.disarmed_at = st.get("disarmed_at")
        if st.get("armed") and st.get("armed_by") in ("app", "voice", "auto"):
            now = self.clock()
            self.armed, self.armed_by = True, st["armed_by"]
            self.armed_at = float(st.get("armed_at") or now)
            self.watch_from = now
            self._absent = {p.key for p in self.cfg.phones} if self.armed_by == "auto" else set()
            self.restored = True

    # ------------------------------------------------------------ config
    def apply_config(self, cfg: AwayConfig) -> None:
        with self._lock:
            self.cfg = cfg
            self.checker.set_phones(cfg.phones)
            self.checker.ping = cfg.ping
            if (cfg.confirm_k, cfg.confirm_n) != (self.kofn.k, self.kofn.n):
                self.kofn = KofN(cfg.confirm_k, cfg.confirm_n)

    # ------------------------------------------------------------ arming
    def arm(self, by: str, now: Optional[float] = None) -> dict:
        if by not in ("app", "voice", "auto"):
            raise ValueError("by must be app, voice or auto")
        now = self.clock() if now is None else now
        with self._lock:
            if self.armed:
                return self.status(now)
            self.armed, self.armed_by, self.armed_at = True, by, now
            # Arming by hand means someone is still inside and about to leave: give
            # them the exit delay. Auto-arming happens 15 min after the last phone left.
            self.watch_from = now if by == "auto" else now + self.cfg.exit_delay_s
            self._absent = {p.key for p in self.cfg.phones} if by == "auto" else set()
            self.kofn.reset()
            self._pre.clear()
            self._source_seen = "unset"
            self.auto_paused = False
            self.restored = False
            self._save_state()
            if by == "auto":
                text = f"Away mode armed automatically: no family phone seen for {self.cfg.away_after_min:g} min"
            else:
                how = "from the app" if by == "app" else "by voice"
                text = (f"Away mode armed {how}: watching starts in {self.cfg.exit_delay_s:g} s"
                        if self.cfg.exit_delay_s else f"Away mode armed {how}")
            self.actions.publish("armed", text, by=by, watch_from=self.watch_from)
            return self.status(now)

    def disarm(self, by: str, now: Optional[float] = None, who: Optional[str] = None) -> dict:
        if by not in ("app", "phone"):
            raise ValueError("by must be app or phone")
        now = self.clock() if now is None else now
        with self._lock:
            if not self.armed:
                return self.status(now)
            if by == "phone":
                reason, ended, text = (f"{who}'s phone came home", f"disarmed: {who}'s phone came home",
                                       f"Away mode disarmed: {who}'s phone came home")
            else:
                reason = ended = "disarmed from the app"
                text = "Away mode disarmed from the app"
            if self.incident is not None:
                pending = self.incident["stage"] == "pending"
                self._close_incident(now, f"cancelled during the entry delay: {reason}" if pending else ended)
            if self.tamper is not None:
                self._close_tamper(now, ended)
            self.armed, self.armed_by, self.armed_at, self.watch_from = False, None, None, None
            self.kofn.reset()
            self._pre.clear()                       # nothing from the armed period stays in memory
            self._absent.clear()
            self.disarmed_at, self.disarmed_by = now, by
            self.restored = False
            # Disarmed by hand while no listed phone is home: someone without a listed
            # phone is in the house. Re-arming 15 min later would arm around them, so
            # auto-arm waits until a family phone is seen again.
            if by == "app" and not self._phones_home(now):
                self.auto_paused = True
            self._save_state()
            self.actions.publish("disarmed", text, by=by, who=who)
            return self.status(now)

    def _phones_home(self, now: float) -> list[str]:
        win = self.cfg.away_after_min * 60
        return [p.name for p in self.cfg.phones if self.checker.seen_within(p.key, win, now)]

    def auto_arm_ready(self, now: float) -> tuple[bool, str, Optional[float]]:
        """(ready, why not / why, seconds until it would arm)."""
        cfg, chk = self.cfg, self.checker
        if not cfg.auto_arm:
            return False, "auto-arm is off", None
        if not cfg.phones:
            return False, "no family phones are listed", None
        if self.auto_paused:
            return False, ("paused: it was disarmed by hand while no listed phone was home; "
                           "it resumes once a family phone is seen"), None
        r = chk.last
        if r is None:
            return False, "the first phone check has not run yet", None
        if not r.ok:
            return False, f"the phone check is failing ({r.error})", None
        if now - r.at > 3 * cfg.check_every_s + 10:
            return False, "the phone check is out of date", None
        if not chk.all_verified():
            never = [s.phone.name for s in chk.states.values() if s.last_seen is None]
            return False, ("waiting to see every listed phone once since JARVIS started "
                           f"(not yet: {', '.join(never)})"), None
        latest = max([s.last_seen for s in chk.states.values()] + [self.disarmed_at or 0.0])
        left = cfg.away_after_min * 60 - (now - latest)
        if left > 0:
            return False, "a family phone was seen recently", left
        return True, f"no family phone seen for {cfg.away_after_min:g} min", 0.0

    def on_presence(self, now: Optional[float] = None) -> None:
        """After each phone check: arm when everyone has gone, disarm when someone is back."""
        now = self.clock() if now is None else now
        with self._lock:
            states = self.checker.states
            if self.armed:
                back = [s for k, s in states.items() if s.seen_in_last_check and k in self._absent]
                if back:
                    self.disarm("phone", now, who=back[0].phone.name)
                    return
                # A phone unseen for return_gap_s SINCE ARMING has really gone; its next
                # sighting is a homecoming. (Measured from arming, so a phone that was
                # dozing at home when it was armed by hand does not count as returning.)
                for k, s in states.items():
                    ref = max(s.last_seen or float("-inf"), self.armed_at or now)
                    if not s.seen_in_last_check and now - ref >= self.cfg.return_gap_s:
                        self._absent.add(k)
                return
            if any(s.seen_in_last_check for s in states.values()):
                self.auto_paused = False
            ready, _, _ = self.auto_arm_ready(now)
            if ready:
                self.arm("auto", now)

    def check_interval(self) -> Optional[float]:
        """How often the phones should be checked now; None = not at all. Disarmed
        with auto-arm off, nothing needs to know who is home, so nothing looks."""
        if not self.cfg.phones:
            return None
        if self.incident is not None and self.incident["stage"] == "pending":
            return self.FAST_CHECK_S
        if self.armed or self.cfg.auto_arm:
            return self.cfg.check_every_s
        return None

    def watching(self, now: float) -> bool:
        return self.armed and self.watch_from is not None and now >= self.watch_from

    # ------------------------------------------------------------ samples
    def on_sample(self, s: Sample, now: Optional[float] = None) -> None:
        now = self.clock() if now is None else now
        with self._lock:
            if not self.watching(now):
                return                              # disarmed or exit delay: look at nothing
            self.last_source = s.source
            self._note_source(s)
            self._check_tamper(s, now)
            if s.source is None:
                return
            if self.incident is not None:
                inc = self.incident
                if now - inc["confirmed_at"] <= self.POST_S:
                    inc["trace"].append(s.row(inc["confirmed_at"]))
                if s.positive:
                    inc["_last_motion"] = now
                # Only a sounded alarm can end by itself. During the entry delay the
                # only ways out are a family phone, the app, or the alarm: an intruder
                # who stands still after being confirmed must not cancel it.
                if inc["stage"] == "alarm" and now - inc["_last_motion"] >= self.cfg.clear_after_s:
                    self._close_incident(now, "motion stopped")
                return
            self._pre.append(s)
            while self._pre and now - self._pre[0].t > self.PRE_S:
                self._pre.popleft()
            if self.kofn.push(s.positive):
                self._open_incident(s, now)

    def tick(self, now: Optional[float] = None) -> None:
        """Timers: the entry delay running out sounds the alarm."""
        now = self.clock() if now is None else now
        with self._lock:
            inc = self.incident
            if inc is not None and inc["stage"] == "pending" and now - inc["confirmed_at"] >= self.cfg.entry_delay_s:
                self._sound_alarm(now)

    def _note_source(self, s: Sample) -> None:
        """Say once what the house is being watched WITH, whenever that changes."""
        if s.source == self._source_seen:
            return
        self._source_seen = s.source
        if s.source is None:
            self._alert("warning", "Armed, but Aankhen is not running: nothing is being watched.", None)
        elif s.source != "hardware":
            self._alert("warning", "Armed, but Aankhen is running a "
                        + ("simulation" if s.source == "simulation" else "replay")
                        + ": the real house is not being watched.", label_for(s.source))
        else:
            self.actions.publish("watching", "Away mode is watching the house through Aankhen's sensors",
                                 source=s.source)

    def _alert(self, level: str, text: str, label: Optional[str], **data) -> None:
        shown = f"{label} — {text}" if label else text
        self.actions.publish("alert", shown, level=level, label=label, sim=label is not None, **data)

    # ------------------------------------------------------------ incidents
    def _open_incident(self, s: Sample, now: float) -> None:
        label = label_for(s.source)
        positives = [x for x in list(self._pre)[-self.kofn.n:] if x.positive]
        started = positives[0].t if positives else now
        stage = "pending" if self.cfg.entry_delay_s > 0 else "alarm"
        inc = {
            "id": self.store.new_id(now), "kind": "motion",
            "started_at": started, "confirmed_at": now, "ended_at": None, "duration_s": None,
            "source": s.source, "simulated": s.source != "hardware", "label": label,
            "stage": stage, "armed_by": self.armed_by,
            "confirm": {"k": self.kofn.k, "n": self.kofn.n, "positive": self.kofn.count},
            "phones": [{"name": p["name"], "seen_ago_s": p["seen_ago_s"]}
                       for p in self.checker.snapshot(now, self.cfg.away_after_min * 60)],
            "actions": {}, "outcome": None,
            "trace": [x.row(now) for x in self._pre],
            "_last_motion": now,
        }
        self.kofn.reset()
        self._pre.clear()
        self.incident = inc
        inc["actions"]["lights"] = self.actions.lights_on()
        inc["saved"] = self.store.save(inc)
        if stage == "pending":
            self._alert("pending", f"Motion confirmed inside while armed ({inc['confirm']['positive']} of the "
                        f"last {self.kofn.n} s). Alarm in {self.cfg.entry_delay_s:g} s unless a family "
                        "phone comes home or it is disarmed.", label, incident=inc["id"])
        else:
            self._sound_alarm(now)

    def _sound_alarm(self, now: float) -> None:
        inc = self.incident
        inc["stage"] = "alarm"
        inc["alarm_at"] = now
        lights = inc["actions"].get("lights") or {}
        words = [self.cfg.warning]
        if lights.get("done"):
            words.append("The lights are on.")
        line = " ".join(words)
        if inc["label"]:
            line = f"{inc['label'].capitalize()} alert. {line}"
        inc["actions"]["speech"] = {**self.actions.speak(line), "text": line}
        inc["saved"] = self.store.save(inc)
        lit = "lights on" if lights.get("done") else "lights NOT confirmed"
        said = "warning spoken" if inc["actions"]["speech"].get("done") else "nothing spoken"
        self._alert("alarm", f"ALARM: motion inside while armed — {lit}, {said}, logged as {inc['id']}.",
                    inc["label"], incident=inc["id"])

    def _close_incident(self, now: float, outcome: str) -> None:
        inc = self.incident
        self.incident = None
        inc["ended_at"] = now
        inc["duration_s"] = round(max(0.0, inc.pop("_last_motion") - inc["started_at"]), 1)
        inc["outcome"] = outcome
        inc["saved"] = self.store.save(inc)
        text = f"Incident {inc['id']} closed: {outcome} ({inc['duration_s']:g} s of motion)"
        self.actions.publish("incident", f"{inc['label']} — {text}" if inc["label"] else text,
                             incident=inc["id"], outcome=outcome, sim=bool(inc["label"]))

    # ------------------------------------------------------------ tamper
    def _check_tamper(self, s: Sample, now: float) -> None:
        """Hardware mode, armed, and the ESP32 has sent no Wi-Fi frames for
        tamper_after_s: unplugged, powered off, or jammed. Simulation has no tamper."""
        if not s.hardware or s.source != "hardware" or s.csi_age_s is None:
            if self.tamper is not None:
                self._close_tamper(now, "Aankhen left hardware mode")
            return
        if s.csi_age_s > self.cfg.tamper_after_s and self.tamper is None:
            t = {"id": self.store.new_id(now), "kind": "tamper", "started_at": now - s.csi_age_s,
                 "confirmed_at": now, "ended_at": None, "duration_s": None, "source": "hardware",
                 "simulated": False, "label": None, "stage": "alarm", "armed_by": self.armed_by,
                 "actions": {}, "outcome": None, "trace": []}
            self.tamper = t
            t["saved"] = self.store.save(t)
            self._alert("tamper", f"Sensor offline: no Wi-Fi frames from the ESP32 for {s.csi_age_s:.0f} s "
                        "while armed. It may have been unplugged or switched off.", None, incident=t["id"])
        elif s.csi_age_s <= self.cfg.tamper_after_s and self.tamper is not None:
            self._close_tamper(now, "frames resumed")

    def _close_tamper(self, now: float, outcome: str) -> None:
        t = self.tamper
        self.tamper = None
        t["ended_at"] = now
        t["duration_s"] = round(now - t["started_at"], 1)
        t["outcome"] = outcome
        t["saved"] = self.store.save(t)
        self.actions.publish("incident", f"Sensor offline incident {t['id']} closed: {outcome} "
                             f"after {t['duration_s']:g} s", incident=t["id"], outcome=outcome)

    # ------------------------------------------------------------ view
    def phase(self, now: float) -> str:
        if not self.armed:
            return "disarmed"
        if self.incident is not None:
            return self.incident["stage"]               # pending | alarm
        if not self.watching(now):
            return "arming"
        return "armed"

    def status(self, now: Optional[float] = None) -> dict:
        now = self.clock() if now is None else now
        with self._lock:
            cfg, chk = self.cfg, self.checker
            win = cfg.away_after_min * 60
            ready, why, arms_in = self.auto_arm_ready(now)
            inc = self.incident
            home = self._phones_home(now)
            warnings = []
            if self.armed and home:
                warnings.append(f"{len(home)} family phone(s) on the Wi-Fi now ({', '.join(home)}). If someone "
                                "is home, their movement will set off the alarm.")
            if self.armed and self.watching(now) and self.last_source not in (None, "hardware"):
                warnings.append("Aankhen is running a simulation: the real house is not being watched.")
            if self.restored:
                warnings.append("Armed state restored after a restart: nothing was watched while JARVIS was off.")
            r = chk.last
            return {
                "phase": self.phase(now),
                "armed": self.armed, "armed_by": self.armed_by, "armed_at": self.armed_at,
                "watch_from": self.watch_from,
                "exit_left_s": round(max(0.0, self.watch_from - now), 1)
                if self.armed and self.watch_from and now < self.watch_from else None,
                "entry_left_s": round(max(0.0, cfg.entry_delay_s - (now - inc["confirmed_at"])), 1)
                if inc is not None and inc["stage"] == "pending" else None,
                "disarmed_at": self.disarmed_at, "disarmed_by": self.disarmed_by,
                "auto_arm": {"enabled": cfg.auto_arm, "ready": ready, "reason": why,
                             "paused": self.auto_paused,
                             "arms_in_s": None if arms_in is None or self.armed else round(arms_in, 1)},
                "phones": chk.snapshot(now, win),
                "phones_home": home,
                "check": None if r is None else {"at": r.at, "ok": r.ok, "error": r.error, "method": r.method,
                                                  "every_s": self.check_interval()},
                "incident": None if inc is None else {k: inc[k] for k in (
                    "id", "stage", "started_at", "confirmed_at", "label", "simulated", "source", "actions")},
                "tamper": None if self.tamper is None else {k: self.tamper[k] for k in ("id", "started_at")},
                "sensor": {"source": self.last_source if self.watching(now) else None},
                "warnings": warnings,
                "limits": LIMITS,
                "now": now,
            }
