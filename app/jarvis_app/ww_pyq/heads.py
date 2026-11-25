"""Papers whose marks stand in the heading of a part, not beside the question (found 25 Nov 2026).

    part_letter(text)                 "PART-B: Attempt all ..." -> "B"
    is_rule(text)                     a line that tells how many to attempt and for how many marks, and is no question
    section_marks(text, units)        the marks of one question under such a heading, or None with the reason
    headed_table(rows, carry, ...)    a ruled table with Q, QUESTIONS, CO and BL columns and no marks column

Why: 25 Word papers of the owner's internal tests, printed to PDF, came out as 614 questions with
marks on 3, and 45 of 93 PDF papers from the same place had none. Two layouts cover nearly all of
them. In the first, "PART A: ANSWER ALL THE QUESTIONS Each question carries 1 mark 4x1=4" heads a
table of "1 | a | text | CO1 | 1" rows. In the second, "2. Attempt any three of the following:
10*3 = 30" heads a table of "(a) | text | 2" rows, so the number is outside the table as well.

Marks are read, never guessed: "each question carries N" is N; "a x b = t" must multiply out, and
which factor is the marks comes from a printed M or Q, or from the number to attempt. Anything else
leaves the marks missing with a reason in the trace, and he types them in review.
"""
from __future__ import annotations

import re
from typing import Optional, Sequence

WORDS = {w: i for i, w in enumerate("one two three four five six seven eight nine ten".split(), 1)}
_N = r"(?:\d{1,2}|one|two|three|four|five|six|seven|eight|nine|ten)"

_PART = re.compile(r"^\s*(?:section|part)\s*[-–—]?\s*(?P<l>[A-Ea-e])(?=$|[\s:.\-–—(]|answer|attempt)", re.I)
# Past 60 characters a line starting "Part A" may be prose, so it must also read like an instruction.
_INSTR = re.compile(r"\b(?:answer|attempt)|\bquestions?\b|\bmarks?\b", re.I)
HEAD_SHORT, HEAD_MAX = 60, 160

ARITH = re.compile(r"(?<![\d.])(?P<a>\d{1,2})\s*(?P<au>[QqMm])?\s*[xX×*]\s*(?P<b>\d{1,2})\s*(?P<bu>[QqMm])?\s*=\s*(?P<t>\d{1,3})(?![\d.])")
_EACH = re.compile(r"\beach\s*(?:question)?\s*(?:carr(?:y|ies)|is\s+of|of)?\s*(?P<v>\d{1,2}(?:\.\d)?)\s*-?\s*marks?\b", re.I)
_KIND = re.compile(rf"\b(?P<v>{_N})\s*-?\s*marks?\s+questions?\b|\bquestions?\s*\(\s*(?P<w>{_N})\s*marks?\s*\)", re.I)
_RANGE = re.compile(rf"\b{_N}\s*(?:-|–|/|to|or)\s*{_N}\s*-?\s*marks?\b", re.I)
_ANY = re.compile(rf"\bany\s*(?P<n>{_N})\b", re.I)
_ALL = re.compile(r"\ball\b|answerall", re.I)
_LEAD_NO = re.compile(r"^\s*(?:q\.?\s*)?(?P<n>\d{1,2})\s*[.)]\s*(?=(?:attempt|answer)\b)", re.I)
_DO = re.compile(r"\b(?:attempt|answer)", re.I)


def _int(s: str) -> int:
    return WORDS.get(s.lower()) or int(s)


def part_letter(text: str) -> Optional[str]:
    """The letter of a part heading, or None. "Section provides positive phase" is prose, not section P."""
    t = " ".join(text.split())
    if len(t) > HEAD_MAX:
        return None
    m = _PART.match(t)
    if not m or (len(t) > HEAD_SHORT and not _INSTR.search(t)):
        return None
    return m.group("l").upper()


def rule_number(text: str) -> str:
    """"2. Attempt any three of the following:" -> "2": the number of the items in the table under it."""
    m = _LEAD_NO.match(text)
    return m.group("n") if m else ""


def is_rule(text: str) -> bool:
    """A loose line that states marks for the questions under it. It needs an instruction or nothing
    but the marks themselves, so a question that happens to hold "3 x 4 = 12" stays a question."""
    t = " ".join(text.split())
    if not t or len(t) > HEAD_MAX:
        return False
    if _DO.search(t) and (ARITH.search(t) or _EACH.search(t) or rule_number(t)):
        return bool(rule_number(t)) or not re.match(r"^\s*(?:q\.?\s*)?\d{1,2}\s*[.)]", t, re.I)
    bare = ARITH.sub("", t)
    if ARITH.search(t) and not re.sub(r"[\s()\[\]:.=\-–—]|marks?|[QqMm]\b", "", bare, flags=re.I):
        return True                                             # "(5 x 2 = 10)" alone on its line
    if _EACH.search(t) and len(t) <= 80 and re.match(r"^\s*\(?\s*(?:note\b.{0,40})?each\b", t, re.I):
        return True
    return bool(re.match(rf"^\s*\(?\s*{_N}\s*-?\s*marks?\s+questions?\s*\)?\s*$", t, re.I))


