"""Circuits: the switchboard as data, and the rule that keeps mains loads off relays.

Until now Limbs knew one "light" and one "fan" with levels nobody measured. A real
switchboard is a list of circuits (L1..L8, a fan with speed steps, an AC, a geyser),
each with a rated wattage and a relay channel. That list is what the energy ledger
prices and what the empty-room detector watches, so it lives in one config:

    app/jarvis_app/circuits.example.json   generic example, committed
    <JARVIS_DATA_DIR>/circuits.json        the real house, git-ignored, never committed

SAFETY, IN CODE, NOT IN A COMMENT. A relay module's 7 A contacts are not rated for
an AC compressor's start or a 2 kW geyser element for hours, and a welded contact on
either is a fire that no software can switch off. So:

  * an AC, geyser or heater can NEVER be assigned to a relay, whatever the config says;
  * any other load must draw no more than 5.6 A continuous (80 % of the 7 A rating,
    the usual continuous derating), with current = watts / (230 V x power factor) and
    a conservative power factor of 0.8 unless the config gives the real one;
  * a config that declares a circuit unsafe (safe_7a: false) cannot give it a relay.

A circuit that breaks a rule at load is kept (so it is still tracked and priced) but
its relay is stripped and the reason is shown; Limbs refuses to drive a relay whose
circuit was refused. assign_relay() raises RelaySafetyError with the same reasons.

Today's two Limbs devices map onto circuits by "alias": the circuit with alias
"light" is what the ESP32's light relay carries, "fan" likewise. Only those two can
be switched until the Uno firmware drives the other channels (ROADMAP L2).
"""
from __future__ import annotations

import json
import math
import threading
from dataclasses import dataclass, field
from pathlib import Path
from typing import Optional

from .paths import DATA

EXAMPLE_FILE = Path(__file__).with_name("circuits.example.json")
USER_FILE_NAME = "circuits.json"

MAINS_V = 230.0                       # Indian nominal supply
RELAY_RATING_A = 7.0                  # the relay module's contact rating
CONTINUOUS_DERATE = 0.8               # run contacts at no more than 80 % continuously
SAFE_CURRENT_A = RELAY_RATING_A * CONTINUOUS_DERATE      # 5.6 A
DEFAULT_PF = 0.8                      # cheap LED drivers and fan motors sit near this

# Loads that never go on a relay, by kind (with the names people actually type).
NEVER_ON_RELAY = {"ac": "AC", "air_conditioner": "AC", "geyser": "geyser",
                  "water_heater": "geyser", "heater": "heater", "room_heater": "heater"}
KINDS = {"light", "fan", "socket", "tv", "fridge", "pump", "other"} | set(NEVER_ON_RELAY)
LEGACY_DEVICES = ("light", "fan")     # Limbs' devices, driven by name on the ESP32

_FIELDS = ("id", "name", "room", "kind", "rated_w", "relay", "safe_7a", "alias", "must_not_auto_off",
           "speed_steps", "watts_by_step", "power_factor", "remind_after_min", "note")


class RelaySafetyError(ValueError):
    """A load that must not be switched by a relay was assigned to one."""


@dataclass
class Circuit:
    id: str
    name: str
    room: str
    kind: str
    rated_w: float
    relay: Optional[int] = None            # relay channel, 1..relay_channels; None = tracked only
    safe_7a: Optional[bool] = None         # what the config DECLARES; verified by relay_check()
    alias: Optional[str] = None            # "light" / "fan": the Limbs device this circuit is
    must_not_auto_off: bool = False
    speed_steps: int = 0                   # fan regulator steps (0 = on/off load)
    watts_by_step: list = field(default_factory=list)
    power_factor: Optional[float] = None
    remind_after_min: Optional[float] = None   # "it has been on for N minutes" (the geyser)
    note: str = ""
    refused: Optional[str] = None          # why its relay was refused at load
    requested_relay: Optional[int] = None  # the channel the config asked for, when refused

    # -------------------------------------------------------------- electrical
    @property
    def never_on_relay(self) -> bool:
        return self.kind in NEVER_ON_RELAY

    def current_a(self) -> float:
        """Steady-state current at rated power. Conservative: a lower power factor
        means more current for the same watts."""
        pf = self.power_factor if self.power_factor and 0 < self.power_factor <= 1 else DEFAULT_PF
        return self.rated_w / (MAINS_V * pf)

    def relay_check(self) -> Optional[str]:
        """None if this load may sit on a 7 A relay, else the reason it may not."""
        amps = self.current_a()
        if self.never_on_relay:
            what = NEVER_ON_RELAY[self.kind]
            return (f"{self.id} “{self.name}” is {_a(what)} {what}: {_a(what)} {what} never goes on a "
                    f"relay ({self.rated_w:.0f} W is about {amps:.1f} A against a {RELAY_RATING_A:.0f} A relay, "
                    f"and a welded contact cannot be switched off). Leave its relay empty; JARVIS can still "
                    f"track it.")
        if amps > SAFE_CURRENT_A:
            return (f"{self.id} “{self.name}” draws about {amps:.1f} A ({self.rated_w:.0f} W at "
                    f"{MAINS_V:.0f} V); a {RELAY_RATING_A:.0f} A relay is only safe up to "
                    f"{SAFE_CURRENT_A:.1f} A continuous. It cannot go on a relay.")
        if self.safe_7a is False:
            return (f"{self.id} “{self.name}” is marked safe_7a: false in the config, so it "
                    f"cannot go on a relay.")
        return None

    @property
    def relay_safe(self) -> bool:
        return self.relay_check() is None

    # -------------------------------------------------------------- power
    def step(self, level: int) -> int:
        """The regulator step a 0-100 level falls on (1..speed_steps)."""
        if self.speed_steps <= 0:
            return 0
        return max(1, min(self.speed_steps, math.ceil(max(0, min(100, level)) / 100 * self.speed_steps)))

    def watts(self, on: bool, level=None) -> float:
        """ESTIMATED draw: on/off only. The relays switch and nothing else: no dimmer is
        wired, and a fan's speed is set on its wall regulator, which JARVIS cannot read.
        So an on load draws its rated watts (a fan's at full speed, the safe side of the
        estimate). `level` is ignored; it stays in the signature for older callers."""
        return float(self.rated_w) if on else 0.0

    def to_dict(self) -> dict:
        d = {k: getattr(self, k) for k in _FIELDS}
        d.update(refused=self.refused, requested_relay=self.requested_relay,
                 current_a=round(self.current_a(), 2), relay_safe=self.relay_safe,
                 relay_reason=self.relay_check(), never_on_relay=self.never_on_relay,
                 switchable=self.switchable)
        return d

    @property
    def switchable(self) -> bool:
        """Can JARVIS switch it today? Only the two relays the ESP32 firmware drives."""
        return self.alias in LEGACY_DEVICES and self.refused is None


