"""/api/mission/dmat: Well Wisher's dMAT practice (generators in ww_dmat.py).

    GET  /api/mission/dmat/set?kind=&seed=&n=&level=   a timed set: figure | equation | latin; no key in it
    POST /api/mission/dmat/score                       {set_id | kind+seed+level+n, answers, seconds}  mark it, keep the result
    GET  /api/mission/dmat/history?kind=&limit=        the last results, newest first

Additive and live-safe: no existing route or state key changes. Results live under their own
key-value key ("@ww_dmat"), not in the Mission plan state: germoney.merge_plan_state keeps only the
keys it lists, so a new plan-state key would be dropped on the next load unless germoney.py
learned it, and a practice score does not need the plan engine. The set is never stored, only
(kind, seed, level, n) and the result; the key is recomputed from the seed when marking.

The server marks, so the page never holds the key. An answer is an option index (0-based) for every
kind, null for skipped.
"""
from __future__ import annotations

import json
import secrets
import threading
import time
from datetime import date
from typing import Any, Optional

from fastapi import Body, FastAPI, HTTPException, Query
from starlette.concurrency import run_in_threadpool

from . import ww_dmat

KEY = "@ww_dmat"
KEEP = 200                         # results kept; 200 sets is months of practice at one a day


def _load(kv) -> list[dict]:
    try:
        v = json.loads(kv.get(KEY) or "[]")
        return v if isinstance(v, list) else []
    except ValueError:
        return []


def record(kv, res: dict, today: Optional[str] = None) -> dict:
    row = {"t": round(time.time(), 1), "date": today or date.today().isoformat(),
           **{k: res[k] for k in ("set_id", "kind", "seed", "level", "n", "correct", "of", "unanswered", "seconds", "time_limit_s", "in_time")}}
    rows = (_load(kv) + [row])[-KEEP:]
    kv.set(KEY, json.dumps(rows))
    return row


def register(app: FastAPI, svc, bus) -> None:
    lock = threading.Lock()

    def fail(e: ValueError):
        raise HTTPException(400, str(e))

    @app.get("/api/mission/dmat/set")
    async def dmat_set(kind: str = Query(...), seed: Optional[int] = Query(None), n: int = Query(10), level: int = Query(1)):
        # No seed asked for = a fresh one, returned so the same set can be replayed or marked.
        sd = secrets.randbelow(2 ** 31) if seed is None else seed
        try:
            pub, _ = await run_in_threadpool(ww_dmat.build, kind, sd, level, n)
        except ValueError as e:
            fail(e)
        return pub

    @app.post("/api/mission/dmat/score")
    async def dmat_score(body: dict = Body(...)):
        try:
            if body.get("set_id"):
                kind, seed, level, n = ww_dmat.parse_set_id(body["set_id"])
            else:
                kind, seed, level, n = body.get("kind"), body.get("seed"), body.get("level"), body.get("n")
            ww_dmat.check_args(kind, seed, level, n)
            res = await run_in_threadpool(ww_dmat.mark, kind, seed, level, n, body.get("answers"), body.get("seconds"))
        except ValueError as e:
            fail(e)

        def store() -> dict:
            with lock:
                return record(svc.kv, res)
        res["saved"] = await run_in_threadpool(store)
        return res

    @app.get("/api/mission/dmat/history")
    async def dmat_history(kind: Optional[str] = Query(None), limit: int = Query(20)):
        if kind is not None and kind not in ww_dmat.KINDS:
            raise HTTPException(400, f"kind is one of {', '.join(ww_dmat.KINDS)}")
        rows = await run_in_threadpool(_load, svc.kv)
        rows = [r for r in rows if kind is None or r.get("kind") == kind][::-1][:max(1, min(limit, KEEP))]
        return {"results": rows, "kinds": list(ww_dmat.KINDS), "levels": list(ww_dmat.LEVELS),
                "empty": not rows}