def section_marks(text: str, units: int) -> tuple[Optional[float], str]:
    """(marks of one question, "") or (None, why). `units` is how many questions stand under the
    heading, an OR pair counting once: that is the number to attempt when the heading says ALL."""
    t = " ".join(text.split())
    each = _EACH.search(t)
    ar = ARITH.search(t)
    if each:
        v = float(each.group("v"))
        if ar and int(ar["a"]) * int(ar["b"]) == int(ar["t"]) and v not in (float(ar["a"]), float(ar["b"])):
            return None, f"the heading says {v:g} marks each and also {ar.group(0)}"
        return v, ""
    if ar:
        a, b, total = int(ar["a"]), int(ar["b"]), int(ar["t"])
        if a * b != total:
            return None, f"{a} x {b} is not {total}"
        au, bu = (ar["au"] or "").lower(), (ar["bu"] or "").lower()
        if bu == "m" and au != "m" or au == "q":
            return float(b), ""
        if au == "m" and bu != "m" or bu == "q":
            return float(a), ""
        if a == b:
            return float(a), ""
        any_n = _ANY.search(t)
        k = _int(any_n.group("n")) if any_n else units if _ALL.search(t) else None
        if k is None:
            return None, "the heading does not say how many to attempt"
        if k == a:
            return float(b), ""
        if k == b:
            return float(a), ""
        return None, f"neither {a} nor {b} is the number to attempt ({k})"
    if _RANGE.search(t):
        return None, "the heading gives a range of marks"
    kind = _KIND.search(t)
    if kind:
        return float(_int(kind.group("v") or kind.group("w"))), ""
    return None, "the heading gives no marks"


# ------------------------------------------------------------------ the table
_Q_HEAD = re.compile(r"^(?:q|qn|q\.?\s*no\.?|ques\.?\s*no\.?|question\s*no\.?|s\.?\s*no\.?|sl\.?\s*no\.?)$", re.I)
_CO_HEAD = re.compile(r"^c(?:\s*o)?s?$", re.I)
_BL_HEAD = re.compile(r"^(?:b\s*l|l|b\s*t\s*l?|k\s*l?)$", re.I)
_NO = re.compile(r"^(?:q\.?\s*)?(?P<n>\d{1,2})\s*[.)]?$", re.I)
_LETTER = re.compile(r"^\(?(?P<l>[a-hA-H])[.)]?$")
_BOTH = re.compile(r"^(?:q\.?\s*)?(?P<n>\d{1,2})\s*[.(]?\s*(?P<l>[a-hA-H])\s*[.)]?$", re.I)
_CO_VAL = re.compile(r"^(?:co\s*)?(?P<n>\d)$", re.I)
_BL_VAL = re.compile(r"^(?:b?\s*l\s*)?(?P<n>[1-6])$", re.I)
_OR = re.compile(r"^\W*or\W*$", re.I)
# In these papers a question with a figure is often a picture with only an OR between two pictures: there is
# no text to read, the crop is the question.
_NO_WORDS = re.compile(r"^(?:[\W_]|\b(?:i{1,3}|iv|v|or|[a-d])\b)*$", re.I)


def header_tail(cells: Sequence[str]) -> Optional[tuple[str, ...]]:
    """("co", "bl") as the last columns are named, when this row is the header of a question table;
    None for any other row. A marks column belongs to the reader that already knew such tables."""
    if len(cells) < 3 or not _Q_HEAD.match(cells[0].strip()):
        return None
    if any(re.match(r"^(?:max\.?\s*)?marks?", c, re.I) for c in cells):
        return None
    tail: list[str] = []
    for c in reversed(cells[1:]):
        kind = "co" if _CO_HEAD.match(c) else "bl" if _BL_HEAD.match(c) else ""
        if not kind or kind in tail:
            break
        tail.insert(0, kind)
    return tuple(tail) if tail and len(cells) - len(tail) >= 2 else None


def _split_tail(cells: list[str], tail: tuple[str, ...]) -> tuple[list[str], dict]:
    """The cells of an item row without its CO and BL values. A row that shows fewer or more values
    than the header has columns keeps none of them: which is which would be a guess."""
    vals: list[str] = []
    rest = list(cells)
    while len(rest) > 1 and (_CO_VAL.match(rest[-1]) or _BL_VAL.match(rest[-1])) and len(vals) < 4:
        vals.insert(0, rest.pop())
    if len(vals) != len(tail):
        return rest, {}
    out = {}
    for kind, v in zip(tail, vals):
        m = (_CO_VAL if kind == "co" else _BL_VAL).match(v)
        if not m:
            return rest, {}
        out[kind] = int(m.group("n"))
    return rest, out


