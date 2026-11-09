"""Gate for the dMAT generators: independent solvers re-solve what ww_dmat.py made.

    python -m jarvis_app.ww_check_dmat        200 seeds x 3 kinds, printed; exit 1 on any mismatch
    tests/test_ww_dmat.py                     the same on a smaller sweep, in the suite

Independence is the point. ww_dmat.py builds an item from a rule it drew; a checker that reused its
rule code would agree with it by construction. These solvers read only the PUBLIC set (what the
page receives) and share no function with the generator:

  figure    parses each shown figure from its "glyph:degrees:count" token, then asks, for every
            candidate next figure, whether the extended sequence is regular in each attribute
            (a constant step, alternating steps, or a repeating cycle of 2 or 3). The generator
            enumerates rules and predicts; this tests candidates by predicate. The item passes
            only if exactly one of the five options is regular and it is the key.
  equation  parses the printed equations with a whitelisted ast walk and brute-forces every
            assignment in the printed range; passes only if exactly one assignment satisfies all
            equations and the printed question has the key's value under it.
  latin     reads the printed grid, checks no symbol repeats in a row or column, counts completions
            with a most-constrained-cell search (the generator fills in row order) and passes only
            if there is exactly one and it puts the key's symbol in the asked cell.

Each set is one seed at one level; the level cycles 1..5 with the seed so all five are covered.
"""
from __future__ import annotations

import ast
import sys
import time
from itertools import product
from typing import Any

from . import ww_dmat

_GLYPH_ORDER = ["arrow", "triangle", "ell", "tee", "flag", "house"]       # the cycle order is part of the rules
_MOD = {"glyph": 6, "rot": 8, "count": 4}
ITEMS_PER_SEED = {"figure": 3, "equation": 3, "latin": 3}


# ------------------------------------------------------------------ figure sequences
def _parse_token(tok: str) -> tuple[int, int, int]:
    g, deg, cnt = tok.split(":")
    d = int(deg)
    if d % 45 or not 0 <= d < 360 or not 1 <= int(cnt) <= 4:
        raise ValueError(f"bad figure token {tok}")
    return _GLYPH_ORDER.index(g), d // 45, int(cnt) - 1


def _regular(seq: list[int], m: int) -> bool:
    """True if seq is a constant-step run, an alternating-step run, or a cycle of 2 or 3."""
    if len(seq) < 3:
        return True
    d = [(seq[i + 1] - seq[i]) % m for i in range(len(seq) - 1)]
    if len(set(d)) == 1:
        return True
    if all(d[i] == d[i % 2] for i in range(len(d))):
        return True
    return any(all(seq[i] == seq[i % p] for i in range(len(seq))) for p in (2, 3))


def solve_figure(item: dict) -> dict:
    shown = [_parse_token(t["token"]) for t in item["shown"]]
    opts = [_parse_token(t["token"]) for t in item["options"]]
    fits = []
    for k, o in enumerate(opts):
        ext = shown + [o]
        if all(_regular([t[a] for t in ext], _MOD[name]) for a, name in enumerate(("glyph", "rot", "count"))):
            fits.append(k)
    # also: nothing outside the options fits as a second reading of the shown terms
    outside = [c for c in product(range(6), range(8), range(4)) if c not in opts
               and all(_regular([t[a] for t in shown + [c]], _MOD[name]) for a, name in enumerate(("glyph", "rot", "count")))]
    return {"fits": fits, "outside": len(outside), "distinct": len(set(opts)) == len(opts)}


# ------------------------------------------------------------------ equations
_OK = (ast.Expression, ast.BinOp, ast.UnaryOp, ast.Add, ast.Sub, ast.Mult, ast.USub, ast.UAdd, ast.Constant, ast.Name, ast.Load)


def _compile(text: str, names: list[str]):
    tree = ast.parse(text, mode="eval")
    for node in ast.walk(tree):
        if not isinstance(node, _OK):
            raise ValueError(f"unexpected {type(node).__name__} in {text!r}")
        if isinstance(node, ast.Name) and node.id not in names:
            raise ValueError(f"unknown {node.id!r} in {text!r}")
        if isinstance(node, ast.Constant) and not isinstance(node.value, int):
            raise ValueError(f"non-integer in {text!r}")
    code = compile(tree, "<eq>", "eval")
    return lambda env: eval(code, {"__builtins__": {}}, env)


def solve_equation(item: dict) -> dict:
    names = list(item["unknowns"])
    lo, hi = item["range"]
    funcs = []
    for line in item["equations"]:
        lhs, rhs = line.split("=")
        f = _compile(lhs, names)
        funcs.append((f, int(rhs)))
    ask = _compile(item["ask"], names)
    sols = []
    for vals in product(range(lo, hi + 1), repeat=len(names)):
        env = dict(zip(names, vals))
        if all(f(env) == r for f, r in funcs):
            sols.append(env)
            if len(sols) > 1:
                break
    values = [o["text"] for o in item["options"]]
    return {"solutions": len(sols), "value": ask(sols[0]) if sols else None, "options": values}


