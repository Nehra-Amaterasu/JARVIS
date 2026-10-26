"""/api/mission: Mission Germoney v2, the plan engine (rules in germoney.py, "the plan engine").

    GET    /api/mission/today              today's blocks + contracts (frozen per day), wins, exam mode
    POST   /api/mission/today/reroll       rebuild today's plan (after a bank update, say)
    GET    /api/mission/state              progress: node statuses, contracts done, events, rotation, parking
    GET    /api/mission/bank               the merged bank as the server sees it, with its warnings/errors
    POST   /api/mission/contract           {key, proof?}            finish a contract (a link = verified)
    POST   /api/mission/node/{id}/{op}     op: start | pause | master
    POST   /api/mission/node/{id}/attribute {kind: cert|project|achievement, text, url?, cert?}
    POST   /api/mission/log                {minutes, track, note?, proof?, node?}   the one log
    POST   /api/mission/xp                 {amount, reason}         XP earned in the window (one total)
    PUT    /api/mission/career             {career}
    PUT    /api/mission/settings           {rotation?, schedule?, window_days?, budget?}
    GET    /api/mission/campaigns          campaigns (suggested, active, shipped) with finish lines
    POST   /api/mission/campaign/{op}      {id, url?}  op: start | ship | drop
    GET    /api/mission/certs              certificates with cost vs the monthly budget
    POST   /api/mission/cert               {cert, url?}
    GET    /api/mission/parking            the parking lot for new ideas
    POST   /api/mission/parking            {text, node?}
    DELETE /api/mission/parking/{id}
    GET    /api/mission/academics          academics.json (private, never bundled) + days left
    GET    /api/mission/academics/file?path=  a study file (notes, a real past paper), only from the
                                           academics folder or the OneDrive COLLEGE folder
    PUT    /api/mission/academics/exam     {subject, date|null}     set an exam date
    POST   /api/mission/exam               {subject|null, days?}    exam mode on/off for a subject
    GET    /api/mission/findings           latest arXiv per active node (cached daily, offline-tolerant)
    POST   /api/mission/voice              {intent, args}           the voice intents, one spoken line
    GET    /api/mission/applications       the internship pipeline (private: data/app/germoney/), countdowns, goals
    PUT    /api/mission/applications       {entry}                  add or edit an application
    POST   /api/mission/applications/{id}/status  {status, note?}   idea|preparing|applied|interview|offer|rejected
    DELETE /api/mission/applications/{id}
    PUT    /api/mission/goals              {goal}                   a goal and its milestones (linked to tree nodes)
    PUT    /api/mission/tasks              {task}                   a prep-checklist item {id?, title, due, done}
    POST   /api/mission/choose             {key, alt}               swap a contract for one of today's alternatives
    GET    /api/mission/ladder             vision → years → quarter / month / week (derived), reviews
    POST   /api/mission/review             {went_well, slipped, next, milestones?}   the monthly review
    GET    /api/mission/profile            his style rules (private profile.json; no test scores)
    PUT    /api/mission/profile            {traits?, rules?, style?}
    GET    /api/mission/learning           the learning-log timeline
    POST   /api/mission/learning           {what, minutes?, note?, tags?, nodes?, files?: [{name, data(base64)}]}
    PUT    /api/mission/learning/{entry}/nodes  {nodes}             correct the matched nodes
    GET    /api/mission/status             Well Wisher Status window: rank, stats (each with how it was
                                           computed), what is not counted, advice (wellwisher.py)
    GET    /api/mission/engines            the Well Wisher engines (ww_engines.py): goal ladder, evidence
                                           audit, career, money, personality, insight, today's 3, the registry
    GET    /api/mission/engine/{name}      one engine over his data (schema checked; invalid_input if not)
    GET    /api/mission/exams              papers ahead: coverage, the block plan to the last paper, a forecast (ww_exams.py)
    POST   /api/mission/exams/{subject}/{op}  op topic {key, state} | minutes {minutes} | paper {score, max}
    GET    /api/mission/inputs             the engine inputs: as written, normalized, and the editable sections
    PUT    /api/mission/inputs/{section}   {value}  replace one section of engine-inputs.json (Settings)
    GET    /api/mission/body               body & life: habits this week + this week's upgrade focus (ww_body.py)
    POST   /api/mission/habit/{id}         {done?: false to undo}  tap a habit done for today
    GET    /api/mission/learn              daily knowledge program: today's concept + recalls due (ww_learning.py)
    POST   /api/mission/learn/{id}/seen    mark today's concept taught
    POST   /api/mission/learn/{id}/recall  {ok: true|false}  one recall answer (Leitner schedule)
    GET    /api/mission/engine/proof       GitHub streak from public activity + one real proof idea (ww_proof.py)
    GET    /api/mission/weekly             the weekly review (insight engine); `say` is the spoken version
    GET    /api/mission/money              the money engine: months, experiments in Rs/hour, projection (education)
    POST   /api/mission/money              {kind, amount, date?, hours?, experiment?, note?}  one money-log entry
    DELETE /api/mission/money/{id}         remove a money-log entry (a typo)
    GET    /api/mission/quests            the optional quest lines, his record, today's quest contract
    PUT    /api/mission/quest/{line}       {on, levels?}            turn a line on/off, placement levels
    POST   /api/mission/quest/{line}/log   {track, sets: [n, ...], proof?}   one session, set by set

A background loop nudges (spoken if JARVIS is awake, else a ticker line) when he has
drifted for more than the profile's idle days: once a day at most, never in quiet hours.

None of this needs the Mission window: the state is one key in the same store
(@mission_v2), written only here.
"""
from __future__ import annotations