_Q_LIKE = re.compile(r"^\W*q\W", re.I)                     # what is left of a "Q. No" header cell


def _lettered(body: list) -> bool:
    """Most rows are "(a) | a sentence": at least two, and at least 6 in 10 of the rows that are not a header."""
    rows = [full for full, _ in body if not _Q_LIKE.match(full[0])]
    hits = sum(1 for full in rows if len(full) >= 2 and _LETTER.match(full[0]) and len(re.findall(r"[A-Za-z]{3,}", " ".join(full[1:]))) >= 3)
    return hits >= 2 and hits >= 0.6 * len(rows)


def headed_table(rows: list[tuple[list[str], list[float]]], carry: dict) -> list[dict]:
    """The events of one ruled table, in order: {"ev": "q", label parts, text, co, bl, bbox},
    {"ev": "or"}, {"ev": "section", text}. [] when the table is not a question table.

    `rows` holds each row's cells (blanks kept) and its box. `carry` keeps the column order and the
    open number across tables and pages, because these papers print the header once and go on."""
    body = [([c for c in cells if c], box) for cells, box in rows if any(cells)]
    tail = next((x for x in (header_tail(full) for full, _ in body[:3]) if x), None)
    if tail is None and _lettered(body):
        # A watermark printed across the page garbles the header ("E / . / Questions 2 5") on 5 of the real papers.
        # The rows still say what the table is: most start with a bare "(a)" and go on with a sentence. Which
        # of CO and BL a last digit is cannot be known without the header, so it is dropped, not guessed.
        tail = ()
        body = [(full[:-1] if len(full) > 2 and (_CO_VAL.match(full[-1]) or _BL_VAL.match(full[-1])) else full, box) for full, box in body]
        body = [(full, box) for full, box in body if _LETTER.match(full[0]) or (len(full) == 1 and _OR.match(full[0])) or not _Q_LIKE.match(full[0])]
        carry.pop("tail", None)
    if tail is None:
        tail = carry.get("tail")
        if tail is None:
            return []
        # A table without a header is a continuation only when its first row reads like one: an OR, or a
        # label with a CO or BL value at the other end. The course-outcome table ("CO1 | Understand ...") is not.
        first = body[0][0] if body else []
        labelled = bool(first) and bool(_NO.match(first[0]) or _LETTER.match(first[0]) or _BOTH.match(first[0]))
        if not body or not (len(first) == 1 and _OR.match(first[0]) or labelled and len(first) > 2 and _split_tail(first, tail)[1]):
            return []
    out: list[dict] = []
    for full, box in body:
        if header_tail(full) is not None:
            carry["tail"] = header_tail(full)
            continue
        if len(full) == 1 and _OR.match(full[0]):
            out.append({"ev": "or", "bbox": box})
            continue
        if len(full) == 1 and part_letter(full[0]):
            out.append({"ev": "section", "text": full[0], "bbox": box})
            carry.pop("num", None)
            continue
        cells, vals = _split_tail(full, carry.get("tail") or tail)
        num = letter = ""
        both = _BOTH.match(cells[0])
        if both and len(both.group(0)) <= 6 and not _NO.match(cells[0]):
            num, letter, cells = both.group("n"), both.group("l"), cells[1:]
        else:
            if cells and _NO.match(cells[0]) and (len(cells) > 1 or vals):
                num, cells = _NO.match(cells[0]).group("n"), cells[1:]
            if cells and _LETTER.match(cells[0]) and (len(cells) > 1 or vals):
                letter, cells = _LETTER.match(cells[0]).group("l"), cells[1:]
        text = " ".join(cells).strip()
        if not num and not letter:
            last = next((e for e in reversed(out) if e["ev"] == "q"), None)
            if last is not None and (text or vals):              # a long question set on several ruled lines
                last["text"] = (last["text"] + " " + text).strip()
                last["bbox"] = [min(last["bbox"][0], box[0]), min(last["bbox"][1], box[1]), max(last["bbox"][2], box[2]), max(last["bbox"][3], box[3])]
                for k, v in vals.items():
                    last.setdefault(k, v)
            continue
        if num:
            carry["num"] = num
        elif out and out[-1]["ev"] == "or":                      # "2 | a ... OR | b ...": the b belongs to 2
            num = carry.get("num", "")
        else:
            num = carry.get("num", "")
        out.append({"ev": "q", "num": num, "letter": letter.lower(), "text": "" if _NO_WORDS.match(text) else text, "bbox": box, **vals})
    return out if any(e["ev"] == "q" for e in out) else []
