"""A practice paper from his reviewed questions, drawn through ww_generator (E08; plan 9.1.8).

    generate_paper(bp, exam, subject, bank, states, marks, seed, *, attempts=None, families=None, today=None)
        -> GeneratedPaper (plan 9.1.5), pure and seeded; ValueError when the blueprint does not balance
    save_generated / load_generated / list_generated     generated/<id>.json under the pyq store
    append_attempts / read_attempts                      attempts.jsonl (marks he typed, R-27)

How ww_generator.py stays unedited: it is called once, with a copy of the exam row whose `pattern`
is the blueprint's sections. Its picking (weak topics come up more, a unit already picked weighs
half) is kept as it is; this module only prepares the bank before the call and checks the seats
after it, because ww_generator knows nothing of families, recent attempts, section types or crops.

Before the call:
  - one question per family (a seeded choice; without a family map every question is its own);
  - a question attempted in the last 14 days stays in the draw with weight 0.3, as a seeded thinning
    (kept when a draw is below 0.3), so last week's question comes back about one paper in three;
  - a row keeps its section letter only when its marks equal that section's marks and the section
    allows its type; a row that fits no section by marks and type is left out (it could only be
    emptied after the draw).
After the call, a seat is emptied when its own question has other marks than the section, a type
the section does not allow, more of one unit than the section's limit, repeats a question, or is
not one of his questions at all (a harvested disk-bank row has no source word in this paper). An
empty seat takes a numerical template not already on the paper; what is still empty is a hollow
slot with a reason made of counts ("needs 1 more 7-mark question") and a line in `shortfall`.
Last, the paper in ww_generator's own shape must pass ww_generator.paper_invariants with an empty
list, or nothing is returned.

Deterministic: string-seeded random.Random (seeded through sha512, independent of PYTHONHASHSEED),
sorted iteration, no clock (`made` is set by the route), no hash() in the result.
"""
from __future__ import annotations

import hashlib
import json
import random
import re
import threading
from datetime import date
from pathlib import Path
from typing import Any, Optional, TypedDict

from .. import ww_generator, ww_numericals
from .blueprint import Blueprint, exam_issues, normalize_blueprint, validate_blueprint, write_json_atomic

HEADER = "Practice paper from your bank. Not an official paper."
RECENT_DAYS = 14            # an attempt this recent thins the question (plan 9.1.6, E08 check 5)
RECENT_KEEP = 0.3           # the weight of a recently attempted question, applied as a keep-draw
ATTEMPTS = "attempts.jsonl"
_GID = re.compile(r"^g-[0-9a-f]{12}$")
_attempts_lock = threading.Lock()
RULE = ("One question per family; a question you attempted in the last 14 days is drawn with weight 0.3; "
        "a seat takes only a question of its section's marks and types; weak topics come up more "
        "(ww_generator); numerical templates fill what your bank cannot; the same seed is the same paper.")


class Slot(TypedDict, total=False):
    n: int
    source: str                 # hand | rule | template | hollow
    question_id: Optional[str]
    text: str
    has_crop: bool
    marks: float
    unit: Optional[int]
    topic: str
    type: str
    reason: str
    key: str                    # template slots only


class GeneratedPaper(TypedDict, total=False):
    id: str
    exam: str
    subject: str
    title: str
    seed: int
    made: Optional[str]
    header: str
    total_marks: float
    duration_min: Optional[float]
    minutes_per_mark: Optional[float]
    sections: list[dict]
    shortfall: list[str]
    invariants: list[str]
    rule: str


def _g(x: Any) -> str:
    return format(float(x), "g")


def _num(x: float):
    return int(x) if float(x) == int(x) else float(x)


def _allows(sec: dict, typ: str) -> bool:
    types = sec.get("types") or []
    return not types or typ in types


def _need(sec: dict, k: int) -> str:
    types = sec.get("types") or []
    return (f"needs {k} more {_g(sec['marks'])}-mark question{'s' if k != 1 else ''}"
            + (f" ({' or '.join(types)})" if types else ""))


