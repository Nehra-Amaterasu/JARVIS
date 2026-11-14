"""Well Wisher's gate: the checks that keep the engines, the routes and the pages honest.

    python -m jarvis_app.ww_check          report on the real inputs (read-only) + a stress run,
                                           printed and appended to data/notes/well-wisher/checks/
    tests/test_ww_gate.py                  the same checks on synthetic data, in the suite

Three kinds of drift it catches, each one a thing that happened here before:
  1. route drift: a route in a module's docstring table that no decorator defines, or a path
     the UI calls that no route serves (the blob-link opener, the Internals card after the
     end-sems: the page looked alive while the server said 404 or nothing);
  2. engine drift: an engine that is not pure (two runs, two answers), an allocation that
     hands out more minutes than a slot has, a margin that disagrees with its own formula;
  3. budget drift: an engine that got slow (exams over 20 papers and 800 topics, attendance
     over 3,000 taps) so Today would wait on it.
Every number in the report is measured in that run; nothing is estimated.
"""
from __future__ import annotations

import glob
import json
import os
import random
import re
import time
from datetime import date
from pathlib import Path
from typing import Any, Optional

from . import ww_engines, ww_generator
from .ww_attendance import margin
from .ww_base import add_days

APP_DIR = Path(__file__).resolve().parent
UI_DIRS = (APP_DIR.parent / "ui" / "src" / "germoney", APP_DIR / "phone_page")
ROUTE_FILES = sorted(APP_DIR.glob("*.py"))          # server.py defines routes too (/api/kv, /api/game/result)
DOC_FILES = (APP_DIR / "routes_mission.py", APP_DIR / "routes_ww_resources.py", APP_DIR / "routes_ww_knowledge.py", APP_DIR / "routes_phone_ww.py", APP_DIR / "routes_phone.py")
# The question engine (wave EW7) keeps its route table in each routes_ww_pyq*.py docstring; the glob takes a new file in without an edit here.
DOC_FILES += tuple(sorted(APP_DIR.glob("routes_ww_pyq*.py")))

_DECOR = re.compile(r"@app\.(get|post|put|delete|patch)\(\s*\"([^\"]+)\"")
_DOCROW = re.compile(r"^\s{2,}(GET|POST|PUT|DELETE|PATCH)\s+((?:/api/|/phone)\S*)", re.M)
_UICALL = re.compile(r"[`'\"](/api/[^`'\"\s?]*)")
_WS_OR_HEALTH = ("/ws/", "/api/health")


# ------------------------------------------------------------------ 1. routes
def routes_defined() -> set[tuple[str, str]]:
    out = set()
    for f in ROUTE_FILES:
        for m, p in _DECOR.findall(f.read_text(encoding="utf-8")):
            out.add((m.upper(), p))
    return out


def routes_documented() -> set[tuple[str, str]]:
    out = set()
    for f in DOC_FILES:
        src = f.read_text(encoding="utf-8")
        doc = src.split('"""', 2)[1] if src.count('"""') >= 2 else ""
        for m, p in _DOCROW.findall(doc):
            out.add((m, p.split("?")[0].rstrip(",")))      # a documented "?paper=<id>" is not part of the path
    return out


def ui_calls() -> dict[str, list[str]]:
    """Every /api path literal in the Well Wisher UI and the phone pages, with the files that use it.
    A template hole `${x}` becomes a path parameter; a literal ending in '/' is a prefix."""
    out: dict[str, set[str]] = {}
    for d in UI_DIRS:
        for f in glob.glob(str(d / "**" / "*"), recursive=True):
            if not f.endswith((".ts", ".tsx", ".js")) or "__tests__" in f or f.endswith(".test.ts"):
                continue
            text = Path(f).read_text(encoding="utf-8", errors="replace")
            for p in _UICALL.findall(text):
                p = re.sub(r"\$\{[^}]*\}", "{p}", p)
                if "${" in p:                        # an unclosed hole: the literal ends at the hole
                    p = p.split("${")[0]
                out.setdefault(p, set()).add(os.path.relpath(f, APP_DIR.parent))
    return {k: sorted(v) for k, v in out.items()}


