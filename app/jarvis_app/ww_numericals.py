"""Parameterised numericals for circuits and control systems, two tiers (Sprint 2, items 5 and 6).

    make(template, seed) -> one item: question (LaTeX), key (sympy), worked solution (LaTeX)
    pool(units, scope, tier, paper_seed, count) -> items placed on the subject's topics, for a paper
    question_from_id(id, units) -> the same item rebuilt from its id, so marks on it can be saved

Why this exists. The bank holds what was transcribed or harvested; a topic with 3 questions runs
dry after one paper, and the GATE tier had nothing of our own at all (the harvester only has
open-licence posts). A numerical with a seed never runs dry and every key is computed, not typed.

Two tiers, as in the real papers. `exam` is one concept (one formula applied once, a 2 to 5 mark
question). `gate` chains two or more (GATE EC asks for the number three steps downstream: a
divider, then a Thevenin source, then an exponential). Every gate template lists its concepts and
keeps the intermediate values in `values`; a test proves the key is none of them.

Determinism. `random.Random("ww-numericals:<template>:<seed>")` seeds from the string through
sha512, so the same seed is the same item in every process whatever PYTHONHASHSEED is.

Numbers come from a printed grid (`RANGES`: low, high, step), drawn as exact fractions so
0.35 is 0.35, not 0.35000000000000003; the key is computed from those fractions by sympy and
stored to 9 significant figures. The independent checker (ww_check_numericals.py) never sees the
generator's code: it reads only the public item and re-derives the key with plain float
arithmetic, numpy root-finding or a Runge-Kutta simulation of the circuit.

Honest limits. The exam tier is not a past paper: it is our own template, so a score on it is
practice. `so_settling` asks for the textbook estimate ts = 4/(zeta*wn), not the exact 2 percent
crossing; the checker simulates the circuit and bounds how far the estimate may sit from it.
"""
from __future__ import annotations

import math
import random
import re
from fractions import Fraction
from typing import Callable, Optional

TIERS = ("exam", "gate")
DEFAULT_MARKS = {"exam": 5, "gate": 10}

# (low, high, step) for every number a template draws. Printed in the item as `ranges`.
RANGES: dict[str, tuple] = {
    "R_k": (1, 50, 1), "C_uf": (1, 100, 1),                    # RC: kilo-ohm, microfarad -> ms
    "R_ohm": (10, 200, 10), "L_mh": (10, 500, 10),             # RL: ohm, millihenry -> ms
    "V": (5, 24, 1), "R1_k": (1, 20, 1), "R2_k": (1, 20, 1), "Cth_uf": (1, 100, 1), "t0_ms": (1, 100, 1),
    "zeta": (0.1, 0.9, 0.05), "zeta_s": (0.1, 0.7, 0.05), "wn": (2, 12, 1),    # zeta_s stops at 0.7: past it the 4/(zeta wn) estimate runs 30 percent long                # second-order
    "Mp": (5, 50, 5), "a_pole": (2, 20, 1),
    "N": (0, 2, 1), "K": (1, 20, 1), "z": (1, 5, 1), "p": (1, 6, 1), "q": (1, 6, 1), "A": (1, 10, 1),
    "ra": (1, 6, 1), "rb": (1, 6, 1), "rA": (1, 5, 1),        # ess_routh: poles a, b and the ramp slope
    "order": (3, 5, 1), "c": (-4, 9, 1),                       # Routh count
    "pp": (2, 9, 1), "qq": (1, 4, 1), "zz": (1, 6, 1), "Kp": (1, 40, 1),
    "a1": (1, 8, 1), "a2": (1, 8, 1), "b1": (1, 8, 1), "b2": (1, 8, 1), "b3": (1, 8, 1),
    "alpha": (0, 6, 1), "beta": (1, 20, 1), "la": (1, 6, 1), "lb": (1, 8, 1), "t0_s": (0.1, 1.0, 0.1),
    "Ks": (1, 12, 1), "t1_s": (0.1, 2.0, 0.1),
}


class _Redraw(Exception):
    """The drawn numbers hit a degenerate case (a zero in the Routh column, equal poles): draw again."""


