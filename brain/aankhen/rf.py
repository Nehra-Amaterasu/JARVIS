"""Aankhen RF physics: the 2.4 GHz channel between a Wi-Fi transmitter and the ESP32,
built from first principles instead of tuned to look right.

WHAT THE ESP32 MEASURES
  For every packet it decodes, the ESP32 reports the channel state information: one
  complex number per OFDM subcarrier, H(f_k), k = -26..26 (312.5 kHz apart, 20 MHz
  channel). Physically H is the sum of every path the signal took:

      H(f) = sum_i  a_i * exp(-j 2 pi f L_i / c)                                  (1)

  a_i is the path's amplitude and L_i its length. A person adds paths that bounce
  off their body, and blocks part of the others. Everything Aankhen can know about a
  person through Wi-Fi is in how those terms change with time.

THE PATHS, AND THE PHYSICS OF EACH AMPLITUDE (lambda = c / f ~ 12.3 cm)
  Direct (line of sight), Friis free-space field:
      a_los = lambda / (4 pi d) * W                                               (2)
  Specular reflection off a wall, floor or ceiling (image method: mirror the
  transmitter in the surface; the path length is the distance from the image):
      a_ref = Gamma * lambda / (4 pi L) * W                                       (3)
  A scatterer (a body part, furniture) with radar cross section sigma, d1 from the
  transmitter and d2 from the receiver (bistatic radar equation, amplitude form):
      a_sc = lambda * sqrt(sigma) / ((4 pi)^(3/2) d1 d2) * W                      (4)
  W = 10^(-n * wall_loss_db / 20) for a path that goes through n walls.

  Dividing (4) by (2): a_sc / a_los = sqrt(sigma / 4 pi) * d / (d1 d2). A body is
  strongest near EITHER END of the link (d1 or d2 small) and weakest far from both.
  This is why someone walking past a router in the hallway can move the channel
  more than someone sitting in the middle of the room.

  Shadowing: a body standing in a path diffracts around it. Modelled as a single
  knife edge (ITU-R P.526), with the edge being the side of the body nearest the
  path or its top:
      v = h * sqrt(2 (d1 + d2) / (lambda d1 d2))      h > 0: the edge obstructs
      J(v) = 6.9 + 20 log10( sqrt((v - 0.1)^2 + 1) + v - 0.1 )  dB, v > -0.78   (5)

BREATHING, AND WHY SOME PLACES ARE BLIND
  The chest moves delta (a few mm) along its normal n. The bounce path then changes
  by exactly
      dL = delta * n . (u_tx + u_rx)                                              (6)
  where u_tx, u_rx are unit vectors from the transmitter and the receiver to the
  chest. |u_tx + u_rx| = 2 cos(beta / 2), beta being the angle tx-chest-rx: up to
  2 delta facing the bisector far from the link, but almost nothing ON the line
  between the two radios (beta ~ 180 deg). Lying on your back, n points up, so only
  the vertical parts of u_tx, u_rx count.

  The chest term rotates by k dL (k = 2 pi / lambda; 6 mm of path is ~0.3 rad) on
  top of the large static sum H0. The ESP32's AMPLITUDE changes by
      d|H| = a_chest * k * dL * sin(psi)                                          (7)
  where psi is the angle between the chest term and H0. When psi is 0 or 180 deg the
  chest term only rotates H's PHASE, which a single unsynchronised ESP32 cannot use.
  These are the Fresnel-zone blind spots of the respiration literature. Because psi
  depends on frequency through the excess path length, the 52 subcarriers help only
  a little: a 2 m excess path rotates psi by ~0.7 rad across the whole channel.

THE RECEIVER (ESP32-S3), WHAT IT ADDS
  - thermal noise: kTB * NF over 20 MHz, about -101 dBm + NF ~ -93 dBm; per-subcarrier
    SNR = RSSI - noise floor, +3 dB from averaging the two LTF symbols;
  - an implementation floor: CSI SNR never exceeds impl_snr_db (EVM-limited);
  - AGC: the gain is set per packet from the preamble, in steps, so the reported
    amplitude follows the received power only to within a step;
  - phase: a random common phase and a timing-offset slope per packet (carrier and
    sampling offsets, packet-detection delay), so raw phase is unusable;
  - int8 I and Q.

WHAT IS MEASURED AND WHAT IS ASSUMED
  Every parameter in RFParams says where its default comes from, with a range. The
  ones that matter most for breathing (wall loss, body RCS, the environment's own
  slow noise) differ between rooms, so `python -m aankhen validate` measures them in
  the real room and this model is then re-run with the measured values.
"""
from __future__ import annotations

