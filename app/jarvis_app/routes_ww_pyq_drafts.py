"""/api/mission/pyq: questions the local model drafts from his notes, and the switch that turns the model off (ww_pyq/drafts.py).

    POST   /api/mission/pyq/drafts/from-notes    R-50 {subject, topic, unit?, count?, marks?} asks the local model; drafts arrive pending
    GET    /api/mission/pyq/drafts               R-51 ?subject=&status= the drafts on file, newest first
    PATCH  /api/mission/pyq/drafts/{did}         R-52 {status: accepted|rejected, text?, marks?, unit?, topic?}
    GET    /api/mission/pyq/settings             R-35 {rules_only}
    PUT    /api/mission/pyq/settings             R-35 {rules_only: bool}: on means the model is never asked

The model only drafts: a draft is pending until he accepts it with marks, and the question it becomes says it was drafted by
the model. The notes it reads are his own (the Markdown notes of his Classroom files for that subject); nothing leaves the
PC, because the model is the local one on loopback (ww_counsel). The order of topics is not asked of the model: that is R-17.
Every answer is the {state, reason, source, ...} envelope of ww_pyq/api.py.
"""
from __future__ import annotations

from typing import Optional

from fastapi import Body, FastAPI, HTTPException
from starlette.concurrency import run_in_threadpool

from .ww_pyq import api, drafts, settings, tag
from .ww_pyq import store as store_mod

SOURCE = "the local model, from your notes"
MAX_NOTES = 400                    # notes of one subject read for passages: 617 notes are on file across 32 courses
MAX_NOTE_CHARS = 200_000


def notes_of(subject: str) -> list[dict]:
    """His Classroom notes of one subject: [{file_id, title, text}]. Read from the files the sync already wrote."""
    from .ww_gcr import sync as gsync
    store = gsync.GcrStore()
    try:
        m = store.manifest()
    except gsync.ManifestError:
        return []
    out = []
    for fid, r in m["files"].items():
        subj = (m["courses"].get(r.get("course"), {}) or {}).get("subject") or r.get("subject") or ""
        if str(subj).lower() != subject or not r.get("note") or r.get("note_state") != "live":
            continue
        try:
            text = (store.root / r["note"]).read_text(encoding="utf-8")[:MAX_NOTE_CHARS]
        except OSError:
            continue
        if text.startswith("---"):                              # the note's small header is not part of the notes
            end = text.find("\n---", 3)
            text = text[end + 4:] if end > 0 else text
        out.append({"file_id": fid, "title": r.get("title") or r.get("name") or "", "text": text})
        if len(out) >= MAX_NOTES:
            break
    return out


def register(app: FastAPI, svc, bus) -> None:
    def store():
        return store_mod.default_store()

    def subject_of(name) -> dict:
        p = getattr(svc, "plan", None)
        if p is None:
            raise HTTPException(503, "the plan store is not up yet")
        if not isinstance(name, str) or not name.strip():
            raise ValueError("Say which subject.")
        want = name.strip().lower()
        for s in (p.academics() or {}).get("subjects") or []:
            if str(s.get("id") or "").lower() == want:
                return s
        raise KeyError("No such subject.")

    def ocr_running() -> bool:
        job = getattr(app.state, "pyq_ocr", None)
        return bool(job is not None and job.running())

    @app.post("/api/mission/pyq/drafts/from-notes")
    async def drafts_from_notes(body: dict = Body(...)):
        def work():
            sub = subject_of(body.get("subject"))
            sid = str(sub["id"]).lower()
            topic = body.get("topic")
            if not isinstance(topic, str) or not topic.strip():
                raise ValueError("Say which topic.")
            topics = tag.topics_of(sub)
            hit = [t for t in topics if t["topic"].strip().lower() == topic.strip().lower()
                   and (body.get("unit") is None or t["unit"] == body.get("unit"))]
            if not hit:
                raise ValueError("That topic is not in the syllabus of this subject.")
            t = hit[0]
            title = next((str(u.get("title") or "") for u in sub.get("units") or [] if u.get("n") == t["unit"]), "")
            r = drafts.draft_from_notes(store(), subject=sid, topic=t["topic"], unit=t["unit"], unit_title=title,
                                        count=body.get("count", 3), marks=body.get("marks"), notes=notes_of(sid),
                                        provider=getattr(app.state, "pyq_draft_provider", None), ocr_running=ocr_running)
            return api.items(r["items"], r["state"], r["reason"], SOURCE)
        return await run_in_threadpool(api.guard, work)

    @app.get("/api/mission/pyq/drafts")
    async def drafts_list(subject: Optional[str] = None, status: Optional[str] = None):
        def work():
            sid = str(subject_of(subject)["id"]).lower() if subject else None
            rows = drafts.list_drafts(store(), sid, status)
            if not rows:
                return api.items([], "waiting", "No draft on file.", SOURCE)
            n = sum(1 for d in rows if d["status"] == "pending")
            return api.items(rows, "live", f"{n} {'draft is' if n == 1 else 'drafts are'} waiting for your review.", SOURCE)
        return await run_in_threadpool(api.guard, work)

    @app.patch("/api/mission/pyq/drafts/{did}")
    async def drafts_decide(did: str, body: dict = Body(...)):
        def work():
            def topic_ok(unit, topic: str) -> bool:
                d = next((x for x in drafts.list_drafts(store()) if x["id"] == did), None)
                if d is None:
                    return True                                  # decide() answers 404 itself
                names = {(t["unit"], t["topic"].strip().lower()) for t in tag.topics_of(subject_of(d["subject"]))}
                return (unit, topic.strip().lower()) in names
            r = drafts.decide(store(), did, body, topic_ok)
            if r["question"] is not None:
                return api.ok("live", "Accepted: it is a question of your bank now, marked as drafted by the model.", SOURCE, **r)
            return api.ok("live", "Rejected: it stays on file as rejected.", SOURCE, **r)
        return await run_in_threadpool(api.guard, work)

    def settings_answer() -> dict:
        s = settings.load(store())
        return api.ok("live", "Rules only: the model is never asked." if s["rules_only"] else "The local model may draft; every draft waits for you.",
                      "your settings", settings=s)

    @app.get("/api/mission/pyq/settings")
    async def settings_get():
        return await run_in_threadpool(api.guard, settings_answer)

    @app.put("/api/mission/pyq/settings")
    async def settings_put(body: dict = Body(...)):
        def work():
            if set(body) != {"rules_only"}:
                raise ValueError("Send {rules_only: true or false}.")
            settings.save(store(), body["rules_only"])
            return settings_answer()
        return await run_in_threadpool(api.guard, work)
