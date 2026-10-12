"""What can this Wi-Fi link sense, and where? Predictions from rf.py, per floor cell.

    python -m aankhen physics [--room room.json] [--out report.html] [--place]

BREATHING (seated, lying): how much does a chest moving +-chest_mm change the
  amplitudes the pipeline sees (each packet divided by its median, as csi.py does)?
  Converted to the SNR of the breathing line in RespirationDetector's spectrum (25 s
  windows, 100 Hz decimated to 10 Hz, best 8 subcarriers):
      SNR = sum_top8  N m_f^2 / (4 (sigma_f^2 / 10 + sigma_env^2))               (8)
  m_f: modulation of subcarrier f (a central difference, so it contains the blind
  spots of rf.py eq. 7); sigma_f: noise of one raw sample (thermal + int8);
  sigma_env: the room's own slow amplitude wander in the breathing band, which no
  formula gives. `python -m aankhen validate` measures it; until then an assumed
  value is used and the report says so.

  BLIND SPOTS ARE THIN BANDS, NOT REGIONS. Moving the chest ~3 cm changes the bounce
  path by ~6 cm, half a wavelength, and turns a visible spot into a blind one. On a
  20 cm grid the pattern aliases: two grids offset by 10 cm gave 75 % and 28 %
  "likely" for the same desk (2026-10-10). So every cell is a Monte Carlo average
  over random positions inside it and random facing directions (or the zone's
  facing_deg +- 25 deg), and the result is a PROBABILITY: of the places and ways you
  might sit here, in how many is breathing visible.

WALKING: variance of the normalised amplitudes over a few gait states and steps
  around the cell, against the noise of one sample. That gives the lag-1
  autocorrelation a motion detector sees, rho = s/(s+1), s = motion/noise power
  (at 100 Hz, walking decorrelates far slower than 10 ms). With no motion, rho over
  1 s of 51 subcarriers has a standard deviation of 1/sqrt(100 * 51) = 0.014, so
  rho > 0.045 is a 0.1 % false-alarm test.

OUTSIDE THE ROOM: walking only. A hallway as sensitive as the room is a warning:
  the link cannot tell them apart (the 2026-10-09 hallway scenario).

TWO PIPELINES. mode="gain": firmware with Espressif's esp_csi_gain_ctrl reports
  each packet's receiver gain, the host undoes it, and amplitudes keep the part of a
  person's effect common to all subcarriers (a COMP_ERR_DB error per packet is
  assumed). mode="normalised": without it, every packet is divided by its own
  median, which removes that common part (90-99 % of a walker's signal on the
  simulator). Same physics, very different visibility.

ROOMS. What else is in the room (unlisted clutter) decides whether the static paths
  add up or cancel, and so how large a person's reflection is next to them: two
  equally plausible draws gave 68 % and 9 % "likely" for the same desk. The model
  cannot know your room's draw, so it runs several and reports the spread; only a
  measurement (`validate`) pins it down.

Verdicts per sample: >= 19.4 dB likely (the detector passes 90 % of windows),
17.2-19.4 dB marginal (50-90 %), below unlikely: calibrated against the detector by
aankhen/tests/calibrate_physics.py. They are predictions, not measurements;
`validate` checks them in the room.
"""
from __future__ import annotations

import json
import math
import os
from dataclasses import asdict, dataclass, field
from typing import Optional

import numpy as np

from .rf import Body, Channel, RFParams
from . import DATA_DIR
from .room import Room, SensorPose

RF_CAL_FILE = os.path.join(DATA_DIR, "rf_calibration.json")

