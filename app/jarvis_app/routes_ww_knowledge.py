"""/api/mission/knowledge: the day's six cards (exam subject, skill, life, word, fact, thought).

    GET  /api/mission/knowledge/today          the six cards; the first read of a day draws, later reads return the same
    POST /api/mission/knowledge/refresh        {slot}  a new item for one slot: exam | skill | life | word | fact | thought

Drawn from the concept bank (the three tracks) and from his curated lists (word, fact, thought);
never generated. No repeat inside the window described in ww_knowledge.py. An empty pool is a card
with empty: true and a sentence, not a filler. State key "@ww_knowledge", beside the plan state.
"""
from __future__ import annotations

import threading
from datetime import date

from fastapi import Body, FastAPI, HTTPException
from starlette.concurrency import run_in_threadpool

from . import germoney, ww_knowledge


def _today() -> str:
    return date.today().isoformat()


def register(app: FastAPI, svc, bus) -> None:
    lock = threading.Lock()

    def plan():
        # routes_mission registers first (alphabetical) and leaves its Plan on svc.
        return getattr(svc, "plan", None) or germoney.Plan(svc.kv)

    @app.get("/api/mission/knowledge/today")
    async def know_today():
        def go():
            with lock:
                return ww_knowledge.today_view(svc.kv, _today(), plan(), germoney.load_bank())
        return await run_in_threadpool(go)

    @app.post("/api/mission/knowledge/refresh")
    async def know_refresh(slot: str = Body(..., embed=True)):
        def go():
            with lock:
                return ww_knowledge.refresh(svc.kv, slot, _today(), plan(), germoney.load_bank())
        try:
            return await run_in_threadpool(go)
        except ValueError as e:
            raise HTTPException(400, str(e))
