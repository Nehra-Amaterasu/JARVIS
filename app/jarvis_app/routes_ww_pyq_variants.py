"""/api/mission/pyq: variants of his questions and rubric points, each pending until he accepts (ww_pyq/variants.py, ww_pyq/rubric.py).

    POST   /api/mission/pyq/variants               R-29 {question_id, count?: 1..3} numerical by template, descriptive drafted by the local model
    GET    /api/mission/pyq/variants               R-30 ?question=&subject=&status= the variants on file, newest first
    PATCH  /api/mission/pyq/variants/{vid}         R-31 {status: accepted|rejected, text?} accepting makes one question with origin and source_question
    POST   /api/mission/pyq/rubric/{qid}/draft     R-32 the local model splits the question's marks into points; stored pending
    GET    /api/mission/pyq/rubric/{qid}           R-33 the rubric on file, or null
    PUT    /api/mission/pyq/rubric/{qid}           R-34 {points: [{text, marks}]} his rubric, accepted; the points must add up to the marks

The model drafts wording and rubric points only: a numerical variant's numbers and key come from a ww_numericals template,
never from the model, and nothing it writes reaches the bank or a rubric before he accepts it. With the rules-only switch on
(R-35, routes_ww_pyq_drafts.py) the model is never asked. The model is the local one on loopback (ww_counsel), one job at a
time and none while OCR reads. Every answer is the {state, reason, source, ...} envelope of ww_pyq/api.py.
"""
from __future__ import annotations

from typing import Optional

from fastapi import Body, FastAPI
from starlette.concurrency import run_in_threadpool

from .ww_pyq import api, rubric, variants
from .ww_pyq import store as store_mod

SOURCE_VARIANTS = "templates and the local model, from your questions"
SOURCE_RUBRIC = "the local model and you, from your question"


def register(app: FastAPI, svc, bus) -> None:
    def store():
        return store_mod.default_store()

    def provider():
        # the same local model the drafts from notes use; tests put a fake here
        return getattr(app.state, "pyq_draft_provider", None)

    def ocr_running() -> bool:
        job = getattr(app.state, "pyq_ocr", None)
        return bool(job is not None and job.running())

    @app.post("/api/mission/pyq/variants")
    async def variants_make(body: dict = Body(...)):
        def work():
            unknown = set(body) - {"question_id", "count"}
            if unknown:
                raise ValueError(f"I do not know the field {sorted(unknown)[0]}.")
            r = variants.make(store(), body.get("question_id"), body.get("count", 1), provider(), ocr_running)
            return api.items(r["items"], r["state"], r["reason"], SOURCE_VARIANTS)
        return await run_in_threadpool(api.guard, work)

    @app.get("/api/mission/pyq/variants")
    async def variants_list(question: Optional[str] = None, subject: Optional[str] = None, status: Optional[str] = None):
        def work():
            rows = variants.list_variants(store(), question, subject, status)
            if not rows:
                return api.items([], "waiting", "No variant on file.", SOURCE_VARIANTS)
            n = sum(1 for v in rows if v["status"] == "pending")
            return api.items(rows, "live", f"{n} {'variant is' if n == 1 else 'variants are'} waiting for your review.", SOURCE_VARIANTS)
        return await run_in_threadpool(api.guard, work)

    @app.patch("/api/mission/pyq/variants/{vid}")
    async def variants_decide(vid: str, body: dict = Body(...)):
        def work():
            r = variants.decide(store(), vid, body)
            if r["question"] is not None:
                return api.ok("live", "Accepted: it is a question of your bank now, marked with the question it came from.",
                              SOURCE_VARIANTS, **r)
            return api.ok("live", "Rejected: it stays on file as rejected.", SOURCE_VARIANTS, **r)
        return await run_in_threadpool(api.guard, work)

    @app.post("/api/mission/pyq/rubric/{qid}/draft")
    async def rubric_draft(qid: str):
        def work():
            r = rubric.draft(store(), qid, provider(), ocr_running)
            return api.ok(r["state"], r["reason"], SOURCE_RUBRIC, rubric=r["rubric"])
        return await run_in_threadpool(api.guard, work)

    @app.get("/api/mission/pyq/rubric/{qid}")
    async def rubric_get(qid: str):
        def work():
            r = rubric.get(store(), qid)
            if r is None:
                return api.ok("waiting", "No rubric yet.", SOURCE_RUBRIC, rubric=None)
            if r["status"] == "accepted":
                return api.ok("live", "Your rubric." if r["origin"] == "hand" else "The model's rubric, accepted by you.", SOURCE_RUBRIC, rubric=r)
            return api.ok("live", "A rubric drafted by the local model, waiting for you.", SOURCE_RUBRIC, rubric=r)
        return await run_in_threadpool(api.guard, work)

    @app.put("/api/mission/pyq/rubric/{qid}")
    async def rubric_put(qid: str, body: dict = Body(...)):
        def work():
            if set(body) != {"points"}:
                raise ValueError("Send {points: [{text, marks}]}.")
            r = rubric.put(store(), qid, body["points"])
            return api.ok("live", "Rubric accepted.", SOURCE_RUBRIC, rubric=r)
        return await run_in_threadpool(api.guard, work)
