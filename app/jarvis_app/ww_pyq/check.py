"""The numeric check (E08, R-26): does the number he typed match a question's numeric key?

    check_numeric(key, answer) -> {match: True | False | None, key, parsed, tolerance, note}

It answers match or no match, never marks: the marks are his to give on the marking sheet, so a
near miss in a derivation is never scored by this function.

Both strings are read as a number with an optional unit: a decimal, scientific notation (1.25e-2,
1.25×10^-2), or a fraction a/b, then a unit with an optional SI prefix (p n u µ m k M G) on a small
set of units (V A W ohm F H s Hz m g J C S rad, and % with no prefix). Two values match when the
units agree and the answer is within the larger of 1 percent of the key or half of the key's last
printed digit: a key printed "0.12" was rounded, so 0.124 is the same number (half a digit, 0.005,
is larger than 1 percent, 0.0012), while "12.5 ms" allows 0.125 ms. ww_numericals stores keys to
4 significant figures with a 1 percent tolerance, which this keeps.

A bare number is read in the key's unit and the note says so; a key with no number (a derivation,
a sketch) answers match None with a note. An answer that is not a number is a ValueError (400).
"""
from __future__ import annotations

import math
import re
from typing import Optional, TypedDict

REL_TOL = 0.01
_PREFIX = {"p": 1e-12, "n": 1e-9, "u": 1e-6, "µ": 1e-6, "μ": 1e-6, "m": 1e-3, "k": 1e3, "M": 1e6, "G": 1e9}
_BASE = {"V": "V", "A": "A", "W": "W", "ohm": "ohm", "ohms": "ohm", "Ohm": "ohm", "Ω": "ohm", "Ω": "ohm",
         "F": "F", "H": "H", "s": "s", "sec": "s", "Hz": "Hz", "m": "m", "g": "g", "J": "J", "C": "C", "S": "S",
         "rad": "rad", "%": "%"}
_NUM = re.compile(r"^(?P<num>[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?)"
                  r"(?:\s*/\s*(?P<den>[+-]?(?:\d+(?:\.\d*)?|\.\d+)))?\s*(?P<unit>.*)$")
_MAX_LEN = 120   # a number with a unit is under 30 characters; a longer string is not one, and the x10^ rewrite below is quadratic in spaces
_UNIT = re.compile(r"^[A-Za-zΩΩµμ%°][A-Za-zΩΩµμ%°/^0-9]{0,11}$")


class CheckResult(TypedDict, total=False):
    match: Optional[bool]
    key: str
    parsed: dict
    tolerance: Optional[float]
    note: str


class _Q:
    __slots__ = ("value", "unit", "factor", "half_digit", "text_unit")

    def __init__(self, value: float, unit: str, factor: float, half_digit: float, text_unit: str):
        self.value, self.unit, self.factor, self.half_digit, self.text_unit = value, unit, factor, half_digit, text_unit


def _unit(u: str) -> tuple[str, float]:
    """(base unit, factor to it). An unknown unit is kept as written with factor 1."""
    if u in _BASE:
        return _BASE[u], 1.0
    if len(u) > 1 and u[0] in _PREFIX and u[1:] in _BASE and _BASE[u[1:]] != "%":
        return _BASE[u[1:]], _PREFIX[u[0]]
    return u, 1.0


def _parse(text) -> Optional[_Q]:
    if not isinstance(text, str) or len(text) > _MAX_LEN:
        return None
    t = text.strip().replace("−", "-").replace(",", "")
    t = re.sub(r"\s*[x×*]\s*10\s*\^\s*\{?\s*([+-]?\d+)\s*\}?", r"e\1", t)
    m = _NUM.match(t)
    if not m:
        return None
    num, den, unit = m.group("num"), m.group("den"), m.group("unit").strip().rstrip(".")
    if unit and not _UNIT.match(unit):
        return None
    try:
        v = float(num)
        if den is not None:
            d = float(den)
            if d == 0:
                return None
            v = v / d
    except (ValueError, OverflowError):
        return None
    if not math.isfinite(v):
        return None
    base, factor = _unit(unit) if unit else ("", 1.0)
    if den is not None:
        half = 0.0                             # a fraction is exact: only the 1 percent applies
    else:
        mant, _, exp = num.lower().partition("e")
        decimals = len(mant.split(".")[1]) if "." in mant else 0
        try:
            half = 0.5 * 10.0 ** (-decimals) * 10.0 ** (int(exp) if exp else 0)
        except (OverflowError, ValueError):
            return None                        # 0e999999 is zero but its digit step is not a float
    return _Q(v * factor, base, factor, half * factor, unit)


def _sig(x: float) -> float:
    return float(f"{x:.6g}")


def check_numeric(key: str, answer: str) -> CheckResult:
    a = _parse(answer)
    if a is None:
        raise ValueError("That answer is not a number.")
    k = _parse(key)
    key_text = str(key or "").strip()
    if k is None:
        return {"match": None, "key": key_text, "parsed": {"value": _sig(a.value / a.factor), "unit": a.text_unit},
                "tolerance": None, "note": "This question has no numeric key."}
    notes = []
    if not a.unit and k.unit:
        a = _Q(a.value * k.factor, k.unit, k.factor, 0.0, k.text_unit)
        notes.append(f"No unit given; read in {k.text_unit}.")
    elif a.unit and not k.unit:
        notes.append("The key has no unit; the number is compared as it is.")
    elif a.unit != k.unit:
        return {"match": False, "key": key_text, "parsed": {"value": _sig(a.value / a.factor), "unit": a.text_unit},
                "tolerance": None, "note": f"The units differ: the key is in {k.text_unit}, the answer in {a.text_unit}."}
    tol = max(REL_TOL * abs(k.value), k.half_digit)
    diff = abs(a.value - k.value)
    match = diff <= tol + 1e-9 * max(1.0, abs(k.value))
    shown = k.text_unit
    notes.append(("Within" if match else "Outside") + f" {_sig(tol / k.factor):g}{(' ' + shown) if shown else ''} of the key.")
    return {"match": match, "key": key_text, "parsed": {"value": _sig(a.value / k.factor), "unit": shown},
            "tolerance": _sig(tol / k.factor), "note": " ".join(notes)}
