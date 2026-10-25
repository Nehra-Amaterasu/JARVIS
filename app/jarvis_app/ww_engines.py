"""Well Wisher engines: each one a pure function over data, with tests.

    engine(inputs: dict, today: str, **data) -> dict

* pure: no file, clock, network or plan-state writes inside an engine; the same
  arguments give the same answer, and the arguments are never mutated
  (app/tests/test_mission_engines.py checks both for every registered engine);
* every answer carries {"engine", "version", "status"}; status is "ok", or
  "not_built" for an engine that so far only has its interface, which then says
  what data it `needs`;
* the System advises: engines rank and explain, they never change the plan.

Built (v1): goal_ladder, evidence. Interfaces only: career, money, personality,
body, learning, insight (docs/well-wisher-v1.md, "Engines").

Inputs come from data/notes/well-wisher/engine-inputs.json (private, git-ignored),
else from the fictional engine-inputs.example.json next to this file. Only
load_inputs() touches the disk.
"""
from __future__ import annotations

import json
import os
import re
from datetime import date
from pathlib import Path
from typing import Any, Callable, Optional

EXAMPLE = Path(__file__).with_name("engine-inputs.example.json")
_DATE = re.compile(r"^\d{4}-\d{2}-\d{2}$")


# ------------------------------------------------------------------ inputs (the one place with I/O)
def inputs_path() -> Path:
    env = os.environ.get("JARVIS_ENGINE_INPUTS")
    if env:
        return Path(env)
    return Path(__file__).resolve().parents[2] / "data" / "notes" / "well-wisher" / "engine-inputs.json"