class _Draw:
    def __init__(self, rnd: random.Random):
        self.rnd, self.values, self.ranges = rnd, {}, {}

    def __call__(self, name: str, key: Optional[str] = None) -> Fraction:
        """Draw from RANGES[name]; `key` names the draw when one range is drawn several times (Routh coefficients)."""
        lo, hi, step = (Fraction(str(x)) for x in RANGES[name])
        v = lo + step * self.rnd.randint(0, int((hi - lo) / step))
        self.values[key or name] = v
        self.ranges[key or name] = [float(lo), float(hi), float(step)]
        return v


# ------------------------------------------------------------------ small helpers
def _sp():
    import sympy
    return sympy


def _q(x: Fraction):
    return _sp().Rational(x.numerator, x.denominator)


def _f(expr) -> float:
    """sympy expression to a float stored to 9 significant figures (the same on every platform)."""
    return float(f"{float(_sp().N(expr, 30)):.9g}")


def _s(x) -> str:
    if isinstance(x, Fraction):
        return str(x.numerator) if x.denominator == 1 else format(float(x), "g")
    return format(x, "g")


def _kc(x: Fraction) -> str:
    """A gain printed in front of a factor: 1 is not written."""
    return "" if x == 1 else _s(x)


def _num(x: Fraction):
    return int(x) if x.denominator == 1 else float(x)


def _fac(z: Fraction) -> str:
    return f"(s + {_s(z)})"


def _poly(c: list, var: str = "s") -> str:
    n, out = len(c) - 1, []
    for i, a in enumerate(c):
        e = n - i
        if a == 0:
            continue
        mag = abs(a)
        coef = "" if (mag == 1 and e > 0) else _s(Fraction(mag))
        term = coef + (var if e == 1 else f"{var}^{{{e}}}" if e > 1 else "")
        out.append(("-" if a < 0 else "") + term if not out else f" {'-' if a < 0 else '+'} {term}")
    return "".join(out) or "0"


def _routh_first_column(coefs: list) -> list:
    """Routh array first column by exact rational arithmetic; _Redraw on a zero (the special cases are not asked)."""
    sp = _sp()
    c = [sp.Rational(x.numerator, x.denominator) if isinstance(x, Fraction) else sp.Integer(x) for x in coefs]
    n = len(c) - 1
    rows = [c[0::2], c[1::2]]
    width = len(rows[0])
    rows[1] = rows[1] + [sp.Integer(0)] * (width - len(rows[1]))
    for i in range(2, n + 1):
        p2, p1 = rows[i - 2], rows[i - 1]
        if p1[0] == 0:
            raise _Redraw()
        rows.append([(p1[0] * p2[j + 1] - p2[0] * p1[j + 1]) / p1[0] for j in range(width - 1)] + [sp.Integer(0)])
    col = [r[0] for r in rows]
    if any(x == 0 for x in col):
        raise _Redraw()
    return col


def _sign_changes(col: list) -> int:
    return sum(1 for a, b in zip(col, col[1:]) if a * b < 0)


def _inverse_terms(F, t_value) -> "object":
    """Value at t_value of the inverse Laplace transform of a proper rational F with simple real poles.

    sympy's apart splits F into c/(lc*s + c0) terms; each is c/lc * exp(-(c0/lc) t). A term that is not
    linear in s raises, which the tests would show: the templates only draw simple real poles."""
    sp = _sp()
    s = sp.Symbol("s")
    total = sp.Integer(0)
    for term in sp.Add.make_args(sp.apart(F, s)):
        num, den = sp.fraction(sp.together(term))
        pd = sp.Poly(den, s)
        if pd.degree() != 1 or sp.Poly(num, s).degree() != 0:
            raise ValueError(f"not a simple-pole term: {term}")
        lc, c0 = pd.all_coeffs()
        total += (num / lc) * sp.exp(-(c0 / lc) * t_value)
    return total


