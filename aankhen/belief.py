"""One honest belief over the zones: where Aman probably is, how sure, and when to say "unsure".

THE CONTRACT (hub status, the frame stream and the snapshot all carry it as `belief`;
the dot-cloud view reads exactly these names)

    {"state": "in_room" | "empty" | "unsure",
     "confidence": 0..1,                       # how sure of `state`
     "zones": [{"id", "name", "p", "x", "y", "r"}, ...],   # every zone, p sums to 1
     "motion": 0..1,                           # normalised human-band energy
     "activity": {"state": "still|typing|moving|lying|none", "p": 0..1} | None,
     "updated": epoch seconds}

HOW (docs/research/2026-10-14-spatial-intelligence-brainstorm.md, idea 2, in software only)
  - PREDICT every tick: probability leaves a zone only along the zone graph
    (zones.GRAPH), at a rate set by a DWELL HAZARD (semi-Markov): long-stay places
    (desk chair, bed, out of the room) have a hazard that FALLS the longer he has been
    there, so a sleeper's "bed" lasts hours without new evidence; transit places
    (beside the bed, the door) have a rising one. Leaving also needs movement: the rate
    is scaled by the measured motion, so with nothing moving the belief stays put.
    That is object permanence: the old 0.999/s fade kept 55 % after 10 minutes.
  - UPDATE with each evidence source as a tempered likelihood (weight <= 1): the learned
    models (coarse classes spread evenly over their zones until zone models exist, weight
    0.3 because they score ~50 % across days), and the free teachers (keyboard in the last
    seconds = at the desk chair; phone gone and laptop idle = out of the room).
    Evidence the guard rejects (out of the training range, HBE gaps) is LEFT OUT: silence
    never counts as "nothing happened".
  - SPEAK only above floors: state needs P >= 0.8 (else "unsure"); a zone is named only
    at p >= 0.6 with a same-firmware reference; an activity only at p >= 0.7. Activity
    "waving" no longer exists.
"""
from __future__ import annotations

import math
import time
from collections import deque
from typing import Optional

import numpy as np

from .zones import ACTIVITIES, OLD_ACTIVITY, ZoneMap

STATE_FLOOR = 0.8          # P(in room) or P(empty) needed to say so; else "unsure"
ZONE_FLOOR = 0.6           # a zone is named only this sure
ACTIVITY_FLOOR = 0.7       # an activity is named only this sure
LEARNED_WEIGHT = 0.3       # the CSI models' evidence is tempered: ~50 % across days
ZONE_MODEL_WEIGHT = 0.5    # a zone model trained on drills, once one exists
TEACHER_FRESH_S = 15.0     # a free-teacher hint older than this is ignored
MIN_P = 1e-6
NO_REFERENCE = ("no empty-room reference for this firmware and fan yet: run the drill, "
                "or let the daily recalibration capture one while the room is empty")


def motion01(hbe: Optional[float], threshold: Optional[float]) -> Optional[float]:
    """Human-band energy as 0..1: 0 = nothing moving, 1 = four times the motion threshold
    (walking). None when there is no reading."""
    if hbe is None or not np.isfinite(hbe):
        return None
    ratio = hbe / threshold if threshold else hbe / 3.0
    return float(min(1.0, max(0.0, ratio / 4.0)))