def load_inputs(path: Optional[Path] = None) -> dict:
    """The private inputs if present and readable, else the fictional example. The
    answer says which (`source`), so a screen never passes the example off as his."""
    p = path or inputs_path()
    for src, f in (("private", p), ("example", EXAMPLE)):
        try:
            raw = json.loads(f.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            continue
        out = normalize_inputs(raw)
        out["source"] = src
        return out
    return {**normalize_inputs({}), "source": "none"}


def _d(v: Any) -> Optional[str]:
    if isinstance(v, str) and _DATE.match(v):
        try:
            date.fromisoformat(v)
            return v
        except ValueError:
            return None
    return None


def _num(v: Any, lo: float, hi: float, dflt: float) -> float:
    try:
        x = float(v)
    except (TypeError, ValueError):
        return dflt
    return max(lo, min(hi, x))


def _ids(v: Any) -> list[str]:
    return [str(x) for x in v if isinstance(x, (str, int))] if isinstance(v, list) else []


def normalize_inputs(raw: Any) -> dict:
    """Tolerant cleaning: unknown keys are ignored, bad items dropped with a warning."""
    raw = raw if isinstance(raw, dict) else {}
    warn: list[str] = []
    goals = []
    for g in raw.get("life_goals") or raw.get("goals") or []:
        if not isinstance(g, dict) or not g.get("id") or not g.get("title"):
            warn.append("a life goal without id/title dropped")
            continue
        fy = [{"id": str(x["id"]), "title": str(x.get("title") or x["id"]), "by": _d(x.get("by"))}
              for x in g.get("five_year") or [] if isinstance(x, dict) and x.get("id")]
        years = []
        for y in g.get("years") or []:
            if not isinstance(y, dict) or not isinstance(y.get("year"), int):
                continue
            ms = [{"id": str(m["id"]), "title": str(m.get("title") or m["id"]), "by": _d(m.get("by")), "skills": _ids(m.get("skills")),
                   "done": bool(m.get("done")), "five_year": str(m["five_year"]) if m.get("five_year") else None}
                  for m in y.get("milestones") or [] if isinstance(m, dict) and m.get("id")]
            years.append({"year": y["year"], "milestones": ms})
        goals.append({"id": str(g["id"]), "title": str(g["title"]), "why": str(g.get("why") or ""), "five_year": fy,
                      "years": sorted(years, key=lambda y: y["year"])})
    deadlines = []
    for x in raw.get("deadlines") or []:
        if isinstance(x, dict) and x.get("id") and _d(x.get("date")):
            deadlines.append({"id": str(x["id"]), "title": str(x.get("title") or x["id"]), "date": x["date"],
                              "kind": str(x.get("kind") or "other"), "skills": _ids(x.get("skills"))})
        else:
            warn.append("a deadline without id/date dropped")
    skills = {}
    for s in raw.get("skills") or []:
        if isinstance(s, dict) and s.get("id"):
            skills[str(s["id"])] = {"id": str(s["id"]), "name": str(s.get("name") or s["id"]), "level": _num(s.get("level"), 0, 5, 0),
                                    "target": _num(s.get("target"), 0, 5, 3), "weight": _num(s.get("weight"), 0, 1, 0.5)}
    week = raw.get("week") if isinstance(raw.get("week"), dict) else {}
    return {"life_goals": goals, "deadlines": sorted(deadlines, key=lambda x: (x["date"], x["id"])), "skills": skills,
            "week": {"capacity_minutes": int(_num(week.get("capacity_minutes"), 0, 6000, 600))}, "warnings": warn}


# ------------------------------------------------------------------ 1. goal ladder
def quarter_end(today: str) -> str:
    d = date.fromisoformat(today)
    q_last_month = ((d.month - 1) // 3 + 1) * 3
    nxt = date(d.year + (q_last_month == 12), q_last_month % 12 + 1, 1)
    return date.fromordinal(nxt.toordinal() - 1).isoformat()


def _days(a: str, b: str) -> int:
    return (date.fromisoformat(b) - date.fromisoformat(a)).days


def urgency(days_left: Optional[int]) -> float:
    """1.0 when due within a week, falling to 0.1 at a year; overdue is 0 (it's gone)."""
    if days_left is None:
        return 0.1
    if days_left < 0:
        return 0.0
    if days_left <= 7:
        return 1.0
    return max(0.1, round(7 / days_left, 3))


def goal_ladder(inputs: dict, today: str, candidates: Optional[list[dict]] = None, done: Optional[set] = None, n: int = 3) -> dict:
    """Life goals -> 5-year -> this year -> this quarter -> this week -> today's n contracts.

    candidates: contracts the plan engine offers today (each with a key, title,
    minutes and node_id). Each pick says which rung it serves, so "why this today"
    is a chain up to a life goal. Without candidates it proposes plain skill
    sessions. `done`: contract keys already finished (skipped)."""
    done = done or set()
    q_end = quarter_end(today)
    wk_end = date.fromordinal(date.fromisoformat(today).toordinal() + 6).isoformat()
    year = date.fromisoformat(today).year
    skills = inputs.get("skills") or {}
    rungs: list[dict] = []                         # every open milestone/deadline with its chain up
    five, this_year = [], []
    for g in inputs.get("life_goals") or []:
        fy_by = {x["id"]: x for x in g["five_year"]}
        five += [{**x, "life_goal": g["id"]} for x in g["five_year"]]
        for y in g["years"]:
            for m in y["milestones"]:
                if m["done"] or (m["by"] and m["by"] < today):
                    continue
                chain = [{"rung": "life", "id": g["id"], "title": g["title"]}]
                if m["five_year"] in fy_by:
                    chain.append({"rung": "five_year", "id": m["five_year"], "title": fy_by[m["five_year"]]["title"]})
                chain.append({"rung": "year", "id": m["id"], "title": m["title"], "year": y["year"]})
                r = {"id": m["id"], "title": m["title"], "by": m["by"], "skills": m["skills"], "kind": "milestone", "chain": chain,
                     "year": y["year"]}
                rungs.append(r)
                if y["year"] == year or (m["by"] and m["by"][:4] == str(year)):
                    this_year.append(r)
    for dl in inputs.get("deadlines") or []:
        if dl["date"] >= today:
            rungs.append({"id": dl["id"], "title": dl["title"], "by": dl["date"], "skills": dl["skills"], "kind": dl["kind"],
                          "chain": [{"rung": "deadline", "id": dl["id"], "title": dl["title"]}], "year": int(dl["date"][:4])})
    # the quarter: what is due by its end; if nothing is, the nearest open milestone, so the quarter is never empty
    quarter = [r for r in rungs if r["by"] and r["by"] <= q_end]
    if not quarter:
        dated = sorted((r for r in rungs if r["by"]), key=lambda r: (r["by"], r["id"]))
        quarter = dated[:1]
    quarter.sort(key=lambda r: (r["by"] or "9999", r["id"]))
    # the week: deadlines inside it, plus one skill step per quarter item (the biggest gap first)
    week = []
    for r in quarter:
        gaps = sorted(((skills[s]["target"] - skills[s]["level"]) * skills[s]["weight"], s) for s in r["skills"] if s in skills)
        gaps = [x for x in gaps if x[0] > 0]
        step = gaps[-1][1] if gaps else (r["skills"][0] if r["skills"] else None)
        week.append({"serves": r["id"], "title": (f"{skills[step]['name'] if step in skills else step}: one step for {r['title']}"
                                                  if step else r["title"]), "skill": step, "due": r["by"],
                     "in_week": bool(r["by"] and r["by"] <= wk_end)})

    def score(skill: Optional[str]) -> tuple[float, Optional[dict]]:
        best, why = 0.0, None
        for r in quarter or rungs:
            if skill and skill in r["skills"]:
                s = skills.get(skill)
                gap = max(0.0, (s["target"] - s["level"])) / 5 if s else 0.2
                val = urgency(_days(today, r["by"]) if r["by"] else None) * (0.5 + (s["weight"] if s else 0.5)) * (0.5 + gap)
                if val > best:
                    best, why = val, r
        return round(best, 4), why

    picks = []
    if candidates:
        scored = []
        for c in candidates:
            if c.get("done") or c.get("key") in done:
                continue
            s, r = score(c.get("node_id"))
            scored.append((-s, c.get("key") or "", c, r, s))
        scored.sort(key=lambda x: (x[0], x[1]))
        seen_nodes: set = set()
        for pass_ in (0, 1):                         # first one per node (variety), then fill
            for _, key, c, r, s in scored:
                if len(picks) >= n or any(p["key"] == key for p in picks):
                    continue
                if pass_ == 0 and c.get("node_id") in seen_nodes:
                    continue
                seen_nodes.add(c.get("node_id"))
                picks.append({"key": key, "title": c.get("title"), "minutes": c.get("minutes"), "score": s,
                              "serves": r["id"] if r else None, "chain": (r["chain"] if r else []),
                              "why": f"Serves {r['title']} (due {r['by']})" if r else "Keeps the plan moving; serves no dated goal"})
    else:
        for w in week:
            if len(picks) >= n or not w["skill"]:
                continue
            s, _ = score(w["skill"])
            r = next(x for x in quarter if x["id"] == w["serves"])    # the rung this step was made for
            picks.append({"key": f"ladder/{w['skill']}/{today}", "title": w["title"], "minutes": 45, "score": s, "serves": w["serves"],
                          "chain": r["chain"] if r else [], "why": f"Serves {r['title']} (due {r['by']})" if r else w["title"]})
    return {"engine": "goal_ladder", "version": 1, "status": "ok", "date": today,
            "life_goals": [{"id": g["id"], "title": g["title"], "why": g["why"]} for g in inputs.get("life_goals") or []],
            "five_year": five, "year": {"year": year, "milestones": this_year},
            "quarter": {"ends": q_end, "items": quarter}, "week": {"ends": wk_end, "items": week,
                                                                  "capacity_minutes": (inputs.get("week") or {}).get("capacity_minutes", 600)},
            "today": picks, "source": inputs.get("source")}


# ------------------------------------------------------------------ 2. evidence
# kind -> (what must be present, how XP is computed). No rule, or a missing field: 0 XP.
EVIDENCE_RULES: dict[str, tuple[tuple[str, ...], Callable[[dict], int], str]] = {
    "contract": (("key",), lambda a: int(a.get("xp") or 0), "a finished contract: its bank XP"),
    "log": (("minutes",), lambda a: min(60, 10 * (int(a["minutes"]) // 30)) or 5, "time logged: 10 per half hour, at most 60"),
    "learning": (("what",), lambda a: (min(60, 10 * (int(a.get("minutes") or 0) // 30)) or 5) + (5 if a.get("files") else 0),
                 "a learning entry: time, +5 with a file"),
    "commit": (("url",), lambda a: 15, "a commit with its link"),
    "test_passed": (("name",), lambda a: 20, "a test or quiz passed"),
    "cert": (("url",), lambda a: 150, "a certificate with its link"),
    "project": (("url",), lambda a: 200, "a project shipped with its link"),
    "reps": (("sets",), lambda a: 10, "a quest session with the numbers"),
    "money_saved": (("amount",), lambda a: 10, "money saved, logged with the amount"),
}


def _present(a: dict, field: str) -> bool:
    v = a.get(field)
    if field == "url":                             # a link, or the plan's record that one was given
        return (isinstance(v, str) and bool(re.match(r"^https?://", v.strip()))) or a.get("verified") is True
    if field in ("minutes", "amount"):
        try:
            return float(v) > 0
        except (TypeError, ValueError):
            return False
    if field == "sets":
        return isinstance(v, list) and any(isinstance(x, (int, float)) and x > 0 for x in v)
    return bool(v)


def evidence(inputs: dict, today: str, actions: Optional[list[dict]] = None) -> dict:
    """The ledger: each action's XP by its rule, or 0 with the reason. No action, no XP;
    an action without its evidence (no link, no minutes, no numbers), no XP."""
    ledger, rejected, total = [], [], 0
    for i, a in enumerate(actions or []):
        if not isinstance(a, dict):
            rejected.append({"i": i, "reason": "not an action record"})
            continue
        kind = str(a.get("kind") or "")
        rule = EVIDENCE_RULES.get(kind)
        if rule is None:
            rejected.append({"i": i, "kind": kind, "reason": "no rule: nothing logged that XP could stand for"})
            continue
        missing = [f for f in rule[0] if not _present(a, f)]
        if missing:
            rejected.append({"i": i, "kind": kind, "reason": f"missing evidence: {', '.join(missing)}"})
            continue
        xp = max(0, int(rule[1](a)))
        total += xp
        ledger.append({"i": i, "kind": kind, "date": a.get("date"), "xp": xp, "rule": rule[2]})
    return {"engine": "evidence", "version": 1, "status": "ok", "date": today, "xp": total, "ledger": ledger, "rejected": rejected,
            "rules": {k: {"needs": list(v[0]), "rule": v[2]} for k, v in EVIDENCE_RULES.items()}}


def actions_from_plan(st: dict) -> list[dict]:
    """The plan's events as action records for the evidence engine (pure)."""
    out = []
    for e in st.get("events") or []:
        k = e.get("kind")
        if k == "contract":
            out.append({"kind": "contract", "key": e.get("key"), "xp": e.get("xp"), "date": e.get("date")})
        elif k == "log":
            out.append({"kind": "log", "minutes": e.get("minutes"), "date": e.get("date")})
        elif k == "learning":
            out.append({"kind": "learning", "what": e.get("note"), "minutes": e.get("minutes"), "files": e.get("verified"), "date": e.get("date")})
        elif k == "quest":
            out.append({"kind": "reps", "sets": e.get("sets"), "date": e.get("date")})
        elif k in ("cert", "ship", "project"):
            out.append({"kind": "cert" if k == "cert" else "project", "verified": e.get("verified") is True, "date": e.get("date")})
        elif k == "xp":
            out.append({"kind": "game_xp", "xp": e.get("xp"), "date": e.get("date")})
    return out


# ------------------------------------------------------------------ 3-8: interfaces only
def _not_built(name: str, needs: list[str], plan: str) -> Callable[..., dict]:
    def engine(inputs: dict, today: str, **data: Any) -> dict:
        return {"engine": name, "version": 0, "status": "not_built", "date": today, "needs": needs, "plan": plan}
    engine.__name__ = name
    engine.__doc__ = f"{name} engine (interface only). Needs: {', '.join(needs)}. {plan}"
    return engine


career = _not_built("career", ["skill tree v2 node statuses", "applications pipeline", "deadlines"],
                    "Rank internships by deadline and the nodes they ask for; say which node unlocks most.")
money = _not_built("money", ["income entries", "monthly budget", "savings entries"],
                   "Savings rate and a projection with its assumptions stated; side income scored by rupees per hour after 4 weeks. Education only.")
personality = _not_built("personality", ["profile traits and style rules", "missed-day history"],
                         "Framing (puzzle first), variety and novelty budget, re-entry after a gap.")
body = _not_built("body", ["quest sessions", "sleep (Aankhen night data)", "checklists"],
                  "Calisthenics is live as a quest line; sleep and the checklists come next. Advice only.")
learning = _not_built("learning", ["learning log", "Yaadash facts"], "Spaced review and explain-it-back quizzes on what he logged.")
insight = _not_built("insight", ["a week of events", "the ladder"], "Weekly: what moved, what stalled, one change, each citing data.")

ENGINES: dict[str, Callable[..., dict]] = {
    "goal_ladder": goal_ladder, "evidence": evidence, "career": career, "money": money,
    "personality": personality, "body": body, "learning": learning, "insight": insight,
}
