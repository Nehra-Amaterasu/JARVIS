"""Question boxes on one PDF page, read by rule (E06). No model, no guess.

    segment_page(page, *, page_no, skip=()) -> list[Box]   page = PyMuPDF page.get_text("dict")
    read_tables(fitz_page, page_no) -> list[dict]          ruled tables whose header names a question and a marks column
    read_marks(text) -> float | None                       marks only in a printed form
    guess_type(text) -> QType                              by the verbs and the shape of the text
    has_text_layer(text) -> bool                           the specification's test for a page with real text
    rows_of(page, skip=()) -> list[dict]                   the page's lines merged into visual rows

How a page is cut (plan 9.1.4 and the E06 decisions):
- PyMuPDF gives lines with boxes; lines on one baseline (centres within 3 pt) are one row, because a
  number printed at the right edge is a separate line on the same baseline as its question.
- A question starts at a row that matches the start pattern (ww_harvest._PROB generalised: "1.",
  "Q3", "Q.1", "(2)", "4 (a)") AND sits at the page's modal left margin of such rows, within 12 pt.
  The margin rule is what keeps a numbered list inside a question ("1. assume ...", indented) from
  being read as new questions.
- "(a)" or "ii)" at the start of a row opens a sub-part of the question it is in.
- "Section B" or "PART A" (a short row) sets the section of what follows; a row that is only "OR"
  marks the questions on either side as one choice. Either ends the question before it.
- Rows before the first start of a page belong to the last question of the page before (it ran
  over); ingest.py does that stitching, because one page cannot see the next.
- The box is the union of the question's rows plus 6 pt, clipped to the page.

Marks are read only from what is printed (plan 9.1.1 item 1: ww_harvest.guess_marks falls back to
text length and that is not used here): "[5]", "(5)", "(5 marks)", "5 M", "5M", "5 Marks" at the end
of the question's first or last line, or a number alone at the right edge of that line. A question
whose sub-parts all carry printed marks and which prints none itself gets their sum, which is
arithmetic on printed numbers, not a guess. Anything else is None.
"""
from __future__ import annotations

import re
from collections import Counter
from typing import Iterable, Optional, Sequence, TypedDict

from .schema import Part, QType

MARGIN_TOL = 12.0        # pt: a start this far from the modal margin is still a start (plan 9.1.4)
PAD = 6.0                  # pt added round a question's rows (plan 9.1.4)
ROW_TOL = 3.0              # pt between line centres that still share a baseline
RIGHT_EDGE = 0.70          # a lone number right of 70 % of the page width is in the marks column
RIGHT_GAP = 15.0           # pt of white between the text and that number
EDGE_BAND = 0.05           # top and bottom 5 % of a page: where page numbers and running heads sit
MAX_MARKS = 100            # a printed "[500]" is not the marks of one question
MCQ_OPTION = 40            # characters: an option of a multiple-choice question is short; a sub-part is not

_NUM = r"\d{1,3}(?:\.\d{1,2})?"
_UNIT = r"(?:[Mm]arks?|MARKS?|M|points?|pts?)"
# "[5]", "(5)", "(5 marks)", "[10 Marks]", "(3 M)" at the end; not "x(5)" (a bracket glued to a word)
_M_BRACKET = re.compile(rf"(?:^|(?<=[\s.?:;,]))[\[(]\s*(?P<v>{_NUM})\s*{_UNIT}?\s*[\])]\s*\.?\s*$")
# "5 M", "5M", "5 Marks" at the end; "5 m" (metres) is not marks
_M_WORD = re.compile(rf"(?:^|(?<=\s))(?P<v>{_NUM})\s*(?:[Mm]arks?|MARKS?|M)\.?\s*$")
_LONE_NUM = re.compile(rf"^(?P<v>{_NUM})$")

