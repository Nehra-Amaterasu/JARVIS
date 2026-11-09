"""dMAT practice: generators for the three Core Module task kinds of the Digital Master Test.

The test (g.a.s.t., Bochum) has a Core Module of three subtests: figure sequences, mathematical
equations and Latin squares. Only the public task descriptions are used here ("continue the
sequence", "find the unknowns", "complete the square"); every item below is produced by this
file's own rules from a seed. Nothing is copied from the test's preparatory material, which is
copyrighted, and no sentence, figure or number from it is stored (tests/test_ww_dmat.py scans
this file for the pdf's wording). Pure: no I/O, no clock, no global random state.

    build(kind, seed, level, n)   -> {"set_id", "items": [...public...], "time_limit_s", ...}, keys
    set_id(kind, seed, level, n)  -> "<kind>-<seed>-L<level>-n<n>", parsed back by parse_set_id
    mark(kind, seed, level, n, answers, seconds)  -> the score, from the regenerated key

Same (kind, seed, level, n) gives the same set on every machine and process: each item draws from
random.Random("dmat|kind|seed|level|index"), and str seeds hash with SHA-512, not with the
process-salted hash(). A set never stores its key; the key is recomputed from the seed, so a
score can be checked later without keeping the set.

Every item has exactly one correct option, and that is a property of the item, not luck: the
generator rejects any draw whose shown data admit a second answer under the rule family
(figures), a second solution (equations) or a second completion (Latin squares). ww_check_dmat.py
re-proves that with solvers that share no code with this file.
"""
from __future__ import annotations

import math
import random
from itertools import product
from typing import Any, Optional

KINDS = ("figure", "equation", "latin")
LEVELS = (1, 2, 3, 4, 5)
MAX_N = 60
LABEL = {"figure": "Figure sequences", "equation": "Equations", "latin": "Latin squares"}

# Seconds per item by level. The real test is timed per subtest; these are practice numbers chosen
# so level 3 is a comfortable-but-not-slow pace (figures 45 s, equations 60 s, squares 50 s),
# and each level step adds about 20 % of that, since the work per item grows about that fast
# (one more changing attribute, one more unknown, 3 to 4 more blank cells).
_BASE_S = {"figure": 25, "equation": 30, "latin": 20}
_STEP_S = {"figure": 10, "equation": 15, "latin": 10}


def seconds_per_item(kind: str, level: int) -> int:
    return _BASE_S[kind] + _STEP_S[kind] * level


def set_id(kind: str, seed: int, level: int, n: int) -> str:
    return f"{kind}-{seed}-L{level}-n{n}"


def parse_set_id(sid: str) -> tuple[str, int, int, int]:
    try:
        kind, seed, lv, n = str(sid).split("-")
        if kind not in KINDS or not lv.startswith("L") or not n.startswith("n"):
            raise ValueError
        return kind, int(seed), int(lv[1:]), int(n[1:])
    except ValueError:
        raise ValueError("set_id looks like figure-123-L2-n10") from None


def check_args(kind: str, seed: int, level: int, n: int) -> None:
    if kind not in KINDS:
        raise ValueError(f"kind is one of {', '.join(KINDS)}")
    if not isinstance(seed, int) or isinstance(seed, bool) or not 0 <= seed < 2 ** 31:
        raise ValueError("seed is a whole number from 0 to 2147483647")
    if level not in LEVELS:
        raise ValueError("level is 1 to 5")
    if not isinstance(n, int) or isinstance(n, bool) or not 1 <= n <= MAX_N:
        raise ValueError(f"n is 1 to {MAX_N}")


def _rng(kind: str, seed: int, level: int, i: int) -> random.Random:
    return random.Random(f"dmat|{kind}|{seed}|{level}|{i}")


