"""Well Wisher engines: each one a pure function over data, with tests.

    engine(inputs: dict, today: str, **data) -> dict

* pure: no file, clock, network or plan-state writes inside an engine; the same
  arguments give the same answer, and the arguments are never mutated
  (app/tests/test_mission_engines.py checks both for every registered engine);
* every answer carries {"engine", "version", "status"}; status is "ok", or
  "not_built" for an engine that so far only has its interface, which then says
  what data it `needs`;
* the System advises: engines rank and explain, they never change the plan.

The registry (ENGINE_TABLE below) names every engine and the file that holds it.
Each engine file exports ENGINE, an EngineSpec (ww_base.py): name, version, the
function, and a schema for the input sections and data it reads. run() checks the
inputs against that schema first. Adding an engine is one file + one line in
ENGINE_TABLE (docs/well-wisher-v1.md, "Adding an engine").

Built: goal_ladder, evidence (this file), career (ww_career.py), money (ww_money.py), personality (ww_personality.py).
Interfaces only: insight, body, learning.

Inputs come from data/notes/well-wisher/engine-inputs.json (private, git-ignored),
else from the fictional engine-inputs.example.json next to this file. Only
load_inputs() touches the disk.
"""
from __future__ import annotations

import importlib
import json
import os
import re
from datetime import date
from pathlib import Path
from typing import Any, Callable, Optional

from . import ww_base
from .ww_base import EngineSpec, check, urgency as _urgency

EXAMPLE = Path(__file__).with_name("engine-inputs.example.json")
_DATE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
INPUTS_SCHEMA = 2


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


def _month_or_date(v: Any) -> Optional[str]:
    """'2027-01' -> '2027-01-01'; a date stays a date; anything else is None."""
    if isinstance(v, str) and re.fullmatch(r"\d{4}-\d{2}", v) and 1 <= int(v[5:]) <= 12:
        return v + "-01"
    return _d(v)


def _num(v: Any, lo: float, hi: float, dflt: float) -> float:
    try:
        x = float(v)
    except (TypeError, ValueError):
        return dflt
    return max(lo, min(hi, x))


def _opt_num(v: Any) -> Optional[float]:
    if isinstance(v, bool):
        return None
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


def _range(v: Any) -> Optional[list[float]]:
    """A number or [low, high] -> [low, high]; anything else None."""
    if isinstance(v, list) and len(v) == 2 and all(_opt_num(x) is not None for x in v):
        lo, hi = sorted(float(x) for x in v)
        return [lo, hi]
    x = _opt_num(v)
    return [x, x] if x is not None else None


def _ids(v: Any) -> list[str]:
    return [str(x) for x in v if isinstance(x, (str, int))] if isinstance(v, list) else []


def _strs(v: Any, cap: int = 30) -> list[str]:
    if isinstance(v, str):
        v = [v]
    return [str(x)[:200] for x in v if isinstance(x, str) and x.strip()][:cap] if isinstance(v, list) else []


