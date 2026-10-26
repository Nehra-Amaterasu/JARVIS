"""Variance presence and a drift monitor, from one Wi-Fi link's amplitudes.

WHY THIS, FIRST
  The second council hearing (2026-10-26) ruled "presence, then motion, then zones":
  across sessions the static spectral shape moves 0.28 rms log units per subcarrier,
  2.4x the 0.12 that separates two places in one session, so anything read from the
  static shape (zones, the level) is buried by drift. Variance of the amplitude in the
  body band ignores a static shift by construction (the VRTI logic), so it is the task
  that sidesteps the drift. One Wi-Fi link sees THAT a body moved, not where or how it
  is bent: "present" here means "movement on the link like a person's", and a person
  lying still looks like an empty room. That is said in every "why".

MEASURED, AND IT FAILS TODAY (data/notes/research/aankhen-presence-fan.md)
  10-26 narrated sessions, fan on, the board through a wall, scored against the
  labelled out-of-room stretches with the reference from the OTHER session: AUC 0.14
  (CI 0.08-0.21) and 0.30, against a shuffled-label control of 0.50-0.51 and an
  always-occupied baseline right 90-97 % of the time. The empty room had MORE body-band
  energy than the occupied one: out of the room he was moving in the hall the link
  crosses (median band power -2.9 against -6.8 sitting still on the bed). So it ships
  with VALIDATED = False: "present" is shown, absence is never claimed, nothing acts on
  it, until a post-move session (transmitter in the room) scores above the baseline.

THE FEATURE (OpenCSI-style per-link normalisation, arXiv 2607.26665)
  Per subcarrier s and 100 Hz sample, on x = log amplitude:
    band     y = lowpass_5Hz(x - lowpass_0.3Hz(x))       two one-pole filters
    power    v = EMA(y^2, 2 s)
  Every 0.5 s: z_s = (log v_s - mu_s) / sd_s against that subcarrier's statistics in
  its own QUIET reference (an empty room), and score = median over subcarriers of z_s.
  O(subcarriers) per sample; the median every 0.5 s is O(S log S).
  p = logistic((score - Z_ON) / Z_SCALE), held for HOLD_S after a confident reading
  (somebody who moved and went still is still there for a while).

THE REFERENCE, AND WHERE IT MAY COME FROM
  Per fan state ("on" / "off" / "unknown"): the fan changes what an empty room's band
  energy is. A reference is captured only from stretches an independent source calls
  EMPTY (the drill's or the teachers' empty blocks, the engine's `empty` evidence), or,
  after a drift, from a SLEEP stretch (night hours, quiet for SLEEP_MIN_S). Never from
  the detector's own "nobody here" during the day: that is how a still person becomes
  part of "empty" and stops being seen. EW-Welford per subcarrier (REF_TAU_S), ready
  after REF_MIN_S of capture.

THE DRIFT MONITOR
  Each reference also keeps the static shape: the mean log amplitude per subcarrier,
  with its mean over subcarriers removed (shape only, the level is not compared). While
  the room is quiet (score < Z_QUIET), the current shape follows with a 60 s EMA, and
  drift = rms(current - reference) in log units. Above DRIFT_AT (0.22, measured: see
  the constant) for DRIFT_HOLD_S
  of quiet time, the channel has changed: the reference is marked stale ("present"
  becomes None unless the movement is unmistakable) and the next empty or sleep stretch
  recaptures it, automatically.
"""
from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Optional

import numpy as np

