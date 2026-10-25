"""Insight engine: the weekly review from logged events.

    insight(inputs, today, events=None, planned=None, nodes=None) -> dict

The week is the seven days ending today; it is compared with the seven before.
Out come: the totals, what moved (more done than the week before), what stalled
(in progress with nothing logged this week, or active last week and silent this
week), and ONE change for next week chosen by a fixed rule list. Every line
carries the numbers it is based on. weekly_say() turns it into a few sentences
JARVIS can read out ("Jarvis, weekly review").

events: plan events {date, kind, minutes?, node?, track?, key?, verified?}
planned: {date: [contract keys planned that day]} (what the day offered)
nodes: [{id, name, status}] for names and what is in progress
Pure: no I/O, the arguments are never changed.
"""
from __future__ import annotations

from typing import Optional

from .ww_base import EngineSpec, add_days, plural

ACTION_KINDS = ("contract", "log", "learning", "quest", "ship", "cert", "project", "achievement")
TIMED_KINDS = ("contract", "log", "learning")


def _min(e: dict) -> int:
    try:
        return max(0, int(e.get("minutes") or 0))
    except (TypeError, ValueError):
        return 0


def week_numbers(events: list[dict], start: str, end: str, planned: dict) -> dict:
    evs = [e for e in events if start <= e["date"] <= end]
    keys_done = {e.get("key") for e in evs if e["kind"] == "contract"}
    plan_keys = {k for d, ks in planned.items() if start <= d <= end for k in ks}
    groups: dict[str, dict] = {}
    for e in evs:
        if e["kind"] not in ACTION_KINDS:
            continue
        gid = str(e.get("node") or e.get("track") or e["kind"])
        g = groups.setdefault(gid, {"minutes": 0, "contracts": 0, "actions": 0, "last": None})
        g["actions"] += 1
        g["minutes"] += _min(e) if e["kind"] in TIMED_KINDS else 0
        g["contracts"] += e["kind"] == "contract"
        g["last"] = max(g["last"] or "", e["date"])
    return {"start": start, "end": end,
            "active_days": len({e["date"] for e in evs if e["kind"] in ACTION_KINDS}),
            "minutes": sum(_min(e) for e in evs if e["kind"] in TIMED_KINDS),
            "contracts": sum(1 for e in evs if e["kind"] == "contract"),
            "with_link": sum(1 for e in evs if e["kind"] == "contract" and e.get("verified")),
            "learning": sum(1 for e in evs if e["kind"] == "learning"),
            "quest": sum(1 for e in evs if e["kind"] == "quest"),
            "planned": len(plan_keys), "planned_done": len(plan_keys & keys_done), "groups": groups}


def one_change(w: dict, stalled_nodes: list[dict]) -> dict:
    """The single change for next week: the first rule that fits, with its numbers."""
    rate = w["planned_done"] / w["planned"] if w["planned"] else None
    if w["active_days"] <= 2:
        return {"rule": "few_days", "text": f"Next week: one 15-minute contract on four days. This week had {plural(w['active_days'], 'active day')} of 7."}
    if rate is not None and rate < 0.5:
        return {"rule": "too_much", "text": f"Next week: plan two contracts a day instead of three. This week {w['planned_done']} of "
                                            f"{w['planned']} planned contracts got done ({round(rate * 100)}%)."}
    if stalled_nodes:
        s = stalled_nodes[0]
        return {"rule": "stalled", "text": f"Next week: finish or pause {s['name']}. It is in progress with 0 minutes this week and holds one of the open slots."}
    if w["contracts"] and not w["with_link"]:
        return {"rule": "proof", "text": f"Next week: add a link to one finished contract. {plural(w['contracts'], 'contract')} finished this week, 0 with a link."}
    return {"rule": "keep", "text": f"Next week: keep the plan and make one contract a stretch version. This week: {w['active_days']}/7 days, {w['minutes']} minutes."}