# Defaults stated as assumptions. chest: peak displacement in quiet breathing (2-6 mm,
# see docs/design/aankhen-physics.md). sigma_env: relative amplitude wander per 0.1 s
# sample in 0.1-0.5 Hz in an empty room: an ASSUMPTION until measured.
CHEST_MM = 3.0
SIGMA_ENV_ASSUMED = 0.004
TARGET_COUNTS = 30.0             # RMS |I + jQ| of an ESP32 CSI capture, in counts
WINDOW_N = 250                   # 25 s at 10 Hz
DECIM = 10
TOP_K = 8
# Verdict lines calibrated against the real detector, not chosen: with the breathing
# SNR of eq. 8 (shared compensation noise included), RespirationDetector passes half
# its windows at 17.2 dB and 90 % at 19.4 dB (aankhen/tests/calibrate_physics.py, 40
# still people at random poses in 4 simulated rooms, gain pipeline, 2026-10-10). The
# first lines (10 / 4 dB) were guesses, and 13 dB too generous.
LIKELY_DB, MARGINAL_DB = 19.4, 17.2
RHO_THRESHOLD = 3.09 / math.sqrt(100 * 51)
FACING_SPREAD_DEG = 25.0
COMP_ERR_DB = 0.25               # error of the firmware's gain compensation, per packet
MODES = ("gain", "normalised")


@dataclass
class Calibration:
    """Room numbers measured by `validate` (empty if never run)."""
    sigma_env: Optional[float] = None
    params: dict = field(default_factory=dict)
    source: str = "assumed"
    # Error of the firmware's gain compensation, dB per packet (measured by validate
    # from the empty room's packet-to-packet level jitter). None: COMP_ERR_DB assumed.
    comp_err_db: Optional[float] = None

    @classmethod
    def load(cls, path: str = RF_CAL_FILE) -> "Calibration":
        if not os.path.exists(path):
            return cls()
        with open(path, encoding="utf-8") as f:
            d = json.load(f)
        return cls(d.get("sigma_env"), d.get("params", {}), d.get("source", path), d.get("comp_err_db"))

    def save(self, path: str = RF_CAL_FILE) -> None:
        with open(path, "w", encoding="utf-8") as f:
            json.dump(asdict(self), f, indent=2)


def norm_amp(H: np.ndarray) -> np.ndarray:
    a = np.abs(H)
    return a / max(float(np.median(a)), 1e-30)


def sample_noise(ch: Channel, H: np.ndarray) -> np.ndarray:
    """Std of one raw normalised-amplitude sample, per subcarrier: thermal noise at
    the CSI SNR plus int8 rounding of I and Q (1/12 count^2 each). The noise is the
    same in absolute terms on every subcarrier; a faded one just has less signal."""
    a = np.abs(H)
    rms = math.sqrt(float(np.mean(a ** 2)))
    thermal = rms / math.sqrt(2 * 10 ** (ch.csi_snr_db(H) / 10))
    quant = rms / TARGET_COUNTS * math.sqrt(1 / 12)
    return np.full(a.shape, math.hypot(thermal, quant) / max(float(np.median(a)), 1e-30))


def breathing_snr_db(ch: Channel, x: float, y: float, posture: str, heading: float,
                     chest_mm: float, sigma_env: float, mode: str = "gain",
                     comp_err_db: float = COMP_ERR_DB) -> float:
    H0 = ch.response([Body("p", x, y, heading, posture)])
    Hu = ch.response([Body("p", x, y, heading, posture, chest_m=chest_mm / 1000)])
    Hd = ch.response([Body("p", x, y, heading, posture, chest_m=-chest_mm / 1000)])
    var = sample_noise(ch, H0) ** 2 / DECIM + sigma_env ** 2
    if mode == "gain":
        ref = max(float(np.median(np.abs(H0))), 1e-30)
        m = (np.abs(Hu) - np.abs(Hd)) / 2 / ref               # signed: common-mode matters
        # The compensation error is ONE number per packet, shared by every subcarrier:
        # noise covariance R = var I + c 11^T. Combining subcarriers does not average
        # it away (2026-10-10: treating it as independent overstated breathing SNR by
        # ~10 dB against the real detector). Optimal combining over the top_k:
        #   SNR = N/4 m^T R^-1 m,  R^-1 = (I - c 11^T / (var + k c)) / var.
        c = (10 ** (comp_err_db / 20) - 1) ** 2 / DECIM
        top = np.argsort(np.abs(m) / np.sqrt(var))[::-1][:TOP_K]
        mt, vt = m[top], float(np.mean(var[top]))
        quad = (mt @ mt - c * mt.sum() ** 2 / (vt + mt.size * c)) / vt
        snr = WINDOW_N * quad / 4
    else:
        m = np.abs(norm_amp(Hu) - norm_amp(Hd)) / 2
        snr = float(np.sort(WINDOW_N * m ** 2 / (4 * var))[::-1][:TOP_K].sum())
    return 10 * math.log10(max(snr, 1e-6))