import math
from dataclasses import dataclass, field
from typing import Optional

import numpy as np

from .room import TORSO_HEIGHT_M, Room, SensorPose

C = 299_792_458.0
K_BOLTZMANN = 1.380649e-23
SUBCARRIER_SPACING_HZ = 312_500.0
SUBCARRIERS = np.array([s for s in range(-26, 27) if s != 0])     # 52 occupied LLTF bins
BANDWIDTH_HZ = 20e6


def channel_center_hz(channel: int) -> float:
    """2.4 GHz Wi-Fi channel number -> centre frequency (802.11, channels 1-14)."""
    if channel == 14:
        return 2.484e9
    if not 1 <= channel <= 13:
        raise ValueError(f"2.4 GHz channel must be 1-14, got {channel}")
    return (2407 + 5 * channel) * 1e6


# ============================================================== formulas
def friis_amplitude(d: float, lam: float) -> float:
    """Free-space field amplitude ratio over distance d (eq. 2)."""
    return lam / (4 * math.pi * max(d, 1e-3))


def bistatic_amplitude(d1: float, d2: float, lam: float, rcs_m2: float) -> float:
    """Field amplitude ratio of a scatterer of radar cross section rcs (eq. 4)."""
    return lam * math.sqrt(rcs_m2) / ((4 * math.pi) ** 1.5 * max(d1, 1e-3) * max(d2, 1e-3))


def diffraction_v(h: float, d1: float, d2: float, lam: float) -> float:
    """Fresnel-Kirchhoff diffraction parameter for an edge h above the path (eq. 5)."""
    d1, d2 = max(d1, 1e-3), max(d2, 1e-3)
    return h * math.sqrt(2 * (d1 + d2) / (lam * d1 * d2))


def knife_edge_loss_db(v: float) -> float:
    """ITU-R P.526 single knife-edge diffraction loss J(v) in dB (eq. 5); 0 for v <= -0.78."""
    if v <= -0.78:
        return 0.0
    return 6.9 + 20 * math.log10(math.sqrt((v - 0.1) ** 2 + 1) + v - 0.1)


def fresnel_radius(d1: float, d2: float, lam: float, n: int = 1) -> float:
    """Radius of the n-th Fresnel zone at d1, d2 from the two ends."""
    return math.sqrt(n * lam * d1 * d2 / (d1 + d2)) if d1 + d2 > 0 else 0.0


def sanitized_phase(H: np.ndarray, sc: np.ndarray = SUBCARRIERS) -> np.ndarray:
    """Phase across subcarriers with its best straight line removed.

    A single ESP32's raw phase carries, every packet, a random common offset (carrier
    frequency offset, random initial phase) and a slope across subcarriers (timing:
    packet-detection delay, sampling-clock offset). Both are linear in the subcarrier
    index, so a least-squares line fit removes them exactly. What remains is the
    curvature of the phase across frequency, which the multipath (and a breathing
    chest in it) shapes, but the random offsets cannot.
    """
    ph = np.unwrap(np.angle(H))
    A = np.vstack([sc, np.ones_like(sc)]).T.astype(float)
    coef, *_ = np.linalg.lstsq(A, ph, rcond=None)
    return ph - A @ coef


