"""/api/mission/career: follow-ups and outreach drafts (ww_career_outreach.py). Nothing here sends anything.

    GET     /api/mission/career/followups                K-08 every application he applied to: applied_at, follow_up_days,
                                                         follow_up_on, days_since, due, last_outreach; `undated` for the rest
    POST    /api/mission/career/outreach                 K-09 {application, to_note, subject, body, follow_up_days?}: a draft
    GET     /api/mission/career/outreach?application=    K-09 the drafts and sent marks, newest first
    PATCH   /api/mission/career/outreach/{id}            K-09 {to_note?, subject?, body?, follow_up_days?}: edits a draft
    POST    /api/mission/career/outreach/{id}/sent       K-10 {sent_on?}: his own mark after he sent it himself; twice is 409

Every JSON answer is {state, reason, source, ...} (ww_pyq/api.py): KeyError is 404, ValueError 400, Busy 409.
The applications are germoney.Applications on svc.plan (routes_mission.py), looked up when a request arrives because
this module may register before it; this module never writes to them. No route opens a socket, a mail program or a
browser: the app keeps his drafts and his marks, and he sends every message himself, from wherever he sends mail.
`to_note` is never used as an address, never checked as one and never logged.
"""
from __future__ import annotations

from typing import Any, Optional

from fastapi import Body, FastAPI, HTTPException
from starlette.concurrency import run_in_threadpool

from . import ww_career_outreach as K
from .ww_pyq import api

SOURCE = "your applications and your drafts"


def _body(body: Any) -> dict:
    if not isinstance(body, dict):
        raise ValueError("Send a JSON object.")
    return body


def _plural(n: int, one: str, many: str) -> str:
    return f"{n} {one if n == 1 else many}"


