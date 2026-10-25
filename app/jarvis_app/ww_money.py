"""Money engine: the monthly budget and savings log, income experiments scored in
rupees per hour, and a long-range projection that prints its assumptions.

    money(inputs, today, entries=None) -> dict

Education, never investment advice: it does arithmetic on what he logged and on
the assumptions written in the inputs, says which is which, and recommends no
product, fund or trade. No invented numbers: a figure nobody logged or wrote down
is shown as "unknown" (a savings rate with no income logged, an experiment's
rupees per hour with no hours, a return rate that is not in the inputs).

entries: what he logged, each {date, kind, amount, hours?, experiment?, note?}
  kind: income | expense | saving | budget (the month's budget) | experiment
  (money earned in an income experiment, with the hours it took; 0 earned is fine).
An experiment is scored once it has `review_after_weeks` (default 4) of log behind it.
Pure: no I/O, no clock, the arguments are never changed.
"""
from __future__ import annotations

from typing import Optional

from .ww_base import EngineSpec, days_between, inr, plural

LABEL = "Education, not investment advice. Amounts in rupees; only what you logged and the assumptions listed below."
KINDS = ("income", "expense", "saving", "budget", "experiment")
HORIZONS = (1, 5, 10)


def _amount(e: dict) -> float:
    try:
        return max(0.0, float(e.get("amount") or 0))
    except (TypeError, ValueError):
        return 0.0


def _hours(e: dict) -> float:
    try:
        return max(0.0, float(e.get("hours") or 0))
    except (TypeError, ValueError):
        return 0.0


def months_view(entries: list[dict], monthly_budget: Optional[float]) -> list[dict]:
    by: dict[str, dict] = {}
    for e in entries:
        m = e["date"][:7]
        row = by.setdefault(m, {"month": m, "income": 0.0, "spent": 0.0, "saved": 0.0, "budget": None, "entries": 0})
        row["entries"] += 1
        a = _amount(e)
        if e["kind"] == "income":
            row["income"] += a
        elif e["kind"] == "expense":
            row["spent"] += a
        elif e["kind"] == "saving":
            row["saved"] += a
        elif e["kind"] == "budget":
            row["budget"] = a                            # the latest budget entry of the month wins
        elif e["kind"] == "experiment":
            row["income"] += a                           # experiment earnings are income too
    out = []
    for m in sorted(by):
        r = by[m]
        budget = r["budget"] if r["budget"] is not None else monthly_budget
        out.append({**r, "budget": budget,
                    "savings_rate": round(r["saved"] / r["income"], 3) if r["income"] > 0 else None,
                    "budget_left": round(budget - r["spent"], 2) if budget is not None else None})
    return out


def score_experiment(x: dict, logged: list[dict], today: str, usd_inr: Optional[float]) -> dict:
    hours = sum(_hours(e) for e in logged)
    earned = sum(_amount(e) for e in logged)
    first = min((e["date"] for e in logged), default=None)
    weeks = days_between(first, today) // 7 if first else 0
    after = x.get("review_after_weeks") or 4
    rph = round(earned / hours, 1) if hours > 0 else None
    ref, ref_from = None, None
    if x.get("inr_per_hour"):
        ref, ref_from = x["inr_per_hour"][0], f"its assumed {inr(x['inr_per_hour'][0])}/h (low end, from the inputs)"
    elif x.get("usd_per_hour_ref") and usd_inr:
        ref = round(x["usd_per_hour_ref"] * usd_inr, 1)
        ref_from = f"USD {x['usd_per_hour_ref']:g}/h at the inputs' rate of {usd_inr:g} = {inr(ref)}/h"
    if not logged:
        verdict, scored = "not started: no hours logged yet", False
    elif hours == 0:
        verdict, scored = "no hours logged, so no rupees per hour", False
    elif weeks < after:
        verdict, scored = f"too early: {weeks} of {after} weeks logged (so far {inr(rph)}/h)", False
    else:
        scored = True
        if ref is None:
            verdict = f"{inr(rph)}/h over {hours:g} h; no reference rate in the inputs to compare with"
        else:
            verdict = f"{inr(rph)}/h over {hours:g} h: {'at or above' if rph >= ref else 'below'} {ref_from}"
    expect = {k: x[k] for k in ("inr_total", "inr_per_month", "inr_per_hour", "usd_per_hour_ref", "probability") if x.get(k) is not None}
    return {"id": x["id"], "type": x.get("type"), "status": x.get("status") or ("running" if logged else "planned"),
            "start": x.get("start"), "hours": round(hours, 2), "earned": round(earned, 2), "weeks": weeks,
            "review_after_weeks": after, "rupees_per_hour": rph, "scored": scored, "verdict": verdict,
            "expected_from_inputs": expect, "assumption": x.get("assumption") or ("unverified: from the inputs" if expect else None)}