import json
from datetime import date
from typing import Any, Optional

from fastapi import Body, FastAPI, HTTPException
from starlette.concurrency import run_in_threadpool

from . import germoney, ww_engines


def _chain_lifespan(app: FastAPI, start) -> None:
    """Run `start()` for the app's lifetime, after the server's own startup."""
    import asyncio
    from contextlib import asynccontextmanager
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
    plan = germoney.Plan(svc.kv)
    svc.plan = plan

    async def drift_loop():
        import asyncio
        while True:
            await asyncio.sleep(1800)
            try:
                text = await run_in_threadpool(germoney.drift_nudge, plan)
            except Exception:
                text = None
            if not text:
                continue
            try:
                await run_in_threadpool(svc.core.speak, text)
            except Exception:
                bus.publish("mission", "nudge", text[:140])
    _chain_lifespan(app, drift_loop)

    def guard(fn, *a, **k):
        try:
            return fn(*a, **k)
        except KeyError as e:
            raise HTTPException(404, str(e).strip("'\""))
        except ValueError as e:
            raise HTTPException(400, str(e))

    def publish(text: str) -> None:
        try:
            bus.publish("mission", "update", text[:140])
        except Exception:
            pass

    @app.get("/api/mission/today")
    async def today():
        return await run_in_threadpool(plan.today)

    @app.post("/api/mission/today/reroll")
    async def reroll():
        return await run_in_threadpool(plan.reroll)

    @app.get("/api/mission/state")
    async def state():
        return await run_in_threadpool(plan.state)

    # ---- Well Wisher (wellwisher.py): the Status window and the optional quest lines
    @app.get("/api/mission/status")
    async def status():
        return await run_in_threadpool(plan.status)

    @app.get("/api/mission/engines")
    async def engines():
        return await run_in_threadpool(plan.engines)

    @app.get("/api/mission/engine/{name}")
    async def engine(name: str):
        return await run_in_threadpool(guard, plan.engine, name)

    @app.get("/api/mission/weekly")
    async def weekly():
        return await run_in_threadpool(plan.weekly)

    @app.get("/api/mission/body")
    async def body():
        return await run_in_threadpool(guard, plan.engine, "body")

    @app.post("/api/mission/habit/{hid}")
    async def habit(hid: str, payload: Optional[dict] = Body(None)):
        return await run_in_threadpool(guard, plan.habit_mark, hid, (payload or {}).get("done", True) is not False)

    @app.get("/api/mission/learn")
    async def learn():
        return await run_in_threadpool(guard, plan.engine, "learning")

    @app.post("/api/mission/learn/{cid}/{op}")
    async def learn_mark(cid: str, op: str, payload: Optional[dict] = Body(None)):
        ok = (payload or {}).get("ok")
        return await run_in_threadpool(guard, plan.learn_mark, cid, op, ok)

    @app.get("/api/mission/exams")
    async def exams():
        return await run_in_threadpool(guard, plan.engine, "exams")

    @app.post("/api/mission/exams/{subject}/{op}")
    async def exam_prep(subject: str, op: str, payload: Optional[dict] = Body(None)):
        return await run_in_threadpool(guard, plan.exam_prep, op, subject, payload or {})

    @app.get("/api/mission/inputs")
    async def inputs_get():
        def view():
            return {"raw": ww_engines.raw_inputs(), "inputs": ww_engines.load_inputs(), "editable": sorted(ww_engines.EDITABLE)}
        return await run_in_threadpool(view)

    @app.put("/api/mission/inputs/{section}")
    async def inputs_put(section: str, payload: dict = Body(...)):
        r = await run_in_threadpool(guard, ww_engines.save_section, section, payload.get("value"))
        if section == "exams":
            await run_in_threadpool(plan.reroll)      # the day may switch into exam mode
        return r

    @app.get("/api/mission/money")
    async def money():
        return await run_in_threadpool(guard, plan.engine, "money")

    @app.post("/api/mission/money")
    async def money_log(payload: dict = Body(...)):
        r = await run_in_threadpool(guard, plan.money_log, payload.get("entry") if isinstance(payload.get("entry"), dict) else payload)
        publish(r["say"])
        return r

    @app.delete("/api/mission/money/{eid}")
    async def money_remove(eid: str):
        return await run_in_threadpool(guard, plan.money_remove, eid)

    @app.get("/api/mission/quests")
    async def quests():
        return await run_in_threadpool(plan.quests)

    @app.put("/api/mission/quest/{lid}")
    async def quest_set(lid: str, payload: dict = Body(...)):
        r = await run_in_threadpool(guard, plan.quest_set, lid, bool(payload.get("on")), payload.get("levels"))
        publish(r["say"])
        return r

    @app.post("/api/mission/quest/{lid}/log")
    async def quest_log(lid: str, payload: dict = Body(...)):
        r = await run_in_threadpool(guard, plan.quest_log, lid, str(payload.get("track") or ""), payload.get("sets"),
                                    str(payload.get("proof") or ""))
        publish(r["say"])
        return r

    @app.get("/api/mission/bank")
    async def bank():
        b = await run_in_threadpool(plan.bank)
        return {k: b[k] for k in ("version", "files", "warnings", "errors", "careers", "certs", "math")} | {
            "nodes": [b["nodes"][n] for n in b["order"]], "resources": list(b["resources"].values())}

    @app.post("/api/mission/contract")
    async def contract(payload: dict = Body(...)):
        key = str(payload.get("key") or "")
        r = await run_in_threadpool(guard, plan.complete, key, str(payload.get("proof") or ""))
        publish(r["say"])
        return r

    @app.post("/api/mission/node/{nid}/{op}")
    async def node(nid: str, op: str, payload: Optional[dict] = Body(None)):
        if op == "attribute":
            p = payload or {}
            r = await run_in_threadpool(guard, plan.add_attribute, nid, str(p.get("kind") or ""), str(p.get("text") or ""),
                                        str(p.get("url") or ""), p.get("cert"))
        elif op in ("start", "pause", "master"):
            fn = {"start": plan.start_node, "pause": plan.pause_node, "master": plan.master_node}[op]
            r = await run_in_threadpool(guard, fn, nid)
        else:
            raise HTTPException(400, "op must be start, pause, master or attribute")
        publish(r.get("say", ""))
        return r

    @app.post("/api/mission/log")
    async def log(payload: dict = Body(...)):
        try:
            minutes = int(payload.get("minutes") or 0)
        except (TypeError, ValueError):
            raise HTTPException(400, "minutes must be a number")
        if minutes <= 0:
            raise HTTPException(400, "log at least one minute")
        r = await run_in_threadpool(guard, plan.log, minutes, str(payload.get("track") or ""), str(payload.get("note") or ""),
                                    str(payload.get("proof") or ""), payload.get("node"))
        publish(r["say"])
        return r

    @app.post("/api/mission/xp")
    async def xp(payload: dict = Body(...)):
        try:
            amount = int(payload.get("amount") or 0)
        except (TypeError, ValueError):
            raise HTTPException(400, "amount must be a number")
        return await run_in_threadpool(plan.add_xp, amount, str(payload.get("reason") or ""))

    @app.put("/api/mission/career")
    async def career(payload: dict = Body(...)):
        return await run_in_threadpool(guard, plan.set_career, payload.get("career") or None)

    @app.put("/api/mission/settings")
    async def settings(payload: dict = Body(...)):
        return await run_in_threadpool(guard, plan.set_settings, payload.get("rotation"), payload.get("schedule"),
                                       payload.get("window_days"), payload.get("budget"))

    @app.get("/api/mission/campaigns")
    async def campaigns():
        return await run_in_threadpool(plan.campaigns)

    @app.post("/api/mission/campaign/{op}")
    async def campaign(op: str, payload: dict = Body(...)):
        r = await run_in_threadpool(guard, plan.campaign, str(payload.get("id") or ""), op, str(payload.get("url") or ""))
        publish(r["say"])
        return r

    @app.get("/api/mission/certs")
    async def certs():
        return await run_in_threadpool(plan.certs)

    @app.post("/api/mission/cert")
    async def cert(payload: dict = Body(...)):
        return await run_in_threadpool(guard, plan.earn_cert, str(payload.get("cert") or ""), str(payload.get("url") or ""))

    @app.get("/api/mission/parking")
    async def parking():
        return {"parking": (await run_in_threadpool(plan.load))["parking"]}

    @app.post("/api/mission/parking")
    async def park(payload: dict = Body(...)):
        return await run_in_threadpool(guard, plan.park, str(payload.get("text") or ""), payload.get("node"))

    @app.delete("/api/mission/parking/{pid}")
    async def unpark(pid: str):
        return await run_in_threadpool(plan.unpark, pid)

    @app.get("/api/mission/academics")
    async def academics():
        ac = await run_in_threadpool(plan.academics)
        if ac is None:
            return {"missing": True, "subjects": []}
        t = date.today()
        for s in ac["subjects"]:
            d, kind, approx = germoney.next_exam(ac, s, t.isoformat())
            s.update(exam_date=d, date_kind=kind, approx=approx, days_left=(date.fromisoformat(d) - t).days if d else None)
        return ac

    @app.get("/api/mission/academics/file")
    async def academics_file(path: str):
        real = await run_in_threadpool(germoney.file_allowed, path)
        if real is None:
            raise HTTPException(404, "not a study file this app may serve")
        from fastapi.responses import FileResponse
        media = {".pdf": "application/pdf", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
                 ".txt": "text/plain", ".md": "text/markdown"}[real.suffix.lower()]
        return FileResponse(real, media_type=media, filename=real.name, content_disposition_type="inline")

    @app.put("/api/mission/academics/exam")
    async def exam_date(payload: dict = Body(...)):
        day = payload.get("date") or None
        r = await run_in_threadpool(guard, germoney.set_exam_date, str(payload.get("subject") or ""), day)
        await run_in_threadpool(plan.reroll)          # today's plan may switch to (or out of) exam mode
        return r

    @app.post("/api/mission/exam")
    async def exam(payload: dict = Body(...)):
        subj = payload.get("subject")
        days = payload.get("days")                    # plan.exam_focus validates it: a wrong shape is a 400, not a 500
        return await run_in_threadpool(guard, plan.exam_focus, None if not subj else str(subj), 14 if days is None else days)

    @app.get("/api/mission/findings")
    async def findings(refresh: bool = False):
        return await run_in_threadpool(germoney.findings, plan, None, refresh)

    @app.get("/api/mission/applications")
    async def applications():
        def view():
            return plan.apps.view(None, plan.bank(), plan.load())
        return await run_in_threadpool(view)

    @app.put("/api/mission/applications")
    async def app_upsert(payload: dict = Body(...)):
        return await run_in_threadpool(guard, plan.apps.upsert, payload.get("entry") or payload)

    @app.post("/api/mission/applications/{aid}/status")
    async def app_status(aid: str, payload: dict = Body(...)):
        r = await run_in_threadpool(guard, plan.apps.set_status, aid, str(payload.get("status") or ""), str(payload.get("note") or ""))
        publish(f"Application {aid}: {payload.get('status')}")
        return r

    @app.delete("/api/mission/applications/{aid}")
    async def app_remove(aid: str):
        return await run_in_threadpool(plan.apps.remove, aid)

    @app.put("/api/mission/tasks")
    async def task(payload: dict = Body(...)):
        return await run_in_threadpool(guard, plan.apps.set_task, payload.get("task") or payload)

    @app.post("/api/mission/choose")
    async def choose(payload: dict = Body(...)):
        return await run_in_threadpool(guard, plan.choose, str(payload.get("key") or ""), str(payload.get("alt") or ""))

    @app.get("/api/mission/ladder")
    async def ladder():
        return await run_in_threadpool(germoney.ladder_view, plan)

    @app.post("/api/mission/review")
    async def review(payload: dict = Body(...)):
        return await run_in_threadpool(guard, germoney.save_review, payload)

    @app.get("/api/mission/profile")
    async def profile():
        return await run_in_threadpool(germoney.load_profile)

    @app.put("/api/mission/profile")
    async def profile_set(payload: dict = Body(...)):
        return await run_in_threadpool(guard, germoney.save_profile, payload)

    @app.get("/api/mission/learning")
    async def learning():
        return {"entries": await run_in_threadpool(germoney.learning_timeline)}

    @app.post("/api/mission/learning")
    async def learning_add(payload: dict = Body(...)):
        files = payload.get("files") or []
        if not isinstance(files, list):
            raise HTTPException(400, "files must be a list")
        r = await run_in_threadpool(guard, germoney.add_learning, plan, str(payload.get("what") or ""), payload.get("minutes") or 0,
                                    str(payload.get("note") or ""), payload.get("tags") or [], files, payload.get("nodes"))
        publish(r["say"])
        return r

    @app.put("/api/mission/learning/{entry}/nodes")
    async def learning_nodes(entry: str, payload: dict = Body(...)):
        return await run_in_threadpool(guard, germoney.correct_learning, plan, entry, payload.get("nodes") or [])

    @app.put("/api/mission/goals")
    async def goal(payload: dict = Body(...)):
        return await run_in_threadpool(guard, plan.apps.set_goal, payload.get("goal") or payload)

    @app.post("/api/mission/voice")
    async def voice(payload: dict = Body(...)):
        intent = str(payload.get("intent") or "")
        args: Any = payload.get("args") or {}
        if not isinstance(args, dict):
            raise HTTPException(400, "args must be an object")
        brief = None
        raw = svc.kv.get("@silicon_game_brief")
        if raw:
            try:
                brief = json.loads(raw)
            except ValueError:
                brief = None
        r = await run_in_threadpool(guard, germoney.voice, plan, intent, args, None, brief)
        if r.get("say"):
            publish(r["say"])
        return r
