"""Well Wisher on the phone: the day's taps behind the phone door.

    GET    /phone/ww, /phone/ww.js, /phone/ww.css   the Study page (installable, same origin)
    GET    /api/phone/ww/today?paper=<id>  next paper + its topics, today's blocks, today's
                                           classes, attendance margin, Life counters
    POST   /api/phone/ww/topic    {subject, key, state}   a topic none | learned | solid
    POST   /api/phone/ww/minutes  {subject, minutes}      study time for a subject
    POST   /api/phone/ww/class    {slot, status}          present | absent | cancelled | clear
    POST   /api/phone/ww/count    {id, delta}             a Life counter, nudged
    GET    /api/phone/ww/resources?node=<id>   resources with a checklist (or one node's), where he is, sections per week
    POST   /api/phone/ww/resource/tap  {rid, item, state}  a section done | skip | open | here
    GET    /api/phone/ww/knowledge        today's six cards: exam, skill, life, word, fact, thought
    POST   /api/phone/ww/knowledge/refresh  {slot}        a new item for one card

Why here and not a hosted site (decided 8 Nov): the phone listener (phone.py, port 8778) is
the app's one public door: a paired device's cookie, the home network or the Cloudflare
tunnel behind Access, `/phone` + `/api/phone/*` only. Every route in this file lives under
that prefix, so the listener's checks apply unchanged and nothing of `data/` leaves the
machine. The taps call the same Plan methods the desktop uses (one Plan instance, shared
with routes_mission, so two writers never race on the state file).
"""
from __future__ import annotations

from datetime import date
from typing import Optional

from fastapi import Body, FastAPI, HTTPException, Request
from fastapi.responses import FileResponse
from starlette.concurrency import run_in_threadpool

from . import germoney, ww_knowledge, ww_resources, ww_season
from .routes_phone import CSP, PAGE_DIR, PAGE_HEADERS

PAPER_KEYS = ("id", "subject", "title", "code", "date", "start", "days_left", "coverage", "kind", "approx")
TOPIC_KEYS = ("key", "unit", "unit_title", "topic", "weight", "state")
ROW_KEYS = ("subject", "name", "held", "attended", "pct", "can_miss", "need")


def today_view(plan, paper: Optional[str] = None, today: Optional[str] = None, now=None) -> dict:
    """One payload for the phone: small enough for mobile data, complete enough to tap."""
    today = today or date.today().isoformat()
    ex = plan.engine("exams", today)
    att = plan.engine("attendance", today)
    life = plan.life_view(today)
    papers = ex.get("papers") or []
    shown = next((p for p in papers if p["id"] == paper), papers[0] if papers else None)
    day = next((d for d in ex.get("days") or [] if d["date"] == today), None)
    blocks = [{"label": s["label"], "minutes": s["minutes"],
               "blocks": [{"paper": b["paper"], "title": b["title"], "minutes": b["minutes"], "focus": b["focus"][:3]} for b in s["blocks"]]}
              for s in (day or {}).get("slots") or []]
    return {"date": today, "say": ex.get("say") or "", "blocks": blocks,
            "papers": [{k: p.get(k) for k in PAPER_KEYS} for p in papers[:16]],
            "paper": ({**{k: shown.get(k) for k in PAPER_KEYS}, "counts": shown.get("counts"),
                       "topics": [{k: t.get(k) for k in TOPIC_KEYS} for t in shown.get("topics") or []]} if shown else None),
            "classes": att.get("today") or [],
            "attendance": [{k: r.get(k) for k in ROW_KEYS} for r in att.get("subjects") or []],
            "rule": att.get("rule"), "counters": life.get("counters") or [],
            "season": ww_season.season_state(ex, today, now)}