class ZoneBelief:
    """Semi-Markov forward filter over the zone map (see the module docstring)."""

    def __init__(self, zmap: ZoneMap):
        self.zmap = zmap
        n = len(zmap)
        self.n = n
        self.p = np.full(n, 1.0 / n)
        self.age = np.zeros(n)                       # expected seconds spent in each zone so far
        self.dwell = np.array([max(5.0, z.dwell_s) for z in zmap.zones])
        # Weibull shape per zone: < 1 (hazard falls with time) for places one settles in.
        self.shape = np.where(self.dwell >= 300.0, 0.6, 1.5)
        self.scale = self.dwell / np.array([math.gamma(1.0 + 1.0 / k) for k in self.shape])
        self.nbr = [[zmap.index[j] for j in z.neighbours if j in zmap.index] for z in zmap.zones]
        self.in_room = zmap.in_room_mask()
        self.t: Optional[float] = None
        self.evidence_at: Optional[float] = None     # device time of the last accepted evidence

    def hazard(self) -> np.ndarray:
        a = np.maximum(self.age, 1.0)
        k, lam = self.shape, self.scale
        return np.minimum((k / lam) * (a / lam) ** (k - 1.0), 1.0)

    def predict(self, t: float, motion: Optional[float]) -> None:
        if self.t is None:
            self.t = t
            return
        dt = t - self.t
        if dt <= 0:
            return
        dt = min(dt, 5.0)                            # a gap is not evidence of movement
        self.t = t
        m = 0.5 if motion is None else motion
        leave = 1.0 - np.exp(-self.hazard() * (0.03 + 0.97 * m) * dt)
        stay = self.p * (1.0 - leave)
        moved = np.zeros(self.n)
        for i, nb in enumerate(self.nbr):
            if nb:
                moved[nb] += self.p[i] * leave[i] / len(nb)
            else:
                stay[i] += self.p[i] * leave[i]
        new = stay + moved
        # mean-field ages: mass that stayed got older, mass that arrived is new
        self.age = np.where(new > 0, stay * (self.age + dt) / np.maximum(new, 1e-12), 0.0)
        self.p = new / new.sum()

    def update(self, lik: np.ndarray, weight: float, t: Optional[float] = None) -> None:
        lik = np.maximum(np.asarray(lik, float), MIN_P)
        b = self.p * lik ** weight
        s = b.sum()
        if not np.isfinite(s) or s <= 0:
            return
        self.p = np.maximum(b / s, MIN_P)
        self.p /= self.p.sum()
        if t is not None:
            self.evidence_at = t

    def p_in_room(self) -> float:
        return float(self.p[self.in_room].sum())


def coarse_likelihood(zmap: ZoneMap, coarse_p: dict) -> np.ndarray:
    """The old five-class output as a likelihood over zones: every zone of a class gets
    that class's probability ("empty" and "outside" both mean: not in the room)."""
    out = np.empty(len(zmap))
    gone = float(coarse_p.get("empty", 0.0)) + float(coarse_p.get("outside", 0.0))
    for i, z in enumerate(zmap.zones):
        out[i] = gone if z.coarse in ("empty", "outside") else float(coarse_p.get(z.coarse, 0.0))
    return out


def zone_model_likelihood(zmap: ZoneMap, zone_p: dict) -> np.ndarray:
    """A drill-trained zone model's output over the zones it knows; zones it never saw
    get the smallest probability it gave anything (no evidence for or against)."""
    known = [float(v) for v in zone_p.values()] or [1.0]
    floor = max(min(known), 1e-3)
    return np.array([float(zone_p.get(z.id, floor)) for z in zmap.zones])


def map_old_activity(act_p: dict) -> dict:
    """The old activity model in the new vocabulary, waving removed and renormalised."""
    out = {a: 0.0 for a in ACTIVITIES}
    for k, v in act_p.items():
        new = OLD_ACTIVITY.get(k, k if k in out else None)
        if new is not None and new in out:
            out[new] += float(v)
    s = sum(out.values())
    return {k: v / s for k, v in out.items()} if s > 0 else out


