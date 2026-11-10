"""Gate for the numericals: an independent checker recomputes every key without sympy.

    python -m jarvis_app.ww_check_numericals        200 seeds x every template, printed; exit 1 on any mismatch
    tests/test_ww_numericals.py                     the same on a smaller sweep, in the suite

Independence is the point (the ww_check_dmat.py pattern). ww_numericals.py draws numbers on a grid
and lets sympy build the key (apart, exp, an exact Routh array, solve for the marginal gain). This
module imports neither sympy nor any function of the generator. It reads only the PUBLIC item
(template, params, ranges, answer, tier, concepts) and re-derives the answer a different way:

  rc_tau        plain float product / quotient
  rc_thevenin   Runge-Kutta 4 of the circuit's own ODE, C dv/dt = (V - v)/R1 - v/R2 (no divider, no Thevenin step)
  so_overshoot  Runge-Kutta 4 of y'' + a y' + b y = b, the maximum of the response (not the exp formula)
  so_settling   the formula 4/(zeta wn) in float, plus a simulation of the 2 percent band that must lie within
                SETTLING_BAND of it (the textbook estimate is an estimate; the band is the measured spread)
  so_design     zeta by bisection on the overshoot curve (not the closed-form inverse), then a simulation
                of the closed loop with K = wn^2: its peak time must equal the key, its overshoot the printed one
  ess_type      the error constant as a numeric limit, s^N G(s) at s = 1e-8, then A/(1+K) or A/K
  ess_routh     numpy roots of the closed loop: K is stable and K + 1 is not; Kv as a numeric limit
  routh_count   numpy roots of the polynomial, right-half-plane count (no Routh array)
  routh_param   numpy roots of the closed-loop polynomial built by multiplying the open-loop factors out
  dc_gain       G(s) evaluated at s = 1e-9
  dc_closed     the closed loop as a state-space model: steady state x = -A^-1 B u, y = C x, poles in the left half-plane
  laplace_inv   residues N(p)/D'(p) at numpy's roots of the denominator
  laplace_step  Runge-Kutta 4 of y'' + (a+b) y' + ab y = K A from rest (no partial fractions)

It also checks the structure the generator promises: every drawn number sits on its printed grid, an exam
item names one concept and a gate item two or more.
"""
from __future__ import annotations

import math
import sys
import time
from typing import Any

import numpy as np

from . import ww_numericals            # only for TEMPLATES' names/tiers and the printed RANGES; no generator code runs here

REL = 1e-6                    # analytic keys are stored to 9 significant figures
SIM = 2e-3                    # a Runge-Kutta answer, relative: 1500 steps over the window measured 1e-5 at worst
SETTLING_BAND = 0.30          # |textbook 4/(zeta wn) - simulated 2% crossing| / simulated; measured in the sweep, see the docs


def _close(a: float, b: float, rel: float, absolute: float = 1e-12) -> bool:
    return abs(a - b) <= max(rel * max(abs(a), abs(b)), absolute)


# ------------------------------------------------------------------ simulation (Runge-Kutta 4)
def _sim2(a: float, b: float, g: float, t_end: float, n: int) -> tuple[float, list[float]]:
    """y'' + a y' + b y = g from rest; returns the step h and y at 0, h, 2h, ..."""
    h = t_end / n
    y = v = 0.0
    out = [0.0]
    for _ in range(n):
        k1y, k1v = v, g - a * v - b * y
        y2, v2 = y + 0.5 * h * k1y, v + 0.5 * h * k1v
        k2y, k2v = v2, g - a * v2 - b * y2
        y3, v3 = y + 0.5 * h * k2y, v + 0.5 * h * k2v
        k3y, k3v = v3, g - a * v3 - b * y3
        y4, v4 = y + h * k3y, v + h * k3v
        k4y, k4v = v4, g - a * v4 - b * y4
        y += h / 6 * (k1y + 2 * k2y + 2 * k3y + k4y)
        v += h / 6 * (k1v + 2 * k2v + 2 * k3v + k4v)
        out.append(y)
    return h, out


