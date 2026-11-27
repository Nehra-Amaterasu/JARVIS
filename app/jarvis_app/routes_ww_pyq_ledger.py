"""/api/mission/pyq/ledger: per topic, what is on file, every number counted from files (ww_pyq/ledger.py, plan 9.0 N02).

    GET    /api/mission/pyq/ledger?subject=                              R-60 one row per syllabus topic, its holes and the totals
    GET    /api/mission/pyq/ledger/attempts?subject=&topic=&from=&to=    R-61 every mark on file, newest first
    GET    /api/mission/pyq/ledger/pace?subject=                         R-62 topics left and the rate, plain division over his last days with a mark

This file only gathers the inputs; the counting is ww_pyq/ledger.py. The subject and its syllabus come from svc.plan
(503 until routes_mission sets it; unknown 404, missing 400), the questions and papers from the pyq store, his notes from
routes_ww_pyq_drafts.notes_of (the Classroom notes R-50 reads), the marks from two files: the evening sheets N01 writes
(<pyq store>/sheets/<id>.json) and attempts.jsonl, where R-27 appends each mark typed on a generated paper (the topic is
read from that paper's seat in generated/<id>.json). R-27 also adds each mark to the plan's paper_marks; that copy is not
read, so a mark is counted once. A sheet file that does not parse is left out and named in `skipped`, never a crash.
The paper date for R-62 is the nearest paper of the subject today or later on the date sheet (ww_engines inputs).
Every answer is {state, reason, source, ...}; nothing here forecasts a mark or a result.
"""
from __future__ import annotations

import json
import re
from datetime import date
from pathlib import Path
from typing import Optional

from fastapi import FastAPI, HTTPException, Query
from starlette.concurrency import run_in_threadpool

from . import routes_ww_pyq_drafts as _drafts_routes
from .ww_pyq import api, ledger, tag
from .ww_pyq import generate as gen
from .ww_pyq import store as store_mod

SOURCE = "your notes, papers and marks on file"
SOURCE_MARKS = "the marks you typed"
_GID = re.compile(r"^g-[0-9a-f]{12}$")          # generate.py's id form: only these lines of attempts.jsonl are papers
_MAX_SHEETS = 2000                              # five years of evenings; a folder larger than that is not his sheets


def _store():
    return store_mod.default_store()


def _today() -> str:
    return date.today().isoformat()


def notes_of(subject: str) -> list[dict]:
    return _drafts_routes.notes_of(subject)


def exams() -> list[dict]:
    from . import ww_engines
    return list(ww_engines.load_inputs().get("exams") or [])


