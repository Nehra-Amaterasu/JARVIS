"""The paper blueprint (E08): the shape a practice paper must have, stored per exam, checked, and
proposed from a paper on file (plan 9.1.5, Blueprint and Issue; plan 9.1.8).

    normalize_blueprint(raw, exam_id=None) -> Blueprint       ValueError when the shape itself is broken
    validate_blueprint(bp) -> [Issue]                         the three rules and malformed values
    exam_issues(bp, exam) -> [Issue]                          the blueprint against the exam row's maximum
    infer_blueprint(paper, qs) -> Blueprint                   origin "rule", not saved
    infer_with_trace(paper, qs) -> (Blueprint, [str])         the same with one line per decision
    load_blueprint(store, exam_id) / save_blueprint(store, exam_id, bp)

Why a blueprint at all: on 9 Nov a 20-mark CIE row borrowed the 60-mark end-semester shape and
printed a paper he could not score himself on (audit STUDY-05). A blueprint is ww_generator's
`pattern` list plus validation, so the generator only ever draws a shape he confirmed and that
adds up. A sections list maps one to one onto that pattern ({name, questions, attempt, marks}).

Two kinds of wrong. A broken shape (not an object, sections not a list, an unknown type word) is a
ValueError and the route answers 400. A value that is wrong but editable (a zero, a duplicate name,
sections that do not add up) is an Issue: the blueprint is still saved so he can keep editing, and
the generator refuses it until the list is empty.
"""
from __future__ import annotations

import json
import os
import re
import time
import uuid
from datetime import datetime
from pathlib import Path
from typing import Any, Literal, Optional, TypedDict

from .schema import Q_TYPES, PaperMeta, Question

CHOICES = ("all", "any", "or-pairs")
ORIGINS = ("hand", "rule")
_EXAM_ID = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$")    # a date-sheet id; no dot, slash or colon can reach a path
_MAX_SECTIONS = 12          # a real paper has 2 to 5; ww_engines keeps at most 8 pattern rows
_MAX_QUESTIONS = 100        # a real section has 3 to 12 questions; generate_paper builds one seat each, so 3 million would hang a worker
_MAX_MARKS = 1000           # one question or one paper; far above any exam row
_MAX_NAME = 40              # the same cut as ww_engines' pattern name
_REPLACE_TRIES = 8          # Windows can hold a target for a few ms (antivirus, an open reader), as in store.py


class Section(TypedDict, total=False):
    name: str
    questions: int
    attempt: int
    marks: float
    types: list[str]                          # QType words allowed in the section; [] allows any
    choice: Literal["all", "any", "or-pairs"]
    unit_limit: Optional[int]                 # at most this many questions of one unit in the section


class Blueprint(TypedDict, total=False):
    exam: str
    source_paper: Optional[str]
    duration_min: Optional[float]
    total: Optional[float]
    origin: Literal["hand", "rule"]
    sections: list[Section]
    updated: str


class Issue(TypedDict, total=False):
    code: str                                 # no_sections, no_name, duplicate, bad_number, attempt, or_pairs, total, exam_max
    section: Optional[str]
    text: str                                 # a sentence a screen prints as it is


# ------------------------------------------------------------------ small helpers
def _numish(v: Any) -> Optional[float]:
    """A number as typed, or None. A bool is not a number; "7" from a text box is."""
    if isinstance(v, bool) or v is None:
        return None
    if isinstance(v, (int, float)):
        f = float(v)
    elif isinstance(v, str) and v.strip():
        try:
            f = float(v.strip())
        except ValueError:
            return None
    else:
        return None
    if f != f or f in (float("inf"), float("-inf")):
        return None
    return int(f) if f == int(f) else f


def _g(x: Any) -> str:
    return format(float(x), "g") if isinstance(x, (int, float)) else str(x)


def _plural(n: int, one: str, many: str) -> str:
    return f"{n} {one if n == 1 else many}"


def check_exam_id(exam_id: Any) -> str:
    if not isinstance(exam_id, str) or not _EXAM_ID.match(exam_id):
        raise ValueError("That exam id cannot name a blueprint.")
    return exam_id