def _recent(attempts: Optional[list], today: Optional[str]) -> list[str]:
    """Question ids attempted within RECENT_DAYS of `today`. Without `today` nothing is recent: the
    function has no clock of its own."""
    if not attempts or not today:
        return []
    try:
        t = date.fromisoformat(str(today)[:10])
    except ValueError:
        return []
    out = set()
    for a in attempts:
        if not isinstance(a, dict) or not isinstance(a.get("question_id"), str):
            continue
        try:
            d = date.fromisoformat(str(a.get("date") or "")[:10])
        except ValueError:
            continue
        if 0 <= (t - d).days <= RECENT_DAYS:
            out.add(a["question_id"])
    return sorted(out)


def _refusal(issue: dict) -> str:
    t = str(issue.get("text") or "it has an issue.").strip()
    return f"The blueprint does not balance: {t[:1].lower() + t[1:]}"


def paper_id(exam_id: str, seed: int, qids: list[Optional[str]]) -> str:
    h = hashlib.sha256("\n".join([str(exam_id), str(seed)] + [q or "-" for q in qids]).encode("utf-8")).hexdigest()
    return f"g-{h[:12]}"


def _template_slot(q: dict) -> dict:
    """A numerical from ww_generator's paper row or from ww_numericals.pool, in one shape."""
    return {"question_id": q["id"], "text": q.get("question") or q.get("text") or "", "unit": q.get("unit"),
            "topic": q.get("topic") or "", "type": "numerical", "key": q.get("answer_text") or "",
            "template": q.get("template") or "", "seed": q.get("seed")}


