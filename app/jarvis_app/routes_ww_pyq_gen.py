"""/api/mission/pyq: the blueprint, the practice paper, its print set, the numeric check and marks (E08).

    GET    /api/mission/pyq/blueprints/{exam}               R-19 the stored blueprint of an exam and its issues
    PUT    /api/mission/pyq/blueprints/{exam}               R-20 {blueprint}: save it (an unbalanced one is kept, and refused by R-22)
    POST   /api/mission/pyq/blueprints/infer                R-21 {paper, exam?}: propose a blueprint from a paper on file, not saved
    POST   /api/mission/pyq/papers/generate                 R-22 {exam, seed?, tier?}: a practice paper from the blueprint, stored
    GET    /api/mission/pyq/generated?exam=                 R-23 generated papers on file
    GET    /api/mission/pyq/generated/{gid}                 R-24 one generated paper
    GET    /api/mission/pyq/generated/{gid}/print?kind=     R-25 the paper, its answers or the marking sheet as A4 HTML
    POST   /api/mission/pyq/check                           R-26 {key, answer} or {question_id, answer}: match or not, never marks
    POST   /api/mission/pyq/generated/{gid}/marks           R-27 {items: [{id, got}]}: marks he typed, into attempts and proficiency

Every JSON answer is {state, reason, source, ...} (ww_pyq/api.py). The exam row and its subject come from
svc.plan the way germoney.Plan.practice_paper reads them (503 until routes_mission has set it): the units
from the subject, topic taps from exam_prep, logged marks from paper_marks. The bank is Store.bank_for.
A paper is drawn only from a saved blueprint that balances and matches the exam row's maximum: the 9 Nov
bug (a 20-mark row printed in the 60-mark shape) is refused here, never repaired by a default shape.
Nothing here predicts a paper or a result, and no route returns a mark it did not get from him.
"""
from __future__ import annotations

import re
from datetime import date, datetime
from typing import Any, Optional

from fastapi import Body, FastAPI, HTTPException
from fastapi.responses import HTMLResponse
from starlette.concurrency import run_in_threadpool

from .ww_pyq import api
from .ww_pyq import blueprint as bpm
from .ww_pyq import check as chk
from .ww_pyq import generate as gen
from .ww_pyq import printset
from .ww_pyq import store as store_mod

SOURCE_BP = "your blueprint"
SOURCE_PAPER = "your reviewed questions and the numerical templates"
SOURCE_CHECK = "the numeric check"
_TEMPLATE_ID = re.compile(r"^n:([a-z_]+):(\d{1,10}):u(\d{1,3})$")      # ww_numericals' id form
_MAX_ITEMS = 200


def _store():
    return store_mod.default_store()


def _plural(n: int, one: str, many: str) -> str:
    return f"{n} {one if n == 1 else many}"


def _g(x: Any) -> str:
    return format(float(x), "g")