_START = re.compile(
    r"^\s*(?:"
    r"(?:[Qq](?:uestion)?|[Pp]roblem|[Ee]xercise)\s*\.?\s*(?P<a>\d{1,3}[A-Za-z]?)\s*[.:)]?(?=\s|$|\()"
    r"|(?P<b>\d{1,3})\s*[.)](?=\s|$|\()"
    r"|\((?P<c>\d{1,3})\)(?=\s|$)"
    r"|(?P<d>\d{1,3})\s*(?=\()"
    r")\s*")
_PART = re.compile(r"^\s*\(?(?P<p>[a-hA-H]|i{1,3}|iv|vi{0,3}|ix|x)\)\s*")
_HEAD = re.compile(r"^\s*(?:section|part)\s+(?P<l>[A-Za-z])(?:\s*$|\s*[:.\-–(]|\s+\()", re.I)
_HEAD_MAX = 60
_OR = re.compile(r"^\s*[-–—(\[]*\s*or\s*[-–—)\]]*\s*$", re.I)
_TOTAL = re.compile(r"\b(?:max(?:imum)?\.?\s*marks|total\s*marks|full\s*marks|total)\s*[:=\-–]?\s*(?P<v>\d{1,4}(?:\.\d+)?)", re.I)
_NOISE = re.compile(r"^\s*(?:page\s*\d+(?:\s*(?:of|/)\s*\d+)?|\d+\s*(?:/|of)\s*\d+|\d{1,3}|-\s*\d+\s*-)\s*$", re.I)
_GOOD_TOKEN = re.compile(r"^[\w.,;:!?()\[\]{}+\-*/=<>^%'\"°±×÷√∑∫∂≤≥≠≈∞πμΩθλαβγδεσωφ|~&$#@…–—’‘“”•·]+$")

_NUMERICAL = re.compile(r"\b(?:find|calculate|determine|compute)\b", re.I)
_UNITS = re.compile(r"\b(?:ohms?|kohms?|volts?|amperes?|amps?|watts?|hertz|k?hz|mhz|ghz|db|rpm|kva|kw|mw|ma|mv|kv|nc|uf|mh|kg|joules?|newtons?|metres?|meters?|seconds?)\b", re.I)
_DERIVATION = re.compile(r"\b(?:derive|prove|show\s+that)\b", re.I)
_SHORT = re.compile(r"(?:^|[.?!:]\s+)\W*(?:define|state|list|name|what\s+is|what\s+are)\b", re.I)
_OPTION = re.compile(r"(?:^|(?<=\s))\(?(?P<o>[a-dA-D])\)\s+")

_Q_COL = re.compile(r"^(?:q|q\.?\s*no\.?|qn|ques\.?\s*no\.?|question\s*no\.?|s\.?\s*no\.?|sl\.?\s*no\.?|no\.?|#)$")
_TEXT_COL = re.compile(r"^(?:questions?|question\s*text|text|description|statement)$")
_MARKS_COL = re.compile(r"^(?:marks?|max\.?\s*marks?|m|marks?\s*allotted)$")
_CO_COL = re.compile(r"^(?:co|cos|co\s*no\.?|course\s*outcomes?)$")
_BL_COL = re.compile(r"^(?:bl|bt|btl|bloom'?s?(?:\s*(?:level|taxonomy))?|k\s*-?\s*level|rbt(?:\s*level)?|level)$")
_TABLE_PART = re.compile(r"^\(?(?P<p>[a-hA-H]|i{1,3}|iv|vi{0,3}|ix|x)\)?\.?$")
_BLOOM = {1: "easy", 2: "easy", 3: "medium", 4: "medium", 5: "hard", 6: "hard"}


class Box(TypedDict, total=False):
    kind: str                       # "question", "cont" (rows that carry on the last question), "section", "or", "total"
    page: int
    label: str
    text: str
    bbox: list[float]               # PDF points, padded and clipped
    own_marks: Optional[float]      # printed on the question's own first or last line
    marks: Optional[float]          # own, else the sum of its parts when every part prints marks
    marks_source: str               # "printed", "table" or "missing"
    parts: list[Part]
    letter: str                     # kind "section"
    value: float                    # kind "total"
    co: str
    bl: Optional[int]
    difficulty: str
    difficulty_source: str