def register(app: FastAPI, svc, bus) -> None:
    def applications() -> list[dict]:
        plan = getattr(svc, "plan", None)
        if plan is None or getattr(plan, "apps", None) is None:
            raise HTTPException(503, "The plan is not up yet.")
        return plan.apps.all()

    def by_id() -> dict[str, dict]:
        return {a["id"]: a for a in applications()}

    def problems(st: K.OutreachStore) -> dict:
        return {"problems": list(st.problems)} if st.problems else {}

    def view(row: dict, apps: dict[str, dict]) -> dict:
        a = apps.get(row["application"])
        return {**row, "application_exists": a is not None,
                "application_title": K.title_of(a) if a else "This application was deleted; the message stays on file."}

    # ------------------------------------------------------------------ K-08
    @app.get("/api/mission/career/followups")
    async def followups():
        def work():
            st = K.default_store()
            today = K._today()
            out = K.followups(applications(), st, today)
            extra = {"undated": out["undated"], "today": today.isoformat(), **problems(st)}
            if st.problems:
                return api.items(out["items"], "fault", st.problems[-1], SOURCE, **extra)
            if not out["items"]:
                why = ("No application has an applied date in its history yet." if out["undated"]
                       else "No application is marked applied yet.")
                return api.items([], "waiting", why, SOURCE, **extra)
            due = sum(1 for it in out["items"] if it["due"])
            reason = f"{_plural(len(out['items']), 'application', 'applications')} with an applied date; {due} due for a follow-up"
            if out["undated"]:
                reason += f"; {_plural(len(out['undated']), 'has', 'have')} no applied date"
            return api.items(out["items"], "live", reason + ".", SOURCE, **extra)
        return await run_in_threadpool(api.guard, work)

    # ------------------------------------------------------------------ K-09 list
    @app.get("/api/mission/career/outreach")
    async def list_outreach(application: Optional[str] = None):
        def work():
            st = K.default_store()
            apps = by_id()
            rows = st.rows(application if application not in (None, "") else None)
            rows.sort(key=lambda r: (r.get("sent_on") or r.get("made") or "", r.get("updated") or ""), reverse=True)
            out = [view(r, apps) for r in rows]
            if st.problems and not out:
                return api.items([], "fault", st.problems[-1], SOURCE, **problems(st))
            if not out:
                return api.items([], "waiting", "No drafts yet.", SOURCE)
            sent = sum(1 for r in out if r["state"] == "sent")
            reason = f"{_plural(len(out) - sent, 'draft', 'drafts')} and {sent} marked sent by you."
            return api.items(out, "live", reason, SOURCE, **problems(st))
        return await run_in_threadpool(api.guard, work)

    # ------------------------------------------------------------------ K-09 add
    @app.post("/api/mission/career/outreach")
    async def add(body: Any = Body(None)):
        def work():
            b = _body(body)
            aid = K.check_application_id(b.get("application"))
            to_note = K._text(b, "to_note", K.MAX_TO_NOTE, "The note of who it is for")
            subject = K._text(b, "subject", K.MAX_SUBJECT, "A subject")
            text = K._text(b, "body", K.MAX_BODY, "A message")
            if not subject.strip() and not text.strip():
                raise ValueError("Write a subject or a message first.")
            days = K.check_days(b["follow_up_days"]) if b.get("follow_up_days") is not None else None
            apps = by_id()
            if aid not in apps:
                raise KeyError("No such application.")
            row = K.default_store().add(aid, to_note, subject, text, days)
            return api.ok("live", "Draft kept. Nothing was sent; send it yourself, then mark it sent.", SOURCE,
                          row=view(row, apps))
        return await run_in_threadpool(api.guard, work)

    # ------------------------------------------------------------------ K-09 edit
    @app.patch("/api/mission/career/outreach/{rid}")
    async def edit(rid: str, body: Any = Body(None)):
        def work():
            b = _body(body)
            if not K.valid_id(rid):
                raise KeyError("No such message.")
            other = sorted(k for k in b if k not in K.EDITABLE)
            if other:
                raise ValueError(f"Only {', '.join(K.EDITABLE)} can change; not {', '.join(other)}.")
            if not b:
                raise ValueError("Nothing to change.")
            ch: dict = {}
            if "to_note" in b:
                ch["to_note"] = K._text(b, "to_note", K.MAX_TO_NOTE, "The note of who it is for")
            if "subject" in b:
                ch["subject"] = K._text(b, "subject", K.MAX_SUBJECT, "A subject")
            if "body" in b:
                ch["body"] = K._text(b, "body", K.MAX_BODY, "A message")
            if "follow_up_days" in b:
                ch["follow_up_days"] = K.check_days(b["follow_up_days"])
            st = K.default_store()
            cur = st.get(rid)
            if not (ch.get("subject", cur["subject"]).strip() or ch.get("body", cur["body"]).strip()):
                raise ValueError("A draft keeps a subject or a message.")
            row = st.edit(rid, ch)
            return api.ok("live", "Draft changed. Nothing was sent.", SOURCE, row=view(row, by_id()))
        return await run_in_threadpool(api.guard, work)

    # ------------------------------------------------------------------ K-10
    @app.post("/api/mission/career/outreach/{rid}/sent")
    async def sent(rid: str, body: Any = Body(None)):
        def work():
            b = _body(body if body is not None else {})
            if not K.valid_id(rid):
                raise KeyError("No such message.")
            today = K._today()
            on = K.check_date(b["sent_on"], "The day you sent it") if b.get("sent_on") not in (None, "") else today
            if on > today:
                raise ValueError("The day you sent it cannot be after today.")
            row = K.default_store().mark_sent(rid, on)
            apps = by_id()
            a = apps.get(row["application"])
            began = K.applied_at(a) if a else None
            if began and row["sent_on"] < began:
                # K-08 counts from a sent day only when it is on or after the applied day; the sentence says the same
                why = (f"Marked sent on {row['sent_on']}, by you; that is before you applied on {began}, "
                       f"so the follow-up still counts from {began}.")
            else:
                why = f"Marked sent on {row['sent_on']}, by you; the follow-up now counts from that day."
            return api.ok("live", why, SOURCE, row=view(row, apps))
        return await run_in_threadpool(api.guard, work)