def write_json_atomic(path: Path, data: Any) -> None:
    """A temporary file in the same folder, then a replace: a reader sees the old file or the new one."""
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(f".{path.name}.{uuid.uuid4().hex[:8]}.tmp")
    try:
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=1)
            f.flush()
            os.fsync(f.fileno())
        for i in range(_REPLACE_TRIES):
            try:
                os.replace(tmp, path)
                return
            except PermissionError:
                if i == _REPLACE_TRIES - 1:
                    raise
                time.sleep(0.02 * (i + 1))
    finally:
        try:
            tmp.unlink()
        except OSError:
            pass


# ------------------------------------------------------------------ shape
def normalize_blueprint(raw: Any, exam_id: Optional[str] = None) -> Blueprint:
    """The blueprint in its stored shape. Numbers are kept as typed (or None) so validate_blueprint
    can name what is wrong; only a shape no screen could have sent is refused here."""
    if not isinstance(raw, dict):
        raise ValueError("A blueprint is an object with sections.")
    secs = raw.get("sections")
    if secs is None:
        secs = []
    if not isinstance(secs, list):
        raise ValueError("A blueprint's sections are a list.")
    if len(secs) > _MAX_SECTIONS:
        raise ValueError(f"A blueprint has at most {_MAX_SECTIONS} sections.")
    out_secs: list[Section] = []
    for i, s in enumerate(secs, 1):
        if not isinstance(s, dict):
            raise ValueError(f"Section {i} is not a section.")
        name = s.get("name")
        if name is None:
            name = ""
        if not isinstance(name, (str, int)) or isinstance(name, bool):
            raise ValueError(f"Section {i}'s name is a short label such as A.")
        name = str(name).strip()[:_MAX_NAME]
        types = s.get("types") or []
        if not isinstance(types, list) or not all(isinstance(t, str) and t in Q_TYPES for t in types):
            raise ValueError(f"Section {name or i}: the types are words from {', '.join(Q_TYPES)}.")
        q, a, m = _numish(s.get("questions")), _numish(s.get("attempt")), _numish(s.get("marks"))
        if any(v is not None and v > _MAX_QUESTIONS for v in (q, a)):
            raise ValueError(f"Section {name or i}: at most {_MAX_QUESTIONS} questions.")
        if m is not None and m > _MAX_MARKS:
            raise ValueError(f"Section {name or i}: marks are at most {_MAX_MARKS}.")
        if a is None and q is not None and s.get("attempt") in (None, ""):
            a = q                                                    # no attempt typed: answer all
        choice = s.get("choice")
        if choice in (None, ""):
            choice = "all" if (q is not None and a == q) else "any"
        if choice not in CHOICES:
            raise ValueError(f"Section {name or i}: the choice is all, any or or-pairs.")
        ul = s.get("unit_limit")
        if ul in ("",):
            ul = None
        if ul is not None and (isinstance(ul, bool) or not isinstance(ul, int) or not 1 <= ul <= 50):
            raise ValueError(f"Section {name or i}: the unit limit is a whole number from 1, or empty.")
        out_secs.append({"name": name, "questions": q, "attempt": a, "marks": m,
                         "types": [t for t in Q_TYPES if t in types], "choice": choice, "unit_limit": ul})
    if (_numish(raw.get("total")) or 0) > _MAX_MARKS * _MAX_SECTIONS * _MAX_QUESTIONS:
        raise ValueError("The total is too large for a paper.")
    origin = raw.get("origin") if raw.get("origin") in ORIGINS else "hand"
    src = raw.get("source_paper")
    if src is not None and not (isinstance(src, str) and re.fullmatch(r"[a-z]-[a-z0-9-]{1,40}", src)):
        raise ValueError("The source paper is a paper id.")
    return {"exam": exam_id if exam_id is not None else str(raw.get("exam") or ""), "source_paper": src,
            "duration_min": _numish(raw.get("duration_min")), "total": _numish(raw.get("total")),
            "origin": origin, "sections": out_secs, "updated": str(raw.get("updated") or "")}


# ------------------------------------------------------------------ the rules
def _pos_int(v: Any) -> bool:
    return isinstance(v, int) and not isinstance(v, bool) and v >= 1


