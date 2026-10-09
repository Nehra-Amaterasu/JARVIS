"""Presence fusion: one belief about "is anyone in the room", from every sensor.

WHY A BELIEF AND NOT A RULE
The first-generation engine declared presence when "a packet was heard". Each
sensor here is wrong in a known, different way:

  - Wi-Fi CSI sees motion anywhere near the link, through walls, but a person
    sitting still is indistinguishable from an empty room (measured on the
    simulator: seated score 1.28x vs a 1.82x threshold — matches the literature).
  - The LD2450 radar sees position and speed, but loses still bodies (roughly half
    the frames for a seated person, most of them for someone lying down).
  - Neither sensor can see a person leave; they only stop seeing them.

So the room's state is a probability, updated in log-odds (Bayes in additive
form), where each sensor contributes evidence at a RATE (log-odds per second).
Rates make the result independent of how often update() is called — CSI readings
arrive at 4 Hz and radar frames at 10 Hz, and both call it.

THE EVIDENCE TABLE (log-odds per second; the belief is clamped to [-4, +8])
  radar: a confirmed moving track          +4.0   strong, direct
  radar: only still (held) tracks          +1.5   the tracker is holding them
  Wi-Fi: motion                            +1.0   (x0.5 on an auto baseline)
  Wi-Fi: recent motion (hold window)        0.0   not evidence — see below
  absence: radar live and empty >= 3 s,
           and Wi-Fi not holding the room  -0.15  (-0.05 without a radar)
  exit: the last track ENDED in an exit
        zone (doorway)                     -5.0   once — the one direct absence cue
  breathing (Wi-Fi, see motion.py)         +0.3   and no absence term; ONLY while the
                                                  belief is already above even, never
                                                  for 2 min after a walk-out

WI-FI CAN SUSTAIN, NEVER CREATE, AGAINST AN EMPTY RADAR
  While the radar is live and sees nobody, Wi-Fi motion adds no evidence. It may
  hold up a belief that is ALREADY above even (someone moving in
  a corner outside the radar's field of view) for csi_sustain_s, then the absence
  term runs again. The audit found why: the link runs from a router 3 m outside the
  wall, so someone pacing in the hallway perturbs it more than anyone inside, and
  Wi-Fi motion used to add +1/s AND switch the absence term off — 100 % false
  "occupied" for a neighbour, 74 % for a channel drifting through a subcarrier null,
  99 % for a ceiling fan. Without a radar, Wi-Fi keeps its full weight: it is then
  the only motion sensor there is.

"Recent motion" is the detector REMEMBERING motion it already reported, so it is
not new evidence. The first version counted it at +0.3/s, and the benchmark showed
the cost: for 90 s after everyone walked out, that memory outvoted both the exit
through the door and the empty radar (98.7 % false "occupied" in empty time).

The absence rate is deliberately slow: -0.15/s takes ~60 s to go from "certain"
to "unsure". A still person who has fallen off the radar must not vanish in the
time it takes to read a page. A walk out through the door is fast, because that
is evidence of leaving rather than absence of evidence.

Between updates the belief relaxes toward 0.5 with a Markov prior (stay 0.999/s):
old certainty decays when nothing is observed at all.
"""
from __future__ import annotations

import math
from dataclasses import dataclass, field
from typing import Optional

from .motion import STATE_MOTION, STATE_QUIET, STATE_RECENT


