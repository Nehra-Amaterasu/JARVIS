"""The ladder: which level he stands on in each topic, from his own marks only (wave EW13, L2; plan 9.0, 28 Nov).

    rows_for_topic(questions_of_topic, attempts_of_topic)  -> [{level, questions, attempts, distinct_questions,
                                                               single_question, got, max}] for levels 1 to 5
    state_of(row, pass_percent)                           -> "passed" | "not passed" | "not measured" | "no question"
    stands_on(levels_rows, pass_percent, top=5)            -> (level or None, sentence)
    topic_ladder(topic, questions, attempts, pass_percent, top=5) -> R-76's item for one topic
    order_for_sheet(candidates, stands_on)                -> the candidates, the level he stands on first
    load_settings(store) / save_settings(store, pass_percent)      R-77, the only two that touch a file

Pure apart from the two settings calls: inputs in, dicts out, no clock read. Where each number comes from:
  * A level is passed when it has at least MIN_ATTEMPTS (3, ww_pyq/next.py: the owner's number of 27 Nov, the same as
    the order of topics) marked attempts at that level in that topic, and got over max of those attempts is at or above
    `pass_percent`. 60 is where it starts because he set it (a setting, not a finding); R-77 takes 50 to 100.
  * The attempts must be on at least 2 different questions when the topic has 2 or more questions at that level:
    three tries at one question can be memory of that question, not the level. With exactly 1 question at the level,
    3 attempts on it may pass it, and the row says `single_question: true` so a screen can say so. Short of that the
    level reads "not measured".
  * Under MIN_ATTEMPTS the level reads "not measured": nothing is estimated from one or two evenings.
  * Marks are summed exactly (fractions of the decimal each mark was typed as) and compared as got x 100 against
    pass_percent x max: 0.6 of 1 three times is 60% exactly, where float sums gave 1.7999999999999998 and "not passed".
    An attempt with got above max, got under 0, a max of 0 or less, or no number is not a marked attempt.
  * A level with no accepted question in the topic reads "no question" and is stepped over: he cannot practise it, so
    it cannot hold him. The sentence names every level stepped over below the one he stands on.
  * He stands on the lowest level (up to `top`) that has a question and is not passed. When every level with a
    question is passed he stands on the highest of them, and the sentence says all are passed.
  * `top` is 5 until a subject has a goal (F2, not built): a goal may cap the ladder lower.
  * An attempt is a row {question_id, got, max, level?}. When it carries `level`, that level counts (the level the
    question had when it was marked; None there means it had none). No producer writes that field yet: the ledger's
    sheet and paper rows do not carry it, so until the integrator stamps it on each mark, every past mark counts at
    the level its question has today, and relabelling a question moves its past marks with it.
"""
from __future__ import annotations

import json
import math
import threading
from fractions import Fraction
from pathlib import Path
from typing import Any, Iterator, Optional

from .blueprint import write_json_atomic
from .levels import LEVELS, NAMES
from .next import MIN_ATTEMPTS

PASS_DEFAULT = 60
PASS_MIN, PASS_MAX = 50, 100
TOP = 5
MIN_DISTINCT = 2            # different questions a level's attempts must be on, when it has that many questions
SETTINGS_FILE = "ladder.json"
STATES = ("passed", "not passed", "not measured", "no question")
_LOCK = threading.Lock()


def _plural(n: int, one: str, many: str) -> str:
    return f"{n} {one if n == 1 else many}"


def _g(x: float) -> str:
    return format(round(float(x), 2), "g")


def _exact(x: Any) -> Optional[Fraction]:
    """A mark as an exact fraction of the decimal it was typed as ("0.6" is 3/5), or None for no finite number."""
    if isinstance(x, bool) or not isinstance(x, (int, float)) or not math.isfinite(x):
        return None
    return Fraction(x) if isinstance(x, int) else Fraction(repr(float(x)))


def _level(v: Any) -> Optional[int]:
    return v if isinstance(v, int) and not isinstance(v, bool) and v in LEVELS else None


def _join(ns: list[int]) -> str:
    s = [str(n) for n in ns]
    return s[0] if len(s) == 1 else ", ".join(s[:-1]) + " and " + s[-1]


