"""Career engine: skill-tree progress + career deadlines -> the ranked next career action.

    career(inputs, today, nodes=None, applications=None, n=5) -> dict

What counts as a career item: a deadline whose kind is a career kind (internship,
gsoc, ms, application, research), an application in the pipeline that is still
open, and a dated goal of a career kind with nothing else standing for it. Each
gets a score

    urgency(days left) x (1 + share of what it asks for that is not mastered yet) x kind weight

and one concrete next step from a fixed template (by kind, days left and pipeline
status), with the facts behind it: days left, the goal it serves, the nodes it
asks for and their status. Exams are not career items; one coming soon is listed
as a gate. Pure: no I/O, the arguments are never changed.
"""
from __future__ import annotations

import re
from typing import Optional

from .ww_base import EngineSpec, days_between, plural, urgency

CAREER_KINDS = ("internship", "gsoc", "ms", "application", "research")
# How much each kind weighs against another at equal urgency. A design choice, stated:
# an internship or programme is near and pays; an MS application is far and has a long runway.
KIND_WEIGHT = {"internship": 1.0, "gsoc": 0.9, "application": 0.9, "research": 0.9, "ms": 0.8}
OPEN_STATUSES = ("idea", "preparing", "applied", "interview")
_TOK = re.compile(r"[a-z0-9]{4,}")


def _tokens(s: str) -> set[str]:
    return set(_TOK.findall((s or "").lower())) - {"with", "from", "close", "closes", "window", "deadline", "date", "verify"}


def next_step(kind: str, days_left: int, status: Optional[str] = None, prep: Optional[list[dict]] = None) -> str:
    """The one concrete step for an item, from fixed templates."""
    if status == "applied":
        return "Wait for the answer; note the date you applied and when to follow up"
    if status == "interview":
        return "Prepare the interview: three stories about your projects, each under two minutes"
    todo = [p for p in prep or [] if not p.get("done")]
    if todo and days_left >= 0:
        return f"Next prep step: {todo[0].get('title') or todo[0].get('id')} ({len(prep) - len(todo)} of {len(prep)} done)"
    if kind == "gsoc":
        return ("Pick one organisation and land one merged pull request before proposals open" if days_left > 30
                else "Write the proposal draft and send it to a mentor for comments")
    if kind == "ms":
        if days_left > 365:
            return "Keep the grades and the proof list growing; read each programme's requirement page once"
        if days_left > 120:
            return "Book the language test and list every document each programme asks for"
        return "Write the statement of purpose and order the transcripts"
    if days_left <= 3:
        return "Submit it: the form, the documents, a last read-through"
    if days_left <= 21:
        return "Finish the application: the form, the documents, one check by someone else"
    return "Draft the application: list what it asks for and write one paragraph on why you"


def _merge_key(title: str, d: str) -> tuple[str, frozenset]:
    return d, frozenset(_tokens(title))