def walking_rho(ch: Channel, x: float, y: float, heading: float, rng: np.random.Generator,
                mode: str = "gain") -> float:
    fx, fy = math.cos(heading), math.sin(heading)
    states = [Body("p", x + (i - 4.5) * 0.06 * fx, y + (i - 4.5) * 0.06 * fy, heading, "standing",
                   speed=0.9, gait_phase=float(rng.uniform(0, 2 * math.pi))) for i in range(10)]
    Hs = [ch.response([b]) for b in states]
    s = sample_noise(ch, Hs[5])
    if mode == "gain":
        ref = max(float(np.median(np.abs(ch.response([])))), 1e-30)
        A = np.stack([np.abs(H) / ref for H in Hs])
        s = np.sqrt(s ** 2 + (10 ** (COMP_ERR_DB / 20) - 1) ** 2)
    else:
        A = np.stack([norm_amp(H) for H in Hs])
    snr = A.var(axis=0) / np.maximum(s ** 2, 1e-30)
    return float(np.mean(snr / (snr + 1)))


@dataclass
class CellResult:
    x: float
    y: float
    inside: bool
    zone: Optional[str]
    walk_rho: float
    seated_p: Optional[float] = None       # share of samples with breathing likely
    seated_db: Optional[float] = None      # median SNR of the samples
    lying_p: Optional[float] = None
    lying_db: Optional[float] = None
    samples: dict = field(default_factory=dict, repr=False)


@dataclass
class LinkReport:
    tx: str
    rx: str
    rssi_dbm: float
    noise_floor_dbm: float
    csi_snr_db: float
    los_distance_m: float
    walls_on_los: int
    fresnel_radius_mid_m: float
    sigma_env: float
    sigma_env_source: str
    chest_mm: float
    mode: str = "gain"
    rooms: int = 1
    cells: list = field(default_factory=list)
    zones: dict = field(default_factory=dict)
    outside_vs_inside_motion: Optional[float] = None


def _grid(room: Room, tx: SensorPose, rx: SensorPose, step: float):
    xs, ys = [0.0, room.width, tx.x, rx.x], [0.0, room.depth, tx.y, rx.y]
    x0, x1, y0, y1 = min(xs) - 0.5, max(xs) + 0.5, min(ys) - 0.5, max(ys) + 0.5
    return np.arange(x0 + step / 2, x1, step), np.arange(y0 + step / 2, y1, step)


def _headings(zone, posture: str, n: int, rng: np.random.Generator) -> np.ndarray:
    if zone is not None and zone.facing_deg is not None:
        return np.radians(zone.facing_deg + rng.uniform(-FACING_SPREAD_DEG, FACING_SPREAD_DEG, n))
    return rng.uniform(0, 2 * math.pi, n)