def _marked(questions_of_topic: list[dict], attempts_of_topic: list[dict]) -> Iterator[tuple]:
    """(level or None, question id, got, max) for each marked attempt, got and max exact."""
    level_of = {q.get("id"): _level(q.get("level")) for q in questions_of_topic}
    for a in attempts_of_topic:
        got, mx = _exact(a.get("got")), _exact(a.get("max"))
        if got is None or mx is None or mx <= 0 or got < 0 or got > mx:
            continue
        n = _level(a.get("level")) if "level" in a else level_of.get(a.get("question_id"))
        yield n, a.get("question_id"), got, mx


# ------------------------------------------------------------------ the rows of one topic
def rows_for_topic(questions_of_topic: list[dict], attempts_of_topic: list[dict]) -> list[dict]:
    """One row a level, 1 to 5. `questions_of_topic` are the topic's accepted questions; `attempts_of_topic` its marked
    attempts {question_id, got, max, level?}; see the module docstring for which level an attempt counts at and which
    rows are not marked attempts. got and max are the exact sums, given as numbers."""
    rows = {n: {"level": n, "questions": 0, "attempts": 0, "distinct_questions": 0, "single_question": False,
                "got": Fraction(0), "max": Fraction(0)} for n in LEVELS}
    seen: dict[int, set] = {n: set() for n in LEVELS}
    for q in questions_of_topic:
        n = _level(q.get("level"))
        if n is not None:
            rows[n]["questions"] += 1
    for n, qid, got, mx in _marked(questions_of_topic, attempts_of_topic):
        if n is None:
            continue
        r = rows[n]
        r["attempts"] += 1
        r["got"] += got
        r["max"] += mx
        seen[n].add(qid)
    out = []
    for n in LEVELS:
        r = rows[n]
        r["distinct_questions"] = len(seen[n])
        r["single_question"] = r["questions"] == 1
        r["got"], r["max"] = _num_out(r["got"]), _num_out(r["max"])
        out.append(r)
    return out


def _num_out(f: Fraction) -> float | int:
    return int(f) if f.denominator == 1 else float(f)


def unlabelled(questions_of_topic: list[dict], attempts_of_topic: list[dict]) -> dict:
    """What the rows leave out: questions without a level, and marked attempts whose level is not known."""
    att = sum(1 for n, *_ in _marked(questions_of_topic, attempts_of_topic) if n is None)
    return {"questions": sum(1 for q in questions_of_topic if _level(q.get("level")) is None), "attempts": att}


def _too_few_questions(row: dict) -> bool:
    return row["questions"] >= MIN_DISTINCT and row.get("distinct_questions", MIN_DISTINCT) < MIN_DISTINCT


def state_of(row: dict, pass_percent: int) -> str:
    if not row["questions"]:
        return "no question"
    if row["attempts"] < MIN_ATTEMPTS or _too_few_questions(row):
        return "not measured"
    # got / max >= p / 100 in exact fractions: no float sum can put 60.0% under 60
    got, mx = _exact(row["got"]), _exact(row["max"])
    return "passed" if got * 100 >= pass_percent * mx else "not passed"


def _why(row: dict, state: str, pass_percent: int) -> str:
    n = row["level"]
    if state == "not measured" and row["attempts"] >= MIN_ATTEMPTS:
        return (f"level {n} ({NAMES[n]}) has {row['attempts']} marked attempts, all on one of its {row['questions']} "
                f"questions; attempts on {MIN_DISTINCT} different questions measure it, so it is not measured yet")
    if state == "not measured":
        return (f"level {n} ({NAMES[n]}) has {_plural(row['attempts'], 'marked attempt', 'marked attempts')} of the "
                f"{MIN_ATTEMPTS} that measure it, so it is not measured yet")
    pct = math.floor(100 * _exact(row["got"]) / _exact(row["max"])) if row["max"] else 0
    return (f"level {n} ({NAMES[n]}): {_g(row['got'])} of {_g(row['max'])} over "
            f"{_plural(row['attempts'], 'attempt', 'attempts')}, {pct}%, under the {pass_percent}% that passes it")