def _ws(text: str) -> str:
    return re.sub(r"\s+", " ", text or "").strip()


# ------------------------------------------------------------------ marks, type, text layer
def _marks_match(text: str) -> Optional[tuple[float, int]]:
    """(value, start of the printed token) when the text ends in a printed marks form."""
    t = (text or "").rstrip()
    for rx in (_M_BRACKET, _M_WORD):
        m = rx.search(t)
        if m:
            v = float(m.group("v"))
            if 0 < v <= MAX_MARKS:
                return (int(v) if v == int(v) else v), m.start()
    return None


def read_marks(text: str) -> Optional[float]:
    """Marks printed at the end of a line, or None. Never from the length of the text."""
    hit = _marks_match(text)
    return hit[0] if hit else None


def _number(cell: str) -> Optional[float]:
    m = _LONE_NUM.match((cell or "").strip())
    if m:
        v = float(m.group("v"))
        if 0 < v <= MAX_MARKS:
            return int(v) if v == int(v) else v
        return None
    return read_marks(cell or "")


def guess_type(text: str) -> QType:
    """The kind of question by pattern, in this order: four short lettered options is mcq; find,
    calculate, determine or compute with digits or units is numerical; derive, prove or show that is a
    derivation; define, state, list or what is (opening a sentence) is short; else descriptive."""
    t = _ws(text)
    if not t:
        return "unknown"
    opts = list(_OPTION.finditer(t))
    letters = [m.group("o").lower() for m in opts]
    if set("abcd") <= set(letters):
        bodies = [t[m.end():(opts[i + 1].start() if i + 1 < len(opts) else len(t))].strip() for i, m in enumerate(opts)]
        if all(len(b) <= MCQ_OPTION for b in bodies):
            return "mcq"
    if _NUMERICAL.search(t) and (re.search(r"\d", t) or _UNITS.search(t)):
        return "numerical"
    if _DERIVATION.search(t):
        return "derivation"
    if _SHORT.search(t):
        return "short"
    return "descriptive"


def text_quality(text: str) -> tuple[int, float]:
    """(characters, share of tokens that are words, digits or maths symbols)."""
    s = (text or "").strip()
    toks = s.split()
    if not toks:
        return 0, 0.0
    good = sum(1 for tok in toks if _GOOD_TOKEN.match(tok))
    return len(s), good / len(toks)


def has_text_layer(text: str) -> bool:
    """The specification's test: at least 40 characters, and at least 80 % of the tokens are words,
    digits or maths symbols. A scan has no characters; a broken font map has glyph soup."""
    n, share = text_quality(text)
    return n >= 40 and share >= 0.8


# ------------------------------------------------------------------ rows
def _inside(b: Sequence[float], area: Sequence[float]) -> bool:
    cx, cy = (b[0] + b[2]) / 2, (b[1] + b[3]) / 2
    return area[0] <= cx <= area[2] and area[1] <= cy <= area[3]