# ================================================================== figure sequences
# A figure is (glyph, rotation, count). Each attribute walks its own cycle:
# glyph over 6 shapes, rotation over 8 steps of 45 degrees, count over 1..4 (stored 0..3).
# All six outlines have no rotational symmetry, so every rotation step is visible.
GLYPHS = ("arrow", "triangle", "ell", "tee", "flag", "house")
_OUTLINE = {      # points in a +-16 box, y down; asymmetric on purpose
    "arrow":    [(0, -16), (12, -2), (5, -2), (5, 16), (-5, 16), (-5, -2), (-12, -2)],
    "triangle": [(0, -16), (13, 14), (-13, 14)],
    "ell":      [(-12, -16), (-2, -16), (-2, 4), (12, 4), (12, 14), (-12, 14)],
    "tee":      [(-14, -16), (14, -16), (14, -6), (5, -6), (5, 16), (-5, 16), (-5, -6), (-14, -6)],
    "flag":     [(-8, -16), (14, -8), (-8, 0), (-8, 16), (-12, 16), (-12, -16)],
    "house":    [(0, -16), (14, -3), (14, 16), (-14, 16), (-14, -3)],
}
_M = {"glyph": len(GLYPHS), "rot": 8, "count": 4}
_ATTRS = ("glyph", "rot", "count")
CELL = 48                                  # one figure copy is drawn in a 48 x 48 cell


def _term_token(t: tuple[int, int, int]) -> str:
    return f"{GLYPHS[t[0]]}:{t[1] * 45}:{t[2] + 1}"


def _term_paths(t: tuple[int, int, int]) -> list[str]:
    g, r, c = t
    a = math.radians(r * 45)
    ca, sa = math.cos(a), math.sin(a)
    out = []
    for k in range(c + 1):
        cx, cy = CELL / 2 + CELL * k, CELL / 2
        pts = [(cx + x * ca - y * sa, cy + x * sa + y * ca) for x, y in _OUTLINE[GLYPHS[g]]]
        out.append("M" + " L".join(f"{x:.1f} {y:.1f}" for x, y in pts) + " Z")
    return out


def _term_public(t: tuple[int, int, int]) -> dict:
    return {"token": _term_token(t), "glyph": GLYPHS[t[0]], "rotation": t[1] * 45, "count": t[2] + 1,
            "text": f"{GLYPHS[t[0]]} x{t[2] + 1}, turned {t[1] * 45} degrees",
            "paths": _term_paths(t), "viewbox": [0, 0, CELL * (t[2] + 1), CELL]}


# Rule family per attribute, over Z_m (the same family generator and uniqueness test use):
#   ("step", d)         x[i+1] = x[i] + d
#   ("alt", d1, d2)     steps d1, d2, d1, d2, ...   (d1 != d2)
#   ("period", p, vals) x[i] = vals[i mod p]        (p = 2 or 3, vals distinct enough to read as a cycle)
def _hypotheses(m: int):
    for d in range(m):
        yield ("step", d)
    for d1 in range(m):
        for d2 in range(m):
            if d1 != d2:
                yield ("alt", d1, d2)


def _predict(h: tuple, seq: list[int], m: int) -> Optional[int]:
    """The next value if hypothesis h reproduces seq exactly, else None."""
    kind = h[0]
    if kind == "step":
        return (seq[-1] + h[1]) % m if all((seq[i + 1] - seq[i]) % m == h[1] for i in range(len(seq) - 1)) else None
    if kind == "alt":
        ok = all((seq[i + 1] - seq[i]) % m == (h[1] if i % 2 == 0 else h[2]) for i in range(len(seq) - 1))
        return (seq[-1] + (h[1] if (len(seq) - 1) % 2 == 0 else h[2])) % m if ok else None
    p = h[1]                                   # period: the first p values repeat
    ok = all(seq[i] == seq[i % p] for i in range(len(seq)))
    return seq[len(seq) % p] if ok and len(seq) >= p else None


def _consistent_next(seq: list[int], m: int) -> set[int]:
    out = {v for h in _hypotheses(m) if (v := _predict(h, seq, m)) is not None}
    for p in (2, 3):
        v = _predict(("period", p), seq, m)
        if v is not None:
            out.add(v)
    return out


def _run(rule: tuple, start: int, length: int, m: int) -> list[int]:
    seq = [start % m]
    if rule[0] == "period":
        return [rule[2][i % rule[1]] for i in range(length)]
    for i in range(length - 1):
        d = rule[1] if rule[0] == "step" or i % 2 == 0 else rule[2]
        seq.append((seq[-1] + d) % m)
    return seq


# (active attributes, allowed rule kinds) per level
_FIG_LEVELS = {
    1: (1, ("step",)),
    2: (2, ("step",)),
    3: (2, ("step", "alt", "period")),
    4: (3, ("step", "alt", "period")),
    5: (3, ("alt", "period")),
}