FS = 100.0
BAND_LO_HZ, BAND_HI_HZ = 0.3, 5.0
POWER_TAU_S = 2.0
HOP = 50                         # an estimate every 0.5 s
Z_ON = 3.0                       # median z this far above the empty room: p = 0.5
Z_SCALE = 1.0
Z_QUIET = 1.5                    # below this the room is "quiet" (drift and sleep use it)
P_PRESENT, P_ABSENT = 0.7, 0.3
HOLD_S = 120.0                   # a confident reading holds "present" this long
ABSENT_AFTER_S = 60.0            # "absent" only after this long without any movement
REF_TAU_S = 300.0                # EW-Welford time constant of the quiet statistics
REF_MIN_S = 30.0                 # capture needed before a reference is used
SHAPE_TAU_S = 60.0
# rms log units. The physics seat proposed 0.15 (between the 0.12 place separation and
# the 0.28 session shift, on window shapes). On THIS monitor's 60 s quiet-time shape, a
# night alone reaches 0.15-0.20 (05:23 session, sleep minutes 25-120: median 0.152, max
# 0.203; turning over is a small place change), so 0.15 flagged 41 % of the night. 0.22
# flagged 0 % of it and 97 % of both real changes measured: the noon pair 40 min apart
# (median 0.295, p10 0.246) and 05:23 against noon (median 0.663). One night and two
# changes: re-measure once more nights exist (data/notes/research/aankhen-presence-fan.md).
DRIFT_AT = 0.22
DRIFT_HOLD_S = 60.0
SLEEP_MIN_S = 600.0              # a quiet night stretch this long counts as sleep
NIGHT_HOURS = (22, 7)            # [22:00, 07:00)
SD_FLOOR = 0.05                  # log units: no subcarrier's spread is taken as below this
EPS = 1e-12
# Not validated on this room: on the 10-26 narrated sessions (fan on, through-wall link)
# the labelled empty room had MORE body-band energy than the occupied one, AUC 0.14-0.30
# against a shuffled control of 0.50 (he was moving in the hall the link crosses, or
# sitting still on the bed). Every reading says so; nothing may act on it until a
# post-move session scores above the always-occupied baseline with its CI.
VALIDATED = False


def _alpha(tau_s: float, dt: float = 1.0 / FS) -> float:
    return 1.0 - math.exp(-dt / tau_s)


@dataclass
class Reference:
    """One fan state's empty room: quiet band-energy statistics and the static shape."""
    n_sub: int
    mean: np.ndarray = None          # EW mean of log band power, per subcarrier
    var: np.ndarray = None
    shape: np.ndarray = None         # mean log amplitude minus its subcarrier mean
    seconds: float = 0.0             # capture seconds behind it
    source: str = "none"             # "empty" | "sleep"
    made_at: Optional[float] = None  # device time the last capture ended
    stale: bool = False              # the drift monitor says the channel changed

    def __post_init__(self):
        if self.mean is None:
            self.mean = np.zeros(self.n_sub)
            self.var = np.zeros(self.n_sub)
            self.shape = np.zeros(self.n_sub)

    @property
    def ready(self) -> bool:
        return self.seconds >= REF_MIN_S

    def add(self, logv: np.ndarray, shape: np.ndarray, dt: float, source: str, t: float) -> None:
        """EW-Welford (West 1979) with a time constant: the first REF_TAU_S average all,
        then old captures fade."""
        n = self.seconds / dt
        a = max(1.0 / (n + 1.0), _alpha(REF_TAU_S, dt))
        d = logv - self.mean
        self.mean = self.mean + a * d
        self.var = (1 - a) * (self.var + a * d * d)
        self.shape = shape.copy() if self.seconds == 0 else (1 - a) * self.shape + a * shape
        self.seconds += dt
        self.source = source
        self.made_at = t

    def to_dict(self) -> dict:
        return {"n_sub": self.n_sub, "mean": self.mean.tolist(), "var": self.var.tolist(),
                "shape": self.shape.tolist(), "seconds": self.seconds, "source": self.source,
                "made_at": self.made_at, "stale": self.stale}

    @classmethod
    def from_dict(cls, d: dict) -> "Reference":
        r = cls(int(d["n_sub"]), np.asarray(d["mean"], float), np.asarray(d["var"], float),
                np.asarray(d["shape"], float), float(d["seconds"]), str(d.get("source", "empty")),
                d.get("made_at"), bool(d.get("stale", False)))
        return r