def career(inputs: dict, today: str, nodes: Optional[list[dict]] = None, applications: Optional[list[dict]] = None, n: int = 5) -> dict:
    node_by = {x["id"]: x for x in nodes or [] if isinstance(x, dict) and x.get("id")}
    skills = inputs.get("skills") or {}
    goals = [g for g in inputs.get("goals") or [] if g.get("deadline") and g["deadline"] >= today]
    items: list[dict] = []

    def add(it: dict) -> None:
        d, toks = _merge_key(it["title"], it["date"])
        for o in items:                               # the same thing from two sources: keep the one with a status
            od, otoks = _merge_key(o["title"], o["date"])
            if od == d and toks & otoks:
                if it.get("status") and not o.get("status"):
                    o.update({k: v for k, v in it.items() if k not in ("id",)}, ids=o["ids"] + [it["id"]])
                else:
                    o["ids"].append(it["id"])
                o["asks"] = sorted(set(o["asks"]) | set(it["asks"]))
                return
        items.append({**it, "ids": [it["id"]]})

    for a in applications or []:
        if not isinstance(a, dict) or a.get("status") not in OPEN_STATUSES or not a.get("closes") or a["closes"] < today:
            continue
        add({"id": str(a.get("id")), "title": " · ".join(x for x in (a.get("org"), a.get("programme")) if x) or str(a.get("id")),
             "date": a["closes"], "kind": a.get("kind") if a.get("kind") in CAREER_KINDS else "internship", "source": "application",
             "status": a["status"], "prep": [p for p in a.get("prep") or [] if isinstance(p, dict)],
             "asks": [str(x) for x in a.get("linked_nodes") or []]})
    for dl in inputs.get("deadlines") or []:
        if dl["kind"] in CAREER_KINDS and dl["date"] >= today:
            add({"id": dl["id"], "title": dl["title"], "date": dl["date"], "kind": dl["kind"], "source": "deadline",
                 "status": None, "prep": [], "asks": list(dl.get("skills") or [])})
    covered = {k for it in items for k in (it["kind"],)}
    for g in goals:                                   # a career goal with no deadline standing for it is an item itself
        if g["kind"] in CAREER_KINDS and g["kind"] not in covered:
            add({"id": g["id"], "title": g["title"], "date": g["deadline"], "kind": g["kind"], "source": "goal",
                 "status": None, "prep": [], "asks": list(g.get("skills") or [])})

    gates = [{"id": dl["id"], "title": dl["title"], "date": dl["date"], "days_left": days_between(today, dl["date"])}
             for dl in inputs.get("deadlines") or [] if dl["kind"] == "exam" and 0 <= days_between(today, dl["date"]) <= 21]

    ranked = []
    for it in items:
        left = days_between(today, it["date"])
        asked = []
        for a in it["asks"]:
            if a in node_by:
                asked.append({"id": a, "name": node_by[a].get("name") or a, "status": node_by[a].get("status") or "unknown"})
            elif a in skills:
                s = skills[a]
                asked.append({"id": a, "name": s["name"], "status": "at target" if s["level"] >= s["target"] else
                              f"level {s['level']:g} of {s['target']:g}"})
        open_asks = [x for x in asked if x["status"] not in ("mastered", "at target")]
        gap = len(open_asks) / len(asked) if asked else 0.0
        score = urgency(left) * (1 + gap) * KIND_WEIGHT.get(it["kind"], 0.8) * (0.2 if it.get("status") == "applied" else 1)
        serves = next((g for g in sorted(goals, key=lambda g: (g["deadline"], g["id"]))
                       if g["kind"] == it["kind"] and g["deadline"] >= it["date"] and g["id"] not in it["ids"]), None)
        why = [f"closes in {plural(left, 'day')} ({it['date']})"]
        if serves:
            why.append(f"serves {serves['title']} (by {serves['deadline']})")
        if open_asks:
            why.append("asks for " + ", ".join(f"{x['name']} ({x['status']})" for x in open_asks[:3]))
        step = next_step(it["kind"], left, it.get("status"), it.get("prep"))
        if it["source"] == "goal" and it["kind"] != "ms":
            step = "No dated application stands for this goal yet: add one to the pipeline with its closing date"
        if open_asks and not it.get("prep") and it.get("status") != "applied":
            step = f"{step}. First node: {open_asks[0]['name']}"
        ranked.append({"id": it["ids"][0], "ids": it["ids"], "title": it["title"], "kind": it["kind"], "source": it["source"],
                       "date": it["date"], "days_left": left, "score": round(score, 4), "status": it.get("status"),
                       "action": step, "why": "; ".join(why), "asks": asked, "serves": serves["id"] if serves else None})
    ranked.sort(key=lambda r: (-r["score"], r["date"], r["id"]))
    if ranked and gates and gates[0]["days_left"] <= 7:        # said once, on the step that would come first
        ranked[0]["why"] += f"; an exam comes first: {gates[0]['title']} in {plural(gates[0]['days_left'], 'day')}"

    unlocks = None
    if node_by:
        count: dict[str, dict] = {}
        for r in ranked:
            for x in r["asks"]:
                if x["id"] in node_by and x["status"] != "mastered":
                    count.setdefault(x["id"], {"asked_by": [], "unlocks": 0})["asked_by"].append(r["id"])
        for nid, node in node_by.items():
            for p in node.get("prereqs") or []:
                if p in node_by and node_by[p].get("status") != "mastered":
                    count.setdefault(p, {"asked_by": [], "unlocks": 0})["unlocks"] += 1
        if count:
            best = min(count, key=lambda k: (-(2 * len(count[k]["asked_by"]) + count[k]["unlocks"]), k))
            unlocks = {"id": best, "name": node_by[best].get("name") or best, "status": node_by[best].get("status"), **count[best]}

    top = ranked[:max(0, n)]
    nxt = top[0] if top else None
    say = (f"Next career step: {nxt['action']}, for {nxt['title']}. {plural(nxt['days_left'], 'day')} left."
           if nxt else "No career deadline is ahead in the inputs, so there is no career step to rank.")
    return {"engine": "career", "version": 1, "status": "ok", "date": today, "actions": top, "next": nxt, "say": say,
            "gates": gates, "unlocks_most": unlocks,
            "counted": {"items": len(ranked), "applications": sum(1 for r in ranked if r["source"] == "application"),
                        "deadlines": sum(1 for r in ranked if r["source"] == "deadline"),
                        "goals": sum(1 for r in ranked if r["source"] == "goal")}}


_DATED = {"type": "dict", "required": {"id": {"type": "str"}, "title": {"type": "str"}, "kind": {"type": "str"}}}
ENGINE = EngineSpec(
    name="career", version=1, fn=career,
    about="Ranks career deadlines (internships, GSoC, MS applications) by urgency and the skill-tree nodes they still need.",
    needs=("deadlines", "goals", "skills", "skill-tree node statuses", "applications pipeline"),
    inputs={"deadlines": {"type": "list", "items": {**_DATED, "required": {**_DATED["required"], "date": {"type": "date"}}}},
            "goals": {"type": "list", "items": {**_DATED, "required": {**_DATED["required"],
                                                                       "deadline": {"type": "date", "optional": True}}}},
            "skills": {"type": "dict", "values": {"type": "dict", "required": {"level": {"type": "num"}, "target": {"type": "num"}}}}},
    data={"nodes": {"type": "list", "items": {"type": "dict", "required": {"id": {"type": "str"}}}},
          "applications": {"type": "list", "items": {"type": "dict", "required": {"id": {"type": "str"}}}}},
)