def _a(word: str) -> str:
    return "an" if word[:1].lower() in "aeiou" or word == "AC" else "a"


class CircuitSet:
    """The loaded switchboard. Read-mostly; assign_relay() rewrites the user's file."""

    def __init__(self, circuits: list[Circuit], raw: dict, source: str, path: Optional[Path],
                 problems: Optional[list[dict]] = None):
        self.circuits = circuits
        self.raw = raw
        self.source = source              # "yours" | "example"
        self.path = path
        self.problems = problems or []
        self.channels = int(raw.get("relay_channels", 12))
        self.example = bool(raw.get("example")) or source == "example"
        self._lock = threading.Lock()

    # -------------------------------------------------------------- lookups
    def get(self, cid: str) -> Optional[Circuit]:
        return next((c for c in self.circuits if c.id == cid), None)

    def by_alias(self, device: str) -> Optional[Circuit]:
        return next((c for c in self.circuits if c.alias == device), None)

    def in_room(self, room: str) -> list[Circuit]:
        return [c for c in self.circuits if c.room == room]

    @property
    def tariff(self) -> dict:
        return dict(self.raw.get("tariff") or {})

    @property
    def waste(self) -> dict:
        return dict(self.raw.get("waste") or {})

    def blocked(self, device: str) -> Optional[str]:
        """Why Limbs must not drive this device's relay (its circuit was refused)."""
        c = self.by_alias(device)
        return c.refused if c is not None else None

    # -------------------------------------------------------------- assignment
    def check_assignment(self, cid: str, channel: Optional[int]) -> Circuit:
        c = self.get(cid)
        if c is None:
            raise KeyError(cid)
        if channel is None:
            return c
        if not isinstance(channel, int) or isinstance(channel, bool) or not 1 <= channel <= self.channels:
            raise RelaySafetyError(f"relay channel {channel!r} does not exist (1-{self.channels})")
        reason = c.relay_check()
        if reason:
            raise RelaySafetyError(reason)
        other = next((o for o in self.circuits if o.relay == channel and o.id != cid), None)
        if other is not None:
            raise RelaySafetyError(f"relay channel {channel} already carries {other.id} “{other.name}”")
        return c

    def assign_relay(self, cid: str, channel: Optional[int], path: Optional[Path] = None) -> Circuit:
        """Put a circuit on a relay channel (or take it off with None) and save the
        user's config. Refuses unsafe loads with RelaySafetyError; nothing is saved then."""
        with self._lock:
            c = self.check_assignment(cid, channel)
            c.relay, c.refused, c.requested_relay = channel, None, None
            if channel is not None:
                c.safe_7a = True if c.safe_7a is None else c.safe_7a
            for d in self.raw.get("circuits", []):
                if d.get("id") == cid:
                    d["relay"] = channel
            target = path or self.path or (DATA / USER_FILE_NAME)
            raw = dict(self.raw)
            if self.source == "example":
                raw["from_example"] = True
            _atomic_write(target, raw)
            self.path, self.source = target, "yours"
            return c

    def to_dict(self) -> dict:
        return {"source": self.source, "example": self.example, "relay_channels": self.channels,
                "path": str(self.path) if self.path else None, "problems": list(self.problems),
                "relay_rating_a": RELAY_RATING_A, "safe_current_a": SAFE_CURRENT_A, "mains_v": MAINS_V,
                "circuits": [c.to_dict() for c in self.circuits]}


