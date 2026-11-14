"""/api/mission/pyq: what his papers on file show, counted (ww_pyq/patterns.py, next.py, tag.py).

    GET    /api/mission/pyq/patterns?subject=                     R-16 how often each topic was set: k of N papers, with the interval
    GET    /api/mission/pyq/practise-next?subject=&gap_minutes=   R-17 topics worth the next minutes, with every term of the sum
    POST   /api/mission/pyq/tags/suggest                          R-18 {ids?, paper?, apply?}: rule tags for questions, written only when certain

The subject and its syllabus come from the plan store (svc.plan, set by routes_mission, which sorts first), the
questions from the private store (ww_pyq.store.default_store), his topic taps and logged marks from the plan's
saved state: the same data Plan.practice_paper reads. An unknown subject is 404, a missing one 400, a plan that is
not up yet 503. Every JSON answer is {state, reason, source, ...} (ww_pyq/api.py); below 3 papers or 20 counted
questions a pattern answers `waiting` with the numbers still present and `provisional` true, because a count over
two papers is a note, not a pattern. Nothing here predicts a paper or a result. R-18 with apply true writes a tag
only where the rule is certain (ww_pyq/tag.py) and never over a tag he set by hand.
"""
from __future__ import annotations

from typing import Optional

from fastapi import Body, FastAPI, HTTPException, Query
from starlette.concurrency import run_in_threadpool

from . import ww_generator
from .ww_pyq import api, next as pnext, patterns, tag
from .ww_pyq import store as store_mod

SOURCE = "your papers on file"
FOOTER = "From papers on file. This prepares practice; it does not predict a paper or a result."
_MAX_IDS = 200
_MAX_GAP = 1440            # a day; a longer gap is a typo, not a study plan


def _store():
    return store_mod.default_store()


def _plural(n: int, one: str, many: str) -> str:
    return f"{n} {one if n == 1 else many}"


