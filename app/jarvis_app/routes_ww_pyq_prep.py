"""/api/mission/pyq/prep: preparing his question store for the loop (ww_pyq/assign.py, ww_pyq/prep.py; wave EW11, B2 to B5).

    GET    /api/mission/pyq/prep                   R-65 the counts by subject: papers, without_subject, questions, pending, accepted, with_marks, tagged, sheet_ready_topics, courses; solutions apart
    POST   /api/mission/pyq/prep/subjects          R-66 {apply?, use_model?, limit?} a subject for each paper without one, naming the rule that spoke; each paper's role
    POST   /api/mission/pyq/prep/reread            R-67 {papers?, apply?} a paper read again with today's reader, before and after; 409 while the desk reads
    POST   /api/mission/pyq/prep/tags              R-68 {subject, apply?, use_model?, limit?} rule tags first, then the model's picks in batches of 20
    GET    /api/mission/pyq/prep/policy            R-69 {auto_accept}, off by default
    PUT    /api/mission/pyq/prep/policy            R-69 {auto_accept: bool}
    POST   /api/mission/pyq/prep/accept            R-70 {subject} accepts only the questions safe to trust without his eye, when the policy is on
    POST   /api/mission/pyq/prep/unaccept          R-71 {subject} every question accepted by rule goes back to pending
    POST   /api/mission/pyq/prep/levels            R-75 {subject, apply?, use_model?, limit?} a level 1 to 5 on each question: rule first, then the model in batches of 20
    POST   /api/mission/pyq/prep/run               R-72 {steps: [subjects|reread|tags|levels|accept], subjects?, use_model?} the steps in one background job
    GET    /api/mission/pyq/prep/run               R-73 {status, step, done, total, counts_before, counts_now, seconds, failures} of that job
    DELETE /api/mission/pyq/prep/run               R-74 stops it after the batch or paper in hand

Every step is reversible and every value names who set it: "rule", or "model" with the model's name. Nothing overwrites what he
set by hand. With apply false (the default) a step answers what it would do and writes nothing. use_model false, or the model
switched off (ww_claude_cli, or rules only), means no model is called at all. A test sets app.state.pyq_prep_provider to stand
in for the model. The subjects and their syllabus come from the plan store (svc.plan); an unknown subject is 404, a missing
one 400, a plan that is not up yet 503. Every answer is the {state, reason, source, ...} envelope of ww_pyq/api.py.

The job (R-72): a model batch of 20 took 30 to 50 s and reading 89 papers again 510 s on his store (28 Nov), so a screen
cannot wait on those steps. One run at a time, on a thread of its own (app.state.pyq_prep_job), the steps in the order
subjects, reread, tags, levels, accept, each with apply on; 409 while it, the paper desk (app.state.pyq_ingest) or OCR
(app.state.pyq_ocr) runs, and the steps that write (R-66, R-68 and R-75 with apply, R-67, R-70, R-71) are 409 while it runs.
R-75 (wave EW13) answers `planned` when the model was asked for and is off or rules only is on: the rule part still runs.
A failed model batch is counted in `failures` and leaves its questions as they were; R-74 stops after the batch or the
paper in hand, so no paper is half replaced.
"""
from __future__ import annotations

from fastapi import Body, FastAPI, HTTPException
from starlette.concurrency import run_in_threadpool

from .ww_pyq import api, assign, levels, prep, settings
from .ww_pyq import store as store_mod

SOURCE = "your papers on file"
SOURCE_RUN = "the preparation run on this PC"


def _store():
    return store_mod.default_store()


def _plural(n: int, one: str, many: str) -> str:
    return f"{n} {one if n == 1 else many}"


def _keys(body: dict, allowed: set) -> dict:
    if not isinstance(body, dict):
        raise ValueError("Send an object.")
    extra = set(body) - allowed
    if extra:
        raise ValueError(f"Not a field of this step: {', '.join(sorted(map(str, extra)))[:120]}.")
    return body


def _flag(body: dict, key: str) -> bool:
    v = body.get(key, False)
    if not isinstance(v, bool):
        raise ValueError(f"{key} is true or false.")
    return v