def _peak(h: float, ys: list[float]) -> tuple[float, float]:
    """Time and height of the largest sample, refined by a parabola through its two neighbours."""
    i = max(range(len(ys)), key=ys.__getitem__)
    if i == 0 or i == len(ys) - 1:
        return i * h, ys[i]
    lo, mid, hi = ys[i - 1], ys[i], ys[i + 1]
    den = lo - 2 * mid + hi
    d = 0.5 * (lo - hi) / den if den else 0.0
    return (i + d) * h, mid - 0.25 * (lo - hi) * d


def _overshoot_fraction(zeta: float) -> float:
    return math.exp(-math.pi * zeta / math.sqrt(1 - zeta * zeta))


# ------------------------------------------------------------------ one check per template
def _rc_tau(p):
    return p["R_k"] * p["C_uf"] if p["variant"] == "rc" else p["L_mh"] / p["R_ohm"]


def _rc_thevenin(p):
    V, R1, R2, C, t0 = (float(p[k]) for k in ("V", "R1_k", "R2_k", "Cth_uf", "t0_ms"))
    n = max(20, math.ceil(t0 / (min(R1, R2) * C / 25)))
    h, v = t0 / n, 0.0
    f = lambda x: ((V - x) / R1 - x / R2) / C            # V/ms: mA / uF = V/ms
    for _ in range(n):
        k1 = f(v)
        k2 = f(v + 0.5 * h * k1)
        k3 = f(v + 0.5 * h * k2)
        k4 = f(v + h * k3)
        v += h / 6 * (k1 + 2 * k2 + 2 * k3 + k4)
    return v


def _so_ab(p):
    z = p["zeta"] if "zeta" in p else p["zeta_s"]
    return 2 * z * p["wn"], float(p["wn"]) ** 2


def _so_overshoot(p):
    a, b = _so_ab(p)
    wd = math.sqrt(b - a * a / 4)
    h, ys = _sim2(a, b, b, 1.6 * math.pi / wd, 1500)
    return 100 * (_peak(h, ys)[1] - 1)


def _so_settling(p):
    return 4 / (p["zeta_s"] * p["wn"])


def _so_settling_sim(p):
    a, b = _so_ab(p)
    sigma = a / 2
    t_end = 10 / sigma
    n = int(t_end * p["wn"] * 40) + 200
    h, ys = _sim2(a, b, b, t_end, n)
    last = max((i for i, y in enumerate(ys) if abs(y - 1) > 0.02), default=0)
    return last * h


def _so_design(p):
    mp, a = p["Mp"] / 100.0, float(p["a_pole"])
    lo, hi = 1e-6, 1 - 1e-9
    for _ in range(100):                                   # the overshoot curve falls with zeta: bisect it
        mid = (lo + hi) / 2
        if _overshoot_fraction(mid) > mp:
            lo = mid
        else:
            hi = mid
    zeta = (lo + hi) / 2
    wn = a / (2 * zeta)
    wd = wn * math.sqrt(1 - zeta * zeta)
    h, ys = _sim2(a, wn * wn, wn * wn, 1.6 * math.pi / wd, 2500)
    tp, peak = _peak(h, ys)
    return tp, 100 * (peak - 1)


def _ess_type(p):
    N, K, z, pp, q, A = int(p["N"]), p["K"], p["z"], p["p"], p["q"], p["A"]
    s = 1e-8
    g = K * (s + z) / (s ** N * (s + pp) * (s + q))        # G(s) with its integrators written out
    const = g * s ** N                                       # K_p, K_v or K_a as a numeric limit
    return A / (1 + const) if N == 0 else A / const


def _ess_routh(p):
    a, b, A = float(p["ra"]), float(p["rb"]), p["rA"]
    poly = lambda K: np.poly1d([1.0, a + b, a * b, K])

    def worst(K):
        return max(np.roots(poly(K)).real)

    # the stable integers end where the largest real part reaches zero; walk up from K = 1
    K = 1
    while worst(K + 1) < -1e-9:
        K += 1
        if K > 5000:
            raise ValueError("no marginal gain below 5000")
    s = 1e-9
    kv = (K / (s * (s + a) * (s + b))) * s                    # s G(s) at a tiny s
    return A / kv, K


def _routh_count(p):
    cs = [1.0] + [float(p[f"c{i}"]) for i in range(1, int(p["order"]) + 1)]
    r = np.roots(cs)
    return int(sum(1 for x in r if x.real > 0)), float(min(abs(x.real) for x in r))