def path_gradient(p: np.ndarray, tx: np.ndarray, rx: np.ndarray) -> np.ndarray:
    """d(|p - tx| + |p - rx|) / dp = u_tx + u_rx (eq. 6): how the bounce path off a
    point p lengthens per metre that p moves."""
    a, b = p - tx, p - rx
    return a / max(np.linalg.norm(a), 1e-9) + b / max(np.linalg.norm(b), 1e-9)


# ============================================================== parameters
@dataclass
class RFParams:
    """Physical constants of one room. Defaults are typical values; the comment on
    each says where it comes from and how far real rooms vary. Measured values from
    `python -m aankhen validate` replace them."""
    channel: int = 6
    # Router EIRP. Home routers transmit 17-20 dBm on 2.4 GHz plus 2-5 dBi antennas;
    # India's licence-exempt limit for 2.4 GHz is 4 W EIRP. Only ratios matter for
    # detection; this sets the RSSI and hence the thermal SNR.
    tx_eirp_dbm: float = 20.0
    rx_gain_dbi: float = 2.0                   # ESP32-S3 module PCB/ceramic antenna
    noise_figure_db: float = 8.0               # -> noise floor ~ -93 dBm in 20 MHz
    # The best CSI SNR an ESP32 reaches however strong the signal (EVM floor of the
    # receiver: phase noise, I/Q imbalance, ADC). Measured on the ESP32-S3: equalised
    # amplitude SD 0.035-0.037 (Portner et al., IEEE IoT-J 2026), i.e. ~29 dB.
    impl_snr_db: float = 28.0
    # One-way loss through one wall at 2.437 GHz, normal incidence, from the ITU-R
    # P.2040-3 material model (single slab): 23 cm brick 6.4 dB (5.6-6.6), plain
    # concrete 15-20 cm 11.5-14.7 dB, wooden door ~0.7 dB. Measured at 2.3 GHz
    # (Wilson 2002): 10 cm brick 4.4 dB, 19 cm cinder block 6.7 dB. Plaster and rebar
    # add to it; RCC walls are not in P.2040. Default: plastered 23 cm brick.
    wall_loss_db: float = 7.0
    # |reflection coefficient| at 2.4 GHz: P.2040 half-space brick 0.33, concrete
    # 0.40; measured brick 0.24, cinder block 0.41, drywall 0.25 (Wilson 2002).
    wall_gamma: float = 0.3
    floor_gamma: float = 0.4
    ceiling_gamma: float = 0.4
    # Whole-body radar cross section of an adult. 3GPP TR 38.901 Rel-19 7.9.2.1
    # (model 1): mean -1.37 dBsm = 0.73 m^2, log-normal with sigma 3.94 dB, angle
    # independent; FDTD (ARL-TR-4290): -4 to 0 dBsm aspect-averaged. No direct
    # 2.4 GHz measurement was found. Split over body parts in BODY_PARTS.
    body_rcs_m2: float = 0.73
    # Unlisted clutter (shelves, bags, a chair): this many point scatterers with RCS
    # drawn from clutter_rcs_m2. They make every simulated room's channel different.
    n_clutter: int = 6
    clutter_rcs_m2: tuple = (0.05, 0.5)
    furniture_rcs_m2: float = 0.3
    # Body as an obstacle: a vertical cylinder this wide (shoulders ~0.45 m).
    body_radius_m: float = 0.2
    # AGC gain steps of the ESP32's receiver.
    agc_step_db: float = 1.0