def analyse(room: Room, tx: SensorPose, rx: SensorPose, params: Optional[RFParams] = None,
            step: float = 0.2, chest_mm: float = CHEST_MM, cal: Optional[Calibration] = None,
            samples: int = 12, zones_only: bool = False, seed: int = 0, mode: str = "gain",
            rooms: int = 1) -> LinkReport:
    """rooms > 1: repeat over that many draws of the unlisted clutter and pool them;
    zone summaries then carry the spread across rooms ("likely_by_room")."""
    if rooms > 1:
        reps = [analyse(room, tx, rx, params, step, chest_mm, cal, samples, zones_only, seed + 7 * k,
                        mode, 1) for k in range(rooms)]
        out = reps[0]
        out.rooms = rooms
        for name, z in out.zones.items():
            per = [r.zones[name]["likely"] for r in reps if name in r.zones]
            z["likely_by_room"] = per
            for k in ("likely", "marginal", "unlikely", "median_db", "walk_detect"):
                z[k] = round(float(np.median([r.zones[name][k] for r in reps if name in r.zones])), 2)
        n = len(out.cells)
        for i, c in enumerate(out.cells):
            for key in ("walk_rho", "seated_p", "lying_p", "seated_db", "lying_db"):
                vals = [getattr(r.cells[i], key) for r in reps if i < len(r.cells)]
                vals = [v for v in vals if v is not None]
                if vals:
                    setattr(c, key, round(float(np.median(vals)), 3))
        ratios = [r.outside_vs_inside_motion for r in reps if r.outside_vs_inside_motion is not None]
        out.outside_vs_inside_motion = round(float(np.median(ratios)), 2) if ratios else None
        return out
    cal = cal or Calibration.load()
    params = params or RFParams(**{k: v for k, v in cal.params.items() if hasattr(RFParams, k)})
    sigma_env = cal.sigma_env if cal.sigma_env is not None else SIGMA_ENV_ASSUMED
    comp_err = cal.comp_err_db if cal.comp_err_db is not None else COMP_ERR_DB
    ch = Channel(room, tx, rx, params, np.random.default_rng(seed))
    H = ch.response([])
    rng = np.random.default_rng(seed + 1)
    d = float(np.linalg.norm(ch.tx - ch.rx))
    rep = LinkReport(tx.id, rx.id, round(ch.rx_power_dbm(H), 1), round(ch.noise_floor_dbm(), 1),
                     round(ch.csi_snr_db(H), 1), round(d, 2), ch.geo.wall_crossings(ch.tx, ch.rx),
                     round(math.sqrt(ch.lam * d / 4), 2), sigma_env,
                     cal.source if cal.sigma_env is not None
                     else "ASSUMED (run `python -m aankhen validate` to measure)", chest_mm, mode)
    gx, gy = _grid(room, tx, rx, step)
    for x in gx:
        for y in gy:
            inside = room.inside(x, y)
            zone = room.zone_at(x, y)
            if zones_only and not (inside and zone):
                continue
            if math.hypot(x - tx.x, y - tx.y) < 0.3 or math.hypot(x - rx.x, y - rx.y) < 0.3:
                continue
            c = CellResult(round(float(x), 2), round(float(y), 2), inside, zone.name if zone else None,
                           round(walking_rho(ch, x, y, float(rng.uniform(0, 2 * math.pi)), rng, mode), 4))
            if inside:
                post = zone.posture if zone and zone.posture in ("seated", "lying") else None
                for p in (("seated",) if post == "seated" else ("lying",) if post == "lying"
                          else ("seated", "lying")):
                    hs = _headings(zone, p, samples, rng)
                    jx = x + rng.uniform(-step / 2, step / 2, samples)
                    jy = y + rng.uniform(-step / 2, step / 2, samples)
                    v = np.array([breathing_snr_db(ch, float(a), float(b), p, float(h), chest_mm, sigma_env, mode,
                                                   comp_err)
                                  for a, b, h in zip(jx, jy, hs)])
                    setattr(c, f"{p}_p", round(float(np.mean(v >= LIKELY_DB)), 3))
                    setattr(c, f"{p}_db", round(float(np.median(v)), 1))
                    c.samples[p] = v
            rep.cells.append(c)
    for zone in room.zones:
        post = zone.posture if zone.posture in ("seated", "lying") else "seated"
        pooled = [c.samples[post] for c in rep.cells if c.zone == zone.name and c.inside and post in c.samples]
        cells = [c for c in rep.cells if c.zone == zone.name and c.inside]
        if not pooled:
            continue
        v = np.concatenate(pooled)
        rep.zones[zone.name] = {
            "posture": post, "samples": int(v.size), "facing_deg": zone.facing_deg,
            "median_db": round(float(np.median(v)), 1),
            "likely": round(float(np.mean(v >= LIKELY_DB)), 2),
            "marginal": round(float(np.mean((v >= MARGINAL_DB) & (v < LIKELY_DB))), 2),
            "unlikely": round(float(np.mean(v < MARGINAL_DB)), 2),
            "walk_detect": round(float(np.mean([c.walk_rho > RHO_THRESHOLD for c in cells])), 2),
        }
    ins = [c.walk_rho for c in rep.cells if c.inside]
    out = [c.walk_rho for c in rep.cells if not c.inside]
    if ins and out:
        rep.outside_vs_inside_motion = round(float(np.median(out) / max(np.median(ins), 1e-9)), 2)
    for c in rep.cells:
        c.samples = {}                                  # not needed after pooling
    return rep


