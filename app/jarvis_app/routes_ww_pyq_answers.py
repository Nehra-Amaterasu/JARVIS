"""/api/mission/pyq/tonight/sheets/{sid}/answers: his answers kept beside an evening sheet, and a mark proposed (ww_pyq/answers.py).

    GET    /api/mission/pyq/tonight/sheets/{sid}/answers                              R-78 the answers kept, and the agreement of his accepted proposals
    PUT    /api/mission/pyq/tonight/sheets/{sid}/answers/{qid}                        R-79 {text} what he typed; "corrected" over text read from a picture
    DELETE /api/mission/pyq/tonight/sheets/{sid}/answers/{qid}                        R-79 the answer and its pictures removed
    POST   /api/mission/pyq/tonight/sheets/{sid}/answers/{qid}/photos                 R-80 one JPEG or PNG as the raw body, 10 MB at most, 6 a question
    GET    /api/mission/pyq/tonight/sheets/{sid}/answers/{qid}/photos/{n}             R-81 one picture back
    POST   /api/mission/pyq/tonight/sheets/{sid}/answers/{qid}/read                   R-82 {replace?} the pictures read by OCR, with the engine's mean confidence
    POST   /api/mission/pyq/tonight/sheets/{sid}/answers/{qid}/check                  R-83 a proposal: the rule for a numerical key, else the rubric judged by the model
    POST   /api/mission/pyq/tonight/sheets/{sid}/answers/{qid}/accept                 R-84 {got?, minutes?, out_of?, keep?} the mark, written as R-58 writes it

A question id that is not on the sheet is 404, as an unknown sheet is. A picture's kind is read from its first bytes and
its size is counted while the body arrives, so a body past 10 MB is refused before it is all read (413). R-82 reads one
answer at a time and none while OCR reads a paper, the paper desk reads files, the preparation run goes or a model job
runs (409); with no OCR engine installed it is waiting. R-83 is planned under rules only, waiting with no rubric, 409
while another model job runs, and says so when the text of his answer left this PC for Claude. A proposal is never a
mark: only R-84 writes one, through the check of R-58, into the sheet and the plan's paper_marks. Tests put a fake model
in app.state.pyq_answer_provider and a fake OCR reader in app.state.pyq_answer_ocr. Every JSON answer is the
{state, reason, source, ...} envelope of ww_pyq/api.py.
"""
from __future__ import annotations

from datetime import date, datetime
from typing import Optional

from fastapi import Body, FastAPI, HTTPException, Request
from fastapi.responses import FileResponse
from starlette.concurrency import run_in_threadpool

from .ww_pyq import answers, api, drafts, ocr, prep, tonight
from .ww_pyq import store as store_mod

SOURCE = "your answers on this sheet"
SOURCE_OCR = "OCR on this PC, from your pictures"
SOURCE_RULE = "the numeric check, from the question's key"
SOURCE_MODEL = "the rubric of the question, judged by the model"
SOURCE_MARKS = "the marks you accepted"


def _store():
    return store_mod.default_store()


def _faulted(work):
    """An answer file that is there but broken answers state fault with its sentence, and nothing is written over it."""
    def run():
        try:
            return work()
        except answers.AnswerFileFault as e:
            return api.ok("fault", str(e), SOURCE)
    return run


def _now() -> str:
    return datetime.now().isoformat(timespec="seconds")