@dataclass
class FusionConfig:
    stay_per_s: float = 0.999
    llr_radar_moving: float = 4.0
    llr_radar_still: float = 1.5
    llr_csi_motion: float = 1.0
    llr_csi_recent: float = 0.0
    auto_baseline_weight: float = 0.5
    llr_absence: float = -0.15
    llr_absence_no_radar: float = -0.05
    absence_after_s: float = 3.0
    llr_exit: float = -5.0
    # After a walk-out with nobody else tracked, the belief lands at least this
    # low (p = 0.18, "empty"). Adding -5 to a saturated +8 left it at p = 0.95,
    # so the room read "occupied" for a minute after it was empty. If someone is
    # still there unseen, the first radar hit lifts it straight back.
    exit_ceiling_L: float = -1.5
    # How long Wi-Fi motion alone may hold up an occupied belief while a live radar
    # sees nobody (see "sustain, never create" above). 60 s, then the slow absence
    # term takes ~60 s more: someone moving out of the radar's view for two minutes
    # is eventually called "empty" — the price of not trusting the hallway.
    csi_sustain_s: float = 60.0
    # BREATHING HOLDS, NEVER CREATES. A sleeper the radar has forgotten is still
    # breathing; on the sleep scenario the room read "empty" 72-85 % of the time
    # someone slept in it. Breathing evidence switches the absence term off and adds
    # llr_breathing, but only while the belief is already above even, and not for
    # breathing_after_exit_s after a walk-out (a curtain swaying at 0.3 Hz must not
    # keep a room occupied after its owner left through the door).
    llr_breathing: float = 0.3
    breathing_after_exit_s: float = 120.0
    clamp: float = 8.0
    # How sure of "empty" the belief may get. Once Wi-Fi motion stopped propping up
    # empty rooms, a long empty spell saturated at -8, and the next person through
    # the door took ~2.4 s (confirmation + climbing back at +4/s) to stop reading
    # "empty" — 8 % false "empty" on the drift run's short visit. At -4 it takes ~1.3 s.
    clamp_empty: float = 4.0
    occupied_p: float = 0.7
    empty_p: float = 0.3


def _sigmoid(x: float) -> float:
    return 1.0 / (1.0 + math.exp(-x))


def _logit(p: float) -> float:
    p = min(max(p, 1e-9), 1 - 1e-9)
    return math.log(p / (1 - p))


@dataclass
class Evidence:
    """What each sensor is saying right now (a snapshot passed to update())."""
    radar_live: bool = False
    n_moving: int = 0
    n_still: int = 0
    csi_live: bool = False
    csi_state: Optional[str] = None        # motion.STATE_* or None
    csi_auto_baseline: bool = False
    csi_score: Optional[float] = None
    breathing: bool = False                # Wi-Fi breathing evidence (RespirationDetector)