def score_placement(rep: LinkReport) -> float:
    """Higher is better: the worst zone's share of likely-breathing samples (plus a
    little of the mean), minus a penalty when walking outside looks like inside."""
    if not rep.zones:
        return -1.0
    shares = [z["likely"] for z in rep.zones.values() if z["posture"] in ("seated", "lying")]
    if not shares:
        return -1.0
    pen = 0.25 * min(1.0, rep.outside_vs_inside_motion or 0.0)
    return min(shares) + 0.25 * float(np.mean(shares)) - pen


def search_placement(room: Room, tx: SensorPose, params: Optional[RFParams] = None,
                     heights=(0.8, 1.2, 1.8), spacing: float = 0.5, step: float = 0.35,
                     samples: int = 8, log=print) -> list[tuple[float, SensorPose, LinkReport]]:
    """Try the ESP32 along every wall (0.1 m in), best placements first."""
    W, D = room.width, room.depth
    cands = [(float(t), 0.1) for t in np.arange(0.25, W - 0.1, spacing)]
    cands += [(float(t), D - 0.1) for t in np.arange(0.25, W - 0.1, spacing)]
    cands += [(0.1, float(t)) for t in np.arange(0.25, D - 0.1, spacing)]
    cands += [(W - 0.1, float(t)) for t in np.arange(0.25, D - 0.1, spacing)]
    out = []
    for i, (x, y) in enumerate(cands):
        for h in heights:
            rx = SensorPose("esp32", "esp32", x, y, h)
            rep = analyse(room, tx, rx, params, step=step, samples=samples)
            out.append((score_placement(rep), rx, rep))
        if log and i % 8 == 0:
            log(f"  placement search {i + 1}/{len(cands)} positions")
    out.sort(key=lambda r: -r[0])
    return out


# ============================================================== HTML report
_VIRIDIS = [(68, 1, 84), (59, 82, 139), (33, 145, 140), (94, 201, 98), (253, 231, 37)]


def _color(v: float, lo: float, hi: float) -> str:
    t = 0.0 if hi <= lo else max(0.0, min(1.0, (v - lo) / (hi - lo)))
    i = min(int(t * (len(_VIRIDIS) - 1)), len(_VIRIDIS) - 2)
    u = t * (len(_VIRIDIS) - 1) - i
    a, b = _VIRIDIS[i], _VIRIDIS[i + 1]
    return "#%02x%02x%02x" % tuple(int(a[k] + (b[k] - a[k]) * u) for k in range(3))


