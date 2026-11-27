"""/api/mission/evidence: the evidence ledger, one dated line a proof (ww_evidence.py, plan 9.0 wave EW10, package KA).

    GET    /api/mission/evidence?node=&kind=&from=&to=     K-01 every line newest first, totals by kind, and xp_check
    POST   /api/mission/evidence                           K-02 file one line {kind, title, link?, file?, node_ids?, at?}
    DELETE /api/mission/evidence/{eid}                     K-03 mark a line removed; it stays on file and leaves every count
    POST   /api/mission/evidence/import-commits            K-04 one line a commit from his work_repos, local git only

The ledger file is <data>/evidence/evidence.jsonl; a file named in K-02 must lie inside <data> (paths.DATA). The repository
paths come from his inputs (ww_engines.load_inputs, `work_repos`); the request body only chooses among their names. xp_check
reads the plan state through svc.plan and prints the plan's XP for certificates, projects and ships beside what the evidence
rule grants the same records, and changes neither. Every answer is {state, reason, source, ...}; an unknown id or name is 404,
a bad value 400, a second import while one runs 409. Nothing here contacts the network.
"""
from __future__ import annotations

from datetime import date
from typing import Any, Optional

from fastapi import Body, FastAPI, Query
from starlette.concurrency import run_in_threadpool

from . import ww_engines
from . import ww_evidence as E
from .ww_pyq import api

SOURCE = "your evidence ledger"
SOURCE_GIT = "your local git repositories"
_LEDGER: list[E.Ledger] = []


def _ledger() -> E.Ledger:
    if not _LEDGER:
        _LEDGER.append(E.Ledger())
    return _LEDGER[0]


def _inputs() -> dict:
    return ww_engines.load_inputs()


def _today() -> str:
    return date.today().isoformat()


def _plural(n: int, one: str, many: str) -> str:
    return f"{n} {one if n == 1 else many}"


def _skipped_note(skipped: list[dict]) -> str:
    return f" {_plural(len(skipped), 'line', 'lines')} on file could not be read and were left out." if skipped else ""


def _what(v: dict) -> str:
    return f"the {v['kind']} line of {v['at']}, \"{v['title'][:80]}\""


def register(app: FastAPI, svc, bus) -> None:
    def plan_state(today: str) -> Optional[dict]:
        p = getattr(svc, "plan", None)
        if p is None:
            return None
        try:
            return p.load(today)
        except Exception:            # a broken plan must not take the ledger down; xp_check then says it has no records
            return None

    # ------------------------------------------------------------------ K-01
    @app.get("/api/mission/evidence")
    async def get_evidence(node: Optional[str] = None, kind: Optional[str] = None,
                           frm: Optional[str] = Query(None, alias="from"), to: Optional[str] = None):
        def work():
            today = _today()
            lo, hi = E.parse_day(frm, "from"), E.parse_day(to, "to")
            want_node = node.strip() if isinstance(node, str) and node.strip() else None
            want_kind = kind.strip() if isinstance(kind, str) and kind.strip() else None
            led = _ledger()
            lines, skipped = led.lines()
            order = {ln["id"]: i for i, ln in enumerate(lines)}
            views = [E.view(ln, led.files) for ln in lines]
            picked = E.newest_first(E.select(views, want_node, want_kind, lo, hi), order)
            t = E.totals(picked)
            active = sum(1 for v in views if not v["removed"])
            shown = sum(1 for v in picked if not v["removed"])
            hard = sum(1 for v in picked if v["hard"] and not v["removed"])
            xp = E.xp_check(plan_state(today), _inputs(), today)
            if not active:
                state, reason = "waiting", "No evidence yet."
            elif not shown:
                state, reason = "live", "No line matches these filters."
            else:
                state = "live"
                reason = f"{_plural(shown, 'line', 'lines')}, {hard} of them hard (a link, or a file still on disk)."
            return api.ok(state, reason + _skipped_note(skipped), SOURCE, items=picked, count=shown,
                          listed=len(picked), totals=t, xp_check=xp, skipped=skipped)
        return await run_in_threadpool(api.guard, work)

    # ------------------------------------------------------------------ K-02
    @app.post("/api/mission/evidence")
    async def post_evidence(body: Any = Body(None)):
        def work():
            led = _ledger()
            ln = led.add(body, _today())
            v = E.view(ln, led.files)
            return api.ok("live", f"Filed: {_what(v)}.", SOURCE, item=v)
        return await run_in_threadpool(api.guard, work)

    # ------------------------------------------------------------------ K-03
    @app.delete("/api/mission/evidence/{eid}")
    async def delete_evidence(eid: str):
        def work():
            led = _ledger()
            ln, now = led.remove(eid, _today())
            v = E.view(ln, led.files)
            if now:
                reason = f"Removed {_what(v)}. It stays on file and is left out of every count."
            else:
                reason = f"{_what(v)[0].upper()}{_what(v)[1:]} was already removed on {v['removed_on']}."
            return api.ok("live", reason, SOURCE, item=v)
        return await run_in_threadpool(api.guard, work)

    # ------------------------------------------------------------------ K-04
    @app.post("/api/mission/evidence/import-commits")
    async def import_commits(body: Any = Body(None)):
        def work():
            if body is not None and not isinstance(body, dict):
                raise ValueError("Send {repos: [name]} or nothing.")
            repos = list(_inputs().get("work_repos") or [])
            if not repos:
                return api.ok("waiting", "No work repositories in your inputs yet: add them under work_repos in Settings.",
                              SOURCE_GIT, added=0, already=0, repos=[])
            out = E.import_commits(_ledger(), repos, (body or {}).get("repos"), _today())
            read = sum(r["commits"] for r in out["repos"])
            reason = (f"{_plural(out['added'], 'commit', 'commits')} added, {out['already']} already on file, from "
                      f"{_plural(read, 'commit', 'commits')} read.")
            unread = [r for r in out["repos"] if r["commits"] == 0]
            if unread:
                reason += f" {_plural(len(unread), 'repository gave', 'repositories gave')} none; each says why."
            return api.ok("live", reason, SOURCE_GIT, **out)
        return await run_in_threadpool(api.guard, work)