def rows_of(page: dict, skip: Iterable[Sequence[float]] = ()) -> list[dict]:
    """The text lines of a page grouped into rows on one baseline, top to bottom, each with its
    segments left to right. Lines inside a `skip` box (a table read as rows) are left out, and so
    is a page number or running number in the top or bottom 5 % of the page."""
    skip = [tuple(s) for s in skip]
    h = float(page.get("height") or 0)
    lines = []
    for b in page.get("blocks") or []:
        if b.get("type", 0) != 0:
            continue
        for ln in b.get("lines") or []:
            spans = ln.get("spans") or []
            text = "".join(s.get("text", "") for s in spans)
            if not text.strip():
                continue
            bb = [float(v) for v in ln["bbox"]]
            if any(_inside(bb, s) for s in skip):
                continue
            size = max((float(s.get("size") or 0) for s in spans), default=0.0)
            lines.append({"x0": bb[0], "y0": bb[1], "x1": bb[2], "y1": bb[3], "text": text, "size": size})
    lines.sort(key=lambda l: ((l["y0"] + l["y1"]) / 2, l["x0"]))
    rows: list[dict] = []
    for ln in lines:
        yc = (ln["y0"] + ln["y1"]) / 2
        if rows and abs(yc - rows[-1]["yc"]) <= max(ROW_TOL, 0.3 * (ln["y1"] - ln["y0"])):
            rows[-1]["segs"].append(ln)
        else:
            rows.append({"yc": yc, "segs": [ln]})
    out = []
    for r in rows:
        segs = sorted(r["segs"], key=lambda s: s["x0"])
        row = {"x0": min(s["x0"] for s in segs), "y0": min(s["y0"] for s in segs),
               "x1": max(s["x1"] for s in segs), "y1": max(s["y1"] for s in segs),
               "size": max(s["size"] for s in segs), "segs": segs,
               "text": _ws(" ".join(s["text"] for s in segs))}
        if h and (row["y1"] < h * EDGE_BAND or row["y0"] > h * (1 - EDGE_BAND)) and _NOISE.match(row["text"]):
            continue
        out.append(row)
    return out


def _modal(xs: list[float]) -> float:
    """The most common left edge, to 2 pt; a tie goes to the leftmost."""
    c = Counter(round(x / 2) * 2 for x in xs)
    best = max(c.values())
    return float(min(x for x, n in c.items() if n == best))


def _is_heading(text: str) -> Optional[str]:
    if len(text) > _HEAD_MAX or _START.match(text):
        return None
    m = _HEAD.match(text)
    return m.group("l").upper() if m else None


def _line_marks(text: str, row: dict, width: float) -> tuple[Optional[float], str]:
    """Marks on one line and the line without them: a printed form at the end, else a number
    alone in the marks column at the right edge."""
    hit = _marks_match(text)
    if hit:
        return hit[0], text[:hit[1]].rstrip()
    segs = row.get("segs") or []
    if len(segs) >= 2 and width:
        last, prev = segs[-1], segs[-2]
        m = _LONE_NUM.match(last["text"].strip())
        if m and last["x0"] >= RIGHT_EDGE * width and last["x0"] - prev["x1"] >= RIGHT_GAP:
            v = float(m.group("v"))
            if 0 < v <= MAX_MARKS:
                stripped = text.rstrip()
                num = last["text"].strip()
                if stripped.endswith(num):
                    stripped = stripped[:-len(num)].rstrip()
                return (int(v) if v == int(v) else v), stripped
    return None, text


def _seg_marks(seg: list[tuple[str, dict]], width: float, first: bool, last: bool) -> tuple[Optional[float], list[str]]:
    texts = [t for t, _ in seg]
    order = ([0] if first else []) + ([len(seg) - 1] if last and (not first or len(seg) > 1) else [])
    for i in order:
        v, new = _line_marks(seg[i][0], seg[i][1], width)
        if v is not None:
            texts[i] = new
            return v, texts
    return None, texts


def final_marks(own: Optional[float], parts: list[Part]) -> Optional[float]:
    """Its own printed marks, else the sum of its parts when every part prints marks."""
    if own is not None:
        return own
    if parts and all(p.get("marks") is not None for p in parts):
        s = sum(float(p["marks"]) for p in parts)
        return int(s) if s == int(s) else s
    return None


def pad_box(bbox: Sequence[float], width: float, height: float, pad: float = PAD) -> list[float]:
    x0, y0, x1, y1 = bbox
    return [round(max(0.0, x0 - pad), 2), round(max(0.0, y0 - pad), 2),
            round(min(width, x1 + pad), 2), round(min(height, y1 + pad), 2)]