def _svg_map(room: Room, rep: LinkReport, tx: SensorPose, rx: SensorPose, key: str,
             lo: float, hi: float, step: float, title: str, fmt) -> str:
    cells = [c for c in rep.cells if getattr(c, key) is not None]
    xs = [c.x for c in rep.cells] + [tx.x, rx.x, 0, room.width]
    ys = [c.y for c in rep.cells] + [tx.y, rx.y, 0, room.depth]
    x0, x1, y0, y1 = min(xs) - step, max(xs) + step, min(ys) - step, max(ys) + step
    S = 60.0
    w, h = (x1 - x0) * S, (y1 - y0) * S
    X = lambda x: (x - x0) * S
    Y = lambda y: (y1 - y) * S
    out = [f'<figure><figcaption>{title}</figcaption><svg viewBox="0 0 {w:.0f} {h + 34:.0f}" '
           f'width="100%" role="img" aria-label="{title}">']
    for c in cells:
        v = getattr(c, key)
        out.append(f'<rect x="{X(c.x - step / 2):.1f}" y="{Y(c.y + step / 2):.1f}" width="{step * S:.1f}" '
                   f'height="{step * S:.1f}" fill="{_color(v, lo, hi)}"><title>({c.x}, {c.y}) {fmt(v)}</title></rect>')
    out.append(f'<rect x="{X(0):.1f}" y="{Y(room.depth):.1f}" width="{room.width * S:.1f}" '
               f'height="{room.depth * S:.1f}" fill="none" stroke="#fff" stroke-width="3"/>')
    for z in room.zones:
        pts = " ".join(f"{X(px):.1f},{Y(py):.1f}" for px, py in z.polygon)
        out.append(f'<polygon points="{pts}" fill="none" stroke="#fff" stroke-dasharray="5 4" stroke-width="1.5"/>')
        cx, cy = z.centroid()
        out.append(f'<text x="{X(cx):.1f}" y="{Y(cy):.1f}" fill="#fff" font-size="13" text-anchor="middle">{z.name}</text>')
    out.append(f'<line x1="{X(tx.x):.1f}" y1="{Y(tx.y):.1f}" x2="{X(rx.x):.1f}" y2="{Y(rx.y):.1f}" '
               f'stroke="#ff4d4d" stroke-width="2" stroke-dasharray="8 5"/>')
    for s, lab in ((tx, "router" if tx.kind == "router" else tx.id), (rx, "ESP32")):
        out.append(f'<circle cx="{X(s.x):.1f}" cy="{Y(s.y):.1f}" r="7" fill="#ff4d4d" stroke="#fff" stroke-width="2"/>'
                   f'<text x="{X(s.x) + 10:.1f}" y="{Y(s.y) - 10:.1f}" fill="#fff" font-size="13">{lab}</text>')
    for i in range(10):
        out.append(f'<rect x="{10 + i * 28}" y="{h + 8:.0f}" width="28" height="12" '
                   f'fill="{_color(lo + (hi - lo) * i / 9, lo, hi)}"/>')
    out.append(f'<text x="300" y="{h + 19:.0f}" fill="currentColor" font-size="12">{fmt(lo)} to {fmt(hi)}</text>'
               '</svg></figure>')
    return "".join(out)