def _pattern(route: str) -> re.Pattern:
    return re.compile("^" + re.sub(r"\{[^}]+\}", r"[^/]+", re.escape(route).replace(r"\{", "{").replace(r"\}", "}")) + "$")


def route_drift() -> dict:
    defined = routes_defined()
    documented = routes_documented()
    pats = [(m, p, _pattern(p)) for m, p in defined]
    undocumented_defs = []     # informative only: not every route needs a docstring row
    doc_without_route = sorted(f"{m} {p}" for m, p in documented
                               if not any(m == dm and dp.match(p) for dm, _, dp in pats))
    ui_without_route = []
    for p, files in ui_calls().items():
        if p.startswith(_WS_OR_HEALTH):
            continue
        if p.endswith("/"):
            ok = any(dp_path.startswith(p) for _, dp_path, _ in pats)
        else:
            ok = any(dp.match(p) for _, _, dp in pats)
        if not ok:
            ui_without_route.append(f"{p}  ({', '.join(files)})")
    return {"defined": len(defined), "documented": len(documented), "ui_paths": len(ui_calls()),
            "doc_without_route": doc_without_route, "ui_without_route": sorted(ui_without_route),
            "undocumented_defs": undocumented_defs}


# ------------------------------------------------------------------ 2. engines
def engine_smoke(inputs: dict, today: str) -> dict:
    """Every registered engine runs with no data, twice, and gives the same dict."""
    bad, slow = [], {}
    for name in ww_engines.REGISTRY:
        t0 = time.perf_counter()
        a = ww_engines.run(name, inputs, today)
        b = ww_engines.run(name, inputs, today)
        slow[name] = round((time.perf_counter() - t0) / 2 * 1000, 1)
        if not isinstance(a, dict) or a.get("engine") != name or "status" not in a:
            bad.append(f"{name}: not an engine answer")
        elif a != b:
            bad.append(f"{name}: two runs differ (not pure)")
    return {"engines": len(ww_engines.REGISTRY), "problems": bad, "ms": slow}


def schema_consistency() -> list[str]:
    """Each engine's declared input sections exist in the normalized inputs."""
    norm = ww_engines.normalize_inputs({})
    return [f"{spec.name}: declares input '{k}' that normalize_inputs never produces"
            for spec in ww_engines.REGISTRY.values() for k in spec.inputs if k not in norm]


def exams_invariants(out: dict) -> list[str]:
    """What must hold in any exams answer, whatever the data."""
    p = []
    if out.get("status") != "ok":
        return [f"exams status {out.get('status')}: {out.get('problems')}"]
    papers = out.get("papers") or []
    planned = {r["id"]: 0 for r in papers}
    last_day = None
    for d in out.get("days") or []:
        if last_day and d["date"] <= last_day:
            p.append(f"days out of order at {d['date']}")
        last_day = d["date"]
        if papers and d["date"] > max(r["date"] for r in papers):
            p.append(f"a planned day {d['date']} after the last paper")
        for s in d["slots"]:
            used = sum(b["minutes"] for b in s["blocks"])
            if used > s["minutes"] + 1e-9:
                p.append(f"{d['date']} {s['label']}: {used} min planned in a {s['minutes']} min slot")
            for b in s["blocks"]:
                if b["minutes"] <= 0:
                    p.append(f"{d['date']}: a zero-minute block for {b['paper']}")
                if abs(sum(f["minutes"] for f in b["focus"]) - b["minutes"]) > 1e-9:
                    p.append(f"{d['date']} {b['paper']}: focus items do not add up to the block")
                planned[b["paper"]] = planned.get(b["paper"], 0) + b["minutes"]
    for r in papers:
        if r.get("planned_minutes") != planned.get(r["id"], 0):
            p.append(f"{r['id']}: planned_minutes {r.get('planned_minutes')} but the blocks hold {planned.get(r['id'], 0)}")
        if r["coverage"] is not None and not 0 <= r["coverage"] <= 1:
            p.append(f"{r['id']}: coverage {r['coverage']} outside 0..1")
        f = r.get("forecast") or {}
        if f and not (0 <= f["half_plan"] <= f["full_plan"] <= 1):
            p.append(f"{r['id']}: forecast {f['half_plan']}..{f['full_plan']} is not a rising range in 0..1")
    ids = [r["id"] for r in papers]
    if sorted(set(sum((g["ids"] for g in out.get("groups") or []), []))) != sorted(ids):
        p.append("groups do not partition the papers")
    return p