# ------------------------------------------------------------------ the templates
# Each builder returns {question, answer (sympy), unit, concepts, values {name: sympy}, solution [LaTeX lines]}.
def _b_rc_tau(rnd, D):
    variant = rnd.choice(("rc", "rl"))
    if variant == "rc":
        R, C = D("R_k"), D("C_uf")
        tau = _q(R) * _q(C)                                  # kilo-ohm x microfarad = millisecond
        return dict(variant=variant, answer=tau, unit="ms", values={},
                    question=rf"A series RC circuit has $R = {_s(R)}\,\mathrm{{k\Omega}}$ and $C = {_s(C)}\,\mu\mathrm{{F}}$. Find its time constant in ms.",
                    solution=[r"One concept: the time constant of a first-order circuit, $\tau = RC$.",
                              rf"$\tau = {_s(R)}\,\mathrm{{k\Omega}} \times {_s(C)}\,\mu\mathrm{{F}} = {_s(Fraction(R * C))}\,\mathrm{{ms}}$."])
    R, L = D("R_ohm"), D("L_mh")
    tau = _q(L) / _q(R)                                      # millihenry / ohm = millisecond
    return dict(variant=variant, answer=tau, unit="ms", values={},
                question=rf"A series RL circuit has $R = {_s(R)}\,\Omega$ and $L = {_s(L)}\,\mathrm{{mH}}$. Find its time constant in ms.",
                solution=[r"One concept: the time constant of a first-order circuit, $\tau = L/R$.",
                          rf"$\tau = {_s(L)}\,\mathrm{{mH}} / {_s(R)}\,\Omega = {format(float(L / R), '.4g')}\,\mathrm{{ms}}$."])


def _b_rc_thevenin(rnd, D):
    sp = _sp()
    V, R1, R2, C, t0 = D("V"), D("R1_k"), D("R2_k"), D("Cth_uf"), D("t0_ms")
    vth = _q(V) * _q(R2) / (_q(R1) + _q(R2))
    rth = _q(R1) * _q(R2) / (_q(R1) + _q(R2))
    tau = rth * _q(C)
    vc = vth * (1 - sp.exp(-_q(t0) / tau))
    return dict(answer=vc, unit="V", values={"vth": vth, "rth": rth, "tau": tau},
                question=(rf"A ${_s(V)}\,\mathrm{{V}}$ source is switched at $t=0$ onto $R_1 = {_s(R1)}\,\mathrm{{k\Omega}}$ in series with the parallel pair "
                          rf"$R_2 = {_s(R2)}\,\mathrm{{k\Omega}}$ and an initially uncharged $C = {_s(C)}\,\mu\mathrm{{F}}$. "
                          rf"Find the capacitor voltage at $t = {_s(t0)}\,\mathrm{{ms}}$, in volts."),
                solution=[r"Three concepts chained: divider, Thevenin source, first-order step response.",
                          rf"Final value (divider): $V_{{th}} = V\,\frac{{R_2}}{{R_1+R_2}} = {format(float(vth), '.4g')}\,\mathrm{{V}}$.",
                          rf"Thevenin resistance: $R_{{th}} = R_1 \parallel R_2 = {format(float(rth), '.4g')}\,\mathrm{{k\Omega}}$, so $\tau = R_{{th}}C = {format(float(tau), '.4g')}\,\mathrm{{ms}}$.",
                          rf"$v_C(t) = V_{{th}}\left(1 - e^{{-t/\tau}}\right)$, so $v_C({_s(t0)}\,\mathrm{{ms}}) = {format(float(vc), '.4g')}\,\mathrm{{V}}$."])


def _second_order_tf(a: Fraction, b: Fraction) -> str:
    return rf"$T(s) = \dfrac{{{_s(b)}}}{{s^{{2}} + {_s(a)}\,s + {_s(b)}}}$"


def _b_so_overshoot(rnd, D):
    sp = _sp()
    zeta, wn = D("zeta"), D("wn")
    a, b = 2 * zeta * wn, wn * wn
    z = _q(a) / (2 * sp.sqrt(_q(b)))
    mp = 100 * sp.exp(-sp.pi * z / sp.sqrt(1 - z ** 2))
    return dict(answer=mp, unit="%", values={"zeta": z, "wn": sp.sqrt(_q(b))},
                question=rf"A closed-loop system has {_second_order_tf(a, b)}. Find the peak percent overshoot of its unit-step response.",
                solution=[r"One concept: peak overshoot of a standard second-order system.",
                          rf"Compare with $s^2 + 2\zeta\omega_n s + \omega_n^2$: $\omega_n = \sqrt{{{_s(b)}}} = {_s(wn)}$, $\zeta = {_s(a)}/(2\omega_n) = {_s(zeta)}$.",
                          rf"$M_p = 100\,e^{{-\pi\zeta/\sqrt{{1-\zeta^2}}}} = {format(float(mp), '.4g')}\,\%$."])


