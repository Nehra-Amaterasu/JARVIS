"""/api/reminders: reminders, timers, alarms and timed switches (reminders.py).

    GET    /api/reminders              pending (soonest first), the last day's fired ones, a spoken summary
    POST   /api/reminders              {text, when | due, kind?, repeat?, interval_min?, action?, origin?}
    POST   /api/reminders/cancel       {query?, kind?, all?}  — "cancel the reminder to call Mum"
    DELETE /api/reminders/{id}
    POST   /api/reminders/{id}/snooze  {minutes?}
    POST   /api/reminders/{id}/ack     he confirmed it ("done", "le li")

The scheduler starts with the app (chained onto the server's lifespan, so server.py
is not edited) and stops with it.
"""
from __future__ import annotations

import asyncio
from contextlib import asynccontextmanager
from typing import Any, Optional

from fastapi import Body, FastAPI, HTTPException
from starlette.concurrency import run_in_threadpool

from .reminders import (ReminderError, ReminderScheduler, ReminderStore, W, _dt, describe_item, describe_list,
                        describe_new)


def _chain_lifespan(app: FastAPI, start) -> None:
    """Run `start()` (a coroutine factory) as a task for the app's lifetime, after the
    server's own startup — the bus is bound to the loop by then."""
    inner = app.router.lifespan_context

    @asynccontextmanager
    async def lifespan(a):
        async with inner(a) as state:
            task = asyncio.create_task(start())
            try:
                yield state
            finally:
                task.cancel()
    app.router.lifespan_context = lifespan


def register(app: FastAPI, svc, bus) -> None:
    store = ReminderStore()
    sched = ReminderScheduler(store, bus, core=getattr(svc, "core", None), limbs=getattr(svc, "limbs", None))
    if svc is not None:
        svc.reminders, svc.reminder_scheduler = store, sched
    _chain_lifespan(app, sched.run)

    def _from_phrase(phrase: str, origin: str) -> dict:
        """The card's one box: "call Mum at 9 pm", "timer 10 min", "medicine 8 am daily".
        Read as he would say it to JARVIS, with "remind me to" added when he left it out."""
        now = _dt(store.clock())
        for said in (phrase, f"remind me to {phrase}"):
            intent = W.parse_reminder(said, now)
            if intent is not None and intent.op == "create" and intent.kind != "action":
                if intent.missing:
                    raise ReminderError("say when: add a time like 'at 9 pm' or 'in 10 minutes'.")
                return store.create(text=intent.text, kind=intent.kind, when=said, origin=origin)
        raise ReminderError("I couldn't find a time in that. Try 'call Mum at 9 pm' or 'timer 10 minutes'.")

    def voice_on() -> bool:
        core = getattr(svc, "core", None)
        return bool(core is not None and core.running and core.mode == "voice")

    @app.get("/api/reminders")
    def reminders_view():
        now = store.clock()
        items = store.pending()
        return {"items": items, "recent": store.recent(), "now": now, "say": describe_list(items, now),
                "voice": voice_on()}

    @app.post("/api/reminders")
    def reminders_create(payload: dict = Body(...)):
        try:
            if payload.get("phrase"):
                r = _from_phrase(str(payload["phrase"])[:300], payload.get("origin") or "app")
            else:
                r = store.create(text=payload.get("text") or "", kind=payload.get("kind") or "reminder",
                                 when=payload.get("when"), due=payload.get("due"), repeat=payload.get("repeat"),
                                 interval_min=payload.get("interval_min"), action=payload.get("action"),
                                 origin=payload.get("origin") or "app")
        except ReminderError as e:
            raise HTTPException(400, str(e))
        say = describe_new(r, store.clock())
        bus.publish("reminders", "created", say, reminder=r)
        return {"reminder": r, "say": say}

    @app.post("/api/reminders/cancel")
    def reminders_cancel(query: str = Body("", embed=True), kind: Optional[str] = Body(None, embed=True),
                         all: bool = Body(False, embed=True)):  # noqa: A002
        done = store.cancel_matching(query, kind or None, all)
        if not done:
            say = "There's no pending reminder matching that."
        elif len(done) == 1:
            say = f"Cancelled: {describe_item(done[0], store.clock())}."
        else:
            say = f"Cancelled {len(done)} reminders."
        for r in done:
            bus.publish("reminders", "cancelled", f"Cancelled: {r.get('text') or r['kind']}", reminder=r)
        return {"cancelled": done, "say": say}

    @app.delete("/api/reminders/{rid}")
    def reminders_delete(rid: str):
        r = store.cancel(rid)
        if r is None:
            raise HTTPException(404, "no such pending reminder")
        bus.publish("reminders", "cancelled", f"Cancelled: {r.get('text') or r['kind']}", reminder=r)
        return {"ok": True, "reminder": r}

    @app.post("/api/reminders/{rid}/snooze")
    def reminders_snooze(rid: str, minutes: int = Body(10, embed=True)):
        r = store.snooze(rid, minutes)
        if r is None:
            raise HTTPException(404, "no such reminder")
        say = f"Snoozed for {max(1, min(240, int(minutes)))} minutes."
        bus.publish("reminders", "snoozed", say, reminder=r)
        return {"reminder": r, "say": say}

    @app.post("/api/reminders/{rid}/ack")
    async def reminders_ack(rid: str):
        r: Any = await run_in_threadpool(store.ack, rid)
        if r is None:
            raise HTTPException(404, "no such reminder")
        bus.publish("reminders", "acked", f"Done: {r.get('text') or r['kind']}", reminder=r)
        return {"reminder": r}