def _draw_rule(rng: random.Random, m: int, kinds: tuple, level: int) -> tuple:
    k = rng.choice(kinds)
    if k == "step":
        return ("step", rng.randrange(1, m))
    if k == "alt":
        d1 = rng.randrange(m)
        d2 = rng.choice([d for d in range(m) if d != d1])
        return ("alt", d1, d2)
    p = 2 if level < 5 else rng.choice((2, 3))
    vals = rng.sample(range(m), min(p, m))
    return ("period", p, vals)


def figure_item(seed: int, level: int, i: int) -> tuple[dict, int]:
    rng = _rng("figure", seed, level, i)
    n_active, kinds = _FIG_LEVELS[level]
    length = 5 + (level >= 3) + (level >= 5)
    for attempt in range(400):
        if attempt and attempt % 40 == 0:
            length = min(9, length + 1)            # a longer run pins the rule down
        active = rng.sample(_ATTRS, n_active)
        seqs = {}
        for a in _ATTRS:
            m = _M[a]
            if a in active:
                seqs[a] = _run(_draw_rule(rng, m, kinds, level), rng.randrange(m), length + 1, m)
            else:
                seqs[a] = [rng.randrange(m)] * (length + 1)
        shown = {a: seqs[a][:length] for a in _ATTRS}
        if any(len(_consistent_next(shown[a], _M[a])) != 1 for a in _ATTRS):
            continue                               # a second answer fits the shown terms
        key_t = tuple(seqs[a][length] for a in _ATTRS)
        if tuple(next(iter(_consistent_next(shown[a], _M[a]))) for a in _ATTRS) != key_t:
            continue                               # the drawn rule is not the only reading
        # a flat attribute that happens to move in the drawn rule is fine; a figure sequence in
        # which nothing ever changes is not a puzzle
        if all(len(set(shown[a])) == 1 for a in _ATTRS):
            continue
        terms = [tuple(shown[a][j] for a in _ATTRS) for j in range(length)]
        opts = _distractors(rng, key_t)
        order = list(range(5))
        rng.shuffle(order)
        options = [opts[j] for j in order]
        item = {"i": i, "kind": "figure", "prompt": "Which figure comes next?",
                "shown": [_term_public(t) for t in terms], "options": [_term_public(t) for t in options]}
        return item, options.index(key_t)
    raise RuntimeError("no unique figure sequence found")     # unreachable at these sizes; the gate would show it


def _distractors(rng: random.Random, key_t: tuple) -> list[tuple]:
    """The key plus four wrong figures. Near misses first (one attribute off, as if one rule were
    misread), then two attributes off."""
    out = [key_t]
    for width in (1, 2, 3):
        pool = []
        for chg in _subsets(width):
            for vals in product(*[[v for v in range(_M[_ATTRS[a]]) if v != key_t[a]] for a in chg]):
                t = list(key_t)
                for a, v in zip(chg, vals):
                    t[a] = v
                pool.append(tuple(t))
        rng.shuffle(pool)
        for t in pool:
            if len(out) == 5:
                break
            if t not in out:
                out.append(t)
    return out


def _subsets(width: int):
    from itertools import combinations
    return combinations(range(3), width)


# ================================================================== equations
# Unknowns are whole numbers in 1..R. An equation is a list of terms (coef, [var, ...]) = rhs.
# Level: (unknowns, range, equations, product terms allowed, min vars per equation)
_EQ_LEVELS = {1: (1, 20, 1, 0, 1), 2: (2, 12, 2, 0, 1), 3: (3, 12, 3, 0, 2), 4: (3, 12, 3, 1, 2), 5: (4, 9, 4, 2, 2)}
_VARS = "ABCD"


def _term_text(coef: int, vs: list[str], first: bool) -> str:
    body = "*".join(vs)
    mag = abs(coef)
    s = str(mag) if not vs else (body if mag == 1 else f"{mag}*{body}")
    if coef < 0:
        return ("-" if first else " - ") + s
    return s if first else " + " + s


def _expr_text(terms: list[tuple[int, list[str]]]) -> str:
    return "".join(_term_text(c, vs, k == 0) for k, (c, vs) in enumerate(terms))


def _eval_terms(terms, env: dict) -> int:
    t = 0
    for c, vs in terms:
        p = c
        for v in vs:
            p *= env[v]
        t += p
    return t