def insight(inputs: dict, today: str, events: Optional[list[dict]] = None, planned: Optional[dict] = None,
            nodes: Optional[list[dict]] = None) -> dict:
    evs = [e for e in events or [] if isinstance(e, dict) and isinstance(e.get("date"), str) and e.get("kind")]
    planned = {d: [k for k in ks if isinstance(k, str)] for d, ks in (planned or {}).items() if isinstance(ks, list)}
    names = {n["id"]: n.get("name") or n["id"] for n in nodes or [] if isinstance(n, dict) and n.get("id")}
    names.update({"deutsch": "German", "silicon": "Silicon", "body": "Training", "learning": "Learning log", "quest": "Quest lines"})
    start = add_days(today, -6)
    this = week_numbers(evs, start, today, planned)
    prev = week_numbers(evs, add_days(today, -13), add_days(today, -7), planned)
    nm = lambda gid: names.get(gid, gid)

    moved = []
    for gid, g in this["groups"].items():
        p = prev["groups"].get(gid, {"minutes": 0, "contracts": 0, "actions": 0})
        if g["minutes"] > p["minutes"] or g["contracts"] > p["contracts"] or (g["actions"] > p["actions"] and not g["minutes"]):
            moved.append((g["minutes"] - p["minutes"], gid,
                          f"{nm(gid)}: {plural(g['contracts'], 'contract')}, {g['minutes']} min this week "
                          f"(last week {p['contracts']}, {p['minutes']} min)"))
    moved.sort(key=lambda x: (-x[0], x[1]))

    stalled, stalled_nodes = [], []
    for nid, n in sorted(names.items()):
        node = next((x for x in nodes or [] if isinstance(x, dict) and x.get("id") == nid), None)
        if node and node.get("status") == "in_progress" and nid not in this["groups"]:
            last = max((e["date"] for e in evs if e.get("node") == nid), default=None)
            stalled_nodes.append({"id": nid, "name": n})
            stalled.append(f"{n}: in progress, 0 min this week" + (f" (last logged {last})" if last else " (nothing logged yet)"))
    for gid, p in sorted(prev["groups"].items()):
        if gid not in this["groups"] and gid not in {s["id"] for s in stalled_nodes}:
            stalled.append(f"{nm(gid)}: {p['minutes']} min and {plural(p['contracts'], 'contract')} last week, nothing this week")
    totals = (f"{this['active_days']}/7 active days, {this['minutes']} minutes, {plural(this['contracts'], 'contract')} finished"
              + (f" ({this['planned_done']} of {this['planned']} planned)" if this["planned"] else "")
              + f"; last week {prev['active_days']}/7 days, {prev['minutes']} minutes")
    change = one_change(this, stalled_nodes)
    if not evs or (this["active_days"] == 0 and prev["active_days"] == 0):
        change = {"rule": "empty", "text": "Next week: one 15-minute contract on three days. Nothing is logged in the last 14 days, so there is nothing to compare yet."}
    out = {"engine": "insight", "version": 1, "status": "ok", "date": today, "week": {"start": start, "end": today},
           "this_week": {k: v for k, v in this.items() if k != "groups"}, "last_week": {k: v for k, v in prev.items() if k != "groups"},
           "totals": totals, "moved": [m[2] for m in moved[:3]], "stalled": stalled[:3], "change": change}
    out["say"] = weekly_say(out)
    return out


def weekly_say(r: dict) -> str:
    """The review in a few spoken sentences."""
    parts = [f"Weekly review, {r['week']['start']} to {r['week']['end']}: {r['totals']}."]
    if r["moved"]:
        parts.append("Moved: " + "; ".join(r["moved"][:2]) + ".")
    if r["stalled"]:
        parts.append("Stalled: " + r["stalled"][0] + ".")
    parts.append(r["change"]["text"])
    return " ".join(parts)


ENGINE = EngineSpec(
    name="insight", version=1, fn=insight,
    about="Weekly review: what moved, what stalled, one change for next week, each line with its numbers.",
    needs=("a week of plan events", "planned contracts per day", "skill-tree node statuses"),
    inputs={},
    data={"events": {"type": "list", "items": {"type": "dict", "required": {"date": {"type": "date"}, "kind": {"type": "str"}}}},
          "planned": {"type": "dict", "values": {"type": "list", "items": {"type": "str"}}},
          "nodes": {"type": "list", "items": {"type": "dict", "required": {"id": {"type": "str"}}}}},
)
