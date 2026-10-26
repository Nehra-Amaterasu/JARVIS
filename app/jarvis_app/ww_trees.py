"""Life trees: parallel progressions (GitHub, LinkedIn, content, money, a second career,
discipline) beside the skill tree, each node verified by evidence.

    trees(inputs, today, bank=None, proofs=None, measures=None) -> dict

bank: lifetrees.json ({"trees": [{id, name, about, nodes: [{id, name, tier, prereqs,
outcomes, proof: {kind, need, unit?, text}}]}]}).
proofs: links he filed {tree: {node: [{date, url, note}]}} (plan state).
measures: numbers other parts of the app already count, so nothing is counted twice:
  github_days    public commit days in the last 30 (github_activity, via the proof engine)
  build_hours    building hours in the last 14 days, from commits (ww_sessions)
  money_income   rupees of "income" entries in the money log (ww_money)
  money_entries  entries in the money log
  skill_nodes    skill-tree nodes mastered with a finished contract (wellwisher.evidence)
  life_points    Life points over the last 4 weeks (ww_life)

A node is locked until every prerequisite is mastered; then mastered when have >= need,
in progress when 0 < have < need, else available. "link" nodes count the links he
filed; every other kind is measured, so the UI offers no "mark done" for them. Pure.
"""
from __future__ import annotations

from typing import Optional

from .ww_base import EngineSpec

MEASURED = ("github_days", "build_hours", "money_income", "money_entries", "skill_nodes", "life_points")
KINDS = ("link",) + MEASURED
# Where each kind of proof is made, so a node can send him there.
PAGE_OF = {"github_days": ("status", "Proof of work"), "build_hours": ("today", "Building"),
           "money_income": ("career", "Money log"), "money_entries": ("career", "Money log"),
           "skill_nodes": ("study", "Study a node"), "life_points": ("life", "Today in taps")}
UNIT = {"link": "links", "github_days": "days", "build_hours": "h", "money_income": "Rs", "money_entries": "entries",
        "skill_nodes": "nodes", "life_points": "points"}


def _status(have: float, need: float, open_: bool) -> str:
    if not open_:
        return "locked"
    if have >= need:
        return "mastered"
    return "in_progress" if have > 0 else "available"


def trees(inputs: dict, today: str, bank: Optional[dict] = None, proofs: Optional[dict] = None,
          measures: Optional[dict] = None) -> dict:
    proofs = proofs or {}
    measures = measures or {}
    out = []
    for t in (bank or {}).get("trees") or []:
        nodes = t.get("nodes") or []
        by_id = {n["id"]: n for n in nodes}
        unlocks: dict[str, list[str]] = {}
        for n in nodes:
            for p in n.get("prereqs") or []:
                unlocks.setdefault(p, []).append(n["id"])
        status: dict[str, str] = {}
        rows = []
        # tiers in order, so every prerequisite has a status before its children
        for n in sorted(nodes, key=lambda n: (int(n.get("tier") or 0), n["id"])):
            pr = n.get("proof") or {}
            kind = pr.get("kind") if pr.get("kind") in KINDS else "link"
            need = float(pr.get("need") or 1)
            filed = (proofs.get(t["id"]) or {}).get(n["id"]) or []
            have = float(len(filed)) if kind == "link" else float(measures.get(kind) or 0)
            open_ = all(status.get(p) == "mastered" for p in n.get("prereqs") or [] if p in by_id)
            st = _status(have, need, open_)
            status[n["id"]] = st
            links = [{"kind": "node", "target": p, "label": f"Needs: {by_id[p]['name']}"} for p in n.get("prereqs") or [] if p in by_id]
            links += [{"kind": "node", "target": u, "label": f"Unlocks: {by_id[u]['name']}"} for u in unlocks.get(n["id"], [])]
            if kind in PAGE_OF:
                page, label = PAGE_OF[kind]
                links.append({"kind": "page", "target": page, "label": f"Where this is measured: {label}"})
            links += [{"kind": "url", "target": e["url"], "label": e.get("note") or e["url"]} for e in filed if e.get("url")]
            rows.append({"id": n["id"], "name": n.get("name", n["id"]), "tier": int(n.get("tier") or 0),
                         "prereqs": [p for p in n.get("prereqs") or [] if p in by_id], "outcomes": n.get("outcomes") or [],
                         "status": st,
                         "proof": {"kind": kind, "need": need, "have": round(have, 1), "unit": pr.get("unit") or UNIT[kind],
                                   "text": pr.get("text") or "", "measured": kind != "link"},
                         "evidence": [{"date": e.get("date"), "text": e.get("note") or "", "url": e.get("url")} for e in filed][-20:],
                         "links": links})
        order = {n["id"]: i for i, n in enumerate(nodes)}
        rows.sort(key=lambda r: (r["tier"], order.get(r["id"], 0)))
        out.append({"id": t["id"], "name": t.get("name", t["id"]), "about": t.get("about", ""),
                    "progress": {"mastered": sum(1 for r in rows if r["status"] == "mastered"), "total": len(rows)},
                    "nodes": rows})
    return {"engine": "trees", "version": 1, "status": "ok", "date": today, "trees": out,
            "measures": {k: measures.get(k) for k in MEASURED},
            "rule": "Each node is mastered by evidence: links you file for link nodes; counted numbers for the rest."}


ENGINE = EngineSpec(
    name="trees", version=1, fn=trees,
    about="Parallel life trees (GitHub, LinkedIn, content, money, second career, discipline), verified by evidence.",
    needs=("lifetrees.json", "filed links", "the numbers other engines count"),
    inputs={},
    data={"bank": {"type": "dict"}, "proofs": {"type": "dict"}, "measures": {"type": "dict"}},
)