def validate_blueprint(bp: Blueprint) -> list[Issue]:
    """Empty list: the blueprint balances. Malformed values first, then the per-section rules,
    then the sum, so the first issue is the one to fix first."""
    issues: list[Issue] = []
    secs = list(bp.get("sections") or [])
    if not secs:
        return [{"code": "no_sections", "section": None, "text": "The blueprint has no sections."}]
    seen: dict[str, str] = {}
    numbers_ok = True
    for i, s in enumerate(secs, 1):
        name = str(s.get("name") or "")
        label = name or str(i)
        if not name:
            issues.append({"code": "no_name", "section": None, "text": f"Section {i} has no name."})
        elif name.upper() in seen:
            issues.append({"code": "duplicate", "section": name, "text": f"Two sections are called {name}."})
        else:
            seen[name.upper()] = name
        q, a, m = s.get("questions"), s.get("attempt"), s.get("marks")
        if not _pos_int(q):
            issues.append({"code": "bad_number", "section": name or None,
                           "text": f"Section {label}: the number of questions must be a whole number above 0."})
            numbers_ok = False
        if not _pos_int(a):
            issues.append({"code": "bad_number", "section": name or None,
                           "text": f"Section {label}: the number to attempt must be a whole number above 0."})
            numbers_ok = False
        if isinstance(m, bool) or not isinstance(m, (int, float)) or m <= 0 or (2 * m) % 1:
            issues.append({"code": "bad_number", "section": name or None,
                           "text": f"Section {label}: marks must be a number above 0, in steps of 0.5."})
            numbers_ok = False
    total = bp.get("total")
    if isinstance(total, bool) or not isinstance(total, (int, float)) or total <= 0:
        issues.append({"code": "bad_number", "section": None, "text": "The total must be a number above 0."})
        numbers_ok = False
    for s in secs:
        q, a, name = s.get("questions"), s.get("attempt"), str(s.get("name") or "")
        if not (_pos_int(q) and _pos_int(a)):
            continue
        if q < a:
            issues.append({"code": "attempt", "section": name or None,
                           "text": f"Section {name} asks for {a} answers from {_plural(q, 'question', 'questions')}."})
        if s.get("choice") == "or-pairs" and (q % 2 or a * 2 != q):
            issues.append({"code": "or_pairs", "section": name or None,
                           "text": f"Section {name} is set as OR pairs, so it needs an even number of questions with half "
                                   f"of them attempted ({q} set, {a} to attempt)."})
    if numbers_ok:
        got = sum(s["attempt"] * float(s["marks"]) for s in secs)
        if abs(got - float(total)) > 1e-9:
            issues.append({"code": "total", "section": None,
                           "text": f"The sections add up to {_g(got)} marks but the total is {_g(total)}."})
    return issues


def exam_issues(bp: Blueprint, exam: dict) -> list[Issue]:
    """The 9 Nov rule: a blueprint for an exam row prints that row's maximum, or it is refused."""
    mx, total = exam.get("max"), bp.get("total")
    if isinstance(mx, (int, float)) and not isinstance(mx, bool) and isinstance(total, (int, float)) \
            and not isinstance(total, bool) and abs(float(mx) - float(total)) > 1e-9:
        return [{"code": "exam_max", "section": None,
                 "text": f"The exam row is {_g(mx)} marks but the blueprint totals {_g(total)}."}]
    return []


def balance_sentence(bp: Blueprint) -> str:
    return f"Balanced: {_g(bp.get('total'))} marks."


# ------------------------------------------------------------------ inference from a paper on file
def _modal(values: list[float]) -> float:
    """The most frequent marks; a tie goes to the value met first in page order (deterministic)."""
    counts: dict[float, int] = {}
    for v in values:
        counts[v] = counts.get(v, 0) + 1
    best = max(counts.values())
    return next(v for v in values if counts[v] == best)