def _b_so_settling(rnd, D):
    sp = _sp()
    zeta, wn = D("zeta_s"), D("wn")
    a, b = 2 * zeta * wn, wn * wn
    z = _q(a) / (2 * sp.sqrt(_q(b)))
    ts = 4 / (z * sp.sqrt(_q(b)))
    return dict(answer=ts, unit="s", values={"zeta": z, "wn": sp.sqrt(_q(b))},
                question=(rf"A closed-loop system has {_second_order_tf(a, b)}. Using the 2 percent criterion $t_s \approx 4/(\zeta\omega_n)$, "
                          r"find the settling time of its unit-step response in seconds."),
                solution=[r"One concept: the 2 percent settling-time estimate of a second-order system.",
                          rf"$\omega_n = {_s(wn)}$ and $\zeta = {_s(zeta)}$ from the denominator.",
                          rf"$t_s \approx 4/(\zeta\omega_n) = 4/({_s(zeta)} \times {_s(wn)}) = {format(float(ts), '.4g')}\,\mathrm{{s}}$."])


def _b_so_design(rnd, D):
    sp = _sp()
    mp, a = D("Mp"), D("a_pole")
    L = sp.log(_q(mp) / 100)
    zeta = -L / sp.sqrt(sp.pi ** 2 + L ** 2)
    wn = _q(a) / (2 * zeta)
    tp = sp.pi / (wn * sp.sqrt(1 - zeta ** 2))
    return dict(answer=tp, unit="s", values={"zeta": zeta, "wn": wn, "K": wn ** 2},
                question=(rf"A unity-feedback system has $G(s) = \dfrac{{K}}{{s(s + {_s(a)})}}$. $K$ is set so that the unit-step response overshoots "
                          rf"by {_s(mp)} percent. Find the peak time $t_p$ in seconds."),
                solution=[r"Three concepts chained: overshoot to damping ratio, natural frequency from the open loop, peak time.",
                          rf"$\zeta = \dfrac{{-\ln(M_p/100)}}{{\sqrt{{\pi^2 + \ln^2(M_p/100)}}}} = {format(float(zeta), '.4g')}$.",
                          rf"The closed loop is $s^2 + {_s(a)}\,s + K$, so $2\zeta\omega_n = {_s(a)}$ and $\omega_n = {format(float(wn), '.4g')}$ (and $K = \omega_n^2 = {format(float(wn ** 2), '.4g')}$).",
                          rf"$t_p = \pi/(\omega_n\sqrt{{1-\zeta^2}}) = {format(float(tp), '.4g')}\,\mathrm{{s}}$."])


_INPUTS = {0: (r"a step of height {A}, $r(t) = {A}\,u(t)$", "step"),
           1: (r"a ramp, $r(t) = {A}\,t$", "ramp"),
           2: (r"a parabola, $r(t) = {A}\,t^2/2$", "parabola")}