# Body parts as point scatterers: (name, share of the body RCS, height when standing,
# seated, lying). Torso parts dominate: they are the largest and flattest.
BODY_PARTS = (
    ("chest", 0.30, 1.30, 1.00, None),
    ("abdomen", 0.25, 1.05, 0.80, None),
    ("head", 0.08, 1.62, 1.25, None),
    ("arm_l", 0.07, 1.10, 0.80, None),
    ("arm_r", 0.07, 1.10, 0.80, None),
    ("leg_l", 0.115, 0.50, 0.45, None),
    ("leg_r", 0.115, 0.50, 0.45, None),
)
BED_TOP_M = TORSO_HEIGHT_M["lying"] - 0.10      # the body lies on a mattress this high
BODY_TOP_M = {"standing": 1.75, "seated": 1.35, "lying": TORSO_HEIGHT_M["lying"] + 0.15}
# Abdomen moves more than the chest in quiet breathing, most of all lying down.
ABDOMEN_OVER_CHEST = 1.3


@dataclass
class Body:
    """A person as the radio sees them at one instant."""
    name: str
    x: float
    y: float
    heading: float              # radians, the way the chest faces (floor plane)
    posture: str                # standing | seated | lying
    speed: float = 0.0          # m/s along the floor
    gait_phase: float = 0.0     # radians, limb swing while walking
    chest_m: float = 0.0        # chest displacement along its normal now (breathing)


def body_points(b: Body) -> list[tuple[str, np.ndarray, float, Optional[np.ndarray]]]:
    """[(part, position, rcs share, displacement normal or None)] for one body.

    Standing and seated: the chest and abdomen move along the facing direction.
    Lying (on the back): they move straight up, and the body extends along heading.
    Walking: arms and legs swing fore and aft, in opposite phase (micro-Doppler).
    """
    fx, fy = math.cos(b.heading), math.sin(b.heading)
    lx, ly = -fy, fx                                     # to the body's left
    out = []
    swing = 0.0 if b.speed < 0.1 else min(0.35, 0.3 * b.speed)
    for name, share, h_st, h_se, _ in BODY_PARTS:
        if b.posture == "lying":
            # head end at +0.75 m along heading, feet at -0.8 m, all at mattress height
            along = {"chest": 0.45, "abdomen": 0.15, "head": 0.8, "arm_l": 0.3, "arm_r": 0.3,
                     "leg_l": -0.5, "leg_r": -0.5}[name]
            side = {"arm_l": 0.25, "arm_r": -0.25, "leg_l": 0.1, "leg_r": -0.1}.get(name, 0.0)
            z = TORSO_HEIGHT_M["lying"] + (0.05 if name in ("chest", "abdomen") else 0.0)
            p = np.array([b.x + along * fx + side * lx, b.y + along * fy + side * ly, z])
            normal = np.array([0.0, 0.0, 1.0]) if name in ("chest", "abdomen") else None
        else:
            z = h_st if b.posture == "standing" else h_se
            side = {"arm_l": 0.22, "arm_r": -0.22, "leg_l": 0.1, "leg_r": -0.1}.get(name, 0.0)
            fore = 0.0
            if swing and name.startswith(("arm", "leg")):
                sgn = 1.0 if name in ("arm_l", "leg_r") else -1.0
                fore = sgn * swing * math.sin(b.gait_phase)
            p = np.array([b.x + fore * fx + side * lx, b.y + fore * fy + side * ly, z])
            normal = np.array([fx, fy, 0.0]) if name in ("chest", "abdomen") else None
        out.append((name, p, share, normal))
    return out


