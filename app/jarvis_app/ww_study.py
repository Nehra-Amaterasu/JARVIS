"""Study engine: one skill-tree node, from "which resource" to "I can explain it".

    study(inputs, today, node=None, resources=None, contracts=None, entries=None, choice=None) -> dict

node: the bank node (id, name, outcomes, hours_est). resources: the bank resources it
lists. contracts: its contracts, each with done (from the plan state). entries: his
learning-log entries tagged with this node (what, minutes, files, date). choice: his
record for the node {"primary": resource id, "since": date}.

The node moves through five stages, and the answer always names the one next step:
  choose     no primary resource yet: pick one (the others stay as backups)
  study      a primary is set and fewer than MIN_ENTRIES logged sessions with it
  contracts  enough study; the node's contracts are the proof (one at a time)
  review     every contract done; spaced explain-backs at 1, 3 and 7 days after
             the last entry turn it into memory (the testing effect, as in ww_learning)
  mastered   contracts done, at least one note filed, all three follow-ups passed
Notes count as files attached to an entry. Pure.
"""
from __future__ import annotations

from typing import Optional

from .ww_base import EngineSpec, add_days, days_between, plural

MIN_ENTRIES = 2
FOLLOW_UPS = (1, 3, 7)


def study(inputs: dict, today: str, node: Optional[dict] = None, resources: Optional[list[dict]] = None,
          contracts: Optional[list[dict]] = None, entries: Optional[list[dict]] = None, choice: Optional[dict] = None) -> dict:
    base = {"engine": "study", "version": 1, "status": "ok", "date": today}
    if not node:
        return {**base, "node": None, "stage": None, "say": "Pick a node on the Tree to study it here."}
    resources = resources or []
    contracts = contracts or []
    entries = sorted(entries or [], key=lambda e: e.get("date", ""))
    choice = choice or {}
    primary = next((r for r in resources if r.get("id") == choice.get("primary")), None)
    minutes = sum(int(e.get("minutes") or 0) for e in entries)
    notes = sum(len(e.get("files") or []) for e in entries)
    done = [c for c in contracts if c.get("done")]
    nxt_c = next((c for c in contracts if not c.get("done")), None)
    last = entries[-1]["date"] if entries else None
    reviews = choice.get("reviews") or []
    follow = []
    if last and not nxt_c:
        for i, gap in enumerate(FOLLOW_UPS):
            due = add_days(last, gap)
            passed = i < len([r for r in reviews if r.get("ok")])
            follow.append({"n": i + 1, "due": due, "passed": passed, "due_now": not passed and due <= today})

    if not primary:
        stage, step = "choose", {"kind": "choose", "title": "Choose your primary resource",
                                 "why": "One main source, studied end to end, beats sampling five. The rest stay as backups."}
    elif len(entries) < MIN_ENTRIES and not done:
        stage, step = "study", {"kind": "study", "title": f"Study with {primary.get('title', primary['id'])}",
                                "why": f"{plural(len(entries), 'session')} logged; log what you covered and attach your notes."}
    elif nxt_c:
        stage, step = "contracts", {"kind": "contract", "title": nxt_c.get("title", nxt_c.get("id")), "key": nxt_c.get("key"),
                                    "minutes": nxt_c.get("minutes"), "why": f"Contract {len(done) + 1} of {len(contracts)}: the proof that you can do it."}
    elif any(not f["passed"] for f in follow):
        f = next(x for x in follow if not x["passed"])
        stage, step = "review", {"kind": "review", "title": f"Explain {node.get('name', node['id'])} from memory",
                                 "due": f["due"], "due_now": f["due_now"],
                                 "why": f"Follow-up {f['n']} of {len(FOLLOW_UPS)}" + ("" if f["due_now"] else f", due {f['due']}")}
    elif notes == 0:
        stage, step = "review", {"kind": "notes", "title": "File one page of notes for this node",
                                 "why": "Mastered needs something you can reread in a year."}
    else:
        stage, step = "mastered", {"kind": "done", "title": "Mastered: mark it on the Tree", "why": "Contracts, notes and three recalls are in."}

    hours = node.get("hours_est")
    return {**base, "node": {k: node.get(k) for k in ("id", "name", "branch", "outcomes", "hours_est")},
            "stage": stage, "next": step, "primary": primary,
            "backups": [r for r in resources if r is not primary],
            "contracts": [{k: c.get(k) for k in ("key", "id", "title", "minutes", "done")} for c in contracts],
            "entries": entries[::-1][:20], "follow_ups": follow,
            "progress": {"minutes": minutes, "hours_est": hours, "share": round(min(1.0, minutes / 60 / hours), 2) if hours else None,
                         "notes": notes, "contracts_done": len(done), "contracts": len(contracts)},
            "say": f"{node.get('name', node['id'])}: {step['title']}."}


ENGINE = EngineSpec(
    name="study", version=1, fn=study,
    about="One node from choosing a resource to explaining it from memory: one next step at a time.",
    needs=("a node", "its resources and contracts", "your learning entries for it"),
    inputs={},
    data={"node": {"type": "dict"}, "resources": {"type": "list"}, "contracts": {"type": "list"},
          "entries": {"type": "list"}, "choice": {"type": "dict"}},
)
