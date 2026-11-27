"""/api/mission/pyq/tonight: the evening practice sheet the app builds by itself, and the marks he types back (ww_pyq/tonight.py).

    GET    /api/mission/pyq/tonight                   R-55 today's sheet, earlier sheets awaiting marks, the settings, the papers ahead
    PUT    /api/mission/pyq/tonight/settings          R-56 {on?, hour? "HH:MM", count? 3 to 12, horizon_days? 1 to 60}
    POST   /api/mission/pyq/tonight/build             R-57 {date?, subject?}: the sheet of a day, each item with its text and why
    POST   /api/mission/pyq/tonight/{sid}/marks       R-58 {items: [{question_id, got, minutes?}]}: kept in the sheet and the plan
    GET    /api/mission/pyq/tonight/{sid}/print       R-59 the sheet as A4 HTML through the print set of R-25

The subject is the paper nearest in date on his date sheet (ww_engines inputs, the rows ww_exams reads) unless he names
one; the topics follow the counted order of R-17 (ww_pyq.next.practise_next with the same terms, over every topic, not a
gap), one accepted question a topic, none that stood on the last three sheets of the subject. A sheet once built is kept
as it is, so the same day and subject always answer the same sheet. Marks go where R-27 sends them, the plan's
paper_marks list of the topic, tagged origin "sheet" and the sheet id so a second post for a question replaces the
first instead of counting twice; that list is what R-17's proficiency reads, so the order moves with them. They are not
added to attempts.jsonl or exam_prep papers: those hold generated papers, and the ledger reads sheets from their files.

The clock rides on the app's reminder scheduler (routes_reminders, which sorts first and leaves svc.reminder_scheduler):
its once-a-second tick also looks at this clock, at most every 30 seconds, and the reminder is raised through
svc.reminders like any other. No thread or task of its own. Off means nothing is built and nothing is raised; one day
never gets two reminders (tonight.clock_step writes the day before it reminds). Every JSON answer is the
{state, reason, source, ...} envelope of ww_pyq/api.py.
"""
from __future__ import annotations

import time
from datetime import date, datetime
from typing import Any, Optional

from fastapi import Body, FastAPI, HTTPException
from fastapi.responses import HTMLResponse
from starlette.concurrency import run_in_threadpool

from . import ww_generator
from .ww_pyq import api, next as pnext, patterns, printset, tag, tonight
from .ww_pyq import store as store_mod

SOURCE = "your papers on file and your date sheet"
SOURCE_MARKS = "the marks you typed"
_ALL_MINUTES = 10 ** 9           # the whole counted order of R-17, not the topics of one gap
_CLOCK_EVERY_S = 30.0            # the scheduler ticks every second; once in 30 s is plenty for a sheet set by the minute
_LETTERS = "ABCDEFGHIJKL"        # one print section per marks value; a sheet holds at most 12 questions


def _store():
    return store_mod.default_store()


def _plural(n: int, one: str, many: str) -> str:
    return f"{n} {one if n == 1 else many}"


def _g(x: Any) -> str:
    return format(float(x), "g")