def _b_ess_type(rnd, D):
    sp = _sp()
    s = sp.Symbol("s")
    N, K, z, p, q, A = int(D("N")), D("K"), D("z"), D("p"), D("q"), D("A")
    G = _q(K) * (s + _q(z)) / (s ** N * (s + _q(p)) * (s + _q(q)))
    const = sp.cancel(s ** N * G).subs(s, 0)                 # Kp, Kv or Ka by the number of integrators
    ess = _q(A) / (1 + const) if N == 0 else _q(A) / const
    names = {0: "K_p", 1: "K_v", 2: "K_a"}
    den = ("" if N == 0 else (r"s " if N == 1 else r"s^{2}")) + rf"(s + {_s(p)})(s + {_s(q)})"
    inp = _INPUTS[N][0].format(A=_s(A))
    return dict(answer=ess, unit="", values={"error_constant": const},
                question=(rf"A stable unity-feedback system has $G(s) = \dfrac{{{_kc(K)}(s + {_s(z)})}}{{{den}}}$ and is driven by {inp}. "
                          r"Find the steady-state error."),
                solution=[rf"One concept: steady-state error by system type. $G$ has {N} integrator{'s' if N != 1 else ''}: type {N}.",
                          rf"${names[N]} = \lim_{{s\to 0}} s^{{{N}}}G(s) = {format(float(const), '.4g')}$.",
                          (rf"$e_{{ss}} = A/(1+K_p) = {format(float(ess), '.4g')}$." if N == 0
                           else rf"$e_{{ss}} = A/{names[N]} = {format(float(ess), '.4g')}$.")])


def _b_ess_routh(rnd, D):
    sp = _sp()
    a, b, A = D("ra"), D("rb"), D("rA")
    K = sp.Symbol("K")
    row3 = ((_q(a) + _q(b)) * _q(a) * _q(b) - K) / (_q(a) + _q(b))      # third Routh row of s^3 + (a+b)s^2 + ab s + K
    kmax = sp.solve(sp.Eq(row3, 0), K)[0]                               # the marginal gain
    kint = kmax - 1                                                      # largest integer gain strictly inside the stable range
    kv = kint / (_q(a) * _q(b))
    ess = _q(A) / kv
    return dict(answer=ess, unit="", values={"K_marginal": kmax, "K": kint, "Kv": kv},
                question=(rf"A unity-feedback system has $G(s) = \dfrac{{K}}{{s(s + {_s(a)})(s + {_s(b)})}}$. $K$ is the largest integer for which the closed loop "
                          rf"is stable. Find the steady-state error for $r(t) = {_s(A)}\,t$."),
                solution=[r"Three concepts chained: Routh stability limit, velocity error constant, ramp error.",
                          rf"Closed loop $s^3 + {_s(a + b)}\,s^2 + {_s(a * b)}\,s + K$. Third Routh row: $\dfrac{{{_s((a + b) * a * b)} - K}}{{{_s(a + b)}}} > 0$, so $K < {_s(Fraction(int(kmax)))}$ and the largest integer is $K = {int(kint)}$.",
                          rf"$K_v = \lim_{{s\to 0}} sG(s) = K/({_s(a)}\cdot{_s(b)}) = {format(float(kv), '.4g')}$.",
                          rf"$e_{{ss}} = A/K_v = {format(float(ess), '.4g')}$."])


def _b_routh_count(rnd, D):
    n = int(D("order"))
    cs = [Fraction(1)] + [D("c", f"c{i}") for i in range(1, n + 1)]
    col = _routh_first_column(cs)
    k = _sign_changes(col)
    return dict(answer=_sp().Integer(k), unit="", values={},
                question=rf"How many roots of $P(s) = {_poly(cs)}$ lie in the right half of the $s$-plane?",
                solution=[r"One concept: sign changes in the first column of the Routh array.",
                          "First column: $" + r",\ ".join(format(float(x), ".4g") for x in col) + "$.",
                          rf"There are {k} sign change{'s' if k != 1 else ''}, so {k} root{'s' if k != 1 else ''} in the right half-plane."])


def _b_routh_param(rnd, D):
    p, q, z, K = D("pp"), D("qq"), D("zz"), D("Kp")
    cs = [Fraction(1), p - q, K - p * q, K * z]
    col = _routh_first_column(cs)
    k = _sign_changes(col)
    return dict(answer=_sp().Integer(k), unit="", values={"char_c1": _q(cs[1]), "char_c2": _q(cs[2]), "char_c3": _q(cs[3])},
                question=(rf"A unity-feedback loop has $G(s) = \dfrac{{{_kc(K)}(s + {_s(z)})}}{{s(s + {_s(p)})(s - {_s(q)})}}$. "
                          r"How many closed-loop poles lie in the right half of the $s$-plane?"),
                solution=[r"Two concepts chained: the characteristic equation from the open loop, then the Routh count.",
                          rf"$1 + G(s) = 0$ gives $s(s+{_s(p)})(s-{_s(q)}) + {_s(K)}(s+{_s(z)}) = {_poly(cs)} = 0$.",
                          "First Routh column: $" + r",\ ".join(format(float(x), ".4g") for x in col) + "$.",
                          rf"{k} sign change{'s' if k != 1 else ''}: {k} closed-loop pole{'s' if k != 1 else ''} in the right half-plane."])