def _count_solutions(eqs, names: list[str], hi: int, limit: int = 2) -> int:
    found = 0
    for vals in product(range(1, hi + 1), repeat=len(names)):
        env = dict(zip(names, vals))
        if all(_eval_terms(t, env) == r for t, r in eqs):
            found += 1
            if found >= limit:
                break
    return found


def equation_item(seed: int, level: int, i: int) -> tuple[dict, int]:
    rng = _rng("equation", seed, level, i)
    nv, hi, n_eq, n_prod, min_vars = _EQ_LEVELS[level]
    names = list(_VARS[:nv])
    for _ in range(300):
        hidden = {v: rng.randint(1, hi) for v in names}
        eqs = []
        prods_left = n_prod
        while len(eqs) < n_eq + 2:                      # up to two extra equations if the first ones leave room
            k = rng.randint(min(min_vars, nv), nv)
            terms = [(rng.choice((-1, 1, 1, 2, 3, 4, 5)) if level > 1 else rng.randint(2, 9), [v]) for v in rng.sample(names, k)]
            if prods_left and nv >= 2 and rng.random() < 0.7:
                a, b = rng.sample(names, 2)
                terms.append((rng.choice((1, 1, 2, -1)), sorted([a, b])))
                prods_left -= 1
            if level == 1 or rng.random() < 0.5:
                terms.append((rng.randint(1, 9) * rng.choice((1, 1, -1)), []))      # a constant, so no equation is a bare multiple
            if all(c < 0 for c, _ in terms):
                terms[0] = (-terms[0][0], terms[0][1])
            eqs.append((terms, _eval_terms(terms, hidden)))
            if len(eqs) >= n_eq and _count_solutions(eqs, names, hi) == 1:
                break
        if _count_solutions(eqs, names, hi) != 1:
            continue
        k = min(nv, 1 if level == 1 else rng.choice((1, 2)))
        ask_vars = rng.sample(names, k)
        ask = [(rng.choice((1, 1, 2, 3)) * (1 if j == 0 else rng.choice((1, -1))), [v]) for j, v in enumerate(ask_vars)]
        key_v = _eval_terms(ask, hidden)
        near = [key_v + d for d in (-3, -2, -1, 1, 2, 3, 4, -4, 5)]
        rng.shuffle(near)
        wrong = []
        for v in near:
            if v != key_v and v not in wrong and v > 0 and len(wrong) < 4:
                wrong.append(v)
        for v in range(1, 200):                          # tiny keys leave few positive neighbours
            if len(wrong) == 4:
                break
            if v != key_v and v not in wrong:
                wrong.append(v)
        opts = [key_v] + wrong
        order = list(range(5))
        rng.shuffle(order)
        options = [opts[j] for j in order]
        item = {"i": i, "kind": "equation", "prompt": f"Find {_expr_text(ask)}",
                "unknowns": names, "range": [1, hi],
                "rule": f"{', '.join(names)} {'is a' if nv == 1 else 'are'} whole number{'' if nv == 1 else 's'} from 1 to {hi}",
                "equations": [f"{_expr_text(t)} = {r}" for t, r in eqs],
                "ask": _expr_text(ask), "options": [{"text": str(v)} for v in options]}
        return item, options.index(key_v)
    raise RuntimeError("no unique equation set found")


# ================================================================== Latin squares
_SYMS = "ABCDEF"
# level: (size, blanks wanted). The least number of givens that still leaves one completion
# bounds this; greedy removal stops at the target or at that bound.
_LATIN_LEVELS = {1: (4, 4), 2: (4, 8), 3: (5, 10), 4: (5, 14), 5: (6, 22)}


def _latin_random(rng: random.Random, n: int) -> list[list[int]]:
    g = [[-1] * n for _ in range(n)]
    cells = [(r, c) for r in range(n) for c in range(n)]

    def fill(k: int) -> bool:
        if k == len(cells):
            return True
        r, c = cells[k]
        used = {g[r][j] for j in range(n)} | {g[j][c] for j in range(n)}
        opts = [s for s in range(n) if s not in used]
        rng.shuffle(opts)
        for s in opts:
            g[r][c] = s
            if fill(k + 1):
                return True
        g[r][c] = -1
        return False

    fill(0)
    return g