def generate_paper(bp: Blueprint, exam: dict, subject: dict, bank: list[dict], states: dict, marks: dict, seed: int, *,
                   attempts: Optional[list] = None, families: Optional[dict] = None,
                   today: Optional[str] = None) -> GeneratedPaper:
    bp = normalize_blueprint(bp, (bp or {}).get("exam") if isinstance(bp, dict) else None)
    issues = validate_blueprint(bp) + exam_issues(bp, exam)
    if issues:
        raise ValueError(_refusal(issues[0]))
    if isinstance(seed, bool) or not isinstance(seed, int) or not 0 <= seed <= 2_000_000_000:
        raise ValueError("The seed is a whole number from 0.")
    units = list(subject.get("units") or [])
    secs = bp["sections"]

    # ---------------------------------------------------------- before the draw
    rows, seen = [], set()
    for r in bank or []:
        if isinstance(r, dict) and isinstance(r.get("id"), str) and r["id"] not in seen and str(r.get("question") or "").strip():
            seen.add(r["id"])
            rows.append(dict(r))
    fam = families or {}
    groups: dict[str, list[dict]] = {}
    for r in rows:
        groups.setdefault(str(fam.get(r["id"]) or r["id"]), []).append(r)
    rnd_fam = random.Random(f"ww-pyq:families:{seed}")
    keep = set()
    for fid in sorted(groups):
        members = sorted(groups[fid], key=lambda r: r["id"])
        keep.add(members[0]["id"] if len(members) == 1 else rnd_fam.choice(members)["id"])
    rows = [r for r in rows if r["id"] in keep]
    present = {r["id"] for r in rows}
    rnd_thin = random.Random(f"ww-pyq:recent:{seed}")
    dropped = {qid for qid in _recent(attempts, today) if qid in present and rnd_thin.random() >= RECENT_KEEP}
    rows = [r for r in rows if r["id"] not in dropped]
    prepared = []
    for r in rows:
        try:
            m = float(r.get("marks"))
        except (TypeError, ValueError):
            continue
        typ = str(r.get("type") or "unknown")
        fits = {s["name"].upper() for s in secs if float(s["marks"]) == m and _allows(s, typ)}
        if not fits:
            continue
        if str(r.get("section") or "").upper() not in fits:
            r["section"] = ""
        prepared.append(r)

    # ---------------------------------------------------------- the draw: one call, the blueprint as the pattern
    pattern = [{"name": s["name"], "questions": s["questions"], "attempt": s["attempt"], "marks": s["marks"]} for s in secs]
    ex = {**exam, "pattern": pattern, "pattern_source": "your blueprint"}
    drawn = ww_generator.generate(ex, prepared, units, states or {}, marks or {}, seed=seed, tier="exam", today=today)

    # ---------------------------------------------------------- after the draw: check every seat
    own = {r["id"]: r for r in prepared}
    used_ids: set = set()
    used_texts: set = set()
    seats_by_sec: list[list[Optional[dict]]] = []
    unit_counts: list[dict] = []

    def fits_unit(i: int, unit) -> bool:
        lim = secs[i].get("unit_limit")
        return not lim or unit is None or unit_counts[i].get(unit, 0) < lim

    def place(i: int, slot: dict) -> None:
        used_ids.add(slot["question_id"])
        used_texts.add(slot["text"])
        if slot.get("unit") is not None:
            unit_counts[i][slot["unit"]] = unit_counts[i].get(slot["unit"], 0) + 1

    for i, (s, gs) in enumerate(zip(secs, drawn["sections"])):
        seats: list[Optional[dict]] = [None] * int(s["questions"])
        unit_counts.append({})
        for j, q in enumerate((gs.get("questions") or [])[: len(seats)]):
            if q.get("origin") == "generated":
                slot = {**_template_slot(q), "source": "template"}
                ok = _allows(s, "numerical")
            else:
                r = own.get(q.get("id"))
                ok = r is not None and float(r["marks"]) == float(s["marks"]) and _allows(s, str(r.get("type") or "unknown"))
                slot = None if r is None else {
                    "question_id": r["id"], "text": r["question"], "unit": r.get("unit"), "topic": r.get("topic") or "",
                    "type": str(r.get("type") or "unknown"), "has_crop": bool(r.get("has_crop")),
                    "source": "rule" if r.get("status_by") == "rule" else "hand", "sitting": str(r.get("sitting") or "")}
            if ok and slot and slot["question_id"] not in used_ids and slot["text"] not in used_texts \
                    and fits_unit(i, slot.get("unit")):
                seats[j] = slot
                place(i, slot)
        seats_by_sec.append(seats)

    # empty seats: numerical templates not already on the paper, only where the section takes numericals
    empty = sum(1 for i, seats in enumerate(seats_by_sec) for seat in seats if seat is None and _allows(secs[i], "numerical"))
    if empty:
        scope = set(exam.get("units") or []) or {int(u["n"]) for u in units if u.get("n") is not None}
        # pool(count=k) is the first k items of one seeded sequence, and the templates ww_generator placed are
        # its first items too, so this count is the least that can still fill every empty seat. Each item is a
        # sympy build, measured 0.2 ms (rc_tau) to 18 ms (so_design) once sympy is loaded (its first import here
        # took about 3 s, once per process), so items nobody seats are not built.
        on_paper = sum(1 for seats in seats_by_sec for seat in seats if seat is not None and seat["source"] == "template")
        pool = ww_numericals.pool(units, scope, "exam", seed, on_paper + empty)
        for i, seats in enumerate(seats_by_sec):
            if not _allows(secs[i], "numerical"):
                continue
            for j in range(len(seats)):
                if seats[j] is not None:
                    continue
                for item in pool:
                    slot = {**_template_slot(item), "source": "template"}
                    if slot["question_id"] in used_ids or slot["text"] in used_texts or not fits_unit(i, slot.get("unit")):
                        continue
                    seats[j] = slot
                    place(i, slot)
                    break

    # ---------------------------------------------------------- the paper
    keys = [ww_generator.topic_key(r.get("unit"), str(r.get("topic") or "")) for r in prepared]
    prof = ww_generator.proficiency(states or {}, marks or {}, keys)
    out_secs, shortfall, shape_secs, qids = [], [], [], []
    for s, seats in zip(secs, seats_by_sec):
        mk = _num(s["marks"])
        slots: list[Slot] = []
        hollow = 0
        for n, seat in enumerate(seats, 1):
            if seat is None:
                hollow += 1
                slots.append({"n": n, "source": "hollow", "question_id": None, "text": "", "has_crop": False, "marks": mk,
                              "unit": None, "topic": "", "type": "", "reason": _need(s, 1)})
                qids.append(None)
                continue
            if seat["source"] == "template":
                reason = (f"Generated numerical from template {seat['template']}, seed {seat['seed']}: its answer is "
                          f"computed, not taken from a past paper.")
                slot = {"n": n, "source": "template", "question_id": seat["question_id"], "text": seat["text"], "has_crop": False,
                        "marks": mk, "unit": seat["unit"], "topic": seat["topic"], "type": "numerical", "reason": reason,
                        "key": seat["key"]}
            else:
                who = "a rule" if seat["source"] == "rule" else "you"
                reason = f"Accepted by {who}; {_g(mk)} marks" + (f"; from {seat['sitting']}." if seat["sitting"] else ".")
                slot = {"n": n, "source": seat["source"], "question_id": seat["question_id"], "text": seat["text"],
                        "has_crop": seat["has_crop"], "marks": mk, "unit": seat["unit"], "topic": seat["topic"],
                        "type": seat["type"], "reason": reason}
            slots.append(slot)
            qids.append(seat["question_id"])
        if hollow:
            shortfall.append(f"Section {s['name']}: {_need(s, hollow)}.")
        out_secs.append({"name": s["name"], "marks": mk, "attempt": s["attempt"], "set": s["questions"],
                         "choice": s.get("choice") or "any", "slots": slots})
        shape_secs.append({"name": s["name"], "marks": float(s["marks"]), "attempt": s["attempt"], "set": s["questions"],
                           "questions": [{"id": x["question_id"], "marks": float(x["marks"]),
                                          "p": prof.get(ww_generator.topic_key(x["unit"], x["topic"]))}
                                         for x in slots if x["source"] != "hollow"]})
    total = sum(s["attempt"] * float(s["marks"]) for s in secs)
    broken = ww_generator.paper_invariants({"sections": shape_secs, "total_marks": total, "shortfall": shortfall}, ex)
    if broken:
        raise ValueError(f"The paper broke a rule of its own: {broken[0]}.")
    dur = bp.get("duration_min")
    dur = _num(dur) if isinstance(dur, (int, float)) and not isinstance(dur, bool) and dur > 0 else None
    return {"id": paper_id(str(exam.get("id") or ""), seed, qids), "exam": str(exam.get("id") or ""),
            "subject": str(subject.get("id") or exam.get("subject") or ""),
            "title": str(exam.get("title") or exam.get("id") or ""), "seed": seed, "made": None, "header": HEADER,
            "total_marks": _num(total), "duration_min": dur,
            "minutes_per_mark": round(dur / total, 3) if dur else None,
            "sections": out_secs, "shortfall": shortfall, "invariants": [], "rule": RULE}