def infer_with_trace(paper: PaperMeta, qs: list[Question]) -> tuple[Blueprint, list[str]]:
    pid = paper.get("id")
    rows = [(i, q) for i, q in enumerate(qs)
            if (not pid or not q.get("paper_id") or q.get("paper_id") == pid)
            and q.get("status", "pending") in ("pending", "accepted") and _numish(q.get("marks")) is not None]
    if not rows:
        raise ValueError("This paper has no accepted or pending questions with marks.")
    rows.sort(key=lambda t: (int(t[1].get("page") or 0), t[0]))
    trace: list[str] = []
    order: list[str] = []
    groups: dict[str, list[dict]] = {}
    current = ""
    lettered = any(str(q.get("section") or "").strip() for _, q in rows)
    if not lettered:
        trace.append("No section letters on this paper: one section A.")
    for _, q in rows:
        name = str(q.get("section") or "").strip().upper()
        if not name:
            name = current or "A"                    # an unlettered question belongs to the section above it
        if name not in groups:
            groups[name] = []
            order.append(name)
        groups[name].append(q)
        current = name
    sections: list[Section] = []
    for name in order:
        g = groups[name]
        mk = _modal([_numish(q["marks"]) for q in g])
        n = len(g)
        off = sum(1 for q in g if _numish(q["marks"]) != mk)
        line = f"Section {name}: {_plural(n, 'question', 'questions')} of {_g(mk)} marks"
        if off:
            line += f" ({off} printed with other marks; the most common value is used)"
        trace.append(line + ".")
        grouped = [str(q.get("choice_group") or "") for q in g]
        sizes: dict[str, int] = {}
        for c in grouped:
            if c:
                sizes[c] = sizes.get(c, 0) + 1
        if sizes and all(grouped) and all(v == 2 for v in sizes.values()):
            att, choice = n // 2, "or-pairs"
            trace.append(f"Section {name}: {len(sizes)} OR pairs, so {att} of {n} are attempted.")
        elif sizes:
            singles = sum(1 for c in grouped if not c)
            att, choice = singles + len(sizes), "any"
            trace.append(f"Section {name}: {len(sizes)} choice groups and {singles} single questions, "
                         f"so {att} of {n} are attempted (one from each group).")
        else:
            att, choice = n, "all"
        sections.append({"name": name, "questions": n, "attempt": att, "marks": mk, "types": [],
                         "choice": choice, "unit_limit": None})
    printed = _numish(paper.get("total_marks"))
    if printed is not None and printed > 0:
        # Too many marks for the printed total: the paper must offer a choice the questions do not show.
        # The last sections give way first, because the short answers at the top are usually all compulsory.
        for s in reversed(sections):
            got = sum(x["attempt"] * float(x["marks"]) for x in sections)
            if got <= printed + 1e-9:
                break
            others = got - s["attempt"] * float(s["marks"])
            fit = int((printed - others + 1e-9) // float(s["marks"]))
            fit = max(1, min(s["attempt"], fit))
            if fit < s["attempt"]:
                trace.append(f"Section {s['name']}: {s['attempt']} questions of {_g(s['marks'])} marks would give "
                             f"{_g(s['attempt'] * float(s['marks']))}; the printed total is {_g(printed)}, so "
                             f"{fit} of {s['questions']} is proposed.")
                s["attempt"] = fit
                s["choice"] = "all" if fit == s["questions"] else "any"
        total = printed
        trace.append(f"Total {_g(printed)} marks, as printed on the paper.")
    else:
        total = sum(x["attempt"] * float(x["marks"]) for x in sections)
        trace.append(f"No total printed on the paper: the sections add up to {_g(total)} marks.")
    total = int(total) if float(total) == int(total) else total
    bp: Blueprint = {"exam": "", "source_paper": pid or None, "duration_min": None, "total": total, "origin": "rule",
                     "sections": sections, "updated": ""}
    return bp, trace


def infer_blueprint(paper: PaperMeta, qs: list[Question]) -> Blueprint:
    return infer_with_trace(paper, qs)[0]


# ------------------------------------------------------------------ the store (blueprints/<exam_id>.json)
def _path(store, exam_id: str) -> Path:
    return Path(store.paths.blueprints) / f"{check_exam_id(exam_id)}.json"


def load_blueprint(store, exam_id: str) -> Optional[Blueprint]:
    p = _path(store, exam_id)
    try:
        raw = json.loads(p.read_text(encoding="utf-8"))
    except FileNotFoundError:
        return None
    except (OSError, ValueError):
        return None                       # a broken file reads as "no blueprint": he infers or types one again
    try:
        return normalize_blueprint(raw, exam_id)
    except ValueError:
        return None


def save_blueprint(store, exam_id: str, bp: Blueprint) -> Blueprint:
    p = _path(store, exam_id)
    clean = normalize_blueprint(bp, exam_id)
    clean["updated"] = datetime.now().isoformat(timespec="seconds")
    write_json_atomic(p, clean)
    return clean