class PresenceDetector:
    """{present: True|False|None, p, why, ref_age_s, drift} from the conditioned CSI.

    Feed it every conditioned sample with push(t, amp). Tell it what independent
    sources know: set_fan(state) picks the reference ("on"/"off"/"unknown"), `empty`
    (bool, set before push) says an independent source calls the room empty right now,
    and `hour` (local hour, set by the caller, None if unknown) allows sleep stretches."""

    def __init__(self, n_sub: int = 51):
        self.n_sub = n_sub
        self.refs: dict[str, Reference] = {}
        self.fan = "unknown"
        self.empty = False
        self.hour: Optional[int] = None
        self._a_hp = _alpha(1.0 / (2 * math.pi * BAND_LO_HZ))
        self._a_lp = _alpha(1.0 / (2 * math.pi * BAND_HI_HZ))
        self._a_v = _alpha(POWER_TAU_S)
        self._a_shape = _alpha(SHAPE_TAU_S, HOP / FS)
        self.restart()
        self.last: Optional[dict] = None

    # ------------------------------------------------------------ state
    def restart(self) -> None:
        """Forget the filters (a channel change): the references stay, and the drift
        monitor decides whether they still describe the room."""
        self._x_lo = None
        self._y = None
        self._v = None
        self._n = 0
        self._warm = 0
        self._shape_now: Optional[np.ndarray] = None
        self._drift_s = 0.0
        self._quiet_s = 0.0
        self._last_conf_t: Optional[float] = None
        self._last_move_t: Optional[float] = None
        self.score: Optional[float] = None
        self.drift: Optional[float] = None
        self._pending: Optional[str] = None   # "sleep" capture in progress after a drift
        self._cand: Optional[Reference] = None

    def set_fan(self, state: Optional[str]) -> None:
        s = state if state in ("on", "off") else "unknown"
        if s != self.fan:
            self.fan = s
            self._shape_now = None
            self._drift_s = 0.0

    @property
    def ref(self) -> Optional[Reference]:
        return self.refs.get(self.fan)

    # ------------------------------------------------------------ feed
    def push(self, t: float, amp: np.ndarray) -> Optional[dict]:
        a = np.asarray(amp, float)
        if a.shape[0] != self.n_sub:
            return None
        x = np.log(np.maximum(a, 1e-3))
        if self._x_lo is None:
            self._x_lo = x.copy()
            self._y = np.zeros_like(x)
            self._v = np.zeros_like(x)
            self._xmean = x.copy()
        self._x_lo += self._a_hp * (x - self._x_lo)
        self._y += self._a_lp * ((x - self._x_lo) - self._y)
        self._v += self._a_v * (self._y * self._y - self._v)
        self._xmean += self._a_hp * 0.1 * (x - self._xmean)     # ~5 s mean for the shape
        self._n += 1
        if self._n % HOP:
            return None
        self._warm += 1
        if self._warm * HOP / FS < 3 * POWER_TAU_S:      # filters still filling
            return None
        return self._estimate(t)

    def _estimate(self, t: float) -> dict:
        dt = HOP / FS
        logv = np.log(self._v + EPS)
        shape = self._xmean - self._xmean.mean()
        ref = self.ref
        # ---- capture from independent "empty" evidence
        if self.empty:
            if ref is None or ref.stale:            # a changed channel starts afresh
                ref = self.refs[self.fan] = Reference(self.n_sub)
            ref.add(logv, shape, dt, "empty", t)
            self._pending = None
        # ---- score against the reference
        score = None
        if ref is not None and ref.ready:
            sd = np.sqrt(np.maximum(ref.var, SD_FLOOR ** 2))
            score = float(np.median((logv - ref.mean) / sd))
        self.score = score
        quiet = score is not None and score < Z_QUIET
        # ---- drift monitor (quiet time only: a person's movement is not the channel)
        if ref is not None and ref.ready and quiet:
            self._shape_now = shape.copy() if self._shape_now is None else                 (1 - self._a_shape) * self._shape_now + self._a_shape * shape
            self.drift = float(np.sqrt(np.mean((self._shape_now - ref.shape) ** 2)))
            self._drift_s = self._drift_s + dt if self.drift > DRIFT_AT else 0.0
            if self._drift_s >= DRIFT_HOLD_S and not ref.stale and not self.empty:
                ref.stale = True
                self._pending = "sleep"
        # ---- recapture from a sleep stretch after a drift (never from awake time): a
        # candidate collects while the night stays quiet and is dropped at the first
        # movement; SLEEP_MIN_S of unbroken quiet promotes it.
        night = self.hour is not None and (self.hour >= NIGHT_HOURS[0] or self.hour < NIGHT_HOURS[1])
        self._quiet_s = self._quiet_s + dt if quiet else 0.0
        if ref is not None and ref.stale and self._pending == "sleep" and not self.empty:
            if quiet and night:
                if self._cand is None:
                    self._cand = Reference(self.n_sub)
                self._cand.add(logv, shape, dt, "sleep", t)
                if self._cand.seconds >= SLEEP_MIN_S:
                    self.refs[self.fan] = ref = self._cand
                    self._cand, self._pending, self._drift_s = None, None, 0.0
                    self._shape_now = None
                    self.drift = None
            else:
                self._cand = None
        return self._reading(t, score, ref)

    # ------------------------------------------------------------ answer
    def _reading(self, t: float, score: Optional[float], ref: Optional[Reference]) -> dict:
        fan = f"fan {self.fan}"
        if ref is None or not ref.ready:
            have = 0.0 if ref is None else ref.seconds
            r = {"present": None, "p": None,
                 "why": f"no empty-room reference for {fan} yet ({have:.0f} of {REF_MIN_S:.0f} s): "
                        "it is captured only while the drill or the teachers say the room is empty",
                 "ref_age_s": None, "drift": None, "score": None, "ref_source": None,
                 "channel_changed": False, "fan": self.fan, "validated": VALIDATED}
            self.last = r
            return r
        p = 1.0 / (1.0 + math.exp(-(score - Z_ON) / Z_SCALE))
        if p >= P_PRESENT:
            self._last_conf_t = t
        if score >= Z_QUIET:
            self._last_move_t = t
        held = self._last_conf_t is not None and t - self._last_conf_t < HOLD_S
        p_out = max(p, 0.5 + 0.5 * (1 - (t - self._last_conf_t) / HOLD_S)) if held else p
        still_for = None if self._last_move_t is None else t - self._last_move_t
        if ref.stale:
            present = True if p >= 0.95 else None
            why = (f"the channel changed (shape drift {self.drift:.2f} > {DRIFT_AT}): the empty room "
                   f"is recaptured at the next empty or sleep stretch; until then only unmistakable "
                   f"movement counts")
        elif p_out >= P_PRESENT:
            present = True
            why = (f"movement on the link {score:.1f} sd above the empty room" if p >= P_PRESENT
                   else f"moved {t - self._last_conf_t:.0f} s ago, probably still here")
        elif p_out <= P_ABSENT and (still_for is None or still_for >= ABSENT_AFTER_S):
            quiet_for = 'a while' if still_for is None else f'{still_for:.0f} s'
            if VALIDATED:
                present = False
                why = (f"no movement on the link like a person's for {quiet_for}; a person "
                       "lying still also looks like this")
            else:
                # Absence is the claim that switches lights off on somebody. On the 10-26
                # sessions this "nothing moves" fired in 85-100 % of the windows he was in
                # the room (114407, own reference), so it is not claimed until validated.
                present = None
                why = (f"no movement on the link for {quiet_for}, but absence is not claimed: "
                       "in this room a still person read as empty on 10-26")
        else:
            present = None
            why = "not sure: a little movement, or a still person; one link cannot tell"
        age = None if ref.made_at is None else max(0.0, t - ref.made_at)
        r = {"present": present, "p": round(float(p_out), 3), "why": why,
             "ref_age_s": None if age is None else round(age, 1),
             "drift": None if self.drift is None else round(self.drift, 3),
             "score": round(float(score), 2), "ref_source": ref.source,
             "channel_changed": bool(ref.stale), "fan": self.fan, "validated": VALIDATED}
        self.last = r
        return r

    def summary(self) -> dict:
        """The last reading, or the warming-up answer before the first."""
        if self.last is not None:
            return dict(self.last)
        return {"present": None, "p": None, "why": "warming up: no Wi-Fi CSI yet", "ref_age_s": None,
                "drift": None, "score": None, "ref_source": None, "channel_changed": False,
                "fan": self.fan, "validated": VALIDATED}