def _routh_param(p):
    pp, q, z, K = (float(p[k]) for k in ("pp", "qq", "zz", "Kp"))
    open_den = np.polymul(np.polymul([1.0, 0.0], [1.0, pp]), [1.0, -q])
    closed = np.polyadd(open_den, K * np.array([1.0, z]))
    r = np.roots(closed)
    return int(sum(1 for x in r if x.real > 0)), float(min(abs(x.real) for x in r))


def _dc_gain(p):
    s = 1e-9
    return p["K"] * (s + p["a1"]) * (s + p["a2"]) / ((s + p["b1"]) * (s + p["b2"]) * (s + p["b3"]))


def _dc_closed(p):
    K, a, b, c, A = (float(p[k]) for k in ("K", "a1", "b1", "b2", "A"))
    den = np.polymul([1.0, b], [1.0, c])                               # (s+b)(s+c)
    num = K * np.array([0.0, 1.0, a])                                  # K (s+a), padded to the same length
    cl = np.polyadd(den, num)                                          # closed-loop denominator
    poles = np.roots(cl)
    Am = np.array([[0.0, 1.0], [-cl[2], -cl[1]]])                      # x1' = x2, x2' = -q x1 - p x2 + u
    Bm = np.array([0.0, 1.0])
    Cm = np.array([K * a, K])                                          # y = K (a x1 + x2)
    x = -np.linalg.solve(Am, Bm) * A
    return float(Cm @ x), float(max(poles.real))


def _residue_value(num: list[float], den_roots: list[float], t: float) -> float:
    """f(t) for N(s)/prod(s - p_i), simple poles: sum of N(p_i)/D'(p_i) e^{p_i t}."""
    den = np.poly(den_roots)
    dp = np.polyder(den)
    return float(sum(np.polyval(num, r) / np.polyval(dp, r) * np.exp(r * t) for r in np.roots(den)).real)


def _laplace_inv(p):
    return _residue_value([float(p["alpha"]), float(p["beta"])], [-float(p["la"]), -float(p["lb"])], float(p["t0_s"]))


def _laplace_step(p):
    K, a, b, A, t = (float(p[k]) for k in ("Ks", "la", "lb", "rA", "t1_s"))
    n = max(200, math.ceil(t / 0.002))
    h, ys = _sim2(a + b, a * b, K * A, t, n)
    return ys[-1]


# ------------------------------------------------------------------ the item check
def _structure(item: dict) -> list[str]:
    out = []
    spec = ww_numericals.TEMPLATES.get(item.get("template"))
    if spec is None:
        return [f"unknown template {item.get('template')}"]
    if item.get("tier") != spec["tier"]:
        out.append(f"tier {item.get('tier')} for a {spec['tier']} template")
    n = len(item.get("concepts") or [])
    if spec["tier"] == "exam" and n != 1:
        out.append(f"exam item names {n} concepts")
    if spec["tier"] == "gate" and n < 2:
        out.append(f"gate item names {n} concept")
    if item.get("origin") != "generated" or not isinstance(item.get("seed"), int):
        out.append("not marked origin generated with its seed")
    if item.get("question", "").replace("\\$", "").count("$") % 2:
        out.append("question has an unmatched $")
    ranges = item.get("ranges") or {}
    for k, v in (item.get("params") or {}).items():
        if k == "variant":
            continue
        base = "c" if k.startswith("c") and k[1:].isdigit() else k
        lo, hi, step = ranges.get(k) or (None, None, None)
        printed = ww_numericals.RANGES.get(base)
        if printed is None or lo is None or [float(x) for x in printed] != [lo, hi, step]:
            out.append(f"{k}: range {ranges.get(k)} is not the printed {printed}")
        elif not lo - 1e-9 <= v <= hi + 1e-9 or abs((v - lo) / step - round((v - lo) / step)) > 1e-6:
            out.append(f"{k} = {v} is off the grid {lo}..{hi} step {step}")
    return out