# ============================================================== geometry
class RoomGeometry:
    """The room as a box [0, W] x [0, D] x [0, H] with walls, floor and ceiling."""

    def __init__(self, room: Room):
        self.W, self.D, self.H = room.width, room.depth, room.height

    def inside(self, p) -> bool:
        return 0.0 <= p[0] <= self.W and 0.0 <= p[1] <= self.D

    def wall_crossings(self, a, b) -> int:
        """How many vertical walls the segment a -> b passes through (0, 1 or 2)."""
        ia, ib = self.inside(a), self.inside(b)
        if ia != ib:
            return 1
        if ia:
            return 0
        # Both outside: 2 if the segment passes through the room (slab test in 2D).
        t0, t1 = 0.0, 1.0
        for k, hi in ((0, self.W), (1, self.D)):
            d = b[k] - a[k]
            if abs(d) < 1e-12:
                if not 0.0 <= a[k] <= hi:
                    return 0
                continue
            u0, u1 = (0.0 - a[k]) / d, (hi - a[k]) / d
            if u0 > u1:
                u0, u1 = u1, u0
            t0, t1 = max(t0, u0), min(t1, u1)
            if t0 > t1:
                return 0
        return 2

    def surfaces(self, p: RFParams):
        """(axis, coordinate, gamma, is_wall) of the six surfaces."""
        return [(0, 0.0, p.wall_gamma, True), (0, self.W, p.wall_gamma, True),
                (1, 0.0, p.wall_gamma, True), (1, self.D, p.wall_gamma, True),
                (2, 0.0, p.floor_gamma, False), (2, self.H, p.ceiling_gamma, False)]

    def reflection(self, tx: np.ndarray, rx: np.ndarray, axis: int, coord: float, is_wall: bool):
        """First-order specular path off one surface: (length, reflection point) or None.

        Image method: mirror tx in the plane; the path is the straight line from the
        image to rx, reflecting where it meets the plane. The point must lie on the
        actual surface (inside the room's extent), and both ends on the same side.
        """
        if (tx[axis] - coord) * (rx[axis] - coord) <= 0:
            return None
        img = tx.copy()
        img[axis] = 2 * coord - tx[axis]
        d = rx - img
        if abs(d[axis]) < 1e-12:
            return None
        s = (coord - img[axis]) / d[axis]
        q = img + s * d
        if is_wall:
            other = 1 - axis
            hi = self.D if axis == 0 else self.W
            if not (0.0 <= q[other] <= hi and 0.0 <= q[2] <= self.H):
                return None
        else:
            if not (0.0 <= q[0] <= self.W and 0.0 <= q[1] <= self.D):
                return None
        return float(np.linalg.norm(d)), q


# ============================================================== the channel
@dataclass
class StaticPath:
    kind: str                   # los | wall | floor | ceiling | clutter | furniture
    length: float
    amp: float
    points: list                # polyline tx -> ... -> rx (for shadowing)
    drifts: bool = False        # part of the environment that slowly moves