def register(app: FastAPI, svc, bus) -> None:
    def plan():
        p = getattr(svc, "plan", None)
        if p is None:
            raise HTTPException(503, "The plan store is not up yet.")
        return p

    def sheet_of(sid: str) -> dict:
        tonight.check_sheet_id(sid)
        return tonight.load_sheet(_store(), sid)

    def running(name: str) -> bool:
        j = getattr(app.state, name, None)
        return bool(j is not None and j.running())

    def machine_busy() -> Optional[str]:
        """The sentence of a job that holds the processor or the model, or None."""
        if running("pyq_ocr"):
            return "OCR is reading a paper; wait for it."
        if running("pyq_ingest"):
            return "The paper desk is reading files; wait for it."
        if running("pyq_prep_job"):
            return "A preparation run is going; wait for it or stop it."
        return None

    def model():
        return prep.model_for(_store(), getattr(app.state, "pyq_answer_provider", None))

    def model_name(m) -> str:
        return m.name if m.mode == "claude" else prep._local_name()

    # ------------------------------------------------------------------ R-78
    @app.get("/api/mission/pyq/tonight/sheets/{sid}/answers")
    async def list_answers(sid: str):
        def work():
            st = _store()
            sheet = sheet_of(sid)
            recs = answers.list_answers(st, sheet)
            agree = answers.agreement(recs)
            rows = [answers.public(r) for r in recs]
            if not rows:
                return api.items([], "waiting", "No answer kept for this sheet yet.", SOURCE, agreement=agree)
            return api.items(rows, "live", f"{len(rows)} of {len(sheet['items'])} questions have an answer kept. "
                             + answers.agreement_sentence(agree), SOURCE, agreement=agree)
        return await run_in_threadpool(api.guard, _faulted(work))

    # ------------------------------------------------------------------ R-79
    @app.put("/api/mission/pyq/tonight/sheets/{sid}/answers/{qid}")
    async def put_answer(sid: str, qid: str, body: dict = Body(...)):
        def work():
            sheet = sheet_of(sid)
            answers.item_of(sheet, qid)
            if not isinstance(body, dict) or set(body) != {"text"}:
                raise ValueError("Send {text}.")
            rec = answers.put_text(_store(), sheet, qid, body["text"], _now())
            said = ("Your correction is kept over the text read from the pictures." if rec["text_status"] == "corrected"
                    else "Your answer is kept.")
            return api.ok("live", said, SOURCE, answer=answers.public(rec))
        return await run_in_threadpool(api.guard, _faulted(work))

    @app.delete("/api/mission/pyq/tonight/sheets/{sid}/answers/{qid}")
    async def delete_answer(sid: str, qid: str):
        def work():
            answers.delete(_store(), sheet_of(sid), qid)
            return api.ok("live", "The answer and its pictures are removed; a mark you accepted stays on the sheet.", SOURCE)
        return await run_in_threadpool(api.guard, _faulted(work))

    # ------------------------------------------------------------------ R-80
    @app.post("/api/mission/pyq/tonight/sheets/{sid}/answers/{qid}/photos")
    async def post_photo(sid: str, qid: str, request: Request):
        await run_in_threadpool(api.guard, lambda: answers.item_of(sheet_of(sid), qid))     # 404 before the body is read
        limit = answers.MAX_PHOTO
        try:
            declared = int(request.headers.get("content-length") or 0)
        except ValueError:
            declared = 0
        if declared > limit:
            raise HTTPException(413, f"A picture is at most {limit // (1024 * 1024)} MB.")
        buf = bytearray()
        async for chunk in request.stream():
            buf.extend(chunk)
            if len(buf) > limit:                       # counted while it arrives: a long body is never held whole
                raise HTTPException(413, f"A picture is at most {limit // (1024 * 1024)} MB.")
            if len(buf) >= 8 and len(buf) - len(chunk) < 8 and answers.photo_kind(bytes(buf[:8])) is None:
                raise HTTPException(400, "That is not a JPEG or PNG picture.")

        def work():
            rec = answers.add_photo(_store(), sheet_of(sid), qid, bytes(buf), _now())
            n = len(rec["photos"])
            return api.ok("live", f"Picture {rec['photos'][-1]['n']} kept ({n} of {answers.MAX_PHOTOS}); it is not read "
                                  "until you ask for it.", SOURCE, answer=answers.public(rec))
        return await run_in_threadpool(api.guard, _faulted(work))

    # ------------------------------------------------------------------ R-81
    @app.get("/api/mission/pyq/tonight/sheets/{sid}/answers/{qid}/photos/{n}")
    async def get_photo(sid: str, qid: str, n: int):
        path, media = await run_in_threadpool(api.guard, lambda: answers.photo_file(_store(), sheet_of(sid), qid, n))
        return FileResponse(path, media_type=media, headers={"Cache-Control": "no-store", "X-Content-Type-Options": "nosniff"})

    # ------------------------------------------------------------------ R-82
    @app.post("/api/mission/pyq/tonight/sheets/{sid}/answers/{qid}/read")
    async def read_answer(sid: str, qid: str, body: Optional[dict] = Body(None)):
        def work():
            b = body or {}
            if not isinstance(b, dict) or set(b) - {"replace"} or not isinstance(b.get("replace", False), bool):
                raise ValueError("Send nothing, or {replace: true}.")
            st = _store()
            sheet = sheet_of(sid)
            answers.item_of(sheet, qid)
            reader = getattr(app.state, "pyq_answer_ocr", None)
            if reader is None:
                if not ocr.installed():
                    rec = answers.load(st, sid, qid)
                    return api.ok("waiting", "The OCR engine is not installed on this PC, so the pictures cannot be read; "
                                             "type the answer instead.", SOURCE_OCR,
                                  answer=None if rec is None else answers.public(rec))
                reader = ocr.read_png
            held = machine_busy()
            if held:
                raise api.Busy(held)
            if drafts._busy.locked():
                raise api.Busy("The model is working on another job; read the pictures when it has finished.")
            r = answers.read(st, sheet, qid, reader, b.get("replace") is True, _now())
            extra = {"ocr_text": r["ocr_text"]} if "ocr_text" in r else {}
            return api.ok(r["state"], r["reason"], SOURCE_OCR, answer=None if r["answer"] is None else answers.public(r["answer"]),
                          faults=r["faults"], **extra)
        return await run_in_threadpool(api.guard, _faulted(work))

    # ------------------------------------------------------------------ R-83
    @app.post("/api/mission/pyq/tonight/sheets/{sid}/answers/{qid}/check")
    async def check_answer(sid: str, qid: str):
        def work():
            st = _store()
            sheet = sheet_of(sid)
            m = model()
            m = m._replace(name=model_name(m))
            r = answers.check(st, sheet, qid, m, machine_busy, _now())
            source = SOURCE_RULE if (r["proposal"] or {}).get("basis") == "number" else SOURCE_MODEL
            rec = answers.load(st, sid, qid)
            return api.ok(r["state"], r["reason"], source, proposal=r["proposal"],
                          answer=None if rec is None else answers.public(rec))
        return await run_in_threadpool(api.guard, _faulted(work))

    # ------------------------------------------------------------------ R-84
    @app.post("/api/mission/pyq/tonight/sheets/{sid}/answers/{qid}/accept")
    async def accept_answer(sid: str, qid: str, body: Optional[dict] = Body(None)):
        def work():
            tonight.check_sheet_id(sid)
            p = plan()
            st = _store()
            r = answers.accept(st, p, sid, qid, body or {}, _now(), date.today().isoformat())
            # keep: his out_of becomes the question's own marks, set by hand, as R-58 does
            kept_marks = []
            for k, out_of in r["keep"].items():
                try:
                    st.update_question(k, {"marks": out_of}, "hand")
                    kept_marks.append(k)
                except (KeyError, ValueError):
                    pass                                   # gone since the sheet was built: the mark itself is kept
            mark, rec = r["mark"], r["answer"]
            said = (f"Saved {mark['got']:g} of {mark['max']:g}"
                    + (", as proposed." if rec["mark_origin"] == "proposal" else ", your own mark.")
                    + (" Your out of is kept as the question's marks." if kept_marks else ""))
            try:
                bus.publish("mission", "update", f"answer mark saved: {mark['got']:g} of {mark['max']:g}"[:140])
            except Exception:
                pass
            return api.ok("live", said, SOURCE_MARKS, mark=mark, mark_origin=rec["mark_origin"], marked_by="you",
                          answer=answers.public(rec), proficiency=r["proficiency"], kept_marks=kept_marks,
                          unmarked=tonight.unmarked(r["sheet"]))
        return await run_in_threadpool(api.guard, _faulted(work))