class OodGuard:
    """Says "can't tell" when a window is outside what the models were trained on.

    - range: the place-carrying features (static-shape and level deviation, energy) must
      lie inside the training range widened by `margin` of its span on each side. On
      10-13/14 shape_dev1 reached -377 against a training range of -19..-179.
    - gaps: if more than `nan_max` of the last `window` feature vectors had no human-band
      energy (packet gaps), the trees are being fed NaN they hardly ever saw."""

    KEYS = ("shape_dev1", "shape_dev2", "shape_dev3", "shape_dev4", "shape_dev5",
            "level_dev_db", "log_hbe")

    def __init__(self, features: list, ranges: Optional[dict] = None, margin: float = 0.25,
                 window: int = 20, nan_max: float = 0.10):
        self.features = list(features)
        self.ranges = ranges or {}
        self.margin = margin
        self.nan_max = nan_max
        self.recent_nan: deque = deque(maxlen=window)
        self.last_reason: Optional[str] = None

    def check(self, v: np.ndarray) -> Optional[str]:
        """None when the window is usable, else why not."""
        hbe_i = self.features.index("log_hbe") if "log_hbe" in self.features else None
        self.recent_nan.append(bool(hbe_i is not None and not np.isfinite(v[hbe_i])))
        reason = None
        if len(self.recent_nan) >= 5 and np.mean(self.recent_nan) > self.nan_max:
            reason = f"packet gaps: {np.mean(self.recent_nan):.0%} of recent windows had no motion energy"
        else:
            for k in self.KEYS:
                if k not in self.ranges or k not in self.features:
                    continue
                lo, hi = self.ranges[k]
                x = v[self.features.index(k)]
                if not np.isfinite(x):
                    continue
                pad = self.margin * max(hi - lo, 1e-6)
                if x < lo - pad or x > hi + pad:
                    reason = f"{k} {x:.0f} outside the trained range {lo:.0f}..{hi:.0f}"
                    break
        self.last_reason = reason
        return reason


def feature_ranges_from_model(model) -> dict:
    """The training range per feature: stored by our own trainers in trained_on
    ["feature_ranges"]; for older models, read off HistGradientBoosting's bin edges
    (its first and last thresholds sit just inside the training min and max)."""
    if model is None:
        return {}
    tr = getattr(model, "trained_on", {}) or {}
    if tr.get("feature_ranges"):
        return {k: tuple(v) for k, v in tr["feature_ranges"].items()}
    feats = getattr(model, "features", None)
    clf = getattr(model, "clf", None)
    if feats is None:
        from .learn import FEATURES
        feats = FEATURES
    try:
        th = clf._bin_mapper.bin_thresholds_
        out = {}
        for name, edges in zip(feats, th):
            e = np.asarray(edges, float)
            e = e[np.isfinite(e)]
            if e.size >= 2:
                out[name] = (float(e.min()), float(e.max()))
        return out
    except Exception:
        return {}


def feature_ranges(X: np.ndarray, features: list) -> dict:
    """Training ranges for a model we train: the 0.5 and 99.5 percentiles."""
    out = {}
    for j, name in enumerate(features):
        col = X[:, j]
        col = col[np.isfinite(col)]
        if col.size:
            out[name] = [round(float(np.percentile(col, 0.5)), 4), round(float(np.percentile(col, 99.5)), 4)]
    return out