@dataclass
class PresenceFusion:
    cfg: FusionConfig = field(default_factory=FusionConfig)
    L: float = 0.0
    last_t: Optional[float] = None
    radar_empty_since: Optional[float] = None
    last_exit_t: Optional[float] = None
    ever_live: bool = False
    contrib: dict = field(default_factory=lambda: {"radar": 0.0, "wifi": 0.0, "absence": 0.0,
                                                   "breathing": 0.0})
    last: Evidence = field(default_factory=Evidence)

    @property
    def p(self) -> float:
        return _sigmoid(self.L)

    def update(self, t: float, ev: Evidence) -> float:
        c = self.cfg
        dt = 0.0 if self.last_t is None else max(0.0, min(t - self.last_t, 2.0))
        self.last_t = t
        self.last = ev
        self.ever_live = self.ever_live or ev.radar_live or ev.csi_live

        # 1. Markov prior: with no evidence the belief relaxes toward 0.5.
        if dt > 0:
            s = c.stay_per_s ** dt
            self.L = _logit(self.p * s + (1 - self.p) * (1 - s))

        # 2. Evidence rates.
        radar = wifi = absence = breath = 0.0
        if ev.radar_live:
            if ev.n_moving:
                radar = c.llr_radar_moving
            elif ev.n_still:
                radar = c.llr_radar_still
            if ev.n_moving + ev.n_still == 0:
                if self.radar_empty_since is None:
                    self.radar_empty_since = t
            else:
                self.radar_empty_since = None
        else:
            self.radar_empty_since = None
        radar_empty_for = (t - self.radar_empty_since
                           if ev.radar_live and self.radar_empty_since is not None else None)
        holding = False                       # is Wi-Fi motion holding the room up?
        if ev.csi_live and ev.csi_state in (STATE_MOTION, STATE_RECENT):
            w = c.auto_baseline_weight if ev.csi_auto_baseline else 1.0
            if ev.csi_state == STATE_MOTION and radar_empty_for is not None:
                # No grace period: with one, the 3 s before the absence term starts
                # let hallway motion lift a fresh belief above even, and then hold
                # it for csi_sustain_s (40 % false "occupied" on the hallway run).
                holding = self.L > 0 and radar_empty_for < c.csi_sustain_s
            else:
                wifi = (c.llr_csi_motion if ev.csi_state == STATE_MOTION else c.llr_csi_recent) * w
                holding = ev.csi_state == STATE_MOTION
        if ev.breathing and self.L > 0 and (self.last_exit_t is None
                                            or t - self.last_exit_t > c.breathing_after_exit_s):
            breath, holding = c.llr_breathing, True
        if not holding:
            if radar_empty_for is not None and radar_empty_for >= c.absence_after_s:
                absence = c.llr_absence
            elif not ev.radar_live and ev.csi_live and ev.csi_state in (STATE_QUIET, STATE_RECENT):
                absence = c.llr_absence_no_radar
        self.contrib = {"radar": radar, "wifi": wifi, "absence": absence, "breathing": breath}
        self.L = max(-c.clamp_empty, min(c.clamp, self.L + (radar + wifi + absence + breath) * dt))
        return self.p

    def entry_observed(self, t: float) -> None:
        """A confirmed track appeared in an exit zone: someone walked in.

        The mirror of the exit cue. Without it, a belief resting at the empty clamp
        needed ~0.8 s at +4/s after the track confirmed to stop reading "empty" — on
        the drift run's short visit that was 7 % false "empty", all of it in the
        doorway. A doorway is where people appear; one there is at least "unsure".
        """
        self.L = max(self.L, 0.0)

    def exit_observed(self, t: float, tracks_remaining: int) -> None:
        """A confirmed track ended inside an exit zone."""
        if tracks_remaining == 0:
            self.L = max(-self.cfg.clamp_empty, min(self.L + self.cfg.llr_exit, self.cfg.exit_ceiling_L))
            self.last_exit_t = t

    # ---- reporting ---------------------------------------------------------
    def state(self) -> str:
        if not self.ever_live:
            return "no data"
        p, ev, c = self.p, self.last, self.cfg
        if p >= c.occupied_p:
            moving = ev.n_moving > 0 or (ev.csi_live and ev.csi_state == STATE_MOTION)
            return "moving" if moving else "still"
        if p <= c.empty_p:
            return "empty"
        return "uncertain"

    def summary(self, now: Optional[float] = None) -> dict:
        ev, p, st = self.last, self.p, self.state()
        parts = []
        if ev.radar_live:
            n = ev.n_moving + ev.n_still
            parts.append(f"radar: {n} {'person' if n == 1 else 'people'}"
                         + (f" ({ev.n_moving} moving)" if n else ""))
        else:
            parts.append("radar: not connected")
        if ev.csi_live and ev.csi_state:
            sc = f" {ev.csi_score:.1f}x" if ev.csi_score is not None else ""
            parts.append(f"Wi-Fi: {ev.csi_state}{sc}")
            if ev.breathing:
                parts.append("Wi-Fi: breathing")
        else:
            parts.append("Wi-Fi: not connected")
        if self.last_exit_t is not None and now is not None and now - self.last_exit_t < 30:
            parts.append("last person left via the door")
        conf = p if st in ("moving", "still") else (1 - p if st == "empty" else 1 - abs(p - 0.5) * 2)
        return {
            "state": st,
            "p": round(p, 4),
            "confidence": round(conf, 3),
            "count": ev.n_moving + ev.n_still if ev.radar_live else None,
            "count_source": "radar" if ev.radar_live else None,
            "evidence": {k: round(v, 3) for k, v in self.contrib.items()},
            "reason": " · ".join(parts),
        }