# ------------------------------------------------------------------ Latin squares
def _complete(grid: list[list[Any]], symbols: list[str], limit: int = 2) -> list[list[list[Any]]]:
    """Up to `limit` completions, most-constrained blank first."""
    n = len(symbols)
    g = [row[:] for row in grid]
    out = []

    def options(r: int, c: int) -> list[str]:
        used = {g[r][j] for j in range(n)} | {g[j][c] for j in range(n)}
        return [s for s in symbols if s not in used]

    def go() -> None:
        if len(out) >= limit:
            return
        best, best_opts = None, None
        for r in range(n):
            for c in range(n):
                if g[r][c] is None:
                    o = options(r, c)
                    if best is None or len(o) < len(best_opts):
                        best, best_opts = (r, c), o
                        if not o:
                            return
        if best is None:
            out.append([row[:] for row in g])
            return
        r, c = best
        for s in best_opts:
            g[r][c] = s
            go()
            g[r][c] = None

    go()
    return out


def solve_latin(item: dict) -> dict:
    grid, syms = item["grid"], item["symbols"]
    n = len(syms)
    bad = []
    for r in range(n):
        row = [x for x in grid[r] if x is not None]
        if len(set(row)) != len(row):
            bad.append(f"row {r + 1} repeats")
    for c in range(n):
        col = [grid[r][c] for r in range(n) if grid[r][c] is not None]
        if len(set(col)) != len(col):
            bad.append(f"column {c + 1} repeats")
    sols = _complete(grid, syms)
    r, c = item["ask"]["row"] - 1, item["ask"]["col"] - 1
    return {"completions": len(sols), "bad": bad, "asked_blank": grid[r][c] is None,
            "symbol": sols[0][r][c] if sols else None, "options": [o["text"] for o in item["options"]]}


# ------------------------------------------------------------------ the sweep
def check_set(kind: str, seed: int, level: int, n: int) -> list[str]:
    """Problems found in one generated set (empty = the solver agrees with every key)."""
    pub, keys = ww_dmat.build(kind, seed, level, n)
    again, again_keys = ww_dmat.build(kind, seed, level, n)
    out = []
    if pub != again or keys != again_keys:
        out.append(f"{pub['set_id']}: same seed gave a different set")
    for item, key in zip(pub["items"], keys):
        tag = f"{pub['set_id']}#{item['i']}"
        if len(item["options"]) < 2 or not 0 <= key < len(item["options"]):
            out.append(f"{tag}: key {key} is not one of {len(item['options'])} options")
            continue
        if kind == "figure":
            r = solve_figure(item)
            if r["fits"] != [key]:
                out.append(f"{tag}: options that fit {r['fits']}, key {key}")
            if r["outside"]:
                out.append(f"{tag}: {r['outside']} figures outside the options also fit")
            if not r["distinct"]:
                out.append(f"{tag}: two options are the same figure")
        elif kind == "equation":
            r = solve_equation(item)
            if r["solutions"] != 1:
                out.append(f"{tag}: {r['solutions']} solutions")
            elif r["options"].count(str(r["value"])) != 1 or r["options"].index(str(r["value"])) != key:
                out.append(f"{tag}: solver says {r['value']}, options {r['options']}, key {key}")
            if len(set(r["options"])) != len(r["options"]):
                out.append(f"{tag}: duplicate options")
        else:
            r = solve_latin(item)
            if r["bad"]:
                out.append(f"{tag}: {r['bad']}")
            if r["completions"] != 1:
                out.append(f"{tag}: {r['completions']} completions")
            elif not r["asked_blank"]:
                out.append(f"{tag}: the asked cell is already filled")
            elif r["options"].index(r["symbol"]) != key:
                out.append(f"{tag}: solver says {r['symbol']}, key {r['options'][key]}")
    # timing contract the page relies on
    if pub["time_limit_s"] != n * ww_dmat.seconds_per_item(kind, level):
        out.append(f"{pub['set_id']}: time limit is not n x seconds per item")
    return out


def sweep(seeds: int = 200) -> dict:
    t0 = time.perf_counter()
    res: dict[str, Any] = {"seeds": seeds, "kinds": {}, "problems": []}
    for kind in ww_dmat.KINDS:
        t = time.perf_counter()
        probs, items = [], 0
        for seed in range(seeds):
            level = seed % 5 + 1
            n = ITEMS_PER_SEED[kind]
            probs += check_set(kind, seed, level, n)
            items += n
        res["kinds"][kind] = {"items": items, "mismatches": len(probs), "seconds": round(time.perf_counter() - t, 2)}
        res["problems"] += probs
    res["seconds"] = round(time.perf_counter() - t0, 2)
    return res


def main() -> int:
    r = sweep(200)
    for k, v in r["kinds"].items():
        print(f"{k:9} {v['items']} items over {r['seeds']} seeds, mismatches {v['mismatches']}, {v['seconds']} s")
    for p in r["problems"][:20]:
        print("  ", p)
    print("dMAT gate", "passed" if not r["problems"] else "FAILED", f"({r['seconds']} s)")
    return 0 if not r["problems"] else 1


if __name__ == "__main__":
    sys.exit(main())