def _b_dc_gain(rnd, D):
    sp = _sp()
    s = sp.Symbol("s")
    K, a1, a2, b1, b2, b3 = D("K"), D("a1"), D("a2"), D("b1"), D("b2"), D("b3")
    G = _q(K) * (s + _q(a1)) * (s + _q(a2)) / ((s + _q(b1)) * (s + _q(b2)) * (s + _q(b3)))
    g0 = G.subs(s, 0)
    return dict(answer=g0, unit="", values={},
                question=(rf"Find the DC gain $G(0)$ of $G(s) = \dfrac{{{_kc(K)}{_fac(a1)}{_fac(a2)}}}{{{_fac(b1)}{_fac(b2)}{_fac(b3)}}}$."),
                solution=[r"One concept: the DC gain of a stable transfer function is $G(0)$.",
                          rf"$G(0) = \dfrac{{{_s(K)}\cdot{_s(a1)}\cdot{_s(a2)}}}{{{_s(b1)}\cdot{_s(b2)}\cdot{_s(b3)}}} = {format(float(g0), '.4g')}$."])


def _b_dc_closed(rnd, D):
    sp = _sp()
    s = sp.Symbol("s")
    K, a, b, c, A = D("K"), D("a1"), D("b1"), D("b2"), D("A")
    G = _q(K) * (s + _q(a)) / ((s + _q(b)) * (s + _q(c)))
    kp = G.subs(s, 0)
    t0 = kp / (1 + kp)
    yss = _q(A) * t0
    return dict(answer=yss, unit="", values={"Kp": kp, "T0": t0},
                question=(rf"A unity-feedback loop has $G(s) = \dfrac{{{_kc(K)}{_fac(a)}}}{{{_fac(b)}{_fac(c)}}}$ and is driven by a step of height {_s(A)}. "
                          r"Find the steady-state value of the output $y(t)$."),
                solution=[r"Three concepts chained: open-loop DC gain, closed-loop DC gain, final value of a step response.",
                          rf"$K_p = G(0) = {format(float(kp), '.4g')}$. The closed loop $s^2 + {_s(b + c + K)}\,s + {_s(b * c + K * a)}$ is stable, so the final value exists.",
                          rf"$T(0) = K_p/(1+K_p) = {format(float(t0), '.4g')}$.",
                          rf"$y_{{ss}} = {_s(A)}\,T(0) = {format(float(yss), '.4g')}$."])


def _b_laplace_inv(rnd, D):
    sp = _sp()
    s = sp.Symbol("s")
    al, be, a, b, t0 = D("alpha"), D("beta"), D("la"), D("lb"), D("t0_s")
    if a == b:
        raise _Redraw()
    F = (_q(al) * s + _q(be)) / ((s + _q(a)) * (s + _q(b)))
    val = _inverse_terms(F, _q(t0))
    num = "0" if (al == 0 and be == 0) else _poly([al, be])
    ra, rb = (be - al * a) / (b - a), (be - al * b) / (a - b)
    return dict(answer=val, unit="", values={"residue_a": _q(ra), "residue_b": _q(rb)},
                question=(rf"Let $F(s) = \dfrac{{{num}}}{{{_fac(a)}{_fac(b)}}}$. Find $f(t)$, the inverse Laplace transform, at $t = {_s(t0)}\,\mathrm{{s}}$."),
                solution=[r"One concept: inverse Laplace transform by partial fractions.",
                          rf"$F(s) = \dfrac{{{format(float(ra), '.4g')}}}{{s + {_s(a)}}} + \dfrac{{{format(float(rb), '.4g')}}}{{s + {_s(b)}}}$.",
                          rf"$f(t) = {format(float(ra), '.4g')}\,e^{{-{_s(a)}t}} + {format(float(rb), '.4g')}\,e^{{-{_s(b)}t}}$, so $f({_s(t0)}) = {format(float(val), '.4g')}$."])