def html_report(room: Room, rep: LinkReport, tx: SensorPose, rx: SensorPose, step: float,
                placements: Optional[list] = None, compare: Optional[LinkReport] = None) -> str:
    def spread(z):
        v = z.get("likely_by_room")
        return f" <small>({min(v):.0%}–{max(v):.0%})</small>" if v else ""

    rows = "".join(
        f"<tr><td>{n}</td><td>{z['posture']}" + (f", facing {z['facing_deg']:g}°" if z.get("facing_deg") is not None else "")
        + f"</td><td>{z['likely']:.0%}{spread(z)}</td>"
        + (f"<td>{compare.zones[n]['likely']:.0%}{spread(compare.zones[n])}</td>" if compare and n in compare.zones else "<td>–</td>")
        + f"<td>{z['unlikely']:.0%}</td><td>{z['walk_detect']:.0%}</td></tr>" for n, z in rep.zones.items())
    place = ""
    if placements:
        place = ("<h2>Best ESP32 positions (searched along the walls)</h2><table><tr><th>x, y, height</th>"
                 "<th>score</th><th>breathing likely, per zone</th></tr>" + "".join(
                     f"<tr><td>{p.x:.2f}, {p.y:.2f}, {p.z:.1f} m</td><td>{s:.2f}</td><td>"
                     + ", ".join(f"{n} {z['likely']:.0%}" for n, z in r.zones.items()) + "</td></tr>"
                     for s, p, r in placements[:8]) + "</table>")
    pct = lambda v: f"{v:.0%}"
    maps = (_svg_map(room, rep, tx, rx, "seated_p", 0, 1, step,
                     "Breathing while seated: probability it is visible", pct)
            + _svg_map(room, rep, tx, rx, "lying_p", 0, 1, step,
                       "Breathing while lying on the back: probability it is visible", pct)
            + _svg_map(room, rep, tx, rx, "walk_rho", 0, 1, step,
                       "Walking: motion statistic rho (detected above 0.045)", lambda v: f"{v:.2f}"))
    env = (f"measured ({rep.sigma_env_source})" if not rep.sigma_env_source.startswith("ASSUMED")
           else "<b>assumed</b>; run <code>python -m aankhen validate</code> in the real room")
    return f"""<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>Aankhen link physics</title>
<style>:root{{color-scheme:dark light}}body{{font:15px/1.5 system-ui,sans-serif;max-width:980px;margin:0 auto;
padding:16px;background:#0b0d10;color:#e8eaed}}table{{border-collapse:collapse;margin:8px 0 18px}}
td,th{{border-bottom:1px solid #333;padding:4px 10px;text-align:left}}figure{{margin:18px 0}}
figcaption{{font-weight:600;margin-bottom:6px}}code{{background:#1c2026;padding:1px 5px;border-radius:4px}}
@media (prefers-color-scheme:light){{body{{background:#fff;color:#111}}td,th{{border-color:#ddd}}code{{background:#eee}}}}
</style></head><body>
<h1>Aankhen: what this Wi-Fi link can sense</h1>
<p>Predictions of the physics model (<code>aankhen/rf.py</code>) for <code>{room.name}</code>; not
measurements. The room's own slow signal wander is {env}.</p>
<table><tr><th>link</th><td>{rep.tx} → {rep.rx}, {rep.los_distance_m} m, {rep.walls_on_los} wall(s) in the way</td></tr>
<tr><th>RSSI / noise floor</th><td>{rep.rssi_dbm} dBm / {rep.noise_floor_dbm} dBm</td></tr>
<tr><th>CSI SNR per subcarrier</th><td>{rep.csi_snr_db} dB</td></tr>
<tr><th>first Fresnel zone, mid-link</th><td>radius {rep.fresnel_radius_mid_m} m</td></tr>
<tr><th>breathing assumed</th><td>chest ±{rep.chest_mm} mm; room wander σ = {rep.sigma_env}</td></tr>
<tr><th>walking outside vs inside</th><td>{rep.outside_vs_inside_motion}× (near 1 or more: the hallway looks like the room)</td></tr></table>
<h2>Zones</h2><table><tr><th>zone</th><th>posture</th><th>breathing likely, with the gain library</th>
<th>without it (current firmware)</th><th>unlikely (with)</th><th>walking detected</th></tr>{rows}</table>
<p>"Likely" is the share of positions inside the zone, and of facing directions, where the breathing
line reaches {LIKELY_DB:g} dB, as the median over {rep.rooms} simulated room(s) (range in brackets): what
else is in a room decides whether its static paths add up or cancel, which the layout alone cannot
tell. Blind spots are thin bands, not regions: moving a chair 3-5 cm can move you into or out of
one. The maps below are for the gain-compensated pipeline.</p>
{maps}{place}</body></html>"""