def attendance_invariants(out: dict, threshold: Optional[float] = None) -> list[str]:
    p = []
    if out.get("status") != "ok":
        return [f"attendance status {out.get('status')}"]
    t = threshold if threshold is not None else float((out.get("rule") or {}).get("threshold") or 0.75)
    for r in out.get("subjects") or []:
        A, N = r["attended"], r["held"]
        if N and not 0 <= r["pct"] <= 1:
            p.append(f"{r['subject']}: pct {r['pct']}")
        if r["can_miss"] and r["need"]:
            p.append(f"{r['subject']}: both margin and need are set")
        if r["can_miss"]:
            S = r["can_miss"]
            if not (A / (N + S) >= t - 1e-9 and A / (N + S + 1) < t):
                p.append(f"{r['subject']}: margin {S} is not the largest S with A/(N+S) >= t ({A}/{N})")
        if r["need"]:
            R = r["need"]
            if not ((A + R) / (N + R) >= t - 1e-9 and (A + R - 1) / (N + R - 1) < t):
                p.append(f"{r['subject']}: need {R} is not the smallest R with (A+R)/(N+R) >= t ({A}/{N})")
    return p


def margin_sweep(threshold: float = 0.75, upto: int = 60) -> list[str]:
    """Every (attended, held) pair to `upto`: the closed form agrees with brute force."""
    p = []
    for N in range(1, upto + 1):
        for A in range(0, N + 1):
            m = margin(A, N, threshold)
            s = 0
            while A / (N + s + 1) >= threshold:
                s += 1
            r = 0
            while (A + r) / (N + r) < threshold:
                r += 1
            if A / N >= threshold and m["can_miss"] != s or A / N < threshold and m["need"] != r:
                p.append(f"A={A} N={N}: closed form {m} vs brute force miss={s} need={r}")
    return p


# ------------------------------------------------------------------ 3. budgets (stress)
def synthetic_exams(n_papers: int = 20, topics_per_unit: int = 8, today: str = "2026-11-08", seed: int = 1) -> tuple[dict, list, dict]:
    rnd = random.Random(seed)
    sheet, subjects, prep = [], [], {}
    for i in range(n_papers):
        sid = f"s{i}"
        units = [{"n": u, "title": f"U{u}", "exam_weight": rnd.choice(["high", "med", "low"]),
                  "topics": [f"t{u}-{k}" for k in range(topics_per_unit)]} for u in range(1, 6)]
        subjects.append({"id": sid, "name": f"Subject {i}", "units": units})
        sheet.append({"id": f"p{i}", "subject": sid, "title": f"Paper {i}", "date": add_days(today, 3 + i * 3 + rnd.randint(0, 1)),
                      "start": rnd.choice(["10:00", "14:00"]), "end": None, "units": [], "kind": rnd.choice(["end_sem", "backlog", "cie"]),
                      "max": 60, "target": 40})
        prep[sid] = {"topics": {f"{u}|t{u}-{k}": {"state": rnd.choice(["learned", "solid"]), "date": today}
                                for u in range(1, 6) for k in range(topics_per_unit) if rnd.random() < 0.4},
                     "minutes": [{"date": add_days(today, -d), "minutes": rnd.randint(20, 120)} for d in range(30)]}
    return ww_engines.normalize_inputs({"exams": sheet}), subjects, prep