def _b_laplace_step(rnd, D):
    sp = _sp()
    s = sp.Symbol("s")
    K, a, b, A, t0 = D("Ks"), D("la"), D("lb"), D("rA"), D("t1_s")
    if a == b:
        raise _Redraw()
    Y = _q(A) * _q(K) / (s * (s + _q(a)) * (s + _q(b)))
    y = _inverse_terms(Y, _q(t0))
    yinf = _q(A) * _q(K) / (_q(a) * _q(b))
    return dict(answer=y, unit="", values={"y_final": yinf},
                question=(rf"A system $G(s) = \dfrac{{{_s(K)}}}{{{_fac(a)}{_fac(b)}}}$ starts at rest and receives a step input of height {_s(A)}. "
                          rf"Find the output $y(t)$ at $t = {_s(t0)}\,\mathrm{{s}}$."),
                solution=[r"Three concepts chained: output transform $Y = G\,X$, partial fractions, inverse Laplace transform.",
                          rf"$Y(s) = \dfrac{{{_s(A * K)}}}{{s{_fac(a)}{_fac(b)}}}$.",
                          rf"Its partial fractions give $y(t) = y_\infty\left[1 - \dfrac{{{_s(b)}e^{{-{_s(a)}t}} - {_s(a)}e^{{-{_s(b)}t}}}}{{{_s(b)} - {_s(a)}}}\right]$ with $y_\infty = {format(float(yinf), '.4g')}$.",
                          rf"$y({_s(t0)}) = {format(float(y), '.4g')}$."])


def _t(tier, concepts, kw, build):
    return {"tier": tier, "concepts": concepts, "kw": re.compile(kw, re.I), "build": build}


TEMPLATES: dict[str, dict] = {
    # exam tier: one concept
    "rc_tau": _t("exam", ["first-order time constant"], r"\brc\b|\brl\b|time constant|transient|first.order|thevenin|network|circuit", _b_rc_tau),
    "so_overshoot": _t("exam", ["second-order peak overshoot"], r"second.order|overshoot|settling|time response|transient response|damping", _b_so_overshoot),
    "so_settling": _t("exam", ["second-order settling time"], r"second.order|overshoot|settling|time response|transient response|damping", _b_so_settling),
    "ess_type": _t("exam", ["steady-state error by system type"], r"steady.state|error constant|system type", _b_ess_type),
    "routh_count": _t("exam", ["Routh array sign changes"], r"routh|hurwitz|stability", _b_routh_count),
    "dc_gain": _t("exam", ["transfer-function DC gain"], r"transfer function|dc gain|block diagram", _b_dc_gain),
    "laplace_inv": _t("exam", ["inverse Laplace by partial fractions"], r"laplace|partial fraction", _b_laplace_inv),
    # gate tier: two or more concepts chained
    "rc_thevenin": _t("gate", ["voltage divider", "Thevenin equivalent", "first-order step response"],
                      r"\brc\b|\brl\b|time constant|transient|first.order|thevenin|network|circuit", _b_rc_thevenin),
    "so_design": _t("gate", ["overshoot to damping ratio", "natural frequency from the open loop", "peak time"],
                    r"second.order|overshoot|settling|time response|transient response|damping", _b_so_design),
    "ess_routh": _t("gate", ["Routh stability limit", "velocity error constant", "ramp steady-state error"],
                    r"steady.state|error constant|system type|routh|hurwitz|stability", _b_ess_routh),
    "routh_param": _t("gate", ["characteristic equation from the open loop", "Routh array sign changes"], r"routh|hurwitz|stability", _b_routh_param),
    "dc_closed": _t("gate", ["open-loop DC gain", "closed-loop DC gain", "final value of a step response"],
                    r"transfer function|dc gain|block diagram|steady.state", _b_dc_closed),
    "laplace_step": _t("gate", ["output transform Y = G X", "partial fractions", "inverse Laplace transform"], r"laplace|partial fraction", _b_laplace_step),
}