def register(app: FastAPI, svc, bus) -> None:
    app.state.pyq_prep_job = prep.PrepJob(bus)

    def plan():
        p = getattr(svc, "plan", None)
        if p is None:
            raise HTTPException(503, "the plan store is not up yet")
        return p

    def subjects() -> list[dict]:
        return list((plan().academics() or {}).get("subjects") or [])

    def subject_of(name) -> dict:
        if not isinstance(name, str) or not name.strip():
            raise ValueError("Say which subject.")
        want = name.strip().lower()
        for s in subjects():
            if str(s.get("id") or "").lower() == want:
                return s
        raise KeyError("No such subject.")

    def model():
        return prep.model_for(_store(), getattr(app.state, "pyq_prep_provider", None))

    def counts() -> dict:
        subs = subjects()                                # 503 before anything else is read
        m, fault = assign.load_manifest()
        return assign.counts(_store(), subs, m, fault)

    def counts_reason(c: dict) -> str:
        ready = sum(r["sheet_ready_topics"] for r in c["by_subject"])
        s = (f"{_plural(c['questions'], 'question', 'questions')} on {_plural(c['papers'], 'paper', 'papers')}: "
             f"{c['accepted']} accepted, {c['with_marks']} with marks, {c['tagged']} with a topic, "
             f"{c['without_subject']} {'paper' if c['without_subject'] == 1 else 'papers'} without a subject; "
             f"{_plural(ready, 'topic is', 'topics are')} ready for an evening sheet.")
        sol = c.get("solutions") or {}
        if sol.get("papers"):
            s += f" {_plural(sol['papers'], 'solution sheet', 'solution sheets')} with {sol['items']} items {'is' if sol['papers'] == 1 else 'are'} counted apart."
        if c.get("not_questions"):
            s += f" {_plural(c['not_questions'], 'item is', 'items are')} not a question."
        return s

    def desk_busy() -> bool:
        return any(j is not None and j.running() for j in (getattr(app.state, "pyq_ingest", None), getattr(app.state, "pyq_ocr", None)))

    def job():
        return app.state.pyq_prep_job

    def not_while_running() -> None:
        if job().running():
            raise api.Busy("A preparation run is going; wait for it or stop it.")

    # ------------------------------------------------------------------ R-65
    @app.get("/api/mission/pyq/prep")
    async def prep_counts():
        def work():
            c = counts()
            if not c["papers"] and not c["solutions"]["papers"]:
                return api.ok("waiting", "No paper on file yet.", SOURCE, counts=c)
            return api.ok("live", counts_reason(c), SOURCE, counts=c)
        return await run_in_threadpool(api.guard, work)

    # ------------------------------------------------------------------ R-66
    @app.post("/api/mission/pyq/prep/subjects")
    async def prep_subjects(body: dict = Body(default={})):
        def work():
            b = _keys(body, {"apply", "use_model", "limit"})
            apply, use_model = _flag(b, "apply"), _flag(b, "use_model")
            if apply:
                not_while_running()
            m, fault = assign.load_manifest()
            md = model() if use_model else prep.OFF
            r = assign.propose(_store(), subjects(), m, apply=apply, use_model=use_model, model=md,
                               limit=b.get("limit", assign.MAX_PAPERS))
            k = r["counts"]
            found = k["course"] + k["code"] + k["name"]
            reason = (f"{'Set' if apply else 'Would set'} a subject on {_plural(found, 'paper', 'papers')} by rule "
                      f"({k['course']} by course, {k['code']} by code, {k['name']} by name)")
            if use_model:
                reason += (f"; the model suggests one for {k['model']}" if md.mode != "off" else "; the model is off")
            reason += f"; {k['none']} still without one."
            rc = r["role_counts"]
            if rc["question_bank"] or rc["solution"]:
                reason += (f" By its title, {_plural(rc['question_bank'], 'paper is a question bank', 'papers are question banks')} "
                           f"and {_plural(rc['solution'], 'paper is a solution sheet', 'papers are solution sheets')}.")
            if r["pairs"]:
                reason += f" {_plural(len(r['pairs']), 'solution names', 'solutions name')} the exam of one paper of {'its' if len(r['pairs']) == 1 else 'their'} subject."
            if fault:
                reason += " The Classroom manifest could not be read, so no course rule was used."
            return api.items(r["items"], "live", reason, "rule on titles, codes and your Classroom courses",
                             counts=k, courses=r["courses"], model=md.name if use_model else "", asked=r["asked"],
                             roles=r["roles"], role_counts=rc, pairs=r["pairs"])
        return await run_in_threadpool(api.guard, work)

    # ------------------------------------------------------------------ R-67
    @app.post("/api/mission/pyq/prep/reread")
    async def prep_reread(body: dict = Body(default={})):
        def work():
            b = _keys(body, {"papers", "apply"})
            apply = _flag(b, "apply")
            not_while_running()
            rows = prep.reread(_store(), b.get("papers"), apply, desk_busy)
            n = sum(1 for r in rows if r["changed"])
            reason = (f"{'Replaced' if apply else 'Reading again would change'} {_plural(n, 'paper', 'papers')} of {len(rows)}"
                      + ("." if apply else "; nothing was written."))
            return api.items(rows, "live", reason, "today's reader on your originals", changed=n)
        return await run_in_threadpool(api.guard, work)

    # ------------------------------------------------------------------ R-68
    @app.post("/api/mission/pyq/prep/tags")
    async def prep_tags(body: dict = Body(...)):
        def work():
            b = _keys(body, {"subject", "apply", "use_model", "limit"})
            sub = subject_of(b.get("subject"))
            apply, use_model = _flag(b, "apply"), _flag(b, "use_model")
            limit = b.get("limit", prep.DEFAULT_LIMIT)
            if limit is None:
                raise ValueError(f"The limit is between 1 and {prep.MAX_LIMIT}.")
            if apply:
                not_while_running()
            md = model() if use_model else prep.OFF
            r = prep.tag_subject(_store(), sub, apply=apply, use_model=use_model, limit=limit, model=md)
            state, reason = r.pop("state"), r.pop("reason")
            return api.ok(state, reason, "rule on the syllabus words" + (f", then {md.name}" if r["model_name"] else ""),
                          subject=str(sub["id"]).lower(), **r)
        return await run_in_threadpool(api.guard, work)

    # ------------------------------------------------------------------ R-75
    @app.post("/api/mission/pyq/prep/levels")
    async def prep_levels(body: dict = Body(...)):
        def work():
            b = _keys(body, {"subject", "apply", "use_model", "limit"})
            sub = subject_of(b.get("subject"))
            apply, use_model = _flag(b, "apply"), _flag(b, "use_model")
            limit = b.get("limit", prep.DEFAULT_LIMIT)
            if limit is None:
                raise ValueError(f"The limit is between 1 and {prep.MAX_LIMIT}.")
            if apply:
                not_while_running()
            st = _store()
            md = model() if use_model else prep.OFF
            r = levels.level_subject(st, sub, apply=apply, use_model=use_model, limit=limit, model=md)
            state, reason = r.pop("state"), r.pop("reason")
            if use_model and md.mode == "off" and state == "live":
                state = "planned"
                reason += (" The model part is planned: rules only is on." if settings.rules_only(st)
                           else " The model part is planned: the model is off.")
            return api.ok(state, reason, "rule on the asking verbs and given values" + (f", then {md.name}" if r["model_name"] else ""),
                          subject=str(sub["id"]).lower(), **r)
        return await run_in_threadpool(api.guard, work)

    # ------------------------------------------------------------------ R-69
    def policy_answer() -> dict:
        p = prep.policy(_store())
        return api.ok("live", "Questions safe to trust may be accepted by rule; each says so." if p["auto_accept"]
                      else "Off: nothing enters the bank without your review.", "your settings", policy=p)

    @app.get("/api/mission/pyq/prep/policy")
    async def prep_policy_get():
        return await run_in_threadpool(api.guard, policy_answer)

    @app.put("/api/mission/pyq/prep/policy")
    async def prep_policy_put(body: dict = Body(...)):
        def work():
            if not isinstance(body, dict) or set(body) != {"auto_accept"}:
                raise ValueError("Send {auto_accept: true or false}.")
            prep.set_policy(_store(), body["auto_accept"])
            return policy_answer()
        return await run_in_threadpool(api.guard, work)

    # ------------------------------------------------------------------ R-70, R-71
    @app.post("/api/mission/pyq/prep/accept")
    async def prep_accept(body: dict = Body(...)):
        def work():
            sid = str(subject_of(_keys(body, {"subject"}).get("subject"))["id"]).lower()
            not_while_running()
            before = counts()
            r = prep.accept(_store(), sid)
            after = counts()
            if not r["on"]:
                return api.ok("planned", "Acceptance by rule is off; only you can turn it on.", "your settings",
                              accepted=0, held={}, unmarked=0, counts=after, before=before)
            held = sum(r["held"].values())
            reason = (f"Accepted {_plural(r['accepted'], 'question', 'questions')} by rule; {held} left for your review. "
                      + (f"{r['unmarked']} of them {'is' if r['unmarked'] == 1 else 'are'} from a question bank: marks not printed. "
                         if r["unmarked"] else "")
                      + counts_reason(after))
            return api.ok("live", reason, "rule: text layer, over 40 characters, subject, marks (a question bank prints "
                          "none), unit and topic", accepted=r["accepted"], held=r["held"], unmarked=r["unmarked"],
                          counts=after, before=before)
        return await run_in_threadpool(api.guard, work)

    @app.post("/api/mission/pyq/prep/unaccept")
    async def prep_unaccept(body: dict = Body(...)):
        def work():
            sid = str(subject_of(_keys(body, {"subject"}).get("subject"))["id"]).lower()
            not_while_running()
            before = counts()
            r = prep.unaccept(_store(), sid)
            after = counts()
            return api.ok("live", f"Returned {_plural(r['returned'], 'question', 'questions')} accepted by rule to pending. "
                          + counts_reason(after), "rule", returned=r["returned"], counts=after, before=before)
        return await run_in_threadpool(api.guard, work)

    # ------------------------------------------------------------------ R-72 to R-74
    def run_answer(stopping: bool = False) -> dict:
        j = job().info()
        if j is None:
            return api.ok("waiting", "No preparation run yet.", SOURCE_RUN, run=None, **_fields(None))
        extra = {"run": j, **_fields(j)}
        if j["status"] == "running":
            if stopping:
                return api.ok("waiting", "Stopping after the batch or paper in hand.", SOURCE_RUN, **extra)
            where = f" {j['done']} of {j['total']} {j['unit']}" if j["unit"] else ""
            return api.ok("live", f"Step {j['step']}:{where} done, {j['seconds']:g} s so far.", SOURCE_RUN, **extra)
        if j["status"] == "failed":
            return api.ok("fault", j.get("error") or "The run did not finish.", SOURCE_RUN, **extra)
        b, n = j["counts_before"] or {}, j["counts_now"] or {}
        text = (f"{'Stopped during' if j['status'] == 'stopped' else 'Finished'} {', '.join(j['steps'])} in {j['seconds']:g} s: "
                f"accepted {b.get('accepted', 0)} to {n.get('accepted', 0)}, with a topic {b.get('tagged', 0)} to "
                f"{n.get('tagged', 0)}, papers without a subject {b.get('without_subject', 0)} to {n.get('without_subject', 0)}; "
                f"{_plural(j['failures'], 'failure', 'failures')}.")
        if j["notes"]:
            text += " " + " ".join(j["notes"][:3])
        return api.ok("live", text, SOURCE_RUN, **extra)

    @app.post("/api/mission/pyq/prep/run")
    async def prep_run_start(body: dict = Body(...)):
        def work():
            b = _keys(body, {"steps", "subjects", "use_model"})
            steps = prep.check_steps(b.get("steps"))
            use_model = _flag(b, "use_model")
            want = b.get("subjects")
            if want is None:
                subs = subjects()
            else:
                if not isinstance(want, list) or not want or len(want) > prep.MAX_JOB_SUBJECTS:
                    raise ValueError(f"Give up to {prep.MAX_JOB_SUBJECTS} subject ids.")
                subs = [subject_of(x) for x in dict.fromkeys(want)]          # 400 for a non-string, 404 for an unknown one
            if desk_busy():
                raise api.Busy("The paper desk or OCR is reading; start the run when it has finished.")
            not_while_running()
            m, _ = assign.load_manifest()
            job().start(_store(), steps, subjects=subs, use_model=use_model, model=model() if use_model else prep.OFF,
                        manifest=m, counts=counts, busy=desk_busy, every_paper=want is None)
            return run_answer()
        return await run_in_threadpool(api.guard, work)

    @app.get("/api/mission/pyq/prep/run")
    async def prep_run_status():
        return await run_in_threadpool(api.guard, run_answer)

    @app.delete("/api/mission/pyq/prep/run")
    async def prep_run_stop():
        def work():
            if not job().stop():
                raise ValueError("No preparation run is going.")
            return run_answer(stopping=True)
        return await run_in_threadpool(api.guard, work)


def _fields(j) -> dict:
    """R-73's named fields at the top of the answer, beside the whole record in `run`."""
    keys = ("status", "step", "done", "total", "counts_before", "counts_now", "seconds", "failures")
    return {k: (j or {}).get(k) for k in keys} if j else {k: None for k in keys}