def check_item(item: dict) -> list[str]:
    """Problems with one item (empty = the key survives an independent derivation)."""
    out = _structure(item)
    if out and item.get("template") not in ww_numericals.TEMPLATES:
        return out
    t, p, ans = item["template"], item.get("params") or {}, item.get("answer")
    try:
        if t == "rc_tau":
            exp, tol = _rc_tau(p), REL
        elif t == "rc_thevenin":
            exp, tol = _rc_thevenin(p), SIM
        elif t == "so_overshoot":
            exp, tol = _so_overshoot(p), SIM
        elif t == "so_settling":
            exp, tol = _so_settling(p), REL
            sim = _so_settling_sim(p)
            if abs(exp - sim) / sim > SETTLING_BAND:
                out.append(f"4/(zeta wn) = {exp:.4g} is {abs(exp - sim) / sim:.0%} from the simulated 2% crossing {sim:.4g}")
        elif t == "so_design":
            tp, ov = _so_design(p)
            exp, tol = tp, SIM
            if abs(ov - p["Mp"]) > 0.05:
                out.append(f"the simulated loop overshoots {ov:.3f} %, not {p['Mp']} %")
        elif t == "ess_type":
            exp, tol = _ess_type(p), 1e-5
        elif t == "ess_routh":
            exp, K = _ess_routh(p)
            tol = REL
            if K < 1:
                out.append("no stable integer gain")
        elif t in ("routh_count", "routh_param"):
            exp, margin = (_routh_count if t == "routh_count" else _routh_param)(p)
            tol = 0.0
            if margin < 1e-7:
                out.append(f"a root sits {margin:.1e} from the imaginary axis: the count is ill-conditioned")
        elif t == "dc_gain":
            exp, tol = _dc_gain(p), 1e-6
        elif t == "dc_closed":
            exp, worst = _dc_closed(p)
            tol = REL
            if worst >= 0:
                out.append("the closed loop is not stable, so there is no final value")
        elif t == "laplace_inv":
            exp, tol = _laplace_inv(p), REL
        elif t == "laplace_step":
            exp, tol = _laplace_step(p), SIM
        else:
            return out + [f"no checker for {t}"]
    except (KeyError, ValueError, ZeroDivisionError, np.linalg.LinAlgError) as e:
        return out + [f"{t}: could not re-derive ({type(e).__name__}: {e})"]
    if not isinstance(ans, (int, float)) or isinstance(ans, bool) or not math.isfinite(ans):
        return out + [f"{t}: key {ans!r} is not a finite number"]
    if not _close(ans, exp, tol, 1e-9 if tol else 0.0):
        out.append(f"{t}: key {ans:.6g} but the independent value is {exp:.6g}")
    return out


def sweep(seeds: int = 200, templates: list | None = None) -> dict:
    t0 = time.time()
    problems, kinds = [], {}
    for tpl in templates or ww_numericals.templates():
        items = 0
        for seed in range(seeds):
            it = ww_numericals.make(tpl, seed)
            items += 1
            for pr in check_item(it):
                problems.append(f"{tpl} seed {seed}: {pr}")
        kinds[tpl] = {"items": items, "tier": ww_numericals.TEMPLATES[tpl]["tier"]}
    return {"seeds": seeds, "kinds": kinds, "seconds": round(time.time() - t0, 2), "problems": problems}


def settling_spread(seeds: int = 200) -> dict:
    """Measured spread of the textbook 4/(zeta wn) against the simulated 2% crossing, over the printed grid."""
    worst, rel = 0.0, []
    for seed in range(seeds):
        p = ww_numericals.make("so_settling", seed)["params"]
        sim = _so_settling_sim(p)
        r = (_so_settling(p) - sim) / sim
        rel.append(r)
        worst = max(worst, abs(r))
    return {"seeds": seeds, "worst_abs": round(worst, 4), "min": round(min(rel), 4), "max": round(max(rel), 4)}


def main(argv=None) -> int:
    argv = list(sys.argv[1:] if argv is None else argv)
    seeds = int(argv[0]) if argv else 200
    r = sweep(seeds)
    n = sum(k["items"] for k in r["kinds"].values())
    for k, v in r["kinds"].items():
        print(f"{k:14s} {v['tier']:5s} {v['items']} items")
    print(f"{n} items over {len(r['kinds'])} templates in {r['seconds']} s; mismatches {len(r['problems'])}")
    for pr in r["problems"][:20]:
        print("  " + pr)
    return 1 if r["problems"] else 0


if __name__ == "__main__":
    raise SystemExit(main())