def _latin_count(grid: list[list[int]], limit: int = 2) -> int:
    n = len(grid)
    g = [row[:] for row in grid]
    rows = [0] * n
    cols = [0] * n
    for r in range(n):
        for c in range(n):
            if g[r][c] >= 0:
                rows[r] |= 1 << g[r][c]
                cols[c] |= 1 << g[r][c]
    blanks = [(r, c) for r in range(n) for c in range(n) if g[r][c] < 0]
    full = (1 << n) - 1
    count = 0

    def go(k: int) -> None:
        nonlocal count
        if count >= limit:
            return
        if k == len(blanks):
            count += 1
            return
        r, c = blanks[k]
        free = full & ~(rows[r] | cols[c])
        while free:
            b = free & -free
            free ^= b
            rows[r] |= b
            cols[c] |= b
            go(k + 1)
            rows[r] &= ~b
            cols[c] &= ~b

    go(0)
    return count


def latin_item(seed: int, level: int, i: int) -> tuple[dict, int]:
    rng = _rng("latin", seed, level, i)
    n, want = _LATIN_LEVELS[level]
    full = _latin_random(rng, n)
    grid = [row[:] for row in full]
    order = [(r, c) for r in range(n) for c in range(n)]
    rng.shuffle(order)
    blanks = 0
    for r, c in order:
        if blanks >= want:
            break
        keep = grid[r][c]
        grid[r][c] = -1
        if _latin_count(grid) == 1:
            blanks += 1
        else:
            grid[r][c] = keep
    empties = [(r, c) for r in range(n) for c in range(n) if grid[r][c] < 0]
    r, c = rng.choice(empties)
    item = {"i": i, "kind": "latin", "prompt": f"Each symbol appears once in every row and every column. Which symbol belongs in row {r + 1}, column {c + 1}?",
            "n": n, "symbols": list(_SYMS[:n]),
            "grid": [[(_SYMS[v] if v >= 0 else None) for v in row] for row in grid],
            "ask": {"row": r + 1, "col": c + 1}, "blanks": len(empties),
            "options": [{"text": s} for s in _SYMS[:n]]}
    return item, full[r][c]


# ================================================================== sets and marking
_MAKERS = {"figure": figure_item, "equation": equation_item, "latin": latin_item}


def build(kind: str, seed: int, level: int, n: int) -> tuple[dict, list[int]]:
    """(public set, keys). The public set carries no key; keys[i] is the index of item i's correct option."""
    check_args(kind, seed, level, n)
    items, keys = [], []
    for i in range(n):
        item, key = _MAKERS[kind](seed, level, i)
        items.append(item)
        keys.append(key)
    per = seconds_per_item(kind, level)
    return ({"set_id": set_id(kind, seed, level, n), "kind": kind, "label": LABEL[kind], "seed": seed, "level": level, "n": n,
             "seconds_per_item": per, "time_limit_s": per * n, "items": items,
             "rules": "Rules are public; every item is generated by this app. None is copied from the test."}, keys)


def mark(kind: str, seed: int, level: int, n: int, answers: Any, seconds: Optional[float] = None) -> dict:
    """Score a set against its regenerated key. `answers` is a list of option indices (null or
    missing = not answered). A wrong-typed answer counts as wrong; it never raises."""
    pub, keys = build(kind, seed, level, n)
    given = list(answers) if isinstance(answers, (list, tuple)) else []
    per_item, right, skipped = [], 0, 0
    for i, key in enumerate(keys):
        a = given[i] if i < len(given) else None
        valid = isinstance(a, int) and not isinstance(a, bool) and 0 <= a < len(pub["items"][i]["options"])
        ok = valid and a == key
        right += ok
        skipped += a is None
        per_item.append({"i": i, "given": a if valid else None, "key": key, "ok": bool(ok)})
    secs = None
    if isinstance(seconds, (int, float)) and not isinstance(seconds, bool) and seconds >= 0 and math.isfinite(seconds):
        secs = round(float(seconds), 1)
    return {"set_id": pub["set_id"], "kind": kind, "seed": seed, "level": level, "n": n, "correct": right, "of": n,
            "unanswered": skipped, "pct": round(100 * right / n), "seconds": secs, "time_limit_s": pub["time_limit_s"],
            "in_time": None if secs is None else secs <= pub["time_limit_s"], "items": per_item}
