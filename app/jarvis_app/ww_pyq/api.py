"""One response envelope and one error mapping for every pyq route file (plan file, section 4).

    ok(state, reason, source, **payload)   -> {"state", "reason", "source", ...payload}
    items(rows, state, reason, source)     -> the same with "items" and "count"
    guard(fn, *a, **k)                     -> KeyError becomes 404, ValueError 400, Busy 409

A value never travels without its state (rule 3): `state` is one of schema.STATES and `reason` is
a sentence the screen can print as it is. `source` says where the value came from ("your papers
on file", "rule", "ww_generator"), never a file path outside the data directory.
"""
from __future__ import annotations

from typing import Any, Callable, Iterable

from fastapi import HTTPException

from .schema import STATES


class Busy(RuntimeError):
    """One job at a time: a second ingest while one runs."""


def ok(state: str, reason: str, source: str, **payload: Any) -> dict:
    if state not in STATES:
        raise ValueError(f"state must be one of {', '.join(STATES)}")
    return {"state": state, "reason": reason, "source": source, **payload}


def items(rows: Iterable[Any], state: str, reason: str, source: str, **payload: Any) -> dict:
    rows = list(rows)
    return ok(state, reason, source, items=rows, count=len(rows), **payload)


def guard(fn: Callable, *a: Any, **k: Any) -> Any:
    """Run a store or engine call for a route: an unknown id is 404, a bad value 400, a busy job 409."""
    try:
        return fn(*a, **k)
    except KeyError as e:
        raise HTTPException(404, str(e).strip("'").strip('"'))
    except Busy as e:
        raise HTTPException(409, str(e))
    except ValueError as e:
        raise HTTPException(400, str(e))