def synthetic_attendance(n_taps: int = 3000, today: str = "2026-11-08", seed: int = 1) -> tuple[dict, dict]:
    rnd = random.Random(seed)
    days = ("mon", "tue", "wed", "thu", "fri")
    slots = [{"day": d, "start": f"{8 + h:02d}:45", "end": f"{9 + h:02d}:45", "subject": f"s{(h + i) % 7}"} for i, d in enumerate(days) for h in range(5)]
    inputs = ww_engines.normalize_inputs({"timetable": {"slots": slots}})
    log: dict[str, list] = {}
    for _ in range(n_taps):
        s = rnd.choice(inputs["timetable"]["slots"])
        log.setdefault(s["subject"], []).append({"date": add_days(today, -rnd.randint(0, 120)), "slot": s["id"],
                                                 "status": rnd.choice(["present", "present", "present", "absent", "cancelled"])})
    return inputs, log


def stress(today: str = "2026-11-08") -> dict:
    inputs, subjects, prep = synthetic_exams(today=today)
    t0 = time.perf_counter()
    ex = ww_engines.run("exams", inputs, today, subjects=subjects, prep=prep)
    t_ex = time.perf_counter() - t0
    ai, log = synthetic_attendance(today=today)
    t0 = time.perf_counter()
    at = ww_engines.run("attendance", ai, today, log=log)
    t_at = time.perf_counter() - t0
    return {"exams": {"papers": len(ex.get("papers") or []), "topics": sum(len(p["topics"]) for p in ex.get("papers") or []),
                      "days": len(ex.get("days") or []), "seconds": round(t_ex, 3), "problems": exams_invariants(ex)},
            "attendance": {"taps": sum(len(v) for v in log.values()), "subjects": len(at.get("subjects") or []),
                           "seconds": round(t_at, 3), "problems": attendance_invariants(at)}}


def generator_sweep(seeds: int = 50) -> dict:
    """A synthetic bank, many seeds: every paper fits the pattern, the same seed repeats,
    the weak topic is asked more than the solid one. The generator's own gate."""
    units = [{"n": u, "title": f"U{u}", "exam_weight": w, "topics": [f"t{u}a", f"t{u}b"]} for u, w in ((1, "high"), (2, "med"), (3, "low"))]
    bank, i = [], 0
    for sec, n, mk in zip("ABC", (12, 24, 12), (2, 7, 5)):
        for k in range(n):
            u = 1 + k % 3
            bank.append({"id": f"q{i}", "unit": u, "topic": f"t{u}{'ab'[k % 2]}", "question": f"Q{i}", "marks": mk, "type": "pyq_see",
                         "section": sec, "sitting": ("Jun 2026", "Dec 2025")[k % 2]})
            i += 1
    exam = {"id": "x", "subject": "x", "title": "X", "units": [], "max": 60, "pattern": ww_generator.DEFAULT_PATTERN}
    states = {f"{q['unit']}|{q['topic']}": {"state": "solid"} for q in bank if q["topic"] != "t1a"}
    problems, asked = [], {"t1a": 0, "t1b": 0}
    t0 = time.perf_counter()
    for seed in range(seeds):
        a = ww_generator.generate(exam, bank, units, states, {}, seed=seed)
        problems += [f"seed {seed}: {x}" for x in ww_generator.paper_invariants(a, exam)]
        if a != ww_generator.generate(exam, bank, units, states, {}, seed=seed):
            problems.append(f"seed {seed}: not repeatable")
        for sct in a["sections"]:
            for q in sct["questions"]:
                if q["topic"] in asked:
                    asked[q["topic"]] += 1
    if not asked["t1a"] > asked["t1b"]:
        problems.append(f"the weak topic was asked {asked['t1a']} times, the solid one {asked['t1b']}")
    scaled = scaled_pattern_sweep(bank, units, seeds=5)
    problems += scaled["problems"]
    # An empty bank says so, and a gate request with no gate question is an exam paper that says so (STUDY-05, STUDY-06).
    empty = ww_generator.generate(exam, [], units, {}, {}, seed=0)
    if not (empty["empty"] is True and empty["bank_size"] == 0):
        problems.append("an empty bank did not answer empty: true")
    gate = ww_generator.generate(exam, bank, units, {}, {}, seed=0, tier="gate")
    if not (gate["tier"] == "exam" and gate["tier_requested"] == "gate" and gate["tier_note"]):
        problems.append("a gate request without gate questions did not say it was an exam paper")
    if any("GATE" in x for x in gate["shortfall"]):
        problems.append("a gate request implied gate questions exist")
    return {"seeds": seeds, "seconds": round(time.perf_counter() - t0, 3), "asked": asked, "scaled": scaled, "problems": problems[:10]}