def money(inputs: dict, today: str, entries: Optional[list[dict]] = None) -> dict:
    cfg = inputs.get("money") or {}
    ass = cfg.get("assumptions") or {}
    ents = sorted((e for e in entries or [] if isinstance(e, dict) and e.get("kind") in KINDS and isinstance(e.get("date"), str)
                   and e["date"] <= today), key=lambda e: (e["date"], str(e.get("kind"))))
    months = months_view(ents, cfg.get("monthly_budget"))
    cur = next((m for m in months if m["month"] == today[:7]), None)

    exps = []
    known = set()
    for x in inputs.get("income_experiments") or []:
        known.add(x["id"])
        exps.append(score_experiment(x, [e for e in ents if e["kind"] == "experiment" and e.get("experiment") == x["id"]],
                                     today, ass.get("usd_inr")))
    for xid in sorted({str(e.get("experiment")) for e in ents if e["kind"] == "experiment" and e.get("experiment")} - known):
        exps.append(score_experiment({"id": xid, "type": "logged only"},
                                     [e for e in ents if e["kind"] == "experiment" and e.get("experiment") == xid], today, ass.get("usd_inr")))

    saved_months = [m for m in months if m["saved"] > 0 or m["income"] > 0]
    monthly = round(sum(m["saved"] for m in saved_months) / len(saved_months), 2) if saved_months else None
    r = ass.get("annual_return_pct")
    lines = []
    for y in HORIZONS:
        row = {"years": y, "at_0_pct": round(monthly * 12 * y, 0) if monthly is not None else None, "at_assumed": None}
        if monthly is not None and r is not None:
            i = r / 100 / 12
            row["at_assumed"] = round(monthly * (((1 + i) ** (12 * y) - 1) / i) if i else monthly * 12 * y, 0)
        lines.append(row)
    assumptions = [
        f"monthly saving: {inr(monthly)} = the average over {plural(len(saved_months), 'month')} with income or savings logged"
        if monthly is not None else "monthly saving: unknown (nothing logged yet)",
        f"annual return: {r:g}% a year, compounded monthly (from the inputs, an assumption, not a forecast)"
        if r is not None else "annual return: not set in the inputs, so only the 0% line is shown",
        "no inflation, tax, fees or changes in income are modelled",
    ]
    if ass.get("usd_inr"):
        assumptions.append(f"exchange rate: {ass['usd_inr']:g} rupees per US dollar (from the inputs)")
    year_income = sum(m["income"] for m in months if m["month"] > f"{int(today[:4]) - 1}{today[4:7]}")
    goals = []
    for g in inputs.get("goals") or []:
        if g.get("kind") != "income" or not isinstance(g.get("target"), (int, float)) or not g.get("deadline"):
            continue
        years = max(0.0, days_between(today, g["deadline"]) / 365.25)
        need = None
        if year_income > 0 and years > 0:
            need = round(((g["target"] / year_income) ** (1 / years) - 1) * 100, 1)
        goals.append({"id": g["id"], "title": g["title"], "target": g["target"], "by": g["deadline"], "years_left": round(years, 1),
                      "income_last_12_months": round(year_income, 0), "growth_needed_pct_per_year": need,
                      "explain": (f"From {inr(year_income)} logged in the last 12 months to {inr(g['target'])} a year by "
                                  f"{g['deadline']} needs {need}% growth a year." if need is not None else
                                  f"{inr(g['target'])} a year by {g['deadline']}: the growth needed is unknown, "
                                  "because no income is logged in the last 12 months.")})
    scored = [x for x in exps if x["scored"]]
    if cur:
        say = (f"This month: {inr(cur['income'])} in, {inr(cur['spent'])} spent, {inr(cur['saved'])} saved"
               + (f", a savings rate of {round(cur['savings_rate'] * 100)}%." if cur["savings_rate"] is not None else "; no income logged, so no savings rate."))
    else:
        say = "Nothing logged this month yet, so the budget and the savings rate are unknown."
    if scored:
        best = max(scored, key=lambda x: (x["rupees_per_hour"] or 0, x["id"]))
        say += f" Best scored experiment: {best['id']} at {inr(best['rupees_per_hour'])} an hour."
    return {"engine": "money", "version": 1, "status": "ok", "date": today, "label": LABEL, "advice": False,
            "months": months, "this_month": cur, "experiments": exps,
            "projection": {"lines": lines, "assumptions": assumptions}, "income_goals": goals, "say": say}


ENGINE = EngineSpec(
    name="money", version=1, fn=money,
    about="Budget and savings by month, income experiments in rupees per hour after four weeks, a projection with its assumptions. Education only.",
    needs=("money log entries", "income experiments", "assumptions written in the inputs"),
    inputs={"income_experiments": {"type": "list", "items": {"type": "dict", "required": {"id": {"type": "str"}}}},
            "money": {"type": "dict", "required": {"assumptions": {"type": "dict"}}},
            "goals": {"type": "list"}},
    data={"entries": {"type": "list", "items": {"type": "dict", "required": {"date": {"type": "date"}, "kind": {"type": "str"}}}}},
)