def _build(kind: str, rows: list[dict], page_no: int, width: float, height: float, m=None) -> Box:
    first = rows[0]
    label = ""
    if m is not None:
        label = next(g for g in m.groups() if g)
        first_text = first["text"][m.end():]
    else:
        first_text = first["text"]
    body: list[tuple[str, dict]] = []
    parts: list[dict] = []
    for i, (text, row) in enumerate([(first_text, first)] + [(r["text"], r) for r in rows[1:]]):
        pm = _PART.match(text) if text else None
        if pm:
            parts.append({"label": pm.group("p"), "lines": [(text[pm.end():], row)]})
        elif parts:
            parts[-1]["lines"].append((text, row))
        elif text or i:
            body.append((text, row))
    if kind == "question":
        own, body_texts = _seg_marks(body, width, first=True, last=not parts) if body else (None, [])
    else:                                         # a carried-over piece: only its last line is the question's last line
        own, body_texts = _seg_marks(body, width, first=False, last=True) if body and not parts else (None, [t for t, _ in body])
    out_parts: list[Part] = []
    for p in parts:
        v, texts = _seg_marks(p["lines"], width, first=True, last=True)
        out_parts.append({"label": p["label"], "text": _ws(" ".join(texts)), "marks": v})
    pieces = [_ws(" ".join(body_texts))] + [f"({p['label']}) {p['text']}" for p in out_parts]
    marks = final_marks(own, out_parts)
    box: Box = {"kind": kind, "page": page_no, "label": label, "text": _ws(" ".join(x for x in pieces if x)),
                "bbox": pad_box([min(r["x0"] for r in rows), min(r["y0"] for r in rows),
                                 max(r["x1"] for r in rows), max(r["y1"] for r in rows)], width, height),
                "own_marks": own, "parts": out_parts, "marks": marks,
                "marks_source": "printed" if marks is not None else "missing"}
    return box


def segment_page(page: dict, *, page_no: int, skip: Iterable[Sequence[float]] = ()) -> list[Box]:
    """The boxes of one page, top to bottom: questions, the carried-over piece at the top (kind
    "cont"), section headings, OR lines and the paper's printed total."""
    width, height = float(page.get("width") or 0), float(page.get("height") or 0)
    rows = rows_of(page, skip)
    starts = [r["x0"] for r in rows if _START.match(r["text"]) and not _is_heading(r["text"])]
    margin = _modal(starts) if starts else None
    out: list[Box] = []
    lead: list[dict] = []
    cur: Optional[dict] = None
    phase = "lead"                                  # lead (top of page), open (in a question), between (after a heading)

    def flush():
        nonlocal cur
        if cur is not None:
            out.append(_build("question", cur["rows"], page_no, width, height, cur["m"]))
            cur = None

    for r in rows:
        t = r["text"]
        letter = _is_heading(t)
        if letter:
            flush()
            out.append({"kind": "section", "page": page_no, "letter": letter, "bbox": pad_box([r["x0"], r["y0"], r["x1"], r["y1"]], width, height, 0)})
            phase = "between"
            continue
        if _OR.match(t):
            flush()
            out.append({"kind": "or", "page": page_no, "bbox": pad_box([r["x0"], r["y0"], r["x1"], r["y1"]], width, height, 0)})
            phase = "between"
            continue
        m = _START.match(t)
        if m and margin is not None and abs(r["x0"] - margin) <= MARGIN_TOL:
            flush()
            cur = {"rows": [r], "m": m}
            phase = "open"
            continue
        if phase == "open":
            cur["rows"].append(r)
            continue
        tot = _TOTAL.search(t)
        if tot:
            v = float(tot.group("v"))
            out.append({"kind": "total", "page": page_no, "value": int(v) if v == int(v) else v,
                        "bbox": pad_box([r["x0"], r["y0"], r["x1"], r["y1"]], width, height, 0)})
            continue
        if phase == "lead":
            lead.append(r)
        # rows after a heading and before the next start are instructions ("Answer any two."): no question's
    flush()
    if lead:
        out.insert(0, _build("cont", lead, page_no, width, height))
    return out


# ------------------------------------------------------------------ tables
def _col_map(names: list[str]) -> Optional[dict]:
    cols: dict[str, int] = {}
    for i, n in enumerate(names):
        low = _ws(n).lower().rstrip(":")
        for key, rx in (("q", _Q_COL), ("text", _TEXT_COL), ("marks", _MARKS_COL), ("co", _CO_COL), ("bl", _BL_COL)):
            if key not in cols and rx.match(low):
                cols[key] = i
                break
    if "marks" in cols and ("q" in cols or "text" in cols):
        return cols
    return None