def scaled_pattern_sweep(bank: list, units: list, seeds: int = 5) -> dict:
    """A paper with no typed pattern is its row's maximum, whatever the maximum: every whole and
    half mark from 0.5 to 300 sums exactly, and a real paper built on a few common CIE maximums
    passes the same invariants as a typed one. 600 maximums take under 0.1 s, so all are checked."""
    problems, maxes = [], [x / 2 for x in range(1, 601)]
    for mx in maxes:
        p = ww_generator.scale_pattern(mx)
        if not p or abs(sum(s["attempt"] * s["marks"] for s in p) - mx) > 1e-9:
            problems.append(f"max {mx:g}: scaled pattern does not sum to the maximum")
    for mx in (10, 15, 20, 25, 30, 40, 50, 100):
        row = {"id": "cie", "subject": "x", "title": "CIE", "units": [], "max": mx}
        for seed in range(seeds):
            a = ww_generator.generate(row, bank, units, {}, {}, seed=seed)
            bad = ww_generator.paper_invariants(a, row)
            if bad or a["total_marks"] != mx or not a["pattern_missing"]:
                problems.append(f"{mx}-mark paper, seed {seed}: {bad or a['total_marks']}")
    return {"maxes": len(maxes), "papers": 8 * seeds, "problems": problems[:10]}