def read_sheets(st) -> tuple[list[dict], list[dict]]:
    """Every sheets/<id>.json that parses as a sheet: [{file, sheet}], and the ones left out with the reason."""
    folder = Path(st.root) / "sheets"
    out, skipped = [], []
    files = sorted(folder.glob("*.json")) if folder.is_dir() else []
    # past the cap the oldest are left out (ids start with the date, so name order is day order) and named, so the
    # marks of this week are never the ones dropped
    for f in files[:-_MAX_SHEETS] if len(files) > _MAX_SHEETS else []:
        skipped.append({"file": f.name, "reason": f"Only the newest {_MAX_SHEETS} sheet files are read; this older one was left out."})
    for f in files[-_MAX_SHEETS:]:
        try:
            sh = json.loads(f.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            skipped.append({"file": f.name, "reason": "This sheet file does not read as JSON; it was left out."})
            continue
        if (not isinstance(sh, dict) or sh.get("id") != f.stem or not isinstance(sh.get("items"), list)
                or not isinstance(sh.get("marks", []), list)):
            skipped.append({"file": f.name, "reason": "This file is not a sheet (id, items and marks); it was left out."})
            continue
        out.append({"file": f.name, "sheet": sh})
    return out, skipped


def read_paper_marks(st) -> tuple[list[dict], dict]:
    """attempts.jsonl and the generated papers its lines name (None for a paper no longer on file)."""
    lines = gen.read_attempts(st)
    papers: dict = {}
    for a in lines:
        pid = a.get("paper_id")
        if isinstance(pid, str) and _GID.match(pid) and pid not in papers:
            try:
                papers[pid] = gen.load_generated(st, pid)
            except KeyError:
                papers[pid] = None
    return lines, papers


def _skipped_note(skipped: list[dict]) -> str:
    n = len({s["file"] for s in skipped})
    return f" {n} {'file' if n == 1 else 'files'} had something that could not be read; see skipped." if n else ""


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

    def marks_of(st, sid: str) -> tuple[list[dict], list[dict]]:
        sheets, skipped = read_sheets(st)
        a, s1 = ledger.sheet_rows(sheets, sid)
        lines, papers = read_paper_marks(st)
        b, s2 = ledger.paper_rows(lines, papers, sid)
        return ledger.newest_first(a + b), skipped + s1 + s2

    # ------------------------------------------------------------------ R-60
    @app.get("/api/mission/pyq/ledger")
    async def get_ledger(subject: Optional[str] = None):
        def work():
            sub = subject_of(subject)
            sid = str(sub["id"]).lower()
            topics = tag.topics_of(sub)
            st = _store()
            rows, skipped = marks_of(st, sid)
            titles = {u.get("n"): str(u.get("title") or "") for u in sub.get("units") or []}
            led = ledger.build_ledger(topics, st.list_questions(subject=sid), st.list_papers(sid), notes_of(sid) if topics else [],
                                      rows, titles)
            t = led["totals"]
            if not topics:
                state, reason = "waiting", "This subject has no syllabus topics yet."
            elif not (t["with_notes"] or t["with_past_question"] or t["practised"]):
                state, reason = "waiting", "Nothing on file for this subject yet: no note mentions a topic, no past question, no mark."
            else:
                state, reason = "live", ledger.ledger_sentence(led)
            return api.items(led["items"], state, reason + _skipped_note(skipped), SOURCE,
                             holes=led["holes"], totals=t, skipped=skipped)
        return await run_in_threadpool(api.guard, work)

    # ------------------------------------------------------------------ R-61
    @app.get("/api/mission/pyq/ledger/attempts")
    async def get_attempts(subject: Optional[str] = None, topic: Optional[str] = None,
                           frm: Optional[str] = Query(None, alias="from"), to: Optional[str] = None):
        def work():
            sub = subject_of(subject)
            sid = str(sub["id"]).lower()
            lo, hi = ledger.parse_day(frm, "from"), ledger.parse_day(to, "to")
            rows, skipped = marks_of(_store(), sid)
            key = None
            if topic is not None and str(topic).strip():
                want = str(topic).strip()
                keys = {t["key"] for t in tag.topics_of(sub)} | {r["topic_key"] for r in rows}
                names: dict[str, list[str]] = {}
                for t in tag.topics_of(sub):
                    names.setdefault(t["topic"].lower(), []).append(t["key"])
                # a name two units share ("introduction") is not guessed: the marks of the other unit would be hidden
                found = [want] if want in keys else names.get(want.lower()) or []
                if len(found) > 1:
                    raise ValueError(f"That topic is in more than one unit; send its key: {', '.join(found)}.")
                if not found:
                    raise KeyError("No such topic in this subject.")
                key = found[0]
            out = ledger.filter_rows(rows, key, lo, hi)
            if not out:
                return api.items(out, "waiting", "No mark on file for this choice." + _skipped_note(skipped), SOURCE_MARKS, skipped=skipped)
            got, mx = sum(r["got"] for r in out), sum(r["max"] for r in out)
            reason = f"{len(out)} {'mark' if len(out) == 1 else 'marks'} on file: {got:g} of {mx:g}."
            return api.items(out, "live", reason + _skipped_note(skipped), SOURCE_MARKS, skipped=skipped)
        return await run_in_threadpool(api.guard, work)

    # ------------------------------------------------------------------ R-62
    @app.get("/api/mission/pyq/ledger/pace")
    async def get_pace(subject: Optional[str] = None):
        def work():
            sub = subject_of(subject)
            sid = str(sub["id"]).lower()
            keys = [t["key"] for t in tag.topics_of(sub)]
            rows, skipped = marks_of(_store(), sid)
            p = ledger.build_pace(keys, rows, exams(), sid, _today())
            if not keys:
                return api.ok("waiting", "This subject has no syllabus topics yet.", SOURCE_MARKS, skipped=skipped, **p)
            state = "live" if p["days_counted"] else "waiting"
            return api.ok(state, p["sentence"] + _skipped_note(skipped), SOURCE_MARKS, skipped=skipped, **p)
        return await run_in_threadpool(api.guard, work)
