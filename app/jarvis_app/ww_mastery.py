"""Sharpen and de-master (Well Wisher plan, Sprint 3 item 8): the two ways back from "mastered".

    mastery(plan, nid)              what each button may do now, and the sentence that says why not
    record_gate_solve(plan, nid, q) file a GATE-tier question the owner solved on this node
    sharpen(plan, nid)              open a round: the node's contracts again, each with a harder check
    finish_sharpen(plan, nid)       close the round: the node is re-proved
    demaster(plan, nid)             take "mastered" off a node, only when nothing above it is

Sharpen needs one GATE-tier question solved on the node, and one more for every further round. The
bank decides what exists (ww_bank_store, tier "gate"), so with no GATE bank on disk the blocker says
exactly that instead of an engine rule it does not have. De-master follows the owner's own rule
(PLAN section 0a, item 5): only when nothing above the node is mastered. The server names the nodes
that stand in the way, nearest first, and which of them can be de-mastered right now. A node that is
merely in progress above it blocks too: it would be left "in progress" with a prerequisite gone.

Both write through the existing plan store (Plan.load, _event, save) under its lock, and both leave a
plan event (kind "node", note "sharpened" / "re-proved" / "de-mastered"), never a silent change.
master_node is not touched. Its +50 XP is taken back by de-master, so master, de-master, master is not
a way to farm XP; sharpen and re-prove give no XP for the same reason.

Pure helpers (blockers, harder_check) take plain dicts, so the tests need no store.
"""
from __future__ import annotations

import re
from datetime import date
from typing import Optional

from . import germoney, ww_bank_store

MASTER_XP = 50                       # what Plan._master grants; de-master hands exactly this back
HARDER = 0.75                        # each round allows 3/4 of the time of the one before
MIN_CAP = 5                          # minutes; a cap under this is not a check
CANDIDATES = 8


def _words(text: str) -> set[str]:
    return {w for w in re.findall(r"[a-z0-9]+", text.lower()) if len(w) >= 3}


def gate_questions() -> list[dict]:
    """Every GATE-tier record on disk, light: id, subject, topic, a reference line. Never the stem of a pointer."""
    out: list[dict] = []
    try:
        subjects = list(ww_bank_store.counts()["subjects"])
    except OSError:
        return out
    for s in subjects:
        for r in ww_bank_store.all_records(s):
            if r.get("tier") == "gate":
                out.append({"id": r["id"], "subject": s, "topic": r.get("topic") or "", "ref": r.get("ref") or r.get("source") or "",
                            "source": r.get("source") or ""})
    return out


def candidates(node: dict, questions: list[dict], solved: set[str]) -> list[dict]:
    """GATE questions to solve for a node: those whose topic shares a word with its name or branch first."""
    mine = _words(f"{node.get('name', '')} {node.get('branch', '')}")
    rows = [{**q, "matched": bool(mine & _words(q["topic"]))} for q in questions if q["id"] not in solved]
    rows.sort(key=lambda q: (not q["matched"], q["subject"], q["id"]))
    return rows[:CANDIDATES]


def dependents_of(bank: dict, nid: str) -> list[tuple[str, int]]:
    """Everything above a node, with its distance (1 = directly depends on it), nearest first."""
    kids: dict[str, list[str]] = {}
    for k, n in bank["nodes"].items():
        for p in n["prereqs"]:
            kids.setdefault(p, []).append(k)
    seen = {nid}
    out: list[tuple[str, int]] = []
    frontier = [nid]
    d = 0
    while frontier:
        d += 1
        nxt: list[str] = []
        for u in frontier:
            for k in kids.get(u, []):
                if k not in seen:
                    seen.add(k)
                    nxt.append(k)
                    out.append((k, d))
        frontier = nxt
    return out


def blockers(bank: dict, st: dict, nid: str) -> list[dict]:
    """The nodes above `nid` that are mastered or in progress, nearest first, each with `now`: can it be de-mastered right now
    (mastered, and nothing above it is mastered or in progress)."""
    held = {k: germoney.node_status(bank, st, k) for k, _ in dependents_of(bank, nid)}
    held = {k: s for k, s in held.items() if s in ("mastered", "in_progress")}
    rows = []
    for k, dist in dependents_of(bank, nid):
        if k not in held:
            continue
        above = [j for j, _ in dependents_of(bank, k) if j in held]
        rows.append({"id": k, "name": bank["nodes"][k]["name"], "status": held[k], "distance": dist,
                     "now": held[k] == "mastered" and not above})
    return rows