def counts(paper: GeneratedPaper) -> dict:
    out = {"hand": 0, "rule": 0, "template": 0, "hollow": 0}
    for s in paper.get("sections") or []:
        for x in s.get("slots") or []:
            if x.get("source") in out:
                out[x["source"]] += 1
    return out


# ------------------------------------------------------------------ generated/<id>.json
def check_generated_id(gid: Any) -> str:
    if not isinstance(gid, str) or not _GID.match(gid):
        raise KeyError("No such generated paper.")
    return gid


def _gpath(store, gid: str) -> Path:
    return Path(store.paths.generated) / f"{check_generated_id(gid)}.json"


def save_generated(store, paper: GeneratedPaper) -> GeneratedPaper:
    write_json_atomic(_gpath(store, paper.get("id")), paper)
    return paper


def load_generated(store, gid: str) -> GeneratedPaper:
    p = _gpath(store, gid)
    try:
        data = json.loads(p.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        raise KeyError("No such generated paper.")
    if not isinstance(data, dict) or data.get("id") != gid:
        raise KeyError("No such generated paper.")
    return data


def list_generated(store, exam: Optional[str] = None) -> list[GeneratedPaper]:
    out = []
    for f in sorted(Path(store.paths.generated).glob("g-*.json")):
        if not _GID.match(f.stem):
            continue
        try:
            p = load_generated(store, f.stem)
        except KeyError:
            continue
        if exam and p.get("exam") != exam:
            continue
        out.append(p)
    return sorted(out, key=lambda p: (str(p.get("made") or ""), p["id"]))


# ------------------------------------------------------------------ attempts.jsonl
def append_attempts(store, rows: list[dict]) -> None:
    path = Path(store.paths.root) / ATTEMPTS
    with _attempts_lock:
        with open(path, "a", encoding="utf-8") as f:
            for r in rows:
                f.write(json.dumps(r, ensure_ascii=False) + "\n")
            f.flush()


def read_attempts(store) -> list[dict]:
    path = Path(store.paths.root) / ATTEMPTS
    try:
        lines = path.read_text(encoding="utf-8").splitlines()
    except OSError:
        return []
    out = []
    for line in lines:
        try:
            r = json.loads(line)
        except ValueError:
            continue                       # a torn last line from a crash is skipped, the rest still counts
        if isinstance(r, dict):
            out.append(r)
    return out