def templates(tier: Optional[str] = None) -> list[str]:
    return [k for k, v in TEMPLATES.items() if tier is None or v["tier"] == tier]


# ------------------------------------------------------------------ one item
def make(template: str, seed: int) -> dict:
    """The item for (template, seed): the same pair is the same item in every process."""
    if template not in TEMPLATES:
        raise KeyError(f"no numerical template {template}")
    spec = TEMPLATES[template]
    rnd = random.Random(f"ww-numericals:{template}:{int(seed)}")
    for _ in range(200):
        D = _Draw(rnd)
        try:
            out = spec["build"](rnd, D)
            break
        except _Redraw:
            continue
    else:                                                   # pragma: no cover (a degenerate draw 200 times running)
        raise RuntimeError(f"{template}: no usable draw for seed {seed}")
    ans = _f(out["answer"])
    is_count = out["unit"] == "" and template in ("routh_count", "routh_param")
    shown = str(int(ans)) if is_count else f"{ans:.4g}" + (f" {out['unit']}" if out["unit"] else "")
    params = {k: _num(v) for k, v in D.values.items()}
    if out.get("variant"):
        params["variant"] = out["variant"]
    ask = "" if is_count else " Give 3 significant figures."
    return {"id": f"n:{template}:{int(seed)}", "template": template, "tier": spec["tier"], "seed": int(seed), "origin": "generated",
            "concepts": list(spec["concepts"]), "question": out["question"] + ask, "answer": ans, "answer_text": shown,
            "unit": out["unit"], "params": params, "ranges": D.ranges,
            "values": {k: _f(v) for k, v in out["values"].items()}, "solution": "\n".join(out["solution"]),
            "marks": DEFAULT_MARKS[spec["tier"]], "tolerance": 0.01}


# ------------------------------------------------------------------ on a subject's topics (the paper hook)
def matching(topic: str, tier: str) -> list[str]:
    return [k for k, v in TEMPLATES.items() if v["tier"] == tier and v["kw"].search(topic or "")]


def has_template(topic: str) -> bool:
    return any(v["kw"].search(topic or "") for v in TEMPLATES.values())


def _place(item: dict, unit, topic: str) -> dict:
    return {**item, "id": f"{item['id']}:u{unit}", "unit": unit, "topic": topic, "section": "", "type": "generated",
            "sitting": f"generated, seed {item['seed']}"}


def pool(units: list[dict], scope: set, tier: str, paper_seed: int, count: int) -> list[dict]:
    """Up to `count` distinct generated items of one tier, spread over the subject's topics that have a template.

    Seeds come from the paper's seed, so the same paper seed is the same pool and a new one is new numbers."""
    cands = []
    for u in units:
        n = u.get("n")
        if n is None or (scope and int(n) not in scope):
            continue
        for topic in u.get("topics") or []:
            cands += [(tpl, int(n), str(topic)) for tpl in matching(str(topic), tier)]
    if not cands or count <= 0:
        return []
    out, texts, i = [], set(), 0
    while len(out) < count and i < count * 8:
        tpl, n, topic = cands[i % len(cands)]
        it = make(tpl, (abs(int(paper_seed)) * 10007 + i) % 2_000_000_000)
        i += 1
        if it["question"] in texts:
            continue
        texts.add(it["question"])
        out.append(_place(it, n, topic))
    return out


_ID = re.compile(r"^n:([a-z_]+):(\d{1,10}):u(\d{1,3})$")


def question_from_id(qid: str, units: list[dict]) -> Optional[dict]:
    """A generated question rebuilt from its id (so marks on a paper's numerical can be saved), or None
    when the id is not one of ours, the template is unknown or the unit has no topic that template fits."""
    m = _ID.match(str(qid))
    if not m or m.group(1) not in TEMPLATES:
        return None
    tpl, seed, unit = m.group(1), int(m.group(2)), int(m.group(3))
    topic = next((str(t) for u in units if u.get("n") is not None and int(u["n"]) == unit for t in u.get("topics") or []
                  if tpl in matching(str(t), TEMPLATES[tpl]["tier"])), None)
    if topic is None:
        return None
    return _place(make(tpl, seed), unit, topic)