def stands_on(levels_rows: list[dict], pass_percent: int = PASS_DEFAULT, top: int = TOP) -> tuple[Optional[int], str]:
    """The level he stands on in a topic and the sentence that says why. Levels above `top` are not climbed."""
    rows = sorted((r for r in levels_rows if _level(r.get("level")) is not None and r["level"] <= top),
                  key=lambda r: r["level"])
    states = {r["level"]: state_of(r, pass_percent) for r in rows}
    with_q = [r for r in rows if states[r["level"]] != "no question"]
    if not with_q:
        return None, (f"No accepted question of this topic has a level from 1 to {top} yet, so there is no ladder to "
                      "stand on.")
    stand = next((r for r in with_q if states[r["level"]] != "passed"), None)
    if stand is None:
        top_q = with_q[-1]["level"]
        s = (f"Every level with a question is passed ({'level' if len(with_q) == 1 else 'levels'} "
             f"{_join([r['level'] for r in with_q])}, at {pass_percent}%); you stand on the highest, level {top_q}.")
        over = [r["level"] for r in rows if states[r["level"]] == "no question" and r["level"] < top_q]
    else:
        n = stand["level"]
        s = f"You stand on level {n}: {_why(stand, states[n], pass_percent)}."
        below = [r["level"] for r in with_q if r["level"] < n]
        if below:
            s += f" {'Level' if len(below) == 1 else 'Levels'} {_join(below)} {'is' if len(below) == 1 else 'are'} passed."
        over = [r["level"] for r in rows if states[r["level"]] == "no question" and r["level"] < n]
    if over:
        s += (f" {'Level' if len(over) == 1 else 'Levels'} {_join(over)} {'has' if len(over) == 1 else 'have'} no "
              f"accepted question in this topic and {'is' if len(over) == 1 else 'are'} stepped over.")
    return (stand["level"] if stand else with_q[-1]["level"]), s


def topic_ladder(topic: dict, questions: list[dict], attempts: list[dict], pass_percent: int = PASS_DEFAULT,
                 top: int = TOP) -> dict:
    """R-76's item for one topic ({key, unit, topic} from tag.topics_of): the five rows with their states, where he
    stands and why, and what has no level yet (`unlabelled`)."""
    rows = rows_for_topic(questions, attempts)
    level, sentence = stands_on(rows, pass_percent, top)
    out = [{**r, "got": round(r["got"], 2), "max": round(r["max"], 2), "state": state_of(r, pass_percent)} for r in rows]
    un = unlabelled(questions, attempts)
    if un["questions"]:
        sentence += f" {_plural(un['questions'], 'question has', 'questions have')} no level yet and {'is' if un['questions'] == 1 else 'are'} not counted."
    return {"key": topic["key"], "unit": topic["unit"], "topic": topic["topic"], "stands_on": level, "top": top,
            "levels": out, "sentence": sentence, "unlabelled": un}


# ------------------------------------------------------------------ the evening sheet
def order_for_sheet(candidates: list[dict], stands_on: Optional[int]) -> list[dict]:
    """The candidates of one topic in the order the sheet should take them: the level he stands on first, then the
    nearest level below (s-1, s-2, ...), then above (s+1, s+2, ...); questions without a level last. Stable: within one
    level the order given is kept. With stands_on None only the unlabelled move to the end."""
    def key(q: dict) -> tuple:
        n = _level(q.get("level"))
        if n is None:
            return (3, 0)
        if stands_on is None or n == stands_on:
            return (0, 0)
        return (1, stands_on - n) if n < stands_on else (2, n - stands_on)
    return sorted(candidates, key=key)


# ------------------------------------------------------------------ R-77 the one setting
def _path(store) -> Path:
    return Path(store.root) / SETTINGS_FILE


def check_percent(v: Any) -> int:
    if isinstance(v, bool) or not isinstance(v, int) or not PASS_MIN <= v <= PASS_MAX:
        raise ValueError(f"pass_percent is a whole number from {PASS_MIN} to {PASS_MAX}.")
    return v


def load_settings(store) -> dict:
    """{"pass_percent"}; a file that is missing, does not parse or holds a value out of range reads as the default."""
    try:
        d = json.loads(_path(store).read_text(encoding="utf-8"))
    except (OSError, ValueError):
        d = {}
    v = d.get("pass_percent") if isinstance(d, dict) else None
    try:
        return {"pass_percent": check_percent(v)}
    except ValueError:
        return {"pass_percent": PASS_DEFAULT}


def save_settings(store, pass_percent: Any) -> dict:
    v = check_percent(pass_percent)
    with _LOCK:
        write_json_atomic(_path(store), {"pass_percent": v})
    return load_settings(store)