def harder_check(node: dict, rounds_done: int) -> dict:
    """What round `rounds_done + 1` asks: the node's contracts again, cold, inside a shrinking time cap."""
    n = rounds_done + 1
    items = []
    for c in node.get("contracts") or []:
        minutes = int(c.get("minutes") or 30)
        cap = max(MIN_CAP, int(minutes * HARDER ** n))
        base = (c.get("success_check") or c.get("title") or "").strip()
        items.append({"contract": c["id"], "title": c.get("title") or c["id"], "minutes": minutes, "cap_minutes": cap,
                      "success_check": base,
                      "harder": f"Cold: no resource open, inside {cap} min (it took {minutes}), then say why it works. {base}".strip()})
    return {"round": n, "items": items,
            "rule": f"Round {n}: each check is repeated from memory inside {int(HARDER ** n * 100)} % of its first time, "
                    "after one more GATE-tier question solved on this node."}


def _rec(st: dict, nid: str) -> dict:
    return st["nodes"].setdefault(nid, {})


def mastery(plan: germoney.Plan, nid: str, today: Optional[str] = None) -> dict:
    """The state of both buttons. KeyError for an unknown node (the route turns it into a 404)."""
    today = today or date.today().isoformat()
    with plan._lock:
        bank = plan.bank()
        if nid not in bank["nodes"]:
            raise KeyError(nid)
        st = plan.load(today)
        node = bank["nodes"][nid]
        status = germoney.node_status(bank, st, nid)
        rec = st["nodes"].get(nid) or {}
        solves = [g for g in rec.get("gate") or [] if isinstance(g, dict)]
        rounds = int(rec.get("sharpen_rounds") or 0)
        active = bool((rec.get("sharpen") or {}).get("active"))
        gate = gate_questions()
        solved_ids = {g.get("q") for g in solves}
        spare = len(solves) - rounds                    # solves not yet spent on a round
        why: Optional[str] = None
        if status != "mastered":
            why = f"Only a mastered node can be sharpened; this one is {status.replace('_', ' ')}."
        elif active:
            why = "A sharpen round is already open on this node. Finish it first."
        elif not gate:
            why = "Sharpen needs one GATE-tier question solved on this node. No GATE bank yet: the question harvester has fetched none."
        elif spare <= 0:
            why = (f"Sharpen needs one GATE-tier question solved on this node. {len(gate)} GATE-tier "
                   f"question{'s are' if len(gate) != 1 else ' is'} on disk; solve one and record it here.")
        block = blockers(bank, st, nid) if status == "mastered" else []
        dm_why: Optional[str] = None
        if status != "mastered":
            dm_why = f"Only a mastered node can be de-mastered; this one is {status.replace('_', ' ')}."
        elif block:
            first = [b["name"] for b in block if b["now"]]
            held = ", ".join(b["name"] for b in block)
            dm_why = (f"{held} {'is' if len(block) == 1 else 'are'} above it and "
                      f"{'is' if len(block) == 1 else 'are'} mastered or in progress."
                      + (f" De-master {', '.join(first)} first." if first else " Pause what is in progress, then de-master from the top."))
        return {
            "node": nid, "name": node["name"], "status": status, "gate_bank": len(gate),
            "sharpen": {"allowed": why is None, "blocker": why, "round": rounds, "active": active,
                        "check": (rec.get("sharpen") or {}).get("check") if active else None,
                        "next": harder_check(node, rounds) if status == "mastered" and node.get("contracts") else None,
                        "solved": solves, "spare": max(0, spare), "reproved": int(rec.get("reproved") or 0),
                        "candidates": candidates(node, gate, solved_ids) if status == "mastered" and why else []},
            "demaster": {"allowed": dm_why is None, "blocker": dm_why, "blockers": block,
                         "first": [b["id"] for b in block if b["now"]], "xp_back": MASTER_XP},
        }