def marks_loop(today: str = "2026-11-09") -> dict:
    """The exam loop the Study page promises: a paper is generated, marked, and the next paper
    weighs the marked topic less. Run end to end on a scratch store and a scratch inputs file
    (never his data): 36 synthetic questions on two topics, one paper, every question of its most
    asked topic marked in full, then 30 seeds before and after. It also records whether the exams
    engine's own plan changed, because the Study page may only say "tomorrow's blocks changed"
    when that is true: marks move paper practice, and the block plan reads topic taps, not marks."""
    import tempfile
    from . import germoney
    subject = {"id": "loop", "name": "Loop Subject", "units": [{"n": 1, "title": "Only", "exam_weight": "high", "topics": ["a", "b"]}],
               "question_bank": [{"unit": 1, "topic": "ab"[k % 2], "question": f"Loop question {k}", "marks": (2, 7, 5)[k // 12],
                                  "section": "ABC"[k // 12], "tier": "exam"} for k in range(36)]}
    row = {"id": "loop-exam", "subject": "loop", "title": "Loop exam", "date": add_days(today, 14), "kind": "end_sem", "max": 60, "target": 40}
    problems: list[str] = []
    old = os.environ.get("JARVIS_ENGINE_INPUTS")
    with tempfile.TemporaryDirectory() as td:
        d = Path(td)
        (d / "inputs.json").write_text(json.dumps({"exams": [row], "subjects": [subject]}), encoding="utf-8")
        os.environ["JARVIS_ENGINE_INPUTS"] = str(d / "inputs.json")
        try:
            plan = germoney.Plan(germoney.KVStore(d / "kv", d / "bk"), bank_loader=lambda: germoney.merge_bank({}), academics_loader=lambda: None,
                                 apps=germoney.Applications(calendar=d / "no-calendar.json", store=d / "apps.json"))

            def shares(n: int = 30) -> dict:
                c = {"a": 0, "b": 0}
                for seed in range(n):
                    for s in plan.practice_paper("loop-exam", seed=seed, today=today)["sections"]:
                        for q in s["questions"]:
                            c[q["topic"]] += 1
                return c

            def weights() -> dict:
                st = plan.load(today)
                sub = next(s for s in plan.academics()["subjects"] if s["id"] == "loop")
                prof = ww_generator.proficiency(((st.get("exam_prep") or {}).get("loop") or {}).get("topics") or {}, (st.get("paper_marks") or {}).get("loop") or {},
                                                [ww_generator.topic_key(q["unit"], q["topic"]) for q in sub["question_bank"]])
                w = ww_generator.topic_weights(sub["question_bank"], sub["units"], prof, papers=1)
                return {k.split("|")[1]: round(v, 4) for k, v in w.items()}, prof

            paper = plan.practice_paper("loop-exam", seed=1, today=today)
            qs = [q for s in paper["sections"] for q in s["questions"]]
            topic = max("ab", key=lambda t: sum(1 for q in qs if q["topic"] == t))
            w_before, prof_before = weights()
            share_before = shares()
            plan_before = plan.engine("exams", today)
            marked = [q for q in qs if q["topic"] == topic]
            res = plan.paper_marks("loop-exam", {"items": [{"id": q["id"], "got": q["bank_marks"]} for q in marked], "seed": 1}, today=today)
            w_after, prof_after = weights()
            share_after = shares()
            plan_after = plan.engine("exams", today)
            key = ww_generator.topic_key(1, topic)
            row_after = next(p for p in plan_after["papers"] if p["id"] == "loop-exam")
            if res["saved"] != len(marked):
                problems.append(f"saved {res['saved']} of {len(marked)} marks")
            if not prof_after[key] > prof_before[key]:
                problems.append(f"proficiency of {topic} did not rise ({prof_before[key]} -> {prof_after[key]})")
            if not w_after[topic] < w_before[topic]:
                problems.append(f"the weight of {topic} did not fall ({w_before[topic]} -> {w_after[topic]})")
            if not share_after[topic] < share_before[topic]:
                problems.append(f"{topic} was asked {share_after[topic]} times after marking, {share_before[topic]} before")
            if not (row_after.get("paper_score") or {}).get("score"):
                problems.append("the exams engine does not show the measured paper score")
            out = {"topic": topic, "marked": len(marked), "p": [prof_before[key], prof_after[key]], "weight": [w_before[topic], w_after[topic]],
                   "asked_in_30_papers": [share_before[topic], share_after[topic]], "score": res["score"], "of": res["max"],
                   "exams_plan_changed": plan_before.get("days") != plan_after.get("days"), "problems": problems}
        finally:
            if old is None:
                os.environ.pop("JARVIS_ENGINE_INPUTS", None)
            else:
                os.environ["JARVIS_ENGINE_INPUTS"] = old
    return out


BUDGET_S = {"exams": 3.0, "attendance": 1.0, "generator": 2.0}


def _dmat(seeds: int = 40) -> dict:
    """The dMAT solvers re-prove every generated key. 40 seeds (360 items) costs the gate about 2.4 s;
    the full 200-seed sweep (1800 items, about 10 s) runs as python -m jarvis_app.ww_check_dmat."""
    from . import ww_check_dmat
    r = ww_check_dmat.sweep(seeds)
    return {"seeds": r["seeds"], "items": sum(k["items"] for k in r["kinds"].values()),
            "seconds": r["seconds"], "problems": r["problems"][:10]}


def _numericals(seeds: int = 20) -> dict:
    """The numericals' keys re-derived by the independent checker (no sympy; simulations and root-finding).
    20 seeds x 13 templates = 260 items; the full 200-seed sweep runs as python -m jarvis_app.ww_check_numericals."""
    from . import ww_check_numericals
    r = ww_check_numericals.sweep(seeds)
    return {"seeds": r["seeds"], "templates": len(r["kinds"]), "items": sum(k["items"] for k in r["kinds"].values()),
            "seconds": r["seconds"], "problems": r["problems"][:10]}


def _depth() -> dict:
    """Resource checklists and the knowledge cards on fictional fixtures (ww_check_depth.py): counts from taps,
    weekly sums, marks kept on a re-type, no repeat inside the window, empty pools said in words."""
    from . import ww_check_depth
    r = ww_check_depth.run()
    return {"cases": r["cases"], "seconds": r["seconds"], "problems": r["problems"][:10]}


def _harvest() -> dict:
    """The harvester's gate cases on recorded fixtures: no network, a scratch bank."""
    from . import ww_check_harvest
    r = ww_check_harvest.run()
    return {"cases": r["cases"], "problems": r["problems"][:10], "pdf_reader": r["pdf_reader"]}


# ------------------------------------------------------------------ the report
def report(plan=None, today: Optional[str] = None) -> dict:
    """All checks; `plan` (a germoney.Plan) adds the real engines' answers, read-only."""
    today = today or date.today().isoformat()
    inputs = ww_engines.load_inputs() if plan is not None else ww_engines.normalize_inputs({})
    out: dict[str, Any] = {"date": today, "routes": route_drift(), "schema": schema_consistency(),
                           "smoke": engine_smoke(inputs, today), "margin_sweep": margin_sweep(), "stress": stress(today),
                           "generator": generator_sweep(), "marks_loop": marks_loop(today),
                           "dmat": _dmat(), "numericals": _numericals(), "harvest": _harvest(), "depth": _depth()}
    if plan is not None:
        ex = plan.engine("exams", today)
        at = plan.engine("attendance", today)
        taps = sum(len((r.get("topics") or {})) for r in (plan.load(today).get("exam_prep") or {}).values())
        out["real"] = {"papers": len(ex.get("papers") or []), "groups": [(g["kind"], g["count"]) for g in ex.get("groups") or []],
                       "work_h": round(sum(p["work_minutes"] for p in ex.get("papers") or []) / 60, 1),
                       "planned_h": round(sum(p["planned_minutes"] for p in ex.get("papers") or []) / 60, 1),
                       "topic_taps": taps, "classes_tapped": sum(r["held"] for r in at.get("subjects") or []),
                       "exams_problems": exams_invariants(ex), "attendance_problems": attendance_invariants(at),
                       "risks": ex.get("risks") or []}
    out["ok"] = not (out["routes"]["doc_without_route"] or out["routes"]["ui_without_route"] or out["schema"]
                     or out["smoke"]["problems"] or out["margin_sweep"]
                     or out["stress"]["exams"]["problems"] or out["stress"]["attendance"]["problems"]
                     or out["stress"]["exams"]["seconds"] > BUDGET_S["exams"] or out["stress"]["attendance"]["seconds"] > BUDGET_S["attendance"]
                     or out["generator"]["problems"] or out["generator"]["seconds"] > BUDGET_S["generator"]
                     or out["marks_loop"]["problems"] or out["dmat"]["problems"] or out["numericals"]["problems"] or out["harvest"]["problems"] or out["depth"]["problems"]
                     or (out.get("real") or {}).get("exams_problems") or (out.get("real") or {}).get("attendance_problems"))
    return out


def as_markdown(r: dict) -> str:
    L = [f"## {r['date']}: gate {'passed' if r['ok'] else 'FAILED'}",
         f"- Routes: {r['routes']['defined']} defined, {r['routes']['documented']} documented, {r['routes']['ui_paths']} paths called by the UI; "
         f"doc without route: {r['routes']['doc_without_route'] or 'none'}; UI without route: {r['routes']['ui_without_route'] or 'none'}.",
         f"- Engines: {r['smoke']['engines']} ran twice, no data; problems: {r['smoke']['problems'] or 'none'}; schema: {r['schema'] or 'consistent'}. "
         f"Slowest: {', '.join(f'{k} {v} ms' for k, v in sorted(r['smoke']['ms'].items(), key=lambda x: -x[1])[:3])}.",
         f"- Margin formula vs brute force, every (A, N) to 60: {len(r['margin_sweep'])} disagreements.",
         f"- Stress: exams {r['stress']['exams']['papers']} papers / {r['stress']['exams']['topics']} topics / {r['stress']['exams']['days']} days in "
         f"{r['stress']['exams']['seconds']} s (budget {BUDGET_S['exams']}), problems {r['stress']['exams']['problems'] or 'none'}; "
         f"attendance {r['stress']['attendance']['taps']} taps in {r['stress']['attendance']['seconds']} s (budget {BUDGET_S['attendance']}), "
         f"problems {r['stress']['attendance']['problems'] or 'none'}."]
    g = r.get("generator") or {}
    if g:
        L.append(f"- Generator: {g['seeds']} seeds in {g['seconds']} s (budget {BUDGET_S['generator']}), weak topic asked {g['asked'].get('t1a')} vs solid {g['asked'].get('t1b')}; problems {g['problems'] or 'none'}.")
        sc = g.get("scaled") or {}
        L.append(f"- Scaled CIE pattern: {sc.get('maxes')} maximums (0.5 to 300) sum exactly, {sc.get('papers')} papers on common maximums pass the invariants; "
                 f"empty bank and gate-without-gate-questions answer honestly; problems {sc.get('problems') or 'none'}.")
    m = r.get("marks_loop")
    if m:
        L.append(f"- Marks loop (scratch store, synthetic subject): marked {m['marked']} questions of topic {m['topic']} ({m['score']:g} of {m['of']:g}); "
                 f"proficiency {m['p'][0]} -> {m['p'][1]}, topic weight {m['weight'][0]} -> {m['weight'][1]}, asked in 30 papers {m['asked_in_30_papers'][0]} -> {m['asked_in_30_papers'][1]}; "
                 f"the exams block plan {'changed' if m['exams_plan_changed'] else 'did not change'} "
                 f"(the Study line says {'blocks changed' if m['exams_plan_changed'] else 'no change to the plan'}); problems {m['problems'] or 'none'}.")
    # The dMAT and harvest checks joined the gate on 10 Nov but only reached `ok`; the printed report
    # is what goes into the dated gate file, so it names them too.
    d = r.get("dmat")
    if d:
        L.append(f"- dMAT keys re-proved by the independent solvers: {d['seeds']} seeds, {d['items']} items in {d['seconds']} s; "
                 f"mismatches {len(d['problems'])}; problems {d['problems'] or 'none'}.")
    nm = r.get("numericals")
    if nm:
        L.append(f"- Numericals (circuits and control, exam and gate tier) re-derived by the independent checker: {nm['templates']} templates, "
                 f"{nm['seeds']} seeds, {nm['items']} items in {nm['seconds']} s; mismatches {len(nm['problems'])}; problems {nm['problems'] or 'none'}.")
    h = r.get("harvest")
    if h:
        L.append(f"- Harvester on recorded fixtures (no network, scratch bank): {h['cases']} cases, PDF reader {h['pdf_reader']}; "
                 f"problems {h['problems'] or 'none'}.")
    dp = r.get("depth")
    if dp:
        L.append(f"- Depth (resource checklists, knowledge cards; fictional fixtures, in-memory store): {dp['cases']} cases in {dp['seconds']} s; "
                 f"problems {dp['problems'] or 'none'}.")
    if r.get("real"):
        x = r["real"]
        L.append(f"- Real data (read-only): {x['papers']} papers {x['groups']}, work {x['work_h']} h, planned {x['planned_h']} h, "
                 f"{x['topic_taps']} topic taps, {x['classes_tapped']} classes tapped; invariants: exams {x['exams_problems'] or 'hold'}, "
                 f"attendance {x['attendance_problems'] or 'hold'}. Risks: {len(x['risks'])}.")
    return "\n".join(L) + "\n"


def main() -> int:
    from . import germoney
    plan = germoney.Plan(germoney.KVStore())
    r = report(plan)
    md = as_markdown(r)
    print(md)
    # Beside his inputs file (data/notes/well-wisher), not under data/app: notes are his, state is the app's.
    out = ww_engines.inputs_path().parent / "checks" / f"{r['date'][:7]}.md"
    out.parent.mkdir(parents=True, exist_ok=True)
    prev = out.read_text(encoding="utf-8") if out.exists() else "# Well Wisher gate reports (newest first)\n\n"
    head, _, body = prev.partition("\n\n")
    out.write_text(f"{head}\n\n{md}\n{body}", encoding="utf-8")
    print(f"written: {out}")
    print(json.dumps({k: v for k, v in r.items() if k in ("ok",)}))
    return 0 if r["ok"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