class Channel:
    """H(f) for one transmitter -> receiver link in a room (eq. 1-5)."""

    def __init__(self, room: Room, tx: SensorPose, rx: SensorPose,
                 params: Optional[RFParams] = None, rng: Optional[np.random.Generator] = None):
        self.p = params or RFParams()
        self.room = room
        self.geo = RoomGeometry(room)
        self.fc = channel_center_hz(self.p.channel)
        self.f = self.fc + SUBCARRIERS * SUBCARRIER_SPACING_HZ
        self.lam = C / self.fc
        self.k = 2 * math.pi * self.f / C
        self.tx = np.array([tx.x, tx.y, tx.z], dtype=float)
        self.rx = np.array([rx.x, rx.y, rx.z], dtype=float)
        rng = rng or np.random.default_rng(0)
        self.paths = self._static_paths(room, rng)
        L = np.array([p.length for p in self.paths])
        A = np.array([p.amp for p in self.paths])
        self._L, self._A = L, A
        self._phasors = A[None, :] * np.exp(-1j * np.outer(self.k, L))      # (52, n_paths)
        self._drift_mask = np.array([p.drifts for p in self.paths])

    # ---------------------------------------------------------- static world
    def _wall_factor(self, *pts) -> float:
        n = sum(self.geo.wall_crossings(a, b) for a, b in zip(pts[:-1], pts[1:]))
        return 10 ** (-n * self.p.wall_loss_db / 20)

    def _static_paths(self, room: Room, rng: np.random.Generator) -> list[StaticPath]:
        tx, rx, lam, P = self.tx, self.rx, self.lam, self.p
        d = float(np.linalg.norm(tx - rx))
        out = [StaticPath("los", d, friis_amplitude(d, lam) * self._wall_factor(tx, rx), [tx, rx])]
        for axis, coord, gamma, is_wall in self.geo.surfaces(P):
            hit = self.geo.reflection(tx, rx, axis, coord, is_wall)
            if hit is None:
                continue
            L, q = hit
            kind = "wall" if is_wall else ("floor" if axis == 2 and coord == 0.0 else "ceiling")
            out.append(StaticPath(kind, L, gamma * friis_amplitude(L, lam) * self._wall_factor(tx, q, rx),
                                  [tx, q, rx]))
        for f in room.furniture:
            q = np.array([f.x + f.w / 2, f.y + f.d / 2, f.h * 0.75])
            d1, d2 = float(np.linalg.norm(q - tx)), float(np.linalg.norm(q - rx))
            out.append(StaticPath("furniture", d1 + d2,
                                  bistatic_amplitude(d1, d2, lam, P.furniture_rcs_m2) * self._wall_factor(tx, q, rx),
                                  [tx, q, rx]))
        lo, hi = P.clutter_rcs_m2
        for i in range(P.n_clutter):
            q = np.array([rng.uniform(0.2, room.width - 0.2), rng.uniform(0.2, room.depth - 0.2),
                          rng.uniform(0.1, room.height - 0.3)])
            d1, d2 = float(np.linalg.norm(q - tx)), float(np.linalg.norm(q - rx))
            rcs = float(rng.uniform(lo, hi))
            # The first clutter point stands for what slowly moves on its own (a door
            # left ajar, a curtain): only it follows Channel.drift_rad.
            out.append(StaticPath("clutter", d1 + d2,
                                  bistatic_amplitude(d1, d2, lam, rcs) * self._wall_factor(tx, q, rx),
                                  [tx, q, rx], drifts=(i == 0)))
        return out

    def static_response(self, drift_rad: float = 0.0) -> np.ndarray:
        if drift_rad == 0.0:
            return self._phasors.sum(axis=1)
        rot = np.where(self._drift_mask, np.exp(1j * drift_rad), 1.0)
        return (self._phasors * rot[None, :]).sum(axis=1)

    # ---------------------------------------------------------- people
    def shadow_db(self, path: StaticPath, b: Body) -> float:
        """Knife-edge loss a body adds to one static path (eq. 5), worst segment."""
        r, top = self.p.body_radius_m, BODY_TOP_M.get(b.posture, 1.75)
        if b.posture == "lying":
            r = 0.25
        worst = 0.0
        pts = path.points
        for a, c in zip(pts[:-1], pts[1:]):
            seg = c - a
            L2 = float(seg[0] ** 2 + seg[1] ** 2)
            if L2 < 1e-12:
                continue
            t = ((b.x - a[0]) * seg[0] + (b.y - a[1]) * seg[1]) / L2
            if not 0.02 < t < 0.98:
                continue
            q = a + t * seg
            perp = math.hypot(b.x - q[0], b.y - q[1])
            seg_len = float(np.linalg.norm(seg))
            d1, d2 = t * seg_len, (1 - t) * seg_len
            h_side = r - perp                     # > 0: the body's side juts into the path
            h_top = top - q[2]                    # > 0: the body's top is above the path
            # Both must obstruct for the body to block; the weaker obstruction is the
            # edge the wave diffracts around.
            h = min(h_side, h_top)
            v = diffraction_v(h, d1, d2, self.lam)
            worst = max(worst, knife_edge_loss_db(v))
        return worst

    def body_response(self, bodies: list[Body]) -> tuple[np.ndarray, np.ndarray]:
        """(sum of body bounce paths H_b(f), amplitude factor per static path)."""
        factor = np.ones(len(self.paths))
        if not bodies:
            return np.zeros(self.f.size, dtype=complex), factor
        pts, rcs, walls = [], [], []
        for b in bodies:
            for name, q, share, normal in body_points(b):
                if normal is not None and b.chest_m:
                    q = q + normal * b.chest_m * (ABDOMEN_OVER_CHEST if name == "abdomen" else 1.0)
                pts.append(q)
                rcs.append(self.p.body_rcs_m2 * share)
                walls.append(self._wall_factor(self.tx, q, self.rx))
            for i, path in enumerate(self.paths):
                if path.kind in ("clutter", "furniture"):
                    continue
                loss = self.shadow_db(path, b)
                if loss > 0.0:
                    factor[i] *= 10 ** (-loss / 20)
        P = np.array(pts)
        d1 = np.maximum(np.linalg.norm(P - self.tx, axis=1), 1e-3)
        d2 = np.maximum(np.linalg.norm(P - self.rx, axis=1), 1e-3)
        amp = self.lam * np.sqrt(np.array(rcs)) / ((4 * math.pi) ** 1.5 * d1 * d2) * np.array(walls)
        Hb = np.exp(-1j * np.outer(self.k, d1 + d2)) @ amp                 # eq. 4 summed
        return Hb, factor

    def scatter(self, points: np.ndarray, rcs: np.ndarray) -> np.ndarray:
        """H(f) of extra point scatterers (fan blades): eq. 4 for each, summed."""
        if len(points) == 0:
            return np.zeros(self.f.size, dtype=complex)
        P = np.asarray(points, dtype=float)
        d1 = np.maximum(np.linalg.norm(P - self.tx, axis=1), 1e-3)
        d2 = np.maximum(np.linalg.norm(P - self.rx, axis=1), 1e-3)
        w = np.array([self._wall_factor(self.tx, q, self.rx) for q in P])
        amp = self.lam * np.sqrt(np.asarray(rcs, dtype=float)) / ((4 * math.pi) ** 1.5 * d1 * d2) * w
        return np.exp(-1j * np.outer(self.k, d1 + d2)) @ amp

    def response(self, bodies: list[Body], drift_rad: float = 0.0) -> np.ndarray:
        """The true H(f) on the 52 subcarriers (field amplitude, relative to the EIRP)."""
        Hb, factor = self.body_response(bodies)
        if drift_rad:
            rot = np.where(self._drift_mask, np.exp(1j * drift_rad), 1.0)
            Hs = (self._phasors * (factor * rot)[None, :]).sum(axis=1)
        else:
            Hs = (self._phasors * factor[None, :]).sum(axis=1)
        return Hs + Hb

    # ---------------------------------------------------------- link budget
    def rx_power_dbm(self, H: np.ndarray) -> float:
        """RSSI the ESP32 would report for this channel."""
        p = float(np.mean(np.abs(H) ** 2))
        return self.p.tx_eirp_dbm + self.p.rx_gain_dbi + 10 * math.log10(max(p, 1e-30))

    def noise_floor_dbm(self) -> float:
        return 10 * math.log10(K_BOLTZMANN * 290 * BANDWIDTH_HZ * 1000) + self.p.noise_figure_db

    def csi_snr_db(self, H: np.ndarray) -> float:
        """Per-subcarrier SNR of the CSI estimate: thermal (+3 dB, two LTF symbols)
        combined with the receiver's implementation floor."""
        thermal = self.rx_power_dbm(H) - self.noise_floor_dbm() + 3.0
        return -10 * math.log10(10 ** (-thermal / 10) + 10 ** (-self.p.impl_snr_db / 10))


