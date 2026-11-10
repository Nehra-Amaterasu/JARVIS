"""/api/mission/status/v2: what Well Wisher's Proof panel shows beyond /api/mission/status (ww_status.py).

    GET  /api/mission/status/v2?today=   4-week series per Life counter (weeks with no data are left out, never 0),
                                         consistency (days on the line over days asked), the next rank's full
                                         requirement list (met and unmet), the System's suggestions with the place each
                                         one goes to, Recent grouped by day, Wins, and advice
                                         lines that each name their source (data/ww_advice.json)

Read-only: no write, no thread, no network. It reads the plan state through the same Plan object routes_mission
registers (alphabetical order puts routes_mission first), so a tap on the Life page shows here on the next
request. `today` is for tests and for replaying a day; the UI never sends it.
"""
from __future__ import annotations

from datetime import date
from typing import Optional

from fastapi import FastAPI, HTTPException, Query
from starlette.concurrency import run_in_threadpool

from . import germoney, wellwisher, ww_engines, ww_status
from .ww_base import is_date


def register(app: FastAPI, svc, bus) -> None:
    plan = getattr(svc, "plan", None) or germoney.Plan(svc.kv)

    def build(today: str) -> dict:
        st = plan.load(today)
        bank = plan.bank()
        rank = wellwisher.rank(bank, st, today)
        stats = wellwisher.stats(bank, st, today)
        rules = wellwisher.advice(st, stats, wellwisher.load_questlines())
        return ww_status.status_v2(st, ww_engines.load_inputs(), today, rank["have"], rank["rank"], stats, rules=rules)

    @app.get("/api/mission/status/v2")
    async def status_v2(today: Optional[str] = Query(None)):
        if today is not None and not is_date(today):
            raise HTTPException(400, "today is a date, YYYY-MM-DD")
        return await run_in_threadpool(build, today or date.today().isoformat())