# ------------------------------------------------------------------ loading
def parse_config(raw: dict, source: str = "yours", path: Optional[Path] = None) -> CircuitSet:
    """Build a CircuitSet. Bad circuits are reported in .problems; an unsafe relay
    assignment is refused (relay stripped, reason kept) instead of failing the load."""
    if not isinstance(raw, dict) or not isinstance(raw.get("circuits"), list):
        raise ValueError("expected an object with a \"circuits\" list")
    channels = int(raw.get("relay_channels", 12))
    circuits: list[Circuit] = []
    problems: list[dict] = []
    seen_alias: dict[str, str] = {}
    for i, d in enumerate(raw["circuits"]):
        try:
            c = _circuit(d)
        except (TypeError, ValueError) as e:
            problems.append({"id": (d or {}).get("id") if isinstance(d, dict) else None,
                             "error": f"circuit #{i + 1}: {e}"})
            continue
        if any(o.id == c.id for o in circuits):
            problems.append({"id": c.id, "error": f"duplicate circuit id {c.id}"})
            continue
        if c.alias is not None:
            if c.alias not in LEGACY_DEVICES:
                problems.append({"id": c.id, "error": f"alias must be one of {LEGACY_DEVICES}, not {c.alias!r}"})
                c.alias = None
            elif c.alias in seen_alias:
                problems.append({"id": c.id, "error": f"alias {c.alias!r} is already {seen_alias[c.alias]}"})
                c.alias = None
            else:
                seen_alias[c.alias] = c.id
        if c.relay is not None:
            reason = None
            if not isinstance(c.relay, int) or isinstance(c.relay, bool) or not 1 <= c.relay <= channels:
                reason = f"relay channel {c.relay!r} does not exist (1-{channels})"
            else:
                reason = c.relay_check()
                if reason is None:
                    other = next((o for o in circuits if o.relay == c.relay), None)
                    if other is not None:
                        reason = f"relay channel {c.relay} already carries {other.id} “{other.name}”"
            if reason:
                c.refused, c.requested_relay, c.relay = reason, c.relay, None
                problems.append({"id": c.id, "error": reason})
        elif c.alias is not None:
            # An alias IS a relay: the ESP32's light/fan pin carries this load whether
            # or not the config numbered the channel. So the same rules apply.
            reason = c.relay_check()
            if reason:
                c.refused = reason
                problems.append({"id": c.id, "error": reason})
        circuits.append(c)
    return CircuitSet(circuits, raw, source, path, problems)


def _circuit(d: dict) -> Circuit:
    if not isinstance(d, dict):
        raise TypeError("not an object")
    missing = [k for k in ("id", "name", "room", "kind", "rated_w") if d.get(k) in (None, "")]
    if missing:
        raise ValueError(f"missing {', '.join(missing)}")
    kind = str(d["kind"]).strip().lower()
    if kind not in KINDS:
        raise ValueError(f"unknown kind {kind!r} (one of {', '.join(sorted(KINDS))})")
    rated = float(d["rated_w"])
    if not rated > 0:
        raise ValueError("rated_w must be more than 0")
    steps = int(d.get("speed_steps") or 0)
    wbs = [float(w) for w in (d.get("watts_by_step") or [])]
    if wbs and len(wbs) != steps:
        raise ValueError(f"watts_by_step has {len(wbs)} values for {steps} speed steps")
    return Circuit(
        id=str(d["id"]), name=str(d["name"]), room=str(d["room"]), kind=kind, rated_w=rated,
        relay=d.get("relay"), safe_7a=d.get("safe_7a"), alias=d.get("alias"),
        must_not_auto_off=bool(d.get("must_not_auto_off", False)), speed_steps=steps, watts_by_step=wbs,
        power_factor=float(d["power_factor"]) if d.get("power_factor") else None,
        remind_after_min=float(d["remind_after_min"]) if d.get("remind_after_min") else None,
        note=str(d.get("note") or ""))


def load_circuits(path: Optional[Path] = None) -> CircuitSet:
    """The user's circuits.json if there is one, else the committed example. A file
    that cannot be read falls back to the example and says so (never silently)."""
    user = path or (DATA / USER_FILE_NAME)
    example = json.loads(EXAMPLE_FILE.read_text(encoding="utf-8"))
    if user.exists():
        try:
            return parse_config(json.loads(user.read_text(encoding="utf-8")), "yours", user)
        except (ValueError, TypeError, KeyError) as e:
            cs = parse_config(example, "example", None)
            cs.problems.insert(0, {"id": None, "error": f"{user.name} could not be read ({e}); "
                                                       f"showing the example circuits instead"})
            return cs
    return parse_config(example, "example", None)


def _atomic_write(path: Path, obj: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(json.dumps(obj, indent=2, ensure_ascii=False), encoding="utf-8")
    tmp.replace(path)