def exams_of() -> list[dict]:
    """The date sheet he typed in Settings (the exam rows ww_exams reads: id, subject, title, date, start)."""
    from . import ww_engines
    try:
        return list(ww_engines.load_inputs().get("exams") or [])
    except Exception:              # a broken inputs file must not take the sheet down; it reads as no paper ahead
        return []


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

    def subjects() -> list[dict]:
        return (plan().academics() or {}).get("subjects") or []

    def subject_of(name: Any) -> dict:
        if not isinstance(name, str) or not name.strip():
            raise ValueError("Say which subject.")
        want = name.strip().lower()
        for s in subjects():
            if str(s.get("id") or "").lower() == want:
                return s
        raise KeyError("No such subject.")

    def name_of(sub: dict) -> str:
        return str(sub.get("name") or sub.get("id") or "")

    def papers_ahead(day: str, horizon: Optional[int]) -> list[dict]:
        """Exam rows from `day` on, within the horizon when one is given, nearest first."""
        d0 = date.fromisoformat(day)
        out = []
        for e in exams_of():
            try:
                left = (date.fromisoformat(str(e.get("date") or "")) - d0).days
            except ValueError:
                continue
            if left < 0 or (horizon is not None and left > horizon):
                continue
            out.append({"subject": str(e.get("subject") or "").lower(), "title": str(e.get("title") or e.get("id") or ""),
                        "date": str(e["date"]), "days_left": left, "_start": str(e.get("start") or ""), "_id": str(e.get("id") or "")})
        out.sort(key=lambda r: (r["date"], r["_start"], r["_id"]))
        return out

    def public(rows: list[dict]) -> list[dict]:
        return [{k: v for k, v in r.items() if not k.startswith("_")} for r in rows]

    def days_left_for(subject_id: str, day: str) -> Optional[int]:
        return next((r["days_left"] for r in papers_ahead(day, None) if r["subject"] == subject_id), None)

    def accepted_of(st, sid: str) -> dict:
        # a question prints from its words or its page crop; one with neither cannot stand on a sheet
        return {q["id"]: q for q in st.list_questions(subject=sid, status="accepted")
                if q.get("marks") is not None and (str(q.get("text") or "").strip() or (q.get("crop") or {}).get("png"))}

    def counted_order(st, sub: dict, sid: str) -> tuple[list[dict], dict]:
        """R-17 as routes_ww_pyq_patterns computes it: the same patterns, proficiency, attempts and syllabus weights."""
        ps = patterns.compute_patterns(st.list_questions(subject=sid), st.list_papers(sid))
        keys = [t["key"] for t in ps["topics"]]
        saved = plan().load() or {}
        states = ((saved.get("exam_prep") or {}).get(sid) or {}).get("topics") or {}
        marks = (saved.get("paper_marks") or {}).get(sid) or {}
        prof = ww_generator.proficiency(states, marks, keys)
        attempts = {k: len(marks.get(k) or []) for k in keys}
        weights = {t["key"]: {"high": 3, "med": 2, "low": 1}.get(t.get("weight", "med"), 2) for t in tag.topics_of(sub)}
        return pnext.practise_next(ps, prof, _ALL_MINUTES, attempts=attempts, weights=weights), ps

    def answer_of(st, sheet: dict) -> dict:
        """The stored sheet with each item's words, its crop reference and the terms that chose it."""
        why = tonight.load_why(st, sheet["id"])
        got = {m["question_id"]: m for m in sheet.get("marks") or []}
        items = []
        for it in sheet.get("items") or []:
            qid = it["question_id"]
            try:
                q = st.get_question(qid)
                crop = f"/api/mission/pyq/crops/{qid}" if st.crop_path(qid) is not None else None
            except (KeyError, ValueError, OSError):
                q, crop = {}, None                 # deleted since: the row stays, its words are gone
            items.append({**it, "text": str(q.get("text") or ""), "crop": crop, "why": why.get(qid),
                          "mark": got.get(qid)})
        return {**sheet, "items": items, "unmarked": tonight.unmarked(sheet)}

    def build(day: str, subject: Any = None) -> tuple[str, str, Optional[dict], Optional[dict], Optional[int]]:
        """(state, reason, sheet answer, subject, days_left). Nothing is written unless a sheet is made."""
        st = _store()
        s = tonight.load_settings(st)
        if subject is None:
            known = {str(x.get("id") or "").lower() for x in subjects()}
            ahead = [r for r in papers_ahead(day, s["horizon_days"]) if r["subject"] in known]
            if not ahead:
                return "waiting", f"No paper on the date sheet in the next {_plural(s['horizon_days'], 'day', 'days')}.", None, None, None
            subject = ahead[0]["subject"]
        sub = subject_of(subject)
        sid_subject = str(sub["id"]).lower()
        sid = tonight.sheet_id(day, sid_subject)
        left = days_left_for(sid_subject, day)
        old = tonight.find_sheet(st, sid)
        if old is not None:
            return "live", f"The sheet of {day}: {_plural(len(old['items']), 'question', 'questions')}, {name_of(sub)}.", answer_of(st, old), sub, left
        accepted = accepted_of(st, sid_subject)
        if not accepted:
            return "waiting", f"No accepted question for {name_of(sub)} yet.", None, sub, left
        picks, _ = counted_order(st, sub, sid_subject)
        if not picks:
            return "waiting", f"No topic of {name_of(sub)} has {pnext.MIN_QUESTIONS} reviewed questions yet.", None, sub, left
        recent = tonight.recent_question_ids(st, sid_subject, day)
        chosen = tonight.choose(picks, accepted, recent, s["count"], sid)
        if not chosen:
            return ("waiting", f"Every question of the counted topics stood on the last {tonight.RECENT_SHEETS} sheets of {name_of(sub)}.",
                    None, sub, left)
        sheet = tonight.make_sheet(sid, day, sid_subject, chosen, datetime.now().isoformat(timespec="seconds"))
        why = {q["id"]: tonight.why_of(p, left) for p, q in chosen}
        tonight.save_sheet(st, sheet, why)
        publish(f"tonight's sheet built: {len(chosen)} questions")
        short = "" if len(chosen) >= s["count"] else f" {_plural(len(chosen), 'topic', 'topics')} had a question to give."
        return "live", tonight.reminder_text(len(chosen), name_of(sub), left) + "." + short, answer_of(st, sheet), sub, left

    def today() -> str:
        return date.today().isoformat()

    # ------------------------------------------------------------------ R-55
    @app.get("/api/mission/pyq/tonight")
    async def get_tonight():
        def work():
            st = _store()
            s = tonight.load_settings(st)
            day = today()
            ahead = papers_ahead(day, s["horizon_days"])
            known = {str(x.get("id") or "").lower(): x for x in subjects()}
            mine = [r for r in ahead if r["subject"] in known]
            sheet = next((x for x in tonight.list_sheets(st) if x.get("date") == day
                          and (not mine or x.get("subject") == mine[0]["subject"])), None)
            if sheet is None:
                sheet = next((x for x in tonight.list_sheets(st) if x.get("date") == day), None)
            waiting_rows = [{"id": x["id"], "date": x["date"], "subject": x["subject"], "unmarked": tonight.unmarked(x)}
                            for x in tonight.list_sheets(st) if (x.get("date") or "") < day and tonight.unmarked(x)]
            body = {"sheet": answer_of(st, sheet) if sheet else None, "awaiting_marks": waiting_rows, "settings": s,
                    "next_papers": public(ahead)}
            if not s["on"]:
                return api.ok("planned", f"The evening sheet is off. Switch it on and one is built at {s['hour']} each day.", SOURCE, **body)
            if not mine:
                return api.ok("waiting", f"No paper on the date sheet in the next {_plural(s['horizon_days'], 'day', 'days')}.", SOURCE, **body)
            sub = known[mine[0]["subject"]]
            if sheet is None and not accepted_of(st, mine[0]["subject"]):
                return api.ok("waiting", f"No accepted question for {name_of(sub)} yet.", SOURCE, **body)
            if sheet is None:
                return api.ok("live", f"Tonight's sheet is built at {s['hour']}: {name_of(sub)}, paper in "
                                      f"{_plural(mine[0]['days_left'], 'day', 'days')}.", SOURCE, **body)
            reason = tonight.reminder_text(len(sheet["items"]), name_of(known.get(sheet["subject"]) or {"id": sheet["subject"]}),
                                           days_left_for(sheet["subject"], day)) + "."
            if waiting_rows:
                reason += f" {_plural(len(waiting_rows), 'earlier sheet is', 'earlier sheets are')} waiting for marks."
            return api.ok("live", reason, SOURCE, **body)
        return await run_in_threadpool(api.guard, work)

    # ------------------------------------------------------------------ R-56
    @app.put("/api/mission/pyq/tonight/settings")
    async def put_settings(body: dict = Body(...)):
        def work():
            s = tonight.save_settings(_store(), body)
            if not s["on"]:
                return api.ok("planned", "The evening sheet is off: nothing is built and nothing reminds you.", "your settings", settings=s)
            return api.ok("live", f"Each day at {s['hour']}: {s['count']} questions for the paper nearest in date within "
                                  f"{_plural(s['horizon_days'], 'day', 'days')}.", "your settings", settings=s)
        return await run_in_threadpool(api.guard, work)

    # ------------------------------------------------------------------ R-57
    @app.post("/api/mission/pyq/tonight/build")
    async def post_build(body: dict = Body(default_factory=dict)):
        def work():
            if not isinstance(body, dict) or set(body) - {"date", "subject"}:
                raise ValueError("Send {date?, subject?}.")
            day = tonight.check_date(body["date"]) if body.get("date") is not None else today()
            subject = body.get("subject")
            if subject is not None and not isinstance(subject, str):
                raise ValueError("Say which subject.")
            state, reason, sheet, _, _ = build(day, subject)
            return api.ok(state, reason, SOURCE, sheet=sheet)
        return await run_in_threadpool(api.guard, work)

    # ------------------------------------------------------------------ R-58
    @app.post("/api/mission/pyq/tonight/{sid}/marks")
    async def post_marks(sid: str, body: dict = Body(...)):
        def work():
            tonight.check_sheet_id(sid)
            p = plan()
            st = _store()
            if not isinstance(body, dict) or set(body) != {"items"}:
                raise ValueError("Send the marks as {items: [{question_id, got, minutes?}]}.")
            with tonight._LOCK:
                sheet = tonight.load_sheet(st, sid)
                new, kept = tonight.apply_marks(sheet, body["items"], datetime.now().isoformat(timespec="seconds"))
                by_q = {it["question_id"]: it for it in sheet["items"]}
                day = today()
                # where R-27 writes (Plan.paper_marks): the topic's list in paper_marks, oldest first, 40 kept. The tag
                # lets a second post replace its own entry; R-27 cannot replace, so its rows are never touched here.
                with p._lock:
                    state = p.load(day)
                    pm = state.setdefault("paper_marks", {}).setdefault(sheet["subject"], {})
                    for m in kept:
                        lst = pm.setdefault(by_q[m["question_id"]]["topic_key"], [])
                        lst[:] = [e for e in lst if not (e.get("sheet") == sid and e.get("q") == m["question_id"])]
                        lst.append({"date": day, "got": m["got"], "max": m["max"], "q": m["question_id"], "origin": "sheet", "sheet": sid})
                        del lst[:-40]
                    p.save(state)
                    states = ((state.get("exam_prep") or {}).get(sheet["subject"]) or {}).get("topics") or {}
                    keys = sorted({by_q[m["question_id"]]["topic_key"] for m in kept})
                    prof = ww_generator.proficiency(states, pm, keys)
                tonight.save_sheet(st, new)
            got_sum, max_sum = sum(m["got"] for m in kept), sum(m["max"] for m in kept)
            left = tonight.unmarked(new)
            publish(f"sheet marks saved: {_g(got_sum)} of {_g(max_sum)}")
            reason = (f"Saved marks for {_plural(len(kept), 'question', 'questions')}: {_g(got_sum)} of {_g(max_sum)}."
                      + (f" {_plural(left, 'question is', 'questions are')} still unmarked." if left else " Every question is marked."))
            return api.ok("live", reason, SOURCE_MARKS, sheet=answer_of(st, new), saved=len(kept),
                          total={"got": got_sum, "max": max_sum}, marked_by="you", proficiency={k: prof.get(k) for k in keys})
        return await run_in_threadpool(api.guard, work)

    # ------------------------------------------------------------------ R-59
    @app.get("/api/mission/pyq/tonight/{sid}/print")
    async def get_print(sid: str):
        def work():
            tonight.check_sheet_id(sid)
            st = _store()
            sheet = tonight.load_sheet(st, sid)
            ans = answer_of(st, sheet)
            try:
                title = name_of(subject_of(sheet["subject"]))
            except (KeyError, ValueError, HTTPException):
                title = sheet["subject"]
            sections: list[dict] = []
            for it in ans["items"]:
                sec = next((x for x in sections if float(x["marks"]) == float(it["marks"])), None)
                if sec is None:
                    sec = {"name": _LETTERS[len(sections)], "marks": it["marks"], "slots": []}
                    sections.append(sec)
                sec["slots"].append({"n": it["n"], "source": "hand", "question_id": it["question_id"], "text": it["text"],
                                     "has_crop": it["crop"] is not None, "marks": it["marks"]})
            for sec in sections:
                sec["attempt"] = sec["set"] = len(sec["slots"])
            paper = {"id": sheet["id"], "title": f"Tonight, {sheet['date']}: {title}", "seed": None,
                     "header": "Practice sheet from your bank. Not an official paper.",
                     "total_marks": sum(float(it["marks"]) for it in ans["items"]), "duration_min": None,
                     "made": sheet.get("built_at"), "sections": sections}
            html = printset.render_print(paper, "paper", store=st)
            # the print set's footer names a generated paper's seed; a sheet has none, so the line names the sheet
            return html.replace("<footer>Seed . Paper ", "<footer>Sheet ", 1)
        html = await run_in_threadpool(api.guard, work)
        return HTMLResponse(html)

    # ------------------------------------------------------------------ the clock
    def clock_build(day: str) -> Optional[dict]:
        state, _, sheet, sub, left = build(day)
        if state != "live" or not sheet:
            return None
        return {"sheet": sheet, "subject_name": name_of(sub) if sub else sheet["subject"], "days_left": left}

    def clock_look(now_ts: float) -> Optional[dict]:
        rs = getattr(svc, "reminders", None)
        if getattr(svc, "plan", None) is None or rs is None:
            return None                            # nothing to build from, or nowhere to remind: the day is not used up
        return tonight.clock_step(_store(), datetime.fromtimestamp(now_ts), clock_build,
                                  lambda text: rs.create(text=text, kind="reminder", due=rs.clock(), origin="tonight"))

    app.state.pyq_tonight_clock = clock_look
    sched = getattr(svc, "reminder_scheduler", None)
    if sched is None:
        return                                     # no scheduler mounted (a test app): the clock is callable, not wired
    # registered again on the same scheduler (a second app in one process): wrap the scheduler's own tick, not the
    # earlier wrapper, so the clock is looked at once per tick however many times the routes were registered
    inner = getattr(sched.tick, "_tonight_inner", sched.tick)
    last = [float("-inf")]

    def tick(now: Optional[float] = None):
        t = sched.clock() if now is None else now
        if not 0 <= t - last[0] < _CLOCK_EVERY_S:
            last[0] = t
            try:
                clock_look(t)
            except Exception as e:                 # the reminders must outlive a bad sheet
                try:
                    bus.publish("mission", "error", f"Tonight's sheet could not be built: {e}"[:140])
                except Exception:
                    pass
        return inner(now)

    tick._tonight_inner = inner
    sched.tick = tick
