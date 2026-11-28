"""/api/mission/pyq/ladder: the level he stands on in each topic, from his own marks (ww_pyq/ladder.py; wave EW13, L2).

    GET    /api/mission/pyq/ladder?subject=        R-76 per topic {key, unit, topic, stands_on, top, levels, sentence}
    GET    /api/mission/pyq/ladder/settings        R-77 {pass_percent}, 60 until he changes it
    PUT    /api/mission/pyq/ladder/settings        R-77 {pass_percent: a whole number from 50 to 100}

This file only gathers the inputs; the counting is ww_pyq/ladder.py. The subject and its syllabus come from svc.plan
(503 until it is up; unknown 404, missing 400). The questions are the subject's accepted questions with a topic, from
the pyq store, leaving out solution sheets, notes and items judged not a question (the same rule as R-68 and R-75).
The marks are the ledger's: the evening sheets and attempts.jsonl, read by routes_ww_pyq_ledger.read_sheets and
read_paper_marks and turned into rows by ledger.sheet_rows and ledger.paper_rows, so a mark counted on R-60 is the same
mark here. `waiting` with the reason when the subject has no accepted question with a topic. Every answer is
{state, reason, source, ...}; a level is passed only on his own marks, and nothing here is estimated.
"""
from __future__ import annotations

from typing import Optional

from fastapi import Body, FastAPI, HTTPException
from starlette.concurrency import run_in_threadpool

from . import ww_generator
from .routes_ww_pyq_ledger import read_paper_marks, read_sheets
from .ww_pyq import api, ladder, ledger, tag
from .ww_pyq import store as store_mod
from .ww_pyq.next import MIN_ATTEMPTS
from .ww_pyq.prep import HELD_ROLES, role_of

SOURCE = "your accepted questions and the marks you typed"
SOURCE_SETTINGS = "your settings"


def _store():
    return store_mod.default_store()


def _plural(n: int, one: str, many: str) -> str:
    return f"{n} {one if n == 1 else many}"


def gather(st, sid: str) -> tuple[dict, dict, list[dict]]:
    """({topic key: [accepted question]}, {topic key: [marks row]}, skipped) for one subject."""
    papers = {p["id"]: p for p in st.list_papers(sid)}
    by_q: dict[str, list[dict]] = {}
    for q in st.list_questions(subject=sid, status="accepted"):
        if role_of(papers.get(q["paper_id"])) in HELD_ROLES or q.get("not_question") is True:
            continue
        if q.get("unit") is None or not str(q.get("topic") or "").strip():
            continue
        by_q.setdefault(ww_generator.topic_key(q["unit"], q["topic"]), []).append(q)
    sheets, skipped = read_sheets(st)
    a, s1 = ledger.sheet_rows(sheets, sid)
    lines, gen_papers = read_paper_marks(st)
    b, s2 = ledger.paper_rows(lines, gen_papers, sid)
    by_a: dict[str, list[dict]] = {}
    for r in a + b:
        by_a.setdefault(r["topic_key"], []).append(r)
    return by_q, by_a, skipped + s1 + s2


def register(app: FastAPI, svc, bus) -> None:
    def plan():
        p = getattr(svc, "plan", None)
        if p is None:
            raise HTTPException(503, "the plan store is not up yet")
        return p

    def subject_of(name: Optional[str]) -> dict:
        if not name or not str(name).strip():
            raise ValueError("Say which subject.")
        want = str(name).strip().lower()
        for s in (plan().academics() or {}).get("subjects") or []:
            if str(s.get("id") or "").lower() == want:
                return s
        raise KeyError("No such subject.")

    # ------------------------------------------------------------------ R-76
    @app.get("/api/mission/pyq/ladder")
    async def get_ladder(subject: Optional[str] = None):
        def work():
            sub = subject_of(subject)
            sid = str(sub["id"]).lower()
            st = _store()
            pct = ladder.load_settings(st)["pass_percent"]
            topics = tag.topics_of(sub)
            by_q, by_a, skipped = gather(st, sid)
            items = [ladder.topic_ladder(t, by_q.get(t["key"], []), by_a.get(t["key"], []), pct, ladder.TOP) for t in topics]
            extra = {"pass_percent": pct, "min_attempts": MIN_ATTEMPTS, "top": ladder.TOP, "skipped": skipped}
            if not topics:
                return api.items(items, "waiting", "This subject has no syllabus topics yet.", SOURCE, **extra)
            if not any(by_q.get(t["key"]) for t in topics):
                return api.items(items, "waiting", "No accepted question of this subject has a topic yet; accept and tag "
                                 "questions first.", SOURCE, **extra)
            standing = [i for i in items if i["stands_on"] is not None]
            no_level = sum(1 for i in items if by_q.get(i["key"]) and i["stands_on"] is None)
            reason = (f"{_plural(len(items), 'topic', 'topics')}: you stand on a level in {len(standing)}; "
                      f"{no_level} {'has' if no_level == 1 else 'have'} accepted questions without a level yet. "
                      f"A level is passed at {pct}% over at least {MIN_ATTEMPTS} marked attempts.")
            return api.items(items, "live", reason, SOURCE, **extra)
        return await run_in_threadpool(api.guard, work)

    # ------------------------------------------------------------------ R-77
    def settings_answer() -> dict:
        s = ladder.load_settings(_store())
        return api.ok("live", f"A level is passed at {s['pass_percent']}% of its marks over at least {MIN_ATTEMPTS} "
                      "marked attempts; you set the percent.", SOURCE_SETTINGS, settings=s, **s)

    @app.get("/api/mission/pyq/ladder/settings")
    async def get_ladder_settings():
        return await run_in_threadpool(api.guard, settings_answer)

    @app.put("/api/mission/pyq/ladder/settings")
    async def put_ladder_settings(body: dict = Body(...)):
        def work():
            if not isinstance(body, dict) or set(body) != {"pass_percent"}:
                raise ValueError(f"Send {{pass_percent: a whole number from {ladder.PASS_MIN} to {ladder.PASS_MAX}}}.")
            ladder.save_settings(_store(), body["pass_percent"])
            return settings_answer()
        return await run_in_threadpool(api.guard, work)
