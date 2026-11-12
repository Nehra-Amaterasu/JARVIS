"""Contrast of every text-over-art placement in the assignment JSON (docs/design/jarvis-product-overhaul.md 8.5.3 item 3).

    python tools/art/check_contrast.py [--assignments FILE]

Each `contrast_treatment` string states a rule; this script turns the rule into a computed worst case from
the real clay tokens (app/ui/src/styles/design/clay/primitive-color.css), so a token change that breaks a
picture's text fails here, next to the token contrast test. A treatment with no rule here fails on purpose:
a new kind of placement needs a new rule, not a silent pass. The ratios the JSON quotes (5.45:1, 6.64:1) are
recomputed and must agree to two decimals, so a stale claim fails too.
"""
from __future__ import annotations

import argparse
import re
import sys
from collections import defaultdict
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import artlib as A  # noqa: E402
from assets import ROOT, assignments_path, load_assignments  # noqa: E402

LIGHT_GROUNDS = ("--p-clay-50", "--p-clay-100", "--p-clay-150", "--p-clay-200")
DARK_GROUNDS = ("--p-char-950", "--p-char-900", "--p-char-800", "--p-char-700")
INK = {"light": {"ink1": "--p-char-800", "ink2": "--p-clay-700", "ink3": "--p-clay-600", "edge": "--p-clay-500"},
       "dark": {"ink1": "--p-bone", "ink2": "--p-char-200", "ink3": "--p-char-300", "edge": "--p-char-400"}}


def _worst(tokens: dict[str, str], fg: str, grounds: tuple[str, ...]) -> float:
    return min(A.contrast_ratio(A.hex_rgb(tokens[fg]), A.hex_rgb(tokens[g])) for g in grounds if g in tokens)


def rule_not_rendered(m, t):
    return True, "not rendered"


def rule_atmosphere(m, t):
    hi = max(float(x) for x in re.findall(r"(\d+(?:\.\d+)?)\s*%", m.group(0)))
    return hi <= 15.0, f"opacity cap {hi:g} % (limit 15 %)"


def rule_scrim(m, t):
    hexv, pct = m.group(1), float(m.group(2)) / 100.0
    # worst case: a white picture under the scrim, so the scrim blends toward the lightest ground it can show
    sc = A.hex_rgb(hexv)
    blended = tuple(pct * s + (1 - pct) * 255.0 for s in sc)
    r = A.contrast_ratio(A.hex_rgb(t[INK["dark"]["ink1"]]), blended)
    return r >= 4.5 and hexv.lower() == t["--p-char-800"], f"ink-1 on a white picture under a {pct:.0%} {hexv} scrim: {r:.2f}:1 (need 4.5)"


def rule_data_marks(m, t):
    lo, hi = _worst(t, INK["light"]["edge"], LIGHT_GROUNDS), _worst(t, INK["dark"]["edge"], DARK_GROUNDS)
    return min(lo, hi) >= 3.0, f"edge-ui worst case {lo:.2f}:1 light, {hi:.2f}:1 dark (need 3.0)"


def rule_glyph_field(m, t):
    lt = A.contrast_ratio(A.hex_rgb(t[INK["light"]["ink3"]]), A.hex_rgb(t["--p-clay-100"]))
    dk = A.contrast_ratio(A.hex_rgb(t[INK["dark"]["ink3"]]), A.hex_rgb(t["--p-char-800"]))
    said_l, said_d = float(m.group(1)), float(m.group(2))
    ok = lt >= 4.5 and dk >= 4.5 and round(lt, 2) == said_l and round(dk, 2) == said_d
    return ok, f"ink-3 {lt:.2f}:1 on clay-light (JSON says {said_l}), {dk:.2f}:1 on #171717 (JSON says {said_d})"


def rule_frame(m, t):
    e = min(_worst(t, INK["light"]["edge"], LIGHT_GROUNDS), _worst(t, INK["dark"]["edge"], DARK_GROUNDS))
    i = min(_worst(t, INK["light"]["ink2"], LIGHT_GROUNDS), _worst(t, INK["dark"]["ink2"], DARK_GROUNDS))
    return e >= 3.0 and i >= 4.5, f"frame {e:.2f}:1 (need 3.0), ink-2 {i:.2f}:1 (need 4.5)"


RULES = [
    (re.compile(r"^Not rendered in the product"), rule_not_rendered),
    (re.compile(r"^Atmosphere only: capped at [^.]*opacity"), rule_atmosphere),
    (re.compile(r"(#[0-9a-fA-F]{6}) scrim at (\d+(?:\.\d+)?) % opacity"), rule_scrim),
    (re.compile(r"^Marks that encode data are drawn in --edge-ui"), rule_data_marks),
    (re.compile(r"^Glyph field drawn in --ink-3 \((\d+\.\d+):1 on clay-light ground, (\d+\.\d+):1 on #171717"), rule_glyph_field),
    (re.compile(r"^Frame and lines in --edge-ui"), rule_frame),
]


def check(rows: list[dict], tokens: dict[str, str]) -> tuple[list[str], dict[str, list]]:
    bad: list[str] = []
    seen: dict[str, list] = defaultdict(list)
    for r in rows:
        text = r["contrast_treatment"]
        for rx, fn in RULES:
            m = rx.search(text)
            if m:
                ok, why = fn(m, tokens)
                seen[why].append(r["id"])
                if not ok:
                    bad.append(f"{r['id']}: {why}")
                break
        else:
            bad.append(f"{r['id']}: no contrast rule matches this treatment: {text[:70]}...")
    return bad, seen


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--assignments")
    a = ap.parse_args(argv)
    rows = load_assignments(assignments_path(a.assignments))
    bad, seen = check(rows, A.load_tokens(ROOT))
    for why, ids in sorted(seen.items()):
        print(f"{len(ids):3d} placements  {why}")
    for b in bad:
        print("FAIL", b)
    print(f"{len(rows)} placements, {len(bad)} failing")
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())