def register(app: FastAPI, svc, bus) -> None:
    # routes_mission registers first (alphabetical) and leaves its Plan on svc; tests that load
    # only the phone features get a Plan of their own over the same store.
    plan = getattr(svc, "plan", None) or germoney.Plan(svc.kv)

    @app.get("/phone/ww")
    def ww_page():
        return FileResponse(PAGE_DIR / "ww.html", media_type="text/html", headers={**PAGE_HEADERS, "Content-Security-Policy": CSP})

    @app.get("/phone/ww.js")
    def ww_script():
        return FileResponse(PAGE_DIR / "ww.js", media_type="text/javascript", headers=PAGE_HEADERS)

    @app.get("/phone/ww.css")
    def ww_style():
        return FileResponse(PAGE_DIR / "ww.css", media_type="text/css", headers=PAGE_HEADERS)

    def view(paper: Optional[str] = None) -> dict:
        return today_view(plan, paper)

    @app.get("/api/phone/ww/today")
    async def ww_today(paper: Optional[str] = None):
        return await run_in_threadpool(view, paper)

    async def tap(fn, *args, paper: Optional[str] = None) -> dict:
        try:
            await run_in_threadpool(fn, *args)
        except ValueError as e:
            raise HTTPException(400, str(e))
        return await run_in_threadpool(view, paper)

    @app.post("/api/phone/ww/topic")
    async def ww_topic(request: Request, subject: str = Body(..., embed=True), key: str = Body(..., embed=True),
                       state: str = Body(..., embed=True), paper: Optional[str] = Body(None, embed=True)):
        return await tap(plan.exam_prep, "topic", subject, {"key": key, "state": state}, paper=paper)

    @app.post("/api/phone/ww/minutes")
    async def ww_minutes(request: Request, subject: str = Body(..., embed=True), minutes: int = Body(..., embed=True),
                         paper: Optional[str] = Body(None, embed=True)):
        return await tap(plan.exam_prep, "minutes", subject, {"minutes": minutes}, paper=paper)

    @app.post("/api/phone/ww/class")
    async def ww_class(request: Request, slot: str = Body(..., embed=True), status: str = Body(..., embed=True),
                       paper: Optional[str] = Body(None, embed=True)):
        return await tap(plan.attendance_tap, slot, status, paper=paper)

    @app.post("/api/phone/ww/count")
    async def ww_count(request: Request, id: str = Body(..., embed=True), delta: int = Body(..., embed=True),
                       paper: Optional[str] = Body(None, embed=True)):
        return await tap(plan.life_tap, "count", {"id": id, "delta": delta}, paper=paper)

    # Depth: resource checklists and the knowledge cards (ww_resources.py, ww_knowledge.py), the same
    # data the desktop routes serve, behind the same phone door. Typing a checklist stays on the desktop.
    def today_s() -> str:
        return date.today().isoformat()

    async def guarded(fn) -> dict:
        try:
            return await run_in_threadpool(fn)
        except ValueError as e:
            raise HTTPException(400, str(e))

    @app.get("/api/phone/ww/resources")
    async def ww_resources_view(node: Optional[str] = None):
        return await guarded(lambda: ww_resources.progress(svc.kv, germoney.load_bank(), today_s(), node, 4))

    @app.post("/api/phone/ww/resource/tap")
    async def ww_resource_tap(request: Request, rid: str = Body(..., embed=True), item: str = Body(..., embed=True),
                              state: str = Body(..., embed=True)):
        return await guarded(lambda: ww_resources.tap(svc.kv, germoney.load_bank(), rid, item, state, today_s()))

    @app.get("/api/phone/ww/knowledge")
    async def ww_knowledge_view():
        return await guarded(lambda: ww_knowledge.today_view(svc.kv, today_s(), plan, germoney.load_bank()))

    @app.post("/api/phone/ww/knowledge/refresh")
    async def ww_knowledge_refresh(request: Request, slot: str = Body(..., embed=True)):
        return await guarded(lambda: ww_knowledge.refresh(svc.kv, slot, today_s(), plan, germoney.load_bank()))