def _need(floor: dict, n_untagged: int = 0) -> str:
    parts = []
    if floor["papers_needed"]:
        parts.append(f"{floor['papers_needed']} more {'paper' if floor['papers_needed'] == 1 else 'papers'}")
    if floor["questions_needed"]:
        parts.append(f"{floor['questions_needed']} more reviewed {'question' if floor['questions_needed'] == 1 else 'questions'}")
    head = "Too few papers to show a pattern" if floor["papers_needed"] else "Too few reviewed questions to show a pattern"
    # accepted questions with no topic are not counted: say so, or "20 more reviewed" reads as wrong to someone who accepted 30
    tail = f" {_plural(n_untagged, 'accepted question has', 'accepted questions have')} no topic yet." if n_untagged and floor["questions_needed"] else ""
    return f"{head}: {', '.join(parts)}.{tail}"


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

    def gather(name: Optional[str]):
        sub = subject_of(name)
        sid = str(sub["id"]).lower()
        st = _store()
        return sub, sid, st.list_papers(sid), st.list_questions(subject=sid)

    def pattern_state(ps: dict) -> tuple[str, str]:
        if ps["provisional"]:
            return "waiting", _need(ps["floor"], ps["n_untagged"])
        return "live", ps["sentence"]

    # ------------------------------------------------------------------ R-16
    @app.get("/api/mission/pyq/patterns")
    async def get_patterns(subject: Optional[str] = None):
        def work():
            _, _, papers, qs = gather(subject)
            ps = patterns.compute_patterns(qs, papers)
            state, reason = pattern_state(ps)
            body = {k: v for k, v in ps.items() if k not in ("floor", "provisional")}
            return api.ok(state, reason, SOURCE, patterns=body, floor=ps["floor"], provisional=ps["provisional"], footer=FOOTER)
        return await run_in_threadpool(api.guard, work)

    # ------------------------------------------------------------------ R-17
    @app.get("/api/mission/pyq/practise-next")
    async def get_practise_next(subject: Optional[str] = None, gap_minutes: int = Query(60)):
        def work():
            if not 1 <= gap_minutes <= _MAX_GAP:
                raise ValueError(f"The gap is between 1 and {_MAX_GAP} minutes.")
            sub, sid, papers, qs = gather(subject)
            ps = patterns.compute_patterns(qs, papers)
            keys = [t["key"] for t in ps["topics"]]
            saved = plan().load() or {}
            states = ((saved.get("exam_prep") or {}).get(sid) or {}).get("topics") or {}
            marks = (saved.get("paper_marks") or {}).get(sid) or {}
            prof = ww_generator.proficiency(states, marks, keys)
            attempts = {k: len(marks.get(k) or []) for k in keys}
            picks = pnext.practise_next(ps, prof, gap_minutes, attempts=attempts)
            extra = {"defaults": {"minutes_per_mark": pnext.MINUTES_PER_MARK}, "provisional": ps["provisional"], "footer": FOOTER}
            if ps["provisional"]:
                return api.items(picks, "waiting", _need(ps["floor"], ps["n_untagged"]), SOURCE, **extra)
            if not picks:
                return api.items(picks, "waiting", "No topic has 3 reviewed questions yet." if not any(
                    len(t["questions"]) >= pnext.MIN_QUESTIONS for t in ps["topics"]) else "Nothing fits in that gap.", SOURCE, **extra)
            used = sum(p["terms"]["minutes"] for p in picks)
            return api.items(picks, "live", f"{_plural(len(picks), 'topic', 'topics')}, about {used:g} of {gap_minutes} minutes.", SOURCE, **extra)
        return await run_in_threadpool(api.guard, work)

    # ------------------------------------------------------------------ R-18
    @app.post("/api/mission/pyq/tags/suggest")
    async def suggest_tags(body: dict = Body(...)):
        def work():
            ids, pid, apply = body.get("ids"), body.get("paper"), body.get("apply", False)
            if not isinstance(apply, bool):
                raise ValueError("Apply is true or false.")
            st = _store()
            if ids:
                if not isinstance(ids, list) or not all(isinstance(i, str) for i in ids) or len(ids) > _MAX_IDS:
                    raise ValueError(f"Give up to {_MAX_IDS} question ids.")
                rows = [st.get_question(i) for i in dict.fromkeys(ids)]
            elif pid:
                if not isinstance(pid, str):
                    raise ValueError("A paper is named by its id.")
                st.get_paper(pid)
                rows = st.list_questions(paper_id=pid)
            else:
                raise ValueError("Give the ids of the questions or a paper.")
            subjects: dict[str, list] = {}
            owner: list[str] = []
            for q in rows:
                sid = str(st.get_paper(q["paper_id"]).get("subject") or "")
                if not sid:
                    raise ValueError("This paper has no subject yet. Choose one first.")
                if sid not in subjects:
                    subjects[sid] = tag.topics_of(subject_of(sid))
                owner.append(sid)
            results, applied = [], 0
            for q, sid in zip(rows, owner):
                topics = subjects[sid]
                r = tag.tag_question(q, topics)
                r["held_by_hand"] = q.get("tag_source") == "hand"
                results.append(r)
                if (apply and r["tag_source"] == "rule" and not r["held_by_hand"]
                        and (q.get("unit"), q.get("topic"), q.get("tag_source")) != (r["unit"], r["topic"], "rule")):
                    st.update_question(q["id"], {"unit": r["unit"], "topic": r["topic"], "tag_source": "rule",
                                                 "tag_score": r["score"], "tag_margin": r["margin"]}, "rule")
                    applied += 1
            if not any(subjects.values()):
                return api.items(results, "waiting", "This subject has no syllabus topics yet.", SOURCE, applied=0)
            certain = sum(1 for r in results if r["tag_source"] == "rule")
            reason = (f"Tagged {applied} of {_plural(len(results), 'question', 'questions')} by rule." if apply
                      else f"{certain} of {_plural(len(results), 'question', 'questions')} have a certain tag; nothing was written.")
            return api.items(results, "live", reason, "rule on the syllabus words", applied=applied)
        return await run_in_threadpool(api.guard, work)