def _co(cell: str) -> str:
    c = _ws(cell).upper().replace(" ", "")
    if re.fullmatch(r"\d{1,2}", c):
        return f"CO{c}"
    return c if re.fullmatch(r"CO\d{1,2}", c) else ""


def _bl(cell: str) -> Optional[int]:
    m = re.search(r"[1-6]", cell or "")
    return int(m.group()) if m else None


def read_tables(page, page_no: int) -> list[dict]:
    """Every ruled table PyMuPDF finds on the page: {bbox, names, ncols, trace, boxes}. A table whose
    header names a question (or question number) column and a marks column gives one question per
    row, with CO and BL read when those columns exist; any other table gives no boxes."""
    try:
        # find_tables looks for ruled lines; a page with no vector drawing has none. The check costs
        # 0.5 ms a page against 61 ms for find_tables, measured on the 20-page text fixture.
        if not page.get_cdrawings():
            return []
        found = page.find_tables()
    except Exception:                               # a page PyMuPDF cannot analyse still reads as text
        return []
    width, height = float(page.rect.width), float(page.rect.height)
    out = []
    for t in found.tables:
        names = [_ws(str(n or "")) for n in (t.header.names or [])]
        info = {"bbox": [float(v) for v in t.bbox], "names": names, "ncols": t.col_count, "boxes": []}
        cols = _col_map(names)
        if cols is None:
            info["trace"] = f"p{page_no} table {t.col_count} cols: {', '.join(names)}; not a question table"
            out.append(info)
            continue
        info["trace"] = f"p{page_no} table {t.col_count} cols: {', '.join(names)}"
        data = t.extract()
        rbs = [r.bbox for r in t.rows]
        first = 0 if t.header.external else 1
        boxes: list[Box] = []

        def cell(row, key):
            i = cols.get(key)
            return _ws(str(row[i] or "")) if i is not None and i < len(row) else ""

        for i in range(first, min(len(data), len(rbs))):
            row = data[i]
            q, text = cell(row, "q"), cell(row, "text")
            if "text" not in cols:
                text = _ws(" ".join(str(c or "") for j, c in enumerate(row) if j not in cols.values()))
            if not q and not text:
                continue
            rb = [float(v) for v in rbs[i]]
            marks = _number(cell(row, "marks"))
            if boxes and _TABLE_PART.match(q):
                b = boxes[-1]
                b["parts"].append({"label": _TABLE_PART.match(q).group("p"), "text": text, "marks": marks})
                b["bbox"] = pad_box([min(b["bbox"][0] + PAD, rb[0]), b["bbox"][1] + PAD, max(b["bbox"][2] - PAD, rb[2]), rb[3]], width, height)
                continue
            if boxes and not q:
                boxes[-1]["text"] = _ws(boxes[-1]["text"] + " " + text)
                continue
            bl = _bl(cell(row, "bl"))
            b: Box = {"kind": "question", "page": page_no, "label": q.rstrip(".") or str(len(boxes) + 1), "text": text,
                      "bbox": pad_box(rb, width, height), "own_marks": marks, "parts": [], "marks": marks,
                      "marks_source": "table" if marks is not None else "missing", "co": _co(cell(row, "co")), "bl": bl}
            if bl is not None:
                b["difficulty"], b["difficulty_source"] = _BLOOM[bl], "bloom"
            boxes.append(b)
        for b in boxes:
            if b["parts"]:
                b["marks"] = final_marks(b["own_marks"], b["parts"])
                b["marks_source"] = "table" if b["marks"] is not None else "missing"
                b["text"] = _ws(" ".join([b["text"]] + [f"({p['label']}) {p['text']}" for p in b["parts"]]))
        info["boxes"] = boxes
        out.append(info)
    return out
