"""Well Wisher engine kit: the spec every engine registers with, a small schema
checker for its inputs, and the date helpers the engines share.

An engine is a pure function

    engine(inputs: dict, today: str, **data) -> dict

registered as an EngineSpec (name, version, the input sections and data it reads,
each with a schema). ww_engines.run() checks the inputs against the schema before
the engine runs, so a malformed input is an answer ("invalid_input" with the
problems), never an exception halfway through. No I/O here.
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field
from datetime import date
from typing import Any, Callable, Optional

_DATE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
_MONTH = re.compile(r"^\d{4}-\d{2}$")


# ------------------------------------------------------------------ the spec
@dataclass(frozen=True)
class EngineSpec:
    name: str
    version: int
    fn: Callable[..., dict]
    about: str = ""
    needs: tuple[str, ...] = ()
    inputs: dict = field(default_factory=dict)    # section of the normalized inputs -> schema
    data: dict = field(default_factory=dict)      # keyword argument -> schema (an absent argument is fine)

    def describe(self) -> dict:
        return {"name": self.name, "version": self.version, "about": self.about, "needs": list(self.needs),
                "inputs": self.inputs, "data": self.data}


# ------------------------------------------------------------------ schema checking
# A schema is a small dict:
#   {"type": "list", "items": <schema>}       a list whose items match
#   {"type": "dict", "required": {k: <schema>}, "values": <schema>}
#   {"type": "str" | "num" | "int" | "bool" | "date" | "month" | "any"}
#   "optional": True lets the value be None.
def is_date(v: Any) -> bool:
    if not (isinstance(v, str) and _DATE.match(v)):
        return False
    try:
        date.fromisoformat(v)
        return True
    except ValueError:
        return False


def is_month(v: Any) -> bool:
    return isinstance(v, str) and bool(_MONTH.match(v)) and 1 <= int(v[5:7]) <= 12


def check(value: Any, schema: dict, where: str = "inputs") -> list[str]:
    """The problems with `value` against `schema` (empty: it matches). Stops at 20."""
    out: list[str] = []
    _check(value, schema, where, out)
    return out[:20]


def _check(v: Any, s: dict, where: str, out: list[str]) -> None:
    if len(out) >= 20:
        return
    if v is None and s.get("optional"):
        return
    t = s.get("type", "any")
    ok = {"any": True, "str": isinstance(v, str), "bool": isinstance(v, bool),
          "num": isinstance(v, (int, float)) and not isinstance(v, bool),
          "int": isinstance(v, int) and not isinstance(v, bool), "date": is_date(v), "month": is_month(v),
          "list": isinstance(v, list), "dict": isinstance(v, dict)}.get(t, False)
    if not ok:
        out.append(f"{where}: expected {t}, got {type(v).__name__}")
        return
    if t == "list" and "items" in s:
        for i, x in enumerate(v):
            _check(x, s["items"], f"{where}[{i}]", out)
    if t == "dict":
        for k, sub in (s.get("required") or {}).items():
            if k not in v:
                if not sub.get("optional"):
                    out.append(f"{where}: missing {k}")
            else:
                _check(v[k], sub, f"{where}.{k}", out)
        if "values" in s:
            for k, x in v.items():
                _check(x, s["values"], f"{where}.{k}", out)


# ------------------------------------------------------------------ shared helpers
def days_between(a: str, b: str) -> int:
    return (date.fromisoformat(b) - date.fromisoformat(a)).days


def add_days(d: str, n: int) -> str:
    return date.fromordinal(date.fromisoformat(d).toordinal() + n).isoformat()


def urgency(days_left: Optional[int]) -> float:
    """1.0 when due within a week, falling to 0.1 at ten weeks and beyond; overdue is 0 (it's gone)."""
    if days_left is None:
        return 0.1
    if days_left < 0:
        return 0.0
    if days_left <= 7:
        return 1.0
    return max(0.1, round(7 / days_left, 3))


def plural(n: int, word: str, many: Optional[str] = None) -> str:
    return f"{n} {word if n == 1 else (many or word + 's')}"


def inr(x: Optional[float]) -> str:
    """Rupees with Indian grouping (12,34,567); unknown stays unknown."""
    if x is None:
        return "unknown"
    neg, n = x < 0, int(round(abs(x)))
    s = str(n)
    if len(s) > 3:
        head, tail = s[:-3], s[-3:]
        parts = []
        while len(head) > 2:
            parts.insert(0, head[-2:])
            head = head[:-2]
        if head:
            parts.insert(0, head)
        s = ",".join(parts + [tail])
    return f"{'-' if neg else ''}Rs {s}"


# Wording the System never uses about him (rule: never shame). Engines run their own
# sentences through no_shame() in the tests; the list is kept short and literal.
SHAME = re.compile(r"\b(lazy|failed|failure|you must|you should have|again\?|disappoint\w*|behind schedule|"
                   r"no excuses?|wasted|pathetic|useless|streak (is )?(lost|broken))\b", re.I)


def no_shame(text: str) -> bool:
    return not SHAME.search(text or "")