def register(app: FastAPI, svc, bus) -> None:
    def publish(text: str) -> None:
        try:
            bus.publish("mission", "update", text[:140])
        except Exception:
            pass

    def plan():
        p = getattr(svc, "plan", None)
        if p is None:
            raise HTTPException(503, "The plan store is not up yet.")
        return p

    def exam_and_subject(p, exam_id: str) -> tuple[dict, dict]:
        """Plan._exam_and_subject, with its "not on the date sheet" ValueError as a 404."""
        try:
            return p._exam_and_subject(exam_id)
        except ValueError as e:
            t = str(e)
            raise KeyError((t[:1].upper() + t[1:]).rstrip(".") + ".")

    def exam_card(exam: dict) -> dict:
        return {"id": exam.get("id"), "subject": exam.get("subject"), "title": exam.get("title"), "max": exam.get("max")}

    def bp_answer(bp: Optional[dict], exam: dict, **extra) -> dict:
        if bp is None:
            return api.ok("waiting", "No blueprint. Infer one from a paper on file.", SOURCE_BP,
                          blueprint=None, issues=[], exam=exam_card(exam), **extra)
        issues = bpm.validate_blueprint(bp) + bpm.exam_issues(bp, exam)
        if issues:
            return api.ok("fault", issues[0]["text"], SOURCE_BP, blueprint=bp, issues=issues, exam=exam_card(exam), **extra)
        return api.ok("live", bpm.balance_sentence(bp), SOURCE_BP, blueprint=bp, issues=[], exam=exam_card(exam), **extra)

    def own_bank(st, subject_id: str) -> list[dict]:
        """Store.bank_for rows, with who accepted each and whether it has a crop (the slot's source and the print)."""
        rows = st.bank_for(subject_id)
        meta = {q["id"]: q for q in st.list_questions(subject=subject_id, status="accepted")}
        out = []
        for r in rows:
            q = meta.get(r["id"]) or {}
            out.append({**r, "status_by": q.get("status_by") or "hand", "has_crop": st.crop_path(r["id"]) is not None})
        return out

    def families_for(st, subject_id: str) -> Optional[dict]:
        """E07's families when its module is there; without them every question is its own family."""
        try:
            from .ww_pyq.families import find_families
        except ImportError:
            return None
        try:
            fams = find_families(st.list_questions(subject=subject_id, status="accepted"))
        except Exception:
            return None
        out = {}
        for f in fams or []:
            fid = (f or {}).get("id")
            for qid in (f or {}).get("question_ids") or []:
                if fid and isinstance(qid, str):
                    out[qid] = str(fid)
        return out

    # ------------------------------------------------------------------ blueprints
    @app.get("/api/mission/pyq/blueprints/{exam}")
    async def get_blueprint(exam: str):
        p = plan()

        def work():
            ex, _ = exam_and_subject(p, exam)
            return bp_answer(bpm.load_blueprint(_store(), exam), ex)
        return await run_in_threadpool(api.guard, work)

    @app.put("/api/mission/pyq/blueprints/{exam}")
    async def put_blueprint(exam: str, body: dict = Body(...)):
        p = plan()

        def work():
            raw = body.get("blueprint")
            if not isinstance(raw, dict):
                raise ValueError("Send the blueprint as {blueprint: {total, sections}}.")
            ex, _ = exam_and_subject(p, exam)
            bp = bpm.save_blueprint(_store(), exam, {**raw, "origin": "hand"})
            publish("blueprint saved")
            return bp_answer(bp, ex)
        return await run_in_threadpool(api.guard, work)

    @app.post("/api/mission/pyq/blueprints/infer")
    async def infer(body: dict = Body(...)):
        exam_id = body.get("exam")
        p = plan() if exam_id else None

        def work():
            pid = body.get("paper")
            if not isinstance(pid, str) or not pid:
                raise ValueError("Say which paper to read the blueprint from.")
            st = _store()
            paper = st.get_paper(pid)
            bp, trace = bpm.infer_with_trace(paper, st.list_questions(paper_id=pid))
            ex = None
            if exam_id:
                ex, _ = exam_and_subject(p, str(exam_id))
                bp["exam"] = str(exam_id)
            issues = bpm.validate_blueprint(bp) + (bpm.exam_issues(bp, ex) if ex else [])
            if issues:
                return api.ok("fault", issues[0]["text"], "rule", blueprint=bp, issues=issues, trace=trace)
            return api.ok("live", f"Read {_plural(len(bp['sections']), 'section', 'sections')} from the paper: "
                                  f"{_g(bp['total'])} marks. Check it, then save it.", "rule",
                          blueprint=bp, issues=[], trace=trace)
        return await run_in_threadpool(api.guard, work)

    # ------------------------------------------------------------------ generate
    @app.post("/api/mission/pyq/papers/generate")
    async def generate(body: dict = Body(...)):
        p = plan()

        def work():
            exam_id = body.get("exam")
            if not isinstance(exam_id, str) or not exam_id:
                raise ValueError("Say which exam the paper is for.")
            if body.get("tier", "exam") != "exam":
                raise ValueError("Only exam-tier papers are drawn from your own papers.")
            ex, sub = exam_and_subject(p, exam_id)
            st = _store()
            bp = bpm.load_blueprint(st, exam_id)
            if bp is None:
                raise ValueError("This exam has no blueprint yet. Infer one from a paper on file, check it and save it; "
                                 "no default shape is used.")
            seed = body.get("seed")
            if seed is None:
                seed = len(gen.list_generated(st, exam=exam_id))    # each press draws the next paper; it stays reproducible
            if isinstance(seed, bool) or not isinstance(seed, int):
                raise ValueError("The seed is a whole number.")
            today = date.today().isoformat()
            state = p.load(today)
            rec = (state.get("exam_prep") or {}).get(sub["id"]) or {}
            marks = (state.get("paper_marks") or {}).get(sub["id"]) or {}
            paper = gen.generate_paper(bp, ex, sub, own_bank(st, sub["id"]), rec.get("topics") or {}, marks, seed,
                                       attempts=gen.read_attempts(st), families=families_for(st, sub["id"]), today=today)
            paper["made"] = datetime.now().isoformat(timespec="seconds")
            gen.save_generated(st, paper)
            n = gen.counts(paper)
            seats = sum(n.values())
            publish(f"practice paper drawn: seed {seed}")
            reason = (f"{seats - n['hollow']} of {_plural(seats, 'seat', 'seats')} filled: {n['hand'] + n['rule']} from your papers, "
                      f"{n['template']} generated numericals" + (f", {n['hollow']} empty." if n["hollow"] else "."))
            return api.ok("live", reason, SOURCE_PAPER, paper=paper)
        return await run_in_threadpool(api.guard, work)

    # ------------------------------------------------------------------ generated papers
    @app.get("/api/mission/pyq/generated")
    async def generated(exam: Optional[str] = None):
        def work():
            rows = [{"id": x["id"], "exam": x.get("exam"), "seed": x.get("seed"), "made": x.get("made"),
                     "total_marks": x.get("total_marks"), "counts": gen.counts(x)}
                    for x in gen.list_generated(_store(), exam=exam or None)]
            if not rows:
                return api.items(rows, "waiting", "No practice papers drawn yet.", SOURCE_PAPER)
            return api.items(rows, "live", f"{_plural(len(rows), 'practice paper', 'practice papers')} on file.", SOURCE_PAPER)
        return await run_in_threadpool(api.guard, work)

    @app.get("/api/mission/pyq/generated/{gid}")
    async def generated_one(gid: str):
        def work():
            paper = gen.load_generated(_store(), gid)
            return api.ok("live", f"Seed {paper.get('seed')}, {_g(paper.get('total_marks') or 0)} marks.", SOURCE_PAPER, paper=paper)
        return await run_in_threadpool(api.guard, work)

    @app.get("/api/mission/pyq/generated/{gid}/print")
    async def print_paper(gid: str, kind: str = "paper"):
        def work():
            st = _store()
            paper = gen.load_generated(st, gid)
            return printset.render_print(paper, kind, store=st)
        html = await run_in_threadpool(api.guard, work)
        return HTMLResponse(html)

    # ------------------------------------------------------------------ the numeric check
    @app.post("/api/mission/pyq/check")
    async def check(body: dict = Body(...)):
        def work():
            answer = body.get("answer")
            key = body.get("key")
            qid = body.get("question_id")
            if key is None:
                if not isinstance(qid, str) or not qid:
                    raise ValueError("Send the key, or the question id, with the answer.")
                m = _TEMPLATE_ID.match(qid)
                if m:
                    from . import ww_numericals
                    try:
                        key = ww_numericals.make(m.group(1), int(m.group(2)))["answer_text"]
                    except KeyError:
                        raise KeyError("No such question.")
                else:
                    _store().get_question(qid)                 # 404 for an unknown id; his questions carry no key yet
                    key = ""
            if not isinstance(key, str):
                raise ValueError("The key is a number with an optional unit.")
            r = chk.check_numeric(key, answer)
            if r["match"] is None:
                return api.ok("waiting", "This question has no numeric key.", SOURCE_CHECK, check=r)
            return api.ok("live", "It matches the key." if r["match"] else "It does not match the key.", SOURCE_CHECK, check=r)
        return await run_in_threadpool(api.guard, work)

    # ------------------------------------------------------------------ marks
    @app.post("/api/mission/pyq/generated/{gid}/marks")
    async def marks(gid: str, body: dict = Body(...)):
        p = plan()

        def work():
            st = _store()
            paper = gen.load_generated(st, gid)
            items = body.get("items")
            if not isinstance(items, list) or not items:
                raise ValueError("Send the marks as {items: [{id, got}]}.")
            if len(items) > _MAX_ITEMS:
                raise ValueError(f"Mark up to {_MAX_ITEMS} questions at once.")
            seats = {x["question_id"]: x for s in paper.get("sections") or [] for x in s.get("slots") or []
                     if x.get("source") != "hollow" and x.get("question_id")}
            rows, seen = [], set()
            for it in items:
                qid = (it or {}).get("id") if isinstance(it, dict) else None
                if not isinstance(qid, str) or qid not in seats:
                    raise ValueError("Each mark needs the id of a question on this paper; an empty seat cannot be marked.")
                if qid in seen:
                    raise ValueError("A question is marked once per sheet.")
                seen.add(qid)
                got = it.get("got")
                mx = float(seats[qid]["marks"])
                if isinstance(got, bool) or not isinstance(got, (int, float)) or not 0 <= float(got) <= mx:
                    raise ValueError(f"Marks for a {_g(mx)}-mark question are from 0 to {_g(mx)}.")
                rows.append((seats[qid], float(got), mx))
            # His own questions are not in academics.json: they travel as extra bank rows. A template
            # goes through ww_numericals' id form, which paper_marks already rebuilds.
            extra = {x["question_id"]: {"id": x["question_id"], "unit": x.get("unit"), "topic": x.get("topic") or "",
                                        "marks": x.get("marks"), "question": x.get("text") or "", "origin": "own-paper"}
                     for x, _, _ in rows if x.get("source") in ("hand", "rule")}
            today = date.today().isoformat()
            res = p.paper_marks(paper["exam"], {"items": [{"id": x["question_id"], "got": got, "max": mx} for x, got, mx in rows],
                                                "seed": paper.get("seed")}, today=today, extra_bank=extra)
            gen.append_attempts(st, [{"question_id": x["question_id"], "paper_id": paper["id"], "got": got, "max": mx,
                                      "marked_by": "you", "date": today} for x, got, mx in rows])
            got_sum, max_sum = sum(g for _, g, _ in rows), sum(m for _, _, m in rows)
            publish(f"marks saved: {_g(got_sum)} of {_g(max_sum)}")
            return api.ok("live", f"Saved marks for {_plural(len(rows), 'question', 'questions')}: {_g(got_sum)} of {_g(max_sum)}.",
                          "the marks you typed", saved=len(rows), total={"got": got_sum, "max": max_sum}, marked_by="you",
                          proficiency=res.get("proficiency") or {})
        return await run_in_threadpool(api.guard, work)
