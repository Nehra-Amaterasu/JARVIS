"""The print set of a generated paper (E08, R-25): one self-contained HTML document per kind.

    render_print(paper, kind, *, store=None) -> str      kind "paper", "key" or "marking"

Why self-contained: the page is opened from the app behind the token header, and an <img> request
cannot carry that header, so every crop is embedded as a base64 PNG data URI read through the Store
(plan 9.1.8). No script tag and no external URL: the document prints the same offline and cannot
run anything. Every string that came from a paper or from him passes through html.escape, so a
question whose text is "<script>...</script>" prints as those characters.

Crop first: a page crop cannot be mis-read, recognised text can. A slot with a crop shows the crop,
and its words under it only when he verified them; a slot with no crop shows its words.

What each kind holds: "paper" never carries an answer anywhere in the document; "key" lists the
computed answers of the template slots and says "no key on file" for every other slot (his own
papers carry no worked answers in this wave); "marking" is a table of question, marks and an empty
"got" column to fill in by hand. A4 with 18 mm margins, the size his printed papers use.
"""
from __future__ import annotations

import base64
from html import escape
from typing import Any, Optional

KINDS = ("paper", "key", "marking")
_MAX_CROP_BYTES = 4 * 1024 * 1024    # a page crop at 150 dpi is 50 to 400 KB; a bigger file is not a crop

_CSS = """
@page { size: A4; margin: 18mm; }
html { font-family: Georgia, "Times New Roman", serif; font-size: 11.5pt; color: #111; background: #fff; }
body { margin: 0; }
h1 { font-size: 15pt; margin: 0 0 2mm; }
.note { font-size: 10pt; margin: 0 0 1mm; }
.meta { font-size: 10pt; color: #333; margin: 0 0 5mm; }
h2 { font-size: 12.5pt; margin: 6mm 0 1mm; break-after: avoid; }
.rule { font-style: italic; margin: 0 0 3mm; }
ol { margin: 0; padding-left: 7mm; }
li { margin: 0 0 4mm; break-inside: avoid; }
.text { white-space: pre-wrap; }
.marks { float: right; font-size: 10pt; margin-left: 4mm; }
.crop { display: block; max-width: 100%; max-height: 120mm; margin: 1mm 0; }
.empty { color: #555; font-style: italic; }
.answer { font-weight: bold; }
table { border-collapse: collapse; width: 100%; margin-top: 3mm; }
th, td { border-bottom: 0.3mm solid #999; padding: 2mm 1mm; text-align: left; vertical-align: top; }
td.got { width: 25mm; }
footer { margin-top: 8mm; font-size: 9pt; color: #444; }
"""


def _e(x: Any) -> str:
    return escape("" if x is None else str(x), quote=True)


def _g(x: Any) -> str:
    try:
        return format(float(x), "g")
    except (TypeError, ValueError):
        return _e(x)


def _instruction(sec: dict) -> str:
    att, n = int(sec.get("attempt") or 0), int(sec.get("set") or 0)
    if sec.get("choice") == "or-pairs":
        return f"Answer one question from each pair: any {att} of {n}."
    return f"Answer all {n}." if att >= n else f"Answer any {att} of {n}."


def _crop_uri(store, qid: Optional[str]) -> Optional[str]:
    if store is None or not qid or not str(qid).startswith("q-"):
        return None
    try:
        p = store.crop_path(qid)
    except (KeyError, ValueError, OSError):
        return None
    if p is None:
        return None
    try:
        data = p.read_bytes()
    except OSError:
        return None
    if not data or len(data) > _MAX_CROP_BYTES:
        return None
    return "data:image/png;base64," + base64.b64encode(data).decode("ascii")


def _verified(store, qid: Optional[str]) -> bool:
    if store is None or not qid or not str(qid).startswith("q-"):
        return False
    try:
        return store.get_question(qid).get("text_status") == "verified"
    except (KeyError, ValueError, OSError):
        return False


def _body_of(slot: dict, store) -> str:
    """The question as it prints: crop first, words under it only when he verified them."""
    if slot.get("source") == "hollow":
        return f'<p class="empty">Empty seat: {_e(slot.get("reason"))}.</p>'
    uri = _crop_uri(store, slot.get("question_id")) if slot.get("has_crop") else None
    parts = []
    if uri:
        parts.append(f'<img class="crop" alt="Question {_e(slot.get("n"))} as printed" src="{uri}">')
        if _verified(store, slot.get("question_id")) and slot.get("text"):
            parts.append(f'<div class="text">{_e(slot["text"])}</div>')
    else:
        parts.append(f'<div class="text">{_e(slot.get("text"))}</div>')
    return "".join(parts)


def _head(paper: dict, kind: str) -> str:
    what = {"paper": "Question paper", "key": "Answers", "marking": "Marking sheet"}[kind]
    dur = paper.get("duration_min")
    meta = f"Total {_g(paper.get('total_marks'))} marks" + (f", {_g(dur)} minutes" if dur else "")
    return ("<!doctype html>\n<html lang=\"en\"><head><meta charset=\"utf-8\">"
            f"<title>{_e(paper.get('title'))}: {what}</title><style>{_CSS}</style></head><body>"
            f"<header><h1>{_e(paper.get('title'))}: {what}</h1>"
            f"<p class=\"note\">{_e(paper.get('header'))}</p><p class=\"meta\">{meta}.</p></header>")


def _foot(paper: dict) -> str:
    made = paper.get("made")
    return (f"<footer>Seed {_e(paper.get('seed'))}. Paper {_e(paper.get('id'))}"
            + (f", made {_e(made)}" if made else "") + ".</footer></body></html>\n")


def render_print(paper: dict, kind: str, *, store=None) -> str:
    if kind == "night":
        raise ValueError("The night sheet is planned.")
    if kind not in KINDS:
        raise ValueError("Print kind is paper, key or marking.")
    out = [_head(paper, kind)]
    if kind == "marking":
        out.append("<table><thead><tr><th>Question</th><th>Marks</th><th>Got</th></tr></thead><tbody>")
        for sec in paper.get("sections") or []:
            for slot in sec.get("slots") or []:
                if slot.get("source") == "hollow":
                    continue
                out.append(f"<tr><td>{_e(sec.get('name'))}{_e(slot.get('n'))}</td><td>{_g(slot.get('marks'))}</td>"
                           f"<td class=\"got\"></td></tr>")
        out.append(f"<tr><th>Total attempted</th><th>{_g(paper.get('total_marks'))}</th><td class=\"got\"></td></tr>")
        out.append("</tbody></table>")
        return "".join(out) + _foot(paper)
    for sec in paper.get("sections") or []:
        out.append(f"<section><h2>Section {_e(sec.get('name'))}: {_g(sec.get('marks'))} marks each</h2>"
                   f"<p class=\"rule\">{_instruction(sec)}</p><ol>")
        for slot in sec.get("slots") or []:
            n = _e(slot.get("n"))
            if kind == "paper":
                out.append(f'<li value="{n}"><span class="marks">[{_g(slot.get("marks"))}]</span>{_body_of(slot, store)}</li>')
            else:
                if slot.get("source") == "hollow":
                    line = '<span class="empty">empty seat</span>'
                elif slot.get("source") == "template" and slot.get("key"):
                    line = f'<span class="answer">{_e(slot["key"])}</span>'
                else:
                    line = '<span class="empty">no key on file</span>'
                out.append(f'<li value="{n}">{line}</li>')
        out.append("</ol></section>")
    return "".join(out) + _foot(paper)