class BeliefTracker:
    """Everything the engine needs: the zone belief, the guard's verdict, the activity,
    and the two outputs (the dot-cloud `contract()` and the engine's `honest()`)."""

    def __init__(self, zmap: ZoneMap, clock=time.time):
        self.zmap = zmap
        self.belief = ZoneBelief(zmap)
        self.clock = clock
        self.motion: Optional[float] = None
        self.activity_p: Optional[dict] = None       # new-vocabulary activity probabilities
        self.unsure_reason: Optional[str] = "no evidence yet"
        self.reference_ok = True                     # a same-firmware empty-room reference
        self.updated: Optional[float] = None

    # ---------------------------------------------------------- evidence
    def step(self, t: float, motion: Optional[float] = None, coarse_p: Optional[dict] = None,
             zone_p: Optional[dict] = None, activity_p: Optional[dict] = None,
             ood: Optional[str] = None, teacher: Optional[dict] = None) -> None:
        self.motion = motion
        self.belief.predict(t, motion)
        used = False
        if ood is None and not self.reference_ok:
            # Place and presence features are deviations from the empty room. Measured
            # against another firmware's or fan state's empty room they are not evidence.
            ood = NO_REFERENCE
        if ood is None:
            if zone_p:
                self.belief.update(zone_model_likelihood(self.zmap, zone_p), ZONE_MODEL_WEIGHT, t)
                used = True
            elif coarse_p:
                self.belief.update(coarse_likelihood(self.zmap, coarse_p), LEARNED_WEIGHT, t)
                used = True
            if activity_p is not None:
                a = activity_p if set(activity_p) <= set(ACTIVITIES) else map_old_activity(activity_p)
                prev = self.activity_p
                self.activity_p = a if prev is None else {k: 0.5 * prev.get(k, 0.0) + 0.5 * a[k] for k in a}
        else:
            self.activity_p = None
        t_used = self._teachers(t, teacher)
        self.unsure_reason = ood if ood is not None and not t_used else (
            None if (used or t_used) else self.unsure_reason)
        self.updated = self.clock()

    def _teachers(self, t: float, teacher: Optional[dict]) -> bool:
        """Free-teacher hints as evidence (counts only; see teachers.py)."""
        if not teacher or self.clock() - teacher.get("at", 0) > TEACHER_FRESH_S:
            return False
        zm, used = self.zmap, False
        if teacher.get("typing"):
            lik = np.full(len(zm), 0.02)
            for zid, v in (("at_desk_chair", 1.0), ("desk_standing", 0.4)):
                if zid in zm.index:
                    lik[zm.index[zid]] = v
            self.belief.update(lik, 1.0, t)
            self.activity_p = {a: (0.95 if a == "typing" else 0.05 / (len(ACTIVITIES) - 1)) for a in ACTIVITIES}
            used = True
        elif teacher.get("away"):
            lik = np.where(self.belief.in_room, 0.05, 1.0)
            self.belief.update(lik, 1.0, t)
            used = True
        return used

    # ---------------------------------------------------------- outputs
    def _activity(self, state: str) -> Optional[dict]:
        if state == "empty":
            return {"state": "none", "p": round(1.0 - self.belief.p_in_room(), 3)}
        if state != "in_room" or not self.activity_p:
            return None
        a = dict(self.activity_p)
        a.pop("none", None)
        s = sum(a.values())
        if s <= 0:
            return None
        a = {k: v / s for k, v in a.items()}
        # still while the bed's lying place dominates is "lying"
        top_zone = self.zmap.zones[int(np.argmax(self.belief.p))]
        if top_zone.posture == "lying" and a.get("still", 0) > a.get("lying", 0):
            a["lying"], a["still"] = a.get("lying", 0) + a["still"], 0.0
        k = max(a, key=a.get)
        return {"state": k, "p": round(a[k], 3)} if a[k] >= ACTIVITY_FLOOR else None

    def state(self) -> tuple[str, float]:
        pin = self.belief.p_in_room()
        conf = max(pin, 1.0 - pin)
        if self.unsure_reason is not None:
            return "unsure", round(conf, 3)
        if pin >= STATE_FLOOR:
            return "in_room", round(pin, 3)
        if 1.0 - pin >= STATE_FLOOR:
            return "empty", round(1.0 - pin, 3)
        return "unsure", round(conf, 3)

    def contract(self) -> dict:
        state, conf = self.state()
        p = self.belief.p
        return {"state": state, "confidence": conf,
                "zones": [{"id": z.id, "name": z.name, "p": round(float(p[i]), 4),
                           "x": z.x, "y": z.y, "r": z.r} for i, z in enumerate(self.zmap.zones)],
                "motion": None if self.motion is None else round(self.motion, 3),
                "activity": self._activity(state),
                "updated": round(self.updated if self.updated is not None else self.clock(), 3)}

    def honest(self) -> dict:
        """The engine's one honest answer: {state, zone, activity, confidence}, plus why
        when it will not say more."""
        state, conf = self.state()
        zone = None
        i = int(np.argmax(self.belief.p))
        if state == "in_room" and self.belief.p[i] >= ZONE_FLOOR and self.reference_ok \
                and self.zmap.zones[i].in_room:
            zone = self.zmap.zones[i].id
        act = self._activity(state)
        why = self.unsure_reason
        if why is None and state == "in_room" and zone is None:
            why = NO_REFERENCE if not self.reference_ok else "no zone is sure enough"
        return {"state": state, "zone": zone, "activity": act["state"] if act else None,
                "confidence": conf, "why": why}