def _slug(s: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", s.lower()).strip("-")[:40] or "x"


# Skill levels written as words map onto the 0..5 scale the ladder uses.
LEVEL_WORDS = {"none": 0, "beginner": 1, "weak": 1, "basic": 2, "fair": 2, "good": 3, "strong": 4, "expert": 5}
# A deadline or goal without a kind gets one from its words (first match wins).
KIND_WORDS = [
    ("exam", re.compile(r"\b(exams?|internals?|end-?sem|mid-?sem|midterms?|backlogs?|quiz|cie|see)\b", re.I)),
    ("gsoc", re.compile(r"\b(gsoc|summer of code)\b", re.I)),
    ("ms", re.compile(r"\b(ms|m\.?sc|masters?|master's|admissions?|universit(y|ies)|graduate school)\b", re.I)),
    ("income", re.compile(r"\b(income|salary|package|ctc|comp|compensation|inr/yr|per year)\b", re.I)),
    ("internship", re.compile(r"\b(intern(ship)?s?|summer|fellowships?|research (programme|program)|offer|stipend)\b", re.I)),
    ("application", re.compile(r"\b(applications?|apply|programme|program|scholarships?)\b", re.I)),
]


def infer_kind(*texts: str) -> str:
    t = " ".join(x for x in texts if x)
    return next((k for k, rx in KIND_WORDS if rx.search(t)), "other")


def normalize_inputs(raw: Any) -> dict:
    """Tolerant cleaning: unknown keys are ignored, bad items dropped with a warning.

    Two shapes of goals are read: life goals (id, title, five_year, years: the ladder's
    tree) and flat goals (id, horizon, metric|title, target, deadline). Deadlines may
    come without an id (one is made from the title and date) and as `item` instead of
    `title`. Skill levels may be words (LEVEL_WORDS)."""
    raw = raw if isinstance(raw, dict) else {}
    warn: list[str] = []
    life_src = list(raw.get("life_goals") or [])
    flat_src = []
    for g in raw.get("goals") or []:                 # old files kept life goals under "goals"
        (life_src if isinstance(g, dict) and ("years" in g or "five_year" in g) else flat_src).append(g)
    goals = []
    for g in life_src:
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
    flat = []
    for g in flat_src:
        title = (g.get("title") or g.get("metric")) if isinstance(g, dict) else None
        if not isinstance(g, dict) or not g.get("id") or not title:
            warn.append("a goal without id/metric dropped")
            continue
        target = g.get("target")
        flat.append({"id": str(g["id"]), "title": str(title)[:200], "horizon": str(g.get("horizon") or "other"),
                     "target": target if isinstance(target, (int, float, str)) and not isinstance(target, bool) else None,
                     "deadline": _d(g.get("deadline")), "skills": _ids(g.get("skills")), "done": bool(g.get("done")),
                     "kind": str(g.get("kind") or infer_kind(str(title), str(g.get("id"))))})
    deadlines, seen = [], set()
    for x in raw.get("deadlines") or []:
        title = (x.get("title") or x.get("item") or x.get("id")) if isinstance(x, dict) else None
        if isinstance(x, dict) and title and _d(x.get("date")):
            did = str(x.get("id") or f"dl-{_slug(str(title))}-{x['date']}")
            if did in seen:
                warn.append(f"deadline {did} twice: the second dropped")
                continue
            seen.add(did)
            deadlines.append({"id": did, "title": str(title)[:200], "date": x["date"],
                              "kind": str(x.get("kind") or infer_kind(str(title))), "skills": _ids(x.get("skills"))})
        else:
            warn.append("a deadline without a title/date dropped")
    skills = {}
    for s in raw.get("skills") or []:
        if isinstance(s, dict) and s.get("id"):
            lv = s.get("level")
            level = LEVEL_WORDS.get(lv.strip().lower(), 0) if isinstance(lv, str) else _num(lv, 0, 5, 0)
            skills[str(s["id"])] = {"id": str(s["id"]), "name": str(s.get("name") or s["id"]), "level": float(level),
                                    "target": _num(s.get("target"), 0, 5, 3), "weight": _num(s.get("weight"), 0, 1, 0.5)}
    exps = []
    for x in raw.get("income_experiments") or []:
        if not isinstance(x, dict) or not x.get("id"):
            warn.append("an income experiment without an id dropped")
            continue
        prob = _opt_num(x.get("probability"))
        exps.append({"id": str(x["id"]), "type": str(x.get("type") or "side"), "status": str(x.get("status") or "planned"),
                     "start": _month_or_date(x.get("start")), "review_after_weeks": int(_num(x.get("review_after_weeks"), 1, 52, 4)),
                     "inr_total": _range(x.get("inr_total")), "inr_per_month": _range(x.get("inr_per_month")),
                     "inr_per_hour": _range(x.get("inr_per_hour") if x.get("inr_per_hour") is not None else x.get("inr_per_hour_assumed")),
                     "usd_per_hour_ref": _opt_num(x.get("usd_per_hour_ref")),
                     "probability": max(0.0, min(1.0, prob)) if prob is not None else None,
                     "assumption": str(x["assumption"])[:200] if x.get("assumption") else None,
                     "metric": str(x["metric"])[:200] if x.get("metric") else None,
                     "baseline": x.get("baseline") if isinstance(x.get("baseline"), dict) else None})
    habits = [{"id": str(h["id"]), "target": str(h.get("target") or ""), "days": str(h.get("days") or ""),
               "opt_in": h.get("opt_in") is not False} for h in raw.get("habits") or [] if isinstance(h, dict) and h.get("id")]
    rr = raw.get("rules") if isinstance(raw.get("rules"), dict) else {}
    rules = {"max_open_projects": int(_num(rr.get("max_open_projects"), 1, 3, 3)),     # 3 is a hard ceiling
             "never_shame": True,                                                     # not switchable
             "advice_only_health_money": True,
             "recovery_after_days": int(_num(rr.get("recovery_after_days"), 1, 30, 2)),
             "sprint_minutes": int(_num(rr.get("sprint_minutes"), 10, 120, 45))}
    pr = raw.get("profile") if isinstance(raw.get("profile"), dict) else {}
    profile = {"traits": _strs(pr.get("traits")), "weak_points": _strs(pr.get("weak_points")), "prefers": _strs(pr.get("prefers")),
               "scores": {str(k): float(v) for k, v in (pr.get("scores") or {}).items() if _opt_num(v) is not None}
               if isinstance(pr.get("scores"), dict) else {}}
    mr = raw.get("money") if isinstance(raw.get("money"), dict) else {}
    ma = mr.get("assumptions") if isinstance(mr.get("assumptions"), dict) else {}
    ret = _opt_num(ma.get("annual_return_pct"))
    fx = _opt_num(ma.get("usd_inr"))
    budget = _opt_num(mr.get("monthly_budget"))
    money = {"monthly_budget": budget if budget is not None and budget >= 0 else None,
             "assumptions": {"annual_return_pct": ret if ret is not None and -50 <= ret <= 50 else None,
                             "usd_inr": fx if fx is not None and fx > 0 else None}}
    week = raw.get("week") if isinstance(raw.get("week"), dict) else {}
    return {"schema": INPUTS_SCHEMA, "life_goals": goals, "goals": sorted(flat, key=lambda g: (g["deadline"] or "9999", g["id"])),
            "deadlines": sorted(deadlines, key=lambda x: (x["date"], x["id"])), "skills": skills,
            "income_experiments": exps, "habits": habits, "rules": rules, "profile": profile, "money": money,
            "week": {"capacity_minutes": int(_num(week.get("capacity_minutes"), 0, 6000, 600))}, "warnings": warn}


# ------------------------------------------------------------------ 1. goal ladder
def quarter_end(today: str) -> str:
    d = date.fromisoformat(today)
    q_last_month = ((d.month - 1) // 3 + 1) * 3
    nxt = date(d.year + (q_last_month == 12), q_last_month % 12 + 1, 1)
    return date.fromordinal(nxt.toordinal() - 1).isoformat()


def _days(a: str, b: str) -> int:
    return ww_base.days_between(a, b)


def urgency(days_left: Optional[int]) -> float:
    """1.0 when due within a week, falling to 0.1 at ten weeks; overdue is 0 (it's gone)."""
    return _urgency(days_left)


_TOK = re.compile(r"[a-z0-9]{4,}")
_STOPTOK = {"with", "from", "into", "that", "this", "example", "closes", "close", "start", "starts", "date", "each", "test", "part"}


def _tokens(s: str) -> set[str]:
    return set(_TOK.findall((s or "").lower())) - _STOPTOK


def link_strength(c: dict, r: dict) -> float:
    """How directly a contract serves a rung: its node is a listed skill (1), an exam
    contract for an exam (1), or they share a word (0.6). 0: no link."""
    nid = c.get("node_id")
    if nid and nid in r["skills"]:
        return 1.0
    if r.get("kind") == "exam" and (c.get("source") == "academics" or c.get("branch") == "academics"):
        return 1.0
    words = _tokens(" ".join(str(c.get(k) or "") for k in ("title", "node_name", "branch")).replace("_", " "))
    return 0.6 if words & _tokens(r["title"]) else 0.0


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
    for g in inputs.get("goals") or []:            # flat goals: a rung each, at their own horizon
        if g["done"] or not g["deadline"] or g["deadline"] < today:
            continue
        r = {"id": g["id"], "title": g["title"], "by": g["deadline"], "skills": g["skills"], "kind": g["kind"],
             "chain": [{"rung": g["horizon"], "id": g["id"], "title": g["title"]}], "year": int(g["deadline"][:4])}
        rungs.append(r)
        if g["deadline"][:4] == str(year):
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

    def value(skill: Optional[str], r: dict, strength: float) -> float:
        s = skills.get(skill) if skill else None
        gap = max(0.0, (s["target"] - s["level"])) / 5 if s else 0.2
        return urgency(_days(today, r["by"]) if r["by"] else None) * (0.5 + (s["weight"] if s else 0.5)) * (0.5 + gap) * strength

    def score_skill(skill: Optional[str]) -> tuple[float, Optional[dict]]:
        best, why = 0.0, None
        for r in quarter or rungs:
            if skill and skill in r["skills"]:
                v = value(skill, r, 1.0)
                if v > best:
                    best, why = v, r
        return round(best, 4), why

    def score_contract(c: dict) -> tuple[float, Optional[dict]]:
        best, why = 0.0, None
        for r in quarter or rungs:
            strength = link_strength(c, r)
            if strength:
                v = value(c.get("node_id") if c.get("node_id") in r["skills"] else None, r, strength)
                if v > best:
                    best, why = v, r
        return round(best, 4), why

    picks = []
    if candidates:
        scored = []
        for c in candidates:
            if c.get("done") or c.get("key") in done:
                continue
            s, r = score_contract(c)
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
                              "node_id": c.get("node_id"), "branch": c.get("branch"), "source": c.get("source"),
                              "success_check": c.get("success_check"),
                              "serves": r["id"] if r else None, "chain": (r["chain"] if r else []),
                              "why": f"Serves {r['title']} (due {r['by']})" if r else "Keeps the plan moving; serves no dated goal"})
    else:
        for w in week:
            if len(picks) >= n or not w["skill"]:
                continue
            s, _ = score_skill(w["skill"])
            r = next(x for x in quarter if x["id"] == w["serves"])    # the rung this step was made for
            picks.append({"key": f"ladder/{w['skill']}/{today}", "title": w["title"], "minutes": 45, "score": s, "serves": w["serves"],
                          "node_id": w["skill"], "branch": None, "source": "ladder", "success_check": None,
                          "chain": r["chain"] if r else [], "why": f"Serves {r['title']} (due {r['by']})" if r else w["title"]})
    return {"engine": "goal_ladder", "version": 2, "status": "ok", "date": today,
            "life_goals": [{"id": g["id"], "title": g["title"], "why": g["why"]} for g in inputs.get("life_goals") or []],
            "goals": [{"id": g["id"], "title": g["title"], "horizon": g["horizon"], "deadline": g["deadline"], "kind": g["kind"]}
                      for g in inputs.get("goals") or []],
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
    """The plan's events (and money-log savings) as action records for the evidence engine (pure)."""
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
    for m in ((st.get("money") or {}).get("entries") or []):
        if m.get("kind") == "saving":
            out.append({"kind": "money_saved", "amount": m.get("amount"), "date": m.get("date")})
    return out


# ------------------------------------------------------------------ interfaces only
def _not_built(name: str, needs: list[str], plan: str) -> Callable[..., dict]:
    def engine(inputs: dict, today: str, **data: Any) -> dict:
        return {"engine": name, "version": 0, "status": "not_built", "date": today, "needs": needs, "plan": plan}
    engine.__name__ = name
    engine.__doc__ = f"{name} engine (interface only). Needs: {', '.join(needs)}. {plan}"
    return engine


_BODY_NEEDS = ["quest sessions", "sleep (Aankhen night data)", "checklists"]
_LEARNING_NEEDS = ["learning log", "Yaadash facts"]
body = _not_built("body", _BODY_NEEDS, "Calisthenics is live as a quest line; sleep and the checklists come next. Advice only.")
learning = _not_built("learning", _LEARNING_NEEDS, "Spaced review and explain-it-back quizzes on what he logged.")

_LOCAL = {
    "goal_ladder": EngineSpec("goal_ladder", 2, goal_ladder, "Life goals down to this week; ranks today's offered contracts by the rung they serve.",
                              ("life goals or dated goals", "deadlines", "skills"),
                              {"life_goals": {"type": "list"}, "goals": {"type": "list"},
                               "deadlines": {"type": "list", "items": {"type": "dict", "required": {"id": {"type": "str"}, "date": {"type": "date"}}}},
                               "skills": {"type": "dict"}},
                              {"candidates": {"type": "list", "items": {"type": "dict"}}, "n": {"type": "int"}}),
    "evidence": EngineSpec("evidence", 1, evidence, "No action, no XP: each action's XP by its rule, or 0 with the reason.",
                           ("logged actions",), {}, {"actions": {"type": "list"}}),
    "insight": EngineSpec("insight", 0, _not_built("insight", ["a week of events", "the ladder"], "Weekly: what moved, what stalled, one change, each citing data."), "Interface only.", tuple(["a week of events", "the ladder"])),
    "body": EngineSpec("body", 0, body, "Interface only.", tuple(_BODY_NEEDS)),
    "learning": EngineSpec("learning", 0, learning, "Interface only.", tuple(_LEARNING_NEEDS)),
}

# ------------------------------------------------------------------ the registry: one line per engine
# (name, module holding its ENGINE spec; "" = defined in this file). The order is the order the screens list them.
ENGINE_TABLE: list[tuple[str, str]] = [
    ("goal_ladder", ""),
    ("evidence", ""),
    ("career", "ww_career"),
    ("money", "ww_money"),
    ("personality", "ww_personality"),
    ("body", ""),
    ("learning", ""),
    ("insight", ""),
]


def _load_registry() -> dict[str, EngineSpec]:
    out: dict[str, EngineSpec] = {}
    for name, mod in ENGINE_TABLE:
        spec = importlib.import_module(f".{mod}", __package__).ENGINE if mod else _LOCAL[name]
        if spec.name != name:
            raise RuntimeError(f"engine table says {name}, {mod or 'ww_engines'} registers {spec.name}")
        out[name] = spec
    return out


REGISTRY: dict[str, EngineSpec] = _load_registry()
ENGINES: dict[str, Callable[..., dict]] = {k: v.fn for k, v in REGISTRY.items()}
career = ENGINES["career"]
money = ENGINES["money"]
personality = ENGINES["personality"]
insight = ENGINES["insight"]


def validate(name: str, inputs: dict, data: Optional[dict] = None) -> list[str]:
    """Schema problems for running engine `name` on these inputs and data (empty: fine)."""
    spec = REGISTRY[name]
    probs = []
    if not isinstance(inputs, dict):
        return ["inputs: expected dict"]
    for sec, sch in spec.inputs.items():
        if sec not in inputs:
            probs.append(f"inputs: missing {sec}")
        else:
            probs += check(inputs[sec], sch, f"inputs.{sec}")
    for k, v in (data or {}).items():
        if k not in spec.data:
            probs.append(f"data: {name} takes no {k}")
        elif v is not None:
            probs += check(v, spec.data[k], f"data.{k}")
    return probs[:20]


def run(name: str, inputs: dict, today: str, **data: Any) -> dict:
    """Run one engine by name after checking its inputs; a bad input is an answer, not a crash."""
    if name not in REGISTRY:
        raise KeyError(f"no engine {name}")
    spec = REGISTRY[name]
    probs = validate(name, inputs, data)
    if not ww_base.is_date(today):
        probs.append("today: expected a date")
    if probs:
        return {"engine": name, "version": spec.version, "status": "invalid_input", "date": today, "problems": probs}
    out = spec.fn(inputs, today, **{k: v for k, v in data.items() if v is not None})
    out.setdefault("version", spec.version)
    return out


def describe() -> list[dict]:
    return [REGISTRY[n].describe() for n, _ in ENGINE_TABLE]