# ============================================================== the ESP32 receiver
class Esp32Receiver:
    """Turns a true H(f) into what the ESP32-S3 reports: AGC, noise, phase, int8.

    target_counts: the RMS |I + jQ| the ESP32's automatic CSI scaling aims at.
    Every packet also yields last_comp_db: what the firmware reports through
    Espressif's esp_csi_gain_ctrl so the host can undo the gain (CSI_GAIN frames).

    WHY THE GAIN MATTERS SO MUCH: a person moves the whole channel up and down
    together far more than they reshape it across frequency (through a wall the
    channel is nearly flat). Dividing each packet by its own median — the only
    defence without gain information — removes that common part. On the physical
    simulator it removed 90-99 % of a walker's signal (2026-10-10).
    """

    def __init__(self, channel: Channel, rng: np.random.Generator, target_counts: float = 30.0,
                 timing_offset_ns: float = 25.0, agc_jitter_steps: float = 0.7,
                 comp_err_db: float = 0.25):
        self.ch = channel
        self.rng = rng
        self.target = target_counts
        self.timing_offset_ns = timing_offset_ns
        # The ESP32-S3's gain choice is "almost random" packet to packet (Portner et
        # al., IEEE IoT-J 2026): modelled as a jump of round(N(0, agc_jitter_steps))
        # steps on top of level tracking. comp_err_db: error of the compensation the
        # firmware reports (esp_csi_gain_ctrl); unknown, assumed 0.25 dB.
        self.agc_jitter_steps = agc_jitter_steps
        self.comp_err_db = comp_err_db
        self._gain_db: Optional[float] = None
        self._g0_db: Optional[float] = None
        self.last_rssi = -60.0
        self.last_snr_db = 30.0
        self.last_comp_db: Optional[float] = None
        self.last_agc_gain = 0

    def _agc(self, rssi_dbm: float) -> float:
        """Gain in dB, in steps, with hysteresis: it tracks the received level but only
        moves when the error exceeds a step (what makes ESP32 CSI amplitudes jump)."""
        step = self.ch.p.agc_step_db
        want = -rssi_dbm
        if self._gain_db is None or abs(want - self._gain_db) > step:
            self._gain_db = step * round(want / step)
        return self._gain_db

    def capture(self, H: np.ndarray) -> tuple[np.ndarray, int]:
        """(int8 I/Q pairs per subcarrier as complex, RSSI dBm) for one packet.
        After the call, last_comp_db holds the gain compensation the firmware would
        report: adding it (in dB) to the amplitudes undoes this packet's gain."""
        rssi = self.ch.rx_power_dbm(H)
        snr_db = self.ch.csi_snr_db(H)
        self.last_rssi, self.last_snr_db = rssi, snr_db
        p_mean = float(np.mean(np.abs(H) ** 2))
        sigma = math.sqrt(p_mean / (2 * 10 ** (snr_db / 10)))
        noisy = H + self.rng.normal(0, sigma, H.size) + 1j * self.rng.normal(0, sigma, H.size)
        # AGC: tracks the level in steps (hysteresis), plus an almost random jump.
        step = self.ch.p.agc_step_db
        gain_db = self._agc(rssi)
        level_db = rssi + gain_db                  # within +-step of 0 dB
        jitter_db = step * round(float(self.rng.normal(0, self.agc_jitter_steps)))
        residual_db = level_db + jitter_db
        scale = self.target / math.sqrt(max(p_mean, 1e-30)) * 10 ** (residual_db / 20)
        # Total gain applied to the field, in dB; compensation brings every packet back
        # to the first packet's gain, so amplitudes become proportional to |H| again.
        g_db = 20 * math.log10(scale)
        if self._g0_db is None:
            self._g0_db = g_db
        self.last_comp_db = self._g0_db - g_db + float(self.rng.normal(0, self.comp_err_db))
        self.last_agc_gain = int(round(gain_db + jitter_db)) % 256
        # Phase impairments: common phase + slope from a per-packet timing offset.
        phi0 = self.rng.uniform(0, 2 * math.pi)
        tau = self.rng.normal(0, self.timing_offset_ns * 1e-9)
        ph = phi0 - 2 * math.pi * SUBCARRIERS * SUBCARRIER_SPACING_HZ * tau
        y = noisy * scale * np.exp(1j * ph)
        re = np.clip(np.round(y.real), -127, 127)
        im = np.clip(np.round(y.imag), -127, 127)
        return re + 1j * im, int(round(max(-100.0, min(-10.0, rssi))))
