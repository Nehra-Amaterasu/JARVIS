"""Director: one ordered list of what to do next, made from the other engines.

    director(inputs, today, exams=None, sessions=None, learning=None, body=None) -> dict

Each argument is that engine's own answer (ww_exams, ww_sessions, ww_learning,
ww_body), so the director adds no new guesses about him: it only orders what the
engines already say, by three rules.

  1. Exam window (a paper within EXAM_WINDOW days): today's study blocks come
     first. Building (JARVIS, Aankhen, Well Wisher) is capped at
     study.build_cap_exam minutes a day (60 by default) until today's study is
     logged. Past the cap the director says so once, without blame, and points
     at the next study block.
  2. Small daily items that keep compounding go next: the recall that is due
     (about 5 minutes), habits not yet ticked today.
  3. Outside the window, or once today's study is logged, the build block gets
     what is left of study.build_cap (180 by default), starting where the last
     session stopped.

A practice paper under its target moves that paper's line up with a reason.
Advice only; nothing here changes the plan. Pure.
"""
from __future__ import annotations

from typing import Optional

from .ww_base import EngineSpec, plural

EXAM_WINDOW = 14


def _hm(m: int) -> str:
    return f"{m // 60} h {m % 60:02d}" if m >= 60 else f"{m} min"


def director(inputs: dict, today: str, exams: Optional[dict] = None, sessions: Optional[dict] = None,
             learning: Optional[dict] = None, body: Optional[dict] = None) -> dict:
    study = inputs.get("study") or {}
    cap_exam = int(study.get("build_cap_exam", 60))
    cap = int(study.get("build_cap", 180))
    papers = (exams or {}).get("papers") or []
    nxt = papers[0] if papers else None
    window = bool(nxt and nxt["days_left"] <= EXAM_WINDOW)
    day = next((d for d in (exams or {}).get("days") or [] if d["date"] == today), None)
    blocks = [b for s in (day or {}).get("slots", []) for b in s["blocks"]]
    study_left = sum(b["minutes"] for b in blocks)
    built = int((sessions or {}).get("today_minutes") or 0)
    steps: list[dict] = []

    under = {p["id"]: p for p in papers if p.get("paper_score") and p.get("target")
             and p["paper_score"]["score"] / p["paper_score"]["max"] < p["target"] / (p.get("max") or 20)}
    blocks.sort(key=lambda b: (b["paper"] not in under,))
    for b in blocks[:3]:
        f = b["focus"][0] if b["focus"] else {"title": "revise"}
        p = next((x for x in papers if x["id"] == b["paper"]), {})
        why = f"{p.get('title', b['title'])} in {plural(p.get('days_left', 0), 'day')}"
        if b["paper"] in under:
            s = p["paper_score"]
            why += f"; the practice paper was {s['score']}/{s['max']}, under your {p['target']}"
        steps.append({"kind": "study", "paper": b["paper"], "title": f"{b['title']}: {f['title']}", "minutes": b["minutes"], "why": why})

    room = max(0, (cap_exam if window and study_left else cap) - built)
    note = None
    if window and study_left and built > cap_exam:
        note = (f"{_hm(built)} of building today, past the {_hm(cap_exam)} exam-week cap. "
                f"The next block is {steps[0]['title'] if steps else 'study'}; the code will keep.")

    for d in ((learning or {}).get("due") or [])[:1]:
        steps.append({"kind": "recall", "title": f"Recall: {d['title']}", "minutes": 5, "why": d.get("question", "")})
    for h in [h for h in (body or {}).get("habits") or [] if not h.get("today_done")][:2]:
        steps.append({"kind": "habit", "title": h.get("target") or h["id"], "minutes": 10, "why": f"{h['done_this_week']}/{h['per_week']} this week"})

    last = ((sessions or {}).get("sessions") or [None])[0]
    if room:
        steps.append({"kind": "build", "title": f"Build: {last['main_area']}" if last else "Build",
                      "minutes": room, "why": ("after today's study" if window and study_left else "the rest of today's build budget")
                      + (f"; last session: {last['subjects'][0]}" if last and last.get("subjects") else "")})

    split = {"study": study_left, "build": room, "built_today": built}
    if window:
        say = (f"Exam week: {_hm(study_left)} of study left today, then up to {_hm(room)} of building."
               if study_left else f"Today's study is done. Up to {_hm(room)} of building is yours.")
    else:
        say = f"No paper within {EXAM_WINDOW} days: up to {_hm(room)} of building today."
    if steps:
        say += f" First: {steps[0]['title']}."
    return {"engine": "director", "version": 1, "status": "ok", "date": today, "mode": "exam" if window else "normal",
            "steps": steps, "split": split, "note": note, "say": say,
            "rule": f"In exam week study comes first and building is capped at {_hm(cap_exam)} until today's study is logged; "
                    f"otherwise building gets up to {_hm(cap)}. Change both in Settings, Study time."}


ENGINE = EngineSpec(
    name="director", version=1, fn=director,
    about="One ordered list for today, merged from the exams, sessions, learning and body engines.",
    needs=("the other engines' answers",),
    inputs={"study": {"type": "dict"}},
    data={k: {"type": "dict"} for k in ("exams", "sessions", "learning", "body")},
)
