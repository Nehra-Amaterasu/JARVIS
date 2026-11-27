"""/api/mission/career/deadlines: deadline rows that carry their documents and lead times (ww_career_deadlines.py, wave EW10 KB).

    GET    /api/mission/career/deadlines                    K-05 every row soonest first: closes, days_left, checked_on, stale, the documents with start_by, auto_remind
    PUT    /api/mission/career/deadlines/settings           the switch {auto_remind: bool}, off by default
    PUT    /api/mission/career/deadlines/{row_id}           K-06 {requires?: [{doc, lead_days, ready?}], closes?, checked_on?}: start_by is computed, never typed
    POST   /api/mission/career/deadlines/{row_id}/remind    K-07 one reminder a document at its start_by; a second press answers the same ones

Rows come from the deadlines of his inputs (row id "in.<id>") and his applications (row id "app.<id>"); both stores are
read only here, and what he types lives in the package's own file under the private data directory. A reminder is
raised only by his press on K-07, or by the switch when he saves a row's documents, through the app's reminder service
(svc.reminders, left there by routes_reminders, which mounts first); with the switch off and no press none exists.
Nothing is sent, submitted or fetched. Every JSON answer is the {state, reason, source, ...} envelope of ww_pyq/api.py:
an unknown row is 404, a bad value 400, an unreadable file of his 409.
"""
from __future__ import annotations

from typing import Any

from fastapi import Body, FastAPI
from starlette.concurrency import run_in_threadpool

from . import ww_career_deadlines as D
from .ww_pyq import api

SOURCE = "your inputs, your applications and the documents you typed"
SOURCE_SET = "your settings"


def _n(n: int, one: str, many: str) -> str:
    return f"{n} {one if n == 1 else many}"


def register(app: FastAPI, svc, bus) -> None:
    def apps_of() -> list:
        plan = getattr(svc, "plan", None)
        if plan is None or getattr(plan, "apps", None) is None:
            raise RuntimeError("the plan store is not up")
        return plan.apps.all()

    def inputs_of() -> dict:
        from . import ww_engines
        return ww_engines.load_inputs()

    app.state.career_deadlines = D.Deadlines(inputs_of=inputs_of, apps_of=apps_of)

    def dl() -> D.Deadlines:
        return app.state.career_deadlines

    def rs() -> Any:
        return getattr(svc, "reminders", None)

    def publish(text: str) -> None:
        try:
            bus.publish("mission", "update", text[:140])
        except Exception:
            pass

    # ------------------------------------------------------------------ K-05
    @app.get("/api/mission/career/deadlines")
    async def get_deadlines():
        def work():
            v = dl().view(rs())
            body = {k: v[k] for k in ("items", "orphans", "auto_remind", "notes", "today")}
            if v["fault"]:
                return api.ok("fault", v["fault"], SOURCE, **body)
            if not v["items"]:
                return api.ok("waiting", "No deadline rows yet: add a deadline in your inputs or an application.", SOURCE, **body)
            stale = sum(r["stale"] for r in v["items"])
            late = sum(d["late"] for r in v["items"] for d in r["requires"])
            reason = _n(len(v["items"]), "row", "rows") + "."
            if stale:
                reason += f" {_n(stale, 'closing date has', 'closing dates have')} not been checked in {D.STALE_DAYS} days."
            if late:
                reason += f" {_n(late, 'document is', 'documents are')} past its start date."
            return api.ok("live", reason, SOURCE, **body)
        return await run_in_threadpool(api.guard, work)

    # ------------------------------------------------------------------ the switch (before {row_id}, so it is not read as a row)
    @app.put("/api/mission/career/deadlines/settings")
    async def put_settings(body: Any = Body(...)):
        def work():
            s = dl().set_settings(body)
            if s["auto_remind"]:
                return api.ok("live", "On: when you save a row's documents, each one gets a reminder at its start date.", SOURCE_SET, settings=s)
            # switching off is "raise no new ones": cancelling his pending reminders silently would leave him without them
            return api.ok("planned", "Off: no reminder is raised unless you press Remind on a row; the ones already raised stay.",
                          SOURCE_SET, settings=s)
        return await run_in_threadpool(api.guard, work)

    # ------------------------------------------------------------------ K-06
    @app.put("/api/mission/career/deadlines/{row_id}")
    async def put_row(row_id: str, body: Any = Body(...)):
        def work():
            out = dl().put(row_id, body, rs())
            row, gone, auto = out["row"], out["cancelled"], out["auto"]
            reason = f"Saved {row['title']}: {_n(len(row['requires']), 'document', 'documents')}."
            if row["closes"] is None and row["requires"]:
                reason += " No closing date on file, so no start date can be worked out."
            if gone:
                reason += (f" {_n(len(gone), 'reminder was', 'reminders were')} cancelled because the document was removed,"
                           " marked ready or its start date moved.")
            if auto is not None:
                reason += f" Switch on: {_n(auto['raised'], 'reminder', 'reminders')} raised."
            elif any(c["why"] == "start_by moved" for c in gone):
                reason += " Press Remind to raise them at the new start dates."
            publish(f"deadline row saved: {row['title']}")
            return api.ok("live", reason, SOURCE, row=row, cancelled=gone, reminders=(auto or {}).get("reminders"))
        return await run_in_threadpool(api.guard, work)

    # ------------------------------------------------------------------ K-07
    @app.post("/api/mission/career/deadlines/{row_id}/remind")
    async def post_remind(row_id: str):
        def work():
            service = rs()
            if service is None:
                row = dl().row(row_id)
                return api.ok("fault", "The reminder service is not running, so nothing was raised.", SOURCE, row=row, reminders=[])
            out = dl().remind(row_id, service)
            row, lines = out["row"], out["reminders"]
            if not lines:
                return api.ok("waiting", "This row has no documents yet: add them first.", SOURCE, **out)
            parts = []
            if out["cancelled"]:
                parts.append(f"{_n(len(out['cancelled']), 'reminder was', 'reminders were')} cancelled because its start date moved"
                             " or the document changed")
            if out["raised"]:
                parts.append(f"Raised {_n(out['raised'], 'reminder', 'reminders')}")
            if out["already"]:
                parts.append(f"{_n(out['already'], 'reminder was', 'reminders were')} already raised")
            if out["late"]:
                parts.append(f"late, with no reminder: {', '.join(out['late'])}")
            ready = sum(x["state"] == "ready" for x in lines)
            if ready:
                parts.append(f"{_n(ready, 'document is', 'documents are')} ready")
            undated = sum(x["state"] == "no_date" for x in lines)
            if undated:
                parts.append(f"{_n(undated, 'document has', 'documents have')} no start date because the row has no closing date")
            refused = [x for x in lines if x["state"] == "not_raised"]
            if refused:
                parts.append(f"the reminder service refused {len(refused)}: {refused[0]['why']}")
            if out["raised"]:
                publish(f"deadline reminders raised: {out['raised']}")
            return api.ok("live", "; ".join(parts) + ".", SOURCE, **out)
        return await run_in_threadpool(api.guard, work)