def record_gate_solve(plan: germoney.Plan, nid: str, question_id: str, today: Optional[str] = None) -> dict:
    today = today or date.today().isoformat()
    with plan._lock:
        bank = plan.bank()
        if nid not in bank["nodes"]:
            raise KeyError(nid)
        st = plan.load(today)
        if germoney.node_status(bank, st, nid) != "mastered":
            return {"ok": False, "say": "Only a mastered node takes a GATE solve; this one is not mastered."}
        q = next((x for x in gate_questions() if x["id"] == question_id), None)
        if q is None:
            return {"ok": False, "say": "That is not a GATE-tier question in the bank."}
        rec = _rec(st, nid)
        have = [g for g in rec.get("gate") or [] if isinstance(g, dict)]
        if any(g.get("q") == question_id for g in have):
            return {"ok": True, "say": "Already recorded for this node."}
        have.append({"q": question_id, "ref": q["ref"], "topic": q["topic"], "at": today})
        rec["gate"] = have
        plan.save(st)
    return {"ok": True, "say": f"Recorded: GATE question {q['ref'] or q['topic']} solved on {bank['nodes'][nid]['name']}."}


def sharpen(plan: germoney.Plan, nid: str, today: Optional[str] = None) -> dict:
    today = today or date.today().isoformat()
    with plan._lock:
        now = mastery(plan, nid, today)
        if not now["sharpen"]["allowed"]:
            return {"ok": False, "say": now["sharpen"]["blocker"], "blocker": now["sharpen"]["blocker"]}
        bank = plan.bank()
        st = plan.load(today)
        node = bank["nodes"][nid]
        rec = _rec(st, nid)
        check = harder_check(node, int(rec.get("sharpen_rounds") or 0))
        rec["sharpen_rounds"] = check["round"]
        rec["sharpen"] = {"active": True, "round": check["round"], "since": today, "check": check}
        plan._event(st, today, "node", node=nid, note="sharpened", round=check["round"])
        plan.save(st)
    return {"ok": True, "round": check["round"], "check": check,
            "say": f"{node['name']}: sharpen round {check['round']} is open. Same contracts, a harder check."}


def finish_sharpen(plan: germoney.Plan, nid: str, today: Optional[str] = None) -> dict:
    today = today or date.today().isoformat()
    with plan._lock:
        bank = plan.bank()
        if nid not in bank["nodes"]:
            raise KeyError(nid)
        st = plan.load(today)
        rec = _rec(st, nid)
        cur = rec.get("sharpen") or {}
        if not cur.get("active"):
            return {"ok": False, "say": "No sharpen round is open on this node."}
        rec["sharpen"] = {**cur, "active": False, "done": today}
        rec["reproved"] = int(rec.get("reproved") or 0) + 1
        plan._event(st, today, "node", node=nid, note="re-proved", round=cur.get("round"))
        plan.save(st)
    return {"ok": True, "say": f"{bank['nodes'][nid]['name']} re-proved at round {cur.get('round')}."}


def demaster(plan: germoney.Plan, nid: str, today: Optional[str] = None) -> dict:
    today = today or date.today().isoformat()
    with plan._lock:
        now = mastery(plan, nid, today)
        if not now["demaster"]["allowed"]:
            return {"ok": False, "say": now["demaster"]["blocker"], "blocker": now["demaster"]["blocker"],
                    "blockers": now["demaster"]["blockers"], "first": now["demaster"]["first"]}
        bank = plan.bank()
        st = plan.load(today)
        rec = _rec(st, nid)
        rec.pop("mastered", None)
        rec["status"] = "available"
        rec["demastered"] = int(rec.get("demastered") or 0) + 1
        rec["last"] = today
        rec.pop("sharpen", None)
        back = min(MASTER_XP, int(st.get("xp") or 0))
        st["xp"] = int(st.get("xp") or 0) - back
        plan._event(st, today, "node", node=nid, note="de-mastered", xp_back=back)
        st["days"].pop(today, None)                     # today's plan is rebuilt with the node open again
        plan.save(st)
    name = bank["nodes"][nid]["name"]
    return {"ok": True, "xp": st["xp"], "xp_back": back,
            "say": f"{name} is open again. The {back} XP from mastering it is taken back so mastering it a second time does not count twice."}

